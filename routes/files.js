'use strict';

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { authMiddleware } = require('../lib/auth');
const { resolveSafePath, isAccessDenied } = require('../lib/paths');
const { DOWNLOAD_DIR } = require('../lib/config');

const execFileAsync = promisify(execFile);
const engines = require('../lib/engines');
const router = express.Router();

// All file routes require authentication
router.use(authMiddleware);

/** Map a lowercased path to a supported archive type, or null. */
function getArchiveType(lowerPath) {
  if (lowerPath.endsWith('.zip')) return 'zip';
  if (lowerPath.endsWith('.rar')) return 'rar';
  if (lowerPath.endsWith('.7z')) return '7z';
  if (
    lowerPath.endsWith('.tar') ||
    lowerPath.endsWith('.tar.gz') ||
    lowerPath.endsWith('.tgz') ||
    lowerPath.endsWith('.tar.bz2') ||
    lowerPath.endsWith('.tar.xz')
  ) {
    return 'tar';
  }
  return null;
}

/** True if an archive entry name would escape the extraction directory. */
function isUnsafeEntry(name) {
  if (!name) return false;
  const n = name.replace(/\\/g, '/').trim();
  if (!n || n === '.') return false;
  if (n.startsWith('/')) return true;          // absolute path
  if (/^[a-zA-Z]:/.test(n)) return true;       // Windows drive letter
  return n.split('/').some((seg) => seg === '..'); // parent-dir traversal
}

/** List entry names inside an archive (for pre-extraction zip-slip checks). */
async function listArchiveEntries(type, file) {
  const opts = { timeout: 60000, maxBuffer: 32 * 1024 * 1024 };
  let stdout = '';
  if (type === 'zip') {
    ({ stdout } = await execFileAsync('unzip', ['-Z1', file], opts));
    return stdout.split('\n');
  }
  if (type === 'rar') {
    ({ stdout } = await execFileAsync('unrar', ['lb', file], opts));
    return stdout.split('\n');
  }
  if (type === 'tar') {
    ({ stdout } = await execFileAsync('tar', ['-tf', file], opts));
    return stdout.split('\n');
  }
  if (type === '7z') {
    ({ stdout } = await execFileAsync('7z', ['l', '-ba', '-slt', file], opts));
    return stdout
      .split('\n')
      .filter((l) => l.startsWith('Path = '))
      .map((l) => l.slice('Path = '.length));
  }
  return [];
}

/**
 * GET /list
 * List directory contents. Defaults to DOWNLOAD_DIR.
 * Query: ?path=relative/or/absolute/path
 */
