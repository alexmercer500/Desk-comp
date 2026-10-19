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
import { addToChange, diffText, type Change } from "./diff";
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
  /** The agent's permission mode ("default", "plan", "auto-accept" …), where it says. */
  mode?: string | null;
  prompt?: string | null;
  error?: string | null;
  /** The agent's last reply, read by the app from the local transcript on Stop. */
  summary?: string | null;
  /** Set on a permission request the relay is holding open for the user's Allow or Deny. */
  rid?: string | null;
  /** The agent suggested a rule for "always allow this". */
  canAlways?: boolean;
  /** That rule, in words ("allow Bash(npm run lint) in this project"). */
  alwaysRule?: string | null;
  /** A permission's whole input (the command and every field), shown before Allow. */
  input?: string | null;
  /** The input was too long to show whole: Deny or the terminal only. */
  cut?: boolean;
  /** Short enough for a phone to show whole, so it may allow it (the app works it out). */
  phoneOk?: boolean;
  /** Claude Code asking a multiple-choice question (with `rid`, answerable from here). */
  questions?: Question[] | null;
  /** The relay's parent processes, nearest first: the agent's window is among them. */
  procs?: number[] | null;
  /** What an edit tool changed (sent after it ran): `old` is null for a whole-file write. */
  edits?: { old: string | null; new: string }[] | null;
}

export type Decision = "allow" | "always" | "deny" | "terminal";

/** The parts of the character controller this module drives. */
export interface CharacterSink {
  startWork(opts: { timeoutMs: number | null }): void;
  finishWork(result: { confidence: number; error?: boolean }): void;
  /** One task's result while other agents are still busy: a reaction, then back to work. */
  interlude(result: { confidence: number; error?: boolean }): void;
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
  /** The same files with their line changes, for the diff view. */
  changes: Change[];
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
  /** What "Always" adds, in words. */
  alwaysRule: string | null;
  /** Everything it will run, as shown on the card; null when the agent sent only `detail`. */
  input: string | null;
  /** Too long to show whole: it can't be allowed from here (Deny, or the terminal). */
  cut: boolean;
  /** A phone may allow it (it gets the whole of it). */
  phoneOk: boolean;
  /** The tool and its detail as the relay sent them: a later step matching it means it was answered there. */
  key: string;
  /** A question rather than a permission: answered by picking options. */
  questions: Question[] | null;
  /** What it's waiting for, when that's more than a question or a permission ("Plan ready for review"). */
  headline: string | null;
  /** Where to answer when it can't be answered from here: "your terminal", "Command Code". */
  where: string;
}

/** What the panel shows for one session. */
export interface SessionView {
  id: string;
  agent: string;
  project: string;
  cwd: string | null;
  status: Status;
  /** The request on the card, oldest first. */
  permission: Permission | null;
  /** More requests from the same session (parallel tools, subagents), each still waiting, next first. */
  queued: Permission[];
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
/** A task that's still only thinking this long after the prompt gets its "working" card anyway. */
const THINKING_MS = 4000;
/** After a finish, an "idle prompt" notification within this window is redundant. */
const QUIET_AFTER_FINISH_MS = 90_000;
/** Steps kept per task, finished tasks kept per session. */
const MAX_STEPS = 40;
/** Files with a stored diff per task. */
const MAX_CHANGES = 50;
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

/** Command Code's plan files (it reviews a plan written there at the end of the turn). */
const PLAN_FILE = /[\\/]\.commandcode[\\/]plans[\\/][^\\/]+\.md$/i;

const PLAN_REVIEW: Question = {
  question: "Plan ready for review. Begin implementation?",
  header: "Plan Review",
  multiSelect: false,
  options: [
    { label: "Yes, auto-accept edits", description: "Implement with accept edits (no permission prompts)" },
    { label: "Cancel", description: "Keep refining the plan" },
  ],
};

/**
 * Command Code's own choice cards, which no hook can answer (they aren't
 * questions it asks through ask_user_question): shown here with their options
 * so you know what it's waiting for, and answered in Command Code. By tool,
 * with the headline the card goes under.
 */
const COMMAND_CODE_CHOICES: Record<string, { headline: string; question: Question }> = {
  plan_review: { headline: "Plan ready for review", question: PLAN_REVIEW },
  exit_plan_mode: {
    headline: "Plan ready for review",
    question: {
      question: "Exit plan mode and begin implementation?",
      header: "Exit Plan",
      multiSelect: false,
      options: [{ label: "Execute with auto-accept mode" }, { label: "Continue planning" }],
    },
  },
  enter_plan_mode: {
    headline: "Wants to switch to plan mode",
    question: {
      question: "Enter plan mode for read-only exploration and planning?",
      header: "Plan mode",
      multiSelect: false,
      options: [{ label: "Yes" }, { label: "No, stay in current mode" }],
    },
  },
};

/** Where to answer what can't be answered from the companion. */
export function answerIn(agent: string): string {
  return agent === "commandcode" ? "Command Code" : "your terminal";
}

interface Session extends SessionView {
  finishedAt: number;
  nudgedAt: number;
  nudges: number;
  /**
   * Command Code wrote a plan file this turn ("written") or showed it for
   * review already ("reviewed"): a written plan is reviewed when the turn ends.
   */
  plan: "written" | "reviewed" | null;
}

export class AgentTracker {
  private sessions = new Map<string, Session>();
  /** Called whenever anything the panel shows changes. */
  onChange: (() => void) | null = null;
  /**
   * A task got going: its first step, or still thinking a few seconds after
   * the prompt. Once per task; the corner shows what it's doing for a moment.
   */
  onStarted: ((session: string) => void) | null = null;
  /**
   * A request queued behind the one on the card (`ahead`). Its relay waits
   * only for a card someone can see, so the owner reports it seen once the
   * card in front of it is ("1 more waiting" is on it).
   */
  onQueued: ((rid: string, ahead: string) => void) | null = null;
  private announced = new WeakSet<Turn>();

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
    this.settled(id, s, rid);
    this.onChange?.();
    return true;
  }

