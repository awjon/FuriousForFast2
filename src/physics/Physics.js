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
 *   isDrifting      boolean         |slipAngle| > stats.driftThreshold — a purely
 *                                   PHYSICAL reading of the tyres, independent of
 *                                   driftState below (an e-brake can slide too).
 *   driftDirection  -1 | 0 | 1      sign of slipAngle while isDrifting
 *   onRoad          boolean         from Track.sampleAt()
 *   nitrous         number          0..stats.nitrousCapacity
 *   nitrousActive   boolean
 *   grounded        boolean         false while airborne over a crest
 *   driftScore      number          accumulates |slipAngle|·speed·dt while drifting
 *
 *   ── The context-sensitive Space key (DRIFT in Config.js; CLAUDE.md §7.1
 *   "The drift model") — a small state machine, not a flag. Entry conditions
 *   are evaluated ONLY on the press edge; while Space is held the state does
 *   not re-evaluate, or a drift would silently become an e-brake the instant
 *   the player straightens the wheel mid-corner.
 *   driftState      'none'|'drift'|'ebrake'|'burnout'|'boost'
 *   driftLockDir    -1 | 0 | 1      steer sign at the moment a drift was
 *                                   committed; fixed for the life of the
 *                                   drift, only 'drift' sets it non-zero.
 *   driftCharge     number          seconds of sustained slip ('drift', vs
 *                                   DRIFT.chargeSlipAngle) or throttle
 *                                   ('burnout', vs DRIFT.burnoutMaxCharge)
 *                                   built up toward a release payout.
 *   boostForce      number          newtons applied along `forward` while
 *                                   driftState === 'boost' — a mini-turbo
 *                                   tier payout or a burnout launch.
 *   boostTimer      number          seconds left on the current boost.
 *   driftKeyHeld    boolean         previous fixed step's controls.drift.
 *                                   Internal edge-detection bookkeeping only
 *                                   — never read outside this file.
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
 * 2. DRIFT STATE MACHINE. Space is one context-sensitive key (DRIFT in
 *    Config.js): on the press edge only, read speed and steer to choose
 *    'drift' (moving + steering past DRIFT.steerToEngage — locks
 *    driftLockDir to sign(steer)), 'burnout' (nearly stopped + throttle) or
 *    'ebrake' (everything else). The state is held fixed until release —
 *    never re-evaluated — so straightening the wheel mid-drift cannot flip
 *    it. A charge meter accumulates while committed and actually sliding
 *    ('drift' vs DRIFT.chargeSlipAngle) or spinning ('burnout'). Release
 *    pays out: 'drift' → the highest DRIFT.tiers threshold reached becomes a
 *    'boost' (mini-turbo); 'burnout' → 'boost' scaled by charge fraction
 *    (launch); 'ebrake' → straight back to 'none'. 'boost' counts its own
 *    timer down to 'none' every step it isn't otherwise interrupted by a
 *    fresh press.
 *
 * 3. SURFACE. Ask Track.sampleAt(position, hint) for a REUSED scratch object:
 *    { road: {edgeId, s}, onRoad, surfaceY, distanceFromCentre, tangent,
 *    centre }. `road` is an opaque RoadPosition handle — copy its fields
 *    (edgeId, s) into the Car's own persistent `roadHint` object; never keep
 *    the scratch reference and never do arithmetic on it. Pass `car.roadHint`
 *    back in as the hint on every call so Phase 2's spatial-index lookup can
 *    search a narrow window instead of the whole network. Off-road multiplies
 *    grip by stats.offroadGripMultiplier and drag by stats.offroadDragMultiplier.
 *
 * 4. LONGITUDINAL FORCE along `forward`:
 *      engine  = throttle · enginePower · powerCurve(forwardSpeed)
 *                where powerCurve = clamp(1 − forwardSpeed / topSpeed, 0, 1),
 *                so force tapers to zero at top speed — a soft limiter with no
 *                explicit speed clamp anywhere.
 *                while driftState === 'burnout': engine ×= (1 −
 *                DRIFT.burnoutHoldFactor), so the car keeps only a small
 *                slice of its drive force and barely creeps. A fraction, not
 *                a fixed hold force, so it behaves the same stock or maxed.
 *      boost   = nitrousActive ? stats.nitrousBoostForce : 0
 *      turbo   = driftState === 'boost' ? boostForce : 0   // mini-turbo / launch
 *      brake   = −sign(forwardSpeed) · brake · brakeForce
 *      reverse = if throttle is 0, brake is held, and forwardSpeed < 0.5,
 *                apply −brake · enginePower · 0.4 instead of braking
 *      ebrake  = driftState === 'ebrake' ? −sign(forwardSpeed) · DRIFT.ebrakeForce : 0
 *      drag    = −dragCoefficient · forwardSpeed · |forwardSpeed| · surfaceDrag
 *      roll    = −rollingResistance · forwardSpeed
 *
 * 5. LATERAL FORCE along `right`. This is where the drift lives:
 *      gripLimit = lateralGrip
 *                · (1 + speed · gripSpeedGain)     // fake downforce
 *                · surfaceGrip
 *                · driftGripFactor
 *      driftGripFactor =
 *          driftState === 'drift'  ? DRIFT.gripMultiplier · (stats.handbrakeGripMultiplier / CAR_BASE.handbrakeGripMultiplier)
 *        : driftState === 'ebrake' ? DRIFT.ebrakeGripMultiplier
 *        : 1
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
 *    This is unrelated to the mini-turbo charge meter — see stage 2 — which
 *    is a separate reward on a separate timescale.
 * 6. YAW. Steering is kinematic, not torque-driven — far easier to tune:
 *      steerInput  = driftState !== 'drift' ? steer
 *                  : driftLockDir · |steer| · (sign(steer) agrees with
 *                    driftLockDir (or steer is 0) ? innerSteerFactor : outerSteerFactor)
 *                    // sign is PINNED to driftLockDir — steering "against" the
 *                    // lock only shrinks the magnitude, it can never cross
 *                    // zero and flip the rotation or straighten the car.
 *      steerTarget = steerInput · maxSteerAngle / (1 + speed · steerSpeedFalloff)
 *      steer       = damp(steer, steerTarget, steerResponse, dt)
 *      yawTarget   = −(forwardSpeed / wheelbase) · tan(steer)      // bicycle model
 *                    ^ negated: the textbook model has +steer = left, but our
 *                      input axis is +1 = RIGHT. Drop the sign and the car
 *                      steers backwards.
 *      if isDrifting: yawTarget *= driftYawAssist
 *      yawRate     = damp(yawRate, yawTarget, yawDamping, dt)
 *      heading    += yawRate · dt
 *    Reverse must steer the correct way: yawTarget already carries the sign of
 *    forwardSpeed, so do NOT take an absolute value there.
 *
 * 7. INTEGRATE (semi-implicit Euler — stable at 120 Hz, unlike explicit):
 *      acceleration = (forwardForce · forward + lateralForce · right) / mass
 *      velocity    += acceleration · dt
 *      position    += velocity · dt
 *    Then snap position.y to surfaceY (Phase 4 adds a spring for crests).
 *
 * 8. NITROUS bookkeeping: engage only if input is held AND
 *    nitrous >= NITROUS.minimumToEngage; drain while active; refill passively,
 *    plus an extra NITROUS.driftRefillPerSecond while isDrifting.
 *
 * TUNING ORDER when the car feels wrong — change one thing at a time:
 *   too sluggish        → enginePower, then topSpeed
 *   won't turn in       → maxSteerAngle, then steerSpeedFalloff
 *   spins on every turn → lateralGrip up, or driftYawAssist down
 *   drift won't hold    → DRIFT.gripMultiplier down, driftYawAssist up
 *   drift won't recover → yawDamping up, and enable ACCESSIBILITY.driftAssist
 */

