/**
 * Game.js — the composition root.
 *
 * Owns the scene graph and the update order. Systems never reach into each
 * other directly; Game is the only place that knows about all of them, and it
 * passes explicit references down. If two systems need to talk, either Game
 * mediates or they communicate through the shared state object.
 *
 * FRAME ORDER (do not reorder without updating CLAUDE.md):
 *   fixedUpdate(dt):
 *     1. Input.sample()          — snapshot of the analogue axes
 *     2. Physics.step(player)    — resolve forces, integrate
 *     3. Physics.step(each cop)
 *     4. Collisions               — track bounds, world props, car-to-car
 *     5. PursuitAI.update()      — cop steering targets for the NEXT step
 *     6. HeatSystem.update()     — heat, evade/bust timers, spawns
 *   render(alpha, frameDt):
 *     7. CameraRig.update()
 *     8. Effects / PostFX uniforms
 *     9. HUD.update()
 *    10. PostFX.render() or Renderer.render()
 */

import * as THREE from 'three';

import { PALETTE, RENDER, TRACK, DEBUG } from '../Config.js';
import { Renderer } from '../render/Renderer.js';
import { Loop } from './Loop.js';
import { Input } from './Input.js';
import { Physics } from '../physics/Physics.js';
import { Track } from '../world/Track.js';
import { Environment } from '../world/Environment.js';
import { Car } from '../entities/Car.js';
import { Police } from '../entities/Police.js';
import { UpgradeSystem } from '../systems/UpgradeSystem.js';
import { HeatSystem } from '../systems/HeatSystem.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { CameraRig } from '../render/CameraRig.js';
import { PostFX } from '../render/PostFX.js';
import { NeonGrid } from '../render/NeonGrid.js';
import { HUD } from '../ui/HUD.js';
import { Garage } from '../ui/Garage.js';

/**
 * SCAFFOLD ONLY. While Track.build() is still a stub this puts a neon grid and
 * a placeholder chassis on screen so `npm run dev` proves the render path.
 * Delete this constant and _buildPlaceholder() at the end of Phase 2.
 */
const SCAFFOLD_PREVIEW = true;

