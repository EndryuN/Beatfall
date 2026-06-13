# pipeline/tests/test_queue_sqlite.py
from beatfall_pipeline.queue_sqlite import SqliteJobQueue

def _q(tmp_path):
    return SqliteJobQueue(tmp_path / "jobs.db")

def test_submit_and_get(tmp_path):
    q = _q(tmp_path)
    job = q.submit("dQw4w9WgXcQ")
    assert job.id.startswith("j-") and job.stage == "queued" and job.video_id == "dQw4w9WgXcQ"
    got = q.get(job.id)
    assert got and got.stage == "queued" and got.progress == 0.0 and got.error is None

def test_dedup_active_job(tmp_path):
    q = _q(tmp_path)
    a = q.submit("dQw4w9WgXcQ")
    b = q.submit("dQw4w9WgXcQ")
    assert a.id == b.id
    q.set(a.id, stage="done")
    c = q.submit("dQw4w9WgXcQ")          # finished → new job allowed
    assert c.id != a.id

def test_claim_and_stage_updates(tmp_path):
    q = _q(tmp_path)
    job = q.submit("dQw4w9WgXcQ")
    assert q.claim(timeout=0) == job.id
    q.set(job.id, stage="separating", progress=0.5)
    got = q.get(job.id)
    assert got.stage == "separating" and got.progress == 0.5
    q.set(job.id, stage="error", error="boom")
    assert q.get(job.id).error == "boom"
    assert q.claim(timeout=0) is None     # queue drained

def test_two_handles_share_state(tmp_path):
    """API and worker are separate processes — separate queue objects, same db file."""
    a, b = _q(tmp_path), _q(tmp_path)
    job = a.submit("dQw4w9WgXcQ")
    assert b.claim(timeout=0) == job.id
    b.set(job.id, stage="analyzing", progress=0.6)
    assert a.get(job.id).stage == "analyzing"

def test_orphan_marking(tmp_path):
    q = _q(tmp_path)
    job = q.submit("dQw4w9WgXcQ")
    q.claim(timeout=0)                    # in-flight, then "worker dies"
    q2 = _q(tmp_path)                     # fresh worker process
    q2.mark_orphans("worker restarted")
    got = q2.get(job.id)
    assert got.stage == "error" and "restarted" in got.error
    q2.finish(job.id)                     # idempotent

def test_get_unknown(tmp_path):
    assert _q(tmp_path).get("j-999") is None
    assert _q(tmp_path).get("garbage") is None
