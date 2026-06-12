'use strict';

/**
 * rclone remote-control (rc) HTTP client.
 * Talks to a local `rclone rcd` daemon. Uses native fetch (Node 18+).
 */
class RcloneClient {
  /**
   * @param {string} rcUrl - e.g. http://127.0.0.1:5572
   */
  constructor(rcUrl) {
    this.rcUrl = (rcUrl || 'http://127.0.0.1:5572').replace(/\/$/, '');
  }

  /**
   * Call an rc command.
   * @param {string} command - e.g. 'config/listremotes'
   * @param {object} [params={}]
   * @returns {Promise<any>}
   */
  async call(command, params = {}) {
    let response;
    try {
      response = await fetch(`${this.rcUrl}/${command}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
    } catch (err) {
      if (err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED') {
        throw new Error('rclone service is not running. Start the rclone-rcd service first.');
      }
      throw err;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      const err = new Error(data.error || `rclone rc error (HTTP ${response.status})`);
      err.status = response.status;
      throw err;
    }
    return data;
  }

  /** @returns {Promise<{remotes: string[]}>} */
  listRemotes() {
    return this.call('config/listremotes');
  }

  /**
   * Copy a single file asynchronously.
   * @returns {Promise<{jobid: number}>}
   */
  copyFileAsync(srcFs, srcRemote, dstFs, dstRemote) {
    return this.call('operations/copyfile', {
      srcFs, srcRemote, dstFs, dstRemote, _async: true,
    });
  }

  /**
   * Copy a directory tree asynchronously (contents of srcFs into dstFs).
   * @returns {Promise<{jobid: number}>}
   */
  copyDirAsync(srcFs, dstFs) {
    return this.call('sync/copy', { srcFs, dstFs, createEmptySrcDirs: true, _async: true });
  }

  /** @param {number} jobid */
  jobStatus(jobid) {
    return this.call('job/status', { jobid });
  }

  /** @param {number} jobid */
  jobStop(jobid) {
    return this.call('job/stop', { jobid });
  }

  /**
   * Transfer stats, optionally scoped to a job's stats group "job/<id>".
   * @param {string} [group]
   */
  stats(group) {
    return this.call('core/stats', group ? { group } : {});
  }

  version() {
    return this.call('core/version');
  }
}

module.exports = RcloneClient;
