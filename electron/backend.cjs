'use strict';
// gitview scanning backend. Strictly read-only toward observed folders:
// Git is queried with --no-optional-locks and nothing is ever written inside a project.

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { diffLines } = require('diff');
const { describe } = require('./filetypes.cjs');

const TEXT_LIMIT = 1024 * 1024; // bytes per side shown as text
const SNIFF = 8000;
const SNAPSHOT_FILE_LIMIT = 25000;
const SNAPSHOT_BLOB_BUDGET = 512 * 1024 * 1024;
const PLAIN_IGNORES = new Set([
  '.git', '.hg', '.svn', 'node_modules', '.godot', '.cache', '__pycache__', '.venv', 'venv',
  '.lake', 'target', 'dist', 'build', '.next', '.nuxt', '.turbo', '.parcel-cache', '.DS_Store', 'Thumbs.db',
]);

const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', LC_ALL: 'C' };
delete GIT_ENV.GIT_DIR;
delete GIT_ENV.GIT_WORK_TREE;
delete GIT_ENV.GIT_INDEX_FILE;

function git(cwd, args, { buffer = false, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['--no-optional-locks', '-c', 'core.quotepath=off', '-c', 'color.ui=false', ...args],
      { cwd, env: GIT_ENV, encoding: buffer ? 'buffer' : 'utf8', timeout, maxBuffer: 256 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const lines = String(stderr || error.message).trim().split('\n').filter(Boolean);
          const err = new Error((lines.pop() || 'git failed').replace(/^fatal:\s*/, ''));
          err.code = error.code;
          return reject(err);
        }
        resolve(stdout);
      },
    );
  });
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');

function isBinary(buf) {
  const n = Math.min(buf.length, SNIFF);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function countLines(buf) {
  if (!buf.length) return 0;
  let n = 0;
  let i = -1;
  while ((i = buf.indexOf(10, i + 1)) !== -1) n++;
  return buf[buf.length - 1] === 10 ? n : n + 1;
}

async function readHead(abs, bytes) {
  const handle = await fs.open(abs, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// ---------------------------------------------------------------- paths

function resolveInside(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || path.isAbsolute(rel)) throw new Error('Invalid file path');
  if (rel.split(/[\\/]+/).some((part) => part === '..')) throw new Error('Invalid file path');
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('Path is outside the folder');
  return abs;
}

async function assertNoEscape(root, abs) {
  const realRoot = await fs.realpath(root);
  try {
    const realDir = await fs.realpath(path.dirname(abs));
    if (realDir !== realRoot && !realDir.startsWith(realRoot + path.sep)) throw new Error('Path is outside the folder');
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  }
}

function cleanRepoPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || path.isAbsolute(value)) return null;
  if (value.split('/').some((part) => part === '..')) return null;
  return value;
}

// ---------------------------------------------------------------- roots

const inspectCache = new Map();

async function inspectRoot(root, { fresh = false } = {}) {
  const hit = inspectCache.get(root);
  if (!fresh && hit && Date.now() - hit.at < 15000) return hit.value;
  let value;
  try {
    const st = await fs.stat(root);
    if (!st.isDirectory()) value = { kind: 'missing', error: 'Not a folder' };
  } catch (error) {
    value = { kind: 'missing', error: error.code === 'EACCES' ? 'Permission denied' : 'Folder not found' };
  }
  if (!value) {
    try {
      const out = await git(root, ['rev-parse', '--show-toplevel', '--show-prefix', '--absolute-git-dir', '--git-common-dir']);
      const [top, prefix, gitDir, commonDir] = out.split('\n');
      value = { kind: 'git', top, prefix: prefix || '', gitDir, commonDir: path.resolve(root, commonDir || gitDir) };
    } catch {
      value = { kind: 'plain' };
    }
  }
  inspectCache.set(root, { at: Date.now(), value });
  return value;
}

// ---------------------------------------------------------------- file metadata

const metaCache = new Map();

