@echo off
chcp 65001 >nul
title 停止后端
echo 正在查找占用 8899 / 8900 端口的进程...
powershell -NoProfile -Command ^
  "$ps = @(); foreach ($p in 8899,8900) { $ps += (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue).OwningProcess }; $ps = $ps | Sort-Object -Unique; if (-not $ps) { Write-Host '  没有在跑的后端'; exit 0 }; foreach ($id in $ps) { $pr = Get-Process -Id $id -ErrorAction SilentlyContinue; Write-Host ('  停止 PID ' + $id + '  ' + $pr.ProcessName); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }; Write-Host '  已停止'"
echo.
pause
