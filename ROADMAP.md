# Roadmap

What's left to do on Desk Companion, in the order we plan to do it. Finished work is recorded in [CHANGELOG.md](CHANGELOG.md); how the project is built is in [README.md](README.md).

Last updated: 12 October 2026.

## Where things stand

- **0.11.0** (16 October 2026) is the latest: the corner shows what agents are doing, its cards never cover the character, and Rui and Dogesh react to each moment of a task (see [0.11](#011-the-corner-speaks-up)). Releases are published to Desk-comp-releases with automatic updates; see CHANGELOG.md for everything since 0.6.
- **0.6.0** (12 October 2026) was the first full release with Rui. It has everything from the 0.5.0 previews: **Rui**, a 3D character built with three.js and drawn entirely in code, plus Command Code, Cursor, Antigravity and VS Code's agent mode, the bigger "done" and "What it did". It's unsigned and has automatic updates off (see [Waiting on decisions](#waiting-on-decisions)).
- **0.4.1** was the last version before Rui: the four 2D characters, the first coding-agent alerts, Settings, and code signing and automatic updates ready to switch on.
- The 0.5.0 previews were never a full release; their notes are in CHANGELOG.md under 0.6.0.

## Rui (3D character): steps

### Step 1: measure him in the real desktop window ✅ done

Measured on an Intel i5-10400 with Intel UHD 630 graphics, in the 160 px corner window:

| | Kulhi (2D) | Rui |
|---|---|---|
| Memory, whole app | about 200–250 MB | the same |
| CPU at rest | about 13–23% of one core | about 15% of one core |
| Graphics chip at rest | about 2–4% | about 6% |

The decisions that came out of it: draw at 1.5× sharpness, use no real shadow pass (the soft blob under his feet is enough), and draw at 30 fps while calm, 60 for quick moves, 15 while dozing.

### Step 2: make him the fifth character ✅ done

Rui is chosen from tray → Character → Rui (3D yeti). The same state machine drives him as the 2D characters. His 3D code loads only when he's chosen.

| Event | What Rui does |
|---|---|
| An agent works | Sits and taps on a tablet |
| A task is done | Cheers |
| An agent needs you | Waves |
| Something fails | Droops |
| You're away | Dozes, then naps with the nose bubble |
| Dragged / dropped | Dangles / lands |
| Break reminder | Exercises |
| Download finished | Eats a cookie |
| You're back after a while | Waves |

Tested live in the corner and top-edge modes.

### Step 3: Settings ✅ done

- [x] A **Rui card** in Settings → Appearance next to the 2D characters, with a still picture of him in his current look and colour (the panel has no 3D of its own).
- [x] A **look** switch: Toy or Anime. Shown under the cards while Rui is the character.
- [x] The **colour themes**: Cream, Mint, Sky blue, Lavender, Peach pink, Panda.
  - Picking one plays one of the three scenes at random (painting, twirl, wardrobe and mirror), never the same twice in a row.
  - For the wardrobe scene, the corner view pulls back for a moment instead of the window widening (that's step 4).
- [x] The look and colour are saved in `prefs.json` as `ruiLook` and `ruiTheme`, validated on the Rust side like the other settings (`system.rs`).
- [x] The choices are in the tray menu as well: Character → Rui's look, Rui's colour.
- [x] In the top-edge island's big view, Rui's session tiles show a picture of him in that session's mood: working, waiting on you, failed, ended, or resting.

The pictures (5 poses × 2 looks × 6 colours, about 250 KB in all) are made by `node scripts/make-rui-stills.mjs`, which renders them with headless Chrome. Run it again after changing his model, looks or colours.

### Step 4: desktop details (all but the last item done)

- [x] **Room to move.** Instead of widening and shrinking the window mid-scene (which can make him jump for a frame), Rui's corner window keeps see-through, click-through room round his square: 30% of his size on each side and 25% above (256 × 200 px at Medium). His canvas covers only his square, so drawing costs the same as before, and grows into the room only while he needs it (the wardrobe scene, a stroll, or he's away from the middle). The camera keeps him the same size and in the same spot. Rust keeps working with his square (`square` and `put` in `desktop.rs`), so the saved spot, dragging, the click area, the bubble and the panel are unchanged.
  - Strolls now go about three times as far, and he walks back to the middle afterwards.
- [x] Decide how the change-colour scenes look **in the top-edge island**, where he's only 40 px tall: the twirl only (done in step 3).
- [x] **Save battery:**
  - after a minute of the same calm behaviour (working, pondering, dozing) he draws 15 frames a second
  - on battery: 30 / 20 / 10 frames a second instead of 60 / 30 / 15
  - Settings → Rui → **On battery, use a 2D character** (off by default): the 2D character stands in while unplugged, and Rui comes back when plugged in
- [x] **Weak graphics:** if WebGL can't start, or he gets less than 40% of his frames (or each frame takes over 30 ms) for 30 seconds after a 15-second grace period, the 2D character stands in for the rest of the session and he says why once (`src/three/speed.ts`).
- [x] **Reduced motion** (Windows setting): no strolls or idle antics, no reactions to break reminders and the like, colour changes without a scene, and a nod instead of cheering, getting dizzy or the start-up hop.
- [ ] **Measure again on a low-end PC or laptop**, since so far he's only been measured on this one. This needs another machine.

Testing without a battery: start the app with `DESK_COMPANION_FAKE_BATTERY=1` and it behaves as if unplugged.

### Step 5: release (now 0.6.0)

- [x] Set the version to 0.6.0 in all four places: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` and the relay's `Cargo.toml`.
- [x] Write the 0.6.0 entry in CHANGELOG.md.
- [x] Build the installer with `npx tauri build`. Use `node scripts/release.mjs --url …` instead once there's an update address.
- [ ] Test installing, updating from 0.4.1, and uninstalling on a clean user account.

## 0.7: agent essentials

Ideas taken from comparing with coucou (12 October 2026). Do them in this order; Sonnet is enough for the Sonnet ones, use Opus for the first two.

- [x] **Approval safety**: 600 ms click guard (`src/bubble/guard.ts`); the card must report itself shown within 2 s (`permission_shown`, `SHOW_WAIT` in agents.rs) or the agent is let go; the corner bubble keeps pinned cards like the island. Tested live (island, corner, full-screen). Answering in the terminal already cleared the card (any later work event clears it).
- [x] **Per-user pipe name**: `desk-companion-<SID>`, from `src-tauri/hook/src/pipe_name.rs`, which the app includes too. Not yet tried with two users signed in at once.
- [x] **Live diffs** (`src/desktop/diff.ts`, relay `edit_parts`, panel `renderFileDiff`): see CHANGELOG. Not yet looked at in the running app.
- [x] **"Other…" free-text answer** to Claude's questions: text box in the panel; the bubble and island open the panel (they never take keyboard focus). Tested live end to end.
- [ ] **Plan usage pills** for Claude (via Claude Code's `statusLine`, keeping the user's own status line running) and Codex (`codex app-server`, `account/rateLimits/read`). Also look into **Command Code** (does its mod API or CLI expose usage?) and any other agent that reports limits; show one pill per agent that has data.
- [ ] **Rate-limit state** for the character (tired, sweating) when an agent reports a rate limit.
- [x] **Keyboard shortcuts** (0.12.0, `src-tauri/src/shortcuts.rs`): global Ctrl+Alt+Y / N (registered only while a request holds a card, 600 ms guard), J (jump), A (activity), M (mute), H (hide, its own flag next to the full-screen step-aside). Tested live with injected keys (N denied a request, M and H both ways).
- [ ] **More agents**: OpenCode, Amp, Muse Code, and a generic `--agent <name>` tag.

Later (0.8): weekly recap, a custom-sounds folder, choosing the display, Ollama for Ask.

## 0.11: the corner speaks up

Asked for 16 October 2026: in corner mode, show what's running for a few seconds (like the top island does), again when it finishes or needs you, never over the character, and give Rui and Dogesh a reaction for each moment.

- [x] **Card placement** (`src-tauri/src/placement.rs`, tested over the whole screen, all sizes, two scales): beside his body box (the hit rect, which follows Rui and Dogesh), the roomier side, 12 px clear, then above / below; follows him while it's up; 3D characters don't wander off while a card is up (`stage.setStill`).
- [x] **Working card**: 5 s at a task's first step (or 4 s into thinking), "N agents working" with a line each; Settings → Notifications → "What agents are working on". Not in top mode (the island's status line does it).
- [x] **Hover list**: hovering him (or the card) shows every busy session. Built; not yet tried with a real mouse.
- [x] **Reactions**: waiting for an OK keeps "call" going until answered; a question → "ponder"; one task done while others carry on → a cheer, then back to work (`controller.interlude`); stopped by you → a shrug. Checked live with Dogesh; Rui uses the same cues (his `call` and `ponder` loop too) but wasn't watched live.
- [x] **Working poses by what the agent is doing** (0.12.0, 3D only): `activityOf` → `stage.setActivity` (settles after 2.5 s, holds 5 s) → cues research / run / browse; Rui and Dogesh each have a magnifier + book, a push button, binoculars. Checked live with Dogesh in the corner.
- [x] **The same reactions for 2D characters** (0.13.0): WORKING carries a `WorkVariant` (research / run / browse / wait / ask) set by `controller.setWork`, which also does the settling (one source for 2D and 3D; the stage maps variants to cues). Each 2D skin draws all five; checked live with 2D Dogesh in the corner and the island, and 3D Dogesh again.

## Next character: the inventor and his big sister

Proposed 16 October 2026: a two-figure character with a genius-little-brother / meddling-big-sister dynamic (our own design, nothing copied from Dexter's Laboratory), the same look in 2D and 3D. Full proposal, open questions and concept-art prompts: [docs/NEW_CHARACTER_SIBLINGS.md](docs/NEW_CHARACTER_SIBLINGS.md).

- [ ] Decide the open questions (names, style reading, her hobby, how often she drops in)
- [ ] Design sheet approved
- [ ] 2D version
- [ ] 3D version
- [ ] Into the app (Settings, island, phone pictures, Android build)

## Android companion

For when you give an agent a prompt and walk away: notifications, Allow / Deny, and a reply when a task is done. Native Kotlin app in `android/` (see its README). Decisions of 13 October 2026: direct link from the phone to the PC first (works on a phone hotspot with a subnet sweep), relay later; "further prompts" means a reply when a Claude Code turn ends (the Stop hook returns `decision: block` and the reply as the reason, so the same terminal session carries on).

- [x] **Phase 0, toolchain**: JDK 17, Android command-line SDK and Gradle under `%LOCALAPPDATA%\Android`, no Android Studio.
- [x] **Phase 2a, demo app (0.1.0)**: Home with the soft-card design, filters, approval sheet with a 600 ms guard, session detail with a reply box, Activity, Settings, a sample notification with Deny / Allow. Samples only. Built, unit-tested and checked on the emulator in light and dark mode (screens, sheet, notification, Deny); not yet on a real phone.
- [x] **Phase 1, desktop phone-link server**: `src-tauri/src/phone/` (proto, identity, server), Settings → Phone, `src/desktop/phone.ts` (the list sent), `docs/PHONE_LINK.md`, `scripts/phone-sim.mjs`. Tested live with the simulator: pinned TLS 1.3, wrong token refused, sessions pushed, a real request denied from the "phone" through the real relay in about 0.3 s, the PC's card closed, Pair again unlinks. Not yet with a real phone (phase 2b), and only over 127.0.0.1 so far (the firewall must allow the app on private networks).
- [x] **Phase 2b, link the app**: QR scan (CameraX + zxing), paste, or a `deskcompanion://pair` link, always ending at a confirmation; pinned TLS 1.3 to each of the PC's addresses in turn, reconnecting with backoff; pairing encrypted under an Android Keystore key; a foreground service keeps the link; live sessions replace the samples. Tested on the emulator against the real desktop app and relay: linked, a real request arrived as a notification, Deny from the notification reached the agent in 0.34 s, Allow from the in-app sheet (opened from the notification) reached it too, the PC's card closed. QR scanning itself not tried (the emulator's camera can't show the code).
- [x] **Phase 3, notifications and approvals**: request notifications (lock screen shows only "Approval needed"), Deny from the notification (with a 600 ms guard), "done" / "stopped" notifications, Allow / answers / replies behind the fingerprint or screen lock, Claude's questions answered from the phone (notification, then a sheet with options and "Other…"), the notification switches and quiet hours applied and saved. Questions tested on the emulator against the real app and relay. Fingerprint prompt not yet tried on a real phone (the emulator has no screen lock).
- [x] **Phase 4, reply when a task is done**: Claude Code's Stop hook is now synchronous; while you're away (a phone with away mode is linked and the PC has had no input for a minute) the app holds the finished turn for up to 5 minutes. A reply from the phone (in the app, or Reply right in the notification) continues it via the Stop hook's `decision: block`; any key or mouse movement on the PC, or the phone going away, lets it go at once. Tested live: held and continued from the simulator and the emulator (notification and in-app), not held without an away phone, released when the phone left.
- [x] **Phase 3b, new look and your character**: the app follows your character: its picture (made from the desktop's own drawings by `scripts/make-phone-pictures.mjs`, Rui's from his stills) in the mood of each session, and its colour for cards, buttons and tints; picked on either side and kept in step (`character` message). Checked on the emulator against the real desktop app; the picture set is static (no live animation on the phone).
- [x] **Phase 5a, reliability**: the PC sends its current addresses on every connect and the phone saves them; when none answers, the phone searches its own /24 for the pinned certificate (at most every 30 s); it retries at once on a network change, hotspot on/off or opening the app, and waits quietly with no network; Settings → Staying linked asks Android to keep the link while the phone sleeps. Tested on the emulator: paired with a wrong address, it found the PC in about 3 s and used the found address first after a restart.
- [x] **Phase 5b, off-network relay**: a Cloudflare Worker (`relay/`, deployed by you, free plan) passes end-to-end encrypted frames between the PC and its phones (`docs/RELAY.md`). Keys from the pairing token by HKDF, AES-256-GCM per direction, session ids and sequence numbers against replays; the PC feeds relayed lines into the same phone handling; the phone tries the direct link first, uses the relay only off the PC's network, and moves back when the PC answers directly. Settings → Phone → Reach your phone anywhere + Relay address. Tested: the same keys and frames in Rust, Kotlin and node; the PC app and the Android app (emulator) linked through the deployed relay, character changes both ways. Not yet from a real phone on mobile data. Also fixed: tapping Link (notification permission) or Scan the code (camera permission) crashed on a phone that hadn't granted them yet (an old Fragment library).

## Waiting on decisions

These come from earlier versions and don't block the Rui work.

- **Update hosting address.** Automatic updates are built in, but they need an HTTPS address to host `latest.json` and the installers. Releases made without one have updates switched off.
- **Code-signing certificate.** Signing is set up (`scripts/sign.mjs`); it starts working as soon as a certificate is configured. Without one, Windows SmartScreen warns about the installer, and some antivirus tools delay the app's first start.
- **Update key backup.** Updates are signed with the private key in `~/.tauri/desk-companion-updater.key`, which is **not** in this project or its zip. Keep a safe copy: without it, installed copies can never be updated again.

## Later ideas

Not planned yet; listed so they aren't lost.

- **Artist-made characters.**
  - A professional model and hand-made animations made in Blender. They could replace Rui's code-built shapes inside the same rig, or ship as optional download packs (data only, signed with the update key).
  - The same Blender character could later move to a game engine (Godot or Unity) for full live 3D if needed.
- **Desktop life for Rui.** Walking along the taskbar in a wide, see-through strip, and reacting to the time of day.
- **More reactions.** For example, a tea break in the afternoon, or a celebration when many tasks finish in a day.
- **Today's totals.** A way to reset them by hand, for example after testing.
- **More IDEs.** Cursor, Antigravity and VS Code's agent mode are connected (0.6.0). Next in line:
  - **Windsurf** (`~/.codeium/windsurf/hooks.json`, its own snake_case events, status only)
  - **Kiro** (hooks are per project, `.kiro/hooks/`, so it needs a per-project switch)
  - **Cline** (one script per event in `Documents\Cline\Hooks`)
