@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PY=C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
if not exist "%PY%" set "PY=python"

start "EchoDaily LAN Server" /min "%PY%" serve.py --host 0.0.0.0 --port 8766 --no-browser
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8766/"

echo.
echo EchoDaily 手机版已启动。
echo.
echo 手机和电脑连同一个 WiFi，手机浏览器打开：
echo   http://172.18.201.215:8766/
echo.
echo 如果这个 IP 打不开，在电脑上运行 ipconfig，看 WLAN 的 IPv4 地址，
echo 把上面的 172.18.201.215 换成那个地址即可。
echo.
echo 如果手机一直转圈，通常是 Windows 防火墙拦截了 8766 端口；
echo 弹出的防火墙提示里允许 Python 访问“专用网络”即可。
echo.
pause
