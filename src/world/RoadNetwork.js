/**
 * RoadNetwork.js — the road GRAPH and every query over it.
 * STUB: see TODO(phase-2a). This is the data structure the open world rests on.
 *
 * `Track.js` owns geometry and the scene graph. This file owns the graph
 * itself: nodes, edges, the spatial index, and routing. Nothing here imports
 * from Track, and nothing here creates a Material or touches the scene — that
 * separation is what lets the network be generated and tested with no WebGL
 * context at all, which matters because it is the hardest part to get right.
 *
 * ── THE SHAPE OF THE DATA ─────────────────────────────────────────────────────
 *
 *   Node   { id, position: Vector3, edges: number[] }
 *            An intersection. `edges` lists incident edge ids, in no
 *            particular order.
 *
 *   Edge   { id, nodeA, nodeB, curve, length, samples, tangents, width,
 *            isArterial }
 *            A street between two nodes. `curve` is a CatmullRomCurve3.
 *            `samples` and `tangents` are ARC-LENGTH-EVEN, one every
 *            WORLD.sampleSpacing metres, so index × sampleSpacing ≈ metres
 *            along the edge. `length` is the true arc length.
 *
 *   RoadPosition { edgeId, s }
 *            An OPAQUE handle: an edge, and metres along it from nodeA.
 *            Never compare or subtract two of them — see §5 of CLAUDE.md.
 *            `s` runs 0..edge.length, always measured from nodeA, so
 *            direction of travel is a separate concern from position.
 *
 * ── DETERMINISM ───────────────────────────────────────────────────────────────
 * Everything here is seeded from `WORLD.seed` through utils/Random.js.
 * **Never call Math.random().** The whole design rests on every player driving
 * the same permanent city (pillar 5), and one stray Math.random() in worldgen
 * silently breaks that for everyone, undetectably, until someone compares two
 * machines. If you need a second stream of randomness, construct a second
 * `Random` with a derived seed — do not interleave draws from one.
 */

import * as THREE from 'three';
import { WORLD } from '../Config.js';
import { Random } from '../utils/Random.js';

/**
 * @typedef {object} RoadPosition
 * @property {number} edgeId
 * @property {number} s metres along that edge, measured from its nodeA
 */

/**
 * @typedef {object} RoadSample
 * @property {RoadPosition} road
 * @property {number}  distanceFromCentre signed metres; negative = left of centre
 * @property {boolean} onRoad             |distanceFromCentre| < edge.width / 2
 * @property {number}  surfaceY           road height here, metres
 * @property {THREE.Vector3} tangent      unit direction of the road, nodeA→nodeB
 * @property {THREE.Vector3} centre       closest point on the centreline
 */

