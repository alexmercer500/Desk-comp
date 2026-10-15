#!/usr/bin/env node
// Checks that this PC can make a release, and that its keys are the real ones
// (the ones installed copies trust), without building or publishing anything.
// Run it on a new release machine after copying the keys (docs/RELEASE-MACHINE-SETUP.md),
// and whenever a release fails for key reasons. It never prints a secret.
//
//   node scripts/check-release-keys.mjs

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The Android release certificate every published APK is signed with (SHA-256, as apksigner and keytool print it). */
const ANDROID_CERT = "8f4049d1ff860da95479d4a7ec4e74d465a0fcefb1599ecde8cd0158747659a9";
const RELEASES = "alexmercer500/Desk-comp-releases";

let failed = 0;
const ok = (what) => console.log(`  ok    ${what}`);
const bad = (what, fix) => {
  failed++;
  console.log(`  FAIL  ${what}\n        → ${fix}`);
};
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32", ...opts });

/** The minisign key id (as printed in the public key's comment) inside a base64 key or signature line. */
const keyId = (b64Line) => Buffer.from(b64Line, "base64").subarray(2, 10).reverse().toString("hex").toUpperCase();

console.log("Windows update key");
{
  const conf = JSON.parse(readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  const trusted = keyId(Buffer.from(conf.plugins.updater.pubkey, "base64").toString().split("\n")[1]);
  const keyFile = process.env.TAURI_SIGNING_PRIVATE_KEY ? null : path.join(os.homedir(), ".tauri", "desk-companion-updater.key");
  if (keyFile && !existsSync(keyFile)) {
    bad(`no key at ${keyFile}`, "copy desk-companion-updater.key from your backup there (docs/RELEASE-MACHINE-SETUP.md, step 4)");
  } else {
    // Sign a scrap file and see which key the signature says it came from.
    const dir = mkdtempSync(path.join(os.tmpdir(), "keycheck-"));
    const scrap = path.join(dir, "scrap.txt");
    writeFileSync(scrap, "key check\n");
    const args = ["tauri", "signer", "sign", ...(keyFile ? ["-f", `"${keyFile}"`] : []), "-p", `"${process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? ""}"`, `"${scrap}"`];
    const r = run("npx", args, { cwd: root });
    const sigFile = `${scrap}.sig`;
    if (r.status !== 0 || !existsSync(sigFile)) {
      bad("the key couldn't sign (damaged copy, or it has a password)", "copy the key file again, byte for byte; if it has a password, set TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
    } else {
      const sig = Buffer.from(readFileSync(sigFile, "utf8").trim(), "base64").toString().split("\n")[1];
      const id = keyId(sig);
      if (id === trusted) ok(`signs as key ${id}, the one installed copies trust`);
      else bad(`signs as key ${id}, but installed copies trust ${trusted}`, "this is a different key: never publish with it; copy the real one from your backup");
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("Android release key");
{
  const props = path.join(root, "android", "keystore.properties");
  if (!existsSync(props)) {
    bad("android/keystore.properties is missing", "create it (docs/RELEASE-MACHINE-SETUP.md, step 4)");
  } else {
    const p = Object.fromEntries(
      readFileSync(props, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
    const missing = ["storeFile", "storePassword", "keyAlias", "keyPassword"].filter((k) => !p[k]);
    if (missing.length) bad(`keystore.properties lacks ${missing.join(", ")}`, "fill in all four lines");
    else if (!existsSync(p.storeFile)) bad(`storeFile points at ${p.storeFile}, which doesn't exist`, "copy android-release.jks there, or fix the path (use forward slashes)");
    else {
      const keytool = path.join(process.env.LOCALAPPDATA ?? "", "Android", "jdk17", "bin", "keytool.exe");
      const tool = existsSync(keytool) ? `"${keytool}"` : "keytool";
      // Passwords go through the environment, never the command line.
      const r = run(tool, ["-list", "-v", "-keystore", `"${p.storeFile}"`, "-alias", `"${p.keyAlias}"`, "-storepass:env", "DC_STOREPASS"], {
        env: { ...process.env, DC_STOREPASS: p.storePassword },
      });
      const sha = /SHA256:\s*([0-9A-F:]+)/i.exec(r.stdout ?? "")?.[1]?.replaceAll(":", "").toLowerCase();
      if (r.status !== 0 || !sha) bad("keytool couldn't open the keystore (wrong storePassword or keyAlias, or JDK 17 missing)", "check the four values against your backup");
      else if (sha === ANDROID_CERT) ok("the keystore holds the certificate every published APK is signed with");
      else bad(`the keystore's certificate is ${sha.slice(0, 16)}…, not the published one`, "this is a different key: phones would refuse its APK; copy the real android-release.jks");
    }
  }
}

console.log("Relay address");
{
  const env = path.join(root, ".env");
  const line = existsSync(env) ? readFileSync(env, "utf8").split(/\r?\n/).find((l) => l.startsWith("DESK_COMPANION_RELAY=")) : undefined;
  const value = line?.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "");
  if (value?.startsWith("https://")) ok("DESK_COMPANION_RELAY is set in .env");
  else bad("no DESK_COMPANION_RELAY=https://… in .env", "copy .env from your backup to the repo root (without it, the phone link only works on the same Wi-Fi)");
}

console.log("Tools");
{
  for (const [cmd, args, name] of [
    ["node", ["--version"], "Node"],
    ["cargo", ["--version"], "Rust"],
    ["gh", ["--version"], "GitHub CLI"],
  ]) {
    const r = run(cmd, args);
    if (r.status === 0) ok(`${name}: ${(r.stdout ?? "").split("\n")[0].trim()}`);
    else bad(`${name} not found`, `install it (docs/RELEASE-MACHINE-SETUP.md, step 2)`);
  }
  const sdk = path.join(process.env.LOCALAPPDATA ?? "", "Android");
  if (existsSync(path.join(sdk, "jdk17", "bin", "java.exe")) && existsSync(path.join(sdk, "Sdk", "platforms", "android-35"))) ok("JDK 17 and Android SDK 35 under %LOCALAPPDATA%\\Android");
  else bad("JDK 17 or Android SDK 35 missing under %LOCALAPPDATA%\\Android", "install them there (step 2); android\\build.cmd looks only in that folder");
  const auth = run("gh", ["api", `repos/${RELEASES}`, "--jq", ".permissions.push"]);
  if ((auth.stdout ?? "").trim() === "true") ok(`gh is logged in and can publish to ${RELEASES}`);
  else bad(`gh can't publish to ${RELEASES}`, "run gh auth login with the account that owns the repo");
}

console.log(failed ? `\n${failed} problem(s): fix them before releasing.` : "\nAll good: this PC can release.");
process.exit(failed ? 1 : 0);
