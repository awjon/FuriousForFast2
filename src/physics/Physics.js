/**
 * Physics.js — arcade car dynamics. IMPLEMENTED (phase 1).
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
 *   driftScore      number          accumulates |slipAngle|·speed·dt while drifting
 *
 * ── CarState, cosmetic and debug half ─────────────────────────────────────────
 * Written here because this is the only place with a real fixed dt to damp
 * against — Car.syncTransform() receives an interpolation fraction, not a time.
 * Never read by gameplay code; safe to ignore when reasoning about the sim.
 *   roll            number          body lean, radians (visual only)
 *   pitch           number          body dive/squat, radians (visual only)
 *   wheelSpin       number          accumulated wheel rotation, radians
 *   forwardForce    number          last resolved longitudinal force, N (?vectors)
 *   lateralForce    number          last resolved lateral force, N (?vectors)
 *
 *   Cosmetic-only fields, read by Car.syncTransform() and never by gameplay
 *   code. Computed here (not in Car.js) because this is the one place with a
 *   real, fixed dt to damp/integrate against:
 *   roll            number   radians, body tilt from lateral force, damped
 *   pitch           number   radians, body tilt from longitudinal force, damped
 *   wheelSpin       number   radians, integrated from forwardSpeed / wheel radius
 *   forwardForce    number   newtons, last resolved longitudinal force (debug)
 *   lateralForce    number   newtons, last resolved lateral force (debug)
 *
 * ── THE STEP, in order ────────────────────────────────────────────────────────
 * 1. DECOMPOSE. Build the car's local basis from `heading`:
 *      forward = (−sin h, 0, −cos h)      right = (cos h, 0, −sin h)
 *    Project velocity onto both to get forwardSpeed and lateralSpeed. Compute
 *    slipAngle = atan2(lateralSpeed, max(|forwardSpeed|, 0.5)). The 0.5 floor
 *    stops slipAngle exploding into noise at a standstill.
 *
 * 2. SURFACE. Ask Track.sampleAt(position, hint) for a REUSED scratch object:
 *    { road: {edgeId, s}, onRoad, surfaceY, distanceFromCentre, tangent,
 *    centre }. `road` is an opaque RoadPosition handle — copy its fields
 *    (edgeId, s) into the Car's own persistent `roadHint` object; never keep
 *    the scratch reference and never do arithmetic on it. Pass `car.roadHint`
 *    back in as the hint on every call so Phase 2's spatial-index lookup can
 *    search a narrow window instead of the whole network. Off-road multiplies
 *    grip by stats.offroadGripMultiplier and drag by stats.offroadDragMultiplier.
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
 *    it.
 *
 *    Accumulate driftScore += |slipAngle| · speed · dt while isDrifting, and
 *    refill nitrous at NITROUS.driftRefillPerSecond. driftScore lives on
 *    car.state, NOT on Game.state: step() is never handed Game.state, and its
 *    signature is fixed. Game mirrors the player's value across each frame.
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
 *    nitrous >= NITROUS.minimumToEngage; drain while active; refill passively,
 *    plus an extra NITROUS.driftRefillPerSecond while isDrifting.
 *
 * TUNING ORDER when the car feels wrong — change one thing at a time:
 *   too sluggish        → enginePower, then topSpeed
 *   won't turn in       → maxSteerAngle, then steerSpeedFalloff
 *   spins on every turn → lateralGrip up, or driftYawAssist down
 *   drift won't hold    → handbrakeGripMultiplier down, driftYawAssist up
 *   drift won't recover → yawDamping up, and enable ACCESSIBILITY.driftAssist
 */

import * as THREE from 'three';
import { NITROUS, CAR_BODY } from '../Config.js';
import { clamp, damp } from '../utils/MathUtils.js';

