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

const ACTIONS = Object.keys(INPUT.bindings);

/** Build a reverse map: 'KeyW' -> 'throttle'. */
const KEY_TO_ACTION = new Map();
for (const [action, codes] of Object.entries(INPUT.bindings)) {
  for (const code of codes) KEY_TO_ACTION.set(code, action);
}

export class Input {
  /** @param {HTMLElement} target element that receives focus for key events */
  constructor(target) {
    this.target = target;

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
      throttle: 0,
      brake: 0,
      handbrake: false,
      nitrous: false,
      lookBack: false,
      pressed: this.pressed,
    };

    this._onKeyDown = (event) => {
      const action = KEY_TO_ACTION.get(event.code);
      if (!action) return;
      event.preventDefault();
      if (!this.held[action]) this._justPressed.add(action);
      this.held[action] = true;
    };

    this._onKeyUp = (event) => {
      const action = KEY_TO_ACTION.get(event.code);
      if (!action) return;
      event.preventDefault();
      this.held[action] = false;
    };

    // Losing focus mid-corner should not leave the throttle pinned.
    this._onBlur = () => {
      for (const action of ACTIONS) this.held[action] = false;
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
    for (const action of ACTIONS) this.pressed[action] = this._justPressed.has(action);
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
    this.snapshot.steer = approach(this.snapshot.steer, steerTarget, steerRate * dt);
    this.snapshot.throttle = approach(
      this.snapshot.throttle,
      throttleTarget,
      (throttleTarget > this.snapshot.throttle ? INPUT.throttleAttack : INPUT.throttleRelease) * dt
    );
    this.snapshot.brake = approach(this.snapshot.brake, brakeTarget, INPUT.throttleAttack * dt);

    this.snapshot.handbrake = this.held.handbrake || Boolean(pad?.handbrake);
    this.snapshot.nitrous = this.held.nitrous || Boolean(pad?.nitrous);
    this.snapshot.lookBack = this.held.lookBack;

    return this.snapshot;
  }

  _readGamepad() {
    const pads = navigator.getGamepads?.();
    const pad = pads && [...pads].find((p) => p?.connected);
    if (!pad) return null;

    return {
      steer: deadzone(pad.axes[0] ?? 0),
      throttle: pad.buttons[7]?.value ?? 0, // RT
      brake: pad.buttons[6]?.value ?? 0, // LT
      handbrake: pad.buttons[0]?.pressed ?? false, // A / cross
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
