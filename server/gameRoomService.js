import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { AVATAR_SKIN_IDS, DEFAULT_SKIN_ID } from '../src/game/AvatarSkins.js';

export const MAX_PLAYERS = 8;
export const MAX_ROUNDS = 3;
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
// Leave room for backgrounded tabs to resume and send an immediate heartbeat.
const PLAYER_TIMEOUT_MS = 60_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_PREFIX = 'rooms/';
const CHAT_PREFIX = 'chat/';
const CHAT_MAX_MESSAGES = 50;
const CHAT_MAX_LENGTH = 140;
const CHAT_RATE_LIMIT_MS = 1500;
const LEADERBOARD_KEY = 'entries';
const LEADERBOARD_LIMIT = 25;
const LEADERBOARD_DAY_MS = 24 * 60 * 60 * 1000;

// Coin patterns contain at most 8 coins per 25 m. Any coin can be the rare
// 10-value gold coin, so the strict physical maximum is 8 × 10 / 25 = 3.2.
const MAX_COINS_PER_METER = (8 * 10) / 25;
// ScoringSystem: 1 point/m, 10 points/coin, 25 points/near miss, up to 3x
// combined x2-powerup + near-miss combo, plus 50 points per 1000 m checkpoint.
// ObstacleManager's minimum row gap is 20.2 m; at most two adjacent hazards
// can award 25-point near-misses per row when the player passes in the center lane.
const MAX_SCORE_MULTIPLIER = 3;
const MAX_SCORE_PER_METER = (1 + MAX_COINS_PER_METER * 10 + (MAX_SCORE_MULTIPLIER * 25) / 20.2) * MAX_SCORE_MULTIPLIER;
const CHECKPOINT_BONUS_SCORE = 50;
const CHECKPOINT_INTERVAL_M = 1000;
const SCORING_SAFETY_MARGIN = 1.25;

const REQUEST_FIELDS = {
  health: ['type', 'playerId'],
  create: ['type', 'playerId', 'name', 'skinId'],
  join: ['type', 'playerId', 'code', 'name', 'skinId'],
  start: ['type', 'playerId', 'code'],
  play_again: ['type', 'playerId', 'code'],
  heartbeat: ['type', 'playerId', 'code'],
  leave: ['type', 'playerId', 'code'],
  progress: ['type', 'playerId', 'code', 'distance', 'score', 'coins', 'lane', 'y', 'anim', 'speed', 'runClock', 'shield'],
  finish: ['type', 'playerId', 'code', 'distance', 'score', 'coins'],
  chat_send: ['type', 'playerId', 'code', 'text'],
  chat_poll: ['type', 'playerId', 'code', 'afterId'],
  leaderboard_get: ['type', 'playerId'],
};

const json = (body, status = 200) => new Response(JSON.stringify({ ...body, serverNow: Date.now() }), {
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
const chatKey = (code) => `${CHAT_PREFIX}${code}`;
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
    autoStartAt: room.autoStartAt ?? null,
    round: room.round,
    maxRounds: MAX_ROUNDS,
    roundResults: room.roundResults,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      skinId: player.skinId || DEFAULT_SKIN_ID,
      connected: connected(player, now),
      distance: player.distance,
      score: Math.floor(player.score),
      coins: player.coins,
      totalDistance: Math.floor(totalFor(player, 'distance')),
      totalScore: Math.floor(totalFor(player, 'score')),
      totalCoins: totalFor(player, 'coins'),
      lane: player.lane,
      y: player.y,
      anim: player.anim,
      shield: player.shield === true,
      alive: player.alive,
      speed: player.speed || 0,
      runClock: player.runClock || 0,
    })),
  };
}

function publicError(message, status = 400) {
  return { response: json({ error: message }, status), changed: false };
}

