# pipeline/tests/test_models.py
import json
from pathlib import Path
import jsonschema
from beatfall_pipeline.models import AnalysisDoc, Beatmap

ROOT = Path(__file__).resolve().parents[2]  # repo root
CONTRACTS = ROOT / "contracts"

def test_analysis_roundtrip_fixture():
    raw = json.loads((CONTRACTS / "fixtures/fixture.analysis.json").read_text())
    doc = AnalysisDoc.model_validate(raw)
    out = doc.model_dump(exclude_none=True)
    schema = json.loads((CONTRACTS / "analysis.schema.json").read_text())
    jsonschema.validate(out, schema)
    assert out["songId"] == "yt:dQw4w9WgXcQ"

def test_beatmap_roundtrip_fixture():
    raw = json.loads((CONTRACTS / "fixtures/fixture.beatmap.hard.json").read_text())
    bm = Beatmap.model_validate(raw)
    schema = json.loads((CONTRACTS / "beatmap.schema.json").read_text())
    jsonschema.validate(bm.model_dump(exclude_none=True), schema)
