// The session list sent to the phone (src/desktop/phone.ts).

import { beforeEach, describe, expect, it } from "vitest";
import { AgentTracker, type AgentEvent, type CharacterSink } from "../src/desktop/agents";
import { phoneView } from "../src/desktop/phone";

let clock = 0;
let t: AgentTracker;
const character: CharacterSink = {
  startWork: () => {},
  finishWork: () => {},
  cancelWork: () => {},
  notify: () => {},
  getState: () => "IDLE",
};
const CWD = "C:/code/shop";
const ev = (event: string, extra: Partial<AgentEvent> = {}): AgentEvent => ({
  agent: "claude-code", event, session: "s1", cwd: CWD, tool: null, detail: null, message: null, kind: null, ...extra,
});

beforeEach(() => {
  clock = 1_000;
  t = new AgentTracker(character, { show: () => {}, hide: () => {} }, () => clock);
});

describe("phoneView", () => {
  it("shows a working session with its current step", () => {
    t.handle(ev("UserPromptSubmit", { prompt: "Fix the cart" }));
    t.handle(ev("PreToolUse", { tool: "Edit", detail: `${CWD}/src/cart.ts` }));
    const [s] = phoneView(t.snapshot());
    expect(s).toMatchObject({ id: "s1", agent: "Claude Code", project: "shop", status: "working", prompt: "Fix the cart", approval: null });
    expect(s.line).toContain("cart.ts");
    expect(s.steps).toEqual([{ tool: "Edit", detail: "src/cart.ts", failed: false }]);
  });

  it("offers Allow / Deny for a permission the relay is holding", () => {
    t.handle(ev("UserPromptSubmit", { prompt: "Run tests" }));
    t.handle(ev("PermissionRequest", { tool: "Bash", detail: "npm test", rid: "r1", canAlways: true }));
    const [s] = phoneView(t.snapshot());
    expect(s.status).toBe("waiting");
    expect(s.line).toBe("Wants to run");
    expect(s.approval).toEqual({ rid: "r1", tool: "Bash", action: "run", detail: "npm test", canAlways: true });
  });

  it("doesn't offer it once only the terminal can answer, but does offer a question to answer", () => {
    t.handle(ev("PermissionRequest", { tool: "Bash", detail: "npm test", rid: "r1" }));
    t.permissionClosed("r1");
    expect(phoneView(t.snapshot())[0].approval).toBeNull();
    t.handle(ev("PreToolUse", { session: "s2", tool: "AskUserQuestion", rid: "q1", questions: [{ question: "Which?", multiSelect: false, options: [{ label: "A" }, { label: "B" }] }] }));
    const q = phoneView(t.snapshot()).find((x) => x.id === "s2")!;
    expect(q.status).toBe("waiting");
    expect(q.approval).toBeNull();
    expect(q.question).toEqual({
      rid: "q1",
      questions: [{ question: "Which?", header: null, multiSelect: false, options: [{ label: "A", description: null }, { label: "B", description: null }] }],
    });
    t.permissionClosed("q1");
    expect(phoneView(t.snapshot()).find((x) => x.id === "s2")!.question).toBeNull();
  });

  it("shows a finished task with its summary and changed files", () => {
    t.handle(ev("UserPromptSubmit", { prompt: "Add limits" }));
    t.handle(ev("PreToolUse", { tool: "Write", detail: `${CWD}/src/limit.ts` }));
    t.handle(ev("PostToolUse", { tool: "Write", detail: `${CWD}/src/limit.ts`, edits: [{ old: null, new: "a\nb" }] }));
    clock = 9_000;
    t.handle(ev("Stop", { summary: "Added a limiter.\nTests pass." }));
    const [s] = phoneView(t.snapshot());
    expect(s.status).toBe("done");
    expect(s.line).toBe("Added a limiter.");
    expect(s.summary).toBe("Added a limiter.\nTests pass."); // line breaks kept for the phone
    expect(s.files).toEqual([{ path: "src/limit.ts", add: 2, del: 0 }]);
  });

  it("keeps long text and long step lists short", () => {
    t.handle(ev("UserPromptSubmit", { prompt: "x".repeat(5000) }));
    for (let i = 0; i < 30; i++) t.handle(ev("PreToolUse", { tool: "Read", detail: `${CWD}/f${i}.ts` }));
    const [s] = phoneView(t.snapshot());
    expect(s.prompt!.length).toBe(1000);
    expect(s.steps).toHaveLength(20);
    expect(s.steps[19].detail).toBe("f29.ts");
  });
});