function createPlayer(id, name, now, skinId = DEFAULT_SKIN_ID) {
  return {
    id,
    name: cleanName(name),
    skinId,
    connected: true,
    lastSeenAt: now,
    distance: 0,
    score: 0,
    coins: 0,
    lane: 1,
    y: 0,
    anim: 'run',
    shield: false,
    speed: 0,
    runClock: 0,
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

function finishRoundIfReady(room, now) {
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
  room.autoStartAt = room.phase === 'roundover' ? now + 25_000 : null;
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
  if (changed) finishRoundIfReady(room, now);
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
    player.shield = false;
    player.alive = true;
  }
  room.seed = randomBytes(4).readUInt32BE(0);
  room.phase = 'countdown';
  room.startAt = now + 3000;
  room.autoStartAt = null;
  room.expiresAt = now + ROOM_TTL_MS;
  return true;
}

async function createRoom(store, playerId, name, skinId, now) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = newRoomCode();
    const player = createPlayer(playerId, name, now, skinId);
    const room = {
      code,
      phase: 'lobby',
      hostId: player.id,
      ownerId: player.id,
      players: [player],
      round: 0,
      roundResults: [],
      seed: randomBytes(4).readUInt32BE(0),
      startAt: null,
      autoStartAt: null,
      expiresAt: now + ROOM_TTL_MS,
    };
    const result = await store.setJSON(roomKey(code), room, { onlyIfNew: true });
    if (result.modified) return json({ playerId, code, room: snapshot(room, now) }, 201);
  }
  return json({ error: 'Could not create a room. Please try again.' }, 503);
}

function leaderboardSort(a, b) {
  return b.distance - a.distance || b.coins - a.coins || b.score - a.score || a.date.localeCompare(b.date) || a.name.localeCompare(b.name);
}

function isBetterLeaderboardEntry(candidate, current) {
  return !current || candidate.distance > current.distance ||
    (candidate.distance === current.distance && candidate.coins > current.coins) ||
    (candidate.distance === current.distance && candidate.coins === current.coins && candidate.score > current.score);
}

async function recordLeaderboardRound(store, room, roundResult, now) {
  if (!store || !roundResult?.standings?.length) return;
  const names = new Map(room.players.map((player) => [player.id, player.name]));
  const candidates = roundResult.standings.map((standing) => ({
    playerId: standing.playerId,
    name: cleanName(names.get(standing.playerId)),
    distance: Math.max(0, Math.floor(Number(standing.distance) || 0)),
    coins: Math.max(0, Math.floor(Number(standing.coins) || 0)),
    score: Math.max(0, Math.floor(Number(standing.score) || 0)),
    date: new Date(now).toISOString(),
    source: 'multiplayer',
  }));

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entry = await store.getWithMetadata(LEADERBOARD_KEY, { consistency: 'strong', type: 'json' });
    const players = entry?.data?.players || {};
    const nextPlayers = { ...players };
    let changed = false;
    for (const candidate of candidates) {
      if (isBetterLeaderboardEntry(candidate, players[candidate.playerId])) {
        nextPlayers[candidate.playerId] = candidate;
        changed = true;
      }
    }
    if (!changed) return;
    const options = entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true };
    const result = await store.setJSON(LEADERBOARD_KEY, { players: nextPlayers }, options);
    if (result.modified) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(3 + attempt * 5, 40)));
  }
  throw new Error('Leaderboard is busy after repeated conditional-write conflicts.');
}

async function readLeaderboard(store, playerId, now) {
  const entry = await store?.getWithMetadata(LEADERBOARD_KEY, { consistency: 'strong', type: 'json' });
  const players = Object.values(entry?.data?.players || {}).sort(leaderboardSort);
  const cutoff = now - LEADERBOARD_DAY_MS;
  const today = players.filter((candidate) => {
    const time = Date.parse(candidate.date);
    return Number.isFinite(time) && time >= cutoff && time <= now;
  });
  const allRank = players.findIndex((candidate) => candidate.playerId === playerId);
  const todayRank = today.findIndex((candidate) => candidate.playerId === playerId);
  return json({
    allTime: players.slice(0, LEADERBOARD_LIMIT),
    today: today.slice(0, LEADERBOARD_LIMIT),
    myRanks: { allTime: allRank < 0 ? null : allRank + 1, today: todayRank < 0 ? null : todayRank + 1 },
    myEntry: {
      allTime: allRank < 0 ? null : players[allRank],
      today: todayRank < 0 ? null : today[todayRank],
    },
  });
}

