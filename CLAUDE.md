# Furious For Fast 2

A minimalist Three.js arcade racer: **Need For Speed Underground 2**'s wet neon
street styling and garage customisation, crossed with **Need For Speed: Hot
Pursuit**'s escalating police chases.

This file is the working brief for anyone — human or model — picking the project
up. Read it fully before writing code. It is authoritative: where this document
and a code comment disagree, this document wins, and you should fix the comment.

---

## 1. Design pillars

Every decision should be traceable to one of these four. If a feature does not
serve one, it does not belong in this project.

1. **The drift is the game.** Cornering sideways at speed must feel good enough
   to be its own reward. Nitrous is earned by drifting, which makes style and
   speed the same currency instead of competing ones.
2. **The chase escalates.** Heat rises, more cops arrive, new tactics unlock.
   The player should always be able to see the pressure increasing, and should
   always believe escape is possible.
3. **Minimalist by construction.** No downloaded 3D models, no texture atlases,
   no physics engine, no state-management library. Cars and city are built from
   primitives and shaders. The whole game should stay comfortably under a
   megabyte of its own code and assets.
4. **Readable at speed.** At 200 km/h in the rain the player must still be able
   to read the road, the cops and the HUD. Legibility beats fidelity every time.
5. **One city, learned by heart.** The map is generated once from a fixed seed
   and is then *permanent* — every player, every session, the same streets.
   Mastery comes from knowing which alley cuts the corner and where the cops
   always set up. Randomising the map every run would throw that away, so
   variety comes from seeded race *routes* across a fixed city, never from
   regenerating the city itself.

### Explicit non-goals

Simulation-grade physics. Licensed cars. Multiplayer. A gearbox with a clutch.
Damage modelling beyond a single 0–1 scalar. Mobile-first controls (touch is
Phase 6, and it is a courtesy, not a target).

Note that **open world and civilian traffic were both moved from non-goals into
scope** after Phase 0 — see §14 for the decisions and what they cost.

---

## 2. Commands

```bash
npm install        # once
npm run dev        # Vite dev server on http://localhost:5173
npm run build      # production bundle into dist/
npm run preview    # serve the built bundle
npm run lint       # eslint (flat config, eslint.config.js)
npm run format     # prettier
```

Debug flags are URL query parameters, so a broken build can be inspected
without editing source:

| URL | Effect |
| --- | --- |
| `?debug` | exposes the `Game` instance on `window.game`, logs scaffold state |
| `?stats` | frame-time / draw-call overlay |
| `?vectors` | draws physics force and velocity vectors on every car |
| `?network` | draws the road network graph: edges, intersection nodes, checkpoints |
| `?freecam` | detaches the camera from the car |
| `?nofx` | bypasses the post-processing chain entirely |

Flags combine: `localhost:5173/?debug&network&stats`.

### Controls

Bindings live in `INPUT.players` in `Config.js`, one entry per player, so
split-screen is a matter of constructing a second `Input` rather than a rewrite.

| | Player 1 | Player 2 |
| --- | --- | --- |
| throttle / brake | `W` / `S` | `↑` / `↓` |
| steer | `A` / `D` | `←` / `→` |
| drift, e-brake, burnout | `Space` | `Numpad0` |
| nitrous | `LShift` | `RShift` |
| look back | `B` or `Q` | `Numpad1` |
| reset | `R` | `Numpad.` |

Session-wide, whoever presses them: `G` garage, `Esc`/`P` pause.

**No Ctrl or Alt bindings, ever.** `Ctrl+W` closes the tab and cannot be
`preventDefault()`-ed in Chrome outside true fullscreen — and player 1 holds `W`
for throttle. `Alt` pulls focus to the browser menu bar on Windows and Linux.
Player 2's extra actions live on the numpad for this reason.

Two players on one keyboard are limited by **rollover**: membrane keyboards
commonly drop the third to sixth simultaneous key, and two players cornering
while boosting will exceed that. A gamepad for player 2 sidesteps it —
`INPUT.players[n].gamepadIndex` already routes each player to their own pad.

---

## 3. Hard constraints

These are not stylistic preferences. Breaking one will cost more time to undo
than to respect.

- **Three.js r186+, ES modules, no build-time transpilation beyond Vite's.**
- **No physics engine.** No Cannon, no Rapier, no Ammo. The car model in
  `Physics.js` is deliberately not a rigid body — see §7.1.
- **No 3D model files.** Cars, road and buildings are procedural geometry.
  This is what lets the garage restyle a car instantly with no loading.
- **`Config.js` imports nothing** and stays free of side effects, so any module
  can be unit-tested under Node with no DOM and no WebGL context. Verify with:
  `node --input-type=module -e "await import('./src/Config.js')"`
- **Every tunable number lives in `Config.js`.** If you are typing a float into
  a system file, it belongs in Config instead.
- **Physics runs on a fixed timestep** (`LOOP.fixedStep`, 120 Hz). Never feed a
  frame delta into `Physics.step()`. Rendering interpolates — see §6.
- **Five lights, total.** See §8. Additional lights recompile shaders and cost a
  full pass in the forward renderer.
- **No shadow maps.** The look comes from emissive materials plus bloom.
- **Addon imports use the `three/addons/…` specifier**, never
  `three/examples/jsm/…` — Vite will not pre-bundle the latter.
- **UI is DOM.** No canvas-rendered text, no sprite fonts, no CSS3DRenderer.
- **The city's seed is pinned and the generator is frozen.** `WORLD.seed` must
  never be randomised at runtime, and worldgen must never call `Math.random()` —
  take a `utils/Random.js` instance. The whole design rests on every player
  driving the same permanent map (§7.2).

---

## 4. Project structure

