import type { ThemeInfo } from '../types';

// Fallback palette (Omarchy-ish dark) used until the real theme arrives or when none is present.
const FALLBACK: Record<string, string> = {
  background: '#0e1013',
  foreground: '#c8ccd4',
  accent: '#80a0ff',
  selection: '#2c3652',
  muted: '#4b5263',
  red: '#ff6b6b',
  yellow: '#e5c07b',
  orange: '#f0a070',
  green: '#98c379',
  cyan: '#6fd3c7',
  blue: '#80a0ff',
  magenta: '#c792ea',
};

export function applyTheme(theme: ThemeInfo | null) {
  const root = document.documentElement;
  const colors = { ...FALLBACK, ...(theme?.colors || {}) };
  for (const key of Object.keys(FALLBACK)) root.style.setProperty(`--c-${key}`, colors[key]);
  root.dataset.mode = theme?.mode || 'dark';
  root.style.colorScheme = theme?.mode === 'light' ? 'light' : 'dark';
}
