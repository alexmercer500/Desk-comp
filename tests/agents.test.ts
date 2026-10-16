// Coding-agent sessions → character, bubble and panel.

import { beforeEach, describe, expect, it } from "vitest";
import type { BubbleMessage } from "../src/bubble/types";
import { AgentTracker, describeStep, type AgentEvent, type CharacterSink } from "../src/desktop/agents";

let clock = 0;
let calls: string[];
let state: string;
let shown: BubbleMessage[];
let hidden: string[];
let t: AgentTracker;

const character: CharacterSink = {
  startWork: () => { calls.push("startWork"); state = "WORKING"; },
  finishWork: (r) => { calls.push(r.error ? "finish:error" : `finish:${r.confidence}`); state = "SUCCESS"; },
  cancelWork: () => { calls.push("cancelWork"); state = "IDLE"; },
  notify: () => { calls.push("notify"); },
  getState: () => state,
};

const CWD = "C:\\code\\shop";
function ev(event: string, extra: Partial<AgentEvent> = {}): AgentEvent {
  return { agent: "claude-code", event, session: "s1", cwd: CWD, tool: null, detail: null, message: null, kind: null, ...extra };
}
const step = (tool: string, detail: string) => {
  t.handle(ev("PreToolUse", { tool, detail }));
  t.handle(ev("PostToolUse", { tool }));
};

beforeEach(() => {
  clock = 0;
  calls = [];
  state = "IDLE";
  shown = [];
  hidden = [];
  t = new AgentTracker(character, { show: (m) => shown.push(m), hide: (id) => hidden.push(id) }, () => clock);
});

describe("a finished task", () => {
  it("says what was asked, how long, what changed, and the agent's summary", () => {
    t.handle(ev("UserPromptSubmit", { prompt: "Fix the cart total" }));
    step("Read", `${CWD}\\src\\cart.ts`);
    step("Edit", `${CWD}\\src\\cart.ts`);
    step("Edit", `${CWD}\\src\\cart.ts`);
    step("Write", `${CWD}\\src\\cart.test.ts`);
    step("Bash", "npm test");
    clock = 134_000;
    t.handle(ev("Stop", { summary: "Fixed rounding.\nAll tests pass." }));

    expect(calls).toEqual(["startWork", "finish:1"]);
    expect(shown.at(-1)).toMatchObject({
      kind: "success",
      title: "Claude Code · shop",
      text: "Done: Fix the cart total",
      meta: "2m 14s · 2 files edited · 1 command",
      detail: "Fixed rounding. All tests pass.",
      session: "s1",
    });

    const [view] = t.snapshot();
    expect(view.status).toBe("idle");
    expect(view.current).toBeNull();
    expect(view.history[0]).toMatchObject({
      prompt: "Fix the cart total", outcome: "done", files: ["src/cart.ts", "src/cart.test.ts"], commands: 1,
      summary: "Fixed rounding.\nAll tests pass.",
    });
    expect(view.history[0].steps.map((s) => s.tool)).toEqual(["Read", "Edit", "Edit", "Write", "Bash"]);
    expect(view.history[0].steps[0].detail).toBe("src/cart.ts");
  });

  it("a Stop for an idle session says nothing", () => {
    t.handle(ev("SessionStart"));
    t.handle(ev("Stop"));
    expect(calls).toEqual([]);
    expect(shown).toEqual([]);
  });

  it("Command Code's chat panel: a Stop that brings its prompt is a whole turn", () => {
    const cc = { agent: "commandcode" };
    t.handle(ev("Stop", { ...cc, prompt: "write a story", summary: "Once upon a time…" }));
    expect(calls).toEqual(["finish:1"]);
    expect(shown.at(-1)).toMatchObject({ kind: "success", text: "Done: write a story", detail: "Once upon a time…" });
    expect(t.snapshot()[0].history[0]).toMatchObject({ prompt: "write a story", outcome: "done" });

    // With tools, the turn starts at the first one and the Stop names it.
    t.handle(ev("PreToolUse", { ...cc, tool: "Read", detail: `${CWD}\\a.ts` }));
    t.handle(ev("Stop", { ...cc, prompt: "read a.ts" }));
    expect(shown.at(-1)).toMatchObject({ text: "Done: read a.ts" });
    // The same Stop again (nothing under way) doesn't announce twice.
    const count = shown.length;
    t.handle(ev("Stop", { ...cc }));
    expect(shown.length).toBe(count);
  });

  it("keeps the last five finished tasks", () => {
    for (let i = 0; i < 7; i++) {
      t.handle(ev("UserPromptSubmit", { prompt: `task ${i}` }));
      t.handle(ev("Stop"));
    }
    expect(t.snapshot()[0].history.map((h) => h.prompt)).toEqual(["task 6", "task 5", "task 4", "task 3", "task 2"]);
  });
});

