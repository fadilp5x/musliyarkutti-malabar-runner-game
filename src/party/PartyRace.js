import * as THREE from 'three';
import { PlayerAvatar } from '../game/PlayerAvatar.js';
import { ShieldBubble } from '../game/ShieldBubble.js';
import { LANES } from '../game/PlayerController.js';
import './party.css';

const PLAYER_COLORS = [
  'var(--color-green-500)', 'var(--color-green-700)',
  'var(--color-gold-400)', 'var(--color-gold-600)',
  'var(--color-sky-400)', 'var(--color-sky-600)',
  'var(--color-coral-500)', 'var(--color-coral-700)',
];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const numberText = (value) => Math.floor(Math.max(0, value || 0)).toLocaleString();
export function estimateRemoteDistance({ distance, speed, runClock, myRunClock, previous = 0 }) {
  const extraSeconds = clamp((Number(myRunClock) || 0) - (Number(runClock) || 0), 0, 0.6);
  return Math.max(Number(previous) || 0, (Number(distance) || 0) + clamp(Number(speed) || 0, 0, 32) * extraSeconds);
}
export const remoteRunnerZ = (remoteDistance, myDistance) => clamp(-(remoteDistance - myDistance), -60, 6);
export const remoteRunnerIsAlive = (player) => Boolean(player?.alive && player?.connected);
export const PARTY_PROGRESS_INTERVAL_MS = 400;
export const PARTY_POLL_INTERVAL_MS = 1500;
export const PARTY_HEARTBEAT_INTERVAL_MS = 6000;
const MAX_POLL_BACKOFF_MS = 5000;
export const raceProgressPercent = (distance, leaderDistance) => leaderDistance > 0
  ? clamp((Math.max(0, Number(distance) || 0) / leaderDistance) * 100, 0, 100)
  : 0;
export const roomShareUrl = (code) => `https://malabarrunner28.netlify.app/?room=${encodeURIComponent(String(code || '').toUpperCase())}`;
export function collectLobbyJoins(room, playerId, state) {
  if (!room?.code || !Array.isArray(room.players)) return [];
  if (state.roomCode !== room.code) {
    state.roomCode = room.code;
    state.playerIds = new Set(room.players.map((player) => player.id));
    return [];
  }
  const joined = [];
  for (const player of room.players) {
    if (state.playerIds.has(player.id)) continue;
    state.playerIds.add(player.id);
    if (player.id !== playerId && room.phase === 'lobby') joined.push(player);
  }
  return joined;
}

