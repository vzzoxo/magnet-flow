/**
 * MagnetFlow — Main Application Logic
 * SPA with hash-based routing, WebSocket, download management,
 * file manager, video player, and settings.
 */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════
     Utility Functions
     ══════════════════════════════════════════════════════ */

  function formatBytes(bytes) {
    if (bytes == null || isNaN(bytes)) return '0 B';
    bytes = Number(bytes);
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(i > 0 ? 2 : 0) + ' ' + sizes[i];
  }

  function formatSpeed(bps) {
    if (!bps || isNaN(bps)) return '0 B/s';
    bps = Number(bps);
    if (bps === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bps) / Math.log(k));
    return (bps / Math.pow(k, i)).toFixed(i > 0 ? 2 : 0) + ' ' + sizes[i];
  }

  function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function getExtension(filename) {
    if (!filename) return '';
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  }

  const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm3u8', 'ts']);
  const AUDIO_EXTS = new Set(['mp3', 'flac', 'wav', 'aac', 'ogg', 'wma', 'm4a']);
  const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']);
  const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst']);
  const DOC_EXTS = new Set(['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'xlsx', 'pptx', 'csv']);

  function isVideoFile(name) { return VIDEO_EXTS.has(getExtension(name)); }
  function isArchiveFile(name) { return ARCHIVE_EXTS.has(getExtension(name)); }
  function isAudioFile(name) { return AUDIO_EXTS.has(getExtension(name)); }

  function getFileIcon(name, isDir) {
    if (isDir) return '📁';
    const ext = getExtension(name);
    if (VIDEO_EXTS.has(ext)) return '🎬';
    if (AUDIO_EXTS.has(ext)) return '🎵';
    if (IMAGE_EXTS.has(ext)) return '🖼️';
    if (ARCHIVE_EXTS.has(ext)) return '📦';
    if (DOC_EXTS.has(ext)) return '📄';
    return '📄';
  }

  function extractFileName(dl) {
    // Try bittorrent info
    if (dl.bittorrent && dl.bittorrent.info && dl.bittorrent.info.name) {
      return dl.bittorrent.info.name;
    }
    // Try files array
    if (dl.files && dl.files.length > 0) {
      const p = dl.files[0].path || dl.files[0].uris?.[0]?.uri || '';
      const name = p.split('/').pop();
      if (name) return name;
    }
    // Try URI
    if (dl.uris && dl.uris.length > 0) {
      try {
        const u = new URL(dl.uris[0].uri);
        const name = u.pathname.split('/').pop();
        if (name) return decodeURIComponent(name);
      } catch (e) { /* ignore */ }
    }
    // Fallback
    return dl.gid || '未知文件';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }


  /* ══════════════════════════════════════════════════════
     Toast System
     ══════════════════════════════════════════════════════ */

  const TOAST_ICONS = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
  };

  // Clean line icons for per-file actions. Stroke uses currentColor so they
  // inherit the button's colour and hover states (including the danger red).
  const SVG = (paths) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ACTION_ICONS = {
    upload: SVG('<path d="M6.5 18.5A4.5 4.5 0 0 1 6 9.6a6 6 0 0 1 11.6-1.1A4 4 0 0 1 18 18.5"/><path d="M12 12.5V19"/><path d="m9 15 3-3 3 3"/>'),
    extract: SVG('<path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M12 12v5"/><path d="M9.5 14.5 12 17l2.5-2.5"/>'),
    copy: SVG('<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15h-.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>'),
    move: SVG('<path d="M12 20h9"/><path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    delete: SVG('<path d="M3 6h18"/><path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6"/><path d="M18.5 6 17.6 19a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 6"/><path d="M10 10.5v6M14 10.5v6"/>'),
  };

  function showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
      <span class="toast-close" onclick="this.parentElement.remove()">✕</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 400);
    }, duration);
  }


  /* ══════════════════════════════════════════════════════
     Modal System
     ══════════════════════════════════════════════════════ */

  let _modalKeyHandler = null;

  function showModal(title, bodyHtml, footerHtml) {
    const overlay = document.getElementById('modal-overlay');
    const header = document.getElementById('modal-header');
    const body = document.getElementById('modal-body');
    const footer = document.getElementById('modal-footer');

    header.innerHTML = `<h3>${escapeHtml(title)}</h3>`;
    body.innerHTML = bodyHtml;
    footer.innerHTML = footerHtml || '';
    overlay.classList.remove('hidden');

    // Close on overlay click
    overlay.onclick = (e) => {
      if (e.target === overlay) hideModal();
    };
    // Close on Escape — register a single handler that hideModal() always removes.
    if (_modalKeyHandler) document.removeEventListener('keydown', _modalKeyHandler);
    _modalKeyHandler = (e) => { if (e.key === 'Escape') hideModal(); };
    document.addEventListener('keydown', _modalKeyHandler);
  }

  function hideModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    if (_modalKeyHandler) {
      document.removeEventListener('keydown', _modalKeyHandler);
      _modalKeyHandler = null;
    }
  }


  /* ══════════════════════════════════════════════════════
     Specific Modals
     ══════════════════════════════════════════════════════ */

  function addDownloadModal() {
    const body = `
      <div class="form-group">
        <label class="form-label" for="download-url-input">磁力链接 / 下载链接</label>
        <input type="text" id="download-url-input" class="form-input"
               placeholder="magnet:? / http(s):// / 或 40位 BT Hash" autofocus>
        <p class="form-hint">支持磁力链接、HTTP/HTTPS、纯 Hash 和 torrent 链接</p>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">或 上传种子文件</label>
        <input type="file" id="torrent-file" accept=".torrent,application/x-bittorrent" style="display:none">
        <button type="button" class="btn-secondary" id="btn-pick-torrent" style="width:100%">📄 选择 .torrent 文件</button>
        <p class="form-hint" id="torrent-hint">选择后立即开始下载</p>
      </div>
    `;
    const footer = `
      <button class="btn-secondary" onclick="window._hideModal()">取消</button>
      <button class="btn-primary" id="btn-confirm-download">开始下载</button>
    `;
    showModal('添加下载', body, footer);

    // .torrent file upload
    const fileInput = document.getElementById('torrent-file');
    document.getElementById('btn-pick-torrent').onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const hint = document.getElementById('torrent-hint');
      hint.textContent = '正在上传 ' + file.name + ' …';
      try {
        const b64 = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(',')[1]);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
        await API.addTorrent(b64);
        showToast('种子已添加', 'success');
        hideModal();
        if (currentPage === 'dashboard') refreshDownloads();
      } catch (err) {
        hint.textContent = '选择后立即开始下载';
        fileInput.value = '';
        showToast('种子添加失败: ' + err.message, 'error');
      }
    };

    document.getElementById('btn-confirm-download').onclick = async () => {
      const url = document.getElementById('download-url-input').value.trim();
      if (!url) { showToast('请输入下载链接', 'warning'); return; }
      try {
        await API.addDownload(url);
        showToast('下载已添加', 'success');
        hideModal();
        if (currentPage === 'dashboard') refreshDownloads();
      } catch (err) {
        showToast('添加失败: ' + err.message, 'error');
      }
    };

    // Enter key shortcut
    document.getElementById('download-url-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-confirm-download').click();
    });
  }

  function confirmDeleteModal(path, label, onDone) {
    const body = `
      <p style="color:var(--text-secondary);font-size:0.9rem;line-height:1.6">
        确定要删除 <strong style="color:var(--text-primary)">${escapeHtml(label)}</strong> 吗？<br>
        <span class="text-danger" style="font-size:0.8rem">此操作不可撤销。</span>
      </p>
    `;
    const footer = `
      <button class="btn-secondary" onclick="window._hideModal()">取消</button>
      <button class="btn-danger" id="btn-confirm-delete">确认删除</button>
    `;
    showModal('确认删除', body, footer);

    document.getElementById('btn-confirm-delete').onclick = async () => {
      try {
        await API.deleteFile(path);
        showToast('已删除: ' + label, 'success');
        hideModal();
        if (onDone) onDone();
      } catch (err) {
        showToast('删除失败: ' + err.message, 'error');
      }
    };
  }

  function newFolderModal(currentPath) {
    const body = `
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label" for="new-folder-input">文件夹名称</label>
        <input type="text" id="new-folder-input" class="form-input" placeholder="新建文件夹" autofocus>
      </div>
    `;
    const footer = `
      <button class="btn-secondary" onclick="window._hideModal()">取消</button>
      <button class="btn-primary" id="btn-confirm-mkdir">创建</button>
    `;
    showModal('新建文件夹', body, footer);

    document.getElementById('btn-confirm-mkdir').onclick = async () => {
      const name = document.getElementById('new-folder-input').value.trim();
      if (!name) { showToast('请输入文件夹名称', 'warning'); return; }
      const fullPath = currentPath ? currentPath + '/' + name : name;
      try {
        await API.createDir(fullPath);
        showToast('文件夹已创建', 'success');
        hideModal();
        renderFileManager(currentPath);
      } catch (err) {
        showToast('创建失败: ' + err.message, 'error');
      }
    };

    document.getElementById('new-folder-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-confirm-mkdir').click();
    });
  }

  function copyFileModal(source, sourceName, onDone) {
    const body = `
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label" for="copy-dest-input">目标路径</label>
        <input type="text" id="copy-dest-input" class="form-input" placeholder="输入目标路径" value="${escapeHtml(source)}" autofocus>
        <p class="form-hint">将 <strong>${escapeHtml(sourceName)}</strong> 复制到指定路径</p>
      </div>
    `;
    const footer = `
      <button class="btn-secondary" onclick="window._hideModal()">取消</button>
      <button class="btn-primary" id="btn-confirm-copy">复制</button>
    `;
    showModal('复制文件', body, footer);

    document.getElementById('btn-confirm-copy').onclick = async () => {
      const dest = document.getElementById('copy-dest-input').value.trim();
      if (!dest) { showToast('请输入目标路径', 'warning'); return; }
      try {
        await API.copyFile(source, dest);
        showToast('复制成功', 'success');
        hideModal();
        if (onDone) onDone();
      } catch (err) {
        showToast('复制失败: ' + err.message, 'error');
      }
    };
  }

  function moveFileModal(source, sourceName, onDone) {
    const body = `
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label" for="move-dest-input">目标路径</label>
        <input type="text" id="move-dest-input" class="form-input" placeholder="输入目标路径" value="${escapeHtml(source)}" autofocus>
        <p class="form-hint">将 <strong>${escapeHtml(sourceName)}</strong> 移动到指定路径</p>
      </div>
    `;
    const footer = `
      <button class="btn-secondary" onclick="window._hideModal()">取消</button>
      <button class="btn-primary" id="btn-confirm-move">移动</button>
    `;
    showModal('移动文件', body, footer);

    document.getElementById('btn-confirm-move').onclick = async () => {
      const dest = document.getElementById('move-dest-input').value.trim();
      if (!dest) { showToast('请输入目标路径', 'warning'); return; }
      try {
        await API.moveFile(source, dest);
        showToast('移动成功', 'success');
        hideModal();
        if (onDone) onDone();
      } catch (err) {
        showToast('移动失败: ' + err.message, 'error');
      }
    };
  }

  // Expose hideModal globally for onclick attributes
  window._hideModal = hideModal;

  // Mobile "⋯" menu listing the per-file actions (delegates to `run`).
  function fileActionsMenu(p, name, isArchive, run) {
    const items = [
      { a: 'upload', t: '☁️ 上传到网盘' },
      ...(isArchive ? [{ a: 'extract', t: '📦 解压' }] : []),
      { a: 'copy', t: '📋 复制' },
      { a: 'move', t: '✂️ 移动 / 重命名' },
      { a: 'delete', t: '🗑️ 删除', danger: true },
    ];
    const body = `<div class="action-menu">${items
      .map((i) => `<button class="action-menu-item${i.danger ? ' danger' : ''}" data-act="${i.a}">${i.t}</button>`)
      .join('')}</div>`;
    showModal(name, body, '');
    document.querySelectorAll('.action-menu-item').forEach((b) => {
      b.onclick = () => { hideModal(); run(b.dataset.act, p, name); };
    });
  }


  /* ══════════════════════════════════════════════════════
     Cloud Upload (rclone)
     ══════════════════════════════════════════════════════ */

  async function uploadToRemoteModal(path, name) {
    let remotes = [];
    try {
      const r = await API.listRemotes();
      remotes = (r && r.remotes) || [];
    } catch (err) {
      showToast('获取网盘列表失败: ' + err.message, 'error');
      return;
    }

    if (!remotes.length) {
      showModal(
        '上传到网盘',
        `<p style="color:var(--text-secondary);font-size:0.9rem;line-height:1.7">
           尚未连接任何网盘。<br>请先在服务器上用 <strong>rclone</strong> 连接 OneDrive / Google Drive，
           连接后这里就会出现可选的网盘。
         </p>`,
        `<button class="btn-secondary" onclick="window._hideModal()">知道了</button>`
      );
      return;
    }

    const options = remotes.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
    const body = `
      <div class="form-group">
        <label class="form-label" for="upload-remote">目标网盘</label>
        <select id="upload-remote" class="form-select">${options}</select>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label" for="upload-dest">网盘内目标文件夹（留空＝根目录）</label>
        <input type="text" id="upload-dest" class="form-input" placeholder="例如 movies，或留空">
        <p class="form-hint">将 <strong>${escapeHtml(name)}</strong> 上传到所选网盘，本地文件会保留。</p>
      </div>
    `;
    const footer = `
      <button class="btn-secondary" onclick="window._hideModal()">取消</button>
      <button class="btn-primary" id="btn-confirm-upload">上传</button>
    `;
    showModal('上传到网盘', body, footer);

    document.getElementById('btn-confirm-upload').onclick = async () => {
      const remote = document.getElementById('upload-remote').value;
      const dest = document.getElementById('upload-dest').value.trim();
      try {
        const res = await API.uploadToRemote(path, remote, dest);
        hideModal();
        showToast(`已开始上传到 ${remote}`, 'success');
        trackUpload(res.jobid, name, remote);
      } catch (err) {
        showToast('上传失败: ' + err.message, 'error');
      }
    };
  }

  const _uploads = new Map(); // jobid -> { name, remote, el }
  let _uploadTimer = null;

  function ensureUploadsPanel() {
    let panel = document.getElementById('uploads-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'uploads-panel';
      panel.className = 'uploads-panel';
      document.body.appendChild(panel);
    }
    return panel;
  }

  function trackUpload(jobid, name, remote) {
    if (jobid == null) return;
    const panel = ensureUploadsPanel();
    const row = document.createElement('div');
    row.className = 'upload-item';
    row.innerHTML = `
      <div class="upload-item-head">
        <span class="upload-item-name" title="${escapeHtml(name)}">☁️ ${escapeHtml(name)}</span>
        <span class="upload-item-status">排队中…</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>
      <div class="upload-item-meta"><span>${escapeHtml(remote)}</span><span class="upload-item-pct">0%</span></div>
    `;
    panel.appendChild(row);
    _uploads.set(jobid, { name, remote, el: row });
    if (!_uploadTimer) _uploadTimer = setInterval(pollUploads, 1500);
  }

  async function pollUploads() {
    if (_uploads.size === 0) {
      clearInterval(_uploadTimer);
      _uploadTimer = null;
      return;
    }
    for (const [jobid, info] of [..._uploads]) {
      let st;
      try {
        st = await API.getUploadJob(jobid);
      } catch {
        continue;
      }
      if (!st) continue;

      const fill = info.el.querySelector('.progress-fill');
      const statusEl = info.el.querySelector('.upload-item-status');
      const pctEl = info.el.querySelector('.upload-item-pct');

      if (st.finished) {
        _uploads.delete(jobid);
        const el = info.el;
        if (st.gone) {
          // Job result expired — outcome unknown; just clear the row quietly.
          statusEl.textContent = '已结束';
          statusEl.className = 'upload-item-status text-muted';
          setTimeout(() => el.remove(), 4000);
        } else if (st.success) {
          fill.style.width = '100%';
          fill.classList.remove('active');
          statusEl.textContent = '已完成';
          statusEl.className = 'upload-item-status text-success';
          pctEl.textContent = '100%';
          showToast(`「${info.name}」已上传到 ${info.remote}`, 'success');
          setTimeout(() => el.remove(), 6000);
        } else {
          fill.classList.remove('active');
          statusEl.textContent = '失败';
          statusEl.className = 'upload-item-status text-danger';
          showToast(`上传失败「${info.name}」: ${st.error || '未知错误'}`, 'error', 6000);
          setTimeout(() => el.remove(), 10000);
        }
      } else {
        fill.classList.add('active');
        fill.style.width = st.percentage + '%';
        pctEl.textContent = st.percentage + '%';
        statusEl.textContent = st.speed ? formatSpeed(st.speed) : '上传中…';
      }
    }
  }


  /* ══════════════════════════════════════════════════════
     App State
     ══════════════════════════════════════════════════════ */

  let currentPage = 'dashboard';
  let downloads = [];
  let wsConnection = null;
  let wsReconnectTimer = null;
  let wsReconnectDelay = 1000;
  let hlsInstance = null;
  let downloadRefreshTimer = null;


  /* ══════════════════════════════════════════════════════
     Authentication
     ══════════════════════════════════════════════════════ */

  async function checkAuth() {
    if (!API.token) {
      showLogin();
      return;
    }
    try {
      const res = await API.checkAuth();
      if (res && res.user) {
        document.getElementById('current-user').textContent = (res.user && res.user.username) || res.user || 'admin';
      }
      showApp();
    } catch (err) {
      showLogin();
    }
  }

  function showLogin() {
    document.getElementById('login-page').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    bindLoginForm();
  }

  function showApp() {
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    navigate(window.location.hash || '#dashboard');
    connectWebSocket();
    loadDiskUsage();
    if (!diskTimer) diskTimer = setInterval(loadDiskUsage, 60000);
  }

  let diskTimer = null;
  async function loadDiskUsage() {
    const el = document.getElementById('disk-widget');
    if (!el) return;
    try {
      const d = await API.getDiskUsage();
      if (!d || !d.total) { el.innerHTML = ''; return; }
      const pct = Math.min(100, Math.round((d.used / d.total) * 100));
      el.innerHTML = `<div class="disk-bar"><div class="disk-fill${pct >= 90 ? ' warn' : ''}" style="width:${pct}%"></div></div>
        <div class="disk-text"><span>磁盘 ${pct}%</span><span>剩 ${formatBytes(d.free)}</span></div>`;
      el.title = `已用 ${formatBytes(d.used)} / 共 ${formatBytes(d.total)}，剩余 ${formatBytes(d.free)}`;
    } catch { /* ignore */ }
  }

  function bindLoginForm() {
    const form = document.getElementById('login-form');
    // Remove existing listeners by cloning
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);

    newForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      const errorEl = document.getElementById('login-error');
      const btnLogin = document.getElementById('btn-login');
      const btnText = btnLogin.querySelector('.btn-text');
      const btnSpinner = btnLogin.querySelector('.btn-spinner');

      if (!username || !password) {
        errorEl.textContent = '请输入用户名和密码';
        errorEl.classList.remove('hidden');
        return;
      }

      btnLogin.disabled = true;
      btnText.classList.add('hidden');
      btnSpinner.classList.remove('hidden');
      errorEl.classList.add('hidden');

      try {
        const res = await API.login(username, password);
        if (res && res.token) {
          API.setToken(res.token);
          if (res.user) {
            document.getElementById('current-user').textContent = (res.user && res.user.username) || res.user || 'admin';
          }
          showApp();
        } else {
          throw new Error('登录响应异常');
        }
      } catch (err) {
        errorEl.textContent = err.message || '登录失败，请重试';
        errorEl.classList.remove('hidden');
      } finally {
        btnLogin.disabled = false;
        btnText.classList.remove('hidden');
        btnSpinner.classList.add('hidden');
      }
    });
  }


  /* ══════════════════════════════════════════════════════
     Routing
     ══════════════════════════════════════════════════════ */

  function navigate(hash) {
    // Clean up previous page
    cleanup();

    if (!hash || hash === '#' || hash === '#login') {
      hash = '#dashboard';
    }

    const parts = hash.replace(/^#/, '').split('/');
    const page = parts[0];
    const param = parts.slice(1).join('/');

    currentPage = page;
    updateNavActive(page);

    switch (page) {
      case 'dashboard':
        renderDashboard();
        break;
      case 'files':
        renderFileManager(decodeURIComponent(param || ''));
        break;
      case 'netdisk':
        renderNetdisk(param || '');
        break;
      case 'rss':
        renderSettings();
        break;
      case 'netplay':
        renderNetMediaPlayer(param || '');
        break;
      case 'player':
        renderPlayer(decodeURIComponent(param || ''));
        break;
      case 'settings':
        renderSettings();
        break;
      case 'about':
        renderAbout();
        break;
      default:
        renderDashboard();
    }

    // Close mobile sidebar
    closeMobileSidebar();
  }

  function cleanup() {
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
    if (downloadRefreshTimer) {
      clearInterval(downloadRefreshTimer);
      downloadRefreshTimer = null;
    }
  }

  function updateNavActive(page) {
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
      const p = link.getAttribute('data-page');
      if (p === page || (page === 'player' && p === 'files') || (page === 'netplay' && p === 'netdisk')) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }


  /* ══════════════════════════════════════════════════════
     Dashboard Page
     ══════════════════════════════════════════════════════ */

  async function renderDashboard() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">📥 下载管理</h1>
        <div class="flex gap-8">
          <button class="btn-secondary btn-sm" id="btn-purge" title="清除已完成/已出错的任务">🧹 清理</button>
          <button class="btn-primary" id="btn-add-download">＋ 添加下载</button>
        </div>
      </div>

      <div class="stats-grid" id="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">⬇️</div>
          <div class="stat-value" id="stat-download-speed">0 B/s</div>
          <div class="stat-label">下载速度</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">⬆️</div>
          <div class="stat-value" id="stat-upload-speed">0 B/s</div>
          <div class="stat-label">上传速度</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🔄</div>
          <div class="stat-value" id="stat-active-count">0</div>
          <div class="stat-label">活跃任务</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">📊</div>
          <div class="stat-value" id="stat-total-count">0</div>
          <div class="stat-label">全部任务</div>
        </div>
      </div>

      <div class="download-list" id="download-list">
        <div class="empty-state" id="download-empty">
          <div class="empty-state-icon">📦</div>
          <div class="empty-state-title">暂无下载任务</div>
          <div class="empty-state-desc">点击上方「添加下载」按钮，粘贴磁力链接或下载链接开始下载</div>
        </div>
      </div>
    `;

    document.getElementById('btn-add-download').onclick = addDownloadModal;
    document.getElementById('btn-purge').onclick = async () => {
      try {
        await API.purgeDownloads();
        showToast('已清理完成的任务', 'success');
        refreshDownloads();
      } catch (err) {
        showToast('清理失败: ' + err.message, 'error');
      }
    };

    await refreshDownloads();

    // Periodic refresh — only a fallback. When the WebSocket is connected it
    // already pushes status every 2s, so skip the poll to avoid double work.
    downloadRefreshTimer = setInterval(() => {
      if (wsConnection && wsConnection.readyState === 1) return;
      refreshDownloads();
    }, 3000);
  }

  async function refreshDownloads() {
    try {
      const res = await API.listDownloads();
      if (res) {
        // Backend returns: { active, waiting, stopped, stats }
        downloads = [
          ...(res.active || []),
          ...(res.waiting || []),
          ...(res.stopped || [])
        ];
        renderDownloadList();
        updateStats();
      }
    } catch (err) {
      // Silently fail on refresh
    }
  }

  function updateStats() {
    let totalDown = 0, totalUp = 0, activeCount = 0;
    downloads.forEach(dl => {
      if (dl.status === 'active') {
        totalDown += Number(dl.downloadSpeed || 0);
        totalUp += Number(dl.uploadSpeed || 0);
        activeCount++;
      }
    });

    const el = (id) => document.getElementById(id);
    if (el('stat-download-speed')) el('stat-download-speed').textContent = formatSpeed(totalDown);
    if (el('stat-upload-speed')) el('stat-upload-speed').textContent = formatSpeed(totalUp);
    if (el('stat-active-count')) el('stat-active-count').textContent = activeCount;
    if (el('stat-total-count')) el('stat-total-count').textContent = downloads.length;
  }

  // One delegated click handler for all download action buttons (so cards can
  // be updated/created in place without re-binding).
  function ensureDownloadDelegation(container) {
    if (container._mfBound) return;
    container._mfBound = true;
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn || !container.contains(btn)) return;
      e.stopPropagation();
      handleDownloadAction(btn.dataset.action, btn.dataset.gid);
    });
  }

  function dlVars(dl) {
    const totalLength = Number(dl.totalLength || 0);
    const completedLength = Number(dl.completedLength || 0);
    const percent = totalLength > 0 ? Math.round((completedLength / totalLength) * 100) : 0;
    const status = dl.status || 'unknown';
    const isActive = status === 'active';
    const canToggle = isActive || status === 'paused' || status === 'waiting';
    return { totalLength, completedLength, percent, status, isActive, canToggle, speed: Number(dl.downloadSpeed || 0) };
  }
  function dlActionsHtml(dl, v) {
    return `${v.canToggle ? `<button class="btn-icon" data-action="${v.isActive ? 'pause' : 'resume'}" data-gid="${dl.gid}" title="${v.isActive ? '暂停' : '继续'}">${v.isActive ? '⏸️' : '▶️'}</button>` : ''}${(dl.bittorrent && v.status !== 'complete' && v.status !== 'error') ? `<button class="btn-icon" data-action="files" data-gid="${dl.gid}" title="选择文件">📂</button>` : ''}<button class="btn-icon danger" data-action="remove" data-gid="${dl.gid}" title="删除">🗑️</button>`;
  }
  function dlStatsHtml(dl, v) {
    return `<span class="download-stat"><span>进度</span> <strong>${formatBytes(v.completedLength)} / ${formatBytes(v.totalLength)}</strong></span>${v.isActive ? `<span class="download-stat"><span>速度</span> <strong>${formatSpeed(v.speed)}</strong></span>` : ''}${v.isActive ? `<span class="download-stat"><span>连接</span> <strong>${Number(dl.connections) || 0}</strong></span>` : ''}${(v.isActive && dl.bittorrent) ? `<span class="download-stat"><span>做种</span> <strong class="${(Number(dl.numSeeders) || 0) > 0 ? 'text-success' : 'text-danger'}">${dl.numSeeders != null ? dl.numSeeders : '?'}</strong></span>` : ''}`;
  }
  function dlMetaRightHtml(dl, v) {
    return `<span class="download-percentage">${v.percent}%</span>${getStatusBadge(v.status)}`;
  }

  function renderDownloadCard(dl) {
    const v = dlVars(dl);
    return `
      <div class="download-card" data-gid="${dl.gid}">
        <div class="download-header">
          <div class="download-name">${escapeHtml(extractFileName(dl))}</div>
          <div class="download-actions">${dlActionsHtml(dl, v)}</div>
        </div>
        <div class="download-progress">
          <div class="progress-bar"><div class="progress-fill ${v.isActive ? 'active' : ''}" style="width:${v.percent}%"></div></div>
        </div>
        <div class="download-meta">
          <div class="download-stats">${dlStatsHtml(dl, v)}</div>
          <div class="download-meta-right flex items-center gap-8">${dlMetaRightHtml(dl, v)}</div>
        </div>
      </div>`;
  }

  // In-place update of an existing card — only changed values are written, so
  // the list does NOT flicker; only the progress bar animates.
  function updateDownloadCard(card, dl) {
    const v = dlVars(dl);
    const fill = card.querySelector('.progress-fill');
    if (fill) { fill.style.width = v.percent + '%'; fill.classList.toggle('active', v.isActive); }
    const nameEl = card.querySelector('.download-name');
    const name = escapeHtml(extractFileName(dl));
    if (nameEl && nameEl.innerHTML !== name) nameEl.innerHTML = name;
    const statsEl = card.querySelector('.download-stats');
    if (statsEl) { const h = dlStatsHtml(dl, v); if (statsEl.innerHTML !== h) statsEl.innerHTML = h; }
    const metaR = card.querySelector('.download-meta-right');
    if (metaR) { const h = dlMetaRightHtml(dl, v); if (metaR.innerHTML !== h) metaR.innerHTML = h; }
    const actEl = card.querySelector('.download-actions');
    if (actEl) {
      const stateKey = (v.canToggle ? (v.isActive ? 'p' : 'r') : 'n') + (dl.bittorrent && v.status !== 'complete' && v.status !== 'error' ? 'f' : '');
      if (actEl.dataset.state !== stateKey) { actEl.innerHTML = dlActionsHtml(dl, v); actEl.dataset.state = stateKey; }
    }
  }

  function renderDownloadList() {
    const container = document.getElementById('download-list');
    if (!container) return;
    ensureDownloadDelegation(container);

    if (!downloads.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📦</div>
          <div class="empty-state-title">暂无下载任务</div>
          <div class="empty-state-desc">点击上方「添加下载」按钮，粘贴磁力链接或下载链接开始下载</div>
        </div>`;
      return;
    }
    const emptyEl = container.querySelector('.empty-state');
    if (emptyEl) emptyEl.remove();

    const order = { active: 0, waiting: 1, paused: 2, complete: 3, error: 4, removed: 5 };
    const sorted = [...downloads].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

    const seen = new Set();
    let anchor = null; // last positioned card
    sorted.forEach((dl) => {
      seen.add(dl.gid);
      let card = container.querySelector(`.download-card[data-gid="${CSS.escape(dl.gid)}"]`);
      if (!card) {
        const tmp = document.createElement('div');
        tmp.innerHTML = renderDownloadCard(dl).trim();
        card = tmp.firstElementChild;
      } else {
        updateDownloadCard(card, dl);
      }
      const ref = anchor ? anchor.nextElementSibling : container.firstElementChild;
      if (ref !== card) container.insertBefore(card, ref);
      anchor = card;
    });
    container.querySelectorAll('.download-card').forEach((card) => {
      if (!seen.has(card.dataset.gid)) card.remove();
    });
  }

  function getStatusBadge(status) {
    const map = {
      active: '<span class="badge badge-active">下载中</span>',
      waiting: '<span class="badge badge-waiting">等待中</span>',
      paused: '<span class="badge badge-paused">已暂停</span>',
      complete: '<span class="badge badge-complete">已完成</span>',
      error: '<span class="badge badge-error">出错</span>',
      removed: '<span class="badge badge-waiting">已移除</span>',
    };
    return map[status] || `<span class="badge badge-waiting">${escapeHtml(status)}</span>`;
  }

  async function handleDownloadAction(action, gid) {
    if (action === 'files') { selectFilesModal(gid); return; }
    try {
      switch (action) {
        case 'pause':
          await API.pauseDownload(gid);
          showToast('已暂停', 'info');
          break;
        case 'resume':
          await API.resumeDownload(gid);
          showToast('已继续', 'info');
          break;
        case 'remove':
          await API.removeDownload(gid);
          showToast('已删除', 'success');
          break;
      }
      refreshDownloads();
    } catch (err) {
      showToast('操作失败: ' + err.message, 'error');
    }
  }


  async function selectFilesModal(gid) {
    let st;
    try {
      st = await API.getDownloadFiles(gid);
    } catch (e) {
      showToast('获取文件列表失败: ' + e.message, 'error');
      return;
    }
    const files = (st && st.files) || [];
    if (!files.length) {
      showToast('该任务尚无文件信息（可能还在获取元数据）', 'warning');
      return;
    }
    const rows = files.map((f) => {
      const idx = f.index;
      const nm = (f.path || '').split('/').pop() || ('文件 ' + idx);
      const sz = formatBytes(Number(f.length || 0));
      const checked = f.selected === 'true' ? 'checked' : '';
      return `<label class="file-pick">
        <input type="checkbox" class="fp-cb" value="${idx}" ${checked}>
        <span class="fp-name">${escapeHtml(nm)}</span>
        <span class="fp-size">${sz}</span>
      </label>`;
    }).join('');
    const body = `
      <div class="flex gap-8" style="margin-bottom:10px">
        <button class="btn-secondary btn-sm" id="fp-all">全选</button>
        <button class="btn-secondary btn-sm" id="fp-none">全不选</button>
      </div>
      <div class="file-pick-list">${rows}</div>`;
    const footer = `
      <button class="btn-secondary" onclick="window._hideModal()">取消</button>
      <button class="btn-primary" id="fp-apply">应用</button>`;
    showModal('选择下载文件', body, footer);

    document.getElementById('fp-all').onclick = () => document.querySelectorAll('.fp-cb').forEach((c) => { c.checked = true; });
    document.getElementById('fp-none').onclick = () => document.querySelectorAll('.fp-cb').forEach((c) => { c.checked = false; });
    document.getElementById('fp-apply').onclick = async () => {
      const idx = Array.from(document.querySelectorAll('.fp-cb:checked')).map((c) => Number(c.value));
      if (!idx.length) { showToast('请至少选择一个文件', 'warning'); return; }
      try {
        await API.selectDownloadFiles(gid, idx);
        showToast('已更新下载文件选择', 'success');
        hideModal();
        refreshDownloads();
      } catch (e) {
        showToast('设置失败: ' + e.message, 'error');
      }
    };
  }


  /* ══════════════════════════════════════════════════════
     File Manager Page
     ══════════════════════════════════════════════════════ */

  async function renderFileManager(path) {
    path = path || '';
    const main = document.getElementById('main-content');

    main.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">📁 文件管理</h1>
      </div>

      <div class="breadcrumb" id="file-breadcrumb"></div>

      <div class="file-toolbar" id="file-toolbar">
        <button class="btn-primary btn-sm" id="btn-new-folder">📂 新建文件夹</button>
        <button class="btn-secondary btn-sm" id="btn-delete-selected" disabled>🗑️ 删除选中</button>
        <input type="search" id="file-search" class="form-input file-search" placeholder="🔍 搜索当前目录…">
      </div>

      <div id="file-content">
        <div class="empty-state">
          <div class="empty-state-icon">⏳</div>
          <div class="empty-state-title">加载中…</div>
        </div>
      </div>
    `;

    renderBreadcrumb(path);

    document.getElementById('btn-new-folder').onclick = () => newFolderModal(path);

    try {
      const res = await API.listFiles(path);
      if (res && res.items) {
        renderFileTable(res.items, path);
      } else {
        document.getElementById('file-content').innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📂</div>
            <div class="empty-state-title">空文件夹</div>
            <div class="empty-state-desc">此目录下暂无文件</div>
          </div>
        `;
      }
    } catch (err) {
      document.getElementById('file-content').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">❌</div>
          <div class="empty-state-title">加载失败</div>
          <div class="empty-state-desc">${escapeHtml(err.message)}</div>
        </div>
      `;
    }
  }

  function renderBreadcrumb(path) {
    const container = document.getElementById('file-breadcrumb');
    if (!container) return;

    let html = `<span class="breadcrumb-item" data-path="">🏠 根目录</span>`;

    if (path) {
      const segments = path.split('/').filter(Boolean);
      let accumulated = '';
      segments.forEach((seg, i) => {
        accumulated += (accumulated ? '/' : '') + seg;
        html += `<span class="breadcrumb-sep">›</span>`;
        if (i === segments.length - 1) {
          html += `<span class="breadcrumb-item current">${escapeHtml(seg)}</span>`;
        } else {
          html += `<span class="breadcrumb-item" data-path="${escapeHtml(accumulated)}">${escapeHtml(seg)}</span>`;
        }
      });
    }

    container.innerHTML = html;

    container.querySelectorAll('.breadcrumb-item:not(.current)').forEach(item => {
      item.onclick = () => {
        window.location.hash = '#files/' + encodeURIComponent(item.dataset.path || '');
      };
    });
  }

  function renderFileTable(files, currentPath) {
    const content = document.getElementById('file-content');

    // Backend returns `isDirectory`; the rest of this view uses `isDir`.
    // Normalize so directory detection (icon, size, navigation) works.
    const normalized = files.map(f => ({
      ...f,
      isDir: (typeof f.isDirectory === 'boolean' ? f.isDirectory : f.isDir) === true,
    }));

    // Sort: directories first, then by name
    const sorted = normalized.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    content.innerHTML = `
      <div class="table-wrap">
      <table class="file-table">
        <thead>
          <tr>
            <th width="40"><input type="checkbox" id="selectAll"></th>
            <th width="40"></th>
            <th>名称</th>
            <th width="100">大小</th>
            <th width="150" class="col-date">修改时间</th>
            <th width="150">操作</th>
          </tr>
        </thead>
        <tbody id="file-tbody">
          ${sorted.map(f => {
            const pathStr = escapeHtml(f.relativePath);
            const nameStr = escapeHtml(f.name);
            const icon = getFileIcon(f.name, f.isDir);
            const sizeStr = f.isDir ? '--' : formatBytes(f.size);
            const dateStr = formatDate(f.modified);
            
            return `
              <tr class="file-row" data-path="${pathStr}" data-name="${nameStr}" data-isdir="${f.isDir}">
                <td onclick="event.stopPropagation()"><input type="checkbox" class="file-cb" value="${pathStr}"></td>
                <td class="text-center">${icon}</td>
                <td class="file-name-cell" title="${nameStr}"><span class="fname">${nameStr}</span></td>
                <td class="text-muted">${sizeStr}</td>
                <td class="text-muted col-date">${dateStr}</td>
                <td onclick="event.stopPropagation()">
                  <div class="flex gap-4 file-actions-inline">
                    <button class="btn-icon" title="上传到网盘" data-action="upload" data-path="${pathStr}" data-name="${nameStr}">${ACTION_ICONS.upload}</button>
                    ${!f.isDir && isArchiveFile(f.name) ? `<button class="btn-icon" title="解压" data-action="extract" data-path="${pathStr}">${ACTION_ICONS.extract}</button>` : ''}
                    <button class="btn-icon" title="复制" data-action="copy" data-path="${pathStr}" data-name="${nameStr}">${ACTION_ICONS.copy}</button>
                    <button class="btn-icon" title="移动 / 重命名" data-action="move" data-path="${pathStr}" data-name="${nameStr}">${ACTION_ICONS.move}</button>
                    <button class="btn-icon danger" title="删除" data-action="delete" data-path="${pathStr}" data-name="${nameStr}">${ACTION_ICONS.delete}</button>
                  </div>
                  <button class="btn-icon file-more" title="操作" data-action="more" data-path="${pathStr}" data-name="${nameStr}" data-archive="${!f.isDir && isArchiveFile(f.name)}">⋯</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      </div>
    `;

    // Row click navigation
    document.querySelectorAll('.file-row').forEach(row => {
      row.onclick = async () => {
        const p = row.dataset.path;
        const isDir = row.dataset.isdir === 'true';
        if (isDir) {
          window.location.hash = '#files/' + encodeURIComponent(p);
        } else if (isVideoFile(p) || isAudioFile(p)) {
          window.location.hash = '#player/' + encodeURIComponent(p);
        } else {
          // Trigger download/open for other files. Open the tab synchronously
          // (within the click gesture) to avoid popup blocking, then navigate
          // it once the scoped stream token is fetched.
          const w = window.open('', '_blank');
          const url = await API.getStreamUrl(p);
          if (w) w.location = url;
          else window.location = url;
        }
      };
    });

    // Checkbox select all
    const selectAll = document.getElementById('selectAll');
    const checkboxes = document.querySelectorAll('.file-cb');
    const btnDeleteSel = document.getElementById('btn-delete-selected');

    const updateDeleteBtn = () => {
      const count = document.querySelectorAll('.file-cb:checked').length;
      btnDeleteSel.disabled = count === 0;
      btnDeleteSel.innerHTML = count > 0 ? `🗑️ 删除选中 (${count})` : '🗑️ 删除选中';
    };

    if (selectAll) {
      selectAll.onchange = (e) => {
        checkboxes.forEach(cb => cb.checked = e.target.checked);
        updateDeleteBtn();
      };
    }

    checkboxes.forEach(cb => {
      cb.onchange = updateDeleteBtn;
    });

    btnDeleteSel.onclick = async () => {
      const selected = Array.from(document.querySelectorAll('.file-cb:checked')).map(cb => cb.value);
      if (!selected.length) return;
      confirmDeleteModal('已选中的 ' + selected.length + ' 个文件', '多文件', async () => {
        for (const p of selected) {
          try { await API.deleteFile(p); } catch (e) { /* ignore individual errs */ }
        }
        renderFileManager(currentPath);
      });
    };

    // File actions: inline buttons (desktop) + a "⋯" menu (mobile).
    const refreshFM = () => renderFileManager(currentPath);
    async function handleFileAction(action, p, name) {
      if (action === 'delete') {
        confirmDeleteModal(p, name, refreshFM);
      } else if (action === 'copy') {
        copyFileModal(p, name, refreshFM);
      } else if (action === 'move') {
        moveFileModal(p, name, refreshFM);
      } else if (action === 'upload') {
        uploadToRemoteModal(p, name);
      } else if (action === 'extract') {
        try {
          showToast('开始解压...', 'info');
          const res = await API.extractArchive(p);
          showToast('解压成功: ' + res.outputDir, 'success');
          refreshFM();
        } catch (err) {
          showToast('解压失败: ' + err.message, 'error');
        }
      }
    }

    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const p = btn.dataset.path;
        const name = btn.dataset.name;
        if (action === 'more') {
          fileActionsMenu(p, name, btn.dataset.archive === 'true', handleFileAction);
        } else {
          handleFileAction(action, p, name);
        }
      };
    });

    // Live search filter for the current directory.
    const searchEl = document.getElementById('file-search');
    if (searchEl) {
      searchEl.oninput = () => {
        const q = searchEl.value.trim().toLowerCase();
        document.querySelectorAll('#file-content .file-row').forEach(r => {
          const n = (r.dataset.name || '').toLowerCase();
          r.style.display = (!q || n.includes(q)) ? '' : 'none';
        });
      };
    }
  }


  /* ══════════════════════════════════════════════════════
     Video Player Page
     ══════════════════════════════════════════════════════ */

  async function renderPlayer(filePath) {
    const main = document.getElementById('main-content');
    const name = filePath.split('/').pop();
    const parentDir = filePath.split('/').slice(0, -1).join('/');
    const isAudio = isAudioFile(name);

    const playerHtml = isAudio
      ? `<div class="audio-player">
           <div class="audio-art">🎵</div>
           <div class="audio-name">${escapeHtml(name)}</div>
           <audio id="video-player" controls autoplay preload="auto" style="width:100%"></audio>
         </div>`
      : `<div class="player-container">
           <video id="video-player" controls preload="auto" width="100%" crossorigin="anonymous"
                  playsinline webkit-playsinline x5-playsinline x5-video-player-type="h5-page">
             您的浏览器不支持 Video 标签。
           </video>
         </div>`;

    main.innerHTML = `
      <div class="page-header flex gap-16 items-center">
        <button class="btn-icon" id="btn-player-back" title="返回">⬅️</button>
        <h1 class="page-title" style="margin:0;font-size:1.1rem">${escapeHtml(name)}</h1>
      </div>

      ${playerHtml}

      <div class="settings-card" style="margin-top:24px">
        <div class="settings-row">
          <span class="settings-label">文件路径</span>
          <span class="settings-value">${escapeHtml(filePath)}</span>
        </div>
      </div>
    `;

    document.getElementById('btn-player-back').onclick = () => {
      window.location.hash = '#files/' + encodeURIComponent(parentDir);
    };

    const video = document.getElementById('video-player');
    const streamUrl = await API.getStreamUrl(filePath);

    if (!isAudio && filePath.endsWith('.m3u8')) {
      if (Hls.isSupported()) {
        hlsInstance = new Hls();
        hlsInstance.loadSource(streamUrl);
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(()=>{});
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl;
      }
    } else {
      video.src = streamUrl;
    }
  }

  /* ══════════════════════════════════════════════════════
     Netdisk (cloud browser, Alist-style)
     ══════════════════════════════════════════════════════ */

  function netEmpty(icon, title, desc) {
    return `<div class="empty-state"><div class="empty-state-icon">${icon}</div>
      <div class="empty-state-title">${escapeHtml(title)}</div>
      ${desc ? `<div class="empty-state-desc">${escapeHtml(desc)}</div>` : ''}</div>`;
  }

  function netSkeleton() {
    return `<div class="skeleton-list">${Array.from({ length: 7 }).map(() => '<div class="skeleton-row"></div>').join('')}</div>`;
  }

  // Colour-coded file-type SVG icons (consistent with the rest of the UI).
  const FT_ICONS = {
    folder: SVG('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    video: SVG('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>'),
    audio: SVG('<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>'),
    image: SVG('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>'),
    archive: SVG('<path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M10 12h4"/>'),
    doc: SVG('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/>'),
    file: SVG('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
    cloud: SVG('<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.96A6 6 0 0 0 6.4 9 4.5 4.5 0 0 0 7 18h10.5Z"/>'),
    list: SVG('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    grid: SVG('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  };
  function ftType(name, isDir) {
    if (isDir) return 'folder';
    const e = getExtension(name);
    if (VIDEO_EXTS.has(e)) return 'video';
    if (AUDIO_EXTS.has(e)) return 'audio';
    if (IMAGE_EXTS.has(e)) return 'image';
    if (ARCHIVE_EXTS.has(e)) return 'archive';
    if (DOC_EXTS.has(e)) return 'doc';
    return 'file';
  }
  function ftIcon(name, isDir) {
    const t = ftType(name, isDir);
    return `<span class="ftype ftype-${t}">${FT_ICONS[t]}</span>`;
  }
  function providerLabel(t) {
    return ({ onedrive: 'OneDrive', drive: 'Google Drive', dropbox: 'Dropbox', s3: 'S3', b2: 'Backblaze', webdav: 'WebDAV', ftp: 'FTP', sftp: 'SFTP', mega: 'MEGA' })[t] || (t || '');
  }
  function remoteCardHtml(info) {
    let cap = '';
    if (info.total) {
      const pct = Math.min(100, Math.round((Number(info.used || 0) / Number(info.total)) * 100));
      cap = `<div class="remote-cap"><div class="remote-cap-bar"><div class="remote-cap-fill" style="width:${pct}%"></div></div>
        <div class="remote-cap-text">${formatBytes(info.used)} / ${formatBytes(info.total)}</div></div>`;
    }
    const label = providerLabel(info.type);
    return `<button class="remote-card" data-remote="${escapeHtml(info.name)}">
      <span class="remote-card-icon ftype-cloud">${FT_ICONS.cloud}</span>
      <span class="remote-card-name">${escapeHtml(info.name)}</span>
      ${label ? `<span class="remote-card-type">${escapeHtml(label)}</span>` : ''}
      ${cap}
    </button>`;
  }

  function netList(items) {
    const rows = items.map((f) => `
      <tr class="file-row" data-nd-open data-path="${escapeHtml(f.path)}" data-isdir="${f.isDir}" data-name="${escapeHtml(f.name)}">
        <td class="text-center">${ftIcon(f.name, f.isDir)}</td>
        <td class="file-name-cell" title="${escapeHtml(f.name)}"><span class="fname">${escapeHtml(f.name)}</span></td>
        <td class="text-muted">${f.isDir ? '--' : formatBytes(f.size)}</td>
        <td class="text-muted col-date">${f.modified ? formatDate(f.modified) : '--'}</td>
        <td onclick="event.stopPropagation()"><button class="btn-icon" data-nd-more data-path="${escapeHtml(f.path)}" data-isdir="${f.isDir}" data-name="${escapeHtml(f.name)}">⋯</button></td>
      </tr>`).join('');
    return `<div class="table-wrap"><table class="file-table">
      <thead><tr><th width="40"></th><th>名称</th><th width="100">大小</th><th width="150" class="col-date">修改时间</th><th width="48"></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }
  function netGrid(items) {
    return `<div class="net-grid">${items.map((f) => `
      <div class="net-cell" data-nd-open data-path="${escapeHtml(f.path)}" data-isdir="${f.isDir}" data-name="${escapeHtml(f.name)}">
        <button class="net-cell-more" data-nd-more data-path="${escapeHtml(f.path)}" data-isdir="${f.isDir}" data-name="${escapeHtml(f.name)}">⋯</button>
        <div class="net-cell-icon">${ftIcon(f.name, f.isDir)}</div>
        <div class="net-cell-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
        <div class="net-cell-size">${f.isDir ? '文件夹' : formatBytes(f.size)}</div>
      </div>`).join('')}</div>`;
  }

  function openLightbox(url, name) {
    let lb = document.getElementById('lightbox');
    if (!lb) { lb = document.createElement('div'); lb.id = 'lightbox'; lb.className = 'lightbox'; document.body.appendChild(lb); }
    lb.innerHTML = `<div class="lightbox-bar"><span class="truncate">${escapeHtml(name)}</span><button class="lightbox-close">✕</button></div><img class="lightbox-img" src="${url}" alt="">`;
    lb.classList.add('show');
    const close = () => lb.classList.remove('show');
    lb.querySelector('.lightbox-close').onclick = close;
    lb.onclick = (e) => { if (e.target === lb) close(); };
  }

  function netMkdirModal(remote, relPath, refresh) {
    showModal('新建文件夹',
      `<div class="form-group" style="margin-bottom:0"><label class="form-label">文件夹名称</label>
        <input type="text" id="nd-folder" class="form-input" placeholder="新建文件夹" autofocus></div>`,
      `<button class="btn-secondary" onclick="window._hideModal()">取消</button><button class="btn-primary" id="nd-mk-ok">创建</button>`);
    document.getElementById('nd-mk-ok').onclick = async () => {
      const name = document.getElementById('nd-folder').value.trim();
      if (!name) { showToast('请输入名称', 'warning'); return; }
      try {
        await API.mkdirRemote(remote, relPath ? relPath + '/' + name : name);
        showToast('文件夹已创建', 'success');
        hideModal();
        refresh && refresh();
      } catch (e) { showToast('创建失败: ' + e.message, 'error'); }
    };
  }

  function cloudActionsMenu(remote, f, refresh) {
    const items = [
      ...(f.isDir ? [] : [{ a: 'download', t: '⬇️ 下载' }, { a: 'link', t: '🔗 复制直链' }]),
      { a: 'delete', t: '🗑️ 删除', danger: true },
    ];
    showModal(f.name,
      `<div class="action-menu">${items.map((i) => `<button class="action-menu-item${i.danger ? ' danger' : ''}" data-act="${i.a}">${i.t}</button>`).join('')}</div>`, '');
    document.querySelectorAll('.action-menu-item').forEach((b) => {
      b.onclick = async () => {
        const act = b.dataset.act;
        hideModal();
        if (act === 'download') {
          const w = window.open('', '_blank');
          const url = await API.getRemoteStreamUrl(remote, f.path);
          if (w) w.location = url; else window.location = url;
        } else if (act === 'link') {
          const abs = location.origin + (await API.getRemoteStreamUrl(remote, f.path));
          try { await navigator.clipboard.writeText(abs); showToast('直链已复制（约 15 分钟有效）', 'success'); }
          catch { showModal('直链', `<input class="form-input" value="${escapeHtml(abs)}" onclick="this.select()" readonly>`, `<button class="btn-secondary" onclick="window._hideModal()">关闭</button>`); }
        } else if (act === 'delete') {
          showModal('删除',
            `<p style="color:var(--text-secondary);font-size:0.9rem">确定从网盘删除 <strong style="color:var(--text-primary)">${escapeHtml(f.name)}</strong> 吗？<br><span class="text-danger text-xs">云端文件将被删除，不可恢复。</span></p>`,
            `<button class="btn-secondary" onclick="window._hideModal()">取消</button><button class="btn-danger" id="nd-del-ok">删除</button>`);
          document.getElementById('nd-del-ok').onclick = async () => {
            try { await API.deleteRemote(remote, f.path, f.isDir); hideModal(); showToast('已删除', 'success'); refresh && refresh(); }
            catch (e) { showToast('删除失败: ' + e.message, 'error'); }
          };
        }
      };
    });
  }

  async function renderNetdisk(param) {
    const main = document.getElementById('main-content');
    const slash = param.indexOf('/');
    const remote = slash === -1 ? param : param.slice(0, slash);
    const relPath = slash === -1 ? '' : decodeURIComponent(param.slice(slash + 1));

    main.innerHTML = `
      <div class="page-header"><h1 class="page-title">☁️ 网盘</h1></div>
      <div id="netdisk-content">${netSkeleton()}</div>`;
    const content = document.getElementById('netdisk-content');

    let names = [];
    try { names = ((await API.listRemotes()).remotes) || []; }
    catch (err) { content.innerHTML = netEmpty('❌', '加载失败', err.message); return; }
    if (!names.length) { content.innerHTML = netEmpty('☁️', '尚未连接网盘', '请先在服务器用 rclone 连接 OneDrive / Google Drive'); return; }

    // Remote picker (with provider icon + capacity)
    if (!remote || !names.includes(remote)) {
      let infos = names.map((n) => ({ name: n, type: '', total: null, used: null }));
      try { const r = await API.remotesInfo(); if (r && r.remotes && r.remotes.length) infos = r.remotes; } catch { /* ignore */ }
      content.innerHTML = `<div class="remote-grid">${infos.map(remoteCardHtml).join('')}</div>`;
      content.querySelectorAll('.remote-card').forEach((b) => {
        b.onclick = () => { window.location.hash = '#netdisk/' + encodeURIComponent(b.dataset.remote); };
      });
      return;
    }

    let data;
    try { data = await API.browseRemote(remote, relPath); }
    catch (err) { content.innerHTML = netEmpty('❌', '无法读取该网盘目录', err.message); return; }

    const view = localStorage.getItem('mf_netview') === 'grid' ? 'grid' : 'list';
    const refresh = () => renderNetdisk(param);

    const segs = relPath ? relPath.split('/') : [];
    let acc = '';
    const crumbs = [`<span class="breadcrumb-item" data-go="">🏠 ${escapeHtml(remote)}</span>`];
    segs.forEach((s, i) => {
      acc = acc ? acc + '/' + s : s;
      crumbs.push('<span class="breadcrumb-sep">/</span>');
      crumbs.push(i === segs.length - 1
        ? `<span class="breadcrumb-item current">${escapeHtml(s)}</span>`
        : `<span class="breadcrumb-item" data-go="${escapeHtml(acc)}">${escapeHtml(s)}</span>`);
    });

    content.innerHTML = `
      <div class="file-toolbar netdisk-toolbar">
        <select id="netdisk-remote" class="form-select" style="max-width:170px">${names.map((n) => `<option value="${escapeHtml(n)}"${n === remote ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select>
        <button class="btn-secondary btn-sm" id="nd-mkdir">📂 新建文件夹</button>
        <div class="view-toggle">
          <button class="vt-btn ${view === 'list' ? 'active' : ''}" data-view="list" title="列表">${FT_ICONS.list}</button>
          <button class="vt-btn ${view === 'grid' ? 'active' : ''}" data-view="grid" title="网格">${FT_ICONS.grid}</button>
        </div>
      </div>
      <div class="breadcrumb" id="netdisk-breadcrumb">${crumbs.join('')}</div>
      ${data.items.length ? (view === 'grid' ? netGrid(data.items) : netList(data.items)) : netEmpty('📂', '空文件夹')}`;

    document.getElementById('netdisk-remote').onchange = (e) => { window.location.hash = '#netdisk/' + encodeURIComponent(e.target.value); };
    document.getElementById('nd-mkdir').onclick = () => netMkdirModal(remote, relPath, refresh);
    content.querySelectorAll('.vt-btn').forEach((b) => { b.onclick = () => { localStorage.setItem('mf_netview', b.dataset.view); renderNetdisk(param); }; });
    content.querySelectorAll('#netdisk-breadcrumb .breadcrumb-item[data-go]').forEach((el) => {
      el.onclick = () => { const go = el.getAttribute('data-go'); window.location.hash = '#netdisk/' + encodeURIComponent(remote) + (go ? '/' + encodeURIComponent(go) : ''); };
    });

    const openItem = async (p, isDir, name) => {
      if (isDir) { window.location.hash = '#netdisk/' + encodeURIComponent(remote) + '/' + encodeURIComponent(p); return; }
      if (isVideoFile(name) || isAudioFile(name)) { window.location.hash = '#netplay/' + encodeURIComponent(remote) + '/' + encodeURIComponent(p); return; }
      if (IMAGE_EXTS.has(getExtension(name))) { openLightbox(await API.getRemoteStreamUrl(remote, p), name); return; }
      const w = window.open('', '_blank');
      const url = await API.getRemoteStreamUrl(remote, p);
      if (w) w.location = url; else window.location = url;
    };
    content.querySelectorAll('[data-nd-open]').forEach((el) => {
      el.onclick = () => openItem(el.dataset.path, el.dataset.isdir === 'true', el.dataset.name);
    });
    content.querySelectorAll('[data-nd-more]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        cloudActionsMenu(remote, { path: btn.dataset.path, name: btn.dataset.name, isDir: btn.dataset.isdir === 'true' }, refresh);
      };
    });
  }

  async function renderNetMediaPlayer(param) {
    const main = document.getElementById('main-content');
    const slash = param.indexOf('/');
    const remote = slash === -1 ? param : param.slice(0, slash);
    const filePath = slash === -1 ? '' : decodeURIComponent(param.slice(slash + 1));
    const name = filePath.split('/').pop();
    const parent = filePath.split('/').slice(0, -1).join('/');
    const kind = isAudioFile(name) ? 'audio' : 'video';

    const playerHtml = kind === 'audio'
      ? `<div class="audio-player">
           <div class="audio-art">🎵</div>
           <div class="audio-name">${escapeHtml(name)}</div>
           <audio id="net-media" controls autoplay style="width:100%"></audio>
         </div>`
      : `<div class="player-container"><video id="net-media" controls autoplay preload="auto" width="100%" playsinline webkit-playsinline x5-playsinline x5-video-player-type="h5-page"></video></div>`;

    main.innerHTML = `
      <div class="page-header flex gap-16 items-center">
        <button class="btn-icon" id="btn-net-back" title="返回">⬅️</button>
        <h1 class="page-title" style="margin:0;font-size:1.1rem">${escapeHtml(name)}</h1>
      </div>
      ${playerHtml}
      <div class="settings-card" style="margin-top:20px">
        <div class="settings-row"><span class="settings-label">网盘</span><span class="settings-value">${escapeHtml(remote)}</span></div>
        <div class="settings-row"><span class="settings-label">路径</span><span class="settings-value">${escapeHtml(filePath)}</span></div>
      </div>
    `;

    document.getElementById('btn-net-back').onclick = () => {
      window.location.hash = '#netdisk/' + encodeURIComponent(remote) + (parent ? '/' + encodeURIComponent(parent) : '');
    };

    const el = document.getElementById('net-media');
    const url = await API.getRemoteStreamUrl(remote, filePath);
    el.src = url;
  }



  /* ══════════════════════════════════════════════════════
     RSS Subscriptions
     ══════════════════════════════════════════════════════ */

  async function refreshRss() {
    const box = document.getElementById('rss-list');
    if (!box) return;
    let subs = [];
    try {
      const r = await API.listRss();
      subs = (r && r.subs) || [];
    } catch (e) {
      box.innerHTML = netEmpty('❌', '加载失败', e.message);
      return;
    }
    if (!subs.length) {
      box.innerHTML = netEmpty('📡', '暂无订阅', '点击右上角「添加订阅」,填入 RSS 链接');
      return;
    }
    box.innerHTML = subs.map((s) => `
      <div class="settings-card" style="margin-bottom:12px">
        <div class="flex flex-between items-center gap-12" style="flex-wrap:wrap">
          <div style="min-width:0;flex:1">
            <div class="font-semibold" style="word-break:break-all">${escapeHtml(s.name)} ${s.enabled ? '' : '<span class="badge badge-paused">已暂停</span>'}</div>
            <div class="text-muted text-xs" style="word-break:break-all;margin-top:3px">${escapeHtml(s.url)}</div>
            <div class="text-muted text-xs" style="margin-top:3px">
              过滤: ${s.filter ? escapeHtml(s.filter) : '全部'} ·
              ${s.lastCheck ? '上次: ' + formatDate(s.lastCheck) : '未检查'}
              ${s.lastError ? ' · <span class="text-danger">' + escapeHtml(s.lastError) + '</span>' : ''}
            </div>
          </div>
          <div class="flex gap-4" style="flex-shrink:0">
            <button class="btn-icon" title="立即检查" data-rss="check" data-id="${s.id}">🔄</button>
            <button class="btn-icon" title="${s.enabled ? '暂停' : '启用'}" data-rss="toggle" data-id="${s.id}">${s.enabled ? '⏸️' : '▶️'}</button>
            <button class="btn-icon danger" title="删除" data-rss="delete" data-id="${s.id}" data-name="${escapeHtml(s.name)}">🗑️</button>
          </div>
        </div>
      </div>`).join('');

    box.querySelectorAll('[data-rss]').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const act = btn.dataset.rss;
        try {
          if (act === 'check') {
            showToast('检查中…', 'info');
            const r = await API.checkRss(id);
            showToast(r.added ? `新增 ${r.added} 个下载` : '没有新内容', 'success');
          } else if (act === 'toggle') {
            await API.toggleRss(id);
          } else if (act === 'delete') {
            const nm = btn.dataset.name || '该订阅';
            showModal('删除订阅',
              `<p style="color:var(--text-secondary);font-size:0.9rem">确定删除订阅 <strong style="color:var(--text-primary)">${escapeHtml(nm)}</strong> 吗?</p>`,
              `<button class="btn-secondary" onclick="window._hideModal()">取消</button><button class="btn-danger" id="rss-del-ok">删除</button>`);
            document.getElementById('rss-del-ok').onclick = async () => {
              try { await API.deleteRss(id); hideModal(); showToast('已删除', 'success'); refreshRss(); }
              catch (e) { showToast('删除失败: ' + e.message, 'error'); }
            };
            return;
          }
          refreshRss();
        } catch (e) {
          showToast('操作失败: ' + e.message, 'error');
        }
      };
    });
  }

  function rssAddModal() {
    const body = `
      <div class="form-group"><label class="form-label">名称</label>
        <input type="text" id="rss-name" class="form-input" placeholder="例如 某追番源"></div>
      <div class="form-group"><label class="form-label">RSS 链接</label>
        <input type="text" id="rss-url" class="form-input" placeholder="https://..."></div>
      <div class="form-group" style="margin-bottom:0"><label class="form-label">过滤词(可选,关键词或正则)</label>
        <input type="text" id="rss-filter" class="form-input" placeholder="留空=全部,如 1080p 或 第.*集">
        <p class="form-hint">仅标题匹配的新条目会自动下载。添加时会以当前内容为基线,只对之后的新条目生效。</p></div>`;
    const footer = `<button class="btn-secondary" onclick="window._hideModal()">取消</button><button class="btn-primary" id="rss-save">添加</button>`;
    showModal('添加 RSS 订阅', body, footer);
    document.getElementById('rss-save').onclick = async () => {
      const url = document.getElementById('rss-url').value.trim();
      if (!url) { showToast('请填写 RSS 链接', 'warning'); return; }
      try {
        await API.addRss(document.getElementById('rss-name').value.trim(), url, document.getElementById('rss-filter').value.trim());
        showToast('订阅已添加', 'success');
        hideModal();
        refreshRss();
      } catch (e) {
        showToast('添加失败: ' + e.message, 'error');
      }
    };
  }


  /* ══════════════════════════════════════════════════════
     Settings Page
     ══════════════════════════════════════════════════════ */

  function renderAbout() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="page-header"><h1 class="page-title">📖 关于</h1></div>

      <div class="settings-section">
        <h2 class="settings-section-title">系统信息</h2>
        <div class="settings-card" id="system-info">
          <div class="settings-row"><span class="settings-label">平台</span><span class="settings-value" id="info-platform">加载中…</span></div>
          <div class="settings-row"><span class="settings-label">运行环境</span><span class="settings-value" id="info-node">加载中…</span></div>
          <div class="settings-row"><span class="settings-label">aria2 引擎</span><span class="settings-value" id="info-aria2">加载中…</span></div>
          <div class="settings-row"><span class="settings-label">运行状态</span><span class="settings-value text-success" id="info-status">运行中</span></div>
          <div class="settings-row"><span class="settings-label">运行时长</span><span class="settings-value" id="info-uptime">加载中…</span></div>
          <div class="settings-row"><span class="settings-label">版本</span><span class="settings-value" id="info-version">加载中…</span></div>
        </div>
      </div>

      <div class="settings-section">
        <h2 class="settings-section-title">关于</h2>
        <div class="settings-card about-card">
          <div class="about-head">
            <img class="about-logo" src="/img/logo.svg" alt="MagnetFlow">
            <div class="about-titles">
              <div class="about-name">MagnetFlow</div>
              <div class="about-tagline">自托管磁力下载 · 在线串流 · 文件管理</div>
            </div>
            <span class="about-version" id="about-version">v2.0.0</span>
          </div>
          <p class="about-desc">一个轻量、自托管的下载中心：粘贴磁力链接或下载地址即可交给 aria2 高速下载，支持边下边管、在线播放、网盘上传，并在完成后自动清理记录、保留文件。</p>
          <div class="about-features">
            <span class="about-chip">🧲 磁力 / 种子</span>
            <span class="about-chip">🎬 在线串流</span>
            <span class="about-chip">📁 文件管理</span>
            <span class="about-chip">☁️ 网盘上传</span>
            <span class="about-chip">📡 RSS 订阅</span>
            <span class="about-chip">🧹 自动清理</span>
          </div>
          <div class="about-footer">
            <span>Powered by Node.js · Express · aria2 · rclone</span>
            <span>© 2026 MagnetFlow · MIT License</span>
          </div>
        </div>
      </div>
    `;
    loadSystemInfo();
  }

  async function renderSettings() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">⚙️ 设置</h1>
      </div>

      <div class="settings-section">
        <h2 class="settings-section-title">安全设置</h2>
        <div class="settings-card">
          <form id="password-form">
            <div class="form-group">
              <label class="form-label" for="current-password">当前密码</label>
              <input type="password" id="current-password" class="form-input" placeholder="请输入当前密码" autocomplete="current-password" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="new-password">新密码</label>
              <input type="password" id="new-password" class="form-input" placeholder="请输入新密码" autocomplete="new-password" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="confirm-password">确认新密码</label>
              <input type="password" id="confirm-password" class="form-input" placeholder="请再次输入新密码" autocomplete="new-password" required>
            </div>
            <button type="submit" class="btn-primary">保存修改</button>
          </form>
        </div>
      </div>

      <div class="settings-section">
        <h2 class="settings-section-title">传输</h2>
        <div class="settings-card">
          <form id="aria2-form">
            <div class="form-group">
              <label class="form-label" for="ul-limit">全局上传速度限制</label>
              <input type="text" id="ul-limit" class="form-input" placeholder="留空或 0 = 不限；例如 1M、500K">
              <p class="form-hint">限制对外上传带宽。⚠️ 不要设为 0——BitTorrent 完全不上传会被对方限速，反而拖慢下载；建议留点余量（如 1M）。</p>
            </div>
            <button type="submit" class="btn-primary">保存</button>
          </form>
        </div>
      </div>

      <div class="settings-section">
        <h2 class="settings-section-title">下载完成后自动上传到网盘</h2>
        <div class="settings-card">
          <form id="autoupload-form">
            <label class="settings-toggle"><input type="checkbox" id="au-enabled"><span>启用：下载完成后自动上传到网盘（本地保留）</span></label>
            <div class="form-group">
              <label class="form-label" for="au-remote">目标网盘</label>
              <select id="au-remote" class="form-select"></select>
            </div>
            <div class="form-group">
              <label class="form-label" for="au-dest">目标文件夹（留空＝根目录）</label>
              <input type="text" id="au-dest" class="form-input" placeholder="例如 downloads">
            </div>
            <button type="submit" class="btn-primary">保存</button>
          </form>
        </div>
      </div>

      <div class="settings-section">
        <h2 class="settings-section-title">完成通知</h2>
        <div class="settings-card">
          <form id="notify-form">
            <div class="form-group"><label class="form-label">Telegram Bot Token</label>
              <input type="text" id="nf-tg-token" class="form-input" placeholder="如 123456:ABC-DEF…"></div>
            <div class="form-group"><label class="form-label">Telegram Chat ID</label>
              <input type="text" id="nf-tg-chat" class="form-input" placeholder="你的 chat id"></div>
            <div class="form-group"><label class="form-label">Bark 推送地址</label>
              <input type="text" id="nf-bark" class="form-input" placeholder="https://api.day.app/yourkey"></div>
            <button type="submit" class="btn-primary">保存</button>
            <p class="form-hint" style="margin-top:8px">填好后下载完成会推送通知；全部留空＝关闭。</p>
          </form>
        </div>
      </div>

      <div class="settings-section">
        <h2 class="settings-section-title" style="justify-content:space-between">
          <span>RSS 订阅</span>
          <button class="btn-primary btn-sm" id="rss-add-btn">＋ 添加</button>
        </h2>
        <p class="text-muted text-xs" style="margin:-6px 0 12px">每 15 分钟自动检查；标题匹配「过滤词」（关键词或正则，留空＝全部）的新条目自动下载。</p>
        <div id="rss-list">${netEmpty('⏳', '加载中…')}</div>
      </div>
    `;

    // Password form
    document.getElementById('password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPwd = document.getElementById('current-password').value;
      const newPwd = document.getElementById('new-password').value;
      const confirmPwd = document.getElementById('confirm-password').value;

      if (!currentPwd || !newPwd || !confirmPwd) {
        showToast('请填写所有字段', 'warning');
        return;
      }
      if (newPwd !== confirmPwd) {
        showToast('两次输入的新密码不一致', 'warning');
        return;
      }
      if (newPwd.length < 6) {
        showToast('新密码长度至少 6 位', 'warning');
        return;
      }

      try {
        await API.changePassword(currentPwd, newPwd);
        document.getElementById('password-form').reset();
        showToast('密码修改成功，请用新密码重新登录', 'success');
        setTimeout(() => API.logout(), 1500);
      } catch (err) {
        showToast('密码修改失败: ' + err.message, 'error');
      }
    });

    // Load current settings + remotes, then wire the auto-upload & notify forms
    let cfg = {};
    try { cfg = await API.getSettings(); } catch (e) { /* ignore */ }
    let remotes = [];
    try { const r = await API.listRemotes(); remotes = (r && r.remotes) || []; } catch (e) { /* ignore */ }

    const au = (cfg && cfg.autoUpload) || {};
    const auRemote = document.getElementById('au-remote');
    auRemote.innerHTML = '<option value="">（选择网盘）</option>' +
      remotes.map((r) => `<option value="${escapeHtml(r)}"${r === au.remote ? ' selected' : ''}>${escapeHtml(r)}</option>`).join('');
    document.getElementById('au-enabled').checked = !!au.enabled;
    document.getElementById('au-dest').value = au.dest || '';

    document.getElementById('autoupload-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const enabled = document.getElementById('au-enabled').checked;
      const remote = auRemote.value;
      const dest = document.getElementById('au-dest').value.trim();
      if (enabled && !remote) { showToast('请选择目标网盘', 'warning'); return; }
      try {
        await API.saveSettings({ autoUpload: { enabled, remote, dest } });
        showToast('自动上传设置已保存', 'success');
      } catch (err) { showToast('保存失败: ' + err.message, 'error'); }
    });

    const nf = (cfg && cfg.notify) || {};
    document.getElementById('nf-tg-token').value = nf.telegramToken || '';
    document.getElementById('nf-tg-chat').value = nf.telegramChat || '';
    document.getElementById('nf-bark').value = nf.barkUrl || '';
    document.getElementById('notify-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await API.saveSettings({ notify: {
          telegramToken: document.getElementById('nf-tg-token').value.trim(),
          telegramChat: document.getElementById('nf-tg-chat').value.trim(),
          barkUrl: document.getElementById('nf-bark').value.trim(),
        } });
        showToast('通知设置已保存', 'success');
      } catch (err) { showToast('保存失败: ' + err.message, 'error'); }
    });

    // RSS subscriptions
    document.getElementById('rss-add-btn').onclick = rssAddModal;
    refreshRss();

    // Upload speed limit
    document.getElementById('ul-limit').value = (cfg.aria2 && cfg.aria2.maxUploadLimit) || '';
    document.getElementById('aria2-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = document.getElementById('ul-limit').value.trim();
      try { await API.saveSettings({ aria2: { maxUploadLimit: v } }); showToast('上传限速已保存', 'success'); }
      catch (err) { showToast('保存失败: ' + err.message, 'error'); }
    });
  }

  function formatUptime(sec) {
    sec = Number(sec) || 0;
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const parts = [];
    if (d) parts.push(d + ' 天');
    if (h) parts.push(h + ' 小时');
    if (m) parts.push(m + ' 分');
    if (!d && !h) parts.push(s + ' 秒');
    return parts.join(' ');
  }

  async function loadSystemInfo() {
    const el = (id) => document.getElementById(id);
    const set = (id, val) => { const e = el(id); if (e) e.textContent = val; };
    try {
      const res = await API.getSystemInfo();
      if (!res) return;
      set('info-platform', res.platform || '未知');
      set('info-node', res.node ? 'Node ' + res.node : '未知');
      set('info-uptime', formatUptime(res.uptime));
      set('info-version', 'v' + (res.version || '?'));
      set('about-version', 'v' + (res.version || '?'));

      const aria2El = el('info-aria2');
      if (aria2El) {
        if (res.aria2) {
          aria2El.textContent = 'v' + res.aria2;
          aria2El.className = 'settings-value text-success';
        } else {
          aria2El.textContent = '未连接';
          aria2El.className = 'settings-value text-danger';
        }
      }
    } catch (e) {
      set('info-platform', '加载失败');
    }
  }


  /* ══════════════════════════════════════════════════════
     WebSocket
     ══════════════════════════════════════════════════════ */

  function connectWebSocket() {
    if (wsConnection && wsConnection.readyState <= 1) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;

    try {
      wsConnection = new WebSocket(wsUrl);
    } catch (e) {
      scheduleWsReconnect();
      return;
    }

    wsConnection.onopen = () => {
      wsReconnectDelay = 1000;
      // Authenticate
      if (API.token) {
        wsConnection.send(JSON.stringify({ type: 'auth', token: API.token }));
      }
    };

    wsConnection.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWsMessage(data);
      } catch (e) {
        // Ignore parse errors
      }
    };

    wsConnection.onclose = () => {
      scheduleWsReconnect();
    };

    wsConnection.onerror = () => {
      // Will trigger onclose
    };
  }

  function handleWsMessage(msg) {
    if (msg.type === 'downloads') {
      let active = [], waiting = [], stopped = [];
      if (msg.data) {
        if (Array.isArray(msg.data)) {
          // Fallback if data is array
          active = msg.data;
        } else {
          active = msg.data.active || [];
          waiting = msg.data.waiting || [];
          stopped = msg.data.stopped || [];
        }
      } else if (msg.downloads && Array.isArray(msg.downloads)) {
        active = msg.downloads;
      }
      
      downloads = [...active, ...waiting, ...stopped];

      if (currentPage === 'dashboard') {
        renderDownloadList();
        updateStats();
      }
    }
  }

  function scheduleWsReconnect() {
    if (wsReconnectTimer) return;
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      wsReconnectDelay = Math.min(wsReconnectDelay * 1.5, 30000);
      connectWebSocket();
    }, wsReconnectDelay);
  }


  /* ══════════════════════════════════════════════════════
     Mobile Sidebar
     ══════════════════════════════════════════════════════ */

  function setupMobileSidebar() {
    const hamburger = document.getElementById('btn-hamburger');
    const overlay = document.getElementById('sidebar-overlay');

    if (hamburger) {
      hamburger.onclick = () => toggleMobileSidebar();
    }
    if (overlay) {
      overlay.onclick = () => closeMobileSidebar();
    }
  }

  function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
    overlay.classList.toggle('hidden');
  }

  function closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
    if (!overlay.classList.contains('hidden')) {
      overlay.classList.add('hidden');
    }
  }


  /* ══════════════════════════════════════════════════════
     Initialization
     ══════════════════════════════════════════════════════ */

  function init() {
    // Hash routing
    window.addEventListener('hashchange', () => {
      navigate(window.location.hash);
    });

    // Logout button
    document.getElementById('btn-logout').addEventListener('click', () => {
      API.logout();
    });

    // Mobile sidebar
    setupMobileSidebar();

    // Initial auth check
    checkAuth();
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
