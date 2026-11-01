'use strict';
// gitview main process. Renderer is the Vite build in dist/; everything here is plain CommonJS.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Store } = require('./store.cjs');
const backend = require('./backend.cjs');
const history = require('./history.cjs');
const { readTheme, watchTheme } = require('./theme.cjs');

app.setName('gitview');

const APP_ROOT = path.join(__dirname, '..');
const DIST = path.join(APP_ROOT, 'dist');
const DEV_URL = process.env.GITVIEW_DEV_URL || null;

let store;
let win = null;
let stopTheme = null;

// ------------------------------------------------------------------ project roots

const rootCache = new Map(); // projectId -> roots from the last scan (authorises detail calls)

async function projectRoots(id) {
  const roots = store.project(id).roots;
  rootCache.set(id, roots.map((r) => path.resolve(r)));
  return roots;
}

function assertRoot(id, root) {
  const allowed = rootCache.get(id) || [];
  if (!allowed.includes(path.resolve(String(root)))) throw new Error('That folder is not part of this project');
}

function scanOptions() {
  return { godotTextScenes: store.prefs.godotTextScenes };
}

async function scanProject(id) {
  const project = store.project(id);
  const roots = await projectRoots(id);
  const result = await backend.scan(roots, scanOptions());
  const files = result.repos.flatMap((r) => r.files);
  const summary = {
    count: files.length,
    assets: files.filter((f) => f.complex).length,
    added: files.reduce((n, f) => n + (f.added || 0), 0),
    removed: files.reduce((n, f) => n + (f.removed || 0), 0),
    folders: result.repos.length,
    errors: result.repos.filter((r) => r.error).length,
    scannedAt: result.scannedAt,
  };
  store.setSummary(id, summary);
  return { ...result, project, summary };
}

// ------------------------------------------------------------------ window

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    // No minimum size: tiling window managers often give gitview a narrow or short tile, and the
    // renderer must lay out at the real size (a minimum makes it render larger and get cropped).
    title: 'gitview',
    backgroundColor: '#0b0c0e',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(APP_ROOT, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!DEV_URL || !url.startsWith(DEV_URL)) event.preventDefault();
  });
  win.on('closed', () => {
    win = null;
  });
  if (DEV_URL) {
    win.loadURL(DEV_URL);
    return;
  }
  const index = path.join(DIST, 'index.html');
  if (!fs.existsSync(index)) {
    dialog.showErrorBox('gitview is not built', `Missing ${index}.\nRun "npm run build" in ${APP_ROOT}.`);
    app.quit();
    return;
  }
  win.loadFile(index);
}

// ------------------------------------------------------------------ IPC

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => fn(...args));
}

function registerIpc() {
  handle('projects:list', () => store.projects.map((p) => ({ ...p, summary: store.data.summaries[p.id] || null })));

  handle('projects:add', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Add project — choose one or more folders',
      buttonLabel: 'Add project',
      properties: ['openDirectory', 'multiSelections'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const { project, existed } = store.addProject(result.filePaths);
    await store.flush();
    return { project, existed };
  });

  handle('projects:addFolders', async (id) => {
    const project = store.project(id);
    const result = await dialog.showOpenDialog(win, {
      title: `Add folders to ${project.name}`,
      buttonLabel: 'Add folders',
      properties: ['openDirectory', 'multiSelections'],
    });
    if (result.canceled || !result.filePaths.length) return project;
    const updated = store.updateProject(id, { roots: [...project.roots, ...result.filePaths] });
    await store.flush();
    return updated;
  });

  handle('projects:update', async (id, changes) => {
    const project = store.updateProject(id, changes || {});
    await store.flush();
    return project;
  });

  handle('projects:remove', async (id) => {
    store.removeProject(id);
    await store.flush();
    return true;
  });

  handle('projects:summary', async (id) => {
    const scanned = await scanProject(id);
    let activity = null;
    try {
      activity = await history.commitActivity(await projectRoots(id), 24);
    } catch {
      activity = null;
    }
    return { ...scanned.summary, activity };
  });

  handle('scan', (id) => scanProject(id));

  handle('detail', async (id, root, file, options = {}) => {
    assertRoot(id, root);
    return backend.fileDetail(root, file, { ...scanOptions(), compare: options.compare, oldRepoPath: options.oldRepoPath });
  });

  handle('baseline:reset', async (id, root) => {
    assertRoot(id, root);
    return backend.resetBaseline(root);
  });

  handle('history:list', async (id, options = {}) => history.listCommits(await projectRoots(id), options));
  handle('history:commit', async (id, root, hash) => {
    assertRoot(id, root);
    return history.commitDetail(root, hash, scanOptions());
  });
  handle('history:file', async (id, root, hash, repoPath, oldRepoPath) => {
    assertRoot(id, root);
    return history.commitFileDetail(root, hash, repoPath, { ...scanOptions(), oldRepoPath });
  });

  handle('prefs:get', () => store.prefs);
  handle('prefs:set', async (changes) => {
    const prefs = store.setPrefs(changes || {});
    await store.flush();
    return prefs;
  });

  handle('theme:get', () => readTheme());

  handle('shell:reveal', async (id, root, file) => {
    assertRoot(id, root);
    const target = file ? path.join(root, file) : root;
    if (fs.existsSync(target)) shell.showItemInFolder(target);
    else shell.openPath(root);
    return true;
  });
}

// ------------------------------------------------------------------ lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    store = await new Store(app.getPath('userData')).load();
    registerIpc();
    createWindow();
    stopTheme = watchTheme((theme) => {
      if (win && !win.isDestroyed()) win.webContents.send('theme:changed', theme);
    });
  });

  app.on('before-quit', () => {
    try {
      store?.flushSync();
    } catch {
      // nothing useful to do while quitting
    }
    stopTheme?.();
  });

  app.on('window-all-closed', () => app.quit());
}
