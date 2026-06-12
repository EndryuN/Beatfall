# pipeline/tests/test_store.py
import json
from pathlib import Path
from beatfall_pipeline.store import BeatmapStore
from beatfall_pipeline.models import AnalysisDoc, Beatmap

FIX = Path(__file__).resolve().parents[2] / "contracts/fixtures"

def _fixtures():
    analysis = AnalysisDoc.model_validate(json.loads((FIX / "fixture.analysis.json").read_text()))
    bm = Beatmap.model_validate(json.loads((FIX / "fixture.beatmap.hard.json").read_text()))
    return analysis, [bm]

def test_save_then_get(tmp_path):
    store = BeatmapStore(tmp_path)
    analysis, maps = _fixtures()
    store.save(analysis, maps)
    assert store.get_analysis("yt:dQw4w9WgXcQ", 1) is not None
    assert store.get_beatmap("yt:dQw4w9WgXcQ", "hard", 1) is not None
    assert store.get_beatmap("yt:dQw4w9WgXcQ", "hard", 99) is None  # version mismatch = miss

def test_list_songs(tmp_path):
    store = BeatmapStore(tmp_path)
    analysis, maps = _fixtures()
    store.save(analysis, maps)
    entries = store.list_songs()
    assert len(entries) == 1
    assert entries[0]["songId"] == "yt:dQw4w9WgXcQ"
    assert entries[0]["status"] == "ready"
    assert "hard" in entries[0]["difficulties"]

def test_get_missing(tmp_path):
    assert BeatmapStore(tmp_path).get_analysis("yt:nope0000000", 1) is None
