#!/usr/bin/env node
// Windows code signing. Tauri runs this for every program it builds (the app,
// the installer, the uninstaller); the build runs it for the relay. With no
// certificate configured it signs nothing and says so, so ordinary builds work.
//
// Configure one of these (environment variables), then build as usual:
//   DESK_COMPANION_SIGN_PFX        path to a .pfx code-signing certificate
//   DESK_COMPANION_SIGN_PASSWORD   its password
// or
//   DESK_COMPANION_SIGN_THUMBPRINT a certificate already in your Windows
//                                  certificate store (e.g. on a USB token)
// Optional:
//   DESK_COMPANION_SIGN_TIMESTAMP  timestamp server (default DigiCert's), or "none"
//   DESK_COMPANION_SIGNTOOL        path to signtool.exe (found automatically otherwise)
//
// Usage: node scripts/sign.mjs <file>

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/sign.mjs <file>");
  process.exit(2);
}

const env = process.env;
const pfx = env.DESK_COMPANION_SIGN_PFX;
const thumbprint = env.DESK_COMPANION_SIGN_THUMBPRINT;
if (!pfx && !thumbprint) {
  console.log(`[sign] no certificate configured: ${path.basename(file)} left unsigned`);
  process.exit(0);
}
if (pfx && !existsSync(pfx)) {
  console.error(`[sign] DESK_COMPANION_SIGN_PFX points to a file that isn't there: ${pfx}`);
  process.exit(1);
}

/** signtool.exe: as configured, else the newest x64 one in the Windows SDK, else on PATH. */
function findSigntool() {
  if (env.DESK_COMPANION_SIGNTOOL) return env.DESK_COMPANION_SIGNTOOL;
  const kits = path.join(env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
  if (existsSync(kits)) {
    const versions = readdirSync(kits)
      .filter((v) => /^\d+\.\d+\.\d+\.\d+$/.test(v))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .reverse();
    for (const v of versions) {
      const tool = path.join(kits, v, "x64", "signtool.exe");
      if (existsSync(tool)) return tool;
    }
  }
  return "signtool.exe";
}

const timestamp = env.DESK_COMPANION_SIGN_TIMESTAMP ?? "http://timestamp.digicert.com";
const args = ["sign", "/fd", "SHA256", "/d", "Desk Companion"];
if (timestamp !== "none") args.push("/tr", timestamp, "/td", "SHA256");
if (thumbprint) args.push("/sha1", thumbprint);
else {
  args.push("/f", pfx);
  if (env.DESK_COMPANION_SIGN_PASSWORD) args.push("/p", env.DESK_COMPANION_SIGN_PASSWORD);
}
args.push(file);

try {
  execFileSync(findSigntool(), args, { stdio: ["ignore", "inherit", "inherit"] });
  console.log(`[sign] signed ${path.basename(file)}`);
} catch {
  console.error(`[sign] signing ${path.basename(file)} failed (see above)`);
  process.exit(1);
}
