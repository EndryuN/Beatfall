from beatfall_pipeline.instruments import _categorize

def test_violin_scores_map_to_strings():
    assert _categorize({"Violin, fiddle": 0.4, "Guitar": 0.15, "Speech": 0.6}) == "strings"

def test_guitar_wins_when_dominant():
    assert _categorize({"Electric guitar": 0.35, "Violin, fiddle": 0.05}) == "guitar"

def test_piano_and_synth():
    assert _categorize({"Piano": 0.3}) == "piano"
    assert _categorize({"Synthesizer": 0.3, "Piano": 0.1}) == "synth"

def test_no_instrument_below_threshold():
    assert _categorize({"Violin, fiddle": 0.05, "Speech": 0.9}) is None
    assert _categorize({}) is None
