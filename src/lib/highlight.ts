// Syntax highlighting with Shiki, coloured by the active Omarchy theme's VS Code palette.
import { createHighlighterCore, type HighlighterCore, type ThemedToken } from '@shikijs/core';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import type { ThemeInfo } from '../types';

type Loader = () => Promise<{ default: unknown }>;

// Explicit loaders so Vite can split each grammar into its own chunk.
const LANGS: Record<string, Loader> = {
  gdscript: () => import('@shikijs/langs/gdscript'),
  gdshader: () => import('@shikijs/langs/gdshader'),
  gdresource: () => import('@shikijs/langs/gdresource'),
  ini: () => import('@shikijs/langs/ini'),
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  python: () => import('@shikijs/langs/python'),
  rust: () => import('@shikijs/langs/rust'),
  go: () => import('@shikijs/langs/go'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  java: () => import('@shikijs/langs/java'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  swift: () => import('@shikijs/langs/swift'),
  lua: () => import('@shikijs/langs/lua'),
  ruby: () => import('@shikijs/langs/ruby'),
  php: () => import('@shikijs/langs/php'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  fish: () => import('@shikijs/langs/fish'),
  powershell: () => import('@shikijs/langs/powershell'),
  sql: () => import('@shikijs/langs/sql'),
  zig: () => import('@shikijs/langs/zig'),
  dart: () => import('@shikijs/langs/dart'),
  vue: () => import('@shikijs/langs/vue'),
  svelte: () => import('@shikijs/langs/svelte'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
  scss: () => import('@shikijs/langs/scss'),
  less: () => import('@shikijs/langs/less'),
  glsl: () => import('@shikijs/langs/glsl'),
  hlsl: () => import('@shikijs/langs/hlsl'),
  wgsl: () => import('@shikijs/langs/wgsl'),
  lean: () => import('@shikijs/langs/lean'),
  haskell: () => import('@shikijs/langs/haskell'),
  elixir: () => import('@shikijs/langs/elixir'),
  qml: () => import('@shikijs/langs/qml'),
  nix: () => import('@shikijs/langs/nix'),
  r: () => import('@shikijs/langs/r'),
  julia: () => import('@shikijs/langs/julia'),
  cmake: () => import('@shikijs/langs/cmake'),
  diff: () => import('@shikijs/langs/diff'),
  markdown: () => import('@shikijs/langs/markdown'),
  mdx: () => import('@shikijs/langs/mdx'),
  rst: () => import('@shikijs/langs/rst'),
  asciidoc: () => import('@shikijs/langs/asciidoc'),
  latex: () => import('@shikijs/langs/latex'),
  log: () => import('@shikijs/langs/log'),
  json: () => import('@shikijs/langs/json'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  json5: () => import('@shikijs/langs/json5'),
  yaml: () => import('@shikijs/langs/yaml'),
  toml: () => import('@shikijs/langs/toml'),
  dotenv: () => import('@shikijs/langs/dotenv'),
  properties: () => import('@shikijs/langs/properties'),
  xml: () => import('@shikijs/langs/xml'),
  csv: () => import('@shikijs/langs/csv'),
  tsv: () => import('@shikijs/langs/tsv'),
  make: () => import('@shikijs/langs/make'),
  docker: () => import('@shikijs/langs/docker'),
};

const MAX_HIGHLIGHT_CHARS = 400_000;

let highlighter: Promise<HighlighterCore> | null = null;
let themeName = 'gitview-fallback';
let themeKey = '';
const loaded = new Set<string>();
const failed = new Set<string>();

async function fallbackTheme() {
  return (await import('@shikijs/themes/github-dark')).default;
}

function core() {
  if (!highlighter) {
    highlighter = (async () =>
      createHighlighterCore({
        themes: [{ ...((await fallbackTheme()) as object), name: 'gitview-fallback' }],
        langs: [],
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      }))();
  }
  return highlighter;
}

/** Use the Omarchy theme's VS Code token colours for code. */
export async function setCodeTheme(theme: ThemeInfo | null) {
  const h = await core();
  if (!theme?.code) {
    themeName = 'gitview-fallback';
    return;
  }
  const key = JSON.stringify(theme.code.tokenColors).length + ':' + (theme.name || '') + ':' + (theme.colors.background || '');
  if (key === themeKey) return;
  themeKey = key;
  const name = `omarchy-${theme.name || 'current'}-${Date.now()}`;
  await h.loadTheme({
    name,
    type: theme.code.type,
    colors: { ...theme.code.colors, 'editor.background': theme.colors.background, 'editor.foreground': theme.colors.foreground },
    tokenColors: theme.code.tokenColors as never,
  } as never);
  themeName = name;
}

async function ensureLang(lang: string) {
  if (loaded.has(lang)) return true;
  if (failed.has(lang) || !LANGS[lang]) return false;
  const h = await core();
  try {
    await h.loadLanguage((await LANGS[lang]()).default as never);
    loaded.add(lang);
    return true;
  } catch {
    failed.add(lang);
    return false;
  }
}

export type TokenLines = ThemedToken[][];

/** Tokens per line, or null when the language is unknown or the text too large. */
export async function tokenize(text: string, lang: string): Promise<TokenLines | null> {
  if (!text || text.length > MAX_HIGHLIGHT_CHARS) return null;
  if (!(await ensureLang(lang))) return null;
  const h = await core();
  try {
    return h.codeToTokensBase(text, { lang, theme: themeName });
  } catch {
    return null;
  }
}

export function hasLanguage(lang: string) {
  return Boolean(LANGS[lang]);
}
