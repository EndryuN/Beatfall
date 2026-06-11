# Beatfall — Design Document

**Date:** 2026-06-11
**Status:** Approved (brainstorming phase complete)

## What it is

A Tap Tap Revolution–style rhythm game for the browser. The player picks any YouTube song; a local pipeline analyzes the audio once and generates beatmaps; at play time the actual YouTube video plays in its own pane (video *and* audio come from the embed — ads roll, views count, revenue flows to the creator) while the player hits falling notes beside it. A goofy cartoon band performs on a stage below the video, animating to the song's real instruments and reacting to the player's mistakes.

**Scope:** v1 is local, single-user. The architecture deliberately isolates everything that must change for the future hosted, multi-user version (shared beatmap database, mlib song search) behind interfaces.

## Decisions log

| Topic | Decision |
|---|---|
| Platform | Web app (browser frontend + local pipeline server) |
| Audience | Local/personal v1; hosted public site is the long-term goal |
| Screen layout | "Stage + Highway": note highway in one column, untouched YouTube player in the other (ToS-clean, no overlays on the player). Mirror toggle: highway left (default) or right |
| Lanes / input | 4 lanes, keyboard, D F J K default, fully remappable |
| Note types | Taps + holds |
| Difficulties | Easy / Medium / Hard, all generated from one analysis pass |
| Ads | Auto-detect (time-progress heuristic), wait panel, 3-2-1 count-in. Same mechanism handles buffering |
| Stack | Python pipeline (FastAPI + yt-dlp + Demucs + librosa), TypeScript frontend (Vite, canvas) |
| Art direction | "Dark Stage" default theme (sleek dark concert UI + cartoon band); "Neon Arcade" switchable theme |
| Band placement | Stage panel under the video in the right pane |
| Library screen | Compact list rows with per-song best grade/combo, search-or-paste bar on top |

## Architecture

Two local processes:

```
Browser (Vite + TypeScript)                Local pipeline server (Python + FastAPI)
┌─────────────────────────────┐            ┌──────────────────────────────────────┐
│ Library screen              │  REST +    │ POST /songs {query|url} → job        │
│ Game screen                 │  progress  │ 1. Resolve (SongResolver)            │
│   YouTube IFrame (pane)     │  polling   │ 2. Fetch audio (yt-dlp) → temp file  │
│   Canvas highway            │ ◄────────► │ 3. Stems (Demucs)                    │
│   Band animation layer      │            │ 4. Analyze (librosa, per stem)       │
│ Settings                    │            │ 5. Generate Easy/Med/Hard beatmaps   │
└─────────────────────────────┘            │ 6. Save via BeatmapStore, delete audio│
                                           └──────────────────────────────────────┘
                                                            │
                                           Local storage: library.json + beatmaps/*.json
```

- **No audio is ever kept.** Downloaded audio exists only for the duration of analysis, then is deleted. Playback always streams from YouTube.
- **Analysis jobs** run one at a time in a queue; the frontend polls job progress (downloading / separating stems / analyzing / generating) and shows it inline on the library row.

### Key interfaces (the future-proofing layer)

- **`BeatmapStore`** — `get(songId, versions)`, `save(...)`, `list()`. v1: JSON files. Hosted later: a real database. The pipeline always checks the store before processing, so a song is analyzed **once ever** (per pipeline version) — locally now, globally when hosted.
- **`SongResolver`** — `search(query) → [{videoId, title, duration, thumbnail}]`, `resolve(videoId) → metadata`. v1: yt-dlp `ytsearch:` (no API key, no quota). Future: the user's **mlib** project implements the same contract (own catalog first, YouTube Data API fallback). Nothing else in Beatfall changes when it swaps in.

## Data model

Facts about the song are stored separately from the games built on those facts:

```
song (songId = "yt:<videoId>")
 └─ analysis   keyed by songId + analysisVersion          ← expensive, cached artifact
     └─ beatmap keyed by songId + generatorVersion
                 + difficulty + mode                      ← cheap, derived, PINNED
         └─ score/session (references beatmapId)          ← future leaderboards stay valid
```

### analysis.json (per song)

```jsonc
{
  "songId": "yt:dQw4w9WgXcQ",
  "analysisVersion": 1,
  "title": "...", "channel": "...", "duration": 213.4, "thumbnail": "...",
  "bpm": 113.2,
  "beatGrid": [0.53, 1.06, ...],            // beat timestamps, full mix
  "roster": ["drummer", "bassist", "singer", "guitarist"],  // from stem activity
  "events": [
    // everything detectable, game-agnostic
    { "t": 12.34, "stem": "drums",  "kind": "onset",   "strength": 0.82 },
    { "t": 13.10, "stem": "vocals", "kind": "sustain", "dur": 1.4,
      "pitch": 62.3, "pitchConf": 0.9 }
  ],
  "energyCurves": { "drums": [...], "bass": [...], "vocals": [...], "other": [...] } // ~15 Hz
}
```

