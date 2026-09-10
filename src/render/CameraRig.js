/**
 * CameraRig.js — chase camera. PARTIAL: minimal phase-1 stand-in below;
 * see TODO(phase-3) for the rest.
 *
 * The camera is doing most of the work of selling speed in an arcade racer, so
 * it deserves as much tuning attention as the physics.
 *
 * ── PHASE 1 STAND-IN ─────────────────────────────────────────────────────────
 * Phase 1's acceptance criteria (accelerate/brake/drift/recover) are untestable
 * without a camera that tracks the car, so this ships ahead of its normal
 * phase-3a slot. It implements only a damped position follow at
 * CAMERA.chaseOffset behind the car's HEADING (not velocity — that is rule 1
 * below, deferred) and a look-at point CAMERA.lookAheadDistance ahead. FOV,
 * drift yaw offset, shake and the alternate modes are untouched TODOs.
 *
 * ── THE RULES (full phase-3 spec; rule 2 and half of rule 4 are live now) ────
 * 1. Follow the car's VELOCITY, not its heading. During a drift the car is
 *    sideways; a heading-locked camera swings violently and you cannot see the
 *    corner. Build the desired yaw from the velocity direction, then blend
 *    CAMERA.driftYawOffset back toward the heading so the drift still reads.
 *    Below ~3 m/s fall back to heading, or the camera spins at a standstill.
 * 2. Smooth with MathUtils.damp(), never a raw lerp — the render step is
 *    variable-rate and a raw lerp makes the camera stiffer at high frame rates.
 * 3. FOV rises from CAMERA.fovAtRest to fovAtTopSpeed with speed. This is the
 *    single most effective speed cue available; more effective than motion blur.
 * 4. Look at a point CAMERA.lookAheadDistance ahead of the car along its
 *    velocity, not at the car itself.
 * 5. Never let the camera pass through the road. Raise it if the sampled
 *    surface behind the car is higher than the camera's y.
 * 6. Shake is additive and decays at CAMERA.shake.decay. Gate all of it behind
 *    ACCESSIBILITY.reducedMotion.
 *
 * Modes: 'chase' (default), 'lookBack' (B held — mirrors the offset so you can
 * see the cops), 'orbit' (garage), 'free' (debug flycam), 'busted' (slow orbit
 * of the stopped car during the bust cutscene).
 */

import * as THREE from 'three';
import { CAMERA, ACCESSIBILITY } from '../Config.js';
import { damp } from '../utils/MathUtils.js';

export class CameraRig {
  /**
   * @param {{
   *   camera: THREE.PerspectiveCamera,
   *   target: import('../entities/Car.js').Car,
   * }} options
   */
  constructor({ camera, target }) {
    this.camera = camera;
    this.target = target;
    /** @type {'chase'|'lookBack'|'orbit'|'free'|'busted'} */
    this.mode = 'chase';
    this._previousMode = 'chase';
    this.shake = 0;

    this._desiredPosition = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();

    // Snap to the target immediately so the first frame doesn't show the
    // camera racing in from wherever Renderer.js parked it by default.
    this._computeDesired();
    this.camera.position.copy(this._desiredPosition);
    this.camera.lookAt(this._lookAt);
  }

  /**
   * @param {number} frameDt variable frame delta — NOT the fixed step
   * @param {object} state Game.state
   */
  update(frameDt, state) {
    // TODO(phase-3): 'orbit'/'free'/'busted' modes, shake, FOV ramp, velocity-
    // following with the drift yaw offset, and the road-height clamp (rule 5).
    this.mode = state?.lookBack ? 'lookBack' : 'chase';

    this._computeDesired();

    // Snap rather than damp when entering or leaving look-back: the desired
    // position jumps to the far side of the car, and damping through that
    // sweeps the camera straight through the bodywork.
    if (this.mode !== this._previousMode) {
      this.camera.position.copy(this._desiredPosition);
      this._previousMode = this.mode;
    }

    const rate = CAMERA.positionLerp;
    this.camera.position.x = damp(this.camera.position.x, this._desiredPosition.x, rate, frameDt);
    this.camera.position.y = damp(this.camera.position.y, this._desiredPosition.y, rate, frameDt);
    this.camera.position.z = damp(this.camera.position.z, this._desiredPosition.z, rate, frameDt);

    // TODO(phase-3): damp the look-at / orientation too, not just position —
    // an instant lookAt is fine at this camera's distance for phase 1 but
    // will read as swimmy once the velocity-following yaw offset lands.
    this.camera.lookAt(this._lookAt);
  }

  /**
   * Desired camera position (behind the car along its HEADING — phase 3
   * swaps this for velocity) and look-at point (ahead along the same axis).
   * Shared by the constructor's initial snap and every update().
   */
  _computeDesired() {
    const car = this.target.state;
    const heading = car.heading;
    this._forward.set(-Math.sin(heading), 0, -Math.cos(heading));
    this._right.set(Math.cos(heading), 0, -Math.sin(heading));

    // Look-back swings the rig to the FRONT of the car and aims it rearward,
    // so the player sees what is chasing them. Flipping the forward basis
    // vector does both at once: the offset lands ahead of the car and the
    // look-at target falls behind it.
    if (this.mode === 'lookBack') this._forward.multiplyScalar(-1);

    this._desiredPosition
      .copy(car.position)
      .addScaledVector(this._forward, -CAMERA.chaseOffset.z)
      .addScaledVector(this._right, CAMERA.chaseOffset.x);
    this._desiredPosition.y = car.position.y + CAMERA.chaseOffset.y;

    this._lookAt.copy(car.position).addScaledVector(this._forward, CAMERA.lookAheadDistance);
    this._lookAt.y = car.position.y + 0.8; // eye-line above the tarmac, not at the wheels
  }

  /** @param {number} intensity 0..1, from collision severity */
  addShake(intensity) {
    if (ACCESSIBILITY.reducedMotion) return;
    this.shake = Math.min(1, this.shake + intensity);
  }
}
