import { PlayerAvatar } from '../game/PlayerAvatar.js';
import { LANES } from '../game/PlayerController.js';
import './party.css';

const PLAYER_COLORS = ['#d9a441', '#36c5b0', '#ed7869', '#6da7ed', '#c48be4', '#d9d566', '#53b9d4', '#ee9ac2'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const numberText = (value) => Math.floor(Math.max(0, value || 0)).toLocaleString();

export class PartyRace {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.playerId = this._getPlayerId();
    this.room = null;
    this.roomCode = null;
    this.finishedForRoom = null;
    this.apiReady = false;
    this._progressPending = false;
    this.countdownTimer = null;
    this.progressTimer = null;
    this.pollTimer = null;
    this.heartbeatTimer = null;
    this.lastRemoteFrame = 0;
    this.remoteAvatars = new Map();
    this._buildUI();
    this._connect();
    this.game.partyRace = this;
    this.game.events?.on?.('statechange', (state) => this._onGameState(state));
    this.progressTimer = setInterval(() => this._progress(), 750);
    this.pollTimer = setInterval(() => this._poll(), 700);
    this.heartbeatTimer = setInterval(() => {
      if (this.roomCode) this._send({ type: 'heartbeat' }, { quiet: true });
    }, 6000);
    this._raf = requestAnimationFrame((now) => this._animateRemotes(now));
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
            <label class="party-field">Room code<input data-code maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="Enter a friend's code"></label>
          </div>
          <div class="party-actions"><button class="btn" data-create>Create room</button><button class="btn secondary" data-join>Join room</button></div>
          <div class="party-status" data-status>Connecting to the race server…</div>
          <div class="party-actions"><button class="btn secondary small" data-close>Back to title</button></div>
        </div>
        <div class="party-view hidden" data-view="lobby">
          <div class="party-kicker">Waiting room</div><h2 class="party-title">Race lobby</h2>
          <p class="party-copy">Share the code, then run three rounds. Total distance wins; race coins break ties.</p><div class="party-code" data-room-code>------</div>
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
          <div class="party-actions"><button class="btn secondary" data-leave>Leave room</button></div>
        </div>
        <div class="party-view hidden" data-view="results">
          <div class="party-kicker" data-results-kicker>Race complete</div><h2 class="party-title" data-results-title>Round results</h2>
          <p class="party-copy" data-winner>Farthest distance wins. Race coins break ties.</p>
          <div class="party-results" data-results></div>
          <div class="party-actions"><button class="btn" data-next>Next round</button><button class="btn secondary" data-leave>Leave room</button></div>
          <div class="party-status" data-results-status></div>
        </div>
      </section>`;
    this.board = document.createElement('div');
    this.board.className = 'party-board hidden';
    this.root.append(this.rootEl, this.board);

    this.nameInput = this.rootEl.querySelector('[data-name]');
    this.codeInput = this.rootEl.querySelector('[data-code]');
    this.statusEl = this.rootEl.querySelector('[data-status]');
    this.roomCodeEl = this.rootEl.querySelector('[data-room-code]');
    this.rosterEl = this.rootEl.querySelector('[data-roster]');
    this.waitRosterEl = this.rootEl.querySelector('[data-wait-roster]');
    this.resultsEl = this.rootEl.querySelector('[data-results]');
    this.winnerEl = this.rootEl.querySelector('[data-winner]');
    this.resultStatusEl = this.rootEl.querySelector('[data-results-status]');
    this.resultsKickerEl = this.rootEl.querySelector('[data-results-kicker]');
    this.resultsTitleEl = this.rootEl.querySelector('[data-results-title]');
    this.lobbyStatusEl = this.rootEl.querySelector('[data-lobby-status]');
    this.countdownEl = this.rootEl.querySelector('[data-countdown]');
    try { this.nameInput.value = localStorage.getItem('mmr.partyName') || ''; } catch { /* storage may be disabled */ }

    const titleScreen = this.root.querySelector('#screen-tap');
    const corner = titleScreen?.querySelector('.corner-links');
    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'btn secondary small party-trigger';
    this.trigger.textContent = 'Multiplayer';
    this.trigger.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.trigger.addEventListener('pointerup', (event) => event.stopPropagation());
    this.trigger.addEventListener('click', (event) => { event.stopPropagation(); this.open(); });
    corner?.prepend(this.trigger);

    this.rootEl.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.rootEl.addEventListener('pointerup', (event) => event.stopPropagation());
    this.rootEl.addEventListener('click', (event) => event.stopPropagation());
    this.rootEl.addEventListener('keydown', (event) => event.stopPropagation());
    this.rootEl.querySelector('[data-create]').addEventListener('click', () => this._createRoom());
    this.rootEl.querySelector('[data-join]').addEventListener('click', () => this._joinRoom());
    this.rootEl.querySelector('[data-start]').addEventListener('click', () => this._send({ type: 'start' }));
    this.rootEl.querySelector('[data-next]').addEventListener('click', () => this._send({ type: 'start' }));
    this.rootEl.querySelectorAll('[data-leave]').forEach((button) => button.addEventListener('click', () => this.leaveRoom(true)));
    this.rootEl.querySelector('[data-close]').addEventListener('click', () => this.close());
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

  _setActionStatus(message, isError = false) {
    const view = [...this.rootEl.querySelectorAll('[data-view]')].find((section) => !section.classList.contains('hidden'));
    const status = view?.querySelector('.party-status') || this.statusEl;
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  _poll() {
    if (!this.roomCode || this._pollPending) return;
    this._pollPending = true;
    this._request({ type: 'poll' }, { quiet: true }).finally(() => { this._pollPending = false; });
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
    this._send({ type: 'create', name });
  }

  _joinRoom() {
    const name = this._name();
    if (!name) return;
    const code = this.codeInput.value.trim().toUpperCase();
    if (code.length !== 6) return this._setStatus('Enter the 6-character room code.', true);
    if (!this.apiReady) return this._setStatus('Still connecting to the race server…');
    this._send({ type: 'join', name, code });
  }

  open() {
    if (this.room?.phase === 'lobby') this._show('lobby');
    else this._show('entry');
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
    this.room = room;
    this.roomCode = room.code;
    this.roomCodeEl.textContent = room.code;
    this._renderBoard(room);
    if (room.phase === 'lobby') {
      this.board.classList.add('hidden');
      this._renderRoster(this.rosterEl, room);
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
      if (this.game.state === 'GAMEOVER') this._showWaiting();
      else this.rootEl.classList.add('hidden');
      this._ensureStarted();
      return;
    }
    if (room.phase === 'roundover' || room.phase === 'gameover') {
      this.board.classList.add('hidden');
      this._showResults(room);
    }
  }

  _startCountdown(room) {
    clearTimeout(this.countdownTimer);
    const update = () => {
      if (!this.room || this.room.phase !== 'countdown') return;
      const remaining = Math.max(0, Math.ceil((this.room.startAt - Date.now()) / 1000));
      this.countdownEl.textContent = remaining > 0 ? String(remaining) : 'RUN!';
    };
    update();
    this.countdownTimer = setTimeout(() => {
      if (!this.room || this.room.phase !== 'countdown') return;
      this._ensureStarted();
    }, Math.max(0, room.startAt - Date.now()));
  }

  _ensureStarted() {
    if (!this.room || (this.room.phase !== 'countdown' && this.room.phase !== 'running')) return;
    if (this.game.state !== 'LIBRARY' && this.game.state !== 'GAMEOVER') return;
    const roundKey = `${this.roomCode}:${this.room.round}`;
    if (this._startedForRoom === roundKey && this.game.state === 'RUNNER') return;
    this._startedForRoom = roundKey;
    this.finishedForRoom = null;
    this.game.startPartyRace?.();
  }

  _renderRoster(container, room, results = false) {
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
    const isHost = this.playerId === room.hostId;
    next.classList.toggle('hidden', final || !isHost);
    next.disabled = room.players.filter((player) => player.connected).length < 2;
    next.textContent = `Start round ${room.round + 1} of ${room.maxRounds}`;
    this.resultStatusEl.textContent = final
      ? 'Three rounds finished. Leave the room to play again.'
      : isHost
        ? `Everyone ready? Start round ${room.round + 1} of ${room.maxRounds}.`
        : 'Waiting for the host to start the next round.';
    this._show('results');
  }

  _onGameState(state) {
    if (!this.room) return;
    if (state === 'RUNNER' || state === 'RUNNING') {
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
      if (this.room.phase === 'gameover') this._showResults(this.room);
      else this._showWaiting();
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
    this._send({
      type: 'progress',
      distance: this.game.scoring?.distanceM || 0,
      score: this.game.scoring?.score || 0,
      coins: this.game.scoring?.coins || 0,
      lane: player.laneIndex,
      y: player.y + player.flyY,
      anim,
    }, { quiet: true }).finally(() => { this._progressPending = false; });
  }

  _ensureRemoteAvatars(room) {
    if (!this.game.runnerRoot) return;
    const remotePlayers = room.players.filter((player) => player.id !== this.playerId);
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
      avatar.group.visible = false;
      avatar.group.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = false;
        object.receiveShadow = false;
      });
      avatar.setAnim('run');
      this.remoteAvatars.set(player.id, avatar);
    }
  }

  _disposeRemote(avatar) {
    const group = avatar.group;
    if (group.parent) group.parent.remove(group);
    group.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry?.dispose?.();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material?.dispose?.();
    });
  }

  _animateRemotes(now) {
    this._raf = requestAnimationFrame((time) => this._animateRemotes(time));
    const dt = this.lastRemoteFrame ? Math.min(.06, (now - this.lastRemoteFrame) / 1000) : 0;
    this.lastRemoteFrame = now;
    if (!this.room || !this.game.runnerRoot || this.room.phase !== 'running') return;
    this._ensureRemoteAvatars(this.room);
    const localDistance = this.game.scoring?.distanceM || 0;
    const localLane = this.game.player?.laneIndex ?? 1;
    const peers = this.room.players.filter((player) => player.id !== this.playerId);
    const laneSlots = new Map();
    for (const player of peers) {
      const avatar = this.remoteAvatars.get(player.id);
      if (!avatar) continue;
      avatar.group.visible = this.game.runnerRoot.visible;
      const lane = clamp(player.lane, 0, 2);
      const peersInLane = laneSlots.get(lane) || 0;
      laneSlots.set(lane, peersInLane + 1);
      const laneOffset = peersInLane === 0 ? 0 : (peersInLane % 2 ? 1 : -1) * Math.ceil(peersInLane / 2) * 0.5;
      const delta = clamp((player.distance - localDistance) * 0.18, -7, 32);
      const z = clamp(-4 - delta - peersInLane * 1.2, -36, 8);
      avatar.group.position.set(LANES[lane] + laneOffset, player.y || 0, z);
      avatar.runRate = Math.max(0.25, (this.game._speed?.() || 10) / 8);
      avatar.runPhase += dt * 14 * avatar.runRate;
      const anim = player.alive ? player.anim : 'fall';
      if (anim && avatar.anim !== anim) avatar.setAnim(anim);
      avatar.update(dt);
    }
  }

  leaveRoom(returnToTitle = false) {
    if (this.roomCode) this._send({ type: 'leave', code: this.roomCode }, { quiet: true, ignoreRoom: true });
    this.room = null;
    this.roomCode = null;
    this._startedForRoom = null;
    this.finishedForRoom = null;
    clearTimeout(this.countdownTimer);
    this.board.classList.add('hidden');
    this.rootEl.classList.add('hidden');
    for (const avatar of this.remoteAvatars.values()) this._disposeRemote(avatar);
    this.remoteAvatars.clear();
    if (returnToTitle) {
      if (this.game.state !== 'LIBRARY') this.game.setState('LIBRARY');
      this.game.ui?.show?.('tap');
    }
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    clearTimeout(this.countdownTimer);
    clearInterval(this.progressTimer);
    clearInterval(this.pollTimer);
    clearInterval(this.heartbeatTimer);
    for (const avatar of this.remoteAvatars.values()) this._disposeRemote(avatar);
    this.remoteAvatars.clear();
    this.rootEl.remove();
    this.board.remove();
  }
}
