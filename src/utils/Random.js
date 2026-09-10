/**
 * Random.js — seeded PRNG. Implemented (not stubbed).
 *
 * Track generation MUST be deterministic: the same TRACK.seed has to produce
 * the same city every reload, or checkpoint positions, roadblock anchors and
 * saved best times all become meaningless. Never call Math.random() in
 * worldgen — take a Random instance instead.
 */

export class Random {
  /** @param {number} seed any 32-bit integer */
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this._state = this.seed || 1;
  }

  /** mulberry32 — fast, tiny, good enough for level layout. */
  next() {
    this._state = (this._state + 0x6d2b79f5) >>> 0;
    let t = this._state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max]. */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  /** Float in [−magnitude, +magnitude). */
  signed(magnitude = 1) {
    return this.range(-magnitude, magnitude);
  }

  /** True with probability `p`. */
  chance(p) {
    return this.next() < p;
  }

  /** @template T @param {T[]} items @returns {T} */
  pick(items) {
    return items[this.int(0, items.length - 1)];
  }

  reset() {
    this._state = this.seed || 1;
  }
}
