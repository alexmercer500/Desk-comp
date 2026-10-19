export type BubbleKind = "attention" | "success" | "error" | "info";

/** What a notification is about, so Settings can switch each kind off. */
export type BubbleCategory =
  | "agent-done" | "agent-permission" | "agent-waiting" | "agent-error" | "agent-working"
  | "break" | "battery" | "download" | "welcome"
  /** Answers to something the user just did (tray actions): always shown. */
  | "notice";

/** One of Claude Code's multiple-choice questions (AskUserQuestion). */
export interface Question {
  question: string;
  header?: string | null;
  multiSelect: boolean;
  options: { label: string; description?: string | null }[];
}

/** One busy agent session, as a line of the "what's going on" card. */
export interface BubbleRow {
  tone: "working" | "attention";
  project: string;
  line: string;
}

export interface BubbleMessage {
  category?: BubbleCategory;
  /** Offer "Always" next to Allow (the agent suggested a rule for it). */
  always?: boolean;
  /** Questions to answer with buttons, instead of Allow / Deny. */
  questions?: Question[];
  /** Clicking opens this instead of the activity panel. */
  action?: "settings";
  /** Lets the sender close this particular bubble later (e.g. once a permission is answered). */
  id: string;
  title: string;
  text: string;
  kind: BubbleKind;
  /** Small line under the text: duration, counts. */
  meta?: string;
  /** A longer block: the exact command (mono) or the agent's summary. */
  detail?: string;
  mono?: boolean;
  /** Agent session this is about; clicking the bubble opens the panel on it. */
  session?: string;
  /** The label of the button that leaves the answer to the agent itself ("In Command Code"); "In terminal" if not given. */
  elsewhere?: string;
  /** A permission request id: the bubble shows Allow / Deny for it. */
  request?: string;
  /** Stays until clicked or closed by id, instead of fading after a few seconds. */
  sticky?: boolean;
  /** Busy sessions, one line each (the "what's going on" card). */
  rows?: BubbleRow[];
  /** How long it stays up, ms, if not the usual (6 s, or 9 s with a detail). */
  ms?: number;
}

/** How long a card that isn't sticky stays up: longer when there's more to read. */
export function showFor(msg: BubbleMessage): number {
  return msg.ms ?? (msg.detail ? 9000 : 6000);
}