describe("permissions", () => {
  it("shows the exact command, and clears once work resumes", () => {
    t.handle(ev("UserPromptSubmit", { prompt: "add stripe" }));
    t.handle(ev("PermissionRequest", { tool: "Bash", detail: "npm install stripe" }));
    expect(calls).toEqual(["startWork", "notify"]);
    expect(shown.at(-1)).toMatchObject({
      kind: "attention", sticky: true, text: "Needs your OK to run:", detail: "npm install stripe", mono: true,
    });
    expect(t.snapshot()[0]).toMatchObject({ status: "waiting", permission: { action: "run", detail: "npm install stripe" } });

    t.handle(ev("PostToolUse", { tool: "Bash" }));
    expect(hidden).toEqual(["permission:s1"]);
    expect(t.snapshot()[0].permission).toBeNull();
  });

  it("offers Allow / Deny only while the relay is holding the request", () => {
    t.handle(ev("PermissionRequest", { tool: "Bash", detail: "npm i", rid: "r1" }));
    expect(shown.at(-1)).toMatchObject({ request: "r1" });
    expect(shown.at(-1)?.meta).toBeUndefined();
    expect(t.snapshot()[0].permission?.rid).toBe("r1");

    t.permissionClosed("r1"); // answered in the terminal / timed out
    expect(shown.at(-1)).toMatchObject({ request: undefined, meta: "Answer in your terminal" });
    expect(t.snapshot()[0]).toMatchObject({ status: "waiting", permission: { rid: null } });
  });

  it("Allow clears the request and goes back to work", () => {
    t.handle(ev("PermissionRequest", { tool: "Bash", detail: "npm i", rid: "r1" }));
    expect(t.answer("r1", "allow")).toBe(true);
    expect(hidden).toContain("permission:s1");
    expect(t.snapshot()[0]).toMatchObject({ status: "working", permission: null });
    expect(t.answer("r1", "allow")).toBe(false); // nothing left to answer
  });

  it("In terminal keeps the details but drops the buttons", () => {
    t.handle(ev("PermissionRequest", { tool: "Bash", detail: "npm i", rid: "r1" }));
    t.answer("r1", "terminal");
    expect(t.snapshot()[0]).toMatchObject({ status: "waiting", permission: { detail: "npm i", rid: null } });
  });

  it("file edits show the path relative to the project", () => {
    t.handle(ev("PermissionRequest", { tool: "Edit", detail: `${CWD}\\src\\cart.ts` }));
    expect(shown[0]).toMatchObject({ text: "Needs your OK to edit:", detail: "src/cart.ts" });
  });

  it("a permission Notification after a PermissionRequest doesn't ask twice", () => {
    t.handle(ev("PermissionRequest", { tool: "Bash", detail: "rm -rf dist" }));
    t.handle(ev("Notification", { message: "Claude needs your permission to use Bash", kind: "permission_prompt" }));
    expect(calls.filter((c) => c === "notify")).toHaveLength(1);
  });

  it("nudges a pending permission every 45 s, three times at most", () => {
    t.handle(ev("PermissionRequest", { tool: "Bash" }));
    for (let i = 0; i < 6; i++) {
      clock += 45_000;
      t.sweep();
    }
    expect(calls.filter((c) => c === "notify")).toHaveLength(4); // the ask + 3 nudges
  });
});

