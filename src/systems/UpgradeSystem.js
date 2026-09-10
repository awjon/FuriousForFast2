/**
 * UpgradeSystem.js — performance and visual customisation state.
 * IMPLEMENTED, not stubbed: Physics and Car read the resolved stat block every
 * step, so this is the integration contract the rest of the game is built on.
 *
 * ── DESIGN RULES ──────────────────────────────────────────────────────────────
 *  - Zero Three.js imports. This module is plain data so it can be unit-tested
 *    with no DOM and no WebGL context.
 *  - Performance parts change NUMBERS ONLY. Visual parts change APPEARANCE
 *    ONLY. A body kit must never grant grip — mixing the two is how NFSU2's
 *    upgrade tree became impossible to balance, and it makes the garage UI lie.
 *  - Modifiers are multiplicative against CAR_BASE and applied in a fixed order
 *    so the result is independent of purchase order.
 *  - getStats() returns a FROZEN new object. Nothing may mutate a stat block:
 *    Police copies it to apply rubber-banding, and a shared mutable block would
 *    leak cop boosts into the player's car.
 */

import { CAR_BASE, NITROUS, ECONOMY, PALETTE } from '../Config.js';

/** Display names per tier index. */
export const TIER_NAMES = ['Stock', 'Street', 'Sport', 'Pro'];

/**
 * The performance tree. Each tier lists its cash cost and the multipliers or
 * offsets it contributes. Tier 0 is always free and neutral.
 *
 * `mods` keys must match fields on the resolved stat block. A multiplier is
 * written as a plain number; an absolute override uses the `set:` prefix.
 */
export const PERFORMANCE_TREE = Object.freeze({
  engine: {
    label: 'Engine',
    blurb: 'Displacement, cams, ECU. Raw force at the wheels.',
    tiers: [
      { cost: 0, mods: {} },
      { cost: 3200, mods: { enginePower: 1.14, topSpeed: 1.05 } },
      { cost: 8600, mods: { enginePower: 1.29, topSpeed: 1.11 } },
      { cost: 19000, mods: { enginePower: 1.48, topSpeed: 1.18 } },
    ],
  },
  turbo: {
    label: 'Turbo',
    blurb: 'Top-end punch. Adds power where the engine tapers off.',
    tiers: [
      { cost: 0, mods: {} },
      { cost: 4100, mods: { enginePower: 1.08, topSpeed: 1.08 } },
      { cost: 10500, mods: { enginePower: 1.15, topSpeed: 1.16 } },
      { cost: 22000, mods: { enginePower: 1.24, topSpeed: 1.25 } },
    ],
  },
  nitrous: {
    label: 'Nitrous',
    blurb: 'Bigger bottle, harder hit. Refills by drifting.',
    tiers: [
      { cost: 0, mods: {} },
      { cost: 2800, mods: { nitrousCapacity: 1.25, nitrousBoostForce: 1.2 } },
      { cost: 7400, mods: { nitrousCapacity: 1.55, nitrousBoostForce: 1.45 } },
      { cost: 16000, mods: { nitrousCapacity: 2.0, nitrousBoostForce: 1.75 } },
    ],
  },
  tires: {
    label: 'Tires',
    blurb: 'Lateral grip. Higher tiers hold a tighter line but drift less freely.',
    tiers: [
      { cost: 0, mods: {} },
      { cost: 2400, mods: { lateralGrip: 1.1, offroadGripMultiplier: 1.06 } },
      { cost: 6200, mods: { lateralGrip: 1.22, offroadGripMultiplier: 1.12 } },
      { cost: 14000, mods: { lateralGrip: 1.38, offroadGripMultiplier: 1.2 } },
    ],
  },
  brakes: {
    label: 'Brakes',
    blurb: 'Stopping force and handbrake control.',
    tiers: [
      { cost: 0, mods: {} },
      { cost: 1900, mods: { brakeForce: 1.15, handbrakeGripMultiplier: 0.95 } },
      { cost: 5200, mods: { brakeForce: 1.3, handbrakeGripMultiplier: 0.9 } },
      { cost: 11500, mods: { brakeForce: 1.5, handbrakeGripMultiplier: 0.85 } },
    ],
  },
  weight: {
    label: 'Weight',
    blurb: 'Strip the interior. Helps acceleration, braking and turn-in at once.',
    tiers: [
      { cost: 0, mods: {} },
      { cost: 3000, mods: { mass: 0.94 } },
      { cost: 8000, mods: { mass: 0.87 } },
      { cost: 17500, mods: { mass: 0.78 } },
    ],
  },
});

