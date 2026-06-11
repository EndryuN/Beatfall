# Beatfall Track A — Python Pipeline Implementation Plan (Laptop A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local FastAPI server that turns a YouTube video id into validated `analysis.json` + three pinned beatmaps, with live job progress — matching `contracts/` exactly.

**Architecture:** FastAPI app → single-worker job queue (thread) → pipeline steps (resolve → fetch → separate → analyze → generate → save). Steps are injected via a protocol so API/queue tests use fakes (no network, no audio). Stem separation starts as librosa HPSS (fast, no model download); Demucs is a stretch task behind the same interface. All persistence goes through `BeatmapStore` (JSON files under `data/`).

**Tech Stack:** Python 3.11+, FastAPI, uvicorn, yt-dlp, librosa, soundfile, numpy, pydantic v2, pytest. ffmpeg must be on PATH.

**Prereq:** Foundation plan complete (contracts + fixtures pushed).

---

### Task 1: Scaffold the Python project

**Files:**
- Create: `pipeline/pyproject.toml`
- Create: `pipeline/src/beatfall_pipeline/__init__.py`
- Create: `pipeline/tests/test_smoke.py`

- [ ] **Step 1: Write `pipeline/pyproject.toml`**

```toml
[project]
name = "beatfall-pipeline"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.110",
  "uvicorn>=0.29",
  "pydantic>=2.6",
  "yt-dlp>=2026.1.1",
  "librosa>=0.10.2",
  "soundfile>=0.12",
  "numpy>=1.26",
]

[project.optional-dependencies]
dev = ["pytest>=8", "httpx>=0.27", "jsonschema>=4.21"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 2: Create package + smoke test**

`pipeline/src/beatfall_pipeline/__init__.py`:
```python
ANALYSIS_VERSION = 1
GENERATOR_VERSION = 1
```

`pipeline/tests/test_smoke.py`:
```python
from beatfall_pipeline import ANALYSIS_VERSION

def test_import():
    assert ANALYSIS_VERSION == 1
```

- [ ] **Step 3: Install and run**

```bash
cd pipeline && pip install -e ".[dev]" && pytest -q
```
Expected: `1 passed`.

- [ ] **Step 4: Commit**

```bash
git add pipeline && git commit -m "feat(pipeline): scaffold" && git push
```

### Task 2: Pydantic models that mirror the contracts

**Files:**
- Create: `pipeline/src/beatfall_pipeline/models.py`
- Test: `pipeline/tests/test_models.py`

- [ ] **Step 1: Write failing test** — models must round-trip the contract fixtures AND validate against the JSON schemas

```python
# pipeline/tests/test_models.py
import json
from pathlib import Path
import jsonschema
from beatfall_pipeline.models import AnalysisDoc, Beatmap

ROOT = Path(__file__).resolve().parents[2]  # repo root
CONTRACTS = ROOT / "contracts"

def test_analysis_roundtrip_fixture():
    raw = json.loads((CONTRACTS / "fixtures/fixture.analysis.json").read_text())
    doc = AnalysisDoc.model_validate(raw)
    out = doc.model_dump(exclude_none=True)
    schema = json.loads((CONTRACTS / "analysis.schema.json").read_text())
    jsonschema.validate(out, schema)
    assert out["songId"] == "yt:dQw4w9WgXcQ"

def test_beatmap_roundtrip_fixture():
    raw = json.loads((CONTRACTS / "fixtures/fixture.beatmap.hard.json").read_text())
    bm = Beatmap.model_validate(raw)
    schema = json.loads((CONTRACTS / "beatmap.schema.json").read_text())
    jsonschema.validate(bm.model_dump(exclude_none=True), schema)
```

- [ ] **Step 2: Run, expect FAIL** (`ModuleNotFoundError: models`): `pytest tests/test_models.py -q`

- [ ] **Step 3: Implement `pipeline/src/beatfall_pipeline/models.py`**

```python
from typing import Literal, Optional
from pydantic import BaseModel, Field

Stem = Literal["drums", "bass", "vocals", "other"]
Difficulty = Literal["easy", "medium", "hard"]

class Event(BaseModel):
    t: float
    stem: Stem
    kind: Literal["onset", "sustain"]
    strength: float = Field(ge=0, le=1)
    dur: Optional[float] = None
    pitch: Optional[float] = None
    pitchConf: Optional[float] = None

class EnergyCurves(BaseModel):
    sampleRateHz: float
    stems: dict[str, list[float]]

class AnalysisDoc(BaseModel):
    songId: str
    analysisVersion: int
    title: str
    channel: str = ""
    duration: float
    thumbnail: str = ""
    bpm: float
    beatGrid: list[float]
    roster: list[Literal["drummer", "bassist", "singer", "guitarist"]]
    events: list[Event]
    energyCurves: EnergyCurves

class Note(BaseModel):
    t: float
    lane: int = Field(ge=0, le=3)
    type: Literal["tap", "hold"]
    dur: Optional[float] = None

class Beatmap(BaseModel):
    beatmapId: str
    songId: str
    generatorVersion: int
    difficulty: Difficulty
    mode: Literal["standard"] = "standard"
    laneCount: Literal[4] = 4
    notes: list[Note]

class SongMeta(BaseModel):
    videoId: str
    title: str
    channel: str = ""
    duration: float
    thumbnail: str = ""
