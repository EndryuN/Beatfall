# Beatfall Service Split (mlib, NATIVE WINDOWS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the pipeline as two native Windows processes — the mlib API and a GPU worker — joined by a durable SQLite job queue, published at `https://api.musiclabs.uk` via a cloudflared Windows service, started by one bat file; the game points at it via `VITE_API_BASE` + `X-API-Key`.

**Architecture:** mlib enqueues into `STORE_ROOT/jobs.db` (WAL SQLite) and serves store reads; the worker claims jobs atomically and runs the ML chain with the host CUDA stack that already works. No Docker, no Redis — the queue interface (`submit/get/set/claim/finish/mark_orphans`) keeps those swappable later. Existing tests stay green via the retained in-process queue path (used whenever `steps` is injected).

**Tech Stack:** Python 3.13 (host env), SQLite (stdlib `sqlite3`, WAL), FastAPI, native cloudflared Windows service, Vite env vars.

**Spec:** `docs/superpowers/specs/2026-06-13-beatfall-service-split-design.md` (see AMENDMENT)

**Status note:** Task 1 (config.py) is already implemented, reviewed, and committed (`945a0df`).

---

### Task 1: ✅ DONE — `config.py` env configuration (commit 945a0df)

### Task 2: pyproject dependency groups (honest deps, no redis)

**Files:**
- Modify: `pipeline/pyproject.toml`

- [ ] **Step 1: Replace the `dependencies` and `[project.optional-dependencies]` sections** (keep everything else):

```toml
dependencies = [
  "fastapi>=0.110",
  "uvicorn>=0.29",
  "pydantic>=2.6",
]

[project.optional-dependencies]
# mlib API process: search needs yt-dlp (no download, no ffmpeg)
api = ["yt-dlp>=2026.1.1"]
# GPU worker process: the whole ML chain. basic-pitch itself is installed with
#   pip install basic-pitch --no-deps   (its pins fight modern numpy/python)
worker = [
  "yt-dlp>=2026.1.1", "librosa>=0.10.2", "soundfile>=0.12", "numpy>=1.26",
  "torch>=2.4", "demucs>=4.0", "panns-inference>=0.1",
  "onnxruntime>=1.17", "pretty_midi>=0.2.10", "resampy>=0.4", "mir_eval>=0.7",
]
dev = ["pytest>=8", "httpx>=0.27", "jsonschema>=4.21"]
```

- [ ] **Step 2:** `pip install -e ".[worker,api,dev]"` then `python -m pytest -q` → 57 pass.
- [ ] **Step 3: Commit** `chore(pipeline): honest dependency groups for api/worker split`.

### Task 3: `queue_sqlite.py` — durable SQLite job queue (+ QUEUE_DB config)

**Files:**
- Create: `pipeline/src/beatfall_pipeline/queue_sqlite.py`
- Modify: `pipeline/src/beatfall_pipeline/config.py` (add QUEUE_DB)
- Test: `pipeline/tests/test_queue_sqlite.py`

- [ ] **Step 1:** Add to `config.py` (after STORE_ROOT):

```python
QUEUE_DB = Path(os.environ.get("QUEUE_DB") or STORE_ROOT / "jobs.db")
```

- [ ] **Step 2: Write the failing tests**

