import { describe, expect, it, vi } from 'vitest';
import { estimateRemoteDistance, remoteRunnerIsAlive, remoteRunnerZ, PartyRace } from '../src/party/PartyRace.js';

describe('remote runner distance and visibility', () => {
  it('estimates distance with at most 600 ms extrapolation and never moves backwards', () => {
    const base = { distance: 100, speed: 20, runClock: 5, myRunClock: 8 };
    expect(estimateRemoteDistance(base)).toBeCloseTo(112);
    expect(estimateRemoteDistance({ ...base, myRunClock: 4 })).toBe(100);
    expect(estimateRemoteDistance({ ...base, myRunClock: 8, previous: 115 })).toBe(115);
  });

  it('places a runner 20 m ahead at z=-20 and clamps the render range', () => {
    expect(remoteRunnerZ(120, 100)).toBe(-20);
    expect(remoteRunnerZ(200, 100)).toBe(-60);
    expect(remoteRunnerZ(90, 100)).toBe(6);
  });

  it('does not consider dead or disconnected players renderable', () => {
    expect(remoteRunnerIsAlive({ alive: true, connected: true })).toBe(true);
    expect(remoteRunnerIsAlive({ alive: false, connected: true })).toBe(false);
    expect(remoteRunnerIsAlive({ alive: true, connected: false })).toBe(false);
  });

  it('immediately removes a remote model when the server reports death', () => {
    const avatar = { group: { visible: true, position: { clone: () => ({ x: 0, y: 1, z: -2 }) } } };
    const race = {
      playerId: 'local',
      room: { players: [{ id: 'remote', alive: true, connected: true, name: 'Salman', distance: 412 }] },
      remoteAvatars: new Map([['remote', avatar]]),
      remoteSnapshots: new Map([['remote', [{}]]]),
      remoteDistanceMax: new Map([['remote', 412]]),
      remoteEdgeIndicators: new Map(),
      crashedRemoteIds: new Set(),
      _disposeRemote: vi.fn(),
      _showRemoteCrash: vi.fn(),
    };
    PartyRace.prototype._syncRemoteLiveness.call(race, {
      players: [{ id: 'local', alive: true, connected: true }, { id: 'remote', alive: false, connected: true, name: 'Salman', distance: 412 }],
    });
    expect(race.remoteAvatars.has('remote')).toBe(false);
    expect(avatar.group.visible).toBe(false);
    expect(race._disposeRemote).toHaveBeenCalledWith(avatar);
    expect(race._showRemoteCrash).toHaveBeenCalledWith(expect.objectContaining({ name: 'Salman' }), { x: 0, y: 1, z: -2 });
  });
});
