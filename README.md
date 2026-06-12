<div align="center">

<img src="public/img/logo.svg" width="96" height="96" alt="MagnetFlow logo">

# MagnetFlow

**自托管的磁力下载 · 在线串流 · 文件管理 · 网盘上传一体平台**

基于 aria2 + Node.js，毛玻璃拟态苹果风界面，开箱即用。

</div>

---

## ✨ 功能特性

- 🧲 **下载管理** — 粘贴磁力链接 / 种子 / HTTP(S) / 纯 BT InfoHash 即可下载，基于 aria2，实时进度、速度、连接数与做种数。
- 🎬 **在线串流** — 浏览器直接播放下载好的视频，支持 HTTP Range 拖动；得益于「头尾优先下载」可边下边播。
- 📁 **文件管理** — 浏览、复制、移动 / 重命名、删除、解压（zip/rar/7z/tar…），毛玻璃风格文件浏览器。
- ☁️ **网盘集成（rclone）** — 一键把文件上传到 OneDrive / Google Drive 等；并提供「网盘浏览器」在线播放云端的视频与音乐（类 Alist）。
- 🧹 **完成自动清理** — 下载完成后自动清理任务记录（文件保留），列表清爽。
- 🔒 **安全** — JWT 登录、bcrypt 口令、登录限流、路径穿越防护、SSRF 拦截、解压 zip-slip 校验、短时单文件串流令牌。
- 🎨 **现代 UI** — 响应式、毛玻璃拟态、深浅渐变，移动端可用。

## 🚀 一键部署

在一台**全新的 Debian / Ubuntu** 机器上（建议 root），执行：

```bash
bash <(curl -sL https://raw.githubusercontent.com/vzzoxo/magnet-flow/main/install.sh)
```

脚本会自动完成：安装系统依赖（aria2、ffmpeg、解压工具、Node.js 20、rclone）→ 克隆代码 → 安装依赖 → 生成随机密钥 → 配置并启动 systemd 服务（`aria2` / `magnetflow` / `rclone-rcd`）。

完成后访问 `http://<服务器IP>:3000`，**初始管理员用户名/密码会在安装结束时打印一次**，请登录后立即修改。

> ⚠️ 默认监听 `0.0.0.0:3000` 且无 HTTPS。生产环境建议放在反向代理（Nginx / Caddy）后并启用 TLS，或仅在内网 / VPN 内访问。

## 🧩 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js 18+ / Express / ws（WebSocket） |
| 下载引擎 | aria2（JSON-RPC） |
| 网盘 | rclone（rc 守护进程） |
| 鉴权 | JWT（jsonwebtoken）+ bcryptjs |
| 前端 | 原生 SPA（无构建）+ hls.js |
| 进程管理 | systemd |

## ⚙️ 配置（环境变量）

部署后配置位于安装目录的 `.env`（由安装脚本自动生成，可手动修改后 `systemctl restart magnetflow`）：

| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | HTTP 端口 | `3000` |
| `JWT_SECRET` | JWT 签名密钥（**必填**，安装脚本随机生成） | — |
| `DOWNLOAD_DIR` | 下载目录 | `<安装目录>/downloads` |
| `ARIA2_RPC_URL` | aria2 RPC 地址 | `http://localhost:6800/jsonrpc` |
| `ARIA2_SECRET` | aria2 RPC 密钥 | 安装脚本随机生成 |
| `RCLONE_RC_URL` | rclone rc 地址 | `http://127.0.0.1:5572` |
| `AUTO_CLEAR_COMPLETED` | 完成后自动清理记录 | `true` |
| `AUTO_CLEAR_DELAY_SEC` | 清理前保留秒数 | `15` |
| `INITIAL_ADMIN_PASSWORD` | 首次创建 admin 的密码（不填则随机并打印一次） | — |

## ☁️ 连接网盘（OneDrive / Google Drive）

网盘功能基于 rclone。首次需用浏览器授权一次（无头服务器用 SSH 端口转发）：

```bash
# 1) 本地电脑建立隧道（保持窗口开着）
ssh -L 53682:localhost:53682 root@<服务器IP>

# 2) 在服务器上运行，按提示连接（OneDrive 选 onedrive / Google Drive 选 drive）
rclone config
#   Use web browser to automatically authenticate? → y
#   把终端打印的 http://127.0.0.1:53682/auth?... 链接复制到本地浏览器登录授权

# 3) 让守护进程加载新配置
systemctl restart rclone-rcd
```

连接后，网页「网盘」页会自动出现对应的网盘，可浏览与在线播放；文件管理里也可把文件 ☁️ 上传到网盘（仅能上传**已下载完成**的文件）。

## 🌐 绑定域名 + HTTPS（反向代理）

把应用放在反向代理后并启用 TLS（推荐 [Caddy](https://caddyserver.com/)，自动签发并续期 Let's Encrypt 证书）。

1. 将域名解析（A 记录）指向服务器公网 IP，确保 80/443 端口可达。
2. 让应用只监听本机（不再对公网暴露 3000）：在 `.env` 中设置
   ```
   HOST=127.0.0.1
   ```
   然后 `systemctl restart magnetflow`。
3. 安装 Caddy 并写 `/etc/caddy/Caddyfile`（把 `your.domain.com` 换成你的域名）：
   ```caddyfile
   your.domain.com {
       encode zstd gzip
       reverse_proxy 127.0.0.1:3000
   }
   ```
4. `systemctl restart caddy` —— Caddy 会自动申请证书。完成后访问 `https://your.domain.com`。

WebSocket（实时进度）由 Caddy 自动升级代理，无需额外配置。

## 🖥️ 服务管理

```bash
systemctl status  magnetflow     # 应用
systemctl restart magnetflow
journalctl -u magnetflow -f      # 实时日志

systemctl status  aria2          # 下载引擎
systemctl status  rclone-rcd     # 网盘守护进程
```

## 🛠️ 手动 / 本地开发

```bash
git clone https://github.com/vzzoxo/magnet-flow.git
cd magnet-flow
npm install
cp .env.example .env
# 生成强密钥填入 JWT_SECRET：
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# 需本机已运行 aria2（开启 RPC）
npm start          # 或 npm run dev（--watch）
npm test           # 运行单元测试（node:test）
```

## 📂 目录结构

```
magnet-flow/
├── server.js            # 入口：Express + WebSocket + 启动初始化
├── lib/                 # auth / config / paths / aria2 / rclone / 限流 / 用户存储 / SSRF 防护
├── routes/              # auth / downloads / files / stream / system / remotes
├── public/              # 前端（index.html / css / js / 图标）
├── test/                # node:test 单元测试
├── install.sh           # 一键部署脚本
└── .env.example         # 配置模板
```

## 🔐 安全说明

- 首次启动会创建 `admin` 用户；**请立即修改密码**（改密码会使旧登录令牌失效）。
- `.env`、`data/`、`downloads/` 已被 `.gitignore` 排除，不会进入版本库。
- 串流使用短时、限定单文件的签名令牌，避免长期凭证泄漏。
- 仅 http(s) 下载会做 SSRF 校验（拦截内网 / 云元数据地址）。
- 建议在反向代理后启用 HTTPS。

## 📜 许可证

MIT License。
