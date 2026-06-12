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
