import { Game } from './game/Game.js';
import { PartyRace } from './party/PartyRace.js';
import './ui/styles.css';
import { mountStyleGuide } from './ui/StyleGuide.js';

if (new URLSearchParams(window.location.search).get('styleguide') === '1') {
  mountStyleGuide();
} else {
  const canvas = document.getElementById('game');
  const game = new Game(canvas);

  function onResize() {
    game.resize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  (async () => {
    try {
      await game.init();
    } catch (err) {
      console.error('[musliyarkutti] game init failed:', err);
    }
    const partyRace = new PartyRace(game, document.getElementById('ui'));
    onResize();
    game.start();
    // Testing/QA handle: lets automated checks drive and inspect the live game.
    window.__game = game;
    window.__partyRace = partyRace;
  })();
}
