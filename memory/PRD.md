# PRD — LPI ERP (PT Ladang Pangan Indonesia)

## Product
Next.js 15 ERP (SQLite `better-sqlite3` + Drizzle, Better Auth, monolithic API at `/app/app/api/[[...path]]/route.js`).
Business: frozen chicken-parts **manufacturing + distribution** (produce parts → cold storage → sell). Language: **Indonesian**.
Durable storage: `lib/db/persistence.js` backs SQLite up to MongoDB when `MONGO_URL` is set (no-op if unset; local `/app/data/erp.db` is authoritative).

## Active initiative — Odoo data integration (month-by-month, backwards from Aug 2026)
Source: Odoo `pg_dump` at `/root/odoo_mig/dump.sql` + user's manual recap Google Sheet (Barang Masuk / Barang Keluar / Stock Colly dan Kg).

### Rules (confirmed by user)
- **Opening Balance per 31 Jul 2026 must stay untouched** (avoid double counting). Aug 2026 = safe pilot.
- ERP **auto-generates** double-entry journals from SO/PO/stock via `lib/accounting/engine.js` (do NOT copy Odoo journal numbers).
- **Revenue recognition = on delivery (Policy A):** all delivered Aug SOs → revenue + COGS.
- **Recap (Google Sheet) = source of truth for physical stock** (qty/kg).
- **Physical-first valuation:** inventory value scaled to match GL Persediaan (accounting kept stable; deep production valuation deferred).

### DONE (Aug 2026 pilot) — backend + frontend tested, all pass
1. Accounting: un-migrated 19 Aug SO + 4 Aug PO (`migrated=0`) → engine generated 29 journals (OPENING×1 untouched, PO_INV×4, SO_INV×19, SPAY×5).
   COGS from Odoo `stock_valuation_layer`; payments from Odoo residuals. Aug: Penjualan 54,623,100 / HPP 46,884,842 / Laba Kotor 7,738,258. Neraca & Neraca Saldo BALANCED.
   Script: `/app/scripts/migrate_august.mjs`. Verify: `/app/scripts/verify_august.mjs`.
2. Physical inventory reconstruction from recap: cold storage renamed "CS Surabaya" + 21 pallete zones; 29 active lots = 5,751 kg (matches recap); 175 Aug movements in `inventory_transaction` (RCP-… : IN=103, OUT=63, TRANSFER_CS=9). Script: `/app/scripts/reconstruct_inventory_august.mjs`.
3. Inventory revaluation: scaled lot `hpp_per_kg` (×0.708004) so physical value = GL Persediaan ≈ Rp 94.38 jt. Script: `/app/scripts/revalue_inventory_august.mjs`.

## Pending / backlog
- (P0) **July 2026 and earlier** integration — requires shifting/adjusting the 31 Jul opening balance date backward to avoid double counting.
- (P1) Formal **Work Order / Produksi** documents for Aug batches (currently production recorded only as IN ledger; recap lacks live-bird input data).
- (P1) **Deep production valuation** (raw material → WIP → finished goods) if exact GL/physical reconciliation is wanted.
- (P1) **PO Markup/Cashback** (mirror the SO "Faktur di-up & Cashback" on the supplier side).
- (P1) **Budget vs Realisasi** per expense account.
- (P2) Advanced analytics; AR/AP aging.

## Deployment note
`MONGO_URL` is NOT set in the current preview → data is local only. Before/at deploy, ensure `MONGO_URL` is configured and a backup captures the Aug integration so production restore doesn't revert it.

## Credentials
Admin: `admin@lpi.co.id` / `admin123` (see `/app/memory/test_credentials.md`).
