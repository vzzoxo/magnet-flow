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
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label" for="download-url-input">磁力链接 / 下载链接</label>
        <input type="text" id="download-url-input" class="form-input"
               placeholder="magnet:? / http(s):// / 或 40位 BT Hash" autofocus>
        <p class="form-hint">支持磁力链接、HTTP/HTTPS、纯 Hash 和 torrent 链接</p>
      </div>
    `;
    const footer = `
      <button class="btn-secondary" onclick="window._hideModal()">取消</button>
      <button class="btn-primary" id="btn-confirm-download">开始下载</button>
    `;
    showModal('添加下载', body, footer);

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
      case 'netplay':
        renderNetMediaPlayer(param || '');
        break;
      case 'player':
        renderPlayer(decodeURIComponent(param || ''));
        break;
      case 'settings':
        renderSettings();
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

  function renderDownloadList() {
    const container = document.getElementById('download-list');
    if (!container) return;

    if (!downloads.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📦</div>
          <div class="empty-state-title">暂无下载任务</div>
          <div class="empty-state-desc">点击上方「添加下载」按钮，粘贴磁力链接或下载链接开始下载</div>
        </div>
      `;
      return;
    }

    // Sort: active → waiting → paused → complete → error
    const order = { active: 0, waiting: 1, paused: 2, complete: 3, error: 4, removed: 5 };
    const sorted = [...downloads].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

    container.innerHTML = sorted.map(dl => renderDownloadCard(dl)).join('');

    // Bind action buttons
    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const gid = btn.dataset.gid;
        handleDownloadAction(action, gid);
      };
    });
  }

  function renderDownloadCard(dl) {
    const name = extractFileName(dl);
    const totalLength = Number(dl.totalLength || 0);
    const completedLength = Number(dl.completedLength || 0);
    const percent = totalLength > 0 ? Math.round((completedLength / totalLength) * 100) : 0;
    const speed = Number(dl.downloadSpeed || 0);
    const status = dl.status || 'unknown';

    const statusBadge = getStatusBadge(status);
    const isActive = status === 'active';
    const isPaused = status === 'paused' || status === 'waiting';
    const canToggle = isActive || isPaused;

    return `
      <div class="download-card" data-gid="${dl.gid}">
        <div class="download-header">
          <div class="download-name">${escapeHtml(name)}</div>
          <div class="download-actions">
            ${canToggle ? `
              <button class="btn-icon" data-action="${isActive ? 'pause' : 'resume'}" data-gid="${dl.gid}"
                      title="${isActive ? '暂停' : '继续'}">
                ${isActive ? '⏸️' : '▶️'}
              </button>
            ` : ''}
            <button class="btn-icon danger" data-action="remove" data-gid="${dl.gid}" title="删除">🗑️</button>
          </div>
        </div>
        <div class="download-progress">
          <div class="progress-bar">
            <div class="progress-fill ${isActive ? 'active' : ''}" style="width:${percent}%"></div>
          </div>
        </div>
        <div class="download-meta">
          <div class="download-stats">
            <span class="download-stat">
              <span>进度</span> <strong>${formatBytes(completedLength)} / ${formatBytes(totalLength)}</strong>
            </span>
            ${isActive ? `<span class="download-stat"><span>速度</span> <strong>${formatSpeed(speed)}</strong></span>` : ''}
            ${isActive ? `<span class="download-stat"><span>连接</span> <strong>${Number(dl.connections) || 0}</strong></span>` : ''}
            ${(isActive && dl.bittorrent) ? `<span class="download-stat"><span>做种</span> <strong class="${(Number(dl.numSeeders) || 0) > 0 ? 'text-success' : 'text-danger'}">${dl.numSeeders != null ? dl.numSeeders : '?'}</strong></span>` : ''}
          </div>
          <div class="flex items-center gap-8">
            <span class="download-percentage">${percent}%</span>
            ${statusBadge}
          </div>
        </div>
      </div>
    `;
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
      <table class="file-table">
        <thead>
          <tr>
            <th width="40"><input type="checkbox" id="selectAll"></th>
            <th width="40"></th>
            <th>名称</th>
            <th width="100">大小</th>
            <th width="150">修改时间</th>
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
                <td>${nameStr}</td>
                <td class="text-muted">${sizeStr}</td>
                <td class="text-muted">${dateStr}</td>
                <td onclick="event.stopPropagation()">
                  <div class="flex gap-4">
                    <button class="btn-icon" title="上传到网盘" data-action="upload" data-path="${pathStr}" data-name="${nameStr}">${ACTION_ICONS.upload}</button>
                    ${!f.isDir && isArchiveFile(f.name) ? `<button class="btn-icon" title="解压" data-action="extract" data-path="${pathStr}">${ACTION_ICONS.extract}</button>` : ''}
                    <button class="btn-icon" title="复制" data-action="copy" data-path="${pathStr}" data-name="${nameStr}">${ACTION_ICONS.copy}</button>
                    <button class="btn-icon" title="移动 / 重命名" data-action="move" data-path="${pathStr}" data-name="${nameStr}">${ACTION_ICONS.move}</button>
                    <button class="btn-icon danger" title="删除" data-action="delete" data-path="${pathStr}" data-name="${nameStr}">${ACTION_ICONS.delete}</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    // Row click navigation
    document.querySelectorAll('.file-row').forEach(row => {
      row.onclick = async () => {
        const p = row.dataset.path;
        const isDir = row.dataset.isdir === 'true';
        if (isDir) {
          window.location.hash = '#files/' + encodeURIComponent(p);
        } else if (isVideoFile(p)) {
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

    // Action buttons
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const p = btn.dataset.path;
        const name = btn.dataset.name;

        if (action === 'delete') {
          confirmDeleteModal(p, name, () => renderFileManager(currentPath));
        } else if (action === 'copy') {
          copyFileModal(p, name, () => renderFileManager(currentPath));
        } else if (action === 'move') {
          moveFileModal(p, name, () => renderFileManager(currentPath));
        } else if (action === 'upload') {
          uploadToRemoteModal(p, name);
        } else if (action === 'extract') {
          try {
            showToast('开始解压...', 'info');
            const res = await API.extractArchive(p);
            showToast('解压成功: ' + res.outputDir, 'success');
            renderFileManager(currentPath);
          } catch (err) {
            showToast('解压失败: ' + err.message, 'error');
          }
        }
      };
    });
  }


  /* ══════════════════════════════════════════════════════
     Video Player Page
     ══════════════════════════════════════════════════════ */

  async function renderPlayer(filePath) {
    const main = document.getElementById('main-content');
    const name = filePath.split('/').pop();
    const parentDir = filePath.split('/').slice(0, -1).join('/');
    
    main.innerHTML = `
      <div class="page-header flex gap-16 items-center">
        <button class="btn-icon" id="btn-player-back" title="返回">⬅️</button>
        <h1 class="page-title" style="margin:0">${escapeHtml(name)}</h1>
      </div>

      <div class="player-container">
        <video id="video-player" controls preload="auto" width="100%" crossorigin="anonymous">
          您的浏览器不支持 Video 标签。
        </video>
      </div>
      
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

    if (filePath.endsWith('.m3u8')) {
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

  async function renderNetdisk(param) {
    const main = document.getElementById('main-content');
    const slash = param.indexOf('/');
    const remote = slash === -1 ? param : param.slice(0, slash);
    const relPath = slash === -1 ? '' : decodeURIComponent(param.slice(slash + 1));

    main.innerHTML = `
      <div class="page-header"><h1 class="page-title">☁️ 网盘</h1></div>
      <div id="netdisk-content">${netEmpty('⏳', '加载中…')}</div>
    `;
    const content = document.getElementById('netdisk-content');

    let remotes = [];
    try {
      const r = await API.listRemotes();
      remotes = (r && r.remotes) || [];
    } catch (err) {
      content.innerHTML = netEmpty('❌', '加载失败', err.message);
      return;
    }

    if (!remotes.length) {
      content.innerHTML = netEmpty('☁️', '尚未连接网盘', '请先在服务器用 rclone 连接 OneDrive / Google Drive');
      return;
    }

    // No remote chosen yet → show a picker.
    if (!remote || !remotes.includes(remote)) {
      content.innerHTML = `<div class="remote-grid">${remotes
        .map((r) => `<button class="remote-card" data-remote="${escapeHtml(r)}">
            <span class="remote-card-icon">☁️</span><span class="remote-card-name">${escapeHtml(r)}</span>
          </button>`)
        .join('')}</div>`;
      content.querySelectorAll('.remote-card').forEach((b) => {
        b.onclick = () => { window.location.hash = '#netdisk/' + encodeURIComponent(b.dataset.remote); };
      });
      return;
    }

    let data;
    try {
      data = await API.browseRemote(remote, relPath);
    } catch (err) {
      content.innerHTML = netEmpty('❌', '无法读取该网盘目录', err.message);
      return;
    }

    const remoteOptions = remotes
      .map((r) => `<option value="${escapeHtml(r)}" ${r === remote ? 'selected' : ''}>${escapeHtml(r)}</option>`)
      .join('');

    const segs = relPath ? relPath.split('/') : [];
    let acc = '';
    const crumbs = [`<span class="breadcrumb-item" data-go="">${escapeHtml(remote)}</span>`];
    segs.forEach((s, i) => {
      acc = acc ? acc + '/' + s : s;
      crumbs.push('<span class="breadcrumb-sep">/</span>');
      crumbs.push(i === segs.length - 1
        ? `<span class="breadcrumb-item current">${escapeHtml(s)}</span>`
        : `<span class="breadcrumb-item" data-go="${escapeHtml(acc)}">${escapeHtml(s)}</span>`);
    });

    const rows = data.items.map((f) => {
      const icon = f.isDir ? '📁' : getFileIcon(f.name, false);
      const sizeStr = f.isDir ? '--' : formatBytes(f.size);
      const playable = !f.isDir && (isVideoFile(f.name) || isAudioFile(f.name));
      return `
        <tr class="file-row" data-path="${escapeHtml(f.path)}" data-isdir="${f.isDir}" data-playable="${playable}">
          <td class="text-center">${icon}</td>
          <td>${escapeHtml(f.name)}</td>
          <td class="text-muted">${sizeStr}</td>
          <td class="text-muted">${f.modified ? formatDate(f.modified) : '--'}</td>
        </tr>`;
    }).join('');

    content.innerHTML = `
      <div class="file-toolbar">
        <select id="netdisk-remote" class="form-select" style="max-width:200px">${remoteOptions}</select>
      </div>
      <div class="breadcrumb" id="netdisk-breadcrumb">${crumbs.join('')}</div>
      ${data.items.length ? `
      <table class="file-table">
        <thead><tr><th width="40"></th><th>名称</th><th width="110">大小</th><th width="160">修改时间</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : netEmpty('📂', '空文件夹')}
    `;

    document.getElementById('netdisk-remote').onchange = (e) => {
      window.location.hash = '#netdisk/' + encodeURIComponent(e.target.value);
    };
    content.querySelectorAll('#netdisk-breadcrumb .breadcrumb-item[data-go]').forEach((el) => {
      el.onclick = () => {
        const go = el.getAttribute('data-go');
        window.location.hash = '#netdisk/' + encodeURIComponent(remote) + (go ? '/' + encodeURIComponent(go) : '');
      };
    });
    content.querySelectorAll('.file-row').forEach((row) => {
      row.onclick = async () => {
        const p = row.dataset.path;
        if (row.dataset.isdir === 'true') {
          window.location.hash = '#netdisk/' + encodeURIComponent(remote) + '/' + encodeURIComponent(p);
        } else if (row.dataset.playable === 'true') {
          window.location.hash = '#netplay/' + encodeURIComponent(remote) + '/' + encodeURIComponent(p);
        } else {
          const w = window.open('', '_blank');
          const url = await API.getRemoteStreamUrl(remote, p);
          if (w) w.location = url; else window.location = url;
        }
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
      : `<div class="player-container"><video id="net-media" controls autoplay preload="auto" width="100%"></video></div>`;

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
     Settings Page
     ══════════════════════════════════════════════════════ */

  function renderSettings() {
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
        <h2 class="settings-section-title">系统信息</h2>
        <div class="settings-card" id="system-info">
          <div class="settings-row">
            <span class="settings-label">平台</span>
            <span class="settings-value" id="info-platform">加载中…</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">运行环境</span>
            <span class="settings-value" id="info-node">加载中…</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">aria2 引擎</span>
            <span class="settings-value" id="info-aria2">加载中…</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">运行状态</span>
            <span class="settings-value text-success" id="info-status">运行中</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">运行时长</span>
            <span class="settings-value" id="info-uptime">加载中…</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">版本</span>
            <span class="settings-value" id="info-version">加载中…</span>
          </div>
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

          <p class="about-desc">
            一个轻量、自托管的下载中心：粘贴磁力链接或下载地址即可交给 aria2 高速下载，
            支持边下边管、在线播放视频，并在任务完成后自动清理记录、保留文件。
          </p>

          <div class="about-features">
            <span class="about-chip">🧲 磁力 / 种子</span>
            <span class="about-chip">🔗 HTTP / HTTPS</span>
            <span class="about-chip">🎬 在线串流</span>
            <span class="about-chip">📁 文件管理</span>
            <span class="about-chip">📊 实时进度</span>
            <span class="about-chip">🧹 自动清理</span>
          </div>

          <div class="about-footer">
            <span>Powered by Node.js · Express · aria2 · hls.js</span>
            <span>© 2026 MagnetFlow · MIT License</span>
          </div>
        </div>
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

    // Load system info
    loadSystemInfo();
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