export class RoadNetwork {
  /** @param {{ seed?: number }} [options] */
  constructor({ seed = WORLD.seed } = {}) {
    this.seed = seed;
    this.random = new Random(seed);

    /** @type {{id: number, position: THREE.Vector3, edges: number[]}[]} */
    this.nodes = [];
    /** @type {object[]} see the Edge shape in the header */
    this.edges = [];

    /**
     * Spatial index: cell key → candidate edge ids. Built once at generate()
     * time. This is what makes sampleAt() O(1) instead of O(edges).
     * @type {Map<number, number[]>}
     */
    this._grid = new Map();

    /**
     * Route cache, keyed by "fromEdge:toEdge". The graph is small and static,
     * so a route computed once stays valid forever. Cops must never run a
     * fresh search per frame.
     * @type {Map<string, number[]>}
     */
    this._routeCache = new Map();

    /**
     * Scratch objects. sampleAt() and getPose() run once per car per fixed
     * step — for the player, eight cops and up to thirty traffic cars — so
     * they must return these rather than allocate. Callers copy what they keep.
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

  // ---------------------------------------------------------------------------
  // Generation
  // ---------------------------------------------------------------------------

  /**
   * Build the graph. Deterministic for a given seed. Called once at load.
   *
   * ORDER (see CLAUDE.md §7.2):
   *  1. Lay intersection nodes on a WORLD.blockSize grid across WORLD.extent,
   *     each jittered by up to WORLD.blockJitter. A perturbed grid is chosen
   *     deliberately: grids give the player legible structure to memorise,
   *     which is what pillar 5 needs.
   *  2. Connect each node to its grid neighbours (N/E is enough — doing all
   *     four directions creates every edge twice).
   *  3. Add WORLD.arterialCount long diagonal/straight arterials across the
   *     grid, wider (WORLD.arterialWidth) and connecting distant nodes. These
   *     are what create shortcut decisions and make route knowledge pay off.
   *  4. Prune: drop edges shorter than WORLD.minEdgeLength, and edges meeting
   *     at a junction more sharply than WORLD.minJunctionAngle. Both make
   *     undrivable geometry.
   *  5. **Verify the graph is fully connected** and drop any orphaned
   *     component. A node the player can reach but cops cannot route to is a
   *     bug that will surface much later as "the AI gave up", and it is far
   *     cheaper to catch here — assert it in a test, not just at runtime.
   *  6. Build one CatmullRomCurve3 per edge, with node tangents aligned so
   *     streets meet smoothly instead of kinking at intersections.
   *  7. Sample each curve with getSpacedPoints() — NOT getPoints(), which
   *     bunches samples on curves and makes `s` stop meaning metres.
   *  8. Build the spatial index.
   */
  generate() {
    // TODO(phase-2a)
    this.random.reset();
  }

  // ---------------------------------------------------------------------------
  // Queries — the hot path
  // ---------------------------------------------------------------------------

  /**
   * Nearest point on the network. **O(1) and allocation-free**: mutate and
   * return `this._scratchSample`.
   *
   * Strategy, in order — the first two should hit almost always:
   *  1. If `hint` is given, test that edge. A car is nearly always still on
   *     the edge it was on last step.
   *  2. Test the edges incident to the hinted edge's two nodes. That covers
   *     driving through an intersection.
   *  3. Fall back to the spatial grid cell(s) overlapping `position`. Only a
   *     respawn or a teleport should reach here.
   *
   * @param {THREE.Vector3} position
   * @param {RoadPosition|null} [hint] this car's road position last step
   * @returns {RoadSample} a REUSED object — copy any field you keep
   */
  sampleAt(position, hint) {
    // TODO(phase-2a)
    void position;
    void hint;
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
   * The inverse of sampleAt: where is this road position in the world?
   *
   * @param {RoadPosition} road
   * @param {number} [lateralOffset] metres right of the centreline
   * @returns {{position: THREE.Vector3, heading: number}} a REUSED object
   */
  getPose(road, lateralOffset = 0) {
    // TODO(phase-2a)
    void road;
    void lateralOffset;
    this._scratchPose.position.set(0, 0, 0);
    this._scratchPose.heading = 0;
    return this._scratchPose;
  }

  /**
   * The player's fixed start point — hand-picked, not random, because it also
   * serves as the respawn point and anchors screenshots and lap times.
   * Returns a FRESH object; this is not on the hot path.
   * @returns {RoadPosition}
   */
  getSpawn() {
    // TODO(phase-2a)
    return { edgeId: 0, s: 0 };
  }

  /** Arc length of an edge, metres. */
  edgeLength(edgeId) {
    return this.edges[edgeId]?.length ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  /**
   * Shortest path as a list of edge ids, inclusive of both endpoints' edges.
   * A* over the node graph with a straight-line heuristic; the graph is ~225
   * nodes so this is cheap, but it still must not run per frame — results are
   * cached in `_routeCache` and the cache never needs invalidating because the
   * city is static.
   *
   * @param {RoadPosition} fromRoad
   * @param {RoadPosition} toRoad
   * @returns {number[]} edge ids, or an empty array if genuinely unreachable
   */
  route(fromRoad, toRoad) {
    // TODO(phase-2a)
    void fromRoad;
    void toRoad;
    return [];
  }

  /**
   * Signed metres from `a` to `b` measured ALONG `route`. Positive means `b`
   * is further along. This replaces the old closed-loop `loopDelta()`, and it
   * is what lets the chase tell "the cop is 40 m behind me" from "the cop is
   * 900 m away on a parallel street" — straight-line distance conflates those
   * two and makes rubber-banding behave bizarrely at junctions.
   *
   * Returns null if either position is not on the route.
   *
   * @param {number[]} route
   * @param {RoadPosition} a
   * @param {RoadPosition} b
   * @returns {number|null}
   */
  gapAlongRoute(route, a, b) {
    // TODO(phase-2a)
    void route;
    void a;
    void b;
    return null;
  }

  /**
   * Edges a car at `road` travelling toward `heading` will plausibly reach
   * within `distance` metres. Used to spawn roadblocks ahead of the player and
   * to decide where traffic may appear.
   *
   * Breadth-first from the current edge, following only connections that do
   * not require a U-turn — a roadblock spawned on the street behind the player
   * is wasted.
   *
   * @param {RoadPosition} road
   * @param {number} heading radians
   * @param {number} distance metres
   * @returns {number[]} edge ids
   */
  edgesAhead(road, heading, distance) {
    // TODO(phase-2a)
    void road;
    void heading;
    void distance;
    return [];
  }

  // ---------------------------------------------------------------------------
  // Debug
  // ---------------------------------------------------------------------------

  /**
   * Build the `?network` overlay: edge centrelines, intersection markers, and
   * the spawn point. Debug-only, so line primitives are acceptable here even
   * though CLAUDE.md §12 forbids building real visuals on them.
   *
   * @returns {THREE.Object3D}
   */
  buildDebugOverlay() {
    // TODO(phase-2a)
    return new THREE.Group();
  }

  /** Rough stats for the debug overlay and for tests to assert against. */
  getStats() {
    return {
      nodes: this.nodes.length,
      edges: this.edges.length,
      totalRoadLength: this.edges.reduce((sum, e) => sum + (e.length ?? 0), 0),
      seed: this.seed,
      generatorVersion: WORLD.generatorVersion,
    };
  }
}
