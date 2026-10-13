import { describe, expect, it } from "vitest";
import type { SessionView } from "../src/desktop/agents";
import { agentRows, agentStatus, islandState } from "../src/desktop/island";

const session = (over: Partial<SessionView>): SessionView => ({
  id: "s1",
  agent: "claude-code",
  project: "shop-app",
  cwd: "C:/Projects/shop-app",
  status: "idle",
  permission: null,
  current: null,
  history: [],
  lastEvent: 0,
  ...over,
});

const turn = (steps: { tool: string; detail: string | null }[]) => ({
  prompt: "Add checkout",
  startedAt: 0,
  endedAt: null,
  steps: steps.map((s) => ({ ...s, at: 0 })),
  files: [],
  commands: 0,
  summary: null,
  outcome: "working" as const,
});

describe("islandState", () => {
  it("tucks away when nothing is going on", () => {
    expect(islandState({ notice: false, status: null, hover: false, busy: false })).toBe("tucked");
  });

  it("peeks out on hover or while the character is doing something", () => {
    expect(islandState({ notice: false, status: null, hover: true, busy: false })).toBe("peek");
    expect(islandState({ notice: false, status: null, hover: false, busy: true })).toBe("peek");
  });

  it("shows the status line while an agent is busy, and lists the sessions on hover", () => {
    const status = { tone: "working" as const, text: "shop-app" };
    expect(islandState({ notice: false, status, hover: false, busy: true })).toBe("status");
    expect(islandState({ notice: false, status, hover: true, busy: false })).toBe("list");
  });

  it("grows into the notification whatever else is going on", () => {
    const status = { tone: "working" as const, text: "shop-app" };
    expect(islandState({ notice: true, status: null, hover: false, busy: false })).toBe("notice");
    expect(islandState({ notice: true, status, hover: true, busy: true })).toBe("notice");
  });
});

describe("agentStatus", () => {
  it("is empty when no agent is busy", () => {
    expect(agentStatus([])).toBeNull();
    expect(agentStatus([session({ status: "idle" }), session({ id: "s2", status: "ended" })])).toBeNull();
  });

  it("names the project and what it's doing now", () => {
    const s = session({ status: "working", current: turn([{ tool: "Read", detail: "src/cart.ts" }, { tool: "Edit", detail: "src/cart.ts" }]) });
    expect(agentStatus([s])).toEqual({ tone: "working", text: "shop-app", more: "Editing cart.ts" });
  });

  it("says Thinking… before the first step", () => {
    expect(agentStatus([session({ status: "working", current: turn([]) })])?.more).toBe("Thinking…");
  });

  it("counts several working sessions", () => {
    const a = session({ status: "working" });
    const b = session({ id: "s2", project: "blog", status: "working" });
    expect(agentStatus([a, b])).toEqual({ tone: "working", text: "2 agents working" });
  });

  it("puts a waiting permission first, with the others as +N", () => {
    const a = session({ status: "working" });
    const b = session({ id: "s2", project: "blog", status: "waiting" });
    expect(agentStatus([a, b])).toEqual({ tone: "attention", text: "blog needs your OK", more: "+1" });
  });
});

describe("agentRows", () => {
  it("lists busy sessions, the ones waiting for an OK first", () => {
    const working = session({ status: "working", current: turn([{ tool: "Bash", detail: "npm test" }]) });
    const waiting = session({
      id: "s2",
      project: "blog",
      status: "waiting",
      permission: { tool: "Bash", action: "run", detail: "npm install astro@5", since: 0, rid: null },
    });
    const idle = session({ id: "s3", project: "notes", status: "idle" });
    expect(agentRows([working, waiting, idle])).toEqual([
      { id: "s2", tone: "attention", project: "blog", line: "wants to run" },
      { id: "s1", tone: "working", project: "shop-app", line: "Running npm test" },
    ]);
  });
});
