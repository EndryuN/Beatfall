import shutil
import librosa
from pathlib import Path
from .analyze import analyze_audio
from .generate import generate_beatmaps
from .models import AnalysisDoc, Beatmap, SongMeta
from .youtube import fetch_audio

class RealSteps:
    def fetch(self, video_id: str, progress_cb):
        return fetch_audio(video_id, progress_cb)
    def analyze(self, audio_path: Path, meta: SongMeta) -> AnalysisDoc:
        y, sr = librosa.load(str(audio_path), sr=22050, mono=True)
        return analyze_audio(y, sr, meta)
    def generate(self, analysis: AnalysisDoc) -> list[Beatmap]:
        return generate_beatmaps(analysis)
    def cleanup(self, audio_path: Path) -> None:
        shutil.rmtree(audio_path.parent, ignore_errors=True)
