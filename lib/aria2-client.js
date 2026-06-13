'use strict';

/**
 * Aria2 JSON-RPC client.
 * Uses native fetch() available in Node 18+.
 */
class Aria2Client {
  /**
   * @param {string} rpcUrl - Aria2 JSON-RPC endpoint (e.g. http://localhost:6800/jsonrpc)
   * @param {string} [secret] - Aria2 RPC secret token
   */
  constructor(rpcUrl, secret) {
    this.rpcUrl = rpcUrl;
    this.secret = secret || '';
  }

  /**
   * Generic JSON-RPC call to aria2.
   * @param {string} method - Method name without 'aria2.' prefix
   * @param  {...any} params - Parameters for the method
   * @returns {Promise<any>} Result from aria2
   */
  async call(method, ...params) {
    const id = 'mf-' + Date.now();
    const fullMethod = 'aria2.' + method;
    const rpcParams = this.secret
      ? ['token:' + this.secret, ...params]
      : params;

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: fullMethod,
      params: rpcParams,
    });

    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      const data = await response.json();

      if (data.error) {
        const err = new Error(data.error.message || 'Aria2 RPC error');
        err.code = data.error.code;
        throw err;
      }

      return data.result;
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED') {
        console.error('[MagnetFlow] aria2 is not running or not reachable at', this.rpcUrl);
        throw new Error('aria2 is not running. Please start aria2 first.');
      }
      throw err;
    }
  }

  // ── Convenience Methods ───────────────────────────────────────────────

  /**
   * Add a download by URI(s).
   * @param {string[]} uris - Array of URIs (magnet links, http, etc.)
   * @param {object} [options={}] - aria2 download options (e.g. { dir: '/path' })
   * @returns {Promise<string>} GID of the added download
   */
  async addUri(uris, options = {}) {
    return this.call('addUri', uris, options);
  }

  /**
   * Get status of a download.
   * @param {string} gid
   * @param {string[]} [keys=[]] - Specific keys to return (empty = all)
   * @returns {Promise<object>}
   */
  async tellStatus(gid, keys = []) {
    return keys.length > 0
      ? this.call('tellStatus', gid, keys)
      : this.call('tellStatus', gid);
  }

  /**
   * Get list of active downloads.
   * @param {string[]} [keys=[]]
   * @returns {Promise<object[]>}
   */
  async tellActive(keys = []) {
    return keys.length > 0
      ? this.call('tellActive', keys)
      : this.call('tellActive');
  }

  /**
   * Get list of waiting downloads.
   * @param {number} offset
   * @param {number} num
   * @param {string[]} [keys=[]]
   * @returns {Promise<object[]>}
   */
  async tellWaiting(offset, num, keys = []) {
    return keys.length > 0
      ? this.call('tellWaiting', offset, num, keys)
      : this.call('tellWaiting', offset, num);
  }

  /**
   * Get list of stopped downloads.
   * @param {number} offset
   * @param {number} num
   * @param {string[]} [keys=[]]
   * @returns {Promise<object[]>}
   */
  async tellStopped(offset, num, keys = []) {
    return keys.length > 0
      ? this.call('tellStopped', offset, num, keys)
      : this.call('tellStopped', offset, num);
  }

  /**
   * Pause a download.
   * @param {string} gid
   * @returns {Promise<string>} GID
   */
  async pause(gid) {
    return this.call('pause', gid);
  }

  /**
   * Unpause (resume) a download.
   * @param {string} gid
   * @returns {Promise<string>} GID
   */
  async unpause(gid) {
    return this.call('unpause', gid);
  }

  /**
   * Remove a download.
   * @param {string} gid
   * @returns {Promise<string>} GID
   */
  async remove(gid) {
    return this.call('remove', gid);
  }

  /**
   * Force remove a download (no graceful shutdown).
   * @param {string} gid
   * @returns {Promise<string>} GID
   */
  async forceRemove(gid) {
    return this.call('forceRemove', gid);
  }

  /**
   * Purge completed/error/removed download results.
   * @returns {Promise<string>} 'OK'
   */
  async purgeDownloadResult() {
    return this.call('purgeDownloadResult');
  }

  /**
   * Remove a single completed/error/removed download result (the record only).
   * The downloaded files on disk are NOT deleted.
   * @param {string} gid
   * @returns {Promise<string>} 'OK'
   */
  async removeDownloadResult(gid) {
    return this.call('removeDownloadResult', gid);
  }

  /**
   * Change options of an in-progress download (e.g. select-file for torrents).
   * @param {string} gid
   * @param {object} options
   * @returns {Promise<string>} 'OK'
   */
  async changeOption(gid, options) {
    return this.call('changeOption', gid, options);
  }

  /**
   * Change global options at runtime (e.g. max-overall-upload-limit).
   * @param {object} options
   * @returns {Promise<string>} 'OK'
   */
  async changeGlobalOption(options) {
    return this.call('changeGlobalOption', options);
  }

  /**
   * Get global download statistics.
   * @returns {Promise<object>} { downloadSpeed, uploadSpeed, numActive, numWaiting, numStopped, ... }
   */
  async getGlobalStat() {
    return this.call('getGlobalStat');
  }

  /**
   * Get aria2 version information.
   * @returns {Promise<object>} { version, enabledFeatures }
   */
  async getVersion() {
    return this.call('getVersion');
  }
}

module.exports = Aria2Client;
