#!/usr/bin/env node
// Makes a release: the installer, its update signature, and the latest.json
// the app checks for updates — all in release/<version>/, ready to upload to
// the address given here. Installed copies of this release look for updates
// at <address>/latest.json.
//
//   node scripts/release.mjs --url https://example.com/desk-companion
//   node scripts/release.mjs --github owner/repo [--publish]
//
// --github hosts the update on that repo's GitHub Releases (the repo and its
// releases must be public, or the app can't download them). The app looks at
// releases/latest/download/latest.json, and latest.json points at this
// version's own tag (v<version>), so older installs still get the right file.
// --publish then creates the release with the GitHub CLI (gh) and uploads both
// files; without it the files are just left in release/<version>/.
//
// Needs the update key (made once with `npx tauri signer generate`):
//   TAURI_SIGNING_PRIVATE_KEY           the key, or a path to it
//                                       (default: ~/.tauri/desk-companion-updater.key)
//   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  its password, if it has one
// Windows code signing, if configured, happens on the way (scripts/sign.mjs).

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const github = arg("--github");
if (github && !/^[\w.-]+\/[\w.-]+$/.test(github)) {
  console.error("--github takes owner/repo, e.g. --github tops/desk-companion");
  process.exit(2);
}
const base = (github
  ? `https://github.com/${github}/releases/latest/download`
  : (arg("--url") ?? process.env.DESK_COMPANION_UPDATE_BASE ?? "")
).replace(/\/+$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("usage: node scripts/release.mjs --url https://<where you'll upload the release>");
  console.error("   or: node scripts/release.mjs --github owner/repo [--publish]");
  process.exit(2);
}
if (base.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base)) {
  console.error("Updates must be served over https (http only for a local test).");
  process.exit(2);
}

const conf = JSON.parse(readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const version = conf.version;
const product = conf.productName;

// The update key.
const env = { ...process.env };
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  const keyFile = path.join(os.homedir(), ".tauri", "desk-companion-updater.key");
  if (!existsSync(keyFile)) {
    console.error(`No update key: set TAURI_SIGNING_PRIVATE_KEY or create ${keyFile} (npx tauri signer generate -w "${keyFile}").`);
    process.exit(1);
  }
  env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyFile, "utf8").trim();
}
env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
// Baked into the app: where it looks for updates.
env.DESK_COMPANION_UPDATE_URL = `${base}/latest.json`;

// Build, with the update artifacts (installer signature) this time.
const override = path.join(os.tmpdir(), `desk-companion-release-${process.pid}.json`);
writeFileSync(override, JSON.stringify({ bundle: { createUpdaterArtifacts: true } }));
console.log(`Building ${product} ${version} (updates from ${env.DESK_COMPANION_UPDATE_URL})…`);
const build = spawnSync(`npx tauri build --config "${override}"`, { cwd: root, env, stdio: "inherit", shell: true });
rmSync(override, { force: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const nsis = path.join(root, "src-tauri", "target", "release", "bundle", "nsis");
const installer = path.join(nsis, `${product}_${version}_x64-setup.exe`);
const signature = `${installer}.sig`;
for (const f of [installer, signature]) {
  if (!existsSync(f)) {
    console.error(`Expected ${f} after the build.`);
    process.exit(1);
  }
}

// release/<version>/: the installer under a web-friendly name, and latest.json.
const out = path.join(root, "release", version);
mkdirSync(out, { recursive: true });
const fileName = `DeskCompanion_${version}_x64-setup.exe`;
copyFileSync(installer, path.join(out, fileName));
const manifest = {
  version,
  notes: releaseNotes(version),
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: readFileSync(signature, "utf8").trim(),
      // On GitHub the installer lives under this version's own tag.
      url: github ? `https://github.com/${github}/releases/download/v${version}/${fileName}` : `${base}/${fileName}`,
    },
  },
};
writeFileSync(path.join(out, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log(`
Release ready in ${path.relative(root, out)}:
  ${fileName}
  latest.json`);

if (github && process.argv.includes("--publish")) {
  const gh = (args) => spawnSync("gh", args, { cwd: root, stdio: "inherit" });
  const tag = `v${version}`;
  const made = gh([
    "release", "create", tag, path.join(out, fileName), path.join(out, "latest.json"),
    "--repo", github, "--title", `${product} ${version}`, "--notes", manifest.notes,
  ]);
  if (made.error || made.status !== 0) {
    console.error(`
Couldn't publish with gh (is it installed and logged in: gh auth login?). Upload the two files to ${tag} by hand.`);
    process.exit(1);
  }
  console.log(`
Published ${tag}. Installed copies check ${base}/latest.json.`);
} else {
  console.log(`Upload both to ${github ? `a GitHub release tagged v${version} on ${github}` : `${base}/`} (replacing the previous latest.json).
Installed copies check ${base}/latest.json and offer the update.`);
}

/** This version's section of CHANGELOG.md, as plain text. */
function releaseNotes(v) {
  const log = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const start = log.indexOf(`## ${v} `);
  if (start < 0) return `Desk Companion ${v}`;
  const rest = log.slice(start).split("\n").slice(1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return rest
    .slice(0, end < 0 ? undefined : end)
    .join("\n")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}