async function handleChatRequest(store, code, playerId, body, now) {
  const roomEntry = await store.getWithMetadata(roomKey(code), { consistency: 'strong', type: 'json' });
  if (!roomEntry || roomEntry.data.expiresAt < now) {
    await store.delete?.(chatKey(code));
    return json({ error: 'Room code not found or expired.' }, 404);
  }
  const room = roomEntry.data;
  const player = room.players.find((entry) => entry.id === playerId);
  if (!player) return json({ error: 'Player not found in this room.' }, 404);

  const key = chatKey(code);
  if (body.type === 'chat_poll') {
    const entry = await store.getWithMetadata(key, { consistency: 'strong', type: 'json' });
    if (!entry) return json({ messages: [] });
    const messages = entry.data.messages || [];
    const afterIndex = messages.findIndex((message) => message.id === body.afterId);
    return json({ messages: afterIndex < 0 ? messages : messages.slice(afterIndex + 1) });
  }

  if (typeof body.text !== 'string') return json({ error: 'Message text is required.' }, 400);
  const text = Array.from(body.text.replace(/[<>\u0000-\u001f\u007f-\u009f]/g, '').trim()).slice(0, CHAT_MAX_LENGTH).join('');
  if (!text) return json({ error: 'Message cannot be empty.' }, 400);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entry = await store.getWithMetadata(key, { consistency: 'strong', type: 'json' });
    const chat = entry?.data || { expiresAt: room.expiresAt, messages: [], lastSentAt: {} };
    const lastSentAt = Number(chat.lastSentAt?.[playerId]) || 0;
    if (now - lastSentAt < CHAT_RATE_LIMIT_MS) return json({ error: 'Please wait before sending another message.' }, 429);
    const message = { id: `${now}-${randomUUID()}`, playerId, name: player.name, text, timestamp: now };
    const next = {
      expiresAt: room.expiresAt,
      messages: [...(chat.messages || []), message].slice(-CHAT_MAX_MESSAGES),
      lastSentAt: { ...(chat.lastSentAt || {}), [playerId]: now },
    };
    const options = entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true };
    const result = await store.setJSON(key, next, options);
    if (result.modified) return json({ message });
    await new Promise((resolve) => setTimeout(resolve, Math.min(3 + attempt * 5, 40)));
  }
  return json({ error: 'Chat is busy. Please try again.' }, 409);
}

async function mutateRoom(store, code, playerId, now, action, leaderboardStore) {
  const key = roomKey(code);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entry = await store.getWithMetadata(key, { consistency: 'strong', type: 'json' });
    if (!entry) return json({ error: 'Room code not found. Check the code and try again.' }, 404);
    const room = entry.data;
    if (room.expiresAt < now) return json({ error: 'This room has expired. Create a new room.' }, 410);
    const resultRoundsBefore = new Set(room.roundResults.map((result) => result.round));
    const staleChanged = expirePlayers(room, now);
    const countdownChanged = advanceCountdown(room, now);
    const autoStarted = room.phase === 'roundover' && room.autoStartAt && now >= room.autoStartAt
      ? beginRound(room, now)
      : false;
    const outcome = autoStarted ? { changed: false } : await action(room, now);
    const completedRounds = room.roundResults.filter((result) => !resultRoundsBefore.has(result.round));
    if (outcome?.response && !outcome.changed && !staleChanged && !countdownChanged) return outcome.response;
    const changed = staleChanged || countdownChanged || autoStarted || outcome?.changed;
    if (!changed) return json({ ok: true, room: snapshot(room, now) });
    room.expiresAt = now + ROOM_TTL_MS;
    const result = await store.setJSON(key, room, { onlyIfMatch: entry.etag });
    if (result.modified) {
      for (const roundResult of completedRounds) {
        try { await recordLeaderboardRound(leaderboardStore, room, roundResult, now); }
        catch (error) { console.error('Could not record multiplayer leaderboard result:', error); }
      }
      return outcome?.response || json({ ok: true, room: snapshot(room, now) });
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(3 + attempt * 5, 40)));
  }
  return json({ error: 'The room is busy. Please try that again.' }, 409);
}

