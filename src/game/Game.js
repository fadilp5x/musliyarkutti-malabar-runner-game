import * as THREE from 'three';
import { STATES } from './GameState.js';
import { InputManager } from './InputManager.js';
import { CameraController } from './CameraController.js';
import { SaveManager } from './SaveManager.js';
import { AudioManager } from './AudioManager.js';
import { LibraryScene } from './LibraryScene.js';
import { CinematicIntro } from './CinematicIntro.js';
import { AssetLoader } from '../assets/AssetLoader.js';
import { PlayerAvatar } from './PlayerAvatar.js';
import { PlayerController, LANES } from './PlayerController.js';
import { EffectsManager } from './EffectsManager.js';
import { WorldBuilder } from './WorldBuilder.js';
import { LandmarkManager } from './LandmarkManager.js';
import { AcademyGate } from './AcademyGate.js';
import { ObstacleManager } from './ObstacleManager.js';
import { CollectibleManager } from './CollectibleManager.js';
import { PowerUpManager } from './PowerUpManager.js';
import { ScoringSystem } from './ScoringSystem.js';
import { VoucherManager, VOUCHER_UNLOCK_M } from './VoucherManager.js';
import { VoucherWallet } from './VoucherWallet.js';
import { Missions } from './Missions.js';
import { ShaytanPursuit } from './ShaytanPursuit.js';
import { ModelLoader } from '../assets/ModelLoader.js';
import { Inventory } from './Inventory.js';
import { UI } from '../ui/UI.js';
// GRAPHICS OVERHAUL: renderer pipeline (bloom composer) + blob contact shadows.
import { RenderPipeline } from './RenderPipeline.js';
import { ContactShadows } from './ContactShadows.js';

