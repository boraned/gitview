'use strict';
// File type knowledge shared by scanning and detail views.
// "Complex" files are never diffed: gitview only shows what kind of file changed.

const path = require('node:path');

// extension -> [label, category, shiki language]
const BY_EXTENSION = {
  // Godot
  gd: ['GDScript', 'code', 'gdscript'],
  gdshader: ['Godot shader', 'code', 'gdshader'],
  gdshaderinc: ['Godot shader include', 'code', 'gdshader'],
  tscn: ['Godot scene', 'scene', 'gdresource'],
  tres: ['Godot resource', 'scene', 'gdresource'],
  scn: ['Godot binary scene', 'scene'],
  res: ['Godot binary resource', 'scene'],
  godot: ['Godot project settings', 'config', 'ini'],
  import: ['Godot import settings', 'meta', 'ini'],
  uid: ['Godot UID', 'meta', 'text'],
  gdextension: ['GDExtension config', 'config', 'ini'],
  pck: ['Godot package', 'archive'],

  // Code
  js: ['JavaScript', 'code', 'javascript'],
  mjs: ['JavaScript', 'code', 'javascript'],
  cjs: ['JavaScript', 'code', 'javascript'],
  jsx: ['JSX', 'code', 'jsx'],
  ts: ['TypeScript', 'code', 'typescript'],
  mts: ['TypeScript', 'code', 'typescript'],
  cts: ['TypeScript', 'code', 'typescript'],
  tsx: ['TSX', 'code', 'tsx'],
  py: ['Python', 'code', 'python'],
  pyi: ['Python stub', 'code', 'python'],
  rs: ['Rust', 'code', 'rust'],
  go: ['Go', 'code', 'go'],
  c: ['C', 'code', 'c'],
  h: ['C header', 'code', 'c'],
  cc: ['C++', 'code', 'cpp'],
  cpp: ['C++', 'code', 'cpp'],
  cxx: ['C++', 'code', 'cpp'],
  hpp: ['C++ header', 'code', 'cpp'],
  hh: ['C++ header', 'code', 'cpp'],
  cs: ['C#', 'code', 'csharp'],
  java: ['Java', 'code', 'java'],
  kt: ['Kotlin', 'code', 'kotlin'],
  kts: ['Kotlin script', 'code', 'kotlin'],
  swift: ['Swift', 'code', 'swift'],
  lua: ['Lua', 'code', 'lua'],
  rb: ['Ruby', 'code', 'ruby'],
  php: ['PHP', 'code', 'php'],
  sh: ['Shell script', 'code', 'shellscript'],
  bash: ['Shell script', 'code', 'shellscript'],
  zsh: ['Shell script', 'code', 'shellscript'],
  fish: ['Fish script', 'code', 'fish'],
  ps1: ['PowerShell', 'code', 'powershell'],
  sql: ['SQL', 'code', 'sql'],
  zig: ['Zig', 'code', 'zig'],
  dart: ['Dart', 'code', 'dart'],
  vue: ['Vue component', 'code', 'vue'],
  svelte: ['Svelte component', 'code', 'svelte'],
  html: ['HTML', 'code', 'html'],
  htm: ['HTML', 'code', 'html'],
  css: ['CSS', 'code', 'css'],
  scss: ['SCSS', 'code', 'scss'],
  less: ['Less', 'code', 'less'],
  glsl: ['GLSL shader', 'code', 'glsl'],
  vert: ['Vertex shader', 'code', 'glsl'],
  frag: ['Fragment shader', 'code', 'glsl'],
  comp: ['Compute shader', 'code', 'glsl'],
  hlsl: ['HLSL shader', 'code', 'hlsl'],
  wgsl: ['WGSL shader', 'code', 'wgsl'],
  lean: ['Lean', 'code', 'lean'],
  hs: ['Haskell', 'code', 'haskell'],
  ex: ['Elixir', 'code', 'elixir'],
  exs: ['Elixir script', 'code', 'elixir'],
  qml: ['QML', 'code', 'qml'],
  nix: ['Nix', 'code', 'nix'],
  r: ['R', 'code', 'r'],
  jl: ['Julia', 'code', 'julia'],
  cmake: ['CMake', 'code', 'cmake'],
  diff: ['Patch', 'code', 'diff'],
  patch: ['Patch', 'code', 'diff'],

  // Docs
  md: ['Markdown', 'docs', 'markdown'],
  markdown: ['Markdown', 'docs', 'markdown'],
  mdx: ['MDX', 'docs', 'mdx'],
  txt: ['Plain text', 'docs', 'text'],
  rst: ['reStructuredText', 'docs', 'rst'],
  adoc: ['AsciiDoc', 'docs', 'asciidoc'],
  tex: ['LaTeX', 'docs', 'latex'],
  log: ['Log', 'docs', 'log'],

  // Config and data
  json: ['JSON', 'data', 'json'],
  jsonc: ['JSON with comments', 'data', 'jsonc'],
  json5: ['JSON5', 'data', 'json5'],
  jsonl: ['JSON Lines', 'data', 'json'],
  yaml: ['YAML', 'config', 'yaml'],
  yml: ['YAML', 'config', 'yaml'],
  toml: ['TOML', 'config', 'toml'],
  ini: ['INI config', 'config', 'ini'],
  cfg: ['Config', 'config', 'ini'],
  conf: ['Config', 'config', 'ini'],
  env: ['Environment file', 'config', 'dotenv'],
  properties: ['Properties', 'config', 'properties'],
  xml: ['XML', 'data', 'xml'],
  csv: ['CSV', 'data', 'csv'],
  tsv: ['TSV', 'data', 'tsv'],
  lock: ['Lockfile', 'config', 'text'],

  // Images
  png: ['PNG image', 'image'],
  jpg: ['JPEG image', 'image'],
  jpeg: ['JPEG image', 'image'],
  webp: ['WebP image', 'image'],
  avif: ['AVIF image', 'image'],
  gif: ['GIF image', 'image'],
  bmp: ['Bitmap image', 'image'],
  tga: ['TGA image', 'image'],
  tif: ['TIFF image', 'image'],
  tiff: ['TIFF image', 'image'],
  svg: ['SVG image', 'image'],
  exr: ['OpenEXR image', 'image'],
  hdr: ['HDR image', 'image'],
  ico: ['Icon', 'image'],
  icns: ['Icon', 'image'],
  psd: ['Photoshop document', 'image'],
  kra: ['Krita document', 'image'],
  xcf: ['GIMP image', 'image'],
  ase: ['Aseprite sprite', 'image'],
  aseprite: ['Aseprite sprite', 'image'],
  dds: ['DDS texture', 'image'],
  ktx: ['KTX texture', 'image'],
  ktx2: ['KTX2 texture', 'image'],

  // Audio
  wav: ['WAV audio', 'audio'],
  ogg: ['Ogg audio', 'audio'],
  mp3: ['MP3 audio', 'audio'],
  flac: ['FLAC audio', 'audio'],
  opus: ['Opus audio', 'audio'],
  m4a: ['M4A audio', 'audio'],
  aif: ['AIFF audio', 'audio'],
  aiff: ['AIFF audio', 'audio'],
  mid: ['MIDI', 'audio'],
  midi: ['MIDI', 'audio'],

  // Video
  mp4: ['MP4 video', 'video'],
  webm: ['WebM video', 'video'],
  mov: ['QuickTime video', 'video'],
  mkv: ['Matroska video', 'video'],
  ogv: ['Ogg video', 'video'],
  avi: ['AVI video', 'video'],

  // 3D
  glb: ['glTF binary model', 'model'],
  gltf: ['glTF model', 'model'],
  fbx: ['FBX model', 'model'],
  obj: ['OBJ model', 'model'],
  mtl: ['OBJ material', 'model'],
  blend: ['Blender file', 'model'],
  blend1: ['Blender backup', 'model'],
  dae: ['Collada model', 'model'],
  stl: ['STL model', 'model'],
  ply: ['PLY model', 'model'],
  usd: ['USD scene', 'model'],
  usda: ['USD scene', 'model'],
  usdc: ['USD scene', 'model'],
  usdz: ['USD scene', 'model'],
  vox: ['Voxel model', 'model'],
  mesh: ['Mesh', 'model'],
  '3ds': ['3DS model', 'model'],

  // Fonts
  ttf: ['TrueType font', 'font'],
  otf: ['OpenType font', 'font'],
  woff: ['WOFF font', 'font'],
  woff2: ['WOFF2 font', 'font'],
  fnt: ['Bitmap font', 'font'],

  // Archives
  zip: ['ZIP archive', 'archive'],
  gz: ['Gzip archive', 'archive'],
  tgz: ['Tar archive', 'archive'],
  tar: ['Tar archive', 'archive'],
  '7z': ['7-Zip archive', 'archive'],
  rar: ['RAR archive', 'archive'],
  xz: ['XZ archive', 'archive'],
  bz2: ['Bzip2 archive', 'archive'],
  zst: ['Zstandard archive', 'archive'],
  apk: ['Android package', 'archive'],
  aab: ['Android bundle', 'archive'],
  jar: ['Java archive', 'archive'],

  // Binaries
  exe: ['Windows executable', 'binary'],
  dll: ['Windows library', 'binary'],
  so: ['Shared library', 'binary'],
  dylib: ['Shared library', 'binary'],
  wasm: ['WebAssembly', 'binary'],
  bin: ['Binary data', 'binary'],
  o: ['Object file', 'binary'],
  a: ['Static library', 'binary'],
  pdb: ['Debug symbols', 'binary'],
  class: ['Java class', 'binary'],
  pyc: ['Python bytecode', 'binary'],

  // Documents and databases
  pdf: ['PDF document', 'document'],
  docx: ['Word document', 'document'],
  xlsx: ['Excel workbook', 'document'],
  pptx: ['PowerPoint deck', 'document'],
  odt: ['OpenDocument text', 'document'],
  ods: ['OpenDocument sheet', 'document'],
  odp: ['OpenDocument slides', 'document'],
  sqlite: ['SQLite database', 'database'],
  sqlite3: ['SQLite database', 'database'],
  db: ['Database', 'database'],
};