async function fileMeta(abs, { sniff = true } = {}) {
  let st;
  try {
    st = await fs.lstat(abs);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { exists: false };
    throw error;
  }
  if (st.isSymbolicLink()) return { exists: true, symlink: true, size: st.size, mtime: st.mtimeMs };
  if (!st.isFile()) return { exists: true, directory: st.isDirectory(), size: 0, mtime: st.mtimeMs };
  const sig = `${st.size}:${st.mtimeMs}:${st.ino}:${sniff}`;
  const hit = metaCache.get(abs);
  if (hit && hit.sig === sig) return hit.meta;
  const meta = { exists: true, size: st.size, mtime: st.mtimeMs, binary: false, lines: null };
  if (sniff) {
    try {
      if (st.size <= TEXT_LIMIT) {
        const buf = await fs.readFile(abs);
        meta.binary = isBinary(buf);
        if (!meta.binary) meta.lines = countLines(buf);
      } else {
        meta.binary = isBinary(await readHead(abs, SNIFF));
      }
    } catch (error) {
      if (error.code === 'ENOENT') return { exists: false };
      throw error;
    }
  }
  if (metaCache.size > 60000) metaCache.clear();
  metaCache.set(abs, { sig, meta });
  return meta;
}

// ---------------------------------------------------------------- git parsing

function splitFields(line, count) {
  const out = [];
  let start = 0;
  for (let k = 0; k < count; k++) {
    const space = line.indexOf(' ', start);
    if (space === -1) return null;
    out.push(line.slice(start, space));
    start = space + 1;
  }
  out.push(line.slice(start));
  return out;
}

function parseStatus(out) {
  const branch = { oid: null, head: null, upstream: null, ahead: 0, behind: 0 };
  const entries = [];
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line) continue;
    if (line.startsWith('# ')) {
      const space = line.indexOf(' ', 2);
      const key = line.slice(2, space === -1 ? undefined : space);
      const value = space === -1 ? '' : line.slice(space + 1);
      if (key === 'branch.oid') branch.oid = value === '(initial)' ? null : value;
      else if (key === 'branch.head') branch.head = value === '(detached)' ? null : value;
      else if (key === 'branch.upstream') branch.upstream = value;
      else if (key === 'branch.ab') {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match) [branch.ahead, branch.behind] = [Number(match[1]), Number(match[2])];
      }
      continue;
    }
    const kind = line[0];
    if (kind === '1') {
      const f = splitFields(line, 8);
      if (f) entries.push({ xy: f[1], sub: f[2], path: f[8] });
    } else if (kind === '2') {
      const f = splitFields(line, 9);
      const origPath = parts[++i];
      if (f) entries.push({ xy: f[1], sub: f[2], path: f[9], origPath });
    } else if (kind === 'u') {
      const f = splitFields(line, 10);
      if (f) entries.push({ xy: f[1], sub: f[2], path: f[10], conflict: true });
    } else if (kind === '?') {
      entries.push({ xy: '??', sub: 'N...', path: line.slice(2), untracked: true });
    } else if (kind === '!') {
      entries.push({ xy: '!!', sub: 'N...', path: line.slice(2), ignored: true });
    }
  }
  return { branch, entries };
}

function displayStatus(entry) {
  if (entry.conflict) return '!';
  if (entry.untracked) return 'U';
  const [x, y] = entry.xy;
  if (x === 'D' || y === 'D') return 'D';
  if (x === 'R') return 'R';
  if (x === 'C') return 'C';
  if (x === 'A') return 'A';
  if (x === 'T' || y === 'T') return 'T';
  return 'M';
}

function parseNumstat(out) {
  const stats = new Map();
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const record = parts[i];
    if (!record) continue;
    const match = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(record);
    if (!match) continue;
    let file = match[3];
    if (file === '') {
      i++; // old path
      file = parts[++i];
    }
    const binary = match[1] === '-';
    stats.set(file, { added: binary ? null : Number(match[1]), removed: binary ? null : Number(match[2]), binary });
  }
  return stats;
}

// ---------------------------------------------------------------- scanning

function classify(rel, meta, options, { binaryHint = false, submodule = false } = {}) {
  const d = describe(rel, options);
  let { type, category, complex } = d;
  const language = d.language;
  let large = false;
  if (submodule) {
    type = 'Git submodule';
    category = 'binary';
    complex = true;
  } else if (meta.symlink) {
    type = 'Symbolic link';
    category = 'binary';
    complex = true;
  } else if (meta.directory || rel.endsWith('/')) {
    type = 'Nested folder';
    category = 'binary';
    complex = true;
  } else if (!complex) {
    const binary = meta.exists ? meta.binary : binaryHint;
    if (binary) {
      complex = true;
      if (!d.known) {
        type = 'Binary file';
        category = 'binary';
      }
    } else if (meta.exists && meta.size > TEXT_LIMIT) {
      complex = true;
      large = true;
    }
  }
  return { type, category, language, complex, large };
}

