'use strict';
// Persistent gitview state: projects, preferences, review marks and cached card summaries.
// Lives in Electron's userData folder and never inside an observed project.

const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const HUES = ['blue', 'magenta', 'cyan', 'green', 'yellow', 'orange', 'red'];

const DEFAULT_PREFS = Object.freeze({
  theme: 'omarchy', // omarchy | dark | light
  diffView: 'split', // split | unified
  wrap: true,
  context: 3,
  ignoreWhitespace: false,
  listMode: 'list', // list | tree
  sort: 'recent', // recent | path | status
  showGodotMeta: true,
  godotTextScenes: false,
  interval: 15,
  codeSize: 12.5,
});

function defaults() {
  return { version: 2, projects: [], prefs: { ...DEFAULT_PREFS }, reviewed: {}, summaries: {} };
}

function sanitizePrefs(input = {}) {
  const prefs = { ...DEFAULT_PREFS };
  const pick = (key, allowed) => {
    if (allowed.includes(input[key])) prefs[key] = input[key];
  };
  pick('theme', ['omarchy', 'dark', 'light']);
  pick('diffView', ['split', 'unified']);
  pick('listMode', ['list', 'tree']);
  pick('sort', ['recent', 'path', 'status']);
  for (const key of ['wrap', 'ignoreWhitespace', 'showGodotMeta', 'godotTextScenes']) if (typeof input[key] === 'boolean') prefs[key] = input[key];
  if ([0, 3, 5, 10, 25].includes(input.context)) prefs.context = input.context;
  if ([3, 5, 15, 30, 60].includes(input.interval)) prefs.interval = input.interval;
  if ([11.5, 12, 12.5, 13, 14].includes(input.codeSize)) prefs.codeSize = input.codeSize;
  return prefs;
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'gitview.json');
    this.data = defaults();
    this.timer = null;
    this.writing = Promise.resolve();
  }

  async load() {
    let raw = null;
    try {
      raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // keep a copy of an unreadable file instead of silently discarding the user's projects
        await fs.copyFile(this.file, `${this.file}.unreadable`).catch(() => {});
      }
    }
    const data = defaults();
    if (raw) {
      const projects = Array.isArray(raw.projects) ? raw.projects : [];
      for (const p of projects) {
        if (!p || !Array.isArray(p.roots) || !p.roots.length) continue;
        data.projects.push({
          id: String(p.id || randomUUID()),
          name: String(p.name || path.basename(p.roots[0])).slice(0, 80),
          mode: 'folders',
          roots: [...new Set(p.roots.map((r) => path.resolve(String(r))))],
          hue: HUES.includes(p.hue) ? p.hue : HUES[data.projects.length % HUES.length],
          createdAt: p.createdAt || new Date().toISOString(),
        });
      }
      data.prefs = sanitizePrefs(raw.prefs || {});
      data.reviewed = raw.reviewed && typeof raw.reviewed === 'object' ? raw.reviewed : {};
      data.summaries = raw.summaries && typeof raw.summaries === 'object' ? raw.summaries : {};
    }
    this.data = data;
    return this;
  }

  dirty() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const payload = JSON.stringify(this.data, null, 1);
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(this.dir, { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, payload, { mode: 0o600 });
        await fs.rename(tmp, this.file);
      });
    return this.writing;
  }

  flushSync() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    fss.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fss.writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 });
    fss.renameSync(tmp, this.file);
  }

  get projects() {
    return this.data.projects;
  }

  get prefs() {
    return this.data.prefs;
  }

  project(id) {
    const project = this.data.projects.find((p) => p.id === id);
    if (!project) throw new Error('Project not found');
    return project;
  }

  addProject(roots, name) {
    const clean = [...new Set((roots || []).map((r) => path.resolve(String(r))))];
    if (!clean.length) throw new Error('Choose at least one folder');
    const key = JSON.stringify([...clean].sort());
    const existing = this.data.projects.find((p) => p.mode === 'folders' && JSON.stringify([...p.roots].sort()) === key);
    if (existing) return { project: existing, existed: true };
    const project = {
      id: randomUUID(),
      name: String(name || path.basename(clean[0]) || 'Project').slice(0, 80),
      mode: 'folders',
      roots: clean,
      hue: HUES[this.data.projects.length % HUES.length],
      createdAt: new Date().toISOString(),
    };
    this.data.projects.push(project);
    this.dirty();
    return { project, existed: false };
  }

  updateProject(id, changes = {}) {
    const project = this.project(id);
    if (changes.name !== undefined) {
      const name = String(changes.name).trim().slice(0, 80);
      if (!name) throw new Error('A project needs a name');
      project.name = name;
    }
    if (changes.roots !== undefined) {
      const roots = [...new Set(changes.roots.map((r) => path.resolve(String(r))))];
      if (!roots.length) throw new Error('Keep at least one folder');
      project.roots = roots;
      delete this.data.summaries[id];
    }
    if (changes.hue !== undefined && HUES.includes(changes.hue)) project.hue = changes.hue;
    this.dirty();
    return project;
  }

  removeProject(id) {
    this.project(id);
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    delete this.data.reviewed[id];
    delete this.data.summaries[id];
    this.dirty();
  }

  setPrefs(changes) {
    this.data.prefs = sanitizePrefs({ ...this.data.prefs, ...changes });
    this.dirty();
    return this.data.prefs;
  }

  reviewedFor(projectId) {
    return this.data.reviewed[projectId] || {};
  }

  setReviewed(projectId, key, signature) {
    const marks = (this.data.reviewed[projectId] ||= {});
    if (signature) marks[key] = signature;
    else delete marks[key];
    this.dirty();
    return marks;
  }

  // forget marks for files that are no longer changed
  pruneReviewed(projectId, liveKeys) {
    const marks = this.data.reviewed[projectId];
    if (!marks) return;
    let changed = false;
    for (const key of Object.keys(marks)) {
      if (!liveKeys.has(key)) {
        delete marks[key];
        changed = true;
      }
    }
    if (changed) this.dirty();
  }

  setSummary(projectId, summary) {
    this.data.summaries[projectId] = summary;
    this.dirty();
  }
}

module.exports = { Store, DEFAULT_PREFS, sanitizePrefs, HUES };
