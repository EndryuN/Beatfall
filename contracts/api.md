# Beatfall pipeline REST API (v1)

Base URL: `http://localhost:8000/api`. JSON everywhere. CORS allows `http://localhost:5173`.

## GET /search?q=<query>
Resolve a song search. If `q` is a YouTube URL or 11-char video id, return a single candidate.
→ 200 `{ "candidates": [ { "videoId": "dQw4w9WgXcQ", "title": "...", "channel": "...", "duration": 213.0, "thumbnail": "https://..." } ] }`

## POST /songs  body: { "videoId": "dQw4w9WgXcQ" }
Idempotent. If beatmaps already exist for (videoId, current versions) → 200 `{ "songId": "yt:dQw4w9WgXcQ", "status": "ready" }`.
Otherwise enqueue → 202 `{ "songId": "yt:dQw4w9WgXcQ", "jobId": "j-1", "status": "queued" }`.

## GET /jobs/{jobId}
→ 200 `{ "jobId": "j-1", "songId": "yt:...", "stage": "queued|downloading|separating|analyzing|generating|done|error", "progress": 0.62, "error": null }`
404 if unknown job.

## GET /songs
→ 200 `[ { "songId": "yt:...", "title": "...", "channel": "...", "duration": 213.0, "thumbnail": "...", "bpm": 113.2, "status": "queued|processing|ready|error", "error": null, "difficulties": ["easy","medium","hard"], "addedAt": "2026-06-11T10:00:00Z" } ]`

## GET /songs/{songId}/analysis
→ 200 AnalysisDoc (validates against analysis.schema.json). 404 if not ready.

## GET /songs/{songId}/beatmaps/{difficulty}
→ 200 Beatmap (validates against beatmap.schema.json). 404 if not ready.

## Not in v1 (decided)
- Scores live in the game's localStorage, keyed by beatmapId. No score endpoints.
- "not-embeddable" detection is client-side only (the IFrame is the only thing that can see error 101/150); MVP shows a blocked overlay, persisting a per-song flag is post-MVP.
- DELETE /songs — YAGNI for the hackathon.
