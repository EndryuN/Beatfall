from typing import Literal, Optional
from pydantic import BaseModel, Field

Stem = Literal["drums", "bass", "vocals", "other"]
Difficulty = Literal["easy", "medium", "hard"]

class Event(BaseModel):
    t: float
    stem: Stem
    kind: Literal["onset", "sustain"]
    strength: float = Field(ge=0, le=1)
    dur: Optional[float] = None
    pitch: Optional[float] = None
    pitchConf: Optional[float] = None

class EnergyCurves(BaseModel):
    sampleRateHz: float
    stems: dict[str, list[float]]

class AnalysisDoc(BaseModel):
    songId: str
    analysisVersion: int
    title: str
    channel: str = ""
    duration: float
    thumbnail: str = ""
    bpm: float
    beatGrid: list[float]
    roster: list[Literal["drummer", "bassist", "singer", "guitarist"]]
    events: list[Event]
    energyCurves: EnergyCurves

class Note(BaseModel):
    t: float
    lane: int = Field(ge=0, le=3)
    type: Literal["tap", "hold"]
    dur: Optional[float] = None

class Beatmap(BaseModel):
    beatmapId: str
    songId: str
    generatorVersion: int
    difficulty: Difficulty
    mode: Literal["standard"] = "standard"
    laneCount: Literal[4] = 4
    notes: list[Note]

class SongMeta(BaseModel):
    videoId: str
    title: str
    channel: str = ""
    duration: float
    thumbnail: str = ""
