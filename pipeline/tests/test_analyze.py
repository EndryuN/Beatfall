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
