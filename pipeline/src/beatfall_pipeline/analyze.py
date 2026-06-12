import numpy as np
import librosa
from . import ANALYSIS_VERSION
from .models import AnalysisDoc, EnergyCurves, Event, SongMeta

HOP = 512
CURVE_HZ = 15.0
STEM_ACTIVITY_RMS = 0.005   # absolute RMS below which a stem counts as silent

def _energy_curve(y: np.ndarray, sr: int, duration: float) -> list[float]:
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    peak = rms.max() or 1.0
    rms = rms / peak
    src_t = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=HOP)
    dst_t = np.arange(0, duration, 1.0 / CURVE_HZ)
    return np.interp(dst_t, src_t, rms).clip(0, 1).round(4).tolist()

def _classify_onsets(y: np.ndarray, sr: int, onset_times) -> list[str]:
    """Kick / snare / hat by where the spectral energy sits at each onset."""
    n_fft = 2048
    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    low = freqs < 150
    mid = (freqs >= 150) & (freqs < 2500)
    high = freqs >= 4000
    labels: list[str] = []
    for t in onset_times:
        f = min(S.shape[1] - 1, int(float(t) * sr / HOP) + 1)
        col = S[:, f]
        e_low, e_mid, e_high = float(col[low].sum()), float(col[mid].sum()), float(col[high].sum())
        total = e_low + e_mid + e_high + 1e-9
        if e_low / total > 0.45:
            labels.append("kick")
        elif e_high / total > 0.30:
            labels.append("hat")
        else:
            labels.append("snare")
    return labels

def _sustains(y_src: np.ndarray, sr: int, stem: str,
              fmin: float = 80, fmax: float = 800) -> list[Event]:
    if float(np.sqrt(np.mean(y_src ** 2))) < STEM_ACTIVITY_RMS:
        return []                                   # silent stem: pyin on noise hallucinates
    f0, voiced, prob = librosa.pyin(y_src, fmin=fmin, fmax=fmax, sr=sr, hop_length=HOP)
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

def _onset_events(y_drums: np.ndarray, sr: int, classify_on: np.ndarray) -> list[Event]:
    onset_env = librosa.onset.onset_strength(y=y_drums, sr=sr, hop_length=HOP)
    onset_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=HOP)
    peak = onset_env.max() or 1.0
    onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=HOP)
    labels = _classify_onsets(classify_on, sr, onset_times)
    return [Event(t=round(float(t), 3), stem="drums", kind="onset",
                  strength=round(float(onset_env[f] / peak), 3), drum=label)
            for t, f, label in zip(onset_times, onset_frames, labels)]

def _active(y_stem: np.ndarray) -> bool:
    return float(np.sqrt(np.mean(y_stem ** 2))) >= STEM_ACTIVITY_RMS

def analyze_audio(y: np.ndarray, sr: int, meta: SongMeta,
                  stems: dict[str, np.ndarray] | None = None) -> AnalysisDoc:
    """stems = real separated stems (Demucs). Without them, fall back to HPSS."""
    duration = len(y) / sr
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=HOP)
    bpm = float(np.atleast_1d(tempo)[0])
    beat_grid = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP).round(3).tolist()

    if stems is not None:
        events = _onset_events(stems["drums"], sr, classify_on=stems["drums"])
        events += _sustains(stems["vocals"], sr, stem="vocals", fmin=80, fmax=1000)
        events += _sustains(stems["bass"], sr, stem="bass", fmin=40, fmax=250)
        curves = {name: _energy_curve(s, sr, duration) for name, s in stems.items()}
        roster: list = []
        if _active(stems["drums"]):
            roster.append("drummer")
        if _active(stems["bass"]):
            roster.append("bassist")
        if _active(stems["vocals"]):
            roster.append("singer")
        if _active(stems["other"]):
            roster.append("guitarist")
    else:
        # HPSS mode: percussive ≈ drums, harmonic ≈ everything melodic ("other")
        y_harm, y_perc = librosa.effects.hpss(y)
        events = _onset_events(y_perc, sr, classify_on=y)
        events += _sustains(y_harm, sr, stem="other")
        curves = {"drums": _energy_curve(y_perc, sr, duration),
                  "other": _energy_curve(y_harm, sr, duration)}
        roster = []
        if np.mean(curves["drums"]) > 0.05:
            roster.append("drummer")
        if np.mean(curves["other"]) > 0.05:
            roster.append("guitarist")

    events.sort(key=lambda e: e.t)
    return AnalysisDoc(
        songId=f"yt:{meta.videoId}", analysisVersion=ANALYSIS_VERSION,
        title=meta.title, channel=meta.channel, duration=round(duration, 3),
        thumbnail=meta.thumbnail, bpm=round(bpm, 2), beatGrid=beat_grid,
        roster=roster, events=events,
        energyCurves=EnergyCurves(sampleRateHz=CURVE_HZ, stems=curves),
    )
