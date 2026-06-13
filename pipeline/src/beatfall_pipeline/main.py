import logging
import secrets
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from . import ANALYSIS_VERSION, GENERATOR_VERSION, config
from .jobs import JobQueue, PipelineSteps
from .store import BeatmapStore

log = logging.getLogger("mlib")

class AddSongBody(BaseModel):
    videoId: str
    force: bool = False   # true = remap even if current-version maps exist

class CustomMapBody(BaseModel):
    notes: list[dict]

def create_app(store: BeatmapStore | None = None, steps: PipelineSteps | None = None,
               queue=None) -> FastAPI:
    if store is None:
        store = BeatmapStore(config.STORE_ROOT)
    if queue is None:
        if steps is not None:                      # tests: in-process thread queue
            q = JobQueue(store, steps)
            q.start()
            queue = q
        else:                                      # service mode: shared sqlite queue
            from .queue_sqlite import SqliteJobQueue
            queue = SqliteJobQueue(config.QUEUE_DB)

    app = FastAPI(title="mlib")

    @app.middleware("http")
    async def require_api_key(request, call_next):
        if config.API_KEY and request.method in ("POST", "PUT", "DELETE") \
                and not secrets.compare_digest(request.headers.get("x-api-key") or "", config.API_KEY):
            return JSONResponse(status_code=401,
                                content={"detail": "invalid or missing API key"})
        return await call_next(request)

    app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS,
                       allow_methods=["*"], allow_headers=["*"])

    @app.get("/api/search")
    def api_search(q: str):
        from .youtube import search
        return {"candidates": [m.model_dump() for m in search(q)]}

    @app.post("/api/songs")
    def add_song(body: AddSongBody):
        song_id = f"yt:{body.videoId}"
        if not body.force and store.get_analysis(song_id, ANALYSIS_VERSION) and \
           store.get_beatmap(song_id, "hard", GENERATOR_VERSION):
            return {"songId": song_id, "status": "ready"}
        try:
            job = queue.submit(body.videoId)
        except Exception:
            log.exception("enqueue failed")
            raise HTTPException(503, "job queue unavailable")
        return JSONResponse(status_code=202,
                            content={"songId": song_id, "jobId": job.id, "status": "queued"})

    @app.delete("/api/songs/{song_id}", status_code=204)
    def delete_song(song_id: str):
        if not store.delete(song_id):
            raise HTTPException(404)

    @app.put("/api/songs/{song_id}/custom/{name}")
    def save_custom_map(song_id: str, name: str, body: CustomMapBody):
        try:
            bm = store.save_custom(song_id, name, body.notes)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return bm.model_dump(exclude_none=True)

    @app.delete("/api/songs/{song_id}/custom/{name}", status_code=204)
    def delete_custom_map(song_id: str, name: str):
        try:
            if not store.delete_custom(song_id, name):
                raise HTTPException(404)
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str):
        job = queue.get(job_id)
        if not job:
            raise HTTPException(404)
        return {"jobId": job.id, "songId": f"yt:{job.video_id}", "stage": job.stage,
                "progress": job.progress, "error": job.error}

    @app.get("/api/songs")
    def list_songs():
        entries = store.list_songs()
        for e in entries:
            # maps from an older generator are stale — surface it so the UI offers a remap
            if e["status"] == "ready" and not store.get_beatmap(e["songId"], "hard", GENERATOR_VERSION):
                e["status"] = "outdated"
        return entries

    @app.get("/api/songs/{song_id}/analysis")
    def get_analysis(song_id: str):
        doc = store.get_analysis(song_id, ANALYSIS_VERSION)
        if not doc:
            raise HTTPException(404)
        return doc.model_dump(exclude_none=True)

    @app.get("/api/songs/{song_id}/beatmaps/{difficulty}")
    def get_beatmap(song_id: str, difficulty: str):
        bm = store.get_beatmap(song_id, difficulty, GENERATOR_VERSION)
        if not bm:
            raise HTTPException(404)
        return bm.model_dump(exclude_none=True)

    return app

app = create_app()
