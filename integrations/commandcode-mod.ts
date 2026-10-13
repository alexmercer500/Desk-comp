// Desk Companion for Command Code.
//
// Written to ~/.commandcode/mods/desk-companion.ts by Desk Companion (Settings →
// Coding agents → Command Code) and removed when that's switched off. Command
// Code loads it at the start of each session.
//
// Command Code's plain hooks say when a tool runs and when a run ends normally,
// but not when a run is interrupted or fails, and not when it asks you for
// permission. A mod sees all of that, so the companion can show:
//   * what each session is doing, step by step
//   * when it's done, failed, or was stopped
//   * when it's waiting for your OK in the terminal (Command Code answers its
//     own permission prompts; nothing outside can, so the companion says to
//     answer there rather than offering Allow / Deny)
//   * its multiple-choice questions, answerable from the companion
//
// Every event goes through Desk Companion's relay (companion-hook.exe), the
// same small program the other agents run, which only ever talks to the
// genuine Desk Companion app on this PC. Nothing is sent anywhere else.

import { spawn } from "node:child_process";

/** The relay. Desk Companion fills this in when it installs the mod. */
const RELAY: string = "__DESK_COMPANION_RELAY__";

/** A tool that's still not running this long after it was queued is waiting for your OK. */
const WAITING_AFTER_MS = 2500;
/** How long a question may wait for an answer from the companion (the relay gives up a little sooner). */
const ANSWER_BUDGET_MS = 115_000;
/** Tools that never ask for permission: no "needs your OK" for these. */
const NEVER_ASK = new Set([
  "read_file", "read_directory", "glob", "grep", "get_diagnostics", "todo_write", "ask_user_question",
  "activate_skill", "read_taste_file", "task_create", "task_update", "task_list", "task_get", "task_output",
  "agent_output", "shell_output", "plan_review", "enter_plan_mode", "exit_plan_mode", "cron_list",
]);

type Json = Record<string, unknown>;
interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}

// The parts of Command Code's ModApi this uses (see its mod-builder reference).
interface ModApi {
  cwd: string;
  hooks(h: {
    transformInput?: (a: { text: string }) => unknown;
    beforeToolCall?: (a: { toolName: string; input: Json }) => Promise<unknown> | unknown;
    onSessionEnd?: (a: { reason: string }) => unknown;
  }): unknown;
  on(event: string, handler: (e: Json) => void): unknown;
}

