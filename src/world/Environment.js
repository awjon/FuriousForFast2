/**
 * Environment.js — lighting, sky, fog and weather. STUB: see TODO(phase-2).
 *
 * Deliberately minimal: this is a night game, so there is no sun, no shadow
 * map and no environment probe. The look comes from emissive materials plus
 * bloom, which is both cheaper and closer to the NFSU2 reference than a
 * physically lit scene would be.
 *
 * LIGHT BUDGET — the whole game gets FIVE lights. Every additional light
 * recompiles shaders and costs a full-scene pass in the forward renderer.
 *   1  HemisphereLight   sky #1a1f4a → ground #05060f, intensity 0.35.
 *                        Stops unlit sides of buildings reading as pure black.
 *   2  DirectionalLight  cold moonlight from above-behind, intensity 0.25,
 *                        castShadow FALSE.
 *   3  PointLight        player underglow, colour from the visual upgrades.
 *   4  PointLight        player headlight pool, warm amber, moves with the car.
 *   5  reserved          nearest police lightbar (Police.js claims it).
 *
 * Rain (Phase 6) is a single additive Points cloud of ~4000 vertices, parented
 * to the camera and scrolled in a shader, plus a road roughness drop. Do not
 * simulate droplets.
 */

import * as THREE from 'three';
import { PALETTE } from '../Config.js';

export class Environment {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'environment';
    scene.add(this.group);
  }

  build() {
    // Minimal ambient so the scaffold preview is visible before Phase 2.
    // TODO(phase-2): replace with the five-light rig documented above.
    const hemisphere = new THREE.HemisphereLight(0x1a1f4a, PALETTE.void, 0.35);
    this.group.add(hemisphere);

    const moon = new THREE.DirectionalLight(0xaab4ff, 0.25);
    moon.position.set(-40, 80, 30);
    this.group.add(moon);

    this.hemisphere = hemisphere;
    this.moon = moon;
  }

  /**
   * @param {number} frameDt variable frame delta, seconds
   * @param {import('../entities/Car.js').Car} player
   */
  update(frameDt, player) {
    // TODO(phase-6): scroll rain, move the headlight pool with the player.
    void frameDt;
    void player;
  }

  dispose() {
    this.group.traverse((object) => object.dispose?.());
    this.group.removeFromParent();
  }
}
