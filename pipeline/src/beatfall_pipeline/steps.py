import logging
import shutil
import librosa
from pathlib import Path
from .analyze import analyze_audio
from .generate import generate_beatmaps
from .models import AnalysisDoc, Beatmap, SongMeta
from .youtube import fetch_audio

log = logging.getLogger(__name__)

class RealSteps:
    def fetch(self, video_id: str, progress_cb):
        return fetch_audio(video_id, progress_cb)

    def analyze(self, audio_path: Path, meta: SongMeta, stage_cb=None) -> AnalysisDoc:
        y, sr = librosa.load(str(audio_path), sr=22050, mono=True)
        stems = None
        try:
            if stage_cb:
                stage_cb("separating")
            from .separate import separate_demucs
            stems = separate_demucs(y, sr)
        except Exception as e:  # torch missing, OOM, model download failure — HPSS still works
            log.warning("Demucs separation unavailable, falling back to HPSS: %s", e)
            stems = None
        if stage_cb:
            stage_cb("analyzing")
        return analyze_audio(y, sr, meta, stems=stems)

    def generate(self, analysis: AnalysisDoc) -> list[Beatmap]:
        return generate_beatmaps(analysis)

    def cleanup(self, audio_path: Path) -> None:
        shutil.rmtree(audio_path.parent, ignore_errors=True)
