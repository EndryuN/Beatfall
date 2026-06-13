import importlib
import pytest


@pytest.fixture(autouse=True)
def reset_config_after_test():
    """Reload config after each test to ensure clean state with defaults."""
    yield
    # After test completes and env vars are cleaned up, reload config to restore defaults
    from beatfall_pipeline import config
    importlib.reload(config)


def test_defaults(monkeypatch):
    for var in ("STORE_ROOT", "QUEUE_DB", "CORS_ORIGINS", "API_KEY", "MAX_VIDEO_DURATION_S"):
        monkeypatch.delenv(var, raising=False)
    from beatfall_pipeline import config
    importlib.reload(config)
    assert config.STORE_ROOT.name == "data"
    assert config.QUEUE_DB.name == "jobs.db"
    assert config.CORS_ORIGINS == ["http://localhost:5173"]
    assert config.API_KEY == ""
    assert config.MAX_VIDEO_DURATION_S == 720


def test_env_overrides(monkeypatch):
    monkeypatch.setenv("STORE_ROOT", "/data")
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173, https://musiclabs.uk")
    monkeypatch.setenv("API_KEY", "sekrit")
    monkeypatch.setenv("MAX_VIDEO_DURATION_S", "900")
    from beatfall_pipeline import config
    importlib.reload(config)
    assert str(config.STORE_ROOT) in ("/data", "\\data")
    assert config.CORS_ORIGINS == ["http://localhost:5173", "https://musiclabs.uk"]
    assert config.API_KEY == "sekrit"
    assert config.MAX_VIDEO_DURATION_S == 900
