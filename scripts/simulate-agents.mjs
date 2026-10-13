// Plays a short session from each coding agent into the running Desk
// Companion, the way each agent really calls us: our hook command, run through
// that agent's own shell on Windows (cmd for Codex, PowerShell for Gemini CLI
// and Copilot CLI), with payloads in that agent's own shape. Command Code goes
// through our actual mod (integrations/commandcode-mod.ts) with a stand-in for
// its API. The IDEs too: Cursor (started directly, as Cursor seems to), Antigravity
// (cmd) and VS Code's agent (Windows PowerShell). Watch the companion while it runs.
//
//   node scripts/simulate-agents.mjs                 every agent
//   node scripts/simulate-agents.mjs gemini codex    just these
//   node scripts/simulate-agents.mjs --question      Command Code also asks a question (answer it in the companion)
//
// Each session's project is called sim-<agent>. These count towards today's totals.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELAY = join(process.env.LOCALAPPDATA ?? "", "DeskCompanion", "bin", "companion-hook.exe").replace(/\\/g, "/");
if (!existsSync(RELAY)) throw new Error(`No relay at ${RELAY}: start Desk Companion once first.`);
const BASH = ["C:/Program Files/Git/bin/bash.exe", "C:/Program Files (x86)/Git/bin/bash.exe"].find(existsSync);

const args = process.argv.slice(2);
const ask = args.includes("--question");
const wanted = args.filter((a) => !a.startsWith("--"));
const pick = (name) => wanted.length === 0 || wanted.includes(name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36);

/** Runs one hook command the way `shell` would, with `payload` on stdin. Returns what it printed. */
function run(shell, command, payload) {
  const input = JSON.stringify(payload);
  let r;
  if (shell === "direct") {
    const [exe, ...rest] = command.split(" ");
    r = spawnSync(exe, rest, { input, encoding: "utf8" });
  } else if (shell === "cmd") {
    r = spawnSync("cmd.exe", ["/d", "/s", "/c", `"${command}"`], { input, encoding: "utf8", windowsVerbatimArguments: true });
  } else if (shell === "powershell") {
    r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { input, encoding: "utf8" });
  } else {
    if (!BASH) throw new Error("Git Bash not found");
    r = spawnSync(BASH, ["-c", command], { input, encoding: "utf8" });
  }
  if (r.status !== 0 || r.stderr?.trim()) {
    console.log(`  ! ${shell} exited ${r.status}: ${(r.stderr || "").trim().slice(0, 300)}`);
  }
  return r.stdout ?? "";
}

const quoted = `"${RELAY}"`;
const ps = (extra) => `& '${RELAY.replace(/'/g, "''")}' ${extra}`;

// ── Gemini CLI: PowerShell, its own event and field names ─────────────────────
async function gemini() {
  const base = { session_id: `sim-gemini-${stamp}`, cwd: "C:/code/sim-gemini" };
  const send = (said, extra = {}) => run("powershell", ps(`--agent gemini --event ${said}`), { ...base, ...extra });
  send("SessionStart", { hook_event_name: "SessionStart" });
  send("UserPromptSubmit", { hook_event_name: "BeforeAgent", prompt: "Add a dark mode toggle" });
  send("PreToolUse", { hook_event_name: "BeforeTool", tool_name: "read_file", tool_input: { absolute_path: "C:/code/sim-gemini/src/theme.ts" } });
  send("PostToolUse", { hook_event_name: "AfterTool", tool_name: "read_file" });
  await sleep(800);
  send("PreToolUse", { hook_event_name: "BeforeTool", tool_name: "run_shell_command", tool_input: { command: "npm test" } });
  send("PostToolUse", { hook_event_name: "AfterTool", tool_name: "run_shell_command" });
  await sleep(800);
  send("Stop", { hook_event_name: "AfterAgent", prompt_response: "Added a dark mode toggle to the header; tests pass." });
}

