/**
 * PostFX.js — post-processing chain. STUB: see TODO(phase-3).
 *
 * Bloom is not optional decoration here: every neon material in the game is
 * authored expecting it, and the scene looks flat and grey without it. Build
 * the chain first, tune materials second.
 *
 * ── CHAIN ─────────────────────────────────────────────────────────────────────
 *   RenderPass          → the scene
 *   UnrealBloomPass     → RENDER.bloom (strength .9, radius .5, threshold .7).
 *                         Threshold above 0.7 loses the kerb strips; below 0.5
 *                         the whole road glows and reads as fog.
 *   RadialBlurPass      → custom ShaderPass, strength driven by
 *                         speed / stats.topSpeed, masked out in the centre 40%
 *                         of the screen so the car stays sharp. Phase 6.
 *   OutputPass          → tone mapping and colour space. MUST be last.
 *
 * Import paths (three r186):
 *   import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
 *   import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
 *   import { UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
 *   import { OutputPass }     from 'three/addons/postprocessing/OutputPass.js';
 * The 'three/addons/' alias is provided by three's package exports — do not
 * deep-import from 'three/examples/jsm/', which Vite will not pre-bundle.
 *
 * PERFORMANCE: the composer allocates render targets at full resolution, so
 * halve the bloom pass resolution on devices reporting a pixel ratio > 1.5.
 * Wire renderer.onResize to composer.setSize or the effect will stretch.
 *
 * The stub below renders straight through the plain renderer so the scaffold is
 * visible before the chain exists. Keep that fallback: it is also the
 * `?nofx` escape hatch for debugging a material in isolation.
 */

import { RENDER } from '../Config.js';

export class PostFX {
  /**
   * @param {{
   *   renderer: import('./Renderer.js').Renderer,
   *   scene: import('three').Scene,
   *   camera: import('three').PerspectiveCamera,
   * }} options
   */
  constructor({ renderer, scene, camera }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = !new URLSearchParams(globalThis.location?.search ?? '').has('nofx');

    /** @type {import('three/addons/postprocessing/EffectComposer.js').EffectComposer|null} */
    this.composer = null;

    // TODO(phase-3): build the composer, and hook resize:
    //   renderer.onResize = (w, h, dpr) => this.composer.setSize(w, h);
    void RENDER;
  }

  /**
   * @param {number} frameDt used to drive time-based uniforms
   */
  render(frameDt) {
    void frameDt;
    if (this.enabled && this.composer) {
      this.composer.render(frameDt);
    } else {
      this.renderer.render(this.scene);
    }
  }

  /** @param {number} normalisedSpeed speed / topSpeed, 0..1+ */
  setSpeedBlur(normalisedSpeed) {
    // TODO(phase-6)
    void normalisedSpeed;
  }

  dispose() {
    this.composer?.dispose?.();
  }
}
