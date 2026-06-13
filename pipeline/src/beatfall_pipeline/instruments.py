"""What's playing lead? AudioSet tagging (PANNs) over the 'other' stem.

Demucs can't isolate a violin stem, but we can identify when strings (or piano,
synth, brass...) dominate the lead — which names the editor's LEAD rail and
puts a violinist on stage instead of a guitarist.
"""
import numpy as np

CATEGORY_LABELS: dict[str, set[str]] = {
    # only genuine string-instrument labels — "Orchestra"/"String section" fire on any lush
    # production and produced spurious violinists, so they're deliberately excluded.
    "strings": {"Violin, fiddle", "Cello", "Viola", "Bowed string instrument", "Pizzicato"},
    "guitar": {"Guitar", "Electric guitar", "Acoustic guitar", "Steel guitar, slide guitar",
               "Strum", "Banjo", "Ukulele", "Plucked string instrument"},
    # keyboards lumped together — Demucs+PANNs can't reliably split piano / e-piano / organ,
    # and a listener hears them all as "the keys" → pianist.
    "piano": {"Piano", "Electric piano", "Harpsichord", "Keyboard (musical)",
              "Organ", "Electronic organ", "Hammond organ"},
    "synth": {"Synthesizer", "Sampler", "Electronic music"},
    "brass": {"Trumpet", "Trombone", "Brass instrument", "Saxophone", "French horn"},
}
MIN_SCORE = 0.08
_TAG_SR = 32000          # PANNs models are trained at 32 kHz

def _categorize(label_scores: dict[str, float]) -> str | None:
    """Pick the lead-instrument family from AudioSet label scores."""
    best: str | None = None
    best_score = 0.0
    for cat, labels in CATEGORY_LABELS.items():
        s = max((label_scores.get(lbl, 0.0) for lbl in labels), default=0.0)
        if s > best_score:
            best, best_score = cat, s
    return best if best_score >= MIN_SCORE else None

_tagger = None

def detect_lead_instrument(y: np.ndarray, sr: int) -> str | None:
    """Tag the loudest ~30s of the stem and map to an instrument family.
    Raises on missing model — callers decide the fallback."""
    global _tagger
    import librosa
    import torch
    from panns_inference import AudioTagging, labels

    if _tagger is None:
        _tagger = AudioTagging(checkpoint_path=None,
                               device="cuda" if torch.cuda.is_available() else "cpu")
    y32 = librosa.resample(y, orig_sr=sr, target_sr=_TAG_SR) if sr != _TAG_SR else y
    span = 30 * _TAG_SR
    start = max(0, len(y32) // 2 - span // 2)      # the middle is usually the thick of the song
    seg = y32[start:start + span].astype(np.float32)
    if len(seg) < _TAG_SR:                          # under a second of lead — nothing to tag
        return None
    clipwise, _ = _tagger.inference(seg[None, :])
    scores = {labels[i]: float(clipwise[0][i]) for i in range(len(labels))}
    return _categorize(scores)
