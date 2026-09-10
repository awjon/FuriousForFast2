/**
 * Renderer.js — owns the WebGLRenderer, the camera and the resize handling.
 *
 * Nothing else in the codebase is allowed to construct a WebGLRenderer or call
 * setSize(). Post-processing hooks in through PostFX.js, which wraps this.
 */

import * as THREE from 'three';
import { RENDER } from '../Config.js';

export class Renderer {
  /** @param {{ canvas: HTMLCanvasElement }} options */
  constructor({ canvas }) {
    this.canvas = canvas;

    this.instance = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      // No alpha: the page background never shows through, and opaque is faster.
      alpha: false,
      stencil: false,
    });

    this.instance.setClearColor(RENDER.fogColor, 1);
    this.instance.toneMapping = THREE.ACESFilmicToneMapping;
    this.instance.toneMappingExposure = 1.1;
    // Emissive neon is authored in sRGB hex; three converts on upload.
    this.instance.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(RENDER.fov, 1, RENDER.near, RENDER.far);
    this.camera.position.set(0, 6, 14);

    this._onResize = this.resize.bind(this);
    globalThis.addEventListener('resize', this._onResize);
    this.resize();
  }

  resize() {
    const width = this.canvas.clientWidth || globalThis.innerWidth;
    const height = this.canvas.clientHeight || globalThis.innerHeight;
    const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, RENDER.maxPixelRatio);

    this.instance.setPixelRatio(pixelRatio);
    this.instance.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.onResize?.(width, height, pixelRatio);
  }

  /** @param {THREE.Scene} scene */
  render(scene) {
    this.instance.render(scene, this.camera);
  }

  dispose() {
    globalThis.removeEventListener('resize', this._onResize);
    this.instance.dispose();
  }
}
