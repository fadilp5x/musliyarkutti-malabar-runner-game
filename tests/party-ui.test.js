import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { raceProgressPercent, roomShareUrl } from '../src/party/PartyRace.js';

describe('Malabar heritage multiplayer UI', () => {
  it('positions runner markers monotonically relative to the leader', () => {
    expect(raceProgressPercent(0, 100)).toBe(0);
    expect(raceProgressPercent(25, 100)).toBe(25);
    expect(raceProgressPercent(100, 100)).toBe(100);
    expect(raceProgressPercent(140, 100)).toBe(100);
    expect(raceProgressPercent(10, 0)).toBe(0);
  });

  it('creates the judge-ready room invite URL from the code', () => {
    expect(roomShareUrl('abCd')).toBe('https://malabarrunner28.netlify.app/?room=ABCD');
    expect(roomShareUrl('A B')).toBe('https://malabarrunner28.netlify.app/?room=A%20B');
  });

  it('keeps the existing lobby and race update hooks while exposing invite and progress UI', () => {
    const source = readFileSync(new URL('../src/party/PartyRace.js', import.meta.url), 'utf8');
    for (const hook of ['data-room-code', 'data-start', 'data-leave', 'data-share-whatsapp', 'data-copy-link', 'data-race-track']) {
      expect(source).toContain(hook);
    }
    expect(source).toContain("this._renderRaceProgress(room)");
    expect(source).toContain("this.root.classList.toggle('party-race-active', running)");
  });
});
