import { randomBytes, randomInt, randomUUID } from 'node:crypto';

export const MAX_PLAYERS = 8;
export const MAX_ROUNDS = 3;
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
const PLAYER_TIMEOUT_MS = 18_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_PREFIX = 'rooms/';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function cleanName(value) {
  const name = String(value || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 16);
  return name || `Runner ${randomInt(10, 100)}`;
}

function cleanPlayerId(value) {
  const id = String(value || '');
  return /^[A-Za-z0-9-]{16,64}$/.test(id) ? id : null;
}

function cleanCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function newRoomCode() {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

const roomKey = (code) => `${ROOM_PREFIX}${code}`;
const connected = (player, now) => player.connected && now - player.lastSeenAt <= PLAYER_TIMEOUT_MS;

function totalFor(player, key) {
  return player.rounds.reduce((sum, round) => sum + (Number(round[key]) || 0), 0);
}

function roundStandings(room, roundNumber = room.round) {
  const result = room.roundResults.find((entry) => entry.round === roundNumber);
  return result?.standings || room.players.map((player) => ({
    playerId: player.id,
    distance: player.distance,
    score: player.score,
    coins: player.coins,
  }));
}

function snapshot(room, now) {
  const phase = room.phase === 'countdown' && now >= room.startAt ? 'running' : room.phase;
  return {
    code: room.code,
    phase,
    hostId: room.hostId,
    seed: room.seed,
    startAt: room.startAt,
    round: room.round,
    maxRounds: MAX_ROUNDS,
    roundResults: room.roundResults,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: connected(player, now),
      distance: Math.floor(player.distance),
      score: Math.floor(player.score),
      coins: player.coins,
      totalDistance: Math.floor(totalFor(player, 'distance')),
      totalScore: Math.floor(totalFor(player, 'score')),
      totalCoins: totalFor(player, 'coins'),
      lane: player.lane,
      y: player.y,
      anim: player.anim,
      alive: player.alive,
    })),
  };
}

function publicError(message, status = 400) {
  return { response: json({ error: message }, status), changed: false };
}

function createPlayer(id, name, now) {
  return {
    id,
    name: cleanName(name),
    connected: true,
    lastSeenAt: now,
    distance: 0,
    score: 0,
    coins: 0,
    lane: 1,
    y: 0,
    anim: 'run',
    alive: true,
    rounds: [],
  };
}

function recordRun(room, player) {
  if (player.rounds.some((entry) => entry.round === room.round)) return;
  player.rounds.push({
    round: room.round,
    distance: Math.floor(player.distance),
    score: Math.floor(player.score),
    coins: Math.floor(player.coins),
  });
}

function finishRoundIfReady(room) {
  if (room.phase !== 'running' || !room.players.length || room.players.some((player) => player.alive && player.connected)) return;
  if (!room.roundResults.some((entry) => entry.round === room.round)) {
    const standings = room.players.map((player) => ({
      playerId: player.id,
      distance: Math.floor(player.distance),
      score: Math.floor(player.score),
      coins: Math.floor(player.coins),
    })).sort((a, b) => b.distance - a.distance || b.coins - a.coins || b.score - a.score);
    room.roundResults.push({ round: room.round, standings });
  }
  room.phase = room.round >= MAX_ROUNDS ? 'gameover' : 'roundover';
  room.startAt = null;
}

function expirePlayers(room, now) {
  let changed = false;
  for (const player of room.players) {
    if (player.connected && !connected(player, now)) {
      player.connected = false;
      changed = true;
      if (room.phase === 'running' && player.alive) {
        player.alive = false;
        player.anim = 'fall';
        recordRun(room, player);
      }
    }
  }
  if (room.hostId && !room.players.some((player) => player.id === room.hostId && connected(player, now))) {
    room.hostId = room.players.find((player) => connected(player, now))?.id || null;
    changed = true;
  }
  if (changed) finishRoundIfReady(room);
  return changed;
}