export class PartyRace {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.playerId = this._getPlayerId();
    this.room = null;
    this.roomCode = null;
    this._knownRoomPlayers = { roomCode: null, playerIds: new Set() };
    this._joinHighlightIds = new Set();
    this.finishedForRoom = null;
    this.apiReady = false;
    this._progressPending = false;
    this.countdownTimer = null;
    this.progressTimer = null;
    this.pollTimer = null;
    this.heartbeatTimer = null;
    this.spectatorPollTimer = null;
    this.roundoverTimer = null;
    this.countdownInterval = null;
    this._pollDelay = PARTY_POLL_INTERVAL_MS;
    this._timerMode = 'none';
    this._pollPending = false;
    this.lastRemoteFrame = 0;
    this.remoteAvatars = new Map();
    this.remoteSnapshots = new Map();
    this.remoteDistanceMax = new Map();
    this.remoteEdgeIndicators = new Map();
    this.crashedRemoteIds = new Set();
    this._serverOffsetMs = 0;
    this.spectating = false;
    this.chatTimer = null;
    this.chatPending = false;
    this.chatOpen = false;
    this.chatUnread = 0;
    this.chatAfterId = null;
    this.chatMessages = [];
    this.chatRoomKey = null;
    this._remoteRoundKey = null;
    this.lastPartyEventId = null;
    this._buildUI();
    this._connect();
    this.game.partyRace = this;
    this.game.events?.on?.('statechange', (state) => this._onGameState(state));
    this.game.events?.on?.('powerup', () => this._broadcastPartyEvent('boost'));
    this._onVisibilityChange = () => this._handleVisibilityChange();
    document.addEventListener('visibilitychange', this._onVisibilityChange);
    this._raf = 0;
    this._syncNetworkTimers();
    if (!document.hidden) this._startRemoteAnimation();
  }

  _buildUI() {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'party-layer hidden';
    this.rootEl.setAttribute('role', 'dialog');
    this.rootEl.setAttribute('aria-modal', 'true');
    this.rootEl.setAttribute('aria-label', 'Multiplayer race');
    this.rootEl.innerHTML = `
      <section class="party-card">
        <div class="party-view" data-view="entry">
          <div class="party-kicker">Multiplayer · 2–8 runners</div>
          <h2 class="party-title">Race together.</h2>
          <p class="party-copy">Create a room and share its code. Race three rounds on the original 3D course; total distance wins, with coins breaking ties.</p>
          <div class="party-fields">
            <label class="party-field">Your name<input data-name maxlength="16" autocomplete="nickname" placeholder="Runner name"></label>
            <label class="party-field">Room code<input data-code maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="Enter a friend's 4-letter code"></label>
          </div>
          <div class="party-actions"><button class="btn" data-create>Create room</button><button class="btn secondary" data-join>Join room</button></div>
          <div class="party-status" data-status>Connecting to the race server…</div>
          <div class="party-actions"><button class="btn secondary small" data-close>Back to title</button></div>
        </div>
        <div class="party-view hidden" data-view="lobby">
          <div class="party-kicker">Waiting room</div><h2 class="party-title">Race lobby</h2>
          <p class="party-copy">Share the code, then run three rounds. Total distance wins; race coins break ties.</p><button type="button" class="party-code" data-room-code aria-label="Copy room code">------</button>
          <div class="party-share-actions"><button type="button" class="party-share-button" data-share-whatsapp>WhatsApp</button><button type="button" class="party-share-button" data-copy-link>Copy Link</button></div><div class="party-share-status" data-share-status aria-live="polite"></div>
          <div class="party-roster" data-roster></div>
          <div class="party-actions"><button class="btn" data-start>Start race</button><button class="btn secondary" data-leave>Leave room</button></div>
          <div class="party-status" data-lobby-status>At least 2 players are needed to start.</div>
        </div>
        <div class="party-view hidden" data-view="countdown">
          <div class="party-kicker">Everyone ready</div><h2 class="party-title" data-countdown>3</h2>
          <p class="party-copy">The race is starting. Get ready to run.</p>
        </div>
        <div class="party-view hidden" data-view="waiting">
          <div class="party-kicker">Run complete</div><h2 class="party-title">Waiting for racers</h2>
          <p class="party-copy">You’re out. The race ends when everyone finishes.</p>
          <div class="party-roster" data-wait-roster></div>
          <div class="party-actions"><button class="btn" data-watch>Watch the race</button><button class="btn secondary" data-leave>Leave room</button></div>
        </div>
        <div class="party-view hidden" data-view="spectator">
          <div class="party-kicker">Spectator view</div><h2 class="party-title">Race in progress</h2>
          <p class="party-copy">Round ends when everyone finishes.</p>
          <div class="party-spectator-track" data-spectator-track aria-label="Live three-lane race view"></div>
          <div class="party-spectator-standings" data-spectator-standings></div>
          <div class="party-actions"><button class="btn secondary" data-leave>Leave room</button></div>
        </div>
        <div class="party-view hidden" data-view="results">
          <div class="party-kicker" data-results-kicker>Race complete</div><h2 class="party-title" data-results-title>Round results</h2>
          <p class="party-copy" data-winner>Farthest distance wins. Race coins break ties.</p>
          <div class="party-results" data-results></div>
          <div class="party-next-banner hidden" data-next-banner>
            <strong data-next-banner-copy></strong>
            <span data-connected-count></span>
            <span data-auto-countdown></span>
          </div>
          <div class="party-actions"><button class="btn" data-next>Next round</button><button class="btn" data-play-again>Play again</button><button class="btn secondary" data-leave>Leave room</button><button class="btn secondary small hidden" data-leaderboard-results>Leaderboard</button></div>
          <div class="party-status" data-results-status></div>
        </div>
      </section>`;
    this.board = document.createElement('div');
    this.board.className = 'party-board hidden';
    this.remoteEdgeList = document.createElement('div');
    this.remoteEdgeList.className = 'party-remote-edges';
    this.remoteEdgeList.setAttribute('aria-live', 'polite');
    this.remoteNameplates = document.createElement('div');
    this.remoteNameplates.className = 'party-remote-nameplates';
    this.chatWidget = document.createElement('aside');
    this.chatWidget.className = 'party-chat hidden';
    this.chatWidget.innerHTML = `
      <button class="party-chat-toggle" type="button" data-chat-toggle aria-expanded="false">Crew chat <span class="party-chat-badge hidden" data-chat-badge></span></button>
      <section class="party-chat-panel hidden" data-chat-panel aria-label="Crew chat">
        <header class="party-chat-header"><strong>Crew chat</strong><button class="party-chat-close" type="button" data-chat-close aria-label="Close chat">×</button></header>
        <div class="party-chat-messages" data-chat-messages aria-live="polite"></div>
        <div class="party-chat-phrases" aria-label="Quick phrases"><button type="button" data-phrase="Ready!">Ready!</button><button type="button" data-phrase="Wait!">Wait!</button><button type="button" data-phrase="GG">GG</button></div>
        <div class="party-chat-phrases party-emotes" aria-label="Race emotes"><button type="button" data-party-action="🤲" aria-label="Dua wave">🤲</button><button type="button" data-party-action="😱" aria-label="Surprised">😱</button><button type="button" data-party-action="☕" aria-label="Coffee break">☕</button><button type="button" data-party-action="⚡" aria-label="Lightning">⚡</button></div>
        <button class="party-dua-boost" type="button" data-party-action="dua_wave">Dua Wave / Audhu Billahi Boost</button>
        <form class="party-chat-form" data-chat-form><input data-chat-input maxlength="140" aria-label="Message" placeholder="Write a message…" autocomplete="off"><button class="btn" type="submit">Send</button></form>
      </section>`;
    this.leaderboardLayer = document.createElement('div');
    this.leaderboardLayer.className = 'party-layer party-leaderboard hidden';
    this.leaderboardLayer.setAttribute('role', 'dialog');
    this.leaderboardLayer.setAttribute('aria-modal', 'true');
    this.leaderboardLayer.setAttribute('aria-label', 'Global leaderboard');
    this.leaderboardLayer.innerHTML = `
      <section class="party-card">
        <div class="party-kicker">Runners worldwide</div><h2 class="party-title">Leaderboard</h2>
        <div class="party-leaderboard-tabs"><button class="active" type="button" data-leaderboard-tab="allTime">All-time</button><button type="button" data-leaderboard-tab="today">Today</button></div>
        <div class="party-leaderboard-status" data-leaderboard-status>Loading scores…</div>
        <div class="party-leaderboard-list" data-leaderboard-list></div>
        <div class="party-actions"><button class="btn secondary" type="button" data-leaderboard-close>Back</button></div>
      </section>`;
    this.root.append(this.rootEl, this.board, this.remoteEdgeList, this.remoteNameplates, this.chatWidget, this.leaderboardLayer);
    this.partyEventToast = document.createElement('div');
    this.partyEventToast.className = 'party-event-toast';
    this.partyEventToast.setAttribute('aria-live', 'polite');
    this.root.append(this.partyEventToast);
    this.raceProgress = document.createElement('div');
    this.raceProgress.className = 'party-race-progress hidden';
    this.raceProgress.setAttribute('aria-label', 'Race progress from Dars Library to Grand Academy Gate');
    this.raceProgress.innerHTML = '<span class="party-race-endpoint party-race-start">Dars Library</span><div class="party-race-track" data-race-track><i class="party-race-shaytan" data-race-shaytan aria-label="Shaytan chasing">👹</i></div><span class="party-race-endpoint party-race-finish">Grand Academy Gate</span>';
    this.root.append(this.raceProgress);
    this.raceTrack = this.raceProgress.querySelector('[data-race-track]');
    this.shaytanMarker = this.raceProgress.querySelector('[data-race-shaytan]');
    this.chatToggle = this.chatWidget.querySelector('[data-chat-toggle]');
    this.chatBadge = this.chatWidget.querySelector('[data-chat-badge]');
    this.chatPanel = this.chatWidget.querySelector('[data-chat-panel]');
    this.chatMessagesEl = this.chatWidget.querySelector('[data-chat-messages]');
    this.chatInput = this.chatWidget.querySelector('[data-chat-input]');
    this.leaderboardListEl = this.leaderboardLayer.querySelector('[data-leaderboard-list]');
    this.leaderboardStatusEl = this.leaderboardLayer.querySelector('[data-leaderboard-status]');
    this.leaderboardTab = 'allTime';
    this.leaderboardData = null;

    this.nameInput = this.rootEl.querySelector('[data-name]');
    this.codeInput = this.rootEl.querySelector('[data-code]');
    this.statusEl = this.rootEl.querySelector('[data-status]');
    this.roomCodeEl = this.rootEl.querySelector('[data-room-code]');
    this.shareStatusEl = this.rootEl.querySelector('[data-share-status]');
    this.rosterEl = this.rootEl.querySelector('[data-roster]');
    this.waitRosterEl = this.rootEl.querySelector('[data-wait-roster]');
    this.spectatorTrackEl = this.rootEl.querySelector('[data-spectator-track]');
    this.spectatorStandingsEl = this.rootEl.querySelector('[data-spectator-standings]');
    this.resultsEl = this.rootEl.querySelector('[data-results]');
    this.winnerEl = this.rootEl.querySelector('[data-winner]');
    this.resultStatusEl = this.rootEl.querySelector('[data-results-status]');
    this.nextBannerEl = this.rootEl.querySelector('[data-next-banner]');
    this.nextBannerCopyEl = this.rootEl.querySelector('[data-next-banner-copy]');
    this.connectedCountEl = this.rootEl.querySelector('[data-connected-count]');
    this.autoCountdownEl = this.rootEl.querySelector('[data-auto-countdown]');
    this.resultsKickerEl = this.rootEl.querySelector('[data-results-kicker]');
    this.resultsTitleEl = this.rootEl.querySelector('[data-results-title]');
    this.lobbyStatusEl = this.rootEl.querySelector('[data-lobby-status]');
    this.countdownEl = this.rootEl.querySelector('[data-countdown]');
    try { this.nameInput.value = localStorage.getItem('mmr.partyName') || ''; } catch { /* storage may be disabled */ }

    const titleScreen = this.root.querySelector('#screen-tap');
    const corner = titleScreen?.querySelector('.corner-links');
    const mainActions = titleScreen?.querySelector('.title-main-actions');
    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'btn btn-secondary party-trigger title-multiplayer';
    this.trigger.textContent = 'Multiplayer';
    this.trigger.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.trigger.addEventListener('pointerup', (event) => event.stopPropagation());
    this.trigger.addEventListener('click', (event) => { event.stopPropagation(); this.open(); });
    mainActions?.append(this.trigger);
    this.leaderboardTrigger = document.createElement('button');
    this.leaderboardTrigger.type = 'button';
    this.leaderboardTrigger.className = 'btn secondary small party-trigger';
    this.leaderboardTrigger.textContent = 'Leaderboard';
    this.leaderboardTrigger.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.leaderboardTrigger.addEventListener('pointerup', (event) => event.stopPropagation());
    this.leaderboardTrigger.addEventListener('click', (event) => { event.stopPropagation(); this.openLeaderboard(); });
    corner?.prepend(this.leaderboardTrigger);

    this.rootEl.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.rootEl.addEventListener('pointerup', (event) => event.stopPropagation());
    this.rootEl.addEventListener('click', (event) => event.stopPropagation());
    this.rootEl.addEventListener('keydown', (event) => event.stopPropagation());
    for (const eventName of ['pointerdown', 'pointerup', 'click', 'keydown', 'touchstart', 'touchmove', 'touchend']) {
      this.chatWidget.addEventListener(eventName, (event) => event.stopPropagation());
    }
    this.chatWidget.addEventListener('pointerup', () => this.game.input?._onPointerCancel?.());
    this.chatToggle.addEventListener('click', () => this._setChatOpen(!this.chatOpen));
    this.chatWidget.querySelector('[data-chat-close]').addEventListener('click', () => this._setChatOpen(false));
    this.chatWidget.querySelectorAll('[data-phrase]').forEach((button) => button.addEventListener('click', () => this._sendChat(button.dataset.phrase)));
    this.chatWidget.querySelectorAll('[data-party-action]').forEach((button) => button.addEventListener('click', () => this._broadcastPartyEvent(button.dataset.partyAction)));
    this.chatWidget.querySelector('[data-chat-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      this._sendChat(this.chatInput.value);
    });
    this.rootEl.querySelector('[data-create]').addEventListener('click', () => this._createRoom());
    this.rootEl.querySelector('[data-join]').addEventListener('click', () => this._joinRoom());
    this.rootEl.querySelector('[data-start]').addEventListener('click', () => this._send({ type: 'start' }));
    this.roomCodeEl.addEventListener('click', () => this._copyRoomLink(true));
    this.rootEl.querySelector('[data-copy-link]').addEventListener('click', () => this._copyRoomLink());
    this.rootEl.querySelector('[data-share-whatsapp]').addEventListener('click', () => {
      const url = roomShareUrl(this.roomCode);
      window.open(`https://wa.me/?text=${encodeURIComponent(`Join my Malabar Runner race: ${url}`)}`, '_blank', 'noopener,noreferrer');
    });
    this.rootEl.querySelector('[data-watch]').addEventListener('click', () => this._watchRace());
    this.rootEl.querySelector('[data-next]').addEventListener('click', () => this._send({ type: 'start' }));
    this.rootEl.querySelector('[data-play-again]').addEventListener('click', () => this._send({ type: 'play_again' }));
    this.rootEl.querySelectorAll('[data-leave]').forEach((button) => button.addEventListener('click', () => this.leaveRoom(true)));
    this.rootEl.querySelector('[data-close]').addEventListener('click', () => this.close());
    this.rootEl.querySelector('[data-leaderboard-results]').addEventListener('click', () => this.openLeaderboard());
    this.leaderboardLayer.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.leaderboardLayer.addEventListener('pointerup', (event) => event.stopPropagation());
    this.leaderboardLayer.addEventListener('click', (event) => event.stopPropagation());
    this.leaderboardLayer.addEventListener('keydown', (event) => event.stopPropagation());
    this.leaderboardLayer.querySelector('[data-leaderboard-close]').addEventListener('click', () => this.closeLeaderboard());
    this.leaderboardLayer.querySelectorAll('[data-leaderboard-tab]').forEach((button) => button.addEventListener('click', () => {
      this.leaderboardTab = button.dataset.leaderboardTab;
      this.leaderboardLayer.querySelectorAll('[data-leaderboard-tab]').forEach((tab) => tab.classList.toggle('active', tab === button));
      this._renderLeaderboard();
    }));
    this.codeInput.addEventListener('input', () => { this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
  }

  _getPlayerId() {
    try {
      const saved = sessionStorage.getItem('mmr.partyPlayerId');
      if (saved) return saved;
      const id = crypto.randomUUID();
      sessionStorage.setItem('mmr.partyPlayerId', id);
      return id;
    } catch {
      return crypto.randomUUID();
    }
  }

  async _connect() {
    const result = await this._request({ type: 'health' }, { quiet: true, ignoreRoom: true });
    this.apiReady = Boolean(result?.ok);
    this._setStatus(this.apiReady ? 'Connected. Create a room or join with a code.' : 'Could not connect to the race server.', !this.apiReady);
    const roomCode = new URLSearchParams(window.location.search).get('room')?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (this.apiReady && (roomCode?.length === 4 || roomCode?.length === 6) && !this.room) {
      this.codeInput.value = roomCode;
      if (!this.nameInput.value.trim()) this.nameInput.value = 'Runner';
      this._joinRoom();
    }
  }

  async _request(message, { quiet = false, ignoreRoom = false } = {}) {
    const body = { ...message, playerId: this.playerId };
    if (!body.code && !ignoreRoom && this.roomCode) body.code = this.roomCode;
    try {
      const response = message.type === 'poll'
        ? await fetch(`/.netlify/functions/game?code=${encodeURIComponent(this.roomCode)}&playerId=${encodeURIComponent(this.playerId)}`, { cache: 'no-store' })
        : await fetch('/.netlify/functions/game', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      const result = await response.json();
      if (Number.isFinite(result.serverNow)) this._serverOffsetMs = result.serverNow - Date.now();
      if (!response.ok) {
        if (!quiet) this._setActionStatus(result.error || 'The race server rejected that action.', true);
        return null;
      }
      if (result.playerId) this.playerId = result.playerId;
      if (result.code) this.roomCode = result.code;
      if (result.room && !ignoreRoom) this._updateRoom(result.room);
      return result;
    } catch {
      if (!quiet) this._setActionStatus('Could not connect to the race server. Check your connection and retry.', true);
      return null;
    }
  }

  _setChatOpen(open) {
    this.chatOpen = Boolean(open);
    this.chatPanel.classList.toggle('hidden', !this.chatOpen);
    this.chatWidget.classList.toggle('is-open', this.chatOpen);
    this.chatToggle.setAttribute('aria-expanded', String(this.chatOpen));
    if (this.chatOpen) {
      this.chatUnread = 0;
      this._renderChatBadge();
      this._pollChat();
    }
    this._scheduleChatPoll();
  }

  _renderChatBadge() {
    this.chatBadge.textContent = this.chatUnread > 0 ? String(Math.min(this.chatUnread, 99)) : '';
    this.chatBadge.classList.toggle('hidden', this.chatUnread <= 0);
  }

  _appendChatMessage(message) {
    if (this.chatMessages.some((entry) => entry.id === message.id)) return false;
    this.chatMessages.push(message);
    if (this.chatMessages.length > 50) this.chatMessages.shift();
    const row = document.createElement('div');
    row.className = `party-chat-message${message.playerId === this.playerId ? ' is-self' : ''}`;
    const sender = document.createElement('strong');
    sender.textContent = message.name;
    const text = document.createElement('span');
    text.textContent = message.text;
    row.append(sender, text);
    this.chatMessagesEl.append(row);
    while (this.chatMessagesEl.children.length > 50) this.chatMessagesEl.firstElementChild.remove();
    if (message.playerId !== this.playerId && !this.chatOpen) this.chatUnread += 1;
    this._renderChatBadge();
    return true;
  }

  async _pollChat(force = false) {
    clearTimeout(this.chatTimer);
    this.chatTimer = null;
    if (document.hidden || !this.roomCode || !this.room || (!force && !this.chatOpen && this.chatUnread === 0) || this.chatPending) return;
    this.chatPending = true;
    try {
      const result = await this._request({ type: 'chat_poll', afterId: this.chatAfterId }, { quiet: true });
      if (result?.messages?.length) {
        for (const message of result.messages) this._appendChatMessage(message);
        this.chatAfterId = result.messages.at(-1).id;
        if (this.chatOpen) this.chatMessagesEl.scrollTop = this.chatMessagesEl.scrollHeight;
      }
    } finally {
      this.chatPending = false;
      this._scheduleChatPoll();
    }
  }

  _scheduleChatPoll() {
    clearTimeout(this.chatTimer);
    this.chatTimer = null;
    if (document.hidden || !this.roomCode || !this.room || (!this.chatOpen && this.chatUnread === 0) || this.chatPending) return;
    this.chatTimer = setTimeout(() => this._pollChat(), 2000);
  }

  async _sendChat(value) {
    const text = String(value || '').slice(0, 140);
    if (!text.trim() || !this.roomCode) return;
    this.chatInput.value = '';
    const result = await this._request({ type: 'chat_send', text }, { quiet: true });
    if (result?.message) {
      this._appendChatMessage(result.message);
      this.chatMessagesEl.scrollTop = this.chatMessagesEl.scrollHeight;
      this._scheduleChatPoll();
    } else if (!result) {
      this.chatInput.value = text;
    }
  }

  _syncChatRoom(room) {
    this.chatWidget.classList.toggle('hidden', !['lobby', 'running', 'roundover', 'gameover'].includes(room.phase));
    this.chatWidget.classList.toggle('is-racing', room.phase === 'running');
    if (this.chatRoomKey !== room.code) {
      this.chatRoomKey = room.code;
      this.chatOpen = false;
      this.chatUnread = 0;
      this.chatAfterId = null;
      this.chatMessages = [];
      this.chatMessagesEl.replaceChildren();
      this.chatPanel.classList.add('hidden');
      this.chatToggle.setAttribute('aria-expanded', 'false');
      this._renderChatBadge();
      this._pollChat(true);
    }
    this._scheduleChatPoll();
  }

  _setActionStatus(message, isError = false) {
    const view = [...this.rootEl.querySelectorAll('[data-view]')].find((section) => !section.classList.contains('hidden'));
    const status = view?.querySelector('.party-status') || this.statusEl;
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  _poll() {
    this.pollTimer = null;
    if (document.hidden || !this.roomCode || !this.room || this.room.phase === 'running' || this._pollPending) return;
    this._pollPending = true;
    this._request({ type: 'poll' }, { quiet: true }).then((result) => {
      this._pollDelay = result ? PARTY_POLL_INTERVAL_MS : Math.min(this._pollDelay * 2, MAX_POLL_BACKOFF_MS);
    }).finally(() => {
      this._pollPending = false;
      this._schedulePoll();
    });
  }

  _clearNetworkTimers() {
    clearInterval(this.progressTimer);
    clearTimeout(this.pollTimer);
    clearTimeout(this.heartbeatTimer);
    clearTimeout(this.spectatorPollTimer);
    this.progressTimer = null;
    this.pollTimer = null;
    this.heartbeatTimer = null;
    this.spectatorPollTimer = null;
  }

  _syncNetworkTimers() {
    const mode = document.hidden ? 'paused'
      : !this.roomCode || !this.room ? 'none'
        : this.room.phase === 'running' ? 'running' : 'idle';
    if (mode === this._timerMode) return;
    this._clearNetworkTimers();
    this._timerMode = mode;
    if (mode === 'running') {
      this._pollDelay = PARTY_POLL_INTERVAL_MS;
      this.progressTimer = setInterval(() => this._progress(), PARTY_PROGRESS_INTERVAL_MS);
    } else if (mode === 'idle') {
      this._pollDelay = PARTY_POLL_INTERVAL_MS;
      this._schedulePoll();
      this._scheduleHeartbeat();
    }
  }

  _schedulePoll() {
    if (document.hidden || this._timerMode !== 'idle' || !this.roomCode || this.pollTimer || this._pollPending) return;
    this.pollTimer = setTimeout(() => this._poll(), this._pollDelay);
  }

  _scheduleHeartbeat() {
    const shouldHeartbeat = this._timerMode === 'idle' || (this._timerMode === 'running' && this.game.state === 'GAMEOVER');
    if (document.hidden || !shouldHeartbeat || !this.roomCode || this.heartbeatTimer) return;
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      const stillNeeded = this._timerMode === 'idle' || (this._timerMode === 'running' && this.game.state === 'GAMEOVER');
      if (document.hidden || !stillNeeded || !this.roomCode) return;
      this._send({ type: 'heartbeat' }, { quiet: true }).finally(() => this._scheduleHeartbeat());
    }, PARTY_HEARTBEAT_INTERVAL_MS);
  }

  _handleVisibilityChange() {
    if (document.hidden) {
      this._syncNetworkTimers();
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      clearTimeout(this.chatTimer);
      this.chatTimer = null;
      return;
    }
    this._timerMode = 'paused';
    this._pollDelay = PARTY_POLL_INTERVAL_MS;
    this._syncNetworkTimers();
    if (this.roomCode && this.room) this._send({ type: 'heartbeat' }, { quiet: true });
    if (this.room?.phase === 'countdown') this._startCountdown(this.room);
    if (this.game.state === 'GAMEOVER') this._scheduleSpectatorPoll();
    this.lastRemoteFrame = 0;
    this._startRemoteAnimation();
    this._scheduleChatPoll();
  }

  _startRemoteAnimation() {
    if (!this._raf && !document.hidden) {
      this._raf = requestAnimationFrame((now) => this._animateRemotes(now));
    }
  }

  _scheduleSpectatorPoll() {
    if (document.hidden || this.game.state !== 'GAMEOVER' || this.room?.phase !== 'running' || this.spectatorPollTimer) return;
    this.spectatorPollTimer = setTimeout(async () => {
      this.spectatorPollTimer = null;
      if (document.hidden || this.game.state !== 'GAMEOVER' || this.room?.phase !== 'running') return;
      await this._request({ type: 'poll' }, { quiet: true });
      this._scheduleSpectatorPoll();
    }, 1000);
  }

  _setStatus(message, isError = false) {
    this.statusEl.textContent = message;
    this.statusEl.classList.toggle('error', isError);
  }

  _send(message, options) {
    return this._request(message, options);
  }

  _name() {
    const name = this.nameInput.value.trim().slice(0, 16);
    if (!name) { this._setStatus('Enter your name first.', true); this.nameInput.focus(); return null; }
    try { localStorage.setItem('mmr.partyName', name); } catch { /* storage may be disabled */ }
    return name;
  }

  _createRoom() {
    const name = this._name();
    if (!name) return;
    if (!this.apiReady) return this._setStatus('Still connecting to the race server…');
    this._send({ type: 'create', name, skinId: this.game.wardrobe?.selected || 'classic' });
  }

  _joinRoom() {
    const name = this._name();
    if (!name) return;
    const code = this.codeInput.value.trim().toUpperCase();
    if (code.length !== 4 && code.length !== 6) return this._setStatus('Enter the 4-letter room code.', true);
    if (!this.apiReady) return this._setStatus('Still connecting to the race server…');
    this._send({ type: 'join', name, code, skinId: this.game.wardrobe?.selected || 'classic' });
  }

  open() {
    if (this.room?.phase === 'lobby') this._show('lobby');
    else this._show('entry');
  }

  async openLeaderboard() {
    this.leaderboardLayer.classList.remove('hidden');
    this.leaderboardStatusEl.textContent = 'Loading scores…';
    const skeletons = Array.from({ length: 4 }, () => {
      const row = document.createElement('div');
      row.className = 'party-leaderboard-skeleton';
      row.setAttribute('aria-hidden', 'true');
      return row;
    });
    this.leaderboardListEl.replaceChildren(...skeletons);
    const result = await this._request({ type: 'leaderboard_get' }, { quiet: true, ignoreRoom: true });
    if (!result) {
      this.leaderboardStatusEl.textContent = 'Could not load scores. Try again.';
      return;
    }
    this.leaderboardData = result;
    this.leaderboardStatusEl.textContent = '';
    this._renderLeaderboard();
  }

  closeLeaderboard() {
    this.leaderboardLayer.classList.add('hidden');
  }

  _renderLeaderboard() {
    if (!this.leaderboardData) return;
    const period = this.leaderboardTab;
    const entries = this.leaderboardData[period] || [];
    const rankKey = period === 'today' ? 'today' : 'allTime';
    const ownRank = this.leaderboardData.myRanks?.[rankKey];
    const ownEntry = this.leaderboardData.myEntry?.[rankKey];
    const rows = entries.map((entry, index) => ({ entry, rank: index + 1 }));
    if (ownEntry && ownRank > entries.length) rows.push({ entry: ownEntry, rank: ownRank });
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'party-leaderboard-empty';
      empty.textContent = period === 'today' ? 'No scores in the last 24 hours yet. Be the first to race!' : 'No multiplayer scores yet. Be the first to race!';
      this.leaderboardListEl.replaceChildren(empty);
      return;
    }
    this.leaderboardListEl.replaceChildren(...rows.map(({ entry, rank }) => {
      const row = document.createElement('div');
      row.className = `party-leaderboard-row${entry.playerId === this.playerId ? ' is-self' : ''}`;
      const place = document.createElement('strong');
      place.className = 'party-leaderboard-rank';
      place.textContent = `#${rank}`;
      const name = document.createElement('span');
      name.className = 'party-leaderboard-name';
      name.textContent = `${entry.name}${entry.playerId === this.playerId ? ' (you)' : ''}`;
      const score = document.createElement('span');
      score.className = 'party-leaderboard-score';
      score.textContent = `${numberText(entry.distance)} m · ${numberText(entry.coins)} coins`;
      row.append(place, name, score);
      return row;
    }));
  }

  close() {
    if (this.room) return this.leaveRoom(false);
    this.rootEl.classList.add('hidden');
  }

  _show(view) {
    this.rootEl.classList.remove('hidden');
    for (const section of this.rootEl.querySelectorAll('[data-view]')) {
      section.classList.toggle('hidden', section.dataset.view !== view);
    }
  }

  _updateRoom(room) {
    if (!room) return;
    const newLobbyPlayers = collectLobbyJoins(room, this.playerId, this._knownRoomPlayers);
    if (newLobbyPlayers.length) {
      this._joinHighlightIds = new Set(newLobbyPlayers.map((player) => player.id));
      this._showJoinCelebration(newLobbyPlayers);
    }
    if (room.lastEvent?.id && room.lastEvent.id !== this.lastPartyEventId) {
      this.lastPartyEventId = room.lastEvent.id;
      this._showPartyEvent(room.lastEvent);
    }
    this._syncRemoteLiveness(room);
    this.room = room;
    this.roomCode = room.code;
    this._syncChatRoom(room);
    this._rememberRemoteSnapshots(room);
    this._syncNetworkTimers();
    this.roomCodeEl.textContent = room.code;
    this._renderRaceProgress(room);
    this._renderBoard(room);
    if (room.phase === 'lobby') {
      this.board.classList.add('hidden');
      this._renderRoster(this.rosterEl, room, false, this._joinHighlightIds);
      this._joinHighlightIds.clear();
      const isHost = this.playerId === room.hostId;
      const start = this.rootEl.querySelector('[data-start]');
      start.classList.toggle('hidden', !isHost);
      start.disabled = room.players.filter((p) => p.connected).length < 2;
      this.lobbyStatusEl.textContent = room.players.filter((p) => p.connected).length < 2
        ? 'At least 2 players are needed to start.'
        : isHost ? 'Everyone is in? Start the race when you are ready.' : 'Waiting for the host to start the race…';
      this._show('lobby');
      return;
    }
    if (room.phase === 'countdown') {
      this._show('countdown');
      this.board.classList.add('hidden');
      this._startCountdown(room);
      return;
    }
    if (room.phase === 'running') {
      this.board.classList.remove('hidden');
      if (this.game.state === 'GAMEOVER') {
        this._scheduleSpectatorPoll();
        if (this.spectating) {
          this._renderSpectator(room);
          this._show('spectator');
        } else this._showWaiting();
      }
      else this.rootEl.classList.add('hidden');
      this._ensureStarted();
      return;
    }
    if (room.phase === 'roundover' || room.phase === 'gameover') {
      this.board.classList.add('hidden');
      this._showResults(room);
    }
  }

  _renderRaceProgress(room) {
    const running = room.phase === 'running';
    this.raceProgress.classList.toggle('hidden', !running);
    this.root.classList.toggle('party-race-active', running);
    if (!running) return;
    const connected = room.players.filter((player) => player.connected);
    const leaderDistance = Math.max(0, ...connected.map((player) => Number(player.distance) || 0));
    const markers = connected.map((player, index) => {
      const marker = document.createElement('span');
      marker.className = `party-race-runner${player.id === this.playerId ? ' is-self' : ''}`;
      marker.style.left = `${raceProgressPercent(player.distance, leaderDistance)}%`;
      marker.style.setProperty('--runner-color', PLAYER_COLORS[index % PLAYER_COLORS.length]);
      const runnerIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      runnerIcon.setAttribute('viewBox', '0 0 24 24');
      runnerIcon.setAttribute('aria-hidden', 'true');
      runnerIcon.innerHTML = '<circle cx="15.5" cy="4.5" r="2.5" fill="currentColor"/><path d="m12 8 4 2 2 4-2.2 1-1.3-2.7-2.4-1.2-2 3.2 3.3 2.2 1.8 5h-2.8l-1.5-3.4-4.5-3.2 3.3-5.6-2.7 2.3-2.6-.2.2-2.5 3.5-.2L12 8Zm-5 9-2.3 5H2l2.6-6.1 2.4 1.1Z" fill="currentColor"/>';
      marker.append(runnerIcon);
      marker.title = `${player.name}: ${numberText(player.distance)} m`;
      marker.setAttribute('aria-label', marker.title);
      return { marker, percent: raceProgressPercent(player.distance, leaderDistance) };
    });
    this.raceTrack.replaceChildren(this.shaytanMarker, ...markers.map(({ marker }) => marker));
    const trailingProgress = markers.length ? Math.min(...markers.map(({ percent }) => percent)) : 0;
    this.shaytanMarker.style.left = `${Math.max(0, trailingProgress - 9)}%`;
  }

  async _copyRoomLink(codeOnly = false) {
    if (!this.roomCode) return;
    const text = codeOnly ? this.roomCode : roomShareUrl(this.roomCode);
    try {
      await navigator.clipboard.writeText(text);
      this.shareStatusEl.textContent = codeOnly ? 'Room code copied.' : 'Invite link copied.';
    } catch {
      const field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed'; field.style.opacity = '0';
      document.body.append(field); field.select();
      const copied = document.execCommand('copy');
      field.remove();
      this.shareStatusEl.textContent = copied ? (codeOnly ? 'Room code copied.' : 'Invite link copied.') : 'Copy the code to share.';
    }
  }

  _startCountdown(room) {
    clearTimeout(this.countdownTimer);
    clearInterval(this.countdownInterval);
    clearInterval(this.roundoverTimer);
    this.countdownTimer = null;
    this.countdownInterval = null;
    this.roundoverTimer = null;
    const update = () => {
      if (!this.room || this.room.phase !== 'countdown') return;
      const remaining = Math.max(0, Math.ceil((this.room.startAt - (Date.now() + this._serverOffsetMs)) / 1000));
      this.countdownEl.textContent = remaining > 0 ? String(remaining) : 'RUN!';
    };
    update();
    if (document.hidden) return;
    this.countdownInterval = setInterval(update, 250);
    this.countdownTimer = setTimeout(() => {
      this.countdownTimer = null;
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
      if (!this.room || this.room.phase !== 'countdown') return;
      this._ensureStarted();
    }, Math.max(0, room.startAt - (Date.now() + this._serverOffsetMs)));
  }

  _ensureStarted() {
    if (!this.room || (this.room.phase !== 'countdown' && this.room.phase !== 'running')) return;
    if (this.game.state !== 'LIBRARY' && this.game.state !== 'GAMEOVER') return;
    const roundKey = `${this.roomCode}:${this.room.round}`;
    if (this._startedForRoom === roundKey && this.game.state === 'RUNNER') return;
    this._startedForRoom = roundKey;
    this.finishedForRoom = null;
    this.spectating = false;
    this.game.startPartyRace?.({ seed: this.room.seed, round: this.room.round });
  }

  _renderRoster(container, room, results = false, highlightedIds = new Set()) {
    const isFinal = room.phase === 'gameover';
    const roundScore = room.roundResults?.find((entry) => entry.round === room.round)?.standings || [];
    const roundByPlayer = new Map(roundScore.map((entry) => [entry.playerId, entry]));
    const valueFor = (player) => {
      if (isFinal) return { distance: player.totalDistance, coins: player.totalCoins };
      const stored = roundByPlayer.get(player.id);
      return stored || { distance: player.distance, coins: player.coins };
    };
    const players = results
      ? [...room.players].sort((a, b) => {
        const aScore = valueFor(a), bScore = valueFor(b);
        return bScore.distance - aScore.distance || bScore.coins - aScore.coins || a.name.localeCompare(b.name);
      })
      : room.players;
    container.replaceChildren(...players.map((player, index) => {
      const row = document.createElement('div');
      row.className = results ? 'party-result' : 'party-player';
      row.dataset.playerId = player.id;
      if (!results && highlightedIds.has(player.id)) row.classList.add('party-player-joined');
      if (results) {
        const name = document.createElement('strong');
        name.textContent = `${index + 1}. ${player.name}${player.id === this.playerId ? ' (you)' : ''}`;
        const result = document.createElement('span');
        const score = valueFor(player);
        result.textContent = `${numberText(score.distance)} m · ${score.coins} coins`;
        row.append(name, result);
      } else {
        const left = document.createElement('span');
        left.className = 'party-player-name';
        const dot = document.createElement('i');
        dot.className = 'party-dot';
        dot.style.background = PLAYER_COLORS[index % PLAYER_COLORS.length];
        dot.style.color = PLAYER_COLORS[index % PLAYER_COLORS.length];
        const name = document.createElement('span');
        name.textContent = `${player.name}${player.id === this.playerId ? ' (you)' : ''}`;
        left.append(dot, name);
        const meta = document.createElement('span');
        meta.className = 'party-player-meta';
        meta.textContent = player.id === room.hostId ? 'Host' : player.connected ? (results ? `${numberText(player.distance)} m` : 'Ready') : 'Left';
        row.append(left, meta);
      }
      return row;
    }));
  }

  _renderBoard(room) {
    const players = [...room.players].sort((a, b) => b.distance - a.distance || b.coins - a.coins);
    this.board.replaceChildren(...players.map((player) => {
      const row = document.createElement('div');
      row.className = 'party-board-row';
      const name = document.createElement('span');
      name.className = 'party-board-name';
      name.textContent = `${player.name}${player.id === this.playerId ? ' · YOU' : ''}`;
      const score = document.createElement('span');
      score.className = 'party-board-stat';
      score.textContent = `${numberText(player.distance)} m · ${player.coins} coins`;
      const state = document.createElement('span');
      state.className = 'party-board-state';
      state.textContent = !player.connected ? 'Left' : player.alive ? 'Running' : 'Run complete';
      row.append(name, score, state);
      return row;
    }));
  }

  _showWaiting() {
    this._renderRoster(this.waitRosterEl, this.room, true);
    this._show('waiting');
  }

  _showEliminated() {
    if (this.game.avatar?.group) this.game.avatar.group.visible = false;
    this._renderRoster(this.waitRosterEl, this.room, true);
    this._show('waiting');
  }

  _watchRace() {
    this.spectating = true;
    if (this.game.avatar?.group) this.game.avatar.group.visible = false;
    this._renderSpectator(this.room);
    this._show('spectator');
  }

  _renderSpectator(room) {
    if (!room || !this.spectatorTrackEl) return;
    const runners = room.players.filter(remoteRunnerIsAlive);
    const leaderDistance = Math.max(0, ...runners.map((player) => Number(player.distance) || 0));
    const lanes = [0, 1, 2].map((lane) => {
      const column = document.createElement('div');
      column.className = 'party-spectator-lane';
      const label = document.createElement('strong');
      label.textContent = `Lane ${lane + 1}`;
      column.append(label);
      for (const player of runners.filter((entry) => clamp(Number(entry.lane) || 0, 0, 2) === lane)) {
        const dot = document.createElement('span');
        dot.className = `party-spectator-dot${player.id === this.playerId ? ' is-self' : ''}`;
        const behind = Math.max(0, leaderDistance - (Number(player.distance) || 0));
        dot.style.bottom = `${clamp(88 - behind * 0.8, 8, 88)}%`;
        dot.textContent = player.name;
        column.append(dot);
      }
      return column;
    });
    this.spectatorTrackEl.replaceChildren(...lanes);
    const sorted = [...room.players].sort((a, b) => b.distance - a.distance || b.coins - a.coins);
    this.spectatorStandingsEl.replaceChildren(...sorted.map((player, index) => {
      const row = document.createElement('div');
      row.className = `party-spectator-standing${remoteRunnerIsAlive(player) ? '' : ' is-finished'}`;
      row.textContent = `${index + 1}. ${player.name} · ${numberText(player.distance)} m${remoteRunnerIsAlive(player) ? '' : ' · finished'}`;
      return row;
    }));
  }

  _showResults(room) {
    const final = room.phase === 'gameover';
    const sorted = [...room.players].sort((a, b) => {
      const aDistance = final ? a.totalDistance : a.distance;
      const bDistance = final ? b.totalDistance : b.distance;
      const aCoins = final ? a.totalCoins : a.coins;
      const bCoins = final ? b.totalCoins : b.coins;
      return bDistance - aDistance || bCoins - aCoins || a.name.localeCompare(b.name);
    });
    const winner = sorted[0];
    this.resultsKickerEl.textContent = final ? 'Three-round match complete' : `Round ${room.round} complete`;
    this.resultsTitleEl.textContent = final ? 'Final standings' : `Round ${room.round} results`;
    this.winnerEl.textContent = winner
      ? final
        ? `Match winner: ${winner.name} · total distance wins; total coins break ties.`
        : `Round leader: ${winner.name} · distance wins; race coins break ties.`
      : 'Distance wins. Coins break ties.';
    this._renderRoster(this.resultsEl, room, true);
    const next = this.rootEl.querySelector('[data-next]');
    const playAgain = this.rootEl.querySelector('[data-play-again]');
    this.rootEl.querySelector('[data-leaderboard-results]').classList.toggle('hidden', !final);
    const isHost = this.playerId === room.hostId;
    next.classList.toggle('hidden', final || !isHost);
    next.disabled = room.players.filter((player) => player.connected).length < 2;
    next.textContent = `Start round ${room.round + 1} of ${room.maxRounds}`;
    playAgain.classList.toggle('hidden', !final || !isHost);
    this.nextBannerEl.classList.toggle('hidden', final);
    this.resultStatusEl.classList.toggle('hidden', !final && !isHost);
    if (final) {
      clearInterval(this.roundoverTimer);
      this.roundoverTimer = null;
      this.resultStatusEl.textContent = isHost
        ? 'Three rounds finished. Play again to return everyone to the lobby.'
        : 'Three rounds finished. Leave the room when you are ready.';
    } else {
      const nextRound = room.round + 1;
      this.nextBannerCopyEl.textContent = isHost
        ? `Round ${nextRound} is next. Start it any time, or wait for the automatic start.`
        : `Round ${nextRound} is next. The host will start it, and you'll be taken there automatically.`;
      const connected = room.players.filter((player) => player.connected).length;
      this.connectedCountEl.textContent = `${connected} of ${room.players.length} players connected`;
      clearInterval(this.roundoverTimer);
      const updateAutoStart = () => {
        const seconds = Math.max(0, Math.ceil(((room.autoStartAt || 0) - (Date.now() + this._serverOffsetMs)) / 1000));
        const label = `Next round in ${seconds} s`;
        this.autoCountdownEl.textContent = label;
        if (isHost) this.resultStatusEl.textContent = label;
      };
      updateAutoStart();
      this.roundoverTimer = setInterval(updateAutoStart, 1000);
    }
    this._show('results');
  }

  _onGameState(state) {
    if (!this.room) return;
    if (state === 'RUNNER' || state === 'RUNNING') {
      this.spectating = false;
      if (this.game.avatar?.group) this.game.avatar.group.visible = true;
      this.rootEl.classList.add('hidden');
      this.board.classList.toggle('hidden', this.room.phase !== 'running');
      this._startedForRoom = `${this.roomCode}:${this.room.round}`;
      return;
    }
    if (state === 'GAMEOVER') {
      const game = this.game;
      const roundKey = `${this.roomCode}:${this.room.round}`;
      if (this.finishedForRoom !== roundKey) {
        this.finishedForRoom = roundKey;
        this._send({
          type: 'finish',
          distance: game.scoring?.distanceM || 0,
          score: game.scoring?.score || 0,
          coins: game.scoring?.coins || 0,
        });
      }
      if (this.room.phase === 'gameover' || this.room.phase === 'roundover') this._showResults(this.room);
      else this._showEliminated();
      this._scheduleHeartbeat();
      this._scheduleSpectatorPoll();
      return;
    }
    if (state === 'LIBRARY') {
      if (this.room.phase === 'lobby') this._show('lobby');
      else this.leaveRoom(false);
    }
  }

  _progress() {
    if (this._progressPending || !this.room || this.room.phase !== 'running' || this.game.state !== 'RUNNER') return;
    const player = this.game.player;
    const powerups = this.game.powerups;
    const anim = player.jumping ? 'jump'
      : player.sliding ? 'slide'
        : powerups?.has?.('glideboard') ? 'glide'
          : player.flyY > 0.5 ? 'jetpack' : 'run';
    this._progressPending = true;
    const serverNow = Date.now() + this._serverOffsetMs;
    const runClock = Math.max(0, (serverNow - (this.room.startAt || serverNow)) / 1000);
    this._send({
      type: 'progress',
      distance: this.game.scoring?.distanceM || 0,
      score: this.game.scoring?.score || 0,
      coins: this.game.scoring?.coins || 0,
      speed: this.game._speed?.() || 0,
      runClock,
      lane: player.laneIndex,
      y: player.y + player.flyY,
      anim,
      shield: powerups?.has?.('shield') === true,
    }, { quiet: true }).finally(() => { this._progressPending = false; });
  }

  _broadcastPartyEvent(action) {
    if (!this.roomCode || this.room?.phase !== 'running') return;
    this._send({ type: 'party_event', action }, { quiet: true });
  }

  _showPartyEvent(event) {
    const labels = {
      dua_wave: 'Dua wave!', boost: 'Power-up!',
      '🤲': '🤲', '😱': '😱', '☕': '☕', '⚡': '⚡',
    };
    this.partyEventToast.textContent = `${event.name}: ${labels[event.action] || 'Race emote'}`;
    this.partyEventToast.classList.remove('is-visible');
    void this.partyEventToast.offsetWidth;
    this.partyEventToast.classList.add('is-visible');
    clearTimeout(this.partyEventTimer);
    this.partyEventTimer = setTimeout(() => this.partyEventToast.classList.remove('is-visible'), 1300);
    if (event.playerId !== this.playerId || event.action !== 'boost') this.game.audio?.play?.('powerup');
  }

  _showJoinCelebration(players) {
    const names = players.map((player) => player.name).filter(Boolean);
    const joined = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
    this.partyEventToast.textContent = `✨ ${joined || 'A new player'} joined the race!`;
    this.partyEventToast.classList.remove('is-visible');
    this.partyEventToast.classList.add('is-join-celebration');
    void this.partyEventToast.offsetWidth;
    this.partyEventToast.classList.add('is-visible');
    clearTimeout(this.partyEventTimer);
    this.partyEventTimer = setTimeout(() => {
      this.partyEventToast.classList.remove('is-visible', 'is-join-celebration');
    }, 1500);
    this.game.audio?.play?.('join_chime');
    this.game.ui?.particles?.burst?.(10);
  }

  _ensureRemoteAvatars(room) {
    if (!this.game.runnerRoot) return;
    const remotePlayers = room.players.filter((player) => player.id !== this.playerId && remoteRunnerIsAlive(player));
    const remoteIds = new Set(remotePlayers.map((player) => player.id));
    for (const [id, avatar] of this.remoteAvatars) {
      if (remoteIds.has(id)) continue;
      this._disposeRemote(avatar);
      this.remoteAvatars.delete(id);
    }
    for (const player of remotePlayers) {
      if (this.remoteAvatars.has(player.id)) continue;
      const avatar = new PlayerAvatar(this.game.runnerRoot);
      avatar.group.scale.setScalar(0.82);
      avatar.shieldBubble = new ShieldBubble(avatar.group, {
        quality: this.game._quality || 'high',
        reducedMotion: this.game._reducedMotion === true,
        scale: 0.72,
        particleCount: 3,
      });
      avatar.group.visible = false;
      avatar.group.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = false;
        object.receiveShadow = false;
      });
      avatar.setAnim('run');
      avatar.nameplate = document.createElement('div');
      avatar.nameplate.className = 'party-remote-nameplate';
      avatar.nameplate.textContent = player.name;
      avatar.nameplatePoint = new THREE.Vector3();
      this.remoteNameplates.append(avatar.nameplate);
      this.remoteAvatars.set(player.id, avatar);
    }
  }

  _disposeRemote(avatar) {
    avatar.shieldBubble?.dispose?.();
    avatar.nameplate?.remove?.();
    const group = avatar.group;
    if (group.parent) group.parent.remove(group);
    group.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry?.dispose?.();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material?.dispose?.();
    });
  }

  _syncRemoteLiveness(room) {
    const priorPlayers = new Map((this.room?.players || []).map((player) => [player.id, player]));
    const nextPlayers = new Map(room.players.map((player) => [player.id, player]));
    for (const [id, avatar] of this.remoteAvatars) {
      const player = nextPlayers.get(id);
      if (remoteRunnerIsAlive(player)) continue;
      const previous = priorPlayers.get(id);
      const position = avatar.group.position.clone();
      avatar.group.visible = false;
      this._disposeRemote(avatar);
      this.remoteAvatars.delete(id);
      this.remoteSnapshots.delete(id);
      this.remoteDistanceMax.delete(id);
      this.remoteEdgeIndicators.get(id)?.remove();
      this.remoteEdgeIndicators.delete(id);
      if (previous && remoteRunnerIsAlive(previous) && !this.crashedRemoteIds.has(id)) {
        this.crashedRemoteIds.add(id);
        this._showRemoteCrash(player || previous, position);
      }
    }
    for (const [id, previous] of priorPlayers) {
      const player = nextPlayers.get(id);
      if (id === this.playerId || !remoteRunnerIsAlive(previous) || remoteRunnerIsAlive(player) || this.crashedRemoteIds.has(id)) continue;
      this.crashedRemoteIds.add(id);
      const last = this.remoteAvatars.get(id)?.group.position.clone() || { x: LANES[clamp(previous.lane, 0, 2)], y: previous.y || 1, z: 0 };
      this._showRemoteCrash(player || previous, last);
    }
  }

  _showRemoteCrash(player, position) {
    this.game._spawnCrashPuff?.(position.x, position.y || 1, position.z || 0);
    const toast = document.createElement('div');
    toast.className = 'party-crash-toast';
    toast.textContent = `${player.name} crashed at ${numberText(player.distance)} m`;
    this.root.append(toast);
    setTimeout(() => toast.remove(), 2800);
  }

  _rememberRemoteSnapshots(room, receivedAt = performance.now()) {
    const roundKey = `${room.code}:${room.round}`;
    if (roundKey !== this._remoteRoundKey) {
      this._remoteRoundKey = roundKey;
      this.remoteSnapshots.clear();
      this.remoteDistanceMax.clear();
      this.crashedRemoteIds?.clear();
      this.remoteEdgeIndicators?.clear();
      this.remoteEdgeList?.replaceChildren();
    }
    const remoteIds = new Set();
    for (const player of room.players) {
      if (player.id === this.playerId) continue;
      if (!remoteRunnerIsAlive(player)) continue;
      remoteIds.add(player.id);
      const history = this.remoteSnapshots.get(player.id) || [];
      const previous = history.at(-1);
      const distance = Math.max(Number(player.distance) || 0, previous?.distance || 0);
      const snapshot = {
        distance,
        lane: clamp(Number(player.lane) || 0, 0, 2),
        y: Number(player.y) || 0,
        anim: player.anim,
        alive: player.alive,
        receivedAt,
        speed: clamp(Number(player.speed) || 0, 0, 32),
        runClock: Math.max(Number(player.runClock) || 0, previous?.runClock || 0),
      };
      if (!previous || snapshot.distance !== previous.distance || snapshot.lane !== previous.lane ||
          snapshot.y !== previous.y || snapshot.anim !== previous.anim || snapshot.alive !== previous.alive ||
          snapshot.speed !== previous.speed || snapshot.runClock !== previous.runClock) {
        history.push(snapshot);
        if (history.length > 2) history.shift();
        this.remoteSnapshots.set(player.id, history);
      }
      if (!this.remoteDistanceMax.has(player.id)) this.remoteDistanceMax.set(player.id, distance);
    }
    for (const playerId of this.remoteSnapshots.keys()) {
      if (remoteIds.has(playerId)) continue;
      this.remoteSnapshots.delete(playerId);
      this.remoteDistanceMax.delete(playerId);
    }
  }

  _remoteDistance(player, now) {
    const latest = this.remoteSnapshots.get(player.id)?.at(-1);
    if (!latest) return Math.max(Number(player.distance) || 0, this.remoteDistanceMax.get(player.id) || 0);
    const myRunClock = Math.max(0, (Date.now() + this._serverOffsetMs - (this.room?.startAt || Date.now())) / 1000);
    const distance = estimateRemoteDistance({
      distance: latest.distance, speed: latest.speed, runClock: latest.runClock,
      myRunClock, previous: this.remoteDistanceMax.get(player.id) || 0,
    });
    this.remoteDistanceMax.set(player.id, distance);
    return distance;
  }

  _animateRemotes(now) {
    if (document.hidden) {
      this._raf = 0;
      return;
    }
    this._raf = requestAnimationFrame((time) => this._animateRemotes(time));
    const dt = this.lastRemoteFrame ? Math.min(.06, (now - this.lastRemoteFrame) / 1000) : 0;
    this.lastRemoteFrame = now;
    if (!this.room || !this.game.runnerRoot || this.room.phase !== 'running') return;
    this._ensureRemoteAvatars(this.room);
    const localDistance = this.game.scoring?.distanceM || 0;
    const peers = this.room.players.filter((player) => player.id !== this.playerId && remoteRunnerIsAlive(player));
    const laneSlots = new Map();
    for (const player of peers) {
      const avatar = this.remoteAvatars.get(player.id);
      if (!avatar) continue;
      if (avatar.skinId !== player.skinId) avatar.setSkin(player.skinId);
      avatar.shieldBubble?.setActive(player.shield === true);
      avatar.group.visible = this.game.runnerRoot.visible;
      const lane = clamp(player.lane, 0, 2);
      const peersInLane = laneSlots.get(lane) || 0;
      laneSlots.set(lane, peersInLane + 1);
      const laneOffset = peersInLane === 0 ? 0 : (peersInLane % 2 ? 1 : -1) * Math.ceil(peersInLane / 2) * 0.5;
      const remoteDistance = this._remoteDistance(player, now);
      const delta = clamp((remoteDistance - localDistance) * 0.18, -7, 32);
      const targetX = LANES[lane] + laneOffset;
      const targetY = Number(player.y) || 0;
      const rawZ = -(remoteDistance - localDistance);
      const targetZ = remoteRunnerZ(remoteDistance, localDistance);
      const outsideRange = rawZ < -60 || rawZ > 6;
      this._setRemoteEdgeIndicator(player, remoteDistance - localDistance, outsideRange);
      avatar.group.visible = this.game.runnerRoot.visible && !outsideRange;
      if (!avatar.group.visible) {
        if (avatar.nameplate) avatar.nameplate.hidden = true;
        continue;
      }
      const blend = 1 - Math.exp(-dt * 10);
      avatar.group.position.x += (targetX - avatar.group.position.x) * blend;
      avatar.group.position.y += (targetY - avatar.group.position.y) * blend;
      avatar.group.position.z += (targetZ - avatar.group.position.z) * blend;
      avatar.runRate = Math.max(0.25, (this.game._speed?.() || 10) / 8);
      avatar.runPhase += dt * 14 * avatar.runRate;
      const anim = player.anim;
      if (anim && avatar.anim !== anim) avatar.setAnim(anim);
      avatar.update(dt);
      avatar.shieldBubble?.update(dt);
      const camera = this.game.camera;
      if (!camera || !avatar.nameplate || !avatar.nameplatePoint) {
        continue;
      }
      camera.updateMatrixWorld();
      const projected = avatar.nameplatePoint
        .set(avatar.group.position.x, avatar.group.position.y + 2.25, avatar.group.position.z)
        .project(camera);
      const screenX = (projected.x * 0.5 + 0.5) * window.innerWidth;
      const screenY = (-projected.y * 0.5 + 0.5) * window.innerHeight;
      avatar.nameplate.hidden = projected.z < -1 || projected.z > 1 ||
        screenX < 0 || screenX > window.innerWidth || screenY < 0 || screenY > window.innerHeight;
      avatar.nameplate.textContent = `${player.name} · ${numberText(remoteDistance)} m · Running`;
      avatar.nameplate.style.left = `${screenX}px`;
      avatar.nameplate.style.top = `${screenY}px`;
    }
    for (const [id, indicator] of this.remoteEdgeIndicators) {
      if (!peers.some((player) => player.id === id)) { indicator.remove(); this.remoteEdgeIndicators.delete(id); }
    }
  }

  _setRemoteEdgeIndicator(player, delta, outsideRange) {
    let indicator = this.remoteEdgeIndicators.get(player.id);
    if (!outsideRange) {
      indicator?.remove();
      this.remoteEdgeIndicators.delete(player.id);
      return;
    }
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'party-remote-edge';
      this.remoteEdgeIndicators.set(player.id, indicator);
      this.remoteEdgeList.append(indicator);
    }
    const ahead = delta > 0;
    indicator.textContent = `${ahead ? '▲' : '▼'} ${player.name} ${ahead ? '+' : ''}${Math.round(delta)} m`;
  }

  leaveRoom(returnToTitle = false) {
    if (this.roomCode) this._send({ type: 'leave', code: this.roomCode }, { quiet: true, ignoreRoom: true });
    this.room = null;
    this.roomCode = null;
    clearTimeout(this.chatTimer);
    this.chatTimer = null;
    this.chatRoomKey = null;
    this.chatOpen = false;
    this.chatUnread = 0;
    this.chatAfterId = null;
    this.chatMessages = [];
    this.chatMessagesEl.replaceChildren();
    this.chatWidget.classList.add('hidden');
    this._startedForRoom = null;
    this.finishedForRoom = null;
    clearTimeout(this.countdownTimer);
    clearInterval(this.countdownInterval);
    clearInterval(this.roundoverTimer);
    this.countdownTimer = null;
    this.countdownInterval = null;
    this.roundoverTimer = null;
    this._syncNetworkTimers();
    this.board.classList.add('hidden');
    this.rootEl.classList.add('hidden');
    for (const avatar of this.remoteAvatars.values()) this._disposeRemote(avatar);
    this.remoteAvatars.clear();
    this.remoteSnapshots.clear();
    this.remoteDistanceMax.clear();
    this.remoteEdgeIndicators.clear();
    this.remoteEdgeList.replaceChildren();
    this.remoteNameplates.replaceChildren();
    this.crashedRemoteIds.clear();
    this.spectating = false;
    this._remoteRoundKey = null;
    if (returnToTitle) {
      if (this.game.state !== 'LIBRARY') this.game.setState('LIBRARY');
      this.game.ui?.show?.('tap');
    }
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    clearTimeout(this.countdownTimer);
    clearInterval(this.countdownInterval);
    clearInterval(this.roundoverTimer);
    clearTimeout(this.chatTimer);
    clearTimeout(this.partyEventTimer);
    this._clearNetworkTimers();
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    for (const avatar of this.remoteAvatars.values()) this._disposeRemote(avatar);
    this.remoteAvatars.clear();
    this.rootEl.remove();
    this.board.remove();
    this.remoteEdgeList.remove();
    this.remoteNameplates.remove();
    this.partyEventToast.remove();
    this.chatWidget.remove();
    this.leaderboardLayer.remove();
  }
}
