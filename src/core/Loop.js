/**
 * Loop.js — fixed-timestep accumulator driving a variable-rate render.
 *
 * Physics MUST be deterministic at a fixed dt or drift/grip tuning changes
 * behaviour on a 144 Hz monitor versus a 60 Hz one. Rendering interpolates
 * between the last two physics states using `alpha`.
 *
 * Usage:
 *   const loop = new Loop({
 *     fixedUpdate: (dt) => world.step(dt),
 *     render: (alpha, frameDt) => view.draw(alpha, frameDt),
 *   });
 *   loop.start();
 */

import { LOOP } from '../Config.js';

export class Loop {
  /**
   * @param {{
   *   fixedUpdate: (dt: number) => void,
   *   render: (alpha: number, frameDt: number) => void,
   * }} handlers
   */
  constructor({ fixedUpdate, render }) {
    this.fixedUpdate = fixedUpdate;
    this.render = render;

    this.running = false;
    this.accumulator = 0;
    this.lastTime = 0;
    this.frameId = 0;

    /** Wall-clock seconds since start(), excluding paused time. */
    this.elapsed = 0;
    /** Smoothed frames per second, for the debug overlay. */
    this.fps = 0;

    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.frameId = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  _tick(now) {
    if (!this.running) return;
    this.frameId = requestAnimationFrame(this._tick);

    // Clamp so a background tab or a breakpoint doesn't produce a 40-second
    // catch-up burst that tunnels every car through the guardrails.
    const frameDt = Math.min((now - this.lastTime) / 1000, LOOP.maxFrameTime);
    this.lastTime = now;
    this.elapsed += frameDt;
    this.fps += (1 / Math.max(frameDt, 1e-6) - this.fps) * 0.1;

    this.accumulator += frameDt;
    while (this.accumulator >= LOOP.fixedStep) {
      this.fixedUpdate(LOOP.fixedStep);
      this.accumulator -= LOOP.fixedStep;
    }

    this.render(this.accumulator / LOOP.fixedStep, frameDt);
  }
}
