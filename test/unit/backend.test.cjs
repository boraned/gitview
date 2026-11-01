'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixture } = require('../fixture.cjs');

process.env.GITVIEW_SNAPSHOT_DIR = fs.mkdtempSync(path.join(process.env.TMPDIR || require('node:os').tmpdir(), 'gitview-snap-'));
const backend = require('../../electron/backend.cjs');
const history = require('../../electron/history.cjs');

const fx = makeFixture();
test.after(() => {
  fx.cleanup();
  fs.rmSync(process.env.GITVIEW_SNAPSHOT_DIR, { recursive: true, force: true });
});

test('scan reports every kind of working change', async () => {
  const { repos } = await backend.scan([fx.main, fx.wt]);
  const main = repos.find((r) => r.path === fx.main);
  const byPath = Object.fromEntries(main.files.map((f) => [f.path, f]));
  assert.equal(main.kind, 'git');
  assert.equal(main.branch, 'main');
  assert.equal(byPath['notes.md'].status, 'M');
  assert.equal(byPath['notes.md'].added, 3);
  assert.equal(byPath['notes.md'].removed, 1);
  assert.equal(byPath['gone.txt'].status, 'D');
  assert.equal(byPath['fresh.txt'].status, 'U');
  assert.equal(byPath['fresh.txt'].added, 2);
  assert.equal(byPath['icon.png'].complex, true);
  assert.equal(byPath['icon.png'].type, 'PNG image');
  const wt = repos.find((r) => r.path === fx.wt);
  assert.equal(wt.branch, 'combat');
  assert.deepEqual(wt.files.map((f) => f.path), ['player.gd']);
});

test('fileDetail returns old/new text for text files and only the type for assets', async () => {
  const text = await backend.fileDetail(fx.main, 'notes.md');
  assert.equal(text.kind, 'text');
  assert.match(text.oldText, /^line 1\n/);
  assert.match(text.newText, /inserted A/);
  const asset = await backend.fileDetail(fx.main, 'icon.png');
  assert.equal(asset.kind, 'complex');
  assert.equal(asset.oldText, undefined);
  assert.ok(asset.newSize > asset.oldSize);
  const deleted = await backend.fileDetail(fx.main, 'gone.txt');
  assert.equal(deleted.newExists, false);
  assert.equal(deleted.oldText, 'bye\n');
});

test('fileDetail refuses paths outside the folder', async () => {
  await assert.rejects(backend.fileDetail(fx.main, '../game-combat/player.gd'), /Invalid file path|outside/);
  await assert.rejects(backend.fileDetail(fx.main, '/etc/passwd'), /Invalid file path/);
});

test('plain folders compare against a persistent baseline', async () => {
  let { repos } = await backend.scan([fx.plain]);
  assert.equal(repos[0].kind, 'plain');
  assert.equal(repos[0].files.length, 0);
  fs.writeFileSync(path.join(fx.plain, 'idea.txt'), 'first idea\nsecond idea\n');
  fs.writeFileSync(path.join(fx.plain, 'new.md'), '# new\n');
  ({ repos } = await backend.scan([fx.plain]));
  const files = Object.fromEntries(repos[0].files.map((f) => [f.path, f.status]));
  assert.deepEqual(files, { 'idea.txt': 'M', 'new.md': 'A' });
  const d = await backend.fileDetail(fx.plain, 'idea.txt');
  assert.equal(d.oldText, 'first idea\n');
  await backend.resetBaseline(fx.plain);
  ({ repos } = await backend.scan([fx.plain]));
  assert.equal(repos[0].files.length, 0);
});

test('history merges worktrees into one timeline and shows commit files', async () => {
  const { commits } = await history.listCommits([fx.main, fx.wt], { limit: 10 });
  assert.deepEqual(commits.map((c) => c.subject), ['Add jump', 'Initial commit']);
  const detail = await history.commitDetail(fx.main, commits[0].hash);
  assert.deepEqual(detail.files.map((f) => [f.status, f.repoPath, f.added]), [['M', 'player.gd', 3]]);
  const file = await history.commitFileDetail(fx.main, commits[0].hash, 'player.gd');
  assert.equal(file.kind, 'text');
  assert.ok(file.newText.includes('func jump'));
  assert.ok(!file.oldText.includes('func jump'));
});

test('scanning never writes inside the observed folders', async () => {
  const snapshot = (dir) => fs.readdirSync(dir, { recursive: true }).filter((p) => !String(p).startsWith('.git')).sort().join('\n');
  const before = snapshot(fx.main);
  await backend.scan([fx.main, fx.wt]);
  await backend.fileDetail(fx.main, 'notes.md');
  assert.equal(snapshot(fx.main), before);
});
