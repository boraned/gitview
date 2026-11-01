import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, ChevronsUpDown, FoldVertical } from 'lucide-react';
import type { ThemedToken } from '@shikijs/core';
import type { Detail, Prefs } from '../types';
import { buildDiff, toSplit, type Line, type Range } from '../lib/diff';
import { tokenize, type TokenLines } from '../lib/highlight';
import { bytes } from '../lib/format';
import { FileIcon, Spinner } from './bits';

const FULL = 1_000_000;

function renderText(text: string, tokens: ThemedToken[] | undefined, marks: Range[] | undefined): ReactNode {
  const segments: { text: string; color?: string; italic?: boolean; bold?: boolean }[] = tokens?.length
    ? tokens.map((t) => ({ text: t.content, color: t.color, italic: Boolean(t.fontStyle && t.fontStyle & 1), bold: Boolean(t.fontStyle && t.fontStyle & 2) }))
    : [{ text }];
  if (!text) return '\u200b';
  const out: ReactNode[] = [];
  let pos = 0;
  let key = 0;
  let mi = 0;
  const ranges = marks || [];
  for (const seg of segments) {
    let start = 0;
    const len = seg.text.length;
    while (start < len) {
      const abs = pos + start;
      while (mi < ranges.length && ranges[mi][1] <= abs) mi++;
      const range = ranges[mi];
      let end = len;
      let marked = false;
      if (range) {
        if (abs >= range[0]) {
          marked = true;
          end = Math.min(len, range[1] - pos);
        } else {
          end = Math.min(len, range[0] - pos);
        }
      }
      const piece = seg.text.slice(start, end);
      const style = seg.color || seg.italic || seg.bold
        ? { color: seg.color, fontStyle: seg.italic ? 'italic' : undefined, fontWeight: seg.bold ? 600 : undefined }
        : undefined;
      const span = <span key={key++} style={style}>{piece}</span>;
      out.push(marked ? <mark key={key++}>{span}</mark> : span);
      start = end;
    }
    pos += len;
  }
  return out;
}

const Code = memo(function Code({ line, tokens, side }: { line: Line; tokens: TokenLines | null; side: 'old' | 'new' }) {
  const no = side === 'old' ? line.oldNo : line.newNo;
  const lineTokens = tokens && no ? tokens[no - 1] : undefined;
  return <span className="code">{renderText(line.text, lineTokens, line.marks)}</span>;
});

function Gap({ count, onExpand }: { count: number; onExpand: () => void }) {
  if (count <= 0) return null;
  return (
    <button className="gap" onClick={onExpand}>
      <ChevronsUpDown size={13} />
      <span>{count.toLocaleString('de-DE')} unchanged line{count === 1 ? '' : 's'}</span>
    </button>
  );
}

