from . import GENERATOR_VERSION
from .models import AnalysisDoc, Beatmap, Event, Note

GRID_DIV = 4               # 16th notes
BAR_SLOTS = GRID_DIV * 4   # 4/4 assumed: 16 slots per bar
MIN_LANE_GAP = 0.15        # same-finger limit, seconds
LEAD_IN_S = 2.0            # no notes before this — the player needs a runway
SNAP_TOL_FRAC = 0.35       # onsets farther than this fraction of a slot from the grid are noise
MIN_ONSET_STRENGTH = 0.3   # weaker detections feel random, not musical
MAX_BUDGET_CARRY = 1.5     # unused note budget rolls into the next beat, but doesn't pile up forever
DENSITY = {"easy": 1.5, "medium": 3.0, "hard": 5.0}        # max notes/sec at full energy
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

def _slot_width(grid: list[float], slot: int) -> float:
    if slot + 1 < len(grid):
        return grid[slot + 1] - grid[slot]
    return grid[slot] - grid[slot - 1] if slot > 0 else 0.125

def snap_to_grid(events: list[Event], beat_grid: list[float],
                 tol_frac: float | None = None) -> list[Event]:
    grid = _grid(beat_grid)
    if not grid:
        return sorted(events, key=lambda e: e.t)
    best: dict[int, Event] = {}  # one event per slot, keep strongest
    for e in events:
        slot = min(range(len(grid)), key=lambda i: abs(grid[i] - e.t))
        dist = abs(grid[slot] - e.t)
        # off-grid onsets are detection noise; sustains (vocal phrases) may start anywhere
        if tol_frac is not None and e.kind == "onset" and dist > tol_frac * _slot_width(grid, slot):
            continue
        snapped = e.model_copy(update={"t": round(grid[slot], 3)})
        if slot not in best or snapped.strength > best[slot].strength:
            best[slot] = snapped
    return [best[s] for s in sorted(best)]

def _slot_index(t: float, grid: list[float]) -> int:
    return min(range(len(grid)), key=lambda i: abs(grid[i] - t))

def _energy_at(doc: AnalysisDoc, t: float) -> float:
    stems = doc.energyCurves.stems
    curve = stems.get("drums") or (next(iter(stems.values())) if stems else None)
    if not curve:
        return 0.5
    i = min(len(curve) - 1, max(0, int(t * doc.energyCurves.sampleRateHz)))
    return curve[i]

def _select(snapped: list[Event], grid: list[float], difficulty: str, doc: AnalysisDoc) -> list[Event]:
    f = SLOT_FILTER[difficulty]
    sustains = [e for e in snapped
                if e.kind == "sustain" and (e.dur or 0) >= MIN_HOLD[difficulty] and e.t >= LEAD_IN_S]
    onsets = [e for e in snapped
              if e.kind == "onset" and e.strength >= MIN_ONSET_STRENGTH
              and e.t >= LEAD_IN_S and _slot_index(e.t, grid) % f == 0]
    if difficulty == "easy":
        onsets = [e for e in onsets if e.drum != "hat"]   # hats are texture, not beginner material

    # density follows the song: each beat gets a note budget scaled by the drums' energy there
    chosen = list(sustains)
    beats = doc.beatGrid
    carry = 0.0
    for bi, bt in enumerate(beats):
        bt_end = beats[bi + 1] if bi + 1 < len(beats) else bt + (beats[-1] - beats[-2] if len(beats) > 1 else 0.5)
        pool = [e for e in onsets if bt <= e.t < bt_end]
        q = DENSITY[difficulty] * (bt_end - bt) * (0.30 + 0.85 * _energy_at(doc, bt)) + carry
        take = min(len(pool), int(q))
        carry = min(MAX_BUDGET_CARRY, q - take)
        pool.sort(key=lambda e: (-e.strength, e.t))
        chosen += pool[:take]

    k = int(DENSITY[difficulty] * doc.duration)            # global ceiling regardless of energy
    if len(chosen) > k:
        chosen.sort(key=lambda e: (-e.strength, e.t))
        chosen = chosen[:k]
    return sorted(chosen, key=lambda e: e.t)

