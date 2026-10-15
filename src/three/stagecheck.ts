// Development only (three.html?stage=corner&who=dogesh&look=anime): the
// desktop app's stage (stage.ts), mounted and framed exactly as the companion
// window mounts it, for checking poses and the clickable box. Size the browser
// window like the app's corner window (1.6 × 1.25 of his square, see ROOM) so
// the see-through room round his square is used too.
//
// window.__stage.sheet(shots) steps exact frames and returns a contact sheet.

import type { StateName, Variant } from "../engine/types";
import { Look } from "./looks";
import { Framing, ROOM, RuiStage, Who } from "./stage";

const q = new URLSearchParams(location.search);
const who: Who = q.get("who") === "dogesh" ? "dogesh" : "rui";
const framing: Framing = q.get("stage") === "island" ? "island" : "corner";

document.querySelectorAll("link[rel=stylesheet]").forEach((l) => l.remove());
document.body.innerHTML = "";
document.body.style.cssText = "margin:0;height:100vh;overflow:hidden;background:transparent";
const view = document.createElement("canvas");
view.style.cssText = framing === "corner" ? "display:block;width:100vmin;height:100vmin" : "display:block;width:40px;height:40px";
document.body.append(view);

const stage = new RuiStage(view, framing, who);
if (framing === "corner") stage.setRoom(ROOM);
stage.setLook((q.get("look") as Look) === "anime" ? "anime" : "toy");
stage.setState("IDLE", null);
stage.advance(0.5);

interface Shot {
  label?: string;
  state?: StateName;
  variant?: Variant;
  overlay?: string;
  reduced?: boolean;
  t?: number;
}

/** Steps through `shots` in order and lays each frame out (the whole window, with his clickable box) on a sheet. */
function sheet(shots: Shot[], columns = 4, scale = 1): string {
  const W = Math.round(window.innerWidth * scale);
  const H = Math.round(window.innerHeight * scale);
  const pad = 18;
  const cols = Math.min(columns, shots.length);
  const out = document.createElement("canvas");
  out.width = cols * W;
  out.height = Math.ceil(shots.length / cols) * (H + pad);
  const g = out.getContext("2d")!;
  const checker = document.createElement("canvas");
  checker.width = checker.height = 16;
  const cg = checker.getContext("2d")!;
  cg.fillStyle = "#c9d6e0";
  cg.fillRect(0, 0, 16, 16);
  cg.fillStyle = "#dfe8ee";
  cg.fillRect(0, 0, 8, 8);
  cg.fillRect(8, 8, 8, 8);
  shots.forEach((s, i) => {
    if (s.reduced !== undefined) stage.setReducedMotion(s.reduced);
    if (s.state) stage.setState(s.state, s.variant ?? null);
    if (s.overlay) stage.overlay(s.overlay);
    stage.advance(s.t ?? 0);
    const x = (i % cols) * W;
    const y = Math.floor(i / cols) * (H + pad);
    g.fillStyle = g.createPattern(checker, "repeat")!;
    g.fillRect(x, y + pad, W, H);
    g.fillStyle = "#fff";
    g.fillRect(x, y, W, pad);
    const r = view.getBoundingClientRect();
    g.drawImage(view, x + r.left * scale, y + pad + r.top * scale, r.width * scale, r.height * scale);
    // His square, and the clickable box the app would report.
    const S = framing === "corner" ? window.innerWidth / (1 + 2 * ROOM.x) : r.width;
    const sq = framing === "corner" ? { l: ROOM.x * S, t: ROOM.top * S } : { l: r.left, t: r.top };
    g.strokeStyle = "rgba(0,0,0,0.25)";
    g.strokeRect(x + sq.l * scale + 0.5, y + pad + sq.t * scale + 0.5, S * scale - 1, S * scale - 1);
    const hit = stage.hitRect();
    g.strokeStyle = "rgba(220,40,40,0.8)";
    g.strokeRect(
      x + (sq.l + hit.x0 * S) * scale, y + pad + (sq.t + hit.y0 * S) * scale, (hit.x1 - hit.x0) * S * scale, (hit.y1 - hit.y0) * S * scale,
    );
    g.strokeStyle = "#999";
    g.strokeRect(x + 0.5, y + 0.5, W - 1, H + pad - 1);
    g.fillStyle = "#000";
    g.font = "12px sans-serif";
    g.fillText(`${s.label ?? s.state ?? s.overlay ?? ""} · ${stage.actor.current}`, x + 4, y + 13);
  });
  return out.toDataURL("image/png");
}

Object.assign(window, { __stage: { stage, sheet } });
document.title = "stage ready";
