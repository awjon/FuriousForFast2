/**
 * Garage.js — the customisation screen. STUB: see TODO(phase-3).
 *
 * A DOM overlay, opened with G. It is a VIEW ONLY: it renders what
 * UpgradeSystem reports and calls purchaseUpgrade / selectVisual. It must not
 * compute costs, gate affordability with its own arithmetic, or hold any
 * duplicate of the upgrade tree — every one of those is a place for the UI and
 * the simulation to disagree.
 *
 * ── LAYOUT ────────────────────────────────────────────────────────────────────
 *   left    tab list: PERFORMANCE | VISUAL
 *   centre  the car, slowly orbiting (CameraRig mode 'orbit') so paint, rims
 *           and underglow changes are visible immediately. Every visual
 *           selection must apply live — a preview that needs a confirm step
 *           kills the fun of the NFSU2 garage.
 *   right   the category list. Each performance row shows the tier name, a
 *           0–10 rating bar from getRatings(), the next tier's cost, and a BUY
 *           button disabled when canAffordUpgrade() is false.
 *
 * On any change, call the onChange callback so Game can re-resolve stats,
 * push them into the Car, and save. The Garage itself never touches SaveSystem.
 *
 * ── ACCESSIBILITY ─────────────────────────────────────────────────────────────
 * Real <button> elements, not styled divs. Arrow keys move between rows, Enter
 * buys, Escape closes. Announce purchases through the aria-live region on
 * #ui-root.
 */

import { PERFORMANCE_TREE, VISUAL_TREE, TIER_NAMES } from '../systems/UpgradeSystem.js';

export class Garage {
  /**
   * @param {{
   *   root: HTMLElement|null,
   *   upgrades: import('../systems/UpgradeSystem.js').UpgradeSystem,
   *   onClose: () => void,
   *   onChange: () => void,
   * }} options
   */
  constructor({ root, upgrades, onClose, onChange }) {
    this.root = root;
    this.upgrades = upgrades;
    this.onClose = onClose;
    this.onChange = onChange;
    this.visible = false;
    /** @type {'performance'|'visual'} */
    this.tab = 'performance';
  }

  /** @param {boolean} visible */
  setVisible(visible) {
    this.visible = visible;
    if (!this.root) return;
    this.root.toggleAttribute('hidden', !visible);
    if (visible) this.render();
  }

  render() {
    if (!this.root) return;
    // TODO(phase-3): build the two tabs from PERFORMANCE_TREE / VISUAL_TREE.
    void PERFORMANCE_TREE;
    void VISUAL_TREE;
    void TIER_NAMES;
    this.root.innerHTML = `
      <h1 class="logo">GARAGE</h1>
      <p class="hint">not built yet — press G to return</p>`;
  }

  dispose() {
    if (this.root) this.root.innerHTML = '';
  }
}