```python
# pipeline/tests/test_queue_sqlite.py
from beatfall_pipeline.queue_sqlite import SqliteJobQueue

def _q(tmp_path):
    return SqliteJobQueue(tmp_path / "jobs.db")

def test_submit_and_get(tmp_path):
    q = _q(tmp_path)
    job = q.submit("dQw4w9WgXcQ")
    assert job.id.startswith("j-") and job.stage == "queued" and job.video_id == "dQw4w9WgXcQ"
    got = q.get(job.id)
    assert got and got.stage == "queued" and got.progress == 0.0 and got.error is None

def test_dedup_active_job(tmp_path):
    q = _q(tmp_path)
    a = q.submit("dQw4w9WgXcQ")
    b = q.submit("dQw4w9WgXcQ")
    assert a.id == b.id
    q.set(a.id, stage="done")
    c = q.submit("dQw4w9WgXcQ")          # finished → new job allowed
    assert c.id != a.id

def test_claim_and_stage_updates(tmp_path):
    q = _q(tmp_path)
    job = q.submit("dQw4w9WgXcQ")
    assert q.claim(timeout=0) == job.id
    q.set(job.id, stage="separating", progress=0.5)
    got = q.get(job.id)
    assert got.stage == "separating" and got.progress == 0.5
    q.set(job.id, stage="error", error="boom")
    assert q.get(job.id).error == "boom"
    assert q.claim(timeout=0) is None     # queue drained

def test_two_handles_share_state(tmp_path):
    """API and worker are separate processes — separate queue objects, same db file."""
    a, b = _q(tmp_path), _q(tmp_path)
    job = a.submit("dQw4w9WgXcQ")
    assert b.claim(timeout=0) == job.id
    b.set(job.id, stage="analyzing", progress=0.6)
    assert a.get(job.id).stage == "analyzing"

def test_orphan_marking(tmp_path):
    q = _q(tmp_path)
    job = q.submit("dQw4w9WgXcQ")
    q.claim(timeout=0)                    # in-flight, then "worker dies"
    q2 = _q(tmp_path)                     # fresh worker process
    q2.mark_orphans("worker restarted")
    got = q2.get(job.id)
    assert got.stage == "error" and "restarted" in got.error
    q2.finish(job.id)                     # idempotent

def test_get_unknown(tmp_path):
    assert _q(tmp_path).get("j-999") is None
    assert _q(tmp_path).get("garbage") is None
```

- [ ] **Step 3: Run** `python -m pytest tests/test_queue_sqlite.py -q` → FAIL (module missing).
- [ ] **Step 4: Implement `pipeline/src/beatfall_pipeline/queue_sqlite.py`**

```python
"""SQLite-backed job queue: durable, shared by the mlib API and worker processes.

WAL mode allows the two processes to read/write concurrently; claiming is a single
atomic UPDATE…RETURNING so a job can never be picked up twice."""
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

ACTIVE_STAGES = ("queued", "downloading", "separating", "analyzing", "generating")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  error TEXT,
  claimed INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL
);
"""

@dataclass
class JobView:
    id: str
    video_id: str
    stage: str
    progress: float
    error: Optional[str]

def _view(row: sqlite3.Row) -> JobView:
    return JobView(id=f"j-{row['id']}", video_id=row["video_id"], stage=row["stage"],
                   progress=row["progress"], error=row["error"] or None)

def _pk(job_id: str) -> Optional[int]:
    try:
        return int(job_id.split("-", 1)[1])
    except (IndexError, ValueError):
        return None

class SqliteJobQueue:
    def __init__(self, db_path: Path | str):
        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(_SCHEMA)

    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.db_path, timeout=10)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        return c

    def submit(self, video_id: str) -> JobView:
        ph = ",".join("?" * len(ACTIVE_STAGES))
        with self._conn() as c:
            row = c.execute(
                f"SELECT * FROM jobs WHERE video_id=? AND stage IN ({ph}) ORDER BY id DESC LIMIT 1",
                (video_id, *ACTIVE_STAGES)).fetchone()
            if row:
                return _view(row)
            cur = c.execute("INSERT INTO jobs (video_id, created_at) VALUES (?, ?)",
                            (video_id, time.time()))
            return _view(c.execute("SELECT * FROM jobs WHERE id=?", (cur.lastrowid,)).fetchone())

    def get(self, job_id: str) -> Optional[JobView]:
        pk = _pk(job_id)
        if pk is None:
            return None
        with self._conn() as c:
            row = c.execute("SELECT * FROM jobs WHERE id=?", (pk,)).fetchone()
        return _view(row) if row else None

    def set(self, job_id: str, stage: str | None = None,
            progress: float | None = None, error: str | None = None) -> None:
        pk = _pk(job_id)
        if pk is None:
            return
        cols, vals = [], []
        if stage is not None:
            cols.append("stage=?"); vals.append(stage)
        if progress is not None:
            cols.append("progress=?"); vals.append(progress)
        if error is not None:
            cols.append("error=?"); vals.append(error)
        if not cols:
            return
        with self._conn() as c:
            c.execute(f"UPDATE jobs SET {', '.join(cols)} WHERE id=?", (*vals, pk))

    def claim(self, timeout: int = 5) -> Optional[str]:
        """Atomically take the oldest queued job. timeout=0 is a single non-blocking try."""
        deadline = time.time() + timeout
        while True:
            with self._conn() as c:
                row = c.execute(
                    "UPDATE jobs SET claimed=1 WHERE id=("
                    "  SELECT id FROM jobs WHERE stage='queued' AND claimed=0 ORDER BY id LIMIT 1"
                    ") RETURNING id").fetchone()
            if row:
                return f"j-{row['id']}"
            if time.time() >= deadline:
                return None
            time.sleep(0.25)

    def finish(self, job_id: str) -> None:
        pk = _pk(job_id)
        if pk is None:
            return
        with self._conn() as c:
            c.execute("UPDATE jobs SET claimed=0 WHERE id=?", (pk,))

    def mark_orphans(self, reason: str) -> None:
        """Worker startup: anything still claimed+active died with the previous worker."""
        ph = ",".join("?" * len(ACTIVE_STAGES))
        with self._conn() as c:
            c.execute(
                f"UPDATE jobs SET stage='error', error=?, claimed=0 "
                f"WHERE claimed=1 AND stage IN ({ph})",
                (reason, *ACTIVE_STAGES))
```

