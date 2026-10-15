#!/usr/bin/env bash
# 块来修仙 —— 云服务器一键部署（Ubuntu / Debian）
#
# 用法（在仓库根目录跑）：
#     sudo bash deploy/install.sh
#
# ★ 它会做什么：
#     1. 装 python3（这游戏零第三方依赖 ✗ 不用 pip 装任何东西 ✓）
#     2. 把 server/ 和 web/ 复制到 /opt/xiuxian2d
#     3. 建一个专门跑游戏的系统用户 xiuxian（不用 root 跑 ✗）
#     4. 装 systemd 服务 → 开机自启 + 崩了自动重启
#     5. 放行防火墙的两个端口（8899 网页 + 8900 游戏通道 ✗ 两个都要 ✓）
set -e

HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST=/opt/xiuxian2d
SVC=xiuxian

echo "==> 1/5 检查 python3"
if ! command -v python3 >/dev/null 2>&1; then
  echo "    没装 python3，正在装"
  apt-get update -qq && apt-get install -y -qq python3
fi
python3 -V

echo "==> 2/5 复制文件到 $DEST"
mkdir -p "$DEST"
cp -r "$HERE/server" "$HERE/web" "$DEST/"
# ★ 存档不能覆盖 ✗ 如果目标已经有 game.db 就留着 ✓
if [ -f "$HERE/server/game.db" ] && [ ! -f "$DEST/server/game.db" ]; then
  cp "$HERE/server/game.db" "$DEST/server/game.db"
  echo "    带上了本地存档（$DEST/server/game.db）"
fi

echo "==> 3/5 建用户 $SVC（不用 root 跑游戏）"
id -u "$SVC" >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d "$DEST" "$SVC"
chown -R "$SVC:$SVC" "$DEST"

echo "==> 4/5 装 systemd 服务"
cp "$HERE/deploy/xiuxian.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable "$SVC"
systemctl restart "$SVC"
sleep 2
systemctl --no-pager --lines=5 status "$SVC" || true

echo "==> 5/5 放行端口 8899 + 8900"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 8899/tcp || true
  ufw allow 8900/tcp || true
  echo "    ufw 已放行"
else
  echo "    （没开 ufw ✗ 如果你用 iptables/firewalld 请自己放行 8899 和 8900）"
fi

IP=$(hostname -I | awk '{print $1}')
cat <<TIP

============================================================
装好了 ✓

  本机测试：   curl http://127.0.0.1:8899/api/health
  手机/外网：  http://${IP}:8899/
  管理页：     http://${IP}:8899/admin.html   （密码见 server/config.json）

★ 两件事必须做，不然外面连不上：
  1. 云服务商的【安全组】里放行 8899 和 8900（两个都要 ✗ 这是最常见的坑 ✓）
     —— 光在系统里放行没用 ✗ 云控制台那层也要开 ✓
  2. server/config.json 里的 admin_password 改成一个强密码 ✓

  看日志： journalctl -u ${SVC} -f
  改配置后重启： sudo systemctl restart ${SVC}
============================================================
TIP