/** Cosmetic options. Purely presentational — see the design rules above. */
export const VISUAL_TREE = Object.freeze({
  paint: {
    label: 'Paint',
    cost: 900,
    options: [
      { id: 'midnight', label: 'Midnight', color: 0x11142a },
      { id: 'cyber', label: 'Cyber Cyan', color: PALETTE.cyan },
      { id: 'hotpink', label: 'Hot Pink', color: PALETTE.magenta },
      { id: 'violet', label: 'Violet Haze', color: PALETTE.violet },
      { id: 'sodium', label: 'Sodium', color: PALETTE.amber },
      { id: 'pearl', label: 'Pearl White', color: 0xe8ecff },
    ],
  },
  rims: {
    label: 'Rims',
    cost: 1400,
    options: [
      { id: 'stock', label: 'Stock', color: 0x2a2f45 },
      { id: 'chrome', label: 'Chrome', color: 0xc8d4ff },
      { id: 'gold', label: 'Gold', color: 0xffcc44 },
      { id: 'neon', label: 'Neon', color: PALETTE.cyan },
    ],
  },
  underglow: {
    label: 'Underglow',
    cost: 1100,
    options: [
      { id: 'off', label: 'Off', color: 0x000000 },
      { id: 'cyan', label: 'Cyan', color: PALETTE.cyan },
      { id: 'magenta', label: 'Magenta', color: PALETTE.magenta },
      { id: 'violet', label: 'Violet', color: PALETTE.violet },
      { id: 'amber', label: 'Amber', color: PALETTE.amber },
    ],
  },
  spoiler: {
    label: 'Spoiler',
    cost: 1600,
    options: [
      { id: 'none', label: 'None' },
      { id: 'lip', label: 'Lip' },
      { id: 'gt', label: 'GT Wing' },
    ],
  },
  tint: {
    label: 'Window Tint',
    cost: 600,
    options: [
      { id: 'clear', label: 'Clear', opacity: 0.35 },
      { id: 'smoke', label: 'Smoke', opacity: 0.6 },
      { id: 'blackout', label: 'Blackout', opacity: 0.88 },
    ],
  },
});

const PERFORMANCE_KEYS = Object.keys(PERFORMANCE_TREE);
const VISUAL_KEYS = Object.keys(VISUAL_TREE);

