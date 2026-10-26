// VoucherWallet.js — PURE (no three, no DOM). Unit-tested in node.
// Holds collected voucher cards and issues one-time DEMO redemption codes.
// Redemption UI must label codes: "DEMO VOUCHER — NOT VALID FOR REAL-WORLD PURCHASES".

const STORE_TYPES = {
  'Juicify Kuttikkattur': 'Food & Beverage',
  'Turkish Corner': 'Food & Beverage',
  'Hey Laban Store': 'Grocery',
  'Family Collections': 'Fashion',
  'Edumart': 'Education',
  'MyG Store': 'Electronics',
};

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function makeCode() {
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  }
  return 'MMR-DEMO-' + s;
}

function validItem(it) {
  return (
    it && typeof it === 'object' &&
    typeof it.id === 'string' &&
    typeof it.store === 'string' &&
    typeof it.type === 'string' &&
    (it.status === 'available' || it.status === 'redeemed') &&
    (it.code === null || typeof it.code === 'string') &&
    typeof it.collectedAt === 'number'
  );
}

export class VoucherWallet {
  constructor() {
    this.items = []; // {id, store, type, status, collectedAt, code}
    this._seq = 0;
  }

  /** Add a collected voucher card for a store. Returns the created item. */
  addVoucher(store) {
    const item = {
      id: 'v' + Date.now().toString(36) + '_' + (this._seq++),
      store,
      type: STORE_TYPES[store] || 'General',
      status: 'available',
      collectedAt: Date.now(),
      code: null,
    };
    this.items.push(item);
    return { ...item };
  }

  /** Copy of all items (available + redeemed). */
  list() {
    return this.items.map((it) => ({ ...it }));
  }

  /**
   * Redeem a voucher -> redemption code. The code is generated once and
   * stored on the item; it is never regenerated.
   * Throws Error('already redeemed') on reuse.
   */
  redeem(id) {
    const item = this.items.find((it) => it.id === id);
    if (!item) throw new Error('voucher not found');
    if (item.status === 'redeemed') throw new Error('already redeemed');
    if (!item.code) item.code = makeCode();
    item.status = 'redeemed';
    return item.code;
  }

  serialize() {
    return { items: this.items.map((it) => ({ ...it })) };
  }

  /** Validated load: corrupt data -> empty wallet, never throws. */
  load(data) {
    this.reset();
    if (!data || typeof data !== 'object' || !Array.isArray(data.items)) return;
    for (const it of data.items) {
      if (!validItem(it)) continue;
      const copy = { ...it };
      // Casing fix (Oct 2026): older saves stored 'HEY LABAN STORE'; the
      // canonical store name is now 'Hey Laban Store' (matches signage).
      if (copy.store === 'HEY LABAN STORE') copy.store = 'Hey Laban Store';
      this.items.push(copy);
    }
  }

  reset() {
    this.items = [];
    this._seq = 0;
  }
}
