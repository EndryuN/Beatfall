# Beatfall Foundation & Contracts Implementation Plan (run FIRST, together, ~1 hour)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the shared GitHub repo and freeze the JSON/REST contracts + fixtures so Track A (pipeline) and Track B (game) can build in parallel without blocking each other.

**Architecture:** Monorepo with `contracts/` as the single source of truth. Track B develops the entire game against hand-written fixture files; Track A's definition of done is "produces files that validate against these schemas." Trunk-based git: everyone commits to `main`, `git pull --rebase` often. `pipeline/` and `game/` never overlap; changing `contracts/` requires telling the other laptop out loud.

**Tech Stack:** git + GitHub (`gh` CLI), JSON Schema draft 2020-12.

**Spec:** `docs/superpowers/specs/2026-06-11-beatfall-design.md`

**Hackathon scope note:** These plans cover spec Milestones 1–2 (core loop + game feel). Explicitly deferred to post-hackathon: band animation layer, Neon theme, record-scratch/finale effects. Demucs is a stretch task in Track A (HPSS fallback ships first).

---

### Task 1: Create the GitHub repo

**Files:** none (repo plumbing)

- [ ] **Step 1: Create remote and push existing commits** (repo already has the spec committed)

```bash
cd /path/to/Beatfall
gh repo create beatfall --private --source . --push
```

Expected: `✓ Created repository <you>/beatfall` and `main`/`master` pushed.

- [ ] **Step 2: Laptop B clones**

```bash
git clone https://github.com/<you>/beatfall.git
```

- [ ] **Step 3: Agree on the rule of the repo** (say it out loud): commit small, push every green test, `git pull --rebase` before every push, `contracts/` changes are announced verbally.

### Task 2: Write the contract schemas

**Files:**
- Create: `contracts/analysis.schema.json`
- Create: `contracts/beatmap.schema.json`

- [ ] **Step 1: Write `contracts/analysis.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "beatfall/contracts/analysis.schema.json",
  "title": "AnalysisDoc",
  "type": "object",
  "required": ["songId", "analysisVersion", "title", "duration", "bpm", "beatGrid", "roster", "events", "energyCurves"],
  "properties": {
    "songId": { "type": "string", "pattern": "^yt:[A-Za-z0-9_-]{11}$" },
    "analysisVersion": { "type": "integer", "minimum": 1 },
    "title": { "type": "string" },
    "channel": { "type": "string" },
    "duration": { "type": "number", "exclusiveMinimum": 0 },
    "thumbnail": { "type": "string" },
    "bpm": { "type": "number", "exclusiveMinimum": 0 },
    "beatGrid": { "type": "array", "items": { "type": "number", "minimum": 0 } },
    "roster": {
      "type": "array",
      "items": { "enum": ["drummer", "bassist", "singer", "guitarist"] },
      "uniqueItems": true
    },
    "events": { "type": "array", "items": { "$ref": "#/$defs/event" } },
    "energyCurves": {
      "type": "object",
      "required": ["sampleRateHz", "stems"],
      "properties": {
        "sampleRateHz": { "type": "number", "exclusiveMinimum": 0 },
        "stems": {
          "type": "object",
          "additionalProperties": { "type": "array", "items": { "type": "number", "minimum": 0, "maximum": 1 } }
        }
      }
    }
  },
  "$defs": {
    "event": {
      "type": "object",
      "required": ["t", "stem", "kind", "strength"],
      "properties": {
        "t": { "type": "number", "minimum": 0 },
        "stem": { "enum": ["drums", "bass", "vocals", "other"] },
        "kind": { "enum": ["onset", "sustain"] },
        "strength": { "type": "number", "minimum": 0, "maximum": 1 },
        "dur": { "type": "number", "exclusiveMinimum": 0 },
        "pitch": { "type": "number", "description": "MIDI note number, optional, only when confidently detected" },
        "pitchConf": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    }
  }
}
```