```

- [ ] **Step 4: Run, expect PASS**: `pytest tests/test_models.py -q`
- [ ] **Step 5: Commit**: `git add -A pipeline && git commit -m "feat(pipeline): contract models" && git push`

### Task 3: BeatmapStore (JSON files)

**Files:**
- Create: `pipeline/src/beatfall_pipeline/store.py`
- Test: `pipeline/tests/test_store.py`

- [ ] **Step 1: Write failing tests**

```python
# pipeline/tests/test_store.py
import json
from pathlib import Path
from beatfall_pipeline.store import BeatmapStore
from beatfall_pipeline.models import AnalysisDoc, Beatmap

FIX = Path(__file__).resolve().parents[2] / "contracts/fixtures"

def _fixtures():
    analysis = AnalysisDoc.model_validate(json.loads((FIX / "fixture.analysis.json").read_text()))
    bm = Beatmap.model_validate(json.loads((FIX / "fixture.beatmap.hard.json").read_text()))
    return analysis, [bm]

def test_save_then_get(tmp_path):
    store = BeatmapStore(tmp_path)
    analysis, maps = _fixtures()
    store.save(analysis, maps)
    assert store.get_analysis("yt:dQw4w9WgXcQ", 1) is not None
    assert store.get_beatmap("yt:dQw4w9WgXcQ", "hard", 1) is not None
    assert store.get_beatmap("yt:dQw4w9WgXcQ", "hard", 99) is None  # version mismatch = miss

def test_list_songs(tmp_path):
    store = BeatmapStore(tmp_path)
    analysis, maps = _fixtures()
    store.save(analysis, maps)
    entries = store.list_songs()
    assert len(entries) == 1
    assert entries[0]["songId"] == "yt:dQw4w9WgXcQ"
    assert entries[0]["status"] == "ready"
    assert "hard" in entries[0]["difficulties"]

def test_get_missing(tmp_path):
    assert BeatmapStore(tmp_path).get_analysis("yt:nope0000000", 1) is None
```

- [ ] **Step 2: Run, expect FAIL**: `pytest tests/test_store.py -q`
- [ ] **Step 3: Implement `pipeline/src/beatfall_pipeline/store.py`**

```python
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from .models import AnalysisDoc, Beatmap

def _safe(song_id: str) -> str:
    return song_id.replace(":", "_")

class BeatmapStore:
    """File layout: <root>/library.json + <root>/songs/<id>/analysis.json + beatmap.<diff>.json"""

    def __init__(self, root: Path):
        self.root = Path(root)
        (self.root / "songs").mkdir(parents=True, exist_ok=True)
        self._index_path = self.root / "library.json"

    def _index(self) -> dict:
        if self._index_path.exists():
            return json.loads(self._index_path.read_text())
        return {}

    def _write_index(self, idx: dict) -> None:
        self._index_path.write_text(json.dumps(idx, indent=2))

    def save(self, analysis: AnalysisDoc, beatmaps: list[Beatmap]) -> None:
        d = self.root / "songs" / _safe(analysis.songId)
        d.mkdir(parents=True, exist_ok=True)
        (d / "analysis.json").write_text(analysis.model_dump_json(exclude_none=True))
        for bm in beatmaps:
            (d / f"beatmap.{bm.difficulty}.json").write_text(bm.model_dump_json(exclude_none=True))
        idx = self._index()
        idx[analysis.songId] = {
            "songId": analysis.songId, "title": analysis.title, "channel": analysis.channel,
            "duration": analysis.duration, "thumbnail": analysis.thumbnail, "bpm": analysis.bpm,
            "status": "ready", "error": None,
            "difficulties": sorted(bm.difficulty for bm in beatmaps),
            "addedAt": datetime.now(timezone.utc).isoformat(),
        }
        self._write_index(idx)

    def get_analysis(self, song_id: str, version: int) -> Optional[AnalysisDoc]:
        p = self.root / "songs" / _safe(song_id) / "analysis.json"
        if not p.exists():
            return None
        doc = AnalysisDoc.model_validate_json(p.read_text())
        return doc if doc.analysisVersion == version else None

    def get_beatmap(self, song_id: str, difficulty: str, generator_version: int) -> Optional[Beatmap]:
        p = self.root / "songs" / _safe(song_id) / f"beatmap.{difficulty}.json"
        if not p.exists():
            return None
        bm = Beatmap.model_validate_json(p.read_text())
        return bm if bm.generatorVersion == generator_version else None

    def list_songs(self) -> list[dict]:
        return sorted(self._index().values(), key=lambda e: e["addedAt"], reverse=True)
```

- [ ] **Step 4: Run, expect PASS**: `pytest tests/test_store.py -q`
- [ ] **Step 5: Commit**: `git add -A pipeline && git commit -m "feat(pipeline): BeatmapStore" && git push`

### Task 4: Synthetic audio fixtures for analysis tests

**Files:**
- Create: `pipeline/tests/audio_fixtures.py`

No test yet — this is the test tooling the next two tasks use.

- [ ] **Step 1: Write `pipeline/tests/audio_fixtures.py`**

```python
import numpy as np

SR = 22050

def click_track(bpm: float, seconds: float, sr: int = SR) -> np.ndarray:
    """Sharp clicks exactly on the beat — ground truth for beat/onset tests."""
    y = np.zeros(int(seconds * sr), dtype=np.float32)
    interval = 60.0 / bpm
    t = 0.0
    while t < seconds - 0.05:
        i = int(t * sr)
        n = int(0.01 * sr)
        y[i:i + n] += (np.random.default_rng(0).standard_normal(n) * np.hanning(n)).astype(np.float32)
        t += interval
    return y / (np.abs(y).max() + 1e-9)

