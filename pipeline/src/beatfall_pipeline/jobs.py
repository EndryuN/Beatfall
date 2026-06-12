import itertools
import queue as queue_mod
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Protocol
from .models import AnalysisDoc, Beatmap, SongMeta
from .store import BeatmapStore

class PipelineSteps(Protocol):
    def fetch(self, video_id: str, progress_cb) -> tuple[Path, SongMeta]: ...
    def analyze(self, audio_path: Path, meta: SongMeta) -> AnalysisDoc: ...
    def generate(self, analysis: AnalysisDoc) -> list[Beatmap]: ...
    def cleanup(self, audio_path: Path) -> None: ...

@dataclass
class Job:
    id: str
    video_id: str
    stage: str = "queued"       # queued|downloading|separating|analyzing|generating|done|error
    progress: float = 0.0
    error: Optional[str] = None
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def set(self, stage=None, progress=None, error=None):
        with self.lock:
            if stage: self.stage = stage
            if progress is not None: self.progress = progress
            if error: self.error = error

class JobQueue:
    def __init__(self, store: BeatmapStore, steps: PipelineSteps):
        self.store, self.steps = store, steps
        self._jobs: dict[str, Job] = {}
        self._by_video: dict[str, str] = {}
        self._q: queue_mod.Queue[Job] = queue_mod.Queue()
        self._ids = itertools.count(1)
        self._lock = threading.Lock()

    def start(self):
        threading.Thread(target=self._worker, daemon=True).start()

    def submit(self, video_id: str) -> Job:
        with self._lock:
            existing_id = self._by_video.get(video_id)
            if existing_id:
                existing = self._jobs[existing_id]
                if existing.stage not in ("done", "error"):
                    return existing
            job = Job(id=f"j-{next(self._ids)}", video_id=video_id)
            self._jobs[job.id] = job
            self._by_video[video_id] = job.id
            self._q.put(job)
            return job

    def get(self, job_id: str) -> Optional[Job]:
        return self._jobs.get(job_id)

    def _worker(self):
        while True:
            job = self._q.get()
            audio = None
            try:
                job.set(stage="downloading", progress=0.0)
                audio, meta = self.steps.fetch(job.video_id, lambda p: job.set(progress=p * 0.4))
                job.set(stage="analyzing", progress=0.5)
                analysis = self.steps.analyze(audio, meta)
                job.set(stage="generating", progress=0.85)
                maps = self.steps.generate(analysis)
                self.store.save(analysis, maps)
                job.set(stage="done", progress=1.0)
            except Exception as e:  # any step failure lands on the job, queue survives
                job.set(stage="error", error=str(e))
            finally:
                if audio is not None:
                    try: self.steps.cleanup(audio)
                    except OSError: pass
