export class SpawnDebugOverlay {
  constructor() {
    this.root = document.createElement('div');
    this.root.setAttribute('aria-label', 'Race spawn debug information');
    Object.assign(this.root.style, {
      position: 'fixed', right: '10px', top: '10px', zIndex: '10000',
      padding: '8px 10px', border: '1px solid #fbd000', borderRadius: '8px',
      background: 'rgba(8, 15, 35, .92)', color: '#fff',
      font: '12px/1.5 monospace', pointerEvents: 'none', whiteSpace: 'pre',
    });
    document.body.appendChild(this.root);
  }

  update({ seed, round, distance, hash, events }) {
    this.root.textContent = `DEBUG RACE\nseed: ${seed ?? '—'}\nround: ${round ?? '—'}\ndistance: ${Number(distance || 0).toFixed(1)} m\nspawn hash: ${hash} (${events})`;
  }
}
