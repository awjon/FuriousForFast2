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

export const TRACK = Object.freeze({
  roadWidth: 16, // metres, two lanes each way
  shoulderWidth: 2.5,
  /** Spline samples per closed loop. Higher = smoother road, more triangles. */
  splineSamples: 900,
  /** Segments the road mesh is chunked into, for frustum culling. */
  chunkCount: 30,
  /** Procedural generation seed. Change for a different city. */
  seed: 20025,
  controlPointCount: 22,
  loopRadius: 620,
  /** How far control points can wander from the base circle, metres. */
  radialJitter: 210,
  /** Vertical variation of the road, metres. Keep small — this is a street racer. */
  elevationRange: 14,
  buildingDensity: 0.65,
  streetlightSpacing: 42,
});

export const INPUT = Object.freeze({
  /** Keyboard maps to analogue axes with these ramp rates, per second. */
  steerAttack: 4.2,
  steerRelease: 6.0,
  throttleAttack: 5.0,
  throttleRelease: 6.5,
  gamepadDeadzone: 0.12,
  bindings: Object.freeze({
    throttle: ['KeyW', 'ArrowUp'],
    brake: ['KeyS', 'ArrowDown'],
    steerLeft: ['KeyA', 'ArrowLeft'],
    steerRight: ['KeyD', 'ArrowRight'],
    handbrake: ['Space'],
    nitrous: ['ShiftLeft', 'ShiftRight'],
    lookBack: ['KeyB'],
    reset: ['KeyR'],
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
  showTrackSpline: QUERY.has('spline'),
  freeCamera: QUERY.has('freecam'),
});

export const SAVE_KEY = 'fff2.save.v1';