def _desired_lanes(events: list[Event], grid: list[float]) -> list[int]:
    """Lane semantics: kicks outer (D/K), snares inner (F/J), hats fill inner off-phase,
    melodic events follow pitch motion, unlabeled fall back to metric position."""
    lanes: list[int] = []
    prev_pitch: float | None = None
    prev_lane = 1
    flips = {"kick": 0, "snare": 0, "hat": 1, "metric": 0}
    for e in events:
        if e.pitch is not None:
            if prev_pitch is None or abs(e.pitch - prev_pitch) < 0.5:
                lane = prev_lane
            elif e.pitch > prev_pitch:
                lane = min(3, prev_lane + 1)
            else:
                lane = max(0, prev_lane - 1)
            prev_pitch = e.pitch
        elif e.drum == "kick":
            lane = (0, 3)[flips["kick"] % 2]; flips["kick"] += 1
        elif e.drum == "snare":
            lane = (1, 2)[flips["snare"] % 2]; flips["snare"] += 1
        elif e.drum == "hat":
            lane = (1, 2)[flips["hat"] % 2]; flips["hat"] += 1
        else:
            if _slot_index(e.t, grid) % GRID_DIV == 0:
                lane = (0, 3)[flips["metric"] % 2]
            else:
                lane = (1, 2)[flips["metric"] % 2]
            flips["metric"] += 1
        lanes.append(lane)
        prev_lane = lane
    return lanes

def _apply_bar_patterns(events: list[Event], lanes: list[int], beat_grid: list[float],
                        grid: list[float]) -> list[int]:
    """Bars with an identical rhythm replay the lane pattern of their first occurrence —
    choruses play the same every time, so charts become learnable."""
    if len(beat_grid) < 2:
        return lanes
    by_bar: dict[int, list[int]] = {}
    for i, e in enumerate(events):
        by_bar.setdefault(_slot_index(e.t, grid) // BAR_SLOTS, []).append(i)
    memo: dict[tuple, tuple[int, ...]] = {}
    out = list(lanes)
    for bar in sorted(by_bar):
        idxs = by_bar[bar]
        sig = tuple((_slot_index(events[i].t, grid) % BAR_SLOTS, events[i].kind,
                     events[i].drum, round(events[i].pitch or -1)) for i in idxs)
        if sig in memo and len(memo[sig]) == len(idxs):
            for i, lane in zip(idxs, memo[sig]):
                out[i] = lane
        else:
            memo[sig] = tuple(out[i] for i in idxs)
    return out

def _place(events: list[Event], lanes: list[int]) -> list[Note]:
    """Final placement with the same-finger gap enforced: rotate to a free lane, drop if none."""
    notes: list[Note] = []
    last_in_lane: dict[int, float] = {}
    for e, lane in zip(events, lanes):
        for off in range(4):
            cand = (lane + off) % 4
            end_t = e.t + (e.dur or 0) if e.kind == "sustain" else e.t
            if e.t - last_in_lane.get(cand, -10.0) >= MIN_LANE_GAP:
                hold_dur = round(e.dur, 3) if e.kind == "sustain" and e.dur else None
                notes.append(Note(t=e.t, lane=cand,
                                  type="hold" if hold_dur else "tap", dur=hold_dur))
                last_in_lane[cand] = end_t
                break
    return notes

def generate_beatmaps(doc: AnalysisDoc) -> list[Beatmap]:
    snapped = snap_to_grid(doc.events, doc.beatGrid, tol_frac=SNAP_TOL_FRAC)
    grid = _grid(doc.beatGrid)
    maps = []
    for difficulty in ("easy", "medium", "hard"):
        chosen = _select(snapped, grid, difficulty, doc)
        lanes = _desired_lanes(chosen, grid)
        lanes = _apply_bar_patterns(chosen, lanes, doc.beatGrid, grid)
        maps.append(Beatmap(
            beatmapId=f"{doc.songId}/g{GENERATOR_VERSION}/{difficulty}/standard",
            songId=doc.songId, generatorVersion=GENERATOR_VERSION,
            difficulty=difficulty, notes=_place(chosen, lanes)))
    return maps
