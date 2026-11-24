"""Tests for the allow-listed PC control tools (jarvis-pt preset)."""

from __future__ import annotations

import json

import pytest

from openjarvis.tools import pc_control
from openjarvis.tools.pc_control import MediaControlTool, OpenAppTool, OpenUrlTool


def test_open_app_rejects_unknown_name():
    result = OpenAppTool().execute(name="rm -rf /")
    assert not result.success
    assert "não está na lista" in result.content


def test_open_app_launches_allow_listed_target(monkeypatch):
    launched = []
    monkeypatch.setattr(pc_control, "_launch", launched.append)
    result = OpenAppTool().execute(name="Calculadora")
    assert result.success
    assert launched == ["calc"]


def test_user_apps_file_extends_allow_list(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENJARVIS_HOME", str(tmp_path))
    (tmp_path / "apps.json").write_text(json.dumps({"Steam": "steam:"}), encoding="utf-8")
    launched = []
    monkeypatch.setattr(pc_control, "_launch", launched.append)
    assert OpenAppTool().execute(name="steam").success
    assert launched == ["steam:"]


@pytest.mark.parametrize("url", ["file:///etc/passwd", "javascript:alert(1)", ""])
def test_open_url_only_allows_http(url):
    assert not OpenUrlTool().execute(url=url).success


def test_open_url_builds_youtube_search(monkeypatch):
    opened = []
    monkeypatch.setattr(pc_control.webbrowser, "open", opened.append)
    assert OpenUrlTool().execute(youtube="legião urbana").success
    assert opened == ["https://www.youtube.com/results?search_query=legi%C3%A3o+urbana"]


def test_media_control_rejects_unknown_action():
    assert not MediaControlTool().execute(action="format_disk").success