- [ ] **Step 2: Write `contracts/beatmap.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "beatfall/contracts/beatmap.schema.json",
  "title": "Beatmap",
  "type": "object",
  "required": ["beatmapId", "songId", "generatorVersion", "difficulty", "mode", "laneCount", "notes"],
  "properties": {
    "beatmapId": { "type": "string", "description": "songId/g<generatorVersion>/<difficulty>/<mode>" },
    "songId": { "type": "string", "pattern": "^yt:[A-Za-z0-9_-]{11}$" },
    "generatorVersion": { "type": "integer", "minimum": 1 },
    "difficulty": { "enum": ["easy", "medium", "hard"] },
    "mode": { "const": "standard" },
    "laneCount": { "const": 4 },
    "notes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["t", "lane", "type"],
        "properties": {
          "t": { "type": "number", "minimum": 0 },
          "lane": { "type": "integer", "minimum": 0, "maximum": 3 },
          "type": { "enum": ["tap", "hold"] },
          "dur": { "type": "number", "exclusiveMinimum": 0 }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add contracts/ && git commit -m "feat(contracts): analysis + beatmap JSON schemas" && git push
```

### Task 3: Write the REST API contract

**Files:**
- Create: `contracts/api.md`

- [ ] **Step 1: Write `contracts/api.md`**

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add contracts/api.md && git commit -m "feat(contracts): REST API contract" && git push
```

### Task 4: Write fixture files (Track B's lifeline)

**Files:**
- Create: `contracts/fixtures/fixture.analysis.json`
- Create: `contracts/fixtures/fixture.beatmap.easy.json`
- Create: `contracts/fixtures/fixture.beatmap.hard.json`

Fixture song: **Rick Astley — Never Gonna Give You Up** (`dQw4w9WgXcQ`): embeddable, stable, ~113 BPM, and funny. Notes are hand-placed on a 113 BPM grid (beat ≈ 0.531 s, first beat ≈ 0.60 s) covering the first ~40 s — enough to feel gameplay.

- [ ] **Step 1: Write `contracts/fixtures/fixture.analysis.json`**

```json
{
  "songId": "yt:dQw4w9WgXcQ",
  "analysisVersion": 1,
  "title": "Never Gonna Give You Up (fixture)",
  "channel": "Rick Astley",
  "duration": 213.0,
  "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
  "bpm": 113.0,
  "beatGrid": [0.60, 1.13, 1.66, 2.19, 2.72, 3.25, 3.78, 4.31, 4.84, 5.37, 5.90, 6.43, 6.97, 7.50, 8.03, 8.56],
  "roster": ["drummer", "singer", "guitarist"],
  "events": [
    { "t": 0.60, "stem": "drums", "kind": "onset", "strength": 0.9 },
    { "t": 1.13, "stem": "drums", "kind": "onset", "strength": 0.7 },
    { "t": 1.66, "stem": "drums", "kind": "onset", "strength": 0.9 },
    { "t": 2.19, "stem": "drums", "kind": "onset", "strength": 0.7 },
    { "t": 2.72, "stem": "vocals", "kind": "sustain", "strength": 0.8, "dur": 1.2, "pitch": 65.0, "pitchConf": 0.9 },
    { "t": 4.31, "stem": "drums", "kind": "onset", "strength": 0.85 }
  ],
  "energyCurves": {
    "sampleRateHz": 15,
    "stems": {
      "drums": [0.1, 0.4, 0.8, 0.7, 0.8, 0.6, 0.8, 0.7, 0.9, 0.8],
      "vocals": [0.0, 0.0, 0.2, 0.5, 0.7, 0.8, 0.6, 0.4, 0.5, 0.6],
      "other": [0.3, 0.4, 0.5, 0.5, 0.6, 0.6, 0.5, 0.5, 0.6, 0.6]
    }
  }
}
```

(The events/curves are illustrative for Track B rendering; the beatmaps below are what gameplay consumes.)

- [ ] **Step 2: Write `contracts/fixtures/fixture.beatmap.easy.json`** — one note per beat-ish, taps + one long hold

```json
{
  "beatmapId": "yt:dQw4w9WgXcQ/g1/easy/standard",
  "songId": "yt:dQw4w9WgXcQ",
  "generatorVersion": 1,
  "difficulty": "easy",
  "mode": "standard",
  "laneCount": 4,
  "notes": [
    { "t": 0.60, "lane": 0, "type": "tap" },
    { "t": 1.66, "lane": 1, "type": "tap" },
    { "t": 2.72, "lane": 2, "type": "tap" },
    { "t": 3.78, "lane": 3, "type": "tap" },
    { "t": 4.84, "lane": 1, "type": "hold", "dur": 1.6 },
    { "t": 6.97, "lane": 2, "type": "tap" },
    { "t": 8.03, "lane": 0, "type": "tap" },
    { "t": 9.09, "lane": 3, "type": "tap" },
    { "t": 10.15, "lane": 1, "type": "tap" },
    { "t": 11.21, "lane": 2, "type": "hold", "dur": 1.6 },
    { "t": 13.34, "lane": 0, "type": "tap" },
    { "t": 14.40, "lane": 3, "type": "tap" },
    { "t": 15.46, "lane": 1, "type": "tap" },
    { "t": 16.52, "lane": 2, "type": "tap" },
    { "t": 17.58, "lane": 0, "type": "hold", "dur": 2.1 },
    { "t": 20.24, "lane": 3, "type": "tap" }
  ]
}
```

- [ ] **Step 3: Write `contracts/fixtures/fixture.beatmap.hard.json`** — ~4 notes/sec bursts, denser patterns

```json
{
  "beatmapId": "yt:dQw4w9WgXcQ/g1/hard/standard",
  "songId": "yt:dQw4w9WgXcQ",
  "generatorVersion": 1,
  "difficulty": "hard",
  "mode": "standard",
  "laneCount": 4,
  "notes": [
    { "t": 0.60, "lane": 0, "type": "tap" }, { "t": 0.87, "lane": 1, "type": "tap" },
    { "t": 1.13, "lane": 2, "type": "tap" }, { "t": 1.40, "lane": 3, "type": "tap" },
    { "t": 1.66, "lane": 0, "type": "tap" }, { "t": 1.93, "lane": 2, "type": "tap" },
    { "t": 2.19, "lane": 1, "type": "tap" }, { "t": 2.46, "lane": 3, "type": "tap" },
    { "t": 2.72, "lane": 2, "type": "hold", "dur": 1.05 },
    { "t": 3.25, "lane": 0, "type": "tap" }, { "t": 3.78, "lane": 1, "type": "tap" },
    { "t": 4.05, "lane": 3, "type": "tap" }, { "t": 4.31, "lane": 0, "type": "tap" },
    { "t": 4.58, "lane": 1, "type": "tap" }, { "t": 4.84, "lane": 2, "type": "tap" },
    { "t": 5.11, "lane": 3, "type": "tap" }, { "t": 5.37, "lane": 0, "type": "tap" },
    { "t": 5.90, "lane": 1, "type": "hold", "dur": 1.05 },
    { "t": 6.97, "lane": 3, "type": "tap" }, { "t": 7.23, "lane": 2, "type": "tap" },
    { "t": 7.50, "lane": 0, "type": "tap" }, { "t": 7.76, "lane": 1, "type": "tap" },
    { "t": 8.03, "lane": 2, "type": "tap" }, { "t": 8.29, "lane": 3, "type": "tap" },
    { "t": 8.56, "lane": 0, "type": "tap" }
  ]
}
```

- [ ] **Step 4: Validate fixtures against schemas** (either laptop, needs Node)

```bash
npx --yes ajv-cli@5 validate -s contracts/analysis.schema.json -d contracts/fixtures/fixture.analysis.json --spec=draft2020
npx --yes ajv-cli@5 validate -s contracts/beatmap.schema.json -d "contracts/fixtures/fixture.beatmap.*.json" --spec=draft2020
```

Expected: `... valid` for all three files.

- [ ] **Step 5: Commit**

```bash
git add contracts/fixtures && git commit -m "feat(contracts): fixture analysis + beatmaps for parallel dev" && git push
```

### Task 5: README quickstart

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
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
````

- [ ] **Step 2: Commit and push**

```bash
git add README.md && git commit -m "docs: README quickstart" && git push
```

**Foundation done — split laptops now.** Laptop A → `2026-06-11-beatfall-track-a-pipeline.md`. Laptop B → `2026-06-11-beatfall-track-b-game.md`.
