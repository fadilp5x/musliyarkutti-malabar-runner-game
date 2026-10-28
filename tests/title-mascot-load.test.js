import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../src/game/Game.js';

afterEach(() => vi.unstubAllGlobals());

describe('title mascot loading', () => {
  it('starts only after two animation frames so the title can paint first', () => {
    const callbacks = [];
    const loadMascot = vi.fn(() => Promise.resolve());
    vi.stubGlobal('requestAnimationFrame', (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });

    Game.prototype._loadHeroMascotAfterFirstPaint.call({ _loadHeroMascot: loadMascot });
    expect(loadMascot).not.toHaveBeenCalled();

    callbacks.shift()(0);
    expect(loadMascot).not.toHaveBeenCalled();

    callbacks.shift()(16);
    expect(loadMascot).toHaveBeenCalledOnce();
  });
});
