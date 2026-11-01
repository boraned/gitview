'use strict';
// Commit history across every Git folder of a project (worktrees of one repository are merged into one timeline).

const path = require('node:path');
const { git, inspectRoot, readGitObject, finishDetail, cleanRepoPath, parseNumstat } = require('./backend.cjs');
const { describe } = require('./filetypes.cjs');

const HASH = /^[0-9a-f]{7,64}$/i;
const LOG_FORMAT = '%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%ct%x1f%S%x1f%s';

async function repoGroups(roots) {
  const groups = new Map();
  for (const root of roots) {
    const info = await inspectRoot(path.resolve(root));
    if (info.kind !== 'git') continue;
    let group = groups.get(info.commonDir);
    if (!group) {
      group = { commonDir: info.commonDir, members: [] };
      groups.set(info.commonDir, group);
    }
    group.members.push({ root: path.resolve(root), info });
  }
  for (const group of groups.values()) {
    await Promise.all(
      group.members.map(async (member) => {
        member.oid = (await git(member.root, ['rev-parse', '--verify', '-q', 'HEAD']).catch(() => '')).trim() || null;
        member.branch = (await git(member.root, ['symbolic-ref', '-q', '--short', 'HEAD']).catch(() => '')).trim() || null;
        member.isMain = path.resolve(member.info.gitDir) === path.resolve(group.commonDir);
      }),
    );
    // The main worktree goes first so shared history is attributed to it, and each other
    // worktree is credited only with commits that are not on the main branch.
    group.members.sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.root.localeCompare(b.root));
  }
  return [...groups.values()];
}

function refsFor(members) {
  const refs = [];
  const owners = new Map();
  for (const member of members) {
    if (!member.oid) continue;
    const ref = member.branch ? `refs/heads/${member.branch}` : member.oid;
    if (owners.has(ref)) continue;
    owners.set(ref, member);
    refs.push(ref);
  }
  return { refs, owners };
}

function parseLog(out) {
  const commits = [];
  for (const chunk of out.split('\x1e')) {
    if (!chunk.trim()) continue;
    const newline = chunk.indexOf('\n');
    const head = newline === -1 ? chunk : chunk.slice(0, newline);
    const rest = newline === -1 ? '' : chunk.slice(newline + 1);
    const [hash, parents, author, email, at, ct, source, ...subject] = head.split('\x1f');
    const stat = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(rest);
    commits.push({
      hash,
      parents: parents ? parents.split(' ') : [],
      author,
      email,
      authoredAt: Number(at) * 1000,
      committedAt: Number(ct) * 1000,
      source,
      subject: subject.join('\x1f'),
      files: stat ? Number(stat[1]) : 0,
      added: stat && stat[2] ? Number(stat[2]) : 0,
      removed: stat && stat[3] ? Number(stat[3]) : 0,
    });
  }
  return commits;
}

/** Newest-first commits reachable from the HEAD of every Git folder (or one folder when `root` is given). */
async function listCommits(roots, { skip = 0, limit = 100, root = null } = {}) {
  skip = Math.max(0, Number(skip) || 0);
  limit = Math.min(500, Math.max(1, Number(limit) || 100));
  const groups = await repoGroups(roots);
  const all = [];
  let hasMore = false;
  for (const group of groups) {
    const members = group.members.filter((m) => !root || m.root === path.resolve(root));
    const { refs, owners } = refsFor(members);
    if (!refs.length) continue;
    const out = await git(group.members[0].root, [
      'log', '--date-order', `--max-count=${skip + limit + 1}`, `--format=${LOG_FORMAT}`,
      '--shortstat', '--diff-merges=first-parent', ...refs, '--',
    ]);
    const commits = parseLog(out);
    if (commits.length > skip + limit) hasMore = true;
    commits.slice(0, skip + limit).forEach((commit, order) => {
      const owner = owners.get(commit.source) || members[0];
      all.push({ ...commit, order, root: owner.root, branch: owner.branch, detached: !owner.branch, source: undefined });
    });
  }
  // newest first; within the same second keep git's own (topological) order
  all.sort((a, b) => b.committedAt - a.committedAt || a.order - b.order);
  for (const c of all) delete c.order;
  if (all.length > skip + limit) hasMore = true;
  return { commits: all.slice(skip, skip + limit), hasMore };
}

function parseNameStatus(out) {
  const parts = out.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i];
    if (!code) continue;
    const letter = code[0];
    if (letter === 'R' || letter === 'C') {
      const from = parts[++i];
      const to = parts[++i];
      files.push({ status: letter, oldRepoPath: from, repoPath: to });
    } else {
      files.push({ status: letter === 'U' ? '!' : letter, oldRepoPath: null, repoPath: parts[++i] });
    }
  }
  return files;
}