def tone(freq: float, seconds: float, sr: int = SR) -> np.ndarray:
    """Steady sine — ground truth for sustain/pitch tests. 440 Hz = MIDI 69."""
    t = np.arange(int(seconds * sr)) / sr
    return (0.5 * np.sin(2 * np.pi * freq * t)).astype(np.float32)

def silence(seconds: float, sr: int = SR) -> np.ndarray:
    return np.zeros(int(seconds * sr), dtype=np.float32)

def concat(*parts: np.ndarray) -> np.ndarray:
    return np.concatenate(parts)
```

- [ ] **Step 2: Commit**: `git add -A pipeline && git commit -m "test(pipeline): synthetic audio fixtures" && git push`

### Task 5: Analyzer — beat grid, onsets, sustains, energy, roster

**Files:**
- Create: `pipeline/src/beatfall_pipeline/analyze.py`
- Test: `pipeline/tests/test_analyze.py`

- [ ] **Step 1: Write failing tests**

```python
# pipeline/tests/test_analyze.py
import numpy as np
from beatfall_pipeline.analyze import analyze_audio
from beatfall_pipeline.models import SongMeta
from .audio_fixtures import SR, click_track, tone, silence, concat

META = SongMeta(videoId="dQw4w9WgXcQ", title="t", duration=10.0)

def test_bpm_and_beats_on_click_track():
    y = click_track(bpm=120, seconds=10)
    doc = analyze_audio(y, SR, META)
    assert abs(doc.bpm - 120) < 3 or abs(doc.bpm - 60) < 3 or abs(doc.bpm - 240) < 6  # octave errors allowed
    # every detected beat lies within 30 ms of a true click (true clicks every 0.5 s)
    for b in doc.beatGrid:
        nearest = round(b / 0.5) * 0.5
        assert abs(b - nearest) < 0.03

def test_drum_onsets_detected():
    y = click_track(bpm=120, seconds=10)
    doc = analyze_audio(y, SR, META)
    onsets = [e for e in doc.events if e.kind == "onset" and e.stem == "drums"]
    assert 15 <= len(onsets) <= 25  # ~20 clicks in 10 s
    assert all(0 < e.strength <= 1 for e in onsets)

def test_sustain_from_steady_tone():
    y = concat(silence(1.0), tone(440, 2.0), silence(1.0))
    doc = analyze_audio(y, SR, SongMeta(videoId="dQw4w9WgXcQ", title="t", duration=4.0))
    sustains = [e for e in doc.events if e.kind == "sustain"]
    assert len(sustains) >= 1
    s = max(sustains, key=lambda e: e.dur or 0)
    assert 0.8 <= s.t <= 1.3
    assert s.dur and s.dur > 1.0
    assert s.pitch and abs(s.pitch - 69.0) < 1.0  # 440 Hz = MIDI 69

def test_energy_curves_and_roster():
    y = click_track(bpm=120, seconds=10)
    doc = analyze_audio(y, SR, META)
    assert doc.energyCurves.sampleRateHz == 15
    assert "drums" in doc.energyCurves.stems
    n = len(doc.energyCurves.stems["drums"])
    assert abs(n - 150) <= 3  # 10 s * 15 Hz
    assert all(0 <= v <= 1 for v in doc.energyCurves.stems["drums"])
    assert "drummer" in doc.roster
```

- [ ] **Step 2: Run, expect FAIL**: `pytest tests/test_analyze.py -q`
- [ ] **Step 3: Implement `pipeline/src/beatfall_pipeline/analyze.py`**

```python
import numpy as np
import librosa
from . import ANALYSIS_VERSION
from .models import AnalysisDoc, EnergyCurves, Event, SongMeta

HOP = 512
CURVE_HZ = 15.0

def _energy_curve(y: np.ndarray, sr: int, duration: float) -> list[float]:
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    peak = rms.max() or 1.0
    rms = rms / peak
    src_t = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=HOP)
    dst_t = np.arange(0, duration, 1.0 / CURVE_HZ)
    return np.interp(dst_t, src_t, rms).clip(0, 1).round(4).tolist()

def _sustains(y_harm: np.ndarray, sr: int, stem: str) -> list[Event]:
    f0, voiced, prob = librosa.pyin(y_harm, fmin=80, fmax=800, sr=sr, hop_length=HOP)
    hop_s = HOP / sr
    events: list[Event] = []
    start = None
    for i in range(len(f0) + 1):
        ok = i < len(f0) and voiced[i] and not np.isnan(f0[i])
        if ok and start is None:
            start = i
        elif not ok and start is not None:
            dur = (i - start) * hop_s
            if dur >= 0.5:
                seg = f0[start:i]
                midi = librosa.hz_to_midi(np.nanmedian(seg))
                conf = float(np.nanmean(prob[start:i]))
                events.append(Event(t=round(start * hop_s, 3), stem=stem, kind="sustain",
                                    strength=min(1.0, conf), dur=round(dur, 3),
                                    pitch=round(float(midi), 2), pitchConf=round(conf, 2)))
            start = None
    return events

