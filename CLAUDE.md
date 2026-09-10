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

### Explicit non-goals

Simulation-grade physics. Licensed cars. Multiplayer. Open world. A gearbox with
a clutch. Damage modelling beyond a single 0–1 scalar. Mobile-first controls
(touch is Phase 6, and it is a courtesy, not a target).

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
| `?spline` | draws the track spline and its sample points |
| `?freecam` | detaches the camera from the car |
| `?nofx` | bypasses the post-processing chain entirely |

Flags combine: `localhost:5173/?debug&spline&stats`.

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
    │   ├── Track.js        procedural spline road + neon city dressing
    │   └── Environment.js  lights, fog, weather
    ├── entities/
    │   ├── Car.js          one vehicle: physics state + mesh + customisation
    │   └── Police.js       pursuit fleet and its AI state machine
    ├── systems/
    │   ├── UpgradeSystem.js  performance + visual state → resolved stat block
    │   ├── HeatSystem.js     pursuit lifecycle, heat, cash, bust/escape
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
| `core/Input.js` | IMPLEMENTED |
| `core/Game.js` | IMPLEMENTED (wiring); contains scaffold preview to delete |
| `render/Renderer.js` | IMPLEMENTED |
| `render/NeonGrid.js` | IMPLEMENTED |
| `systems/UpgradeSystem.js` | IMPLEMENTED |
| `systems/SaveSystem.js` | IMPLEMENTED |
| `utils/MathUtils.js` | IMPLEMENTED |
| `utils/Random.js` | IMPLEMENTED |
| `physics/Physics.js` | STUB — phase 1 |
| `entities/Car.js` | STUB — phase 1 / 3 |
| `world/Track.js` | STUB — phase 2 |
| `world/Environment.js` | PARTIAL — placeholder lights, phase 2 |
| `render/CameraRig.js` | STUB — phase 3 |
| `render/PostFX.js` | STUB — phase 3 (falls through to plain render) |
| `ui/HUD.js` | STUB — phase 3 |
| `ui/Garage.js` | STUB — phase 3 |
| `entities/Police.js` | STUB — phase 4 |
| `systems/HeatSystem.js` | STUB — phase 4 |

---

## 5. Conventions

**Units are SI.** Metres, seconds, kilograms, radians, newtons. Speed is m/s
everywhere internally; only `HUD.js` converts for display.

**Axes.** +X right, +Y up, −Z forward. A car at rest with `heading = 0` faces
−Z. Heading increases counter-clockwise viewed from above.

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

## 7. The four core subsystems

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

### 7.2 `world/Track.js` — road geometry

The track is **one closed `CatmullRomCurve3`**. Road mesh, kerb neon,
guardrails, buildings, streetlights, checkpoints, cop spawn anchors and the
off-road test are all derived from that single curve. Derive new world furniture
from the spline rather than hand-placing it, so changing `TRACK.seed`
regenerates a coherent city.

- **Generation.** Walk `TRACK.controlPointCount` angles around a circle of
  `TRACK.loopRadius`; jitter each radially and vertically; reject candidates
  whose turn angle exceeds ~70°, which is what yields drivable sweepers rather
  than hairpin spaghetti. Deterministic via `utils/Random.js`.
- **Sampling.** Use `curve.getSpacedPoints()`, **not** `getPoints()`.
  Arc-length-even samples are what stop the road mesh bunching in corners and
  what make `t` usable as a race position.
- **Mesh.** For each sample, emit two vertices at
  `point ± side · roadWidth / 2` where `side = normalize(cross(tangent, UP))`.
  UV `v` in metres / 8 so dashes tile at a fixed real-world scale.
  Build **`TRACK.chunkCount` separate meshes**, not one giant geometry: a single
  mesh can never be frustum-culled, so the GPU transforms the whole city every
  frame.
- **Query API.** `sampleAt()` is called for every car every fixed step, so it
  must be O(1) and allocation-free. Precompute a ~40 m uniform spatial grid from
  cell → candidate sample indices at build time and test only those. Accept a
  `hintT` so a car can search a narrow window around its last known position.
- `loopDelta(fromT, toT)` (already implemented) gives signed shortest distance
  around the loop. The pursuit AI needs it; a naive `toT − fromT` is wrong
  across the seam.

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

