import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, GitCommitHorizontal, Tag } from 'lucide-react';
import type { Commit, CommitDetail, Prefs, Project } from '../types';
import { api, errorText } from '../lib/api';
import { dateTime, num, shortDir, splitPath, timeAgo } from '../lib/format';
import { FileIcon, LineStats, Spinner, StatusBadge } from './bits';
import { DiffPanel, type PanelTarget } from './DiffPanel';

const PAGE = 80;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
}

export function HistoryView({ project, root, prefs, onPrefs, themeVersion, narrow, focus, onFocus }: {
  project: Project;
  root: string | null;
  prefs: Prefs;
  onPrefs: (p: Partial<Prefs>) => void;
  themeVersion: number;
  narrow: boolean;
  focus: boolean;
  onFocus: () => void;
}) {
  // narrow windows show one pane at a time: commits → files → diff
  const [stage, setStage] = useState<'commits' | 'files' | 'diff'>('commits');
  const [commits, setCommits] = useState<Commit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Commit | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [file, setFile] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    async (skip: number) => {
      setLoading(true);
      try {
        const page = await api.commits(project.id, { skip, limit: PAGE, root });
        setCommits((prev) => (skip ? [...prev, ...page.commits] : page.commits));
        setHasMore(page.hasMore);
        setError(null);
        if (!skip) setSelected((cur) => cur && page.commits.find((c) => c.hash === cur.hash && c.root === cur.root) ? cur : page.commits[0] || null);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setLoading(false);
      }
    },
    [project.id, root],
  );

  useEffect(() => {
    setCommits([]);
    setSelected(null);
    load(0);
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    api
      .commit(project.id, selected.root, selected.hash)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setFile(d.files[0]?.repoPath ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.modal') || (e.target as HTMLElement)?.matches?.('input, textarea, select')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (narrow && e.key === 'Escape') {
        setStage((s) => (s === 'diff' ? 'files' : 'commits'));
        return;
      }
      if (narrow && stage !== 'commits') return;
      if (!['ArrowDown', 'ArrowUp', 'j', 'k'].includes(e.key) || !commits.length) return;
      e.preventDefault();
      const i = commits.findIndex((c) => c === selected);
      const next = commits[Math.max(0, Math.min(commits.length - 1, i + (e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1)))];
      setSelected(next);
      requestAnimationFrame(() => document.querySelector(`[data-commit="${next.root}:${next.hash}"]`)?.scrollIntoView({ block: 'nearest' }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commits, selected, narrow, stage]);

  const fileEntry = detail?.files.find((f) => f.repoPath === file) || null;

  const target = useMemo<PanelTarget | null>(() => {
    if (!detail || !fileEntry || !selected) return null;
    return {
      key: `${selected.root}:${detail.hash}:${fileEntry.repoPath}`,
      version: detail.hash,
      path: fileEntry.repoPath,
      oldPath: fileEntry.oldRepoPath,
      status: fileEntry.status,
      type: fileEntry.type,
      category: fileEntry.category,
      added: fileEntry.added,
      removed: fileEntry.removed,
      load: () => api.commitFile(project.id, selected.root, detail.hash, fileEntry.repoPath, fileEntry.oldRepoPath),
      subtitle: <span className="chip mono">{detail.hash.slice(0, 7)}</span>,
    };
  }, [detail, fileEntry, selected, project.id]);

  const copyHash = () => {
    if (!detail) return;
    navigator.clipboard.writeText(detail.hash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  let lastDay = '';

  const showCommits = narrow ? stage === 'commits' : !focus;
  const showFiles = narrow ? stage === 'files' : !focus;
  const showDiff = narrow ? stage === 'diff' : true;

  return (
    <>
      {showCommits ? (
      <section className={`commit-pane ${narrow ? 'full' : ''}`}>
        <div className="pane-title">
          <GitCommitHorizontal size={14} /> Commits {root ? <span className="chip">{splitPath(root).name}</span> : <span className="muted">all folders</span>}
        </div>
        <div className="commit-list">
          {error && !commits.length ? <div className="diff-note error">{error}</div> : null}
          {commits.map((c) => {
            const day = new Date(c.committedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <div key={`${c.root}:${c.hash}`}>
                {showDay ? <div className="day-head">{day}</div> : null}
                <button
                  data-commit={`${c.root}:${c.hash}`}
                  className={`commit-row ${selected === c ? 'on' : ''}`}
                  onClick={() => {
                    setSelected(c);
                    if (narrow) setStage('files');
                  }}
                >
                  <span className="avatar" title={`${c.author} <${c.email}>`}>{initials(c.author)}</span>
                  <span className="commit-main">
                    <span className="commit-subject">{c.subject || '(no message)'}</span>
                    <span className="commit-meta">
                      <span className="mono">{c.hash.slice(0, 7)}</span>
                      <span>{timeAgo(c.committedAt)}</span>
                      {project.roots.length > 1 ? <span className="chip">{c.branch || splitPath(c.root).name}</span> : null}
                    </span>
                  </span>
                  <span className="commit-stats">
                    <LineStats added={c.added} removed={c.removed} />
                    <span className="muted">{c.files} file{c.files === 1 ? '' : 's'}</span>
                  </span>
                </button>
              </div>
            );
          })}
          {loading ? (
            <div className="side-loading">
              <Spinner /> Loading commits…
            </div>
          ) : hasMore ? (
            <button className="load-more" onClick={() => load(commits.length)}>
              Load older commits
            </button>
          ) : commits.length ? (
            <div className="list-end">Beginning of history</div>
          ) : (
            <div className="empty-list">
              <div className="empty-title">No commits</div>
              <div className="muted">These folders have no Git history.</div>
            </div>
          )}
        </div>
      </section>
      ) : null}

      {showFiles ? (
      <section className={`commit-files ${narrow ? 'full' : ''}`}>
        {narrow ? (
          <button className="pane-back" onClick={() => setStage('commits')}>
            <ArrowLeft size={14} /> Commits
          </button>
        ) : null}
        {detail && selected ? (
          <>
            <div className="commit-card">
              <div className="commit-card-subject">{detail.subject || '(no message)'}</div>
              {detail.body ? <pre className="commit-card-body">{detail.body}</pre> : null}
              <div className="commit-card-meta">
                <span className="avatar sm">{initials(detail.author)}</span>
                <span>
                  <strong>{detail.author}</strong> · {dateTime(detail.committedAt)}
                </span>
              </div>
              <div className="commit-card-meta">
                <button className="hash" onClick={copyHash} title="Copy full hash">
                  <span className="mono">{detail.hash.slice(0, 12)}</span> {copied ? <Check size={12} /> : <Copy size={12} />}
                </button>
                {detail.refs.map((r) => (
                  <span key={r} className="chip ref">
                    <Tag size={10} /> {r.replace(/^HEAD -> /, '')}
                  </span>
                ))}
              </div>
            </div>
            <div className="pane-title small">
              {num(detail.files.length)} changed file{detail.files.length === 1 ? '' : 's'}
            </div>
            <div className="file-list">
              {detail.files.map((f) => {
                const { dir, name } = splitPath(f.repoPath);
                return (
                  <button
                    key={f.repoPath}
                    className={`file-row ${file === f.repoPath ? 'on' : ''} ${f.status === 'D' ? 'deleted' : ''}`}
                    onClick={() => {
                      setFile(f.repoPath);
                      if (narrow) setStage('diff');
                    }}
                    title={f.repoPath}
                  >
                    <FileIcon category={f.category} />
                    <span className="file-main">
                      <span className="file-name">{name}</span>
                      <span className="file-dir">{shortDir(dir, 40)}</span>
                    </span>
                    <LineStats added={f.added} removed={f.removed} />
                    <StatusBadge status={f.status} />
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="pane-center muted">{detailLoading || loading ? <Spinner size={18} /> : 'Select a commit'}</div>
        )}
      </section>
      ) : null}

      {showDiff ? (
        <DiffPanel
          target={target}
          prefs={prefs}
          onPrefs={onPrefs}
          themeVersion={themeVersion}
          onBack={narrow ? () => setStage('files') : undefined}
          focused={!narrow && focus}
          onFocus={narrow ? undefined : onFocus}
          empty={<div className="pane-center muted">{detailLoading ? <Spinner size={18} /> : 'Select a file'}</div>}
        />
      ) : null}
    </>
  );
}
