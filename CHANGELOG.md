# Changelog

What changed in each version of Desk Companion. The newest version is at the top.

Version numbers go up with every update:

- the **middle** number (0.**2**.0) for new features
- the **last** number (0.2.**1**) for releases that only fix bugs

The installed version is shown at the bottom of the tray menu.

## 0.6.0 (12 October 2026)

Everything from the 0.5.0 previews below, in one version: Rui, more coding agents and IDEs, and a better "done". It's numbered 0.6.0 rather than 0.5.0 because of how much it adds. Updating from 0.4.1 or any 0.5.0 preview keeps your settings and connected agents.

### New

- **Rui, a 3D character** (tray → Character → Rui). A small yeti in a hood, with two looks (Toy or Anime) and six colours, each change played as a little scene. He has his own card in Settings and appears on the island's session tiles. (previews 1 and 2)
- **IDEs:** Cursor, Antigravity, and VS Code's agent mode, each shown under its own name. (preview 6)
- **Command Code** through a mod: every step, stopped and failed runs, waiting for your OK, and its questions answered from the companion. (preview 4)
- **A bigger "done" at the top edge,** like coucou's. Click it to open the session. (preview 4)
- **"What it did"** on every finished task: files changed, commands run and every step. (preview 5)

### Improved

- **Rui on the desktop:** room to stroll, battery saving, a 2D stand-in on weak graphics, and calmer behaviour with Windows' reduced-motion setting on. (preview 3)

### Fixed

- **Gemini CLI** now reaches the companion on Windows. **Copilot CLI** and **Codex** hooks were corrected too, and agents connected with an older version are updated when the app starts. (preview 4)

### Not in this version

- The installer isn't code-signed yet, and automatic updates are off until there's an address to host them (see ROADMAP.md → Waiting on decisions).
- Rui hasn't been measured on a low-end PC yet.

## 0.5.0-preview.6 (12 October 2026)

IDEs: Cursor, Antigravity and VS Code's agent mode.

### New

- **Cursor.** Settings → Coding agents → Cursor adds the app's hooks to Cursor's own `hooks.json`. The companion shows what Cursor's agent is doing, and when it's **done** (with its reply as the summary), **stopped** or **failed**. Restart Cursor after connecting. Before this, Cursor only showed up through Claude Code's hooks; once Cursor is connected that copy is skipped, so nothing is counted twice.
- **Antigravity** (the IDE, Antigravity 2.0 and its CLI). Settings → Coding agents → Antigravity adds a hook group named `desk-companion` to `~/.gemini/config/hooks.json`. The companion shows each step once it's done, failed steps in red, and when a task ends or fails.
  - Antigravity doesn't send the prompt's text, so its tasks are titled "Done" without it.
  - The companion never answers Antigravity's permission prompts: they stay in Antigravity, exactly as before.
- **VS Code's agent mode** (GitHub Copilot in VS Code). VS Code reads the same hook folder as Copilot CLI, so the Copilot switch (now "GitHub Copilot (CLI and VS Code)") covers both. Each one is shown under its own name. Until now, VS Code's chats appeared as "Copilot CLI" whenever Copilot CLI was connected.
- Turning an IDE off takes the app's hooks out again. A file that held nothing else is removed rather than left empty.

### Good to know

- All three are status only: Allow / Deny stays in the IDE. Cursor and VS Code can only block a tool from a hook, not approve one. Antigravity could approve, but the companion never decides on its behalf.
- Antigravity's own forum has reports of hooks not firing in its Windows IDE. If nothing shows up, try Antigravity's CLI or a newer version.

## 0.5.0-preview.5 (12 October 2026)

### New

- **What it did.** Every finished task in the activity view now has a "What it did" section: the files it changed, the commands it ran, and every step in order, with failed ones in red. Clicking a "done" notification opens that session with its latest task's story already open.

## 0.5.0-preview.4 (12 October 2026)

Coding agents: Command Code, Gemini CLI, Copilot CLI and Codex fixed and tested, and a bigger "done" at the top edge.

### New

