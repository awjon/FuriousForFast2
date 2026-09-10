/**
 * Config.js — single source of truth for tuning constants.
 *
 * RULES
 *  - Every magic number that a designer might want to tweak lives here, not
 *    inline in a system. If you find yourself typing a float into Physics.js,
 *    it belongs in this file.
 *  - This module imports nothing. It must stay side-effect free and safe to
 *    import from a unit test with no DOM and no WebGL context.
 *  - Units are SI: metres, seconds, kilograms, radians. Speed is m/s
 *    internally; only the HUD converts to km/h (× 3.6) or mph (× 2.23694).
 */

/** World axes: +X right, +Y up, −Z forward. A car at rest faces −Z. */
export const AXES = Object.freeze({
  UP: Object.freeze({ x: 0, y: 1, z: 0 }),
  FORWARD: Object.freeze({ x: 0, y: 0, z: -1 }),
});

export const PALETTE = Object.freeze({
  void: 0x05060f,
  asphalt: 0x0b0d16,
  cyan: 0x00e5ff,
  magenta: 0xff2d95,
  violet: 0x7b2dff,
  amber: 0xffb300,
  policeRed: 0xff1744,
  policeBlue: 0x2979ff,
  ink: 0xe8ecff,
});

export const RENDER = Object.freeze({
  fov: 68,
  near: 0.3,
  far: 900,
  /** Clamped device pixel ratio. Above 2 costs a lot and buys nothing here. */
  maxPixelRatio: 2,
  fogDensity: 0.012,
  fogColor: PALETTE.void,
  bloom: Object.freeze({ strength: 0.9, radius: 0.5, threshold: 0.7 }),
  /** Cheap fake-wet look: how strongly the road reflects neon emitters. */
  roadReflectivity: 0.35,
});

export const LOOP = Object.freeze({
  /** Physics runs on a fixed step; rendering is variable and interpolates. */
  fixedStep: 1 / 120,
  /** Never simulate more than this much wall time in one frame (spiral guard). */
  maxFrameTime: 0.25,
});

/**
 * Baseline car — a STOCK vehicle with every upgrade at tier 0.
 * UpgradeSystem.getStats() multiplies/offsets these; Physics never reads this
 * object directly, it reads the resolved stat block.
 */
export const CAR_BASE = Object.freeze({
  mass: 1400, // kg
  /** Peak drive force at the wheels, newtons. Tuned, not derived from torque. */
  enginePower: 11000,
  /** Speed (m/s) at which engine force has fallen to zero — the soft limiter. */
  topSpeed: 62, // ≈ 223 km/h
  brakeForce: 18000,
  handbrakeForce: 9000,
  /** Aerodynamic drag: F = −dragCoefficient · v · |v| */
  dragCoefficient: 2.6,
  /** Rolling resistance: F = −rollingResistance · v */
  rollingResistance: 12,
  /** Max lateral force the tyres hold before the car starts sliding, newtons. */
  lateralGrip: 16500,
  /** Grip multiplier while the handbrake is held — this is what starts drifts. */
  handbrakeGripMultiplier: 0.32,
  /** Grip multiplier off the road surface. */
  offroadGripMultiplier: 0.55,
  offroadDragMultiplier: 2.4,
  /** Steering, radians. Full lock at a standstill. */
  maxSteerAngle: 0.62,
  /** Steering authority falls off with speed: factor = 1/(1 + speed·falloff). */
  steerSpeedFalloff: 0.028,
  /** How fast the steer input approaches the target, per second. */
  steerResponse: 7.0,
  /** Yaw damping applied when not drifting; keeps the car from oscillating. */
  yawDamping: 4.2,
  /** Slip angle (radians) past which the car is considered to be drifting. */
  driftThreshold: 0.22,
  /** Extra yaw the car keeps while drifting — the arcade "it rotates" feel. */
  driftYawAssist: 1.35,
  /** Downforce-ish grip gain with speed, keeps high-speed cornering stable. */
  gripSpeedGain: 0.006,
});

