"""PC control tools: open apps and sites, media keys, lock screen.

Added for the Portuguese "Jarvis pessoal" preset. Every action is a fixed,
allow-listed operation; nothing here runs free-form shell text from the model.
Windows is the primary target, with best-effort macOS/Linux fallbacks.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import webbrowser
from pathlib import Path
from typing import Any, Dict
from urllib.parse import quote_plus

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec

_IS_WIN = sys.platform == "win32"
_IS_MAC = sys.platform == "darwin"

# Friendly name -> launch target (exe on PATH, or a URI scheme).
_DEFAULT_APPS: Dict[str, str] = {
    "bloco de notas": "notepad",
    "notepad": "notepad",
    "calculadora": "calc",
    "calculator": "calc",
    "explorador de arquivos": "explorer",
    "explorer": "explorer",
    "arquivos": "explorer",
    "paint": "mspaint",
    "terminal": "wt",
    "prompt de comando": "cmd",
    "configuracoes": "ms-settings:",
    "configurações": "ms-settings:",
    "settings": "ms-settings:",
    "spotify": "spotify:",
    "whatsapp": "whatsapp:",
    "edge": "microsoft-edge:",
    "chrome": "chrome",
    "vs code": "code",
    "vscode": "code",
    "word": "winword",
    "excel": "excel",
    "powerpoint": "powerpnt",
    "outlook": "outlook",
    "gerenciador de tarefas": "taskmgr",
    "task manager": "taskmgr",
    "camera": "microsoft.windows.camera:",
    "câmera": "microsoft.windows.camera:",
    "relogio": "ms-clock:",
    "relógio": "ms-clock:",
}

# Windows virtual-key codes sent through WScript.Shell.SendKeys.
_MEDIA_KEYS = {
    "volume_up": 175,
    "volume_down": 174,
    "mute": 173,
    "play_pause": 179,
    "next": 176,
    "previous": 177,
}


def _user_apps_file() -> Path:
    return Path(os.environ.get("OPENJARVIS_HOME", Path.home() / ".openjarvis")) / "apps.json"


def load_apps() -> Dict[str, str]:
    """Built-in apps merged with the user's ``~/.openjarvis/apps.json``."""
    apps = dict(_DEFAULT_APPS)
    path = _user_apps_file()
    if path.is_file():
        try:
            extra = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(extra, dict):
                apps.update({str(k).lower().strip(): str(v) for k, v in extra.items()})
        except (OSError, ValueError):
            pass
    return apps


def _launch(target: str) -> None:
    """Open ``target`` (an allow-listed exe name, path or URI) detached."""
    if _IS_WIN:
        # os.startfile resolves App Paths (winword, chrome...) and URI schemes
        # without going through a shell, so nothing in ``target`` is parsed.
        os.startfile(target)  # type: ignore[attr-defined]  # noqa: S606
    elif _IS_MAC:
        subprocess.Popen(["open", target])  # noqa: S603, S607
    else:
        subprocess.Popen(["xdg-open", target])  # noqa: S603, S607


@ToolRegistry.register("open_app")
class OpenAppTool(BaseTool):
    """Open a desktop program by friendly name from an allow-list."""

    tool_id = "open_app"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="open_app",
            description=(
                "Abre um programa do computador pelo nome (ex: 'spotify', "
                "'calculadora', 'vs code'). Só abre programas da lista "
                "conhecida; se o nome não existir, retorna a lista."
            ),
            parameters={
                "type": "object",
                "properties": {"name": {"type": "string", "description": "Nome do programa"}},
                "required": ["name"],
            },
            category="system",
        )

    def execute(self, **params: Any) -> ToolResult:
        name = str(params.get("name", "")).lower().strip()
        apps = load_apps()
        target = apps.get(name)
        if not target:
            return ToolResult(
                tool_name="open_app",
                content=(
                    f"Programa '{name}' não está na lista. Disponíveis: "
                    f"{', '.join(sorted(apps))}. Cadastre outros em {_user_apps_file()}."
                ),
                success=False,
            )
        try:
            _launch(target)
        except OSError as exc:
            return ToolResult(tool_name="open_app", content=f"Falhou: {exc}", success=False)
        return ToolResult(tool_name="open_app", content=f"Abri {name}.")