- **A bigger "done" at the top edge,** like coucou's. When a task finishes, the island opens wide: the character larger in the middle, the project under it, and the news on a dark panel with a few sparks drifting up. Permission requests and questions keep the compact card with their buttons.
- **Command Code, done properly.** It now gets a small mod instead of plain hooks (Settings → Coding agents → Command Code; anyone connected before moves over on the next start). The companion now shows:
  - every step, not only some of them
  - when a run is **stopped** (Esc) or **fails** (for example, the model provider being overloaded), instead of staying "working" forever
  - when it's **waiting for your OK** in its terminal, with the command. Command Code doesn't let other programs answer its permission prompts, so the card says to answer in the terminal; click it for the session, where Show window brings the terminal to the front
  - its **multiple-choice questions**, which you can answer from the companion. In terminal hands the question back

### Fixed

- **Gemini CLI never reached the companion on Windows.** Gemini runs hooks through PowerShell, which treated our command as text and refused it. It now runs properly.
- **GitHub Copilot CLI** hooks now use Copilot's own event names and say which event it is, since Copilot leaves that out.
- **Codex:** pressing Esc ends the turn as "Stopped" instead of leaving it working, and its hook file no longer has a setting Codex doesn't know.
- Agents connected with an older version get the corrected hooks automatically when the app starts (a backup of each changed file is kept, as always).

## 0.5.0-preview.3 (12 October 2026)

Rui on the desktop: room to move, and kinder to slower PCs and laptops.

### Improved

- **Room to move.** Rui's window now has a see-through margin around him that clicks pass straight through. The wardrobe scene happens at his normal size, with the whole wardrobe and the mirror in view, instead of the view zooming out.
- **Longer strolls.** He wanders about three times as far as before when idle, then strolls back to his spot.
- **Calmer when it's quiet.** After a minute of the same calm activity, such as working on his tablet, he's drawn less often.
- **On battery** he's drawn less often all round. A new switch, Settings → Rui → **On battery, use a 2D character**, swaps him for a 2D character while a laptop is unplugged, and brings him back when it's plugged in.
- **Reduced motion.** With Windows' reduced-motion setting on, he nods instead of cheering or getting dizzy, and skips strolls and other idle antics.

### New

- **A stand-in on weak graphics.** If his 3D can't start on a PC, or runs much too slowly, a 2D character takes his place for that session and says why once.

### Fixed

- With Rui chosen, moving the mouse near him now counts as you being around, as it does for the 2D characters.

## 0.5.0-preview.2 (12 October 2026)

Rui's settings.

### New

- **Rui in Settings.** He has his own card in Settings → Appearance, next to the 2D characters, with a picture of him in his current look and colour.
- **Rui's look:** Toy (soft vinyl) or Anime (flat colours with outlines). It switches at once.
- **Rui's colour:** Cream, Mint, Sky blue, Lavender, Peach pink or Panda. Pick one and he changes into it with one of three little scenes, chosen at random and never the same twice in a row:
  - he paints himself with a brush and palette
  - he twirls into it
  - he steps into a wardrobe and admires himself in a mirror afterwards (the view pulls back for a moment to make room)

  At the top edge there's only room for the twirl. With Windows' reduced motion setting on, the colour just changes. If an agent was working, he goes back to his tablet afterwards.
