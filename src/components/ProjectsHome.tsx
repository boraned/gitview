import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, FolderGit2, MoreHorizontal, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import type { Project, Summary } from '../types';
import { api, errorText } from '../lib/api';
import { num, timeAgo } from '../lib/format';
import { Mark, Spinner } from './bits';

function Sparkline({ buckets }: { buckets: number[] }) {
  const max = Math.max(1, ...buckets);
  return (
    <div className="spark" title="Commits per hour, last 24 hours">
      {buckets.map((b, i) => (
        <span key={i} style={{ height: `${Math.max(b ? 14 : 4, (b / max) * 100)}%` }} className={b ? 'on' : ''} />
      ))}
    </div>
  );
}

function Card({ project, summary, loading, onOpen, onRename, onRemove }: {
  project: Project;
  summary: Summary | null;
  loading: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const commit = () => {
    setEditing(false);
    if (name.trim() && name.trim() !== project.name) onRename(name.trim());
    else setName(project.name);
  };

  return (
    <div
      className={`card hue-${project.hue || 'accent'}`}
      role="button"
      tabIndex={0}
      onClick={() => !editing && !menu && onOpen()}
      onKeyDown={(e) => e.key === 'Enter' && !editing && onOpen()}
    >
      <div className="card-top">
        <span className="card-icon">
          <FolderGit2 size={20} />
        </span>
        <div className="card-menu" ref={menuRef} onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" onClick={() => setMenu((m) => !m)} title="Project options">
              <MoreHorizontal size={16} />
            </button>
            {menu ? (
              <div className="menu">
                <button onClick={() => { setMenu(false); setEditing(true); }}>
                  <Pencil size={13} /> Rename
                </button>
                <button className="danger" onClick={() => { setMenu(false); onRemove(); }}>
                  <Trash2 size={13} /> Remove from gitview
                </button>
              </div>
            ) : null}
        </div>
      </div>
      {editing ? (
        <input
          className="card-rename"
          autoFocus
          value={name}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setName(project.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <h3 className="card-name">{project.name}</h3>
      )}
      <div className="card-sub" title={project.roots.join('\n')}>
        {project.roots.length === 1
            ? project.roots[0].replace(/^\/home\/[^/]+/, '~')
            : `${project.roots.length} folders`}
      </div>

      <div className="card-stats">
        <div>
          <span className="stat-value">{summary ? num(summary.count) : loading ? <Spinner size={12} /> : '—'}</span>
          <span className="stat-label">{summary?.count === 1 ? 'changed file' : 'changed files'}</span>
        </div>
        <div>
          <span className="stat-value">
            {summary ? (
              <>
                <span className="plus">+{num(summary.added)}</span> <span className="minus">−{num(summary.removed)}</span>
              </>
            ) : '—'}
          </span>
          <span className="stat-label">lines</span>
        </div>
        <div>
          <span className="stat-value">{summary ? num(summary.assets) : '—'}</span>
          <span className="stat-label">{summary?.assets === 1 ? 'asset' : 'assets'}</span>
        </div>
      </div>

      {summary?.activity ? (
        <div className="card-activity">
          <Sparkline buckets={summary.activity.buckets} />
          <div className="activity-text">
            <span>
              <strong>{num(summary.activity.total)}</strong> commit{summary.activity.total === 1 ? '' : 's'} in 24h
            </span>
            {summary.activity.last ? (
              <span className="muted last" title={summary.activity.last.subject}>
                {timeAgo(summary.activity.last.at)} · {summary.activity.last.subject}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="card-activity empty">{summary ? 'No Git history' : ''}</div>
      )}
      <ArrowUpRight size={18} className="card-go" />
    </div>
  );
}

export function ProjectsHome({ projects, onOpen, onProjects, onSettings }: {
  projects: Project[];
  onOpen: (p: Project) => void;
  onProjects: (list: Project[]) => void;
  onSettings: () => void;
}) {
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    for (const p of projects) {
      if (p.summary) setSummaries((s) => (s[p.id] ? s : { ...s, [p.id]: p.summary! }));
      setLoading((l) => ({ ...l, [p.id]: true }));
      api
        .projectSummary(p.id)
        .then((summary) => {
          if (!cancelled) setSummaries((s) => ({ ...s, [p.id]: summary }));
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading((l) => ({ ...l, [p.id]: false }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [projects]);

  const add = async () => {
    try {
      const result = await api.addProject();
      if (!result) return;
      onProjects(await api.listProjects());
      onOpen(result.project);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="home">
      <header className="home-head">
        <div className="brand">
          <Mark size={40} />
          <div>
            <div className="brand-name">gitview</div>
            <div className="brand-tag">Change Observatory</div>
          </div>
        </div>
        <div className="home-actions">
          <button className="icon-btn" onClick={onSettings} title="Settings">
            <Settings2 size={16} />
          </button>
          <button className="primary" onClick={add}>
            <Plus size={15} /> Add project
          </button>
        </div>
      </header>

      <div className="home-intro">
        <h1>
          Every change, <span>in view.</span>
        </h1>
        <p>Working changes across all of a project’s folders, the way git shows them. Read-only — gitview never touches your files.</p>
      </div>

      <div className="section-label">
        Projects <span>{projects.length}</span>
      </div>
      {error ? <div className="diff-note error">{error}</div> : null}
      <div className="cards">
        {projects.map((p) => (
          <Card
            key={p.id}
            project={p}
            summary={summaries[p.id] || null}
            loading={Boolean(loading[p.id])}
            onOpen={() => onOpen(p)}
            onRename={async (name) => {
              await api.updateProject(p.id, { name });
              onProjects(await api.listProjects());
            }}
            onRemove={async () => {
              if (!window.confirm(`Remove “${p.name}” from gitview?\n\nThe folders themselves are not touched.`)) return;
              await api.removeProject(p.id);
              onProjects(await api.listProjects());
            }}
          />
        ))}
        <button className="card add-card" onClick={add}>
          <span className="add-plus">
            <Plus size={22} />
          </span>
          <span className="add-title">Add project</span>
          <span className="muted">Choose one or more folders — Git repos or plain folders</span>
        </button>
      </div>
    </div>
  );
}