async function scanGitRoot(root, info, options) {
  const out = await git(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--ignore-submodules=dirty', '--', '.']);
  const { branch, entries } = parseStatus(out);
  let stats = new Map();
  if (entries.some((e) => !e.untracked && !e.ignored)) {
    const base = branch.oid ? ['diff', 'HEAD'] : ['diff', '--cached'];
    try {
      stats = parseNumstat(await git(root, [...base, '--numstat', '-z', '-M', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', '--', '.']));
    } catch {
      stats = new Map();
    }
  }
  const prefix = info.prefix;
  const files = (
    await mapLimit(entries, 24, async (entry) => {
      if (entry.ignored) return null;
      if (prefix && !entry.path.startsWith(prefix)) return null;
      const rel = entry.path.slice(prefix.length);
      if (!rel) return null;
      const d0 = describe(rel, options);
      const meta = await fileMeta(path.join(root, rel), { sniff: !d0.complex });
      const stat = stats.get(entry.path);
      const kind = classify(rel, meta, options, { binaryHint: Boolean(stat?.binary), submodule: entry.sub?.[0] === 'S' });
      let added = stat ? stat.added : null;
      let removed = stat ? stat.removed : null;
      if (entry.untracked) {
        added = meta.lines ?? null;
        removed = 0;
      }
      if (kind.complex) {
        added = null;
        removed = null;
      }
      const origPath = entry.origPath || null;
      return {
        path: rel,
        repoPath: entry.path,
        oldRepoPath: origPath,
        oldPath: origPath ? (origPath.startsWith(prefix) ? origPath.slice(prefix.length) : origPath) : null,
        status: displayStatus(entry),
        xy: entry.xy,
        staged: !entry.untracked && entry.xy[0] !== '.',
        unstaged: entry.untracked || entry.xy[1] !== '.',
        added,
        removed,
        ...kind,
        size: meta.exists ? meta.size || 0 : 0,
        mtime: meta.exists ? meta.mtime || 0 : 0,
        exists: Boolean(meta.exists),
      };
    })
  ).filter(Boolean);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    kind: 'git',
    branch: branch.head,
    detached: !branch.head,
    oid: branch.oid,
    upstream: branch.upstream,
    ahead: branch.ahead,
    behind: branch.behind,
    gitDir: info.gitDir,
    commonDir: info.commonDir,
    files,
  };
}

// ---------------------------------------------------------------- snapshot mode (folders without Git)

function snapshotHome() {
  return process.env.GITVIEW_SNAPSHOT_DIR || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'gitview', 'snapshots');
}

function snapshotDir(root) {
  return path.join(snapshotHome(), sha(root).slice(0, 32));
}

const inventoryCache = new Map();
const baselineCache = new Map();
const diffCountCache = new Map();

async function hashFile(abs) {
  const digest = crypto.createHash('sha256');
  const handle = await fs.open(abs, 'r');
  try {
    for await (const chunk of handle.createReadStream()) digest.update(chunk);
  } finally {
    await handle.close().catch(() => {});
  }
  return digest.digest('hex');
}

async function inventory(root) {
  const previous = inventoryCache.get(root) || new Map();
  const entries = new Map();
  let truncated = false;
  async function walk(rel) {
    let dirents;
    try {
      dirents = await fs.readdir(rel ? path.join(root, rel) : root, { withFileTypes: true });
    } catch (error) {
      if (!rel) throw error;
      return;
    }
    dirents.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const dirent of dirents) {
      if (truncated) return;
      if (PLAIN_IGNORES.has(dirent.name)) continue;
      const child = rel ? `${rel}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        await walk(child);
        continue;
      }
      if (!dirent.isFile() && !dirent.isSymbolicLink()) continue;
      if (entries.size >= SNAPSHOT_FILE_LIMIT) {
        truncated = true;
        return;
      }
      const abs = path.join(root, child);
      let st;
      try {
        st = await fs.lstat(abs);
      } catch {
        continue;
      }
      const sig = `${st.size}:${st.mtimeMs}:${st.ino}`;
      const prior = previous.get(child);
      if (prior && prior.sig === sig) {
        entries.set(child, prior);
        continue;
      }
      const item = { sig, size: st.size, mtime: st.mtimeMs, binary: false, lines: null, link: false, hash: '' };
      try {
        if (st.isSymbolicLink()) {
          item.link = true;
          item.hash = `link:${sha(await fs.readlink(abs))}`;
        } else if (st.size <= TEXT_LIMIT) {
          const buf = await fs.readFile(abs);
          item.hash = sha(buf);
          item.binary = isBinary(buf);
          if (!item.binary) item.lines = countLines(buf);
        } else if (st.size <= 256 * 1024 * 1024) {
          item.hash = await hashFile(abs);
          item.binary = isBinary(await readHead(abs, SNIFF));
        } else {
          item.hash = `size:${st.size}:${st.mtimeMs}`;
          item.binary = true;
        }
      } catch {
        continue;
      }
      entries.set(child, item);
    }
  }
  await walk('');
  inventoryCache.set(root, entries);
  return { entries, truncated };
}

async function writeBaseline(root, current) {
  const dir = snapshotDir(root);
  const blobs = path.join(dir, 'blobs');
  await fs.mkdir(blobs, { recursive: true });
  const entries = {};
  let budget = SNAPSHOT_BLOB_BUDGET;
  for (const [rel, item] of current.entries) {
    const entry = { hash: item.hash, size: item.size, mtime: item.mtime, binary: item.binary, lines: item.lines, link: item.link, stored: false };
    if (!item.binary && !item.link && item.size <= TEXT_LIMIT && item.size < budget && !describe(rel).complex) {
      const blob = path.join(blobs, item.hash);
      try {
        await fs.access(blob);
        entry.stored = true;
      } catch {
        try {
          const buf = await fs.readFile(path.join(root, rel));
          if (sha(buf) === item.hash) {
            await fs.writeFile(`${blob}.tmp`, buf);
            await fs.rename(`${blob}.tmp`, blob);
            budget -= buf.length;
            entry.stored = true;
          }
        } catch {
          // file vanished mid-snapshot
        }
      }
    }
    entries[rel] = entry;
  }
  const manifest = { version: 1, root, createdAt: new Date().toISOString(), truncated: current.truncated, entries };
  const file = path.join(dir, 'manifest.json');
  await fs.writeFile(`${file}.tmp`, JSON.stringify(manifest));
  await fs.rename(`${file}.tmp`, file);
  // drop blobs no manifest entry references
  const keep = new Set(Object.values(entries).filter((e) => e.stored).map((e) => e.hash));
  for (const name of await fs.readdir(blobs)) if (!keep.has(name)) await fs.rm(path.join(blobs, name), { force: true });
  baselineCache.set(root, manifest);
  return manifest;
}

async function loadBaseline(root, current) {
  const cached = baselineCache.get(root);
  if (cached) return cached;
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(snapshotDir(root), 'manifest.json'), 'utf8'));
    baselineCache.set(root, manifest);
    return manifest;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return writeBaseline(root, current || (await inventory(root)));
}

async function readBlob(root, entry) {
  if (!entry?.stored) return null;
  try {
    return await fs.readFile(path.join(snapshotDir(root), 'blobs', entry.hash));
  } catch {
    return null;
  }
}

async function plainChangeCounts(root, rel, before, now) {
  const key = `${root}\0${rel}\0${before.hash}\0${now.hash}`;
  if (diffCountCache.has(key)) return diffCountCache.get(key);
  let result = { added: null, removed: null };
  if (before.stored && now.size <= 256 * 1024) {
    const [oldBuf, newBuf] = await Promise.all([readBlob(root, before), fs.readFile(path.join(root, rel)).catch(() => null)]);
    if (oldBuf && newBuf) {
      result = { added: 0, removed: 0 };
      for (const part of diffLines(oldBuf.toString('utf8'), newBuf.toString('utf8'))) {
        if (part.added) result.added += part.count;
        else if (part.removed) result.removed += part.count;
      }
    }
  }
  if (diffCountCache.size > 5000) diffCountCache.clear();
  diffCountCache.set(key, result);
  return result;
}

async function scanPlainRoot(root, options) {
  const current = await inventory(root);
  const base = await loadBaseline(root, current);
  const names = new Set([...Object.keys(base.entries), ...current.entries.keys()]);
  const files = [];
  for (const rel of names) {
    const before = base.entries[rel];
    const now = current.entries.get(rel);
    if (before && now && before.hash === now.hash) continue;
    const ref = now || before;
    const meta = { exists: Boolean(now), symlink: ref.link, binary: ref.binary, size: now ? now.size : 0 };
    const kind = classify(rel, meta, options, { binaryHint: ref.binary });
    const status = !before ? 'A' : !now ? 'D' : 'M';
    let added = null;
    let removed = null;
    if (!kind.complex) {
      if (status === 'A') [added, removed] = [now.lines, 0];
      else if (status === 'D') [added, removed] = [0, before.lines ?? null];
      else ({ added, removed } = await plainChangeCounts(root, rel, before, now));
    }
    files.push({
      path: rel,
      repoPath: rel,
      oldRepoPath: null,
      oldPath: null,
      status,
      xy: null,
      staged: false,
      unstaged: true,
      added,
      removed,
      ...kind,
      size: now ? now.size : 0,
      mtime: now ? now.mtime : 0,
      exists: Boolean(now),
    });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { kind: 'plain', baselineAt: base.createdAt, truncated: Boolean(current.truncated), files };
}

async function resetBaseline(root) {
  root = path.resolve(root);
  const info = await inspectRoot(root, { fresh: true });
  if (info.kind !== 'plain') throw new Error('Only folders without Git use a baseline');
  return { baselineAt: (await writeBaseline(root, await inventory(root))).createdAt };
}

// ---------------------------------------------------------------- public scan API

async function scanRoot(root, options = {}) {
  root = path.resolve(root);
  const base = { path: root, name: path.basename(root) };
  try {
    const info = await inspectRoot(root);
    if (info.kind === 'missing') return { ...base, kind: 'missing', files: [], error: info.error };
    const result = info.kind === 'git' ? await scanGitRoot(root, info, options) : await scanPlainRoot(root, options);
    return { ...base, ...result };
  } catch (error) {
    inspectCache.delete(root);
    return { ...base, kind: 'error', files: [], error: error.message };
  }
}

async function scanRoots(roots, options = {}) {
  return mapLimit([...new Set(roots.map((r) => path.resolve(r)))], 6, (root) => scanRoot(root, options));
}

async function scan(roots, options = {}) {
  return { repos: await scanRoots(roots, options), scannedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------- detail (old/new content)

async function readGitObject(root, spec, { sizeOnly = false } = {}) {
  let size;
  try {
    size = Number((await git(root, ['cat-file', '-s', spec])).trim());
  } catch {
    return null;
  }
  if (sizeOnly) return { size };
  if (size > TEXT_LIMIT) return { size, large: true };
  return { size, buf: await git(root, ['cat-file', 'blob', spec], { buffer: true }) };
}

async function readWorktree(abs, { sizeOnly = false } = {}) {
  try {
    const st = await fs.lstat(abs);
    if (st.isSymbolicLink()) return { size: st.size, link: true };
    if (!st.isFile()) return { size: 0, notFile: true };
    if (sizeOnly) return { size: st.size };
    if (st.size > TEXT_LIMIT) return { size: st.size, large: true };
    return { size: st.size, buf: await fs.readFile(abs) };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

function finishDetail(rel, d, oldSide, newSide, labels, extra = {}) {
  const base = {
    path: rel,
    type: d.type,
    category: d.category,
    language: d.language,
    oldLabel: labels[0],
    newLabel: labels[1],
    oldExists: Boolean(oldSide),
    newExists: Boolean(newSide),
    oldSize: oldSide ? oldSide.size : null,
    newSize: newSide ? newSide.size : null,
    ...extra,
  };
  const sides = [oldSide, newSide].filter(Boolean);
  if (d.complex) return { ...base, kind: 'complex', reason: 'asset' };
  if (sides.some((s) => s.link)) return { ...base, kind: 'complex', type: 'Symbolic link', category: 'binary', reason: 'link' };
  if (sides.some((s) => s.notFile)) return { ...base, kind: 'complex', type: 'Nested folder', category: 'binary', reason: 'folder' };
  if (sides.some((s) => s.large)) return { ...base, kind: 'complex', reason: 'large' };
  if (sides.some((s) => s.buf && isBinary(s.buf))) {
    return { ...base, kind: 'complex', type: d.known ? d.type : 'Binary file', category: d.known ? d.category : 'binary', reason: 'binary' };
  }
  if (oldSide && oldSide.missingContent) return { ...base, kind: 'text', oldText: null, newText: newSide?.buf ? newSide.buf.toString('utf8') : '' };
  return {
    ...base,
    kind: 'text',
    oldText: oldSide?.buf ? oldSide.buf.toString('utf8') : '',
    newText: newSide?.buf ? newSide.buf.toString('utf8') : '',
  };
}

/**
 * Old and new content of one changed file.
 * compare: 'all' (HEAD -> working tree), 'staged' (HEAD -> index), 'unstaged' (index -> working tree)
 */
async function fileDetail(root, rel, options = {}) {
  root = path.resolve(String(root));
  const abs = resolveInside(root, rel);
  await assertNoEscape(root, abs);
  const info = await inspectRoot(root);
  const d = describe(rel, options);
  const sizeOnly = d.complex;
  if (info.kind === 'git') {
    const repoPath = info.prefix + rel;
    const oldRepoPath = cleanRepoPath(options.oldRepoPath) || repoPath;
    const compare = options.compare === 'staged' || options.compare === 'unstaged' ? options.compare : 'all';
    let head = false;
    try {
      await git(root, ['rev-parse', '--verify', '-q', 'HEAD']);
      head = true;
    } catch {
      head = false;
    }
    const fromHead = () => (head ? readGitObject(root, `HEAD:${oldRepoPath}`, { sizeOnly }) : null);
    const fromIndex = (p) => readGitObject(root, `:${p}`, { sizeOnly });
    let oldSide;
    let newSide;
    let labels;
    if (compare === 'staged') {
      [oldSide, newSide, labels] = [await fromHead(), await fromIndex(repoPath), ['HEAD', 'Staged']];
    } else if (compare === 'unstaged') {
      [oldSide, newSide, labels] = [await fromIndex(repoPath), await readWorktree(abs, { sizeOnly }), ['Staged', 'Working tree']];
    } else {
      [oldSide, newSide, labels] = [await fromHead(), await readWorktree(abs, { sizeOnly }), [head ? 'HEAD' : 'Empty', 'Working tree']];
    }
    return finishDetail(rel, d, oldSide, newSide, labels, { compare, oldPath: oldRepoPath !== repoPath ? oldRepoPath : null });
  }
  if (info.kind === 'plain') {
    const base = await loadBaseline(root);
    const entry = base.entries[rel];
    let oldSide = null;
    if (entry) {
      if (entry.link) oldSide = { size: entry.size, link: true };
      else if (sizeOnly || entry.binary) oldSide = { size: entry.size, buf: entry.binary ? Buffer.from([0]) : undefined };
      else {
        const buf = await readBlob(root, entry);
        oldSide = buf ? { size: entry.size, buf } : { size: entry.size, missingContent: true };
      }
    }
    const newSide = await readWorktree(abs, { sizeOnly });
    return finishDetail(rel, d, oldSide, newSide, ['Baseline', 'Now'], { compare: 'all', baselineAt: base.createdAt });
  }
  throw new Error(info.error || 'Folder not found');
}

// ---------------------------------------------------------------- browsing (every file, not just changes)

const LIST_LIMIT = 25000;
const MEDIA_LIMIT = 64 * 1024 * 1024; // bytes sent to the renderer for an image/audio/video preview

/** Every file in a folder: Git repos list tracked + untracked (not ignored); plain folders use the inventory walk. */
async function listFiles(root, options = {}) {
  root = path.resolve(String(root));
  const base = { path: root, name: path.basename(root) };
  try {
    const info = await inspectRoot(root);
    if (info.kind === 'missing') return { ...base, kind: 'missing', files: [], truncated: false, error: info.error };
    const entries = [];
    let truncated = false;
    if (info.kind === 'git') {
      const out = await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate']);
      const rels = [...new Set(out.split('\0').filter(Boolean))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      if (rels.length > LIST_LIMIT) truncated = true;
      const stats = await mapLimit(rels.slice(0, LIST_LIMIT), 32, async (rel) => {
        try {
          const st = await fs.lstat(path.join(root, rel));
          return st.isFile() || st.isSymbolicLink() ? { rel, size: st.size, mtime: st.mtimeMs, link: st.isSymbolicLink() } : null;
        } catch {
          return null; // deleted in the working tree: the Changes tab shows those
        }
      });
      for (const s of stats) if (s) entries.push(s);
    } else {
      const inv = await inventory(root);
      truncated = inv.truncated;
      for (const [rel, item] of inv.entries) entries.push({ rel, size: item.size, mtime: item.mtime, link: item.link });
    }
    const files = entries.map(({ rel, size, mtime, link }) => ({ path: rel, size, mtime, link, ...describe(rel, options) }));
    return { ...base, kind: info.kind, files, truncated };
  } catch (error) {
    inspectCache.delete(root);
    return { ...base, kind: 'error', files: [], truncated: false, error: error.message };
  }
}

function sniffMedia(buf, category, rel) {
  const hex = buf.subarray(0, 16).toString('hex');
  const ascii = buf.subarray(0, 16).toString('latin1');
  if (hex.startsWith('89504e47')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (ascii.startsWith('GIF8')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.startsWith('BM')) return category === 'image' ? 'image/bmp' : null;
  if (hex.startsWith('00000100')) return 'image/x-icon';
  if (ascii.slice(4, 12) === 'ftypavif' || ascii.slice(4, 12) === 'ftypavis') return 'image/avif';
  if (category === 'image' && /\.svg$/i.test(rel)) {
    const head = buf.subarray(0, 4096).toString('utf8');
    return /<svg[\s>]/i.test(head) ? 'image/svg+xml' : null;
  }
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii.startsWith('OggS')) return category === 'video' ? 'video/ogg' : 'audio/ogg';
  if (ascii.startsWith('fLaC')) return 'audio/flac';
  if (ascii.startsWith('ID3') || hex.startsWith('fffb') || hex.startsWith('fff3') || hex.startsWith('fff2')) return 'audio/mpeg';
  if (hex.startsWith('1a45dfa3')) return category === 'audio' ? 'audio/webm' : 'video/webm';
  if (ascii.slice(4, 8) === 'ftyp') return category === 'audio' ? 'audio/mp4' : 'video/mp4';
  return null;
}

/**
 * Current content of one file for the Files tab.
 * kind: 'text' (text), 'media' (bytes + mime for an image/audio/video preview) or 'asset' (type only, with a reason).
 */
async function fileContent(root, rel, options = {}) {
  root = path.resolve(String(root));
  const abs = resolveInside(root, rel);
  await assertNoEscape(root, abs);
  const d = describe(rel, options);
  const base = { path: rel, type: d.type, category: d.category, language: d.language, size: 0, mtime: 0 };
  let st;
  try {
    st = await fs.lstat(abs);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { ...base, kind: 'asset', reason: 'missing' };
    throw error;
  }
  Object.assign(base, { size: st.size, mtime: st.mtimeMs });
  if (st.isSymbolicLink()) return { ...base, kind: 'asset', type: 'Symbolic link', category: 'binary', reason: 'link', target: await fs.readlink(abs) };
  if (!st.isFile()) return { ...base, kind: 'asset', type: 'Folder', category: 'binary', reason: 'folder' };
  const media = ['image', 'audio', 'video'].includes(d.category);
  if (media) {
    if (st.size > MEDIA_LIMIT) return { ...base, kind: 'asset', reason: 'large' };
    const buf = await fs.readFile(abs);
    const mime = sniffMedia(buf, d.category, rel);
    if (mime) return { ...base, kind: 'media', mime, data: new Uint8Array(buf.buffer, buf.byteOffset, buf.length) };
    return { ...base, kind: 'asset', reason: 'format' };
  }
  if (st.size > TEXT_LIMIT) return { ...base, kind: 'asset', reason: 'large' };
  const buf = await fs.readFile(abs);
  if (isBinary(buf)) return { ...base, kind: 'asset', type: d.known ? d.type : 'Binary file', category: d.known ? d.category : 'binary', reason: 'binary' };
  // Text content is shown even for types the Changes tab treats as assets (e.g. Godot scenes, glTF).
  return { ...base, kind: 'text', language: d.language, text: buf.toString('utf8'), lines: countLines(buf) };
}

module.exports = {
  TEXT_LIMIT,
  listFiles,
  fileContent,
  git,
  mapLimit,
  inspectRoot,
  scan,
  scanRoot,
  scanRoots,
  fileDetail,
  resetBaseline,
  readGitObject,
  finishDetail,
  cleanRepoPath,
  parseStatus,
  parseNumstat,
  displayStatus,
  _caches: { inspectCache, metaCache, inventoryCache, baselineCache },
};
