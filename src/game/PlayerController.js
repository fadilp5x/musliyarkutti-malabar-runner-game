// ---------------------------------------------------------------------------
// PlayerController — lane movement, jump physics, slide, locomotion anim
// selection for MUSLIYARKUTTI: MALABAR RUNNER.
// Owns: laneIndex/x, jump physics (vy0 = 8.2, g = -24), slide timer,
// flyY (set externally by PowerUpManager), board flag (glideboard).
// Avatar + events are injected (no imports of other workstream modules).
// Emits: 'jump', 'land', 'slide' (existing), plus 'footstep' (each stride
// while running grounded — stride frequency scales with speed), 'left' /
// 'right' (lane changes, with {lane, dir}). The audio workstream maps these
// to SFX; see PATCHES.md for the expected event->sfx mapping.
// Note: update() syncs avatar.group.position but does NOT call
// avatar.update(dt) — the engine calls that once per frame.
// ---------------------------------------------------------------------------

export const LANES = [-2.4, 0, 2.4];

const JUMP_VY = 8.2;
const GRAVITY = -24;
const LANE_LERP_RATE = 12; // per second
// Slide duration shortened 0.75 -> 0.62 (speed workstream, Oct 2026):
// at the new 28 m/s cap a 0.75 s slide travels 21 m, longer than the
// minimum row gap, so a jump-required row right after a slide row would be
// unreactable (slide locks out jump). 0.62 s = 17.4 m at cap speed, which
// fits inside the minimum gap with margin.
const SLIDE_TIME = 0.62;
const TURN_TIME = 0.25;
const STUMBLE_TIME = 0.35;
// Base stride angular frequency of the run cycle (rad/s) at SPEED_REF m/s.
// Actual stride frequency scales linearly with speed so footfalls match
// ground speed: freq = STRIDE_BASE * (speed / SPEED_REF).
const STRIDE_BASE = 14;
const SPEED_REF = 8;

export class PlayerController {
  constructor(avatar, events) {
    this.avatar = avatar;
    this.events = events;
    this.reset();
  }

  reset() {
    this.laneIndex = 1;
    this.x = 0;
    this.y = 0;
    this.vy = 0;
    this.jumping = false;
    this.sliding = false;
    this.slideT = 0;
    this.flyY = 0;
    this.board = false;
    this.turnT = 0;
    this.stumbleT = 0;
    this._stridePhase = 0; // run-cycle phase; drives avatar legs + footstep events
    this.avatar.reset();
    this.avatar.runRate = 1;
    this.avatar.runPhase = 0;
  }

  _locomotion() {
    if (this.flyY > 0.5) return 'jetpack';
    if (this.board) return 'glide';
    if (this.jumping) return 'jump';
    if (this.sliding) return 'slide';
    return 'run';
  }

  _applyLocomotion() {
    this.avatar.setAnim(this._locomotion());
  }

  doLeft() {
    if (this.laneIndex <= 0) return;
    this.laneIndex -= 1;
    this.turnT = TURN_TIME;
    this.avatar.setAnim('left');
    this.events.emit('left', { lane: this.laneIndex, dir: -1 });
  }

  doRight() {
    if (this.laneIndex >= LANES.length - 1) return;
    this.laneIndex += 1;
    this.turnT = TURN_TIME;
    this.avatar.setAnim('right');
    this.events.emit('right', { lane: this.laneIndex, dir: 1 });
  }

  doJump() {
    if (this.sliding) return; // no jump while sliding
    if (this.jumping || this.y > 0) return; // must be grounded
    this.jumping = true;
    this.vy = JUMP_VY;
    this.turnT = 0;
    this.stumbleT = 0;
    this.avatar.setAnim('jump');
    this.events.emit('jump');
  }

  doSlide() {
    if (this.jumping) this.vy = -18; // fast-fall while airborne
    this.sliding = true;
    this.slideT = SLIDE_TIME;
    this.turnT = 0;
    this.stumbleT = 0;
    this.avatar.setAnim('slide');
    this.events.emit('slide');
  }

  // Brief non-lethal stagger (puddle / pedestrian crowd). NOTE: this method
  // does NOT emit 'stumble' — the collision source (ObstacleManager) emits the
  // event, and Game's handler calls this method as the response. Emitting here
  // would recurse: handler -> stumble() -> emit -> handler -> ...
  stumble() {
    this.stumbleT = STUMBLE_TIME;
    this.turnT = 0;
    this.avatar.setAnim('stumble');
  }

  update(dt, speed) {
    // lane x lerp (rate 12/s); lane change during slide keeps sliding
    const targetX = LANES[this.laneIndex];
    const k = 1 - Math.exp(-LANE_LERP_RATE * dt);
    this.x += (targetX - this.x) * k;

    // jump physics
    if (this.jumping) {
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.jumping = false;
        this.events.emit('land');
        this._applyLocomotion();
      }
    }

    // slide timer
    if (this.sliding) {
      this.slideT -= dt;
      if (this.slideT <= 0) {
        this.sliding = false;
        this.slideT = 0;
        this._applyLocomotion();
      }
    }

    // brief turn flourish, then back to locomotion
    if (this.turnT > 0) {
      this.turnT -= dt;
      if (this.turnT <= 0) {
        this.turnT = 0;
        this._applyLocomotion();
      }
    }

    // stumble flourish, then back to locomotion
    if (this.stumbleT > 0) {
      this.stumbleT -= dt;
      if (this.stumbleT <= 0) {
        this.stumbleT = 0;
        this._applyLocomotion();
      }
    }

    // stride phase: single source of truth for the run cycle. The avatar
    // reads avatar.runPhase so leg swing matches ground speed exactly, and
    // every half-cycle (one footfall) emits 'footstep' while running on the
    // ground. Grounded-run only: no footsteps mid-air, sliding, flying, or
    // gliding on the board.
    const rate = Math.max(0.25, speed / SPEED_REF);
    const prevStep = Math.floor(this._stridePhase / Math.PI);
    this._stridePhase += dt * STRIDE_BASE * rate;
    if (Math.floor(this._stridePhase / Math.PI) !== prevStep) {
      if (!this.jumping && !this.sliding && this.flyY <= 0.5 && !this.board && this.y <= 0) {
        this.events.emit('footstep', { x: this.x, y: this.y });
      }
    }
    this.avatar.runRate = rate;
    this.avatar.runPhase = this._stridePhase;

    // sync avatar transform (controller owns position; avatar owns pose)
    const g = this.avatar.group;
    g.position.set(this.x, this.y + this.flyY + (this.avatar.groupOffsetY || 0), 0);
  }

  getBox() {
    const y0 = this.y + this.flyY;
    return {
      x0: this.x - 0.35,
      x1: this.x + 0.35,
      y0,
      y1: y0 + (this.sliding ? 0.85 : 1.7),
      z0: -0.3,
      z1: 0.3,
    };
  }
}

export default PlayerController;
