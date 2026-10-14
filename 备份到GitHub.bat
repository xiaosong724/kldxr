@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   备份到 GitHub（xiaosong724/-）
echo ============================================
git add -A
git commit -m "备份 %date% %time%"
if errorlevel 1 echo （没有新改动，直接推送）
git push
echo.
echo 当前状态：
git log --oneline -3
git status --short
echo.
pause