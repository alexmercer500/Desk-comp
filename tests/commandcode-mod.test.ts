// The Command Code mod (integrations/commandcode-mod.ts): what it tells the
// relay for each thing Command Code does. The relay launches are intercepted;
// each records the event it was given and can print an answer back.

import { EventEmitter } from "node:events";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Sent {
  args: string[];
  payload: Record<string, unknown>;
}
let sent: Sent[] = [];
/** What the relay prints for a waiting (--wait) event. */
let answer = "";

vi.mock("node:child_process", () => ({
  spawn: (_exe: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const stdout = new EventEmitter();
    let input = "";
    child.stdout = stdout;
    child.kill = () => {};
    child.stdin = {
      on: () => {},
      end: (text: string) => {
        input += text;
        sent.push({ args, payload: JSON.parse(input) });
        setTimeout(() => {
          if (args.includes("--wait") && answer) stdout.emit("data", answer);
          child.emit("close", 0);
        }, 1);
      },
    };
    return child;
  },
}));

type Handler = (e: Record<string, unknown>) => void;
interface Hooks {
  transformInput?: (a: { text: string }) => unknown;
  beforeToolCall?: (a: { toolName: string; input: Record<string, unknown> }) => Promise<unknown> | unknown;
  onSessionEnd?: (a: { reason: string }) => unknown;
}

let on: Record<string, Handler>;
let hooks: Hooks;
const fire = (event: string, e: Record<string, unknown> = {}) => on[event]?.({ type: event, ...e });
/** Lets the mod's queued relay launches run: until nothing new has gone out for a moment. */
async function settle() {
  let seen = -1;
  while (seen !== sent.length) {
    seen = sent.length;
    await new Promise((r) => setTimeout(r, 60));
  }
}
const events = () => sent.map((s) => s.payload.hook_event_name);

/** The mod as installed: the relay path written in, in a file of its own (removed after). */
const INSTALLED = fileURLToPath(new URL("./.commandcode-mod.installed.ts", import.meta.url));

async function load() {
  vi.resetModules();
  const source = readFileSync(fileURLToPath(new URL("../integrations/commandcode-mod.ts", import.meta.url)), "utf8");
  writeFileSync(INSTALLED, source.replace('"__DESK_COMPANION_RELAY__"', '"C:/relay/companion-hook.exe"'));
  const mod = await import(/* @vite-ignore */ `./.commandcode-mod.installed.ts?t=${Date.now()}`);
  on = {};
  hooks = {};
  mod.default({
    cwd: "C:/code/shop",
    hooks: (h: Hooks) => Object.assign(hooks, h),
    on: (event: string, handler: Handler) => {
      on[event] = handler;
    },
  });
}

beforeEach(async () => {
  vi.useRealTimers();
  await settle(); // anything still going out from the test before
  sent = [];
  answer = "";
  await load();
});
afterEach(() => vi.useRealTimers());
afterAll(() => rmSync(INSTALLED, { force: true }));

