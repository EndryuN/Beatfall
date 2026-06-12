import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from .models import Beatmap, AnalysisDoc, Note

STANDARD_KEYS = ("easy", "medium", "hard")

def _safe(song_id: str) -> str:
    return song_id.replace(":", "_")

def _slug(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9-_ ]", "", name).strip().replace(" ", "-").lower()
    if not s:
        raise ValueError("custom map name must contain letters or digits")
    if s in STANDARD_KEYS:
        raise ValueError(f"'{s}' is a reserved map name")
    return s

def _map_meta(bm: Beatmap) -> dict:
    return {"key": bm.difficulty, "mode": bm.mode,
            "notes": len(bm.notes), "holds": sum(1 for n in bm.notes if n.type == "hold"),
            "generatorVersion": bm.generatorVersion}

class BeatmapStore:
    """File layout: <root>/library.json + <root>/songs/<id>/analysis.json + beatmap.<key>.json"""

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
        prev = idx.get(analysis.songId, {})
        custom_maps = [m for m in prev.get("maps", []) if m.get("mode") == "custom"]
        idx[analysis.songId] = {
            "songId": analysis.songId, "title": analysis.title, "channel": analysis.channel,
            "duration": analysis.duration, "thumbnail": analysis.thumbnail, "bpm": analysis.bpm,
            "status": "ready", "error": None,
            "difficulties": sorted(bm.difficulty for bm in beatmaps),
            "maps": [_map_meta(bm) for bm in beatmaps] + custom_maps,
            "addedAt": prev.get("addedAt") or datetime.now(timezone.utc).isoformat(),
        }
        self._write_index(idx)

    def save_custom(self, song_id: str, name: str, notes: list) -> Beatmap:
        key = _slug(name)
        d = self.root / "songs" / _safe(song_id)
        if not d.exists():
            raise ValueError("unknown song")
        bm = Beatmap(beatmapId=f"{song_id}/custom/{key}", songId=song_id, generatorVersion=0,
                     difficulty=key, mode="custom",
                     notes=[Note.model_validate(n) for n in notes])
        bm.notes.sort(key=lambda n: n.t)
        (d / f"beatmap.{key}.json").write_text(bm.model_dump_json(exclude_none=True))
        idx = self._index()
        if song_id in idx:
            maps = [m for m in idx[song_id].get("maps", []) if m.get("key") != key]
            maps.append(_map_meta(bm))
            idx[song_id]["maps"] = maps
            self._write_index(idx)
        return bm

    def delete_custom(self, song_id: str, name: str) -> bool:
        key = _slug(name)
        p = self.root / "songs" / _safe(song_id) / f"beatmap.{key}.json"
        existed = p.exists()
        if existed:
            p.unlink()
        idx = self._index()
        if song_id in idx:
            idx[song_id]["maps"] = [m for m in idx[song_id].get("maps", []) if m.get("key") != key]
            self._write_index(idx)
        return existed

    def delete(self, song_id: str) -> bool:
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

    def get_beatmap(self, song_id: str, key: str, generator_version: int) -> Optional[Beatmap]:
        p = self.root / "songs" / _safe(song_id) / f"beatmap.{key}.json"
        if not p.exists():
            return None
        bm = Beatmap.model_validate_json(p.read_text())
        if bm.mode == "custom":
            return bm                                  # human-authored maps never go stale
        return bm if bm.generatorVersion == generator_version else None

    def list_songs(self) -> list[dict]:
        return sorted(self._index().values(), key=lambda e: e["addedAt"], reverse=True)