- **Pitch is optional and confidence-scored.** Monophonic stems (vocals, bass) get reliable pitch via pYIN; polyphonic content does not — nothing load-bearing depends on exact pitch. Full transcription ("that was a C#4 on guitar") is explicitly out of scope.

### beatmap json (3 per song, derived deterministically)

```jsonc
{
  "beatmapId": "yt:dQw4w9WgXcQ/g1/hard/standard",
  "songId": "yt:dQw4w9WgXcQ",
  "generatorVersion": 1, "difficulty": "hard", "mode": "standard",
  "laneCount": 4,
  "notes": [ { "t": 12.32, "lane": 2, "type": "tap" },
             { "t": 13.08, "lane": 0, "type": "hold", "dur": 1.4 } ]
}
```

- **Generation is deterministic and maps are stored, never regenerated at play time** — two plays of the same map are always the same game, which keeps scores comparable (and future leaderboards honest).
- `pipelineVersion` = (analysisVersion, generatorVersion). Improving the generator later lazily upgrades maps without re-downloading anything.

## Pipeline internals

1. **Fetch:** yt-dlp, best-audio format + metadata.
2. **Separate:** Demucs → drums / bass / vocals / other. (The heavy step: minutes on CPU, seconds on GPU — paid once per song ever.)
3. **Analyze per stem (librosa):**
   - Full mix → beat grid + BPM.
   - Drums stem → onset detection with strength scores (candidate taps).
   - Vocals + bass stems → pYIN pitch tracking; stable pitched segments ≥ ~0.5 s → candidate holds.
   - Other stem → onsets for melodic accents.
   - Per-stem energy curves (~15 Hz) + roster from stem activity.
4. **Generate maps (deterministic):**
   - Snap events to the beat grid at 16th-note resolution (quantized feels fair; raw onsets feel random).
   - Filter by strength rank to difficulty densities — Easy ≈ 1–2 notes/s (strong beats only), Medium ≈ 3/s, Hard ≈ 5/s (off-beats + melodic layer). Enforce minimum same-lane gap (~150 ms) and playable patterns.
   - Lane assignment: pitched events follow relative pitch motion (melody rises → lanes move right); drums by type (kick → outer, snare/hat → inner); holds keep their lane clear while active.
5. **Persist** analysis + 3 beatmaps via BeatmapStore; delete temp audio.

**Quality expectation:** not hand-crafted-chart quality, but drum-stem onsets snapped to a beat grid are reliably fun — and every generator improvement upgrades the whole library via versioned regeneration.

## Gameplay engine

- **Clock:** the engine keeps a high-resolution song clock (`performance.now()` based) reconciled against the YouTube player's `getCurrentTime()` (which only updates a few times/sec). Small drift is smoothly corrected; >~80 ms snaps. Notes are positioned by time each frame, never moved by deltas — lag can't desync the chart.
- **Rendering:** canvas highway via `requestAnimationFrame`; notes spawn ~2 s of scroll ahead; holds render head + tail. Band layer renders from energy curves + the gameplay event bus.
- **Judgment:** Perfect ±45 ms / Great ±90 ms / Good ±135 ms / Miss. Holds: head judged like a tap, key must stay down; release ≥50 % through earns partial credit. **Whiff** (key press with no note nearby in that lane) breaks combo and fires `key:wrong`.
- **Scoring:** base points per judgment × combo multiplier; results screen with grade (S–D), accuracy, max combo, judgment counts, band finale.
- **Latency calibration:** Settings has a tap-to-metronome test producing a per-machine input offset applied to all judgments. Required — every setup's audio latency differs.
- **Ad/interruption state machine:** if player state is `PLAYING` but content time isn't advancing → `WAITING` (notes freeze, "ad playing…" panel). When time advances → 3-2-1 count-in → live. Covers pre-roll ads, mid-roll ads, and buffering with one mechanism. User scrubbing the (visible, functional) YouTube controls → detect time jump, resync notes, mark run "unranked".
- **Event bus:** `note:hit`, `note:miss`, `key:wrong`, `combo:milestone`, `song:end` — consumed by effects and the band layer.

## Game design: look, effects, UI

### Art direction

- **Default theme — "Dark Stage":** sleek dark concert-stage UI (any music video looks at home) with fully cartoon band characters under stage lighting. The serious frame makes the slapstick funnier.
- **Switchable theme — "Neon Arcade":** synthwave palette, glow/trail effects. Themes are token sets (colors, note skins, effect palettes) over identical layout/logic.

