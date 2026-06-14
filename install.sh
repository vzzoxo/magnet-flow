#!/usr/bin/env bash
#
# MagnetFlow one-click installer for Debian / Ubuntu.
#
#   bash <(curl -sL https://raw.githubusercontent.com/vzzoxo/magnet-flow/main/install.sh)
#
# Installs system deps, Node.js, rclone, clones the repo, generates secrets,
# and sets up systemd services (aria2 / magnetflow / rclone-rcd).
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/vzzoxo/magnet-flow.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/magnet-flow}"
DOWNLOAD_DIR="${DOWNLOAD_DIR:-${INSTALL_DIR}/downloads}"
PORT="${PORT:-3000}"
ARIA2_DIR="/root/.aria2"
RCLONE_CONF_DIR="/root/.config/rclone"

c_ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
c_info() { printf '\033[36m▸\033[0m %s\n' "$1"; }
c_warn() { printf '\033[33m!\033[0m %s\n' "$1"; }
die()    { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行（sudo bash ...）"
command -v apt-get >/dev/null 2>&1 || die "此脚本目前仅支持 Debian / Ubuntu (apt)"

echo
echo "  ╔══════════════════════════════════════╗"
echo "  ║       MagnetFlow Installer            ║"
echo "  ╚══════════════════════════════════════╝"
echo "  安装目录: ${INSTALL_DIR}"
echo "  下载目录: ${DOWNLOAD_DIR}"
echo

# ── 1. System dependencies ──────────────────────────────────────────────────
c_info "安装系统依赖…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates git aria2 ffmpeg unzip p7zip-full cron python3 transmission-daemon >/dev/null
# unrar 在部分源里需要 non-free，失败不阻断
apt-get install -y -qq unrar >/dev/null 2>&1 || apt-get install -y -qq unrar-free >/dev/null 2>&1 || c_warn "unrar 未安装（.rar 解压将不可用）"
c_ok "系统依赖就绪"

# ── 2. Node.js (>=18, 否则装 20) ────────────────────────────────────────────
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "${major:-0}" -ge 18 ] && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  c_info "安装 Node.js 20.x…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
c_ok "Node.js $(node -v)"

# ── 3. rclone（网盘功能）────────────────────────────────────────────────────
if ! command -v rclone >/dev/null 2>&1; then
  c_info "安装 rclone…"
  curl -fsSL https://rclone.org/install.sh | bash >/dev/null 2>&1 || c_warn "rclone 安装失败（网盘功能将不可用）"
fi
command -v rclone >/dev/null 2>&1 && c_ok "rclone $(rclone version 2>/dev/null | head -1 | awk '{print $2}')"

# ── 4. 获取代码 ──────────────────────────────────────────────────────────────
if [ -d "${INSTALL_DIR}/.git" ]; then
  c_info "更新已存在的代码库…"
  git -C "${INSTALL_DIR}" pull --ff-only >/dev/null 2>&1 || c_warn "git pull 失败，继续使用现有代码"
else
  c_info "克隆代码到 ${INSTALL_DIR}…"
  rm -rf "${INSTALL_DIR}"
  git clone --depth 1 "${REPO_URL}" "${INSTALL_DIR}" >/dev/null 2>&1 || die "git clone 失败：${REPO_URL}"
fi
cd "${INSTALL_DIR}"
c_ok "代码就绪"

# ── 5. Node 依赖 ─────────────────────────────────────────────────────────────
c_info "安装 npm 依赖…"
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --production >/dev/null 2>&1
c_ok "依赖安装完成"

# ── 6. 目录与密钥 ────────────────────────────────────────────────────────────
mkdir -p "${DOWNLOAD_DIR}" "${ARIA2_DIR}" "${RCLONE_CONF_DIR}"
touch "${ARIA2_DIR}/aria2.session" "${RCLONE_CONF_DIR}/rclone.conf"

FRESH=0
if [ ! -f "${INSTALL_DIR}/.env" ]; then
  FRESH=1
  JWT_SECRET="$(node -e 'console.log(require("crypto").randomBytes(48).toString("hex"))')"
  ARIA2_SECRET="$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')"
  ADMIN_PASS="$(node -e 'console.log(require("crypto").randomBytes(9).toString("base64url"))')"
  cat > "${INSTALL_DIR}/.env" <<EOF
PORT=${PORT}
HOST=0.0.0.0
JWT_SECRET=${JWT_SECRET}
DOWNLOAD_DIR=${DOWNLOAD_DIR}
ARIA2_RPC_URL=http://localhost:6800/jsonrpc
ARIA2_SECRET=${ARIA2_SECRET}
RCLONE_RC_URL=http://127.0.0.1:5572
TRANSMISSION_RPC_URL=http://127.0.0.1:9091/transmission/rpc
AUTO_CLEAR_COMPLETED=true
AUTO_CLEAR_DELAY_SEC=15
AUTO_UPLOAD_REMOTE=
AUTO_UPLOAD_DEST=
NOTIFY_TELEGRAM_BOT_TOKEN=
NOTIFY_TELEGRAM_CHAT_ID=
NOTIFY_BARK_URL=
INITIAL_ADMIN_PASSWORD=${ADMIN_PASS}
EOF
  chmod 600 "${INSTALL_DIR}/.env"
  c_ok "已生成 .env（随机密钥）"
