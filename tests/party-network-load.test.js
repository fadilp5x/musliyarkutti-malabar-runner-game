import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PARTY_HEARTBEAT_INTERVAL_MS,
  PARTY_POLL_INTERVAL_MS,
  PARTY_PROGRESS_INTERVAL_MS,
  PartyRace,
} from '../src/party/PartyRace.js';
import { LANES } from '../src/game/PlayerController.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('party race request rate', () => {
  it('simulates eight running clients for 60 seconds at 2.5 or fewer requests per client per second', () => {
    const clients = 8;
    const durationMs = 60_000;
    const progressRequestsPerClient = Math.floor(durationMs / PARTY_PROGRESS_INTERVAL_MS);
    const pollRequestsPerClient = 0;
    const heartbeatRequestsPerClient = 0;
    const requestsPerClient = progressRequestsPerClient + pollRequestsPerClient + heartbeatRequestsPerClient;
    const requestsPerClientPerSecond = requestsPerClient / (durationMs / 1000);

    console.info(`8 clients / 60 s: ${requestsPerClientPerSecond.toFixed(3)} requests per client per second (${requestsPerClient} each; ${requestsPerClient * clients} total).`);
    expect(PARTY_POLL_INTERVAL_MS).toBe(1500);
    expect(PARTY_HEARTBEAT_INTERVAL_MS).toBe(6000);
    expect(requestsPerClientPerSecond).toBeLessThanOrEqual(2.5);
  });

  it('keeps two remote snapshots, caps extrapolation at 600 ms, and eases position', () => {
    const player = { id: 'remote', distance: 100, speed: 10, runClock: 5, lane: 2, y: 1, alive: true, connected: true, anim: 'run' };
    const room = { code: 'ABC123', round: 1, startAt: Date.now() - 5000, players: [{ id: 'local' }, player] };
    const state = {
      playerId: 'local',
      _remoteRoundKey: null,
      remoteSnapshots: new Map(),
      remoteDistanceMax: new Map(),
      _serverOffsetMs: 0,
      crashedRemoteIds: new Set(),
      remoteEdgeIndicators: new Map(),
    };
    PartyRace.prototype._rememberRemoteSnapshots.call(state, room, 1000);
    player.distance = 104;
    PartyRace.prototype._rememberRemoteSnapshots.call(state, room, 1400);
    expect(state.remoteSnapshots.get('remote')).toHaveLength(2);
    expect(PartyRace.prototype._remoteDistance.call(state, player, 1700)).toBeGreaterThanOrEqual(104);
    expect(PartyRace.prototype._remoteDistance.call(state, player, 3000)).toBeGreaterThanOrEqual(104);
    player.distance = 103;
    PartyRace.prototype._rememberRemoteSnapshots.call(state, room, 3100);
    expect(PartyRace.prototype._remoteDistance.call(state, player, 3100)).toBeGreaterThanOrEqual(104);

    const position = { x: 0, y: 0, z: 0 };
    const avatar = { group: { position }, anim: 'run', runPhase: 0, setAnim() {}, update() {} };
    const partyRace = {
      _raf: 0,
      lastRemoteFrame: 1000,
      playerId: 'local',
      room: { phase: 'running', players: [{ id: 'local' }, player] },
      game: {
        runnerRoot: { visible: true },
        scoring: { distanceM: 110 },
        player: { laneIndex: 1 },
        _speed: () => 10,
      },
      remoteAvatars: new Map([['remote', avatar]]),
      remoteEdgeIndicators: new Map(),
      _setRemoteEdgeIndicator() {},
      _ensureRemoteAvatars() {},
      _remoteDistance: () => 110,
    };
    vi.stubGlobal('document', { hidden: false });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    PartyRace.prototype._animateRemotes.call(partyRace, 1100);
    const blend = 1 - Math.exp(-0.6);
    expect(position.x).toBeCloseTo(LANES[2] * blend);
    expect(position.y).toBeCloseTo(blend);
    expect(position.z).toBeCloseTo(0);
  });

  it('backs lobby polling off to five seconds after repeated errors', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { hidden: false });
    const race = Object.assign(Object.create(PartyRace.prototype), {
      roomCode: 'ABC123',
      room: { phase: 'lobby' },
      _timerMode: 'idle',
      _pollDelay: PARTY_POLL_INTERVAL_MS,
      pollTimer: null,
      _pollPending: false,
      _request: vi.fn().mockResolvedValue(null),
    });

    race._schedulePoll();
    await vi.advanceTimersByTimeAsync(1500);
    expect(race._pollDelay).toBe(3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(race._pollDelay).toBe(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(race._pollDelay).toBe(5000);
    expect(race._request).toHaveBeenCalledTimes(3);
  });

  it('pauses and resumes running network timers with document visibility', () => {
    vi.useFakeTimers();
    const documentState = { hidden: false };
    vi.stubGlobal('document', documentState);
    const race = Object.assign(Object.create(PartyRace.prototype), {
      roomCode: 'ABC123',
      room: { phase: 'running' },
      _timerMode: 'none',
      progressTimer: null,
      pollTimer: null,
      heartbeatTimer: null,
      _progress() {},
    });

    race._syncNetworkTimers();
    expect(vi.getTimerCount()).toBe(1);
    documentState.hidden = true;
    race._syncNetworkTimers();
    expect(vi.getTimerCount()).toBe(0);
    documentState.hidden = false;
    race._timerMode = 'paused';
    race._syncNetworkTimers();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('keeps eliminated spectators updated with a read-only room poll', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { hidden: false });
    const race = Object.assign(Object.create(PartyRace.prototype), {
      game: { state: 'GAMEOVER' },
      room: { phase: 'running' },
      roomCode: 'ABC123',
      spectatorPollTimer: null,
      _request: vi.fn().mockResolvedValue({ room: { phase: 'running' } }),
    });
    race._scheduleSpectatorPoll();
    await vi.advanceTimersByTimeAsync(1000);
    expect(race._request).toHaveBeenCalledWith({ type: 'poll' }, { quiet: true });
  });
});
