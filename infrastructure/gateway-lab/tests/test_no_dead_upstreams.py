import importlib


def test_default_upstreams_never_point_to_a_shut_down_cloud_run_project(monkeypatch):
    for key in ("SMILE_API_UPSTREAM", "UPSTREAM_DEMODENTAL"):
        monkeypatch.delenv(key, raising=False)
    from gateway import config, targets
    importlib.reload(config)
    importlib.reload(targets)
    hosts = targets.configured_upstreams()
    assert not any(host.endswith(".run.app") for host in hosts)
    assert config.SMILE_API_UPSTREAM == ""
