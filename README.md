# Beatfall

Rhythm game for any YouTube song. Video + audio play from the official YouTube embed;
a local pipeline analyzes audio once to generate beatmaps. Spec: `docs/superpowers/specs/`.

## Layout
- `contracts/` — JSON schemas, REST contract, fixtures. Source of truth between the two halves.
- `pipeline/`  — Python FastAPI server: yt-dlp → stems → librosa → beatmaps. Port 8000.
- `game/`      — Vite + TypeScript game. Port 5173.

## Run (desktop = the mlib service)

One-time: copy `service-config.example.bat` → `service-config.bat`, set an API key.

```bat
start-beatfall.bat   :: mlib API (port 8000) + GPU worker, minimized windows
stop-beatfall.bat
```

Unattended: put a shortcut to `start-beatfall.bat` in `shell:startup`. The cloudflared
tunnel (`api.musiclabs.uk`) runs separately as a Windows service and survives reboots.

## Run (laptop = the game)

```bash
cd game && npm install
# remote service: copy .env.example to .env (sets VITE_API_BASE), and paste the
# API key into the game's settings screen
npm run dev
```

Local dev fallback (everything on one machine, no service scripts):
`pip install -e "pipeline[worker,api,dev]"` then run the two processes manually, or just
`start-beatfall.bat` — the game defaults to http://localhost:8000/api.

## Hackathon workflow
Trunk-based on main. Pull --rebase before push. Announce `contracts/` changes out loud.
Plans: `docs/superpowers/plans/` — `00-foundation` (done), `track-a-pipeline` (laptop A), `track-b-game` (laptop B).
