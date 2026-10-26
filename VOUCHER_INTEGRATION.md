# VOUCHER_INTEGRATION.md — voucher system: prototype → real merchants

## What exists today (local prototype)

- **Unlock rule (game logic, not just UI):** `VoucherManager.canSpawn(distanceM)`
  returns `false` for any distance below **500 m**. `CollectibleManager`/`Game`
  only spawn voucher cards when `shouldSpawn()` passes, which first checks the
  500 m rule, then a 120 m minimum interval and a probability gate. Automated
  tests (`tests/voucher.test.js`) prove no spawn is possible below 500 m,
  including a seeded simulated 3000 m run.
- **Eligible stores:** Juicify Kuttikkattur, Turkish Corner, HEY LABAN STORE,
  Family Collections, Edumart, MyG Store. The masjid, bus stop and academy
  never issue vouchers (enforced in `VOUCHER_STORES` + test).
- **Wallet:** `VoucherWallet` stores collected cards (store, type, status,
  collected date). Redeeming generates a **local demo code**
  (`MMR-DEMO-XXXXXXXX`), marks the card redeemed, and refuses reuse
  (`redeem()` throws `already redeemed`; the code is generated once and stable).
- **Honesty labelling:** every wallet/redeem surface carries
  **"DEMO VOUCHER — NOT VALID FOR REAL-WORLD PURCHASES"**. No real discounts
  are claimed and no store is presented as a participating partner.

## Service interface (ready for a backend)

`src/game/VoucherWallet.js` is the seam. To go live, replace/extend it with an
implementation of this interface (all async, all server-validated):

```js
interface VoucherService {
  issue(playerId, storeId, runId) -> Promise<{ voucherId, store, type, expiresAt }>
  list(playerId)                 -> Promise<Voucher[]>
  redeem(playerId, voucherId)    -> Promise<{ code, redeemedAt }>  // single-use, atomic
  revoke(voucherId, reason)      -> Promise<void>
}
```

Keep the 500 m unlock rule server-side too (never trust the client for issuance).

## What real merchant redemption requires

1. **Merchant approval & agreements:** written consent from each store
   (Juicify Kuttikkattur, Turkish Corner, etc.) covering offer terms, validity
   windows, redemption limits and who funds the discount. Nothing in this
   prototype implies any store has agreed.
2. **Backend storage:** a database of issued vouchers (id, player, store,
   offer, status, timestamps) with an atomic redeem operation so a code cannot
   be double-spent, plus revocation/expiry handling.
3. **Secure validation:** codes must be unpredictable (CSPRNG), single-use,
   and validated server-side at the point of sale (e.g. merchant scans/enters
   the code against an API, or a signed QR/JWT the merchant app verifies with
   the backend). Never validate purely on-device.
4. **Abuse controls:** rate limits, per-player caps, device/account binding,
   and audit logs.
5. **Legal/UX:** clear offer terms shown before redeem, receipts, and a way to
   handle failed redemptions gracefully.

Until all of the above exist, the DEMO labelling must stay.
