import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { Prefs, ThemeInfo } from '../types';

function Choice<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={checked} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div>
        <div className="set-title">{title}</div>
        {hint ? <div className="set-hint">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function SettingsDialog({ prefs, theme, onPrefs, onClose }: { prefs: Prefs; theme: ThemeInfo | null; onPrefs: (p: Partial<Prefs>) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <header>
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <div className="set-group">Diff</div>
          <Row title="Layout">
            <Choice value={prefs.diffView} onChange={(v) => onPrefs({ diffView: v })} options={[{ value: 'split', label: 'Side by side' }, { value: 'unified', label: 'Unified' }]} />
          </Row>
          <Row title="Context lines" hint="Unchanged lines shown around each change">
            <Choice value={prefs.context} onChange={(v) => onPrefs({ context: v })} options={[3, 5, 10, 25].map((n) => ({ value: n, label: String(n) }))} />
          </Row>
          <Row title="Wrap long lines" hint="Unified layout; side by side always wraps">
            <Toggle checked={prefs.wrap} onChange={(v) => onPrefs({ wrap: v })} />
          </Row>
          <Row title="Ignore whitespace changes">
            <Toggle checked={prefs.ignoreWhitespace} onChange={(v) => onPrefs({ ignoreWhitespace: v })} />
          </Row>
          <Row title="Code size">
            <Choice value={prefs.codeSize} onChange={(v) => onPrefs({ codeSize: v })} options={[11.5, 12, 12.5, 13, 14].map((n) => ({ value: n, label: String(n) }))} />
          </Row>

          <div className="set-group">Godot</div>
          <Row title="Show .uid and .import files" hint="Godot writes these next to every script and asset">
            <Toggle checked={prefs.showGodotMeta} onChange={(v) => onPrefs({ showGodotMeta: v })} />
          </Row>
          <Row title="Diff .tscn and .tres as text" hint="Off: scenes and resources show only their type">
            <Toggle checked={prefs.godotTextScenes} onChange={(v) => onPrefs({ godotTextScenes: v })} />
          </Row>

          <div className="set-group">Watching</div>
          <Row title="Refresh every" hint="Also refreshes when the window gets focus">
            <Choice value={prefs.interval} onChange={(v) => onPrefs({ interval: v })} options={[3, 5, 15, 30, 60].map((n) => ({ value: n, label: `${n}s` }))} />
          </Row>
          <Row title="Theme" hint="Colours follow your Omarchy theme automatically">
            <span className="theme-chip">
              {['background', 'accent', 'green', 'yellow', 'red', 'magenta'].map((k) => (
                <span key={k} style={{ background: theme?.colors?.[k] || `var(--c-${k})` }} />
              ))}
              {theme?.name || 'default'}
            </span>
          </Row>
        </div>
      </div>
    </div>
  );
}
