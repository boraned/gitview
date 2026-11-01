'use strict';
// Builds a throwaway fixture: a main repo, a linked worktree and a plain folder.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Test Author', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test Author', GIT_COMMITTER_EMAIL: 't@example.com' } });
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5b80000000049454e44ae426082', 'hex');

function makeFixture() {
  const base = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'gitview-fixture-'));
  const main = path.join(base, 'game');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
  fs.writeFileSync(path.join(main, 'notes.md'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(main, 'player.gd'), 'extends Node\n\nfunc _ready():\n\tprint("hello")\n');
  fs.writeFileSync(path.join(main, 'gone.txt'), 'bye\n');
  fs.writeFileSync(path.join(main, 'icon.png'), PNG);
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'Initial commit');
  fs.appendFileSync(path.join(main, 'player.gd'), '\nfunc jump():\n\tpass\n');
  git(main, 'commit', '-q', '-am', 'Add jump');

  // working changes: insert two lines in the middle, edit one, delete a file, add untracked, change an asset
  const changed = [...lines];
  changed.splice(10, 0, 'inserted A', 'inserted B');
  changed[30] = 'line 29 edited';
  fs.writeFileSync(path.join(main, 'notes.md'), changed.join('\n') + '\n');
  fs.rmSync(path.join(main, 'gone.txt'));
  fs.writeFileSync(path.join(main, 'fresh.txt'), 'brand new\nfile\n');
  fs.writeFileSync(path.join(main, 'icon.png'), Buffer.concat([PNG, Buffer.from([0, 1, 2, 3])]));

  // linked worktree on its own branch with one change
  const wt = path.join(base, 'game-combat');
  git(main, 'worktree', 'add', '-q', '-b', 'combat', wt);
  fs.writeFileSync(path.join(wt, 'player.gd'), 'extends Node2D\n\nfunc _ready():\n\tprint("combat")\n\nfunc jump():\n\tpass\n');

  // plain (non-git) folder elsewhere, for "Add project"
  const plain = path.join(base, 'sketches');
  fs.mkdirSync(plain);
  fs.writeFileSync(path.join(plain, 'idea.txt'), 'first idea\n');

  return { base, main, wt, plain, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

module.exports = { makeFixture, git };