- [ ] **Step 5: Run** `python -m pytest tests/test_queue_sqlite.py -q` → 6 pass; full suite green. **Commit** `feat(pipeline): durable sqlite job queue`.

### Task 4: `worker_main.py` — worker entrypoint

**Files:**
- Create: `pipeline/src/beatfall_pipeline/worker_main.py`
- Test: `pipeline/tests/test_worker_main.py`

- [ ] **Step 1: Write the failing tests**

```python
# pipeline/tests/test_worker_main.py
from beatfall_pipeline import GENERATOR_VERSION
from beatfall_pipeline.queue_sqlite import SqliteJobQueue
from beatfall_pipeline.store import BeatmapStore
from beatfall_pipeline.worker_main import run_one
from .test_jobs import FakeSteps

def test_run_one_happy_path(tmp_path):
    q = SqliteJobQueue(tmp_path / "jobs.db")
    store = BeatmapStore(tmp_path)
    job = q.submit("dQw4w9WgXcQ")
    assert run_one(q, store, FakeSteps(), timeout=0) is True
    assert q.get(job.id).stage == "done"
    assert store.get_beatmap("yt:dQw4w9WgXcQ", "hard", GENERATOR_VERSION) is not None

def test_run_one_failure_lands_on_job(tmp_path):
    q = SqliteJobQueue(tmp_path / "jobs.db")
    job = q.submit("dQw4w9WgXcQ")
    assert run_one(q, BeatmapStore(tmp_path), FakeSteps(fail_at="fetch"), timeout=0) is True
    j = q.get(job.id)
    assert j.stage == "error" and "unavailable" in j.error

def test_run_one_empty_queue(tmp_path):
    q = SqliteJobQueue(tmp_path / "jobs.db")
    assert run_one(q, BeatmapStore(tmp_path), FakeSteps(), timeout=0) is False
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `pipeline/src/beatfall_pipeline/worker_main.py`**

```python
"""GPU worker entrypoint: consume jobs from the SQLite queue, run the pipeline, write the store."""
import logging

from . import config
from .queue_sqlite import SqliteJobQueue
from .store import BeatmapStore

log = logging.getLogger("beatfall.worker")

