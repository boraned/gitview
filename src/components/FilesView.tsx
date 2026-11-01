import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  ArrowLeft, Check, ChevronDown, ChevronRight, Copy, Expand, Folder, FolderOpen, FoldVertical, Maximize2, Minimize2,
  Search, Shrink, UnfoldVertical, WrapText, X,
} from 'lucide-react';
import type { ThemedToken } from '@shikijs/core';
import type { FileContent, FileListing, ListedFile, ListedFolder, Prefs, Project, Status } from '../types';
import { api, errorText } from '../lib/api';
import { bytes, num, shortDir, splitPath, STATUS_LABEL, timeAgo } from '../lib/format';
import { tokenize, type TokenLines } from '../lib/highlight';
import { renderText } from './DiffView';
import { FileIcon, Spinner, StatusBadge } from './bits';

const AUTO_EXPAND = 400; // listings up to this many files open fully; bigger ones start at the top level
const SEARCH_CAP = 1500;

interface Dir {
  name: string;
  path: string; // '' for the folder root
  dirs: Map<string, Dir>;
  files: ListedFile[];
  count: number;
}

type TreeRow =
  | { kind: 'root'; key: string; folder: ListedFolder; open: boolean }
  | { kind: 'dir'; key: string; folder: ListedFolder; dir: Dir; depth: number; open: boolean }
  | { kind: 'file'; key: string; folder: ListedFolder; file: ListedFile; depth: number };

const fkey = (root: string, rel: string) => `${root}\u0000${rel}`;
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function buildTree(files: ListedFile[]) {
  const top: Dir = { name: '', path: '', dirs: new Map(), files: [], count: 0 };
  for (const file of files) {
    const parts = file.path.split('/');
    let node = top;
    node.count++;
    for (let i = 0; i < parts.length - 1; i++) {
      let next = node.dirs.get(parts[i]);
      if (!next) {
        next = { name: parts[i], path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [], count: 0 };
        node.dirs.set(parts[i], next);
      }
      next.count++;
      node = next;
    }
    node.files.push(file);
  }
  return top;
}

// ------------------------------------------------------------------ content viewers

const TextLine = memo(function TextLine({ no, text, tokens }: { no: number; text: string; tokens: ThemedToken[] | undefined }) {
  return (
    <div className="row">
      <span className="ln">{no}</span>
      <span className="code">{renderText(text, tokens, undefined)}</span>
    </div>
  );
});

function TextViewer({ content, prefs, themeVersion }: { content: FileContent; prefs: Prefs; themeVersion: number }) {
  const text = content.text ?? '';
  const lines = useMemo(() => {
    const out = text.split('\n');
    if (out.length > 1 && out[out.length - 1] === '') out.pop();
    return out;
  }, [text]);
  const [tokens, setTokens] = useState<TokenLines | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTokens(null);
    tokenize(text, content.language).then((t) => {
      if (!cancelled) setTokens(t);
    });
    return () => {
      cancelled = true;
    };
  }, [text, content.language, themeVersion]);
  if (!text) return <div className="diff-note">This file is empty.</div>;
  return (
    <div className={`diff unified viewer ${prefs.wrap ? 'wrap' : ''}`} style={{ fontSize: prefs.codeSize }}>
      {lines.map((line, i) => (
        <TextLine key={i} no={i + 1} text={line} tokens={tokens?.[i]} />
      ))}
    </div>
  );
}

function MediaViewer({ content, fit, onSize }: { content: FileContent; fit: boolean; onSize: (s: string | null) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!content.data || !content.mime) return;
    const u = URL.createObjectURL(new Blob([content.data as BlobPart], { type: content.mime }));
    setUrl(u);
    setFailed(false);
    onSize(null);
    return () => URL.revokeObjectURL(u);
  }, [content, onSize]);
  if (!url) return null;
  if (failed) return <AssetCard content={{ ...content, kind: 'asset', reason: 'format' }} />;
  if (content.category === 'image') {
    return (
      <div className={`image-stage ${fit ? 'fit' : 'actual'}`}>
        <img
          src={url}
          alt={content.path}
          draggable={false}
          onLoad={(e) => onSize(`${num(e.currentTarget.naturalWidth)} × ${num(e.currentTarget.naturalHeight)}`)}
          onError={() => setFailed(true)}
        />
      </div>
    );
  }
  if (content.category === 'video') {
    return (
      <div className="image-stage fit">
        <video src={url} controls onError={() => setFailed(true)} onLoadedMetadata={(e) => onSize(`${num(e.currentTarget.videoWidth)} × ${num(e.currentTarget.videoHeight)}`)} />
      </div>
    );
  }
  return (
    <div className="audio-stage">
      <div className={`asset-glyph cat-${content.category}`}>
        <FileIcon category={content.category} size={44} />
      </div>
      <audio src={url} controls onError={() => setFailed(true)} />
    </div>
  );
}

