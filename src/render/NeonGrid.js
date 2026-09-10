/**
 * NeonGrid.js — an infinite-looking neon ground grid drawn analytically in a
 * fragment shader. IMPLEMENTED, not stubbed.
 *
 * WHY NOT THREE.GridHelper: a helper draws GL line primitives, which are one
 * pixel wide regardless of distance, alias badly, cannot fade out, and
 * rasterise unreliably at grazing angles — the near-parallel lines running away
 * from the camera drop out entirely on some drivers and on software GL. A
 * single quad with a procedural grid has none of those problems.
 *
 * The `fwidth`-based line function below is worth understanding, because
 * Track.js needs exactly the same technique for lane markings in Phase 2:
 * dividing the distance-to-a-line by its screen-space derivative gives a line
 * whose width is constant IN PIXELS, so it stays crisp up close and fades to a
 * smooth grey in the distance instead of turning into aliased noise.
 */

import * as THREE from 'three';
import { PALETTE, RENDER } from '../Config.js';

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    // Pass the POSITION, not a distance. See the note in the fragment shader.
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3  uMinorColor;
  uniform vec3  uMajorColor;
  uniform float uSpacing;      // metres between minor lines
  uniform float uMajorEvery;   // a major line every N minor lines
  uniform float uLineWidth;    // in pixels
  uniform float uFogDensity;
  uniform vec3  uFogColor;
  uniform float uOpacity;

  varying vec3 vWorldPosition;

  /**
   * Coverage of the nearest grid line, antialiased. Returns 0..1.
   * fwidth(coord) is how much coord changes across one pixel, so
   * distance / fwidth is a distance measured in pixels.
   */
  float gridCoverage(vec2 worldXZ, float spacing, float widthPixels) {
    vec2 coord = worldXZ / spacing;
    vec2 derivative = fwidth(coord);
    // Distance to the nearest integer line, in pixels, per axis.
    vec2 distanceToLine = abs(fract(coord - 0.5) - 0.5) / max(derivative, vec2(1e-6));
    float nearest = min(distanceToLine.x, distanceToLine.y);
    return 1.0 - smoothstep(0.0, widthPixels, nearest);
  }

  void main() {
    /**
     * Distance MUST be computed here, per fragment, and never passed down as a
     * varying from the vertex shader. This quad is 4 km across with only four
     * vertices, so a per-vertex distance interpolates between corner values of
     * ~2000 m and reports thousands of metres even for ground right under the
     * camera — which saturates the fog term to 1.0 and discards every fragment.
     * Interpolating the POSITION and taking its length here is exact.
     * Any large, sparsely-tessellated surface has this trap; the Phase 2 road
     * shader will need the same treatment.
     */
    float viewDistance = length(vWorldPosition - cameraPosition);

    vec2 worldXZ = vWorldPosition.xz;
    float minor = gridCoverage(worldXZ, uSpacing, uLineWidth);
    float major = gridCoverage(worldXZ, uSpacing * uMajorEvery, uLineWidth * 1.4);

    // Major lines win where they overlap a minor one.
    vec3  color = mix(uMinorColor, uMajorColor, major);
    float alpha = max(minor * 0.55, major);

    // Match the scene's exponential-squared fog so the grid dissolves into the
    // same darkness as everything else rather than ending in a hard edge.
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * viewDistance * viewDistance);
    color = mix(color, uFogColor, clamp(fogFactor, 0.0, 1.0));
    alpha *= (1.0 - clamp(fogFactor, 0.0, 1.0)) * uOpacity;

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

export class NeonGrid {
  /**
   * @param {{
   *   size?: number,        edge length of the ground quad, metres
   *   spacing?: number,     metres between minor lines
   *   majorEvery?: number,  a brighter line every N minor lines
   *   minorColor?: number,
   *   majorColor?: number,
   *   opacity?: number,
   * }} [options]
   */
  constructor({
    size = 4000,
    spacing = 4,
    majorEvery = 8,
    minorColor = PALETTE.violet,
    majorColor = PALETTE.magenta,
    opacity = 0.85,
  } = {}) {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      // The grid is a ground plane: it should never occlude the cars above it,
      // and writing depth from a transparent surface causes sorting artefacts.
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uMinorColor: { value: new THREE.Color(minorColor) },
        uMajorColor: { value: new THREE.Color(majorColor) },
        uSpacing: { value: spacing },
        uMajorEvery: { value: majorEvery },
        uLineWidth: { value: 1.5 },
        uFogDensity: { value: RENDER.fogDensity },
        uFogColor: { value: new THREE.Color(RENDER.fogColor) },
        uOpacity: { value: opacity },
      },
    });

    const geometry = new THREE.PlaneGeometry(size, size);
    geometry.rotateX(-Math.PI / 2); // bake the rotation so mesh.rotation stays clean

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'neon-grid';
    // Draw before other transparent objects, and never cull it — the quad is
    // huge and its bounding sphere is almost always on screen anyway.
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  /**
   * Keep the grid centred under the camera, snapped to the major-line spacing
   * so the pattern does not visibly slide. Lets a 4 km quad read as infinite.
   * @param {THREE.Vector3} position
   */
  followCamera(position) {
    const snap = this.material.uniforms.uSpacing.value * this.material.uniforms.uMajorEvery.value;
    this.mesh.position.set(
      Math.round(position.x / snap) * snap,
      0,
      Math.round(position.z / snap) * snap
    );
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
