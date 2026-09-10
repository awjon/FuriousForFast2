/**
 * Car.js — one vehicle: its physics state, its mesh, its visual customisation.
 * IMPLEMENTED for phase 1 (build/placeOnTrack/syncTransform). applyVisuals()
 * stays a phase-3 stub.
 *
 * A Car is a dumb container. It does not steer itself and it does not decide
 * anything: Physics.js mutates `state`, and either Input (player) or PursuitAI
 * (police) writes `controls`. Keeping it passive is what lets the same class
 * serve the player, the cops and future traffic.
 *
 * ── MODEL ─────────────────────────────────────────────────────────────────────
 * No glTF asset. The car is built from primitives so upgrades can restyle it at
 * runtime with zero loading, which is the whole point of a minimalist build:
 *   body      BoxGeometry 1.9 × 0.75 × 4.4, on a `_chassis` sub-group so
 *             phase-1's cosmetic body roll/pitch can tilt it independently of
 *             the wheels, which must stay planted on the road.
 *   cabin     BoxGeometry 1.6 × 0.55 × 2.0, offset +0.2 z, dark glass material,
 *             also on `_chassis`.
 *   wheels    4 × CylinderGeometry(0.34, 0.34, 0.25, 16) rotated onto Z,
 *             at (±0.95, 0.34, ∓1.35) — front pair toward −Z (the heading-0
 *             forward direction), rear pair toward +Z. Direct children of
 *             `group`, not `_chassis`, so they never inherit body roll. Rims
 *             are a separate emissive-capable material so the visual upgrades
 *             can recolour them (phase 3).
 *   spoiler   optional box, added/removed by applyVisuals() (phase 3)
 *   underglow the PointLight from Environment's budget, parented here (phase 3)
 *
 * Wheels get visual-only treatment in syncTransform(): front pair yaws by
 * `state.steer`, all four spin by forwardSpeed / radius (state.wheelSpin,
 * integrated in Physics.js where a real dt is available). Never let wheel
 * transforms feed back into physics.
 *
 * ── DEBUG VECTORS (`?vectors`) ───────────────────────────────────────────────
 * When DEBUG.showPhysicsVectors is set, build() creates three THREE.ArrowHelper
 * instances once (velocity, resolved longitudinal force, resolved lateral
 * force) as direct scene children — not children of `group`, so their
 * direction can be set in world space without fighting the car's own rotation.
 * syncTransform() repositions/redirects them in place every render call; they
 * are never rebuilt.
 */

import * as THREE from 'three';
import { PALETTE, DEBUG, CAR_BODY, DEBUG_DRAW } from '../Config.js';
import { angleDelta } from '../utils/MathUtils.js';


/** Debug-arrow visual scale, metres of arrow per unit of the quantity drawn. */

export class Car {
  /**
   * @param {{
   *   stats: object,        resolved stat block from UpgradeSystem.getStats()
   *   isPlayer?: boolean,
   *   isPolice?: boolean,
   * }} options
   */
  constructor({ stats, isPlayer = false, isPolice = false }) {
    this.stats = stats;
    this.isPlayer = isPlayer;
    this.isPolice = isPolice;

    /** Physics state. Shape documented in physics/Physics.js. */
    this.state = {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      heading: 0,
      yawRate: 0,
      steer: 0,
      prevPosition: new THREE.Vector3(),
      prevHeading: 0,
      speed: 0,
      forwardSpeed: 0,
      lateralSpeed: 0,
      slipAngle: 0,
      isDrifting: false,
      driftDirection: 0,
      driftScore: 0,
      onRoad: true,
      nitrous: 0,
      nitrousActive: false,
      grounded: true,
      // Cosmetic-only, written by Physics.js with a real dt, read here.
      roll: 0,
      pitch: 0,
      wheelSpin: 0,
      // Debug-only, written by Physics.js, read by the `?vectors` overlay.
      forwardForce: 0,
      lateralForce: 0,
    };

    /** Written by Input (player) or PursuitAI (police), read by Physics. */
    this.controls = {
      steer: 0,
      throttle: 0,
      brake: 0,
      drift: false,
      nitrous: false,
    };

    /**
     * This car's last known place on the road network — an opaque
     * RoadPosition ({ edgeId, s }) owned by this Car, or null before the
     * first physics step. Physics.js copies fields into it every step; never
     * assign Track.sampleAt()'s scratch object directly, and never do
     * arithmetic on it.
     * @type {import('../world/Track.js').RoadPosition | null}
     */
    this.roadHint = null;
    /** 0 = pristine, 1 = wrecked. Police units are removed at 1. */
    this.damage = 0;

    this.group = new THREE.Group();
    this.group.name = isPolice ? 'police-car' : 'player-car';
    /**
     * Chassis sub-group: body + cabin. Rolls/pitches under cornering and
     * braking without dragging the wheels along with it.
     */
    this._chassis = new THREE.Group();
    this._chassis.name = 'chassis';
    this.group.add(this._chassis);

    /** @type {THREE.Object3D[]} [frontLeft, frontRight, rearLeft, rearRight] */
    this.wheels = [];

    /** @type {THREE.ArrowHelper|null} `?vectors` debug helpers, built once. */
    this._velocityArrow = null;
    this._longitudinalArrow = null;
    this._lateralArrow = null;
    /** Scratch vector reused by the debug-arrow updates — never reallocated. */
    this._debugScratch = new THREE.Vector3();
  }

