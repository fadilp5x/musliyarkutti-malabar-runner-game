// VoucherWalletUI.js — voucher wallet screen. DOM only, no three.js.
// Every voucher surface carries the DEMO disclaimer.

const DEMO_LABEL = 'DEMO VOUCHER \u2014 NOT VALID FOR REAL-WORLD PURCHASES';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export class VoucherWalletUI {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.root = null; // screen element, built lazily
  }

  _ensure() {
    if (this.root) return this.root;
    const el = document.createElement('div');
    el.className = 'screen hidden';
    el.id = 'screen-wallet';

    const panel = document.createElement('div');
    panel.className = 'panel page-shell';

    const header = document.createElement('header');
    header.className = 'page-header';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn-ghost page-back';
    back.setAttribute('aria-label', 'Back');
    back.textContent = '←';
    back.addEventListener('click', () => {
      this.game.audio?.play?.('click');
      this.ui.show(this.ui.menus?.returnTo || 'hud');
    });

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Voucher Wallet';
    header.append(back, title, document.createElement('span'));
    panel.appendChild(header);

    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.textContent = DEMO_LABEL;
    panel.appendChild(banner);

    this.listEl = document.createElement('div');
    this.listEl.className = 'scroll-list';
    panel.appendChild(this.listEl);

    el.appendChild(panel);
    this.root = el;
    this.ui.registerScreen('wallet', el);
    return el;
  }

  render() {
    this._ensure();
    // Wallet screen registers lazily; ensure it is visible for this show().
    this.root.classList.remove('hidden');
    const list = this.listEl;
    list.innerHTML = '';

    let items = [];
    try { items = this.game.wallet?.list?.() ?? []; } catch { items = []; }

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML =
        'No vouchers yet.<br>Run past <b>500 m</b> in a single run to start ' +
        'finding vouchers from Malabar shops along the road.';
      list.appendChild(empty);
      return;
    }

    for (const item of items) {
      list.appendChild(this._card(item));
    }
  }

  _card(item) {
    const card = document.createElement('div');
    card.className = 'voucher-card';

    const store = document.createElement('div');
    store.className = 'v-store';
    store.textContent = item.store || 'Unknown store';
    card.appendChild(store);

    const type = document.createElement('div');
    type.className = 'v-type';
    type.textContent = item.type || 'Voucher';
    card.appendChild(type);

    const status = document.createElement('span');
    status.className = 'v-status ' + (item.status === 'redeemed' ? 'redeemed' : 'available');
    status.textContent = item.status === 'redeemed' ? 'Redeemed' : 'Available';
    card.appendChild(status);

    const meta = document.createElement('div');
    meta.className = 'v-meta';
    let dateStr = '';
    try {
      dateStr = item.collectedAt ? new Date(item.collectedAt).toLocaleDateString() : '';
    } catch { dateStr = ''; }
    meta.textContent = dateStr ? 'Collected: ' + dateStr : '';
    card.appendChild(meta);

    if (item.status === 'redeemed' && item.code) {
      const code = document.createElement('div');
      code.className = 'voucher-code';
      code.textContent = item.code;
      card.appendChild(code);

      const done = document.createElement('button');
      done.type = 'button';
      done.className = 'btn secondary small';
      done.textContent = 'Redeemed';
      done.disabled = true;
      card.appendChild(done);

      const note = document.createElement('div');
      note.className = 'v-meta';
      note.textContent = DEMO_LABEL;
      card.appendChild(note);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small';
      btn.textContent = 'Redeem';
      btn.addEventListener('click', () => this._redeem(item.id, card, btn));
      card.appendChild(btn);
    }

    return card;
  }

  _redeem(id, card, btn) {
    this.game.audio?.play?.('click');
    let code = null;
    try {
      code = this.game.wallet?.redeem?.(id);
    } catch (err) {
      btn.textContent = err?.message || 'Redeem failed';
      btn.disabled = true;
      return;
    }
    if (!code) {
      btn.textContent = 'Redeem failed';
      btn.disabled = true;
      return;
    }

    card.innerHTML = '';

    const store = document.createElement('div');
    store.className = 'v-store';
    const item = this._find(id);
    store.textContent = (item && item.store) || 'Voucher';
    card.appendChild(store);

    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.textContent = DEMO_LABEL;
    card.appendChild(banner);

    const codeEl = document.createElement('div');
    codeEl.className = 'voucher-code';
    codeEl.textContent = code;
    card.appendChild(codeEl);

    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'btn secondary small';
    done.textContent = 'Redeemed';
    done.disabled = true;
    card.appendChild(done);

    this.game.audio?.play?.('voucher');
    this.game.events?.emit?.('redeem', { id, code });
  }

  _find(id) {
    try {
      const items = this.game.wallet?.list?.() ?? [];
      return items.find((i) => i.id === id) || null;
    } catch {
      return null;
    }
  }
}
