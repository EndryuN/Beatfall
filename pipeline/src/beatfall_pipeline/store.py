import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from .models import AnalysisDoc, Beatmap

def _safe(song_id: str) -> str:
    return song_id.replace(":", "_")

class BeatmapStore:
    """File layout: <root>/library.json + <root>/songs/<id>/analysis.json + beatmap.<diff>.json"""

    def __init__(self, root: Path):
        self.root = Path(root)
        (self.root / "songs").mkdir(parents=True, exist_ok=True)
        self._index_path = self.root / "library.json"

    def _index(self) -> dict:
        if self._index_path.exists():
            return json.loads(self._index_path.read_text())
        return {}

    def _write_index(self, idx: dict) -> None:
        self._index_path.write_text(json.dumps(idx, indent=2))

    def save(self, analysis: AnalysisDoc, beatmaps: list[Beatmap]) -> None:
        d = self.root / "songs" / _safe(analysis.songId)
        d.mkdir(parents=True, exist_ok=True)
        (d / "analysis.json").write_text(analysis.model_dump_json(exclude_none=True))
        for bm in beatmaps:
            (d / f"beatmap.{bm.difficulty}.json").write_text(bm.model_dump_json(exclude_none=True))
        idx = self._index()
        idx[analysis.songId] = {
            "songId": analysis.songId, "title": analysis.title, "channel": analysis.channel,
            "duration": analysis.duration, "thumbnail": analysis.thumbnail, "bpm": analysis.bpm,
            "status": "ready", "error": None,
            "difficulties": sorted(bm.difficulty for bm in beatmaps),
            "addedAt": datetime.now(timezone.utc).isoformat(),
        }
        self._write_index(idx)

    def delete(self, song_id: str) -> bool:
        import shutil
        idx = self._index()
        existed = song_id in idx
        idx.pop(song_id, None)
        self._write_index(idx)
        d = self.root / "songs" / _safe(song_id)
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
            existed = True
        return existed

    def get_analysis(self, song_id: str, version: int) -> Optional[AnalysisDoc]:
        p = self.root / "songs" / _safe(song_id) / "analysis.json"
        if not p.exists():
            return None
        doc = AnalysisDoc.model_validate_json(p.read_text())
        return doc if doc.analysisVersion == version else None

    def get_beatmap(self, song_id: str, difficulty: str, generator_version: int) -> Optional[Beatmap]:
        p = self.root / "songs" / _safe(song_id) / f"beatmap.{difficulty}.json"
        if not p.exists():
            return None
        bm = Beatmap.model_validate_json(p.read_text())
        return bm if bm.generatorVersion == generator_version else None

    def list_songs(self) -> list[dict]:
        return sorted(self._index().values(), key=lambda e: e["addedAt"], reverse=True)
