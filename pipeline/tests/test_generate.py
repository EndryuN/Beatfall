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

def test_lead_in_no_notes_before_2s():
    events = [_onset(0.5), _onset(1.0), _onset(1.5), _onset(3.0)]
    for m in generate_beatmaps(_doc(events)):
        assert all(n.t >= 2.0 for n in m.notes)

def test_offgrid_onsets_filtered_as_noise():
    # slot width 0.125s -> tolerance 43.75ms; an onset 60ms off the grid is noise
    maps = {m.difficulty: m for m in generate_beatmaps(_doc([_onset(3.0), _onset(3.56)]))}
    assert [n.t for n in maps["hard"].notes] == [3.0]

def test_weak_onsets_filtered():
    maps = {m.difficulty: m for m in generate_beatmaps(_doc([_onset(3.0, s=0.9), _onset(4.0, s=0.2)]))}
    assert [n.t for n in maps["hard"].notes] == [3.0]

def test_downbeats_get_outer_lanes():
    maps = {m.difficulty: m for m in generate_beatmaps(_doc([_onset(2.0, s=0.9), _onset(2.5, s=0.9)]))}
    assert {n.lane for n in maps["hard"].notes} == {0, 3}

def test_deterministic():
    events = [_onset(round(0.125 * i, 3), s=0.5 + (i % 7) * 0.07) for i in range(160)]
    a = [m.model_dump_json() for m in generate_beatmaps(_doc(events))]
    b = [m.model_dump_json() for m in generate_beatmaps(_doc(events))]
    assert a == b

def test_beatmap_ids():
    m = generate_beatmaps(_doc([_onset(1.0)]))[0]
    assert m.beatmapId == f"yt:dQw4w9WgXcQ/g{m.generatorVersion}/{m.difficulty}/standard"