describe("other endings", () => {
  it("a failed tool call is still work; StopFailure is the error", () => {
    t.handle(ev("UserPromptSubmit"));
    t.handle(ev("PreToolUse", { tool: "Grep", detail: "nothing" }));
    t.handle(ev("PostToolUseFailure", { tool: "Grep" }));
    expect(calls).toEqual(["startWork"]);
    t.handle(ev("StopFailure", { error: "API error" }));
    expect(calls).toEqual(["startWork", "finish:error"]);
    expect(shown.at(-1)).toMatchObject({ kind: "error", text: "Stopped with an error", detail: "API error" });
    expect(t.snapshot()[0].history[0]).toMatchObject({ outcome: "error", steps: [{ tool: "Grep", failed: true }] });
  });

  it("closing a busy session stops work without a celebration, and stays listed as closed", () => {
    t.handle(ev("UserPromptSubmit", { prompt: "long job" }));
    t.handle(ev("SessionEnd"));
    expect(calls).toEqual(["startWork", "cancelWork"]);
    expect(t.snapshot()[0]).toMatchObject({ status: "ended", history: [{ outcome: "cancelled" }] });
    clock += 31 * 60_000;
    t.sweep();
    expect(t.snapshot()).toHaveLength(0);
  });

  it("a session that goes silent for 10 minutes is dropped from work", () => {
    t.handle(ev("UserPromptSubmit"));
    clock += 11 * 60_000;
    t.sweep();
    expect(t.busyCount()).toBe(0);
    expect(calls.at(-1)).toBe("cancelWork");
  });

  it("stays quiet about 'waiting for input' right after finishing", () => {
    t.handle(ev("UserPromptSubmit"));
    t.handle(ev("Stop"));
    const before = shown.length;
    clock += 60_000;
    t.handle(ev("Notification", { message: "Claude is waiting for your input", kind: "idle_prompt" }));
    expect(shown).toHaveLength(before);
  });
});

describe("stopped by the user", () => {
  it("an Interrupt ends the turn quietly: no done, no error, not working any more", () => {
    t.handle(ev("UserPromptSubmit", { agent: "codex", prompt: "Refactor the API" }));
    step("Edit", `${CWD}\src\api.ts`);
    t.handle(ev("Interrupt", { agent: "codex" }));
    expect(calls).toEqual(["startWork", "cancelWork"]);
    expect(shown).toEqual([]);
    const [view] = t.snapshot();
    expect(view.status).toBe("idle");
    expect(view.history[0]).toMatchObject({ prompt: "Refactor the API", outcome: "cancelled" });
  });

  it("Command Code waiting for its terminal permission shows the command, then clears when it runs", () => {
    const cc = (event: string, extra: Partial<AgentEvent> = {}) => ev(event, { agent: "commandcode", ...extra });
    t.handle(cc("UserPromptSubmit", { prompt: "Clean the build" }));
    t.handle(cc("Notification", { kind: "permission_prompt", tool: "Bash", detail: "rm -rf dist", message: "Command Code needs your permission. Answer in its terminal." }));
    expect(t.snapshot()[0].status).toBe("waiting");
    expect(t.snapshot()[0].permission).toMatchObject({ tool: "Bash", detail: "rm -rf dist", rid: null });
    t.handle(cc("PreToolUse", { tool: "Bash", detail: "rm -rf dist" }));
    expect(t.snapshot()[0].status).toBe("working");
    expect(t.snapshot()[0].permission).toBeNull();
  });
});

describe("several sessions", () => {
  it("only the last one to finish makes the character celebrate; waiting ones sort first", () => {
    t.handle(ev("UserPromptSubmit", { session: "a" }));
    t.handle(ev("UserPromptSubmit", { session: "b", cwd: "C:\\code\\blog" }));
    t.handle(ev("PermissionRequest", { session: "b", cwd: "C:\\code\\blog", tool: "Bash" }));
    expect(t.snapshot().map((s) => s.project)).toEqual(["blog", "shop"]);
    t.handle(ev("Stop", { session: "a" }));
    expect(calls).not.toContain("finish:1");
    t.handle(ev("Stop", { session: "b", cwd: "C:\\code\\blog" }));
    expect(calls).toContain("finish:1");
    expect(shown.at(-1)?.title).toBe("Claude Code · blog");
  });
});