async function commitDetail(root, hash, options = {}) {
  root = path.resolve(String(root));
  if (!HASH.test(String(hash))) throw new Error('Invalid commit');
  const info = await inspectRoot(root);
  if (info.kind !== 'git') throw new Error('Not a Git folder');
  const meta = await git(root, ['show', '-s', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ct%x1f%D%x1f%B', hash, '--']);
  const [full, parents, author, email, at, committer, ct, refs, ...body] = meta.split('\x1f');
  const parentList = parents ? parents.split(' ') : [];
  const range = parentList.length ? [parentList[0], full] : ['--root', full];
  const [names, numbers] = await Promise.all([
    git(root, ['diff-tree', '-r', '-z', '-M', '--no-commit-id', '--name-status', ...range]),
    git(root, ['diff-tree', '-r', '-z', '-M', '--no-commit-id', '--numstat', ...range]),
  ]);
  const stats = parseNumstat(numbers);
  const files = parseNameStatus(names).map((file) => {
    const d = describe(file.repoPath, options);
    const stat = stats.get(file.repoPath);
    const binary = Boolean(stat?.binary);
    const complex = d.complex || binary;
    return {
      ...file,
      path: file.repoPath,
      type: binary && !d.known ? 'Binary file' : d.type,
      category: binary && !d.known ? 'binary' : d.category,
      language: d.language,
      complex,
      added: complex ? null : stat?.added ?? null,
      removed: complex ? null : stat?.removed ?? null,
    };
  });
  files.sort((a, b) => (a.repoPath < b.repoPath ? -1 : 1));
  const message = body.join('\x1f').replace(/\s+$/, '');
  const newline = message.indexOf('\n');
  return {
    hash: full,
    parents: parentList,
    author,
    email,
    authoredAt: Number(at) * 1000,
    committer,
    committedAt: Number(ct) * 1000,
    refs: refs ? refs.split(', ').filter(Boolean) : [],
    subject: newline === -1 ? message : message.slice(0, newline),
    body: newline === -1 ? '' : message.slice(newline + 1).trim(),
    files,
    prefix: info.prefix,
  };
}

async function commitFileDetail(root, hash, repoPath, options = {}) {
  root = path.resolve(String(root));
  if (!HASH.test(String(hash))) throw new Error('Invalid commit');
  const file = cleanRepoPath(repoPath);
  if (!file) throw new Error('Invalid file path');
  const oldFile = cleanRepoPath(options.oldRepoPath) || file;
  const parent = (await git(root, ['rev-parse', '--verify', '-q', `${hash}^1`]).catch(() => '')).trim() || null;
  const d = describe(file, options);
  const sizeOnly = d.complex;
  const oldSide = parent ? await readGitObject(root, `${parent}:${oldFile}`, { sizeOnly }) : null;
  const newSide = await readGitObject(root, `${hash}:${file}`, { sizeOnly });
  return finishDetail(file, d, oldSide, newSide, [parent ? parent.slice(0, 7) : 'Empty', hash.slice(0, 7)], {
    compare: 'commit',
    oldPath: oldFile !== file ? oldFile : null,
  });
}

/** Commits per hour over the last `hours` hours plus the newest commit, for project cards. */
async function commitActivity(roots, hours = 24) {
  const groups = await repoGroups(roots);
  const now = Date.now();
  const since = Math.floor(now / 1000) - hours * 3600;
  const buckets = new Array(hours).fill(0);
  let total = 0;
  let last = null;
  for (const group of groups) {
    const { refs } = refsFor(group.members);
    if (!refs.length) continue;
    const out = await git(group.members[0].root, ['log', `--since=${since}`, '--format=%ct%x1f%s', ...refs, '--']);
    for (const line of out.split('\n')) {
      if (!line) continue;
      const [ct, subject] = line.split('\x1f');
      const at = Number(ct) * 1000;
      const index = hours - 1 - Math.floor((now - at) / 3600000);
      if (index >= 0 && index < hours) buckets[index]++;
      total++;
      if (!last || at > last.at) last = { at, subject };
    }
    if (!last) {
      const newest = (await git(group.members[0].root, ['log', '-1', '--format=%ct%x1f%s', ...refs, '--']).catch(() => '')).trim();
      if (newest) {
        const [ct, subject] = newest.split('\x1f');
        const at = Number(ct) * 1000;
        if (!last || at > last.at) last = { at, subject };
      }
    }
  }
  return { hours, buckets, total, last };
}

module.exports = { listCommits, commitDetail, commitFileDetail, commitActivity, repoGroups, parseLog, parseNameStatus };