export default function deskCompanion(cmd: ModApi): void {
  const cwd = cmd.cwd;
  let session = "";
  let started = false;
  /** The prompt you typed, for the next run. */
  let prompt: string | null = null;
  let lastError: string | null = null;
  const waiting = new Map<string, ReturnType<typeof setTimeout>>();
  /** Each queued call's input (the "running" event doesn't carry it). */
  const inputs = new Map<string, unknown>();
  /** Events go out one after another, so the companion sees them in order. */
  let queue: Promise<unknown> = Promise.resolve();

  const sessionId = () => session || `commandcode:${cwd}`;

  /** Runs the relay with one event; resolves with what it printed (an answer, or nothing). */
  function relay(event: string, extra: Json, wait: boolean): Promise<string> {
    return new Promise((resolve) => {
      if (RELAY.startsWith("__")) return resolve("");
      const payload = { session_id: sessionId(), cwd, hook_event_name: event, ...extra };
      let out = "";
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(out);
      };
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(RELAY, ["--agent", "commandcode", ...(wait ? ["--wait"] : [])], {
          stdio: ["pipe", "pipe", "ignore"],
          windowsHide: true,
        });
      } catch {
        return resolve("");
      }
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // gone already
        }
        finish();
      }, wait ? ANSWER_BUDGET_MS : 5000);
      child.stdout?.on("data", (d) => (out += String(d)));
      child.on("error", finish);
      child.on("close", finish);
      child.stdin?.on("error", () => {});
      child.stdin?.end(JSON.stringify(payload));
    });
  }

  /** Fire and forget, in order. Never throws, never holds Command Code up. */
  function send(event: string, extra: Json = {}): void {
    queue = queue.then(() => relay(event, extra, false)).catch(() => {});
  }

  const text = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : undefined);
  const stopWaiting = (id: string) => {
    const t = waiting.get(id);
    if (t) clearTimeout(t);
    waiting.delete(id);
  };

  cmd.hooks({
    // The prompt you typed (automated turns and slash commands don't come through here).
    transformInput: ({ text: typed }) => {
      prompt = typed;
      return undefined;
    },

    // Command Code asking you a question: show it in the companion and, if you
    // answer there, hand the answer to the model in place of the terminal prompt.
    beforeToolCall: async ({ toolName, input }) => {
      if (toolName !== "ask_user_question") return undefined;
      const questions = (Array.isArray(input?.questions) ? input.questions : []) as Question[];
      if (!questions.length) return undefined;
      const asked = {
        questions: questions.map((q) => ({
          question: q.question,
          header: q.header,
          multiSelect: q.multiSelect === true,
          options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description })),
        })),
      };
      await queue;
      const out = await relay("PreToolUse", { tool_name: "AskUserQuestion", tool_input: asked }, true);
      const answers = parseAnswers(out);
      // No answer from the companion ("In terminal", or none in time): Command Code asks as usual.
      if (!answers) return undefined;
      const lines = Object.entries(answers).map(([q, a]) => `- ${q}\n  Answer: ${a}`);
      return {
        block: true,
        additionalContext: `The user answered in the Desk Companion app (instead of the terminal):\n${lines.join("\n")}`,
      };
    },

    onSessionEnd: () => {
      for (const id of [...waiting.keys()]) stopWaiting(id);
      if (started) send("SessionEnd");
    },
  });

  cmd.on("run_start", (e) => {
    session = text(e.sessionId, 128) ?? session;
    if (!started) {
      started = true;
      send("SessionStart");
    }
    lastError = null;
    send("UserPromptSubmit", { prompt: prompt ?? undefined });
    prompt = null;
  });

  cmd.on("tool_queued", (e) => {
    const id = String(e.toolCallId ?? "");
    const tool = String(e.toolName ?? "");
    if (!id) return;
    inputs.set(id, e.input ?? {});
    if (NEVER_ASK.has(tool)) return;
    // Still not running in a moment: Command Code is asking you in the terminal.
    waiting.set(
      id,
      setTimeout(() => {
        waiting.delete(id);
        send("Notification", {
          notification_type: "permission_prompt",
          message: "Command Code needs your permission. Answer in its terminal.",
          tool_name: tool,
          tool_input: e.input ?? {},
        });
      }, WAITING_AFTER_MS),
    );
  });

  cmd.on("tool_running", (e) => {
    // Command Code checks a whole batch's permissions before running any of it,
    // so once one runs, nothing in the batch is waiting for you any more.
    for (const id of [...waiting.keys()]) stopWaiting(id);
    const id = String(e.toolCallId ?? "");
    const input = inputs.get(id) ?? {};
    inputs.delete(id);
    if (e.toolName === "ask_user_question") return; // shown as a question instead
    send("PreToolUse", { tool_name: e.toolName, tool_input: input });
  });

  cmd.on("tool_completed", (e) => send("PostToolUse", { tool_name: e.toolName }));
  cmd.on("tool_errored", (e) => send("PostToolUseFailure", { tool_name: e.toolName }));
  const forget = (e: Json) => {
    const id = String(e.toolCallId ?? "");
    stopWaiting(id);
    inputs.delete(id);
  };
  cmd.on("tool_denied", forget);
  cmd.on("tool_hook_blocked", forget);

  cmd.on("run_error", (e) => {
    const err = e.error as { message?: unknown } | undefined;
    lastError = text(err?.message, 300) ?? "Something went wrong";
  });

  // Every run ends here, however it ended.
  cmd.on("run_end", (e) => {
    for (const id of [...waiting.keys()]) stopWaiting(id);
    inputs.clear();
    const result = (e.result ?? {}) as Json;
    const reason = String(result.stopReason ?? "");
    if (reason === "run_error" || lastError) {
      send("StopFailure", { error: lastError ?? "Stopped with an error" });
    } else if (reason === "interrupted" || reason === "permission_denied") {
      send("Interrupt", { message: reason === "permission_denied" ? "Permission denied" : "Stopped" });
    } else {
      send("Stop", { last_assistant_message: text(result.finalText, 1500) });
    }
    lastError = null;
  });
}

/** The answers in the relay's reply (Claude Code's format), or null if there aren't any. */
function parseAnswers(out: string): Record<string, string> | null {
  try {
    const reply = JSON.parse(out.trim()) as { hookSpecificOutput?: { updatedInput?: { answers?: Record<string, unknown> } } };
    const answers = reply.hookSpecificOutput?.updatedInput?.answers;
    if (!answers || typeof answers !== "object") return null;
    const clean: Record<string, string> = {};
    for (const [q, a] of Object.entries(answers)) if (typeof a === "string" && a) clean[q] = a;
    return Object.keys(clean).length ? clean : null;
  } catch {
    return null;
  }
}