/**
 * Car geometry and cosmetic body motion.
 *
 * Deliberately SEPARATE from CAR_BASE: these describe how a car is drawn and
 * how it leans, and no upgrade tier may ever touch them. Keeping them out of
 * the resolved stat block is what enforces "visual parts change appearance
 * only" (see UpgradeSystem.js) — a body kit cannot accidentally grant grip if
 * grip does not live in the same object.
 */
const WHEELBASE = 2.7;

export const CAR_BODY = Object.freeze({
  /** Distance between axles, metres. The yaw bicycle model in Physics.js uses this. */
  wheelbase: WHEELBASE,
  /**
   * Longitudinal distance from the car's centre to each axle. DERIVED, not
   * typed twice: the wheel meshes and the physics model must never be able to
   * disagree about where the axles are.
   */
  axleOffset: WHEELBASE / 2,
  /**
   * Rolling radius, metres. Drives BOTH the wheel mesh and the spin rate in
   * Physics.js — these were previously two separate literals in two files that
   * a comment asked you to keep in sync by hand.
   */
  wheelRadius: 0.34,
  wheelWidth: 0.25,
  /** Lateral distance from the centreline to each wheel, metres. */
  halfTrack: 0.95,

  /** Cosmetic body lean. Purely visual — never fed back into the simulation. */
  maxRoll: 0.1, // radians (~5.7°) at full lateral grip saturation
  maxPitch: 0.05, // radians (~2.9°) at full braking force
  tiltResponse: 9.0, // damp rate, per second
});

/** Scaling for the `?vectors` debug overlay. Debug-only, never gameplay. */
export const DEBUG_DRAW = Object.freeze({
  velocityArrowScale: 0.15, // m/s -> metres of arrow
  forceArrowScale: 0.00025, // newtons -> metres of arrow
  minArrowLength: 0.4,
  arrowHeadLength: 0.35,
  arrowHeadWidth: 0.2,
});

export const NITROUS = Object.freeze({
  capacity: 100, // "units" — the HUD shows this as a bar
  drainPerSecond: 34,
  /** Refill rate while drifting; drifting is how you earn nitrous. */
  driftRefillPerSecond: 22,
  /** Passive trickle so a player who never drifts is not permanently dry. */
  passiveRefillPerSecond: 2.5,
  /** Additive drive force while active, newtons (before upgrade scaling). */
  boostForce: 9000,
  /** Minimum charge required to trigger a fresh boost. */
  minimumToEngage: 15,
});

/**
 * DRIFT — the context-sensitive Space key, Mario Kart style.
 *
 * Space does three different things depending on what else you are doing, so
 * there is never a tap-versus-hold timer and therefore never any input lag:
 *
 *   moving + steering  → COMMIT to a drift. Direction locks to the way you
 *                        were steering; you cannot flip it without releasing.
 *                        A charge meter builds, and releasing pays out a
 *                        mini-turbo sized by how long you held it.
 *   moving + straight  → E-BRAKE. Actually stops the car, which the old
 *                        grip-only handbrake never did.
 *   stopped + throttle → BURNOUT. Wheels spin, car barely moves, and letting
 *                        go launches you.
 *
 * The direction LOCK is what separates this from "reduced grip while held".
 * A lock you commit to and steer within is a decision; a grip multiplier is
 * just a slider. That commitment is what the charge meter rewards.
 */
