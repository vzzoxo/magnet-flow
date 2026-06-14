'use strict';

const { aria2, transmission, DOWNLOAD_DIR, MAX_LIST } = require('./config');

const TR_FIELDS = [
  'id', 'name', 'status', 'percentDone', 'sizeWhenDone', 'leftUntilDone',
  'rateDownload', 'rateUpload', 'peersConnected', 'peersSendingToUs',
  'error', 'errorString', 'downloadDir', 'metadataPercentComplete', 'eta',
];

// ── Transmission availability (cached health check) ─────────────────────────
let _tr = { at: 0, ok: false };
async function trAvailable() {
  if (Date.now() - _tr.at < 30000) return _tr.ok;
  let ok = false;
  try { await transmission.version(); ok = true; } catch { ok = false; }
  _tr = { at: Date.now(), ok };
  return ok;
}

/** Parse a namespaced task id, e.g. "tr:7" → {engine:'tr', id:'7'}. */
function parseId(gid) {
  const s = String(gid);
  const i = s.indexOf(':');
  if (i === -1) return { engine: 'aria2', id: s };
  return { engine: s.slice(0, i), id: s.slice(i + 1) };
}

function normAria2(d) {
  return Object.assign({}, d, { gid: 'aria2:' + d.gid, engine: 'aria2' });
}

function normTr(t) {
  const total = Number(t.sizeWhenDone || 0);
  const left = Number(t.leftUntilDone || 0);
  const completed = Math.max(0, total - left);
  const done = total > 0 && left === 0;
  let status;
  if (t.error && t.error !== 0) status = 'error';
  else if (done) status = 'complete';
  else if (t.status === 0) status = 'paused';
  else if (t.status === 4 || t.status === 2 || t.status === 6) status = 'active';
  else status = 'waiting';
  return {
    gid: 'tr:' + t.id,
    engine: 'tr',
    status,
    totalLength: String(total),
    completedLength: String(completed),
    downloadSpeed: String(Number(t.rateDownload || 0)),
    uploadSpeed: String(Number(t.rateUpload || 0)),
    connections: String(Number(t.peersConnected || 0)),
    numSeeders: String(Number(t.peersSendingToUs || 0)),
    dir: t.downloadDir,
    bittorrent: { info: { name: t.name } },
    errorMessage: t.errorString || '',
  };
}

/** Merge both engines' tasks into the aria2-style {active,waiting,stopped,stats}. */
async function collectDownloads() {
  const out = {
    active: [], waiting: [], stopped: [],
    stats: { downloadSpeed: 0, uploadSpeed: 0, numActive: 0, numWaiting: 0, numStopped: 0 },
  };

  try {
    const [a, w, s, st] = await Promise.all([
      aria2.tellActive(),
      aria2.tellWaiting(0, MAX_LIST),
      aria2.tellStopped(0, MAX_LIST),
      aria2.getGlobalStat(),
    ]);
    a.forEach((d) => out.active.push(normAria2(d)));
    w.forEach((d) => out.waiting.push(normAria2(d)));
    s.forEach((d) => out.stopped.push(normAria2(d)));
    out.stats.downloadSpeed += Number(st.downloadSpeed || 0);
    out.stats.uploadSpeed += Number(st.uploadSpeed || 0);
  } catch { /* aria2 down */ }

  if (await trAvailable()) {
    try {
      const torrents = await transmission.list(TR_FIELDS);
      torrents.forEach((t) => {
        const n = normTr(t);
        out.stats.downloadSpeed += Number(n.downloadSpeed);
        out.stats.uploadSpeed += Number(n.uploadSpeed);
        (n.status === 'active' ? out.active : n.status === 'waiting' ? out.waiting : out.stopped).push(n);
      });
    } catch { /* transmission hiccup */ }
  }

  out.stats.numActive = out.active.length;
  out.stats.numWaiting = out.waiting.length;
  out.stats.numStopped = out.stopped.length;
  return out;
}

async function engineList() {
  const list = ['aria2'];
  if (await trAvailable()) list.push('transmission');
  return list;
}

// ── Operations (dispatch by engine) ─────────────────────────────────────────
async function addUrl(url, engine) {
  if (engine === 'transmission' || engine === 'tr') return 'tr:' + (await transmission.addMagnet(url, DOWNLOAD_DIR));
  return 'aria2:' + (await aria2.addUri([url], { dir: DOWNLOAD_DIR }));
}
async function addTorrentFile(base64, engine) {
  if (engine === 'transmission' || engine === 'tr') return 'tr:' + (await transmission.addTorrent(base64, DOWNLOAD_DIR));
  return 'aria2:' + (await aria2.addTorrent(base64, { dir: DOWNLOAD_DIR }));
}
async function pause(gid) {
  const { engine, id } = parseId(gid);
  return engine === 'tr' ? transmission.stop([Number(id)]) : aria2.pause(id);
}
async function resume(gid) {
  const { engine, id } = parseId(gid);
  return engine === 'tr' ? transmission.start([Number(id)]) : aria2.unpause(id);
}
async function remove(gid) {
  const { engine, id } = parseId(gid);
  if (engine === 'tr') return transmission.remove([Number(id)], false);
  try { return await aria2.remove(id); } catch { return aria2.forceRemove(id); }
}
async function getFiles(gid) {
  const { engine, id } = parseId(gid);
  if (engine === 'tr') {
    const [t] = await transmission.list(['id', 'files', 'fileStats', 'name'], [Number(id)]);
    const files = ((t && t.files) || []).map((f, i) => ({
      index: i,
      path: f.name,
      length: String(f.length),
      completedLength: String(f.bytesCompleted),
      selected: (t.fileStats && t.fileStats[i] && t.fileStats[i].wanted) ? 'true' : 'false',
    }));
    return { gid, files };
  }
  return aria2.tellStatus(id, ['gid', 'files', 'bittorrent', 'totalLength', 'status']);
}
async function selectFiles(gid, indexes) {
  const { engine, id } = parseId(gid);
  if (engine === 'tr') {
    const [t] = await transmission.list(['id', 'files'], [Number(id)]);
    const total = ((t && t.files) || []).length;
    const wanted = indexes.map(Number);
    const wset = new Set(wanted);
    const unwanted = [];
    for (let i = 0; i < total; i++) if (!wset.has(i)) unwanted.push(i);
    return transmission.setWanted(Number(id), wanted, unwanted);
  }
  const sel = indexes.map((n) => parseInt(n, 10)).filter((n) => n > 0).join(',');
  return aria2.changeOption(id, { 'select-file': sel });
}
/** Clear a completed task's record (keep files on disk). */
async function removeCompletedRecord(gid) {
  const { engine, id } = parseId(gid);
  if (engine === 'tr') return transmission.remove([Number(id)], false);
  return aria2.removeDownloadResult(id);
}

module.exports = {
  parseId, collectDownloads, engineList, trAvailable,
  addUrl, addTorrentFile, pause, resume, remove, getFiles, selectFiles, removeCompletedRecord,
};