function AssetCard({ detail }: { detail: Detail }) {
  const statusText = !detail.oldExists ? 'Added' : !detail.newExists ? 'Deleted' : 'Modified';
  const reason =
    detail.reason === 'large'
      ? 'This file is too large to show as text.'
      : detail.reason === 'binary'
        ? 'Binary content isn’t diffed — only the file type is shown.'
        : detail.reason === 'link'
          ? 'Symbolic links are not followed.'
          : detail.reason === 'folder'
            ? 'A nested repository or folder changed.'
            : 'Assets aren’t diffed — only the file type is shown.';
  const delta = detail.oldSize != null && detail.newSize != null ? detail.newSize - detail.oldSize : null;
  return (
    <div className="asset-card">
      <div className={`asset-glyph cat-${detail.category}`}>
        <FileIcon category={detail.category} size={44} />
      </div>
      <div className="asset-type">{detail.type}</div>
      <div className="asset-status">{statusText}</div>
      <p className="asset-reason">{reason}</p>
      <div className="asset-sizes">
        <div>
          <span className="label">{detail.oldLabel}</span>
          <span className="value">{detail.oldExists ? bytes(detail.oldSize) : 'none'}</span>
        </div>
        <ArrowRight size={16} className="asset-arrow" />
        <div>
          <span className="label">{detail.newLabel}</span>
          <span className="value">{detail.newExists ? bytes(detail.newSize) : 'none'}</span>
        </div>
        {delta != null && delta !== 0 ? (
          <span className={`asset-delta ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? '+' : '−'}{bytes(Math.abs(delta))}</span>
        ) : null}
      </div>
    </div>
  );
}

export function DiffBody({ detail, prefs, themeVersion }: { detail: Detail; prefs: Prefs; themeVersion: number }) {
  const [expanded, setExpanded] = useState(false);
  const [tokens, setTokens] = useState<{ old: TokenLines | null; new: TokenLines | null }>({ old: null, new: null });

  useEffect(() => setExpanded(false), [detail]);

  const oldText = detail.oldText ?? '';
  const newText = detail.newText ?? '';
  const model = useMemo(
    () => (detail.kind === 'text' ? buildDiff(oldText, newText, expanded ? FULL : prefs.context, prefs.ignoreWhitespace) : null),
    [detail, oldText, newText, expanded, prefs.context, prefs.ignoreWhitespace],
  );

  useEffect(() => {
    if (detail.kind !== 'text') return;
    let cancelled = false;
    setTokens({ old: null, new: null });
    Promise.all([tokenize(oldText, detail.language), tokenize(newText, detail.language)]).then(([o, n]) => {
      if (!cancelled) setTokens({ old: o, new: n });
    });
    return () => {
      cancelled = true;
    };
  }, [detail, oldText, newText, themeVersion]);

  if (detail.kind === 'complex') return <AssetCard detail={detail} />;
  if (!model) return null;

  if (detail.oldText === null) {
    return (
      <div className="diff-note">
        The baseline for this folder did not keep a copy of this file, so only its current content is known.
      </div>
    );
  }
  if (model.identical) {
    return <div className="diff-note">No content differences{prefs.ignoreWhitespace ? ' (whitespace ignored)' : ''}. Only file metadata changed.</div>;
  }

  const expand = () => setExpanded(true);
  // A file that exists on only one side has nothing to compare against: one column reads better.
  const split = prefs.diffView === 'split' && detail.oldExists && detail.newExists;

  return (
    <div className={`diff ${split ? 'split' : 'unified'} ${prefs.wrap ? 'wrap' : ''}`} style={{ fontSize: prefs.codeSize }}>
      {expanded && prefs.context < FULL ? (
        <button className="gap collapse" onClick={() => setExpanded(false)}>
          <FoldVertical size={13} /> <span>Collapse unchanged lines</span>
        </button>
      ) : null}
      {model.hunks.map((hunk, hi) => (
        <section className="hunk" key={hi}>
          <Gap count={hunk.gapBefore} onExpand={expand} />
          {!expanded ? (
            <div className="hunk-head">
              @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
            </div>
          ) : null}
          {split
            ? toSplit(hunk.lines).map((row, ri) => (
                <div className="row" key={ri}>
                  <div className={`cell ${row.left ? row.left.kind : 'empty'}`}>
                    <span className="ln">{row.left?.oldNo ?? ''}</span>
                    <span className="sign">{row.left?.kind === 'del' ? '−' : ''}</span>
                    {row.left ? <Code line={row.left} tokens={tokens.old} side="old" /> : <span className="code" />}
                  </div>
                  <div className={`cell ${row.right ? row.right.kind : 'empty'}`}>
                    <span className="ln">{row.right?.newNo ?? ''}</span>
                    <span className="sign">{row.right?.kind === 'add' ? '+' : ''}</span>
                    {row.right ? <Code line={row.right} tokens={tokens.new} side="new" /> : <span className="code" />}
                  </div>
                </div>
              ))
            : hunk.lines.map((line, li) => (
                <div className={`row ${line.kind}`} key={li}>
                  <span className="ln">{line.oldNo ?? ''}</span>
                  <span className="ln">{line.newNo ?? ''}</span>
                  <span className="sign">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span>
                  <Code line={line} tokens={line.kind === 'del' ? tokens.old : tokens.new} side={line.kind === 'del' ? 'old' : 'new'} />
                </div>
              ))}
        </section>
      ))}
      <Gap count={model.gapAfter} onExpand={expand} />
    </div>
  );
}

export function DiffLoading() {
  return (
    <div className="pane-center muted">
      <Spinner size={18} />
    </div>
  );
}