def run_one(q: SqliteJobQueue, store: BeatmapStore, steps, timeout: int = 5) -> bool:
    """Process at most one job. Returns False when the queue was empty."""
    job_id = q.claim(timeout=timeout)
    if not job_id:
        return False
    audio = None
    try:
        job = q.get(job_id)
        if job is None:
            return True
        q.set(job_id, stage="downloading", progress=0.0)
        audio, meta = steps.fetch(job.video_id, lambda p: q.set(job_id, progress=p * 0.4))
        q.set(job_id, stage="analyzing", progress=0.5)
        analysis = steps.analyze(audio, meta, stage_cb=lambda s: q.set(job_id, stage=s))
        q.set(job_id, stage="generating", progress=0.85)
        maps = steps.generate(analysis)
        store.save(analysis, maps)
        q.set(job_id, stage="done", progress=1.0)
    except Exception as e:  # job-level failure must not kill the worker loop
        log.exception("job %s failed", job_id)
        q.set(job_id, stage="error", error=str(e))
    finally:
        q.finish(job_id)
        if audio is not None:
            try:
                steps.cleanup(audio)
            except OSError:
                pass
    return True

def main() -> None:
    logging.basicConfig(level=logging.INFO)
    from .steps import RealSteps          # heavy import: worker process only
    q = SqliteJobQueue(config.QUEUE_DB)
    q.mark_orphans("worker restarted")
    store = BeatmapStore(config.STORE_ROOT)
    steps = RealSteps()
    log.info("worker up — store=%s queue=%s", config.STORE_ROOT, config.QUEUE_DB)
    while True:
        run_one(q, store, steps)

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run** `python -m pytest tests/test_worker_main.py -q` → 3 pass. **Commit** `feat(pipeline): worker entrypoint`.

### Task 5: mlib service — queue selection, auth, CORS env

**Files:**
- Modify: `pipeline/src/beatfall_pipeline/main.py`
- Test: `pipeline/tests/test_api_auth.py`

- [ ] **Step 1: Write the failing tests**

```python
# pipeline/tests/test_api_auth.py
from fastapi.testclient import TestClient
from beatfall_pipeline import config
from beatfall_pipeline.main import create_app
from beatfall_pipeline.queue_sqlite import SqliteJobQueue
from beatfall_pipeline.store import BeatmapStore

def _client(tmp_path, monkeypatch, key=""):
    monkeypatch.setattr(config, "API_KEY", key)
    q = SqliteJobQueue(tmp_path / "jobs.db")
    return TestClient(create_app(store=BeatmapStore(tmp_path), queue=q)), q

def test_mutations_need_key_when_configured(tmp_path, monkeypatch):
    c, _ = _client(tmp_path, monkeypatch, key="sekrit")
    assert c.post("/api/songs", json={"videoId": "dQw4w9WgXcQ"}).status_code == 401
    r = c.post("/api/songs", json={"videoId": "dQw4w9WgXcQ"},
               headers={"X-API-Key": "sekrit"})
    assert r.status_code == 202
    assert c.get("/api/songs").status_code == 200          # reads stay open

def test_auth_disabled_when_no_key(tmp_path, monkeypatch):
    c, _ = _client(tmp_path, monkeypatch, key="")
    assert c.post("/api/songs", json={"videoId": "dQw4w9WgXcQ"}).status_code == 202

def test_sqlite_queue_drives_job_endpoint(tmp_path, monkeypatch):
    c, q = _client(tmp_path, monkeypatch)
    job_id = c.post("/api/songs", json={"videoId": "dQw4w9WgXcQ"}).json()["jobId"]
    q.set(job_id, stage="separating", progress=0.4)
    j = c.get(f"/api/jobs/{job_id}").json()
    assert j["stage"] == "separating" and j["songId"] == "yt:dQw4w9WgXcQ"
```

- [ ] **Step 2: Run** → FAIL (`create_app` has no `queue` param).
- [ ] **Step 3: Modify `main.py`** — keep every existing route body intact. Signature and setup become:

