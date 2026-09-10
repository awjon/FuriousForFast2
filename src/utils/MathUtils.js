/**
 * MathUtils.js — small, dependency-free numeric helpers.
 * Implemented (not stubbed): every other module assumes these work.
 */

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export const lerp = (a, b, t) => a + (b - a) * t;

export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

/**
 * Frame-rate independent exponential smoothing. Prefer this over
 * `lerp(a, b, 0.1)` in anything that runs at a variable rate (cameras, FOV,
 * HUD needles) — plain lerp is faster on a 144 Hz display than a 60 Hz one.
 * @param {number} rate approach speed, per second
 */
export const damp = (current, target, rate, dt) =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

/** Move `current` toward `target` by at most `maxDelta`. */
export const approach = (current, target, maxDelta) => {
  const delta = target - current;
  return Math.abs(delta) <= maxDelta ? target : current + Math.sign(delta) * maxDelta;
};

/**
 * Wrap an angle into [−π, π). Essential for yaw error in the pursuit AI.
 * Note the half-open range: an input of exactly +π comes back as −π. Same
 * direction either way, so it is harmless for steering error, but do not rely
 * on the sign at the boundary.
 */
export const wrapAngle = (radians) => {
  const wrapped = ((radians + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  return wrapped - Math.PI;
};

/** Shortest signed angular difference from `from` to `to`, in [−π, π). */
export const angleDelta = (from, to) => wrapAngle(to - from);

/** Smooth 0→1 ramp, zero derivative at both ends. */
export const smoothstep = (edge0, edge1, x) => {
  const t = clamp(invLerp(edge0, edge1, x), 0, 1);
  return t * t * (3 - 2 * t);
};

export const metresPerSecondToKmh = (mps) => mps * 3.6;
export const metresPerSecondToMph = (mps) => mps * 2.23694;