else
  # 复用已有密钥，保持 aria2.conf 同步
  ARIA2_SECRET="$(grep -E '^ARIA2_SECRET=' "${INSTALL_DIR}/.env" | cut -d= -f2-)"
  DOWNLOAD_DIR="$(grep -E '^DOWNLOAD_DIR=' "${INSTALL_DIR}/.env" | cut -d= -f2- || echo "${DOWNLOAD_DIR}")"
  c_warn ".env 已存在，沿用现有配置"
fi

# ── 7. aria2 配置 ────────────────────────────────────────────────────────────
c_info "写入 aria2 配置…"
# 从 GitHub 拉取最新 BT tracker 列表（失败则使用内置备用列表）
BT_TRACKERS="$(curl -fsSL -m 15 https://raw.githubusercontent.com/adysec/tracker/main/trackers_best.txt 2>/dev/null | grep -E '^[a-z]+://' | paste -sd, -)"
if [ -z "${BT_TRACKERS}" ]; then
  BT_TRACKERS="udp://tracker.opentrackr.org:1337/announce,udp://open.demonii.com:1337/announce,udp://open.stealth.si:80/announce,udp://tracker.torrent.eu.org:451/announce,udp://tracker.dler.org:6969/announce,udp://tracker.bittor.pw:1337/announce,udp://tracker-udp.gbitt.info:80/announce,udp://tracker.qu.ax:6969/announce"
  c_warn "tracker 列表拉取失败，使用内置备用列表"
fi
cat > "${ARIA2_DIR}/aria2.conf" <<EOF
enable-rpc=true
rpc-listen-port=6800
rpc-secret=${ARIA2_SECRET}

dir=${DOWNLOAD_DIR}
continue=true
allow-overwrite=true
file-allocation=falloc
disk-cache=64M

input-file=${ARIA2_DIR}/aria2.session
save-session=${ARIA2_DIR}/aria2.session
save-session-interval=60
force-save=true

max-concurrent-downloads=10
optimize-concurrent-downloads=false
max-connection-per-server=16
split=16
min-split-size=1M
max-overall-download-limit=0
max-download-limit=0

enable-dht=true
enable-dht6=true
enable-peer-exchange=true
bt-enable-lpd=true
listen-port=6881-6999
dht-listen-port=6881-6999
follow-torrent=true
bt-save-metadata=true
bt-load-saved-metadata=true

bt-max-peers=200
bt-max-open-files=256
bt-request-peer-speed-limit=50M
seed-time=0
seed-ratio=0.0

bt-tracker=${BT_TRACKERS}
EOF
c_ok "aria2 配置就绪"

# ── 7b. Transmission 配置(第二下载引擎) ─────────────────────────────────────
TR_CONF_DIR="/root/.config/transmission-daemon"
systemctl stop transmission-daemon 2>/dev/null || true
systemctl disable transmission-daemon >/dev/null 2>&1 || true
mkdir -p "${TR_CONF_DIR}"
cat > "${TR_CONF_DIR}/settings.json" <<EOF
{
  "rpc-enabled": true,
  "rpc-bind-address": "127.0.0.1",
  "rpc-port": 9091,
  "rpc-url": "/transmission/",
  "rpc-whitelist-enabled": true,
  "rpc-whitelist": "127.0.0.1",
  "rpc-authentication-required": false,
  "download-dir": "${DOWNLOAD_DIR}",
  "incomplete-dir-enabled": false,
  "ratio-limit": 0,
  "ratio-limit-enabled": true,
  "peer-port": 51413,
  "peer-port-random-on-start": false,
  "dht-enabled": true,
  "pex-enabled": true,
  "lpd-enabled": true,
  "encryption": 1
}
EOF
c_ok "Transmission 配置就绪"

# ── 8. systemd 服务 ──────────────────────────────────────────────────────────
c_info "配置 systemd 服务…"
NODE_BIN="$(command -v node)"
ARIA2_BIN="$(command -v aria2c)"

cat > /etc/systemd/system/aria2.service <<EOF
[Unit]
Description=aria2 Download Manager
After=network.target

[Service]
Type=simple
ExecStart=${ARIA2_BIN} --conf-path=${ARIA2_DIR}/aria2.conf
Restart=always
RestartSec=3
User=root
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/magnetflow.service <<EOF
[Unit]
Description=MagnetFlow Server
After=network.target aria2.service

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_BIN} server.js
Restart=always
RestartSec=3
User=root
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

if command -v rclone >/dev/null 2>&1; then
  RCLONE_BIN="$(command -v rclone)"
  cat > /etc/systemd/system/rclone-rcd.service <<EOF
