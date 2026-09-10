/**
 * Track.js — the drivable city. IMPLEMENTED phase-2b: dressed road geometry
 * (lane markings, kerbs, guardrails, intersection fill), streetlights and
 * buildings. Phase-2a's crude overlapping ribbons are gone.
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
 * chunked road meshes, plus everything Phase 2b dresses the city with.
 *
 * Consequences to respect:
 *  - There is no global lap parameter `t`. A position on the road is an opaque
 *    {@link RoadPosition} — an edge id plus metres along that edge. Treat it as
 *    a handle: pass it back to sampleAt() as a hint, hand it to getPose(), but
 *    never do arithmetic on it.
 *  - Cops need real route-finding across the graph, not a lookahead along one
 *    curve. See CLAUDE.md §7.4.
 *
 * ── ROAD MESH ─────────────────────────────────────────────────────────────────
 * Per edge, for each of its (already arc-length-even) samples i: point Pᵢ,
 * tangent Tᵢ (already computed by RoadNetwork), and side vector
 * Sᵢ = normalize(cross(Tᵢ, UP)). Emit two vertices at Pᵢ ± Sᵢ · (edge.width/2),
 * each carrying a UV (u = signed metres from the centreline, −halfWidth left
 * … +halfWidth right — NOT normalized 0..1, since road width varies per edge
 * and the lane shader's line width is a constant in metres; v = arc-length
 * metres / 8, CLAUDE.md §7.2 step 5) and a `laneMask` of 1, and index
 * consecutive sample pairs into two triangles each, wound so the face normal
 * points +Y.
 *
 * Every edge meets its neighbours at a node, so ribbons from different edges
 * still overlap right at the intersection — a filled disc is added on top
 * (`laneMask = 0`, so it never draws a dash) slightly raised so it always
 * wins the depth test there, which is what stops the z-fighting CLAUDE.md §12
 * calls out. Ribbons are cheaper to leave overlapping than to trim.
 *
 * ── LANE MARKINGS — the fwidth technique, reused from NeonGrid.js ────────────
 * The road material is a MeshStandardMaterial (the wet-asphalt look, §8)
 * extended via `onBeforeCompile`: a custom `laneMask` attribute and the UV
 * above feed a fragment function that measures distance-to-centreline and
 * dash-phase in screen-space pixels via `fwidth()`, exactly like
 * `NeonGrid.gridCoverage()`, and adds the result into `totalEmissiveRadiance`
 * so it blooms without needing its own light. One shared material, so this
 * costs nothing extra in draw calls.
 *
 * ── CHUNKING ──────────────────────────────────────────────────────────────────
 * Edge ribbons and intersection discs are grouped into `WORLD.chunkSize`-metre
 * chunks (by edge midpoint / node position) and merged into one BufferGeometry
 * per chunk, not one mesh for the city, so the road can be frustum-culled. An
 * edge or node straddling a chunk boundary is not split — an accepted
 * phase-2a simplification carried forward; it only affects culling precision
 * on long arterials, never correctness.
 *
 * Kerbs, guardrails and streetlights are each ONE merged mesh for the whole
 * city (not chunked): they are thin enough that culling them separately from
 * the road buys little, and one draw call each keeps the budget simple.
 * Buildings are one InstancedMesh, per CLAUDE.md §9's Phase 2b brief.
 */

