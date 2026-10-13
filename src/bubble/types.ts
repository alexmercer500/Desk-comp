export type BubbleKind = "attention" | "success" | "error" | "info";

/** What a notification is about, so Settings can switch each kind off. */
export type BubbleCategory =
  | "agent-done" | "agent-permission" | "agent-waiting" | "agent-error"
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
  /** A permission request id: the bubble shows Allow / Deny for it. */
  request?: string;
  /** Stays until clicked or closed by id, instead of fading after a few seconds. */
  sticky?: boolean;
}
