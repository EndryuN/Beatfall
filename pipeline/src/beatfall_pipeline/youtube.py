import re
import tempfile
from pathlib import Path
import yt_dlp
from .models import SongMeta

MAX_DURATION_S = 12 * 60
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

def extract_video_id(query: str) -> str | None:
    if _ID_RE.match(query):
        return query
    m = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})", query)
    return m.group(1) if m else None

def _meta(info: dict) -> SongMeta:
    return SongMeta(videoId=info["id"], title=info.get("title", ""),
                    channel=info.get("channel") or info.get("uploader", ""),
                    duration=float(info.get("duration") or 0),
                    thumbnail=info.get("thumbnail", ""))

def search(query: str, limit: int = 5) -> list[SongMeta]:
    vid = extract_video_id(query)
    target = vid if vid else f"ytsearch{limit}:{query}"
    with yt_dlp.YoutubeDL({"quiet": True, "extract_flat": False, "skip_download": True}) as ydl:
        info = ydl.extract_info(target, download=False)
    entries = info.get("entries", [info]) if info else []
    return [_meta(e) for e in entries if e]

def fetch_audio(video_id: str, progress_cb=None) -> tuple[Path, SongMeta]:
    """Download best audio to a temp dir as wav. Caller MUST delete the file's parent dir."""
    tmp = Path(tempfile.mkdtemp(prefix="beatfall-"))
    def hook(d):
        if progress_cb and d.get("status") == "downloading" and d.get("total_bytes"):
            progress_cb(d["downloaded_bytes"] / d["total_bytes"])
    opts = {
        "quiet": True, "format": "bestaudio/best",
        "outtmpl": str(tmp / "%(id)s.%(ext)s"),
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
        "progress_hooks": [hook],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
    meta = _meta(info)
    if meta.duration > MAX_DURATION_S:
        raise ValueError(f"Video too long ({meta.duration:.0f}s > {MAX_DURATION_S}s)")
    return tmp / f"{video_id}.wav", meta