def analyze_audio(y: np.ndarray, sr: int, meta: SongMeta) -> AnalysisDoc:
    duration = len(y) / sr
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=HOP)
    bpm = float(np.atleast_1d(tempo)[0])
    beat_grid = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP).round(3).tolist()

    y_harm, y_perc = librosa.effects.hpss(y)

    onset_env = librosa.onset.onset_strength(y=y_perc, sr=sr, hop_length=HOP)
    onset_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=HOP)
    peak = onset_env.max() or 1.0
    onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=HOP)
    events = [Event(t=round(float(t), 3), stem="drums", kind="onset",
                    strength=round(float(onset_env[f] / peak), 3))
              for t, f in zip(onset_times, onset_frames)]
    # HPSS mode: melodic sustains come from the harmonic component, labeled "other".
    # (Demucs stretch task relabels real vocals/bass stems — same Event shape.)
    events += _sustains(y_harm, sr, stem="other")
    events.sort(key=lambda e: e.t)

    curves = {"drums": _energy_curve(y_perc, sr, duration),
              "other": _energy_curve(y_harm, sr, duration)}
    roster: list = []
    if np.mean(curves["drums"]) > 0.05:
        roster.append("drummer")
    if np.mean(curves["other"]) > 0.05:
        roster.append("guitarist")

    return AnalysisDoc(
        songId=f"yt:{meta.videoId}", analysisVersion=ANALYSIS_VERSION,
        title=meta.title, channel=meta.channel, duration=round(duration, 3),
        thumbnail=meta.thumbnail, bpm=round(bpm, 2), beatGrid=beat_grid,
        roster=roster, events=events,
        energyCurves=EnergyCurves(sampleRateHz=CURVE_HZ, stems=curves),
    )
```

- [ ] **Step 4: Run, expect PASS** (slow-ish, librosa): `pytest tests/test_analyze.py -q`
  If the sustain test fails on pitch, print the detected events — pyin on a clean sine should be within a semitone; widen `fmin/fmax` only if needed.
- [ ] **Step 5: Commit**: `git add -A pipeline && git commit -m "feat(pipeline): librosa analyzer (HPSS mode)" && git push`

### Task 6: Beatmap generator — snap, select, lanes, determinism

**Files:**
- Create: `pipeline/src/beatfall_pipeline/generate.py`
- Test: `pipeline/tests/test_generate.py`

- [ ] **Step 1: Write failing tests**

```python
# pipeline/tests/test_generate.py
import json
from beatfall_pipeline.generate import generate_beatmaps, snap_to_grid, DENSITY
from beatfall_pipeline.models import AnalysisDoc, Event, EnergyCurves

def _doc(events, duration=20.0, bpm=120.0):
    beats = [round(i * 0.5, 3) for i in range(int(duration / 0.5))]
    return AnalysisDoc(songId="yt:dQw4w9WgXcQ", analysisVersion=1, title="t", duration=duration,
                       bpm=bpm, beatGrid=beats, roster=["drummer"], events=events,
                       energyCurves=EnergyCurves(sampleRateHz=15, stems={"drums": [0.5] * 300}))

def _onset(t, s=0.8):
    return Event(t=t, stem="drums", kind="onset", strength=s)

def test_snap_quantizes_to_16ths():
    doc = _doc([_onset(1.03), _onset(1.97)])
    snapped = snap_to_grid(doc.events, doc.beatGrid)
    assert snapped[0].t == 1.0 and snapped[1].t == 2.0  # 16th grid at 120bpm = 0.125 s steps

def test_difficulty_densities():
    events = [_onset(round(0.125 * i, 3), s=0.5 + (i % 5) * 0.1) for i in range(160)]  # dense input
    maps = {m.difficulty: m for m in generate_beatmaps(_doc(events))}
    dur = 20.0
    assert len(maps["easy"].notes) <= DENSITY["easy"] * dur + 1
    assert len(maps["medium"].notes) <= DENSITY["medium"] * dur + 1
    assert len(maps["easy"].notes) < len(maps["medium"].notes) < len(maps["hard"].notes)

def test_no_same_lane_within_150ms():
    events = [_onset(round(0.125 * i, 3)) for i in range(160)]
    for m in generate_beatmaps(_doc(events)):
        last: dict[int, float] = {}
        for n in m.notes:
            if n.lane in last:
                assert n.t - last[n.lane] >= 0.15 - 1e-9
            last[n.lane] = n.t

def test_holds_from_sustains():
    events = [Event(t=2.0, stem="other", kind="sustain", strength=0.8, dur=1.5, pitch=65.0, pitchConf=0.9),
              _onset(5.0)]
    maps = {m.difficulty: m for m in generate_beatmaps(_doc(events))}
    holds = [n for n in maps["hard"].notes if n.type == "hold"]
    assert holds and abs(holds[0].dur - 1.5) < 0.26  # dur snapped, roughly preserved

def test_deterministic():
    events = [_onset(round(0.125 * i, 3), s=0.5 + (i % 7) * 0.07) for i in range(160)]
    a = [m.model_dump_json() for m in generate_beatmaps(_doc(events))]
    b = [m.model_dump_json() for m in generate_beatmaps(_doc(events))]
    assert a == b

def test_beatmap_ids():
    m = generate_beatmaps(_doc([_onset(1.0)]))[0]
    assert m.beatmapId == f"yt:dQw4w9WgXcQ/g{m.generatorVersion}/{m.difficulty}/standard"
```

- [ ] **Step 2: Run, expect FAIL**: `pytest tests/test_generate.py -q`
- [ ] **Step 3: Implement `pipeline/src/beatfall_pipeline/generate.py`**

```python
from . import GENERATOR_VERSION
from .models import AnalysisDoc, Beatmap, Event, Note