```
.
├── CLAUDE.md               this file
├── README.md               short public-facing readme
├── index.html              the only HTML page; canvas + DOM UI layer
├── package.json            three + vite; scripts in §2
├── vite.config.js          relative base, es2022 target, three in its own chunk
├── eslint.config.js        flat config
├── public/
│   ├── textures/           generated or hand-authored textures (currently none)
│   └── audio/              engine loop, siren, tyre squeal (Phase 5)
└── src/
    ├── main.js             entry point: build Game, surface fatal errors
    ├── Config.js           ALL tuning constants; imports nothing
    ├── core/
    │   ├── Game.js         composition root; owns the scene and update order
    │   ├── Loop.js         fixed-timestep accumulator + variable render
    │   └── Input.js        keyboard + gamepad → one analogue snapshot
    ├── physics/
    │   └── Physics.js      arcade car dynamics: accel, brake, steer, drift
    ├── world/
    │   ├── Track.js        owns the city: generation + road geometry
    │   ├── RoadNetwork.js  the road GRAPH: nodes, edges, spatial index, routing
    │   └── Environment.js  lights, fog, weather
    ├── entities/
    │   ├── Car.js          one vehicle: physics state + mesh + customisation
    │   ├── Police.js       pursuit fleet and its AI state machine
    │   └── Traffic.js      civilian cars; density is a player setting
    ├── systems/
    │   ├── UpgradeSystem.js  performance + visual state → resolved stat block
    │   ├── HeatSystem.js     pursuit lifecycle, heat, cash, bust/escape
    │   ├── RaceSystem.js     seeded checkpoint races across the fixed city
    │   └── SaveSystem.js     localStorage, defensively wrapped
    ├── render/
    │   ├── Renderer.js     owns the WebGLRenderer and camera; only resize point
    │   ├── CameraRig.js    chase camera
    │   ├── PostFX.js       EffectComposer: bloom, speed blur
    │   └── NeonGrid.js     shader ground grid (also the road-shader reference)
    ├── ui/
    │   ├── HUD.js          speed, nitrous, heat, escape bar, drift score
    │   ├── Garage.js       upgrade + customisation screen
    │   └── styles.css      UI shell and the CSS half of the palette
    └── utils/
        ├── MathUtils.js    clamp, lerp, damp, wrapAngle, smoothstep
        └── Random.js       seeded PRNG; worldgen must never use Math.random()
```

### Status of each module

`IMPLEMENTED` files work and are verified. `STUB` files have a complete,
documented API contract and a body that is a safe no-op marked
`TODO(phase-N)`. **Implement against the documented contract; do not redesign
the signatures without updating this file.**

| Module | Status |
| --- | --- |
| `Config.js` | IMPLEMENTED |
| `main.js` | IMPLEMENTED |
| `core/Loop.js` | IMPLEMENTED |
| `core/Input.js` | IMPLEMENTED — per-player, split-screen ready |
| `core/Game.js` | IMPLEMENTED (wiring); contains scaffold preview to delete |
| `render/Renderer.js` | IMPLEMENTED |
| `render/NeonGrid.js` | IMPLEMENTED |
| `systems/UpgradeSystem.js` | IMPLEMENTED |
| `systems/SaveSystem.js` | IMPLEMENTED |
| `utils/MathUtils.js` | IMPLEMENTED |
| `utils/Random.js` | IMPLEMENTED |
| `physics/Physics.js` | IMPLEMENTED |
| `entities/Car.js` | IMPLEMENTED (mesh + state); `applyVisuals` phase 3 |
| `world/Track.js` | IMPLEMENTED (crude ribbons); dressing in phase 2b |
| `world/Environment.js` | PARTIAL — placeholder lights, phase 2 |
| `render/CameraRig.js` | PARTIAL — minimal follow in phase 1, completed phase 3 |
| `render/PostFX.js` | STUB — phase 3 (falls through to plain render) |
| `ui/HUD.js` | STUB — phase 3 |
| `ui/Garage.js` | STUB — phase 3 |
| `entities/Police.js` | STUB — phase 4 |
| `systems/HeatSystem.js` | STUB — phase 4 |
| `world/RoadNetwork.js` | IMPLEMENTED — graph, index, routing; Node-safe |
| `systems/RaceSystem.js` | NOT YET WRITTEN — phase 3b |
| `entities/Traffic.js` | NOT YET WRITTEN — phase 5 |

**`Config.js` groups.** `WORLD` (city seed, extent, block grid, widths, spatial
cell size) replaced the old closed-loop `TRACK` group at the start of Phase 2a.
`TRAFFIC` (density presets) and `RACE` (checkpoint spacing) are pinned now so
the settings UI and the performance budget have concrete numbers to target,
even though they are consumed in Phases 5 and 3b. `DEBUG.showNetwork` sits
behind `?network`.

---

## 5. Conventions

**Units are SI.** Metres, seconds, kilograms, radians, newtons. Speed is m/s
everywhere internally; only `HUD.js` converts for display.

**Axes.** +X right, +Y up, −Z forward. A car at rest with `heading = 0` faces
−Z. Heading increases counter-clockwise viewed from above.

**Road positions.** A place on the road is a `RoadPosition` — `{ edgeId, s }`,
an edge of the network and metres along it. It is an **opaque handle**: pass it
to `sampleAt`/`getPose`/`route`, store it as a car's `roadHint`, but never
compare or subtract two of them. Distances and gaps come from `RoadNetwork`
queries. There is no global lap parameter; see §7.2.

**Raw versus ramped steer.** `Input` publishes two steering values.
`controls.steer` is the smoothed axis that drives the car; `controls.steerRaw`
is the instantaneous intent. **Anything reacting to a key press EDGE must read
`steerRaw`.** The ramp takes ~60 ms to cross a threshold, so testing the
smoothed axis on a press judges a player who hit A and Space together — the
natural way to start a drift — as "not steering", and hands them an e-brake.
Cars with no input layer (police, traffic) simply omit `steerRaw`.

**Reused return objects.** `Track.sampleAt()` and `Track.getPose()` return a
single scratch object that is overwritten on the next call, because they run
once per car per fixed step. **Copy any field you need to keep.** Holding the
reference gives you a value that silently changes under you.

**Naming.** Classes `PascalCase`, one per file, filename matches. Private
members prefix with `_`. Scratch objects reused across frames are `_named` and
declared in the constructor.

**Ownership.** `Game.state` is shared mutable state; every field names its
single owning system in a comment. Only the owner writes; everyone else reads.
Systems never reach into each other — `Game` mediates.

**No per-frame allocation.** Anything running in `fixedUpdate` or `render` must
not allocate. `new THREE.Vector3()` inside `Physics.step()` produces hundreds of
garbage objects per second per car and will show up as GC stutter. Declare
scratch vectors in the constructor and reuse them.

**Frame-rate independence.** Use `MathUtils.damp(current, target, rate, dt)` for
smoothing, never `lerp(a, b, 0.1)`. A raw lerp is stiffer at 144 Hz than at
60 Hz, which silently changes camera and steering feel across machines.

---

## 6. Frame order

`Game.js` is the only place that knows the whole order. Do not reorder without
updating both the comment in that file and this section.

