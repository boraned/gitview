'use strict';
// Follows the active Omarchy theme: UI colours from colors.toml, code colours from vscode-theme.json.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const KEYS = [
  'accent', 'selection', 'muted', 'background', 'dark_background', 'darker_background', 'lighter_background',
  'foreground', 'dark_foreground', 'light_foreground', 'bright_foreground',
  'red', 'yellow', 'orange', 'green', 'cyan', 'blue', 'magenta',
  'bright_red', 'bright_yellow', 'bright_green', 'bright_cyan', 'bright_blue', 'bright_magenta',
];

function themeDir() {
  return process.env.GITVIEW_THEME_DIR || path.join(os.homedir(), '.local', 'state', 'omarchy', 'current', 'theme');
}

function parseColors(text) {
  const colors = {};
  let mode = null;
  for (const line of text.split('\n')) {
    const match = /^\s*([a-z_]+)\s*=\s*"([^"]*)"/i.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (key === 'mode') mode = value === 'light' ? 'light' : 'dark';
    else if (KEYS.includes(key) && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) colors[key] = value.slice(0, 7).toLowerCase();
  }
  return { colors, mode };
}

function luminance(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

async function readTheme() {
  const dir = themeDir();
  let parsed;
  try {
    parsed = parseColors(await fsp.readFile(path.join(dir, 'colors.toml'), 'utf8'));
  } catch {
    return null;
  }
  const { colors } = parsed;
  if (!colors.background || !colors.foreground) return null;
  let name = null;
  try {
    name = (await fsp.readFile(path.join(path.dirname(dir), 'theme.name'), 'utf8')).trim() || null;
  } catch {
    name = null;
  }
  let code = null;
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(dir, 'vscode-theme.json'), 'utf8'));
    if (Array.isArray(raw.tokenColors)) {
      code = { name: 'omarchy', type: raw.type === 'light' ? 'light' : 'dark', colors: raw.colors || {}, tokenColors: raw.tokenColors, semanticTokenColors: raw.semanticTokenColors };
    }
  } catch {
    code = null;
  }
  const mode = parsed.mode || (luminance(colors.background) > 0.4 ? 'light' : 'dark');
  return { source: 'omarchy', name, mode, colors, code };
}

/** Calls `onChange` whenever Omarchy swaps the current theme. Returns a disposer. */
function watchTheme(onChange) {
  const dir = themeDir();
  const parent = path.dirname(dir);
  let timer = null;
  let last = '';
  let watcher = null;
  const check = async () => {
    const theme = await readTheme();
    const signature = JSON.stringify(theme);
    if (signature === last) return;
    last = signature;
    onChange(theme);
  };
  readTheme().then((theme) => {
    last = JSON.stringify(theme);
  });
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(check, 350);
  };
  try {
    watcher = fs.watch(parent, { persistent: false }, schedule);
    watcher.on('error', () => {});
  } catch {
    watcher = null;
  }
  // fs.watch misses some atomic swaps; a slow poll keeps us honest
  const poll = setInterval(check, 5000);
  poll.unref?.();
  return () => {
    clearTimeout(timer);
    clearInterval(poll);
    watcher?.close();
  };
}

module.exports = { readTheme, watchTheme, parseColors, themeDir };
