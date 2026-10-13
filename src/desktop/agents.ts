// Coding-agent sessions → what the character does, what the bubble says, and
// what the activity panel shows.
//
// Events come from the companion-hook relay (one per agent hook call). Several
// sessions can run at once: the character works while any of them is busy,
// asks for attention when one needs a permission, and celebrates when the
// last busy one finishes. Each session keeps its current task (the prompt,
// a timeline of steps, files edited, commands run), a pending permission if
// any, and its last few finished tasks with the agent's own summary.

import type { BubbleMessage, Question } from "../bubble/types";
import { baseName, dotted, elapsed, firstLine, plainText, plural, relativeTo } from "./format";

/** One hook event, as the relay summarises it. */
export interface AgentEvent {
  agent: string;
  event: string | null;
  session: string | null;
  cwd: string | null;
  tool: string | null;
  detail: string | null;
  message: string | null;
  kind: string | null;
  prompt?: string | null;
  error?: string | null;
  /** The agent's last reply, read by the app from the local transcript on Stop. */
  summary?: string | null;
  /** Set on a permission request the relay is holding open for the user's Allow or Deny. */
  rid?: string | null;
  /** The agent suggested a rule for "always allow this". */
  canAlways?: boolean;
  /** Claude Code asking a multiple-choice question (with `rid`, answerable from here). */
  questions?: Question[] | null;
  /** The relay's parent processes, nearest first: the agent's window is among them. */
  procs?: number[] | null;
}

export type Decision = "allow" | "always" | "deny" | "terminal";

/** The parts of the character controller this module drives. */
export interface CharacterSink {
  startWork(opts: { timeoutMs: number | null }): void;
  finishWork(result: { confidence: number; error?: boolean }): void;
  cancelWork(): void;
  notify(): void;
  getState(): string;
}

export interface BubbleSink {
  show(msg: BubbleMessage): void;
  hide(id: string): void;
}

export type Status = "idle" | "working" | "waiting" | "ended";

export interface Step {
  tool: string;
  detail: string | null;
  at: number;
  failed?: boolean;
}

export interface Turn {
  prompt: string | null;
  startedAt: number;
  endedAt: number | null;
  steps: Step[];
  /** Files edited or written, relative to the project. */
  files: string[];
  commands: number;
  summary: string | null;
  outcome: "working" | "done" | "error" | "cancelled";
}

export interface Permission {
  tool: string;
  /** "run", "edit", "use WebFetch" … */
  action: string;
  detail: string | null;
  since: number;
  /** Request id while Allow / Deny can still be sent; null once only the terminal can answer. */
  rid: string | null;
  /** "Always" can be offered: the agent suggested a rule for it. */
  canAlways: boolean;
  /** A question rather than a permission: answered by picking options. */
  questions: Question[] | null;
}

/** What the panel shows for one session. */
export interface SessionView {
  id: string;
  agent: string;
  project: string;
  cwd: string | null;
  status: Status;
  permission: Permission | null;
  current: Turn | null;
  history: Turn[];
  lastEvent: number;
  /** The relay's parent processes, for bringing the session's window forward. */
  procs: number[];
}

/** Today's totals, for the summary line at the top of the activity view. */
export interface DayStats {
  /** Local date, YYYY-MM-DD. */
  date: string;
  done: number;
  failed: number;
  /** Times an agent waited for the user (permissions and questions). */
  asks: number;
  /** Time agents spent on tasks that ended today. */
  workMs: number;
}

/** Where the day's totals are kept between runs. */
export interface StatsStore {
  load(): DayStats | null;
  save(stats: DayStats): void;
}

export const localDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** A busy session that goes quiet this long is assumed gone (crashed, killed). */
const STALE_MS = 10 * 60_000;
/** Ended sessions stay in the panel this long. */
const KEEP_ENDED_MS = 30 * 60_000;
/** While a permission is pending, nudge again this often, at most MAX_NUDGES times. */
const NUDGE_EVERY_MS = 45_000;
const MAX_NUDGES = 3;
/** After a finish, an "idle prompt" notification within this window is redundant. */
const QUIET_AFTER_FINISH_MS = 90_000;
/** Steps kept per task, finished tasks kept per session. */
const MAX_STEPS = 40;
const MAX_HISTORY = 5;

