/**
 * Minimal line diff.
 *
 * Used to show what a compile actually changed, because "here is a better
 * prompt" is not reviewable and a diff is. Dependency-free LCS; the input is a
 * prompt, so quadratic tables are fine up to a generous cap.
 *
 * @module prompt-funnel/diff
 */

/** One line of a diff. */
export interface DiffLine {
  kind: 'same' | 'add' | 'del';
  text: string;
}

const MAX_LINES = 800;

/** Longest-common-subsequence line diff. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      ...a.map((text): DiffLine => ({ kind: 'del', text })),
      ...b.map((text): DiffLine => ({ kind: 'add', text })),
    ];
  }

  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = table[i] as number[];
      const next = table[i + 1] as number[];
      row[j] =
        a[i] === b[j] ? (next[j + 1] as number) + 1 : Math.max(next[j] as number, row[j + 1] as number);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] as string });
      i += 1;
      j += 1;
      continue;
    }
    const down = (table[i + 1] as number[])[j] as number;
    const right = (table[i] as number[])[j + 1] as number;
    if (down >= right) {
      out.push({ kind: 'del', text: a[i] as string });
      i += 1;
    } else {
      out.push({ kind: 'add', text: b[j] as string });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ kind: 'del', text: a[i] as string });
    i += 1;
  }
  while (j < b.length) {
    out.push({ kind: 'add', text: b[j] as string });
    j += 1;
  }
  return out;
}

/** Render a diff for a terminal, collapsing unchanged runs. */
export function formatDiff(diff: DiffLine[], context = 2): string {
  const lines: string[] = [];
  let skip = 0;
  for (let index = 0; index < diff.length; index += 1) {
    const entry = diff[index] as DiffLine;
    if (entry.kind === 'same') {
      // Keep a small window of context around every change.
      const nearChange = diff
        .slice(Math.max(0, index - context), index + context + 1)
        .some((neighbour) => neighbour.kind !== 'same');
      if (!nearChange) {
        skip += 1;
        continue;
      }
      if (skip > 0) {
        lines.push(`  … ${skip} 行未变 …`);
        skip = 0;
      }
      lines.push(`  ${entry.text}`);
      continue;
    }
    lines.push(`${entry.kind === 'add' ? '+ ' : '- '}${entry.text}`);
  }
  if (skip > 0) lines.push(`  … ${skip} 行未变 …`);
  return lines.join('\n');
}
