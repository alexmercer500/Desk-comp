# Changelog

What changed in each version of Desk Companion. The newest version is at the top.

Version numbers go up with every update:

- the **middle** number (0.**2**.0) for new features
- the **last** number (0.2.**1**) for releases that only fix bugs

The installed version is shown at the bottom of the tray menu.

## 0.10.3 (16 October 2026, Android 0.4.4 carried over)

- **Command Code's chat in VS Code now shows up.** Replies there that didn't use any tools (a question, an explanation, a story) went unnoticed. Command Code's chat panel only says something when a reply is finished, and it doesn't pass on what you asked. Desk Companion now reads your question and the reply from Command Code's own record of the chat on your PC, so you get the usual "Done: …" with the start of the answer. Replies that did use tools also show what you asked now, not just "Done". The terminal version of Command Code worked already and hasn't changed.

## 0.10.2 (15 October 2026, Android 0.4.4 carried over)

- **The phone link over the internet works with antivirus HTTPS scanning.** Avast, AVG, ESET and other antivirus programs check secure connections by putting their own certificate in front of the website's. Desk Companion only accepted certificates from its own built-in list, so on those PCs the link to the relay was slow to connect, kept retrying, or failed. It now checks certificates the way Windows and your browser do, so anything your browser trusts, it trusts too. Ask (AI) also accepts the certificates Windows trusts now.

## 0.10.1 (15 October 2026, Android 0.4.4)

- **Dogesh Bhai's outfits on your phone.** The phone app now shows Dogesh Bhai in the outfit he wears on your PC, in every mood (working, needs you, done, droop, asleep), and takes the outfit's colour. You can pick his outfit on the phone too: Settings → Character → Dogesh Bhai, and the PC changes into it. Both directions need both apps updated; an older one just keeps the Cozy scarf.
- **Android: the character picker no longer squeezes.** Settings → Character shows the characters three to a line instead of six in one row, so their names fit and the pictures are bigger.

## 0.10.0 (15 October 2026, Android 0.4.3 carried over)

- **Dogesh Bhai's outfits.** Dogesh Bhai now has nine outfits, each in its own fur colour: **Cozy scarf** (his first look), **Desi Bhai** (kurta, Nehru jacket and cap), **Detective** (trench coat, deerstalker and magnifying glass), **Superhero** (cape, mask and a lightning badge), **Rainy day** (raincoat, rain hat and boots), **Coder Bhai** (hoodie, headphones and glasses), **Pyjamas** (with a floppy nightcap), **Chef** (apron and a tall hat) and **Dapper** (sweater vest, bow tie and flat cap). Pick one in Settings → Character → Dogesh Bhai → **Outfit**. Each outfit has its own way of hiding when an agent needs you: he pulls the cap down, hides in his hood or cape, or behind a frying pan. He changes into a new outfit in a puff of smoke or behind a folding screen with clothes flying over the top. Both 3D and 2D have the outfits, and with the Character theme every window takes the outfit's colours.
- **The island at the top edge is roomier.** It's a little taller with a bigger character, and the words aren't clipped any more (underscores and letters like g and y lost their bottoms). The status line and the hover list are wider. Each session in the hover list now takes two lines, the project and then what it's doing, so you can read the whole command or page. MCP tools read as words everywhere: "Playwright · browser navigate" instead of "mcp__playwright__browser_navigate".
- **Character cards wrap.** In Settings and the Desk Companion window, the character cards fit as many to a line as there's room for and wrap the rest, so names like Dogesh Bhai aren't cut off in a narrow window. In the Desk Companion window, the cards' drawings were sometimes blank; they show now.

## 0.9.0 (15 October 2026, Android 0.4.3)

**Know that your agents are really connected.** Until now, Desk Companion only found out an agent was hooked up when that agent ran, and if something blocked it, you just saw silence.