```
Loop.fixedUpdate(dt)         // dt is ALWAYS LOOP.fixedStep
  1. Input.sample(dt)          analogue snapshot; reused object, copy don't keep
  2. Physics.step(player, …)   resolve forces, integrate
  3. Physics.step(cop, …)      for each active cruiser
  4. collision resolution      track bounds → props → car-to-car
  5. Police.update(player, dt) writes each cop's controls for the NEXT step
  6. HeatSystem.update(dt, …)  heat, evade/bust timers, spawns, cash

Loop.render(alpha, frameDt)  // alpha is the 0..1 fraction between fixed steps
  7. Car.syncTransform(alpha)  the ONLY place group.position may be written
  8. CameraRig.update(frameDt)
  9. Environment.update / PostFX uniforms
 10. HUD.update(player, frameDt)
 11. PostFX.render(frameDt)
```

**Why interpolate.** Physics ticks at 120 Hz, the display at whatever the
monitor does. `Car.state.prevPosition` and `prevHeading` hold the previous fixed
step; `syncTransform(alpha)` lerps between them. Skipping this makes a 60 Hz
display judder because it samples an unevenly-phased 120 Hz simulation.
Interpolate heading along the **shortest** angular path or the car spins the
wrong way through the ±π seam — use `MathUtils.angleDelta`.

---

## 7. The core subsystems

### 7.1 `physics/Physics.js` — car dynamics

**Not a rigid-body simulation, and it must not become one.** It is a point mass
with an explicit yaw degree of freedom. That separation is the whole point:
arcade drifting needs the car's heading to be semi-independent of its velocity,
which a real tyre model actively fights.

`Physics.step()` runs these seven stages in order. The file's header comment
carries the same list with the exact formulas — treat that as the spec.

1. **Decompose.** Build the local basis from `heading`
   (`forward = (−sin h, 0, −cos h)`, `right = (cos h, 0, −sin h)`), project
   velocity onto both, and compute
   `slipAngle = atan2(lateralSpeed, max(|forwardSpeed|, 0.5))`. The 0.5 floor
   stops slip angle becoming noise at a standstill.
2. **Surface.** `Track.sampleAt()` gives `onRoad`, `surfaceY` and `t`. Off-road
   scales grip and drag. Cache `t` on the car as `trackT`.
3. **Longitudinal force.** Engine force tapers as
   `clamp(1 − forwardSpeed / topSpeed, 0, 1)`, which is a soft limiter — there
   is no explicit speed clamp anywhere in the codebase. Plus nitrous, brakes,
   quadratic drag, linear rolling resistance, and a reverse case.
4. **Lateral force — this is where the drift lives.** Compute the force that
   would cancel all sideways motion, then clamp it to a grip limit. When the
   demand exceeds the limit the tyres are saturated and the car slides; the
   leftover lateral velocity *is* the drift. Nothing needs to special-case it.
   The handbrake simply multiplies the limit by
   `stats.handbrakeGripMultiplier`.
5. **Yaw.** Kinematic, not torque-driven, because it is far easier to tune:
   a bicycle-model target yaw rate from steer angle and forward speed, scaled by
   `driftYawAssist` while drifting, then damped toward. Keep the sign of
   `forwardSpeed` so reverse steers the correct way.
6. **Integrate.** Semi-implicit Euler — stable at 120 Hz where explicit Euler is
   not. Velocity from acceleration first, then position from the new velocity.
7. **Nitrous bookkeeping.** Engage only above `NITROUS.minimumToEngage`; drain
   while active; refill from drifting plus a small passive trickle.

**Tuning order** when the car feels wrong. Change one thing at a time:

| Symptom | First knob | Then |
| --- | --- | --- |
| sluggish | `enginePower` | `topSpeed` |
| will not turn in | `maxSteerAngle` | `steerSpeedFalloff` |
| spins on every corner | `lateralGrip` ↑ | `driftYawAssist` ↓ |
| drift will not hold | `handbrakeGripMultiplier` ↓ | `driftYawAssist` ↑ |
| drift will not recover | `yawDamping` ↑ | enable `ACCESSIBILITY.driftAssist` |

#### The drift model — one context-sensitive key

Space does three different things, chosen by what else you are doing at the
moment it goes down. **There is no tap-versus-hold timer**: a timer would have
to wait to see whether you release before deciding, and that latency is
unacceptable on the input that defines the game. Context is free and instant.

| You are | Space does |
| --- | --- |
| moving and steering | **DRIFT** — commit, charge, release for a mini-turbo |
| moving, roughly straight | **E-BRAKE** — actually stops the car |
| stopped, throttle pinned | **BURNOUT** — spin the tyres, release to launch |

**The direction lock is the mechanic.** On entry the drift direction locks to
the way you were steering, and you cannot flip it without releasing. Steering
inside the drift only modulates the arc — into the turn tightens it
(`DRIFT.innerSteerFactor`), away widens it (`outerSteerFactor`), and neither
straightens the car. This is what separates a *committed drift* from "reduced
grip while a key is held": a lock you steer within is a decision with a
consequence, a grip multiplier is just a slider. Tune those two factors before
anything else — they are the whole skill expression.

**The mini-turbo ladder** (`DRIFT.tiers`) is Mario Kart's blue / orange /
purple: hold the drift longer, get a bigger boost on release. Charge only
accumulates while slip exceeds `DRIFT.chargeSlipAngle`, so a lazy slide earns
nothing and you cannot farm a boost by tapping.

**Mini-turbo and nitrous both reward drifting, on purpose, at different
timescales.** Mini-turbo is the instant per-corner payout that teaches you to
drift everything; nitrous is the bank you spend deliberately on a straight or
to break a pursuit. They reinforce rather than compete — but if drifting ever
feels like it trivialises nitrous, the mini-turbo is the one to shrink, because
pillar 1 makes nitrous-from-drifting load-bearing.

**A state machine, not a flag.** Physics owns `state.driftState`
(`none` | `drift` | `ebrake` | `burnout` | `boost`). Entry conditions are
evaluated only on the press edge, from `controls.steerRaw`; while held, the
state does not re-evaluate. That is what stops a drift silently becoming an
e-brake mid-corner when you happen to straighten the wheel.

**A boost runs on its own clock**, independent of `driftState`, so committing to
the next drift does not cancel the one you just earned. Chaining corner to
corner is the point of the ladder, and clearing the boost on re-press would
punish exactly the play it should reward.

