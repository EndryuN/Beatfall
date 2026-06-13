from . import GENERATOR_VERSION
from .models import AnalysisDoc, Beatmap, Event, Note

GRID_DIV = 4               # 16th notes
BAR_SLOTS = GRID_DIV * 4   # 4/4 assumed: 16 slots per bar
LEAD_IN_S = 2.0            # no notes before this — the player needs a runway
SNAP_TOL_FRAC = 0.35       # onsets farther than this fraction of a slot from the grid are noise
MAX_BUDGET_CARRY = 1.5     # unused note budget rolls into the next window, but doesn't pile up forever

FILL_ENERGY = 0.72         # hard streams only where the song is genuinely loud
FILL_STRENGTH = 0.25       # synthetic fills are first to go when the global cap trims

# Per-difficulty character (piano-cover model: melody is the lead line everywhere).
# v7 generates HARD first, then down-charts: medium ⊂ hard, easy ⊂ medium — same notes,
# same lanes, fewer of them, so learning easy literally teaches hard's skeleton.
#   lane_gap = minimum same-lane repeat interval: hard allows genuine rapid streams.
DIFF = {
    "easy":   {"density": 2.6, "slot": 2, "floor": 0.38, "min_hold": 0.9,
               "energy": (0.35, 0.70), "hats": False, "chord_strength": None, "window_beats": 4,
               "stems": {"drums", "vocals"}, "fill": False, "lane_gap": 0.20},
    "medium": {"density": 4.0, "slot": 2, "floor": 0.30, "min_hold": 0.6,
               "energy": (0.35, 0.85), "hats": True, "chord_strength": None, "window_beats": 1,
               "stems": {"drums", "vocals", "other"}, "fill": False, "lane_gap": 0.15},
    "hard":   {"density": 4.5, "slot": 1, "floor": 0.32, "min_hold": 0.45,
               "energy": (0.40, 0.70), "hats": True, "chord_strength": 0.93, "window_beats": 1,
               "stems": {"drums", "vocals", "other", "bass"}, "fill": True, "lane_gap": 0.12},
}
DENSITY = {d: c["density"] for d, c in DIFF.items()}       # kept for external reference

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

def _metric_prio(e: Event, grid: list[float]) -> int:
    """How structural a position is within its bar: downbeat, mid-bar, other beats, off-beats."""
    return {0: 0, 8: 1, 4: 2, 12: 3}.get(_slot_index(e.t, grid) % BAR_SLOTS, 4)

def _drum_prio(e: Event) -> int:
    """Primacy for easy: kicks anchor, melody sings, snares answer, texture last."""
    if e.pitch is not None:
        return 1
    return {"kick": 0, "snare": 2, "hat": 4}.get(e.drum or "", 3)

def _select(snapped: list[Event], grid: list[float], difficulty: str, doc: AnalysisDoc) -> list[Event]:
    cfg = DIFF[difficulty]
    in_scope = [e for e in snapped if e.stem in cfg["stems"] and e.t >= LEAD_IN_S]
    sustains = [e for e in in_scope
                if e.kind == "sustain" and (e.dur or 0) >= cfg["min_hold"]]
    # short melody notes play as taps, keeping their pitch for lane contouring
    melody_taps = [e.model_copy(update={"kind": "onset", "dur": None})
                   for e in in_scope
                   if e.kind == "sustain" and (e.dur or 0) < cfg["min_hold"]]
    onsets = [e for e in in_scope if e.kind == "onset"] + melody_taps
    onsets = [e for e in onsets
              if e.strength >= cfg["floor"] and _slot_index(e.t, grid) % cfg["slot"] == 0]
    if not cfg["hats"]:
        onsets = [e for e in onsets if e.drum != "hat"]

    # density follows the song: each window gets a note budget scaled by the drums' energy.
    # Easy budgets per bar and spends on the most PRIMARY notes; medium/hard per beat by strength.
    # Hard additionally streams: unspent budget in loud sections becomes grid fills.
    chosen = list(sustains)
    beats = doc.beatGrid
    win = cfg["window_beats"]
    e0, e1 = cfg["energy"]
    carry = 0.0
    for wi in range(0, len(beats), win):
        wt = beats[wi]
        if wi + win < len(beats):
            wt_end = beats[wi + win]
        else:
            step = beats[-1] - beats[-2] if len(beats) > 1 else 0.5
            wt_end = beats[-1] + step
        pool = [e for e in onsets if wt <= e.t < wt_end]
        energy = _energy_at(doc, wt)
        q = cfg["density"] * (wt_end - wt) * (e0 + e1 * energy) + carry
        take = min(len(pool), int(q))
        if difficulty == "easy":
            pool.sort(key=lambda e: (_metric_prio(e, grid), _drum_prio(e), -e.strength, e.t))
        else:
            pool.sort(key=lambda e: (-e.strength, e.t))
        chosen += pool[:take]

        fills = 0
        if cfg["fill"] and energy >= FILL_ENERGY and wt >= LEAD_IN_S and take == len(pool):
            deficit = int(q) - take
            occupied = {_slot_index(e.t, grid) for e in pool}
            lo, hi = wi * GRID_DIV, min((wi + win) * GRID_DIV, len(grid))
            # streams fill 8th positions first, then 16ths
            for slot in sorted(range(lo, hi), key=lambda s: (s % 2, s)):
                if fills >= deficit:
                    break
                if slot in occupied:
                    continue
                chosen.append(Event(t=round(grid[slot], 3), stem="drums", kind="onset",
                                    strength=FILL_STRENGTH))
                occupied.add(slot)
                fills += 1
        carry = min(MAX_BUDGET_CARRY, q - take - fills)

    k = int(cfg["density"] * doc.duration)                 # global ceiling regardless of energy
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

