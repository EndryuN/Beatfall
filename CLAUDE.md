# CLAUDE.md — Beatfall

Working notes for AI agents and humans. Keep this current when architecture changes.

## What this is

**Beatfall** — a Tap Tap Revolution–style rhythm game for any YouTube song. The video plays
in its own untouched pane (ToS-clean: ads roll, views count); notes fall on a canvas highway
beside it. A local GPU pipeline analyzes each song once and generates beatmaps; the game streams
video+audio from the YouTube embed at play time (downloaded audio is analysis-only, then deleted).

The backend service is branded **mlib** (a reusable music-library/processing service); Beatfall the
game is its first client. Public domains (planned): `beatfall.<tld>` = game frontend,
`api.musiclabs.uk` = mlib API.

## Repo layout

```
pipeline/                 Python — the mlib service (API + GPU worker)
  src/beatfall_pipeline/
    main.py               FastAPI app "mlib": routes, auth middleware, queue selection
    worker_main.py        GPU worker entrypoint (run_one + main loop)
    queue_sqlite.py       durable SQLite job queue (submit/get/set/claim/finish/mark_orphans)
    jobs.py               legacy in-process thread queue — TESTS ONLY (injected via steps=)
    config.py             env config (STORE_ROOT, QUEUE_DB, CORS_ORIGINS, API_KEY, MAX_VIDEO_DURATION_S)
    steps.py              RealSteps: fetch→analyze→generate→cleanup (imports librosa — worker only)
    store.py              BeatmapStore: JSON files under data/ (library.json + songs/<id>/...)
    models.py             pydantic: Event, AnalysisDoc, Note, Beatmap, SongMeta
    analyze.py            librosa analysis + orchestrates stems/transcribe/instruments
    separate.py           Demucs htdemucs stem separation (GPU)
    transcribe.py         basic-pitch audio→notes (the "piano cover" pass)
    instruments.py        PANNs lead-instrument tagging → band member (strings=violinist, piano=pianist, else guitarist)
    generate.py           beatmap generator (down-charting; the DIFF table is the tuning surface)
    youtube.py            yt-dlp fetch + search
  tests/                  pytest (73 passing)
game/                     Vite + TypeScript — the game client
  src/
    main.ts               screen router (library → game / editor / settings)
    api.ts                fetch wrapper; BASE from VITE_API_BASE; X-API-Key on mutations
    settings-store.ts     localStorage Settings (keyCodes, laneCount 3|4, theme, apiKey, ...)
    scores.ts             localStorage personal bests, keyed by beatmapId
    engine/               clock, judge, chart, sync (ad/pause state machine), project (4→3 lanes)
    render/               highway, effects, theme, visualizer
    band/                 cartoon band: band.ts (state) + render.ts (vector draw)
    screens/              library, game, editor, settings, results
  tests/ (*.test.ts)      vitest (46 passing)
contracts/                api.md + analysis.schema.json + beatmap.schema.json + fixtures/
docs/superpowers/         specs/ and plans/ (design history — may lag current code)
start-beatfall.bat        launches mlib API + worker (minimized windows)
stop-beatfall.bat         kills them by window title
service-config.example.bat → copy to service-config.bat (GITIGNORED: holds API_KEY)
```

## How to run

**Desktop (the only GPU machine = the mlib service):**
```
start-beatfall.bat     # mlib API on 127.0.0.1:8000 + GPU worker; reads service-config.bat
stop-beatfall.bat
```
Two processes share `data/jobs.db` (SQLite queue) and the `data/` store. `restart: unless-stopped`
behavior is manual here; a Startup-folder shortcut makes it unattended.

**Game (laptop or same machine):**
```
cd game && npm install && npm run dev      # localhost:5173, defaults to localhost:8000 API
```
Remote: set `VITE_API_BASE` (game/.env), paste the API key into the game's ⚙ settings.

**Local dev fallback (no bats):** `pip install -e "pipeline[worker,api,dev]"`, then run uvicorn +
`python -m beatfall_pipeline.worker_main` manually. No Redis/Docker — rejected in favor of native.

## Architecture (current)

```
game (browser) ──REST──▶ mlib API (uvicorn :8000) ──▶ SQLite queue (data/jobs.db) ◀── GPU worker
                              │  (thin: validate/enqueue/serve reads, auth)        │  (the ML chain)
                              └──────────────── data/ store (shared) ──────────────┘
```
- **API never imports ML libs** (verified: `import beatfall_pipeline.main` leaves librosa out of
  sys.modules). All heavy work is behind the queue in the worker.
- **Queue is durable**: jobs survive restarts; a job claimed when the worker dies is marked
  `error: "worker restarted"` (orphan marking) on next start.
