// Small text helpers shared by the bubble, the panel and the trackers.

/** "50 minutes", "1 hour", "2 h 5 min" — for spoken-style sentences. */
export function duration(secs: number): string {
  const mins = Math.max(1, Math.round(secs / 60));
  if (mins < 60) return mins === 1 ? "1 minute" : `${mins} minutes`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h} h ${m} min`;
}

/** "8s", "2m 14s", "1h 3m" — compact elapsed time for meta lines. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** "just now", "3 min ago", "2 h ago". */
export function ago(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ago`;
}

/** Last path segment, for either slash. */
export function baseName(path: string | null | undefined): string {
  if (!path) return "";
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** A path shown relative to the project folder when it's inside it. */
export function relativeTo(cwd: string | null, path: string): string {
  if (!cwd) return path;
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = norm(cwd);
  const p = norm(path);
  return p.toLowerCase().startsWith(base.toLowerCase() + "/") ? p.slice(base.length + 1) : path;
}

/** First line of a text, shortened to `max` characters. */
export function firstLine(text: string | null | undefined, max = 90): string {
  const line = (text ?? "").trim().split(/\r?\n/)[0] ?? "";
  return line.length > max ? line.slice(0, max - 1).trimEnd() + "…" : line;
}

/** Joins the non-empty parts with " · ". */
export const dotted = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" · ");

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** An agent's markdown reply as plain text: the words, without the markup. */
export function plainText(md: string): string {
  return md
    .replace(/^\s*```.*$/gm, "") // code fences
    .replace(/^\s*\|?\s*:?-{3,}[-:|\s]*$/gm, "") // table rules
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/^\s*>\s?/gm, "") // quotes
    .replace(/^(\s*)[-*+]\s+/gm, "$1• ") // bullets
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links, images
    .replace(/(\*\*|__)(.+?)\1/g, "$2") // bold
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2") // italics
    .replace(/`([^`\n]+)`/g, "$1") // inline code
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