// ── GitHub Copilot CLI: PowerShell field, camelCase events, no event in the payload ──
async function copilot() {
  const base = { sessionId: `sim-copilot-${stamp}`, cwd: "C:/code/sim-copilot", timestamp: Date.now() };
  const send = (event, extra = {}) => run("powershell", ps(`--agent copilot --event ${event}`), { ...base, ...extra });
  send("sessionStart", { source: "new" });
  send("userPromptSubmitted", { prompt: "Rename the user service" });
  send("preToolUse", { toolName: "edit", toolArgs: JSON.stringify({ path: "src/user-service.ts" }) });
  send("postToolUse", { toolName: "edit", toolResult: { resultType: "success" } });
  await sleep(800);
  send("preToolUse", { toolName: "bash", toolArgs: JSON.stringify({ command: "npm run lint" }) });
  send("postToolUse", { toolName: "bash", toolResult: { resultType: "success" } });
  await sleep(800);
  send("agentStop", {});
}

// ── Codex: cmd, Claude Code-like payloads; a second turn interrupted with Esc ──
async function codex() {
  const base = { session_id: `sim-codex-${stamp}`, cwd: "C:/code/sim-codex" };
  const send = (event, extra = {}) => run("cmd", `${quoted} --agent codex`, { ...base, hook_event_name: event, ...extra });
  send("SessionStart", { source: "startup" });
  send("UserPromptSubmit", { prompt: "Explain the build script" });
  send("PreToolUse", { tool_name: "shell", tool_input: { command: ["bash", "-lc", "cat package.json"] } });
  send("PostToolUse", { tool_name: "shell" });
  await sleep(800);
  send("Stop", { last_assistant_message: "The build script compiles TypeScript, then bundles with Vite." });
  await sleep(1500);
  send("UserPromptSubmit", { prompt: "Now rewrite it in Rust" });
  send("PreToolUse", { tool_name: "shell", tool_input: { command: ["bash", "-lc", "cargo init"] } });
  await sleep(800);
  send("Interrupt", {});
}

// ── Claude Code: Git Bash (its hooks also run for real in any Claude Code session) ──
async function claude() {
  const base = { session_id: `sim-claude-${stamp}`, cwd: "C:/code/sim-claude", transcript_path: "" };
  const send = (event, extra = {}) => run("bash", quoted, { ...base, hook_event_name: event, ...extra });
  send("SessionStart", { source: "startup" });
  send("UserPromptSubmit", { prompt: "Fix the flaky login test" });
  send("PreToolUse", { tool_name: "Read", tool_input: { file_path: "C:/code/sim-claude/tests/login.test.ts" } });
  send("PostToolUse", { tool_name: "Read" });
  await sleep(800);
  send("Stop", {});
}

// ── Command Code: our mod, driven like Command Code drives it ──────────────────
async function commandcode() {
  const source = readFileSync(join(root, "integrations", "commandcode-mod.ts"), "utf8").replace('"__DESK_COMPANION_RELAY__"', JSON.stringify(RELAY));
  const file = join(tmpdir(), `desk-companion-mod-${stamp}.ts`);
  writeFileSync(file, source);
  try {
    const mod = await import(pathToFileURL(file).href);
    const on = {};
    const hooks = {};
    mod.default({ cwd: "C:/code/sim-commandcode", hooks: (h) => Object.assign(hooks, h), on: (e, f) => (on[e] = f) });
    const fire = (e, x = {}) => on[e]?.({ type: e, ...x });
    hooks.transformInput({ text: "Tidy the README" });
    fire("run_start", { sessionId: `sim-commandcode-${stamp}` });
    fire("tool_queued", { toolCallId: "1", toolName: "read_file", input: { path: "README.md" } });
    fire("tool_running", { toolCallId: "1", toolName: "read_file" });
    fire("tool_completed", { toolCallId: "1", toolName: "read_file" });
    // A command that waits for permission in the terminal…
    fire("tool_queued", { toolCallId: "2", toolName: "shell_command", input: { command: "git push" } });
    await sleep(3500);
    // …granted there.
    fire("tool_running", { toolCallId: "2", toolName: "shell_command" });
    fire("tool_completed", { toolCallId: "2", toolName: "shell_command" });
    if (ask) {
      console.log("  Command Code is asking a question: answer it in the companion (or press In terminal).");
      const r = await hooks.beforeToolCall({
        toolName: "ask_user_question",
        input: { questions: [{ question: "Which heading style?", header: "Style", options: [{ label: "Title Case" }, { label: "Sentence case" }] }] },
      });
      console.log(`  → the model gets: ${r ? JSON.stringify(r.additionalContext) : "nothing (asked in the terminal instead)"}`);
    }
    await sleep(800);
    fire("run_end", { result: { stopReason: "end_turn", finalText: "Tidied the README: shorter intro, fixed the install steps." } });
    // A second run that fails.
    fire("run_start", { sessionId: `sim-commandcode-${stamp}` });
    fire("run_error", { error: new Error("Model provider returned 529 (overloaded)") });
    fire("run_end", { result: { stopReason: "run_error" } });
    await sleep(2500); // let the mod's queue drain
  } finally {
    rmSync(file, { force: true });
  }
}

