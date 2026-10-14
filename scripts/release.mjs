#!/usr/bin/env node
// Makes a release of both apps: the Windows installer with its update signature and
// latest.json, and the signed Android APK with its android.json — all in
// release/<version>/, ready to upload to the address given here. Installed copies of
// this release look for updates at <address>/latest.json (Windows) and
// <address>/android.json (Android).
//
//   node scripts/release.mjs --url https://example.com/desk-companion
//   node scripts/release.mjs --github owner/repo [--publish]
//   add --skip-android or --skip-windows to build only one; the other one's file
//   is carried over from the current release, so its installs keep working.
//   add --allow-dirty to publish with uncommitted changes (normally refused).
//
// One release is one tag, v<desktop version>; bump it (and the changelog) every time.
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
//
// The Android APK is signed with android/keystore.properties (see docs/RELEASING.md).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const has = (name) => process.argv.includes(name);
const skipAndroid = has("--skip-android");
const skipWindows = has("--skip-windows");
if (skipAndroid && skipWindows) {
  console.error("Nothing to build: --skip-android and --skip-windows together.");
  process.exit(2);
}
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

// Publishing: refuse before the long build if it would go wrong at the end.
const publish = Boolean(github) && has("--publish");
if (publish) {
  const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: "utf8" });
  if (!has("--allow-dirty") && run("git", ["status", "--porcelain"]).stdout.trim()) {
    console.error("There are uncommitted changes. Commit them first so the release matches the code (or --allow-dirty).");
    process.exit(1);
  }
  run("git", ["fetch", "--quiet"]);
  const behind = run("git", ["rev-list", "--count", "HEAD..@{u}"]).stdout.trim();
  if (behind && behind !== "0") {
    console.error(`This branch is ${behind} commit(s) behind origin. git pull first, so two machines don't release different code.`);
    process.exit(1);
  }
  const exists = run("gh", ["release", "view", `v${conf.version}`, "--repo", github]);
  if (exists.status === 0) {
    console.error(`Release v${conf.version} already exists on ${github}. Bump the version (all four manifests + CHANGELOG) and try again.`);
    process.exit(1);
  }
}

const out = path.join(root, "release", version);
mkdirSync(out, { recursive: true });
const files = []; // what gets uploaded

if (!skipWindows) buildWindows();
if (!skipAndroid) buildAndroid();
carryOver();

console.log(`
Release ready in ${path.relative(root, out)}:
${files.map((f) => "  " + f).join("\n")}`);

if (publish) {
  const gh = (args) => spawnSync("gh", args, { cwd: root, stdio: "inherit" });
  const tag = `v${version}`;
  const made = gh([
    "release", "create", tag, ...files.map((f) => path.join(out, f)),
    "--repo", github, "--title", `${product} ${version}`, "--notes", releaseNotes(version),
  ]);
  if (made.error || made.status !== 0) {
    console.error(`
Couldn't publish with gh (is it installed and logged in: gh auth login?). Upload the files above to ${tag} by hand.`);
    process.exit(1);
  }
  console.log(`
Published ${tag}. Installed copies check ${base}/latest.json (Windows) and ${base}/android.json (Android).`);
} else {
  console.log(`Upload them all to ${github ? `a GitHub release tagged v${version} on ${github}` : `${base}/`} (replacing the previous manifests).
Installed copies check ${base}/latest.json and ${base}/android.json and offer the update.`);
}

function buildWindows() {
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

  // The installer under a web-friendly name, and latest.json.
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
  files.push(fileName, "latest.json");
}

function buildAndroid() {
  const dir = path.join(root, "android");
  if (!existsSync(path.join(dir, "keystore.properties"))) {
    console.error("No Android release key: android/keystore.properties is missing (docs/RELEASING.md says how to set it up or copy it from your other machine).");
    process.exit(1);
  }
  const gradle = readFileSync(path.join(dir, "app", "build.gradle.kts"), "utf8");
  const code = Number(/versionCode\s*=\s*(\d+)/.exec(gradle)?.[1]);
  const name = /versionName\s*=\s*"([^"]+)"/.exec(gradle)?.[1];
  if (!code || !name) {
    console.error("Couldn't read versionCode/versionName from android/app/build.gradle.kts.");
    process.exit(1);
  }
  const updateUrl = `${base}/android.json`;
  console.log(`Building the Android app ${name} (code ${code}; updates from ${updateUrl})…`);
  const build = spawnSync(`"${path.join(dir, "build.cmd")}" assembleRelease "-PupdateUrl=${updateUrl}"`, { cwd: dir, stdio: "inherit", shell: true });
  if (build.status !== 0) process.exit(build.status ?? 1);

  const built = path.join(dir, "app", "build", "outputs", "apk", "release", "app-release.apk");
  if (!existsSync(built)) {
    console.error(`Expected a signed ${built} (an -unsigned one means the key wasn't used).`);
    process.exit(1);
  }
  const apkName = `DeskCompanion-Android-${name}.apk`;
  copyFileSync(built, path.join(out, apkName));
  const apk = readFileSync(built);
  const manifest = {
    versionCode: code,
    versionName: name,
    url: github ? `https://github.com/${github}/releases/download/v${version}/${apkName}` : `${base}/${apkName}`,
    sha256: createHash("sha256").update(apk).digest("hex"),
    size: statSync(built).size,
    notes: releaseNotes(version),
    pub_date: new Date().toISOString(),
  };
  writeFileSync(path.join(out, "android.json"), JSON.stringify(manifest, null, 2) + "\n");
  files.push(apkName, "android.json");
}

/**
 * When only one app was built, the other's manifest still has to be in this release (the apps
 * look at "latest"), so it is copied from the current latest release, pointing at the older files.
 */
function carryOver() {
  const missing = [skipWindows && "latest.json", skipAndroid && "android.json"].filter(Boolean);
  for (const file of missing) {
    if (!github) {
      console.log(`Note: ${file} is not part of this release; keep serving the previous one at ${base}/${file}.`);
      continue;
    }
    const got = spawnSync("gh", ["release", "download", "--repo", github, "--pattern", file, "--dir", out, "--clobber"], { cwd: root, stdio: "inherit" });
    if (got.status === 0 && existsSync(path.join(out, file))) files.push(file);
    else console.log(`Note: no earlier ${file} found on ${github}; that app has no update from this release.`);
  }
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
