# Desk Companion

A small character that lives in the corner of your Windows desktop: **Kulhi** (a chai cup), **Hexo** (a hex nut), **Glim** (a firefly) **Billu** (a ginger cat on a little flying saucer), or **Rui**, a 3D yeti in a hood (tray → Character). Drag it anywhere; it potters about, follows your cursor with its eyes, and dozes off when you step away.

It keeps an eye on things for you:

- **Coding agents and IDEs** (Claude Code, Codex, Copilot CLI, Gemini CLI, Command Code, Cursor, Antigravity, and VS Code's agent mode):
  - shows when an agent is working, and tells you what it finished, with the agent's own summary
  - asks for attention when an agent needs permission, with **Allow / Always / Deny** right in the bubble (Claude Code and Codex)
  - lets you answer Claude's multiple-choice questions with buttons
  - click the character for the activity panel, with today's totals and a **Show window** button for each session
- **Everyday**: break reminders ("Chai break?"), low battery, finished downloads, welcome back.
- **Ask**: questions about your PC, answered by Claude (needs your own Anthropic API key; optional).

Everything can be changed in the **Desk Companion window** (it opens when you start the app yourself, or from tray → Open Desk Companion…; the gear in the panel has the same settings): where it lives, character and size, which notifications to show and pausing them, which agent moments to hear about, whether Allow / Deny is answered from the companion at all, the Ask feature and what it shares, connecting Claude Code and starting with Windows. The most-used switches are in the tray menu too.

**Where I live**: on the desktop (drag it anywhere), or **at the top edge** of the screen, in a little island like [coucou](https://github.com/Louis-CFM/coucou)'s. There it stays tucked away as a thin tab until you push the cursor to the top edge or an agent gets busy; then it slides out with a status line ("shop-app · Editing cart.ts", "blog needs your OK"). Hover the line to see every busy session. Notifications grow out of the island itself: a permission becomes a card with the command and Allow / Deny until it's answered, a finished task shows for a few seconds, then the island shrinks back. Click it and it grows into a bigger dark island: every session as a tile with its own little character (working, asking, pleased, asleep), Allow / Deny on the one that's waiting, and the Ask tab. Drag the island to slide it along the edge. By default it sits three quarters of the way across, so it doesn't sit on top of coucou's island in the middle if you run both.

## Inspired by

Kulhi owes a lot to [coucou](https://github.com/Louis-CFM/coucou) by Louis-CFM: a tiny friend that lives in your Mac's notch and on your iPhone, keeps an eye on your AI coding agents, and lets you approve them from the notch or the Lock Screen. If you're on a Mac, use it; it's lovely.

Kulhi brings that idea to the Windows desktop, with its own cast and an Android app. Several of its best parts started as coucou's ideas:

- the island at the top edge of the screen that grows out into a card when an agent needs you, and the bigger card when a task is done
- guarding the Allow button so a stray click can't approve something you didn't see
- answering an agent's question with your own words, and seeing its edits as they happen

The ideas were too good to keep on one platform. Thank you, coucou.

## Run it (development)

Needs Node 20+, Rust (the project pins 1.90 in `src-tauri/rust-toolchain.toml`) and the MSVC build tools.

```bash
npm install
npm run desktop     # the desktop app (Tauri)
npm run dev         # the character playground in a browser, http://localhost:5179
                    # and the 3D prototype (Rui) at http://localhost:5179/three.html
node scripts/make-rui-stills.mjs   # remake Rui's still pictures for the panel (after changing his model, looks or colours)
# DESK_COMPANION_FAKE_BATTERY=1 when starting the app: behaves as if on battery (for trying Rui's power saving)
node scripts/simulate-agents.mjs   # plays a short session from each coding agent into the running app, through each agent's own shell
npx vitest run      # app tests
cd src-tauri && cargo test --workspace   # Rust tests
```

## Build on another machine

Windows app: install Node 20+, Rust (through rustup; the project pins its version) and the Visual Studio Build Tools with the "Desktop development with C++" workload, then `npm install` and `npx tauri build`. WebView2 comes with Windows 11.

Android app (`android/`): needs a JDK 17 and the Android SDK command-line tools (packages `platform-tools`, `platforms;android-35`, a recent `build-tools`), no Android Studio. Put `sdk.dir=<path to the SDK>` in `android/local.properties` (not committed), set `JAVA_HOME` to the JDK, and run `gradlew assembleDebug` in `android/`; the APK lands in `android/app/build/outputs/apk/debug/`. `android\build.cmd` is the same with this project's own tool folders. More in `android/README.md`.

## Build the installer

```bash
npx tauri build
```

The installer lands in `src-tauri/target/release/bundle/nsis/`. It installs per user (no admin prompt) and includes the agent relay. A plain build like this has automatic updates switched off, and is signed only if a certificate is configured (see below).

**Your phone relay, built in.** To build with your own relay (`docs/RELAY.md`) so nobody has to paste its address, copy `.env.example` to `.env` and set `DESK_COMPANION_RELAY=https://…workers.dev` (or set that environment variable). `.env` isn't in git: everyone who builds the app uses their own relay. Without it the app is built with none, and an address can still be pasted in Settings → Phone.

## Releasing (signed, with automatic updates)

```bash
node scripts/release.mjs --url https://<where you'll host the files>
# or, on GitHub Releases (public repo):
node scripts/release.mjs --github owner/repo --publish   # --publish needs the GitHub CLI (gh auth login)
```

This builds the installer and puts two files in `release/<version>/`: the installer, and `latest.json` (the version, its release notes from this CHANGELOG, and the update signature). Upload both to that address. Copies installed from this release check `<address>/latest.json` every few hours and offer newer versions there.

- **Update key.** Every update is signed with the private key at `~/.tauri/desk-companion-updater.key`, and the app only accepts updates signed with it (the public half is in `tauri.conf.json`). Keep a backup of the key somewhere safe. Without it, installed copies can never be updated again.
- **Code signing.** Get a code-signing certificate, then set either:
  - `DESK_COMPANION_SIGN_PFX` (the `.pfx` file) and `DESK_COMPANION_SIGN_PASSWORD`, or
  - `DESK_COMPANION_SIGN_THUMBPRINT` (a certificate in your Windows certificate store, e.g. on a USB token).

  The build then signs the app, the relay, the uninstaller and the installer, with a timestamp (`scripts/sign.mjs`). With nothing set, it signs nothing and says so.

## Connect coding agents

Settings → Coding agents (Claude Code is also in the tray). Each switch adds the app's hooks to that agent's own settings and takes them out again when turned off:

| Agent | File | Allow / Deny from the app |
|---|---|---|
| Claude Code | `~/.claude/settings.json` | Yes, plus Always and question answers |
| Codex | `~/.codex/hooks.json` (trust it once with `/hooks` in Codex) | Yes, plus Always |
| GitHub Copilot CLI and VS Code's agent mode | `~/.copilot/hooks/desk-companion.json` (one file, read by both) | No, status only |
| Gemini CLI | `~/.gemini/settings.json` | No, status only |
| Command Code | a mod, `~/.commandcode/mods/desk-companion.ts` | No (questions yes) |
| Cursor | `~/.cursor/hooks.json` (restart Cursor after connecting) | No, status only |
| Antigravity (IDE, 2.0, CLI) | a `desk-companion` group in `~/.gemini/config/hooks.json` | No, status only |

Shared settings files are backed up first (a dated copy next to them). Everything else in them, including other tools' hooks, stays exactly as it was.

Only a permission request or a question waits (up to 110 s) for you; every other hook runs in the background and never holds an agent up. Nothing is ever allowed without a click.

## What leaves your computer

- **Agent events** go only to the app, over a local pipe that only your Windows user can write to: event names, project folder, tool names, file paths, commands, your prompt (shortened). Never file contents or command output. The "what was done" summary is read from Claude Code's transcript file on your disk.
- **Ask** (only if you add an API key) sends your question, the conversation, and a short device summary (Windows version, model, CPU, memory, disk, battery) to Anthropic. The panel shows exactly what that summary says. The key is kept in Windows Credential Manager and never reaches the web pages.
- Nothing else. No telemetry.

## Security

- Installs for your user only. No admin rights, services or drivers.
- The relay only talks to the Desk Companion that installed it. It checks the program on the other end of the pipe against the path the app recorded next to it.
- Every window runs under a strict content security policy, and can only use the app commands it needs (`src-tauri/capabilities/`).
- Uninstalling removes the Claude Code hooks (with a backup), the relay and the start-with-Windows entry (`src-tauri/windows/hooks.nsh`).
- Updates are only installed if they're signed with the project's update key, and only after you click Install.
- Releases are code-signed once a certificate is configured (see Releasing).

## Where things are

| Path | What |
|---|---|
| `src/engine/` | The shared character engine: state machine (`controller.ts`), animation layers (`engine.ts`) |
| `src/skins/` | The characters: `kulhi.ts`, `hexo.ts`, `glim.ts`, `billu.ts`, shared motions in `common.ts` |
| `src/three/` | Rui, the 3D character (three.js, loaded only when he's chosen): the model and behaviours (`rui.ts`), face (`face.ts`), toy and anime looks (`looks.ts`), colour themes as plain data (`palette.ts`), props (`props.ts`), the stage that connects him to the app (`stage.ts`) and its "is this PC keeping up?" check (`speed.ts`). `three.html` is his test page; `rui-stills.html` and `stills.ts` render his still pictures. |
| `src/assets/rui/` | Rui's still pictures for the Settings card and the island's session tiles (one per pose, look and colour), made by `scripts/make-rui-stills.mjs` |
| `src/desktop/` | The desktop window: drag, pottering, agents (`agents.ts`), everyday events (`companion.ts`), the top-edge island (`island.ts`) |
| `src/bubble/`, `src/panel/` | The speech bubble and the Ask / Activity panel |
| `src-tauri/src/` | Rust: windows and drag (`desktop.rs`), agent pipe (`agents.rs`), system events (`system.rs`), Claude API (`assistant.rs`), setup (`setup.rs`), tray |
| `src-tauri/hook/` | The relay each coding agent runs on each hook event (it translates every agent's dialect into Claude Code's) |
| `integrations/commandcode-mod.ts` | The mod installed into Command Code (`~/.commandcode/mods/desk-companion.ts`) |
| `character-animation-spec.md`, `character-blueprint-prompts.md` | The design specs |
| `CHANGELOG.md` | What changed in each version |
