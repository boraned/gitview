export type Status = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '!';

export type Category =
  | 'code' | 'docs' | 'data' | 'config' | 'meta' | 'scene' | 'image' | 'audio' | 'video'
  | 'model' | 'font' | 'archive' | 'binary' | 'document' | 'database' | 'other';

export interface Summary {
  count: number;
  assets: number;
  added: number;
  removed: number;
  folders: number;
  errors: number;
  scannedAt: string;
  activity?: Activity | null;
}

export interface Activity {
  hours: number;
  buckets: number[];
  total: number;
  last: { at: number; subject: string } | null;
}

export interface Project {
  id: string;
  name: string;
  mode: 'folders';
  roots: string[];
  hue?: string;
  createdAt?: string;
  summary?: Summary | null;
}

export interface ChangedFile {
  path: string;
  repoPath: string;
  oldRepoPath: string | null;
  oldPath: string | null;
  status: Status;
  xy: string | null;
  staged: boolean;
  unstaged: boolean;
  added: number | null;
  removed: number | null;
  type: string;
  category: Category;
  language: string;
  complex: boolean;
  large: boolean;
  size: number;
  mtime: number;
  exists: boolean;
}

export interface Repo {
  path: string;
  name: string;
  kind: 'git' | 'plain' | 'missing' | 'error';
  branch?: string | null;
  detached?: boolean;
  oid?: string | null;
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  baselineAt?: string;
  truncated?: boolean;
  files: ChangedFile[];
  error?: string;
}

export interface ScanResult {
  repos: Repo[];
  scannedAt: string;
  project: Project;
  summary: Summary;
}

export interface Detail {
  kind: 'text' | 'complex';
  path: string;
  type: string;
  category: Category;
  language: string;
  oldLabel: string;
  newLabel: string;
  oldExists: boolean;
  newExists: boolean;
  oldSize: number | null;
  newSize: number | null;
  oldText?: string | null;
  newText?: string;
  oldPath?: string | null;
  compare?: string;
  baselineAt?: string;
  reason?: 'asset' | 'link' | 'folder' | 'large' | 'binary';
}

export interface ListedFile {
  path: string;
  size: number;
  mtime: number;
  link: boolean;
  type: string;
  category: Category;
  language: string;
  complex: boolean;
}

export interface ListedFolder {
  path: string;
  name: string;
  kind: 'git' | 'plain' | 'missing' | 'error';
  files: ListedFile[];
  truncated: boolean;
  error?: string;
}

export interface FileListing {
  folders: ListedFolder[];
  listedAt: string;
}

export interface FileContent {
  kind: 'text' | 'media' | 'asset';
  path: string;
  type: string;
  category: Category;
  language: string;
  size: number;
  mtime: number;
  text?: string;
  lines?: number;
  mime?: string;
  data?: Uint8Array;
  target?: string;
  reason?: 'missing' | 'link' | 'folder' | 'large' | 'format' | 'binary';
}

export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  authoredAt: number;
  committedAt: number;
  subject: string;
  files: number;
  added: number;
  removed: number;
  root: string;
  branch: string | null;
  detached: boolean;
}

export interface CommitFile {
  status: string;
  repoPath: string;
  oldRepoPath: string | null;
  path: string;
  type: string;
  category: Category;
  language: string;
  complex: boolean;
  added: number | null;
  removed: number | null;
}

export interface CommitDetail {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  authoredAt: number;
  committer: string;
  committedAt: number;
  refs: string[];
  subject: string;
  body: string;
  files: CommitFile[];
  prefix: string;
}

export interface Prefs {
  diffView: 'split' | 'unified';
  wrap: boolean;
  context: number;
  ignoreWhitespace: boolean;
  listMode: 'list' | 'tree';
  sort: 'recent' | 'path' | 'status';
  showGodotMeta: boolean;
  godotTextScenes: boolean;
  interval: number;
  codeSize: number;
}

export interface ThemeInfo {
  source: string;
  name: string | null;
  mode: 'dark' | 'light';
  colors: Record<string, string>;
  code: { name: string; type: 'dark' | 'light'; colors: Record<string, string>; tokenColors: unknown[]; semanticTokenColors?: unknown } | null;
}
