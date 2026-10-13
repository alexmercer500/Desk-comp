// Contract between the shared engine and each character skin.

export type CharacterId = "kulhi" | "hexo" | "glim" | "billu";

export type StateName =
  | "OFF" | "BOOTING" | "IDLE" | "ATTENTIVE" | "TOUCHED" | "WORKING"
  | "SUCCESS" | "SUGGESTING" | "CONFUSED" | "ERROR" | "NOTIFY"
  | "SLEEPY" | "SLEEPING" | "WAKING"
  // Desktop only (not in the original spec): being dragged, and the drop.
  | "HELD" | "LANDING";

/**
 * Variations of a state: TOUCHED "dizzy", SUCCESS "short" (after a suggestion
 * pick), NOTIFY "ack" (the happy beat after the user acknowledges).
 */
export type Variant = "dizzy" | "short" | "ack" | null;

/**
 * A pose is a flat bag of numeric channels so any two poses can be crossfaded.
 * Channels every skin must provide in `rest` (the engine reads them):
 *   lift, bodyX, bodyRot, sx, sy, fade,
 *   eyeOpen, blink (≥ 0.5 allows random blinks), gazeLock, gazeLockX, gazeLockY
 * The engine writes these before `draw`: eyeMorph, gazeX, gazeY, lagX, lagY.
 * Units: 1 = character height. `lift` is up-positive. Angles in radians.
 */
export type Pose = Record<string, number>;

export interface PoseInput {
  state: StateName;
  variant: Variant;
  /** ms since this state was entered */
  st: number;
  /** seconds on the engine clock (frozen under reduced motion) */
  t: number;
  /** 1 = full motion, 0 = reduced motion: skins scale movement by it */
  motion: number;
  /** WORKING progress 0…1, or null when indeterminate */
  progress: number | null;
  /** Drag velocity while HELD, logical px/s (0 otherwise) */
  carryX: number;
  carryY: number;
}

export interface PoseOut {
  pose: Partial<Pose>;
  /** Discrete eye shape (or screen glyph). The engine morphs between shapes. */
  eye: string;
}

export interface Frame {
  /** pixels per unit */
  U: number;
  /** character origin (centre of base) in canvas pixels */
  ox: number;
  oy: number;
  size: number;
  t: number;
  /** 0…1, how much fine detail is worth drawing at this size */
  detail: number;
}

export type ParticleKind = "sparkle" | "z" | "puff" | "star" | "glow";

export interface Particle {
  kind: ParticleKind;
  /** units from the origin, y up-positive like `lift` */
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  age: number;
  rot: number;
  spin: number;
}

export type Emit = (p: Omit<Particle, "age" | "rot" | "spin"> & Partial<Pick<Particle, "rot" | "spin">>) => void;

export interface Skin {
  id: CharacterId;
  /** How the character sits in a square view: the view is `units` tall, origin at `base` × size. */
  fit: { units: number; base: number };
  /** The clickable body, as fractions of a square view (the desktop window is click-through elsewhere). */
  hit: { x0: number; y0: number; x1: number; y1: number };
  rest: Pose;
  restEye: string;
  /** Target pose for a state at a moment. Pure: no hidden state. */
  pose(input: PoseInput): PoseOut;
  /** Spawns particles when a state's clock crosses a moment (prevSt → st). */
  events?(input: PoseInput, prevSt: number, emit: Emit, pose: Pose): void;
  draw(g: CanvasRenderingContext2D, pose: Pose, eye: string, frame: Frame): void;
}