GRID_DIV = 4          # 16th notes
MIN_LANE_GAP = 0.15   # same-finger limit, seconds
DENSITY = {"easy": 1.5, "medium": 3.0, "hard": 5.0}        # max notes/sec
SLOT_FILTER = {"easy": 4, "medium": 2, "hard": 1}          # keep slots where slot % f == 0
MIN_HOLD = {"easy": 1.0, "medium": 0.6, "hard": 0.5}

def _grid(beat_grid: list[float]) -> list[float]:
    """Subdivide beats into 16ths; extrapolate one beat past the end."""
    if len(beat_grid) < 2:
        return list(beat_grid)
    out = []
    for a, b in zip(beat_grid, beat_grid[1:]):
        step = (b - a) / GRID_DIV
        out += [a + step * i for i in range(GRID_DIV)]
    out.append(beat_grid[-1])
    return out

def snap_to_grid(events: list[Event], beat_grid: list[float]) -> list[Event]:
    grid = _grid(beat_grid)
    if not grid:
        return sorted(events, key=lambda e: e.t)
    best: dict[int, Event] = {}  # one event per slot, keep strongest
    for e in events:
        slot = min(range(len(grid)), key=lambda i: abs(grid[i] - e.t))
        snapped = e.model_copy(update={"t": round(grid[slot], 3)})
        if slot not in best or snapped.strength > best[slot].strength:
            best[slot] = snapped
    return [best[s] for s in sorted(best)]

def _slot_index(t: float, grid: list[float]) -> int:
    return min(range(len(grid)), key=lambda i: abs(grid[i] - t))

def _select(snapped: list[Event], grid: list[float], difficulty: str, duration: float) -> list[Event]:
    f = SLOT_FILTER[difficulty]
    pool = [e for e in snapped if e.kind == "sustain" and (e.dur or 0) >= MIN_HOLD[difficulty]] + \
           [e for e in snapped if e.kind == "onset" and _slot_index(e.t, grid) % f == 0]
    pool.sort(key=lambda e: (-e.strength, e.t))           # strongest first, time tiebreak
    k = int(DENSITY[difficulty] * duration)
    return sorted(pool[:k], key=lambda e: e.t)

def _assign_lanes(events: list[Event]) -> list[Note]:
    notes: list[Note] = []
    last_in_lane: dict[int, float] = {}
    prev_pitch: float | None = None
    prev_lane = 1
    flip = 0
    for e in events:
        if e.pitch is not None:                            # melodic: follow pitch motion
            if prev_pitch is None or abs(e.pitch - prev_pitch) < 0.5:
                lane = prev_lane
            elif e.pitch > prev_pitch:
                lane = min(3, prev_lane + 1)
            else:
                lane = max(0, prev_lane - 1)
            prev_pitch = e.pitch
        else:                                              # drums: strong → outer, weak → inner
            lane = (0, 3)[flip % 2] if e.strength >= 0.7 else (1, 2)[flip % 2]
            flip += 1
        # enforce same-lane gap: rotate to a free lane, drop if none
        placed = False
        for off in range(4):
            cand = (lane + off) % 4
            end_t = e.t + (e.dur or 0) if e.kind == "sustain" else e.t
            if e.t - last_in_lane.get(cand, -10.0) >= MIN_LANE_GAP:
                hold_dur = round(e.dur, 3) if e.kind == "sustain" and e.dur else None
                notes.append(Note(t=e.t, lane=cand,
                                  type="hold" if hold_dur else "tap", dur=hold_dur))
                last_in_lane[cand] = end_t
                prev_lane = cand
                placed = True
                break
        if not placed:
            continue
    return notes

def generate_beatmaps(doc: AnalysisDoc) -> list[Beatmap]:
    snapped = snap_to_grid(doc.events, doc.beatGrid)
    grid = _grid(doc.beatGrid)
    maps = []
    for difficulty in ("easy", "medium", "hard"):
        chosen = _select(snapped, grid, difficulty, doc.duration)
        maps.append(Beatmap(
            beatmapId=f"{doc.songId}/g{GENERATOR_VERSION}/{difficulty}/standard",
            songId=doc.songId, generatorVersion=GENERATOR_VERSION,
            difficulty=difficulty, notes=_assign_lanes(chosen)))
    return maps
```

- [ ] **Step 4: Run, expect PASS**: `pytest tests/test_generate.py -q`
- [ ] **Step 5: Commit**: `git add -A pipeline && git commit -m "feat(pipeline): deterministic beatmap generator" && git push`

### Task 7: Resolver + fetcher (yt-dlp — the network edge)

**Files:**
- Create: `pipeline/src/beatfall_pipeline/youtube.py`

Network code: no unit tests (everything downstream is tested with fakes); verified manually in Task 10.

- [ ] **Step 1: Implement `pipeline/src/beatfall_pipeline/youtube.py`**

```python
import re
import tempfile
from pathlib import Path
import yt_dlp
from .models import SongMeta

MAX_DURATION_S = 12 * 60
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

def extract_video_id(query: str) -> str | None:
    if _ID_RE.match(query):
        return query
    m = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})", query)
    return m.group(1) if m else None

def _meta(info: dict) -> SongMeta:
    return SongMeta(videoId=info["id"], title=info.get("title", ""),
                    channel=info.get("channel") or info.get("uploader", ""),
                    duration=float(info.get("duration") or 0),
                    thumbnail=info.get("thumbnail", ""))

def search(query: str, limit: int = 5) -> list[SongMeta]:
    vid = extract_video_id(query)
    target = vid if vid else f"ytsearch{limit}:{query}"
    with yt_dlp.YoutubeDL({"quiet": True, "extract_flat": False, "skip_download": True}) as ydl:
        info = ydl.extract_info(target, download=False)
    entries = info.get("entries", [info]) if info else []
    return [_meta(e) for e in entries if e]

