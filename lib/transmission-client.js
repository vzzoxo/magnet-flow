'use strict';

/**
 * Transmission RPC client (native fetch, Node 18+).
 * Handles the CSRF session-id handshake: the first request gets a 409 with an
 * X-Transmission-Session-Id header which must be echoed on subsequent calls.
 */
class TransmissionClient {
  /**
   * @param {string} rpcUrl - e.g. http://127.0.0.1:9091/transmission/rpc
   */
  constructor(rpcUrl) {
    this.rpcUrl = rpcUrl || 'http://127.0.0.1:9091/transmission/rpc';
    this.sessionId = '';
  }

  /**
   * Call a Transmission RPC method.
   * @param {string} method
   * @param {object} [args={}]
   * @param {boolean} [_retried=false]
   * @returns {Promise<object>} the `arguments` object on success
   */
  async call(method, args = {}, _retried = false) {
    let response;
    try {
      response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'X-Transmission-Session-Id': this.sessionId },
        body: JSON.stringify({ method, arguments: args }),
      });
    } catch (err) {
      if (err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED') {
        throw new Error('Transmission is not running.');
      }
      throw err;
    }

    if (response.status === 409 && !_retried) {
      this.sessionId = response.headers.get('x-transmission-session-id') || '';
      return this.call(method, args, true);
    }
    if (!response.ok) throw new Error(`Transmission RPC HTTP ${response.status}`);

    const data = await response.json();
    if (data.result !== 'success') throw new Error(data.result || 'Transmission RPC error');
    return data.arguments || {};
  }

  version() {
    return this.call('session-get', { fields: ['version', 'rpc-version', 'download-dir'] });
  }

  /** Add a magnet/URL torrent. @returns {Promise<number>} torrent id */
  async addMagnet(magnet, dir) {
    const a = await this.call('torrent-add', { filename: magnet, 'download-dir': dir });
    const t = a['torrent-added'] || a['torrent-duplicate'];
    return t && t.id;
  }

  /** Add from a .torrent file (base64). @returns {Promise<number>} torrent id */
  async addTorrent(base64, dir) {
    const a = await this.call('torrent-add', { metainfo: base64, 'download-dir': dir });
    const t = a['torrent-added'] || a['torrent-duplicate'];
    return t && t.id;
  }

  /** @returns {Promise<object[]>} torrents */
  async list(fields, ids) {
    const args = { fields };
    if (ids) args.ids = ids;
    const a = await this.call('torrent-get', args);
    return a.torrents || [];
  }

  start(ids) { return this.call('torrent-start', { ids }); }
  stop(ids) { return this.call('torrent-stop', { ids }); }
  remove(ids, deleteLocal = false) {
    return this.call('torrent-remove', { ids, 'delete-local-data': !!deleteLocal });
  }

  /** Choose which files to download (1 torrent). */
  setWanted(id, wanted, unwanted) {
    const args = { ids: [id] };
    if (wanted && wanted.length) args['files-wanted'] = wanted;
    if (unwanted && unwanted.length) args['files-unwanted'] = unwanted;
    return this.call('torrent-set', args);
  }
}

module.exports = TransmissionClient;
