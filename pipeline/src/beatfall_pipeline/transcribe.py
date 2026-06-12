"""Audio → note events via Spotify's basic-pitch (the 'piano cover' of the song).

Each transcribed note carries start, duration, MIDI pitch, and amplitude — exactly
the material a human mapper reads off a piano cover when charting a song.
"""
import os
import tempfile
import numpy as np
import soundfile as sf

from .models import Event, Stem

_MIN_NOTE_S = 0.08
_MIN_AMP = 0.15          # basic-pitch amplitude below this is transcription noise


def transcribe_notes(y: np.ndarray, sr: int, stem: Stem,
                     pitch_min: float = 0, pitch_max: float = 127) -> list[Event]:
    """Transcribe a (stem) waveform into pitched note Events. Raises on missing model —
    callers decide the fallback."""
    from basic_pitch.inference import predict  # heavy import stays local

    fd, path = tempfile.mkstemp(suffix=".wav", prefix="beatfall-bp-")
    os.close(fd)
    try:
        sf.write(path, y, sr)
        _, _, note_events = predict(path)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass

    amps = [n[3] for n in note_events] or [1.0]
    peak = max(amps) or 1.0
    events: list[Event] = []
    for start, end, pitch, amplitude, *_ in note_events:
        dur = float(end) - float(start)
        amp = float(amplitude) / peak
        if dur < _MIN_NOTE_S or amp < _MIN_AMP:
            continue
        if not (pitch_min <= float(pitch) <= pitch_max):
            continue
        events.append(Event(t=round(float(start), 3), stem=stem, kind="sustain",
                            strength=round(min(1.0, amp), 3), dur=round(dur, 3),
                            pitch=round(float(pitch), 2), pitchConf=round(min(1.0, amp), 2)))
    events.sort(key=lambda e: e.t)
    return events
