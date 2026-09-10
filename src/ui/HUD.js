/**
 * HUD.js — speedometer, nitrous bar, heat, escape/bust meters, drift score.
 * STUB: see TODO(phase-3).
 *
 * All UI is plain DOM over the canvas. No canvas-drawn text, no sprite fonts:
 * DOM is sharper, free, accessible, and restyleable without a rebuild.
 *
 * ── PERFORMANCE RULE ──────────────────────────────────────────────────────────
 * update() runs every rendered frame. Writing element.textContent every frame
 * for eight widgets forces layout eight times a frame and will cost more than
 * the entire 3D scene. Therefore:
 *   - Cache element references in build(). Never querySelector in update().
 *   - Diff before writing: only touch the DOM when the DISPLAYED value changes
 *     (compare the rounded integer, not the float).
 *   - Drive bars with `transform: scaleX()` or a CSS custom property, not
 *     `width`, so they composite instead of triggering layout.
 *
 * ── WIDGETS ───────────────────────────────────────────────────────────────────
 *   speed        big number, bottom right. km/h or mph per ACCESSIBILITY.units.
 *   nitrous      horizontal bar, magenta, flashes when below minimumToEngage.
 *   heat         0–5 police-badge pips, filling red as heat climbs.
 *   escape       radial or horizontal bar, only visible during 'cooldown'.
 *                Label it "EVADING" — this is the pursuit's climax, give it the
 *                screen space it deserves.
 *   bust         red vignette plus a countdown, only visible while pinned.
 *   drift        floating score that accumulates during a drift and "banks"
 *                with a flourish when the car straightens out.
 *   cash         top right, tweens toward its target rather than snapping.
 *   toast        transient announcements: "ROADBLOCK AHEAD", "SPIKE STRIP",
 *                "HEAT LEVEL 3", "EVADED". Queue these; never stack two.
 */

import { ACCESSIBILITY } from '../Config.js';
import { metresPerSecondToKmh, metresPerSecondToMph } from '../utils/MathUtils.js';

export class HUD {
  /**
   * @param {{ root: HTMLElement|null, state: object }} options
   */
  constructor({ root, state }) {
    this.root = root;
    this.state = state;
    /** Last values actually written to the DOM, for diffing. */
    this._displayed = { speed: -1, nitrous: -1, heat: -1, cash: -1 };
    this.build();
  }

  build() {
    if (!this.root) return;
    // TODO(phase-3): inject the widget markup and cache element references.
    this.root.innerHTML = '<div class="hud-placeholder"></div>';
  }

  /**
   * @param {import('../entities/Car.js').Car} player
   * @param {number} frameDt
   */
  update(player, frameDt) {
    // TODO(phase-3): diff-and-write each widget per the performance rule above.
    void player;
    void frameDt;
    void ACCESSIBILITY;
    void metresPerSecondToKmh;
    void metresPerSecondToMph;
  }

  /** @param {string} message @param {number} [seconds] */
  toast(message, seconds = 2.5) {
    // TODO(phase-3)
    void message;
    void seconds;
  }

  dispose() {
    if (this.root) this.root.innerHTML = '';
  }
}
