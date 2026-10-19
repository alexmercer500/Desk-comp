// A command too long for its card scrolls inside it, and Allow waits until
// it has been scrolled to the end: nothing is allowed that wasn't on screen.
// Shared by the bubble and the top-edge island.

/** Close enough to the end to count as read (a line's worth of slack). */
const END_SLACK_PX = 8;

/**
 * Watches `detail` (already laid out): while it has more below than it shows,
 * `gated` buttons are disabled and `hint` says why. Returns a function that
 * stops watching (call it before the card shows something else).
 */
export function readFirst(detail: HTMLElement, gated: HTMLButtonElement[], hint: HTMLElement): () => void {
  const read = () => detail.scrollHeight - detail.clientHeight - detail.scrollTop <= END_SLACK_PX;
  const sync = () => {
    const done = read();
    for (const b of gated) {
      b.disabled = !done;
      b.title = done ? (b.dataset.title ?? "") : "Scroll to the end of the command first";
    }
    hint.hidden = done;
    detail.classList.toggle("unread", !done);
  };
  sync();
  detail.addEventListener("scroll", sync, { passive: true });
  return () => {
    detail.removeEventListener("scroll", sync);
    for (const b of gated) {
      b.disabled = false;
      b.title = b.dataset.title ?? "";
    }
    hint.hidden = true;
    detail.classList.remove("unread");
  };
}
