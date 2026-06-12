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