// Fixed-timestep simulation: 120 Hz steps, max 5 steps per frame, render each rAF.
const STEP = 1 / 120;
const MAX_STEPS = 5;
// Speed workstream (Oct 2026): base 8 -> 10 (+25%), cap 24 -> 28 (+17%).
// Curve stays linear with a slightly steeper ramp; reaction-time analysis in
// .work/speed-findings.md, spacing patch in PATCHES.md (ObstacleManager).
const MAX_SPEED = 28;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = STATES.LOADING;
    this._prevState = null;

    // Tiny pub/sub event bus (contract: game.events = { on, emit })
    this._listeners = {};
    this.events = {
      on: (evt, cb) => {
        if (!this._listeners[evt]) this._listeners[evt] = [];
        this._listeners[evt].push(cb);
      },
      emit: (evt, data) => {
        const arr = this._listeners[evt];
        if (!arr) return;
        for (const cb of arr.slice()) {
          try {
            cb(data);
          } catch (err) {
            console.error(`[game] event "${evt}" handler failed:`, err);
          }
        }
      },
    };

    this.save = new SaveManager();
    this.audio = new AudioManager();
    // Audio workstream (A1): single wiring point for sfx→play, statechange→loop
    // routing, audioDuck→duck, footstep→throttled steps. Do NOT add duplicate
    // 'sfx'/'audioDuck' handlers elsewhere — bindEvents is the one call site.
    this.audio.bindEvents(this.events);
    this.assetLoader = new AssetLoader();

    this._acc = 0;
    this._last = 0;
    this._raf = 0;
    this._stumbleT = 0;
    this._coinSfxT = 0;
    this._bankedCoins = 0;
    this._runVouchers = 0;
    this._mCoins = 0;
    this._mNear = 0;
    this._mVouchers = 0;
    this._reducedMotion = false;
    this._quality = 'high';

    // transient impact FX (shockwave rings) + dev collision overlay
    this._fx = [];
    this.collisionDebug = null;

    // Handles filled in init()
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.cameraCtl = null;
    this.avatar = null;
    this.player = null;
    this.library = null;
    this.pursuit = null;
    this.world = null;
    this.landmarks = null;
    this.academyGate = null;
    this.obstacles = null;
    this.collectibles = null;
    this.powerups = null;
    this.scoring = null;
    this.effects = null; // speed/FX workstream: pooled transient effects
    this.vouchers = null;
    this.wallet = null;
    this.missions = null;
    this.inventory = null;
    this.ui = null;
    this.input = null;
  }

  // --- lifecycle -----------------------------------------------------------

  async init() {
    const data = this.save.load();
    this._bankedCoins = data.coins || 0;
    this._reducedMotion = data.settings.reducedMotion === true;
    const q0 = data.settings.quality;
    this._quality = q0 === 'low' || q0 === 'medium' ? q0 : 'high';
    this.audio.setEnabled(data.settings.sound !== false);
    // Audio workstream (A2): apply persisted per-layer volumes immediately.
    try { this.audio.setVolumes(data.settings); } catch { /* audio optional */ }

    // UI first (Oct 14, 2026): the loading screen must exist BEFORE the heavy
    // assets load so the 0-100% progress bar is honest from the first step.
    this.ui = new UI(this, document.getElementById('ui'));
    this._reportProgress(3, 'Starting...');

    // 1. Assets first — every SVG texture the world/managers need.
    const textures = await this.assetLoader.loadAll();
    void textures;
    this._reportProgress(15, 'Textures loaded...');

    // 2. Renderer / scene / camera
    // GRAPHICS OVERHAUL: explicit sRGB output + ACES filmic tone mapping.
    // ACES compresses highlights/midtones, so light intensities elsewhere
    // were raised ~1.5-2.5x to compensate (see WorldBuilder._buildLights).
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = this._quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1a2e);
    // Sky/fog baseline (unchanged): the runner sky dome's horizon color
    // matches this so the dome melts into the fogged ground.
    this.scene.fog = new THREE.Fog(0x87b5d6, 40, 160);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 2.4, 5.4);
    this.cameraCtl = new CameraController(this.camera);

    // GRAPHICS OVERHAUL: post pipeline (restrained bloom, High only) + blob
    // contact shadows. setQuality applies the tier (pixel ratio / bloom /
    // shadow-map on-off); world.setQuality runs later once the world exists.
    this._pipeline = new RenderPipeline(this.renderer, this.scene, this.camera);
    this._contactShadows = new ContactShadows(this.scene);
    this.setQuality(this._quality);
    this._reportProgress(25, 'Renderer ready...');

    // 3. Player
    this.avatar = new PlayerAvatar(this.scene);
    this.player = new PlayerController(this.avatar, this.events);

    // 4. Library intro scene (uses the avatar)
    this.library = new LibraryScene(this.scene, this.assetLoader, this.avatar, this.events);
    this.library.setCamera(this.camera);
    if (this._reducedMotion) this.library.reducedMotion = true;
    await this.library.init();
    this._reportProgress(40, 'Library built...');

    // Street pursuit (cinematic workstream): follows the player for ~10s
    // after each run begins, then dissolves and stays dormant.
    this.pursuit = new ShaytanPursuit(this.scene, this.events);
    this.pursuit.setCamera(this.camera);
    this.pursuit.setAssetLoader(this.assetLoader);
    this.pursuit.setPlayerX(() => this.player.x);
    this.pursuit.setReducedMotion(this._reducedMotion);
    // GLB model pipeline (Oct 13, 2026): fari's supplied models — traffic
    // vehicles, windmill, selectable Shaytan apparitions.
    this.modelLoader = new ModelLoader({ scene: this.scene });
    await this.modelLoader.init();
    this.pursuit.setModelLoader(this.modelLoader);
    this._reportProgress(48, 'Models ready...');
    // Hero mascot (Oct 14, 2026): fari's GLB on the title screen. Loaded here
    // (not lazily) so the progress bar stays honest — 7.7MB is the big one.
    try {
      await this._loadHeroMascot();
      this._reportProgress(62, 'Mascot loaded...');
    } catch (e) {
      console.warn('[game] hero mascot load failed (title will show without it):', e);
      this._reportProgress(62, 'Mascot skipped...');
    }
    // Apply the saved Shaytan variant (lazy: the GLB loads in the background
    // only when a non-classic variant is selected — never blocks boot).
    try {
      this.pursuit.setVariant(data.settings.shaytan || 'classic');
    } catch (e) {
      console.warn('[game] shaytan variant init failed:', e);
    }

    // Audio-hook plumbing (cinematic workstream). LibraryScene/ShaytanPursuit
    // emit 'sfx' hook names and 'audioDuck' — BOTH are already consumed once by
    // audio.bindEvents() in the constructor, so no duplicate handlers here.
    // Camera shake for the library lunge (LibraryScene has no camera handle).
    this.events.on('shake', (n) => { if (this.cameraCtl) this.cameraCtl.shake(n); });

    // 5. Runner world + managers. They live under runnerRoot so the whole
    //    street can be hidden when quitting back to the library title.
    this.runnerRoot = new THREE.Group();
    this.scene.add(this.runnerRoot);
    this._runnerActive = false;
    this.world = new WorldBuilder(this.runnerRoot, this.events, this.assetLoader);
    this.world.setQuality(this._quality);
    // fari's GLB traffic + windmill (lazy: failures keep procedural models).
    try {
      await this.world.loadVehicleModels(this.modelLoader);
      this._reportProgress(78, 'Vehicles loaded...');
    } catch (e) {
      console.warn('[game] vehicle GLB load failed:', e);
      this._reportProgress(78, 'Vehicles skipped...');
    }
    this.landmarks = new LandmarkManager(this.runnerRoot, this.events, this.assetLoader);
    // Shamsul Huda academy entrance gate: spans all 3 lanes at ~22 m, visual only.
    this.academyGate = new AcademyGate(this.runnerRoot, this.assetLoader, {
      events: this.events,
      audio: this.audio,
    });
    this.obstacles = new ObstacleManager(this.runnerRoot, this.events, this.assetLoader);
    this.collectibles = new CollectibleManager(this.runnerRoot, this.events, this.assetLoader);
    this.powerups = new PowerUpManager(this.runnerRoot, this.events);
    // Pooled runner FX (footstep dust, landing bursts, streaks, sparkles,
    // portal swirl, trails, speed lines). Lives under runnerRoot so it hides
    // with quit-to-title; event-triggered, zero per-frame allocation.
    this.effects = new EffectsManager(this.runnerRoot, this.events, this.camera, {
      reducedMotion: this._reducedMotion,
      maxSpeed: MAX_SPEED,
    });
    // GRAPHICS OVERHAUL: blob contact shadows (no extra shadow-map passes).
    // Blobs attach as children so they ride the treadmill / landmark slide.
    if (this._contactShadows) {
      this._contactShadows.attachWorld(this.world);
      this._contactShadows.attachLandmarks(this.landmarks);
      this._contactShadows.attachGate(this.academyGate);
      this._contactShadows.setHero(
        () => this.player.x,
        () => this.avatar.group.position.y
      );
    }
    this.scoring = new ScoringSystem();
    this.scoring.best = data.highscore || 0;
    this.vouchers = new VoucherManager();
    if (data.vouchers && typeof data.vouchers.lastSpawnM === 'number') {
      this.vouchers.lastSpawnM = data.vouchers.lastSpawnM;
    }
    this.wallet = new VoucherWallet();
    this.wallet.load(data.wallet);
    this.missions = new Missions();
    this.missions.load(data.missions);
    this.inventory = new Inventory();
    this.inventory.load(data.inventory);

    // 6. Wiring (UI was created at the top of init so the loading screen
    // shows progress from the first step; it maps states to screens itself
    // via 'statechange').
    this._wireEvents();
    this.input = new InputManager((action) => this._onAction(action));
    this._reportProgress(88, 'Almost there...');

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._doPause();
    });

    // 7. Intro tableau, then wait for a tap (UI shows 'tap' on statechange)
    this._reportProgress(94, 'Lighting the lamps...');
    await this.library.playIntro();
    this.avatar.setAnim('reading');
    this._reportProgress(100, 'Ready!');

    // Dev-only collision overlay: ?debug=collisions (dynamic import so it
    // never joins the production bundle).
    try {
      if (typeof window !== 'undefined' &&
          new URLSearchParams(window.location.search).get('debug') === 'collisions') {
        const { CollisionDebug } = await import('./CollisionDebug.js');
        this.collisionDebug = new CollisionDebug(this.runnerRoot, this.events);
        console.log('[game] collision debug overlay enabled (?debug=collisions)');
      }
    } catch {
      // dev aid only — never break the game
    }

    this.setState(STATES.LIBRARY);
  }

  // Hero mascot (Oct 14, 2026): fari's GLB as the title-screen greeter.
  // The model is static (no rig), so the "life" comes from a gentle
  // group-level bob — honest, no fake skeletal animation claimed.
  async _loadHeroMascot() {
    const handle = await this.modelLoader.loadModel('hero_mascot');
    const obj = handle?.object3D;
    if (!obj) return;
    // Normalize: the GLB is ~2 units tall; scale to ~1.7 to match the avatar.
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    const h = size.y || 1;
    const s = 1.7 / h;
    obj.scale.setScalar(s);
    // Re-center so feet sit on y=0.
    const box2 = new THREE.Box3().setFromObject(obj);
    obj.position.y -= box2.min.y;
    // Greeting pose faces the camera: library camera looks down -z from +z,
    // so the mascot stands to the right of the desk, facing forward (+z).
    const mount = new THREE.Group();
    mount.add(obj);
    mount.position.set(2.1, 0, -1.2);
    mount.rotation.y = -0.35; // slight angle, welcoming
    this.library.group.add(mount);
    this._mascot = mount;
    this._mascotBaseY = 0;
    this._mascotVisible = true;
  }

  _setMascotVisible(v) {
    if (!this._mascot) return;
    this._mascotVisible = v;
    this._mascot.visible = v;
  }

  start() {
    if (this._raf) return;
    this._last = performance.now();
    const tick = (t) => {
      this._raf = requestAnimationFrame(tick);
      let dt = (t - this._last) / 1000;
      this._last = t;
      if (dt > 0.25) dt = 0.25;
      this._acc += dt;
      let steps = 0;
      while (this._acc >= STEP && steps < MAX_STEPS) {
        this.update(STEP);
        this._acc -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS) this._acc = 0; // drop backlog, avoid spiral of death
      this.render();
    };
    this._raf = requestAnimationFrame(tick);
  }

  stop() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
  }

  resize(w, h) {
    if (!this.renderer || !this.camera) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    // GRAPHICS OVERHAUL: keep the composer in sync with the canvas.
    if (this._pipeline) this._pipeline.setSize(w, h);
  }

  render() {
    if (this.renderer && this.scene && this.camera) {
      // GRAPHICS OVERHAUL: hero blob tracks the player; the pipeline picks
      // direct render (Low/Medium) or composer + restrained bloom (High).
      if (this._contactShadows) this._contactShadows.update();
      if (this._pipeline) this._pipeline.render();
      else this.renderer.render(this.scene, this.camera);
    }
  }

  // GRAPHICS OVERHAUL: quality tiers.
  //   Low:    pixelRatio 1, shadow map off, bloom off, halved scenery.
  //   Medium: pixelRatio <= 1.5, 1024 shadows, bloom off, full scenery.
  //   High:   pixelRatio <= 2, 2048 shadows, bloom on, full FX.
  // Safe to call before the world/pipeline exist (guards skip missing parts).
  // Thakarppan loading (Oct 14, 2026): honest 0-100% progress on the
  // loading screen. Safe to call before UI exists (no-op until then).
  _reportProgress(pct, label) {
    try {
      this.ui?.setLoadingProgress?.(pct, label);
    } catch { /* loading UI is best-effort */ }
  }

  setQuality(q) {
    const quality = q === 'low' || q === 'medium' ? q : 'high';
    this._quality = quality;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const pr = quality === 'low' ? 1
      : quality === 'medium' ? Math.min(dpr, 1.5)
      : Math.min(dpr, 2);
    if (this.renderer) {
      this.renderer.setPixelRatio(pr);
      this.renderer.shadowMap.enabled = quality !== 'low';
    }
    if (this._pipeline) {
      this._pipeline.setPixelRatio(pr);
      if (typeof window !== 'undefined') {
        this._pipeline.setSize(window.innerWidth, window.innerHeight);
      }
      this._pipeline.setBloom(quality === 'high');
    }
    if (this.world) this.world.setQuality(quality);
  }

  setState(s) {
    const wasRunner = this._runnerActive === true;
    this.state = s;
    // Quit-to-title: tear down the street and rebuild the library tableau.
    if (s === STATES.LIBRARY && wasRunner && this.library) {
      this._quitToTitle();
    }
    // Mascot greets on the title screen only — hide during the scare/chase/run.
    this._setMascotVisible(s === STATES.LIBRARY);
    this.events.emit('statechange', s);
  }

  // Public controls used by the UI workstream (HUD buttons / menu screens).
  togglePause() {
    this._togglePause();
  }

  restart() {
    if (this.state === STATES.GAMEOVER || this.state === STATES.PAUSED) {
      this._beginRunner();
    }
  }

  startRun() {
    // First-time players choose tutorial preference before the cinematic.
    const data = this.save.load();
    if (!data.tutorialPreference) {
      this.ui.showTutorialChoice();
      this._pendingStartRun = true;
      return;
    }
    this._startShaytan();
  }

  // All players enter the same runner scene on the room's shared countdown.
  // Bypass the solo intro and first-run tutorial so race starts stay in sync.
  startPartyRace() {
    if (this.state !== STATES.LIBRARY && this.state !== STATES.GAMEOVER) return false;
    this._partyRaceStarting = true;
    try { this._beginRunner(); }
    finally { this._partyRaceStarting = false; }
    return true;
  }

  // Called when the player picks a tutorial preference.
  setTutorialPreference(choice) {
    try {
      const d = this.save.load();
      d.tutorialPreference = choice; // 'with' | 'without'
      this.save.save(d);
    } catch {}
  }

  // Continue after the tutorial choice overlay is dismissed.
  proceedAfterTutorialChoice() {
    if (this._pendingStartRun) {
      this._pendingStartRun = false;
      this._startShaytan();
    }
  }

  // Skip the tutorial mid-flow → normal gameplay.
  skipTutorial() {
    if (this.state !== STATES.TUTORIAL) return;
    this._endTutorial();
  }

  // Guided first-time tutorial (Oct 14, 2026). Uses the real runner mechanics;
  // each step completes on the actual player action.
  _startTutorial() {
    this.setState(STATES.TUTORIAL);
    this.audio.play('start');
    this._tutorialStep = 0;
    this._tutorialCoins = 0;
    this._tutorialTimer = 0;
    this._showTutorialStep();
  }

  _tutorialSteps() {
    return [
      '⬅️ Swipe LEFT or RIGHT (or ← → keys) to change lanes ➡️',
      '⬆️ Swipe UP (or ↑ key) to JUMP over low barriers',
      '⬇️ Swipe DOWN (or ↓ key) to SLIDE under overhead gates',
      '✨ Collect the glowing Arabic letters to earn coins!',
      '⚠️ Watch the road! Avoid pedestrians, vehicles, and barriers.',
      '👹 Keep running! Shaytan is chasing you from behind!',
    ];
  }

  _showTutorialStep() {
    const steps = this._tutorialSteps();
    if (this._tutorialStep < steps.length) {
      this.ui.showTutorialPrompt(`Step ${this._tutorialStep + 1}/6: ${steps[this._tutorialStep]}`);
    }
  }

  _advanceTutorial() {
    this._tutorialStep++;
    if (this._tutorialStep >= this._tutorialSteps().length) {
      this._endTutorial();
    } else {
      this._showTutorialStep();
      // Step-specific setup
      if (this._tutorialStep === 3) {
        // Step 4 (collect): record starting coin count
        this._tutorialCoins = this.scoring.coins || 0;
      }
      if (this._tutorialStep === 4 || this._tutorialStep === 5) {
        // Steps 5-6: reset timer
        this._tutorialTimer = 0;
      }
      if (this._tutorialStep === 5) {
        // Step 6 (shaytan): make pursuit visible
        try { this.pursuit?.nudge?.(0.5); } catch {}
      }
    }
  }

  _endTutorial() {
    this._tutorialDone = true;
    this.ui.hideTutorialPrompt();
    this.setState(STATES.RUNNER);
  }

  // Called by the tutorial step logic when the player performs the action.
  _onTutorialAction(action) {
    if (this.state !== STATES.TUTORIAL) return;
    const step = this._tutorialStep;
    if (step === 0 && (action === 'left' || action === 'right')) this._advanceTutorial();
    else if (step === 1 && action === 'jump') this._advanceTutorial();
    else if (step === 2 && action === 'slide') this._advanceTutorial();
    // Steps 3-5 advance via update() (coins collected, timer)
  }

  // Per-frame tutorial progress: coin collection (step 4) and timers (steps 5-6).
  _updateTutorial(dt) {
    const step = this._tutorialStep;
    if (step === 3) {
      // Step 4: collect 3 coins
      const coins = this.scoring.coins || 0;
      if (coins >= this._tutorialCoins + 3) this._advanceTutorial();
    } else if (step === 4) {
      // Step 5: survive 8 seconds of obstacles
      this._tutorialTimer += dt;
      if (this._tutorialTimer >= 8) this._advanceTutorial();
    } else if (step === 5) {
      // Step 6: shaytan warning for 4 seconds, then done
      this._tutorialTimer += dt;
      if (this._tutorialTimer >= 4) this._advanceTutorial();
    }
  }

  _quitToTitle() {
    this._runnerActive = false;
    try {
      this.world.reset();
      this.landmarks.reset?.();
      this.academyGate.reset?.();
      this.obstacles.reset();
      this.collectibles.reset();
      this.powerups.reset();
    } catch {
      // managers may not be fully built yet
    }
    this.runnerRoot.visible = false;
    // Show the library again (was hidden when the runner started)
    if (this.library && this.library.group) {
      this.library.group.visible = true;
    }
    this.player.reset();
    if (this.pursuit) this.pursuit.reset();
    this.scoring.resetRun();
    this.scoring.multiplier = 1;
    this._clearFx();
    this.library.resetToIntro();
  }

  // --- event wiring --------------------------------------------------------

  _wireEvents() {
    this.events.on('coin', (n) => {
      this.scoring.addCoins(n || 1);
      const now = performance.now();
      if (now - this._coinSfxT > 70) {
        this._coinSfxT = now;
        this.audio.play('coin');
      }
    });
    this.events.on('nearmiss', () => {
      this.scoring.addNearMiss();
      this.audio.play('nearmiss');
    });
    this.events.on('powerup', (type) => {
      this.audio.play('powerup');
      if (type === 'multiplier') this.scoring.multiplier = 2;
    });
    this.events.on('powerupEnd', (type) => {
      if (type === 'multiplier') this.scoring.multiplier = 1;
    });
    this.events.on('hit', () => this.audio.play('hit'));
    // Crash from ObstacleManager: shield or scholar's glideboard absorbs one hit
    // (destroying the obstacle); otherwise the run ends.
    this.events.on('crash', (info = {}) => {
      if (this.state !== STATES.RUNNER) return;
      const idx = typeof info.index === 'number' ? info.index : -1;
      // Smartphone portal: blue-cyan distortion burst + dedicated SFX hook,
      // whether protection absorbs it or the run ends.
      if (info.kind === 'portal') {
        const lane = typeof info.lane === 'number' ? info.lane : 1;
        this._spawnShockwave(LANES[lane], 1.6, 0, 0x35e0ff, 2.6);
        this.audio.play('portal_collision'); // safe no-op until wired
        if (!this._reducedMotion) this.cameraCtl.shake(0.55);
        this._flashImpact('rgba(80,200,255,0.5)');
      }
      if (this.powerups.has('shield')) {
        this.powerups.consume('shield');
        if (idx >= 0) this.obstacles.destroyAt(idx);
        this.audio.play('hit');
        return;
      }
      if (this.powerups.has('glideboard')) {
        this.powerups.consume('glideboard');
        if (idx >= 0) this.obstacles.destroyAt(idx);
        this.audio.play('hit');
        return;
      }
      this.events.emit('gameover');
    });
    // Stumble from ObstacleManager: puddles keep the classic non-lethal
    // stumble; the pedestrian crowd routes through the richer feedback path.
    this.events.on('stumble', (info = {}) => {
      if (this.state !== STATES.RUNNER) return;
      if (info.type === 'pedestrian') {
        this._onPedestrianHit(info);
        return;
      }
      this.player.stumble();
      this.avatar.setAnim('stumble');
      this._stumbleT = 0.9;
    });
    this.events.on('gameover', () => this._gameOver());
    this.events.on('voucher', (store) => {
      this._runVouchers += 1;
      this.vouchers.recordSpawn(this.scoring.distanceM);
      this.wallet.addVoucher(store);
      this.audio.play('voucher');
      this._saveProgress(false);
    });
    this.events.on('mission', () => this.audio.play('voucher'));
    this.events.on('pause', () => this._doPause());
    this.events.on('resume', () => this._doResume());
    this.events.on('restart', () => this.restart());
    this.events.on('settings', (patch) => this._applySettings(patch));
    // Academy gate reveal: subtle camera tilt as the player passes under it.
    this.events.on('academy_gate_reveal', () => {
      if (!this._reducedMotion) this.cameraCtl.shake(0.15);
    });
  }

  // --- pedestrian crowd hit: rich feedback, protection absorb, or crash -----
  _onPedestrianHit(info = {}) {
    const lane = typeof info.lane === 'number' ? info.lane : 1;
    const x = LANES[lane];
    // Shield / glideboard absorb the hit: consume the protection, burst the
    // crowd apart visually, destroy nothing else — no stumble, no death.
    if (this.powerups.has('shield') || this.powerups.has('glideboard')) {
      if (this.powerups.has('shield')) this.powerups.consume('shield');
      else this.powerups.consume('glideboard');
      this._spawnShockwave(x, 1.0, 0, 0x9adcff, 1.8);
      this.audio.play('hit');
      return;
    }
    // Vulnerable window: barging into the crowd while already stumbling is
    // a crash (game over — no protection left to absorb it).
    if (this._stumbleT > 0) {
      this.events.emit('crash', { type: 'pedestrian', kind: 'pedestrian', lane });
      return;
    }
    // Rich non-lethal stumble: existing anim + SFX hook + restrained shake +
    // brief warm flash.
    this.player.stumble();
    this.avatar.setAnim('stumble');
    this._stumbleT = 0.9;
    this.audio.play('pedestrian_collision'); // safe no-op until audio workstream wires it
    if (!this._reducedMotion) this.cameraCtl.shake(0.35);
    this._flashImpact('rgba(255,240,220,0.55)');
  }

  // --- transient impact FX -------------------------------------------------
  // Expanding shockwave ring at a world position; stepped in _updateFx.
  _spawnShockwave(x, y, z, color = 0xffffff, maxR = 2) {
    if (!this.scene) return;
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.3, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    mesh.position.set(x, y, z);
    (this.runnerRoot || this.scene).add(mesh);
    this._fx.push({ mesh, t: 0, dur: 0.45, maxR });
  }

  _updateFx(dt) {
    for (let i = this._fx.length - 1; i >= 0; i--) {
      const fx = this._fx[i];
      fx.t += dt;
      const k = Math.min(fx.t / fx.dur, 1);
      const s = 0.4 + k * fx.maxR;
      fx.mesh.scale.set(s, s, s);
      fx.mesh.material.opacity = 0.9 * (1 - k);
      if (k >= 1) {
        if (fx.mesh.parent) fx.mesh.parent.remove(fx.mesh);
        fx.mesh.geometry.dispose();
        fx.mesh.material.dispose();
        this._fx.splice(i, 1);
      }
    }
  }

  // Brief fullscreen flash. Own minimal element (#impact-flash); no UI restyle.
  _flashImpact(color = 'rgba(255,255,255,0.45)') {
    if (this._reducedMotion) return;
    if (typeof document === 'undefined') return;
    let el = document.getElementById('impact-flash');
    if (!el) {
      el = document.createElement('div');
      el.id = 'impact-flash';
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;z-index:60;';
      document.body.appendChild(el);
    }
    el.style.transition = 'none';
    el.style.background = color;
    el.style.opacity = '1';
    void el.offsetWidth; // reflow so the fade below actually animates
    el.style.transition = 'opacity 0.28s ease-out';
    el.style.opacity = '0';
  }

  _applySettings(patch) {
    if (!patch || typeof patch !== 'object') return;
    const cur = this.save.load().settings;
    const next = {
      sound: typeof patch.sound === 'boolean' ? patch.sound : cur.sound,
      reducedMotion: typeof patch.reducedMotion === 'boolean' ? patch.reducedMotion : cur.reducedMotion,
      quality: patch.quality === 'low' || patch.quality === 'medium' || patch.quality === 'high' ? patch.quality : cur.quality,
    };
    this.save.save({ settings: next });
    this.audio.setEnabled(next.sound);
    this._reducedMotion = next.reducedMotion;
    if (this.library) this.library.reducedMotion = next.reducedMotion;
    if (this.pursuit) this.pursuit.setReducedMotion(next.reducedMotion);
    // GRAPHICS OVERHAUL: one call applies pixel ratio, shadow map, bloom,
    // and world scenery/shadow resolution for the tier.
    this.setQuality(next.quality);
  }

  // --- input ---------------------------------------------------------------

  _onAction(action) {
    if (action === 'pause') {
      this._togglePause();
      return;
    }
    if (this.state === STATES.LIBRARY) {
      // Any tap/click/key starts the scare
      this._startShaytan();
      return;
    }
    if (this.state !== STATES.RUNNER && this.state !== STATES.TUTORIAL) return;
    if (action === 'left') this.player.doLeft();
    else if (action === 'right') this.player.doRight();
    else if (action === 'jump') this.player.doJump();
    else if (action === 'slide') this.player.doSlide();
    // Tutorial step tracking
    if (this.state === STATES.TUTORIAL) this._onTutorialAction(action);
    // 'tap' is a no-op mid-run (HUD buttons handle their own touches)
  }

  _togglePause() {
    if (this.state === STATES.PAUSED) this._doResume();
    else this._doPause();
  }

  _doPause() {
    // Pause only from RUNNER or CHASE (guard makes re-entrant emits safe).
    // UI shows the pause screen itself via 'statechange'.
    if (this.state !== STATES.RUNNER && this.state !== STATES.CHASE) return;
    this._prevState = this.state;
    this.setState(STATES.PAUSED);
    this.audio.play('click');
  }

  _doResume() {
    if (this.state !== STATES.PAUSED) return;
    const prev = this._prevState || STATES.RUNNER;
    this._prevState = null;
    this.setState(prev);
    this.audio.play('click');
    this.events.emit('resume');
  }

  // --- scripted flow: library → shaytan → chase → runner --------------------

  async _startShaytan() {
    if (this.state !== STATES.LIBRARY) return;
    // Check if we should skip (player has seen it before and chose to skip)
    const data = this.save.load();
    if (data.hasSeenIntro && this._skipIntroRequested) {
      this._skipIntroRequested = false;
      this._beginRunner();
      return;
    }
    // Cinematic opening (Oct 14, 2026): narration-synced 8-state sequence.
    // Any key/click/tap during the cinematic skips to gameplay.
    this.setState(STATES.LIBRARY_INTRO);
    this.ui.hideAll();
    this._cinematicSignal = { aborted: false };
    this._armSkipListener();
    try {
      const intro = new CinematicIntro(this.library);
      await intro.play({
        modelLoader: this.modelLoader,
        audio: this.audio,
        subtitles: this.ui.subtitles,
        onState: (s) => { if (STATES[s]) this.setState(STATES[s]); },
        signal: this._cinematicSignal,
      });
    } catch (e) {
      console.error('[game] cinematic failed:', e);
    } finally {
      this._disarmSkipListener();
    }
    // If skipped, _beginRunner was already called by skipCinematic().
    if (this._cinematicSignal.aborted) return;
    // Mark intro as seen
    try {
      const d = this.save.load();
      d.hasSeenIntro = true;
      this.save.save(d);
    } catch {}
    // Cinematic done → start the runner
    this._beginRunner();
  }

  // Skip the running cinematic (any input during cinematic states).
  // Safe to call when no cinematic is running (no-op).
  skipCinematic() {
    if (!this._cinematicSignal || this._cinematicSignal.aborted) return;
    const cinematicStates = ['LIBRARY_INTRO', 'LIBRARY_SEARCH', 'SHAYTAN_REVEAL',
      'RECITATION', 'LIBRARY_ESCAPE', 'LIBRARY_EXIT', 'ACADEMY_GATE'];
    if (!cinematicStates.includes(this.state)) return;
    this._cinematicSignal.aborted = true;
    this._disarmSkipListener();
    // Stop intro audio/subtitles immediately
    try { this.audio?.stopNarration?.(); } catch {}
    try { this.ui?.subtitles?.stop?.(); } catch {}
    // Mark as seen (player chose to skip)
    try {
      const d = this.save.load();
      d.hasSeenIntro = true;
      this.save.save(d);
    } catch {}
    this._beginRunner();
  }

  // Arm the "any input skips" listener for the cinematic duration.
  _armSkipListener() {
    this._disarmSkipListener();
    // Delay arming by 800ms so the tap that started the game doesn't
    // instantly skip the cinematic.
    this._skipArmTimer = setTimeout(() => {
      const handler = (e) => {
        // Ignore the skip-hint button's own click (it calls skipCinematic directly)
        if (e.target?.closest?.('.skip-intro-hint')) return;
        this.skipCinematic();
      };
      this._skipHandler = handler;
      window.addEventListener('keydown', handler);
      window.addEventListener('pointerdown', handler);
    }, 800);
  }

  _disarmSkipListener() {
    if (this._skipArmTimer) { clearTimeout(this._skipArmTimer); this._skipArmTimer = null; }
    if (this._skipHandler) {
      window.removeEventListener('keydown', this._skipHandler);
      window.removeEventListener('pointerdown', this._skipHandler);
      this._skipHandler = null;
    }
  }

  // Called by the Skip Intro button (only shown after first viewing)
  skipIntro() {
    this._skipIntroRequested = true;
    this._startShaytan();
  }

  async _startChase() {
    // Legacy: superseded by the cinematic. Kept for compatibility.
    this.setState(STATES.CHASE);
    await this.library.playChase();
    // Pausing during CHASE freezes the library timeline, so we only auto-advance
    // when the chase actually completed while we were still in CHASE.
    if (this.state === STATES.CHASE) this._beginRunner();
  }

  _beginRunner() {
    this.scoring.resetRun();
    this.scoring.multiplier = 1;
    this.vouchers.reset();    this.player.reset();
    this.obstacles.reset();
    this.collectibles.reset();
    this.powerups.reset();
    this.world.reset();
    this.academyGate.reset?.();
    this.runnerRoot.visible = true;
    // Hide the library (cinematic set) — the runner has its own scene.
    if (this.library && this.library.group) {
      this.library.group.visible = false;
    }
    // Hide the title mascot (it lives in the library group, but be explicit)
    this._setMascotVisible(false);
    this._runnerActive = true;
    this.avatar.reset();
    this.avatar.group.position.set(0, 0, 0);
    this.avatar.group.rotation.set(0, 0, 0);
    this.avatar.setAnim('run');
    this._stumbleT = 0;
    this._runVouchers = 0;
    this._mCoins = 0;
    this._mNear = 0;
    this._mVouchers = 0;
    this._clearFx();
    if (this.effects) this.effects.reset();
    // First-time tutorial: enter guided mode instead of free run.
    const data = this.save.load();
    const settings = data.settings || {};
    const wantTutorial = data.tutorialPreference === 'with' || settings.tutorialNext;
    if (!this._partyRaceStarting && wantTutorial && !this._tutorialDone) {
      // Clear the one-shot setting flag
      if (settings.tutorialNext) {
        try {
          settings.tutorialNext = false;
          this.save.save({ settings });
        } catch {}
      }
      this._startTutorial();
      return;
    }
    this.setState(STATES.RUNNER); // UI shows HUD via 'statechange'
    this.audio.play('start');
    if (this.pursuit) this.pursuit.start();
  }

  // Dispose any lingering impact rings (fresh run = clean slate).
  _clearFx() {
    for (const fx of this._fx) {
      if (fx.mesh.parent) fx.mesh.parent.remove(fx.mesh);
      fx.mesh.geometry.dispose();
      fx.mesh.material.dispose();
    }
    this._fx = [];
  }

  // --- game over ------------------------------------------------------------

  _gameOver() {
    if (this.state !== STATES.RUNNER) return;
    this.setState(STATES.GAMEOVER);
    if (this.pursuit) this.pursuit.reset();
    this.avatar.setAnim('fall');
    this.audio.play('gameover');
    if (!this._reducedMotion) this.cameraCtl.shake(0.7);
    this.scoring.commitBest();
    this._saveProgress(true);
    this.ui.show('gameover', {
      score: Math.floor(this.scoring.score),
      best: Math.floor(this.scoring.best),
      coins: Math.floor(this._bankedCoins),
      runCoins: this.scoring.coins,
      distanceM: Math.floor(this.scoring.distanceM),
      nearMisses: this.scoring.nearMisses,
    });
  }

  _saveProgress(bankRunCoins) {
    const data = this.save.load();
    if (bankRunCoins) {
      this._bankedCoins += this.scoring.coins;
      this.scoring.coins = 0;
    }
    this.save.save({
      highscore: Math.floor(this.scoring.best),
      bestDistance: Math.floor(Math.max(data.bestDistance || 0, this.scoring.distanceM)),
      coins: this._bankedCoins,
      wallet: this.wallet.serialize(),
      missions: this.missions.serialize(),
      inventory: this.inventory.serialize(),
      vouchers: { lastSpawnM: this.vouchers.lastSpawnM },
    });
  }

  // --- simulation ------------------------------------------------------------

  _speed() {
    // +25% base (8 -> 10), cap 24 -> 28, linear ramp slightly steepened
    // (0.012 -> 0.0125). Cap reached at ~1440 m (was ~1333 m).
    return Math.min(10 + this.scoring.distanceM * 0.0125, MAX_SPEED);
  }

  update(dt) {
    // Mascot idle life (title screen only): gentle bob + sway. The GLB is
    // static, so this is a group transform — no fake skeletal motion.
    if (this._mascot && this._mascotVisible && this.state === STATES.LIBRARY) {
      const t = performance.now() / 1000;
      this._mascot.position.y = this._mascotBaseY + Math.sin(t * 1.8) * 0.05;
      this._mascot.rotation.z = Math.sin(t * 1.2) * 0.03;
    }
    switch (this.state) {
      case STATES.LIBRARY:
      case STATES.SHAYTAN:
        this.library.update(dt);
        this.cameraCtl.update(dt, 0, 'library');
        this.avatar.update(dt);
        break;
      case STATES.LIBRARY_INTRO:
      case STATES.LIBRARY_SEARCH:
      case STATES.SHAYTAN_REVEAL:
      case STATES.RECITATION:
      case STATES.LIBRARY_ESCAPE:
      case STATES.LIBRARY_EXIT:
      case STATES.ACADEMY_GATE:
        this.library.update(dt);
        this.cameraCtl.update(dt, 0, 'cinematic');
        this.avatar.update(dt);
        break;
      case STATES.CHASE:
        this.library.update(dt);
        this.cameraCtl.update(dt, this.player.x, 'chase');
        this.avatar.update(dt);
        break;
      case STATES.RUNNER:
      case STATES.RUNNING:
      case STATES.TUTORIAL:
        this._updateRunner(dt);
        if (this.state === STATES.TUTORIAL) this._updateTutorial(dt);
        break;
      case STATES.PAUSED:
        // render only — sim frozen
        break;
      case STATES.GAMEOVER:
        // slow-mo tableau, no sim
        this.cameraCtl.update(dt, this.player.x, 'runner');
        this.avatar.update(dt * 0.25);
        this._updateFx(dt); // let impact rings finish their animation
        // let pooled FX bursts finish gracefully (no new ambient spawns)
        if (this.effects) {
          this.effects.update(dt, {
            x: this.player.x, y: this.player.y,
            speed: 0, speedN: 0, glide: false, jet: false, running: false,
          });
        }
        break;
      case STATES.LOADING:
      default:
        break;
    }
  }

  _updateRunner(dt) {
    const speed = this._speed();

    // input → player → powerups → world → landmarks → obstacles →
    // collectibles → scoring → voucher check → missions → hud → camera → avatar
    this.player.update(dt, speed);
    this.powerups.update(dt, speed, this.scoring.distanceM, this.player, this.avatar);
    this.world.update(dt, speed, this.scoring.distanceM, this._quality);
    this.landmarks.update(dt, speed, this.scoring.distanceM);
    this.academyGate.update(dt, this.scoring.distanceM);

    const box = this.player.getBox();
    const mods = {
      shield: this.powerups.has('shield'),
      jetpack: this.player.flyY > 2,
      sliding: this.player.sliding,
    };
    this.obstacles.update(dt, speed, this.scoring.distanceM, box, this.player.laneIndex, mods);
    if (this.state !== STATES.RUNNER) return; // obstacle crash ended the run

    // dev collision overlay
    if (this.collisionDebug) {
      this.collisionDebug.update(this.player.getBox(), this.obstacles.debugBoxes());
    }

    this.collectibles.spawnPatterns(this.scoring.distanceM);
    this.collectibles.update(dt, speed, box, {
      magnet: this.powerups.has('magnet'),
      jetpack: this.player.flyY > 2,
    });
    this.scoring.addDistance(speed * dt);

    const freeLanes = typeof this.obstacles.getFreeLanes === 'function'
      ? this.obstacles.getFreeLanes()
      : [0, 1, 2];

    // Voucher spawn: unlock rule lives in VoucherManager (500 m).
    // recordSpawn at spawn time enforces the 120 m minimum interval.
    if (this.vouchers.shouldSpawn(this.scoring.distanceM)) {
      const lane = freeLanes.length > 0
        ? freeLanes[Math.floor(Math.random() * freeLanes.length)]
        : 1;
      this.collectibles.spawnVoucher(lane);
      this.vouchers.recordSpawn(this.scoring.distanceM);
    }

    this.powerups.trySpawn(this.scoring.distanceM, freeLanes);

    // Missions.update takes DELTAS for coins/nearMisses/vouchers (absolute run
    // distance for run500). Track last-seen values per run.
    if (typeof this.missions.update === 'function') {
      const stats = {
        distanceM: this.scoring.distanceM,
        coins: this.scoring.coins - this._mCoins,
        nearMisses: this.scoring.nearMisses - this._mNear,
        vouchers: this._runVouchers - this._mVouchers,
      };
      this._mCoins = this.scoring.coins;
      this._mNear = this.scoring.nearMisses;
      this._mVouchers = this._runVouchers;
      this.missions.update(stats);
    }

    // Stumble anim recovery
    if (this._stumbleT > 0) {
      this._stumbleT -= dt;
      if (this._stumbleT <= 0 && this.state === STATES.RUNNER) {
        this.avatar.setAnim(this.player.jumping ? 'jump' : this.player.sliding ? 'slide' : 'run');
      }
    }

    this.ui.hud.update({
      score: Math.floor(this.scoring.score),
      distanceM: Math.floor(this.scoring.distanceM),
      coins: this.scoring.coins,
      multiplier: this.scoring.multiplier,
      powerups: this.powerups.active,
      activePowerups: this.powerups.active,
      voucherUnlocked: this.scoring.distanceM >= VOUCHER_UNLOCK_M,
      canSpawn: this.vouchers.canSpawn(this.scoring.distanceM),
      speed,
    });

    // Street pursuit (S5): playerZ is 0 in RUNNER (the world scrolls past the
    // hero). Placed before the camera update so the apparition tracks smoothly.
    if (this.pursuit) this.pursuit.update(dt, 0, speed);
    this.cameraCtl.update(dt, this.player.x, 'runner', speed);
    this.avatar.update(dt);
    // Audio workstream (A4): jetpack thrust loop follows player.flyY.
    // (Footstep emission skipped here on purpose: PlayerController already
    // emits 'footstep' each grounded stride and AudioManager throttles it —
    // a second emitter would be redundant.)
    try { this.audio.update(dt, this.player ? this.player.flyY : 0); } catch { /* noop */ }
    // Pooled FX step: player state for event placement + continuous states
    // (glideboard trail, jetpack thrust, speed lines). Event bursts (dust,
    // sparkles, streaks, swirls) are triggered by the event bus in _bind.
    if (this.effects) {
      this.effects.reducedMotion = this._reducedMotion;
      this.effects.update(dt, {
        x: this.player.x,
        y: this.player.y + this.player.flyY,
        speed,
        speedN: speed / MAX_SPEED,
        glide: this.powerups.has('glideboard'),
        jet: this.player.flyY > 2,
        running: true,
      });
    }
    this._updateFx(dt);
  }
}
