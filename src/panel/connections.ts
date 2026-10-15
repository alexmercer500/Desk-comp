// Whether each coding agent can really reach the app, in words and as a state,
// for the Activity tab's badges and setup card and for Settings → Coding agents.
// The data comes from Rust (connections.rs): when each agent was last heard
// from, and the last relay test.

import { invoke } from "@tauri-apps/api/core";

export interface AgentStatus {
  id: string;
  name: string;
  installed: boolean;
  connected: boolean;
  /** When the app last heard from it (ms since 1970), if ever. */
  lastHeard: number | null;
}

export interface RelayTest {
  ok: boolean;
  problem: string | null;
  at: number;
  ms: number;
}

export interface ConnectionsView {
  agents: AgentStatus[];
  relay: RelayTest | null;
  offerSetup: boolean;
}

/**
 * live: heard from in the last 15 minutes. heard: some time before.
 * quiet: connected, never heard from (new sessions load the hooks).
 * blocked: connected, but the relay test failed. off / missing: not connected.
 */
export type LinkState = "live" | "heard" | "quiet" | "blocked" | "off" | "missing";

const LIVE_FOR = 15 * 60_000;

export function linkState(a: AgentStatus, relay: RelayTest | null, now = Date.now()): LinkState {
  if (!a.connected) return a.installed ? "off" : "missing";
  if (relay && !relay.ok) return "blocked";
  if (a.lastHeard === null) return "quiet";
  return now - a.lastHeard < LIVE_FOR ? "live" : "heard";
}

/** "5 min ago", "3 h ago", "yesterday", "4 days ago". */
export function since(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** One line about an agent's connection, for Settings and the badges' tooltips. */
export function linkText(a: AgentStatus, relay: RelayTest | null, now = Date.now()): string {
  switch (linkState(a, relay, now)) {
    case "live":
    case "heard":
      return `Connected · last heard ${since(now - (a.lastHeard ?? now))}`;
    case "quiet":
      return "Connected · nothing heard yet. Start a new session (open ones don't load the hooks)";
    case "blocked":
      return "Connected, but it can't reach me (see the connection test)";
    case "off":
      return "Found on this PC · not connected";
    case "missing":
      return "Not found on this PC";
  }
}

export async function loadConnections(): Promise<ConnectionsView | null> {
  try {
    return await invoke<ConnectionsView>("agent_connections");
  } catch {
    return null;
  }
}

// ── Drawing (the Activity tab and the app window) ───────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

const AGENT_SHORT: Record<string, string> = { copilot: "Copilot", "claude-code": "Claude Code", commandcode: "Command Code" };

/** One badge per connected agent, a warning first if agents can't reach the app; null when none is connected. */
export function renderBadges(c: ConnectionsView, onClick: (agent: string) => void): HTMLElement | null {
  const shown = c.agents.filter((a) => a.connected);
  if (shown.length === 0) return null;
  const box = el("div", "links");
  box.setAttribute("aria-label", "Connected agents");
  if (c.relay && !c.relay.ok) {
    const warn = el("p", "links-warn");
    warn.append(el("b", undefined, "Your agents can't reach me. "), c.relay.problem ?? "");
    box.append(warn);
  }
  const now = Date.now();
  for (const a of shown) {
    const b = el("button", "link-badge");
    b.type = "button";
    b.dataset.state = linkState(a, c.relay, now);
    b.title = `${a.name}: ${linkText(a, c.relay, now)}`;
    b.append(el("span", "link-dot"), AGENT_SHORT[a.id] ?? a.name);
    b.addEventListener("click", () => onClick(a.id));
    box.append(b);
  }
  return box;
}

/**
 * "Connect your coding agents": while none is connected and some are on this
 * PC (`offerSetup`), then what connecting did until it's put away.
 */
export class SetupCard {
  private connecting = false;
  private result: { text: string; ok: boolean } | null = null;

  constructor(
    /** Draw again (the card changed). */
    private redraw: () => void,
    /** "Choose in Settings". */
    private choose: () => void,
    /** Fresh status after connecting. */
    private reload: () => Promise<ConnectionsView | null>,
  ) {}

  render(c: ConnectionsView): HTMLElement | null {
    if (!c.offerSetup && !this.result) return null;
    const card = el("section", "setup-card");
    card.setAttribute("aria-label", "Connect your coding agents");
    const row = el("div", "setup-actions");
    if (this.result) {
      card.append(el("strong", undefined, this.result.ok ? "All set" : "Almost there"));
      card.append(el("p", this.result.ok ? undefined : "setup-problem", this.result.text));
      const done = el("button", "act", "OK");
      done.type = "button";
      done.addEventListener("click", () => {
        this.result = null;
        this.redraw();
      });
      row.append(done);
      card.append(row);
      return card;
    }
    const found = c.agents.filter((a) => a.installed);
    card.append(el("strong", undefined, "Connect your coding agents"));
    card.append(
      el("p", undefined, `Found on this PC: ${found.map((a) => a.name).join(", ")}. I'll add my hooks (backing up their settings first) and test that they reach me.`),
    );
    const go = el("button", "act allow", this.connecting ? "Connecting…" : "Connect them");
    go.type = "button";
    go.disabled = this.connecting;
    go.addEventListener("click", () => void this.connect());
    const choose = el("button", "act", "Choose in Settings");
    choose.type = "button";
    choose.addEventListener("click", () => this.choose());
    const later = el("button", "act", "Not now");
    later.type = "button";
    later.addEventListener("click", async () => {
      await invoke("set_setting", { key: "agentSetupDismissed", value: true }).catch(() => {});
      await this.reload();
      this.redraw();
    });
    row.append(go, choose, later);
    card.append(row);
    return card;
  }

  private async connect() {
    this.connecting = true;
    this.redraw();
    try {
      const text = await invoke<string>("connect_found_agents");
      const fresh = await this.reload();
      this.result = { text, ok: fresh?.relay?.ok !== false };
    } catch (e) {
      this.result = { text: String(e), ok: false };
    }
    this.connecting = false;
    this.redraw();
  }
}
