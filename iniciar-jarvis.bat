@echo off
chcp 65001 >nul
title Jarvis Pessoal
cd /d "%~dp0"
echo.
echo   ==== JARVIS PESSOAL ====
echo.

where uv >nul 2>nul || (
  echo [1/5] Instalando o uv (gerenciador do Python)...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
  set "PATH=%USERPROFILE%\.local\bin;%PATH%"
)

where node >nul 2>nul || (
  echo Falta o Node.js 22+. Instalando pelo winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  echo Feche esta janela e abra o iniciar-jarvis.bat de novo.
  pause & exit /b
)

where ollama >nul 2>nul || (
  echo [2/5] Instalando o Ollama (a IA local, gratis)...
  winget install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements
  set "PATH=%LOCALAPPDATA%\Programs\Ollama;%PATH%"
)

where espeak-ng >nul 2>nul || (
  echo [opcional] Instalando o eSpeak NG para a voz brasileira local...
  winget install -e --id eSpeak-NG.eSpeak-NG --accept-package-agreements --accept-source-agreements >nul 2>nul
)

echo [3/5] Preparando o Jarvis (a primeira vez demora alguns minutos)...
call uv sync --extra server --extra desktop --extra voice --extra inference-google || (echo Falhou ao instalar dependencias. & pause & exit /b)

if not exist "%USERPROFILE%\.openjarvis\config.toml" (
  echo [4/5] Configurando em portugues, 100%% local e gratis...
  call uv run jarvis init --preset jarvis-pt --force
)

echo [5/5] Baixando o modelo de IA (so na primeira vez)...
ollama list | findstr /i "qwen3.5:4b" >nul || ollama pull qwen3.5:4b

echo.
echo   Abrindo a tela de comando... (deixe esta janela aberta)
echo.
call uv run jarvis gui
pause
