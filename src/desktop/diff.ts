// Line diffs for "what the agent changed", built from the text the agent's
// own edit tools carry (never by reading the disk). An Edit gives a snippet
// before and after; a Write gives only the new file, so all its lines count
// as added. Big inputs are counted but not diffed, so a huge Write can't
// stall the app.

export interface DiffLine {
  t: " " | "+" | "-";
  s: string;
}

/** One file's changes in a task. `hunks` are groups of lines with a little context. */
export interface Change {
  path: string;
  add: number;
  del: number;
  hunks: DiffLine[][];
  /** Counts are exact, but some lines are left out of `hunks`. */
  truncated?: boolean;
}

/** Past this many lines on either side, only the counts are kept. */
const MAX_LINES = 4000;
/** Size of the comparison table; past this, only the counts are kept. */
const MAX_CELLS = 1_000_000;
/** Lines of unchanged text kept around each change. */
const CONTEXT = 3;
/** Diff lines kept per file, across all its edits in a task. */
export const MAX_KEPT_LINES = 400;
/** Characters kept per line. */
const MAX_LINE_CHARS = 300;

const lines = (text: string): string[] => (text === "" ? [] : text.replace(/\r\n/g, "\n").split("\n"));

type Op = DiffLine;

/** The edit from `before` to `after` as one list of kept, removed and added lines. */
function ops(before: string[], after: string[]): { ops: Op[]; exact: boolean } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
    endB--;
    endA--;
  }
  const head: Op[] = before.slice(0, start).map((s) => ({ t: " ", s }));
  const tail: Op[] = before.slice(endB).map((s) => ({ t: " ", s }));
  const a = before.slice(start, endB);
  const b = after.slice(start, endA);

  if (a.length > MAX_LINES || b.length > MAX_LINES || a.length * b.length > MAX_CELLS) {
    // Too big to compare line by line: everything between is a change.
    return { ops: [...head, ...a.map((s): Op => ({ t: "-", s })), ...b.map((s): Op => ({ t: "+", s })), ...tail], exact: false };
  }

  // Longest common subsequence of the middle.
  const w = b.length + 1;
  const table = new Uint16Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * w + j] = a[i] === b[j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
    }
  }
  const mid: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      mid.push({ t: " ", s: a[i] });
      i++;
      j++;
    } else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) {
      mid.push({ t: "-", s: a[i++] });
    } else {
      mid.push({ t: "+", s: b[j++] });
    }
  }
  while (i < a.length) mid.push({ t: "-", s: a[i++] });
  while (j < b.length) mid.push({ t: "+", s: b[j++] });
  return { ops: [...head, ...mid, ...tail], exact: true };
}

export interface TextDiff {
  add: number;
  del: number;
  hunks: DiffLine[][];
  truncated: boolean;
}

/** Diff of one edit. `before` is null for a whole-file write (nothing known about the old file). */
export function diffText(before: string | null, after: string): TextDiff {
  const { ops: all, exact } = ops(before === null ? [] : lines(before), lines(after));
  let add = 0;
  let del = 0;
  for (const o of all) {
    if (o.t === "+") add++;
    else if (o.t === "-") del++;
  }

  // Keep each change with CONTEXT lines around it; start a new hunk after a gap.
  const keep = new Array<boolean>(all.length).fill(false);
  all.forEach((o, idx) => {
    if (o.t === " ") return;
    for (let k = Math.max(0, idx - CONTEXT); k <= Math.min(all.length - 1, idx + CONTEXT); k++) keep[k] = true;
  });
  const hunks: DiffLine[][] = [];
  let current: DiffLine[] | null = null;
  let kept = 0;
  let truncated = !exact;
  for (let idx = 0; idx < all.length; idx++) {
    if (!keep[idx]) {
      current = null;
      continue;
    }
    if (kept >= MAX_KEPT_LINES) {
      truncated = true;
      break;
    }
    if (!current) hunks.push((current = []));
    const o = all[idx];
    current.push({ t: o.t, s: o.s.length > MAX_LINE_CHARS ? `${o.s.slice(0, MAX_LINE_CHARS - 1)}…` : o.s });
    kept++;
  }
  return { add, del, hunks: exact ? hunks : [], truncated };
}

/** Adds one more edit of the same file to its change (several edits in a task add up). */
export function addToChange(change: Change, d: TextDiff): void {
  change.add += d.add;
  change.del += d.del;
  const room = MAX_KEPT_LINES - change.hunks.reduce((n, h) => n + h.length, 0);
  if (d.truncated) change.truncated = true;
  let left = room;
  for (const h of d.hunks) {
    if (left <= 0) {
      change.truncated = true;
      break;
    }
    const part = h.slice(0, left);
    if (part.length < h.length) change.truncated = true;
    change.hunks.push(part);
    left -= part.length;
  }
}
