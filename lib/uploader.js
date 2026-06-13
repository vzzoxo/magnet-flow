'use strict';

const path = require('path');
const fs = require('fs/promises');
const { rclone } = require('./config');

/**
 * Copy a local file/folder to a cloud remote via rclone (async job).
 * Shared by the manual upload route and the auto-upload-on-complete hook.
 * @param {string} absPath - absolute local path (file or directory)
 * @param {string} remote - configured rclone remote name (no trailing ':')
 * @param {string} [destDir] - folder on the remote (no leading/trailing slash)
 * @returns {Promise<{jobid:number, name:string, isDirectory:boolean}>}
 */
async function startUpload(absPath, remote, destDir) {
  const name = path.basename(absPath);
  const dd = String(destDir || '').replace(/^\/+/, '').replace(/\/+$/, '');
  const stat = await fs.stat(absPath);

  let job;
  if (stat.isDirectory()) {
    const dstFs = `${remote}:${dd ? dd + '/' + name : name}`;
    job = await rclone.copyDirAsync(absPath, dstFs);
  } else {
    const dstFs = `${remote}:${dd}`;
    job = await rclone.copyFileAsync(path.dirname(absPath), name, dstFs, name);
  }
  return { jobid: job.jobid, name, isDirectory: stat.isDirectory() };
}

module.exports = { startUpload };