describe("the Command Code mod", () => {
  it("reports a run: start, the prompt, each tool with its input, and the end with the reply", async () => {
    hooks.transformInput?.({ text: "Fix the cart total" });
    fire("run_start", { sessionId: "cc-1" });
    fire("tool_queued", { toolCallId: "t1", toolName: "read_file", input: { path: "src/cart.ts" } });
    fire("tool_running", { toolCallId: "t1", toolName: "read_file" });
    fire("tool_completed", { toolCallId: "t1", toolName: "read_file" });
    fire("tool_queued", { toolCallId: "t2", toolName: "shell_command", input: { command: "npm test" } });
    fire("tool_running", { toolCallId: "t2", toolName: "shell_command" });
    fire("tool_errored", { toolCallId: "t2", toolName: "shell_command" });
    fire("run_end", { result: { stopReason: "end_turn", finalText: "Fixed the rounding." } });
    await settle();

    expect(events()).toEqual(["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PreToolUse", "PostToolUseFailure", "Stop"]);
    expect(sent.every((s) => s.args.join(" ") === "--agent commandcode")).toBe(true);
    expect(sent.every((s) => s.payload.session_id === "cc-1" && s.payload.cwd === "C:/code/shop")).toBe(true);
    expect(sent[1].payload.prompt).toBe("Fix the cart total");
    expect(sent[2].payload).toMatchObject({ tool_name: "read_file", tool_input: { path: "src/cart.ts" } });
    expect(sent[4].payload).toMatchObject({ tool_name: "shell_command", tool_input: { command: "npm test" } });
    expect(sent[6].payload.last_assistant_message).toBe("Fixed the rounding.");
  });

  it("says when a run is interrupted, refused, or fails, instead of leaving it working", async () => {
    fire("run_start", { sessionId: "cc-1" });
    fire("run_end", { result: { stopReason: "interrupted" } });
    fire("run_start", { sessionId: "cc-1" });
    fire("run_end", { result: { stopReason: "permission_denied" } });
    fire("run_start", { sessionId: "cc-1" });
    fire("run_error", { error: new Error("Rate limited") });
    fire("run_end", { result: { stopReason: "run_error" } });
    await settle();
    const ends = sent.filter((s) => !["SessionStart", "UserPromptSubmit"].includes(String(s.payload.hook_event_name)));
    expect(ends.map((s) => [s.payload.hook_event_name, s.payload.message ?? s.payload.error])).toEqual([
      ["Interrupt", "Stopped"],
      ["Interrupt", "Permission denied"],
      ["StopFailure", "Rate limited"],
    ]);
  });

  it("flags a tool still not running after a moment as waiting for permission, with its command", async () => {
    vi.useFakeTimers();
    fire("run_start", { sessionId: "cc-1" });
    fire("tool_queued", { toolCallId: "t1", toolName: "shell_command", input: { command: "rm -rf dist" } });
    await vi.advanceTimersByTimeAsync(3000);
    vi.useRealTimers();
    await settle();
    const note = sent.find((s) => s.payload.hook_event_name === "Notification");
    expect(note?.payload).toMatchObject({ notification_type: "permission_prompt", tool_name: "shell_command", tool_input: { command: "rm -rf dist" } });
  });

  it("never flags reads, or the rest of a batch while its first tool runs", async () => {
    vi.useFakeTimers();
    fire("run_start", { sessionId: "cc-1" });
    fire("tool_queued", { toolCallId: "r", toolName: "read_file", input: { path: "a.ts" } });
    fire("tool_queued", { toolCallId: "a", toolName: "shell_command", input: { command: "npm run build" } });
    fire("tool_queued", { toolCallId: "b", toolName: "edit_file", input: { path: "b.ts" } });
    // Permissions for the whole batch pass, then the first runs for a long time.
    fire("tool_running", { toolCallId: "a", toolName: "shell_command" });
    await vi.advanceTimersByTimeAsync(10_000);
    vi.useRealTimers();
    await settle();
    expect(events()).not.toContain("Notification");
  });

  it("asks Command Code's question in the companion and hands the model the answer", async () => {
    answer = JSON.stringify({ hookSpecificOutput: { updatedInput: { answers: { "Which database?": "Postgres" } } } });
    fire("run_start", { sessionId: "cc-1" });
    const result = await hooks.beforeToolCall?.({
      toolName: "ask_user_question",
      input: { questions: [{ question: "Which database?", header: "DB", options: [{ label: "Postgres", description: "SQL", preview: "<b/>" }, { label: "Mongo" }] }] },
    });
    const asked = sent.find((s) => s.args.includes("--wait"));
    expect(asked?.payload).toMatchObject({
      hook_event_name: "PreToolUse",
      tool_name: "AskUserQuestion",
      tool_input: { questions: [{ question: "Which database?", header: "DB", multiSelect: false, options: [{ label: "Postgres", description: "SQL" }, { label: "Mongo" }] }] },
    });
    expect(result).toMatchObject({ block: true });
    expect(String((result as { additionalContext: string }).additionalContext)).toContain("Which database?\n  Answer: Postgres");
  });

  it("leaves the question to the terminal when nobody answers in the companion", async () => {
    answer = "";
    const result = await hooks.beforeToolCall?.({ toolName: "ask_user_question", input: { questions: [{ question: "Go?", options: [{ label: "Yes" }] }] } });
    expect(result).toBeUndefined();
    // Every other tool is left alone.
    expect(await hooks.beforeToolCall?.({ toolName: "shell_command", input: { command: "ls" } })).toBeUndefined();
  });
});