function AssetCard({ content }: { content: FileContent }) {
  const reason =
    content.reason === 'large'
      ? 'This file is too large to preview.'
      : content.reason === 'binary'
        ? 'Binary content can’t be shown as text — only the file type is shown.'
        : content.reason === 'link'
          ? `Symbolic link${content.target ? ` → ${content.target}` : ''}. Links are not followed.`
          : content.reason === 'missing'
            ? 'This file no longer exists.'
            : content.reason === 'format'
              ? 'This format can’t be previewed here — only the file type is shown.'
              : 'There is no preview for this kind of file.';
  return (
    <div className="asset-card">
      <div className={`asset-glyph cat-${content.category}`}>
        <FileIcon category={content.category} size={44} />
      </div>
      <div className="asset-type">{content.type}</div>
      <p className="asset-reason">{reason}</p>
      {content.reason !== 'missing' ? (
        <div className="asset-sizes">
          <div>
            <span className="label">Size</span>
            <span className="value">{bytes(content.size)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ preview pane

interface Target {
  key: string;
  root: string;
  rootName: string;
  file: ListedFile;
  status: Status | null;
}

function FilePreview({ project, target, prefs, onPrefs, themeVersion, onBack, focused, onFocus, empty }: {
  project: Project;
  target: Target | null;
  prefs: Prefs;
  onPrefs: (p: Partial<Prefs>) => void;
  themeVersion: number;
  onBack?: () => void;
  focused?: boolean;
  onFocus?: () => void;
  empty: ReactNode;
}) {
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [fit, setFit] = useState(true);
  const [dims, setDims] = useState<string | null>(null);
  const onSize = useCallback((s: string | null) => setDims(s), []);

  const version = target ? `${target.file.size}:${target.file.mtime}` : '';
  useEffect(() => {
    if (!target) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .readFile(project.id, target.root, target.file.path)
      .then((c) => {
        if (!cancelled) setContent(c);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(errorText(e));
          setContent(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.key, version, project.id]);

  useEffect(() => setDims(null), [target?.key]);

  const backButton = onBack ? (
    <button className="back-btn" onClick={onBack} title="Back to the files (Esc)">
      <ArrowLeft size={15} />
    </button>
  ) : null;

  if (!target) return <div className="diff-panel">{backButton}{empty}</div>;

  const { dir, name } = splitPath(target.file.path);
  const shown = content && content.path === target.file.path ? content : null;
  const isImage = shown?.kind === 'media' && shown.category === 'image';
  const copyPath = () =>
    navigator.clipboard.writeText(target.file.path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });

  return (
    <div className="diff-panel">
      <header className="diff-head">
        <div className="diff-title">
          {backButton}
          <FileIcon category={target.file.category} size={16} />
          <div className="diff-name">
            <div className="name-line">
              <span className="fname">{name}</span>
              {target.status ? <StatusBadge status={target.status} title={`${STATUS_LABEL[target.status] || target.status} — see Changes`} /> : null}
            </div>
            <div className="path-line" title={target.file.path}>
              {dir || '/'} · {shown?.type || target.file.type} · {bytes(target.file.size)}
              {shown?.kind === 'text' ? ` · ${num(shown.lines ?? 0)} line${shown.lines === 1 ? '' : 's'}` : ''}
              {dims ? ` · ${dims}` : ''}
              {' · '}modified {timeAgo(target.file.mtime)}
              <span className="chip">{target.rootName}</span>
            </div>
          </div>
        </div>
        <div className="diff-tools">
          {isImage ? (
            <button className={`icon-btn ${fit ? '' : 'on'}`} title={fit ? 'Actual size' : 'Fit to the pane'} onClick={() => setFit((f) => !f)}>
              {fit ? <Expand size={15} /> : <Shrink size={15} />}
            </button>
          ) : null}
          {shown?.kind === 'text' ? (
            <button className={`icon-btn ${prefs.wrap ? 'on' : ''}`} title="Wrap long lines" onClick={() => onPrefs({ wrap: !prefs.wrap })}>
              <WrapText size={15} />
            </button>
          ) : null}
          <button className="icon-btn" title="Copy path" onClick={copyPath}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
          {onFocus ? (
            <button className={`icon-btn ${focused ? 'on' : ''}`} title={focused ? 'Show the file list (F / Esc)' : 'Give the file the whole window (F)'} onClick={onFocus}>
              {focused ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          ) : null}
          <button className="icon-btn" title="Show in file manager" onClick={() => api.reveal(project.id, target.root, target.file.path)}>
            <FolderOpen size={15} />
          </button>
        </div>
      </header>
      {shown?.kind === 'media' && shown.mime ? (
        <div className="diff-sides">
          <span>{shown.mime}</span>
        </div>
      ) : null}
      <div className={`diff-scroll ${loading && shown ? 'stale' : ''}`}>
        {error ? (
          <div className="diff-note error">{error}</div>
        ) : shown ? (
          shown.kind === 'text' ? (
            <TextViewer content={shown} prefs={prefs} themeVersion={themeVersion} />
          ) : shown.kind === 'media' ? (
            <MediaViewer content={shown} fit={fit} onSize={onSize} />
          ) : (
            <AssetCard content={shown} />
          )
        ) : (
          <div className="pane-center muted">
            <Spinner size={18} />
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the tab

export function FilesView({ project, listing, error, statuses, activeRoot, prefs, onPrefs, themeVersion, narrow, focus, onFocus, listWidth, resizer, overlayOpen, searchRef }: {
  project: Project;
  listing: FileListing | null;
  error: string | null;
  statuses: Map<string, Status>;
  activeRoot: string | null;
  prefs: Prefs;
  onPrefs: (p: Partial<Prefs>) => void;
  themeVersion: number;
  narrow: boolean;
  focus: boolean;
  onFocus: () => void;
  listWidth: number;
  resizer: Record<string, unknown>;
  overlayOpen: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [showFile, setShowFile] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const folders = useMemo(() => (listing?.folders || []).filter((f) => !activeRoot || f.path === activeRoot), [listing, activeRoot]);
  const total = folders.reduce((n, f) => n + f.files.length, 0);
  const autoOpen = total <= AUTO_EXPAND;
  const trees = useMemo(() => new Map(folders.map((f) => [f.path, buildTree(f.files)])), [folders]);
  const multi = folders.length > 1;

  const isOpen = useCallback((key: string, depth: number) => {
    const byDefault = depth < 0 ? true : autoOpen;
    return toggled.has(key) ? !byDefault : byDefault;
  }, [toggled, autoOpen]);

  const rows = useMemo<TreeRow[]>(() => {
    const q = query.trim().toLowerCase();
    const out: TreeRow[] = [];
    if (q) {
      for (const folder of folders) {
        for (const file of folder.files) {
          if (out.length >= SEARCH_CAP) break;
          if (`${folder.name}/${file.path}`.toLowerCase().includes(q)) out.push({ kind: 'file', key: fkey(folder.path, file.path), folder, file, depth: -1 });
        }
      }
      return out;
    }
    const walk = (folder: ListedFolder, dir: Dir, depth: number) => {
      for (const sub of [...dir.dirs.values()].sort((a, b) => byName(a.name, b.name))) {
        const key = fkey(folder.path, `${sub.path}/`);
        const open = isOpen(key, depth);
        out.push({ kind: 'dir', key, folder, dir: sub, depth, open });
        if (open) walk(folder, sub, depth + 1);
      }
      for (const file of [...dir.files].sort((a, b) => byName(splitPath(a.path).name, splitPath(b.path).name))) {
        out.push({ kind: 'file', key: fkey(folder.path, file.path), folder, file, depth });
      }
    };
    for (const folder of folders) {
      const tree = trees.get(folder.path);
      if (!tree) continue;
      if (multi) {
        const key = fkey(folder.path, '');
        const open = isOpen(key, -1);
        out.push({ kind: 'root', key, folder, open });
        if (open) walk(folder, tree, 1);
      } else walk(folder, tree, 0);
    }
    return out;
  }, [folders, trees, multi, query, isOpen]);

  const fileRows = useMemo(() => rows.filter((r): r is Extract<TreeRow, { kind: 'file' }> => r.kind === 'file'), [rows]);
  const allFiles = useMemo(() => {
    const map = new Map<string, { folder: ListedFolder; file: ListedFile }>();
    for (const folder of folders) for (const file of folder.files) map.set(fkey(folder.path, file.path), { folder, file });
    return map;
  }, [folders]);

  // keep a valid selection: the first file in the tree order when nothing (or something gone) is selected
  useEffect(() => {
    if (!listing) return;
    if (selected && allFiles.has(selected)) return;
    setSelected(fileRows[0]?.key ?? null);
  }, [listing, allFiles, fileRows, selected]);

  const target = useMemo<Target | null>(() => {
    const hit = selected ? allFiles.get(selected) : null;
    if (!hit) return null;
    return { key: selected!, root: hit.folder.path, rootName: hit.folder.name, file: hit.file, status: statuses.get(selected!) || null };
  }, [selected, allFiles, statuses]);

  const toggle = useCallback((key: string) => {
    setToggled((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }, []);

  const setAll = useCallback((open: boolean) => {
    // toggles are relative to the default, so "all open" with autoOpen is the empty set, and vice versa
    if (open === autoOpen) return setToggled(new Set());
    const keys = new Set<string>();
    for (const folder of folders) {
      const tree = trees.get(folder.path);
      const visit = (dir: Dir) => {
        for (const sub of dir.dirs.values()) {
          keys.add(fkey(folder.path, `${sub.path}/`));
          visit(sub);
        }
      };
      if (tree) visit(tree);
    }
    setToggled(keys);
  }, [autoOpen, folders, trees]);

  const scrollTo = (key: string) =>
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' }));

  const cursor = selected;
  const move = useCallback((delta: number) => {
    if (!rows.length) return;
    const i = rows.findIndex((r) => r.key === cursor);
    // step over folder rows: the cursor always rests on a file
    let j = i === -1 ? (delta > 0 ? -1 : rows.length) : i;
    do j += delta;
    while (j >= 0 && j < rows.length && rows[j].kind !== 'file');
    if (j < 0 || j >= rows.length) return;
    setSelected(rows[j].key);
    scrollTo(rows[j].key);
  }, [rows, cursor]);

  // expand / collapse the folder that holds the selected file
  const parentKey = useMemo(() => {
    if (!target) return null;
    const { dir } = splitPath(target.file.path);
    return dir ? fkey(target.root, `${dir}/`) : null;
  }, [target]);

  const fileOnly = narrow ? showFile : focus;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.modal')) return;
      if ((e.target as HTMLElement)?.matches?.('input, textarea, select')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (!overlayOpen && narrow && showFile) setShowFile(false);
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        setShowFile(false);
        if (focus) onFocus();
        if (searchRef.current) searchRef.current.focus();
        else requestAnimationFrame(() => searchRef.current?.focus());
        return;
      }
      if ((e.key === 'f' || e.key === 'F') && narrow) return setShowFile((s) => !s);
      if (fileOnly) return;
      if (e.key === 'Enter' && narrow && target) return setShowFile(true);
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        move(-1);
      } else if (e.key === 'ArrowLeft' && parentKey && !query) {
        e.preventDefault();
        const row = rows.find((r) => r.key === parentKey);
        if (row && row.kind === 'dir' && row.open) toggle(parentKey);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, narrow, showFile, focus, onFocus, fileOnly, target, parentKey, rows, toggle, query, overlayOpen, searchRef]);

  const changedCount = useMemo(() => [...allFiles.keys()].filter((k) => statuses.has(k)).length, [allFiles, statuses]);
  const truncated = folders.some((f) => f.truncated);

  const list = (
    <section className={`list-pane files-pane ${narrow ? 'full' : ''}`} style={narrow ? undefined : { width: listWidth }}>
      <div className="list-tools">
        <div className="search">
          <Search size={14} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') e.currentTarget.blur();
              else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                move(e.key === 'ArrowDown' ? 1 : -1);
              } else if (e.key === 'Enter' && narrow && target) setShowFile(true);
            }}
            placeholder="Find a file"
            spellCheck={false}
          />
          {query ? (
            <button className="clear" onClick={() => setQuery('')} title="Clear">
              <X size={13} />
            </button>
          ) : (
            <kbd>/</kbd>
          )}
        </div>
      </div>
      <div className="list-summary">
        <span>
          {listing ? `${num(total)} file${total === 1 ? '' : 's'}` : 'Listing…'}
          {changedCount ? <> · <span className="changed-count">{num(changedCount)} changed</span></> : null}
          {truncated ? ' · first 25.000 shown' : ''}
        </span>
        {!query && rows.some((r) => r.kind === 'dir') ? (
          <span className="tree-tools">
            <button className="icon-btn sm" title="Expand all folders" onClick={() => setAll(true)}>
              <UnfoldVertical size={13} />
            </button>
            <button className="icon-btn sm" title="Collapse all folders" onClick={() => setAll(false)}>
              <FoldVertical size={13} />
            </button>
          </span>
        ) : null}
      </div>
      <div className="file-list tree" ref={listRef}>
        {error ? (
          <div className="diff-note error">{error}</div>
        ) : !listing ? (
          <div className="pane-center muted">
            <Spinner size={18} />
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-list">
            <div className="empty-mark">∅</div>
            <div className="empty-title">{query ? 'No files match' : 'This folder is empty'}</div>
            <div className="muted">{query ? 'Try another name or path.' : 'Files you add to it will show up here.'}</div>
          </div>
        ) : (
          rows.map((row) => {
            if (row.kind === 'root') {
              return (
                <button key={row.key} className="group-head" onClick={() => toggle(row.key)} title={row.folder.path}>
                  {row.open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span className="group-name">{row.folder.name}</span>
                  {row.folder.error ? <span className="err">{row.folder.error}</span> : null}
                  <span className="group-count">{num(row.folder.files.length)}</span>
                </button>
              );
            }
            if (row.kind === 'dir') {
              return (
                <button key={row.key} data-key={row.key} className="tree-row dir" style={{ paddingLeft: 6 + row.depth * 14 }} onClick={() => toggle(row.key)} title={row.dir.path}>
                  {row.open ? <ChevronDown size={13} className="chev" /> : <ChevronRight size={13} className="chev" />}
                  {row.open ? <FolderOpen size={14} className="dir-icon" /> : <Folder size={14} className="dir-icon" />}
                  <span className="tree-name">{row.dir.name}</span>
                  <span className="tree-meta">{num(row.dir.count)}</span>
                </button>
              );
            }
            const status = statuses.get(row.key);
            const flat = row.depth < 0;
            const { dir, name } = splitPath(row.file.path);
            return (
              <button
                key={row.key}
                data-key={row.key}
                className={`tree-row file ${row.key === selected ? 'on' : ''}`}
                style={{ paddingLeft: flat ? 8 : 6 + row.depth * 14 + 17 }}
                onClick={() => {
                  setSelected(row.key);
                  if (narrow) setShowFile(true);
                }}
                title={row.file.path}
              >
                <FileIcon category={row.file.category} size={14} />
                <span className="tree-name">
                  {name}
                  {flat ? <span className="tree-dir">{multi ? `${row.folder.name}/` : ''}{shortDir(dir, 40)}</span> : null}
                </span>
                <span className="tree-meta">{bytes(row.file.size)}</span>
                {status ? <StatusBadge status={status} /> : null}
              </button>
            );
          })
        )}
      </div>
      <div className="list-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>/</kbd> find</span>
        <span><kbd>F</kbd> {narrow ? 'open' : 'focus'}</span>
      </div>
    </section>
  );

  return (
    <>
      {!fileOnly ? list : null}
      {!narrow && !fileOnly ? <div className="resizer" {...resizer} title="Drag to resize" /> : null}
      {!narrow || showFile ? (
        <FilePreview
          project={project}
          target={target}
          prefs={prefs}
          onPrefs={onPrefs}
          themeVersion={themeVersion}
          onBack={narrow ? () => setShowFile(false) : undefined}
          focused={!narrow && focus}
          onFocus={narrow ? undefined : onFocus}
          empty={
            <div className="pane-center">
              <div className="empty-list">
                <div className="empty-mark">◐</div>
                <div className="empty-title">{listing ? 'Select a file' : 'Reading folders…'}</div>
                <div className="muted">Text shows its content. Images, audio and video play right here.</div>
              </div>
            </div>
          }
        />
      ) : null}
    </>
  );
}
