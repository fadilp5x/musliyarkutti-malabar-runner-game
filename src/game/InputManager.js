// InputManager — keyboard, tap, and swipe input mapped to game actions.
// Actions: left | right | jump | slide | pause | tap

const SWIPE_PX = 30;

export class InputManager {
  constructor(onAction) {
    this.onAction = onAction;
    this._startX = 0;
    this._startY = 0;
    this._tracking = false;

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      let action = null;
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
          action = 'left';
          break;
        case 'ArrowRight':
        case 'KeyD':
          action = 'right';
          break;
        case 'ArrowUp':
        case 'KeyW':
        case 'Space':
          action = 'jump';
          break;
        case 'ArrowDown':
        case 'KeyS':
          action = 'slide';
          break;
        case 'Escape':
          action = 'pause';
          break;
        default:
          return;
      }
      if (action !== 'pause') e.preventDefault();
      this._emit(action);
    };

    this._onPointerDown = (e) => {
      this._tracking = true;
      this._startX = e.clientX;
      this._startY = e.clientY;
    };

    this._onPointerUp = (e) => {
      if (!this._tracking) return;
      this._tracking = false;
      const dx = e.clientX - this._startX;
      const dy = e.clientY - this._startY;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      if (Math.max(adx, ady) < SWIPE_PX) {
        this._emit('tap');
        return;
      }
      if (adx > ady) {
        this._emit(dx > 0 ? 'right' : 'left');
      } else {
        this._emit(dy < 0 ? 'jump' : 'slide');
      }
    };

    this._onPointerCancel = () => {
      this._tracking = false;
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerCancel);
  }

  _emit(action) {
    try {
      this.onAction(action);
    } catch (err) {
      console.error('[input] action handler failed:', err);
    }
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerCancel);
  }
}
