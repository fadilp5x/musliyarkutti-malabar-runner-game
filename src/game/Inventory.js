// Inventory.js — PURE (no three, no DOM).
// Glide-board shop inventory: owned boards, selected board, buy/select.
// buy() does NOT deduct coins — the caller (engine/UI) deducts on true.

export const BOARDS = [
  { id: 'palm', name: 'Palm Board', cost: 0 },
  { id: 'gold', name: 'Gold Board', cost: 500 },
  { id: 'cyan', name: 'Cyan Board', cost: 1500 },
];

export class Inventory {
  constructor() {
    this.owned = ['palm'];
    this.selected = 'palm';
  }

  /** Attempt to buy a board. Returns true on success (caller deducts cost). */
  buy(id, coinBalance) {
    const board = BOARDS.find((b) => b.id === id);
    if (!board) return false;
    if (this.owned.includes(id)) return false;
    if (typeof coinBalance !== 'number' || coinBalance < board.cost) return false;
    this.owned.push(id);
    return true;
  }

  /** Select a board. Only owned boards can be selected. Returns true on success. */
  select(id) {
    if (!this.owned.includes(id)) return false;
    this.selected = id;
    return true;
  }

  getBoard(id) {
    return BOARDS.find((b) => b.id === id) || null;
  }

  serialize() {
    return { owned: [...this.owned], selected: this.selected };
  }

  /** Validated load: corrupt data -> default inventory, never throws. */
  load(data) {
    this.owned = ['palm'];
    this.selected = 'palm';
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.owned)) {
      const clean = data.owned.filter(
        (id) => typeof id === 'string' && BOARDS.some((b) => b.id === id)
      );
      if (clean.length > 0) {
        this.owned = [...new Set(['palm', ...clean])];
      }
    }
    if (typeof data.selected === 'string' && this.owned.includes(data.selected)) {
      this.selected = data.selected;
    }
  }

  reset() {
    this.owned = ['palm'];
    this.selected = 'palm';
  }
}
