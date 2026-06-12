import numpy as np
import librosa

_model = None  # loaded once, reused across songs

def _get_model():
    global _model
    if _model is None:
        from demucs.pretrained import get_model
        _model = get_model("htdemucs")
        _model.eval()
    return _model

def separate_demucs(y: np.ndarray, sr: int) -> dict[str, np.ndarray]:
    """Split a mono mix into drums/bass/vocals/other with htdemucs.
    Returns mono stems resampled back to the input sample rate.
    Heavy imports are local so the pipeline works without torch installed."""
    import torch
    from demucs.apply import apply_model

    model = _get_model()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    y44 = librosa.resample(y, orig_sr=sr, target_sr=model.samplerate) if sr != model.samplerate else y
    wav = torch.tensor(np.stack([y44, y44]), dtype=torch.float32)
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)
    with torch.no_grad():
        sources = apply_model(model, wav[None], device=device, progress=False)[0]
    sources = sources * (ref.std() + 1e-8) + ref.mean()
    out: dict[str, np.ndarray] = {}
    for name, tensor in zip(model.sources, sources):
        mono = tensor.mean(dim=0).cpu().numpy().astype(np.float32)
        if model.samplerate != sr:
            mono = librosa.resample(mono, orig_sr=model.samplerate, target_sr=sr)
        out[name] = mono
    return out
