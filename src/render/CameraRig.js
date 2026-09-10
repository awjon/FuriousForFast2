/**
 * CameraRig.js — chase camera. STUB: see TODO(phase-3).
 *
 * The camera is doing most of the work of selling speed in an arcade racer, so
 * it deserves as much tuning attention as the physics.
 *
 * ── THE RULES ─────────────────────────────────────────────────────────────────
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
    this.shake = 0;

    this._desiredPosition = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();
  }

  /**
   * @param {number} frameDt variable frame delta — NOT the fixed step
   * @param {object} state Game.state
   */
  update(frameDt, state) {
    // TODO(phase-3): implement rules 1–6 above.
    void frameDt;
    void state;
    void CAMERA;
    void ACCESSIBILITY;
  }

  /** @param {number} intensity 0..1, from collision severity */
  addShake(intensity) {
    if (ACCESSIBILITY.reducedMotion) return;
    this.shake = Math.min(1, this.shake + intensity);
  }
}