def _place(events: list[Event], lanes: list[int], grid: list[float],
           chord_strength: float | None = None,
           lane_gap: float = 0.09) -> list[tuple[Event, Note, bool]]:
    """Final placement with the same-finger gap enforced. A busy lane falls back to its
    MIRROR lane first (0↔3, 1↔2 — drum class stays on its pair), then the rest, else drop.
    Powerful downbeat kicks chord the outer pair (D+K), powerful snares the inner pair (F+J).
    Returns (source event, note, is_chord_partner) so easier tiers can be derived."""
    placed: list[tuple[Event, Note, bool]] = []
    last_in_lane: dict[int, float] = {}
    for e, lane in zip(events, lanes):
        for cand in (lane, 3 - lane, (lane + 1) % 4, (lane + 2) % 4):
            end_t = e.t + (e.dur or 0) if e.kind == "sustain" else e.t
            if e.t - last_in_lane.get(cand, -10.0) >= lane_gap:
                hold_dur = round(e.dur, 3) if e.kind == "sustain" and e.dur else None
                placed.append((e, Note(t=e.t, lane=cand,
                                       type="hold" if hold_dur else "tap", dur=hold_dur), False))
                last_in_lane[cand] = end_t
                wants_chord = (chord_strength is not None and e.kind == "onset"
                               and e.strength >= chord_strength
                               and _slot_index(e.t, grid) % GRID_DIV == 0
                               and ((e.drum == "kick" and cand in (0, 3))
                                    or (e.drum == "snare" and cand in (1, 2))))
                if wants_chord:
                    mirror = 3 - cand                      # 0↔3 (D+K) and 1↔2 (F+J)
                    if e.t - last_in_lane.get(mirror, -10.0) >= lane_gap:
                        placed.append((e, Note(t=e.t, lane=mirror, type="tap"), True))
                        last_in_lane[mirror] = e.t
                break
    return placed

def _downchart(placed: list[tuple[Event, Note, bool]], grid: list[float],
               difficulty: str, doc: AnalysisDoc) -> list[tuple[Event, Note, bool]]:
    """Derive an easier tier as a strict subset of a harder one: same notes, same lanes,
    fewer of them. Filters are removal criteria; the energy budget thins what remains."""
    cfg = DIFF[difficulty]
    keeps: list[tuple[Event, Note, bool]] = []
    pool: list[tuple[Event, Note, bool]] = []
    for ev, note, is_partner in placed:
        if is_partner:
            continue                                   # chords are a hard-tier flourish
        if ev.stem not in cfg["stems"]:
            continue
        if note.type == "hold":
            if (note.dur or 0) >= cfg["min_hold"]:
                keeps.append((ev, note, False))
            continue
        if ev.strength < cfg["floor"]:
            continue
        if not cfg["hats"] and ev.drum == "hat":
            continue
        if _slot_index(note.t, grid) % cfg["slot"] != 0:
            continue
        pool.append((ev, note, False))

    chosen = list(keeps)
    beats = doc.beatGrid
    win = cfg["window_beats"]
    e0, e1 = cfg["energy"]
    carry = 0.0
    for wi in range(0, len(beats), win):
        wt = beats[wi]
        if wi + win < len(beats):
            wt_end = beats[wi + win]
        else:
            step = beats[-1] - beats[-2] if len(beats) > 1 else 0.5
            wt_end = beats[-1] + step
        wpool = [p for p in pool if wt <= p[1].t < wt_end]
        q = cfg["density"] * (wt_end - wt) * (e0 + e1 * _energy_at(doc, wt)) + carry
        take = min(len(wpool), int(q))
        carry = min(MAX_BUDGET_CARRY, q - take)
        if difficulty == "easy":
            wpool.sort(key=lambda p: (_metric_prio(p[0], grid), _drum_prio(p[0]),
                                      -p[0].strength, p[0].t))
        else:
            wpool.sort(key=lambda p: (-p[0].strength, p[0].t))
        chosen += wpool[:take]
    chosen.sort(key=lambda p: p[1].t)
    return chosen

def generate_beatmaps(doc: AnalysisDoc) -> list[Beatmap]:
    """Chart hard first, then down-chart: easy ⊂ medium ⊂ hard (same notes/lanes, fewer)."""
    snapped = snap_to_grid(doc.events, doc.beatGrid, tol_frac=SNAP_TOL_FRAC)
    grid = _grid(doc.beatGrid)
    chosen = _select(snapped, grid, "hard", doc)
    lanes = _desired_lanes(chosen, grid)
    lanes = _apply_bar_patterns(chosen, lanes, doc.beatGrid, grid)
    hard = _place(chosen, lanes, grid,
                  chord_strength=DIFF["hard"]["chord_strength"],
                  lane_gap=DIFF["hard"]["lane_gap"])
    medium = _downchart(hard, grid, "medium", doc)
    easy = _downchart(medium, grid, "easy", doc)
    tiers = {"easy": easy, "medium": medium, "hard": hard}
    return [Beatmap(
        beatmapId=f"{doc.songId}/g{GENERATOR_VERSION}/{difficulty}/standard",
        songId=doc.songId, generatorVersion=GENERATOR_VERSION,
        difficulty=difficulty,
        notes=[n.model_copy() for _, n, _ in tiers[difficulty]])
        for difficulty in ("easy", "medium", "hard")]