describe("describeStep", () => {
  it.each([
    ["Edit", "src/cart.ts", "Editing cart.ts"],
    ["Bash", "npm test", "Running npm test"],
    ["Grep", "toFixed", "Searching for toFixed"],
    ["Read", "C:\\a\\b.md", "Reading b.md"],
    ["mcp__playwright__browser_navigate", null, "Playwright · browser navigate"],
    ["mcp__chrome-devtools__take_screenshot", null, "Chrome devtools · take screenshot"],
    ["mcp_odd", null, "mcp_odd"],
  ])("%s %s → %s", (tool, detail, text) => {
    expect(describeStep({ tool, detail, at: 0 })).toBe(text);
  });
});

describe("0.4: questions, Always, today's totals", () => {
  const questions = [
    { question: "Which framework?", header: "Framework", multiSelect: false, options: [{ label: "React" }, { label: "Vue" }] },
  ];

  it("shows Claude's question with its options while it can be answered here", () => {
    t.handle(ev("UserPromptSubmit", { prompt: "Set up the app" }));
    t.handle(ev("PreToolUse", { tool: "AskUserQuestion", rid: "q1", questions }));
    const card = shown.at(-1)!;
    expect(card).toMatchObject({ category: "agent-permission", request: "q1", sticky: true, text: "Has a question for you:" });
    expect(card.questions?.[0].options.map((o) => o.label)).toEqual(["React", "Vue"]);
    const s = t.snapshot()[0];
    expect(s.status).toBe("waiting");
    expect(s.current?.steps.at(-1)?.tool).toBe("AskUserQuestion");
    expect(describeStep(s.current!.steps.at(-1)!)).toBe("Asking you a question");

    expect(t.answered("q1")).toBe(true);
    expect(t.snapshot()[0].status).toBe("working");
    expect(hidden).toContain("permission:s1");
    expect(t.answered("q1")).toBe(false);
  });

  it("falls back to the terminal for a question when the relay lets go", () => {
    t.handle(ev("PreToolUse", { tool: "AskUserQuestion", rid: "q2", questions }));
    t.permissionClosed("q2");
    const card = shown.at(-1)!;
    expect(card.questions).toBeUndefined();
    expect(card.meta).toBe("Answer in your terminal");
    expect(card.detail).toBe("Which framework?");
  });

  it("offers Always only when the agent suggested a rule", () => {
    t.handle(ev("PermissionRequest", { tool: "Bash", detail: "npm run lint", rid: "p1", canAlways: true }));
    expect(shown.at(-1)).toMatchObject({ request: "p1", always: true });
    expect(t.answer("p1", "always")).toBe(true);
    expect(t.snapshot()[0].status).toBe("working");

    t.handle(ev("PermissionRequest", { tool: "Bash", detail: "rm -rf dist", rid: "p2" }));
    expect(shown.at(-1)?.always).toBe(false);
  });

  it("keeps the agent's window processes from the latest event that has them", () => {
    t.handle(ev("SessionStart", { procs: [40, 30, 20] }));
    t.handle(ev("PreToolUse", { tool: "Bash", detail: "ls" }));
    expect(t.snapshot()[0].procs).toEqual([40, 30, 20]);
  });

  it("counts today's finished and failed tasks, work time and waits, and survives a restart", () => {
    let saved: unknown = null;
    const store = { load: () => saved as never, save: (s: unknown) => { saved = structuredClone(s); } };
    clock = new Date(2026, 9, 9, 10, 0).getTime();
    t = new AgentTracker(character, { show: () => {}, hide: () => {} }, () => clock, store);
    t.handle(ev("UserPromptSubmit", { prompt: "one" }));
    t.handle(ev("PermissionRequest", { tool: "Bash", detail: "x", rid: "r" }));
    t.handle(ev("Notification", { kind: "permission_prompt", message: "needs permission" })); // same wait, not counted twice
    clock += 60_000;
    t.handle(ev("Stop"));
    t.handle(ev("UserPromptSubmit", { prompt: "two" }));
    clock += 30_000;
    t.handle(ev("StopFailure", { error: "boom" }));
    expect(t.today()).toMatchObject({ done: 1, failed: 1, asks: 1, workMs: 90_000, date: "2026-10-09" });

    const again = new AgentTracker(character, { show: () => {}, hide: () => {} }, () => clock, store);
    expect(again.today().done).toBe(1);
    clock = new Date(2026, 9, 10, 9, 0).getTime();
    expect(again.today()).toMatchObject({ done: 0, failed: 0, date: "2026-10-10" });
  });
});

