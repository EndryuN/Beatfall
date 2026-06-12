# pipeline/tests/test_jobs.py
import json, time
from pathlib import Path
from beatfall_pipeline import ANALYSIS_VERSION, GENERATOR_VERSION
from beatfall_pipeline.jobs import JobQueue, PipelineSteps
from beatfall_pipeline.models import AnalysisDoc, Beatmap, SongMeta
from beatfall_pipeline.store import BeatmapStore

FIX = Path(__file__).resolve().parents[2] / "contracts/fixtures"

def fixture_beatmap(generator_version: int = GENERATOR_VERSION) -> Beatmap:
    """Contract fixture is pinned at g1; tests stamp it with the requested generator version."""
    bm = Beatmap.model_validate(json.loads((FIX / "fixture.beatmap.hard.json").read_text()))
    return bm.model_copy(update={
        "generatorVersion": generator_version,
        "beatmapId": f"{bm.songId}/g{generator_version}/hard/standard",
    })

class FakeSteps(PipelineSteps):
    def __init__(self, fail_at: str | None = None):
        self.fail_at = fail_at
    def fetch(self, video_id, progress_cb):
        if self.fail_at == "fetch": raise RuntimeError("boom: video unavailable")
        return Path("fake.wav"), SongMeta(videoId=video_id, title="Fake", duration=10.0)
    def analyze(self, audio_path, meta):
        if self.fail_at == "analyze": raise RuntimeError("boom")
        doc = AnalysisDoc.model_validate(json.loads((FIX / "fixture.analysis.json").read_text()))
        return doc.model_copy(update={"analysisVersion": ANALYSIS_VERSION})  # fixture is pinned at v1
    def generate(self, analysis):
        return [fixture_beatmap()]
    def cleanup(self, audio_path): pass

def _wait(q, job_id, until=("done", "error"), timeout=5.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = q.get(job_id)
        if j and j.stage in until: return j
        time.sleep(0.01)
    raise TimeoutError

def test_happy_path(tmp_path):
    store = BeatmapStore(tmp_path)
    q = JobQueue(store, FakeSteps()); q.start()
    job = q.submit("dQw4w9WgXcQ")
    j = _wait(q, job.id)
    assert j.stage == "done"
    assert store.get_beatmap("yt:dQw4w9WgXcQ", "hard", GENERATOR_VERSION) is not None

def test_failure_reported(tmp_path):
    q = JobQueue(BeatmapStore(tmp_path), FakeSteps(fail_at="fetch")); q.start()
    j = _wait(q, q.submit("dQw4w9WgXcQ").id)
    assert j.stage == "error" and "unavailable" in j.error

def test_duplicate_submit_returns_same_job(tmp_path):
    q = JobQueue(BeatmapStore(tmp_path), FakeSteps())
    a = q.submit("dQw4w9WgXcQ"); b = q.submit("dQw4w9WgXcQ")
    assert a.id == b.id  # not started yet → same queued job