**Steering.** Pure pursuit against a **lookahead point on the spline**, not the
player's current position — aiming at where the player is now makes cops cut
corners into walls. Blend toward the player's actual position as the gap closes.
Throttle drops when the heading error is large so cops brake for corners.

**Rubber-banding.** Scale a *copy* of the cop's stat block by
`POLICE.rubberBand` from the along-track gap. Far behind → up to 1.22×. Very
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

**Cash is only committed on escape.** Being busted forfeits the run, which is
what makes the decision to keep pushing interesting.

---

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

### Phase 1 — The car moves

Implement `Physics.js` stages 1–7 (minus the surface query — stub `sampleAt` as
flat ground at y = 0), and `Car.build()` / `Car.syncTransform()`.

*Acceptance:* On flat ground you can accelerate, brake, reverse, and hold a
sustained handbrake drift that recovers when you straighten out. Body roll reads
under cornering. Wheels steer and spin. `?vectors` shows force vectors pointing
where you would expect. Feel is tuned to §7.1's table — **spend real time here;
if the car is not fun on an empty plane, no amount of track will save it.**

### Phase 2 — The city

Implement `Track.build()`, `sampleAt()`, `getPose()`, and the `Environment`
five-light rig. Delete `SCAFFOLD_PREVIEW` and `_buildPlaceholder()` from
`Game.js`.

*Acceptance:* A closed neon circuit you can drive a full lap of. Going off-road
is felt, not just reported. `sampleAt()` costs O(1) — profile it with 8 cars
before moving on. `?spline` overlays the curve. Changing `TRACK.seed` produces a
different but equally drivable city.

### Phase 3 — It looks and reads like a game

`CameraRig`, `PostFX` (bloom), `HUD`, `Garage`, and `Car.applyVisuals()`.

*Acceptance:* The chase camera follows velocity rather than heading and stays
readable through a long drift. FOV opens with speed. Bloom makes the neon glow.
The HUD shows speed, nitrous and drift score without measurable frame cost — put
the diff-and-write rule in `HUD.js`'s header into practice. The garage lets you
buy every performance tier and see paint, rims and underglow change **live**.

### Phase 4 — The chase

`Police.build()` / `update()` and the full `HeatSystem` state machine, plus
`Physics.resolveCollision()` and `applyBarrier()`.

*Acceptance:* A patrol spots you, a chase starts, heat climbs, more cruisers
arrive, and roadblocks and spike strips appear at the right levels. You can be
busted, and you can escape — and both are legible on the HUD several seconds
before they resolve. Cash accrues and is committed only on escape. Eight
cruisers plus the player hold 60 fps.

### Phase 5 — Sound and feel

Engine loop with pitch tied to speed, tyre squeal keyed to slip angle, siren
with distance falloff and Doppler, nitrous whoosh, collision thumps. Tyre smoke
and nitrous particles. Skid decals on the road.

*Acceptance:* Audio makes the same car feel faster. Nothing crackles under rapid
throttle changes. All audio starts from a user gesture, per browser autoplay
policy.

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

Flagging rather than guessing. Reasonable defaults are in place; these are worth
a decision before Phase 3 locks the feel in.

1. **Top speed.** Fully-upgraded `topSpeed` currently resolves to ~329 km/h
   (engine ×1.18 × turbo ×1.25 × 62 m/s). That is fast even for arcade — NFSU2's
   maxed cars sat nearer 250–280. If it feels uncontrollable at Phase 1, trim
   the tier-3 `topSpeed` multipliers rather than adding a speed clamp; the soft
   limiter in §7.1 exists precisely so there is one place to tune this.
2. **Braking rating saturates** at 10/10 when fully upgraded. Either widen
   `getRatings()`'s braking range or reduce the tier-3 brake multiplier so the
   bar remains informative.
3. **Single circuit or several?** Everything derives from `TRACK.seed`, so
   multiple tracks are nearly free. Not yet decided whether they are a menu
   choice, unlocks, or one endless loop.
4. **Traffic.** `Car.js` is already generic enough to serve civilian traffic.
   Traffic adds a lot of chase texture and a lot of collision cases. Currently
   out of scope; revisit after Phase 4.
5. **Race events.** Hot Pursuit has structured races; this brief is free-roam
   plus chases. Sprints between spline checkpoints would be cheap to add.