export const DRIFT = Object.freeze({
  /** Minimum |steer| at the moment Space goes down to read it as a drift. */
  steerToEngage: 0.25,
  /** Below this speed Space is an e-brake or a burnout, never a drift. */
  minSpeed: 6, // m/s
  /** Grip multiplier while a drift is locked in — replaces handbrakeGripMultiplier. */
  gripMultiplier: 0.32,

  /**
   * Steering authority INSIDE a locked drift. Steering into the turn tightens
   * the arc, steering away widens it, but neither can straighten the car or
   * flip the drift. This band is the whole skill expression of the mechanic,
   * so tune these two before anything else.
   */
  innerSteerFactor: 1.0, // holding into the drift
  outerSteerFactor: 0.35, // holding against it

  /** Slip angle the car must exceed before the charge meter will build. */
  chargeSlipAngle: 0.25, // radians

  /**
   * Mini-turbo ladder — seconds of sustained drift to reach each tier, and
   * what it pays out. Mirrors Mario Kart's blue / orange / purple.
   * `color` drives the HUD meter and the exhaust flash in Phase 3a.
   */
  tiers: Object.freeze([
    Object.freeze({ name: 'blue', seconds: 0.6, force: 5200, duration: 0.55, color: 0x00e5ff }),
    Object.freeze({ name: 'orange', seconds: 1.5, force: 8600, duration: 0.9, color: 0xffb300 }),
    Object.freeze({ name: 'purple', seconds: 2.6, force: 13000, duration: 1.35, color: 0x7b2dff }),
  ]),

  /** E-BRAKE — Space with little or no steering. This one must actually stop you. */
  ebrakeForce: 22000, // newtons, stronger than CAR_BASE.brakeForce on purpose
  ebrakeGripMultiplier: 0.55, // slides a little, so it still reads as an e-brake

  /** BURNOUT — stopped, throttle pinned, Space held. */
  burnoutMaxSpeed: 3, // m/s; above this Space e-brakes instead
  /**
   * Fraction of engine force cancelled while roasting the tyres. A FRACTION,
   * not an absolute newton figure: engine power ranges from 11000 N stock to
   * over 20000 N fully upgraded, and no fixed hold force works across that.
   * 16000 N flat left a stock car frozen at exactly 0 m/s while a maxed one
   * accelerated past burnoutMaxSpeed and simply drove away.
   */
  burnoutHoldFactor: 0.92,
  burnoutWheelSpinRate: 45, // rad/s of visual wheel spin while roasting them
  burnoutChargePerSecond: 1.0,
  burnoutMaxCharge: 1.6, // seconds of charge worth banking
  burnoutLaunchForce: 7000, // newtons, scaled by charge, on release
  burnoutLaunchDuration: 0.7, // seconds
});

export const HEAT = Object.freeze({
  maxLevel: 5,
  /** Seconds of active pursuit needed to climb one heat level. */
  secondsPerLevel: 45,
  /** Heat gain multipliers for player behaviour. */
  gain: Object.freeze({
    ramCop: 0.35,
    wreckCop: 0.8,
    nearMissTraffic: 0.05,
    overSpeedPerSecond: 0.01,
  }),
  /** Pursuit escape: stay this far from every cop, unseen, for this long. */
  evadeDistance: 220, // metres
  evadeSeconds: 8,
  /** Bust: this many cops within this radius while under this speed, this long. */
  bustRadius: 9,
  bustSpeed: 6, // m/s
  bustSeconds: 3,
  /** Cooldown before patrols can spot the player again after an escape. */
  cooldownSeconds: 20,
});

export const POLICE = Object.freeze({
  /** Cruisers on-screen per heat level (index = heat level 0..5). */
  unitsPerHeat: Object.freeze([0, 2, 3, 4, 6, 8]),
  /** Speed advantage cops get when far behind, to keep chases tense. */
  rubberBand: Object.freeze({
    maxBoostMultiplier: 1.22,
    /** Distance (m) at which rubber-banding reaches full strength. */
    fullBoostDistance: 160,
    /** Inside this distance cops are slightly slowed so they cannot glue on. */
    easeOffDistance: 25,
    minBoostMultiplier: 0.9,
  }),
  /** Heat level at which each tactic unlocks. */
  unlock: Object.freeze({ pit: 2, roadblock: 3, spikeStrip: 4, helicopter: 5 }),
  pitRange: 6, // metres
  spawnAheadDistance: 400, // roadblocks spawn this far up the spline
  despawnDistance: 500,
});

export const CAMERA = Object.freeze({
  /** Chase camera offset in the car's local space. */
  chaseOffset: Object.freeze({ x: 0, y: 3.1, z: 7.4 }),
  lookAheadDistance: 9,
  /** Positional smoothing, per second. Higher = stiffer. */
  positionLerp: 6.5,
  rotationLerp: 8.0,
  /** FOV pushes out with speed for the sense of acceleration. */
  fovAtRest: 68,
  fovAtTopSpeed: 86,
  /** How far the camera swings out during a drift, radians. */
  driftYawOffset: 0.28,
  shake: Object.freeze({ collision: 0.5, nitrous: 0.12, decay: 4.0 }),
});

