# auto_play.ps1 - 模拟玩家键盘操作（45 秒）
# 只用键盘：WASD 移动 + 空格跳 + J 攻击（如果游戏没有 J 键绑定，改成鼠标点击也安全）

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class K {
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtra);
}
"@

function Tap($vk, $ms) {
    [K]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)      # KEYDOWN
    Start-Sleep -Milliseconds $ms
    [K]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)      # KEYUP
}

$W=0x57; $A=0x41; $S=0x53; $D=0x44; $SPC=0x20; $J=0x4A

# 等游戏加载 + 登录完成
Start-Sleep -Seconds 10

$end = (Get-Date).AddSeconds(42)
$rnd = New-Object System.Random

while ((Get-Date) -lt $end) {
    # 随机方向走 0.5~1.1 秒
    $dir = @($W,$A,$S,$D)[$rnd.Next(4)]
    Tap $dir (500 + $rnd.Next(600))
    # 30% 概率跳
    if ($rnd.Next(10) -lt 3) { Tap $SPC 120 }
    # 攻击：按 J 键（挥剑/挖矿）
    Tap $J 120
    Start-Sleep -Milliseconds 250
    Tap $J 120
    Start-Sleep -Milliseconds 350
}
