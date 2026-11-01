import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, Columns2, Copy, FolderOpen, Maximize2, Minimize2, Rows2, WrapText } from 'lucide-react';
import type { Detail, Prefs } from '../types';
import { errorText } from '../lib/api';
import { splitPath, STATUS_LABEL } from '../lib/format';
import { DiffBody, DiffLoading } from './DiffView';
import { FileIcon, LineStats, StatusBadge } from './bits';

export interface PanelTarget {
  key: string; // identity of the file being shown
  version: string; // changes whenever the file's content may have changed
  path: string;
  oldPath?: string | null;
  status: string;
  type: string;
  category: Detail['category'];
  added: number | null;
  removed: number | null;
  compareChoices?: boolean; // git file with both staged and unstaged changes
  load: (compare: string) => Promise<Detail>;
  reveal?: () => void;
  subtitle?: ReactNode;
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function DiffPanel({ target, prefs, onPrefs, themeVersion, empty, onBack, focused, onFocus }: {
  target: PanelTarget | null;
  prefs: Prefs;
  onPrefs: (p: Partial<Prefs>) => void;
  themeVersion: number;
  empty: ReactNode;
  onBack?: () => void; // narrow windows: return to the list
  focused?: boolean;
  onFocus?: () => void; // wide windows: give the file the whole width
}) {
  const [compare, setCompare] = useState('all');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => setCompare('all'), [target?.key]);

  const load = target?.load;
  useEffect(() => {
    if (!target || !load) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    load(compare)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(errorText(e));
          setDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // version captures content changes; key captures a different file
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.key, target?.version, compare, prefs.godotTextScenes]);

  const copyPath = useCallback(() => {
    if (!target) return;
    navigator.clipboard.writeText(target.path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [target]);

  const backButton = onBack ? (
    <button className="back-btn" onClick={onBack} title="Back to the list (Esc)">
      <ArrowLeft size={15} />
    </button>
  ) : null;

  if (!target) return <div className="diff-panel">{backButton}{empty}</div>;

  const { dir, name } = splitPath(target.path);
  const showDiffControls = detail?.kind === 'text' || (!detail && !target.category.match(/image|audio|video|model|font|archive|binary|document|database|scene/));

  return (
    <div className="diff-panel">
      <header className="diff-head">
        <div className="diff-title">
          {backButton}
          <FileIcon category={target.category} size={16} />
          <div className="diff-name">
            <div className="name-line">
              <span className="fname">{name}</span>
              <StatusBadge status={target.status} />
              <LineStats added={target.added} removed={target.removed} />
            </div>
            <div className="path-line" title={target.path}>
              {target.oldPath ? <span className="renamed">renamed from {target.oldPath} · </span> : null}
              {dir || '/'} · {target.type} · {STATUS_LABEL[target.status] || target.status}
              {target.subtitle ? <> · {target.subtitle}</> : null}
            </div>
          </div>
        </div>
        <div className="diff-tools">
          {target.compareChoices ? (
            <Segmented
              value={compare}
              onChange={setCompare}
              options={[
                { value: 'all', label: 'All', title: 'HEAD → working tree' },
                { value: 'staged', label: 'Staged', title: 'HEAD → index' },
                { value: 'unstaged', label: 'Unstaged', title: 'Index → working tree' },
              ]}
            />
          ) : null}
          {showDiffControls ? (
            <>
              <Segmented
                value={prefs.diffView}
                onChange={(v) => onPrefs({ diffView: v })}
                options={[
                  { value: 'split', label: <Columns2 size={14} />, title: 'Side by side' },
                  { value: 'unified', label: <Rows2 size={14} />, title: 'Unified' },
                ]}
              />
              {prefs.diffView === 'unified' ? (
                <button className={`icon-btn ${prefs.wrap ? 'on' : ''}`} title="Wrap long lines" onClick={() => onPrefs({ wrap: !prefs.wrap })}>
                  <WrapText size={15} />
                </button>
              ) : null}
            </>
          ) : null}
          <button className="icon-btn" title="Copy path" onClick={copyPath}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
          {onFocus ? (
            <button className={`icon-btn ${focused ? 'on' : ''}`} title={focused ? 'Show the file list (F / Esc)' : 'Give the file the whole window (F)'} onClick={onFocus}>
              {focused ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          ) : null}
          {target.reveal ? (
            <button className="icon-btn" title="Show in file manager" onClick={target.reveal}>
              <FolderOpen size={15} />
            </button>
          ) : null}
        </div>
      </header>
      {detail && detail.kind === 'text' ? (
        <div className="diff-sides">
          <span>{detail.oldLabel}</span>
          <span className="arrow">→</span>
          <span>{detail.newLabel}</span>
          {detail.baselineAt ? <span className="muted"> · baseline from {new Date(detail.baselineAt).toLocaleString()}</span> : null}
        </div>
      ) : null}
      <div className={`diff-scroll ${loading && detail ? 'stale' : ''}`}>
        {error ? <div className="diff-note error">{error}</div> : detail ? <DiffBody detail={detail} prefs={prefs} themeVersion={themeVersion} /> : loading ? <DiffLoading /> : null}
      </div>
    </div>
  );
}
