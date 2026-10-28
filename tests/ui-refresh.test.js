import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('title and shared screen refresh', () => {
  it('keeps title tap-anywhere play, moves help into settings, and uses compact navigation', () => {
    const menu = read('src/ui/MenuController.js');
    const party = read('src/party/PartyRace.js');
    expect(menu).toContain("playButton.textContent = 'PLAY'");
    expect(menu).toContain("el.addEventListener('click', () =>");
    expect(menu).toContain('this.game.startRun?.()');
    expect(menu).not.toContain("summary.textContent = 'How to play'");
    expect(menu).toContain("guideTitle.textContent = 'How to play'");
    expect(menu).not.toContain("mk('Missions', 'missions')");
    expect(menu).toContain("mk('Goals', 'goals')");
    expect(menu).toContain("mk('Credits', 'credits')");
    expect(party).toContain("mainActions?.append(this.trigger)");
    expect(party).toContain("corner?.prepend(this.leaderboardTrigger)");
  });

  it('uses the shared sticky page shell and waits for loading before the tap-to-start action', () => {
    const menu = read('src/ui/MenuController.js');
    const ui = read('src/ui/UI.js');
    const wallet = read('src/ui/VoucherWalletUI.js');
    expect(menu).toContain("panel.className = 'panel page-shell'");
    expect(menu).toContain('this._loadingMinMs = 3000');
    expect(menu).toContain("start.textContent = 'TAP TO START'");
    expect(ui).toContain('this.menus.markLoadingComplete?.()');
    expect(wallet).toContain("panel.className = 'panel page-shell'");
  });

  it('removes title particles outside loading/title and honors motion, visibility, quality and DPR limits', () => {
    const particles = read('src/ui/ParticleLayer.js');
    const ui = read('src/ui/UI.js');
    expect(particles).toContain("screen === 'loading' || screen === 'tap'");
    expect(particles).toContain('this.canvas?.remove()');
    expect(particles).toContain("'(prefers-reduced-motion: reduce)'");
    expect(particles).toContain("document.addEventListener('visibilitychange'");
    expect(particles).toContain('Math.min(2, window.devicePixelRatio || 1)');
    expect(particles).toContain("window.innerWidth <= 640 || low ? 12 : 30");
    expect(ui).toContain('this.particles.setScreen(name)');
  });

  it('uses token colours and prevents portrait/landscape title and HUD overflow', () => {
    const screens = read('src/ui/screens.css');
    const party = read('src/party/party.css');
    expect(screens).toContain('grid-template-columns: repeat(6, minmax(48px, 1fr))');
    expect(screens).toContain('@media (max-height: 480px) and (orientation: landscape)');
    expect(screens).toContain('var(--color-sky-400)');
    expect(screens).toContain('var(--color-green-500)');
    expect(screens).toContain('var(--color-white)');
    expect(party).toContain('.party-board { width: min(245px, 40vw)');
    expect(party).toContain('.party-card { max-height: calc(100dvh - 2 * var(--space-4))');
  });
});