import * as THREE from 'three';
import { NITROUS, CAR_BODY, CAR_BASE, DRIFT } from '../Config.js';
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
   * The highest mini-turbo tier reached by a charge, or null if the charge
   * never crossed even the first threshold. DRIFT.tiers is short and fixed,
   * so a linear scan is fine — and it returns a reference into that frozen
   * array, never allocating.
   * @param {number} charge seconds accumulated
   * @returns {{name: string, seconds: number, force: number, duration: number, color: number}|null}
   */
  _resolveDriftTier(charge) {
    let reached = null;
    for (const tier of DRIFT.tiers) {
      if (charge >= tier.seconds) reached = tier;
    }
    return reached;
  }

  /**
   * Advance one car by exactly one fixed timestep.
   *
   * @param {import('../entities/Car.js').Car} car     mutated in place
   * @param {object} controls  { steer, throttle, brake, drift, nitrous }
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

    // ── 2. DRIFT STATE MACHINE — the context-sensitive Space key ───────
    // Entry conditions are evaluated ONLY on the press edge (computed from
    // state.driftKeyHeld, never from controls.pressed — police controls have
    // no `pressed` field, and this must work for any car). While Space stays
    // down the state is left exactly as it was: re-checking every frame is
    // the trap CLAUDE.md calls out — it would turn a drift into an e-brake
    // the instant the player straightens the wheel mid-corner.
    const driftKeyDown = Boolean(controls.drift);
    const driftPressEdge = driftKeyDown && !state.driftKeyHeld;
    const driftReleaseEdge = !driftKeyDown && state.driftKeyHeld;
    state.driftKeyHeld = driftKeyDown;

    if (driftPressEdge) {
      // Read the RAW steer intent, not the ramped axis. The ramp needs ~60 ms
      // to cross steerToEngage, so testing `controls.steer` here judges a
      // player who pressed A and Space together as "not steering" and hands
      // them an e-brake instead of the drift they asked for. Cars with no
      // input layer (police, traffic) fall back to the smoothed axis.
      const steerIntent = controls.steerRaw ?? controls.steer;
      if (state.speed >= DRIFT.minSpeed && Math.abs(steerIntent) >= DRIFT.steerToEngage) {
        state.driftState = 'drift';
        state.driftLockDir = Math.sign(steerIntent);
      } else if (state.speed < DRIFT.burnoutMaxSpeed && controls.throttle > 0) {
        state.driftState = 'burnout';
        state.driftLockDir = 0;
      } else {
        state.driftState = 'ebrake';
        state.driftLockDir = 0;
      }
      // Deliberately NOT clearing boostTimer/boostForce: a boost already
      // running keeps running when you commit to the next drift. Chaining
      // corner to corner is the point of the mini-turbo ladder, and zeroing
      // the boost here would punish exactly the play it should reward.
      state.driftCharge = 0;
    } else if (driftReleaseEdge) {
      if (state.driftState === 'drift') {
        const tier = this._resolveDriftTier(state.driftCharge);
        if (tier) {
          state.driftState = 'boost';
          state.boostTimer = tier.duration;
          state.boostForce = tier.force;
        } else {
          state.driftState = 'none';
        }
      } else if (state.driftState === 'burnout') {
        const chargeFraction = clamp(state.driftCharge / DRIFT.burnoutMaxCharge, 0, 1);
        state.driftState = 'boost';
        state.boostTimer = DRIFT.burnoutLaunchDuration;
        state.boostForce = DRIFT.burnoutLaunchForce * chargeFraction;
      } else {
        // 'ebrake' (or already 'none'/'boost') — no payout, just let go.
        state.driftState = 'none';
      }
      state.driftCharge = 0;
    }

    // Boost runs on its own clock, independent of driftState, so it survives
    // being re-pressed into a new drift (see above).
    if (state.boostTimer > 0) {
      state.boostTimer -= dt;
      if (state.boostTimer <= 0) {
        state.boostTimer = 0;
        state.boostForce = 0;
        if (state.driftState === 'boost') state.driftState = 'none';
      }
    }

    // Charge only builds while committed AND actually sliding/spinning, so a
    // lazy slide or a light throttle blip earns nothing (mirrors the mini-
    // turbo ladder's design intent in Config.js).
    if (state.driftState === 'drift') {
      if (Math.abs(slipAngle) > DRIFT.chargeSlipAngle) state.driftCharge += dt;
    } else if (state.driftState === 'burnout') {
      state.driftCharge = Math.min(
        DRIFT.burnoutMaxCharge,
        state.driftCharge + DRIFT.burnoutChargePerSecond * dt
      );
    }

    // ── 3. SURFACE ──────────────────────────────────────────────────────
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

    // ── 4. LONGITUDINAL FORCE along `forward` ──────────────────────────
    const powerCurve = clamp(1 - forwardSpeed / stats.topSpeed, 0, 1);
    let engineForce = controls.throttle * stats.enginePower * powerCurve;

    // BURNOUT: cancel most of the engine so the car barely creeps while the
    // tyres spin. Scaling engine force by a FRACTION rather than subtracting a
    // fixed hold force is what makes this work across the upgrade tree — a
    // flat 16000 N left a stock car (11000 N) frozen at exactly zero while a
    // fully upgraded one (20187 N) accelerated past burnoutMaxSpeed and simply
    // drove off. A fraction always leaves the same small slice of creep, and
    // can never go negative, so a burnout cannot roll the car backward.
    if (state.driftState === 'burnout') {
      engineForce *= 1 - DRIFT.burnoutHoldFactor;
    }

    let longitudinal = engineForce;

    state.nitrousActive = Boolean(controls.nitrous) && state.nitrous >= NITROUS.minimumToEngage;
    if (state.nitrousActive) longitudinal += stats.nitrousBoostForce;

    // Mini-turbo payout or burnout launch: a forward push that decays over
    // boostTimer. Independent of nitrous — both can be active at once.
    if (state.driftState === 'boost') longitudinal += state.boostForce;

    const isReverseThrottle = controls.throttle <= 0 && controls.brake > 0 && forwardSpeed < 0.5;
    if (isReverseThrottle) {
      longitudinal += -controls.brake * stats.enginePower * 0.4;
    } else {
      longitudinal += -Math.sign(forwardSpeed) * controls.brake * stats.brakeForce;
    }

    // E-BRAKE: a genuine stop, independent of the `brake` control — this is
    // what the old grip-only handbrake never did.
    if (state.driftState === 'ebrake') {
      longitudinal += -Math.sign(forwardSpeed) * DRIFT.ebrakeForce;
    }

    longitudinal += -stats.dragCoefficient * forwardSpeed * Math.abs(forwardSpeed) * surfaceDrag;
    longitudinal += -stats.rollingResistance * forwardSpeed;

    // ── 5. LATERAL FORCE along `right` — this is where the drift lives ─
    // DRIFT.gripMultiplier is the base; the brakes upgrade's
    // stats.handbrakeGripMultiplier still modulates it by the same ratio it
    // would have applied to the old handbrake, so that upgrade keeps doing
    // something (see the Phase 1b report for why a ratio, not a product).
    let driftGripFactor = 1;
    if (state.driftState === 'drift') {
      driftGripFactor =
        DRIFT.gripMultiplier * (stats.handbrakeGripMultiplier / CAR_BASE.handbrakeGripMultiplier);
    } else if (state.driftState === 'ebrake') {
      driftGripFactor = DRIFT.ebrakeGripMultiplier;
    }

    const gripLimit =
      stats.lateralGrip * (1 + state.speed * stats.gripSpeedGain) * surfaceGrip * driftGripFactor;

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

    // ── 6. YAW — kinematic bicycle model ───────────────────────────────
    // Inside a locked drift, steering only modulates the arc: into the turn
    // tightens it (innerSteerFactor), away widens it (outerSteerFactor), but
    // the sign fed to the bicycle model below is pinned to driftLockDir — it
    // can shrink toward zero but never cross it, so opposing the lock cannot
    // straighten the car or flip which way it is rotating.
    let steerInput = controls.steer;
    if (state.driftState === 'drift') {
      const lockDir = state.driftLockDir;
      const rawSign = Math.sign(controls.steer);
      const intoTurn = rawSign === 0 || rawSign === lockDir;
      const factor = intoTurn ? DRIFT.innerSteerFactor : DRIFT.outerSteerFactor;
      steerInput = lockDir * Math.abs(controls.steer) * factor;
    }

    const steerTarget =
      (steerInput * stats.maxSteerAngle) / (1 + state.speed * stats.steerSpeedFalloff);
    state.steer = damp(state.steer, steerTarget, stats.steerResponse, dt);

    // NEGATED on purpose. The textbook bicycle model is written in the SAE
    // convention where a POSITIVE steer angle turns LEFT (counter-clockwise,
    // increasing heading). Our input convention is the opposite: Config's
    // steer axis is -1 = full left, +1 = full right. Without this sign the
    // car steers backwards — pressing A sends it right.
    let yawTarget = -(forwardSpeed / CAR_BODY.wheelbase) * Math.tan(state.steer);
    if (state.isDrifting) yawTarget *= stats.driftYawAssist;
    state.yawRate = damp(state.yawRate, yawTarget, stats.yawDamping, dt);
    state.heading += state.yawRate * dt;

    // ── 7. INTEGRATE — semi-implicit Euler ─────────────────────────────
    this._acceleration
      .copy(forward)
      .multiplyScalar(longitudinal)
      .addScaledVector(right, lateral)
      .divideScalar(stats.mass);

    state.velocity.addScaledVector(this._acceleration, dt);
    state.position.addScaledVector(state.velocity, dt);
    state.position.y = surfaceY;

    // ── 8. NITROUS BOOKKEEPING ─────────────────────────────────────────
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

    // BURNOUT overrides the visual spin rate: the wheels are slipping on the
    // spot, not rolling with forwardSpeed, so the usual formula would barely
    // move them.
    if (state.driftState === 'burnout') {
      state.wheelSpin += DRIFT.burnoutWheelSpinRate * dt;
    } else {
      state.wheelSpin += (forwardSpeed / CAR_BODY.wheelRadius) * dt;
    }
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
