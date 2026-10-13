// Optional sounds (Settings → Notifications → Sounds, off by default): short,
// soft chimes made on the spot with Web Audio, so there are no sound files.
//
//   done       two notes going up        a task finished
//   attention  two quick taps            an agent waits for you
//   error      two notes going down      something failed

import type { BubbleMessage } from "../bubble/types";

type Chime = "done" | "attention" | "error";

const NOTES: Record<Chime, [number, number][]> = {
  // [frequency Hz, start s]
  done: [[659.25, 0], [987.77, 0.11]],
  attention: [[880, 0], [880, 0.16]],
  error: [[523.25, 0], [392, 0.14]],
};

let ctx: AudioContext | null = null;

function play(chime: Chime, volume = 0.18) {
  ctx ??= new AudioContext();
  const now = ctx.currentTime;
  for (const [freq, at] of NOTES[chime]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    // A soft attack and a gentle fade, like a small bell.
    gain.gain.setValueAtTime(0, now + at);
    gain.gain.linearRampToValueAtTime(volume, now + at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + at);
    osc.stop(now + at + 0.5);
  }
}

/** The chime for a notification that's about to show, if it gets one. */
export function chimeFor(msg: BubbleMessage): Chime | null {
  switch (msg.category) {
    case "agent-done":
      return "done";
    case "agent-permission":
      return "attention";
    case "agent-error":
      return "error";
    case "break":
    case "battery":
      return "attention";
    default:
      return null;
  }
}

export function playFor(msg: BubbleMessage) {
  const chime = chimeFor(msg);
  if (!chime) return;
  try {
    play(chime);
  } catch {
    // No audio device, or audio blocked: notifications are silent then.
  }
}
