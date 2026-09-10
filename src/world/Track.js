/**
 * Track.js — the drivable city. STUB: see TODO(phase-2).
 *
 * ⚠ ARCHITECTURE CHANGE (decided after Phase 0; see CLAUDE.md §7.2)
 * This is NO LONGER a single closed circuit. The game is an OPEN WORLD: one
 * road NETWORK — a graph of intersections joined by spline segments —
 * generated once from a FIXED seed so the city is identical in every session
 * and players learn it by heart. Races are seeded CHECKPOINT SEQUENCES laid
 * on top of that fixed city; the seed varies the route, never the map.
 *
 * The graph, its spatial index and its routing live in world/RoadNetwork.js.
 * This file owns generation and geometry, and exposes the query API below.
 *
 * Consequences to respect:
 *  - There is no global lap parameter `t`. A position on the road is an opaque
 *    {@link RoadPosition} — an edge id plus metres along that edge. Treat it as
 *    a handle: pass it back to sampleAt() as a hint, hand it to getPose(), but
 *    never do arithmetic on it. The old `loopDelta()` does not generalise and
 *    is gone; gap-along-route is a RoadNetwork query.
 *  - Cops need real route-finding across the graph, not a lookahead along one
 *    curve. See CLAUDE.md §7.4.
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
import { WORLD, PALETTE } from '../Config.js';
import { Random } from '../utils/Random.js';

/**
 * An opaque handle to a location on the road network. Do not do arithmetic on
 * it — ask RoadNetwork for distances and routes instead.
 *
 * @typedef {object} RoadPosition
 * @property {number} edgeId index of the network edge
 * @property {number} s      metres along that edge, from its start node
 */

/**
 * @typedef {object} TrackSample
 * @property {RoadPosition}  road               where on the network this is
 * @property {number}  distanceFromCentre signed metres; negative = left of centre
 * @property {boolean} onRoad             |distanceFromCentre| < roadWidth / 2
 * @property {number}  surfaceY           road height at this point, metres
 * @property {THREE.Vector3} tangent      unit forward direction of the road
 * @property {THREE.Vector3} centre       closest point on the road centreline
 */

export class Track {
  /** @param {{ seed?: number }} options */
  constructor({ seed = WORLD.seed } = {}) {
    this.random = new Random(seed);
    this.seed = seed;

    /** @type {THREE.CatmullRomCurve3 | null} */
    this.curve = null;
    /** @type {THREE.Vector3[]} arc-length-even samples along the loop */
    this.samples = [];
    /** @type {import('./RoadNetwork.js').RoadNetwork | null} built in Phase 2 */
    this.network = null;
    /** @type {THREE.Group} everything this track added to the scene */
    this.group = new THREE.Group();
    this.group.name = 'track';
    /**
     * Scratch objects returned by sampleAt() and getPose(). Reused every call —
     * these two run once per car per fixed step, and allocating there produces
     * hundreds of garbage objects a second.
     */
    this._scratchSample = {
      road: { edgeId: 0, s: 0 },
      distanceFromCentre: 0,
      onRoad: true,
      surfaceY: 0,
      tangent: new THREE.Vector3(0, 0, -1),
      centre: new THREE.Vector3(),
    };
    this._scratchPose = { position: new THREE.Vector3(), heading: 0 };
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
   * Nearest-point query against the road network. Called for every car every
   * fixed step, so it MUST be O(1) and allocation-free: mutate and return
   * `this._scratchSample` rather than building a new object.
   *
   * PHASE 1 BEHAVIOUR: reports flat ground at y = 0 and `onRoad: true`
   * everywhere, so Physics can be built and tuned before the city exists.
   * Callers must not depend on that — read the fields, never assume the values.
   *
   * @param {THREE.Vector3} position
   * @param {RoadPosition} [hint] this car's road position last step. Lets the
   *   Phase 2 implementation search a couple of adjacent edges instead of the
   *   whole spatial index. Safe to pass null on the first call.
   * @returns {TrackSample} a REUSED object — copy any field you need to keep
   */
  sampleAt(position, hint) {
    // TODO(phase-2): spatial-index lookup, then nearest point on candidate edges.
    void position;
    const sample = this._scratchSample;
    sample.road.edgeId = hint?.edgeId ?? 0;
    sample.road.s = hint?.s ?? 0;
    sample.distanceFromCentre = 0;
    sample.onRoad = true;
    sample.surfaceY = 0;
    sample.tangent.set(0, 0, -1);
    sample.centre.set(position.x, 0, position.z);
    return sample;
  }

  /**
   * Position and orientation at a road position. Used to place the player at
   * the start, respawn after a bust, and spawn cops and roadblocks.
   *
   * PHASE 1 BEHAVIOUR: returns the origin facing −Z regardless of input.
   *
   * @param {RoadPosition} road
   * @param {number} [lateralOffset] metres right of centre
   * @returns {{ position: THREE.Vector3, heading: number }} a REUSED object
   */
  getPose(road, lateralOffset = 0) {
    // TODO(phase-2)
    void road;
    void lateralOffset;
    this._scratchPose.position.set(0, 0, 0);
    this._scratchPose.heading = 0;
    return this._scratchPose;
  }

  /**
   * The player's default start position — a fixed, hand-picked spot in the
   * city, not a random one, because it doubles as the respawn point and as the
   * place screenshots and lap times are anchored to.
   * @returns {RoadPosition}
   */
  getSpawn() {
    // TODO(phase-2)
    return { edgeId: 0, s: 0 };
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
