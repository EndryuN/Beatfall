# pipeline/tests/test_api.py
import json, time
from pathlib import Path
from fastapi.testclient import TestClient
from beatfall_pipeline.main import create_app
from beatfall_pipeline.store import BeatmapStore
from beatfall_pipeline.models import AnalysisDoc
from .test_jobs import FIX, FakeSteps, fixture_beatmap

def _client(tmp_path):
    app = create_app(store=BeatmapStore(tmp_path), steps=FakeSteps())
    return TestClient(app)

def test_post_song_then_poll_job(tmp_path):
    c = _client(tmp_path)
    r = c.post("/api/songs", json={"videoId": "dQw4w9WgXcQ"})
    assert r.status_code == 202
    job_id = r.json()["jobId"]
    for _ in range(100):
        j = c.get(f"/api/jobs/{job_id}").json()
        if j["stage"] in ("done", "error"): break
        time.sleep(0.02)
    assert j["stage"] == "done"
    songs = c.get("/api/songs").json()
    assert songs[0]["songId"] == "yt:dQw4w9WgXcQ"
    bm = c.get("/api/songs/yt:dQw4w9WgXcQ/beatmaps/hard")
    assert bm.status_code == 200 and bm.json()["difficulty"] == "hard"

def test_post_existing_song_is_instant(tmp_path):
    c = _client(tmp_path)
    c.post("/api/songs", json={"videoId": "dQw4w9WgXcQ"})
    time.sleep(0.3)
    r = c.post("/api/songs", json={"videoId": "dQw4w9WgXcQ"})
    assert r.status_code == 200 and r.json()["status"] == "ready"

def test_old_generator_maps_flagged_outdated(tmp_path):
    store = BeatmapStore(tmp_path)
    analysis = AnalysisDoc.model_validate(json.loads((FIX / "fixture.analysis.json").read_text()))
    store.save(analysis, [fixture_beatmap(generator_version=1)])  # stale: g1, current is newer
    c = TestClient(create_app(store=store, steps=FakeSteps()))
    entries = c.get("/api/songs").json()
    assert entries[0]["status"] == "outdated"
    assert c.get("/api/songs/yt:dQw4w9WgXcQ/beatmaps/hard").status_code == 404

def test_404s(tmp_path):
    c = _client(tmp_path)
    assert c.get("/api/jobs/j-999").status_code == 404
    assert c.get("/api/songs/yt:nope0000000/beatmaps/hard").status_code == 404