### Game screen (layout)

- Highway column (~46 %) on the left by default — **mirror toggle in Settings** moves it right.
- Right pane: YouTube player on top (untouched, controls usable, ToS-clean), **band stage panel below it**, HUD (score, combo, accuracy) at the bottom.
- Designed for fullscreen play.

### The band

- **Roster from analysis:** drummer / bassist / guitarist / singer appear only if their stem has real energy. Instrumental track → no singer.
- **Groove:** each member animates with intensity driven by their stem's energy curve (drummer flails during loud drums; singer leans in on vocal lines). All precomputed data — costs nothing at play time.
- **Reactions (event bus):** miss → a random member stumbles; whiff → a member swings at the air and falls over, dizzy stars. Rate-limited (~1 fall / 2 s) so bad runs read as slapstick, not noise. Combo milestones (50/100/200…) → stage lights flare, band hype (stick-spin, point-at-camera). Breaking a >50 combo → record-scratch freeze-frame. Full combo → confetti + encore bow; bad grade → band shuffles off, lights cut one by one.
- **Sequencing:** the stem/energy/roster *data* ships in the v1 pipeline; the band *animation layer* is its own milestone after core gameplay feels good. Build the stage, then hire the band.

### Effects

- Hits: ring shockwave + particle burst at the hit line, color-graded by judgment (gold/teal/gray); lane flash. Holds spray particles while held, payoff burst on clean release.
- Judgment popups with cartoon squash-and-stretch, slight stacking for readability in streams.
- Miss/whiff: brief lane dim + subtle red vignette pulse (plus band reaction).
- Ambient: stage-light sweeps synced to the beat grid; stage floor pulses with the drum energy curve — the scene breathes with the song even between notes.

### Library screen

- Top bar: one input — **search a song or paste a YouTube link**. Search shows top YouTube candidates (thumbnail, title, duration); picking one starts the pipeline.
- Song list: **compact rows** — thumbnail, title/artist/duration/BPM, best grade + max combo, three difficulty chips (E/M/H) as direct play buttons.
- In-progress songs show a live pipeline progress bar inline (queued / downloading / separating stems / analyzing / generating). Failed songs show a readable error + retry.

### Settings screen

- Key remapping (4 lanes), highway side (left/right), theme (Dark Stage / Neon Arcade), latency calibration test, scroll speed.

## Error handling

- **Add-time:** clear per-row states for private/deleted, age-restricted, region-locked, download-blocked; retry button. Videos > ~12 min get a cost warning before analysis.
- **Embeddability:** some uploaders disable embedding (IFrame errors 101/150). Caught at play time → song flagged "not embeddable" in the library. No workaround by design — that's the lawsuit-safe answer.
- **Play-time:** stalls/buffering reuse the ad state machine. Pipeline server down → library banner; already-mapped songs still play (beatmaps are local).
- **Analysis edge cases:** no-drum songs fall back to full-mix onset detection; non-music videos (speech/silence) complete but are tagged "low confidence."

## Testing

- **Pipeline:** unit tests on synthetic fixtures with exact ground truth — click tracks at known BPMs (beats within ±30 ms), tone sweeps (onsets, holds). A determinism test (same input → byte-identical beatmaps) protects score comparability. Golden-file tests pin generator output so tuning is a visible diff, never silent drift.
- **Engine:** judgment, combo, scoring, and clock reconciliation are pure functions — unit-tested headless. The ad/sync state machine runs against a scripted mock YouTube player (stalls, seeks, ads) covering all transitions.
- **Manual:** debug overlay (FPS, clock drift, judgment-offset histogram) for tuning feel and default calibration.

## Milestones (build order)

1. **Core loop:** pipeline (fetch → stems → analysis → maps) + minimal game screen (highway, judgments, scoring, YouTube sync, ad handling). Playable end-to-end.
2. **Game feel:** effects pass, latency calibration, settings (remap, mirror, scroll speed), results screen.
3. **The band:** animation layer (groove from energy curves, reactions from event bus), finale animations.
4. **Polish:** Neon theme, library quality-of-life, edge-case hardening.

## Future (explicitly out of v1 scope, designed-for)

- **Hosted version:** pipeline containerized behind the same REST API; `BeatmapStore` backed by a shared database so each song is analyzed once globally. (Server-side downloading at scale carries legal/blocking risk — revisit the client-side-analysis option from brainstorming when this becomes real.)
- **mlib integration:** mlib implements `SongResolver` (own catalog → YouTube Data API fallback).
- Leaderboards (scores already reference pinned beatmapIds), density-slider difficulty, drums-only/bass-only modes (the analysis layer already stores per-stem events).
