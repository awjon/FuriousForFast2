/**
 * Car.js — one vehicle: its physics state, its mesh, its visual customisation.
 * STUB: see TODO(phase-1) and TODO(phase-3).
 *
 * A Car is a dumb container. It does not steer itself and it does not decide
 * anything: Physics.js mutates `state`, and either Input (player) or PursuitAI
 * (police) writes `controls`. Keeping it passive is what lets the same class
 * serve the player, the cops and future traffic.
 *
 * ── MODEL ─────────────────────────────────────────────────────────────────────
 * No glTF asset. The car is built from primitives so upgrades can restyle it at
 * runtime with zero loading, which is the whole point of a minimalist build:
 *   body      BoxGeometry 1.9 × 0.75 × 4.4, chamfered by scaling a second
 *             slightly smaller box for the cabin on top
 *   cabin     BoxGeometry 1.6 × 0.55 × 2.0, offset +0.2 z, dark glass material
 *   wheels    4 × CylinderGeometry(0.34, 0.34, 0.25, 16) rotated onto Z,
 *             at (±0.95, 0.34, ±1.35). Rims are a separate emissive material so
 *             the visual upgrades can recolour them.
 *   spoiler   optional box, added/removed by applyVisuals()
 *   underglow the PointLight from Environment's budget, parented here
 *
 * Wheels get visual-only treatment in syncTransform(): front pair yaws by
 * `state.steer`, all four spin by forwardSpeed / radius. Never let wheel
 * transforms feed back into physics.
 */

import * as THREE from 'three';

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
      onRoad: true,
      nitrous: 0,
      nitrousActive: false,
      grounded: true,
    };

    /** Written by Input (player) or PursuitAI (police), read by Physics. */
    this.controls = {
      steer: 0,
      throttle: 0,
      brake: 0,
      handbrake: false,
      nitrous: false,
    };

    /** Normalised position around the track loop, cached by Physics.step(). */
    this.trackT = 0;
    /** 0 = pristine, 1 = wrecked. Police units are removed at 1. */
    this.damage = 0;

    this.group = new THREE.Group();
    this.group.name = isPolice ? 'police-car' : 'player-car';
    /** @type {THREE.Object3D[]} [frontLeft, frontRight, rearLeft, rearRight] */
    this.wheels = [];
  }

  /**
   * Build the mesh hierarchy and add it to the scene.
   * @param {THREE.Scene} scene
   */
  async build(scene) {
    // TODO(phase-1): build body/cabin/wheels from the primitives listed above.
    scene.add(this.group);
  }

  /**
   * Snap the car onto the track at a normalised position, at rest.
   * Used at start-up, after a reset, and after a bust.
   *
   * @param {import('../world/Track.js').Track} track
   * @param {number} t normalised 0..1
   * @param {number} [lateralOffset] metres right of centre
   */
  placeOnTrack(track, t, lateralOffset = 0) {
    const { position, heading } = track.getPose(t, lateralOffset);
    this.state.position.copy(position);
    this.state.prevPosition.copy(position);
    this.state.velocity.set(0, 0, 0);
    this.state.heading = heading;
    this.state.prevHeading = heading;
    this.state.yawRate = 0;
    this.state.steer = 0;
    this.trackT = t;
    this.group.position.copy(position);
    this.group.rotation.y = heading;
  }

  /**
   * Copy physics state onto the Three.js transform, interpolating between the
   * last two fixed steps so a 60 Hz render of a 120 Hz simulation is smooth.
   * This is the ONLY place group.position/rotation may be written.
   *
   * @param {number} alpha 0..1 fraction between prev and current state
   */
  syncTransform(alpha) {
    // TODO(phase-1): lerp position, lerp-shortest-path the heading, spin wheels,
    // and apply a small body roll from lateral acceleration and pitch from
    // longitudinal acceleration — the roll is most of the perceived weight.
    this.group.position.lerpVectors(this.state.prevPosition, this.state.position, alpha);
    this.group.rotation.y = this.state.heading;
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
  }
}
