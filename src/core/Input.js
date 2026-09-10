/**
 * Input.js — turns keyboard and gamepad into a single analogue control snapshot.
 *
 * Implemented for the scaffold because Game.fixedUpdate() depends on the shape
 * of the snapshot. Touch controls are Phase 6.
 *
 * The snapshot returned by sample() is REUSED between frames — never store a
 * reference to it, copy the fields you need.
 */

import { INPUT } from '../Config.js';

export class Input {
  /**
   * One instance per player. Split-screen constructs two; solo play
   * constructs one and it is player 0.
   *
   * @param {HTMLElement} target element that receives focus for key events
   * @param {{ playerIndex?: number, includeSystem?: boolean }} [options]
   *   `includeSystem` folds the session-wide keys (garage, pause) into this
   *   instance. Defaults to true for player 0 only, so a second player cannot
   *   pause the game from their half of the keyboard by accident.
   */
  constructor(target, { playerIndex = 0, includeSystem = playerIndex === 0 } = {}) {
    const player = INPUT.players[playerIndex];
    if (!player) throw new Error(`No INPUT.players entry for index ${playerIndex}`);

    this.target = target;
    this.playerIndex = playerIndex;
    this.label = player.label;
    this.gamepadIndex = player.gamepadIndex;

    // Bindings and the reverse lookup are PER INSTANCE, not module-level:
    // two players have different maps, and a module-level one would let
    // player 2's keys drive player 1's car.
    this.bindings = includeSystem
      ? { ...player.bindings, ...INPUT.system }
      : { ...player.bindings };
    const ACTIONS = Object.keys(this.bindings);
    this.actions = ACTIONS;

    this.keyToAction = new Map();
    for (const [action, codes] of Object.entries(this.bindings)) {
      for (const code of codes) this.keyToAction.set(code, action);
    }

    /** Raw digital state, keyed by action name. */
    this.held = Object.fromEntries(ACTIONS.map((a) => [a, false]));
    /** True only on the fixed step where the action went down. */
    this.pressed = Object.fromEntries(ACTIONS.map((a) => [a, false]));
    this._justPressed = new Set();

    /**
     * Smoothed analogue snapshot handed to Physics.
     * steer: −1 (full left) … +1 (full right)
     * throttle / brake: 0 … 1
     */
    this.snapshot = {
      steer: 0,
      /**
       * Instantaneous steering INTENT, before the ramp above smooths it.
       * The ramped `steer` axis takes ~60 ms to cross a threshold, so a player
       * who presses A and Space together — the natural way to start a drift —
       * would be judged "not steering" and get an e-brake. Anything reacting
       * to a key press EDGE must read this, not `steer`.
       */
      steerRaw: 0,
      throttle: 0,
      brake: 0,
      /** Context-sensitive: drift / e-brake / burnout. Physics decides which. */
      drift: false,
      nitrous: false,
      lookBack: false,
      pressed: this.pressed,
    };

    this._onKeyDown = (event) => {
      const action = this.keyToAction.get(event.code);
      if (!action) return;
      event.preventDefault();
      if (!this.held[action]) this._justPressed.add(action);
      this.held[action] = true;
    };

    this._onKeyUp = (event) => {
      const action = this.keyToAction.get(event.code);
      if (!action) return;
      event.preventDefault();
      this.held[action] = false;
    };

    // Losing focus mid-corner should not leave the throttle pinned.
    this._onBlur = () => {
      for (const action of this.actions) this.held[action] = false;
    };

    globalThis.addEventListener('keydown', this._onKeyDown);
    globalThis.addEventListener('keyup', this._onKeyUp);
    globalThis.addEventListener('blur', this._onBlur);
  }

  /**
   * @param {number} dt fixed timestep, seconds
   * @returns {typeof this.snapshot}
   */
  sample(dt) {
    for (const action of this.actions) this.pressed[action] = this._justPressed.has(action);
    this._justPressed.clear();

    const pad = this._readGamepad();

    const steerTarget = pad
      ? pad.steer
      : (this.held.steerRight ? 1 : 0) - (this.held.steerLeft ? 1 : 0);
    const throttleTarget = pad ? pad.throttle : this.held.throttle ? 1 : 0;
    const brakeTarget = pad ? pad.brake : this.held.brake ? 1 : 0;

    // Ramp toward the target so keyboard input feels analogue. Releasing is
    // faster than applying, which is what makes flick-steering readable.
    const steerRate = Math.abs(steerTarget) > Math.abs(this.snapshot.steer)
      ? INPUT.steerAttack
      : INPUT.steerRelease;
    this.snapshot.steerRaw = steerTarget;
    this.snapshot.steer = approach(this.snapshot.steer, steerTarget, steerRate * dt);
    this.snapshot.throttle = approach(
      this.snapshot.throttle,
      throttleTarget,
      (throttleTarget > this.snapshot.throttle ? INPUT.throttleAttack : INPUT.throttleRelease) * dt
    );
    this.snapshot.brake = approach(this.snapshot.brake, brakeTarget, INPUT.throttleAttack * dt);

    this.snapshot.drift = this.held.drift || Boolean(pad?.drift);
    this.snapshot.nitrous = this.held.nitrous || Boolean(pad?.nitrous);
    this.snapshot.lookBack = this.held.lookBack;

    return this.snapshot;
  }

  _readGamepad() {
    const pads = navigator.getGamepads?.();
    // Index by player, so player 2's stick cannot steer player 1's car.
    const pad = pads?.[this.gamepadIndex];
    if (!pad?.connected) return null;

    return {
      steer: deadzone(pad.axes[0] ?? 0),
      throttle: pad.buttons[7]?.value ?? 0, // RT
      brake: pad.buttons[6]?.value ?? 0, // LT
      drift: pad.buttons[0]?.pressed ?? false, // A / cross
      nitrous: pad.buttons[1]?.pressed ?? false, // B / circle
    };
  }

  dispose() {
    globalThis.removeEventListener('keydown', this._onKeyDown);
    globalThis.removeEventListener('keyup', this._onKeyUp);
    globalThis.removeEventListener('blur', this._onBlur);
  }
}

function approach(current, target, maxDelta) {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

function deadzone(value) {
  const dz = INPUT.gamepadDeadzone;
  if (Math.abs(value) < dz) return 0;
  return Math.sign(value) * ((Math.abs(value) - dz) / (1 - dz));
}
