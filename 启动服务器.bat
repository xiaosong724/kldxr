@echo off
chcp 65001 >nul
title 末日丧尸修仙 - 后端
setlocal
pushd "%~dp0server" 2>nul
if errorlevel 1 (
  echo [错误] 进不去 server 目录: %~dp0server
  pause & exit /b 1
)
echo ============================================
echo   末日丧尸 x 组队修仙  后端
echo   关掉这个窗口 = 停服
echo   本机自检: http://127.0.0.1:8899/api/health
echo ============================================
set PY=C:\Users\49553\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe
if exist "%PY%" (
  "%PY%" app.py
) else (
  where python >nul 2>nul && (python app.py) || (py -3 app.py)
)
echo.
echo 服务已停止。
popd
pause