/**
 * WORLD — the one permanent city. Supersedes the old closed-loop TRACK group.
 *
 * ⚠ `seed` and `generatorVersion` are FROZEN once the map ships. Changing
 * either silently rebuilds the city and invalidates every player's route
 * knowledge, lap times and leaderboard (§7.2, pillar 5). If generation must
 * change after launch, bump `generatorVersion` and treat it as a NEW map, not
 * a patch.
 */
export const WORLD = Object.freeze({
  seed: 20025,
  generatorVersion: 1,

  /**
   * The city is `extent` × `extent` metres, centred on the origin. 2 km square
   * = 4 km²: crossing it flat out takes ~36 s, which is long enough for a
   * pursuit to develop and short enough to hold in your head. Bigger costs
   * load-time generation and makes the map harder to learn, which is the whole
   * point of pillar 5.
   */
  extent: 2000,

  /** Nominal spacing between intersections; ~14 blocks across at 2 km. */
  blockSize: 140,
  /** How far each intersection may wander off the perfect grid, metres. */
  blockJitter: 34,
  /** Vertical variation. Keep small — this is a street racer, not a hill climb. */
  elevationRange: 12,

  /** Reject edges shorter than this; they produce undrivable stubs. */
  minEdgeLength: 45,
  /** Reject junctions meeting at a sharper angle than this, radians (~31°). */
  minJunctionAngle: 0.55,

  /** Ordinary street width, metres (two lanes each way). */
  roadWidth: 13,
  /** Arterials are wider, faster, and the spine you navigate by. */
  arterialWidth: 18,
  /** Long diagonal/straight arterials cut across the grid to create shortcuts. */
  arterialCount: 4,

  /** Metres between arc-length-even samples along an edge spline. */
  sampleSpacing: 6,
  /** Uniform spatial-index cell size for sampleAt(), metres. */
  spatialCellSize: 40,
  /** Metres per geometry chunk, so the road can be frustum-culled (Phase 2b). */
  chunkSize: 250,

  /** Phase 2b dressing. */
  buildingDensity: 0.65,
  streetlightSpacing: 42,
});

/**
 * TRAFFIC — civilian cars. Density is a PLAYER SETTING, not a fixed constant:
 * it is the main difficulty and performance dial available to them (§7.6).
 * Implemented in Phase 5; the presets are pinned here so the settings UI and
 * the performance budget have something concrete to target.
 */
export const TRAFFIC = Object.freeze({
  density: 'medium', // 'off' | 'low' | 'medium' | 'high'
  /** Maximum civilian cars alive at once, per density preset. */
  maxCars: Object.freeze({ off: 0, low: 8, medium: 18, high: 30 }),
  /** Spawn on edges this far ahead of the player, despawn beyond the second. */
  spawnDistance: 220,
  despawnDistance: 400,
  /** Never spawn one closer than this in front of a moving player. */
  minSpawnGap: 60,
  targetSpeed: 14, // m/s, ~50 km/h
  speedJitter: 4,
});

/**
 * RACE — seeded checkpoint routes across the fixed city (§7.5, Phase 3b).
 * The map never varies; these govern the routes laid over it.
 */
export const RACE = Object.freeze({
  /** Target metres between consecutive checkpoints. */
  checkpointSpacing: 400,
  spacingJitter: 120,
  /** Checkpoint gate trigger radius, metres. */
  gateRadius: 14,
  minCheckpoints: 4,
  maxCheckpoints: 12,
});