**Burnout cancels a FRACTION of engine force** (`DRIFT.burnoutHoldFactor`), not
a fixed number of newtons. Engine power spans 11000 N stock to over 20000 N
fully upgraded, and no absolute hold force works across that range — the
original flat 16000 N left a stock car frozen at exactly zero while a maxed one
accelerated past `burnoutMaxSpeed` and drove away. A fraction leaves the same
slice of creep at both ends and can never go negative.

**The brakes upgrade still reaches the drift.** `DRIFT.gripMultiplier` is the
authored base; the owned brakes tier is applied as a ratio against
`CAR_BASE.handbrakeGripMultiplier` so a purchased upgrade keeps visibly
deepening the slide. Substituting `stats.handbrakeGripMultiplier` wholesale
would look identical today only because the two Config bases happen to match,
and would silently stop working the moment they diverge.

### 7.2 `world/Track.js` + `world/RoadNetwork.js` — the open-world city

**The city is one fixed, permanent map.** It is generated procedurally, but
**once**, from a pinned seed (`WORLD.seed`), so every player in every session
drives the same streets and can learn them. This is design pillar 5 and it is
the reason the architecture below is a graph rather than a curve.

> **Treat the generator as frozen once the map ships.** Changing generation code
> silently rebuilds the city, which invalidates every player's route knowledge,
> lap times and leaderboard. If the generator must change after launch, bump
> `WORLD.generatorVersion` and treat it as a new map, not a patch.

**`RoadNetwork.js` owns the graph and every query over it** — node/edge
generation, the splines, the spatial index, `sampleAt`, `getPose` and routing.
**`Track.js` owns geometry and the scene graph**, building meshes from the
network it holds as `track.network` and delegating the queries straight through.

That split is load-bearing: `RoadNetwork` imports no material, touches no
scene, and is constructible under Node with no WebGL context. The graph is the
hardest part of the open world to get right, and being able to unit-test
generation, connectivity and routing headlessly — in milliseconds, without a
browser — is worth more than the small awkwardness of two files.

#### The graph

- **Nodes** are intersections: a position plus its incident edge ids.
- **Edges** are road segments: a `CatmullRomCurve3` between two nodes, plus
  lane count, width, and arc-length-even sample points.
- A **`RoadPosition`** is `{ edgeId, s }` — an edge and metres along it. It is
  the only way to name a place on the road. **It is an opaque handle: never do
  arithmetic on it.** Distances and gaps are `RoadNetwork` queries, because
  "0.3 along edge 7" and "0.3 along edge 40" are not comparable quantities.

There is deliberately **no global lap parameter**. The old closed-loop `t` and
its `loopDelta()` helper are gone; they do not generalise to a graph, and code
that fakes a global position will be subtly wrong at every junction.

#### Generation, in order

1. **Street skeleton.** Lay out intersection nodes, then join them into a graph.
   A perturbed grid with a few long diagonal arterials is the right starting
   point: grids give the player legible structure to memorise, and the
   diagonals create the shortcut decisions that make route knowledge pay off.
   Deterministic via `utils/Random.js` seeded with `WORLD.seed` — **never
   `Math.random()`** anywhere in worldgen.
2. **Reject bad junctions.** Drop edges that meet at very shallow angles or that
   are shorter than a car length; both produce undrivable geometry.
2b. **Verify the graph is fully connected** and drop any orphaned component.
   A node the player can drive to but cops cannot route to surfaces much later
   and much more confusingly as "the AI gave up in that corner of the map".
   Assert connectivity in a test, not just at runtime — it is nearly free to
   check at generation time and expensive to diagnose from gameplay.
3. **Edge splines.** One `CatmullRomCurve3` per edge, with tangents at each node
   aligned so roads meet smoothly rather than kinking at intersections.
4. **Sampling.** `curve.getSpacedPoints()`, **not** `getPoints()` — arc-length-even
   samples are what stop the road mesh bunching on curves and what make `s`
   mean actual metres.
5. **Geometry.** Per edge, emit two vertices at
   `point ± side · width / 2` where `side = normalize(cross(tangent, UP))`.
   UV `v` in metres / 8 so lane dashes tile at a fixed real-world scale.
   Intersections need their own filled polygons — do not just overlap two road
   strips, the z-fighting is very visible at night.
6. **Chunking.** Group geometry into spatial chunks and build one mesh per
   chunk, **not one mesh for the city**: a single mesh can never be
   frustum-culled, so the GPU would transform every street every frame. Chunks
   are also the unit of loading if the map ever outgrows memory.

#### Queries — the hot path

`sampleAt(position, hint)` runs for **every car every fixed step** (player,
eight cops, and traffic). It must be **O(1) and allocation-free** — mutate and
return a scratch object, as the stub already demonstrates.

- Build a **uniform spatial grid** (~40 m cells) at load time mapping cell →
  candidate edge ids. Query only the cells overlapping the position.
- Honour the `hint`: a car almost always remains on the edge it was on, or moves
  to one adjacent to it. Check the hinted edge and its node's neighbours first
  and you will hit in one or two tests, falling back to the grid only on a
  teleport or a respawn.
- Returns `{ road, distanceFromCentre, onRoad, surfaceY, tangent, centre }`.

`getPose(road, lateralOffset)` is the inverse — position and heading at a road
position. Used for spawning, respawning, checkpoints and roadblocks.

#### Routing

The pursuit AI and traffic both need paths, so `RoadNetwork` owns routing:

- `route(fromRoad, toRoad)` → a list of edge ids. Dijkstra or A* over the node
  graph with a straight-line heuristic. The graph is small and static, so
  **precompute and cache**; do not run a fresh search every frame.
- `gapAlongRoute(route, a, b)` → signed metres between two road positions along
  a given route. This is what replaces `loopDelta()`, and it is what lets the
  chase logic distinguish "the cop is 40 m behind me" from "the cop is 900 m
  away on a parallel street".
- `edgesAhead(road, heading, distance)` → the edges a car travelling this way
  will plausibly reach, for spawning roadblocks and streaming.

### 7.3 `systems/UpgradeSystem.js` — customisation state

**Already implemented** — it is the integration contract the rest of the game
reads, so it was built first. Study it before touching `Physics.js`.

- **Zero Three.js imports.** Plain data, unit-testable with no DOM.
- **Performance parts change numbers only; visual parts change appearance
  only.** A body kit must never grant grip. Mixing the two is how an upgrade
  tree becomes impossible to balance, and it makes the garage UI lie.