router.get('/list', async (req, res) => {
  try {
    const requestedPath = req.query.path || DOWNLOAD_DIR;
    // resolveSafePath handles both relative and absolute inputs: an absolute
    // path outside DOWNLOAD_DIR is rejected, one inside is accepted.
    const dirPath = resolveSafePath(requestedPath, DOWNLOAD_DIR);

    const allEntries = await fs.readdir(dirPath, { withFileTypes: true });
    // Hide .aria2 control files from the file manager view
    const entries = allEntries.filter(entry => !entry.name.endsWith('.aria2'));

    // Fetch the names of files/folders currently associated with active or incomplete downloads from cache
    const activeDownloadNames = engines.getActiveDownloadNames();

    const items = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(DOWNLOAD_DIR, fullPath);
        const isDirectory = entry.isDirectory();
        
        // A file/folder is downloading if it's currently associated with active/incomplete tasks
        const isDownloading = activeDownloadNames.has(entry.name);

        try {
          const stat = await fs.stat(fullPath);
          return {
            name: entry.name,
            path: fullPath,
            relativePath,
            isDirectory,
            size: isDirectory ? 0 : stat.size,
            modified: stat.mtime.toISOString(),
            extension: isDirectory ? '' : path.extname(entry.name).toLowerCase(),
            isDownloading,
          };
        } catch {
          return {
            name: entry.name,
            path: fullPath,
            relativePath,
            isDirectory,
            size: 0,
            modified: new Date().toISOString(),
            extension: isDirectory ? '' : path.extname(entry.name).toLowerCase(),
            isDownloading,
          };
        }
      })
    );

    // Sort: directories first, then alphabetically by name
    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    res.json({ path: dirPath, items });
  } catch (err) {
    console.error('[MagnetFlow] List files error:', err.message);
    if (isAccessDenied(err)) {
      return res.status(403).json({ error: err.message });
    }
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Directory not found' });
    }
    if (err.code === 'ENOTDIR') {
      return res.status(400).json({ error: 'Not a directory' });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /mkdir
 * Create a directory recursively.
 */
router.post('/mkdir', async (req, res) => {
  try {
    const { path: dirPath } = req.body;
    if (!dirPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    const safePath = resolveSafePath(dirPath, DOWNLOAD_DIR);
    await fs.mkdir(safePath, { recursive: true });
    console.log(`[MagnetFlow] Directory created: ${safePath}`);
    res.json({ message: 'Directory created', path: safePath });
  } catch (err) {
    console.error('[MagnetFlow] Mkdir error:', err.message);
    if (isAccessDenied(err)) {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /copy
 * Copy a file or directory recursively.
 */
router.post('/copy', async (req, res) => {
  try {
    const { source, destination } = req.body;
    if (!source || !destination) {
      return res.status(400).json({ error: 'Source and destination are required' });
    }

    const safeSource = resolveSafePath(source, DOWNLOAD_DIR);
    const safeDest = resolveSafePath(destination, DOWNLOAD_DIR);

    await fs.cp(safeSource, safeDest, { recursive: true });
    console.log(`[MagnetFlow] Copied: ${safeSource} → ${safeDest}`);
    res.json({ message: 'Copied successfully', source: safeSource, destination: safeDest });
  } catch (err) {
    console.error('[MagnetFlow] Copy error:', err.message);
    if (isAccessDenied(err)) {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /move
 * Move/rename a file or directory. Falls back to copy+delete for cross-device moves.
 */
router.post('/move', async (req, res) => {
  try {
    const { source, destination } = req.body;
    if (!source || !destination) {
      return res.status(400).json({ error: 'Source and destination are required' });
    }

    const safeSource = resolveSafePath(source, DOWNLOAD_DIR);
    const safeDest = resolveSafePath(destination, DOWNLOAD_DIR);

    try {
      await fs.rename(safeSource, safeDest);
    } catch (renameErr) {
      // EXDEV: cross-device link not permitted — fallback to copy + remove
      if (renameErr.code === 'EXDEV') {
        await fs.cp(safeSource, safeDest, { recursive: true });
        await fs.rm(safeSource, { recursive: true, force: true });
      } else {
        throw renameErr;
      }
    }

    console.log(`[MagnetFlow] Moved: ${safeSource} → ${safeDest}`);
    res.json({ message: 'Moved successfully', source: safeSource, destination: safeDest });
  } catch (err) {
    console.error('[MagnetFlow] Move error:', err.message);
    if (isAccessDenied(err)) {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /delete
 * Delete a file or directory recursively.
 * SECURITY: Will not allow deleting the DOWNLOAD_DIR itself.
 */
router.post('/delete', async (req, res) => {
  try {
    const { path: filePath } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    const safePath = resolveSafePath(filePath, DOWNLOAD_DIR);
    const normalizedDownloadDir = path.resolve(DOWNLOAD_DIR);

    // Never allow deleting the download directory itself
    if (safePath === normalizedDownloadDir) {
      return res.status(403).json({ error: 'Cannot delete the root download directory' });
    }

    await fs.rm(safePath, { recursive: true, force: true });
    console.log(`[MagnetFlow] Deleted: ${safePath}`);
    res.json({ message: 'Deleted successfully', path: safePath });
  } catch (err) {
    console.error('[MagnetFlow] Delete error:', err.message);
    if (isAccessDenied(err)) {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /extract
 * Extract an archive file.
 * Supported: .zip, .rar, .7z, .tar, .tar.gz, .tgz, .tar.bz2, .tar.xz
 */
router.post('/extract', async (req, res) => {
  try {
    const { path: archivePath, destination } = req.body;
    if (!archivePath) {
      return res.status(400).json({ error: 'Archive path is required' });
    }

    const safeArchivePath = resolveSafePath(archivePath, DOWNLOAD_DIR);

    // Check archive exists
    try {
      await fs.access(safeArchivePath);
    } catch {
      return res.status(404).json({ error: 'Archive file not found' });
    }

    // Determine destination directory
    const destDir = destination
      ? resolveSafePath(destination, DOWNLOAD_DIR)
      : path.dirname(safeArchivePath);

    // Ensure destination directory exists
    await fs.mkdir(destDir, { recursive: true });

    // Determine archive type up front.
    const lowerPath = safeArchivePath.toLowerCase();
    const type = getArchiveType(lowerPath);
    if (!type) {
      return res.status(400).json({
        error: 'Unsupported archive format. Supported: .zip, .rar, .7z, .tar, .tar.gz, .tgz, .tar.bz2, .tar.xz',
      });
    }

    // Zip-slip guard: inspect entry names BEFORE extracting and refuse any
    // archive that would write outside the destination (absolute paths or ".."
    // traversal). Covers zip / rar / 7z / tar.
    try {
      const entries = await listArchiveEntries(type, safeArchivePath);
      const bad = entries.find(isUnsafeEntry);
      if (bad) {
        console.warn(`[MagnetFlow] Blocked unsafe archive entry: ${bad.trim()}`);
        return res.status(400).json({ error: `Unsafe archive entry detected: ${bad.trim()}` });
      }
    } catch (e) {
      return res.status(400).json({ error: 'Unable to inspect archive: ' + e.message });
    }

    let cmd;
    let args;
    if (type === 'zip') {
      cmd = 'unzip';
      args = ['-o', safeArchivePath, '-d', destDir];
    } else if (type === 'rar') {
      cmd = 'unrar';
      args = ['x', '-o+', safeArchivePath, destDir + '/'];
    } else if (type === '7z') {
      cmd = '7z';
      args = ['x', safeArchivePath, '-o' + destDir, '-y'];
    } else {
      cmd = 'tar';
      // --no-absolute-names strips a leading "/"; combined with -C this keeps
      // extraction inside destDir. GNU tar already refuses ".." members.
      args = ['--no-absolute-names', '-xf', safeArchivePath, '-C', destDir];
    }

    console.log(`[MagnetFlow] Extracting: ${cmd} ${args.join(' ')}`);
    await execFileAsync(cmd, args, { timeout: 300000 }); // 5 minute timeout

    console.log(`[MagnetFlow] Extraction complete: ${safeArchivePath} → ${destDir}`);
    res.json({
      success: true,
      message: 'Extraction completed successfully',
      outputDir: destDir,
    });
  } catch (err) {
    console.error('[MagnetFlow] Extract error:', err.message);
    if (isAccessDenied(err)) {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({
      success: false,
      error: err.message || 'Extraction failed',
    });
  }
});

/**
 * GET /info
 * Get detailed information about a file or directory.
 * Query: ?path=relative/or/absolute/path
 */
router.get('/info', async (req, res) => {
  try {
    const { path: filePath } = req.query;
    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    const safePath = resolveSafePath(filePath, DOWNLOAD_DIR);
    const stat = await fs.stat(safePath);
    const relativePath = path.relative(DOWNLOAD_DIR, safePath);

    res.json({
      name: path.basename(safePath),
      path: safePath,
      relativePath,
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
      size: stat.size,
      created: stat.birthtime.toISOString(),
      modified: stat.mtime.toISOString(),
      accessed: stat.atime.toISOString(),
      extension: stat.isFile() ? path.extname(safePath).toLowerCase() : '',
      permissions: stat.mode.toString(8),
    });
  } catch (err) {
    console.error('[MagnetFlow] File info error:', err.message);
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    if (isAccessDenied(err)) {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
