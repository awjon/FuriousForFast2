/**
 * RoadNetwork.js — the road GRAPH and every query over it. IMPLEMENTED phase-2a.
 *
 * `Track.js` owns geometry and the scene graph. This file owns the graph
 * itself: nodes, edges, the spatial index, and routing. Nothing here imports
 * from Track, and nothing here creates a Material or touches the scene — that
 * separation is what lets the network be generated and tested with no WebGL
 * context at all, which matters because it is the hardest part to get right.
 * `buildDebugOverlay()` is the one exception: it is allowed to build Three.js
 * scene objects because it exists purely to visualise the graph behind
 * `?network` and is never on a code path a Node test exercises.
 *
 * ── THE SHAPE OF THE DATA ─────────────────────────────────────────────────────
 *
 *   Node   { id, position: Vector3, edges: number[] }
 *            An intersection. `edges` lists incident edge ids, in no
 *            particular order.
 *
 *   Edge   { id, nodeA, nodeB, curve, length, samples, tangents, sampleArc,
 *            width, isArterial }
 *            A street between two nodes. `curve` is a CatmullRomCurve3.
 *            `samples` and `tangents` are ARC-LENGTH-EVEN (one every
 *            WORLD.sampleSpacing metres via getSpacedPoints()), and
 *            `sampleArc[i]` is the exact cumulative arc length at sample i, so
 *            `s` can be converted to/from a sample index without walking the
 *            whole edge. `length` is the true arc length (sampleArc's last
 *            entry), not the curve's own estimate.
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
 * machines. Random draws happen in a single, fixed order every run (nodes row
 * by row, then arterial candidate pairs), which is what makes the graph
 * byte-identical for a given seed.
 *
 * ── A DELIBERATE SIMPLIFICATION: EVERY EDGE IS A STRAIGHT LINE ────────────────
 * Each edge's CatmullRomCurve3 is built from exactly the two node positions.
 * With only two control points the curve degenerates to a straight segment —
 * there is no attempt at the tangent-blended, curved-through-the-node geometry
 * CLAUDE.md's generation notes describe. This keeps the graph and every query
 * over it (sampleAt, getPose, routing) simple and exactly correct, and is
 * explicitly allowed by the phase-2a brief ("geometry can stay crude — Phase
 * 2b makes it look like a city"). Phase 2b, which owns intersection polygons
 * and the visual smoothing, is the right place to revisit this.
 *
 * ── SAMPLEAT() HOT-PATH BUDGET ─────────────────────────────────────────────────
 * The hinted path (hint edge + the edges incident to its two nodes) is a fixed,
 * small, bounded set — independent of total node/edge count — and allocates
 * nothing. It hits on effectively every call in real play, because every car's
 * `roadHint` is always kept valid by Physics.js/Car.placeOnTrack(). The grid
 * fallback (teleport, respawn without a hint, or the very first call before a
 * hint exists) is not on that hot path and is allowed to differ slightly —
 * see `_sampleFromGrid()`.
 */

import * as THREE from 'three';
import { WORLD, PALETTE } from '../Config.js';
import { Random } from '../utils/Random.js';
import { clamp } from '../utils/MathUtils.js';

/**
 * Spatial grid cells are keyed by a single packed integer, not a string —
 * `sampleAt()` computes one every call, and a template-literal string key
 * would allocate on every call it's on. The offset just needs to keep
 * (cell + offset) non-negative for any cell the 2 km city (plus the fallback
 * search's radius-6 expansion) can reach; 8192 cells × a 40 m cell size is
 * ~328 km of headroom either side of the origin.
 */