- Six performance categories (`engine`, `turbo`, `nitrous`, `tires`, `brakes`,
  `weight`), four tiers each (Stock / Street / Sport / Pro), applied as
  multipliers against `CAR_BASE` in a **fixed key order**, so the resolved stats
  are independent of purchase order.
- `getStats()` returns a **frozen, cached** stat block. Nothing may mutate it —
  `Police.js` copies it to apply rubber-banding, and a shared mutable block
  would leak cop boosts into the player's car. The cache is invalidated by any
  purchase.
- `getRatings()` derives the garage's 0–10 bars from the stat block, so the UI
  can never disagree with what the car actually does.
- `deserialize()` is deliberately tolerant: unknown categories and out-of-range
  tiers are ignored rather than thrown, so adding a category later does not
  brick existing saves.

### 7.4 `entities/Police.js` + `systems/HeatSystem.js` — the chase

Split on purpose: `Police` knows how to *drive*, `HeatSystem` decides *how many
and when*. You can retune chase pacing without touching steering code.

**Per-unit states.** `PATROL → SPOTTED → PURSUIT → {PIT, BLOCKING} → SEARCHING`,
plus `DISABLED`. `SPOTTED` is a deliberate ~0.8 s reaction pause with the
lightbar coming up: instant reaction reads as cheating.

**Steering — now a routing problem.** In an open world a cop cannot just follow
one curve: at every intersection it has to *choose*. So:

1. `RoadNetwork.route(cop.roadHint, player.roadHint)` gives a path of edge ids.
   Recompute it only when the player changes edge or the cop finishes one, never
   every frame.
2. Take a lookahead point along that route, not the player's current position —
   aiming at where the player is *now* makes cops cut corners into walls.
   Lookahead grows with speed.
3. Blend the aim point toward the player's actual position as the gap closes, so
   the final approach is direct.
4. `steer = clamp(headingError · 2.2, −1, 1)`; throttle drops when the error is
   large so cops brake for corners instead of understeering into a wall.

This routing also buys the chase its best moments for free: cops can take a
*different* route and cut you off, which a single-spline chase cannot do.

**Rubber-banding.** Scale a *copy* of the cop's stat block by
`POLICE.rubberBand`, driven by `RoadNetwork.gapAlongRoute()` — the along-route
gap, not straight-line distance, or a cop on a parallel street reads as
"close" and gets throttled for no reason. Far behind → up to 1.22×. Very
close → 0.9×, which stops cops welding to the player's bumper.

**Tactics** unlock by heat (`POLICE.unlock`): PIT at 2, roadblocks at 3, spike
strips at 4, helicopter at 5. Announce a roadblock on the HUD ~2 s before it is
visible.

**Pooling.** Pre-build the maximum fleet at load. Never construct a `Car`
mid-chase; building geometry during a pursuit stutters.

**Escape and bust are the emotional core, so both need generous, readable
timers.** Escape: unseen and beyond `HEAT.evadeDistance` for `evadeSeconds`, and
*any* line of sight resets the timer — that reset is the tension. Bust: cops
within `bustRadius` while under `bustSpeed` for `bustSeconds`, and any of the
three breaking resets it, so nudging free of a pin always works. A bust must
never feel like it happened to the player without warning.

The open world makes escape far more interesting than a loop did: breaking line
of sight now means turning off the main drag into a side street, which rewards
exactly the map knowledge pillar 5 is built around. Use **straight-line
distance plus line of sight** for the evade test, not route distance — hiding
one block away with a building between you should count as hidden.

**Cash is only committed on escape.** Being busted forfeits the run, which is
what makes the decision to keep pushing interesting.

---

### 7.5 `systems/RaceSystem.js` — seeded races on a fixed map

The variety that seeded *tracks* would have given comes from here instead: the
city is constant, the **routes** through it are generated.

- A race is a **seeded sequence of checkpoints** — `RoadPosition`s on the fixed
  network — plus a type (sprint point-to-point, circuit, or a chase-survival
  event) and a target time.
- Seed the sequence from `raceId`, so a given race is always the same for
  everyone and can be shared, compared and leaderboarded, while the *catalogue*
  of races is cheap to expand.
- Generate a route by picking a start node and walking the graph to checkpoints
  a target distance apart. **Validate every generated route by routing between
  consecutive checkpoints** and rejecting any that is unreachable or that
  doubles back on itself — an unwinnable race is much worse than a boring one.
- Checkpoints render as tall neon gates so they read from a distance, and the
  HUD needs a next-checkpoint direction indicator; in an open world the player
  genuinely does not know which way to go, and this is the difference between
  "learning the city" and "lost".
- Unlocks and results persist through `SaveSystem` (which is implemented and
  tested). Progression gates new race events, **not** new maps.

### 7.6 `entities/Traffic.js` — civilian cars

Traffic density is a **player-facing setting** (`TRAFFIC.density`: `off`,
`low`, `medium`, `high`), not a fixed constant — it is the main difficulty and
performance dial the player controls.

- Reuses `Car.js` with `isPlayer: false, isPolice: false`. Traffic does not need
  the full physics step: a much cheaper "follow my edge at a target speed" mover
  is enough, and using full `Physics.step()` for thirty cars will not fit the
  budget. Keep them on rails, obeying lanes.
- **Spawn and despawn by distance from the player** on edges ahead
  (`RoadNetwork.edgesAhead`). Pool them exactly as `Police` pools cruisers —
  never construct a `Car` while driving.
- Traffic must be **avoidable, never unfair**: keep it out of the racing line on
  blind corners, and never spawn one in front of the player at speed.
- Near-misses feed `HEAT.gain.nearMissTraffic`. Ramming one costs speed and adds
  heat.

## 8. Art direction

Wet night streets. Sodium orange and neon cyan reflected in black tarmac. Long
smeared highlights. Almost no daylight colour anywhere.

**Palette** — canonical in `Config.js` as `PALETTE`, mirrored in `styles.css` as
custom properties. Keep both in sync.

| Role | Hex |
| --- | --- |
| void / fog / clear | `#05060f` |
| asphalt | `#0b0d16` |
| neon cyan | `#00e5ff` |
| neon magenta | `#ff2d95` |
| violet | `#7b2dff` |
| sodium amber | `#ffb300` |
| police red / blue | `#ff1744` / `#2979ff` |
| ink (UI text) | `#e8ecff` |

