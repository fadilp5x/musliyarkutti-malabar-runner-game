import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectLobbyJoins, raceProgressPercent, roomShareUrl } from '../src/party/PartyRace.js';

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

  it('celebrates two simultaneous arrivals once across overlapping snapshots', () => {
    const state = { roomCode: null, playerIds: new Set() };
    const snapshot = (players) => ({ code: 'ABCD', phase: 'lobby', players });
    const initial = snapshot([{ id: 'self', name: 'Me' }]);
    expect(collectLobbyJoins(initial, 'self', state)).toEqual([]);
    const first = snapshot([{ id: 'self' }, { id: 'a', name: 'Salman' }, { id: 'b', name: 'Rahim' }]);
    expect(collectLobbyJoins(first, 'self', state).map((player) => player.id)).toEqual(['a', 'b']);
    // A parallel poll completing with the same/newer snapshot cannot repeat either celebration.
    expect(collectLobbyJoins(first, 'self', state)).toEqual([]);
    expect(collectLobbyJoins(snapshot([{ id: 'self' }, { id: 'a' }]), 'self', state)).toEqual([]);
  });

  it('celebrates three arrivals in one batch and ignores already-counted reconnects or race arrivals', () => {
    const state = { roomCode: null, playerIds: new Set() };
    collectLobbyJoins({ code: 'WXYZ', phase: 'lobby', players: [{ id: 'self' }, { id: 'known' }] }, 'self', state);
    const three = { code: 'WXYZ', phase: 'lobby', players: [{ id: 'self' }, { id: 'known' }, { id: 'a' }, { id: 'b' }, { id: 'c' }] };
    expect(collectLobbyJoins(three, 'self', state).map((player) => player.id)).toEqual(['a', 'b', 'c']);
    expect(collectLobbyJoins(three, 'self', state)).toEqual([]);
    expect(collectLobbyJoins({ ...three, phase: 'running', players: [...three.players, { id: 'late' }] }, 'self', state)).toEqual([]);
    expect(collectLobbyJoins({ ...three, players: [...three.players, { id: 'late' }] }, 'self', state)).toEqual([]);
  });

  it('uses the shared event toast, animated roster row, soft join chime, and optional particles', () => {
    const party = readFileSync(new URL('../src/party/PartyRace.js', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../src/party/party.css', import.meta.url), 'utf8');
    const audio = readFileSync(new URL('../src/game/AudioManager.js', import.meta.url), 'utf8');
    const particles = readFileSync(new URL('../src/ui/ParticleLayer.js', import.meta.url), 'utf8');
    expect(party).toContain('this._showJoinCelebration(newLobbyPlayers)');
    expect(party).toContain('this.partyEventToast.textContent = `✨');
    expect(party).toContain("this.game.audio?.play?.('join_chime')");
    expect(party).toContain('this.game.ui?.particles?.burst?.(10)');
    expect(css).toContain('.party-player-joined');
    expect(css).toContain('600ms');
    expect(audio).toContain('_joinChime');
    expect(particles).toContain('burst(count = 10)');
  });
});