def fetch_audio(video_id: str, progress_cb=None) -> tuple[Path, SongMeta]:
    """Download best audio to a temp dir as wav. Caller MUST delete the file's parent dir."""
    tmp = Path(tempfile.mkdtemp(prefix="beatfall-"))
    def hook(d):
        if progress_cb and d.get("status") == "downloading" and d.get("total_bytes"):
            progress_cb(d["downloaded_bytes"] / d["total_bytes"])
    opts = {
        "quiet": True, "format": "bestaudio/best",
        "outtmpl": str(tmp / "%(id)s.%(ext)s"),
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
        "progress_hooks": [hook],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
    meta = _meta(info)
    if meta.duration > MAX_DURATION_S:
        raise ValueError(f"Video too long ({meta.duration:.0f}s > {MAX_DURATION_S}s)")
    return tmp / f"{video_id}.wav", meta
```

(Duration is also pre-checked before download in the job runner — Task 8 — so the user gets the error before the slow part.)

- [ ] **Step 2: Quick manual check** (needs network + ffmpeg):

```bash
python -c "from beatfall_pipeline.youtube import search; print([ (m.videoId, m.title) for m in search('never gonna give you up')][:3])"
```
Expected: list of (videoId, title) tuples, `dQw4w9WgXcQ` among them.

- [ ] **Step 3: Commit**: `git add -A pipeline && git commit -m "feat(pipeline): yt-dlp resolver + fetcher" && git push`

### Task 8: Job queue with injected steps

**Files:**
- Create: `pipeline/src/beatfall_pipeline/jobs.py`
- Test: `pipeline/tests/test_jobs.py`

- [ ] **Step 1: Write failing tests**

```python
# pipeline/tests/test_jobs.py
import json, time
from pathlib import Path
from beatfall_pipeline.jobs import JobQueue, PipelineSteps
from beatfall_pipeline.models import AnalysisDoc, Beatmap, SongMeta
from beatfall_pipeline.store import BeatmapStore

FIX = Path(__file__).resolve().parents[2] / "contracts/fixtures"

class FakeSteps(PipelineSteps):
    def __init__(self, fail_at: str | None = None):
        self.fail_at = fail_at
    def fetch(self, video_id, progress_cb):
        if self.fail_at == "fetch": raise RuntimeError("boom: video unavailable")
        return Path("fake.wav"), SongMeta(videoId=video_id, title="Fake", duration=10.0)
    def analyze(self, audio_path, meta):
        if self.fail_at == "analyze": raise RuntimeError("boom")
        return AnalysisDoc.model_validate(json.loads((FIX / "fixture.analysis.json").read_text()))
    def generate(self, analysis):
        return [Beatmap.model_validate(json.loads((FIX / "fixture.beatmap.hard.json").read_text()))]
    def cleanup(self, audio_path): pass

def _wait(q, job_id, until=("done", "error"), timeout=5.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = q.get(job_id)
        if j and j.stage in until: return j
        time.sleep(0.01)
    raise TimeoutError

def test_happy_path(tmp_path):
    store = BeatmapStore(tmp_path)
    q = JobQueue(store, FakeSteps()); q.start()
    job = q.submit("dQw4w9WgXcQ")
    j = _wait(q, job.id)
    assert j.stage == "done"
    assert store.get_beatmap("yt:dQw4w9WgXcQ", "hard", 1) is not None

def test_failure_reported(tmp_path):
    q = JobQueue(BeatmapStore(tmp_path), FakeSteps(fail_at="fetch")); q.start()
    j = _wait(q, q.submit("dQw4w9WgXcQ").id)
    assert j.stage == "error" and "unavailable" in j.error

def test_duplicate_submit_returns_same_job(tmp_path):
    q = JobQueue(BeatmapStore(tmp_path), FakeSteps())
    a = q.submit("dQw4w9WgXcQ"); b = q.submit("dQw4w9WgXcQ")
    assert a.id == b.id  # not started yet → same queued job
```

- [ ] **Step 2: Run, expect FAIL**: `pytest tests/test_jobs.py -q`
- [ ] **Step 3: Implement `pipeline/src/beatfall_pipeline/jobs.py`**

```python
import itertools
import queue as queue_mod
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Protocol
from .models import AnalysisDoc, Beatmap, SongMeta
from .store import BeatmapStore

class PipelineSteps(Protocol):
    def fetch(self, video_id: str, progress_cb) -> tuple[Path, SongMeta]: ...
    def analyze(self, audio_path: Path, meta: SongMeta) -> AnalysisDoc: ...
    def generate(self, analysis: AnalysisDoc) -> list[Beatmap]: ...
    def cleanup(self, audio_path: Path) -> None: ...

@dataclass
class Job:
    id: str
    video_id: str
    stage: str = "queued"       # queued|downloading|separating|analyzing|generating|done|error
    progress: float = 0.0
    error: Optional[str] = None
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def set(self, stage=None, progress=None, error=None):
        with self.lock:
            if stage: self.stage = stage
            if progress is not None: self.progress = progress
            if error: self.error = error

class JobQueue:
    def __init__(self, store: BeatmapStore, steps: PipelineSteps):
        self.store, self.steps = store, steps
        self._jobs: dict[str, Job] = {}
        self._by_video: dict[str, str] = {}
        self._q: queue_mod.Queue[Job] = queue_mod.Queue()
        self._ids = itertools.count(1)
        self._lock = threading.Lock()

    def start(self):
        threading.Thread(target=self._worker, daemon=True).start()

    def submit(self, video_id: str) -> Job:
        with self._lock:
            existing_id = self._by_video.get(video_id)
            if existing_id:
                existing = self._jobs[existing_id]
                if existing.stage not in ("done", "error"):
                    return existing
            job = Job(id=f"j-{next(self._ids)}", video_id=video_id)
            self._jobs[job.id] = job
            self._by_video[video_id] = job.id
            self._q.put(job)
            return job

    def get(self, job_id: str) -> Optional[Job]:
        return self._jobs.get(job_id)

    def _worker(self):
        while True:
            job = self._q.get()
            audio = None
            try:
                job.set(stage="downloading", progress=0.0)
                audio, meta = self.steps.fetch(job.video_id, lambda p: job.set(progress=p * 0.4))
                job.set(stage="analyzing", progress=0.5)
                analysis = self.steps.analyze(audio, meta)
                job.set(stage="generating", progress=0.85)
                maps = self.steps.generate(analysis)
                self.store.save(analysis, maps)
                job.set(stage="done", progress=1.0)
            except Exception as e:  # any step failure lands on the job, queue survives
                job.set(stage="error", error=str(e))
            finally:
                if audio is not None:
                    try: self.steps.cleanup(audio)
                    except OSError: pass
```

- [ ] **Step 4: Run, expect PASS**: `pytest tests/test_jobs.py -q`
- [ ] **Step 5: Commit**: `git add -A pipeline && git commit -m "feat(pipeline): job queue with injectable steps" && git push`

### Task 9: Real steps + FastAPI app

**Files:**
- Create: `pipeline/src/beatfall_pipeline/steps.py`
- Create: `pipeline/src/beatfall_pipeline/main.py`
- Test: `pipeline/tests/test_api.py`

- [ ] **Step 1: Write failing API tests (use FakeSteps — no network)**

```python
# pipeline/tests/test_api.py
import json, time
from pathlib import Path
from fastapi.testclient import TestClient
from beatfall_pipeline.main import create_app
from beatfall_pipeline.store import BeatmapStore
from .test_jobs import FakeSteps

def _client(tmp_path):
    app = create_app(store=BeatmapStore(tmp_path), steps=FakeSteps())
    return TestClient(app)

def test_post_song_then_poll_job(tmp_path):
    c = _client(tmp_path)
    r = c.post("/api/songs", json={"videoId": "dQw4w9WgXcQ"})
    assert r.status_code == 202
    job_id = r.json()["jobId"]
    for _ in range(100):
        j = c.get(f"/api/jobs/{job_id}").json()
        if j["stage"] in ("done", "error"): break
        time.sleep(0.02)
    assert j["stage"] == "done"
    songs = c.get("/api/songs").json()
    assert songs[0]["songId"] == "yt:dQw4w9WgXcQ"
    bm = c.get("/api/songs/yt:dQw4w9WgXcQ/beatmaps/hard")
    assert bm.status_code == 200 and bm.json()["difficulty"] == "hard"

def test_post_existing_song_is_instant(tmp_path):
    c = _client(tmp_path)
    c.post("/api/songs", json={"videoId": "dQw4w9WgXcQ"})
    time.sleep(0.3)
    r = c.post("/api/songs", json={"videoId": "dQw4w9WgXcQ"})
    assert r.status_code == 200 and r.json()["status"] == "ready"

def test_404s(tmp_path):
    c = _client(tmp_path)
    assert c.get("/api/jobs/j-999").status_code == 404
    assert c.get("/api/songs/yt:nope0000000/beatmaps/hard").status_code == 404
```

- [ ] **Step 2: Run, expect FAIL**: `pytest tests/test_api.py -q`
- [ ] **Step 3: Implement `pipeline/src/beatfall_pipeline/steps.py`** (real steps wired to youtube/analyze/generate)

```python
import shutil
import librosa
from pathlib import Path
from .analyze import analyze_audio
from .generate import generate_beatmaps
from .models import AnalysisDoc, Beatmap, SongMeta
from .youtube import fetch_audio

class RealSteps:
    def fetch(self, video_id: str, progress_cb):
        return fetch_audio(video_id, progress_cb)
    def analyze(self, audio_path: Path, meta: SongMeta) -> AnalysisDoc:
        y, sr = librosa.load(str(audio_path), sr=22050, mono=True)
        return analyze_audio(y, sr, meta)
    def generate(self, analysis: AnalysisDoc) -> list[Beatmap]:
        return generate_beatmaps(analysis)
    def cleanup(self, audio_path: Path) -> None:
        shutil.rmtree(audio_path.parent, ignore_errors=True)
```

- [ ] **Step 4: Implement `pipeline/src/beatfall_pipeline/main.py`**

```python
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from . import ANALYSIS_VERSION, GENERATOR_VERSION
from .jobs import JobQueue, PipelineSteps
from .store import BeatmapStore

class AddSongBody(BaseModel):
    videoId: str

def create_app(store: BeatmapStore | None = None, steps: PipelineSteps | None = None) -> FastAPI:
    if store is None:
        store = BeatmapStore(Path(__file__).resolve().parents[3] / "data")
    if steps is None:
        from .steps import RealSteps
        steps = RealSteps()
    queue = JobQueue(store, steps)
    queue.start()

    app = FastAPI(title="beatfall-pipeline")
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"],
                       allow_methods=["*"], allow_headers=["*"])

    @app.get("/api/search")
    def api_search(q: str):
        from .youtube import search
        return {"candidates": [m.model_dump() for m in search(q)]}

    @app.post("/api/songs")
    def add_song(body: AddSongBody):
        song_id = f"yt:{body.videoId}"
        if store.get_analysis(song_id, ANALYSIS_VERSION) and \
           store.get_beatmap(song_id, "hard", GENERATOR_VERSION):
            return {"songId": song_id, "status": "ready"}
        job = queue.submit(body.videoId)
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=202,
                            content={"songId": song_id, "jobId": job.id, "status": "queued"})

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str):
        job = queue.get(job_id)
        if not job:
            raise HTTPException(404)
        return {"jobId": job.id, "songId": f"yt:{job.video_id}", "stage": job.stage,
                "progress": job.progress, "error": job.error}

    @app.get("/api/songs")
    def list_songs():
        return store.list_songs()

    @app.get("/api/songs/{song_id}/analysis")
    def get_analysis(song_id: str):
        doc = store.get_analysis(song_id, ANALYSIS_VERSION)
        if not doc:
            raise HTTPException(404)
        return doc.model_dump(exclude_none=True)

    @app.get("/api/songs/{song_id}/beatmaps/{difficulty}")
    def get_beatmap(song_id: str, difficulty: str):
        bm = store.get_beatmap(song_id, difficulty, GENERATOR_VERSION)
        if not bm:
            raise HTTPException(404)
        return bm.model_dump(exclude_none=True)

    return app