**The wet-road read** is a `MeshStandardMaterial` with low roughness (~0.35) and
high metalness (~0.55). The low roughness is what makes neon emitters smear
along the tarmac. Getting this wrong makes the whole scene look like grey felt.

**Bloom is not decoration.** Every neon material is authored assuming it. Build
the composer chain before tuning any material. Threshold above 0.7 loses the
kerb strips; below 0.5 the entire road glows and reads as fog.

**Kerbs and signage use `MeshBasicMaterial`,** not Standard, so bloom picks them
up at full intensity without needing a light.

**Light budget — five, total.** Every extra light recompiles shaders and costs a
full-scene pass in the forward renderer.

1. `HemisphereLight` sky `#1a1f4a` → ground `#05060f`, 0.35. Keeps unlit
   building faces from reading as pure black.
2. `DirectionalLight` cold moonlight, 0.25, **`castShadow = false`**.
3. `PointLight` player underglow, colour from the visual upgrades.
4. `PointLight` player headlight pool, warm amber, follows the car.
5. Reserved for the nearest police lightbar (`Police.js` claims it).

**Streetlights and building windows are emissive quads and textures, never
lights.** Four hundred `PointLight`s will not run at any resolution.

---

## 9. Implementation phases

Work in order. Each phase ends in something runnable and visibly better than the
last — do not start a phase until the previous one's acceptance criteria pass.

### Phase 0 — Scaffold ✅ DONE

Structure, `package.json`, Vite, `Config.js`, `Loop`, `Input`, `Renderer`,
`UpgradeSystem`, `SaveSystem`, utils, and a `NeonGrid` preview scene.

*Verified:* `npm run dev` boots with no console errors, renders a neon grid and
a rotating placeholder chassis at 60+ fps; `npm run build` and `npm run lint`
both clean; `UpgradeSystem` stat resolution and save round-trip tested.

### Phase 1 — The car moves ✅ DONE

`Physics.js` stages 1–7, `Car.build()` / `Car.syncTransform()`, the `?vectors`
overlay, and a minimal `CameraRig` follow camera.

*Verified* by an independent headless acceptance run (14/14) that drives the car
with real key events rather than inspecting code: throttle 0 → 18.2 m/s in 3 s;
brake 18.2 → 0.3 m/s in 1.5 s; reverse at −7.7 m/s steering opposite to forward;
handbrake drift entry at 0.77 rad slip, sustaining after release, and
**recovering to 0.000 rad slip with no residual yaw**; nitrous 16 → 31 m/s
while draining; `step()` bit-exact deterministic across two identical 600-step
runs; `driftScore` exactly 0 in a straight line and accumulating in a slide.

**Still open — feel, not correctness.** A provoked drift reaches ~1.5 rad
(86°) of slip: the car goes very nearly broadside before it recovers. It is
stable and it always comes back, but that is a rally-style pendulum rather than
the tighter 20–40° slide the NFSU2 reference holds. Nobody has judged it with
hands on the keyboard yet, and headless assertions cannot: **§7.1's tuning table
is the tool for this, and `driftYawAssist` ↓ / `lateralGrip` ↑ is the first
thing to try.**

### Phase 1b — Drift feel and two-player input ✅ DONE

The context-sensitive drift replacing the grip-only handbrake, plus per-player
input.

*Verified* across three independent suites, all green: the drift lock holds
when you steer against it (yaw stayed +1.27 rad/s while opposing); holding
through a straightened wheel never flips to e-brake; the tier ladder resolves
blue/orange/purple at 0.61/1.51/2.61 s of charge and each pays measurably more
speed (5.18 / 10.21 / 18.33 m/s gained, against 3.27 on throttle alone);
e-brake stops from 16.2 m/s in 1.02 s over 8.1 m; burnout holds under 3 m/s
while `wheelSpin` climbs 36 rad, and releasing launches to 9.3 m/s; a boost
survives being chained into the opposite drift.

**Still open — feel, not correctness.** The same broadside drift noted in
Phase 1 is still there, and `DRIFT.outerSteerFactor` (how much steering away
widens the arc) is a pure judgement call nobody has driven yet. The steer
modulation pins the sign and only scales magnitude; an alternative reading
would have opposing input actively unwind the yaw. Drive it before retuning.

*Not in scope here:* split-screen rendering — two viewports, two cameras, a
split render target. This phase only makes the input layer ready for it.

### Phase 2a — The road network ✅ DONE

`RoadNetwork.js`: graph generation, the spatial index, `sampleAt`, `getPose`,
routing, and the `?network` overlay. `Track.js` builds crude chunked ribbons
from it and delegates the queries through.

*Verified* by an independent Node validator (21/21) plus three browser suites
(19/19, 17/17, 4/4). **225 nodes, 417 edges, 65 km of road, generated in 56 ms.**
Same seed byte-identical across separate instances; a different seed differs.
Fully connected — 225/225 reachable. `sampleAt()` **3.19 µs/call, 26× faster
than a naive all-edges scan**, ~1.1% of the fixed-step budget with 30 cars, and
allocation-free. 300/300 random routes succeed and every one is a genuinely
connected chain. Round-trips `getPose`→`sampleAt` to within 0.00 m.

**Known simplifications, all Phase 2b's to revisit:**
- Every edge is a straight two-point curve, so streets kink at junctions rather
  than blending through them. Explicitly allowed by "geometry can stay crude".
- An edge straddling a chunk boundary is not split; its whole ribbon goes to
  the chunk containing its midpoint. Affects culling precision on long
  arterials, never correctness.
- The road is unlit black ribbon — the five-light rig and materials are 2b.

### Phase 2b — The city looks like a city

Road geometry proper (lane markings via the `fwidth` technique from
`NeonGrid.js`), intersection polygons, kerb neon, guardrails, buildings as one
`InstancedMesh`, streetlights as emissive quads, and the `Environment`
five-light rig. Delete `SCAFFOLD_PREVIEW` and `_buildPlaceholder()` from
`Game.js`.

*Acceptance:* The city reads as a place — you can tell one junction from another
and navigate by landmark, which pillar 5 depends on. Going off-road is *felt*,
not just reported. Holds the §10 draw-call budget.

### Phase 3a — It reads like a game

Complete `CameraRig` (velocity-following, FOV ramp, drift offset, shake, modes),
`PostFX` bloom, `HUD`, `Garage`, and `Car.applyVisuals()`.

