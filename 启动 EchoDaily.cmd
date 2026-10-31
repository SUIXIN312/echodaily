@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PY=C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
if not exist "%PY%" set "PY=python"

start "EchoDaily Server" /min "%PY%" serve.py --no-browser
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8765/"
exit /b 0