export const AGENT_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  copilot: "Copilot CLI",
  gemini: "Gemini CLI",
  commandcode: "Command Code",
  cursor: "Cursor",
  antigravity: "Antigravity",
  vscode: "VS Code",
};

const EDIT_TOOLS = /^(Edit|MultiEdit|Write|NotebookEdit)$/;
// A failed tool call (a search with no match, a failing test) is part of normal
// work; only StopFailure means the turn itself failed.
// ToolUsed: a step reported once it's done (Antigravity), failed if it carries an error.
const WORK_EVENTS = new Set(["UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "SubagentStart", "ToolUsed"]);

interface Session extends SessionView {
  finishedAt: number;
  nudgedAt: number;
  nudges: number;
}

export class AgentTracker {
  private sessions = new Map<string, Session>();
  /** Called whenever anything the panel shows changes. */
  onChange: (() => void) | null = null;

  private stats: DayStats;

  constructor(
    private character: CharacterSink,
    private bubble: BubbleSink,
    private now: () => number = () => Date.now(),
    private store: StatsStore | null = null,
  ) {
    const saved = store?.load();
    this.stats = saved && saved.date === localDate(this.now()) ? saved : emptyDay(this.now());
  }

  /** Today's totals so far. */
  today(): DayStats {
    this.rollOver();
    return { ...this.stats };
  }

  private rollOver() {
    const date = localDate(this.now());
    if (this.stats.date !== date) this.stats = emptyDay(this.now());
  }

  private count(change: (s: DayStats) => void) {
    this.rollOver();
    change(this.stats);
    this.store?.save(this.stats);
  }

  /** The user answered a question from the companion. */
  answered(rid: string): boolean {
    const found = this.byRequest(rid);
    if (!found) return false;
    const [id, s] = found;
    this.clearPermission(id, s);
    this.setStatus(s, "working");
    this.onChange?.();
    return true;
  }

  handle(e: AgentEvent) {
    this.apply(e);
    this.onChange?.();
  }

  /** Call every few seconds: re-nudges pending permissions and drops sessions that went silent. */
  sweep() {
    const now = this.now();
    let changed = false;
    for (const [id, s] of this.sessions) {
      if (s.status === "waiting" && s.nudges < MAX_NUDGES && now - s.nudgedAt >= NUDGE_EVERY_MS) {
        s.nudges++;
        s.nudgedAt = now;
        this.character.notify();
      }
      if ((s.status === "working" || s.status === "waiting") && now - s.lastEvent > STALE_MS) {
        this.clearPermission(id, s);
        this.endTurn(s, "cancelled");
        s.status = "idle";
        changed = true;
      }
      if (s.status === "ended" && now - s.lastEvent > KEEP_ENDED_MS) {
        this.sessions.delete(id);
        changed = true;
      }
    }
    if (!this.anyBusy() && this.character.getState() === "WORKING") this.character.cancelWork();
    if (changed) this.onChange?.();
  }

  /**
   * The user clicked Allow, Deny or "In terminal" for request `rid`. Returns
   * false if that request isn't waiting any more (nothing to send).
   */
  answer(rid: string, decision: Decision): boolean {
    const found = this.byRequest(rid);
    if (!found) return false;
    const [id, s] = found;
    if (decision === "terminal") {
      // Hand it back to the terminal: keep the details, drop the buttons.
      s.permission!.rid = null;
      this.showPermission(id, s);
    } else {
      this.clearPermission(id, s);
      this.setStatus(s, "working");
    }
    this.onChange?.();
    return true;
  }

  /** The relay stopped waiting (answered in the terminal, or timed out). */
  permissionClosed(rid: string) {
    const found = this.byRequest(rid);
    if (!found) return;
    const [id, s] = found;
    s.permission!.rid = null;
    this.showPermission(id, s);
    this.onChange?.();
  }

  private byRequest(rid: string): [string, Session] | null {
    for (const [id, s] of this.sessions) if (s.permission?.rid === rid) return [id, s];
    return null;
  }

  busyCount() {
    let n = 0;
    for (const s of this.sessions.values()) if (s.status === "working" || s.status === "waiting") n++;
    return n;
  }

  /** Sessions for the panel: waiting first, then working, then most recent. */
  snapshot(): SessionView[] {
    const rank: Record<Status, number> = { waiting: 0, working: 1, idle: 2, ended: 3 };
    return [...this.sessions.values()]
      .sort((a, b) => rank[a.status] - rank[b.status] || b.lastEvent - a.lastEvent)
      .map(({ finishedAt: _f, nudgedAt: _n, nudges: _c, ...view }) => structuredClone(view));
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  private apply(e: AgentEvent) {
    const name = e.event ?? "";
    const id = e.session ?? `${e.agent}:${e.cwd ?? "?"}`;
    // Nothing to say about a session we never saw.
    if (name === "SessionEnd" && !this.sessions.has(id)) return;
    const s = this.session(id, e);
    const now = this.now();
    s.lastEvent = now;
    if (e.procs?.length) s.procs = e.procs;

    // Claude Code asking a question: a step, and the user's turn to answer.
    if (name === "PreToolUse" && e.tool === "AskUserQuestion" && e.questions?.length) {
      const turn = (s.current ??= newTurn(null, now));
      this.recordStep(s, turn, e, now);
      this.askPermission(id, s, e);
      return;
    }

    if (WORK_EVENTS.has(name)) {
      // A new prompt starts a new task. Without the prompt's text (Antigravity
      // says only that the agent is starting again) a task still under way goes on.
      const continues = !e.prompt && s.current && (s.status === "working" || s.status === "waiting");
      if (name === "UserPromptSubmit" && !continues) {
        if (s.current) this.endTurn(s, "cancelled");
        s.current = newTurn(e.prompt ?? null, now);
      }
      const turn = (s.current ??= newTurn(null, now));
      if ((name === "PreToolUse" || name === "ToolUsed") && e.tool) this.recordStep(s, turn, e, now);
      if (name === "ToolUsed" && e.tool && e.error) turn.steps[turn.steps.length - 1].failed = true;
      if (name === "PostToolUseFailure") {
        const last = [...turn.steps].reverse().find((st) => st.tool === e.tool);
        if (last) last.failed = true;
      }
      this.clearPermission(id, s);
      this.setStatus(s, "working");
      return;
    }

    switch (name) {
      case "PermissionRequest":
        this.askPermission(id, s, e);
        return;

      case "Notification": {
        const msg = e.message ?? "";
        if (e.kind === "permission_prompt" || /permission/i.test(msg)) {
          if (s.status !== "waiting") this.askPermission(id, s, e);
        } else if (e.kind === "idle_prompt" || /waiting for your input/i.test(msg)) {
          if (now - s.finishedAt > QUIET_AFTER_FINISH_MS) {
            this.say(id, s, { kind: "info", category: "agent-waiting", text: "Waiting for your next message" });
          }
        } else if (msg) {
          this.say(id, s, { kind: "info", category: "agent-waiting", text: msg });
        }
        return;
      }

      // The agent's reply, sent just before it stops (Cursor).
      case "AgentResponse":
        if (s.current && e.summary) s.current.summary = plainText(e.summary);
        return;

      case "Stop": {
        const turn = s.current;
        const wasBusy = s.status === "working" || s.status === "waiting";
        this.clearPermission(id, s);
        s.status = "idle";
        s.finishedAt = now;
        if (!turn) return;
        if (e.summary) turn.summary = plainText(e.summary);
        this.endTurn(s, "done");
        if (!wasBusy) return;
        this.say(id, s, {
          kind: "success",
          category: "agent-done",
          text: turn.prompt ? `Done: ${firstLine(turn.prompt, 70)}` : "Done",
          meta: turnMeta(turn),
          detail: turn.summary ? firstLine(turn.summary.replace(/\s+/g, " "), 220) : undefined,
        });
        if (!this.anyBusy()) this.character.finishWork({ confidence: 1 });
        return;
      }

      case "StopFailure":
        this.fail(id, s, e.error ?? e.message ?? null);
        return;

      // Stopped by the user (Esc in Codex, an interrupted or refused run in Command Code):
      // the turn ends quietly, no "done" and no error.
      case "Interrupt":
        this.clearPermission(id, s);
        if (s.current) {
          s.current.summary = e.message ?? null;
          this.endTurn(s, "cancelled");
        }
        s.status = "idle";
        s.finishedAt = now;
        if (!this.anyBusy()) this.character.cancelWork();
        return;

      case "SessionEnd":
        this.clearPermission(id, s);
        this.endTurn(s, "cancelled");
        s.status = "ended";
        // Keep it listed only if there's something to look back at.
        if (s.history.length === 0) this.sessions.delete(id);
        if (!this.anyBusy()) this.character.cancelWork();
        return;

      default:
        // Other agents' failure events, whatever they call them.
        if (/fail|error/i.test(name)) this.fail(id, s, e.error ?? e.message ?? null);
    }
  }

  private fail(id: string, s: Session, reason: string | null) {
    this.clearPermission(id, s);
    const turn = s.current;
    if (turn) turn.summary = reason;
    this.endTurn(s, "error");
    s.status = "idle";
    s.finishedAt = this.now();
    this.say(id, s, { kind: "error", category: "agent-error", text: "Stopped with an error", detail: reason ?? undefined });
    if (!this.anyBusy()) this.character.finishWork({ confidence: 0, error: true });
  }

  private recordStep(s: Session, turn: Turn, e: AgentEvent, now: number) {
    const tool = e.tool!;
    // Any path inside the project reads better relative to it; commands are left alone.
    const detail = e.detail && tool !== "Bash" ? relativeTo(s.cwd, e.detail) : e.detail;
    turn.steps.push({ tool, detail, at: now });
    if (turn.steps.length > MAX_STEPS) turn.steps.shift();
    if (EDIT_TOOLS.test(tool) && detail && !turn.files.includes(detail)) turn.files.push(detail);
    if (tool === "Bash") turn.commands++;
  }

  private askPermission(id: string, s: Session, e: AgentEvent) {
    const wasAnyBusy = this.anyBusy();
    const tool = e.tool ?? "a tool";
    const detail = e.detail ? (tool !== "Bash" ? relativeTo(s.cwd, e.detail) : e.detail) : null;
    // A Notification about a request we already hold keeps its buttons.
    const rid = e.rid ?? (s.permission?.tool === tool ? s.permission.rid : null);
    const questions = e.questions?.length ? e.questions : null;
    const canAlways = Boolean(e.canAlways ?? (s.permission?.tool === tool && s.permission.canAlways));
    if (s.status !== "waiting") this.count((d) => d.asks++);
    s.permission = { tool, action: permissionAction(tool), detail: questions ? null : detail, since: this.now(), rid, canAlways, questions };
    s.current ??= newTurn(null, this.now());
    s.status = "waiting";
    s.nudges = 0;
    s.nudgedAt = this.now();
    // Waiting still counts as busy, so the character keeps working once the nudge ends.
    if (!wasAnyBusy) this.character.startWork({ timeoutMs: null });
    this.character.notify();
    this.showPermission(id, s, e.message);
  }

  private showPermission(id: string, s: Session, message?: string | null) {
    const p = s.permission!;
    if (p.questions) {
      this.bubble.show({
        id: permissionId(id),
        category: "agent-permission",
        session: id,
        title: this.titleFor(s),
        kind: "attention",
        sticky: true,
        text: p.questions.length > 1 ? "Has a few questions for you:" : "Has a question for you:",
        questions: p.rid ? p.questions : undefined,
        detail: p.rid ? undefined : p.questions.map((q) => q.question).join("\n"),
        meta: p.rid ? undefined : "Answer in your terminal",
        request: p.rid ?? undefined,
      });
      return;
    }
    this.bubble.show({
      id: permissionId(id),
      category: "agent-permission",
      session: id,
      title: this.titleFor(s),
      kind: "attention",
      sticky: true,
      text: p.detail ? `Needs your OK to ${p.action}:` : (message || `Needs your OK to ${p.action}`),
      detail: p.detail ?? undefined,
      mono: !!p.detail,
      meta: p.rid ? undefined : "Answer in your terminal",
      request: p.rid ?? undefined,
      always: p.rid ? p.canAlways : undefined,
    });
  }

  private clearPermission(id: string, s: Session) {
    if (s.status === "waiting" || s.permission) this.bubble.hide(permissionId(id));
    s.permission = null;
  }

  private endTurn(s: Session, outcome: Turn["outcome"]) {
    const turn = s.current;
    if (!turn) return;
    turn.endedAt = this.now();
    turn.outcome = outcome;
    if (outcome === "done" || outcome === "error") {
      const took = turn.endedAt - turn.startedAt;
      this.count((d) => {
        if (outcome === "done") d.done++;
        else d.failed++;
        d.workMs += took;
      });
    }
    // A turn that did nothing visible isn't worth keeping.
    if (turn.prompt || turn.steps.length || turn.summary) {
      s.history.unshift(turn);
      if (s.history.length > MAX_HISTORY) s.history.pop();
    }
    s.current = null;
  }

  private session(id: string, e: AgentEvent): Session {
    let s = this.sessions.get(id);
    if (!s) {
      s = {
        id,
        agent: e.agent,
        project: baseName(e.cwd),
        cwd: e.cwd,
        status: "idle",
        permission: null,
        current: null,
        history: [],
        lastEvent: 0,
        procs: [],
        finishedAt: -Infinity,
        nudgedAt: 0,
        nudges: 0,
      };
      this.sessions.set(id, s);
    } else if (e.cwd) {
      s.cwd = e.cwd;
      s.project = baseName(e.cwd);
    }
    if (s.status === "ended" && e.event !== "SessionEnd") s.status = "idle";
    return s;
  }

  private setStatus(s: Session, status: Status) {
    const wasAnyBusy = this.anyBusy();
    s.status = status;
    if (status === "working" && !wasAnyBusy) this.character.startWork({ timeoutMs: null });
  }

  private say(id: string, s: Session, msg: Omit<BubbleMessage, "id" | "title" | "session">) {
    this.bubble.show({ id: `${msg.kind}:${id}`, session: id, title: this.titleFor(s), ...msg });
  }

  private titleFor(s: Session) {
    const agent = AGENT_NAMES[s.agent] ?? s.agent;
    return s.project ? `${agent} · ${s.project}` : agent;
  }

  private anyBusy() {
    return this.busyCount() > 0;
  }
}

const permissionId = (session: string) => `permission:${session}`;

const newTurn = (prompt: string | null, now: number): Turn => ({
  prompt, startedAt: now, endedAt: null, steps: [], files: [], commands: 0, summary: null, outcome: "working",
});

const emptyDay = (now: number): DayStats => ({ date: localDate(now), done: 0, failed: 0, asks: 0, workMs: 0 });

function permissionAction(tool: string): string {
  if (tool === "AskUserQuestion") return "ask you";
  if (tool === "Bash") return "run";
  if (EDIT_TOOLS.test(tool)) return "edit";
  if (tool === "WebFetch") return "open";
  return `use ${tool}`;
}

/** "2m 14s · 3 files edited · 2 commands" */
export function turnMeta(t: Turn): string {
  const took = t.endedAt !== null ? elapsed(t.endedAt - t.startedAt) : null;
  return dotted(
    took,
    t.files.length > 0 && `${plural(t.files.length, "file")} edited`,
    t.commands > 0 && plural(t.commands, "command"),
    t.files.length === 0 && t.commands === 0 && t.steps.length > 0 && plural(t.steps.length, "step"),
  );
}

/** Present-tense line for what a step is doing, e.g. "Editing cart.ts". */
export function describeStep(step: Step): string {
  const d = step.detail ? firstLine(step.detail, 60) : "";
  const file = baseName(step.detail);
  switch (step.tool) {
    case "Read": return `Reading ${file}`;
    case "Edit": case "MultiEdit": return `Editing ${file}`;
    case "Write": return `Writing ${file}`;
    case "NotebookEdit": return `Editing ${file}`;
    case "Bash": return d ? `Running ${d}` : "Running a command";
    case "Grep": return d ? `Searching for ${d}` : "Searching";
    case "Glob": return d ? `Finding ${d}` : "Finding files";
    case "WebFetch": return d ? `Opening ${d}` : "Opening a page";
    case "WebSearch": return d ? `Searching the web: ${d}` : "Searching the web";
    case "Task": case "Agent": return d ? `Delegating: ${d}` : "Delegating to a subagent";
    case "TodoWrite": return "Updating the plan";
    case "AskUserQuestion": return "Asking you a question";
    default: return d ? `${step.tool}: ${d}` : step.tool;
  }
}
