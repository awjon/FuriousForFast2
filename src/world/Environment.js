/**
 * Environment.js — lighting, sky, fog and weather. IMPLEMENTED phase-2b: the
 * five-light rig. Rain (Phase 6) is still a TODO.
 *
 * Deliberately minimal: this is a night game, so there is no sun, no shadow
 * map and no environment probe. The look comes from emissive materials plus
 * bloom, which is both cheaper and closer to the NFSU2 reference than a
 * physically lit scene would be.
 *
 * LIGHT BUDGET — the whole game gets FIVE lights, all tuned in Config's
 * LIGHTING group. Every additional light recompiles shaders and costs a
 * full-scene pass in the forward renderer.
 *   1  HemisphereLight   sky → ground. Stops unlit building faces reading as
 *                        pure black.
 *   2  DirectionalLight  cold moonlight, castShadow FALSE (§3 — no shadow maps).
 *   3  PointLight        player underglow, follows the car every render frame.
 *                        Colour is a fixed neon default here; Car.applyVisuals()
 *                        wires it to the owned visual upgrade in Phase 3.
 *   4  PointLight        player headlight pool, warm amber, projected onto the
 *                        road ahead of the car.
 *   5  reserved          nearest police lightbar — Police.js claims it in
 *                        Phase 4. Do not add a sixth light here.
 *
 * Rain (Phase 6) is a single additive Points cloud of ~4000 vertices, parented
 * to the camera and scrolled in a shader, plus a road roughness drop. Do not
 * simulate droplets.
 */

import * as THREE from 'three';
import { LIGHTING } from '../Config.js';

export class Environment {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'environment';
    scene.add(this.group);
  }

  build() {
    const hemiCfg = LIGHTING.hemisphere;
    const hemisphere = new THREE.HemisphereLight(hemiCfg.sky, hemiCfg.ground, hemiCfg.intensity);
    this.group.add(hemisphere);

    const moonCfg = LIGHTING.moon;
    const moon = new THREE.DirectionalLight(moonCfg.color, moonCfg.intensity);
    moon.position.set(moonCfg.position.x, moonCfg.position.y, moonCfg.position.z);
    moon.castShadow = false; // §3: no shadow maps, ever
    this.group.add(moon);

    const underCfg = LIGHTING.underglow;
    const underglow = new THREE.PointLight(underCfg.color, underCfg.intensity, underCfg.distance);
    this.group.add(underglow);

    const headCfg = LIGHTING.headlightPool;
    const headlightPool = new THREE.PointLight(headCfg.color, headCfg.intensity, headCfg.distance);
    this.group.add(headlightPool);

    this.hemisphere = hemisphere;
    this.moon = moon;
    this.underglow = underglow;
    this.headlightPool = headlightPool;
  }

  /**
   * @param {number} frameDt variable frame delta, seconds
   * @param {import('../entities/Car.js').Car} player
   */
  update(frameDt, player) {
    // TODO(phase-6): scroll rain.
    void frameDt;
    if (!player) return;

    const pos = player.group.position;
    const heading = player.group.rotation.y;

    this.underglow.position.set(pos.x, pos.y + LIGHTING.underglow.height, pos.z);

    // Projected ahead of the car along its heading, at road level — the pool
    // of light a headlight actually throws, not a light glued to the bumper.
    const forwardX = -Math.sin(heading);
    const forwardZ = -Math.cos(heading);
    const cfg = LIGHTING.headlightPool;
    this.headlightPool.position.set(
      pos.x + forwardX * cfg.forwardOffset,
      pos.y + cfg.height,
      pos.z + forwardZ * cfg.forwardOffset
    );
  }

  dispose() {
    this.group.traverse((object) => object.dispose?.());
    this.group.removeFromParent();
  }
}
