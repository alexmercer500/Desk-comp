# Product

<!-- impeccable:product-schema 1 -->

## Platform

web (the public website in `web/`). The product itself is a Windows desktop app (Tauri 2) with an Android companion app.

## Stack

Website: Vite + TypeScript, no framework (user's choice, 29 Oct 2026). It imports the app's own 2D character engine (`src/engine`, `src/skins`) so the characters on the page are the real ones. Static output from `web/`, deployed on Vercel (or any static host) with `web/` as the root.

## Users

Two audiences, equally weighted (confirmed):

- **Developers running AI coding agents** (Claude Code, Codex, Copilot, Gemini CLI, Cursor, Antigravity, Command Code) who step away or switch windows while an agent works and want to know when it's done or needs them, and to answer permission prompts without hunting for the terminal.
- **Anyone who wants a small character on their desktop**: a companion that potters about, follows the cursor, dozes off, and nudges them about breaks, finished downloads, low battery.

Both meet it on Windows; the phone app extends it for people who leave the desk.

## Product Purpose

A small character lives on the Windows desktop (in a corner, or in an island at the top edge) and keeps an eye on things: what each coding agent is doing, when it finishes (with the agent's own summary), and when it needs permission, with Allow / Deny right on its card. Everyday moments too: break reminders, downloads, battery, welcome back. Success: people keep it running all day because it is useful and they like having it there.

## Positioning

The agent watcher with a personality. One companion watches every coding agent on the PC at once and lets you answer their permission requests from its card (or your phone), while being a character with moods and reactions rather than a notification list. Free and open source (MIT), local-only, no account, no telemetry.

## Operating Context

- Windows 10/11 desktop; per-user install, no admin rights; WebView2.
- Agents are connected by switches in Settings, which add the app's hooks to each agent's own settings file (backed up first) and remove them when turned off.
- Android app pairs over the same Wi-Fi (or the phone's hotspot); away from home it can go through a relay the user runs on Cloudflare (end-to-end encrypted). Public builds will ship without a built-in relay; users paste their own (decided 29 Oct 2026).
- Updates: signed, checked every few hours from GitHub Releases (alexmercer500/Desk-comp-releases), installed only after a click.

## Capabilities and Constraints

- Characters: Kulhi (a chai cup), Hexo (a hex nut), Glim (a firefly), Billu (a ginger cat on a flying saucer), Dogesh Bhai (a scaredy pup, 2D or 3D, with outfits), Rui (a 3D yeti in a hood, with looks and colours), and **your own character** made from your pictures (an AI prompt makes a 4x2 sheet; the app cuts it into 8 moods, removes plain backgrounds).
- Agents: Claude Code and Codex get Allow / Always / Deny from the card (Claude's multiple-choice questions too); Copilot CLI and VS Code agent mode, Gemini CLI, Cursor, Antigravity: status only; Command Code: status and questions. Codex asks the user to trust the hooks once.
- Plan approval from the card (Claude Code), session names, quiet when you're already watching that agent's window.
- Everyday: break reminders ("Chai break?"), low battery, finished downloads, welcome back, optional sounds, step aside for full-screen apps.
- Ask (optional): questions about your PC answered by Claude with the user's own Anthropic API key.
- Phone (Android): see agents, Allow / Deny, reply to a finished turn, peek at an agent's window (one picture per tap, announced on the PC).
- Not code-signed yet: Windows SmartScreen warns on first install ("More info", "Run anyway"). Android APK is sideloaded (not on Play).
- Windows only for the desktop app; Linux and a Store (MSIX) build are planned, not available.
- Public name: **Kulhi** (chosen 29 Oct 2026, after the chai-cup character; the other characters are Kulhi's friends). The app itself is still called Desk Companion in code until it is renamed. Undecided: domain, logo.

## Brand Commitments

- The public name is Kulhi. The site's two actions carry equal weight: Download for Windows, and Star on GitHub.
- Website look (user, 29 Oct 2026): fun, but grown-up. The user rejected a bright, saturated sticker-sheet look as childish, then a calm near-white page as too bland and basic. Colour should feel painted and cinematic (rich, mood-led light), not flat primaries and not a white SaaS page. Kulhi stays the hero character, drawn cleanly (no sticker borders).
- The characters are the brand: their names, designs and personalities (spec in `character-animation-spec.md`, `character-blueprint-prompts.md`). Desi warmth in the details (Kulhi the chai cup, "Chai break?", Dogesh Bhai, Billu).
- Copy is plain, friendly, short; speaks to the user as "you"; no hype.

## Evidence on Hand

- The real character engine and skins (`src/engine`, `src/skins`), Rui's and Dogesh Bhai's stills (`src/assets/rui/`, phone stills), the app icon (`src-tauri/icons/`).
- CHANGELOG.md (every release since 0.1), README.md (features, privacy, security), docs/RELAY.md.
- Releases on GitHub (public): https://github.com/alexmercer500/Desk-comp-releases
- None: no users' testimonials, download counts, press, star counts, or company logos. Never invent them.

## Product Principles

1. Never in the way: it steps aside, stays quiet when you're already looking, and only a permission waits for you.
2. Nothing is allowed without your click.
3. Local and private: nothing leaves the PC except what the user opts into (Ask, the phone link).
4. Personality is function: the character's mood is the status (working, needs you, done, oops, asleep).
5. Free and open: MIT, anyone can build it with their own keys and relay.

## Accessibility & Inclusion

The app honours reduced motion (characters stop pottering and fancy motion), keyboard shortcuts for every agent action, and screen-reader labels for the character's state. The website must honour prefers-reduced-motion the same way.