[Unit]
Description=rclone remote control daemon (MagnetFlow)
After=network.target

[Service]
Type=simple
ExecStart=${RCLONE_BIN} rcd --rc-addr 127.0.0.1:5572 --rc-no-auth --rc-serve --rc-job-expire-duration=24h --config ${RCLONE_CONF_DIR}/rclone.conf
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF
fi

# Transmission (second download engine) — run as root so it can write DOWNLOAD_DIR
TR_BIN="$(command -v transmission-daemon || echo /usr/bin/transmission-daemon)"
cat > /etc/systemd/system/transmission.service <<EOF
[Unit]
Description=Transmission BitTorrent Daemon (MagnetFlow)
After=network.target

[Service]
Type=simple
ExecStart=${TR_BIN} -f --config-dir /root/.config/transmission-daemon
Restart=always
RestartSec=3
User=root
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable aria2 magnetflow transmission >/dev/null 2>&1 || true
systemctl restart aria2
systemctl restart transmission 2>/dev/null || true
[ -f /etc/systemd/system/rclone-rcd.service ] && { systemctl enable rclone-rcd >/dev/null 2>&1 || true; systemctl restart rclone-rcd; }
systemctl restart magnetflow
sleep 2
c_ok "服务已启动"

# ── 8b. 每日自动刷新 BT tracker (cron 03:00) ─────────────────────────────────
cat > /etc/cron.d/magnetflow-trackers <<EOF
# MagnetFlow: refresh BT trackers daily at 03:00
0 3 * * * root /usr/bin/python3 ${INSTALL_DIR}/scripts/update-trackers.py >/dev/null 2>&1
EOF
chmod 644 /etc/cron.d/magnetflow-trackers
systemctl enable cron >/dev/null 2>&1 || true
systemctl restart cron >/dev/null 2>&1 || true
c_ok "已配置每日自动更新 tracker (03:00)"

# ── 8c. 磁盘守护 + 配置备份 (cron) ───────────────────────────────────────────
cat > /etc/cron.d/magnetflow-diskguard <<EOF
# MagnetFlow: pause downloads when free disk < 2GB
*/10 * * * * root DOWNLOAD_DIR=${DOWNLOAD_DIR} MIN_FREE_GB=2 /usr/bin/python3 ${INSTALL_DIR}/scripts/disk-guard.py >/dev/null 2>&1
EOF
cat > /etc/cron.d/magnetflow-backup <<EOF
# MagnetFlow: daily config/user backup at 03:30
30 3 * * * root APP_DIR=${INSTALL_DIR} /bin/bash ${INSTALL_DIR}/scripts/backup.sh >/dev/null 2>&1
EOF
chmod 644 /etc/cron.d/magnetflow-diskguard /etc/cron.d/magnetflow-backup
c_ok "已配置磁盘守护(每10分钟) + 配置备份(每日03:30)"

# ── 8d. 日志轮转 + BBR 网络调优 ──────────────────────────────────────────────
cat > /etc/logrotate.d/magnetflow <<'EOF'
/root/.aria2/*.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    copytruncate
}
EOF
cat > /etc/sysctl.d/99-magnetflow.conf <<'EOF'
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
EOF
sysctl --system >/dev/null 2>&1 || true
c_ok "已配置日志轮转 + BBR"

# ── 8e. 防火墙：若启用了 ufw，放行应用端口与 BT 端口 ─────────────────────────
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true
  ufw allow 6881:6999/tcp >/dev/null 2>&1 || true
  ufw allow 6881:6999/udp >/dev/null 2>&1 || true
  ufw allow 51413/tcp >/dev/null 2>&1 || true
  ufw allow 51413/udp >/dev/null 2>&1 || true
  c_warn "已在 ufw 放行 ${PORT} 与 BT 端口 6881-6999；若使用云厂商防火墙(如 DigitalOcean Cloud Firewall)请自行放行这些端口"
fi

# ── 9. 完成 ──────────────────────────────────────────────────────────────────
IP="$(curl -s -m 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
echo
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║   MagnetFlow 安装完成 🎉                       ║"
echo "  ╚══════════════════════════════════════════════╝"
echo "  访问地址 : http://${IP}:${PORT}"
if [ "${FRESH}" -eq 1 ]; then
  echo "  登录账号 : admin"
  echo "  登录密码 : ${ADMIN_PASS:-<见日志>}"
  echo "  （请登录后立即修改密码）"
else
  echo "  账号密码 : 沿用上次（如忘记可删除 ${INSTALL_DIR}/data/users.json 后重装）"
fi
echo
echo "  服务管理 : systemctl {status|restart} magnetflow"
echo "  实时日志 : journalctl -u magnetflow -f"
echo "  连接网盘 : 见 README「连接网盘」一节（rclone config）"
echo
[ "$(systemctl is-active magnetflow)" = "active" ] && c_ok "magnetflow 运行中" || c_warn "magnetflow 未运行，请查看 journalctl -u magnetflow"