- **Auth is tunnel-aware**: `X-API-Key` required only on mutating requests (POST/PUT/DELETE) that
  arrive through the Cloudflare tunnel (`cf-ray` header). Direct loopback (local dev) needs no key.
  GETs are always open. `API_KEY=""` disables auth entirely (tests).
- **cloudflared** (planned, not yet set up) publishes the API as `https://api.musiclabs.uk`.

## Pipeline chain (per song)

yt-dlp fetch → **Demucs** htdemucs stems (drums/bass/vocals/other, GPU) → per-stem analysis:
drum onsets classified kick/snare/hat by spectral band; **basic-pitch** transcribes vocals/other/bass
into real note events (the "piano cover"); **PANNs** tags the lead instrument (string-led →
violinist on stage) → **generator v7**: charts HARD first, then down-charts Medium⊂Hard, Easy⊂Medium
(same notes/lanes, fewer) so patterns transfer across difficulties. Energy-adaptive density,
bar-pattern reuse, kick/snare lane semantics, chords on big hits, stream fills in loud sections,
per-difficulty same-lane gap (easy 0.22s / med 0.15 / hard 0.09 — hard allows rapid streams).
Tuning lives in the `DIFF` table in generate.py.

## Versioning (important)

`__init__.py` holds `ANALYSIS_VERSION` (currently 7) and `GENERATOR_VERSION` (currently 8).
Bumping either makes existing maps show `status: "outdated"` in the library → user clicks **remap**
(⟳) to reprocess. Custom (hand-authored) maps have `mode: "custom"`, `generatorVersion: 0`, and
NEVER go outdated — they survive remaps. Bump the relevant version whenever analysis or generation
output changes meaningfully.

## Game specifics

- **Lanes**: maps are stored 4-lane (a 3-lane chart is just one that never uses lane 3);
  `engine/project.ts` folds 4→3 at play time when the library's 🎹 toggle / settings chooses 3.
  The editor ALSO honors the lane setting (records to 3 lanes, folding any lane-3 notes on load).
  Settings shows one remappable key per lane (3 in 3-lane).
- **Editor** (`screens/editor.ts`): preview / edit / record modes (E, R keys). Record = tap keys to
  the music (holds from key-hold duration, 16th-snap). Edit-mode mouse: click empty = place, click
  note = select (outlined), drag = move, right-click or Del = remove, +/- stretch selected into a
  hold, ctrl+z undo. Per-stem waveform rails + beat lines; save & test. Custom maps via PUT.
- **Sync** (`engine/sync.ts`): YouTube has no ad signal, so ads/buffering = "player says playing but
  content time isn't advancing." Notes freeze during ads/pause; seek → run marked unranked.
- **Clock** (`engine/clock.ts`): perf.now()-based, reconciled to player time, ignores stale samples.
- **iframe focus**: clicking the YouTube embed steals keyboard focus — `keepKeyboardFocus()` in
  youtube.ts kicks it back so DFJK/Esc/R keep working.

## Testing & conventions

- Pipeline: `cd pipeline && python -m pytest -q` (73). Game: `cd game && npm test` (46) +
  `npx tsc --noEmit`. **Run all three before claiming done.** TDD is the norm here.
- Trunk-based: commit straight to `master`, small commits. Co-author line:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The `contracts/` schemas are the cross-boundary source of truth; changing them means updating both
  sides + fixtures. Schema fixtures are validated with `ajv-cli`.

## Known gotchas

- **ffmpeg** isn't on PATH in fresh shells — `start-beatfall.bat` prepends the winget install path
  (hardcoded version string → breaks on ffmpeg upgrade; fix the path if downloads fail at wav extract).
- **Transient SSL errors** (`DECRYPTION_FAILED_OR_BAD_RECORD_MAC`) on this machine's network hit pip
  and yt-dlp intermittently — retries succeed; the library's retry button covers job failures.
- **basic-pitch** must be installed `pip install basic-pitch --no-deps` (its pins fight py3.13);
  real runtime deps are in the `[worker]` extra.
- **PANNs** writes to `~/panns_data`; the checkpoint (~300MB) and AudioSet labels download on first use.
- GPU-in-Docker was abandoned (Docker Desktop wouldn't run here); the stack is native Windows. The
  container design is retained in the spec for a future hosted version only.

## Outstanding (not built)

GitHub remote (repo is local-only — needs `gh auth login` then `gh repo create`); Cloudflare tunnel +
domain wiring; deploying the frontend to `beatfall.<tld>`. Future ideas: multiplayer (async ghost
battles), extracting mlib to its own repo.