*Acceptance:* The chase camera follows velocity rather than heading and stays
readable through a long drift. FOV opens with speed. Bloom makes the neon glow.
The HUD shows speed, nitrous and drift score with no measurable frame cost — put
the diff-and-write rule in `HUD.js`'s header into practice. The garage lets you
buy every performance tier and see paint, rims and underglow change **live**.

### Phase 3b — Races

`RaceSystem.js`: seeded checkpoint routes, neon checkpoint gates, the HUD's
next-checkpoint direction indicator, timing, results and unlock persistence.

*Acceptance:* You can start a race, follow it without getting lost, finish it,
and see the result saved. Reloading keeps your unlocks. The same `raceId` always
produces the same route. No generated race is unwinnable — validate a few
hundred of them in a script, not by hand.

### Phase 4 — The chase

`Police.build()` / `update()` with graph routing, the full `HeatSystem` state
machine, and `Physics.resolveCollision()` / `applyBarrier()`.

*Acceptance:* A patrol spots you, a chase starts, heat climbs, more cruisers
arrive, and roadblocks and spike strips appear at the right levels. Cops route
around the block to cut you off rather than only trailing you. You can be
busted, and you can escape — and both are legible on the HUD several seconds
before they resolve. Cash accrues and is committed only on escape. Eight
cruisers plus the player hold 60 fps.

### Phase 5 — Traffic, sound and feel

`Traffic.js` with the `off`/`low`/`medium`/`high` density setting. Engine loop
with pitch tied to speed, tyre squeal keyed to slip angle, siren with distance
falloff and Doppler, nitrous whoosh, collision thumps. Tyre smoke and nitrous
particles. Skid decals.

*Acceptance:* Traffic at `high` still holds 60 fps alongside a full pursuit, and
never spawns unfairly in front of the player. Audio makes the same car feel
faster. Nothing crackles under rapid throttle changes. All audio starts from a
user gesture, per browser autoplay policy.

### Phase 6 — Polish

Rain (one additive `Points` cloud parented to the camera, plus a road roughness
drop — do not simulate droplets). Radial speed blur. Touch controls. Lap timing
and a leaderboard in `localStorage`. Reduced-motion pass. Real accessibility
sweep on the DOM UI.

---

## 10. Performance budget

Target 60 fps at 1080p on integrated graphics, with eight cruisers plus the
player in a pursuit.

| Budget | Limit |
| --- | --- |
| draw calls | < 150 |
| triangles | < 250 k |
| lights | 5 |
| shadow maps | 0 |
| per-frame allocation in update/render | 0 |
| bundle (own code, gzipped) | < 60 kB |

Buildings are a single `InstancedMesh`. The road is chunked so it can be
frustum-culled. Bloom runs at half resolution above a 1.5 pixel ratio.
`RENDER.maxPixelRatio` is capped at 2 — above that costs a great deal and buys
nothing at this art style.

**The open world moved the bottleneck.** Two things now dominate, and both are
per-car-per-fixed-step, so they scale with traffic density:

- `RoadNetwork.sampleAt()` — must be O(1) via the spatial grid plus the edge
  hint. Profile it with 30 cars at Phase 2a, not later.
- Route caching — cops must not re-run a graph search per frame.

Traffic cars use the cheap on-rails mover, not the full `Physics.step()`, and at
`high` density there should be no more than ~30 of them alive at once. Everything
beyond the player's surroundings is despawned, not simulated.

---

## 11. Verifying changes

`npm run lint` and `npm run build` are the floor, not the ceiling. Neither
catches a shader that silently renders nothing, which is the most common failure
mode in this codebase.

**Headless smoke test.** Chromium is available at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Launch it with
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, load
`localhost:5173/?debug`, and assert: no `pageerror`, the loading overlay is
hidden, `window.game.loop.fps` is sane, and — critically — **confirm that
non-background pixels exist where you expect them.** Checking the pixels is what
catches "renders black"; neither the linter nor the build ever will.

Two ways to read the pixels, and the difference matters:

- `page.screenshot()` captures the composited frame and always works. Reduce it
  to a colour histogram or a coarse ASCII brightness map — that pinpoints
  *where* on screen something drew far faster than eyeballing an image.
- `gl.readPixels` gives exact values, but the drawing buffer is not preserved
  after the browser presents a frame, so reading it "whenever" returns a cleared
  buffer and a false negative. Only use it immediately after forcing a render
  yourself: `game.loop.stop()`, park the camera, then
  `game.renderer.instance.render(game.scene, game.camera)` and read. This needs
  `?debug` for the `window.game` handle.

**When something renders nothing, bisect the shader, do not theorise.** Swap the
fragment shader for a solid colour to confirm the draw happens at all, then
reintroduce terms one at a time. This is much faster than reasoning about
blending and tone mapping.

Note that SwiftShader is a software rasteriser: it renders GL line primitives at
grazing angles unreliably, so do not trust `LineSegments`-based helpers there —
and do not build any visual feature on them (see §12).

---

## 12. Known traps

Each of these cost real time. Read before debugging.

**Per-vertex distance on a large, sparsely-tessellated surface.** A 4 km ground
quad has four vertices. Computing `length(worldPos − cameraPosition)` in the
*vertex* shader and interpolating it reports ~2000 m even for ground directly
under the camera, which saturates any fog term to 1.0 and discards every
fragment. Interpolate the **position** and take its length **per fragment**.
This bug blanked `NeonGrid` entirely; the Phase 2 road shader has the same
exposure.

**`THREE.GridHelper` and line primitives generally.** One pixel wide at any
distance, alias badly, cannot fade, and drop out at grazing angles on some
drivers and on software GL. Use the `fwidth`-based analytic grid in
`NeonGrid.js` instead — and reuse that technique for lane markings, which need
constant *pixel* width to stay crisp up close without turning into aliased noise
in the distance.

**Vite 8 bundles with Rolldown**, which rejects the object form of
`manualChunks`. Use the function form. Vite 8 also needs Node ≥ 20.19.

**Backticks inside a GLSL template literal** terminate the JavaScript template
early. Never use them in shader comments.

**`localStorage` throws rather than returning null** in Safari private mode,
with site data blocked, and when over quota. Every access in `SaveSystem.js` is
wrapped for this reason; do not "simplify" it.

**Angle wrapping.** `MathUtils.wrapAngle` returns `[−π, π)` — exactly +π comes
back as −π. Harmless for steering error, but do not depend on the sign at the
boundary.

---

## 13. Open questions

Flagging rather than guessing. Reasonable defaults are in place.