/**
 * INPUT — per-player bindings, built for split-screen from the start.
 *
 * ── Why no Ctrl or Alt ────────────────────────────────────────────────────────
 * Ctrl+W closes the tab and CANNOT be preventDefault()-ed in Chrome outside
 * true fullscreen. Player 1 holds W for throttle, so a Ctrl binding would end
 * the session mid-race. Alt is nearly as bad: on Windows and Linux it pulls
 * focus to the browser menu bar. Neither is worth the risk, so player 2's
 * extra actions live on the numpad instead.
 *
 * ── Known limits ──────────────────────────────────────────────────────────────
 *  - Laptops without a numpad cannot play player 2 as bound. Rebinding or a
 *    gamepad is the answer; the game should say so rather than silently
 *    ignoring the keys.
 *  - Keyboard ROLLOVER is the real ceiling on two players sharing one board.
 *    Membrane keyboards commonly drop the 3rd–6th simultaneous key, and two
 *    players cornering while boosting will exceed that. A gamepad for player 2
 *    sidesteps it entirely, which is what console split-screen actually does.
 */
export const INPUT = Object.freeze({
  /** Keyboard maps to analogue axes with these ramp rates, per second. */
  steerAttack: 4.2,
  steerRelease: 6.0,
  throttleAttack: 5.0,
  throttleRelease: 6.5,
  gamepadDeadzone: 0.12,

  /**
   * One entry per player. Index 0 is always the solo player. Split-screen adds
   * index 1; nothing above 2 is planned. `gamepadIndex` lets a player take a
   * pad instead of the keyboard — the pad wins whenever one is connected.
   */
  players: Object.freeze([
    Object.freeze({
      label: 'Player 1',
      gamepadIndex: 0,
      bindings: Object.freeze({
        throttle: ['KeyW'],
        brake: ['KeyS'],
        steerLeft: ['KeyA'],
        steerRight: ['KeyD'],
        /** Context-sensitive: drift / e-brake / burnout. See DRIFT. */
        drift: ['Space'],
        nitrous: ['ShiftLeft'],
        lookBack: ['KeyB', 'KeyQ'],
        reset: ['KeyR'],
      }),
    }),
    Object.freeze({
      label: 'Player 2',
      gamepadIndex: 1,
      bindings: Object.freeze({
        throttle: ['ArrowUp'],
        brake: ['ArrowDown'],
        steerLeft: ['ArrowLeft'],
        steerRight: ['ArrowRight'],
        drift: ['Numpad0'],
        nitrous: ['ShiftRight'],
        lookBack: ['Numpad1'],
        reset: ['NumpadDecimal'],
      }),
    }),
  ]),

  /** Not per-player: these act on the session, whoever presses them. */
  system: Object.freeze({
    garage: ['KeyG'],
    pause: ['Escape', 'KeyP'],
  }),
});

export const ECONOMY = Object.freeze({
  startingCash: 5000,
  /** Cash awarded per second of active pursuit, scaled by heat level. */
  pursuitCashPerSecond: 12,
  escapeBonusPerHeatLevel: 1500,
  bustPenalty: 0.25, // fraction of on-hand cash lost
  driftPointsToCash: 0.08,
});

export const ACCESSIBILITY = Object.freeze({
  /** Set true to disable camera shake, chromatic aberration and speed blur. */
  reducedMotion: false,
  /** Steering assist for keyboard players: counter-steers slightly during drift. */
  driftAssist: true,
  units: 'kmh', // 'kmh' | 'mph'
});

/**
 * Debug flags. Enabled by adding `?debug` to the URL, so a broken build can be
 * inspected without editing this file: `localhost:5173/?debug`. Individual
 * flags also read their own query key, e.g. `?debug&spline`.
 *
 * `globalThis.location` is optional-chained on purpose — Config.js must stay
 * importable from a Node unit test, where there is no location object.
 */
const QUERY = new URLSearchParams(globalThis.location?.search ?? '');

export const DEBUG = Object.freeze({
  /** Exposes the Game instance on window.game and logs scaffold state. */
  enabled: QUERY.has('debug'),
  showStats: QUERY.has('stats'),
  showPhysicsVectors: QUERY.has('vectors'),
  showNetwork: QUERY.has('network'),
  freeCamera: QUERY.has('freecam'),
});

export const SAVE_KEY = 'fff2.save.v1';