async function joinRoom(store, code, playerId, name, skinId, now) {
  return mutateRoom(store, code, playerId, now, (room) => {
    const existing = room.players.find((player) => player.id === playerId);
    if (existing) {
      existing.name = cleanName(name);
      existing.skinId = skinId;
      existing.connected = true;
      existing.lastSeenAt = now;
      if (room.phase === 'lobby' && room.ownerId === existing.id) room.hostId = existing.id;
      if (!room.hostId) room.hostId = existing.id;
      return { changed: true, response: json({ playerId, code, room: snapshot(room, now) }) };
    }
    if (room.phase !== 'lobby') return publicError('That race has already started.');
    if (room.players.filter((player) => connected(player, now)).length >= MAX_PLAYERS) return publicError('That room is full.', 409);
    room.players.push(createPlayer(playerId, name, now, skinId));
    if (!room.hostId) room.hostId = playerId;
    return { changed: true, response: json({ playerId, code, room: snapshot(room, now) }, 201) };
  });
}

function finiteNumber(value, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(max, number)) : 0;
}

function hasUnknownFields(body) {
  const allowed = REQUEST_FIELDS[body.type] || ['type', 'playerId', 'code'];
  return Object.keys(body).some((field) => !allowed.includes(field));
}

function handleAction(room, playerId, body, now) {
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) return publicError('Player not found in this room.', 404);
  const restoreHost = room.phase === 'lobby' && room.ownerId === playerId && room.hostId !== playerId;
  if (body.type === 'heartbeat' && !restoreHost && player.connected && now - player.lastSeenAt < 3000) {
    return { changed: false };
  }
  player.connected = true;
  player.lastSeenAt = now;
  if (restoreHost) room.hostId = playerId;

  if (body.type === 'heartbeat') return { changed: true };
  if (body.type === 'leave') {
    player.connected = false;
    player.alive = false;
    player.shield = false;
    player.anim = 'fall';
    recordRun(room, player);
    if (room.phase === 'lobby') room.players = room.players.filter((entry) => entry.id !== playerId);
    if (room.hostId === playerId) room.hostId = room.players.find((entry) => connected(entry, now))?.id || null;
    finishRoundIfReady(room, now);
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
  if (body.type === 'play_again') {
    if (playerId !== room.hostId) return publicError('Only the host can reset this match.', 403);
    if (room.phase !== 'gameover') return publicError('The match is not finished yet.');
    room.phase = 'lobby';
    room.round = 0;
    room.roundResults = [];
    room.startAt = null;
    room.autoStartAt = null;
    room.seed = randomBytes(4).readUInt32BE(0);
    for (const entry of room.players) {
      entry.rounds = [];
      entry.distance = 0;
      entry.score = 0;
      entry.coins = 0;
      entry.lane = 1;
      entry.y = 0;
      entry.anim = 'run';
      entry.shield = false;
      entry.alive = true;
    }
    return { changed: true };
  }
  if (body.type === 'progress' || body.type === 'finish') {
    if (room.phase !== 'running' || !player.alive) return { changed: true };
    const elapsed = Math.max(0, (now - (room.startAt || now)) / 1000);
    const maxDistance = elapsed * 32 + 8;
    player.distance = Math.max(player.distance, Math.min(maxDistance, finiteNumber(body.distance, 1e7)));
    player.speed = finiteNumber(body.speed, 32);
    player.runClock = Math.max(player.runClock || 0, Math.min(elapsed, finiteNumber(body.runClock, elapsed)));
    const maxCoins = Math.floor(player.distance * MAX_COINS_PER_METER * SCORING_SAFETY_MARGIN);
    const milestoneCount = Math.floor(player.distance / CHECKPOINT_INTERVAL_M);
    const maxScore = Math.floor((player.distance * MAX_SCORE_PER_METER + milestoneCount * CHECKPOINT_BONUS_SCORE * MAX_SCORE_MULTIPLIER) * SCORING_SAFETY_MARGIN);
    player.score = Math.max(player.score, Math.min(maxScore, finiteNumber(body.score, Number.MAX_SAFE_INTEGER)));
    player.coins = Math.max(player.coins, Math.floor(Math.min(maxCoins, finiteNumber(body.coins, Number.MAX_SAFE_INTEGER))));
    if (body.type === 'progress') {
      player.lane = Math.max(0, Math.min(2, Math.floor(finiteNumber(body.lane, 2))));
      player.y = finiteNumber(body.y, 10);
      player.anim = ['run', 'jump', 'slide', 'glide', 'jetpack', 'fall'].includes(body.anim) ? body.anim : 'run';
      player.shield = body.type === 'progress' && body.shield === true;
    } else {
      player.alive = false;
      player.anim = 'fall';
      player.shield = false;
      recordRun(room, player);
      finishRoundIfReady(room, now);
    }
    return { changed: true };
  }
  return publicError('Unknown game action.');
}

