'use strict';
// Drives the real Electron app (built renderer + source main) against a fixture project.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { makeFixture } = require('../fixture.cjs');

const APP = path.resolve(__dirname, '../..');
// Playwright is not a dependency of the app; use a local install or point PLAYWRIGHT_DIR at one.
const { _electron: electron } = require(process.env.PLAYWRIGHT_DIR || 'playwright');

const fx = makeFixture();
const userData = path.join(fx.base, 'profile');
const snapshots = path.join(fx.base, 'snapshots');
const themeDir = path.join(fx.base, 'theme', 'current', 'theme');
fs.mkdirSync(themeDir, { recursive: true });
const writeTheme = (bg, accent) =>
  fs.writeFileSync(path.join(themeDir, 'colors.toml'), `mode = "dark"\naccent = "${accent}"\nbackground = "${bg}"\nforeground = "#d0d0d0"\nred = "#ff5555"\ngreen = "#55ff55"\nyellow = "#ffff55"\n`);
writeTheme('#112233', '#ff8800');

const errors = [];

async function launch() {
  const app = await electron.launch({
    executablePath: require(path.join(APP, 'node_modules/electron')),
    args: ['--ozone-platform=x11', '--disable-gpu', `--user-data-dir=${userData}`, APP],
    env: { ...process.env, WAYLAND_DISPLAY: '', GITVIEW_SNAPSHOT_DIR: snapshots, GITVIEW_THEME_DIR: themeDir },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()} ${m.location()?.url || ''}`));
  await page.setViewportSize({ width: 1440, height: 900 });
  return { app, page };
}

async function fits(page) {
  const box = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, vh: innerHeight, vw: innerWidth }));
  assert.ok(box.h <= box.vh && box.w <= box.vw, `document ${box.w}x${box.h} exceeds viewport ${box.vw}x${box.vh}`);
}

test.after(() => fx.cleanup());

test('gitview end to end', async (t) => {
  let { app, page } = await launch();

  const pickFolders = (folders) =>
    app.evaluate(({ dialog }, list) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: list });
    }, folders);

  await t.test('starts with no projects; Add project picks folders and shows live numbers', async () => {
    await page.locator('.home .add-card').waitFor();
    assert.equal(await page.locator('.card:not(.add-card)').count(), 0, 'no built-in project');
    assert.equal(await page.locator('.brand-name').textContent(), 'gitview');
    assert.equal(await page.title(), 'gitview');
    await pickFolders([fx.main, fx.wt]);
    await page.locator('.home-actions .primary').click();
    await page.locator('.crumb', { hasText: 'game' }).waitFor();
    await page.locator('.home-btn').click();
    await page.locator('.card .card-name', { hasText: 'game' }).waitFor();
    await page.locator('.card .stat-value', { hasText: '5' }).first().waitFor();
  });

  await t.test('follows the Omarchy theme live', async () => {
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, 'rgb(17, 34, 51)');
    writeTheme('#221100', '#00aaff');
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(34, 17, 0)', null, { timeout: 10000 });
    await fits(page);
  });

  await t.test('project view lists every folder and change', async () => {
    await page.locator('.card:not(.add-card)').first().click();
    await page.locator('.file-row').first().waitFor();
    assert.equal(await page.locator('.sidebar .folder-wrap').count(), 2);
    assert.equal(await page.locator('.file-row').count(), 5);
    assert.equal(await page.locator('.home-btn').isVisible(), true);
    const box = await page.locator('.home-btn').boundingBox();
    assert.ok(box.x < 40 && box.y < 30, 'home button sits at the top left');
    await fits(page);
  });

  await t.test('text files get a split diff with aligned line numbers and word marks', async () => {
    await page.locator('.file-row', { hasText: 'notes.md' }).click();
    await page.locator('.diff.split').waitFor();
    const report = await page.evaluate(() => {
      const ctxMissing = [...document.querySelectorAll('.split .cell.ctx .ln')].filter((n) => !n.textContent.trim()).length;
      const added = [...document.querySelectorAll('.split .cell.add .code')].map((n) => n.textContent);
      const marks = document.querySelectorAll('.split .cell.add mark').length;
      const gaps = document.querySelectorAll('.gap').length;
      return { ctxMissing, added, marks, gaps };
    });
    assert.equal(report.ctxMissing, 0, 'every context cell has a line number');
    assert.ok(report.added.includes('inserted A') && report.added.includes('line 29 edited'), JSON.stringify(report.added));
    assert.ok(report.marks >= 1, 'edited line has a word-level mark');
    assert.ok(report.gaps >= 1, 'unchanged regions are collapsed');
    await page.locator('.gap').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.split .row').length >= 42);
    await page.locator('.diff-tools .segmented button').nth(1).click();
    await page.locator('.diff.unified').waitFor();
    await fits(page);
  });

  await t.test('assets show only their type', async () => {
    await page.locator('.file-row', { hasText: 'icon.png' }).click();
    await page.locator('.asset-type', { hasText: 'PNG image' }).waitFor();
    assert.equal(await page.locator('.diff').count(), 0);
  });

  await t.test('filters and search narrow the list', async () => {
    await page.locator('.filters > button', { hasText: 'Assets' }).click();
    assert.equal(await page.locator('.file-row').count(), 1);
    await page.locator('.filters > button', { hasText: 'All' }).click();
    await page.keyboard.press('/');
    await page.keyboard.type('player');
    assert.equal(await page.locator('.file-row').count(), 1);
    await page.locator('.search .clear').click();
    await page.locator('.sidebar .folder', { hasText: 'combat' }).click();
    assert.equal(await page.locator('.file-row').count(), 1);
    await page.locator('.sidebar .folder', { hasText: 'All folders' }).click();
  });

  await t.test('history shows commits, their files and diffs', async () => {
    await page.locator('.tabs button', { hasText: 'History' }).click();
    await page.locator('.commit-row').first().waitFor();
    assert.equal(await page.locator('.commit-row').count(), 2);
    assert.equal(await page.locator('.commit-row .commit-subject').first().textContent(), 'Add jump');
    await page.locator('.commit-files .file-row', { hasText: 'player.gd' }).waitFor();
    await page.locator('.diff :is(.cell.add, .row.add)', { hasText: 'func jump' }).first().waitFor();
    await fits(page);
  });

  await t.test('Files lists every file as a tree and shows its content', async () => {
    await page.locator('.tabs button', { hasText: 'Files' }).click();
    await page.locator('.files-pane .tree-row.file').first().waitFor();
    // both folders, each with its own files (deleted gone.txt is not there; untracked fresh.txt is)
    assert.equal(await page.locator('.files-pane .group-head').count(), 2);
    const names = await page.locator('.files-pane .tree-row.file .tree-name').allTextContents();
    assert.deepEqual(names.slice(0, 4), ['fresh.txt', 'icon.png', 'notes.md', 'player.gd']);
    assert.equal(names.filter((n) => n === 'gone.txt').length, 1, 'only the worktree still has gone.txt');
    assert.equal(await page.locator('.tabs button', { hasText: 'Files' }).locator('.tab-count').textContent(), '8');
    // unchanged files are listed too, changed ones carry their status
    await page.locator('.files-pane .tree-row.file', { hasText: 'notes.md' }).first().locator('.status.s-M').waitFor();
    await page.locator('.files-pane .tree-row.file', { hasText: 'player.gd' }).first().click();
    await page.locator('.viewer .row', { hasText: 'func jump' }).waitFor();
    assert.equal(await page.locator('.viewer .row').count(), 7);
    assert.equal(await page.locator('.viewer .row .ln').first().textContent(), '1');
    await page.locator('.files-pane .tree-row.file', { hasText: 'icon.png' }).first().click();
    await page.waitForFunction(() => document.querySelector('.image-stage img')?.naturalWidth === 1);
    assert.match(await page.locator('.diff-head .path-line').textContent(), /1 × 1/);
    await page.keyboard.press('/');
    await page.keyboard.type('combat');
    assert.equal(await page.locator('.files-pane .tree-row.file').count(), 4);
    await page.locator('.files-pane .search .clear').click();
    await fits(page);
    await page.setViewportSize({ width: 620, height: 660 });
    await page.locator('.files-pane.full').waitFor();
    await page.locator('.files-pane .tree-row.file', { hasText: 'notes.md' }).first().click();
    await page.locator('.viewer .row', { hasText: 'inserted A' }).waitFor();
    assert.ok((await page.evaluate(() => document.querySelector('.diff-panel').getBoundingClientRect().width)) >= 615);
    await fits(page);
    await page.keyboard.press('Escape');
    await page.locator('.files-pane.full').waitFor();
    // a very small tile still lays out inside the window
    await page.setViewportSize({ width: 300, height: 330 });
    await page.locator('.files-pane .tree-row.file', { hasText: 'icon.png' }).first().click();
    await page.waitForFunction(() => document.querySelector('.image-stage img')?.naturalWidth === 1);
    const right = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.topbar button, .diff-head button, .diff-head .fname')].map((n) => n.getBoundingClientRect().right)));
    assert.ok(right <= 300, `top bar and file header fit a 300 px window (right edge ${right})`);
    await fits(page);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.tabs button', { hasText: 'Changes' }).click();
  });

  await t.test('settings change and persist', async () => {
    await page.locator('.top-right .icon-btn[title="Settings"]').click();
    await page.locator('.modal').waitFor();
    await page.locator('.set-row', { hasText: 'Layout' }).locator('button', { hasText: 'Unified' }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.modal').count(), 0);
  });

  await t.test('the open file gets the window: focus mode, auto-hidden folders, narrow stacking', async () => {
    const width = (sel) => page.evaluate((s) => document.querySelector(s)?.getBoundingClientRect().width ?? 0, sel);
    await page.locator('.home-btn').click();
    await page.locator('.card:not(.add-card)').first().click();
    await page.locator('.file-row', { hasText: 'notes.md' }).click();
    await page.keyboard.press('f');
    assert.equal(await page.locator('.list-pane').count(), 0);
    assert.ok((await width('.diff-panel')) >= 1430, 'focus mode gives the file the whole width');
    await page.keyboard.press('Escape');
    await page.locator('.list-pane').waitFor();
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.waitForFunction(() => !document.querySelector('.sidebar'));
    await page.setViewportSize({ width: 620, height: 660 });
    await page.locator('.list-pane.full').waitFor();
    await page.locator('.file-row', { hasText: 'notes.md' }).click();
    await page.locator('.diff').waitFor();
    assert.ok((await width('.diff-panel')) >= 615, 'narrow window shows the file full width');
    await page.keyboard.press('Escape');
    await page.locator('.list-pane.full').waitFor();
    await fits(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await t.test('home button returns to projects; Add project uses the folder picker', async () => {
    await page.locator('.home-btn').click();
    await page.locator('.home .add-card').waitFor();
    fs.mkdirSync(path.join(fx.plain, 'pics'));
    fs.copyFileSync(path.join(fx.main, 'icon.png'), path.join(fx.plain, 'pics', 'shot.png'));
    await pickFolders([fx.plain]);
    await page.locator('.home-actions .primary').click();
    await page.locator('.crumb', { hasText: 'sketches' }).waitFor();
    await page.locator('.empty-title', { hasText: 'Working tree clean' }).waitFor();
    // nothing changed yet, but the folder's content is one click away
    await page.locator('.browse-btn').click();
    await page.locator('.files-pane .tree-row.dir', { hasText: 'pics' }).waitFor();
    await page.locator('.files-pane .tree-row.file', { hasText: 'idea.txt' }).click();
    await page.locator('.viewer .row', { hasText: 'first idea' }).waitFor();
    await page.locator('.files-pane .tree-row.file', { hasText: 'shot.png' }).click();
    await page.waitForFunction(() => document.querySelector('.image-stage img')?.naturalWidth === 1);
    await page.locator('.files-pane .tree-row.dir', { hasText: 'pics' }).click();
    assert.equal(await page.locator('.files-pane .tree-row.file', { hasText: 'shot.png' }).count(), 0, 'folders collapse');
    await page.locator('.tabs button', { hasText: 'Changes' }).click();
    fs.writeFileSync(path.join(fx.plain, 'idea.txt'), 'first idea\nbetter idea\n');
    await page.locator('.top-right .icon-btn[title="Refresh (R)"]').click();
    await page.locator('.file-row', { hasText: 'idea.txt' }).waitFor();
    await page.locator('.diff.unified .row.add', { hasText: 'better idea' }).waitFor();
  });

  await app.close();

  await t.test('projects and settings survive a restart', async () => {
    ({ app, page } = await launch());
    await page.locator('.card .card-name', { hasText: 'sketches' }).waitFor();
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'gitview.json'), 'utf8'));
    assert.equal(saved.prefs.diffView, 'unified');
    assert.deepEqual(saved.projects.map((p) => p.name), ['game', 'sketches']);
    assert.deepEqual(saved.projects[0].roots, [fx.main, fx.wt]);
    await app.close();
  });

  await t.test('no renderer errors were logged', () => {
    assert.deepEqual(errors, []);
  });
});
