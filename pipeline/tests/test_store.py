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

def test_custom_maps_save_get_delete_and_survive_remap(tmp_path):
    store = BeatmapStore(tmp_path)
    analysis, maps = _fixtures()
    store.save(analysis, maps)
    notes = [{"t": 2.0, "lane": 0, "type": "tap"}, {"t": 3.0, "lane": 1, "type": "hold", "dur": 1.0}]
    bm = store.save_custom("yt:dQw4w9WgXcQ", "my-map", notes)
    assert bm.mode == "custom" and bm.difficulty == "my-map"
    got = store.get_beatmap("yt:dQw4w9WgXcQ", "my-map", 999)   # custom maps ignore generator version
    assert got is not None and len(got.notes) == 2
    store.save(analysis, maps)                                  # remap must not clobber custom maps
    assert store.get_beatmap("yt:dQw4w9WgXcQ", "my-map", 999) is not None
    entry = store.list_songs()[0]
    assert any(m["key"] == "my-map" and m["mode"] == "custom" for m in entry["maps"])
    assert store.delete_custom("yt:dQw4w9WgXcQ", "my-map") is True
    assert store.get_beatmap("yt:dQw4w9WgXcQ", "my-map", 999) is None

def test_custom_map_reserved_names_rejected(tmp_path):
    store = BeatmapStore(tmp_path)
    analysis, maps = _fixtures()
    store.save(analysis, maps)
    import pytest
    with pytest.raises(ValueError):
        store.save_custom("yt:dQw4w9WgXcQ", "easy", [])

def test_maps_metadata_in_index(tmp_path):
    store = BeatmapStore(tmp_path)
    analysis, maps = _fixtures()
    store.save(analysis, maps)
    entry = store.list_songs()[0]
    hard = next(m for m in entry["maps"] if m["key"] == "hard")
    assert hard["mode"] == "standard" and hard["notes"] == 25 and hard["holds"] == 2

def test_delete_song(tmp_path):
    store = BeatmapStore(tmp_path)
    analysis, maps = _fixtures()
    store.save(analysis, maps)
    assert store.delete("yt:dQw4w9WgXcQ") is True
    assert store.get_analysis("yt:dQw4w9WgXcQ", 1) is None
    assert store.list_songs() == []
    assert store.delete("yt:dQw4w9WgXcQ") is False   # already gone

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