@ToolRegistry.register("open_url")
class OpenUrlTool(BaseTool):
    """Open a web page, or a YouTube search, in the default browser."""

    tool_id = "open_url"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="open_url",
            description=(
                "Abre um site no navegador do usuário. Passe 'url' (https://...) "
                "ou 'youtube' com o que tocar/procurar no YouTube."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Endereço completo https://"},
                    "youtube": {"type": "string", "description": "Busca para tocar no YouTube"},
                },
            },
            category="system",
        )

    def execute(self, **params: Any) -> ToolResult:
        url = str(params.get("url") or "").strip()
        yt = str(params.get("youtube") or "").strip()
        if yt:
            url = f"https://www.youtube.com/results?search_query={quote_plus(yt)}"
        if not url.lower().startswith(("http://", "https://")):
            return ToolResult(tool_name="open_url", content="Só abro links http/https.", success=False)
        webbrowser.open(url)
        return ToolResult(tool_name="open_url", content=f"Abri {url}")


@ToolRegistry.register("media_control")
class MediaControlTool(BaseTool):
    """Volume and playback keys (Windows)."""

    tool_id = "media_control"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="media_control",
            description="Controla volume e reprodução de mídia do computador.",
            parameters={
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": sorted(_MEDIA_KEYS)},
                    "steps": {
                        "type": "integer",
                        "description": "Passos de volume (cada um ~2%). Padrão 5.",
                    },
                },
                "required": ["action"],
            },
            category="system",
        )

    def execute(self, **params: Any) -> ToolResult:
        action = str(params.get("action", ""))
        if action not in _MEDIA_KEYS:
            return ToolResult(tool_name="media_control", content="Ação inválida.", success=False)
        if not _IS_WIN:
            return ToolResult(
                tool_name="media_control",
                content="Controle de mídia só está disponível no Windows.",
                success=False,
            )
        times = 1
        if action.startswith("volume_"):
            try:
                times = max(1, min(50, int(params.get("steps") or 5)))
            except (TypeError, ValueError):
                times = 5
        code = _MEDIA_KEYS[action]
        script = (
            "$w=New-Object -ComObject WScript.Shell; "
            f"1..{times} | % {{ $w.SendKeys([char]{code}); Start-Sleep -Milliseconds 30 }}"
        )
        subprocess.Popen(  # noqa: S603, S607
            ["powershell.exe", "-NoProfile", "-WindowStyle", "Hidden", "-Command", script],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return ToolResult(tool_name="media_control", content=f"Feito: {action}.")


@ToolRegistry.register("lock_screen")
class LockScreenTool(BaseTool):
    """Lock the workstation."""

    tool_id = "lock_screen"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="lock_screen",
            description="Bloqueia a tela do computador.",
            parameters={"type": "object", "properties": {}},
            category="system",
        )

    def execute(self, **params: Any) -> ToolResult:
        if _IS_WIN:
            import ctypes

            ctypes.windll.user32.LockWorkStation()  # type: ignore[attr-defined]
        elif _IS_MAC:
            subprocess.Popen(["pmset", "displaysleepnow"])  # noqa: S603, S607
        else:
            subprocess.Popen(["loginctl", "lock-session"])  # noqa: S603, S607
        return ToolResult(tool_name="lock_screen", content="Tela bloqueada.")





@ToolRegistry.register("weather_free")
class FreeWeatherTool(BaseTool):
    """Weather from Open-Meteo: free, no API key."""

    tool_id = "weather_free"
    is_local = False

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="weather_free",
            description="Clima atual e previsão de 4 dias para uma cidade (grátis, sem chave).",
            parameters={
                "type": "object",
                "properties": {"city": {"type": "string", "description": "Cidade, ex: Recife"}},
                "required": ["city"],
            },
            category="information",
        )

    def execute(self, **params: Any) -> ToolResult:
        import httpx

        city = str(params.get("city", "")).strip()
        try:
            geo = httpx.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": city, "count": 1, "language": "pt"},
                timeout=10,
            ).json()
            loc = (geo.get("results") or [None])[0]
            if not loc:
                return ToolResult(tool_name="weather_free", content=f"Cidade '{city}' não encontrada.", success=False)
            data = httpx.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": loc["latitude"],
                    "longitude": loc["longitude"],
                    "current": "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
                    "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
                    "forecast_days": 4,
                    "timezone": "auto",
                },
                timeout=10,
            ).json()
        except Exception as exc:  # network errors surface to the model
            return ToolResult(tool_name="weather_free", content=f"Falhou: {exc}", success=False)
        place = f"{loc.get('name')}, {loc.get('admin1', '')} {loc.get('country', '')}".strip()
        return ToolResult(
            tool_name="weather_free",
            content=json.dumps(
                {"local": place, "agora": data.get("current"), "diario": data.get("daily"), "codigos": "WMO"},
                ensure_ascii=False,
            ),
        )


__all__ = ["OpenAppTool", "OpenUrlTool", "MediaControlTool", "LockScreenTool", "FreeWeatherTool", "load_apps"]
