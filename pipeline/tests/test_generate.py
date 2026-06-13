# pipeline/tests/test_generate.py
import json
from beatfall_pipeline.generate import generate_beatmaps, snap_to_grid, DENSITY
from beatfall_pipeline.models import AnalysisDoc, Event, EnergyCurves

def _doc(events, duration=20.0, bpm=120.0, drums_curve=None):
    beats = [round(i * 0.5, 3) for i in range(int(duration / 0.5))]
    curve = drums_curve if drums_curve is not None else [0.5] * 300
    return AnalysisDoc(songId="yt:dQw4w9WgXcQ", analysisVersion=1, title="t", duration=duration,
                       bpm=bpm, beatGrid=beats, roster=["drummer"], events=events,
                       energyCurves=EnergyCurves(sampleRateHz=15, stems={"drums": curve}))

def _onset(t, s=0.8, drum=None):
    return Event(t=t, stem="drums", kind="onset", strength=s, drum=drum)

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
    # down-charting guarantees easy ⊆ medium ⊆ hard; harder tiers are no smaller, and the
    # easy↔hard gap is real (exact pairwise strictness can collapse on sparse material)
    assert len(maps["easy"].notes) <= len(maps["medium"].notes) <= len(maps["hard"].notes)
    assert len(maps["easy"].notes) < len(maps["hard"].notes)

def test_same_lane_gap_respects_difficulty():
    from beatfall_pipeline.generate import DIFF
    events = [_onset(round(0.125 * i, 3)) for i in range(160)]
    for m in generate_beatmaps(_doc(events)):
        gap = DIFF[m.difficulty]["lane_gap"]
        last: dict[int, float] = {}
        for n in m.notes:
            if n.lane in last:
                assert n.t - last[n.lane] >= gap - 1e-9
            last[n.lane] = n.t

def test_hard_allows_rapid_same_lane_melody():
    # repeated-pitch 16th melody run (133ms apart) must STAY in one lane on hard,
    # not scatter to other lanes because of a lane-cooldown rotation
    mel = [Event(t=round(4.0 + 0.125 * i, 3), stem="vocals", kind="sustain",
                 strength=0.8, dur=0.2, pitch=60.0, pitchConf=0.9) for i in range(4)]
    maps = {m.difficulty: m for m in generate_beatmaps(_doc(mel))}
    notes = maps["hard"].notes
    assert len(notes) >= 3                      # density budget may trim the tail
    assert len({n.lane for n in notes}) == 1    # but survivors must NOT scatter across lanes

def test_difficulties_are_strict_subsets():
    events = [_onset(round(2.0 + 0.125 * i, 3), s=0.4 + (i % 6) * 0.1,
                     drum=["kick", "snare", "hat", None][i % 4]) for i in range(120)]
    maps = {m.difficulty: m for m in generate_beatmaps(_doc(events))}
    def keys(m):
        return {(n.t, n.lane, n.type) for n in m.notes}
    assert keys(maps["easy"]) <= keys(maps["medium"]) <= keys(maps["hard"])
    assert len(maps["easy"].notes) < len(maps["hard"].notes)

def test_holds_from_sustains():
    events = [Event(t=2.0, stem="other", kind="sustain", strength=0.8, dur=1.5, pitch=65.0, pitchConf=0.9),
              _onset(5.0)]
    maps = {m.difficulty: m for m in generate_beatmaps(_doc(events))}
    holds = [n for n in maps["hard"].notes if n.type == "hold"]
    assert holds and abs(holds[0].dur - 1.5) < 0.26  # dur snapped, roughly preserved

def test_lead_in_no_notes_before_2s():
    events = [_onset(0.5), _onset(1.0), _onset(1.5), _onset(3.0)]
    for m in generate_beatmaps(_doc(events)):
        assert all(n.t >= 2.0 for n in m.notes)

def test_offgrid_onsets_filtered_as_noise():
    # slot width 0.125s -> tolerance 43.75ms; an onset 60ms off the grid is noise
    maps = {m.difficulty: m for m in generate_beatmaps(_doc([_onset(3.0), _onset(3.56)]))}
    assert [n.t for n in maps["hard"].notes] == [3.0]