app = create_app()
```

- [ ] **Step 5: Run all tests, expect PASS**: `pytest -q`
- [ ] **Step 6: Commit**: `git add -A pipeline && git commit -m "feat(pipeline): FastAPI app + real steps" && git push`

### Task 10: End-to-end smoke test (real network)

**Files:** none

- [ ] **Step 1: Start the server**

```bash
cd pipeline && uvicorn beatfall_pipeline.main:app --port 8000
```

- [ ] **Step 2: From a second terminal, run a real song through**

```bash
curl -X POST http://localhost:8000/api/songs -H "Content-Type: application/json" -d "{\"videoId\": \"dQw4w9WgXcQ\"}"
curl http://localhost:8000/api/jobs/j-1
# poll until stage == done (HPSS analysis of a 3.5 min song ≈ 1-2 min on a laptop)
curl http://localhost:8000/api/songs/yt:dQw4w9WgXcQ/beatmaps/medium
```

Expected: job walks downloading → analyzing → generating → done; beatmap JSON returns; `data/songs/yt_dQw4w9WgXcQ/` contains analysis + 3 beatmaps; **no .wav files remain anywhere** (cleanup ran).

- [ ] **Step 3: Validate real output against contracts**

```bash
npx --yes ajv-cli@5 validate -s ../contracts/analysis.schema.json -d "../data/songs/yt_dQw4w9WgXcQ/analysis.json" --spec=draft2020
npx --yes ajv-cli@5 validate -s ../contracts/beatmap.schema.json -d "../data/songs/yt_dQw4w9WgXcQ/beatmap.*.json" --spec=draft2020
```
Expected: all valid. **This is the moment Track B can switch from fixtures to live data.** Tell Laptop B.

- [ ] **Step 4: Commit anything outstanding, push.**

### Task 11 (STRETCH): Demucs stem separation

Only start this once Tasks 1–10 are done and integrated with Track B. Pre-download the model on hotel/home wifi, not hackathon wifi: `pip install demucs torch` then `python -c "import demucs.api; demucs.api.Separator(model='htdemucs')"` (~2 GB).

**Files:**
- Create: `pipeline/src/beatfall_pipeline/separate.py`
- Modify: `pipeline/src/beatfall_pipeline/analyze.py` (accept pre-separated stems)
- Modify: `pipeline/src/beatfall_pipeline/steps.py`

- [ ] **Step 1: Implement `separate.py`**

```python
import numpy as np

