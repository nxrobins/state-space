@echo off
echo Starting State Space...
start /B python -m http.server 8095 --directory "%~dp0web" --bind 127.0.0.1
timeout /t 2 /nobreak >nul
start chrome --disable-extensions http://localhost:8095
echo Server running on http://localhost:8095
echo Press Ctrl+C to stop server
pause
