# Beatfall Service Split — Design Document

**Date:** 2026-06-13
**Status:** Approved — **amended to NATIVE WINDOWS mode** (Docker dropped by decision after
Docker Desktop failed to run; see Amendment below)

## AMENDMENT: native Windows deployment (supersedes container sections)

Docker and Redis are removed. The same architecture ships as native Windows processes:

- **mlib API** = `uvicorn beatfall_pipeline.main:app` on `127.0.0.1:8000` (one process).
- **GPU worker** = `python -m beatfall_pipeline.worker_main` (second process; uses the host
  CUDA stack that already works today).
- **Queue** = `queue_sqlite.SqliteJobQueue` — a WAL-mode SQLite db at `STORE_ROOT/jobs.db`
  with the same five-method interface (`submit/get/set/claim/finish/mark_orphans`); atomic
  claim via `UPDATE … RETURNING`. Durable across restarts. Redis can replace it later behind
  the same interface if multi-machine workers ever happen.
- **Tunnel** = native `cloudflared` installed as a Windows service
  (`cloudflared service install <token>`), routing `api.musiclabs.uk` → `http://localhost:8000`.
- **Runbook** = `start-beatfall.bat` launches both processes in minimized titled windows
  (PATH includes ffmpeg); `stop-beatfall.bat` kills them by window title;
  `service-config.bat` (gitignored, from a committed `.example`) sets `API_KEY`/`CORS_ORIGINS`.
  A Startup-folder shortcut makes it unattended.

Auth, CORS, config.py, the client changes, and the contracts are unchanged from the sections
below. Container sections below are retained for the future hosted version but are NOT being
built now.

## Goal

Turn the GPU pipeline into a containerized, remotely reachable service running unattended on the
desktop (the only GPU machine), published as `https://api.musiclabs.uk`. The game client — developed
and run from a laptop at the hackathon — talks to it over the internet. Starting the whole service is
one double-click (`start-beatfall.bat`).

## Naming: the service is mlib

The API container is **founded as mlib** — the user's planned music-library service. Same codebase
(`pipeline/`), two entrypoints: `mlib` (the API service, container name `mlib`, FastAPI title
"mlib") and the GPU worker. The HTTP surface stays `contracts/api.md` verbatim, so Beatfall the
game is simply mlib's first client; song search (`/search`) is already mlib's natural territory.
Extracting mlib into its own repository is future work, deliberately out of scope — the container
boundary is the seam that makes that extraction mechanical later.

## Architecture

Four containers via `docker-compose.yml` at the repo root, on one Docker network:

```
laptop (game, Vite)  ──HTTPS──▶  Cloudflare edge  ──tunnel──▶  cloudflared ──▶ mlib ──▶ redis ◀── worker (GPU)
                                                                              │                     │
                                                                              └──── data volume ────┘
```

| Container | Image base | Role | GPU |
|---|---|---|---|
| `mlib` | `python:3.12-slim` | FastAPI (the mlib service): validate, enqueue, serve store reads, search, auth | no |
| `worker` | `pytorch/pytorch:*-cuda*-runtime` | consume jobs: yt-dlp → Demucs → basic-pitch → PANNs → generate → store | yes |
| `redis` | `redis:7-alpine` | job queue + job status (durable across restarts) | no |
| `cloudflared` | `cloudflare/cloudflared` | publish api as `api.musiclabs.uk` (outbound tunnel, TLS at edge) | no |

The audit-verified split works because heavy imports are already lazy in the right places:
`main.py`, `jobs-replacement`, `store.py`, `models.py`, `generate.py`, `youtube.py` import no ML
libraries at module load. `steps.py` and `analyze.py` import librosa at the top and are **worker-only**;
the API must never import them (today `main.py` only pulls `RealSteps` lazily inside `create_app` —
that path moves behind the queue).

## Code refactor (pipeline)

New/changed modules in `pipeline/src/beatfall_pipeline/`:

- **`queue_redis.py` (new):** replaces in-memory `jobs.py`. Job records live in Redis hashes
  (`job:<id>` → videoId, stage, progress, error, createdAt; TTL 24 h), the pending queue is a Redis
  list (`jobs:pending`, BRPOP), and `video:<videoId>` → active job id preserves the dedup behavior.
  Stages keep today's vocabulary: `queued|downloading|separating|analyzing|generating|done|error`.
  A job found mid-stage at worker startup (worker crashed) is marked `error: "worker restarted"`.
- **`worker_main.py` (new):** worker entrypoint. Loop: BRPOP job → run `RealSteps` chain with the
  existing progress/stage callbacks writing to Redis → `store.save()` → mark done. One job at a time
  (one GPU). Models stay warm via the existing module-level singletons.
- **`main.py` (changed):** drops `JobQueue`/`RealSteps`; `POST /songs` enqueues via `queue_redis`,
  `GET /jobs/{id}` reads Redis. Adds `X-API-Key` middleware (below) and env-driven config. All
  read endpoints unchanged — the `contracts/api.md` surface is preserved verbatim (one addition:
  401 responses on mutating routes without a valid key).
- **`config.py` (new):** env with defaults — `STORE_ROOT` (default `<repo>/data`), `REDIS_URL`
  (default `redis://localhost:6379`), `CORS_ORIGINS` (comma list, default `http://localhost:5173`),
  `API_KEY` (default empty = auth disabled, for local dev/tests), `MAX_VIDEO_DURATION_S` (720).
