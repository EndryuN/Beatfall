@echo off
cd /d "%~dp0"
if exist service-config.bat call service-config.bat
:: ffmpeg (winget install) is not on PATH in fresh shells
set "PATH=C:\Users\Endryu\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin;%PATH%"
start "mlib-api" /min cmd /c "cd pipeline && python -m uvicorn beatfall_pipeline.main:app --host 127.0.0.1 --port 8000"
start "mlib-worker" /min cmd /c "cd pipeline && python -m beatfall_pipeline.worker_main"
echo mlib starting:  http://localhost:8000/api/songs
echo (two minimized windows: mlib-api, mlib-worker)
