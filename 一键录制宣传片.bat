@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ============================================================
echo   块来修仙 · 实机宣传片录制（v2）
echo ============================================================
echo.

REM ---------- 1. 找 Python ----------
set PY=python
where python >nul 2>&1
if errorlevel 1 (
    if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
        set PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    ) else (
        echo [错误] 找不到 Python，请确认安装并加入 PATH
        pause & exit /b 1
    )
)

REM ---------- 2. 找 ffmpeg ----------
set FF=.videotools\ffmpeg-9.0.2-essentials_build\bin\ffmpeg.exe
if not exist "%FF%" (
    echo [错误] 找不到 %FF%
    pause & exit /b 1
)

REM ---------- 3. 找 Chrome ----------
set CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
if not exist "%CHROME%" (
    echo [错误] 找不到 Chrome 或 Edge
    pause & exit /b 1
)
echo 浏览器: %CHROME%

REM ---------- 4. 启动游戏服务器 ----------
echo [1/6] 启动游戏服务器...
start "游戏服务器" /min %PY% server\app.py
REM 等服务器真的起来（最多 15 秒）
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 15;$i++){ try{ $r=Invoke-WebRequest -Uri 'http://127.0.0.1:8899/api/health' -UseBasicParsing -TimeoutSec 1; if($r.StatusCode -eq 200){$ok=$true;break} }catch{}; Start-Sleep 1 }; if(-not $ok){ exit 1 }"
if errorlevel 1 (
    echo [错误] 服务器没起来，请手动双击 启动服务器.bat 看看控制台报什么错
    pause & exit /b 1
)
echo      服务器已就绪 ✓

REM ---------- 5. 注册录制账号（幂等，重复跑没事） ----------
echo [2/6] 注册录制账号 bot01...
powershell -NoProfile -Command "try{ Invoke-RestMethod -Uri 'http://127.0.0.1:8899/api/register' -Method Post -ContentType 'application/json' -Body '{\"name\":\"bot01\",\"pw\":\"bot12345\"}' | Out-Null }catch{}"
echo      账号就绪 ✓

REM ---------- 6. 打开浏览器（带自动登录参数） ----------
echo [3/6] 打开游戏页面（自动登录 bot01）...
start "" "%CHROME%" --new-window --start-maximized --autoplay-policy=no-user-gesture-required "http://127.0.0.1:8899/?rec=1"
timeout /t 8 /nobreak >nul

echo.
echo ┌────────────────────────────────────────────────────┐
echo │ 即将开始录制 45 秒，录制期间请不要动鼠标、不要切窗口 │
echo └────────────────────────────────────────────────────┘
timeout /t 3

REM ---------- 7. 录制 + 自动操作 ----------
echo [4/6] 录制中（45 秒）...
start "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0auto_play.ps1"
"%FF%" -y -f gdigrab -framerate 30 -t 45 -i desktop -c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p raw_recording.mp4 -loglevel error
if errorlevel 1 (
    echo [错误] 录制失败，ffmpeg 报错
    pause & exit /b 1
)

REM ---------- 8. 收尾 ----------
echo [5/6] 关闭浏览器和服务器...
taskkill /f /im chrome.exe >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8899" ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>&1

echo [6/6] 完成！
echo      素材文件: %CD%\raw_recording.mp4
echo      录好了就告诉 AI 助手「录好了」即可
pause
