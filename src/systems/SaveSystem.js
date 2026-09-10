/**
 * SaveSystem.js — localStorage persistence. IMPLEMENTED, not stubbed.
 *
 * Every access is wrapped in try/catch on purpose. localStorage throws, not
 * returns null, in a handful of real situations: Safari private browsing, a
 * browser configured to block site data, and an over-quota write. An
 * unhandled throw here would take the whole game down at boot, so a failed
 * save degrades to "this session is not persisted" and the game carries on.
 */

import { SAVE_KEY } from '../Config.js';

export class SaveSystem {
  constructor(key = SAVE_KEY) {
    this.key = key;
    /** False when storage is unavailable; the HUD can warn once. */
    this.available = this._probe();
  }

  _probe() {
    try {
      const probe = `${this.key}.probe`;
      globalThis.localStorage.setItem(probe, '1');
      globalThis.localStorage.removeItem(probe);
      return true;
    } catch {
      console.warn('[fff2] localStorage unavailable — progress will not persist');
      return false;
    }
  }

  /** @returns {object|null} the saved payload, or null if there is none */
  load() {
    if (!this.available) return null;
    try {
      const raw = globalThis.localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Reject anything that is not a plain object — a corrupted or
      // hand-edited value must not reach UpgradeSystem.deserialize().
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return parsed;
    } catch (error) {
      console.warn('[fff2] save file is corrupt, starting fresh', error);
      return null;
    }
  }

  /** @param {object} payload output of UpgradeSystem.serialize() */
  save(payload) {
    if (!this.available) return false;
    try {
      globalThis.localStorage.setItem(this.key, JSON.stringify(payload));
      return true;
    } catch (error) {
      console.warn('[fff2] failed to write save', error);
      return false;
    }
  }

  clear() {
    if (!this.available) return;
    try {
      globalThis.localStorage.removeItem(this.key);
    } catch {
      /* nothing useful to do */
    }
  }
}