function advanceCountdown(room, now) {
  if (room.phase === 'countdown' && now >= room.startAt) {
    room.phase = 'running';
    return true;
  }
  return false;
}

function beginRound(room, now) {
  if (room.phase === 'lobby') room.round = 1;
  else if (room.phase === 'roundover' && room.round < MAX_ROUNDS) room.round += 1;
  else return false;

  const players = room.players.filter((player) => connected(player, now));
  if (players.length < 2) return false;
  for (const player of players) {
    player.distance = 0;
    player.score = 0;
    player.coins = 0;
    player.lane = 1;
    player.y = 0;
    player.anim = 'run';
    player.alive = true;
  }
  room.seed = randomBytes(4).readUInt32BE(0);
  room.phase = 'countdown';
  room.startAt = now + 3000;
  room.expiresAt = now + ROOM_TTL_MS;
  return true;
}

async function createRoom(store, playerId, name, now) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = newRoomCode();
    const player = createPlayer(playerId, name, now);
    const room = {
      code,
      phase: 'lobby',
      hostId: player.id,
      players: [player],
      round: 0,
      roundResults: [],
      seed: randomBytes(4).readUInt32BE(0),
      startAt: null,
      expiresAt: now + ROOM_TTL_MS,
    };
    const result = await store.setJSON(roomKey(code), room, { onlyIfNew: true });
    if (result.modified) return json({ playerId, code, room: snapshot(room, now) }, 201);
  }
  return json({ error: 'Could not create a room. Please try again.' }, 503);
}

async function mutateRoom(store, code, playerId, now, action) {
  const key = roomKey(code);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entry = await store.getWithMetadata(key, { consistency: 'strong', type: 'json' });
    if (!entry) return json({ error: 'Room code not found. Check the code and try again.' }, 404);
    const room = entry.data;
    if (room.expiresAt < now) return json({ error: 'This room has expired. Create a new room.' }, 410);
    const staleChanged = expirePlayers(room, now);
    const countdownChanged = advanceCountdown(room, now);
    const outcome = await action(room, now);
    if (outcome?.response && !outcome.changed && !staleChanged && !countdownChanged) return outcome.response;
    const changed = staleChanged || countdownChanged || outcome?.changed;
    if (!changed) return json({ ok: true, room: snapshot(room, now) });
    room.expiresAt = now + ROOM_TTL_MS;
    const result = await store.setJSON(key, room, { onlyIfMatch: entry.etag });
    if (result.modified) return outcome?.response || json({ ok: true, room: snapshot(room, now) });
    await new Promise((resolve) => setTimeout(resolve, Math.min(3 + attempt * 5, 40)));
  }
  return json({ error: 'The room is busy. Please try that again.' }, 409);
}

async function joinRoom(store, code, playerId, name, now) {
  return mutateRoom(store, code, playerId, now, (room) => {
    const existing = room.players.find((player) => player.id === playerId);
    if (existing) {
      existing.name = cleanName(name);
      existing.connected = true;
      existing.lastSeenAt = now;
      if (!room.hostId) room.hostId = existing.id;
      return { changed: true, response: json({ playerId, code, room: snapshot(room, now) }) };
    }
    if (room.phase !== 'lobby') return publicError('That race has already started.');
    if (room.players.filter((player) => connected(player, now)).length >= MAX_PLAYERS) return publicError('That room is full.', 409);
    room.players.push(createPlayer(playerId, name, now));
    if (!room.hostId) room.hostId = playerId;
    return { changed: true, response: json({ playerId, code, room: snapshot(room, now) }, 201) };
  });
}

function finiteNumber(value, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(max, number)) : 0;
}