- **`pyproject.toml` (changed):** honest dependency groups. `[project]` core: fastapi, uvicorn,
  pydantic, redis. `[api]` extra: yt-dlp (search). `[worker]` extra: yt-dlp, librosa, soundfile,
  numpy, torch, demucs, panns-inference, onnxruntime, pretty_midi, resampy, mir_eval (basic-pitch
  itself stays a documented `--no-deps` install in the worker Dockerfile — its pins don't support
  py3.13).
- **In-process mode stays for tests:** `create_app(store=..., steps=...)` keeps working with the
  current FakeSteps-driven tests by retaining a thread-queue fallback when `REDIS_URL` is unset in
  test construction (existing test suite must stay green; queue_redis gets its own tests against
  `fakeredis`).

## Auth & CORS

- `X-API-Key` header checked by FastAPI middleware on POST/PUT/DELETE only; GETs stay open
  (playing songs costs nothing; adding/remapping/deleting costs GPU/storage). Key is a long random
  string in `.env` (gitignored), generated once. Empty `API_KEY` disables the check (local dev).
- CORS origins from env: localhost dev plus, later, `https://musiclabs.uk`.
- The api container publishes no host port in the compose default; reachable only through the
  tunnel and, for home dev, an optional `127.0.0.1:8000:8000` binding kept in compose.

## Containers — the load-bearing details (from audit)

- **Worker Dockerfile:** CUDA runtime PyTorch base; `apt-get install ffmpeg` (yt-dlp wav
  extraction); `pip install .[worker]` then `pip install basic-pitch --no-deps`. Env:
  `TORCH_HOME=/models/torch` (Demucs checkpoint cache) and `HOME=/models/home` (PANNs writes to
  `~/panns_data` — the audit confirmed the home-dir assumption). Named volume `models` mounted at
  `/models` so ~700 MB of checkpoints download once and survive rebuilds. basic-pitch's model ships
  inside the wheel — nothing to mount.
- **API Dockerfile:** slim Python; `pip install .[api]`; no ffmpeg (search uses
  `skip_download`), no ML wheels; image stays small and rebuilds in seconds.
- **Shared `data` bind mount:** the existing `./data` folder mounts into both containers; the worker
  is the only writer of song artifacts (audit-confirmed single-writer pattern), the api only writes
  via `save_custom`/`delete*` (file-level operations on distinct files — acceptable contention
  profile for one user; not a concurrency redesign).
- **GPU passthrough:** Docker Desktop (WSL2 backend) + NVIDIA driver; compose `deploy.resources`
  device reservation. **First implementation step is the smoke test** `docker run --rm --gpus all
  pytorch/pytorch:… python -c "import torch; print(torch.cuda.is_available())"` — everything else
  waits on it (fallback if it fails: worker runs on CPU, same image, ~5× slower analysis).

## Client changes (game)

Audit found six touch points, all small:

1. `api.ts:3` — `const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000/api'`.
2. `api.ts` — the four mutating calls (`addSong` POST, `deleteSong` DELETE, `saveCustom` PUT,
   `deleteCustom` DELETE) send `X-API-Key` from settings when present.
3. `settings-store.ts` — `apiKey?: string` field.
4. `settings.ts` — password-type input for the key.
5. `library.ts:220` — offline banner stops naming `localhost:8000`; shows the configured base instead.
6. `game/.env.example` — documents `VITE_API_BASE=https://api.musiclabs.uk`.

## Deployment & runbook

- `start-beatfall.bat` → `docker compose up -d --build`; `stop-beatfall.bat` → `docker compose down`.
  `restart: unless-stopped` + Docker Desktop autostart makes reboots self-healing.
- Cloudflare: domain `musiclabs.uk` on Cloudflare DNS (free), a named tunnel whose token lives in
  `.env`; `api.musiclabs.uk` routes to `http://api:8000` inside the compose network.
- Desktop power settings: sleep disabled while plugged in (a GPU box that naps mid-Demucs fails jobs).
- Laptop hackathon setup: clone repo, `npm install`, set `VITE_API_BASE` + API key in game settings —
  no Python, no GPU, no models.

## Error handling

- Worker crash mid-job → job marked `error` with reason on next worker start; UI retry button
  already handles re-submission.
- Redis down → api returns 503 on enqueue with a readable message; reads from the file store still work.
- Tunnel down → game's existing offline banner covers it (now says the configured URL).
- Auth failure → 401 `{detail: "invalid or missing API key"}`; the game surfaces it in the banner
  with a hint to set the key in settings.

## Testing

- `queue_redis` unit tests against `fakeredis` (enqueue/dedup/stage transitions/crash-marking).
- Existing API tests keep running with in-process fallback (no Redis dependency in CI/test).
- Auth middleware tests: 401 without key, 200 with key, GETs open.
- Manual acceptance: laptop on phone hotspot (true outside network) → add song → watch stages →
  play — the full hackathon path.

## Out of scope (explicitly)

- Multi-worker / multi-GPU scheduling; cloud deployment; public song-adding without a key;
  migrating the JSON store to a database (the BeatmapStore interface already isolates that future);
  serving the game itself from musiclabs.uk (designed-for via CORS env, not built here).
