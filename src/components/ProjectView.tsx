import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, CircleAlert, Folder, FolderPlus, GitBranch, History, House,
  Layers, ListFilter, PanelLeft, PanelLeftClose, RefreshCw, RotateCcw, Search, Settings2, X,
} from 'lucide-react';
import { COMPACT, NARROW, useResizer, useStored, useWindowWidth } from '../lib/layout';
import type { ChangedFile, Prefs, Project, Repo, ScanResult } from '../types';
import { api, errorText, fileKey } from '../lib/api';
import { num, shortDir, splitPath, timeAgo } from '../lib/format';
import { FileIcon, LineStats, Spinner, StatusBadge } from './bits';
import { DiffPanel, type PanelTarget } from './DiffPanel';
import { HistoryView } from './HistoryView';

type Filter = 'all' | 'code' | 'assets';

interface Row {
  key: string;
  repo: Repo;
  file: ChangedFile;
}

const GODOT_META = /\.(uid|import)$/i;
const STATUS_ORDER: Record<string, number> = { '!': 0, M: 1, R: 2, A: 3, U: 4, D: 5, C: 6, T: 7 };

function useNow(ms = 15000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Sidebar({ project, scan, activeRoot, onRoot, onAddFolder, onResetBaseline, overlay }: {
  project: Project;
  scan: ScanResult | null;
  activeRoot: string | null;
  onRoot: (root: string | null) => void;
  onAddFolder: () => void;
  onResetBaseline: (repo: Repo) => void;
  overlay: boolean;
}) {
  const repos = scan?.repos || [];
  const total = repos.reduce((n, r) => n + r.files.length, 0);
  return (
    <aside className={`sidebar ${overlay ? 'overlay' : ''}`}>
      <div className="side-head">
        <span>Folders</span>
        <span className="count">{repos.length || ''}</span>
      </div>
      <nav className="side-list">
        <button className={`folder ${activeRoot === null ? 'on' : ''}`} onClick={() => onRoot(null)}>
          <Layers size={15} className="folder-icon" />
          <span className="folder-main">
            <span className="folder-name">All folders</span>
            <span className="folder-sub">{`${project.roots.length} folder${project.roots.length === 1 ? '' : 's'}`}</span>
          </span>
          <span className="pill">{num(total)}</span>
        </button>
        <div className="side-sep" />
        {repos.map((repo) => (
          <div key={repo.path} className={`folder-wrap ${activeRoot === repo.path ? 'on' : ''}`}>
            <button className={`folder ${activeRoot === repo.path ? 'on' : ''} ${repo.files.length ? '' : 'clean'}`} onClick={() => onRoot(repo.path)} title={repo.path}>
              {repo.error ? <CircleAlert size={15} className="folder-icon err" /> : repo.kind === 'git' ? <GitBranch size={15} className="folder-icon" /> : <Folder size={15} className="folder-icon" />}
              <span className="folder-main">
                <span className="folder-name">{repo.name}</span>
                <span className="folder-sub">
                  {repo.error
                    ? repo.error
                    : repo.kind === 'git'
                      ? (
                        <>
                          {repo.branch && repo.branch !== repo.name && repo.branch !== repo.name
                            ? repo.branch
                            : repo.branch && repo.oid
                              ? `at ${repo.oid.slice(0, 7)}`
                              : repo.oid
                                ? `detached ${repo.oid.slice(0, 7)}`
                                : 'no commits'}
                          {repo.ahead ? <span className="ab"><ArrowUp size={10} />{repo.ahead}</span> : null}
                          {repo.behind ? <span className="ab"><ArrowDown size={10} />{repo.behind}</span> : null}
                        </>
                      )
                      : `baseline ${timeAgo(repo.baselineAt)}`}
                </span>
              </span>
              <span className={`pill ${repo.files.length ? '' : 'zero'}`}>{repo.error ? '!' : num(repo.files.length)}</span>
            </button>
            {repo.kind === 'plain' ? (
              <button className="folder-action" title="Reset baseline: treat the folder as it is now as unchanged" onClick={() => onResetBaseline(repo)}>
                <RotateCcw size={13} />
              </button>
            ) : null}
          </div>
        ))}
        {!scan ? (
          <div className="side-loading">
            <Spinner /> Discovering folders…
          </div>
        ) : null}
      </nav>
      <button className="side-add" onClick={onAddFolder}>
        <FolderPlus size={15} /> Add folder
      </button>
    </aside>
  );
}

export function ProjectView({ project, prefs, onPrefs, onHome, onSettings, onProjectChange, themeVersion }: {
  project: Project;
  prefs: Prefs;
  onPrefs: (p: Partial<Prefs>) => void;
  onHome: () => void;
  onSettings: () => void;
  onProjectChange: (p: Project) => void;
  themeVersion: number;
}) {
  const [tab, setTab] = useState<'changes' | 'history'>('changes');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [activeRoot, setActiveRoot] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const now = useNow();

  // ------------------------------------------------------------- layout
  const width = useWindowWidth();
  const narrow = width < NARROW;
  const compact = width < COMPACT;
  const [sidebarPref, setSidebarPref] = useStored('sidebar', true);
  const [sidebarOpen, setSidebarOpen] = useState(sidebarPref && !compact);
  const [listWidth, setListWidth] = useStored('listWidth', 360);
  const [focus, setFocus] = useStored('focus', false);
  const [showFile, setShowFile] = useState(false); // narrow windows: file view replaces the list

  useEffect(() => setSidebarOpen(compact ? false : sidebarPref), [compact]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      if (!compact) setSidebarPref(!open);
      return !open;
    });
    setFocus(false);
  }, [compact, setSidebarPref, setFocus]);

  const fileOnly = narrow ? showFile : focus;
  const sidebarVisible = sidebarOpen && !fileOnly;
  const sidebarOverlay = sidebarVisible && compact;
  const maxList = Math.max(260, Math.min(640, (width - (sidebarVisible && !sidebarOverlay ? 236 : 0)) * 0.5));
  const effectiveList = Math.min(listWidth, maxList);
  const resizer = useResizer(effectiveList, setListWidth, 240, maxList);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setScanning(true);
    try {
      const result = await api.scan(project.id);
      setScan(result);
      setScanError(null);
    } catch (e) {
      setScanError(errorText(e));
    } finally {
      busy.current = false;
      setScanning(false);
    }
  }, [project.id]);

  useEffect(() => {
    setScan(null);
    setSelected(null);
    setActiveRoot(null);
    refresh();
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden && tab === 'changes') refresh();
    }, prefs.interval * 1000);
    return () => clearInterval(t);
  }, [refresh, prefs.interval, tab]);

  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  // ------------------------------------------------------------- rows

  const allRows = useMemo<Row[]>(() => {
    if (!scan) return [];
    const rows: Row[] = [];
    for (const repo of scan.repos) for (const file of repo.files) rows.push({ key: fileKey(repo.path, file), repo, file });
    return rows;
  }, [scan]);

  const baseRows = useMemo(
    () => allRows.filter((r) => (activeRoot ? r.repo.path === activeRoot : true) && (prefs.showGodotMeta || !GODOT_META.test(r.file.path))),
    [allRows, activeRoot, prefs.showGodotMeta],
  );

  const counts = useMemo(() => ({
    all: baseRows.length,
    code: baseRows.filter((r) => !r.file.complex).length,
    assets: baseRows.filter((r) => r.file.complex).length,
    hiddenMeta: prefs.showGodotMeta ? 0 : allRows.filter((r) => (activeRoot ? r.repo.path === activeRoot : true) && GODOT_META.test(r.file.path)).length,
  }), [baseRows, allRows, activeRoot, prefs.showGodotMeta]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = baseRows.filter(
      (r) => (filter === 'all' || (filter === 'assets' ? r.file.complex : !r.file.complex)) && (!q || `${r.repo.name}/${r.file.path}`.toLowerCase().includes(q)),
    );
    const repoIndex = new Map(scan?.repos.map((r, i) => [r.path, i]));
    list.sort((a, b) => {
      const g = (repoIndex.get(a.repo.path) ?? 0) - (repoIndex.get(b.repo.path) ?? 0);
      if (g) return g;
      if (prefs.sort === 'recent') return b.file.mtime - a.file.mtime || a.file.path.localeCompare(b.file.path);
      if (prefs.sort === 'status') return (STATUS_ORDER[a.file.status] ?? 9) - (STATUS_ORDER[b.file.status] ?? 9) || a.file.path.localeCompare(b.file.path);
      return a.file.path.localeCompare(b.file.path);
    });
    return list;
  }, [baseRows, filter, query, prefs.sort, scan]);

  const groups = useMemo(() => {
    const out: { repo: Repo; rows: Row[] }[] = [];
    for (const row of rows) {
      const last = out[out.length - 1];
      if (last && last.repo.path === row.repo.path) last.rows.push(row);
      else out.push({ repo: row.repo, rows: [row] });
    }
    return out;
  }, [rows]);

  const visibleRows = useMemo(() => groups.flatMap((g) => (collapsed.has(g.repo.path) ? [] : g.rows)), [groups, collapsed]);

  // keep a valid selection
  useEffect(() => {
    if (!scan) return;
    if (selected && allRows.some((r) => r.key === selected)) return;
    setSelected(visibleRows[0]?.key ?? null);
  }, [scan, allRows, visibleRows, selected]);

  const selectedRow = useMemo(() => allRows.find((r) => r.key === selected) || null, [allRows, selected]);

  const move = useCallback(
    (delta: number) => {
      if (!visibleRows.length) return;
      const i = visibleRows.findIndex((r) => r.key === selected);
      const next = visibleRows[Math.max(0, Math.min(visibleRows.length - 1, (i === -1 ? -1 : i) + delta))];
      setSelected(next.key);
      requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(next.key)}"]`)?.scrollIntoView({ block: 'nearest' }));
    },
    [visibleRows, selected],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.modal')) return;
      const typing = (e.target as HTMLElement)?.matches?.('input, textarea, select');
      if (typing) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          move(e.key === 'ArrowDown' ? 1 : -1);
        }
        return;
      }
      if (e.altKey && e.key === 'ArrowLeft') return onHome();
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '[') return toggleSidebar();
      if (e.key === 'Escape') {
        if (sidebarOverlay) setSidebarOpen(false);
        else if (narrow && showFile) setShowFile(false);
        else if (focus) setFocus(false);
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        if (!narrow) setFocus((f) => !f);
        else if (tab === 'changes') setShowFile((s) => !s);
        return;
      }
      if (tab === 'changes' && e.key === 'Enter' && narrow && !showFile) return setShowFile(true);
      if (e.key === '/') {
        e.preventDefault();
        setTab('changes');
        setShowFile(false);
        setFocus(false);
        // focus now if the list is on screen, so keys typed right after "/" aren't lost
        if (searchRef.current) searchRef.current.focus();
        else requestAnimationFrame(() => searchRef.current?.focus());
      } else if (e.key === 'r' || e.key === 'F5') refresh();
      else if (e.key === '1') setTab('changes');
      else if (e.key === '2') setTab('history');
      else if (tab === 'changes' && (e.key === 'ArrowDown' || e.key === 'j')) {
        e.preventDefault();
        move(1);
      } else if (tab === 'changes' && (e.key === 'ArrowUp' || e.key === 'k')) {
        e.preventDefault();
        move(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, refresh, onHome, tab, toggleSidebar, sidebarOverlay, narrow, showFile, focus, setFocus]);

  // ------------------------------------------------------------- panel target

  const target = useMemo<PanelTarget | null>(() => {
    if (!selectedRow) return null;
    const { repo, file } = selectedRow;
    return {
      key: selectedRow.key,
      version: `${file.status}:${file.xy}:${file.size}:${file.mtime}:${file.added}:${file.removed}`,
      path: file.path,
      oldPath: file.oldPath,
      status: file.status,
      type: file.type,
      category: file.category,
      added: file.added,
      removed: file.removed,
      compareChoices: repo.kind === 'git' && file.staged && file.unstaged && file.status !== 'U',
      load: (compare) => api.detail(project.id, repo.path, file.path, { compare, oldRepoPath: file.oldRepoPath }),
      reveal: () => api.reveal(project.id, repo.path, file.exists ? file.path : undefined),
      subtitle: <span className="chip">{repo.name}</span>,
    };
  }, [selectedRow, project.id]);

  const addFolder = async () => {
    const updated = await api.addFolders(project.id);
    onProjectChange(updated);
    refresh();
  };

  const resetBaseline = async (repo: Repo) => {
    if (!window.confirm(`Reset the baseline for “${repo.name}”?\n\nEverything in the folder as it is now will count as unchanged.`)) return;
    await api.resetBaseline(project.id, repo.path);
    refresh();
  };

  const totalAdded = baseRows.reduce((n, r) => n + (r.file.added || 0), 0);
  const totalRemoved = baseRows.reduce((n, r) => n + (r.file.removed || 0), 0);

  return (
    <div className="project">
      <header className="topbar">
        <div className="top-left">
          <button className="home-btn" onClick={onHome} title="Back to projects (Alt+←)">
            <House size={16} />
            <span>Projects</span>
          </button>
          <button className={`icon-btn ${sidebarVisible ? 'on' : ''}`} onClick={toggleSidebar} title={sidebarVisible ? 'Hide folders ([)' : 'Show folders ([)'}>
            {sidebarVisible ? <PanelLeftClose size={15} /> : <PanelLeft size={15} />}
          </button>
          <ChevronRight size={14} className="crumb-sep" />
          <span className="crumb">{project.name}</span>
        </div>
        <div className="tabs">
          <button className={tab === 'changes' ? 'on' : ''} onClick={() => setTab('changes')}>
            <Layers size={14} /> Changes <span className="tab-count">{scan ? num(scan.summary.count) : '…'}</span>
          </button>
          <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
            <History size={14} /> History
          </button>
        </div>
        <div className="top-right">
          <span className="updated" title={scan ? new Date(scan.scannedAt).toLocaleString() : ''}>
            {scanError ? <span className="err">{scanError}</span> : scan ? `Updated ${timeAgo(scan.scannedAt, now)}` : 'Scanning…'}
          </span>
          <button className="icon-btn" onClick={refresh} title="Refresh (R)" disabled={scanning}>
            <RefreshCw size={15} className={scanning ? 'spin' : ''} />
          </button>
          <button className="icon-btn" onClick={onSettings} title="Settings">
            <Settings2 size={15} />
          </button>
        </div>
      </header>

      <div className="workspace">
        {sidebarVisible ? (
          <>
            {sidebarOverlay ? <div className="scrim" onClick={() => setSidebarOpen(false)} /> : null}
            <Sidebar
              project={project}
              scan={scan}
              activeRoot={activeRoot}
              onRoot={(root) => {
                setActiveRoot(root);
                if (sidebarOverlay) setSidebarOpen(false);
              }}
              onAddFolder={addFolder}
              onResetBaseline={resetBaseline}
              overlay={sidebarOverlay}
            />
          </>
        ) : null}

        {tab === 'changes' ? (
          <>
            {!fileOnly ? (
            <section className={`list-pane ${narrow ? 'full' : ''}`} style={narrow ? undefined : { width: effectiveList }}>
              <div className="list-tools">
                <div className="search">
                  <Search size={14} />
                  <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter files" spellCheck={false} />
                  {query ? (
                    <button className="clear" onClick={() => setQuery('')} title="Clear">
                      <X size={13} />
                    </button>
                  ) : (
                    <kbd>/</kbd>
                  )}
                </div>
                <div className="filters">
                  {(['all', 'code', 'assets'] as Filter[]).map((f) => (
                    <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                      {f === 'all' ? 'All' : f === 'code' ? 'Text' : 'Assets'} <span>{num(counts[f])}</span>
                    </button>
                  ))}
                  <div className="sort" title="Sort">
                    <ListFilter size={13} />
                    <select value={prefs.sort} onChange={(e) => onPrefs({ sort: e.target.value as Prefs['sort'] })}>
                      <option value="recent">Recent</option>
                      <option value="path">Path</option>
                      <option value="status">Status</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="list-summary">
                <span>
                  {num(rows.length)} file{rows.length === 1 ? '' : 's'}
                  {totalAdded || totalRemoved ? (
                    <>
                      {' · '}
                      <span className="plus">+{num(totalAdded)}</span> <span className="minus">−{num(totalRemoved)}</span>
                    </>
                  ) : null}
                </span>
                <button
                  className={`toggle-chip ${prefs.showGodotMeta ? '' : 'on'}`}
                  onClick={() => onPrefs({ showGodotMeta: !prefs.showGodotMeta })}
                  title={prefs.showGodotMeta ? 'Hide Godot .uid and .import files' : 'Show Godot .uid and .import files'}
                >
                  <span className="tick" />
                  Hide .uid/.import{counts.hiddenMeta ? ` · ${num(counts.hiddenMeta)}` : ''}
                </button>
              </div>
              <div className="file-list" ref={listRef}>
                {!scan ? (
                  <div className="pane-center muted">
                    <Spinner size={18} />
                  </div>
                ) : groups.length === 0 ? (
                  <div className="empty-list">
                    <div className="empty-mark">✓</div>
                    <div className="empty-title">{allRows.length ? 'No files match' : 'Working tree clean'}</div>
                    <div className="muted">{allRows.length ? 'Try another filter or search.' : 'Nothing has changed in these folders.'}</div>
                  </div>
                ) : (
                  groups.map((g) => {
                    const isCollapsed = collapsed.has(g.repo.path);
                    return (
                      <div className="group" key={g.repo.path}>
                        {scan.repos.length > 1 && !activeRoot ? (
                          <button
                            className="group-head"
                            onClick={() =>
                              setCollapsed((s) => {
                                const n = new Set(s);
                                if (n.has(g.repo.path)) n.delete(g.repo.path);
                                else n.add(g.repo.path);
                                return n;
                              })
                            }
                          >
                            {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                            <span className="group-name">{g.repo.name}</span>
                            {g.repo.branch && g.repo.branch !== g.repo.name ? <span className="group-branch">{g.repo.branch}</span> : null}
                            <span className="group-count">{g.rows.length}</span>
                          </button>
                        ) : null}
                        {!isCollapsed
                          ? g.rows.map((row) => {
                              const { dir, name } = splitPath(row.file.path);
                              return (
                                <button
                                  key={row.key}
                                  data-key={row.key}
                                  className={`file-row ${row.key === selected ? 'on' : ''} ${row.file.status === 'D' ? 'deleted' : ''}`}
                                  onClick={() => {
                                    setSelected(row.key);
                                    if (narrow) setShowFile(true);
                                  }}
                                  title={row.file.path}
                                >
                                  <FileIcon category={row.file.category} />
                                  <span className="file-main">
                                    <span className="file-name">{name}</span>
                                    <span className="file-dir">{shortDir(dir)}</span>
                                  </span>
                                  <LineStats added={row.file.added} removed={row.file.removed} />
                                  {row.file.staged ? <span className="staged-dot" title="Has staged changes" /> : null}
                                  <StatusBadge status={row.file.status} />
                                </button>
                              );
                            })
                          : null}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="list-foot">
                <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
                <span><kbd>/</kbd> filter</span>
                <span><kbd>R</kbd> refresh</span>
                <span><kbd>F</kbd> {narrow ? 'open' : 'focus'}</span>
              </div>
            </section>
            ) : null}
            {!narrow && !fileOnly ? <div className="resizer" {...resizer} title="Drag to resize" /> : null}
            {!narrow || showFile ? (
            <DiffPanel
              target={target}
              prefs={prefs}
              onPrefs={onPrefs}
              themeVersion={themeVersion}
              onBack={narrow ? () => setShowFile(false) : undefined}
              focused={!narrow && focus}
              onFocus={narrow ? undefined : () => setFocus((f) => !f)}
              empty={
                <div className="pane-center">
                  <div className="empty-list">
                    <div className="empty-mark">◐</div>
                    <div className="empty-title">{scan ? 'Select a file' : 'Reading folders…'}</div>
                    <div className="muted">Text files show a diff. Assets show their type.</div>
                  </div>
                </div>
              }
            />
            ) : null}
          </>
        ) : (
          <HistoryView project={project} root={activeRoot} prefs={prefs} onPrefs={onPrefs} themeVersion={themeVersion} narrow={narrow} focus={focus} onFocus={() => setFocus((f) => !f)} />
        )}
      </div>
    </div>
  );
}
