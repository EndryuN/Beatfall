"""GPU worker entrypoint: consume jobs from the SQLite queue, run the pipeline, write the store."""
import logging
import time

from . import config
from .queue_sqlite import SqliteJobQueue
from .store import BeatmapStore

log = logging.getLogger("beatfall.worker")

def run_one(q: SqliteJobQueue, store: BeatmapStore, steps, timeout: int = 5) -> bool:
    """Process at most one job. Returns False when the queue was empty."""
    job_id = q.claim(timeout=timeout)
    if not job_id:
        return False
    audio = None
    try:
        job = q.get(job_id)
        if job is None:
            return True
        q.set(job_id, stage="downloading", progress=0.0)
        audio, meta = steps.fetch(job.video_id, lambda p: q.set(job_id, progress=p * 0.4))
        q.set(job_id, stage="analyzing", progress=0.5)
        analysis = steps.analyze(audio, meta, stage_cb=lambda s: q.set(job_id, stage=s))
        q.set(job_id, stage="generating", progress=0.85)
        maps = steps.generate(analysis)
        store.save(analysis, maps)
        q.set(job_id, stage="done", progress=1.0)
    except Exception as e:  # job-level failure must not kill the worker loop
        log.exception("job %s failed", job_id)
        q.set(job_id, stage="error", error=str(e))
    finally:
        q.finish(job_id)
        if audio is not None:
            try:
                steps.cleanup(audio)
            except OSError:
                pass
    return True

def main() -> None:
    logging.basicConfig(level=logging.INFO)
    from .steps import RealSteps          # heavy import: worker process only
    q = SqliteJobQueue(config.QUEUE_DB)
    q.mark_orphans("worker restarted")
    store = BeatmapStore(config.STORE_ROOT)
    steps = RealSteps()
    log.info("worker up — store=%s queue=%s", config.STORE_ROOT, config.QUEUE_DB)
    while True:
        try:
            run_one(q, store, steps)
        except Exception:
            log.exception("worker loop error")
            time.sleep(2)

if __name__ == "__main__":
    main()
