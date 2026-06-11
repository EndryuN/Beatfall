# Beatfall

Rhythm game for any YouTube song. Video + audio play from the official YouTube embed;
a local pipeline analyzes audio once to generate beatmaps. Spec: `docs/superpowers/specs/`.

## Layout
- `contracts/` — JSON schemas, REST contract, fixtures. Source of truth between the two halves.
- `pipeline/`  — Python FastAPI server: yt-dlp → stems → librosa → beatmaps. Port 8000.
- `game/`      — Vite + TypeScript game. Port 5173.

## Run
```bash
# pipeline (Python 3.11+, ffmpeg on PATH)
cd pipeline && pip install -e ".[dev]" && uvicorn beatfall_pipeline.main:app --port 8000
# game (Node 20+)
cd game && npm install && npm run dev
```

## Hackathon workflow
Trunk-based on main. Pull --rebase before push. Announce `contracts/` changes out loud.
Plans: `docs/superpowers/plans/` — `00-foundation` (done), `track-a-pipeline` (laptop A), `track-b-game` (laptop B).
