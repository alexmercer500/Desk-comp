// Dogesh Bhai changing outfit in 2D: a little scene drawn on a canvas laid
// over his own, hiding him while the outfit swaps. Two scenes:
//   "puff":   a cartoon smoke puff blooms over him, wobbles, sparkles and clears (~1.6 s);
//   "screen": a folding dressing screen slides in front of him and opens, old
//             clothes fly over the top and tumble away, then it folds and slides
//             off; he stays ducked behind it (so a tall new hat can't peek over the
//             top) and springs up as it goes (~3.5 s).
// The window is transparent and click-through, so only the scene is drawn,
// never a background. The caller skips the scene under reduced motion.

import { Ease, clamp, lerp, smoothstep } from "../engine/ease";
import { dogesh } from "../skins/dogesh";

export type ChangeKind = "puff" | "screen";

const TAU = Math.PI * 2;
/** The cartoon line (dark brown, like his). */
const LINE = "#5A3A1E";

/** How long each scene runs, and when he's fully hidden (the swap), in ms. */
const TIMING: Record<ChangeKind, { dur: number; swapAt: number }> = {
  puff: { dur: 1600, swapAt: 560 },
  screen: { dur: 3500, swapAt: 1650 },
};

/** Plays a change over `host` (his canvas), calls `swap` while he's hidden, and resolves when it's over. */
export function playDogeshChange(host: HTMLCanvasElement, kind: ChangeKind, swap: () => void): Promise<void> {
  return new Promise((resolve) => {
    let swapped = false;
    const doSwap = () => {
      if (swapped) return;
      swapped = true;
      try {
        swap();
      } catch (err) {
        console.error(err);
      }
    };
    const rect = host.getBoundingClientRect();
    const size = host.clientWidth || rect.width;
    const overlay = document.createElement("canvas");
    const g = rect.width > 0 && rect.height > 0 ? overlay.getContext("2d") : null;
    if (!g) {
      doSwap();
      resolve();
      return;
    }
    const dpr = globalThis.devicePixelRatio || 1;
    overlay.width = Math.round(rect.width * dpr);
    overlay.height = Math.round(rect.height * dpr);
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.cssText =
      `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;` +
      "pointer-events:none;z-index:2147483000;background:transparent;";
    document.body.append(overlay);

    // The same space he's drawn in: units, origin on the ground under him, y down.
    const U = size / dogesh.fit.units;
    const ox = rect.width / 2, oy = size * dogesh.fit.base;
    const { dur, swapAt } = TIMING[kind];
    const draw = kind === "puff" ? drawPuff : drawScreen;
    // Behind the screen he ducks (his canvas squashed down onto his feet), put back after.
    const duck = kind === "screen";
    const prevTransform = host.style.transform, prevOrigin = host.style.transformOrigin;
    if (duck) host.style.transformOrigin = `50% ${(oy / rect.height) * 100}%`;

    let done = false;
    let raf = 0;
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      clearTimeout(safety);
      doSwap();
      if (duck) {
        host.style.transform = prevTransform;
        host.style.transformOrigin = prevOrigin;
      }
      overlay.remove();
      resolve();
    };
    // If frames stop (a hidden window), still swap and clean up.
    const safety = setTimeout(finish, dur + 1500);
    const start = performance.now();
    const frame = (now: number) => {
      if (done) return;
      const ms = now - start;
      if (ms >= swapAt) doSwap();
      if (ms >= dur) {
        finish();
        return;
      }
      if (duck) {
        const sy = screenDuck(ms);
        host.style.transform = sy === 1 ? prevTransform : `${prevTransform} scale(${1 + (1 - sy) * 0.35}, ${sy})`.trim();
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, rect.width, rect.height);
      g.translate(ox, oy);
      g.scale(U, U);
      g.lineCap = "round";
      g.lineJoin = "round";
      draw(g, ms);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
}

// ── Puff ──────────────────────────────────────────────────────────────────────

/** Cloud blobs over his body (x, y, radius, delay ms), big enough to hide him and his ears. */
const BLOBS: [number, number, number, number][] = [
  [0.06, -0.56, 0.4, 0], [-0.2, -0.32, 0.24, 40], [0.32, -0.34, 0.26, 70], [-0.16, -0.82, 0.25, 50],
  [0.3, -0.84, 0.24, 90], [0.04, -1.02, 0.25, 110], [0.08, -0.17, 0.22, 60], [-0.3, -0.13, 0.14, 130],
  [0.4, -0.12, 0.15, 120], [0.5, -0.58, 0.17, 150], [-0.36, -0.58, 0.16, 140], [-0.27, -1.0, 0.12, 170],
  [0.3, -1.08, 0.14, 180], [-0.42, -0.36, 0.1, 200], [0.58, -0.86, 0.1, 210],
  [-0.1, -0.05, 0.14, 90], [0.22, -0.05, 0.15, 100],
];
const SPARKLES: [number, number, number, number][] = [
  [-0.5, -1.0, 0.07, 250], [0.62, -0.86, 0.06, 380], [-0.52, -0.3, 0.05, 520], [0.6, -0.2, 0.065, 650],
  [0.12, -1.3, 0.06, 760], [-0.2, -1.22, 0.045, 900],
];

function drawPuff(g: CanvasRenderingContext2D, ms: number) {
  // Bloom (to ~350 ms), wobble, then from 950 ms drift apart, shrink and fade.
  const clear = smoothstep(950, 1550, ms);
  const blobs = BLOBS.map(([x, y, r, delay], i) => {
    const grow = Ease.outBack(clamp((ms - delay) / 300, 0, 1));
    const wob = 1 + 0.06 * Math.sin(ms / 70 + i * 1.7) * (1 - clear);
    const away = Math.hypot(x - 0.06, y + 0.56) || 1;
    const drift = clear * clear * 0.5;
    return {
      x: x + ((x - 0.06) / away) * drift,
      y: y + ((y + 0.56) / away) * drift - clear * 0.25,
      r: Math.max(0, r * grow * wob * (1 - 0.75 * clear)),
    };
  });
  g.save();
  const fade = 1 - smoothstep(1150, 1560, ms);
  // Outline every blob first, then fill them all: one cloud with only its outer edge drawn.
  // (The outline goes first as it breaks up, so the wisps don't turn into bubbles.)
  g.globalAlpha = fade * (1 - smoothstep(0.15, 0.55, clear));
  g.strokeStyle = LINE;
  g.lineWidth = 0.028;
  for (const b of blobs) {
    if (b.r <= 0.001) continue;
    g.beginPath();
    g.arc(b.x, b.y, b.r, 0, TAU);
    g.stroke();
  }
  const fill = g.createLinearGradient(0, -1.3, 0.3, 0.1);
  fill.addColorStop(0, "#FFFFFF");
  fill.addColorStop(0.55, "#F6F1E8");
  fill.addColorStop(1, "#DDD3C4");
  g.fillStyle = fill;
  g.globalAlpha = fade;
  for (const b of blobs) {
    if (b.r <= 0.001) continue;
    g.beginPath();
    g.arc(b.x, b.y, b.r, 0, TAU);
    g.fill();
  }
  // A few curls of shading along the lower edges of the puffs.
  g.strokeStyle = "rgba(160,138,112,0.5)";
  g.lineWidth = 0.014;
  for (const k of [1, 2, 6, 9]) {
    const b = blobs[k];
    if (b.r <= 0.05) continue;
    g.beginPath();
    g.arc(b.x, b.y, b.r * 0.7, 0.5, 1.6);
    g.stroke();
  }
  g.restore();
  for (const [x, y, r, at] of SPARKLES) {
    const k = clamp((ms - at) / 520, 0, 1);
    if (k <= 0 || k >= 1) continue;
    star(g, x, y - 0.1 * k, r * Math.sin(Math.PI * k), (ms / 400) % TAU);
  }
}

/** A gold four-pointed sparkle. */
function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number) {
  if (r <= 0.002) return;
  g.save();
  g.translate(x, y);
  g.rotate(spin * 0.3);
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const rr = i % 2 ? r * 0.32 : r;
    g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = "#F6C85F";
  g.fill();
  g.strokeStyle = LINE;
  g.lineWidth = 0.01;
  g.stroke();
  g.restore();
}

// ── Dressing screen ───────────────────────────────────────────────────────────

const SCREEN = {
  /** Where it stands open (centre x), how wide and tall (units). */
  x: 0.07, width: 1.08, height: 1.24,
  wood: "#A0703F", woodDark: "#7A5230", woodLight: "#C08A54",
  cloth: "#E3925A", clothShade: "#C9773F", pattern: "#F6CB93",
};

/** How tall he stands behind the screen: ducked (squashed onto his feet) once it's open, springing up as it leaves. */
const DUCK = 0.8;
function screenDuck(ms: number): number {
  if (ms < 650) return 1;
  if (ms < 3150) return lerp(1, DUCK, Ease.inOutSine(clamp((ms - 650) / 250, 0, 1)));
  return lerp(DUCK, 1, Ease.outBack(clamp((ms - 3150) / 330, 0, 1)));
}

function drawScreen(g: CanvasRenderingContext2D, ms: number) {
  // Slides in folded from the right (0–450), opens (450–850), shakes as he
  // changes, then slides off to the left (2700–3250), folding as it goes.
  const inK = Ease.outBack(clamp(ms / 450, 0, 1));
  const outK = Ease.inQuad(clamp((ms - 2700) / 550, 0, 1));
  const cx = lerp(1.5, SCREEN.x, inK) + lerp(0, -2.0, outK);
  const open = Ease.outBack(clamp((ms - 420) / 420, 0, 1)) * (1 - Ease.inOutSine(clamp((ms - 2900) / 350, 0, 1)));
  const busy = ms > 850 && ms < 2600 ? 1 : 0;
  const shake = busy * 0.012 * Math.sin(ms / 45) * (0.5 + 0.5 * Math.sin(ms / 230));
  // Clothes fly out over the top, behind the screen.
  for (const item of ITEMS) drawItem(g, item, ms, cx);
  drawFoldingScreen(g, cx, open, shake, ms);
  // Little rustle marks while he wriggles out of the old clothes.
  if (busy) {
    g.save();
    g.strokeStyle = LINE;
    g.lineWidth = 0.014;
    g.globalAlpha = 0.6 + 0.4 * Math.sin(ms / 90);
    const top = -SCREEN.height - 0.05;
    for (const [dx, a] of [[-0.25, -0.5], [0.0, 0], [0.25, 0.5]] as const) {
      const hop = 0.02 * Math.sin(ms / 60 + dx * 9);
      g.beginPath();
      g.moveTo(cx + dx + Math.sin(a) * 0.03, top - 0.02 + hop);
      g.lineTo(cx + dx + Math.sin(a) * 0.09, top - 0.09 + hop);
      g.stroke();
    }
    g.restore();
  }
}

/** The three-panel folding screen, `open` 0 (stacked) … 1 (zig-zag, wide open). */
function drawFoldingScreen(g: CanvasRenderingContext2D, cx: number, open: number, shake: number, ms: number) {
  const pw = SCREEN.width / 3;
  const w = pw * lerp(0.2, 1, open);
  const H = SCREEN.height;
  const left = cx - (w * 3) / 2;
  g.save();
  g.translate(cx, 0);
  g.rotate(shake);
  g.translate(-cx, 0);
  // Panels: the middle one turns away from us (darker, a touch shorter at its folds).
  for (let i = 0; i < 3; i++) {
    const x0 = left + i * w, x1 = x0 + w;
    const away = i === 1;
    const lift = (away ? 0.03 : 0) * open;
    const y0 = -H + lift, y1 = 0.0;
    const arch = 0.06;
    const panel = new Path2D();
    panel.moveTo(x0, y1);
    panel.lineTo(x0, y0 + arch);
    panel.quadraticCurveTo((x0 + x1) / 2, y0 - arch, x1, y0 + arch);
    panel.lineTo(x1, y1);
    panel.closePath();
    // Wooden frame.
    g.fillStyle = away ? SCREEN.woodDark : SCREEN.wood;
    g.fill(panel);
    g.strokeStyle = LINE;
    g.lineWidth = 0.014;
    g.stroke(panel);
    // Cloth inset.
    const m = Math.min(0.035, w * 0.18);
    const cloth = new Path2D();
    cloth.moveTo(x0 + m, y1 - 0.08);
    cloth.lineTo(x0 + m, y0 + arch + m);
    cloth.quadraticCurveTo((x0 + x1) / 2, y0 - arch + m * 1.6, x1 - m, y0 + arch + m);
    cloth.lineTo(x1 - m, y1 - 0.08);
    cloth.closePath();
    g.fillStyle = away ? SCREEN.clothShade : SCREEN.cloth;
    g.fill(cloth);
    g.save();
    g.clip(cloth);
    // A small flower print, and a soft shadow down one side.
    g.fillStyle = SCREEN.pattern;
    g.globalAlpha = away ? 0.55 : 0.8;
    for (let row = 0; row < Math.ceil((H - 0.15) / 0.12); row++) {
      for (let col = 0; col < 3; col++) {
        const px = x0 + ((col + 0.5 + (row % 2) * 0.5) / 3) * w;
        const py = y0 + 0.12 + row * 0.12;
        for (let p = 0; p < 4; p++) {
          const a = (p / 4) * TAU + 0.4;
          g.beginPath();
          g.arc(px + Math.cos(a) * 0.014, py + Math.sin(a) * 0.014, 0.011, 0, TAU);
          g.fill();
        }
      }
    }
    g.globalAlpha = 1;
    const sh = g.createLinearGradient(x0, 0, x1, 0);
    sh.addColorStop(0, away ? "rgba(70,30,10,0.05)" : "rgba(70,30,10,0)");
    sh.addColorStop(1, away ? "rgba(70,30,10,0.25)" : "rgba(70,30,10,0.12)");
    g.fillStyle = sh;
    g.fill(cloth);
    g.restore();
    g.strokeStyle = LINE;
    g.lineWidth = 0.009;
    g.stroke(cloth);
    // A highlight on the wood.
    g.strokeStyle = away ? "rgba(255,230,190,0.2)" : "rgba(255,230,190,0.45)";
    g.lineWidth = 0.008;
    g.beginPath();
    g.moveTo(x0 + 0.012, y1 - 0.05);
    g.lineTo(x0 + 0.012, y0 + arch + 0.02);
    g.stroke();
    // Little feet.
    for (const fx of [x0 + 0.03, x1 - 0.03]) {
      g.fillStyle = SCREEN.woodDark;
      g.beginPath();
      g.ellipse(fx, 0.012, 0.03, 0.014, 0, 0, TAU);
      g.fill();
      g.strokeStyle = LINE;
      g.lineWidth = 0.008;
      g.stroke();
    }
  }
  // Brass hinges between the panels.
  for (let i = 1; i < 3; i++) {
    const x = left + i * w;
    for (const y of [-H * 0.78, -H * 0.25]) {
      g.fillStyle = "#D9A93E";
      g.beginPath();
      g.roundRect(x - 0.012, y - 0.03, 0.024, 0.06, 0.008);
      g.fill();
      g.strokeStyle = LINE;
      g.lineWidth = 0.007;
      g.stroke();
    }
  }
  // A towel hung over the top, swinging a little.
  if (open > 0.6) {
    const x = left + w * 2.4;
    const swing = 0.03 * Math.sin(ms / 160);
    g.fillStyle = "#F4F1EA";
    g.beginPath();
    g.moveTo(x - 0.06, -H + 0.02);
    g.lineTo(x + 0.07, -H + 0.03);
    g.lineTo(x + 0.08 + swing, -H + 0.22);
    g.lineTo(x - 0.04 + swing, -H + 0.2);
    g.closePath();
    g.fill();
    g.strokeStyle = LINE;
    g.lineWidth = 0.01;
    g.stroke();
    g.strokeStyle = "#5BA7C9";
    g.lineWidth = 0.014;
    g.beginPath();
    g.moveTo(x - 0.035 + swing * 0.8, -H + 0.16);
    g.lineTo(x + 0.075 + swing * 0.8, -H + 0.175);
    g.stroke();
  }
  g.restore();
}

/** Clothes thrown over the top: when (ms), from where along the top, how they fly. */
interface Item { kind: "hat" | "sock" | "shirt"; at: number; dx: number; vx: number; vy: number; spin: number }
const ITEMS: Item[] = [
  { kind: "hat", at: 950, dx: -0.15, vx: -0.85, vy: -1.5, spin: -5 },
  { kind: "sock", at: 1300, dx: 0.12, vx: 0.95, vy: -1.6, spin: 7 },
  { kind: "shirt", at: 1700, dx: 0.0, vx: -0.6, vy: -1.6, spin: 3.5 },
  { kind: "sock", at: 2050, dx: 0.2, vx: 0.7, vy: -1.45, spin: -8 },
];

function drawItem(g: CanvasRenderingContext2D, item: Item, ms: number, cx: number) {
  const s = (ms - item.at) / 1000;
  if (s <= 0 || s > 1.4) return;
  const x = cx + item.dx + item.vx * s;
  const y = -SCREEN.height + 0.15 + item.vy * s + 2.6 * s * s;
  g.save();
  g.globalAlpha = 1 - smoothstep(1.0, 1.4, s);
  g.translate(x, y);
  g.rotate(item.spin * s);
  g.strokeStyle = LINE;
  g.lineWidth = 0.012;
  const fillStroke = (fill: string) => {
    g.fillStyle = fill;
    g.fill();
    g.stroke();
  };
  switch (item.kind) {
    case "hat": {
      // A battered old bowler.
      g.beginPath();
      g.ellipse(0, 0.02, 0.13, 0.03, 0, 0, TAU);
      fillStroke("#6B4A2B");
      g.beginPath();
      g.moveTo(-0.08, 0.02);
      g.bezierCurveTo(-0.09, -0.11, 0.09, -0.11, 0.08, 0.02);
      g.closePath();
      fillStroke("#7D5835");
      g.strokeStyle = "#C9A04A";
      g.lineWidth = 0.016;
      g.beginPath();
      g.moveTo(-0.078, -0.005);
      g.quadraticCurveTo(0, 0.01, 0.078, -0.005);
      g.stroke();
      break;
    }
    case "sock": {
      g.beginPath();
      g.moveTo(-0.035, -0.12);
      g.lineTo(0.03, -0.12);
      g.lineTo(0.03, 0.02);
      g.quadraticCurveTo(0.1, 0.02, 0.1, 0.06);
      g.quadraticCurveTo(0.1, 0.1, 0.04, 0.1);
      g.lineTo(-0.01, 0.1);
      g.quadraticCurveTo(-0.04, 0.1, -0.035, 0.05);
      g.closePath();
      fillStroke("#F4F1EA");
      g.save();
      g.clip();
      g.fillStyle = "#D2392F";
      for (const yy of [-0.11, -0.07, -0.03]) g.fillRect(-0.05, yy, 0.1, 0.018);
      g.fillRect(0.04, 0.06, 0.08, 0.06);
      g.restore();
      g.stroke();
      break;
    }
    case "shirt": {
      g.beginPath();
      g.moveTo(-0.05, -0.1);
      g.quadraticCurveTo(0, -0.07, 0.05, -0.1);
      g.lineTo(0.13, -0.06);
      g.lineTo(0.1, 0.0);
      g.lineTo(0.07, -0.02);
      g.lineTo(0.07, 0.11);
      g.lineTo(-0.07, 0.11);
      g.lineTo(-0.07, -0.02);
      g.lineTo(-0.1, 0.0);
      g.lineTo(-0.13, -0.06);
      g.closePath();
      fillStroke("#5B8FD0");
      g.strokeStyle = "#F4F1EA";
      g.lineWidth = 0.012;
      g.beginPath();
      g.moveTo(-0.07, 0.03);
      g.lineTo(0.07, 0.03);
      g.stroke();
      break;
    }
  }
  g.restore();
}
