// Connects Claude Code to the desktop companion.
//
//   node scripts/install-claude-hooks.mjs            install (or update)
//   node scripts/install-claude-hooks.mjs --remove   take our hooks out again
//
// 1. Copies the relay to %LOCALAPPDATA%\DeskCompanion\bin, so the hooks never
//    point at a build output that changes on every rebuild.
// 2. Backs up ~/.claude/settings.json (dated copy next to it).
// 3. Adds one hook group per event (async, except PermissionRequest, which
//    waits for the user's Allow / Deny). Everything else in the file —
//    other tools' hooks included — is kept as it was. Running it again
//    replaces our entries instead of duplicating them.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EVENTS = [
  "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "PermissionRequest", "Notification", "Stop", "StopFailure", "SessionEnd",
];
const MARK = "companion-hook.exe";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = join(root, "src-tauri", "target", "debug", MARK);
const binDir = join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "DeskCompanion", "bin");
const relay = join(binDir, MARK);
const settingsPath = join(homedir(), ".claude", "settings.json");
const remove = process.argv.includes("--remove");

const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
const before = JSON.stringify(settings, null, 2);

if (!remove) {
  if (!existsSync(built)) {
    console.error(`Relay not built yet: ${built}\nRun: cd src-tauri && cargo build -p companion-hook`);
    process.exit(1);
  }
  mkdirSync(binDir, { recursive: true });
  copyFileSync(built, relay);
  console.log(`Relay copied to ${relay}`);
}

const command = `"${relay.replaceAll("\\", "/")}"`;
const isOurs = (group) => group?.hooks?.some((h) => typeof h.command === "string" && h.command.includes(MARK));

settings.hooks ??= {};
for (const event of EVENTS) {
  const groups = (settings.hooks[event] ?? []).filter((g) => !isOurs(g));
  if (!remove) {
    // PermissionRequest waits (up to 110 s) for Allow / Deny clicked in the
    // companion, so it must run in the foreground with room to spare. Every
    // other event is fire-and-forget and never holds the agent up.
    const hook = event === "PermissionRequest"
      ? { type: "command", command, timeout: 120 }
      : { type: "command", command, timeout: 5, async: true };
    groups.push(/ToolUse|Permission/.test(event) ? { matcher: "*", hooks: [hook] } : { hooks: [hook] });
  }
  if (groups.length) settings.hooks[event] = groups;
  else delete settings.hooks[event];
}

const after = JSON.stringify(settings, null, 2);
if (after === before) {
  console.log("Claude Code settings already up to date.");
  process.exit(0);
}

if (existsSync(settingsPath)) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const backup = `${settingsPath}.bak-${stamp}`;
  copyFileSync(settingsPath, backup);
  console.log(`Backup: ${backup}`);
}
mkdirSync(dirname(settingsPath), { recursive: true });
writeFileSync(settingsPath, after + "\n");
console.log(`${remove ? "Removed" : "Installed"} companion hooks for: ${EVENTS.join(", ")}`);
