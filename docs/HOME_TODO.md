# Next phase: things to do at home

What's left after 0.7.0 that needs your own machine, phone, accounts or a decision. Work top to bottom. Tick things off as you go.

State when this was written (13 October 2026): branch `development` has everything for 0.7.0 (Windows app, Android app 0.2.0, phone link). `main` is still at the old commit. Nothing is released yet and nothing is signed.

## 1. Get the code and builds

- [ ] `git clone https://github.com/alexmercer500/Desk-comp.git`, then `git checkout development`.
- [ ] Build the Windows app and the Android app: see "Build on another machine" in `README.md`.
- [ ] Or copy over the builds made on the work PC: `Desk Companion_0.7.0_x64-setup.exe` and `app-debug.apk` (they are not in git).

## 2. Try it on a real phone (the biggest unknown)

Everything so far was tested on an emulator and a phone simulator, never a real phone.

- [ ] Follow `docs/REAL_PHONE_TEST.md` from start to finish (pairing, Allow / Deny with the fingerprint, questions, replies, characters, hotspot reconnect).
- [ ] Windows Firewall: allow Desk Companion on **private networks**. The phone can't connect without it.
- [ ] Write down what failed, with the phone model and Android version, and bring it back.
- [ ] Check the screen on your phone's size: nothing cut off, text readable, the bottom bar not covering buttons.

## 3. First real release

Do this once the phone test is good.

- [ ] Create a **public** GitHub repo for releases (for example `Desk-comp-releases`). The app's update check reads files from it, so it must be public.
- [ ] Install the GitHub CLI (`gh`) and run `gh auth login`.
- [ ] **Back up the update key** `~/.tauri/desk-companion-updater.key` somewhere safe (password manager, a drive that isn't this PC). Without it, installed copies can never be updated again. Never put it in a repo.
- [ ] Run `node scripts/release.mjs --github <owner>/<repo> --publish` (see "Releasing" in `README.md`).
- [ ] Install that release on a PC, then publish a tiny 0.7.1 and check the PC offers the update and installs it.
- [ ] Optional now, needed later: buy a code-signing certificate so Windows stops showing the SmartScreen warning (`README.md`, "signed" section).

## 4. Other checks on the Windows app

- [ ] Install on a **clean Windows account** and on a **low-end PC**: does it start, does Rui (3D) stay smooth or does it fall back to the 2D characters.
- [ ] Two Windows users on one PC: each gets their own companion (one pipe per user). Sign in as the second user and check the first one's agents don't show up.
- [ ] Uninstall: hooks are removed from Claude Code's settings (check `~/.claude/settings.json`), the relay is gone, start-with-Windows is gone.

## 5. Decisions only you can make

- [x] **Deploy the relay**: done, `https://desk-companion-relay.desktop-champ.workers.dev`.
- [ ] **Try the relay from a real phone**: on the PC, Settings → Phone → paste the address above into Relay address, Save, turn on Reach your phone anywhere ("Relay: connected"). Connect the phone once on the same Wi-Fi so it learns the address, then turn Wi-Fi off on the phone: Settings on the phone should say "Connected through the relay" within about 15 s, and requests should still arrive. Turn Wi-Fi back on: it should move back to the direct link within 5 minutes (at once if you open the app).
- [ ] **Merge `development` into `main`** when you're happy with 0.7.0 (a pull request on GitHub is the safest way).
- [ ] **Google Play?** If you ever publish the Android app there, the "stay linked while the phone sleeps" request needs a justification, and the app needs a release signing key (not the debug one). Not needed for installing the APK yourself.
- [ ] **Which files stay in the repo:** the repo holds docs and specs; decide if any should be removed before it goes public.

## 6. Work to hand back to Claude afterwards

Pick the order, and say which model (Sonnet for most, Opus for security or protocol):

- [ ] Fix whatever the real-phone test found.
- [ ] Desktop: keyboard shortcuts (Y / N for Allow / Deny, plus a global one).
- [ ] Desktop: more agents (OpenCode, Amp, a generic `--agent` option).
- [ ] Desktop: plan usage pills for Codex and Command Code, and a rate-limit state on the character.
- [ ] Later ideas: weekly recap, a sounds folder, choosing which display the character sits on, Ollama (local AI) for Ask.

## Where things are

| What | Where |
|---|---|
| Plan and progress | `ROADMAP.md` |
| What changed | `CHANGELOG.md` |
| Phone link protocol | `docs/PHONE_LINK.md` |
| Real-phone checklist | `docs/REAL_PHONE_TEST.md` |
| Android app notes | `android/README.md` |
| Remake the phone's character pictures | `node scripts/make-phone-pictures.mjs` |
| Simulate a phone (no phone needed) | `node scripts/phone-sim.mjs "<pairing link>"` |
