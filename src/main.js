/**
 * main.js — entry point. Deliberately thin.
 *
 * Its only jobs: find the canvas, construct the Game, surface fatal errors to
 * the player instead of a blank black screen, and expose the instance on
 * `window.game` when debug mode is on. All real logic lives in core/Game.js.
 */

import { Game } from './core/Game.js';
import { DEBUG } from './Config.js';

const canvas = document.getElementById('game-canvas');
const loadingScreen = document.getElementById('loading-screen');

function fatal(message, error) {
  console.error(message, error);
  if (!loadingScreen) return;
  loadingScreen.hidden = false;
  loadingScreen.innerHTML = `
    <h1 class="logo">STALLED</h1>
    <p class="hint">${message}</p>
    <p class="hint" style="letter-spacing:0;text-transform:none;opacity:.6">
      ${error?.message ?? ''}
    </p>`;
}

async function boot() {
  if (!canvas) throw new Error('#game-canvas is missing from index.html');

  const game = new Game({ canvas });
  await game.init();

  loadingScreen?.setAttribute('hidden', '');
  document.getElementById('hud')?.removeAttribute('hidden');

  game.start();

  if (DEBUG.enabled) {
    globalThis.game = game;
    console.info('[fff2] debug mode — game instance on window.game');
  }

  // Vite HMR: tear the game down cleanly so we don't leak WebGL contexts,
  // rAF handles or event listeners across hot reloads.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => game.dispose());
  }
}

boot().catch((error) => {
  if (error instanceof Error && /webgl/i.test(error.message)) {
    fatal('WebGL2 is unavailable in this browser.', error);
  } else {
    fatal('The game failed to start.', error);
  }
});
