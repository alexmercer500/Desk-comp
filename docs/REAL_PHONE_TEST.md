# Trying it on a real phone

A checklist for the first test with your own phone. About 20 minutes. Tick things off; anything that fails, note what you saw.

## Set up

- [ ] Install the new Windows installer, then the APK (copy it to the phone, open it, allow "install unknown apps" once).
- [ ] PC: Settings → Phone → turn on **Link a phone**.
- [ ] Windows asks about the firewall the first time: tick **Private networks**. (Later: Windows Security → Firewall → Allow an app.)
- [ ] Phone and PC on the same Wi-Fi, or the PC joined to your phone's hotspot.
- [ ] PC: **Show pairing code**. Phone: Settings → Link a computer → **Scan the code** → check the PC's name → **Link**.
- [ ] Allow notifications when the phone asks.

## Basics

- [ ] The phone's Settings says **Linked / Connected**, and your PC's character shows.
- [ ] Start Claude Code in a project. It appears on the phone's Home.
- [ ] Ask Claude something that needs permission (run a command). A notification arrives within a second or two; the lock screen shows only "Approval needed".
- [ ] **Deny** from the notification works without unlocking. The card on the PC closes.
- [ ] Again, tap the notification → **Allow** → the fingerprint / screen-lock prompt appears → the agent carries on.
- [ ] Answer it on the PC instead: the notification on the phone disappears.

## Questions and replies

- [ ] Make Claude ask a multiple-choice question (e.g. "ask me which colour"). A notification arrives; answer from the phone (an option, and once with **Other…**).
- [ ] Phone: Settings → **Away mode** on. Give Claude a short task, then walk away from the PC for over a minute (no keyboard or mouse). When it finishes, the "done" notification offers **Reply**. Reply "Now add a test". Claude continues in the same terminal.
- [ ] Do the same but touch the PC's mouse before the reply: the task simply ends, no hold.

## Characters

- [ ] Phone: Settings → Character → pick another. The PC's character changes too. Change it on the PC: the phone follows (colours and picture).

## Reconnecting

- [ ] Phone: Settings → **Stay linked while the phone sleeps** → Allow.
- [ ] Lock the phone for 10 minutes, then trigger a permission request: it should arrive on the lock screen.
- [ ] Turn the phone's hotspot off and on (the PC gets a new address). The phone reconnects by itself within about 30 seconds (sooner when you open the app).
- [ ] Turn off Wi-Fi on the phone for a minute, then on: it reconnects.
- [ ] PC: **Pair again**. The phone says it's been unlinked and asks you to scan the new code.

## Note

Things that need a note from you: time a notification took, anything that said "Not connected", anything unreadable on your screen size, and the phone model and Android version.