def test_weak_onsets_filtered():
    maps = {m.difficulty: m for m in generate_beatmaps(_doc([_onset(3.0, s=0.9), _onset(4.0, s=0.15)]))}
    assert [n.t for n in maps["hard"].notes] == [3.0]

def test_easy_prefers_bar_downbeats():
    # scarce budget in one bar: the quiet downbeat kick must outrank louder off-anchor snares
    curve = [0.05] * 300
    events = [_onset(4.0, s=0.5, drum="kick"),     # bar downbeat (metric prio 0), quietest
              _onset(4.5, s=0.9, drum="snare"),
              _onset(5.0, s=0.95, drum="snare"),
              _onset(5.5, s=0.92, drum="snare")]
    maps = {m.difficulty: m for m in generate_beatmaps(_doc(events, drums_curve=curve))}
    ts = [n.t for n in maps["easy"].notes]
    assert 4.0 in ts                               # the bar anchor survives despite being quietest
    assert len(ts) < 4                             # scarce budget still drops some louder off-beats

def test_strong_snares_chord_the_inner_pair():
    events = [_onset(4.0, s=0.95, drum="snare")]
    maps = {m.difficulty: m for m in generate_beatmaps(_doc(events))}
    at4 = [n for n in maps["hard"].notes if n.t == 4.0]
    assert len(at4) == 2 and {n.lane for n in at4} == {1, 2}   # F+J double press

def test_hard_chords_on_big_downbeat_kicks():
    events = [_onset(4.0, s=0.95, drum="kick"), _onset(5.0, s=0.6, drum="snare")]
    maps = {m.difficulty: m for m in generate_beatmaps(_doc(events))}
    at4_hard = [n for n in maps["hard"].notes if n.t == 4.0]
    assert len(at4_hard) == 2 and {n.lane for n in at4_hard} == {0, 3}   # two-lane chord
    at4_easy = [n for n in maps["easy"].notes if n.t == 4.0]
    assert len(at4_easy) == 1                                            # easy stays single

def test_medium_denser_than_before_and_hard_denser_still():
    events = [_onset(round(0.125 * i, 3), s=0.5 + (i % 5) * 0.1) for i in range(160)]
    maps = {m.difficulty: m for m in generate_beatmaps(_doc(events))}
    assert len(maps["medium"].notes) >= 30        # ≥ ~1.7/s over the 18 playable seconds
    assert len(maps["hard"].notes) >= 50

def test_downbeats_get_outer_lanes():
    maps = {m.difficulty: m for m in generate_beatmaps(_doc([_onset(2.0, s=0.9), _onset(2.5, s=0.9)]))}
    assert {n.lane for n in maps["hard"].notes} == {0, 3}

def test_kicks_outer_snares_inner():
    events = [_onset(2.0, drum="kick"), _onset(2.5, drum="snare"),
              _onset(3.0, drum="kick"), _onset(3.5, drum="snare")]
    maps = {m.difficulty: m for m in generate_beatmaps(_doc(events))}
    kicks = [n.lane for n in maps["hard"].notes if n.t in (2.0, 3.0)]
    snares = [n.lane for n in maps["hard"].notes if n.t in (2.5, 3.5)]
    assert set(kicks) <= {0, 3} and set(snares) <= {1, 2}

def test_easy_skips_hats():
    events = [_onset(2.0, drum="kick"), _onset(2.5, drum="hat"), _onset(3.0, drum="hat"),
              _onset(3.5, drum="kick")]
    maps = {m.difficulty: m for m in generate_beatmaps(_doc(events))}
    assert [n.t for n in maps["easy"].notes] == [2.0, 3.5]
    assert len(maps["hard"].notes) == 4

