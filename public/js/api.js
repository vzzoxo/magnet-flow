/**
 * MagnetFlow API Client
 * Handles all HTTP communication with the backend.
 */
window.API = (function () {
  const api = {
    token: localStorage.getItem('mf_token'),

    /**
     * Generic request helper with auth & error handling.
     */
    async request(url, options = {}) {
      const headers = { 'Content-Type': 'application/json' };
      if (api.token) {
        headers['Authorization'] = 'Bearer ' + api.token;
      }
      const merged = {
        ...options,
        headers: { ...headers, ...(options.headers || {}) },
      };

      let res;
      try {
        res = await fetch(url, merged);
      } catch (err) {
        throw new Error('网络请求失败，请检查网络连接');
      }

      if (res.status === 401) {
        api.logout();
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.message || res.statusText);
      }

      // Some endpoints may return 204 No Content
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    },

    /* ── Token management ─────────────────────────────── */
    setToken(token) {
      api.token = token;
      localStorage.setItem('mf_token', token);
    },

    logout() {
      api.token = null;
      localStorage.removeItem('mf_token');
      window.location.hash = '#login';
      location.reload();
    },

    /* ── Auth ──────────────────────────────────────────── */
    login(username, password) {
      return api.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
    },

    checkAuth() {
      return api.request('/api/auth/check');
    },

    changePassword(currentPassword, newPassword) {
      return api.request('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
    },

    /* ── Downloads ─────────────────────────────────────── */
    addDownload(url) {
      return api.request('/api/downloads/add', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
    },

    listDownloads() {
      return api.request('/api/downloads/list');
    },

    pauseDownload(gid) {
      return api.request('/api/downloads/pause/' + gid, { method: 'POST' });
    },

    resumeDownload(gid) {
      return api.request('/api/downloads/resume/' + gid, { method: 'POST' });
    },

    removeDownload(gid) {
      return api.request('/api/downloads/' + gid, { method: 'DELETE' });
    },

    purgeDownloads() {
      return api.request('/api/downloads/purge', { method: 'POST' });
    },

    getDownloadFiles(gid) {
      return api.request('/api/downloads/files/' + gid);
    },

    selectDownloadFiles(gid, indexes) {
      return api.request('/api/downloads/select/' + gid, {
        method: 'POST',
        body: JSON.stringify({ indexes }),
      });
    },

    /* ── Files ─────────────────────────────────────────── */
    listFiles(path) {
      return api.request(
        '/api/files/list?path=' + encodeURIComponent(path || '')
      );
    },

    createDir(path) {
      return api.request('/api/files/mkdir', {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
    },

    copyFile(source, destination) {
      return api.request('/api/files/copy', {
        method: 'POST',
        body: JSON.stringify({ source, destination }),
      });
    },

    moveFile(source, destination) {
      return api.request('/api/files/move', {
        method: 'POST',
        body: JSON.stringify({ source, destination }),
      });
    },

    deleteFile(path) {
      return api.request('/api/files/delete', {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
    },

    extractArchive(path, destination) {
      return api.request('/api/files/extract', {
        method: 'POST',
        body: JSON.stringify({ path, destination }),
      });
    },

    /* ── System ────────────────────────────────────────── */
    getSystemInfo() {
      return api.request('/api/system/info');
    },

    /* ── RSS ───────────────────────────────────────────── */
    listRss() { return api.request('/api/rss/list'); },
    addRss(name, url, filter) {
      return api.request('/api/rss/add', { method: 'POST', body: JSON.stringify({ name, url, filter }) });
    },
    deleteRss(id) { return api.request('/api/rss/' + id, { method: 'DELETE' }); },
    toggleRss(id) { return api.request('/api/rss/toggle/' + id, { method: 'POST' }); },
    checkRss(id) { return api.request('/api/rss/check/' + id, { method: 'POST' }); },

    /* ── Cloud remotes (rclone) ────────────────────────── */
    listRemotes() {
      return api.request('/api/remotes/list');
    },

    uploadToRemote(path, remote, dest) {
      return api.request('/api/remotes/upload', {
        method: 'POST',
        body: JSON.stringify({ path, remote, dest }),
      });
    },

    getUploadJob(jobid) {
      return api.request('/api/remotes/job/' + jobid);
    },

    browseRemote(remote, path) {
      return api.request(
        '/api/remotes/browse?remote=' + encodeURIComponent(remote) +
        '&path=' + encodeURIComponent(path || '')
      );
    },

    // Fetch a scoped token, then build the cloud stream URL.
    async getRemoteStreamUrl(remote, filePath) {
      let token = '';
      try {
        const res = await api.request(
          '/api/remotes/stream-token?remote=' + encodeURIComponent(remote) +
          '&path=' + encodeURIComponent(filePath)
        );
        token = (res && res.token) || '';
      } catch (e) { /* will 401 */ }
      return (
        '/api/remotes/stream?remote=' + encodeURIComponent(remote) +
        '&path=' + encodeURIComponent(filePath) +
        (token ? '&token=' + encodeURIComponent(token) : '')
      );
    },

    /* ── Streaming ─────────────────────────────────────── */
    // Fetch a short-lived, single-file token, then build the media URL.
    async getStreamUrl(filePath) {
      let token = '';
      try {
        const res = await api.request(
          '/api/stream/token?path=' + encodeURIComponent(filePath)
        );
        token = (res && res.token) || '';
      } catch (e) {
        // Fall through with no token; the media request will 401.
      }
      return (
        '/api/stream/video/' +
        encodeURIComponent(filePath) +
        (token ? '?token=' + encodeURIComponent(token) : '')
      );
    },
  };

  return api;
})();