```python
# imports add:
from fastapi.responses import JSONResponse
from . import config

def create_app(store: BeatmapStore | None = None, steps: PipelineSteps | None = None,
               queue=None) -> FastAPI:
    if store is None:
        store = BeatmapStore(config.STORE_ROOT)
    if queue is None:
        if steps is not None:                      # tests: in-process thread queue
            q = JobQueue(store, steps)
            q.start()
            queue = q
        else:                                      # service mode: shared sqlite queue
            from .queue_sqlite import SqliteJobQueue
            queue = SqliteJobQueue(config.QUEUE_DB)

    app = FastAPI(title="mlib")
    app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS,
                       allow_methods=["*"], allow_headers=["*"])

    @app.middleware("http")
    async def require_api_key(request, call_next):
        if config.API_KEY and request.method in ("POST", "PUT", "DELETE") \
                and request.headers.get("x-api-key") != config.API_KEY:
            return JSONResponse(status_code=401,
                                content={"detail": "invalid or missing API key"})
        return await call_next(request)
```

Replace each `queue.submit(...)`/`queue.get(...)` usage accordingly (the in-process `JobQueue`
and `SqliteJobQueue` both expose `.submit(video_id)` returning an object with
`id/video_id/stage/progress/error`, and `.get(job_id)`). The old default
`RealSteps` import path disappears from main.py entirely (the API process never imports ML code).
Wrap the enqueue:

```python
        try:
            job = queue.submit(body.videoId)
        except Exception:
            raise HTTPException(503, "job queue unavailable")
```

- [ ] **Step 4: Run the whole suite** `python -m pytest -q` → everything green (old API tests pass
`steps=FakeSteps()` → in-process path preserved).
- [ ] **Step 5: Commit** `feat(pipeline): mlib service - sqlite queue, API-key auth, env CORS`.

### Task 6: bat scripts + service config

**Files:**
- Create: `start-beatfall.bat`, `stop-beatfall.bat`, `service-config.example.bat` (repo root)
- Modify: `.gitignore` (add `service-config.bat`, `data/jobs.db*`)

- [ ] **Step 1: `service-config.example.bat`**

```bat
@echo off
:: copy to service-config.bat (gitignored) and fill in.
:: generate a key:  python -c "import secrets; print(secrets.token_urlsafe(32))"
set API_KEY=
set CORS_ORIGINS=http://localhost:5173,https://musiclabs.uk
```

- [ ] **Step 2: `start-beatfall.bat`**

```bat
@echo off
cd /d "%~dp0"
if exist service-config.bat call service-config.bat
:: ffmpeg (winget install) is not on PATH in fresh shells
set "PATH=C:\Users\Endryu\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin;%PATH%"
start "mlib-api" /min cmd /c "cd pipeline && python -m uvicorn beatfall_pipeline.main:app --host 127.0.0.1 --port 8000"
start "mlib-worker" /min cmd /c "cd pipeline && python -m beatfall_pipeline.worker_main"
echo mlib starting:  http://localhost:8000/api/songs
echo (two minimized windows: mlib-api, mlib-worker)
```

- [ ] **Step 3: `stop-beatfall.bat`**

```bat
@echo off
taskkill /FI "WINDOWTITLE eq mlib-api*" /T /F
taskkill /FI "WINDOWTITLE eq mlib-worker*" /T /F
```

- [ ] **Step 4:** Append to `.gitignore`: `service-config.bat` and `data/jobs.db*`.
- [ ] **Step 5: Commit** `feat: native service runbook (start/stop bats + service config)`.

### Task 7: Boot natively and run a real song through both processes

**Files:** none (verification)