function handleAction(room, playerId, body, now) {
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) return publicError('Player not found in this room.', 404);
  player.connected = true;
  player.lastSeenAt = now;

  if (body.type === 'heartbeat') return { changed: true };
  if (body.type === 'leave') {
    player.connected = false;
    player.alive = false;
    player.anim = 'fall';
    recordRun(room, player);
    if (room.phase === 'lobby') room.players = room.players.filter((entry) => entry.id !== playerId);
    if (room.hostId === playerId) room.hostId = room.players.find((entry) => entry.connected)?.id || null;
    finishRoundIfReady(room);
    return { changed: true };
  }
  if (body.type === 'start') {
    if (playerId !== room.hostId) return publicError('Only the host can start the next race.', 403);
    if (room.phase === 'lobby' && room.players.filter((entry) => connected(entry, now)).length < 2) {
      return publicError('Invite at least one more player before starting.');
    }
    if (!beginRound(room, now)) return publicError('At least two players must be connected to start the next round.');
    return { changed: true };
  }
  if (body.type === 'progress' || body.type === 'finish') {
    if (room.phase !== 'running' || !player.alive) return { changed: true };
    const elapsed = Math.max(0, (now - (room.startAt || now)) / 1000);
    const maxDistance = elapsed * 32 + 8;
    player.distance = Math.max(player.distance, Math.min(maxDistance, finiteNumber(body.distance, 1e7)));
    player.score = Math.max(player.score, finiteNumber(body.score, 1e9));
    player.coins = Math.max(player.coins, Math.floor(finiteNumber(body.coins, 9999)));
    if (body.type === 'progress') {
      player.lane = Math.max(0, Math.min(2, Math.floor(finiteNumber(body.lane, 2))));
      player.y = finiteNumber(body.y, 10);
      player.anim = ['run', 'jump', 'slide', 'glide', 'jetpack', 'fall'].includes(body.anim) ? body.anim : 'run';
    } else {
      player.alive = false;
      player.anim = 'fall';
      recordRun(room, player);
      finishRoundIfReady(room);
    }
    return { changed: true };
  }
  return publicError('Unknown game action.');
}

export async function handleGameRequest(request, { store, now = Date.now() }) {
  try {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const code = cleanCode(url.searchParams.get('code'));
      const playerId = cleanPlayerId(url.searchParams.get('playerId'));
      if (!code || !playerId) return json({ error: 'Room code and player ID are required.' }, 400);
      const entry = await store.getWithMetadata(roomKey(code), { consistency: 'strong', type: 'json' });
      if (!entry || entry.data.expiresAt < now) return json({ error: 'Room code not found or expired.' }, 404);
      if (!entry.data.players.some((player) => player.id === playerId)) return json({ error: 'Player not found in this room.' }, 404);
      return json({ room: snapshot(entry.data, now) });
    }
    if (request.method !== 'POST') return json({ error: 'Use GET to read a room or POST to send a game action.' }, 405);
    if (request.headers.get('content-length') && Number(request.headers.get('content-length')) > 16_384) return json({ error: 'Game request is too large.' }, 413);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Request body must be valid JSON.' }, 400); }
    if (!body || typeof body.type !== 'string') return json({ error: 'Game action is required.' }, 400);
    if (body.type === 'health') return json({ ok: true });
    const playerId = cleanPlayerId(body.playerId);
    if (!playerId) return json({ error: 'A valid player ID is required.' }, 400);
    if (body.type === 'create') return createRoom(store, playerId, body.name, now);
    const code = cleanCode(body.code);
    if (code.length !== 6) return json({ error: 'Enter the 6-character room code.' }, 400);
    if (body.type === 'join') return joinRoom(store, code, playerId, body.name, now);
    return mutateRoom(store, code, playerId, now, (room, actionTime) => handleAction(room, playerId, body, actionTime));
  } catch (error) {
    console.error('Multiplayer game request failed:', error);
    return json({ error: 'The race service is temporarily unavailable. Please retry.' }, 503);
  }
}

export const __test = { snapshot, finishRoundIfReady, handleAction, roomKey, MAX_ROUNDS };
