/**
 * Physics.js — arcade car dynamics. STUB: see TODO(phase-1).
 *
 * This is NOT a rigid-body simulation and must not become one. It is a
 * 2.5D point-mass model with an explicit yaw degree of freedom, chosen because
 * arcade drifting needs the car's heading to be semi-independent of its
 * velocity — something a real tyre model fights you on.
 *
 * ── CarState (owned by Car.js, mutated only here) ─────────────────────────────
 *   position        THREE.Vector3   world metres; y follows the road surface
 *   velocity        THREE.Vector3   world m/s
 *   heading         number          yaw in radians; 0 faces −Z
 *   yawRate         number          rad/s
 *   steer           number          current front-wheel angle, radians
 *   prevPosition    THREE.Vector3   previous fixed step, for render interpolation
 *   prevHeading     number          ditto
 *   speed           number          cached |velocity| (m/s)
 *   forwardSpeed    number          signed velocity along heading (m/s)
 *   lateralSpeed    number          signed velocity across heading (m/s)
 *   slipAngle       number          atan2(lateralSpeed, |forwardSpeed|), radians
 *   isDrifting      boolean         |slipAngle| > stats.driftThreshold
 *   driftDirection  -1 | 0 | 1
 *   onRoad          boolean         from Track.sampleAt()
 *   nitrous         number          0..stats.nitrousCapacity
 *   nitrousActive   boolean
 *   grounded        boolean         false while airborne over a crest
 *
 * ── THE STEP, in order ────────────────────────────────────────────────────────
 * 1. DECOMPOSE. Build the car's local basis from `heading`:
 *      forward = (−sin h, 0, −cos h)      right = (cos h, 0, −sin h)
 *    Project velocity onto both to get forwardSpeed and lateralSpeed. Compute
 *    slipAngle = atan2(lateralSpeed, max(|forwardSpeed|, 0.5)). The 0.5 floor
 *    stops slipAngle exploding into noise at a standstill.
 *
 * 2. SURFACE. Ask Track.sampleAt(position) for { onRoad, distanceFromCentre,
 *    surfaceY, tangent, t }. Off-road multiplies grip by
 *    stats.offroadGripMultiplier and drag by stats.offroadDragMultiplier.
 *    Cache `t` on the car as `trackT` — the AI, HUD and respawn all read it.
 *
 * 3. LONGITUDINAL FORCE along `forward`:
 *      engine  = throttle · enginePower · powerCurve(forwardSpeed)
 *                where powerCurve = clamp(1 − forwardSpeed / topSpeed, 0, 1),
 *                so force tapers to zero at top speed — a soft limiter with no
 *                explicit speed clamp anywhere.
 *      boost   = nitrousActive ? stats.nitrousBoostForce : 0
 *      brake   = −sign(forwardSpeed) · brake · brakeForce
 *      reverse = if throttle is 0, brake is held, and forwardSpeed < 0.5,
 *                apply −brake · enginePower · 0.4 instead of braking
 *      drag    = −dragCoefficient · forwardSpeed · |forwardSpeed| · surfaceDrag
 *      roll    = −rollingResistance · forwardSpeed
 *
 * 4. LATERAL FORCE along `right`. This is where the drift lives:
 *      gripLimit = lateralGrip
 *                · (1 + speed · gripSpeedGain)     // fake downforce
 *                · surfaceGrip
 *                · (handbrake ? handbrakeGripMultiplier : 1)
 *      desired   = −lateralSpeed · mass / dt        // force that would kill all slide
 *      lateral   = clamp(desired, −gripLimit, +gripLimit)
 *    When |desired| > gripLimit the tyres are saturated: the car slides, and
 *    the leftover lateral speed IS the drift. Nothing else needs to special-case
 *    it. Accumulate driftScore += |slipAngle| · speed · dt while isDrifting, and
 *    refill nitrous at NITROUS.driftRefillPerSecond.
 *
 * 5. YAW. Steering is kinematic, not torque-driven — far easier to tune:
 *      steerTarget = steerInput · maxSteerAngle / (1 + speed · steerSpeedFalloff)
 *      steer       = damp(steer, steerTarget, steerResponse, dt)
 *      yawTarget   = (forwardSpeed / wheelbase) · tan(steer)       // bicycle model
 *      if isDrifting: yawTarget *= driftYawAssist
 *      yawRate     = damp(yawRate, yawTarget, yawDamping, dt)
 *      heading    += yawRate · dt
 *    Reverse must steer the correct way: yawTarget already carries the sign of
 *    forwardSpeed, so do NOT take an absolute value there.
 *
 * 6. INTEGRATE (semi-implicit Euler — stable at 120 Hz, unlike explicit):
 *      acceleration = (forwardForce · forward + lateralForce · right) / mass
 *      velocity    += acceleration · dt
 *      position    += velocity · dt
 *    Then snap position.y to surfaceY (Phase 4 adds a spring for crests).
 *
 * 7. NITROUS bookkeeping: engage only if input is held AND
 *    nitrous >= NITROUS.minimumToEngage; drain while active; refill passively.
 *
 * TUNING ORDER when the car feels wrong — change one thing at a time:
 *   too sluggish        → enginePower, then topSpeed
 *   won't turn in       → maxSteerAngle, then steerSpeedFalloff
 *   spins on every turn → lateralGrip up, or driftYawAssist down
 *   drift won't hold    → handbrakeGripMultiplier down, driftYawAssist up
 *   drift won't recover → yawDamping up, and enable ACCESSIBILITY.driftAssist
 */

import * as THREE from 'three';
import { NITROUS } from '../Config.js';

/** Distance between axles, metres. Only used by the yaw bicycle model. */
const WHEELBASE = 2.7;

export class Physics {
  constructor() {
    // Scratch vectors — reused every step for every car. Allocating a Vector3
    // inside step() would produce ~500 garbage objects a second per car.
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._acceleration = new THREE.Vector3();
  }

  /**
   * Advance one car by exactly one fixed timestep.
   *
   * @param {import('../entities/Car.js').Car} car     mutated in place
   * @param {object} controls  { steer, throttle, brake, handbrake, nitrous }
   * @param {import('../world/Track.js').Track} track  queried for the surface
   * @param {number} dt        fixed step, seconds — never a frame delta
   */
  step(car, controls, track, dt) {
    // TODO(phase-1): implement steps 1–7 documented above.
    void car;
    void controls;
    void track;
    void dt;
    void NITROUS;
    void WHEELBASE;
  }

  /**
   * Resolve a collision between two cars, or a car and a static prop.
   * Arcade rules: conserve very little energy, favour the heavier car, and
   * always leave the player pointing roughly down the road. A realistic
   * impulse response here makes the game feel broken.
   *
   * @param {object} a
   * @param {object} b  a second car, or { position, normal, mass: Infinity }
   * @returns {number} impact severity 0..1, for camera shake and heat gain
   */
  resolveCollision(a, b) {
    // TODO(phase-4)
    void a;
    void b;
    return 0;
  }

  /**
   * Keep a car inside the road when it hits a guardrail: cancel the inward
   * velocity component, scrub some speed, nudge the heading parallel to the
   * rail. Should feel like scraping a wall, not hitting a brick.
   *
   * @param {object} car
   * @param {object} surface result of Track.sampleAt()
   */
  applyBarrier(car, surface) {
    // TODO(phase-4)
    void car;
    void surface;
  }
}
