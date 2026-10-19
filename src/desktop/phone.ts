// The session list in the shape Desk Companion for Android reads
// (docs/PHONE_LINK.md, "Session"). The companion page sends it to Rust
// (`phone_sessions`) whenever it changes; Rust passes it to paired phones.
//
// Kept small and plain: the last 20 steps, at most 50 files, strings shortened.

import { AGENT_NAMES, describeStep, type SessionView, type Turn } from "./agents";
import { firstLine } from "./format";

export type PhoneStatus = "working" | "waiting" | "done" | "error" | "idle";

export interface PhoneSession {
  id: string;
  agent: string;
  project: string;
  status: PhoneStatus;
  line: string;
  prompt: string | null;
  summary: string | null;
  steps: { tool: string; detail: string; failed: boolean }[];
  files: { path: string; add: number; del: number }[];
  updatedAt: number;
  /** Present only while Allow / Deny can be sent for it. */
  approval: { rid: string; tool: string; action: string; detail: string; canAlways: boolean } | null;
  /**
   * The session's processes, for finding its window when a phone peeks
   * (peek.rs). The PC keeps these; they're never sent to the phone.
   */
  procs: number[];
  /** Claude's question card, while it can be answered from here. */
  question: { rid: string; questions: PhoneQuestion[] } | null;
  /**
   * What it's asking where it was asked (Command Code's plan review, a question
   * left to its own card): shown with its choices, answered there.
   */
  ask: { headline: string | null; questions: PhoneQuestion[]; where: string } | null;
}

export interface PhoneQuestion {
  question: string;
  header: string | null;
  multiSelect: boolean;
  options: { label: string; description: string | null }[];
}

const MAX_SESSIONS = 20;
const MAX_STEPS = 20;
const MAX_FILES = 50;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function statusOf(s: SessionView): PhoneStatus {
  if (s.status === "waiting") return "waiting";
  if (s.status === "working") return "working";
  const last = s.history[0];
  if (last?.outcome === "done") return "done";
  if (last?.outcome === "error") return "error";
  return "idle";
}

function lineOf(s: SessionView, status: PhoneStatus, turn: Turn | null): string {
  switch (status) {
    case "waiting":
      if (s.permission?.headline) return s.permission.headline;
      return s.permission?.questions ? "Has a question for you" : `Wants to ${s.permission?.action ?? "do something"}`;
    case "working": {
      const step = turn?.steps[turn.steps.length - 1];
      return step ? describeStep(step) : "Working";
    }
    case "done":
      return firstLine(turn?.summary, 160) || "Finished";
    case "error":
      return "Stopped with an error";
    default:
      return "Idle";
  }
}

export function phoneView(sessions: SessionView[]): PhoneSession[] {
  return sessions.slice(0, MAX_SESSIONS).map((s) => {
    const status = statusOf(s);
    // What's going on now, else the task that just ended.
    const turn = s.current ?? s.history[0] ?? null;
    const p = s.permission;
    const asked = (questions: NonNullable<typeof p>["questions"] & object) => questions.map((q) => ({
      question: q.question,
      header: q.header ?? null,
      multiSelect: Boolean(q.multiSelect),
      options: q.options.map((o) => ({ label: o.label, description: o.description ?? null })),
    }));
    return {
      id: s.id,
      agent: AGENT_NAMES[s.agent] ?? s.agent,
      project: s.project,
      status,
      line: clip(lineOf(s, status, turn), 160),
      prompt: turn?.prompt ? clip(turn.prompt, 1000) : null,
      summary: turn?.summary ? clip(turn.summary, 2000) : null,
      steps: (turn?.steps ?? []).slice(-MAX_STEPS).map((st) => ({ tool: st.tool, detail: clip(st.detail ?? "", 300), failed: Boolean(st.failed) })),
      files: (turn?.files ?? []).slice(0, MAX_FILES).map((path) => {
        const c = turn?.changes.find((x) => x.path === path);
        return { path: clip(path, 300), add: c?.add ?? 0, del: c?.del ?? 0 };
      }),
      updatedAt: s.lastEvent,
      procs: s.procs,
      approval: p && p.rid && !p.questions
        ? { rid: p.rid, tool: p.tool, action: p.action, detail: clip(p.detail ?? "", 2000), canAlways: p.canAlways }
        : null,
      // Not clipped: an answer must repeat the question exactly (the relay checks it).
      question: p && p.rid && p.questions ? { rid: p.rid, questions: asked(p.questions) } : null,
      ask: p && !p.rid && p.questions ? { headline: p.headline, questions: asked(p.questions), where: p.where } : null,
    };
  });
}
