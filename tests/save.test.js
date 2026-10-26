// tests/save.test.js — SaveManager (engine workstream).
import { describe, it, expect } from 'vitest';
import { SaveManager } from '../src/game/SaveManager.js';

// Minimal fake storage implementing getItem/setItem/removeItem.
function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _raw: store,
  };
}

describe('SaveManager', () => {
  it('corrupt JSON string falls back to defaults', () => {
    const storage = fakeStorage({ 'mmr.highscore': 'not-json{{{' });
    const mgr = new SaveManager(storage);
    const defaults = new SaveManager(fakeStorage()).load();
    expect(mgr.load()).toEqual(defaults);
  });

  it('wrong types for a key fall back to the default for that key', () => {
    const storage = fakeStorage({ 'mmr.highscore': JSON.stringify('abc') });
    const mgr = new SaveManager(storage);
    const defaults = new SaveManager(fakeStorage()).load();
    expect(mgr.load().highscore).toBe(defaults.highscore);
  });

  it('never throws on garbage storage', () => {
    const storage = fakeStorage({
      'mmr.highscore': '{oops',
      'mmr.coins': 'null',
      'mmr.settings': '42',
    });
    const mgr = new SaveManager(storage);
    expect(() => mgr.load()).not.toThrow();
  });

  it('save patch persists', () => {
    const storage = fakeStorage();
    const mgr = new SaveManager(storage);
    mgr.save({ highscore: 1234 });
    expect(mgr.load().highscore).toBe(1234);
    expect(JSON.parse(storage.getItem('mmr.highscore'))).toBe(1234);
    // unrelated keys keep defaults
    const defaults = new SaveManager(fakeStorage()).load();
    expect(mgr.load().coins).toBe(defaults.coins);
  });

  it('reset clears back to defaults', () => {
    const storage = fakeStorage();
    const mgr = new SaveManager(storage);
    mgr.save({ highscore: 999, coins: 50 });
    mgr.reset();
    const defaults = new SaveManager(fakeStorage()).load();
    expect(mgr.load()).toEqual(defaults);
    expect(storage.getItem('mmr.highscore')).toBeNull();
  });
});
