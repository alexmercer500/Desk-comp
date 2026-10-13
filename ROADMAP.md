# Roadmap

What's left to do on Desk Companion, in the order we plan to do it. Finished work is recorded in [CHANGELOG.md](CHANGELOG.md); how the project is built is in [README.md](README.md).

Last updated: 12 October 2026.

## Where things stand

- **0.6.0** is the latest version (12 October 2026). It has everything from the 0.5.0 previews: **Rui**, a 3D character built with three.js and drawn entirely in code, plus Command Code, Cursor, Antigravity and VS Code's agent mode, the bigger "done" and "What it did". It's unsigned and has automatic updates off (see [Waiting on decisions](#waiting-on-decisions)).
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
