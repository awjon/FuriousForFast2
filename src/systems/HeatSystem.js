/**
 * HeatSystem.js — pursuit lifecycle, heat level, cash and the bust/escape
 * timers. STUB: see TODO(phase-4).
 *
 * This is the game's director. Police.js knows how to drive; HeatSystem decides
 * how many cops exist, when a chase begins, and how it ends. Keeping the two
 * apart means you can tune chase pacing without touching any steering code.
 *
 * ── PURSUIT STATES (state.pursuit) ────────────────────────────────────────────
 *   null        free roam. Patrols exist but are not hunting.
 *   'active'    chase in progress. Cash accrues, heat climbs.
 *   'cooldown'  the player is out of sight and the escape timer is running.
 *               Re-entering any cop's line of sight returns this to 'active'
 *               and RESETS the timer — that reset is the tension.
 *   'evaded'    escaped. Award the bonus, drop heat by one, hold
 *               HEAT.cooldownSeconds before patrols can spot again.
 *   'busted'    caught. Charge ECONOMY.bustPenalty, reset heat to 0, respawn
 *               the player at their current trackT.
 *
 * ── HEAT ──────────────────────────────────────────────────────────────────────
 * Heat is a float 0..HEAT.maxLevel; the HUD shows Math.floor(heat). It rises
 * with time in pursuit (1 level per HEAT.secondsPerLevel), and in jumps from
 * HEAT.gain events (ramming a cop, wrecking one, sustained over-speeding).
 * On each integer crossing:
 *   - call police.setActiveCount(POLICE.unitsPerHeat[level], player.trackT)
 *   - if the level unlocks a tactic (POLICE.unlock), announce it on the HUD
 * Heat never decays during a pursuit. It drops one level per escape and resets
 * to zero on a bust.
 *
 * ── ESCAPE ────────────────────────────────────────────────────────────────────
 * Enter 'cooldown' when police.isPlayerUnseen(player) AND
 * police.distanceToClosest(player) > HEAT.evadeDistance. Run a timer to
 * HEAT.evadeSeconds. Any line of sight resets it to zero. The HUD shows this
 * timer as the classic filling escape bar.
 *
 * ── BUST ──────────────────────────────────────────────────────────────────────
 * Count cops within HEAT.bustRadius while player speed < HEAT.bustSpeed. Hold
 * all three conditions for HEAT.bustSeconds. Any of them breaking resets the
 * timer, so nudging free of a pin always works — a bust must never feel like it
 * happened to the player without warning.
 *
 * ── CASH ──────────────────────────────────────────────────────────────────────
 * ECONOMY.pursuitCashPerSecond × (1 + heat) while 'active', plus
 * state.driftScore × ECONOMY.driftPointsToCash banked on escape. Cash is only
 * committed to UpgradeSystem on 'evaded' — being busted forfeits the run, which
 * is what makes the escape decision interesting.
 */

import { HEAT, ECONOMY, POLICE } from '../Config.js';

export class HeatSystem {
  /**
   * @param {{
   *   police: import('../entities/Police.js').Police,
   *   player: import('../entities/Car.js').Car,
   *   state: object, shared Game.state — this system owns heat/cash/pursuit
   * }} options
   */
  constructor({ police, player, state }) {
    this.police = police;
    this.player = player;
    this.state = state;

    /** Float 0..HEAT.maxLevel. The HUD floors this. */
    this.heat = 0;
    /** @type {null|'active'|'cooldown'|'evaded'|'busted'} */
    this.pursuit = null;

    this.evadeTimer = 0;
    this.bustTimer = 0;
    this.cooldownTimer = 0;
    /** Cash earned this pursuit, forfeited on a bust. */
    this.pendingCash = 0;
    /** Seconds the current pursuit has lasted, for the end-of-chase summary. */
    this.pursuitDuration = 0;

    /** @type {((event: {type: string, [k: string]: unknown}) => void)[]} */
    this.listeners = [];
  }

  /** Subscribe to pursuit events, for the HUD and audio. */
  on(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  _emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  /**
   * @param {number} dt fixed timestep
   * @param {import('../entities/Car.js').Car} player
   */
  update(dt, player) {
    // TODO(phase-4): implement the state machine documented above.
    void dt;
    void player;
    void HEAT;
    void ECONOMY;
    void POLICE;
  }

  /**
   * Register a heat-worthy player action.
   * @param {keyof typeof HEAT.gain} kind
   * @param {number} [scale] multiplier, e.g. collision severity 0..1
   */
  addHeat(kind, scale = 1) {
    // TODO(phase-4)
    void kind;
    void scale;
  }

  /** Force a chase to start — used by the debug menu and the tutorial. */
  startPursuit() {
    // TODO(phase-4)
  }

  reset() {
    this.heat = 0;
    this.pursuit = null;
    this.evadeTimer = 0;
    this.bustTimer = 0;
    this.cooldownTimer = 0;
    this.pendingCash = 0;
    this.pursuitDuration = 0;
  }
}
