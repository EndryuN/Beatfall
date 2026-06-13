from fastapi.testclient import TestClient
from beatfall_pipeline import config
from beatfall_pipeline.main import create_app
from beatfall_pipeline.queue_sqlite import SqliteJobQueue
from beatfall_pipeline.store import BeatmapStore

def _client(tmp_path, monkeypatch, key=""):
    monkeypatch.setattr(config, "API_KEY", key)
    q = SqliteJobQueue(tmp_path / "jobs.db")
    return TestClient(create_app(store=BeatmapStore(tmp_path), queue=q)), q

def test_mutations_need_key_when_configured(tmp_path, monkeypatch):
    c, _ = _client(tmp_path, monkeypatch, key="sekrit")
    assert c.post("/api/songs", json={"videoId": "dQw4w9WgXcQ"}).status_code == 401
    r = c.post("/api/songs", json={"videoId": "dQw4w9WgXcQ"},
               headers={"X-API-Key": "sekrit"})
    assert r.status_code == 202
    assert c.get("/api/songs").status_code == 200          # reads stay open
    # Verify 401 includes CORS header when origin is allowed
    r401 = c.post("/api/songs", json={"videoId": "dQw4w9WgXcQ"},
                  headers={"Origin": "http://localhost:5173"})
    assert r401.status_code == 401
    assert r401.headers.get("access-control-allow-origin") == "http://localhost:5173"

def test_auth_disabled_when_no_key(tmp_path, monkeypatch):
    c, _ = _client(tmp_path, monkeypatch, key="")
    assert c.post("/api/songs", json={"videoId": "dQw4w9WgXcQ"}).status_code == 202

def test_sqlite_queue_drives_job_endpoint(tmp_path, monkeypatch):
    c, q = _client(tmp_path, monkeypatch)
    job_id = c.post("/api/songs", json={"videoId": "dQw4w9WgXcQ"}).json()["jobId"]
    q.set(job_id, stage="separating", progress=0.4)
    j = c.get(f"/api/jobs/{job_id}").json()
    assert j["stage"] == "separating" and j["songId"] == "yt:dQw4w9WgXcQ"
