<div align="center">

<img src="public/img/logo.svg" width="96" height="96" alt="MagnetFlow logo">

# MagnetFlow

**自托管的磁力下载 · 在线串流 · 文件管理 · 网盘集成 一体平台**

[![Release](https://img.shields.io/github/v/release/vzzoxo/magnet-flow?color=5e5ce6)](https://github.com/vzzoxo/magnet-flow/releases)
[![License](https://img.shields.io/github/license/vzzoxo/magnet-flow?color=0a84ff)](LICENSE)
![Node](https://img.shields.io/badge/Node-%E2%89%A518-3c873a?logo=node.js&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Debian%20%7C%20Ubuntu-bf5af2)

基于 aria2 + Node.js，毛玻璃拟态苹果风界面，一条命令部署，开箱即用。

</div>

---

## ✨ 功能特性

**下载**
- 🧲 粘贴磁力链接 / 种子 / HTTP(S) / 纯 BT InfoHash 即可下载，基于 aria2。
- 🔀 **双下载引擎**：磁力/种子可选 **aria2** 或 **Transmission**（HTTP 直链始终用 aria2），任务卡带引擎标签。
- 📊 实时进度、速度、连接数与**做种数**（一眼判断是否「死种」）。
- 📂 多文件种子可**勾选只下需要的文件**。
- 🧹 **实时彻底删除**：删除未完成/出错/已停止的任务时，实时从列表消失（无需再手动点击清理），并且**自动物理删除本地或网盘关联的未下载完的分片文件、.aria2 状态文件及空文件夹**，绝不残留磁盘垃圾。
- ⚡ 两个引擎均已调优：aria2(200 peers、并发 10、64M 缓存、DHT/PEX/LPD、每日自动更新的 tracker 列表、session 持久化)；Transmission(并发 10、500/100 peers、64M 缓存、uTP/DHT/PEX/LPD、下完不做种)；配合 BBR。
- 🚦 可在设置里调整**全局上传限速**,即时生效。

**播放与文件**
- 🎬 **全能在线播放**：浏览器在线播放视频，支持 HTTP Range 拖动与 HLS 播放；🎵 在线播放音乐；提供「上一个 / 下一个」切片导航按钮。
- 🔄 **三大播放模式**：支持**单片循环**、**列表顺序播放**、**列表循环播放**，模式设置自动持久化保存。
- 🩹 **后台播放自愈**：临时播放令牌（Token）生存期升级至 **24 小时**，且当由于网络抖动或长时间挂起导致播放失败时，播放器可自动刷新 Token 并**无缝恢复到刚才的播放进度（断点续播）**，杜绝网页刷新。
- 📁 **文件管理**：浏览 / 复制 / 移动 / 删除 / 解压（zip/rar/7z/tar…）/ 搜索；“移动目录”与“重命名”功能彻底独立拆分，拥有专属的输入框与确认键，操作便捷且防误触。

**网盘（rclone）**
- ☁️ 一键把文件上传到 **OneDrive / Google Drive** 等网盘（本地保留）。
- 🗂️ **网盘浏览器**（类 Alist）：列表/网格双视图、按类型配色图标、容量显示、在线播放云端视频/音乐、图片灯箱预览、复制直链、新建文件夹、删除云端文件。
- ⬆️ 可设置**下载完成后自动上传**到指定网盘。

**自动化与通知**
- 📡 **RSS 订阅**：按标题关键词/正则自动追新下载（每 15 分钟检查）。
- 🔔 **完成通知**：Telegram / Bark 推送。
- ⚙️ 以上自动上传 / 通知 / RSS 均可在**网页「设置」里可视化配置，即时生效**（无需改配置或重启）。

**运维 & 界面**
- 🛡️ aria2 / 应用 / rclone 均由 systemd 托管（开机自启、崩溃自拉起）；磁盘不足自动暂停下载；每日备份配置与用户库；日志轮转。
- 🔒 JWT 登录、bcrypt 口令、登录限流、路径穿越防护、SSRF 拦截、解压 zip-slip 校验、串流用短时单文件令牌、改密码使旧令牌失效。
- 🎨 毛玻璃拟态苹果风、响应式、完整适配手机端（含播放器全屏）；侧边栏实时**磁盘容量条**。

## 🚀 一键部署

在一台**全新的 Debian / Ubuntu**（root）机器上执行：

```bash
bash <(curl -sL https://raw.githubusercontent.com/vzzoxo/magnet-flow/main/install.sh)
```

自动完成：系统依赖（aria2、Transmission、ffmpeg、解压工具、cron、python3）→ Node.js 20 → rclone → 克隆代码到 `/opt/magnet-flow` → npm 安装 → 生成随机密钥 → 写入调优后的 aria2 配置（含每日 tracker 自动更新）与 Transmission 配置 → 配置并启动 systemd 服务（`aria2` / `transmission` / `magnetflow` / `rclone-rcd`）→ 磁盘守护 / 备份 / 日志轮转 / BBR。

完成后访问 `http://<服务器IP>:3000`，**初始管理员密码会在安装结束时打印一次**，请登录后立即修改。

### 绑定域名 + 自动 HTTPS（推荐）

先把域名的 **A 记录解析到服务器 IP**，再运行脚本。脚本会**交互询问域名**：填入后会自动安装 **Caddy**、签发 Let's Encrypt 证书、把应用改为仅监听 `127.0.0.1` 并反代，访问地址变为 `https://你的域名`。

也可全自动（跳过交互）：

```bash
DOMAIN=dl.example.com LE_EMAIL=you@example.com bash <(curl -sL https://raw.githubusercontent.com/vzzoxo/magnet-flow/main/install.sh)
```

> 留空域名则维持 `http://IP:3000` 直连方式。

> 可用环境变量覆盖默认：`INSTALL_DIR`、`DOWNLOAD_DIR`、`PORT`、`REPO_URL`。

## 🌐 绑定域名 + HTTPS（推荐 Caddy，自动证书）

> 一键脚本在交互时填入域名即可**自动完成下面所有步骤**（见上节）。以下为手动配置 / 原理说明，适用于已部署后再加域名的情况。

1. 域名 A 记录指向服务器公网 IP，确保 80/443 可达。
2. 让应用只监听本机：`.env` 设 `HOST=127.0.0.1`，然后 `systemctl restart magnetflow`。
3. 安装 Caddy，写 `/etc/caddy/Caddyfile`（把 `your.domain.com` 换成你的域名）：
   ```caddyfile
   your.domain.com {
       encode zstd gzip
       reverse_proxy 127.0.0.1:3000 {
           header_down -Cache-Control
       }
       @assets path /css/* /js/* /img/* /favicon.ico
       header @assets Cache-Control "public, max-age=31536000, immutable"
       @dynamic not path /css/* /js/* /img/* /favicon.ico
       header @dynamic Cache-Control "no-store"
   }
   ```
4. `systemctl restart caddy` —— 自动签发并续期 Let's Encrypt 证书。WebSocket 自动支持。

## ☁️ 连接网盘（OneDrive / Google Drive）

网盘基于 rclone，首次需用浏览器授权一次（无头服务器用 SSH 端口转发）：

```bash
# 1) 本地电脑建立隧道（保持窗口开着）
ssh -L 53682:localhost:53682 root@<服务器IP>

# 2) 在服务器上运行，按提示连接（OneDrive 选 onedrive / Google Drive 选 drive）
rclone config
#   Use web browser to automatically authenticate? → y
#   把终端打印的 http://127.0.0.1:53682/auth?... 复制到本地浏览器登录授权

# 3) 让守护进程加载新配置
systemctl restart rclone-rcd
```

连接后，网页「网盘」会自动出现对应网盘，可浏览、在线播放、删除、复制直链；文件管理里也可把**已下载完成**的文件 ☁️ 上传到网盘。

> 在线播放云端视频走**服务器代理**（浏览器 ⇄ 服务器 ⇄ 网盘），凭据只留在服务器、用短时单文件令牌，安全但会占用服务器带宽。

### Google Drive 额外说明

`rclone config` 选 `drive` 时的关键选项：`client_id`/`client_secret` 可留空（用共享 ID）；`scope` 选 `1`（完全读写）；`Configure this as a Shared Drive (Team Drive)?` 个人盘选 `n`。

- **建议自建 OAuth client_id**（避免共享 ID 限速 / “未验证”警告）：Google Cloud Console → 新建项目 → 启用 **Google Drive API**（不是 Drive Activity API）→ 配置 OAuth 同意屏幕（External，加自己为测试用户）→ 凭据里创建 **OAuth 客户端 ID**，类型选 **桌面应用**，把得到的 id/secret 填进 `rclone config`。
- ⚠️ **7 天过期坑**：OAuth 同意屏幕若停留在「测试」状态，刷新令牌每 7 天失效一次；把发布状态点成「**生产 / In production**」即可长期有效（自用忽略未验证警告）。
- **容量显示**：Google Workspace 池化存储经 API 返回的常是占位值（如 100 TiB），并非管理后台设定的真实额度，仅供参考。

## ⚙️ 网页设置（无需改配置）

进「设置」页可直接配置并即时生效：
- **安全**：修改密码（改后旧登录自动失效）。
- **下载完成自动上传**：开关 + 选网盘 + 目标文件夹。
- **手动上传默认网盘**：设一个默认网盘，文件管理的「上传到网盘」弹窗会自动预选（仍可临时更换）。
- **完成通知**：Telegram Bot Token / Chat ID、Bark 地址。
- **RSS 订阅**：添加/暂停/立即检查/删除，过滤词支持关键词或正则。

## 🔧 配置（环境变量 `.env`）

由安装脚本自动生成，可手动修改后 `systemctl restart magnetflow`：

| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | HTTP 端口 | `3000` |
| `HOST` | 监听地址（反代后设 `127.0.0.1`） | `0.0.0.0` |
| `JWT_SECRET` | JWT 签名密钥（**必填**，脚本随机生成） | — |
| `DOWNLOAD_DIR` | 下载目录 | `<安装目录>/downloads` |
| `ARIA2_RPC_URL` / `ARIA2_SECRET` | aria2 RPC 地址 / 密钥 | 本地 / 随机生成 |
| `RCLONE_RC_URL` | rclone rc 地址 | `http://127.0.0.1:5572` |
| `TRANSMISSION_RPC_URL` | Transmission RPC 地址（第二下载引擎，不通则自动隐藏并回退 aria2） | `http://127.0.0.1:9091/transmission/rpc` |
| `AUTO_CLEAR_COMPLETED` / `AUTO_CLEAR_DELAY_SEC` | 完成后自动清理记录 / 保留秒数 | `true` / `15` |
| `AUTO_UPLOAD_REMOTE` / `AUTO_UPLOAD_DEST` | 自动上传网盘 / 目标文件夹（也可在网页设置） | 空 |
| `NOTIFY_TELEGRAM_BOT_TOKEN` / `NOTIFY_TELEGRAM_CHAT_ID` / `NOTIFY_BARK_URL` | 完成通知（也可在网页设置） | 空 |
| `INITIAL_ADMIN_PASSWORD` | 首次创建 admin 的密码（不填则随机并打印一次） | — |

> 网页「设置」里保存的自动上传 / 通知 / RSS 存于 `data/settings.json`、`data/rss.json`，会覆盖 `.env` 中的对应默认值。

## 🖥️ 服务与运维

```bash
systemctl status  magnetflow      # 应用            journalctl -u magnetflow -f
systemctl status  aria2           # 下载引擎
systemctl status  transmission    # 第二下载引擎(可选)
systemctl status  rclone-rcd      # 网盘守护进程
systemctl status  caddy           # 反向代理(若装)
```

自动任务（安装脚本已配置 cron）：
- **每日 03:00** 从 GitHub 拉取最新 BT tracker 列表并热更新（`scripts/update-trackers.py`）。
- **每 10 分钟**磁盘空间守护：低于 2GB 自动暂停下载（`scripts/disk-guard.py`，可改阈值）。
- **每日 03:30** 备份 `.env` / `users.json` / `aria2.conf` / `rclone.conf` 到 `<安装目录>/backups`（保留最近 14 份，`scripts/backup.sh`）。

## 🧩 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js 18+ / Express / ws（WebSocket） |
| 下载引擎 | aria2（JSON-RPC） / Transmission（RPC） |
| 网盘 | rclone（rc 守护进程） |
| 鉴权 | JWT（jsonwebtoken）+ bcryptjs |
| 前端 | 原生 SPA（无构建）+ hls.js |
| 进程/运维 | systemd + cron + logrotate + Caddy(可选) |

## 📂 目录结构

```
magnet-flow/
├── server.js            # 入口：Express + WebSocket + 轮询/完成钩子
├── lib/                 # auth/config/paths/aria2/rclone/notify/uploader/settings/rss/rate-limit/users-store/ssrf-guard
├── routes/              # auth/downloads/files/stream/system/remotes/rss/settings
├── public/              # 前端（index.html / css / js / 图标）
├── scripts/             # update-trackers / disk-guard / backup / gen_favicon
├── test/                # node:test 单元测试
├── install.sh           # 一键部署脚本
└── .env.example         # 配置模板
```

## 🛠️ 手动 / 本地开发

```bash
git clone https://github.com/vzzoxo/magnet-flow.git
cd magnet-flow
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # 填入 JWT_SECRET
# 需本机已运行 aria2（开启 RPC）
npm start          # 或 npm run dev（--watch）
npm test           # 单元测试（node:test）
```

## 🔐 安全说明

- 首次启动创建 `admin` 用户，**请立即改密码**（改密会使旧登录令牌失效）。
- `.env`、`data/`、`downloads/`、`backups/` 已被 `.gitignore` 排除，不会进版本库。
- 串流使用短时、限定单文件的签名令牌；http(s) 下载有 SSRF 校验；解压前校验防 zip-slip。
- 公网使用建议放在反向代理后启用 HTTPS，并将 `HOST` 设为 `127.0.0.1`。

## 📜 许可证

MIT License。
