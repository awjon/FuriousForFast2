/**
 * Track.js — the drivable city. IMPLEMENTED phase-2a (crude geometry; Phase 2b
 * replaces the road mesh with lane markings, intersection polygons, kerb neon,
 * guardrails and buildings).
 *
 * ⚠ ARCHITECTURE (decided after Phase 0; see CLAUDE.md §7.2)
 * This is NOT a single closed circuit. The game is an OPEN WORLD: one road
 * NETWORK — a graph of intersections joined by spline segments — generated
 * once from a FIXED seed so the city is identical in every session and
 * players learn it by heart. Races are seeded CHECKPOINT SEQUENCES laid on
 * top of that fixed city; the seed varies the route, never the map.
 *
 * **`RoadNetwork.js` owns the graph and every query over it** (generation,
 * `sampleAt`, `getPose`, `getSpawn`, routing) — this file only holds it as
 * `this.network` and delegates those calls straight through. This file's own
 * job is geometry and the scene graph: turning the network's edges into
 * chunked road meshes.
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
 * ── ROAD MESH (phase-2a: crude, untextured ribbons — Phase 2b's job to dress) ─
 * Per edge, for each of its (already arc-length-even) samples i: point Pᵢ,
 * tangent Tᵢ (already computed by RoadNetwork), and side vector
 * Sᵢ = normalize(cross(Tᵢ, UP)). Emit two vertices at Pᵢ ± Sᵢ · (edge.width/2)
 * and index consecutive sample pairs into two triangles each, wound so the
 * face normal points +Y (verified against `computeVertexNormals()`, not
 * assumed — see the derivation in `_buildRoadMeshes()`).
 *
 * No lane-marking UVs, no intersection fill polygons, no kerbs/rails/
 * buildings/streetlights yet — all explicitly Phase 2b. Ribbons from
 * different edges simply overlap at junctions for now; CLAUDE.md §7.2 already
 * flags the z-fighting this will cause as a Phase 2b concern, not a phase-2a
 * one ("geometry can stay crude — untextured ribbons are fine").
 *
 * Chunking: edges are grouped into `WORLD.chunkSize`-metre chunks by their
 * midpoint and built into one BufferGeometry per chunk (not one mesh for the
 * whole city), so the road can be frustum-culled. An edge that happens to
 * straddle a chunk boundary is not split — its whole ribbon goes to the chunk
 * containing its midpoint. That is an acceptable phase-2a simplification: it
 * only affects culling precision at the edges of very long arterials, never
 * correctness, and Phase 2b's real geometry pass is the natural place to
 * split spans across chunk boundaries properly.
 */

import * as THREE from 'three';
import { WORLD, PALETTE } from '../Config.js';
import { Random } from '../utils/Random.js';
import { RoadNetwork } from './RoadNetwork.js';

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

    /** @type {RoadNetwork} the graph and every query over it — see RoadNetwork.js */
    this.network = new RoadNetwork({ seed });

    /** @type {THREE.Group} everything this track added to the scene */
    this.group = new THREE.Group();
    this.group.name = 'track';

    /** @type {THREE.Material|null} shared by every road chunk mesh */
    this._roadMaterial = null;
  }

  /**
   * Generate the network and its geometry, and add it to the scene.
   * Async so Phase 5 can await texture loads without changing the call site.
   * @param {THREE.Scene} scene
   */
  async build(scene) {
    this.network.generate();
    this._buildRoadMeshes();
    scene.add(this.group);
  }

  /**
   * Crude chunked road ribbons — see the file header for the exact geometry
   * and the deliberate phase-2a simplifications (no lane markings, no
   * intersection fill, edges not split across chunk boundaries).
   */
  _buildRoadMeshes() {
    this._roadMaterial = new THREE.MeshStandardMaterial({
      color: PALETTE.asphalt,
      roughness: 0.35,
      metalness: 0.55,
    });

    const chunkSize = WORLD.chunkSize;
    /** @type {Map<string, {positions: number[], indices: number[]}>} */
    const chunks = new Map();

    for (const edge of this.network.edges) {
      const samples = edge.samples;
      const tangents = edge.tangents;
      const halfWidth = edge.width / 2;

      const mid = samples[Math.floor(samples.length / 2)];
      const chunkKey = `${Math.floor(mid.x / chunkSize)}_${Math.floor(mid.z / chunkSize)}`;
      let chunk = chunks.get(chunkKey);
      if (!chunk) {
        chunk = { positions: [], indices: [] };
        chunks.set(chunkKey, chunk);
      }

      const baseIndex = chunk.positions.length / 3;
      for (let i = 0; i < samples.length; i++) {
        const p = samples[i];
        const t = tangents[i];
        // side = normalize(cross(tangent, UP)); cross(T, (0,1,0)) = (-T.z, 0, T.x).
        const sideX = -t.z;
        const sideZ = t.x;
        const sideLen = Math.hypot(sideX, sideZ) || 1;
        const sx = (sideX / sideLen) * halfWidth;
        const sz = (sideZ / sideLen) * halfWidth;
        // Left vertex first, then right — a0/a1 below assumes this order.
        chunk.positions.push(p.x - sx, p.y, p.z - sz, p.x + sx, p.y, p.z + sz);
      }

      // Winding: (a0, a1, b0) then (a1, b1, b0) — derived by hand for a
      // tangent of (0,0,-1) (side = +X, so a0=left=-X, a1=right=+X, and the
      // next sample is further -Z): cross(a1-a0, b0-a0) = (0, +2·halfWidth·Δz
      // sign works out to +Y) confirms this winding faces up, not down.
      for (let i = 0; i < samples.length - 1; i++) {
        const a0 = baseIndex + i * 2;
        const a1 = a0 + 1;
        const b0 = a0 + 2;
        const b1 = a0 + 3;
        chunk.indices.push(a0, a1, b0, a1, b1, b0);
      }
    }

    for (const [key, chunk] of chunks) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(chunk.positions, 3));
      geometry.setIndex(chunk.indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, this._roadMaterial);
      mesh.name = `road-chunk-${key}`;
      this.group.add(mesh);
    }
  }

  /**
   * Nearest-point query against the road network. Called for every car every
   * fixed step, so it MUST be O(1) and allocation-free. Delegates straight to
   * RoadNetwork, which owns the graph, the spatial index and the scratch
   * object actually being returned — see RoadNetwork.sampleAt().
   *
   * @param {THREE.Vector3} position
   * @param {RoadPosition} [hint] this car's road position last step. Safe to
   *   pass null on the first call.
   * @returns {TrackSample} a REUSED object — copy any field you need to keep
   */
  sampleAt(position, hint) {
    return this.network.sampleAt(position, hint);
  }

  /**
   * Position and orientation at a road position. Used to place the player at
   * the start, respawn after a bust, and spawn cops and roadblocks. Delegates
   * to RoadNetwork.getPose() — see RoadNetwork.js.
   *
   * @param {RoadPosition} road
   * @param {number} [lateralOffset] metres right of centre
   * @returns {{ position: THREE.Vector3, heading: number }} a REUSED object
   */
  getPose(road, lateralOffset = 0) {
    return this.network.getPose(road, lateralOffset);
  }

  /**
   * The player's default start position — a fixed, hand-picked spot in the
   * city, not a random one, because it doubles as the respawn point and as the
   * place screenshots and lap times are anchored to. Delegates to
   * RoadNetwork.getSpawn().
   * @returns {RoadPosition}
   */
  getSpawn() {
    return this.network.getSpawn();
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
