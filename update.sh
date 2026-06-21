#!/usr/bin/env bash
#
# MagnetFlow one-click upgrade script.
#
#   bash <(curl -sL https://raw.githubusercontent.com/vzzoxo/magnet-flow/main/update.sh)
#
set -euo pipefail

c_ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
c_info() { printf '\033[36m▸\033[0m %s\n' "$1"; }
c_warn() { printf '\033[33m!\033[0m %s\n' "$1"; }
die()    { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行（sudo bash ...）"

echo "  ╔══════════════════════════════════════╗"
echo "  ║        MagnetFlow 一键升级脚本        ║"
echo "  ╚══════════════════════════════════════╝"
echo

# 1. Detect installation directory
INSTALL_DIR=""
if [ -f /etc/systemd/system/magnetflow.service ]; then
  INSTALL_DIR="$(grep -E '^WorkingDirectory=' /etc/systemd/system/magnetflow.service | cut -d= -f2-)"
fi

if [ -z "${INSTALL_DIR}" ] || [ ! -d "${INSTALL_DIR}" ]; then
  # Fallback check
  if [ -d "/opt/magnet-flow/.git" ]; then
    INSTALL_DIR="/opt/magnet-flow"
  elif [ -d "/root/magnet-flow/.git" ]; then
    INSTALL_DIR="/root/magnet-flow"
  elif [ -d "./.git" ]; then
    INSTALL_DIR="$(pwd)"
  else
    die "未检测到已安装的 MagnetFlow 目录，请手动进入安装目录运行升级或重新安装。"
  fi
fi

c_info "检测到 MagnetFlow 安装目录: ${INSTALL_DIR}"

# 2. Git fetch and pull (hard reset to origin/main)
c_info "开始从 GitHub 拉取最新代码..."
git -C "${INSTALL_DIR}" fetch --all
git -C "${INSTALL_DIR}" reset --hard origin/main
c_ok "代码已成功更新至最新版"

# 3. Npm install dependencies
c_info "检查并更新 Node 依赖包..."
cd "${INSTALL_DIR}"
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --production >/dev/null 2>&1
c_ok "依赖包更新完毕"

# 4. Restart magnetflow service
if [ -f /etc/systemd/system/magnetflow.service ] || systemctl list-unit-files | grep -q 'magnetflow.service'; then
  c_info "正在重启 magnetflow 服务..."
  systemctl daemon-reload
  systemctl restart magnetflow
  sleep 1
  if [ "$(systemctl is-active magnetflow)" = "active" ]; then
    c_ok "MagnetFlow 服务重启成功，已运行最新版本！"
  else
    c_warn "MagnetFlow 服务未能成功启动，请运行 'journalctl -u magnetflow -n 50' 查看错误日志。"
  fi
else
  c_warn "未检测到 systemd 注册的 magnetflow.service 服务，请手动重启您的 Node 服务。"
fi

echo
c_ok "一键升级已全部完成！"
