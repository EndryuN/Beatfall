"""Environment-driven configuration. Defaults preserve today's local-dev behavior."""
import os
from pathlib import Path

STORE_ROOT = Path(os.environ.get("STORE_ROOT") or Path(__file__).resolve().parents[3] / "data")
QUEUE_DB = Path(os.environ.get("QUEUE_DB") or STORE_ROOT / "jobs.db")
REDIS_URL = os.environ.get("REDIS_URL", "")        # empty = in-process queue (dev/tests)
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
API_KEY = os.environ.get("API_KEY", "")            # empty = auth disabled
MAX_VIDEO_DURATION_S = int(os.environ.get("MAX_VIDEO_DURATION_S", "720"))
