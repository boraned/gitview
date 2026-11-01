export function timeAgo(input: number | string | null | undefined, now = Date.now()) {
  if (input == null) return '';
  const t = typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function dateTime(input: number | string) {
  const t = typeof input === 'number' ? input : Date.parse(input);
  return new Date(t).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function bytes(n: number | null | undefined) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function splitPath(p: string) {
  const i = p.lastIndexOf('/');
  return i === -1 ? { dir: '', name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) };
}

export function shortDir(dir: string, max = 54) {
  if (!dir) return '/';
  if (dir.length <= max) return dir;
  const tail = dir.slice(dir.length - max + 1);
  const cut = tail.indexOf('/');
  return '…' + (cut > 0 && cut < 18 ? tail.slice(cut) : tail);
}


export const num = (n: number) => n.toLocaleString('de-DE');

export const STATUS_LABEL: Record<string, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  T: 'Type changed',
  U: 'Untracked',
  '!': 'Conflict',
};
