import {
  Archive, AudioLines, Binary, Box, Braces, Clapperboard, Database, File, FileCode2, FileCog, FileText,
  Fingerprint, Image, Shapes, Type,
} from 'lucide-react';
import type { Category } from '../types';
import { STATUS_LABEL } from '../lib/format';

const ICONS: Record<Category, typeof File> = {
  code: FileCode2,
  docs: FileText,
  data: Braces,
  config: FileCog,
  meta: Fingerprint,
  scene: Shapes,
  image: Image,
  audio: AudioLines,
  video: Clapperboard,
  model: Box,
  font: Type,
  archive: Archive,
  binary: Binary,
  document: FileText,
  database: Database,
  other: File,
};

export function FileIcon({ category, size = 15 }: { category: Category; size?: number }) {
  const Icon = ICONS[category] || File;
  return (
    <span className={`file-icon cat-${category}`}>
      <Icon size={size} strokeWidth={1.75} />
    </span>
  );
}

export function StatusBadge({ status, title }: { status: string; title?: string }) {
  return (
    <span className={`status s-${status === '!' ? 'X' : status}`} title={title || STATUS_LABEL[status] || status}>
      {status}
    </span>
  );
}

export function LineStats({ added, removed }: { added: number | null; removed: number | null }) {
  if (added == null && removed == null) return null;
  return (
    <span className="line-stats">
      {added ? <span className="plus">+{added}</span> : null}
      {removed ? <span className="minus">−{removed}</span> : null}
    </span>
  );
}

export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="mark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--c-accent)" />
          <stop offset="1" stopColor="var(--c-magenta)" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="58" height="58" rx="16" fill="url(#mark-g)" opacity="0.16" />
      <rect x="3.5" y="3.5" width="57" height="57" rx="15.5" fill="none" stroke="url(#mark-g)" strokeOpacity="0.55" />
      <g fill="none" stroke="var(--c-foreground)" strokeWidth="3.5" strokeLinecap="round">
        <path d="M18 22v20" />
        <path d="M18 38c0-7 11-6 11-13" />
      </g>
      <circle cx="18" cy="19" r="4" fill="var(--c-foreground)" />
      <circle cx="18" cy="45" r="4" fill="var(--c-foreground)" />
      <circle cx="29" cy="22" r="4" fill="var(--c-accent)" />
      <rect x="38" y="24" width="10" height="4.5" rx="2.25" fill="var(--c-green)" />
      <rect x="38" y="32.5" width="14" height="4.5" rx="2.25" fill="var(--c-yellow)" />
      <rect x="38" y="41" width="8" height="4.5" rx="2.25" fill="var(--c-red)" />
    </svg>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}
