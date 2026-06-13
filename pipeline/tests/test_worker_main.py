# pipeline/tests/test_worker_main.py
from beatfall_pipeline import GENERATOR_VERSION
from beatfall_pipeline.queue_sqlite import SqliteJobQueue
from beatfall_pipeline.store import BeatmapStore
from beatfall_pipeline.worker_main import run_one
from .test_jobs import FakeSteps

def test_run_one_happy_path(tmp_path):
    q = SqliteJobQueue(tmp_path / "jobs.db")
    store = BeatmapStore(tmp_path)
    job = q.submit("dQw4w9WgXcQ")
    assert run_one(q, store, FakeSteps(), timeout=0) is True
    assert q.get(job.id).stage == "done"
    assert store.get_beatmap("yt:dQw4w9WgXcQ", "hard", GENERATOR_VERSION) is not None

def test_run_one_failure_lands_on_job(tmp_path):
    q = SqliteJobQueue(tmp_path / "jobs.db")
    job = q.submit("dQw4w9WgXcQ")
    assert run_one(q, BeatmapStore(tmp_path), FakeSteps(fail_at="fetch"), timeout=0) is True
    j = q.get(job.id)
    assert j.stage == "error" and "unavailable" in j.error

def test_run_one_empty_queue(tmp_path):
    q = SqliteJobQueue(tmp_path / "jobs.db")
    assert run_one(q, BeatmapStore(tmp_path), FakeSteps(), timeout=0) is False