export class UpgradeSystem {
  /** @param {object|null} saved output of a previous serialize(), or null */
  constructor(saved = null) {
    /** @type {Record<string, number>} category -> owned tier index */
    this.performance = Object.fromEntries(PERFORMANCE_KEYS.map((key) => [key, 0]));
    /** @type {Record<string, string>} category -> selected option id */
    this.visuals = Object.fromEntries(
      VISUAL_KEYS.map((key) => [key, VISUAL_TREE[key].options[0].id])
    );
    this.cash = ECONOMY.startingCash;

    /** Cached stat block; invalidated by any performance change. */
    this._stats = null;

    if (saved) this.deserialize(saved);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Resolve CAR_BASE plus every owned performance tier into the flat, frozen
   * stat block that Physics reads. Cached — this runs once per purchase, not
   * once per frame.
   * @returns {Readonly<object>}
   */
  getStats() {
    if (this._stats) return this._stats;

    const stats = {
      ...CAR_BASE,
      nitrousCapacity: NITROUS.capacity,
      nitrousBoostForce: NITROUS.boostForce,
      nitrousDrainPerSecond: NITROUS.drainPerSecond,
    };

    // Fixed iteration order over PERFORMANCE_KEYS makes the result independent
    // of the order the player bought things in.
    for (const key of PERFORMANCE_KEYS) {
      const tier = PERFORMANCE_TREE[key].tiers[this.performance[key]];
      for (const [field, modifier] of Object.entries(tier.mods)) {
        if (!(field in stats)) {
          throw new Error(`Upgrade "${key}" modifies unknown stat "${field}"`);
        }
        stats[field] *= modifier;
      }
    }

    this._stats = Object.freeze(stats);
    return this._stats;
  }

  /** @returns {object} resolved cosmetic selections, for Car.applyVisuals(). */
  getVisuals() {
    const resolved = {};
    for (const key of VISUAL_KEYS) {
      const id = this.visuals[key];
      resolved[key] =
        VISUAL_TREE[key].options.find((option) => option.id === id) ??
        VISUAL_TREE[key].options[0];
    }
    return resolved;
  }

  /**
   * 0–10 ratings for the garage bars. Derived from the stat block so they can
   * never disagree with what the car actually does.
   */
  getRatings() {
    const stats = this.getStats();
    const scale = (value, min, max) =>
      Math.round(Math.max(0, Math.min(1, (value - min) / (max - min))) * 100) / 10;

    return {
      acceleration: scale(stats.enginePower / stats.mass, 6, 16),
      topSpeed: scale(stats.topSpeed, 55, 95),
      handling: scale(stats.lateralGrip / stats.mass, 10, 22),
      braking: scale(stats.brakeForce / stats.mass, 11, 22),
      nitrous: scale(stats.nitrousBoostForce, 8000, 17000),
    };
  }

  /** @returns {{ tier: number, maxTier: number, nextCost: number|null }} */
  getPerformanceInfo(category) {
    const node = PERFORMANCE_TREE[category];
    if (!node) throw new Error(`Unknown performance category "${category}"`);
    const tier = this.performance[category];
    const next = node.tiers[tier + 1];
    return { tier, maxTier: node.tiers.length - 1, nextCost: next ? next.cost : null };
  }

  canAffordUpgrade(category) {
    const { nextCost } = this.getPerformanceInfo(category);
    return nextCost !== null && this.cash >= nextCost;
  }

  // ---------------------------------------------------------------------------
  // Mutations — all return a boolean "did this actually happen"
  // ---------------------------------------------------------------------------

  /**
   * Buy the next tier of a performance category.
   * @returns {boolean} false if already maxed or the player cannot afford it
   */
  purchaseUpgrade(category) {
    const { nextCost } = this.getPerformanceInfo(category);
    if (nextCost === null || this.cash < nextCost) return false;

    this.cash -= nextCost;
    this.performance[category] += 1;
    this._stats = null; // invalidate the cache
    return true;
  }

  /**
   * Select a cosmetic option, charging for it the first time a non-default
   * option in that category is chosen.
   * @returns {boolean}
   */
  selectVisual(category, optionId) {
    const node = VISUAL_TREE[category];
    if (!node) throw new Error(`Unknown visual category "${category}"`);
    if (!node.options.some((option) => option.id === optionId)) return false;
    if (this.visuals[category] === optionId) return true;

    const isDefault = optionId === node.options[0].id;
    if (!isDefault) {
      if (this.cash < node.cost) return false;
      this.cash -= node.cost;
    }

    this.visuals[category] = optionId;
    return true;
  }

  /** @param {number} amount may be negative; cash floors at zero */
  addCash(amount) {
    this.cash = Math.max(0, Math.round(this.cash + amount));
    return this.cash;
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  serialize() {
    return {
      version: 1,
      cash: this.cash,
      performance: { ...this.performance },
      visuals: { ...this.visuals },
    };
  }

  /**
   * Restore from a save. Tolerant by design: an unknown category or an
   * out-of-range tier is ignored rather than thrown, so adding a new upgrade
   * category in a later phase does not brick existing saves.
   */
  deserialize(saved) {
    if (typeof saved?.cash === 'number' && Number.isFinite(saved.cash)) {
      this.cash = Math.max(0, saved.cash);
    }

    for (const key of PERFORMANCE_KEYS) {
      const tier = saved?.performance?.[key];
      const maxTier = PERFORMANCE_TREE[key].tiers.length - 1;
      if (Number.isInteger(tier) && tier >= 0 && tier <= maxTier) {
        this.performance[key] = tier;
      }
    }

    for (const key of VISUAL_KEYS) {
      const id = saved?.visuals?.[key];
      if (VISUAL_TREE[key].options.some((option) => option.id === id)) {
        this.visuals[key] = id;
      }
    }

    this._stats = null;
  }
}
