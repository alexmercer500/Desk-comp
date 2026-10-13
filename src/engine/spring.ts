// Damped springs for gaze (critically damped) and secondary motion (springy lag).

export class Spring {
  value: number;
  velocity = 0;

  constructor(
    initial: number,
    public stiffness: number,
    public damping: number,
  ) {
    this.value = initial;
  }

  /** Semi-implicit Euler with fixed substeps, stable for any frame time. */
  step(target: number, dt: number): number {
    const sub = 1 / 240;
    let left = Math.min(dt, 0.1);
    while (left > 0) {
      const h = Math.min(sub, left);
      const accel = this.stiffness * (target - this.value) - this.damping * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
      left -= h;
    }
    return this.value;
  }

  snap(value: number) {
    this.value = value;
    this.velocity = 0;
  }
}

/** A spring with damping = 2·√stiffness: reaches the target fastest without overshoot. */
export const criticalSpring = (initial: number, stiffness: number) =>
  new Spring(initial, stiffness, 2 * Math.sqrt(stiffness));
