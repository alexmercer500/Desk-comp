// Small one-shot effects shared by every character: sparkles, sleep curls, puffs.

import type { Frame, Particle } from "./types";

export function updateParticles(list: Particle[], dt: number): Particle[] {
  for (const p of list) {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
  }
  return list.filter((p) => p.age < p.life);
}

export function drawParticles(g: CanvasRenderingContext2D, list: readonly Particle[], f: Frame) {
  for (const p of list) {
    const k = p.age / p.life;
    const x = f.ox + p.x * f.U;
    const y = f.oy - p.y * f.U;
    const s = p.size * f.U;
    g.save();
    g.translate(x, y);
    g.rotate(p.rot);
    switch (p.kind) {
      case "sparkle":
      case "star": {
        // Pops in, then shrinks away.
        const grow = k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75;
        const r = s * Math.max(0, grow);
        g.globalAlpha *= Math.min(1, (1 - k) * 2);
        g.fillStyle = p.kind === "sparkle" ? "#FFE3A0" : "#FFD166";
        star4(g, r, r * 0.28);
        g.fill();
        g.fillStyle = "rgba(255,255,255,0.9)";
        star4(g, r * 0.45, r * 0.14);
        g.fill();
        break;
      }
      case "z": {
        // A little zig-zag curl that grows as it drifts up. Drawn, not typed.
        const r = s * (0.6 + k * 0.6);
        g.globalAlpha *= Math.sin(Math.PI * k) * 0.8;
        g.strokeStyle = "#8C97AD";
        g.lineWidth = Math.max(1, r * 0.22);
        g.lineCap = "round";
        g.lineJoin = "round";
        g.beginPath();
        g.moveTo(-r * 0.5, -r * 0.5);
        g.quadraticCurveTo(0, -r * 0.62, r * 0.5, -r * 0.5);
        g.lineTo(-r * 0.5, r * 0.5);
        g.quadraticCurveTo(0, r * 0.62, r * 0.5, r * 0.5);
        g.stroke();
        break;
      }
      case "glow": {
        // A soft mint light, Glim's trail.
        const r = s * (1 - k * 0.4);
        g.globalAlpha *= (1 - k) * 0.4;
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
        grad.addColorStop(0, "rgba(190,255,220,1)");
        grad.addColorStop(0.4, "rgba(155,246,196,0.7)");
        grad.addColorStop(1, "rgba(155,246,196,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case "puff": {
        const r = s * (0.5 + k * 0.8);
        g.globalAlpha *= (1 - k) * 0.75;
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
        grad.addColorStop(0, "rgba(250,246,238,0.95)");
        grad.addColorStop(0.6, "rgba(244,239,230,0.6)");
        grad.addColorStop(1, "rgba(244,239,230,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fill();
        break;
      }
    }
    g.restore();
  }
}

function star4(g: CanvasRenderingContext2D, outer: number, inner: number) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
}
