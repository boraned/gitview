import type { ChangedFile, Commit, CommitDetail, Detail, FileContent, FileListing, Prefs, Project, ScanResult, Summary, ThemeInfo } from '../types';

interface Bridge {
  listProjects(): Promise<Project[]>;
  addProject(): Promise<{ project: Project; existed: boolean } | null>;
  addFolders(id: string): Promise<Project>;
  updateProject(id: string, changes: Partial<Pick<Project, 'name' | 'roots' | 'hue'>>): Promise<Project>;
  removeProject(id: string): Promise<boolean>;
  projectSummary(id: string): Promise<Summary>;

  scan(id: string): Promise<ScanResult>;
  detail(id: string, root: string, file: string, options?: { compare?: string; oldRepoPath?: string | null }): Promise<Detail>;
  resetBaseline(id: string, root: string): Promise<{ baselineAt: string }>;

  listFiles(id: string): Promise<FileListing>;
  readFile(id: string, root: string, file: string): Promise<FileContent>;

  commits(id: string, options?: { skip?: number; limit?: number; root?: string | null }): Promise<{ commits: Commit[]; hasMore: boolean }>;
  commit(id: string, root: string, hash: string): Promise<CommitDetail>;
  commitFile(id: string, root: string, hash: string, repoPath: string, oldRepoPath?: string | null): Promise<Detail>;

  getPrefs(): Promise<Prefs>;
  setPrefs(changes: Partial<Prefs>): Promise<Prefs>;

  getTheme(): Promise<ThemeInfo | null>;
  onTheme(callback: (theme: ThemeInfo | null) => void): () => void;

  reveal(id: string, root: string, file?: string): Promise<boolean>;
}

declare global {
  interface Window {
    gitview: Bridge;
  }
}

export const api: Bridge = window.gitview;

export const fileKey = (root: string, file: Pick<ChangedFile, 'path'>) => `${root}\u0000${file.path}`;

export function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