const BY_NAME = {
  makefile: ['Makefile', 'code', 'make'],
  gnumakefile: ['Makefile', 'code', 'make'],
  dockerfile: ['Dockerfile', 'code', 'docker'],
  'cmakelists.txt': ['CMake', 'code', 'cmake'],
  license: ['License', 'docs', 'text'],
  'license.md': ['License', 'docs', 'markdown'],
  '.gitignore': ['Git ignore rules', 'config', 'text'],
  '.gitattributes': ['Git attributes', 'config', 'text'],
  '.gitmodules': ['Git submodules', 'config', 'ini'],
  '.editorconfig': ['EditorConfig', 'config', 'ini'],
  '.env': ['Environment file', 'config', 'dotenv'],
};

const COMPLEX = new Set(['scene', 'image', 'audio', 'video', 'model', 'font', 'archive', 'binary', 'document', 'database']);

/**
 * Describe a file by name.
 * @param {string} file relative path
 * @param {{godotTextScenes?: boolean}} options godotTextScenes=true shows .tscn/.tres as text diffs
 */
function describe(file, options = {}) {
  const base = path.posix.basename(String(file).replace(/\\/g, '/')).toLowerCase();
  let entry = BY_NAME[base];
  if (!entry) {
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 || (dot === 0 && base.length > 1) ? base.slice(dot + 1) : '';
    entry = ext ? BY_EXTENSION[ext] : undefined;
    if (!entry) {
      return { type: ext ? `${ext.toUpperCase()} file` : 'File', category: 'other', language: 'text', complex: false, known: false };
    }
  }
  const [type, category, language] = entry;
  let complex = COMPLEX.has(category);
  if (category === 'scene' && language && options.godotTextScenes) complex = false;
  return { type, category, language: language || 'text', complex, known: true };
}

module.exports = { describe, COMPLEX };