- **Meet Dogesh Bhai**, a new character: a lanky, jittery cartoon pup with thin noodle legs, huge bulging eyes, long floppy ears and a big teal knitted scarf. He's scared of everything but brave for you in the end. When an agent needs you, he freaks out (leaps up screaming, legs spinning, fur on end), then hides under his scarf and peeks out, knees knocking. When something fails, he screams and faints stiff as a board; when a task is done, he does a wobbly jig and wipes his brow. Poke him and he jumps out of his skin. When he's idle he can't stand still: double-takes, a nervous whistle, tiptoeing, scratching behind his ear. He comes in **3D** (like Rui, in Rui's Toy or Anime look) or **2D** (drawn like the others, and lighter on your PC): Settings → Character → Dogesh Bhai → **Drawn in**. If 3D can't run on a PC's graphics, his 2D self takes over. His Character theme is butter-cream with his scarf's teal. **Android 0.4.3:** the phone knows him too.
- **The Desk Companion window.** Desk Companion now has a proper window, in the taskbar like any app, with a page for each thing: Home, Coding agents, Character, Notifications, Phone, Ask (AI), and System and updates. Home shows which agents are connected and whether they reach me, offers to connect the ones found on this PC, and links to the rest. Kulhi, Hexo, Glim and Billu wander along the top of each page (poke one); Rui stands at the end when he's your character. The window opens when you start Desk Companion yourself, after installing, when you start it again while it runs, or from the tray's **Open Desk Companion…**. It stays closed when Windows starts it at sign-in, and closing it leaves your character running. The panel's Settings tab is still there, with a link to the window.
- **Themes.** Settings → Character (or Appearance) → **Theme**: **Character** (the new default) colours every window in your character's colours: Kulhi terracotta, Hexo steel blue, Glim lavender, Billu ginger, and Rui in whatever colour he's wearing. **System** follows Windows, **Light** and **Dark** stay put. It covers everything: the character's island at the top edge (no longer always dark), the speech bubble, the panel and its Settings, and the Desk Companion window. Dark is now a neutral graphite instead of brown.
- **A new way for Rui to change colour: the trunk.** A dark magic trunk with little fangs and glowing eyes pops up behind him, and ghostly hands grab him. He panics (big trembling eyes, a wail, tears flying), falls on his tummy and claws at the floor while they drag him back by the feet, then clings to the trunk's rim until a hand prises him off. The trunk shakes, and he's thrown out in his new colour, a bit confused, then delighted. It joins the paint, twirl and wardrobe scenes in the random pick (never the same twice in a row). At the top edge Rui still just twirls, and with reduced motion the change is instant.
- **Connect in one click.** While no coding agent is connected, the Activity tab shows the agents found on this PC with a **Connect them** button. It adds the hooks (backing up each agent's settings first) and tests the connection straight away. **Not now** hides the card; Settings → Coding agents still has a switch for each agent.
- **Connection badges.** The Activity tab shows a small badge for each connected agent. Green means heard from in the last 15 minutes, faded green means heard from before, and a hollow dot means connected but nothing heard yet (open sessions don't load new hooks). Hover for when it was last heard from; click to open Settings.
- **Connection test.** Desk Companion runs its relay the way your agents do and checks that the event arrives. If the relay is missing, blocked or held up (antivirus software such as Avast's CyberCapture holds new programs for a scan), it says so in plain words and tells you which folder to allow. The test runs at start-up when an agent is connected, after connecting, and from Settings → Coding agents → **Test**.
- **Each agent's status in Settings:** "Connected · last heard 5 min ago", "Connected · nothing heard yet", "Found on this PC · not connected" or "Not found on this PC".
- **The update button shows its progress.** Installing an update fills the button from left to right as it downloads ("Downloading 42%", then "Installing…"). **Check now** shows a moving light while it checks.
- **Command Code's VS Code chat panel works.** The panel doesn't load mods, so Command Code now also gets plain hooks next to the mod: the panel shows each step and when it's done. Where the mod runs (the CLI and the desktop app), the hooks' copies are dropped, so nothing shows twice. Connecting also finds Command Code's folder when a `HOME` variable moves it, and its permission notice no longer says "in its terminal" (it may be the app).
- **Antigravity:** hooks now work when your Windows user name has a space in it (Antigravity runs hooks through `cmd /c`, which breaks quoted paths, so the relay's short path is used). The Antigravity app's install folder now counts as Antigravity being installed. Note: the older standalone Antigravity IDE doesn't run hooks at all yet; the Antigravity app and CLI do.

## 0.8.6 (15 October 2026)

- **Fixed: "Couldn't check for updates" on some networks.** GitHub serves updates from several addresses, and on some networks one of them refuses every connection while the others work. The app used to try only the first one Windows gave it. Now a failed check or download tries again from a different address, up to four times. A bad update signature is never retried.
- **Clearer update errors.** When a check still fails, the message says why (for example "connection reset"), not just "error sending request".
- **Fixed:** in Settings → System, a long update message ran over the "Updates" title. It now sits under the title, with the button on the right.
- If you're on 0.8.4 or 0.8.5 on such a network, that copy can't update itself there: install 0.8.6 by hand once. Updates work from then on.
- `scripts/release.mjs --skip-android` (or `--skip-windows`) now falls back to this machine's copy of the other app's manifest when it can't download it from GitHub.

## 0.8.5 (14 October 2026, Android 0.4.2)

- **Test release: The Little Mug That Updated Itself.** Once there was a clay mug on a desk who watched the robots work all day. One morning a note arrived through the post: a new version of you is ready. The mug did not panic. It checked the note was really from home, packed its things, and when the screen blinked it was a little taller, a little wiser, and still the same mug. Nothing else changed in this version; if you can read this on your phone, updating works.

## 0.8.4 (14 October 2026, Android 0.4.1)

- **The phone's update card keeps its buttons on screen.** A long list of release notes no longer pushes Update and Check now off the bottom; only the first lines are shown.
- First release published through GitHub for both apps (0.8.3 was the first); this one is the first update on top of it.

## 0.8.3 (14 October 2026, Android 0.4.0)

- **The Android app can now update itself.** Settings has an Updates card: it checks when you open the app (at most every 6 hours) and has a Check now button. When a newer version is out you get a notification and an Update button. The app downloads it, checks it against its published checksum and that it's signed with the same key as the installed copy, then hands it to Android's own install screen. The first time, Android asks you to allow installs from Desk Companion.
- **One command now publishes both apps.** `node scripts/release.mjs --github owner/repo --publish` builds the signed Windows installer and the signed Android APK and uploads them with `latest.json` and `android.json`. It refuses to publish with uncommitted changes, when the branch is behind `origin`, or when that version already exists. See docs/RELEASING.md.
- **Android release signing.** The phone app is now signed with its own release key (kept outside the repo). Phones that have the older, debug-signed 0.3.x need to uninstall it once and pair again; from 0.4.0 on, updates install over the top.

## 0.8.2 (14 October 2026)

- **Replies from your phone work whenever Away mode is on.** Before, a finished Claude Code task only waited for your reply if nobody had touched the PC for a whole minute, so the phone's Send button stayed greyed out when you tried it from your desk. Now Away mode on the phone is enough: each finished task waits up to 5 minutes for a reply. Using the PC's keyboard or mouse still lets it go at once, so working at the PC isn't held up.
- **Android 0.3.1:** the hint above the reply box no longer runs into the text scrolling underneath it, and it says why a reply can't be sent yet.

## 0.8.1 (14 October 2026)

- **Fixed:** after installing or updating, the app could start without listening to your coding agents at all: the character and your phone stayed "All quiet" until the app was restarted. It happened when the copy being replaced hadn't quite let go yet. The app now keeps trying until it can listen.

## 0.8.0 (14 October 2026)

**Your phone, away from home.** Desk Companion for Android (0.3.0) now works when the phone isn't on the PC's network: on mobile data, at work, anywhere.

- **Reach your phone anywhere** (Settings → Phone, off by default). Both the PC and the phone connect out to a small relay that you run yourself on Cloudflare's free plan (`docs/RELAY.md` has the 10-minute setup). Paste its address into **Relay address**, click **Save**, turn the switch on, and the line under it says "Relay: connected". The phone learns the address on its next connection at home, or from a new pairing code.
- **The relay can't read anything.** Everything is encrypted between the PC and the phone with keys made from the pairing secret in the QR code, which never goes through the internet. Each message is numbered and tied to its connection, so nothing recorded on the way can be played back. **Pair again** changes every key.
- **Direct first.** On the same Wi-Fi or hotspot the phone still connects straight to the PC. It only goes through the relay when it can't, and moves back to the direct link when it's home again (within 5 minutes, or at once when you open the app). On the phone, Settings says which: "Connected through the relay, encrypted end to end". On the PC, such a phone shows as "connected (through the relay)".
- **Built in, nothing to paste.** Put your relay's address in a `.env` file before building (`DESK_COMPANION_RELAY=…`, see `.env.example`) and the app comes with it: Reach your phone anywhere is on, and the phone gets the address from the pairing code. `.env` stays out of git, so anyone who builds the app uses their own relay. A pasted address in Settings still overrides it.
- **Pair from anywhere.** A PC wired to a LAN, with no Wi-Fi, can pair with a phone on its own mobile data: with the relay on, the pairing code works through the relay alone, even when the PC has no address a phone could reach.
- Everything works the same through the relay: notifications, Allow / Deny behind the fingerprint, answers to Claude's questions, replies when a task finishes, the character.
- **Fixed on Android:** tapping **Link** (when asked to allow notifications) or **Scan the code** (when asked for the camera) crashed the app on a phone that hadn't given those permissions yet.
- On the phone, mobile data no longer counts as a local network, so it doesn't knock on the carrier's addresses looking for the PC.
- `scripts/phone-sim.mjs --relay` plays a phone through the relay, for testing.

## 0.7.0 (13 October 2026)

The big ones: a safer Allow / Deny, live diffs, and **Desk Companion for Android**: get a notification on your phone when an agent needs you or finishes, Allow or Deny it, answer Claude's questions, and reply when a task is done, all over your own network.

- **Live diffs.** When an agent edits a file, the panel shows how many lines changed (`+42 −7`) next to the task's summary, and "What it did" → Files changed lists each file with its own `+N −M`. Click a file to see the lines that changed, with a little context. It's built only from the text the agent's own edit tool sent (Edit, MultiEdit, Write and the same shapes from other agents), after the tool ran, so a refused edit never counts and nothing is read from your disk. A whole-file write counts every line as added. Very large edits keep their counts but not their lines; at most 50 files per task and 400 lines per file are kept.
- **Safer Allow / Deny.**
  - The buttons ignore clicks for 0.6 s after a card appears, so a click meant for whatever was under the cursor can't land on Allow. This applies to the bubble, the top-edge island, the panel and question answers.
  - An agent only waits for a card that's actually on screen. The card must report itself shown within 2 seconds; if it doesn't (a full-screen app is in front, or the window is stuck), the agent is let go at once and asks in its terminal, instead of waiting up to two minutes for a card nobody saw.
  - In the corner bubble, a passing notification (say, another session finishing) no longer replaces a permission card for good: the card comes back when the notification ends, and several waiting requests line up, newest first. A new request also goes in front of a passing notification. The top-edge island already worked this way.
- **"Other…" for Claude's questions.** Every question now has an **Other…** button for an answer of your own, as in the terminal. In the panel it shows a text box (Enter sends). The speech bubble and the top-edge island never take the keyboard focus, so they can't interrupt your typing elsewhere; there **Other…** opens the panel on that session instead. For a question where several answers are allowed, your text is added after the options you picked. The relay accepts typed answers up to 500 characters with no control characters; they still have to be for a question that was asked.
- **Phone link** (for Desk Companion for Android, see below). Settings → Phone → **Link a phone** (off by default) lets a phone on the same network, or a PC on the phone's hotspot, see your sessions and Allow / Deny requests. Pairing is by a QR code shown only when you click **Show pairing code**; the phone pins the PC's own certificate and signs in with a secret token, over TLS 1.3. Only local addresses can connect; nothing goes through the internet. **Pair again** makes a new code and unlinks every phone. A phone's answer goes to the agent exactly like a click here, and the card on the PC closes. The certificate and token live in Windows Credential Manager. The protocol is in `docs/PHONE_LINK.md`; `scripts/phone-sim.mjs` plays a phone for testing.
- **One pipe per Windows user.** The relay and the app now talk over a pipe named after the user's account (its SID), so two people signed in to the same PC each get their own companion, and no other account can take the name first. The relay and the app build the name from the same code. When the app updates the relay while a hook is still running the old one, it now moves the old copy aside instead of leaving it in place.

- **Answer Claude's questions from your phone.** Claude Code's multiple-choice questions reach the phone as a notification; pick an option (or several, or type your own) and the answer goes to Claude exactly like one picked on the PC.
- **Reply from your phone when a task finishes.** While you're away from the PC (a linked phone has **Away mode** on and nobody has touched the PC for a minute), a finished Claude Code task waits up to 5 minutes for a reply. Type one in the app, or right in the notification, and Claude carries on with it. Touch the keyboard or mouse and it ends as usual at once. For this, Claude Code's Stop hook now runs in step with Claude (it returns in a few milliseconds when there's nothing to wait for).

- **Your character on your phone.** The Android app now shows the character you picked on the PC (Kulhi, Hexo, Glim, Billu or Rui) in the mood of each session, and takes its colours from that character. Pick another on the phone (Settings → Character, with Rui's look and colour) and it changes on the PC too, and the other way round.

- **The phone finds your PC again on its own.** When the PC's address changes (your phone's hotspot gives it a new one), the phone searches its own network for it, only the PC with the paired certificate can answer, and remembers the new address. It also reconnects as soon as the network changes or you open the app. A new setting, **Stay linked while the phone sleeps**, keeps requests arriving with the screen off.

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
