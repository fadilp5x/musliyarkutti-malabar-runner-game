import { describe, expect, it } from 'vitest';
import { handleGameRequest } from '../server/gameRoomService.js';

class ConditionalBlobStore {
  constructor() { this.entries = new Map(); this.revision = 0; this.reads = []; this.writes = []; }

  async getWithMetadata(key, options = {}) {
    this.reads.push(options);
    const entry = this.entries.get(key);
    return entry ? { data: structuredClone(entry.data), etag: entry.etag, metadata: {} } : null;
  }

  async setJSON(key, value, options = {}) {
    this.writes.push(options);
    const current = this.entries.get(key);
    if (options.onlyIfNew && current) return { modified: false };
    if (options.onlyIfMatch && current?.etag !== options.onlyIfMatch) return { modified: false };
    if (options.onlyIfMatch && !current) return { modified: false };
    const etag = `"test-${++this.revision}"`;
    this.entries.set(key, { data: structuredClone(value), etag });
    return { modified: true, etag };
  }
}

describe('Netlify room service', () => {
  it('runs three complete rounds for two players and chooses the aggregate-distance winner', async () => {
    const store = new ConditionalBlobStore();
    let clock = 1_800_000_000_000;
    const playerA = 'player-111111111111111111111111';
    const playerB = 'player-222222222222222222222222';
    const call = async (body) => {
      const response = await handleGameRequest(new Request('https://game.test/.netlify/functions/game', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }), { store, now: clock });
      return { status: response.status, body: await response.json() };
    };

    const created = await call({ type: 'create', playerId: playerA, name: 'Amina' });
    expect(created.status).toBe(201);
    const { code } = created.body;
    const joined = await call({ type: 'join', playerId: playerB, name: 'Basheer', code });
    expect(joined.status).toBe(201);

    for (let round = 1; round <= 3; round += 1) {
      const started = await call({ type: 'start', playerId: playerA, code });
      expect(started.body.room.phase).toBe('countdown');
      expect(started.body.room.round).toBe(round);
      clock = started.body.room.startAt + 5_000;

      const distanceA = [140, 110, 100][round - 1];
      const distanceB = [100, 130, 120][round - 1];
      for (const [playerId, distance, coins] of [
        [playerA, distanceA, 10 * round],
        [playerB, distanceB, 5 * round],
      ]) {
        await call({ type: 'progress', playerId, code, distance, score: distance * 2, coins, lane: 1, y: 0, anim: 'run' });
        await call({ type: 'finish', playerId, code, distance, score: distance * 2, coins });
      }
      const view = new URLSearchParams({ code, playerId: playerA });
      const read = await handleGameRequest(new Request(`https://game.test/.netlify/functions/game?${view}`), { store, now: clock });
      const room = (await read.json()).room;
      expect(room.phase).toBe(round === 3 ? 'gameover' : 'roundover');
      expect(room.roundResults).toHaveLength(round);
      if (round === 3) {
        const totals = Object.fromEntries(room.players.map((player) => [player.id, {
          distance: player.totalDistance,
          coins: player.totalCoins,
          score: player.totalScore,
        }]));
        expect(totals[playerA]).toEqual({ distance: 350, coins: 60, score: 700 });
        expect(totals[playerB]).toEqual({ distance: 350, coins: 30, score: 700 });
        const standings = [...room.players].sort((a, b) => b.totalDistance - a.totalDistance || b.totalCoins - a.totalCoins);
        expect(standings[0].id).toBe(playerA);
      }
    }

    expect(store.writes[0]).toEqual({ onlyIfNew: true });
    expect(store.writes.slice(1).every((write) => typeof write.onlyIfMatch === 'string')).toBe(true);
    expect(store.reads.some((read) => read.consistency === 'strong')).toBe(true);
  });
});
