---
name: Kulhi
description: A tiny chai cup that lives on your desktop and keeps an eye on your coding agents. The public website's calm, precise light world.
colors:
  bg: "#f7f7f8"
  surface: "#ffffff"
  ink: "#111114"
  ink-2: "#34343d"
  muted: "#5d5d69"
  hair: "#e6e6ea"
  hair-2: "#d6d6dd"
  violet: "#5848e8"
  device: "#0f0e15"
  device-2: "#1c1a26"
  peach: "#fdede4"
  lavender: "#eeebfd"
  sky: "#e6eefc"
  mint: "#e4f4ec"
  work: "#f0a21a"
  ask: "#ee4377"
  done: "#23a764"
typography:
  display:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(2.6rem, 5.2vw, 4.6rem)"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(2rem, 3.8vw, 3.2rem)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(1.45rem, 2.2vw, 1.85rem)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  lede:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "1.1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 550
    lineHeight: 1.4
  mono:
    fontFamily: "Geist Mono Variable, ui-monospace, Cascadia Mono, monospace"
    fontSize: "0.82rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xs: "8px"
  sm: "10px"
  md: "12px"
  window: "14px"
  toast: "16px"
  card: "18px"
  panel: "20px"
  plate: "26px"
  field: "28px"
  pill: "999px"
spacing:
  gutter: "clamp(1rem, 4vw, 2.5rem)"
  wrap: "min(1160px, 100% - 2 * gutter)"
  section: "clamp(4.5rem, 8.5vw, 7.25rem)"
  split-gap: "clamp(2.5rem, 6vw, 5rem)"
  stack: "0.75rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "0 1.35rem"
    height: "3.1rem"
  button-primary-hover:
    backgroundColor: "#26262e"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 1.35rem"
    height: "3.1rem"
  nav-link:
    textColor: "{colors.muted}"
    rounded: "{rounded.xs}"
    padding: "0.4rem 0.75rem"
  nav-github:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.45rem 0.85rem"
  surface-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.toast}"
    padding: "1rem 1.1rem"
  field-tinted:
    backgroundColor: "{colors.peach}"
    rounded: "{rounded.field}"
    padding: "2.5rem 2rem 3.5rem"
  app-card:
    backgroundColor: "{colors.device}"
    textColor: "#f4f3f8"
    rounded: "{rounded.card}"
    padding: "1rem 1.05rem 1.05rem"
  app-island:
    backgroundColor: "{colors.device}"
    textColor: "#f4f3f8"
    rounded: "{rounded.pill}"
    padding: "0.55rem 1.05rem"
---

# Design System: Kulhi

**Scope.** This system governs only the public website (`web/`). The desktop app's own windows (`app.html`, the panel, the companion, the bubble) keep their own look, defined in `src/panel/style.css` and `src/theme.ts`, and are not governed here. Inside the site, the dark permission card and the dark island are copies of the app's real UI: they are part of the depiction, not general site chrome, and their dark values do not license dark site surfaces.

## Overview

**Creative North Star: "The Quiet Desk"**

A calm, precise light page where the product proves itself. The page is a cool near-white plane with white surfaces separated by hairlines and soft layered shadow; type is ink, set in one family (Geist) with tight display tracking. Colour appears only where it means something: soft, character-tinted fields that hold a character or a real UI fragment, and tiny state dots (amber working, rose needs you, green done). The characters, drawn live by the app's own engine, are the only illustration.

The page sits alongside Notion, Superhuman, Arc, Framer, Linear and Raycast: modern, slick, light. It rejects the bright die-cut sticker sheet it replaced (judged childish) and equally the dark neon dev-tool page. No saturated full-width colour blocks; no sticker borders around characters.

Density is generous: one idea per section, sections divided by a single hairline and large vertical rhythm, copy capped near 62ch.

**Key Characteristics:**
- Cool near-white page, white surfaces, hairline dividers.
- Ink type and an ink primary button; violet only for focus and caret.
- Colour as pale character-tinted fields and 8px state dots, never as blocks.
- One sans family (Geist) at weights 400-650; Geist Mono only for real commands and terminal lines.
- Large radii (14-28px) and soft, layered, low-opacity shadows.
- Live characters with a soft drop shadow, no outline.

## Colors

A near-monochrome cool-grey and ink palette, lit by four pale pastel fields and three small state colours.

### Primary
- **Ink** (`ink`): headings, strong labels, links, the primary button fill, step counters, the phone frame. The page's one decisive colour.

