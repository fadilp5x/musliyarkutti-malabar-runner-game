import { describe, expect, it } from 'vitest';
import { handleGameRequest } from '../server/gameRoomService.js';

class ConditionalBlobStore {
  constructor() { this.entries = new Map(); this.revision = 0; this.reads = []; this.writes = []; this.writeKeys = []; }

  async getWithMetadata(key, options = {}) {
    this.reads.push(options);
    const entry = this.entries.get(key);
    return entry ? { data: structuredClone(entry.data), etag: entry.etag, metadata: {} } : null;
  }

  async setJSON(key, value, options = {}) {
    this.writes.push(options);
    this.writeKeys.push(key);
    const current = this.entries.get(key);
    if (options.onlyIfNew && current) return { modified: false };
    if (options.onlyIfMatch && current?.etag !== options.onlyIfMatch) return { modified: false };
    if (options.onlyIfMatch && !current) return { modified: false };
    const etag = `"test-${++this.revision}"`;
    this.entries.set(key, { data: structuredClone(value), etag });
    return { modified: true, etag };
  }
}

async function runningRoomFixture(playerId) {
  const store = new ConditionalBlobStore();
  const baseTime = 1_800_000_000_000;
  const request = async (body, now = baseTime) => {
    const response = await handleGameRequest(new Request('https://game.test/.netlify/functions/game', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), { store, now });
    return { status: response.status, body: await response.json() };
  };
  const created = await request({ type: 'create', playerId, name: 'Runner' });
  const code = created.body.code;
  await request({ type: 'join', playerId: `${playerId}B`, name: 'Other', code });
  const started = await request({ type: 'start', playerId, code });
  const runningAt = started.body.room.startAt + 1000;
  return {
    store,
    code,
    playerId,
    runningAt,
    request,
    progress: (fields, now = runningAt) => request({ type: 'progress', playerId, code, ...fields }, now),
    finish: (fields, now = runningAt) => request({ type: 'finish', playerId, code, ...fields }, now),
  };
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
    expect(code).toMatch(/^[A-Z]{4}$/);
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

    const roomWrites = store.writes.filter((_, index) => store.writeKeys[index].startsWith('rooms/'));
    expect(roomWrites[0]).toEqual({ onlyIfNew: true });
    expect(roomWrites.slice(1).every((write) => typeof write.onlyIfMatch === 'string')).toBe(true);
    expect(store.reads.some((read) => read.consistency === 'strong')).toBe(true);
  });

  it('serializes simultaneous joins with conditional Blob writes', async () => {
    const store = new ConditionalBlobStore();
    const now = 1_800_000_000_000;
    const request = async (body) => handleGameRequest(new Request('https://game.test/.netlify/functions/game', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }), { store, now });
    const createdResponse = await request({ type: 'create', playerId: 'player-race-host-11111111', name: 'Host' });
    const created = await createdResponse.json();
    const joins = await Promise.all([
      request({ type: 'join', playerId: 'player-race-guest-a-111111', code: created.code, name: 'A' }),
      request({ type: 'join', playerId: 'player-race-guest-b-111111', code: created.code, name: 'B' }),
    ]);
    expect(joins.map((response) => response.status)).toEqual([201, 201]);
    const stored = store.entries.get(`rooms/${created.code}`).data;
    expect(stored.players.map((player) => player.name)).toEqual(['Host', 'A', 'B']);
    expect(store.writes.filter((write) => write.onlyIfMatch).length).toBeGreaterThanOrEqual(2);
  });

  it('marks an inactive player disconnected after ten seconds', async () => {
    const store = new ConditionalBlobStore();
    const now = 1_800_000_000_000;
    const playerId = 'player-timeout-host-11111111';
    const createdResponse = await handleGameRequest(new Request('https://game.test/.netlify/functions/game', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'create', playerId, name: 'Host' }),
    }), { store, now });
    const created = await createdResponse.json();
    const readResponse = await handleGameRequest(new Request(`https://game.test/.netlify/functions/game?${new URLSearchParams({ code: created.code, playerId })}`), {
      store, now: now + 10_001,
    });
    const read = await readResponse.json();
    expect(read.room.players[0].connected).toBe(false);
  });

  it('automatically starts the next round when a room read passes autoStartAt', async () => {
    const fixture = await runningRoomFixture('player-auto-start-111111111111');
    const guestId = `${fixture.playerId}B`;
    await fixture.finish({ distance: 20, score: 20, coins: 0 });
    const finished = await fixture.request({ type: 'finish', playerId: guestId, code: fixture.code, distance: 18, score: 18, coins: 0 }, fixture.runningAt);
    expect(finished.body.room.phase).toBe('roundover');
    expect(finished.body.room.autoStartAt).toBe(fixture.runningAt + 25_000);

    await fixture.request({ type: 'heartbeat', playerId: fixture.playerId, code: fixture.code }, finished.body.room.autoStartAt - 1000);
    await fixture.request({ type: 'heartbeat', playerId: guestId, code: fixture.code }, finished.body.room.autoStartAt - 1000);

    const read = await handleGameRequest(new Request(`https://game.test/.netlify/functions/game?${new URLSearchParams({ code: fixture.code, playerId: fixture.playerId })}`), {
      store: fixture.store,
      now: finished.body.room.autoStartAt,
    });
    const room = (await read.json()).room;
    expect(room).toMatchObject({ phase: 'countdown', round: 2, autoStartAt: null });
    expect(room.startAt).toBe(finished.body.room.autoStartAt + 3000);
  });

  it('hands host to the next connected player between rounds', async () => {
    const store = new ConditionalBlobStore();
    const baseTime = 1_800_000_000_000;
    const ids = ['player-handover-host-111111', 'player-handover-next-111111', 'player-handover-third-11111'];
    const call = async (body, now) => {
      const response = await handleGameRequest(new Request('https://game.test/.netlify/functions/game', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }), { store, now });
      return { status: response.status, body: await response.json() };
    };
    const created = await call({ type: 'create', playerId: ids[0], name: 'Host' }, baseTime);
    const code = created.body.code;
    await call({ type: 'join', playerId: ids[1], code, name: 'Next' }, baseTime);
    await call({ type: 'join', playerId: ids[2], code, name: 'Third' }, baseTime);
    const started = await call({ type: 'start', playerId: ids[0], code }, baseTime);
    const runTime = started.body.room.startAt + 5000;
    for (const [index, playerId] of ids.entries()) {
      await call({ type: 'finish', playerId, code, distance: 30 - index, score: 30 - index, coins: 0 }, runTime);
    }
    const left = await call({ type: 'leave', playerId: ids[0], code }, runTime + 100);
    expect(left.body.room.phase).toBe('roundover');
    expect(left.body.room.hostId).toBe(ids[1]);
    expect(left.body.room.players.find((player) => player.id === ids[0]).connected).toBe(false);
    const nextRound = await call({ type: 'start', playerId: ids[1], code }, runTime + 200);
    expect(nextRound.body.room).toMatchObject({ phase: 'countdown', round: 2, hostId: ids[1] });
  });

  it('lets the final host play again and resets the match back to the lobby', async () => {
    const store = new ConditionalBlobStore();
    let clock = 1_800_000_000_000;
    const hostId = 'player-play-again-host-1111111';
    const guestId = 'player-play-again-guest-111111';
    const call = async (body) => {
      const response = await handleGameRequest(new Request('https://game.test/.netlify/functions/game', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }), { store, now: clock });
      return { status: response.status, body: await response.json() };
    };
    const created = await call({ type: 'create', playerId: hostId, name: 'Host' });
    const code = created.body.code;
    await call({ type: 'join', playerId: guestId, code, name: 'Guest' });
    for (let round = 1; round <= 3; round++) {
      const started = await call({ type: 'start', playerId: hostId, code });
      clock = started.body.room.startAt + 5000;
      await call({ type: 'finish', playerId: hostId, code, distance: 40, score: 40, coins: 1 });
      await call({ type: 'finish', playerId: guestId, code, distance: 35, score: 35, coins: 0 });
      if (round < 3) clock += 1000;
    }
    const reset = await call({ type: 'play_again', playerId: hostId, code });
    expect(reset.status).toBe(200);
    expect(reset.body.room).toMatchObject({ phase: 'lobby', round: 0, roundResults: [], startAt: null, autoStartAt: null });
    expect(reset.body.room.players.every((player) => player.totalDistance === 0 && player.distance === 0)).toBe(true);
    const restarted = await call({ type: 'start', playerId: hostId, code });
    expect(restarted.body.room).toMatchObject({ phase: 'countdown', round: 1 });
  });

  it('skips a redundant heartbeat write within three seconds', async () => {
    const store = new ConditionalBlobStore();
    const playerId = 'player-333333333333333333333333';
    const clock = 1_800_000_000_000;
    let code;
    const call = async (now) => handleGameRequest(new Request('https://game.test/.netlify/functions/game', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'heartbeat', playerId, code }),
    }), { store, now });

    const created = await handleGameRequest(new Request('https://game.test/.netlify/functions/game', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'create', playerId, name: 'Amina' }),
    }), { store, now: clock });
    code = (await created.json()).code;
    const writesBeforeHeartbeat = store.writes.length;

    const recent = await call(clock + 2999);
    expect(recent.status).toBe(200);
    expect(await recent.json()).toHaveProperty('room');
    expect(store.writes).toHaveLength(writesBeforeHeartbeat);

    const due = await call(clock + 3000);
    expect(due.status).toBe(200);
    expect(store.writes).toHaveLength(writesBeforeHeartbeat + 1);
  });

  it('keeps the host and joiner connected while the host tab resumes within the background timeout', async () => {
    const store = new ConditionalBlobStore();
    const baseTime = 1_800_000_000_000;
    const hostId = 'player-background-host-1111111';
    const guestId = 'player-background-guest-111111';
    const request = async (body, now) => {
      const response = await handleGameRequest(new Request('https://game.test/.netlify/functions/game', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }), { store, now });
      return { status: response.status, body: await response.json() };
    };
    const created = await request({ type: 'create', playerId: hostId, name: 'Host' }, baseTime);
    const joined = await request({ type: 'join', playerId: guestId, code: created.body.code, name: 'Guest' }, baseTime + 9_000);
    expect(joined.body.room.hostId).toBe(hostId);
    expect(joined.body.room.players.map((player) => [player.name, player.connected])).toEqual([
      ['Host', true], ['Guest', true],
    ]);
    const started = await request({ type: 'start', playerId: hostId, code: created.body.code }, baseTime + 9_100);
    expect(started.body.room.phase).toBe('countdown');
  });

  it('restores the original lobby host after a long background pause', async () => {
    const store = new ConditionalBlobStore();
    const baseTime = 1_800_000_000_000;
    const hostId = 'player-returning-host-111111';
    const guestId = 'player-returning-guest-11111';
    const request = async (body, now) => {
      const response = await handleGameRequest(new Request('https://game.test/.netlify/functions/game', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }), { store, now });
      return { status: response.status, body: await response.json() };
    };
    const created = await request({ type: 'create', playerId: hostId, name: 'Host' }, baseTime);
    const joined = await request({ type: 'join', playerId: guestId, code: created.body.code, name: 'Guest' }, baseTime + 70_000);
    expect(joined.body.room.hostId).toBe(guestId);
    const resumed = await request({ type: 'heartbeat', playerId: hostId, code: created.body.code }, baseTime + 71_000);
    expect(resumed.body.room.hostId).toBe(hostId);
    expect(resumed.body.room.players.every((player) => player.connected)).toBe(true);
    const started = await request({ type: 'start', playerId: hostId, code: created.body.code }, baseTime + 71_100);
    expect(started.body.room.phase).toBe('countdown');
  });

  it('broadcasts only allowed multiplayer emotes to room members', async () => {
    const fixture = await runningRoomFixture('player-emote-host-111111111111');
    const sent = await fixture.request({ type: 'party_event', playerId: fixture.playerId, code: fixture.code, action: 'dua_wave' }, fixture.runningAt + 1000);
    expect(sent.status).toBe(200);
    expect(sent.body.room.lastEvent).toMatchObject({
      action: 'dua_wave', playerId: fixture.playerId, name: 'Runner', timestamp: fixture.runningAt + 1000,
    });

    const limited = await fixture.request({ type: 'party_event', playerId: fixture.playerId, code: fixture.code, action: '⚡' }, fixture.runningAt + 1500);
    expect(limited.status).toBe(429);
    const unknown = await fixture.request({ type: 'party_event', playerId: fixture.playerId, code: fixture.code, action: 'admin' }, fixture.runningAt + 2000);
    expect(unknown.status).toBe(400);
    const nonMember = await fixture.request({ type: 'party_event', action: '🤲', playerId: 'player-not-in-room-11111111', code: fixture.code }, fixture.runningAt + 2500);
    expect(nonMember.status).toBe(404);
  });

  it('clamps forged coins to the distance-based physical limit', async () => {
    const fixture = await runningRoomFixture('player-444444444444444444444444');
    const result = await fixture.progress({ distance: 40, score: 0, coins: 9999, lane: 1, y: 0, anim: 'run' });
    const player = result.body.room.players.find((entry) => entry.id === fixture.playerId);
    expect(player.distance).toBe(40);
    expect(player.coins).toBe(160); // 8 rare 10-value coins/25 m × 1.25 margin × 40 m
  });

  it('clamps forged score on finish using rare coins, combo x3 and the safety margin', async () => {
    const fixture = await runningRoomFixture('player-555555555555555555555555');
    const result = await fixture.finish({ distance: 40, score: 1e9, coins: 0 });
    const player = result.body.room.players.find((entry) => entry.id === fixture.playerId);
    expect(player.score).toBe(5506); // rare-coin ceiling, max x3 near-miss combo and margin
  });

  it('caps coins using the rare 10-value coin maximum per metre', async () => {
    const fixture = await runningRoomFixture('player-rare-coin-cap-111111111111');
    const result = await fixture.progress({ distance: 25, score: 0, coins: 9999, lane: 1, y: 0, anim: 'run' });
    const player = result.body.room.players.find((entry) => entry.id === fixture.playerId);
    expect(player.coins).toBe(100); // 8 × 10 value × 1.25 safety margin
  });

  it('does not let accepted distance, coins, or score decrease', async () => {
    const fixture = await runningRoomFixture('player-666666666666666666666666');
    const later = fixture.runningAt + 2000;
    const first = await fixture.progress({ distance: 100, score: 500, coins: 20, lane: 1, y: 0, anim: 'run' }, later);
    const decreased = await fixture.progress({ distance: 50, score: 10, coins: 1, lane: 1, y: 0, anim: 'run' }, later + 100);
    const player = decreased.body.room.players.find((entry) => entry.id === fixture.playerId);
    expect(player.distance).toBe(first.body.room.players.find((entry) => entry.id === fixture.playerId).distance);
    expect(player.coins).toBe(20);
    expect(player.score).toBe(500);
  });

  it('caps reported distance at 32 m/s plus the existing 8 m allowance', async () => {
    const fixture = await runningRoomFixture('player-777777777777777777777777');
    const result = await fixture.progress({ distance: 1000, score: 0, coins: 0, lane: 1, y: 0, anim: 'run' });
    const player = result.body.room.players.find((entry) => entry.id === fixture.playerId);
    expect(player.distance).toBe(40); // 1 s × 32 m/s + 8 m allowance
  });

  it('returns the server clock and stores progress speed and run clock', async () => {
    const fixture = await runningRoomFixture('player-clock-speed-111111111111');
    const result = await fixture.progress({ distance: 30, score: 30, coins: 0, lane: 1, y: 0, anim: 'run', speed: 18, runClock: 0.8 });
    const player = result.body.room.players.find((entry) => entry.id === fixture.playerId);
    expect(result.body.serverNow).toEqual(expect.any(Number));
    expect(player).toMatchObject({ speed: 18, runClock: 0.8 });
  });

  it('accepts and snapshots the active shield state for remote runners', async () => {
    const fixture = await runningRoomFixture('player-shield-sync-111111111111');
    const result = await fixture.progress({ distance: 30, score: 30, coins: 0, lane: 1, y: 0, anim: 'run', shield: true });
    const player = result.body.room.players.find((entry) => entry.id === fixture.playerId);
    expect(player.shield).toBe(true);
  });

  it('rejects unknown request fields', async () => {
    const fixture = await runningRoomFixture('player-888888888888888888888888');
    const result = await fixture.progress({ distance: 40, score: 0, coins: 0, lane: 1, y: 0, anim: 'run', admin: true });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/unknown request field/i);
  });

  it('rate limits each room chat sender to one message per 1.5 seconds', async () => {
    const fixture = await runningRoomFixture('player-chat-rate-1111111111');
    const send = (now) => fixture.request({ type: 'chat_send', playerId: fixture.playerId, code: fixture.code, text: 'Ready!' }, now);
    expect((await send(fixture.runningAt)).status).toBe(200);
    expect((await send(fixture.runningAt + 1499)).status).toBe(429);
    expect((await send(fixture.runningAt + 1500)).status).toBe(200);
  });

  it('strips controls and angle brackets and caps chat text at 140 characters', async () => {
    const fixture = await runningRoomFixture('player-chat-length-111111111');
    const sent = await fixture.request({
      type: 'chat_send', playerId: fixture.playerId, code: fixture.code,
      text: `<${'a'.repeat(150)}\n>`,
    }, fixture.runningAt);
    expect(sent.status).toBe(200);
    expect(sent.body.message.text).toBe('a'.repeat(140));
    expect(sent.body.message.text).not.toMatch(/[<>\u0000-\u001f]/);
  });

  it('rejects chat requests from players who are not room members', async () => {
    const fixture = await runningRoomFixture('player-chat-member-1111111');
    const response = await fixture.request({
      type: 'chat_send', playerId: 'player-chat-outsider-111111', code: fixture.code, text: 'Hello',
    });
    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/not found in this room/i);
  });

  it('retains only the latest 50 room chat messages', async () => {
    const fixture = await runningRoomFixture('player-chat-cap-11111111111');
    const otherId = `${fixture.playerId}B`;
    for (let index = 0; index < 51; index += 1) {
      const sender = index % 2 === 0 ? fixture.playerId : otherId;
      const sent = await fixture.request({
        type: 'chat_send', playerId: sender, code: fixture.code, text: `Message ${index}`,
      }, fixture.runningAt + index * 1500);
      expect(sent.status).toBe(200);
    }
    const result = await fixture.request({
      type: 'chat_poll', playerId: fixture.playerId, code: fixture.code, afterId: null,
    }, fixture.runningAt + 51 * 1500);
    expect(result.status).toBe(200);
    expect(result.body.messages).toHaveLength(50);
    expect(result.body.messages[0].text).toBe('Message 1');
    expect(result.body.messages.at(-1).text).toBe('Message 50');
  });

  it('lets room members poll messages after the last message id', async () => {
    const fixture = await runningRoomFixture('player-chat-poll-11111111111');
    const otherId = `${fixture.playerId}B`;
    const first = await fixture.request({
      type: 'chat_send', playerId: fixture.playerId, code: fixture.code, text: 'Ready!',
    }, fixture.runningAt);
    const second = await fixture.request({
      type: 'chat_send', playerId: otherId, code: fixture.code, text: 'GG',
    }, fixture.runningAt);
    const polled = await fixture.request({
      type: 'chat_poll', playerId: fixture.playerId, code: fixture.code, afterId: first.body.message.id,
    }, fixture.runningAt + 100);
    expect(second.status).toBe(200);
    expect(fixture.store.entries.has(`chat/${fixture.code}`)).toBe(true);
    expect(fixture.store.entries.get(`rooms/${fixture.code}`).data).not.toHaveProperty('messages');
    expect(fixture.store.entries.get(`chat/${fixture.code}`).data.messages[0]).toEqual({
      id: first.body.message.id,
      playerId: fixture.playerId,
      name: 'Runner',
      text: 'Ready!',
      timestamp: fixture.runningAt,
    });
    expect(polled.body.messages).toEqual([second.body.message]);
  });

  it('keeps only each player’s best server-recorded multiplayer result', async () => {
    const fixture = await runningRoomFixture('player-leaderboard-best-111111');
    const otherId = `${fixture.playerId}B`;
    await fixture.finish({ distance: 35, score: 100, coins: 4 }, fixture.runningAt);
    await fixture.request({ type: 'finish', playerId: otherId, code: fixture.code, distance: 20, score: 50, coins: 2 }, fixture.runningAt);

    const started = await fixture.request({ type: 'start', playerId: fixture.playerId, code: fixture.code }, fixture.runningAt + 1000);
    const nextRunAt = started.body.room.startAt + 1000;
    await fixture.request({ type: 'finish', playerId: fixture.playerId, code: fixture.code, distance: 25, score: 1e9, coins: 5 }, nextRunAt);
    await fixture.request({ type: 'finish', playerId: otherId, code: fixture.code, distance: 15, score: 30, coins: 1 }, nextRunAt);

    const result = await fixture.request({ type: 'leaderboard_get', playerId: fixture.playerId }, nextRunAt + 10);
    expect(result.status).toBe(200);
    expect(result.body.allTime.find((entry) => entry.playerId === fixture.playerId)).toMatchObject({
      name: 'Runner', distance: 35, coins: 4, score: 100, source: 'multiplayer',
    });
    expect(result.body.allTime.filter((entry) => entry.playerId === fixture.playerId)).toHaveLength(1);
  });

  it('sorts top scores and assigns the current player’s overall rank', async () => {
    const roomStore = new ConditionalBlobStore();
    const leaderboardStore = new ConditionalBlobStore();
    const now = 1_800_000_000_000;
    const entries = [
      { playerId: 'player-older-best-1111', name: 'Older', distance: 120, coins: 2, score: 500, date: new Date(now - 26 * 60 * 60 * 1000).toISOString(), source: 'multiplayer' },
      { playerId: 'player-coin-tie-111111', name: 'Coins', distance: 100, coins: 8, score: 400, date: new Date(now - 1000).toISOString(), source: 'multiplayer' },
      { playerId: 'player-distance-best-111', name: 'Distance', distance: 120, coins: 3, score: 200, date: new Date(now - 2000).toISOString(), source: 'multiplayer' },
    ];
    for (let index = 0; index < 30; index += 1) {
      entries.push({
        playerId: `player-extra-${String(index).padStart(12, '0')}`,
        name: `Extra ${index}`,
        distance: 90 - index,
        coins: 0,
        score: 90 - index,
        date: new Date(now - 3000 - index).toISOString(),
        source: 'multiplayer',
      });
    }
    await leaderboardStore.setJSON('entries', { players: Object.fromEntries(entries.map((entry) => [entry.playerId, entry])) });
    const response = await handleGameRequest(new Request('https://game.test/.netlify/functions/game', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'leaderboard_get', playerId: 'player-coin-tie-111111' }),
    }), { store: roomStore, leaderboardStore, now });
    const result = await response.json();
    expect(result.allTime.slice(0, 3).map((entry) => entry.playerId)).toEqual(['player-distance-best-111', 'player-older-best-1111', 'player-coin-tie-111111']);
    expect(result.allTime).toHaveLength(25);
    expect(result.today).toHaveLength(25);
    expect(result.myRanks.allTime).toBe(3);
  });

  it('shows only entries from the last 24 hours in the Today list', async () => {
    const store = new ConditionalBlobStore();
    const now = 1_800_000_000_000;
    const entries = [
      { playerId: 'player-inside-1111111', name: 'Inside', distance: 20, coins: 0, score: 20, date: new Date(now - 23 * 60 * 60 * 1000).toISOString(), source: 'multiplayer' },
      { playerId: 'player-boundary-111111', name: 'Boundary', distance: 10, coins: 0, score: 10, date: new Date(now - 24 * 60 * 60 * 1000).toISOString(), source: 'multiplayer' },
      { playerId: 'player-outside-1111111', name: 'Outside', distance: 999, coins: 0, score: 999, date: new Date(now - 24 * 60 * 60 * 1000 - 1).toISOString(), source: 'multiplayer' },
    ];
    await store.setJSON('entries', { players: Object.fromEntries(entries.map((entry) => [entry.playerId, entry])) });
    const response = await handleGameRequest(new Request('https://game.test/.netlify/functions/game', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'leaderboard_get', playerId: 'player-outside-1111111' }),
    }), { store, now });
    const result = await response.json();
    expect(result.today.map((entry) => entry.playerId)).toEqual(['player-inside-1111111', 'player-boundary-111111']);
    expect(result.myRanks.allTime).toBe(1);
    expect(result.myRanks.today).toBeNull();
  });

  it('does not accept client-supplied score fields as leaderboard submissions', async () => {
    const store = new ConditionalBlobStore();
    const response = await handleGameRequest(new Request('https://game.test/.netlify/functions/game', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'leaderboard_get', playerId: 'player-leaderboard-forge-1111', distance: 999999, score: 1e9, coins: 9999 }),
    }), { store, now: 1_800_000_000_000 });
    expect(response.status).toBe(400);
    expect(store.entries.has('entries')).toBe(false);
  });

  it('includes only allow-listed skin IDs in multiplayer room snapshots', async () => {
    const store = new ConditionalBlobStore();
    const now = 1_800_000_000_000;
    const call = async (body) => {
      const response = await handleGameRequest(new Request('https://game.test/.netlify/functions/game', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }), { store, now });
      return { status: response.status, body: await response.json() };
    };
    const rejected = await call({ type: 'create', playerId: 'player-skin-owner-111111', name: 'Amina', skinId: 'custom-upload' });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toMatch(/unknown player skin/i);

    const created = await call({ type: 'create', playerId: 'player-skin-owner-111111', name: '<Amina>', skinId: 'monsoon' });
    expect(created.body.room.players[0]).toMatchObject({ name: 'Amina', skinId: 'monsoon' });
    const unknownJoin = await call({
      type: 'join', playerId: 'player-skin-guest-1111111', name: 'Basheer', code: created.body.code, skinId: 'uploads',
    });
    expect(unknownJoin.status).toBe(400);
  });
});