  /**
   * Build the mesh hierarchy and add it to the scene.
   * @param {THREE.Scene} scene
   */
  async build(scene) {
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: PALETTE.asphalt,
      emissive: this.isPolice ? PALETTE.policeBlue : PALETTE.cyan,
      emissiveIntensity: 0.4,
      metalness: 0.55,
      roughness: 0.35,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.75, 4.4), bodyMaterial);
    body.position.y = 0.45;
    this._chassis.add(body);

    const cabinMaterial = new THREE.MeshStandardMaterial({
      color: 0x05070d,
      metalness: 0.4,
      roughness: 0.2,
    });
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.0), cabinMaterial);
    cabin.position.set(0, 0.9, 0.2);
    this._chassis.add(cabin);

    const rimMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a2f45,
      metalness: 0.6,
      roughness: 0.4,
    });
    const wheelGeometry = new THREE.CylinderGeometry(
      CAR_BODY.wheelRadius,
      CAR_BODY.wheelRadius,
      CAR_BODY.wheelWidth,
      16
    );
    // Default cylinder axis is Y (up); rotate it onto X so the wheel's flat
    // faces point left/right and the axle runs across the car, matching the
    // ±X wheel positions below.
    wheelGeometry.rotateZ(Math.PI / 2);

    // Axle offset is derived from the wheelbase in Config, so the mesh cannot
    // drift out of agreement with the bicycle model that steers the car.
    const halfTrack = CAR_BODY.halfTrack;
    const axle = CAR_BODY.axleOffset;
    const positions = [
      [-halfTrack, CAR_BODY.wheelRadius, -axle], // frontLeft (−Z is forward at heading 0)
      [halfTrack, CAR_BODY.wheelRadius, -axle], // frontRight
      [-halfTrack, CAR_BODY.wheelRadius, axle], // rearLeft
      [halfTrack, CAR_BODY.wheelRadius, axle], // rearRight
    ];

    this.wheels = positions.map(([x, y, z]) => {
      const wheel = new THREE.Mesh(wheelGeometry, rimMaterial);
      wheel.position.set(x, y, z);
      this.group.add(wheel);
      return wheel;
    });

    scene.add(this.group);

    if (DEBUG.showPhysicsVectors) {
      const origin = new THREE.Vector3();
      const dir = new THREE.Vector3(0, 0, 1);
      this._velocityArrow = new THREE.ArrowHelper(dir, origin, 1, PALETTE.cyan, 0.35, 0.2);
      this._longitudinalArrow = new THREE.ArrowHelper(dir, origin, 1, PALETTE.amber, 0.35, 0.2);
      this._lateralArrow = new THREE.ArrowHelper(dir, origin, 1, PALETTE.magenta, 0.35, 0.2);
      this._velocityArrow.visible = false;
      this._longitudinalArrow.visible = false;
      this._lateralArrow.visible = false;
      scene.add(this._velocityArrow, this._longitudinalArrow, this._lateralArrow);
    }
  }

  /**
   * Snap the car onto the track at a road position, at rest.
   * Used at start-up, after a reset, and after a bust.
   *
   * @param {import('../world/Track.js').Track} track
   * @param {import('../world/Track.js').RoadPosition} road
   * @param {number} [lateralOffset] metres right of centre
   */
  placeOnTrack(track, road, lateralOffset = 0) {
    // getPose() returns a REUSED scratch object — copy out, don't keep it.
    const pose = track.getPose(road, lateralOffset);
    this.state.position.copy(pose.position);
    this.state.prevPosition.copy(pose.position);
    this.state.velocity.set(0, 0, 0);
    this.state.heading = pose.heading;
    this.state.prevHeading = pose.heading;
    this.state.yawRate = 0;
    this.state.steer = 0;
    this.state.roll = 0;
    this.state.pitch = 0;
    this.state.wheelSpin = 0;
    this.state.forwardForce = 0;
    this.state.lateralForce = 0;
    this.state.nitrousActive = false;

    this.roadHint = { edgeId: road.edgeId, s: road.s };

    this.group.position.copy(pose.position);
    this.group.rotation.y = pose.heading;
  }

  /**
   * Copy physics state onto the Three.js transform, interpolating between the
   * last two fixed steps so a 60 Hz render of a 120 Hz simulation is smooth.
   * This is the ONLY place group.position/rotation may be written.
   *
   * @param {number} alpha 0..1 fraction between prev and current state
   */
  syncTransform(alpha) {
    const state = this.state;

    this.group.position.lerpVectors(state.prevPosition, state.position, alpha);

    // Interpolate heading along the shortest angular path or the car spins
    // the wrong way through the ±π seam.
    const heading = state.prevHeading + angleDelta(state.prevHeading, state.heading) * alpha;
    this.group.rotation.y = heading;

    // Body roll (cornering) and pitch (braking/accelerating) — cosmetic, not
    // interpolated between fixed steps since the underlying signal is already
    // a smooth per-second damp done in Physics.js with a real dt. Applied to
    // the chassis sub-group only, so the wheels stay level with the road.
    this._chassis.rotation.z = state.roll;
    this._chassis.rotation.x = state.pitch;

    // Wheels: front pair steers, all four spin. Same reasoning as above for
    // skipping cross-step interpolation — imperceptible at spin/steer rates.
    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i];
      wheel.rotation.x = state.wheelSpin;
      if (i < 2) wheel.rotation.y = state.steer; // front pair only
    }

    if (this._velocityArrow) this._updateDebugArrows();
  }

  _updateDebugArrows() {
    const state = this.state;
    const origin = this.group.position;
    const heading = this.group.rotation.y;
    const liftY = origin.y + 0.7;

    this._velocityArrow.position.set(origin.x, liftY, origin.z);
    this._setDebugArrow(
      this._velocityArrow,
      this._debugScratch.copy(state.velocity),
      DEBUG_DRAW.velocityArrowScale
    );

    const fx = -Math.sin(heading);
    const fz = -Math.cos(heading);
    const rx = Math.cos(heading);
    const rz = -Math.sin(heading);

    this._longitudinalArrow.position.set(origin.x, liftY, origin.z);
    this._setDebugArrow(
      this._longitudinalArrow,
      this._debugScratch.set(fx * state.forwardForce, 0, fz * state.forwardForce),
      DEBUG_DRAW.forceArrowScale
    );

    this._lateralArrow.position.set(origin.x, liftY, origin.z);
    this._setDebugArrow(
      this._lateralArrow,
      this._debugScratch.set(rx * state.lateralForce, 0, rz * state.lateralForce),
      DEBUG_DRAW.forceArrowScale
    );
  }

  /** @param {THREE.ArrowHelper} arrow @param {THREE.Vector3} vector scratch, mutated */
  _setDebugArrow(arrow, vector, scale) {
    const length = vector.length();
    if (length < 1e-4) {
      arrow.visible = false;
      return;
    }
    arrow.visible = true;
    arrow.setDirection(vector.normalize());
    arrow.setLength(Math.max(DEBUG_DRAW.minArrowLength, length * scale), 0.35, 0.2);
  }

  /**
   * Re-read the performance stat block after an upgrade purchase. Physics reads
   * `this.stats` every step, so this is just a swap — but nitrous capacity can
   * shrink, so clamp the current charge.
   * @param {object} stats
   */
  applyStats(stats) {
    this.stats = stats;
    this.state.nitrous = Math.min(this.state.nitrous, stats.nitrousCapacity);
  }

  /**
   * Apply cosmetic choices: body colour, rim colour, underglow colour and
   * on/off, spoiler present, window tint.
   * @param {object} visuals from UpgradeSystem.getVisuals()
   */
  applyVisuals(visuals) {
    // TODO(phase-3)
    void visuals;
  }

  dispose() {
    this.group.traverse((object) => {
      object.geometry?.dispose();
      const material = object.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.group.removeFromParent();

    for (const arrow of [this._velocityArrow, this._longitudinalArrow, this._lateralArrow]) {
      if (!arrow) continue;
      arrow.line.geometry.dispose();
      arrow.line.material.dispose();
      arrow.cone.geometry.dispose();
      arrow.cone.material.dispose();
      arrow.removeFromParent();
    }
  }
}