import * as THREE from 'three';
import { WORLD, DRESSING, PALETTE } from '../Config.js';
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
    /** @type {THREE.Material|null} shared by the building InstancedMesh */
    this._buildingMaterial = null;
  }

  /**
   * Generate the network and its geometry, and add it to the scene.
   * Async so Phase 5 can await texture loads without changing the call site.
   * @param {THREE.Scene} scene
   */
  async build(scene) {
    this.network.generate();
    this._buildRoadMeshes();
    this._buildKerbs();
    this._buildGuardrails();
    this._buildStreetlights();
    this._buildBuildings();
    scene.add(this.group);
  }

  // ---------------------------------------------------------------------------
  // Road ribbons, intersection fill and the lane-marking shader
  // ---------------------------------------------------------------------------

  _buildRoadMeshes() {
    this._roadMaterial = new THREE.MeshStandardMaterial({
      color: PALETTE.asphalt,
      roughness: 0.35,
      metalness: 0.55,
    });
    this._installLaneMarkingShader(this._roadMaterial);

    const chunkSize = WORLD.chunkSize;
    /** @type {Map<string, {positions: number[], indices: number[], uvs: number[], laneMask: number[]}>} */
    const chunks = new Map();
    const chunkAt = (x, z) => {
      const key = `${Math.floor(x / chunkSize)}_${Math.floor(z / chunkSize)}`;
      let chunk = chunks.get(key);
      if (!chunk) {
        chunk = { positions: [], indices: [], uvs: [], laneMask: [] };
        chunks.set(key, chunk);
      }
      return chunk;
    };

    for (const edge of this.network.edges) {
      const samples = edge.samples;
      const tangents = edge.tangents;
      const arc = edge.sampleArc;
      const halfWidth = edge.width / 2;

      const mid = samples[Math.floor(samples.length / 2)];
      const chunk = chunkAt(mid.x, mid.z);

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
        const v = arc[i] / 8; // metres / 8 — fixed real-world tiling scale
        // U is signed METRES from the centreline (-halfWidth left, +halfWidth
        // right), not normalized 0..1 — road width varies per edge, and the
        // lane shader's line-width threshold is a constant in metres, so a
        // normalized U would make the same line read a different physical
        // width on an arterial than on a side street.
        // Left vertex first, then right — a0/a1 below assumes this order.
        chunk.positions.push(p.x - sx, p.y, p.z - sz, p.x + sx, p.y, p.z + sz);
        chunk.uvs.push(-halfWidth, v, halfWidth, v);
        chunk.laneMask.push(1, 1);
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

    // Intersection fill: one n-gon disc per node, raised slightly so it wins
    // the depth test over whatever ribbons overlap there. laneMask = 0 so the
    // dashed centreline never draws across it.
    const segments = DRESSING.intersection.segments;
    for (const node of this.network.nodes) {
      if (node.edges.length === 0) continue;
      let widest = 0;
      for (const edgeId of node.edges) {
        widest = Math.max(widest, this.network.edges[edgeId].width);
      }
      const radius = (widest / 2) * DRESSING.intersection.radiusPad;
      const y = node.position.y + DRESSING.intersection.riseY;
      const chunk = chunkAt(node.position.x, node.position.z);

      const centreIndex = chunk.positions.length / 3;
      chunk.positions.push(node.position.x, y, node.position.z);
      chunk.uvs.push(0, 0);
      chunk.laneMask.push(0);

      const rimStart = centreIndex + 1;
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        chunk.positions.push(
          node.position.x + Math.cos(angle) * radius,
          y,
          node.position.z + Math.sin(angle) * radius
        );
        chunk.uvs.push(0, 0);
        chunk.laneMask.push(0);
      }
      for (let i = 0; i < segments; i++) {
        // CCW winding (+Y normal): centre, next rim point, this rim point.
        chunk.indices.push(centreIndex, rimStart + i + 1, rimStart + i);
      }
    }

    for (const [key, chunk] of chunks) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(chunk.positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(chunk.uvs, 2));
      geometry.setAttribute('laneMask', new THREE.Float32BufferAttribute(chunk.laneMask, 1));
      geometry.setIndex(chunk.indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, this._roadMaterial);
      mesh.name = `road-chunk-${key}`;
      this.group.add(mesh);
    }
  }

  /**
   * Extend a MeshStandardMaterial with the dashed-centreline fwidth technique
   * from NeonGrid.js. Reads the `uv` and `laneMask` attributes built above and
   * adds emissive radiance where a dash covers the fragment, so the line
   * blooms without spending any of the five-light budget on it.
   * @param {THREE.MeshStandardMaterial} material
   */
  _installLaneMarkingShader(material) {
    const cfg = DRESSING.laneMarking;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uDashLength = { value: cfg.dashLength };
      shader.uniforms.uDashGap = { value: cfg.dashGap };
      shader.uniforms.uLineHalfWidth = { value: cfg.halfWidth };
      shader.uniforms.uLineColor = { value: new THREE.Color(cfg.color) };
      shader.uniforms.uLineEmissive = { value: cfg.emissiveIntensity };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\nattribute float laneMask;\nvarying vec2 vRoadUv;\nvarying float vLaneMask;`
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>\n\tvRoadUv = uv;\n\tvLaneMask = laneMask;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uDashLength;
          uniform float uDashGap;
          uniform float uLineHalfWidth;
          uniform vec3 uLineColor;
          uniform float uLineEmissive;
          varying vec2 vRoadUv;
          varying float vLaneMask;

          // Same trick as NeonGrid.gridCoverage(): distance-to-line divided by
          // its screen-space derivative gives a line whose width is constant
          // IN PIXELS, so it stays crisp close up and fades cleanly at range.
          float laneLineCoverage(vec2 uv) {
            float distFromCentre = abs(uv.x); // uv.x is signed metres from centre
            float duFromCentre = max(fwidth(distFromCentre), 1e-5);
            float lineCoverage = 1.0 - smoothstep(
              uLineHalfWidth - duFromCentre, uLineHalfWidth + duFromCentre, distFromCentre
            );

            float metres = uv.y * 8.0; // UV.y is stored as metres / 8
            float dashPeriod = uDashLength + uDashGap;
            float dashPhase = mod(metres, dashPeriod);
            float dashDeriv = max(fwidth(dashPhase), 1e-5);
            float dashCoverage = 1.0 - smoothstep(
              uDashLength - dashDeriv, uDashLength + dashDeriv, dashPhase
            );

            return lineCoverage * dashCoverage;
          }`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += uLineColor * uLineEmissive * laneLineCoverage(vRoadUv) * vLaneMask;`
        );
    };
    // onBeforeCompile mutates the program; a stable cache key stops three from
    // silently reusing an un-patched cached program for this material.
    material.customProgramCacheKey = () => 'road-lane-markings';
  }

  // ---------------------------------------------------------------------------
  // Kerbs — one merged neon strip mesh, MeshBasicMaterial so bloom needs no light
  // ---------------------------------------------------------------------------

  _buildKerbs() {
    const cfg = DRESSING.kerb;
    const positions = [];
    const indices = [];

    for (const edge of this.network.edges) {
      const samples = edge.samples;
      const tangents = edge.tangents;
      const halfWidth = edge.width / 2;

      for (const sign of [-1, 1]) {
        const base = positions.length / 3;
        for (let i = 0; i < samples.length; i++) {
          const p = samples[i];
          const t = tangents[i];
          const sideX = -t.z;
          const sideZ = t.x;
          const sideLen = Math.hypot(sideX, sideZ) || 1;
          const nx = sideX / sideLen;
          const nz = sideZ / sideLen;
          const innerOffset = halfWidth * sign;
          const outerOffset = (halfWidth + cfg.width) * sign;
          const y = p.y + cfg.riseY;
          positions.push(
            p.x + nx * innerOffset,
            y,
            p.z + nz * innerOffset,
            p.x + nx * outerOffset,
            y,
            p.z + nz * outerOffset
          );
        }
        for (let i = 0; i < samples.length - 1; i++) {
          const a0 = base + i * 2;
          const a1 = a0 + 1;
          const b0 = a0 + 2;
          const b1 = a0 + 3;
          // The left strip's inner→outer direction points the opposite way
          // across the tangent from the right strip's, so it needs the
          // opposite winding to keep both facing +Y. Verified by hand against
          // cross(edgeA, edgeB) for a (0,0,-1) tangent, same as the road
          // ribbon derivation above.
          if (sign < 0) indices.push(a0, b0, a1, a1, b0, b1);
          else indices.push(a0, a1, b0, a1, b1, b0);
        }
      }
    }

    if (positions.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({ color: cfg.color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'kerbs';
    this.group.add(mesh);
  }

  // ---------------------------------------------------------------------------
  // Guardrails — posts + rail, one merged mesh, kept clear of intersections
  // ---------------------------------------------------------------------------

  _buildGuardrails() {
    const cfg = DRESSING.guardrail;
    const positions = [];
    const indices = [];

    const addBox = (cx, cz, y0, y1, halfX, halfZ) => {
      const base = positions.length / 3;
      positions.push(
        cx - halfX,
        y0,
        cz - halfZ,
        cx + halfX,
        y0,
        cz - halfZ,
        cx + halfX,
        y0,
        cz + halfZ,
        cx - halfX,
        y0,
        cz + halfZ,
        cx - halfX,
        y1,
        cz - halfZ,
        cx + halfX,
        y1,
        cz - halfZ,
        cx + halfX,
        y1,
        cz + halfZ,
        cx - halfX,
        y1,
        cz + halfZ
      );
      // Sides only (top/bottom never seen on a thin rail/post) — four quads.
      // (a,c,b),(a,d,c) — NOT the more obvious (a,b,c,d) fan: hand-verified
      // via cross(edgeA, edgeB) that (a,b,c) on this vertex order faces
      // INWARD on every side of the box, which FrontSide culls from the one
      // angle that matters (outside it, looking in).
      const quad = (a, b, c, d) =>
        indices.push(base + a, base + c, base + b, base + a, base + d, base + c);
      quad(0, 1, 5, 4);
      quad(1, 2, 6, 5);
      quad(2, 3, 7, 6);
      quad(3, 0, 4, 7);
    };

    for (const edge of this.network.edges) {
      if (edge.length < cfg.minEdgeLength) continue;
      const samples = edge.samples;
      const tangents = edge.tangents;
      const arc = edge.sampleArc;
      const halfWidth = edge.width / 2;
      const usableStart = cfg.endMargin;
      const usableEnd = edge.length - cfg.endMargin;
      if (usableEnd <= usableStart) continue;

      for (const sign of [-1, 1]) {
        // Posts at fixed spacing along the usable span of the edge.
        const span = usableEnd - usableStart;
        const postCount = Math.max(2, Math.floor(span / cfg.postSpacing) + 1);
        for (let p = 0; p <= postCount; p++) {
          const s = usableStart + (span * p) / postCount;
          const sample = this._sampleEdgeAtArc(edge, arc, samples, tangents, s);
          const offset = (halfWidth + cfg.offset) * sign;
          const cx = sample.x + sample.nx * offset;
          const cz = sample.z + sample.nz * offset;
          addBox(cx, cz, sample.y, sample.y + cfg.height, cfg.postHalfWidth, cfg.postHalfWidth);
        }

        // The rail itself as a single continuous ribbon along the same span,
        // resampled from the edge's own arc-length-even points so it follows
        // elevation changes without extra bookkeeping.
        const base = positions.length / 3;
        let railVertCount = 0;
        for (let i = 0; i < samples.length; i++) {
          if (arc[i] < usableStart || arc[i] > usableEnd) continue;
          const t = tangents[i];
          const sideX = -t.z;
          const sideZ = t.x;
          const sideLen = Math.hypot(sideX, sideZ) || 1;
          const nx = sideX / sideLen;
          const nz = sideZ / sideLen;
          const offset = (halfWidth + cfg.offset) * sign;
          const p = samples[i];
          const cx = p.x + nx * offset;
          const cz = p.z + nz * offset;
          const yTop = p.y + cfg.height;
          const yBot = yTop - cfg.railHalfHeight * 2;
          positions.push(
            cx - nz * cfg.railHalfHeight,
            yBot,
            cz + nx * cfg.railHalfHeight,
            cx + nz * cfg.railHalfHeight,
            yTop,
            cz - nx * cfg.railHalfHeight
          );
          railVertCount++;
        }
        for (let i = 0; i < railVertCount - 1; i++) {
          const a0 = base + i * 2;
          const a1 = a0 + 1;
          const b0 = a0 + 2;
          const b1 = a0 + 3;
          // Winding only matters with backface culling on; the rail material
          // is DoubleSide (it's a thin vertical ribbon seen from either side
          // of the road depending on the camera), so one winding is enough.
          indices.push(a0, a1, b0, a1, b1, b0);
        }
      }
    }

    if (positions.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({ color: cfg.color, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'guardrails';
    this.group.add(mesh);
  }

  /**
   * Interpolate position/tangent-normal at arc length `s` along an edge's own
   * sample arrays. Generation-time only (guardrail/streetlight placement),
   * never the sampleAt() hot path, so an allocation-free scratch object isn't
   * required — a small returned object is fine here.
   */
  _sampleEdgeAtArc(edge, arc, samples, tangents, s) {
    let index = 0;
    for (let i = 0; i < arc.length - 1; i++) {
      index = i;
      if (s <= arc[i + 1]) break;
    }
    const segLen = arc[index + 1] - arc[index];
    const localT = segLen > 1e-6 ? (s - arc[index]) / segLen : 0;
    const a = samples[index];
    const b = samples[index + 1];
    const t = tangents[index];
    const sideX = -t.z;
    const sideZ = t.x;
    const sideLen = Math.hypot(sideX, sideZ) || 1;
    return {
      x: a.x + (b.x - a.x) * localT,
      y: a.y + (b.y - a.y) * localT,
      z: a.z + (b.z - a.z) * localT,
      nx: sideX / sideLen,
      nz: sideZ / sideLen,
    };
  }

  // ---------------------------------------------------------------------------
  // Streetlights — poles + lamps, one merged mesh via vertex colour, no lights
  // ---------------------------------------------------------------------------

  _buildStreetlights() {
    const cfg = DRESSING.streetlight;
    const poleColor = new THREE.Color(cfg.poleColor);
    const lampColor = new THREE.Color(cfg.color);

    const positions = [];
    const colors = [];
    const indices = [];

    const addBox = (cx, cz, y0, y1, halfX, halfZ, color) => {
      const base = positions.length / 3;
      positions.push(
        cx - halfX,
        y0,
        cz - halfZ,
        cx + halfX,
        y0,
        cz - halfZ,
        cx + halfX,
        y0,
        cz + halfZ,
        cx - halfX,
        y0,
        cz + halfZ,
        cx - halfX,
        y1,
        cz - halfZ,
        cx + halfX,
        y1,
        cz - halfZ,
        cx + halfX,
        y1,
        cz + halfZ,
        cx - halfX,
        y1,
        cz + halfZ
      );
      for (let i = 0; i < 8; i++) colors.push(color.r, color.g, color.b);
      // (a,c,b),(a,d,c) — NOT the more obvious (a,b,c,d) fan: hand-verified
      // via cross(edgeA, edgeB) that (a,b,c) on this vertex order faces
      // INWARD on every side of the box, which FrontSide culls from the one
      // angle that matters (outside it, looking in).
      const quad = (a, b, c, d) =>
        indices.push(base + a, base + c, base + b, base + a, base + d, base + c);
      quad(0, 1, 5, 4);
      quad(1, 2, 6, 5);
      quad(2, 3, 7, 6);
      quad(3, 0, 4, 7);
      quad(4, 5, 6, 7); // top, visible from the chase camera's high angle
    };

    for (const edge of this.network.edges) {
      const samples = edge.samples;
      const tangents = edge.tangents;
      const arc = edge.sampleArc;
      const halfWidth = edge.width / 2;
      const count = Math.max(1, Math.floor(edge.length / WORLD.streetlightSpacing));
      // Alternate sides per light along the edge, a cheap way to avoid a
      // monotonous single-side row and to keep density believable.
      for (let n = 1; n < count; n++) {
        const s = (edge.length * n) / count;
        const sample = this._sampleEdgeAtArc(edge, arc, samples, tangents, s);
        const sign = n % 2 === 0 ? 1 : -1;
        const offset = (halfWidth + cfg.offset) * sign;
        const cx = sample.x + sample.nx * offset;
        const cz = sample.z + sample.nz * offset;
        addBox(
          cx,
          cz,
          sample.y,
          sample.y + cfg.poleHeight,
          cfg.poleHalfWidth,
          cfg.poleHalfWidth,
          poleColor
        );
        addBox(
          cx,
          cz,
          sample.y + cfg.poleHeight - cfg.lampHeight,
          sample.y + cfg.poleHeight,
          cfg.lampWidth / 2,
          cfg.lampWidth / 2,
          lampColor
        );
      }
    }

    if (positions.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'streetlights';
    this.group.add(mesh);
  }

  // ---------------------------------------------------------------------------
  // Buildings — one InstancedMesh, placement rejection-sampled off the roads
  // ---------------------------------------------------------------------------

  _buildBuildings() {
    const cfg = DRESSING.building;
    const half = WORLD.extent / 2;
    // Worst-case clearance a candidate needs from the nearest road edge,
    // independent of the footprint eventually chosen for it (chosen after
    // the placement check passes) — see the file header rationale.
    const requiredClearance = cfg.margin + cfg.maxFootprint / 2;

    const placements = [];
    const probe = new THREE.Vector3();
    for (let x = -half; x <= half; x += cfg.gridSpacing) {
      for (let z = -half; z <= half; z += cfg.gridSpacing) {
        const px = x + this.random.signed(cfg.jitter);
        const pz = z + this.random.signed(cfg.jitter);
        probe.set(px, 0, pz);
        const sample = this.network.sampleAt(probe, null);
        const edge = this.network.edges[sample.road.edgeId];
        if (!edge) continue;
        const gap = Math.abs(sample.distanceFromCentre) - edge.width / 2;
        if (gap <= requiredClearance) continue;
        if (!this.random.chance(WORLD.buildingDensity)) continue;

        placements.push({
          x: px,
          z: pz,
          y: sample.surfaceY,
          width: this.random.range(cfg.minFootprint, cfg.maxFootprint),
          depth: this.random.range(cfg.minFootprint, cfg.maxFootprint),
          height: this.random.range(cfg.minHeight, cfg.maxHeight),
        });
      }
    }

    if (placements.length === 0) return;

    this._buildingMaterial = new THREE.MeshStandardMaterial({
      color: cfg.color,
      emissive: cfg.color,
      emissiveIntensity: cfg.emissiveIntensity,
      roughness: 0.8,
      metalness: 0.1,
    });
    this._installBuildingWindowShader(this._buildingMaterial);

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    // Boxes sit on the ground, not centred on it — shift the pivot to the base
    // so `matrix.y = footprint.y` (ground height) places it correctly.
    geometry.translate(0, 0.5, 0);

    const mesh = new THREE.InstancedMesh(geometry, this._buildingMaterial, placements.length);
    mesh.name = 'buildings';
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const matrix = new THREE.Matrix4();
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      matrix.makeScale(p.width, p.height, p.depth);
      matrix.setPosition(p.x, p.y, p.z);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;

    this.group.add(mesh);
  }

  /**
   * Extend the building MeshStandardMaterial with a procedural window grid,
   * self-lit via emissive radiance (never a THREE.Light — see §8). Vertical
   * spacing uses true world-space height so floors are a fixed real-world
   * size regardless of a building's height; horizontal spacing uses the RAW
   * (pre-instance) local position, which stays in ±0.5 on the box's two
   * in-plane axes — since one of {localX, localZ} is pinned to ±0.5 on any
   * given face, their SUM isolates whichever one is actually varying across
   * that face without needing the face normal at all.
   * @param {THREE.MeshStandardMaterial} material
   */
  _installBuildingWindowShader(material) {
    const cfg = DRESSING.building;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWindowColor = { value: new THREE.Color(cfg.windowColor) };
      shader.uniforms.uWindowIntensity = { value: cfg.windowIntensity };
      shader.uniforms.uFloorHeight = { value: cfg.windowFloorHeight };
      shader.uniforms.uWindowColumns = { value: cfg.windowColumns };
      shader.uniforms.uLitChance = { value: cfg.windowLitChance };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\nvarying vec3 vFff2WorldPos;\nvarying float vFff2WallCoord;\nvarying float vFff2NormalY;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 fff2Local = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            fff2Local = instanceMatrix * fff2Local;
          #endif
          vFff2WorldPos = (modelMatrix * fff2Local).xyz;
          // One of {localX, localZ} is pinned to ±0.5 on any given box face,
          // so their sum isolates whichever one is actually varying across
          // that face — no need to know which face this is.
          vFff2WallCoord = position.x + position.z;
          // Raw box-local normal: ±1 on Y for the roof/floor caps, ~0 for the
          // four side walls. Used to keep windows off the roof.
          vFff2NormalY = normal.y;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 uWindowColor;
          uniform float uWindowIntensity;
          uniform float uFloorHeight;
          uniform float uWindowColumns;
          uniform float uLitChance;
          varying vec3 vFff2WorldPos;
          varying float vFff2WallCoord;
          varying float vFff2NormalY;

          float fff2Hash(vec2 v) {
            return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453);
          }`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            float floorCoord = vFff2WorldPos.y / uFloorHeight;
            float floorIndex = floor(floorCoord);
            float floorFrac = fract(floorCoord);
            float rowMask = step(0.22, floorFrac) * step(floorFrac, 0.78);

            // Roof/floor caps have a near-vertical normal; windows only ever
            // belong on the four walls.
            float isWall = 1.0 - step(0.5, abs(vFff2NormalY));

            float colCoord = vFff2WallCoord * uWindowColumns;
            float colIndex = floor(colCoord);
            float colFrac = fract(colCoord);
            float colMask = step(0.18, colFrac) * step(colFrac, 0.82);

            float seed = floor(vFff2WorldPos.x * 0.37) + floor(vFff2WorldPos.z * 0.53) * 131.0;
            float lit = step(1.0 - uLitChance, fff2Hash(vec2(floorIndex + seed, colIndex - seed)));

            float windowMask = rowMask * colMask * lit * isWall;
            totalEmissiveRadiance += uWindowColor * uWindowIntensity * windowMask;
          }`
        );
    };
    material.customProgramCacheKey = () => 'building-windows';
  }

  // ---------------------------------------------------------------------------
  // Queries — delegated straight to RoadNetwork, which owns the graph
  // ---------------------------------------------------------------------------

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