def separate_demucs(y: np.ndarray, sr: int) -> dict[str, np.ndarray]:
    """Returns {'drums','bass','vocals','other'} mono stems at input sr."""
    import torch
    import demucs.api
    sep = demucs.api.Separator(model="htdemucs")
    wav = torch.tensor(np.stack([y, y]))           # fake stereo
    _, stems = sep.separate_tensor(wav, sr)
    return {name: t.mean(dim=0).numpy() for name, t in stems.items()}
```

- [ ] **Step 2: Refactor `analyze_audio`** to take `stems: dict[str, np.ndarray] | None = None`; when provided: onsets from `stems["drums"]`, sustains from `stems["vocals"]` (stem="vocals") and `stems["bass"]` (stem="bass"), energy curves + roster per real stem (`vocals` → `singer`, `bass` → `bassist`); when `None`, keep the HPSS path exactly as is. Existing tests must still pass (they pass `stems=None` implicitly).
- [ ] **Step 3: Wire into `RealSteps.analyze`** with a try/except ImportError fallback to HPSS, and report stage "separating" via a `job.set(stage="separating")` hook — pass an optional `stage_cb` through `PipelineSteps.analyze` if time allows; otherwise leave stage reporting as "analyzing".
- [ ] **Step 4: Re-run all tests** (`pytest -q`, must stay green), smoke-test one real song, bump `ANALYSIS_VERSION` to 2 in `__init__.py` (old maps become stale by design), commit.

---

**Definition of done (Track A):** all pytest green, Task 10 smoke passes, real output validates against `contracts/`, Laptop B plays a song end-to-end from your server.
