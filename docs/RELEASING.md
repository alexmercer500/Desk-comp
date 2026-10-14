# Releasing

One command builds both apps and publishes them. Installed copies find the update themselves.

```
node scripts/release.mjs --github alexmercer500/Desk-comp-releases --publish
```

It builds the signed Windows installer (`latest.json`) and the signed Android APK (`android.json`),
then creates the GitHub release `v<desktop version>` on the public releases repo with all four
files. The releases repo holds only builds; the code repo stays private.

Windows copies check `…/releases/latest/download/latest.json` (every few hours, or Settings → System
→ Check now) and install after you click. Android copies check `…/android.json` when the app opens
(at most every 6 hours, or Settings → Updates → Check now), notify once, and install after you tap
Update and confirm Android's own screen.

## Each release

1. Bump the version in the four manifests (package.json, src-tauri/tauri.conf.json,
   src-tauri/Cargo.toml, src-tauri/hook/Cargo.toml) and add a CHANGELOG.md entry. One release is one
   tag, `v<desktop version>`, even when only the phone changed.
2. If the Android app changed, raise `versionCode` (it must go up every time) and `versionName` in
   `android/app/build.gradle.kts`.
3. Commit and `git push`. The script refuses to publish with uncommitted changes, when the branch is
   behind `origin`, or when the tag already exists.
4. Run the command above. `--skip-android` or `--skip-windows` builds one app; the other's manifest
   is copied from the current release so its installs keep working.
5. Put the two installables in `current-build/` and commit them (see the standing rule in memory).

Builds from `npx tauri build` or `android\build.cmd assembleDebug` have no update address and never
check. Only `release.mjs` builds know where to look.

## Keys: where they live

| Key | File | In git? |
| --- | --- | --- |
| Windows update signing | `~/.tauri/desk-companion-updater.key` (+ password if set) | never |
| Android release signing | `~/.desk-companion/android-release.jks` | never |
| Its passwords | `android/keystore.properties` (storeFile, storePassword, keyAlias, keyPassword) | never (ignored) |
| Relay address | `.env` at the repo root (`DESK_COMPANION_RELAY=`) | never (ignored) |

Back up the two keys somewhere that isn't this PC (a password manager). Lose the Windows key and
installed copies can't be updated any more. Lose the Android key and phones must uninstall and
reinstall. Keep them off chat, email and synced folders.

### Releasing from a second machine

Install the same tools (Node, Rust, JDK 17 + Android SDK, `gh`), clone the repo, `gh auth login`,
then copy the three key files above and `.env` from your backup (the `storeFile` path in
`keystore.properties` must point at where you put the `.jks`). `git pull` before every release,
`git push` after.

## Changing keys

- The Android signing key can't change: Android refuses an update signed by a different key, so
  phones would have to uninstall first. The first release-signed APK (0.4.0) is the one-time break
  from the debug-signed 0.3.x builds.
- Never change the updater public key in `tauri.conf.json` without a release that is still signed
  with the old key; otherwise installed copies reject the new one.
