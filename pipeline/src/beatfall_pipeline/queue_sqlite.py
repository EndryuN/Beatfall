"""SQLite-backed job queue: durable, shared by the mlib API and worker processes.

WAL mode allows the two processes to read/write concurrently; claiming is a single
atomic UPDATE…RETURNING so a job can never be picked up twice."""
import sqlite3
import time
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

ACTIVE_STAGES = ("queued", "downloading", "separating", "analyzing", "generating")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  error TEXT,
  claimed INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL
);
"""

@dataclass
class JobView:
    id: str
    video_id: str
    stage: str
    progress: float
    error: Optional[str]

def _view(row: sqlite3.Row) -> JobView:
    return JobView(id=f"j-{row['id']}", video_id=row["video_id"], stage=row["stage"],
                   progress=row["progress"], error=row["error"] or None)

def _pk(job_id: str) -> Optional[int]:
    try:
        return int(job_id.split("-", 1)[1])
    except (IndexError, ValueError):
        return None

class SqliteJobQueue:
    def __init__(self, db_path: Path | str):
        self.db_path = str(db_path)
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        # Concurrent first-time init (fresh db file) can hit "database is locked"
        # while two processes race the WAL switch / schema creation — retry briefly.
        for attempt in range(10):
            try:
                with closing(self._conn()) as c:
                    c.executescript(_SCHEMA)
                break
            except sqlite3.OperationalError:
                if attempt == 9:
                    raise
                time.sleep(0.3)

    def _conn(self) -> sqlite3.Connection:
        # isolation_level=None → autocommit; transactions are managed explicitly
        # (see submit()). Single-statement methods are atomic as-is.
        c = sqlite3.connect(self.db_path, timeout=10, isolation_level=None)
        c.execute("PRAGMA busy_timeout=10000")
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        return c

    def submit(self, video_id: str) -> JobView:
        ph = ",".join("?" * len(ACTIVE_STAGES))
        with closing(self._conn()) as c:
            # Dedup SELECT + INSERT must be one write transaction, otherwise two
            # concurrent submits of the same video both miss the SELECT and insert.
            c.execute("BEGIN IMMEDIATE")
            try:
                row = c.execute(
                    f"SELECT * FROM jobs WHERE video_id=? AND stage IN ({ph}) ORDER BY id DESC LIMIT 1",
                    (video_id, *ACTIVE_STAGES)).fetchone()
                if row is None:
                    cur = c.execute("INSERT INTO jobs (video_id, created_at) VALUES (?, ?)",
                                    (video_id, time.time()))
                    row = c.execute("SELECT * FROM jobs WHERE id=?", (cur.lastrowid,)).fetchone()
                result = _view(row)
                c.execute("COMMIT")
                return result
            except BaseException:
                c.execute("ROLLBACK")
                raise

    def get(self, job_id: str) -> Optional[JobView]:
        pk = _pk(job_id)
        if pk is None:
            return None
        with closing(self._conn()) as c:
            row = c.execute("SELECT * FROM jobs WHERE id=?", (pk,)).fetchone()
        return _view(row) if row else None

    def set(self, job_id: str, stage: str | None = None,
            progress: float | None = None, error: str | None = None) -> None:
        pk = _pk(job_id)
        if pk is None:
            return
        cols, vals = [], []
        if stage is not None:
            cols.append("stage=?"); vals.append(stage)
        if progress is not None:
            cols.append("progress=?"); vals.append(progress)
        if error is not None:
            cols.append("error=?"); vals.append(error)
        if not cols:
            return
        with closing(self._conn()) as c:
            c.execute(f"UPDATE jobs SET {', '.join(cols)} WHERE id=?", (*vals, pk))

    def claim(self, timeout: int = 5) -> Optional[str]:
        """Atomically take the oldest queued job. timeout=0 is a single non-blocking try."""
        deadline = time.time() + timeout
        while True:
            with closing(self._conn()) as c:
                row = c.execute(
                    "UPDATE jobs SET claimed=1 WHERE id=("
                    "  SELECT id FROM jobs WHERE stage='queued' AND claimed=0 ORDER BY id LIMIT 1"
                    ") RETURNING id").fetchone()
            if row:
                return f"j-{row['id']}"
            if time.time() >= deadline:
                return None
            time.sleep(0.25)

    def finish(self, job_id: str) -> None:
        pk = _pk(job_id)
        if pk is None:
            return
        with closing(self._conn()) as c:
            c.execute("UPDATE jobs SET claimed=0 WHERE id=?", (pk,))

    def mark_orphans(self, reason: str) -> None:
        """Worker startup: anything still claimed+active died with the previous worker."""
        ph = ",".join("?" * len(ACTIVE_STAGES))
        with closing(self._conn()) as c:
            c.execute(
                f"UPDATE jobs SET stage='error', error=?, claimed=0 "
                f"WHERE claimed=1 AND stage IN ({ph})",
                (reason, *ACTIVE_STAGES))
