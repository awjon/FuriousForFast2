/**
 * Track.js — procedural closed-loop street circuit + neon city dressing.
 * STUB: see TODO(phase-2).
 *
 * The track is ONE closed CatmullRomCurve3. Everything else — road mesh, kerb
 * neon, guardrails, buildings, streetlights, checkpoints, cop spawn anchors,
 * the off-road test — is derived from that single curve. If you need a new
 * piece of world furniture, derive it from the spline rather than hand-placing
 * it, so a seed change regenerates a coherent city.
 *
 * ── GENERATION (deterministic, driven by utils/Random.js) ─────────────────────
 * 1. Walk `TRACK.controlPointCount` angles evenly around a circle of
 *    TRACK.loopRadius. Perturb each point radially by ±TRACK.radialJitter and
 *    vertically within TRACK.elevationRange. Reject a candidate whose turn
 *    angle against its neighbours exceeds ~70° — that is what produces
 *    drivable sweepers instead of hairpin spaghetti.
 * 2. new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5)
 * 3. curve.getSpacedPoints(TRACK.splineSamples) for ARC-LENGTH-EVEN samples.
 *    Use getSpacedPoints, not getPoints: even spacing is what keeps the road
 *    mesh from bunching in corners and makes `t` usable as a race position.
 *
 * ── ROAD MESH ─────────────────────────────────────────────────────────────────
 * For each sample i: point Pᵢ, tangent Tᵢ = curve.getTangentAt(i/N), and a
 * side vector Sᵢ = normalize(cross(Tᵢ, UP)). Emit two vertices at
 * Pᵢ ± Sᵢ · (roadWidth / 2). Index consecutive pairs into quads. UVs: u across
 * the road (0..1), v along it in metres / 8 so the dashed-line texture tiles at
 * a fixed real-world scale regardless of segment length.
 *
 * Build the road as TRACK.chunkCount separate meshes rather than one giant
 * BufferGeometry — a single mesh can never be frustum-culled, so the GPU
 * transforms the whole city every frame.
 *
 * ── STYLING (the NFSU2 look) ──────────────────────────────────────────────────
 *  road      MeshStandardMaterial, near-black (PALETTE.asphalt), roughness 0.35,
 *            metalness 0.55 — the low roughness is the "wet street" read, and it
 *            is what makes the neon emitters smear along the tarmac.
 *  kerbs     thin extruded strips, MeshBasicMaterial in cyan/magenta, alternating
 *            per chunk. Basic (not Standard) so bloom picks them up at full
 *            intensity without needing a light.
 *  rails     boxes at ±(roadWidth/2 + shoulderWidth), emissive edge trim.
 *  buildings InstancedMesh of boxes, one instance per streetlight slot that
 *            passes TRACK.buildingDensity. Vary height 8–70 m. Windows come from
 *            an emissive grid texture, NOT from geometry.
 *  lights    Do NOT add a PointLight per streetlight — 400 lights will not run.
 *            Use emissive quads for the glow and 3–4 moving lights total.
 *
 * ── QUERY API ─────────────────────────────────────────────────────────────────
 * sampleAt() is called for every car every fixed step, so it must be O(1).
 * Precompute a uniform spatial grid (cell ≈ 40 m) mapping cell → candidate
 * sample indices at build time, then test only those candidates.
 */

import * as THREE from 'three';
import { TRACK, PALETTE } from '../Config.js';
import { Random } from '../utils/Random.js';

/**
 * @typedef {object} TrackSample
 * @property {number}  t                  normalised position along the loop, 0..1
 * @property {number}  distanceFromCentre signed metres; negative = left of centre
 * @property {boolean} onRoad             |distanceFromCentre| < roadWidth / 2
 * @property {number}  surfaceY           road height at this point, metres
 * @property {THREE.Vector3} tangent      unit forward direction of the road
 * @property {THREE.Vector3} centre       closest point on the spline
 */

export class Track {
  /** @param {{ seed?: number }} options */
  constructor({ seed = TRACK.seed } = {}) {
    this.random = new Random(seed);
    this.seed = seed;

    /** @type {THREE.CatmullRomCurve3 | null} */
    this.curve = null;
    /** @type {THREE.Vector3[]} arc-length-even samples along the loop */
    this.samples = [];
    /** Total loop length in metres, for lap timing and race position. */
    this.length = 0;
    /** @type {THREE.Group} everything this track added to the scene */
    this.group = new THREE.Group();
    this.group.name = 'track';
    /** @type {{ t: number, position: THREE.Vector3 }[]} */
    this.checkpoints = [];
  }

  /**
   * Generate the spline and all geometry, and add it to the scene.
   * Async so Phase 5 can await texture loads without changing the call site.
   * @param {THREE.Scene} scene
   */
  async build(scene) {
    // TODO(phase-2): generate spline, road mesh, kerbs, rails, buildings.
    scene.add(this.group);
    void PALETTE;
  }

  /**
   * Nearest-point query against the spline. MUST be allocation-free and O(1) —
   * see the spatial grid note above. Reuse a single scratch TrackSample.
   *
   * @param {THREE.Vector3} position
   * @param {number} [hintT] last known t for this car; lets you search a narrow
   *                         window of samples instead of the whole grid
   * @returns {TrackSample}
   */
  sampleAt(position, hintT) {
    // TODO(phase-2)
    void position;
    void hintT;
    return {
      t: 0,
      distanceFromCentre: 0,
      onRoad: true,
      surfaceY: 0,
      tangent: new THREE.Vector3(0, 0, -1),
      centre: new THREE.Vector3(),
    };
  }

  /**
   * Position and orientation at a normalised distance along the loop. Used to
   * place the player at the start, respawn after a bust, and spawn cops and
   * roadblocks ahead of the player.
   *
   * @param {number} t normalised 0..1, wraps
   * @param {number} [lateralOffset] metres right of centre
   * @returns {{ position: THREE.Vector3, heading: number }}
   */
  getPose(t, lateralOffset = 0) {
    // TODO(phase-2)
    void t;
    void lateralOffset;
    return { position: new THREE.Vector3(), heading: 0 };
  }

  /**
   * Signed shortest distance from `fromT` to `toT` around the loop, in
   * normalised units (−0.5..0.5). Positive means `toT` is ahead. The pursuit AI
   * needs this to tell "the cop is 40 m behind me" from "the cop is 900 m
   * behind me", which a naive `toT - fromT` gets wrong across the seam.
   */
  loopDelta(fromT, toT) {
    const raw = toT - fromT;
    return raw - Math.round(raw);
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