### Secondary
- **Focus Violet** (`violet`): the focus-visible outline (2px, 3px offset) and the text caret. Nothing else. Selection uses its pale tint (#dcd6ff).

### Tertiary (character fields)
- **Chai Peach** (`peach`): Kulhi's field; also the top of the closing panel's gradient into white.
- **Glim Lavender** (`lavender`), **Hexo Sky** (`sky`), **Billu Mint** (`mint`): pale fields and cast plates tinted from each character. Sky also backs the phone panel.

### State
- **Working Amber** (`work`): the pulsing dot while an agent works.
- **Needs-you Rose** (`ask`): the dot on a waiting permission card or session.
- **Done Green** (`done`): the done dot, table check marks, the note bullet.

### Neutral
- **Cool Paper** (`bg`): page background, scrollbar track.
- **White** (`surface`): windows, table panel, toasts, secondary buttons.
- **Ink Soft** (`ink-2`): body text default.
- **Muted Slate** (`muted`): sublines, supporting copy, nav links at rest, table headers, timestamps.
- **Hairline** (`hair`) and **Hairline Strong** (`hair-2`): section rules, table rows, window bars (hair); button and nav-chip borders, FAQ and ledger rules, dashed "your own" slot (hair-2).
- **Device Black** (`device`) and **Device Raised** (`device-2`): only for the depicted app card and island and their inner rows.

### Named Rules
**The Meaningful Colour Rule.** Colour appears only as a pale field behind a character or product fragment, or as an 8px state dot. No saturated fills, no full-width colour bands.

**The Violet Is For Focus Rule.** Violet marks keyboard focus and the caret. Links stay ink with a hairline underline that darkens on hover.

**The Depicted Device Rule.** Device black belongs to copies of the app's UI. Site chrome never goes dark.

## Typography

**Display Font:** Geist Variable (with Segoe UI, system-ui)
**Body Font:** Geist Variable
**Label/Mono Font:** Geist Mono Variable (with ui-monospace, Cascadia Mono), terminal and command text only

**Character:** One neutral, engineered sans carries everything; hierarchy comes from size and negative tracking, not from a second face.

### Hierarchy
- **Display** (600, clamp 2.6-4.6rem, 1.02, -0.04em): the hero headline only, centred, max 20ch, balanced wrap.
- **Headline** (600, clamp 2-3.2rem, 1.08, -0.035em): section headings.
- **Title** (600, clamp 1.45-1.85rem, 1.2, -0.025em): feature headings.
- **Body** (400, 1.0625rem, 1.6): running copy in ink-2, max 62ch, pretty wrap. Section copy steps up to 1.1rem in muted (lede).
- **Label** (550, 0.82-0.95rem): table headers, nav links, card titles, timestamps (tabular figures).
- **Mono** (400, 0.82rem, 1.5): terminal lines and the command on the permission card.

### Named Rules
**The One Family Rule.** Geist for all prose and UI; mono appears only where the text is a real command or terminal output.

**The Tight Display Rule.** Larger type tracks tighter (-0.04em display down to -0.01em on buttons); body stays at normal tracking.

## Layout

A single centred column, `wrap` wide (max 1160px with a fluid gutter). Sections stack with `section` padding top and bottom, each divided by one hairline rule. Content sections use a two-column split (roughly 0.85fr copy / 1.15fr evidence, `split-gap` between); feature rows alternate sides (flip) and one runs full width. The hero is centred: headline, subline, two equal buttons side by side, a fine-print line, then a wide 16:7.4 desktop stage.

Responsive: at 900px splits, features and the phone panel collapse to one column and the desk becomes 4:3.6 (the shop window hides). At 560px nav links hide, buttons go full width, the desk becomes 3:4.8, the ledger stacks, the ask field becomes a vertical stack, and table cells tighten.

## Elevation & Depth

Hybrid: surfaces are mostly flat white on cool paper, separated by hairlines, with soft layered shadow to lift windows and panels. Shadows are ink-tinted, low-opacity, wide-blurred, and offset straight down; never hard or offset.

### Shadow Vocabulary
- **Small** (`0 1px 2px rgb(17 17 20 / 0.06), 0 1px 1px rgb(17 17 20 / 0.04)`): secondary buttons, nav GitHub chip, table panel, toasts, phone notes, the shop window.
- **Medium** (`0 1px 2px rgb(17 17 20 / 0.05), 0 8px 24px -6px rgb(17 17 20 / 0.12)`): the terminal window and floating toast fragment.
- **Large** (`0 0 0 1px rgb(17 17 20 / 0.05), 0 2px 4px rgb(17 17 20 / 0.04), 0 32px 64px -24px rgb(17 17 20 / 0.22)`): the hero desk, the phone, the closing panel.
- **Character** (`drop-shadow(0 14px 14px rgb(17 17 20 / 0.14))`): live characters and Rui's still.

### Named Rules
**The Soft Lift Rule.** Depth is layered, diffuse and ink-tinted; no hard offset shadows and no outlines around characters.

## Shapes

Generous, consistent rounding that grows with the object: 8px for nav links, focus rings and toast icons; 10px for small chips and inner command blocks; 12px for buttons; 14px for depicted windows; 16-18px for toasts and the app card; 20px for the table panel; 26-28px for plates, fields and the hero desk; 32-46px for the phone panel, close panel and phone frame. Pills (999px) for the island and round dots. Borders are 1px hairlines; the only dashed border is the "your own" slot (1.5px, hair-2).

## Components

### Buttons
Quiet and solid: equal-weight pair in the hero and close.
- **Shape:** gently rounded (12px), min 13.5rem wide, 3.1rem tall.
- **Primary:** ink fill, white text, weight 550, inner top highlight plus a soft ink drop shadow.
- **Secondary:** white with a hair-2 border and the small shadow, ink text.
- **Hover / Focus:** lift 1px (0.3s, expo-out ease); primary lightens slightly, secondary's border darkens to muted. Active returns to rest. Focus is the violet ring.

### Navigation
Brand (live Kulhi mark at 30px plus wordmark, 650) left; muted text links (0.95rem, 500) with a faint ink hover wash on 8px corners; a white bordered GitHub chip at the right. Links hide below 560px.

### Cards / Containers
- **Surface cards** (table panel, toasts): white, 1px hair border, small shadow, 16-20px corners, about 1rem padding.
- **Tinted fields**: pastel background, 28px corners, no border or shadow, holding one character and one real UI fragment.
- **Cast plates**: square pastel tiles (26px) with the character at 74% width; the "your own" slot is dashed.

### Tables
The agent matrix: white panel, hairline row rules, a faint header row in muted label type, green check / grey minus SVG marks with accessible labels, muted inline "extra" notes.

### Lists
- **Ledger**: definition rows on hairlines, 11rem term column, muted description.
- **Steps**: ink circular counters (2rem) beside bold step titles.
- **FAQ**: details rows on hair-2 rules; a masked plus that rotates to a cross when open.

### Status Dots
8px circles: grey idle, amber working (pulsing opacity, 1.4s), rose needs you, green done. The only bright colour on the page.

### Hero Desk (signature)
A 28px-rounded desktop with its own chai-ripple wallpaper (pale rings over a cool gradient), a frosted taskbar, a light terminal window over a faded shop window, the dark island at the top edge, the dark permission card growing out of it (0.5s grow), and a large live Kulhi at the right. The demo plays only when on screen; terminal lines type in with a 4px slide.

### Depicted App UI
The permission card, island list and session rows copy the app's real UI: device black, device-raised rows, near-white text, a light Allow button beside dark Always/Deny. Keep these faithful to the app; they are not site components.

### Characters
Live canvases from the app's engine (Rui as a still). Soft drop shadow, 1.03 hover scale, a squash-and-stretch poke on click, eyes following the cursor.

## Do's and Don'ts

### Do:
- **Do** keep the page cool paper with white surfaces and hairline dividers.
- **Do** use ink for the primary action and keep Download and Star equal in size.
- **Do** put colour only in pale character fields and 8px state dots.
- **Do** set everything in Geist with tight display tracking; use Geist Mono only for real commands.
- **Do** show real product fragments and live characters as the proof.
- **Do** use the layered soft shadows from the vocabulary and radii that grow with the object.

### Don't:
- **Don't** use saturated full-width colour blocks or bright toy palettes.
- **Don't** put sticker borders, outlines or hard offset shadows on characters or cards.
- **Don't** make site chrome dark; device black is only for depicted app UI.
- **Don't** use violet for decoration, buttons or links; it marks focus.
- **Don't** add a second display face or eyebrow/kicker labels above headings.
- **Don't** apply this system to the desktop app's windows; they follow `src/panel/style.css` and `src/theme.ts`.