  /** The requests waiting behind this one in its session (for reporting them seen with it). */
  queuedBehind(rid: string): string[] {
    for (const s of this.sessions.values()) {
      if (s.permission?.rid === rid) return s.queued.flatMap((p) => (p.rid ? [p.rid] : []));
    }
    return [];
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
      if (s.status === "working" && s.current && now - s.current.startedAt >= THINKING_MS) this.announce(id, s);
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
    if (decision === "terminal") this.handedBack(id, s, rid);
    else this.settled(id, s, rid);
    this.onChange?.();
    return true;
  }

  /** The relay stopped waiting (answered in the terminal, or timed out). */
  permissionClosed(rid: string) {
    const found = this.byRequest(rid);
    if (!found) return;
    const [id, s] = found;
    this.handedBack(id, s, rid);
    this.onChange?.();
  }

  /** The session holding request `rid`, on its card or queued behind it. */
  private byRequest(rid: string): [string, Session] | null {
    for (const [id, s] of this.sessions) {
      if (s.permission?.rid === rid || s.queued.some((p) => p.rid === rid)) return [id, s];
    }
    return null;
  }

  /** Request `rid` was answered: the next one waiting takes the card, or work goes on. */
  private settled(id: string, s: Session, rid: string) {
    if (s.permission?.rid !== rid) {
      s.queued = s.queued.filter((p) => p.rid !== rid);
      this.showPermission(id, s);
      return;
    }
    if (s.queued.length) return this.promote(id, s);
    this.clearPermission(id, s);
    this.setStatus(s, "working");
  }

  /**
   * Request `rid` is left to the terminal (the user said so, or the relay
   * stopped waiting). With others still answerable here, the next takes the
   * card; alone, it stays up with its details and without its buttons.
   */
  private handedBack(id: string, s: Session, rid: string) {
    if (s.permission?.rid !== rid || s.queued.length) return this.settled(id, s, rid);
    s.permission.rid = null;
    this.showPermission(id, s);
  }

  /** The next request in the queue goes on the card. */
  private promote(id: string, s: Session) {
    s.permission = { ...s.queued.shift()!, since: this.now() };
    s.status = "waiting";
    s.nudges = 0;
    s.nudgedAt = this.now();
    this.character.notify();
    this.showPermission(id, s);
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
      .map(({ finishedAt: _f, nudgedAt: _n, nudges: _c, plan: _p, ...view }) => structuredClone(view));
  }

