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

import { RENDER, WORLD, DEBUG } from '../Config.js';
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
import { HUD } from '../ui/HUD.js';
import { Garage } from '../ui/Garage.js';

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
      driftScore: 0, // mirror of player.state.driftScore                   (owner: Physics)
      lookBack: false, // B held; read by CameraRig at render time          (owner: Input)
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

    this.track = new Track({ seed: WORLD.seed });
    await this.track.build(this.scene);

    // `?network` — overlay the road graph: edge centrelines, intersection
    // markers, the spawn point. Debug-only; RoadNetwork.buildDebugOverlay()
    // is the one place that file is allowed to touch Three.js scene objects.
    if (DEBUG.showNetwork) {
      this._networkOverlay = this.track.network.buildDebugOverlay();
      this.scene.add(this._networkOverlay);
    }

    this.player = new Car({ stats: this.state.stats, isPlayer: true });
    await this.player.build(this.scene);
    this.player.placeOnTrack(this.track, this.track.getSpawn());

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
      this.player.placeOnTrack(this.track, this.player.roadHint ?? this.track.getSpawn());
    }

    // Sampled on the fixed step but consumed at render time by CameraRig,
    // so it has to cross over through shared state.
    this.state.lookBack = controls.lookBack;

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

    // Physics accumulates drift score per car (it is never handed Game.state);
    // Game mirrors the player's across for the HUD and the economy.
    this.state.driftScore = this.player.state.driftScore;

    this.cameraRig.update(frameDt, this.state);
    this.environment.update(frameDt, this.player);
    this.hud.update(this.player, frameDt);

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
    if (this._networkOverlay) {
      this._networkOverlay.traverse((object) => {
        object.geometry?.dispose();
        object.material?.dispose();
      });
      this._networkOverlay.removeFromParent();
    }
    this.renderer.dispose();
    this.scene.clear();
  }
}
