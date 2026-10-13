// A permission card's buttons ignore clicks for a moment after the card
// appears, so a click meant for whatever was under the cursor can't land on
// Allow. Shared by the speech bubble, the top-edge island and the panel.

/** How long after a card appears its buttons start to count. */
export const GUARD_MS = 600;

export class ClickGuard {
  private since = new Map<string, number>();

  constructor(private now: () => number = () => performance.now()) {}

  /** The card for this request just came on screen (or back on screen). */
  arm(rid: string) {
    this.since.set(rid, this.now());
    // Old requests are long answered; keep the map small.
    if (this.since.size > 32) this.since.delete(this.since.keys().next().value!);
  }

  /** Arms only if this request hasn't been seen yet (for views that redraw often). */
  armOnce(rid: string) {
    if (!this.since.has(rid)) this.arm(rid);
  }

  /** True when a click on this request's buttons should count. */
  ready(rid: string): boolean {
    const at = this.since.get(rid);
    return at !== undefined && this.now() - at >= GUARD_MS;
  }

  /** Forget everything: the next time any card shows, it's armed afresh. */
  reset() {
    this.since.clear();
  }
}
