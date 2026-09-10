/**
 * Police.js — the pursuit fleet and its AI. STUB: see TODO(phase-4).
 *
 * This is the Hot Pursuit half of the game. `Police` owns the pool of cruisers
 * and the per-unit state machine; HeatSystem owns how many units exist and
 * when the chase starts or ends.
 *
 * ── PER-UNIT STATE MACHINE ────────────────────────────────────────────────────
 *   PATROL     cruising at ~60% of the player's top speed, on the racing line.
 *              Transitions to SPOTTED when the player is within 120 m, roughly
 *              in front, and HeatSystem is not in cooldown.
 *   SPOTTED    0.8 s reaction pause with the lightbar and siren coming on. This
 *              delay matters: instant reaction reads as cheating.
 *   PURSUIT    drive at the player using the steering controller below.
 *   PIT        heat ≥ POLICE.unlock.pit and within POLICE.pitRange behind the
 *              player: aim at the player's rear quarter instead of their centre
 *              and hold throttle. A successful PIT spins the player.
 *   BLOCKING   part of a roadblock; parked across the road, zero throttle.
 *   DISABLED   damage ≥ 1: no throttle, smoke, despawn after 6 s.
 *   SEARCHING  lost the player: drive to their last known t, give up after 12 s.
 *
 * ── STEERING CONTROLLER (writes cop.controls, never cop.state) ────────────────
 * Pure pursuit against a lookahead point, NOT the player's current position —
 * aiming at where the player is now makes cops cut corners into walls.
 *   1. aimT   = player.trackT + lookahead, where lookahead grows with speed
 *   2. target = track.getPose(aimT).position, blended toward player.position by
 *              a factor that rises as the cop closes, so the final approach is
 *              direct but the long chase follows the road
 *   3. error  = angleDelta(cop.state.heading, bearing to target)
 *   4. steer  = clamp(error · 2.2, −1, 1)
 *   5. throttle: 1, dropping to 0.4 when |error| > 0.5 rad, so cops brake for
 *      corners instead of understeering into the guardrail
 *   6. handbrake when |error| > 1.1 rad and speed > 25 m/s
 *
 * ── RUBBER-BANDING ────────────────────────────────────────────────────────────
 * Scale the cop's effective enginePower by POLICE.rubberBand, derived from the
 * along-track gap via Track.loopDelta(). Far behind → up to 1.22×. Very close →
 * 0.9×, which stops cops welding themselves to the player's bumper. Apply it to
 * a COPY of the stat block; never mutate the shared one.
 *
 * ── TACTICS ───────────────────────────────────────────────────────────────────
 * Roadblock: at heat ≥ 3, spawn 2–3 BLOCKING units at
 *   player.trackT + POLICE.spawnAheadDistance / track.length, spread across the
 *   road, leaving one gap the player can thread at speed. Announce it on the HUD
 *   ~2 s before it is visible.
 * Spike strip: at heat ≥ 4, a thin trigger volume across the road. Hitting it
 *   drops lateralGrip to 40% and topSpeed to 60% for 8 s.
 * Helicopter: at heat 5, a spotlight that tracks the player and removes the
 *   line-of-sight requirement for spotting. Cosmetic pressure, no collision.
 *
 * ── POOLING ───────────────────────────────────────────────────────────────────
 * Never construct a Car mid-chase — building geometry during a pursuit stutters.
 * Allocate POLICE.unitsPerHeat's maximum at build time and recycle.
 */

import { POLICE } from '../Config.js';

/** @typedef {'PATROL'|'SPOTTED'|'PURSUIT'|'PIT'|'BLOCKING'|'DISABLED'|'SEARCHING'} PursuitState */

export class Police {
  /**
   * @param {{
   *   track: import('../world/Track.js').Track,
   *   scene: import('three').Scene,
   * }} options
   */
  constructor({ track, scene }) {
    this.track = track;
    this.scene = scene;

    /** Active cruisers. Game iterates this to step physics. */
    this.units = [];
    /** Pre-built, currently unused cruisers. */
    this.pool = [];
  }

  /**
   * Pre-build the maximum fleet so nothing is constructed during a chase.
   * @param {object} baseStats stat block cops derive from
   */
  async build(baseStats) {
    // TODO(phase-4): allocate max(POLICE.unitsPerHeat) pooled Car instances
    // with isPolice: true, plus their lightbar meshes.
    void baseStats;
    void POLICE;
  }

  /**
   * Bring the active fleet up to `count`, taking from the pool.
   * @param {number} count
   * @param {number} playerT spawn behind and out of sight of this position
   */
  setActiveCount(count, playerT) {
    // TODO(phase-4)
    void count;
    void playerT;
  }

  /**
   * Run the AI for every active unit. Writes each unit's `controls` for the
   * NEXT physics step — it must not integrate anything itself.
   *
   * @param {import('./Car.js').Car} player
   * @param {number} dt fixed timestep
   */
  update(player, dt) {
    // TODO(phase-4)
    void player;
    void dt;
  }

  /**
   * @param {number} heat current heat level
   * @param {number} playerT
   */
  spawnRoadblock(heat, playerT) {
    // TODO(phase-4)
    void heat;
    void playerT;
  }

  /** True when no active unit currently has line of sight to the player. */
  isPlayerUnseen(player) {
    // TODO(phase-4)
    void player;
    return true;
  }

  /** Distance in metres from the player to the closest active cruiser. */
  distanceToClosest(player) {
    // TODO(phase-4)
    void player;
    return Infinity;
  }

  dispose() {
    for (const unit of [...this.units, ...this.pool]) unit.dispose();
    this.units.length = 0;
    this.pool.length = 0;
  }
}