// ── Cursor: its own hooks.json, camelCase events, the reply before the stop ──
async function cursor() {
  const base = { conversation_id: `sim-cursor-${stamp}`, workspace_roots: ["C:/code/sim-cursor"], cursor_version: "2.0.0" };
  const send = (event, extra = {}) => run("direct", `${RELAY} --agent cursor --event ${event}`, { ...base, hook_event_name: event, ...extra });
  send("sessionStart", { session_id: `sim-cursor-${stamp}` });
  send("beforeSubmitPrompt", { prompt: "Add pagination to the orders page" });
  send("preToolUse", { tool_name: "Read", tool_input: { file_path: "C:/code/sim-cursor/src/orders.tsx" } });
  send("postToolUse", { tool_name: "Read" });
  await sleep(800);
  send("preToolUse", { tool_name: "Shell", tool_input: { command: "npm test" } });
  send("postToolUseFailure", { tool_name: "Shell", error_message: "1 test failed" });
  await sleep(800);
  send("afterAgentResponse", { text: "Added **pagination** (20 per page). One older test still expects 50 rows." });
  send("stop", { status: "completed" });
}

// ── Antigravity: a named group, camelCase fields, the tool in toolCall ───────
async function antigravity() {
  const base = { conversationId: `sim-antigravity-${stamp}`, workspacePaths: ["C:/code/sim-antigravity"] };
  const send = (event, extra = {}) => run("cmd", `${RELAY} --agent antigravity --event ${event}`, { ...base, ...extra });
  const replies = [];
  replies.push(send("PreInvocation", { invocationNum: 1 }));
  replies.push(send("PostToolUse", { toolCall: { name: "view_file", args: { AbsolutePath: "C:/code/sim-antigravity/main.go" } } }));
  await sleep(800);
  replies.push(send("PostToolUse", { toolCall: { name: "replace_file_content", args: { TargetFile: "C:/code/sim-antigravity/main.go" } } }));
  replies.push(send("PostToolUse", { toolCall: { name: "run_command", args: { CommandLine: "go test ./..." } }, error: "" }));
  await sleep(800);
  replies.push(send("Stop", { terminationReason: "model_stop", fullyIdle: true }));
  // Antigravity reads a JSON object back each time: never a decision.
  if (!replies.every((r) => r.trim() === "{}")) console.log(`  ! unexpected replies: ${JSON.stringify(replies)}`);
}

// ── VS Code's agent: Copilot's hook file, its `windows` command (PowerShell) ──
async function vscode() {
  const base = { session_id: `sim-vscode-${stamp}`, cwd: "C:/code/sim-vscode", timestamp: new Date().toISOString() };
  const send = (event, extra = {}) => run("powershell", ps(`--agent vscode --event ${event}`), { ...base, hook_event_name: event, ...extra });
  send("SessionStart", { source: "new" });
  send("UserPromptSubmit", { prompt: "Fix the date formatting bug" });
  send("PreToolUse", { tool_name: "read_file", tool_input: { filePath: "C:/code/sim-vscode/src/dates.ts" } });
  send("PostToolUse", { tool_name: "read_file" });
  await sleep(800);
  send("PreToolUse", { tool_name: "replace_string_in_file", tool_input: { filePath: "C:/code/sim-vscode/src/dates.ts" } });
  send("PostToolUse", { tool_name: "replace_string_in_file" });
  send("PreToolUse", { tool_name: "run_in_terminal", tool_input: { command: "npm test" } });
  send("PostToolUse", { tool_name: "run_in_terminal" });
  await sleep(800);
  send("Stop", { stop_hook_active: false });
}

const AGENTS = { claude, codex, gemini, copilot, commandcode, cursor, antigravity, vscode };
for (const [name, play] of Object.entries(AGENTS)) {
  if (!pick(name)) continue;
  console.log(`${name}…`);
  await play();
  await sleep(1000);
}
console.log("done");
// The mod's relay children are finished; nothing else keeps us alive.
void spawn;