- **In the tray** too: Character → Rui's look and Rui's colour, usable while Rui is the character.
- **Rui on the island's session tiles.** At the top edge, each session's tile now shows Rui (busy with his tablet, waving when a session needs you, drooping after an error, asleep when it's ended) instead of a 2D character.

The look and colour are remembered with the other settings.

## 0.5.0-preview.1 (9 October 2026)

A preview of 0.5.0, to try Rui. His settings (look, colour themes) come in the full 0.5.0.

### New

- **Rui, a 3D character** (tray → Character → Rui). A small yeti in a hood, drawn in real 3D. He does what the other characters do, in his own way:
  - sits down and taps away on a tablet while an agent works, and cheers when it's done
  - waves at you when something needs you, droops when something goes wrong
  - dozes off when you're away and naps with a bubble at his nose; it pops when he wakes
  - dangles when you drag him, and lands with a squash
  - exercises with you at break time, has a cookie when a download finishes, waves when you come back
  - at the top edge, his head and shoulders show in the island

  His 3D code loads only when he's chosen, so the other characters cost nothing extra. Measured on an everyday PC: the same memory as Kulhi, about the same CPU at rest, and a little more graphics-chip time (about 6% of a basic built-in graphics chip). He draws at 30 frames a second while calm, 60 for quick moves and 15 while dozing.

## 0.4.1 (9 October 2026)

### Improved

- **The installer is Kulhi too.** It used to show the installer tool's generic icon; it now has Kulhi as its icon, a Kulhi side panel on its welcome and finish pages, and a small Kulhi banner on the other pages. The uninstaller uses the same icon. (The artwork is drawn from the app icon by `scripts/make-installer-art.py`.)

## 0.4.0 (9 October 2026)

### New

- **More coding agents.** Connect each one in Settings → Coding agents:
  - **Codex**, with Allow / Deny from the companion. Codex asks you once to trust the new hook (run `/hooks` in Codex).
  - **GitHub Copilot CLI**, **Gemini CLI** and **Command Code**. These show what the agent is doing and when it's done; their permission prompts stay in the terminal.
  - **Cursor** sessions, which already come in through Claude Code's hooks, are now labelled "Cursor".

  An agent that isn't installed on the PC is shown as "Not found on this PC".
- **Always allow.** When Claude Code (or Codex) suggests a rule for a request, the card offers **Always** next to Allow. It's the same as "Yes, and don't ask again" in the terminal: Claude Code saves the rule in that project's own settings.
- **Answer Claude's questions from the companion.** When Claude asks a multiple-choice question, the island, bubble or panel shows the options as buttons. One tap answers a single question; with several questions or "pick any", choose and then Send. In terminal still works as before.
- **Show window.** Each session in the activity view can bring its terminal or editor window to the front.
- **Today's totals** at the top of the activity view, e.g. "12 done · 1 failed · 2h 10m of agent work · asked you 5 times". They survive a restart and start again each day.
- **Sounds** (Settings → Notifications, off by default): a soft chime when a task finishes, an agent needs you, or something fails.
- **Automatic updates.** The app checks for new versions in the background (Settings → System; it can be switched off) and says when one is ready. Installing takes one click and restarts the app. Updates must be signed with the project's update key, or the app refuses them.
- **Code signing.** The build signs the app, the relay, the installer and the uninstaller as soon as a code-signing certificate is configured (see README → Releasing).

### Fixed

- Clicking the island while the panel was opening could leave the island following the mouse along the top edge. A drag now always ends once the mouse button is up.

## 0.3.1 (9 October 2026)

Security and performance fixes from the 0.3.0 review.

### Security

- **Uninstalling now cleans up after itself.** It removes the Claude Code hooks (after backing up your settings file, as always), the relay program in `%LOCALAPPDATA%\DeskCompanion`, and the start-with-Windows entry. Other tools' hooks are left exactly as they are. Updating to a newer version skips this, so you stay connected.
- **The relay checks who it's talking to.** Before sending anything or accepting an Allow / Deny, it confirms that the program on the other end is the Desk Companion that installed it. Another program pretending to be Desk Companion gets nothing, and can't answer Claude Code's permission requests.
- **A strict security policy (CSP) is now on in every window,** so the app's pages can only run their own code.
- **Each window can only use the commands it needs.** For example, only the character's own window can pass on an Allow / Deny, and the speech bubble can't change settings.

### Performance

Measured on the installed build:

| | 0.3.0 | 0.3.1 |
|---|---|---|
| Memory at rest | about 285 MB | about 166 MB |
| CPU at rest | 13% of one core | 1.5% of one core |
| CPU while an agent works | 22% of one core | 15% of one core |

- Long-lasting animations (resting, working) draw 30 frames a second instead of 60. Quick reactions (a tap, a success hop, a notification) still get every frame.
- When the top-edge island is tucked away, nothing is drawn at all. The character's clock keeps ticking, so it still gets sleepy on time.
- The panel window is created the first time you open it, instead of at start-up.
- The background check of where your cursor is runs 20 times a second at rest instead of 30.

## 0.3.0 (9 October 2026)

### New

- **Settings tab.** A gear next to Home and Ask, in both the desktop panel and the top-edge island. Open it there or from tray → Settings…. Every change is saved at once and the tray menu follows along.
  - **Appearance:** pick the character from picture cards, desktop or top edge, size, and stepping aside for full-screen apps.
  - **Notifications:**
    - **Pause notifications** for 30 minutes, 1 hour, 3 hours, until tomorrow morning, or until you turn them back on. Permission requests still show, because an agent is waiting on them.
    - Break reminders, now with a choice of interval (every 30, 45, 50, 60 or 90 minutes).
    - Low battery, finished downloads and welcome back, each on or off.
  - **Coding agents:**
    - Connect or disconnect Claude Code.
    - Choose which moments notify you: task finished, needs permission, waiting for you, something failed.
    - **Allow / Deny from here** can be turned off. Requests then go straight to your terminal with no wait.
  - **Ask (AI):**
    - Turn the Ask tab off completely.
    - Choose whether your device details are sent with questions, and see exactly what they say.
    - Remove the API key, or go to Ask to add one.
  - **System:** start with Windows, and the version number.
- Tray: a **Settings…** item.

### Improved

- The tray menu's check marks always match what's stored, whether you change something in the tray or in Settings.
- Settings files from older versions keep their choices; the new settings start switched on.
- A settings value the app doesn't recognise is refused instead of saved.

## 0.2.0 (9 October 2026)

### New

- **Billu, the space cat.** A ginger cat sitting on a little flying saucer, as the fourth character (tray → Character). It has every state the other characters have, plus its own touches:
  - it grooms a paw, does a slow cat blink, and waves
  - the saucer scans with a tractor beam while working, and its rim lights fill up with progress
  - the saucer sputters with puffs of smoke when something goes wrong
  - it curls into a loaf to sleep
- **Live at the top edge of the screen, like coucou.** Tray → Where I live → At the top edge. The character moves into a small island that grows and shrinks with what's going on:
  - when nothing is happening it tucks away to a thin tab, and peeks out when you push the cursor to the top edge
  - while an agent works it shows a status line ("shop-app · Editing cart.ts")
  - hovering the status line lists every busy session and what it's doing
  - notifications grow out of the island itself: a permission request becomes a card with the command and Allow / Deny until it's answered, and a finished task shows for a few seconds
  - clicking the island opens a bigger dark island with each session as a tile (each with its own live character) and the Ask tab
  - you can drag the island along the top edge. By default it sits ¾ of the way across, so it stays clear of coucou's island in the middle.
- **Version in the tray menu**, and this changelog.

### Improved

- The speech bubble and the activity panel no longer have drop shadows. A slightly stronger border keeps them distinct.
- Claude's "what was done" summary is shown as plain text. Markdown such as `**bold**` used to appear as raw symbols.

### Fixed

- After the app restarted, the activity panel could stay on screen as a frozen, unclickable image. The panel and bubble windows are now moved off-screen on start, and the panel draws nothing unless it's open.
- Clicking the island without dragging it no longer saves its position.

## 0.1.0 (8 October 2026)

First installable version (Windows installer, per-user, no admin rights needed).

- **Three characters:**
  - Kulhi, the chai cup
  - Hexo, the hex nut
  - Glim, the firefly

  All three are drawn in code, with a shared animation engine covering every state in the animation spec: booting, idle, attentive, touched, dizzy, working, success, suggesting, confused, error, notify, sleepy, sleeping, waking, plus being picked up and landing.
- **Lives on the desktop:**
  - sits in a corner and potters about
  - follows the cursor with its eyes and dozes off when you're away
  - can be dragged anywhere and snaps to nearby edges
- **Coding agent alerts (Claude Code):**
  - bubbles for permission requests, with the full command and Allow / Deny / In terminal
  - bubbles for finished tasks, with Claude's own summary, and for errors
  - an activity panel showing every session's steps, prompt and history
- **Everyday companion:**
  - break reminders, low battery, finished downloads
  - "welcome back" after you've been away
- **Ask:** questions about your PC, answered by Claude using your own Anthropic API key, which is stored in Windows Credential Manager.
- **Tray menu:**
  - character and size
  - stepping aside for full-screen apps
  - which reminders to show
  - Connect Claude Code (backs up your settings file first)
  - Start with Windows