1. **Braking rating saturates** at 10/10 when fully upgraded. Either widen
   `getRatings()`'s braking range or reduce the tier-3 brake multiplier so the
   bar stays informative.
2. **Navigation aid.** An open world needs *some* wayfinding beyond the
   checkpoint indicator. A minimap is the obvious answer and the least in
   keeping with "minimalist"; neon direction arrows painted on the road might
   do the whole job. Decide before Phase 3b.
3. **Do cops know the map better than the player?** They have perfect routing,
   which risks feeling unfair. Consider deliberately degrading their routing —
   a chance to take the second-best turn — as a difficulty dial.
4. **Where does free roam end and a race begin?** Driving into a neon start gate
   is the classic answer and needs no menu. Unconfirmed.

---

## 14. Decision log

Decisions already made, with the reasoning, so they are not silently reopened.

**2026-09-10 — Open world, not a set of circuits.** Superseded an earlier
decision to ship eight seeded procedural tracks with unlocks. One fixed,
permanent city instead, with seeded checkpoint *routes* forming races (§7.2,
§7.5). Rationale: a map you can learn creates a real skill curve, which
regenerated tracks cannot — knowing the shortcuts *is* the mastery. Recorded as
design pillar 5.

*What it cost:* Phase 2 roughly doubled and split into 2a/2b. `sampleAt()`
became a nearest-point query against a graph rather than one curve; the police
AI needs genuine route-finding; the global lap parameter `t` and `loopDelta()`
were deleted in favour of the opaque `RoadPosition`. Accepted knowingly — it is
the better game, and the routing also gives cops the ability to cut the player
off, which a single-spline chase could never do.

**2026-09-10 — Civilian traffic is in scope,** with density as a player setting
(`off`/`low`/`medium`/`high`), moved out of the non-goals list (§7.6, Phase 5).
It is also the main performance dial available to the player.

**2026-09-10 — Top speed stays as-is.** ~329 km/h fully upgraded is close enough
to the 250–280 reference. Revisit only if it is uncontrollable in play; the soft
limiter in §7.1 is the one place to tune it.

**2026-09-10 — Progression gates race events, not maps.** There is only one map.
`SaveSystem` is implemented and tested, so unlock persistence is available.

**2026-09-10 — `CameraRig` gets a minimal follow camera in Phase 1,** ahead of
its Phase 3a slot. Phase 1's acceptance criteria are untestable without a camera
that tracks the car, and the scaffold's orbiting preview camera fights it. The
Phase 3a features (velocity-following, FOV ramp, shake, modes) remain
`TODO(phase-3)`.

**2026-09-10 — Space is context-sensitive, not tap-versus-hold.** Steering →
drift, straight → e-brake, stopped with throttle → burnout (§7.1). Chosen over
a tap/hold timer specifically to avoid input latency on the game's defining
key, and over a second key to keep both players' hands small enough to share a
keyboard.

**2026-09-10 — Mario Kart's committed drift, adopted deliberately.** Direction
locks on entry, steering only modulates the arc, and a charge ladder pays out
a mini-turbo on release. The old model — hold a key, get less grip, slide
indefinitely — had no commitment and therefore no skill expression.

**2026-09-10 — Mini-turbo and nitrous both reward drifting.** Different
timescales: instant per-corner versus banked and spent. If they ever feel
redundant, shrink the mini-turbo, because pillar 1 makes nitrous-from-drifting
load-bearing.

**2026-09-10 — No Ctrl or Alt key bindings, ever.** `Ctrl+W` closes the tab and
cannot be blocked in Chrome outside fullscreen, and player 1 holds `W`. Player
2's extra actions are on the numpad. Superseded the original proposal of
`LCtrl`/`LAlt` and `RCtrl`/`RAlt`.

**2026-09-10 — Drift entry reads `steerRaw`, not the ramped axis.** Pressing A
and Space together produced an e-brake, because the smoothed steer axis was
still at 0.07 when the press edge fired. Input now publishes instantaneous
intent alongside the smoothed value, and anything edge-triggered reads it.

**2026-09-10 — Burnout hold is a fraction of engine force, not a fixed
newton figure.** No absolute value works across an 11000–20200 N engine range.

**2026-09-10 — A mini-turbo survives chaining into the next drift.** The boost
timer runs independently of `driftState`, so an S-bend rewards rather than
punishes committing early.

**2026-09-10 — City size pinned at 2 km square (4 km²).** Roughly a 14×14 block
grid: ~225 intersections and ~420 streets before pruning. Crossing it flat out
takes about 36 seconds — long enough for a pursuit to develop, short enough to
hold in your head, which is what pillar 5 requires. Generation happens at load,
so growing it costs boot time as well as memorability.

**2026-09-10 — `RoadNetwork` stays free of Three.js materials and the scene.**
It is constructible under Node with no WebGL context, so graph generation,
connectivity and routing can be unit-tested in milliseconds instead of through
a browser. `Track.js` owns all geometry.

**2026-09-10 — `route()` resolves direction ambiguity by trying all four
endpoint pairs.** A `RoadPosition` names a place, not a direction of travel, so
"route from this edge" does not say which of its two nodes to leave by. `route()`
tries both endpoints of the from-edge against both of the to-edge, weights each
by real partial-edge distance, and keeps the cheapest — with an A* node-pair
cache underneath so the four searches are not four times the cost. **Phase 4
should check this is what the pursuit AI wants**: a cop that should never
U-turn may need a direction-aware variant rather than the cheapest path.

**2026-09-10 — `sampleAt()` never trusts its hint blindly.** The first
implementation accepted the hinted edge whenever it was within a block, without
checking what was actually near the queried position — which passes every
ordinary test and then puts a respawned or teleported car on the wrong street.
It now always also tests the 3×3 spatial cells around the true position. Cost
rose from 0.6 µs to 3.2 µs per call, still 26× faster than a naive scan, and
worth every nanosecond: a wrong edge silently corrupts routing, rubber-banding
and race progress downstream.

**2026-09-10 — Position after N seconds is not a valid proxy for turn
direction.** The Phase 1 suite asserted steering by x-displacement after three
seconds at full lock. Once real roads existed the car could rotate past 180°,
flipping the sign of its net displacement and making correct steering look
inverted. The check now measures heading change over 0.5 s, taking the shortest
signed path so the ±π seam cannot corrupt it. The related flat-earth assertion
(`y ≈ 0`) became "sits on the road surface", since the city now has elevation.