const GRID_KEY_OFFSET = 8192;
const GRID_KEY_SPAN = GRID_KEY_OFFSET * 2;
const cellKey = (cx, cz) => (cx + GRID_KEY_OFFSET) * GRID_KEY_SPAN + (cz + GRID_KEY_OFFSET);

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
     * @type {Map<string, number[]>}
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
     * A* node-to-node path cache, keyed by "startNode:goalNode". route() tries
     * up to four node-pair combinations (either end of the from-edge to either
     * end of the to-edge) per call; this is what stops that from re-running
     * A* redundantly, both within one route() call and across many.
     * @type {Map<string, number[]|null>}
     */
    this._nodePathCache = new Map();

    /** @type {Map<string, number>} "nodeA_nodeB" (both orders) → edge id */
    this._nodePairToEdge = new Map();

    /** The hand-picked, fixed spawn point. Set at the end of generate(). */
    this._spawn = { edgeId: 0, s: 0 };

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

    /**
     * Scratch used internally by sampleAt()'s per-edge evaluation. Flat and
     * numeric-only (no Vector3s) so a single object can be freely overwritten
     * every candidate edge test without allocating.
     */
    this._candidate = {
      edgeId: 0,
      s: 0,
      distanceFromCentre: 0,
      onRoad: true,
      surfaceY: 0,
      tangentX: 0,
      tangentY: 0,
      tangentZ: -1,
      centreX: 0,
      centreZ: 0,
    };

    /** Scratch used by getPose()'s edge-position lookup. */
    this._locateScratch = { index: 0, localT: 0 };
  }

  // ---------------------------------------------------------------------------
  // Generation
  // ---------------------------------------------------------------------------

  /**
   * Build the graph. Deterministic for a given seed. Called once at load.
   * See the file header for the order and the straight-edge simplification.
   */
  generate() {
    this.random.reset();
    this._routeCache.clear();
    this._nodePathCache.clear();
    this._grid.clear();

    const count = Math.round(WORLD.extent / WORLD.blockSize) + 1;
    const half = (count - 1) / 2;
    const nodeIndex = (row, col) => row * count + col;

    // 1. Perturbed grid of intersection nodes.
    const rawNodes = [];
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        const x = (col - half) * WORLD.blockSize + this.random.signed(WORLD.blockJitter);
        const z = (row - half) * WORLD.blockSize + this.random.signed(WORLD.blockJitter);
        const y = this.random.range(0, WORLD.elevationRange);
        rawNodes.push({ position: new THREE.Vector3(x, y, z), edges: [] });
      }
    }

    // 2. Grid edges — N/E neighbours only, so each edge is created once.
    const rawEdges = [];
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        const a = nodeIndex(row, col);
        if (col + 1 < count) {
          rawEdges.push({ nodeA: a, nodeB: nodeIndex(row, col + 1), isArterial: false });
        }
        if (row + 1 < count) {
          rawEdges.push({ nodeA: a, nodeB: nodeIndex(row + 1, col), isArterial: false });
        }
      }
    }

    // 3. Arterials — long diagonal/straight shortcuts across the grid. Picked
    // by grid (row,col) distance, not world distance, so the choice is stable
    // regardless of jitter and always spans a genuinely long stretch.
    const minGridDist = Math.max(3, Math.floor((count - 1) * 0.55));
    const seenPairs = new Set();
    let arterialsAdded = 0;
    let attempts = 0;
    while (arterialsAdded < WORLD.arterialCount && attempts < 2000) {
      attempts++;
      const aRow = this.random.int(0, count - 1);
      const aCol = this.random.int(0, count - 1);
      const bRow = this.random.int(0, count - 1);
      const bCol = this.random.int(0, count - 1);
      const gridDist = Math.max(Math.abs(aRow - bRow), Math.abs(aCol - bCol));
      if (gridDist < minGridDist) continue;
      const nodeA = nodeIndex(aRow, aCol);
      const nodeB = nodeIndex(bRow, bCol);
      if (nodeA === nodeB) continue;
      const key = nodeA < nodeB ? `${nodeA}:${nodeB}` : `${nodeB}:${nodeA}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      rawEdges.push({ nodeA, nodeB, isArterial: true });
      arterialsAdded++;
    }

    for (let i = 0; i < rawEdges.length; i++) rawEdges[i].tempId = i;

    const lengthOf = (e) => rawNodes[e.nodeA].position.distanceTo(rawNodes[e.nodeB].position);

    const rebuildAdjacency = (edgeList) => {
      for (const n of rawNodes) n.edges = [];
      for (const e of edgeList) {
        rawNodes[e.nodeA].edges.push(e.tempId);
        rawNodes[e.nodeB].edges.push(e.tempId);
      }
    };

    // 4. Prune edges too short to be drivable.
    let survivingEdges = rawEdges.filter((e) => lengthOf(e) >= WORLD.minEdgeLength);
    rebuildAdjacency(survivingEdges);

    // 4b. Prune junctions meeting more sharply than WORLD.minJunctionAngle.
    // Single pass over the post-length-prune snapshot: collect everything to
    // remove, then remove it all at once, so removing one edge in a violating
    // pair cannot change which edges a later pair in the same node sees.
    let tempIdToEdge = new Map(survivingEdges.map((e) => [e.tempId, e]));
    const dirFromNode = (edge, fromNode) => {
      const otherId = edge.nodeA === fromNode ? edge.nodeB : edge.nodeA;
      const from = rawNodes[fromNode].position;
      const other = rawNodes[otherId].position;
      const dx = other.x - from.x;
      const dz = other.z - from.z;
      const len = Math.hypot(dx, dz) || 1;
      return { x: dx / len, z: dz / len };
    };

    const toRemove = new Set();
    for (let nodeId = 0; nodeId < rawNodes.length; nodeId++) {
      const incident = rawNodes[nodeId].edges;
      for (let i = 0; i < incident.length; i++) {
        for (let j = i + 1; j < incident.length; j++) {
          const idI = incident[i];
          const idJ = incident[j];
          if (toRemove.has(idI) || toRemove.has(idJ)) continue;
          const edgeI = tempIdToEdge.get(idI);
          const edgeJ = tempIdToEdge.get(idJ);
          const dirI = dirFromNode(edgeI, nodeId);
          const dirJ = dirFromNode(edgeJ, nodeId);
          const dot = Math.max(-1, Math.min(1, dirI.x * dirJ.x + dirI.z * dirJ.z));
          const angle = Math.acos(dot);
          if (angle < WORLD.minJunctionAngle) {
            // Prefer to keep an arterial over a grid street, and otherwise
            // keep the longer of the two — both reduce how much connectivity
            // a single sharp junction costs the graph.
            if (edgeI.isArterial && !edgeJ.isArterial) toRemove.add(idJ);
            else if (edgeJ.isArterial && !edgeI.isArterial) toRemove.add(idI);
            else toRemove.add(lengthOf(edgeI) < lengthOf(edgeJ) ? idI : idJ);
          }
        }
      }
    }
    survivingEdges = survivingEdges.filter((e) => !toRemove.has(e.tempId));
    rebuildAdjacency(survivingEdges);

    // 5. Verify the graph is fully connected; keep only the largest component.
    tempIdToEdge = new Map(survivingEdges.map((e) => [e.tempId, e]));
    const visited = new Array(rawNodes.length).fill(false);
    let largestComponent = [];
    for (let start = 0; start < rawNodes.length; start++) {
      if (visited[start]) continue;
      const component = [];
      const queue = [start];
      visited[start] = true;
      let qi = 0;
      while (qi < queue.length) {
        const current = queue[qi++];
        component.push(current);
        for (const edgeId of rawNodes[current].edges) {
          const edge = tempIdToEdge.get(edgeId);
          const other = edge.nodeA === current ? edge.nodeB : edge.nodeA;
          if (!visited[other]) {
            visited[other] = true;
            queue.push(other);
          }
        }
      }
      if (component.length > largestComponent.length) largestComponent = component;
    }
    const keepNodes = new Set(largestComponent);
    survivingEdges = survivingEdges.filter((e) => keepNodes.has(e.nodeA) && keepNodes.has(e.nodeB));

    // 6. Reindex nodes and edges contiguously from 0.
    const sortedNodeIds = [...keepNodes].sort((a, b) => a - b);
    const oldToNewNode = new Map();
    this.nodes = sortedNodeIds.map((oldId, newId) => {
      oldToNewNode.set(oldId, newId);
      return { id: newId, position: rawNodes[oldId].position, edges: [] };
    });

    this.edges = survivingEdges.map((e, newId) => ({
      id: newId,
      nodeA: oldToNewNode.get(e.nodeA),
      nodeB: oldToNewNode.get(e.nodeB),
      isArterial: e.isArterial,
    }));
    for (const edge of this.edges) {
      this.nodes[edge.nodeA].edges.push(edge.id);
      this.nodes[edge.nodeB].edges.push(edge.id);
    }

    // 7. Build one CatmullRomCurve3 per edge (two control points — a straight
    // line, see the header's "deliberate simplification" note) and sample it
    // arc-length-even via getSpacedPoints(), never getPoints().
    for (const edge of this.edges) {
      const a = this.nodes[edge.nodeA].position;
      const b = this.nodes[edge.nodeB].position;
      const curve = new THREE.CatmullRomCurve3([a.clone(), b.clone()], false, 'catmullrom', 0.5);
      const straightLength = a.distanceTo(b);
      const sampleCount = Math.max(1, Math.round(straightLength / WORLD.sampleSpacing));
      const points = curve.getSpacedPoints(sampleCount);
      const tangents = new Array(points.length);
      for (let i = 0; i < points.length; i++) tangents[i] = curve.getTangentAt(i / sampleCount);

      const sampleArc = new Array(points.length);
      sampleArc[0] = 0;
      for (let i = 1; i < points.length; i++) {
        sampleArc[i] = sampleArc[i - 1] + points[i - 1].distanceTo(points[i]);
      }

      edge.curve = curve;
      edge.samples = points;
      edge.tangents = tangents;
      edge.sampleArc = sampleArc;
      edge.length = sampleArc[sampleArc.length - 1];
      edge.width = edge.isArterial ? WORLD.arterialWidth : WORLD.roadWidth;
    }

    this._buildNodePairIndex();
    this._buildSpatialIndex();
    this._chooseSpawn();
  }

  _buildNodePairIndex() {
    this._nodePairToEdge.clear();
    for (const edge of this.edges) {
      this._nodePairToEdge.set(`${edge.nodeA}_${edge.nodeB}`, edge.id);
      this._nodePairToEdge.set(`${edge.nodeB}_${edge.nodeA}`, edge.id);
    }
  }

  /** Edge connecting two adjacent node ids, or null if they are not adjacent. */
  _edgeBetween(a, b) {
    const id = this._nodePairToEdge.get(`${a}_${b}`);
    return id === undefined ? null : this.edges[id];
  }

  _buildSpatialIndex() {
    this._grid.clear();
    const cellSize = WORLD.spatialCellSize;
    for (const edge of this.edges) {
      const seen = new Set();
      for (const p of edge.samples) {
        const cx = Math.floor(p.x / cellSize);
        const cz = Math.floor(p.z / cellSize);
        // Register into the 3x3 neighbourhood of every sample's cell, not
        // just the sample's own cell — cheap at generate time, and it means a
        // query near a cell boundary still finds edges whose samples landed
        // just across it.
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const key = cellKey(cx + dx, cz + dz);
            if (seen.has(key)) continue;
            seen.add(key);
            let list = this._grid.get(key);
            if (!list) {
              list = [];
              this._grid.set(key, list);
            }
            list.push(edge.id);
          }
        }
      }
    }
  }

  /** The player's fixed start point: the arterial nearest the origin, midway along it. */
  _chooseSpawn() {
    let best = this.edges[0];
    let bestDistSq = Infinity;
    for (const edge of this.edges) {
      if (!edge.isArterial) continue;
      const mid = edge.samples[Math.floor(edge.samples.length / 2)];
      const distSq = mid.x * mid.x + mid.z * mid.z;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = edge;
      }
    }
    this._spawn = { edgeId: best ? best.id : 0, s: best ? best.length / 2 : 0 };
  }

  // ---------------------------------------------------------------------------
  // Queries — the hot path
  // ---------------------------------------------------------------------------

  /**
   * Evaluate one edge against `position`, writing the winning fields into
   * `this._candidate` (flat/numeric, zero allocation) and — if it beats
   * `bestDistSq` — copying them into `sample`. Returns the new best distance².
   * A plain method (not a closure captured per-call) so calling it costs
   * nothing beyond the call itself.
   */
  _tryEdge(sample, edgeId, position, bestDistSq) {
    const edge = this.edges[edgeId];
    if (!edge) return bestDistSq;
    const samples = edge.samples;

    let localBestDistSq = Infinity;
    let bestIndex = 0;
    let bestT = 0;
    let bestCx = 0;
    let bestCz = 0;

    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const apx = position.x - a.x;
      const apz = position.z - a.z;
      const abLenSq = abx * abx + abz * abz;
      let t = abLenSq > 1e-8 ? (apx * abx + apz * abz) / abLenSq : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const cx = a.x + abx * t;
      const cz = a.z + abz * t;
      const dx = position.x - cx;
      const dz = position.z - cz;
      const distSq = dx * dx + dz * dz;
      if (distSq < localBestDistSq) {
        localBestDistSq = distSq;
        bestIndex = i;
        bestT = t;
        bestCx = cx;
        bestCz = cz;
      }
    }

    if (localBestDistSq >= bestDistSq) return bestDistSq;

    const arc = edge.sampleArc;
    const a = samples[bestIndex];
    const b = samples[bestIndex + 1];
    const tangent = edge.tangents[bestIndex];

    const candidate = this._candidate;
    candidate.edgeId = edge.id;
    candidate.s = arc[bestIndex] + (arc[bestIndex + 1] - arc[bestIndex]) * bestT;
    candidate.surfaceY = a.y + (b.y - a.y) * bestT;
    candidate.tangentX = tangent.x;
    candidate.tangentY = tangent.y;
    candidate.tangentZ = tangent.z;

    // right = normalize(cross(tangent, UP)) = (-tangent.z, 0, tangent.x); only
    // its sign is needed here, so skip the normalize.
    const rightX = -tangent.z;
    const rightZ = tangent.x;
    const dx = position.x - bestCx;
    const dz = position.z - bestCz;
    const sign = dx * rightX + dz * rightZ >= 0 ? 1 : -1;
    const distance = Math.sqrt(localBestDistSq);
    candidate.distanceFromCentre = sign * distance;
    candidate.onRoad = distance < edge.width / 2;
    candidate.centreX = bestCx;
    candidate.centreZ = bestCz;

    sample.road.edgeId = candidate.edgeId;
    sample.road.s = candidate.s;
    sample.distanceFromCentre = candidate.distanceFromCentre;
    sample.onRoad = candidate.onRoad;
    sample.surfaceY = candidate.surfaceY;
    sample.tangent.set(candidate.tangentX, candidate.tangentY, candidate.tangentZ);
    sample.centre.set(candidate.centreX, candidate.surfaceY, candidate.centreZ);

    return localBestDistSq;
  }

  /**
   * Nearest point on the network. **O(1) and allocation-free**: mutates and
   * returns `this._scratchSample`.
   *
   * Two candidate sets are tried, and the best result across BOTH wins:
   *  1. `hint`'s own edge plus the edges incident to its two nodes. A car is
   *     nearly always still on the edge it was on last step, or has just
   *     crossed into one that shares a node with it, so this is normally
   *     where the answer comes from.
   *  2. The spatial-grid cells actually covering `position` (a fixed 3×3
   *     neighbourhood — still O(1), independent of the total edge count).
   *
   * Checking (2) unconditionally, rather than only when the hint looks
   * "far enough" from `position`, matters: a hint's own neighbourhood can
   * easily contain a point that is merely *plausible* (within a block) for
   * a position that actually has a genuinely closer edge somewhere else
   * entirely — a stale hint after a bug, or a cop that got reset without its
   * hint being updated. Trusting "close enough" without ever checking what is
   * truly local to `position` would silently return that wrong edge. The
   * position's own grid cells always contain whatever is really nearby,
   * independent of anything the hint claims, so cross-checking against them
   * is what actually earns the "the hint is usually right" shortcut its
   * O(1) claim rather than merely hoping for it.
   *
   * Only when NEITHER set finds anything at all (position is nowhere near
   * the generated city — off the map, or no hint and an unlucky first call)
   * does this fall back to an expanding grid search and, as an absolute last
   * resort, a full scan of every edge.
   *
   * @param {THREE.Vector3} position
   * @param {RoadPosition|null} [hint] this car's road position last step
   * @returns {RoadSample} a REUSED object — copy any field you keep
   */
  sampleAt(position, hint) {
    const sample = this._scratchSample;
    if (this.edges.length === 0) return sample;

    let bestDistSq = Infinity;

    if (hint) {
      const hintEdge = this.edges[hint.edgeId];
      if (hintEdge) {
        bestDistSq = this._tryEdge(sample, hintEdge.id, position, bestDistSq);
        const nodeA = this.nodes[hintEdge.nodeA];
        for (let i = 0; i < nodeA.edges.length; i++) {
          const eid = nodeA.edges[i];
          if (eid !== hintEdge.id) bestDistSq = this._tryEdge(sample, eid, position, bestDistSq);
        }
        const nodeB = this.nodes[hintEdge.nodeB];
        for (let i = 0; i < nodeB.edges.length; i++) {
          const eid = nodeB.edges[i];
          if (eid !== hintEdge.id) bestDistSq = this._tryEdge(sample, eid, position, bestDistSq);
        }
      }
    }

    bestDistSq = this._searchGridRadius(sample, position, bestDistSq, 1);

    if (bestDistSq === Infinity) {
      // Nothing within ~120m of position at all, and no usable hint either —
      // a genuine teleport, a respawn before any hint exists, or a position
      // off the edge of the generated city. Expand, then fall back to a full
      // scan; this path is never on the guaranteed-O(1) budget.
      bestDistSq = this._searchGridRadius(sample, position, bestDistSq, 6);
      if (bestDistSq === Infinity) {
        for (let i = 0; i < this.edges.length; i++) {
          bestDistSq = this._tryEdge(sample, this.edges[i].id, position, bestDistSq);
        }
      }
    }

    return sample;
  }

  _searchGridRadius(sample, position, bestDistSq, radius) {
    const cellSize = WORLD.spatialCellSize;
    const cx = Math.floor(position.x / cellSize);
    const cz = Math.floor(position.z / cellSize);
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const candidates = this._grid.get(cellKey(cx + dx, cz + dz));
        if (!candidates) continue;
        for (let i = 0; i < candidates.length; i++) {
          bestDistSq = this._tryEdge(sample, candidates[i], position, bestDistSq);
        }
      }
    }
    return bestDistSq;
  }

  /** Locate `s` on `edge`'s sample array. Reuses `this._locateScratch`. */
  _locateOnEdge(edge, s) {
    const arc = edge.sampleArc;
    let index = 0;
    for (let i = 0; i < arc.length - 1; i++) {
      index = i;
      if (s <= arc[i + 1]) break;
    }
    const segLen = arc[index + 1] - arc[index];
    const localT = segLen > 1e-6 ? (s - arc[index]) / segLen : 0;
    const out = this._locateScratch;
    out.index = index;
    out.localT = clamp(localT, 0, 1);
    return out;
  }

  /**
   * The inverse of sampleAt: where is this road position in the world?
   *
   * @param {RoadPosition} road
   * @param {number} [lateralOffset] metres right of the centreline
   * @returns {{position: THREE.Vector3, heading: number}} a REUSED object
   */
  getPose(road, lateralOffset = 0) {
    const pose = this._scratchPose;
    const edge = this.edges[road?.edgeId];
    if (!edge) {
      pose.position.set(0, 0, 0);
      pose.heading = 0;
      return pose;
    }

    const s = clamp(road.s, 0, edge.length);
    const { index, localT } = this._locateOnEdge(edge, s);
    const a = edge.samples[index];
    const b = edge.samples[index + 1];
    const tangent = edge.tangents[index];

    pose.position.set(
      a.x + (b.x - a.x) * localT,
      a.y + (b.y - a.y) * localT,
      a.z + (b.z - a.z) * localT
    );

    if (lateralOffset !== 0) {
      const rightX = -tangent.z;
      const rightZ = tangent.x;
      const rightLen = Math.hypot(rightX, rightZ) || 1;
      pose.position.x += (rightX / rightLen) * lateralOffset;
      pose.position.z += (rightZ / rightLen) * lateralOffset;
    }

    // forward = (-sin h, 0, -cos h) ⇒ h = atan2(-tangent.x, -tangent.z).
    pose.heading = Math.atan2(-tangent.x, -tangent.z);
    return pose;
  }

  /**
   * The player's fixed start point — hand-picked, not random, because it also
   * serves as the respawn point and anchors screenshots and lap times.
   * Returns a FRESH object; this is not on the hot path.
   * @returns {RoadPosition}
   */
  getSpawn() {
    return { edgeId: this._spawn.edgeId, s: this._spawn.s };
  }

  /** Arc length of an edge, metres. */
  edgeLength(edgeId) {
    return this.edges[edgeId]?.length ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  /**
   * A* over the node graph between two node ids, straight-line heuristic.
   * Cached permanently and forever (the graph is static): a cache hit is a
   * single Map lookup. `null` (unreachable) is cached too, so a bad query
   * never re-runs the search.
   */
  _aStarNodePath(startId, goalId) {
    const cacheKey = `${startId}:${goalId}`;
    if (this._nodePathCache.has(cacheKey)) return this._nodePathCache.get(cacheKey);

    if (startId === goalId) {
      const trivial = [startId];
      this._nodePathCache.set(cacheKey, trivial);
      return trivial;
    }

    const goalPos = this.nodes[goalId].position;
    const gScore = new Map([[startId, 0]]);
    const cameFrom = new Map();
    const fScore = new Map([[startId, this.nodes[startId].position.distanceTo(goalPos)]]);
    const open = new Set([startId]);

    while (open.size > 0) {
      let current = -1;
      let bestF = Infinity;
      for (const id of open) {
        const f = fScore.get(id) ?? Infinity;
        if (f < bestF) {
          bestF = f;
          current = id;
        }
      }

      if (current === goalId) {
        const path = [current];
        let cursor = current;
        while (cameFrom.has(cursor)) {
          cursor = cameFrom.get(cursor);
          path.unshift(cursor);
        }
        this._nodePathCache.set(cacheKey, path);
        return path;
      }

      open.delete(current);
      const node = this.nodes[current];
      for (const edgeId of node.edges) {
        const edge = this.edges[edgeId];
        const neighbor = edge.nodeA === current ? edge.nodeB : edge.nodeA;
        const tentativeG = (gScore.get(current) ?? Infinity) + edge.length;
        if (tentativeG < (gScore.get(neighbor) ?? Infinity)) {
          cameFrom.set(neighbor, current);
          gScore.set(neighbor, tentativeG);
          fScore.set(neighbor, tentativeG + this.nodes[neighbor].position.distanceTo(goalPos));
          open.add(neighbor);
        }
      }
    }

    this._nodePathCache.set(cacheKey, null);
    return null;
  }

  /**
   * Shortest path as a list of edge ids, inclusive of both endpoints' edges.
   * A* over the node graph with a straight-line heuristic; the graph is ~225
   * nodes so this is cheap, but it still must not run per frame — results are
   * cached in `_routeCache` and the cache never needs invalidating because the
   * city is static.
   *
   * A RoadPosition names a spot ON an edge, not a direction of travel, so this
   * tries both endpoints of the from-edge as the starting node and both
   * endpoints of the to-edge as the goal, and keeps whichever of the (up to)
   * four combinations gives the shortest total path — partial distance along
   * the from/to edges included.
   *
   * @param {RoadPosition} fromRoad
   * @param {RoadPosition} toRoad
   * @returns {number[]} edge ids, or an empty array if genuinely unreachable
   */
  route(fromRoad, toRoad) {
    if (!fromRoad || !toRoad) return [];
    if (!this.edges[fromRoad.edgeId] || !this.edges[toRoad.edgeId]) return [];

    const cacheKey = `${fromRoad.edgeId}:${toRoad.edgeId}`;
    const cached = this._routeCache.get(cacheKey);
    if (cached) return cached;

    if (fromRoad.edgeId === toRoad.edgeId) {
      const result = [fromRoad.edgeId];
      this._routeCache.set(cacheKey, result);
      return result;
    }

    const fromEdge = this.edges[fromRoad.edgeId];
    const toEdge = this.edges[toRoad.edgeId];

    let best = null;
    for (const startNode of [fromEdge.nodeA, fromEdge.nodeB]) {
      const entryCost = startNode === fromEdge.nodeA ? fromRoad.s : fromEdge.length - fromRoad.s;
      for (const goalNode of [toEdge.nodeA, toEdge.nodeB]) {
        const exitCost = goalNode === toEdge.nodeA ? toRoad.s : toEdge.length - toRoad.s;
        const nodePath = this._aStarNodePath(startNode, goalNode);
        if (!nodePath) continue;
        let midCost = 0;
        let valid = true;
        for (let i = 0; i < nodePath.length - 1; i++) {
          const edge = this._edgeBetween(nodePath[i], nodePath[i + 1]);
          if (!edge) {
            valid = false;
            break;
          }
          midCost += edge.length;
        }
        if (!valid) continue;
        const total = entryCost + midCost + exitCost;
        if (!best || total < best.total) best = { nodePath, total };
      }
    }

    if (!best) {
      this._routeCache.set(cacheKey, []);
      return [];
    }

    const result = [fromRoad.edgeId];
    for (let i = 0; i < best.nodePath.length - 1; i++) {
      const edge = this._edgeBetween(best.nodePath[i], best.nodePath[i + 1]);
      if (result[result.length - 1] !== edge.id) result.push(edge.id);
    }
    if (result[result.length - 1] !== toRoad.edgeId) result.push(toRoad.edgeId);

    this._routeCache.set(cacheKey, result);
    return result;
  }

  /** The node shared by two adjacent edges. */
  _sharedNode(edgeA, edgeB) {
    if (edgeA.nodeA === edgeB.nodeA || edgeA.nodeA === edgeB.nodeB) return edgeA.nodeA;
    return edgeA.nodeB;
  }

  /**
   * For each edge in `route`, which node the route ENTERS that edge from
   * (i.e. travel proceeds from this node toward the other). Needed to turn
   * each edge's nodeA-relative `s` into a distance travelled along the route.
   * Not cached: routes are short (a handful to a few dozen edges) and this is
   * only called from gapAlongRoute(), not the sampleAt()/getPose() hot path.
   */
  _routeEntryNodes(route) {
    const entry = new Array(route.length);
    for (let i = 0; i < route.length; i++) {
      const edge = this.edges[route[i]];
      if (i === 0) {
        if (route.length === 1) {
          entry[i] = edge.nodeA; // arbitrary — a single-edge route has no travel direction to infer
        } else {
          const nextEdge = this.edges[route[1]];
          const shared = this._sharedNode(edge, nextEdge);
          entry[i] = edge.nodeA === shared ? edge.nodeB : edge.nodeA;
        }
      } else {
        const prevEdge = this.edges[route[i - 1]];
        entry[i] = this._sharedNode(prevEdge, edge);
      }
    }
    return entry;
  }

  _offsetAlongRoute(route, entry, index, s) {
    let cumulative = 0;
    for (let i = 0; i < index; i++) cumulative += this.edges[route[i]].length;
    const edge = this.edges[route[index]];
    const distanceIntoEdge = entry[index] === edge.nodeA ? s : edge.length - s;
    return cumulative + distanceIntoEdge;
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
    if (!route || route.length === 0) return null;
    const indexA = route.indexOf(a.edgeId);
    const indexB = route.indexOf(b.edgeId);
    if (indexA === -1 || indexB === -1) return null;

    const entry = this._routeEntryNodes(route);
    const offsetA = this._offsetAlongRoute(route, entry, indexA, a.s);
    const offsetB = this._offsetAlongRoute(route, entry, indexB, b.s);
    return offsetB - offsetA;
  }

  /**
   * Edges a car at `road` travelling toward `heading` will plausibly reach
   * within `distance` metres. Used to spawn roadblocks ahead of the player and
   * to decide where traffic may appear.
   *
   * Breadth-first from the current edge, following only connections that do
   * not require a U-turn — a roadblock spawned on the street behind the player
   * is wasted. Includes the starting edge itself.
   *
   * @param {RoadPosition} road
   * @param {number} heading radians
   * @param {number} distance metres
   * @returns {number[]} edge ids
   */
  edgesAhead(road, heading, distance) {
    const edge = this.edges[road?.edgeId];
    if (!edge) return [];

    const dirX = -Math.sin(heading);
    const dirZ = -Math.cos(heading);
    const { index } = this._locateOnEdge(edge, clamp(road.s, 0, edge.length));
    const tangent = edge.tangents[index];
    const goingTowardB = tangent.x * dirX + tangent.z * dirZ >= 0;
    const aheadNode = goingTowardB ? edge.nodeB : edge.nodeA;
    const usedOnStart = goingTowardB ? edge.length - road.s : road.s;

    const result = [edge.id];
    const visited = new Set([edge.id]);
    const remainingStart = distance - usedOnStart;
    if (remainingStart <= 0) return result;

    const queue = [{ edgeId: edge.id, arrivalNode: aheadNode, remaining: remainingStart }];
    let qi = 0;
    while (qi < queue.length) {
      const current = queue[qi++];
      const node = this.nodes[current.arrivalNode];
      for (const candidateId of node.edges) {
        if (candidateId === current.edgeId) continue; // exclude the U-turn back the way we came
        if (visited.has(candidateId)) continue;
        visited.add(candidateId);
        result.push(candidateId);
        const candidate = this.edges[candidateId];
        const farNode = candidate.nodeA === current.arrivalNode ? candidate.nodeB : candidate.nodeA;
        const newRemaining = current.remaining - candidate.length;
        if (newRemaining > 0) {
          queue.push({ edgeId: candidateId, arrivalNode: farNode, remaining: newRemaining });
        }
      }
    }
    return result;
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
    const group = new THREE.Group();
    group.name = 'network-debug';

    const normalPositions = [];
    const arterialPositions = [];
    for (const edge of this.edges) {
      const target = edge.isArterial ? arterialPositions : normalPositions;
      for (let i = 0; i < edge.samples.length - 1; i++) {
        const a = edge.samples[i];
        const b = edge.samples[i + 1];
        target.push(a.x, a.y + 0.5, a.z, b.x, b.y + 0.5, b.z);
      }
    }

    const addLines = (positions, color) => {
      if (positions.length === 0) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({ color });
      group.add(new THREE.LineSegments(geometry, material));
    };
    addLines(normalPositions, PALETTE.cyan);
    addLines(arterialPositions, PALETTE.amber);

    const nodePositions = [];
    for (const node of this.nodes) {
      nodePositions.push(node.position.x, node.position.y + 0.6, node.position.z);
    }
    if (nodePositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(nodePositions, 3));
      const material = new THREE.PointsMaterial({
        color: PALETTE.magenta,
        size: 4,
        sizeAttenuation: false,
      });
      group.add(new THREE.Points(geometry, material));
    }

    const spawnPose = this.getPose(this.getSpawn());
    const spawnMarker = new THREE.Mesh(
      new THREE.SphereGeometry(3, 8, 8),
      new THREE.MeshBasicMaterial({ color: PALETTE.ink })
    );
    spawnMarker.position.set(spawnPose.position.x, spawnPose.position.y + 1.5, spawnPose.position.z);
    group.add(spawnMarker);

    return group;
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
