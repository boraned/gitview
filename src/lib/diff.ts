import { structuredPatch, diffWordsWithSpace } from 'diff';

export type Range = [number, number];

export interface Line {
  kind: 'ctx' | 'add' | 'del';
  oldNo: number | null;
  newNo: number | null;
  text: string;
  marks?: Range[]; // changed character ranges (word diff)
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  gapBefore: number; // unchanged lines hidden before this hunk
  lines: Line[];
}

export interface DiffModel {
  hunks: Hunk[];
  gapAfter: number;
  added: number;
  removed: number;
  identical: boolean;
}

export interface SplitRow {
  left: Line | null;
  right: Line | null;
}

const WORD_DIFF_LIMIT = 600; // chars per line pair

function lineCount(text: string) {
  if (!text) return 0;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

function wordMarks(a: string, b: string): [Range[], Range[]] | null {
  if (a.length > WORD_DIFF_LIMIT || b.length > WORD_DIFF_LIMIT) return null;
  const parts = diffWordsWithSpace(a, b);
  const left: Range[] = [];
  const right: Range[] = [];
  let ai = 0;
  let bi = 0;
  let same = 0;
  for (const part of parts) {
    const len = part.value.length;
    if (part.added) {
      right.push([bi, bi + len]);
      bi += len;
    } else if (part.removed) {
      left.push([ai, ai + len]);
      ai += len;
    } else {
      ai += len;
      bi += len;
      same += len;
    }
  }
  // When almost nothing is shared, word marks are noise: the whole line changed.
  if (same < Math.min(a.length, b.length) * 0.35) return null;
  return [left, right];
}

/** Attach word-level marks to del/add runs that replace each other. */
function markReplacements(lines: Line[]) {
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== 'del') {
      i++;
      continue;
    }
    const delStart = i;
    while (i < lines.length && lines[i].kind === 'del') i++;
    const addStart = i;
    while (i < lines.length && lines[i].kind === 'add') i++;
    const dels = addStart - delStart;
    const adds = i - addStart;
    const pairs = Math.min(dels, adds);
    for (let k = 0; k < pairs; k++) {
      const d = lines[delStart + k];
      const a = lines[addStart + k];
      const marks = wordMarks(d.text, a.text);
      if (marks) {
        d.marks = marks[0];
        a.marks = marks[1];
      }
    }
  }
}

export function buildDiff(oldText: string, newText: string, context: number, ignoreWhitespace = false): DiffModel {
  const patch = structuredPatch('a', 'b', oldText, newText, '', '', { context, ignoreWhitespace });
  const hunks: Hunk[] = [];
  let added = 0;
  let removed = 0;
  let prevOldEnd = 1;
  for (const h of patch.hunks) {
    const lines: Line[] = [];
    let o = h.oldStart;
    let n = h.newStart;
    for (const raw of h.lines) {
      const sign = raw[0];
      const text = raw.slice(1);
      if (sign === '\\') continue; // "\ No newline at end of file"
      if (sign === '+') {
        lines.push({ kind: 'add', oldNo: null, newNo: n++, text });
        added++;
      } else if (sign === '-') {
        lines.push({ kind: 'del', oldNo: o++, newNo: null, text });
        removed++;
      } else {
        lines.push({ kind: 'ctx', oldNo: o++, newNo: n++, text });
      }
    }
    markReplacements(lines);
    const oldStart = h.oldLines === 0 ? h.oldStart + 1 : h.oldStart;
    hunks.push({
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      gapBefore: Math.max(0, oldStart - prevOldEnd),
      lines,
    });
    prevOldEnd = oldStart + h.oldLines;
  }
  const totalOld = lineCount(oldText);
  const gapAfter = hunks.length ? Math.max(0, totalOld - prevOldEnd + 1) : 0;
  return { hunks, gapAfter, added, removed, identical: hunks.length === 0 };
}

/** Pair deletions with additions so a split view shows replacements side by side. */
export function toSplit(lines: Line[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.kind === 'ctx') {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const dels: Line[] = [];
    const adds: Line[] = [];
    while (i < lines.length && lines[i].kind === 'del') dels.push(lines[i++]);
    while (i < lines.length && lines[i].kind === 'add') adds.push(lines[i++]);
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) rows.push({ left: dels[k] || null, right: adds[k] || null });
  }
  return rows;
}