export async function handleGameRequest(request, { store, leaderboardStore = store, now = Date.now() }) {
  try {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const code = cleanCode(url.searchParams.get('code'));
      const playerId = cleanPlayerId(url.searchParams.get('playerId'));
      if (!code || !playerId) return json({ error: 'Room code and player ID are required.' }, 400);
      const entry = await store.getWithMetadata(roomKey(code), { consistency: 'strong', type: 'json' });
      if (!entry || entry.data.expiresAt < now) return json({ error: 'Room code not found or expired.' }, 404);
      if (!entry.data.players.some((player) => player.id === playerId)) return json({ error: 'Player not found in this room.' }, 404);
      return mutateRoom(store, code, playerId, now, () => ({ changed: false }), leaderboardStore);
    }
    if (request.method !== 'POST') return json({ error: 'Use GET to read a room or POST to send a game action.' }, 405);
    if (request.headers.get('content-length') && Number(request.headers.get('content-length')) > 16_384) return json({ error: 'Game request is too large.' }, 413);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Request body must be valid JSON.' }, 400); }
    if (!body || typeof body.type !== 'string') return json({ error: 'Game action is required.' }, 400);
    if (hasUnknownFields(body)) return json({ error: 'Unknown request field.' }, 400);
    if (body.type === 'health') return json({ ok: true });
    const playerId = cleanPlayerId(body.playerId);
    if (!playerId) return json({ error: 'A valid player ID is required.' }, 400);
    if (body.type === 'leaderboard_get') return readLeaderboard(leaderboardStore, playerId, now);
    const skinId = body.skinId === undefined ? DEFAULT_SKIN_ID : body.skinId;
    if ((body.type === 'create' || body.type === 'join') && !AVATAR_SKIN_IDS.includes(skinId)) {
      return json({ error: 'Unknown player skin.' }, 400);
    }
    if (body.type === 'create') return createRoom(store, playerId, body.name, skinId, now);
    const code = cleanCode(body.code);
    if (code.length !== 6) return json({ error: 'Enter the 6-character room code.' }, 400);
    if (body.type === 'join') return joinRoom(store, code, playerId, body.name, skinId, now);
    if (body.type === 'chat_send' || body.type === 'chat_poll') {
      const roomUpdate = await mutateRoom(store, code, playerId, now, () => ({ changed: false }), leaderboardStore);
      if (!roomUpdate.ok) return roomUpdate;
      return handleChatRequest(store, code, playerId, body, now);
    }
    return mutateRoom(store, code, playerId, now, (room, actionTime) => handleAction(room, playerId, body, actionTime), leaderboardStore);
  } catch (error) {
    console.error('Multiplayer game request failed:', error);
    return json({ error: 'The race service is temporarily unavailable. Please retry.' }, 503);
  }
}

export const __test = { snapshot, finishRoundIfReady, handleAction, roomKey, chatKey, recordLeaderboardRound, readLeaderboard, MAX_ROUNDS };
