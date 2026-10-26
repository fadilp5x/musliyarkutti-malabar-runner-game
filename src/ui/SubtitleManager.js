// SubtitleManager — displays SRT subtitles synced to the narration audio.
// The SRT file (public/subtitles/intro.srt) contains EXACT text and timecodes
// supplied by fari. This manager preserves them verbatim — it never
// paraphrases, regenerates, or shifts timings.

export class SubtitleManager {
  constructor() {
    this.cues = []; // {start, end, text}
    this.enabled = true;
    this._active = false;
    this._startTime = 0; // performance.now() when narration started
    this._currentIdx = -1;
    this._el = null;
    this._raf = 0;
    this._loadPromise = null;
  }

  // Parse SRT timecode "00:00:04,500" → seconds
  static _parseTime(tc) {
    const m = tc.match(/(\d+):(\d+):(\d+),(\d+)/);
    if (!m) return 0;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
  }

  // Load and parse the SRT file. Called once at boot.
  async load(url = 'subtitles/intro.srt') {
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = (async () => {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const text = await r.text();
        this.cues = this._parse(text);
      } catch (e) {
        console.warn('[subtitles] failed to load SRT:', e);
        this.cues = [];
      }
    })();
    return this._loadPromise;
  }

  _parse(srt) {
    const cues = [];
    // Split on blank lines; each block is: index, timecode, text...
    const blocks = srt.trim().split(/\r?\n\r?\n/);
    for (const b of blocks) {
      const lines = b.split(/\r?\n/);
      if (lines.length < 3) continue;
      const tc = lines[1].match(/(.+) --> (.+)/);
      if (!tc) continue;
      cues.push({
        start: SubtitleManager._parseTime(tc[1].trim()),
        end: SubtitleManager._parseTime(tc[2].trim()),
        text: lines.slice(2).join('\n').trim(),
      });
    }
    cues.sort((a, b) => a.start - b.start);
    return cues;
  }

  // Create the DOM element (called by UI on init)
  mount(parent) {
    if (this._el) return;
    const el = document.createElement('div');
    el.className = 'subtitle-display hidden';
    el.setAttribute('aria-live', 'polite');
    parent.appendChild(el);
    this._el = el;
  }

  // Start displaying subtitles synced to narration start (performance.now())
  start(narrationStartPerf = performance.now()) {
    if (!this.enabled || !this.cues.length) return;
    this._active = true;
    this._startTime = narrationStartPerf;
    this._currentIdx = -1;
    if (this._el) this._el.classList.remove('hidden');
    this._tick();
  }

  _tick() {
    if (!this._active) return;
    const t = (performance.now() - this._startTime) / 1000;
    // Find the cue active at time t
    let idx = -1;
    for (let i = 0; i < this.cues.length; i++) {
      if (t >= this.cues[i].start && t <= this.cues[i].end) {
        idx = i;
        break;
      }
    }
    if (idx !== this._currentIdx) {
      this._currentIdx = idx;
      if (this._el) {
        if (idx >= 0) {
          this._el.textContent = this.cues[idx].text;
          this._el.classList.remove('hidden');
          this._el.classList.add('visible');
        } else {
          this._el.classList.remove('visible');
          // Keep element for fade-out, hide after transition
          setTimeout(() => {
            if (this._currentIdx === -1 && this._el) this._el.classList.add('hidden');
          }, 400);
        }
      }
    }
    // Stop after the last cue ends (+1s buffer)
    const last = this.cues[this.cues.length - 1];
    if (last && t > last.end + 1) {
      this.stop();
      return;
    }
    this._raf = requestAnimationFrame(() => this._tick());
  }

  stop() {
    this._active = false;
    this._currentIdx = -1;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this._el) {
      this._el.classList.remove('visible');
      this._el.classList.add('hidden');
      this._el.textContent = '';
    }
  }

  setEnabled(v) {
    this.enabled = !!v;
    if (!this.enabled) this.stop();
  }
}
