// CinematicIntro — narration-synced library opening for MUSLIYARKUTTI.
// Plays fari's supplied narration (public/audio/intro-narration.mp3, ~16.7s)
// as the master track. Visual beats and the exact SRT subtitles sync to the
// narration start time. The recitation (audhu-billahi.mp3) plays once at the
// Shaytan reveal, ducked under the narration for intelligibility.
//
// Abort: Game.js passes an AbortSignal-like {aborted:false}. All waits and
// movements check it and bail out cleanly so skipCinematic() can jump to
// gameplay without leaving timers or audio running.

import * as THREE from 'three';

export class CinematicIntro {
  constructor(library) {
    this.lib = library; // LibraryScene
    this._shaytanObj = null;
    this._cinEyes = [];
  }

  // Play the full intro. Resolves when done OR when signal.aborted becomes true.
  // onState(s) notifies Game.js of state changes for the state machine.
  async play({ modelLoader, audio, subtitles, onState, signal }) {
    const lib = this.lib;
    const setState = (s) => { try { onState && onState(s); } catch {} };
    const cam = lib._camera;
    const avatar = lib.avatar;
    if (!cam || !avatar) return;
    const now = () => performance.now() / 1000;
    const aborted = () => signal && signal.aborted;

    // --- helpers (all abort-aware) ---
    const wait = (s) => new Promise((res, rej) => {
      if (aborted()) return rej(new Error('ABORTED'));
      const t = setTimeout(() => res(), s * 1000);
      // Poll for abort during long waits
      const poll = setInterval(() => {
        if (aborted()) { clearTimeout(t); clearInterval(poll); rej(new Error('ABORTED')); }
      }, 100);
      // Clear poll when done
      setTimeout(() => clearInterval(poll), s * 1000 + 50);
    });

    const moveCam = (to, dur) => new Promise((res, rej) => {
      if (aborted()) return rej(new Error('ABORTED'));
      const from = cam.position.clone();
      const t0 = now();
      const tick = () => {
        if (aborted()) return rej(new Error('ABORTED'));
        const k = Math.min(1, (now() - t0) / dur);
        const e = k * k * (3 - 2 * k);
        cam.position.lerpVectors(from, to, e);
        if (k < 1) setTimeout(tick, 50);
        else res();
      };
      tick();
    });

    const moveAvatar = (to, dur, anim = 'run') => new Promise((res, rej) => {
      if (aborted()) return rej(new Error('ABORTED'));
      const from = avatar.group.position.clone();
      avatar.setAnim(anim);
      const t0 = now();
      const tick = () => {
        if (aborted()) return rej(new Error('ABORTED'));
        const k = Math.min(1, (now() - t0) / dur);
        avatar.group.position.lerpVectors(from, to, k);
        if (k < 1) setTimeout(tick, 50);
        else res();
      };
      tick();
    });

    const sfx = (n) => { try { lib._sfx(n); } catch {} };

    try {
      // ── 0.0s: Narration starts, subtitle 1. Avatar searching. ──
      setState('LIBRARY_INTRO');
      sfx('library_ambience');
      cam.position.set(0, 3.0, 10);
      avatar.group.position.set(0, 0, 3.5);
      avatar.group.rotation.set(0, 0.3, 0);

      // Start narration and subtitles together
      let narrStart = performance.now();
      if (audio) {
        const r = await audio.playNarration();
        if (r) narrStart = performance.now(); // sync to actual start
      }
      if (subtitles) subtitles.start(narrStart);

      // Search: walk down the aisle toward the right shelf
      await Promise.all([
        moveCam(new THREE.Vector3(0, 2.4, 7), 4.0),
        moveAvatar(new THREE.Vector3(1.5, 0, 1.5), 4.0, 'run'),
      ]);

      // Reach for a book, examine it
      setState('LIBRARY_SEARCH');
      avatar.setAnim('idle');
      avatar.group.rotation.set(0, -Math.PI / 2, 0);
      sfx('library_page_turn');
      avatar.setAnim('collect');
      await wait(1.2);
      avatar.setAnim('idle');

      // ── ~5.5s: "Suddenly..." — lights dim, rumble ──
      setState('SHAYTAN_REVEAL');
      lib._lightTarget.warm = 18;
      lib._flicker = true;
      sfx('shaytan_distant_roar');
      avatar.setAnim('react');
      avatar.group.rotation.set(0, Math.PI * 0.75, 0);
      await wait(1.5);

      // ── ~7s: Shaytan appears (reaper GLB) ──
      try {
        const handle = await modelLoader.loadModel('shaytan_reaper');
        const obj = handle?.object3D;
        if (obj && !aborted()) {
          obj.position.set(0, 0, 5.5);
          obj.rotation.y = Math.PI;
          obj.visible = false;
          lib.group.add(obj);
          this._shaytanObj = obj;
          lib._cinShaytan = obj;
          for (const sx of [-0.18, 0.18]) {
            const eye = new THREE.Sprite(new THREE.SpriteMaterial({
              map: lib._smokeTex, color: 0xff3300, transparent: true, opacity: 0,
              blending: THREE.AdditiveBlending, depthWrite: false,
            }));
            eye.position.set(sx, 1.55, 0.25);
            eye.scale.set(0.3, 0.3, 1);
            obj.add(eye);
            this._cinEyes.push(eye);
          }
        }
      } catch (e) {
        console.warn('[cinematic] shaytan GLB failed:', e);
      }

      // Eyes first, then form
      for (const eye of this._cinEyes) eye.material.opacity = 0.95;
      sfx('shaytan_reveal_roar');
      await wait(1.0);
      if (this._shaytanObj && !aborted()) {
        this._shaytanObj.visible = true;
        lib._spawnSmoke(12, 0, 0.5, 5.5);
      }

      // Three aggressive steps forward
      if (this._shaytanObj) {
        for (let i = 0; i < 3 && !aborted(); i++) {
          const z0 = this._shaytanObj.position.z;
          await new Promise((res, rej) => {
            const t0 = now();
            const tick = () => {
              if (aborted()) return rej(new Error('ABORTED'));
              const k = Math.min(1, (now() - t0) / 0.6);
              this._shaytanObj.position.z = z0 - k * 0.55;
              this._shaytanObj.position.y = Math.abs(Math.sin(k * Math.PI * 2)) * 0.08;
              if (k < 1) setTimeout(tick, 50);
              else res();
            };
            tick();
          });
          sfx('footsteps_running');
        }
      }

      // ── ~10.5s: Recitation (subtitle 4). Duck narration for clarity. ──
      setState('RECITATION');
      avatar.group.rotation.set(0, 0, 0);
      avatar.setAnim('react');
      if (audio) {
        audio.duckForRecitation();
        audio.duckNarrationForRecitation(true);
        await audio.playRecitation();
        // Restore narration after the 3.2s recitation
        setTimeout(() => {
          try { audio.duckNarrationForRecitation(false); } catch {}
        }, 3400);
      }
      await wait(3.6);
      // Shaytan recoils from the recitation
      if (this._shaytanObj) {
        this._shaytanObj.position.z += 0.8;
        for (const eye of this._cinEyes) eye.material.opacity = 0.3;
      }

      // ── ~15s: Escape! (subtitle 5) ──
      setState('LIBRARY_ESCAPE');
      lib._flicker = false;
      lib._lightTarget.warm = 40;
      avatar.group.rotation.set(0, Math.PI, 0);
      sfx('footsteps_running');
      sfx('library_escape_whoosh');
      // Rush: Shaytan surges as the avatar flees
      lib.events.emit('shake', 0.5);
      sfx('shaytan_surge');

      const escAvatar = moveAvatar(new THREE.Vector3(0, 0, -5.8), 3.0, 'run');
      let shChase = Promise.resolve();
      if (this._shaytanObj) {
        const shZ0 = this._shaytanObj.position.z;
        shChase = new Promise((res, rej) => {
          const t0 = now();
          const tick = () => {
            if (aborted()) return rej(new Error('ABORTED'));
            const k = Math.min(1, (now() - t0) / 3.0);
            this._shaytanObj.position.z = shZ0 - k * 4.2;
            this._shaytanObj.position.x = Math.sin(k * 10) * 0.3;
            if (k < 1) setTimeout(tick, 50);
            else res();
          };
          tick();
        });
      }
      await Promise.all([escAvatar, shChase]);

      // ── Through the doorway into the courtyard ──
      setState('LIBRARY_EXIT');
      if (lib._sunLight) {
        const sunT0 = now();
        const sunTick = () => {
          if (aborted()) return;
          const k = Math.min(1, (now() - sunT0) / 2.5);
          lib._sunLight.intensity = 0.4 + k * 2.6;
          if (k < 1) setTimeout(sunTick, 100);
        };
        sunTick();
      }
      await moveAvatar(new THREE.Vector3(0, 0, -12), 2.2, 'run');
      await moveCam(new THREE.Vector3(0, 2.6, -4), 1.8);

      // ── Academy gate ──
      setState('ACADEMY_GATE');
      sfx('academy_gate_reveal');
      await moveAvatar(new THREE.Vector3(0, 0, -22), 2.8, 'run');
      await moveCam(new THREE.Vector3(0, 3.0, -14), 2.2);
      await wait(0.8);

      // Clean up
      if (this._shaytanObj) this._shaytanObj.visible = false;
      if (subtitles) subtitles.stop();
      if (audio) { try { audio.stopNarration(); } catch {} }
    } catch (e) {
      if (e && e.message === 'ABORTED') {
        // Skip requested: clean up quietly, Game.js will start the runner.
        if (this._shaytanObj) this._shaytanObj.visible = false;
        if (subtitles) subtitles.stop();
        if (audio) { try { audio.stopNarration(); } catch {} }
        return;
      }
      throw e;
    }
    // Done — Game.js starts the runner
  }
}