def test_density_follows_energy():
    # quiet first half, loud second half; identical onset material in both
    curve = [0.05] * 150 + [1.0] * 150          # 15 Hz x 20 s
    events = [_onset(round(0.25 * i, 3), s=0.6) for i in range(8, 80)]  # 2.0 .. 19.75
    maps = {m.difficulty: m for m in generate_beatmaps(_doc(events, drums_curve=curve))}
    notes = maps["medium"].notes
    first = [n for n in notes if n.t < 10.0]
    second = [n for n in notes if n.t >= 10.0]
    assert len(second) > len(first) * 2

def test_repeated_bars_repeat_their_pattern():
    # identical rhythm in bar starting at 4.0s and bar starting at 8.0s (bars are 2s at 120bpm)
    pat = [(0.0, "kick"), (0.5, "snare"), (1.0, "kick"), (1.5, "snare")]
    events = [_onset(4.0 + dt, drum=d) for dt, d in pat] + \
             [_onset(6.0, drum="kick")] + \
             [_onset(8.0 + dt, drum=d) for dt, d in pat]   # 6.0 kick shifts alternation parity
    maps = {m.difficulty: m for m in generate_beatmaps(_doc(events))}
    notes = sorted(maps["hard"].notes, key=lambda n: n.t)
    lanes_a = [n.lane for n in notes if 4.0 <= n.t < 6.0]
    lanes_b = [n.lane for n in notes if 8.0 <= n.t < 10.0]
    assert len(lanes_a) == 4 and lanes_a == lanes_b

def test_short_melody_notes_become_pitch_laned_taps():
    # rising 3-note melody line: taps (too short for holds) walking up the lanes
    mel = [Event(t=4.0 + 0.5 * i, stem="vocals", kind="sustain", strength=0.8,
                 dur=0.25, pitch=60.0 + 4 * i, pitchConf=0.9) for i in range(3)]
    maps = {m.difficulty: m for m in generate_beatmaps(_doc(mel))}
    notes = sorted(maps["easy"].notes, key=lambda n: n.t)
    assert len(notes) == 3
    assert all(n.type == "tap" for n in notes)                       # short = tap, not hold
    assert [n.lane for n in notes] == sorted(n.lane for n in notes)  # rising melody walks right

def test_melodic_onsets_only_on_harder_tiers():
    events = [Event(t=4.0, stem="other", kind="onset", strength=0.9),
              _onset(6.0, s=0.9, drum="kick")]
    maps = {m.difficulty: m for m in generate_beatmaps(_doc(events))}
    assert [n.t for n in maps["easy"].notes] == [6.0]            # drums only
    assert {n.t for n in maps["hard"].notes} == {4.0, 6.0}       # melodic accents join

def test_hard_fills_streams_in_high_energy():
    curve = [1.0] * 300
    events = [_onset(round(0.5 * i, 3), s=0.8, drum="kick") for i in range(4, 40)]  # 1/beat
    maps = {m.difficulty: m for m in generate_beatmaps(_doc(events, drums_curve=curve))}
    # detection gives ~2/s; hard must stream far beyond it, medium stays near detection
    assert len(maps["hard"].notes) >= 1.8 * len(maps["medium"].notes)

def test_hard_does_not_fill_quiet_parts():
    curve = [0.1] * 300
    events = [_onset(round(0.5 * i, 3), s=0.8, drum="kick") for i in range(4, 40)]
    maps = {m.difficulty: m for m in generate_beatmaps(_doc(events, drums_curve=curve))}
    assert len(maps["hard"].notes) <= len(events)                # no synthetic notes added

def test_deterministic():
    events = [_onset(round(0.125 * i, 3), s=0.5 + (i % 7) * 0.07) for i in range(160)]
    a = [m.model_dump_json() for m in generate_beatmaps(_doc(events))]
    b = [m.model_dump_json() for m in generate_beatmaps(_doc(events))]
    assert a == b

def test_beatmap_ids():
    m = generate_beatmaps(_doc([_onset(1.0)]))[0]
    assert m.beatmapId == f"yt:dQw4w9WgXcQ/g{m.generatorVersion}/{m.difficulty}/standard"