describe("IDEs", () => {
  it("Cursor's reply, sent before its stop, becomes the done summary", () => {
    const cur = (event: string, extra: Partial<AgentEvent> = {}) => ev(event, { agent: "cursor", ...extra });
    t.handle(cur("UserPromptSubmit", { prompt: "Rename the store" }));
    step("Edit", `${CWD}\src\store.ts`);
    t.handle(cur("AgentResponse", { summary: "Renamed **store** to cart everywhere." }));
    t.handle(cur("Stop"));
    expect(shown.at(-1)).toMatchObject({ kind: "success", text: "Done: Rename the store", detail: "Renamed store to cart everywhere." });
    expect(t.snapshot()[0].history[0].summary).toBe("Renamed store to cart everywhere.");
  });

  it("Antigravity: steps arrive once done, and a start without a prompt doesn't cut the task short", () => {
    const ag = (event: string, extra: Partial<AgentEvent> = {}) => ev(event, { agent: "antigravity", ...extra });
    t.handle(ag("UserPromptSubmit"));
    t.handle(ag("ToolUsed", { tool: "Read", detail: `${CWD}\\README.md` }));
    t.handle(ag("UserPromptSubmit"));
    t.handle(ag("ToolUsed", { tool: "Bash", detail: "cargo check", error: "exit code 101" }));
    t.handle(ag("Stop"));
    const [view] = t.snapshot();
    expect(view.history).toHaveLength(1);
    expect(view.history[0].outcome).toBe("done");
    expect(view.history[0].steps.map((s) => [s.tool, s.detail, Boolean(s.failed)])).toEqual([
      ["Read", "README.md", false],
      ["Bash", "cargo check", true],
    ]);
    expect(shown.at(-1)).toMatchObject({ kind: "success", title: "Antigravity · shop", text: "Done" });
  });

  it("a new prompt with its text still starts a new task", () => {
    t.handle(ev("UserPromptSubmit", { prompt: "One" }));
    t.handle(ev("UserPromptSubmit", { prompt: "Two" }));
    expect(t.snapshot()[0].history[0]).toMatchObject({ prompt: "One", outcome: "cancelled" });
  });
});

describe("live diffs", () => {
  const edited = (tool: string, file: string, edits: AgentEvent["edits"]) => {
    t.handle(ev("PreToolUse", { tool, detail: file }));
    t.handle(ev("PostToolUse", { tool, detail: file, edits }));
  };

  it("adds up the lines changed per file and shows the total in the summary", () => {
    t.handle(ev("UserPromptSubmit", { prompt: "Fix totals" }));
    edited("Edit", `${CWD}/src/cart.ts`, [{ old: "a\nb", new: "a\nc\nd" }]);
    edited("Edit", `${CWD}/src/cart.ts`, [{ old: "x", new: "y" }]);
    edited("Write", `${CWD}/src/new.ts`, [{ old: null, new: "1\n2\n3" }]);
    clock = 5_000;
    t.handle(ev("Stop", { summary: "Done." }));

    const turn = t.snapshot()[0].history[0];
    expect(turn.changes.map((c) => [c.path, c.add, c.del])).toEqual([
      ["src/cart.ts", 3, 2],
      ["src/new.ts", 3, 0],
    ]);
    expect(turn.files).toEqual(["src/cart.ts", "src/new.ts"]);
    expect(shown.at(-1)?.meta).toBe("5s · 2 files edited · +6 −2");
  });

  it("shows no line counts when the relay sent no edit text", () => {
    t.handle(ev("UserPromptSubmit", { prompt: "Fix" }));
    step("Edit", `${CWD}/src/cart.ts`);
    clock = 5_000;
    t.handle(ev("Stop", { summary: "Done." }));
    expect(t.snapshot()[0].history[0].changes).toEqual([]);
    expect(shown.at(-1)?.meta).toBe("5s · 1 file edited");
  });
});
