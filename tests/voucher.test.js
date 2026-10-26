// tests/voucher.test.js — VoucherManager + VoucherWallet (world workstream).
import { describe, it, expect } from 'vitest';
import { VoucherManager, VOUCHER_UNLOCK_M, VOUCHER_STORES } from '../src/game/VoucherManager.js';
import { VoucherWallet } from '../src/game/VoucherWallet.js';

// Deterministic seeded RNG (LCG) for simulated runs.
function seededRng(seed = 123456789) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('VoucherManager.canSpawn', () => {
  it('exposes the 500 m unlock constant', () => {
    expect(VOUCHER_UNLOCK_M).toBe(500);
  });

  it('is false for every integer 0..499', () => {
    const vm = new VoucherManager();
    for (let d = 0; d < 500; d++) {
      expect(vm.canSpawn(d)).toBe(false);
    }
  });

  it('is true at 500 and above', () => {
    const vm = new VoucherManager();
    for (const d of [500, 501, 1000, 10000]) {
      expect(vm.canSpawn(d)).toBe(true);
    }
  });
});

describe('VoucherManager.shouldSpawn', () => {
  it('never returns true below 500 m over a simulated 3000 m run', () => {
    const vm = new VoucherManager(seededRng(42));
    for (let d = 0; d <= 3000; d++) {
      const spawned = vm.shouldSpawn(d);
      expect(spawned && d < 500).toBe(false);
      if (spawned) vm.recordSpawn(d);
    }
  });

  it('respects the 120 m minimum interval between spawns', () => {
    // rng always < 0.45 so probability never blocks a legal spawn.
    const vm = new VoucherManager(() => 0);
    vm.recordSpawn(500);
    expect(vm.shouldSpawn(500)).toBe(false);
    expect(vm.shouldSpawn(619)).toBe(false);
    expect(vm.shouldSpawn(620)).toBe(true);
    vm.recordSpawn(620);
    expect(vm.shouldSpawn(739)).toBe(false);
    expect(vm.shouldSpawn(740)).toBe(true);
  });

  it('never spawns below 500 even when interval and probability allow', () => {
    const vm = new VoucherManager(() => 0);
    for (let d = 0; d < 500; d++) {
      expect(vm.shouldSpawn(d)).toBe(false);
    }
  });
});

describe('VoucherWallet.redeem', () => {
  it('returns a code starting with MMR-DEMO-', () => {
    const w = new VoucherWallet();
    w.addVoucher('Juicify Kuttikkattur');
    const id = w.list()[0].id;
    const code = w.redeem(id);
    expect(code.startsWith('MMR-DEMO-')).toBe(true);
  });

  it('throws on a second redeem of the same id', () => {
    const w = new VoucherWallet();
    w.addVoucher('Turkish Corner');
    const id = w.list()[0].id;
    w.redeem(id);
    expect(() => w.redeem(id)).toThrow('already redeemed');
  });

  it('keeps the first code stable across redeem attempts', () => {
    const w = new VoucherWallet();
    w.addVoucher('Edumart');
    const id = w.list()[0].id;
    const first = w.redeem(id);
    expect(() => w.redeem(id)).toThrow();
    expect(w.list()[0].code).toBe(first);
    expect(w.list()[0].status).toBe('redeemed');
  });
});

describe('VOUCHER_STORES', () => {
  it('excludes masjid, bus stop and academy', () => {
    expect(Array.isArray(VOUCHER_STORES)).toBe(true);
    expect(VOUCHER_STORES.length).toBeGreaterThan(0);
    for (const name of VOUCHER_STORES) {
      expect(name).not.toMatch(/masjid/i);
      expect(name).not.toMatch(/bus/i);
      expect(name).not.toMatch(/academy/i);
    }
  });
});