  /** The permissions answerable by Ctrl+Alt+Y: short enough to have been read whole on the card. */
  static fitsCard(p: Permission): boolean {
    const text = p.input ?? p.detail ?? "";
    return !p.cut && text.length <= CARD_CHARS && text.split("\n").length <= CARD_LINES;
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

    // Command Code showing one of its own choice cards: a step, and a wait for you there.
    const choice = e.agent === "commandcode" && name === "PreToolUse" && e.tool ? COMMAND_CODE_CHOICES[e.tool] : undefined;
    if (choice) {
      const turn = (s.current ??= newTurn(null, now));
      this.recordStep(s, turn, e, now);
      if (e.tool !== "enter_plan_mode") s.plan = "reviewed";
      this.askPermission(id, s, { ...e, rid: null, questions: [choice.question] }, choice.headline);
      return;
    }

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
        s.plan = null;
      }
      const turn = (s.current ??= newTurn(null, now));
      if ((name === "PreToolUse" || name === "ToolUsed") && e.tool) this.recordStep(s, turn, e, now);
      if (name === "ToolUsed" && e.tool && e.error) turn.steps[turn.steps.length - 1].failed = true;
      if (name === "PostToolUse" && e.edits?.length && e.detail) this.recordChange(s, turn, e.edits, relativeTo(s.cwd, e.detail));
      if (name === "PostToolUse" && e.agent === "commandcode" && EDIT_TOOLS.test(e.tool ?? "") && PLAN_FILE.test(e.detail ?? "")) {
        s.plan ??= "written";
      }
      if (name === "PostToolUseFailure") {
        const last = [...turn.steps].reverse().find((st) => st.tool === e.tool);
        if (last) last.failed = true;
      }
      this.workGoesOn(id, s, name, e);
      if (turn.steps.length > 0) this.announce(id, s);
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
        let wasBusy = s.status === "working" || s.status === "waiting";
        // Command Code's chat panel has no prompt hook, so a reply with no tools
        // arrives as a Stop alone; the prompt read from its transcript makes it a turn.
        if (!s.current && e.prompt && !wasBusy) {
          s.current = newTurn(e.prompt, now);
          wasBusy = true;
        } else if (s.current && !s.current.prompt && e.prompt) {
          s.current.prompt = e.prompt;
        }
        const turn = s.current;
        // A plan written this turn and not reviewed yet: Command Code shows it for
        // review now (in its default mode; plan mode reviews with exit_plan_mode).
        const reviewNext = s.plan === "written" && (e.mode === "default" || e.mode === "plan");
        s.plan = null;
        this.clearPermission(id, s);
        s.status = "idle";
        s.finishedAt = now;
        if (!turn) return;
        if (e.summary) turn.summary = plainText(e.summary);
        this.endTurn(s, "done");
        if (reviewNext) {
          // Not done yet as far as you're concerned: it's waiting for your go-ahead.
          this.askPermission(id, s, { ...e, tool: "plan_review", rid: null, questions: [PLAN_REVIEW] }, "Plan ready for review", false);
          return;
        }
        if (!wasBusy) return;
        this.say(id, s, {
          kind: "success",
          category: "agent-done",
          text: turn.prompt ? `Done: ${firstLine(turn.prompt, 70)}` : "Done",
          meta: turnMeta(turn),
          detail: turn.summary ? firstLine(turn.summary.replace(/\s+/g, " "), 220) : undefined,
        });
        if (!this.anyBusy()) this.character.finishWork({ confidence: 1 });
        else this.character.interlude({ confidence: 1 });
        return;
      }

      case "StopFailure":
        this.fail(id, s, e.error ?? e.message ?? null);
        return;

      // Stopped by the user (Esc in Codex, an interrupted or refused run in Command Code):
      // the turn ends quietly, no "done" and no error.
      case "Interrupt": {
        const wasBusy = s.status === "working" || s.status === "waiting";
        this.clearPermission(id, s);
        if (s.current) {
          s.current.summary = e.message ?? null;
          this.endTurn(s, "cancelled");
        }
        s.status = "idle";
        s.finishedAt = now;
        // Stopped part-way: a little shrug ("oh, okay"), rather than just going quiet.
        if (!this.anyBusy()) {
          if (wasBusy) this.character.finishWork({ confidence: 0 });
          else this.character.cancelWork();
        } else if (wasBusy) {
          this.character.interlude({ confidence: 0 });
        }
        return;
      }

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

  /**
   * A step while requests may be waiting. Other tools run alongside a request
   * (parallel calls, subagents), and Claude Code's PreToolUse can arrive after
   * the request it led to, so a step alone never closes a request the relay
   * still holds: only an answer, the relay letting go, the tool having run
   * (answered in the terminal), a new prompt or the turn's end do. Cards that
   * only say "answer in your terminal" go once work moves on.
   */
  private workGoesOn(id: string, s: Session, name: string, e: AgentEvent) {
    if (name === "UserPromptSubmit") {
      this.clearPermission(id, s);
      this.setStatus(s, "working");
      return;
    }
    const ran = name === "PostToolUse" || name === "PostToolUseFailure" || name === "ToolUsed" ? requestKey(e) : null;
    const before = s.queued.length;
    s.queued = s.queued.filter((p) => p.rid && p.key !== ran);
    const p = s.permission;
    if (p && (!p.rid || p.key === ran)) {
      if (s.queued.length) this.promote(id, s);
      else this.clearPermission(id, s);
    } else if (p && s.queued.length !== before) {
      this.showPermission(id, s);
    }
    this.setStatus(s, s.permission ? "waiting" : "working");
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
    else this.character.interlude({ confidence: 0, error: true });
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

  /** Adds an edit's line changes to its file's entry in the task. */
  private recordChange(_s: Session, turn: Turn, edits: NonNullable<AgentEvent["edits"]>, path: string) {
    let change = turn.changes.find((c) => c.path === path);
    if (!change) {
      if (turn.changes.length >= MAX_CHANGES) return;
      change = { path, add: 0, del: 0, hunks: [] };
      turn.changes.push(change);
    }
    for (const part of edits) addToChange(change, diffText(part.old, part.new));
    if (!turn.files.includes(path)) turn.files.push(path);
  }

  /**
   * The session waits for you: a permission, or questions (`e.questions`).
   * `headline` says what it's waiting for when that's more than either.
   * `inTurn` false: the turn has ended already (a plan waiting for review),
   * so no new one is started for the wait.
   */
  private askPermission(id: string, s: Session, e: AgentEvent, headline: string | null = null, inTurn = true) {
    const wasAnyBusy = this.anyBusy();
    const tool = e.tool ?? "a tool";
    const detail = e.detail ? (tool !== "Bash" ? relativeTo(s.cwd, e.detail) : e.detail) : null;
    const questions = e.questions?.length ? e.questions : null;
    const head = s.permission;
    const make = (rid: string | null, canAlways: boolean, alwaysRule: string | null): Permission => ({
      tool, action: permissionAction(tool), detail: questions ? null : detail, since: this.now(), rid, canAlways, alwaysRule,
      input: questions ? null : (e.input ?? null), cut: Boolean(e.cut), phoneOk: Boolean(e.phoneOk), key: requestKey(e),
      questions, headline, where: answerIn(s.agent),
    });
    // Another request while the card's is still answerable here: both relays
    // are waiting, so this one queues behind it rather than replacing it.
    if (head?.rid && e.rid !== head.rid) {
      // A Notification about the request on the card: it's already up.
      if (!e.rid && head.tool === tool) return this.showPermission(id, s, e.message);
      if (e.rid && s.queued.some((p) => p.rid === e.rid)) return;
      this.count((d) => d.asks++);
      s.queued.push(make(e.rid ?? null, Boolean(e.canAlways), e.alwaysRule ?? null));
      if (e.rid) this.onQueued?.(e.rid, head.rid);
      this.showPermission(id, s);
      return;
    }
    // A Notification about a request we already hold keeps its buttons.
    const rid = e.rid ?? (head?.tool === tool ? head.rid : null);
    const same = !e.rid && head?.tool === tool;
    const canAlways = Boolean(e.canAlways ?? (same && head.canAlways));
    if (s.status !== "waiting") this.count((d) => d.asks++);
    s.permission = same
      ? { ...head, since: this.now() }
      : make(rid, canAlways, e.alwaysRule ?? null);
    if (inTurn) s.current ??= newTurn(null, this.now());
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
        text: p.headline ? `${p.headline}:` : p.questions.length > 1 ? "Has a few questions for you:" : "Has a question for you:",
        questions: p.rid ? p.questions : undefined,
        // Can't be answered here: what it's asking and its choices, to answer there.
        detail: p.rid ? undefined : questionsText(p.questions),
        meta: p.rid ? undefined : `Answer in ${p.where}`,
        request: p.rid ?? undefined,
        elsewhere: elsewhere(p.where),
      });
      return;
    }
    const shown = p.input || p.detail;
    const more = s.queued.length;
    const meta = [
      p.rid && p.cut && `Too long to show here in full: read it and answer in ${p.where}`,
      p.rid && !p.cut && p.canAlways && p.alwaysRule && `Always: ${p.alwaysRule}`,
      !p.rid && `Answer in ${p.where}`,
      more > 0 && `${more} more waiting`,
    ].filter(Boolean).join("\n");
    this.bubble.show({
      id: permissionId(id),
      category: "agent-permission",
      session: id,
      title: this.titleFor(s),
      kind: "attention",
      sticky: true,
      text: shown ? `Needs your OK to ${p.action}:` : (message || `Needs your OK to ${p.action}`),
      detail: shown ?? undefined,
      mono: !!shown,
      meta: meta || undefined,
      request: p.rid ?? undefined,
      always: p.rid ? p.canAlways && !p.cut : undefined,
      noAllow: p.rid && p.cut ? true : undefined,
      rule: p.rid && p.canAlways ? (p.alwaysRule ?? undefined) : undefined,
      elsewhere: elsewhere(p.where),
    });
  }

  private clearPermission(id: string, s: Session) {
    if (s.status === "waiting" || s.permission) this.bubble.hide(permissionId(id));
    s.permission = null;
    s.queued = [];
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
        queued: [],
        current: null,
        history: [],
        lastEvent: 0,
        procs: [],
        finishedAt: -Infinity,
        nudgedAt: 0,
        nudges: 0,
        plan: null,
      };
      this.sessions.set(id, s);
    } else if (e.cwd) {
      s.cwd = e.cwd;
      s.project = baseName(e.cwd);
    }
    if (s.status === "ended" && e.event !== "SessionEnd") s.status = "idle";
    return s;
  }

  private announce(id: string, s: Session) {
    const turn = s.current;
    if (!turn || s.status !== "working" || this.announced.has(turn)) return;
    this.announced.add(turn);
    this.onStarted?.(id);
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

/** Longest request answerable by Ctrl+Alt+Y: what the card shows without scrolling. */
const CARD_CHARS = 300;
const CARD_LINES = 4;

/** A request's tool and what it touches, as the relay sends both for it and for its step once run. */
const requestKey = (e: AgentEvent) => `${e.tool ?? ""}\n${e.detail ?? ""}`;

/** The button that leaves the answer to the agent: "In terminal", "In Command Code". */
export const elsewhere = (where: string) => (where === "your terminal" ? "In terminal" : `In ${where}`);

/** Questions with their choices, one per line: "Which one?\n• Blue\n• Green". */
export function questionsText(questions: Question[]): string {
  return questions.map((q) => [q.question, ...q.options.map((o) => `• ${o.label}`)].join("\n")).join("\n\n");
}

const newTurn = (prompt: string | null, now: number): Turn => ({
  prompt, startedAt: now, endedAt: null, steps: [], files: [], changes: [], commands: 0, summary: null, outcome: "working",
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
    lineTotals(t.changes),
    t.commands > 0 && plural(t.commands, "command"),
    t.files.length === 0 && t.commands === 0 && t.steps.length > 0 && plural(t.steps.length, "step"),
  );
}

/** "+42 −7" for the lines changed across a task's files, or false when nothing is known. */
export function lineTotals(changes: Change[]): string | false {
  const add = changes.reduce((n, c) => n + c.add, 0);
  const del = changes.reduce((n, c) => n + c.del, 0);
  return add + del > 0 && `+${add} −${del}`;
}

/**
 * What kind of task a tool is, for the character's working pose: reading or
 * searching, editing, running a command, or the web. Null when it's none of
 * those (planning, delegating): the pose stays as it was.
 */
export function activityOf(tool: string | null | undefined): "research" | "edit" | "run" | "browse" | null {
  if (!tool) return null;
  const t = tool.toLowerCase();
  if (/^mcp__.*(playwright|browser|chrome|puppeteer|fetch|web)/.test(t)) return "browse";
  if (/^(webfetch|websearch|web_fetch|web_search|google_web_search|fetch_url)$/.test(t)) return "browse";
  if (/^(bash|powershell|shell|shell_command|run_shell_command|run_command|execute_command|terminal|bashoutput|killshell)$/.test(t)) return "run";
  if (/^(edit|multiedit|write|notebookedit|write_file|edit_file|replace|str_replace|apply_patch|create_file)$/.test(t)) return "edit";
  if (/^(read|grep|glob|ls|notebookread|read_file|read_many_files|read_directory|list_directory|search_files|search_file_content|grep_search|file_search|codebase_search)$/.test(t)) return "research";
  return null;
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
    default: {
      const tool = toolName(step.tool);
      return d ? `${tool}: ${d}` : tool;
    }
  }
}

/** An MCP tool ("mcp__playwright__browser_navigate") as words: "Playwright · browser navigate". */
function toolName(tool: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (!mcp) return tool;
  const server = mcp[1].replace(/[_-]+/g, " ");
  return `${server[0].toUpperCase()}${server.slice(1)} · ${mcp[2].replace(/_+/g, " ")}`;
}