- [ ] **Step 1:** Stop any old dev uvicorn. Copy `service-config.example.bat` → `service-config.bat`, set a real `API_KEY`. Run `start-beatfall.bat`.
- [ ] **Step 2:** `curl http://localhost:8000/api/songs` → 200 with the existing library.
- [ ] **Step 3:** Real job (PowerShell):

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/songs -Headers @{"X-API-Key"="<key>"} -ContentType application/json -Body '{"videoId":"dQw4w9WgXcQ","force":true}'
```

Poll `/api/jobs/j-1` → stages walk to done (worker window shows logs; GPU active).
- [ ] **Step 4 (durability):** enqueue another job, run `stop-beatfall.bat` mid-download, `start-beatfall.bat` again → that job shows `error: worker restarted` (orphan marking) and a retry from the UI works. A queued-but-unclaimed job instead survives and processes.
- [ ] **Step 5:** Wrong key → 401; no key on GET → 200.

### Task 8: Cloudflare domain + tunnel as a Windows service (manual)

- [ ] **Step 1:** Register `musiclabs.uk`, add site to Cloudflare free plan, switch nameservers at the registrar.
- [ ] **Step 2:** `winget install Cloudflare.cloudflared`
- [ ] **Step 3:** Cloudflare dashboard → Zero Trust → Networks → Tunnels → Create tunnel (`beatfall`). Copy the install command it shows — on Windows it is `cloudflared service install <token>` — run it in an **admin** PowerShell. The tunnel now runs as a Windows service (survives reboots, no bat needed).
- [ ] **Step 4:** Tunnel → Public Hostname: `api.musiclabs.uk` → `http://localhost:8000`.
- [ ] **Step 5:** From a phone on mobile data: `https://api.musiclabs.uk/api/songs` → 200 JSON.

### Task 9: Game client — env base URL + API key

**Files:**
- Modify: `game/src/api.ts` (BASE + key headers), `game/src/settings-store.ts` (apiKey), `game/src/screens/settings.ts` (key input), `game/src/screens/library.ts` (banner copy)
- Create: `game/.env.example`

- [ ] **Step 1:** `api.ts` top:

```ts
import { loadSettings } from './settings-store';

export const BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8000/api';

function keyHeaders(): Record<string, string> {
  const k = loadSettings().apiKey;
  return k ? { 'X-API-Key': k } : {};
}
```

Spread `...keyHeaders()` into the headers of `addSong` (POST) and `saveCustom` (PUT); give
`deleteSong`/`deleteCustom` fetches `headers: keyHeaders()`.
- [ ] **Step 2:** `settings-store.ts`: add `apiKey?: string;` to `Settings`.
- [ ] **Step 3:** `settings.ts`: add a field

```html
<label>API key <input id="apikey" type="password" value="${s.apiKey ?? ''}" placeholder="needed for remote mlib"></label>
```

save handler: `s.apiKey = (root.querySelector('#apikey') as HTMLInputElement).value.trim() || undefined;`
- [ ] **Step 4:** `library.ts` offline banner → `` banner.textContent = `⚠ mlib unreachable at ${BASE} — is the service up?` `` (import `BASE` from `../api`).
- [ ] **Step 5:** `game/.env.example`:

```ini
# point the game at a remote mlib (omit for local dev = http://localhost:8000/api)
VITE_API_BASE=https://api.musiclabs.uk/api
```

- [ ] **Step 6:** `npx tsc --noEmit && npm test` → 40 pass. **Commit** `feat(game): configurable API base + X-API-Key for remote mlib`.

### Task 10: Contract + README runbook

**Files:**
- Modify: `contracts/api.md`, `README.md`

- [ ] **Step 1:** `api.md`: note on mutating endpoints: `Requires header X-API-Key when the service is configured with API_KEY (401 otherwise); GETs never require it.` Mention remote base `https://api.musiclabs.uk/api`.
- [ ] **Step 2:** README Run section → native flow: `start-beatfall.bat` on the desktop; laptop = `npm run dev` + `VITE_API_BASE` + key in game settings; note the Startup-folder shortcut trick for unattended boot, and that cloudflared runs as a Windows service.
- [ ] **Step 3: Commit** `docs: native service runbook`.

### Task 11: Hackathon acceptance test (manual)

- [ ] From a non-LAN network (laptop on phone hotspot): `VITE_API_BASE=https://api.musiclabs.uk/api` in `game/.env`, API key in game settings → add a song → stages stream → play. Wrong key → 401 banner; reads keyless → fine.

---

**Definition of done:** a song processes end-to-end via `api.musiclabs.uk` from another network; jobs survive process restarts (orphans marked, queued jobs kept); all pipeline + 40 game tests green; `start-beatfall.bat` is the only thing run on the desktop.
