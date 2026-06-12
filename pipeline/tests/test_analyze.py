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

def _burst(y, sr, t0, freqs, dur=0.04):
    """Short percussive burst of the given frequencies with a sharp attack."""
    n0, n = int(t0 * sr), int(dur * sr)
    tt = np.arange(n) / sr
    env = np.linspace(1.0, 0.0, n)
    for f in freqs:
        y[n0:n0 + n] += (0.8 * np.sin(2 * np.pi * f * tt) * env).astype(y.dtype)

def _drum_near(doc, t, tol=0.08):
    cands = [e for e in doc.events if e.kind == "onset" and abs(e.t - t) <= tol]
    return cands[0].drum if cands else None

def test_onset_drum_classification():
    y = np.zeros(int(6 * SR), dtype=np.float32)
    for t in (1.0, 2.0):
        _burst(y, SR, t, [60, 90])                  # kick: low thump
    for t in (1.5, 2.5):
        _burst(y, SR, t, [7000, 9000, 11000])       # hat: high sizzle
    for t in (3.0, 4.0):
        _burst(y, SR, t, [400, 900, 1800])          # snare: mid crack
    doc = analyze_audio(y, SR, SongMeta(videoId="dQw4w9WgXcQ", title="t", duration=6.0))
    assert _drum_near(doc, 1.0) == "kick" and _drum_near(doc, 2.0) == "kick"
    assert _drum_near(doc, 1.5) == "hat" and _drum_near(doc, 2.5) == "hat"
    assert _drum_near(doc, 3.0) == "snare" and _drum_near(doc, 4.0) == "snare"

def test_analyze_with_real_stems():
    """Demucs path: onsets from the drums stem, sustains from vocals and bass,
    roster from per-stem activity."""
    dur = 6.0
    n = int(dur * SR)
    drums = np.zeros(n, dtype=np.float32)
    for t in (1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0):
        _burst(drums, SR, t, [60, 90])
    vocals = concat(silence(1.0), tone(440, 2.0), silence(3.0))           # MIDI 69
    bass = concat(silence(3.0), tone(82.41, 1.5), silence(1.5))          # E2 = MIDI 40
    other = np.zeros(n, dtype=np.float32)
    stems = {"drums": drums, "bass": bass[:n], "vocals": vocals[:n], "other": other}
    mix = (drums + stems["bass"] + stems["vocals"]).astype(np.float32)
    doc = analyze_audio(mix, SR, SongMeta(videoId="dQw4w9WgXcQ", title="t", duration=dur),
                        stems=stems)
    vocal_sus = [e for e in doc.events if e.kind == "sustain" and e.stem == "vocals"]
    bass_sus = [e for e in doc.events if e.kind == "sustain" and e.stem == "bass"]
    assert vocal_sus and abs((vocal_sus[0].pitch or 0) - 69) < 1.5
    assert bass_sus and abs((bass_sus[0].pitch or 0) - 40) < 1.5
    assert set(doc.energyCurves.stems) == {"drums", "bass", "vocals", "other"}
    assert "drummer" in doc.roster and "singer" in doc.roster and "bassist" in doc.roster
    assert "guitarist" not in doc.roster                      # "other" stem is silent

def test_energy_curves_and_roster():
    y = click_track(bpm=120, seconds=10)
    doc = analyze_audio(y, SR, META)
    assert doc.energyCurves.sampleRateHz == 15
    assert "drums" in doc.energyCurves.stems
    n = len(doc.energyCurves.stems["drums"])
    assert abs(n - 150) <= 3  # 10 s * 15 Hz
    assert all(0 <= v <= 1 for v in doc.energyCurves.stems["drums"])
    assert "drummer" in doc.roster