export class Physics {
  constructor() {
    // Scratch vectors — reused every step for every car. Allocating a Vector3
    // inside step() would produce ~500 garbage objects per second per car.
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
    const state = car.state;
    const stats = car.stats;

    // Render interpolation reads from the previous fixed step, so stash it
    // before this step overwrites position/heading.
    state.prevPosition.copy(state.position);
    state.prevHeading = state.heading;

    // ── 1. DECOMPOSE ────────────────────────────────────────────────────
    const forward = this._forward.set(-Math.sin(state.heading), 0, -Math.cos(state.heading));
    const right = this._right.set(Math.cos(state.heading), 0, -Math.sin(state.heading));

    const forwardSpeed = state.velocity.dot(forward);
    const lateralSpeed = state.velocity.dot(right);
    const slipAngle = Math.atan2(lateralSpeed, Math.max(Math.abs(forwardSpeed), 0.5));

    state.speed = state.velocity.length();
    state.forwardSpeed = forwardSpeed;
    state.lateralSpeed = lateralSpeed;
    state.slipAngle = slipAngle;

    // ── 2. SURFACE ──────────────────────────────────────────────────────
    // sample is a REUSED scratch object — read fields now, never keep it.
    const sample = track.sampleAt(state.position, car.roadHint);
    state.onRoad = sample.onRoad;
    state.grounded = true; // Phase 4 adds a spring for crests
    const surfaceY = sample.surfaceY;

    // Copy the opaque RoadPosition into a persistent object this car owns.
    // Never assign `sample.road` directly — it is overwritten on the next
    // sampleAt() call, on any car.
    if (!car.roadHint) car.roadHint = { edgeId: sample.road.edgeId, s: sample.road.s };
    else {
      car.roadHint.edgeId = sample.road.edgeId;
      car.roadHint.s = sample.road.s;
    }

    const surfaceGrip = state.onRoad ? 1 : stats.offroadGripMultiplier;
    const surfaceDrag = state.onRoad ? 1 : stats.offroadDragMultiplier;

    // ── 3. LONGITUDINAL FORCE along `forward` ──────────────────────────
    const powerCurve = clamp(1 - forwardSpeed / stats.topSpeed, 0, 1);
    let longitudinal = controls.throttle * stats.enginePower * powerCurve;

    state.nitrousActive = Boolean(controls.nitrous) && state.nitrous >= NITROUS.minimumToEngage;
    if (state.nitrousActive) longitudinal += stats.nitrousBoostForce;

    const isReverseThrottle = controls.throttle <= 0 && controls.brake > 0 && forwardSpeed < 0.5;
    if (isReverseThrottle) {
      longitudinal += -controls.brake * stats.enginePower * 0.4;
    } else {
      longitudinal += -Math.sign(forwardSpeed) * controls.brake * stats.brakeForce;
    }

    longitudinal += -stats.dragCoefficient * forwardSpeed * Math.abs(forwardSpeed) * surfaceDrag;
    longitudinal += -stats.rollingResistance * forwardSpeed;

    // ── 4. LATERAL FORCE along `right` — this is where the drift lives ─
    const gripLimit =
      stats.lateralGrip *
      (1 + state.speed * stats.gripSpeedGain) *
      surfaceGrip *
      (controls.handbrake ? stats.handbrakeGripMultiplier : 1);

    const desiredLateral = (-lateralSpeed * stats.mass) / dt;
    const lateral = clamp(desiredLateral, -gripLimit, gripLimit);

    state.isDrifting = Math.abs(slipAngle) > stats.driftThreshold;
    state.driftDirection = state.isDrifting ? Math.sign(slipAngle) : 0;

    // Drift score accumulates PER CAR rather than on Game.state, because
    // step() is not handed Game.state and its signature is fixed. Game mirrors
    // the player's value into Game.state each frame for the HUD; cops and
    // traffic accumulate their own harmlessly and nobody reads them.
    if (state.isDrifting) {
      state.driftScore += Math.abs(slipAngle) * state.speed * dt;
    }

    // ── 5. YAW — kinematic bicycle model ───────────────────────────────
    const steerTarget =
      (controls.steer * stats.maxSteerAngle) / (1 + state.speed * stats.steerSpeedFalloff);
    state.steer = damp(state.steer, steerTarget, stats.steerResponse, dt);

    let yawTarget = (forwardSpeed / CAR_BODY.wheelbase) * Math.tan(state.steer);
    if (state.isDrifting) yawTarget *= stats.driftYawAssist;
    state.yawRate = damp(state.yawRate, yawTarget, stats.yawDamping, dt);
    state.heading += state.yawRate * dt;

    // ── 6. INTEGRATE — semi-implicit Euler ─────────────────────────────
    this._acceleration
      .copy(forward)
      .multiplyScalar(longitudinal)
      .addScaledVector(right, lateral)
      .divideScalar(stats.mass);

    state.velocity.addScaledVector(this._acceleration, dt);
    state.position.addScaledVector(state.velocity, dt);
    state.position.y = surfaceY;

    // ── 7. NITROUS BOOKKEEPING ─────────────────────────────────────────
    if (state.nitrousActive) {
      state.nitrous = Math.max(0, state.nitrous - stats.nitrousDrainPerSecond * dt);
    } else {
      let refill = NITROUS.passiveRefillPerSecond;
      if (state.isDrifting) refill += NITROUS.driftRefillPerSecond;
      state.nitrous = Math.min(stats.nitrousCapacity, state.nitrous + refill * dt);
    }

    // ── VISUAL-ONLY bookkeeping for Car.syncTransform() and `?vectors` ──
    // Not part of the documented CarState contract above the fold; cosmetic
    // or debug-only, never read by gameplay code. Damped/integrated here
    // (not in Car.js) because this is the one place with a real, fixed dt —
    // Car.syncTransform() only receives an interpolation fraction.
    state.forwardForce = longitudinal;
    state.lateralForce = lateral;

    const rollTarget = clamp(-lateral / stats.lateralGrip, -1, 1) * CAR_BODY.maxRoll;
    const pitchTarget = clamp(longitudinal / stats.brakeForce, -1, 1) * CAR_BODY.maxPitch;
    state.roll = damp(state.roll, rollTarget, CAR_BODY.tiltResponse, dt);
    state.pitch = damp(state.pitch, pitchTarget, CAR_BODY.tiltResponse, dt);

    state.wheelSpin += (forwardSpeed / CAR_BODY.wheelRadius) * dt;
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