export class Game {
  /** @param {{ canvas: HTMLCanvasElement }} options */
  constructor({ canvas }) {
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(RENDER.fogColor);
    this.scene.fog = new THREE.FogExp2(RENDER.fogColor, RENDER.fogDensity);

    this.renderer = new Renderer({ canvas });
    this.camera = this.renderer.camera;

    /**
     * Shared mutable state. Read by many systems, written by few — each field
     * below names its single owner. Anything else only reads it.
     */
    this.state = {
      mode: 'boot', // 'boot' | 'driving' | 'garage' | 'paused' | 'busted'  (owner: Game)
      cash: 0, //                                                           (owner: HeatSystem)
      heat: 0, //                                                           (owner: HeatSystem)
      pursuit: null, //                                                     (owner: HeatSystem)
      driftScore: 0, //                                                     (owner: Physics)
      stats: null, // resolved car stat block                               (owner: UpgradeSystem)
    };

    this.loop = new Loop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      render: (alpha, frameDt) => this.render(alpha, frameDt),
    });
  }

  /** Async because Phase 5 loads textures and audio here. */
  async init() {
    this.save = new SaveSystem();
    this.upgrades = new UpgradeSystem(this.save.load());
    this.state.stats = this.upgrades.getStats();
    this.state.cash = this.upgrades.cash;

    this.input = new Input(this.canvas);
    this.physics = new Physics();

    this.environment = new Environment(this.scene);
    this.environment.build();

    this.track = new Track({ seed: TRACK.seed });
    await this.track.build(this.scene);

    this.player = new Car({ stats: this.state.stats, isPlayer: true });
    await this.player.build(this.scene);
    this.player.placeOnTrack(this.track, 0);

    this.player.applyVisuals(this.upgrades.getVisuals());

    this.police = new Police({ track: this.track, scene: this.scene });
    await this.police.build(this.state.stats);
    this.heat = new HeatSystem({ police: this.police, player: this.player, state: this.state });

    this.cameraRig = new CameraRig({ camera: this.camera, target: this.player });
    this.postFX = new PostFX({ renderer: this.renderer, scene: this.scene, camera: this.camera });

    this.hud = new HUD({ root: document.getElementById('hud'), state: this.state });
    this.garage = new Garage({
      root: document.getElementById('garage'),
      upgrades: this.upgrades,
      onClose: () => this.setMode('driving'),
      onChange: () => {
        this.state.stats = this.upgrades.getStats();
        this.state.cash = this.upgrades.cash;
        this.player.applyStats(this.state.stats);
        this.player.applyVisuals(this.upgrades.getVisuals());
        this.save.save(this.upgrades.serialize());
      },
    });

    if (SCAFFOLD_PREVIEW) this._buildPlaceholder();

    this.setMode('driving');
  }

  start() {
    this.loop.start();
  }

  /** @param {'driving'|'garage'|'paused'|'busted'} mode */
  setMode(mode) {
    this.state.mode = mode;
    this.garage?.setVisible(mode === 'garage');
  }

  fixedUpdate(dt) {
    const controls = this.input.sample(dt);

    if (controls.pressed.garage) {
      this.setMode(this.state.mode === 'garage' ? 'driving' : 'garage');
    }
    if (controls.pressed.reset) {
      this.player.placeOnTrack(this.track, this.player.trackT ?? 0);
    }

    if (this.state.mode !== 'driving') return;

    this.physics.step(this.player, controls, this.track, dt);
    for (const cop of this.police.units) {
      this.physics.step(cop, cop.controls, this.track, dt);
    }

    this.police.update(this.player, dt);
    this.heat.update(dt, this.player);
  }

  render(alpha, frameDt) {
    this.player.syncTransform(alpha);
    for (const cop of this.police.units) cop.syncTransform(alpha);

    this.cameraRig.update(frameDt, this.state);
    this.environment.update(frameDt, this.player);
    this.hud.update(this.player, frameDt);

    if (SCAFFOLD_PREVIEW) this._animatePlaceholder();

    this.postFX.render(frameDt);
  }

  dispose() {
    this.loop.stop();
    this.input?.dispose();
    this.hud?.dispose();
    this.garage?.dispose();
    this.postFX?.dispose();
    this.police?.dispose();
    this.track?.dispose();
    this.environment?.dispose();
    this.player?.dispose();
    this.renderer.dispose();
    this.scene.clear();
  }

  // ---------------------------------------------------------------------------
  // Scaffold preview — remove with SCAFFOLD_PREVIEW in Phase 2.
  // ---------------------------------------------------------------------------

  _buildPlaceholder() {
    const grid = new NeonGrid({ spacing: 4, majorEvery: 8, opacity: 0.8 });
    this.scene.add(grid.mesh);

    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.9, 4.4),
      new THREE.MeshStandardMaterial({
        color: PALETTE.asphalt,
        emissive: PALETTE.cyan,
        emissiveIntensity: 0.55,
        metalness: 0.7,
        roughness: 0.3,
      })
    );
    chassis.position.y = 0.55;
    this.scene.add(chassis);

    const underglow = new THREE.PointLight(PALETTE.magenta, 40, 22, 2);
    underglow.position.set(0, 0.25, 0);
    this.scene.add(underglow);

    this._placeholder = { grid, chassis, underglow };
    this.camera.position.set(0, 4.2, 10);
    this.camera.lookAt(0, 0.8, 0);

    if (DEBUG.enabled) console.info('[fff2] scaffold preview active — Track.build() is a stub');
  }

  _animatePlaceholder() {
    const t = this.loop.elapsed;
    const { chassis, grid } = this._placeholder;
    chassis.rotation.y = t * 0.4;
    this.camera.position.set(Math.sin(t * 0.15) * 11, 4.2, Math.cos(t * 0.15) * 11);
    this.camera.lookAt(0, 0.8, 0);
    grid.followCamera(this.camera.position);
  }
}
