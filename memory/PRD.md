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
`MONGO_URL` is provided by Emergent in production (not in preview). Data durability = SQLite auto-backup to MongoDB (GridFS) via `lib/db/persistence.js`; on a fresh container, `lib/db/seed.js` restores `lib/db/seed-snapshot.json`.

### Production incident (2026-08-15) + fixes (in preview, needs redeploy)
Symptoms from prod logs after first deploy:
1. `[persistence] backup/restore failed: not authorized on test` — driver defaulted to the `test` db (MONGO_URL had no db path) which managed clusters forbid.
2. `[seed] Fresh DB detected — restored snapshot: 996 rows` — the bundled `seed-snapshot.json` was an OLD (Aug 12) dump, so production came up with stale pre-reset data (209 SO / 51 PO / 26 lots), not the clean slate.
Fixes applied in preview:
1. `lib/db/persistence.js` — db name now resolves as `MONGO_DB_NAME || DB_NAME || <db from URL path> || 'erp_prod'` (never `test`). `scripts/generate_seed_snapshot.mjs` added.
2. `lib/db/seed-snapshot.json` — regenerated from the current clean slate (247 rows: login + master data, transactions empty).
Action: user must REDEPLOY. After redeploy, check prod logs — if backup still says "not authorized on erp_prod", set env `MONGO_DB_NAME` to the authorized database, or contact Emergent Support for the correct MongoDB db name.
Pre-reset backup: `/root/odoo_mig/erp.db.bak_before_reset_*`. Old snapshot saved: `/root/odoo_mig/seed-snapshot.OLD.json`.

## Kartu Stok (Stock Card) — added 2026-02
Per-product auditable stock ledger. New table `stock_ledger` (schema.js + CREATE TABLE in index.js) records every
stock movement via helper `recordLedger()` hooked into: inbound (IN, incl. tally finalize), SO confirm (OUT),
sales return (RETURN_IN), non-sales/damage (OUT/DAMAGE), CS transfer (TRANSFER_OUT+TRANSFER_IN), opname approve (ADJ).
Read API: `GET /api/inventory-reports/stock-card?productId=&coldStorageId=&from=&to=` → opening balance, movements
with running balance, and summary. UI: 5th tab "Kartu Stok" in `/dashboard/inventory-reports` (product/CS/date filters,
summary cards, ledger table). Backend tested 7/7 pass. Table auto-creates on prod boot (needs redeploy to appear in prod).

## Phase 1 — Auth/Sessions migrated to MongoDB — added 2026-02
Fixes production multi-replica 401 "Unauthorized": Better Auth now uses `mongodbAdapter` (shared MongoDB) instead of
per-pod SQLite. Users/sessions/accounts live in MongoDB (collections user/account/session). Business data still SQLite.
Key files: lib/db/mongo.js (shared MongoClient, safe db-name), lib/auth/auth.js (mongodbAdapter, transaction:false),
lib/auth/users.js (Mongo user helpers + sync recipient cache), lib/auth/seed-users.js (seed 4 team users, idempotent),
lib/db/boot.js (seed + cache prime), route.js (all /users endpoints + createNotification + /stats + profile -> Mongo),
lib/db/index.js (dropped SQLite FK notifications.user_id). Preview Mongo: localhost:27017 (db erp_prod); prod: injected
Atlas MONGO_URL. Backend tested 9/9 pass; deployment agent PASS. NEEDS REDEPLOY. Keep prod at 1 replica until Phase 2
(business data still SQLite = per-pod). Deployment: removed .env from .gitignore per Emergent requirement; removed
MONGO_URL from .env (uses injected Atlas in prod, localhost fallback in preview).

## PROD FIX — MongoDB "not authorized on erp_prod" (deploy) — 2026-02
Root cause: `lib/db/mongo.js` resolved the DB name WITHOUT reading `process.env.DB_NAME`, so in production it fell
back to `erp_prod` where the Emergent-injected Atlas user is NOT authorized → Better Auth seed/login + master-data
ops failed ("not authorized on erp_prod ... find: user"). Meanwhile `lib/db/persistence.js` DID read `DB_NAME`, so the
SQLite GridFS restore succeeded on the correct DB (explaining the contradictory logs). FIX: `mongo.js` now resolves
`safeDbName(MONGO_DB_NAME) || safeDbName(DB_NAME) || safeDbName(dbNameFromUrl) || 'erp_prod'` — identical to
persistence.js. All Mongo access (auth.js, users.js, seed-users.js, masterdata.js) goes through getMongoDb() so the
single fix propagates. Preview unaffected (no DB_NAME → localhost erp_prod). REQUIRES REDEPLOY to take effect in prod.
NOTE: Better Auth "Base URL is not set" is a non-fatal warning (login works via dynamic origin); optionally set
BETTER_AUTH_URL=https://erp.ladangpangan.id in prod env to silence it. IMPORTANT: keep prod at 1 REPLICA — auth &
master data are shared in Mongo, but transactions still live in per-pod SQLite (file backed up to GridFS), so 2+
replicas would diverge/lose transaction data until transactions are migrated to Mongo.

## Credentials
Admin: `admin@lpi.co.id` / `admin123` (see `/app/memory/test_credentials.md`).

## Phase 2 — Master Data migrated to MongoDB (DUAL-WRITE) — added 2026-02
Master data `products`, `cold_storages`, `zones` are now MongoDB-authoritative (db `erp_prod`) with a DUAL-WRITE
mirror to local SQLite so un-migrated transaction modules keep working. Docs use the UUID as Mongo `_id` (same id
shared with SQLite + all transaction rows). Reads for these CRUD endpoints come from Mongo; every write
(POST/PATCH/DELETE + archive/restore) writes Mongo first then mirrors to SQLite via Drizzle. One-time forward
backfill SQLite->Mongo runs on boot when a Mongo collection is empty (ran: products=52, cold_storages=1, zones=23).
`/stats` now counts these from Mongo. New file: `lib/db/masterdata.js` (mdList/mdGet/mdInsert/mdUpdate/mdDelete/
mdDeleteMany/mdCount/mdArchivedFilter + ensureMasterSync). route.js: rewrote products/cold-storages/zones handlers,
archive handler mirrors archive to Mongo, cold-storage delete cascades zones in Mongo. Backend tested — all pass,
seeded counts restored after cleanup. LIMITATION: transactions still read master data from the per-pod SQLite mirror,
so keep prod at 1 replica until transactions are migrated (Phase 2 continued). Next: contacts, then transactions.

## Tally Outbound — "Catat" (Draft) vs "Simpan" (Final) — added 2026-02
Operators allocate kode-simpan (stock lots) to SO Draft items with two modes on
POST /api/tally-outbound/orders/:id/items/:itemId/allocate body {stockIds, mode:'draft'|'final'}:
- Catat (draft): saves picked lots into so_item_stocks WITHOUT locking stock (inventory_stock stays 'active') and
  WITHOUT changing SO totals; sets sales_order_items.outbound_tally_status='draft'. Re-openable/incremental.
- Simpan (final): locks stock (status='allocated'), revises item weight/qty/subtotal = sum of lots, recalcs SO totals,
  sets outbound_tally_status='final'.
New column sales_order_items.outbound_tally_status (default 'none'). SO Confirm (Draft->Confirmed) is BLOCKED while any
non-dropship item is 'draft' (must Simpan first). Re-pick frees prior lots to 'active' ONLY if not used by another item.
GET /api/tally-outbound/orders reports allocatedItemCount(=final) + draftItemCount; SO hidden only when all items final.
Frontend /app/app/tally/outbound/page.js dialog has 3 buttons Batal/Catat/Simpan, shows selected-code chips and a live
"sisa yang diminta" (ordered - selected). Backend tested 7/7. Selecting lots is optional per SO item — can be done via
SO detail page OR Tally Outbound; SO-page allocate also now sets outbound_tally_status='final'.

## Biaya Kirim (shipping cost) on SO — fixed 2026-02
Rules (user-confirmed): shippingBearer='buyer' => shipping ADDED to sales_order.total_amount (billed to customer) AND
posted as expense (company pays courier) => operating margin NEUTRAL. shippingBearer='seller' => NOT billed; posted as
Beban Pengiriman/Ongkir (6-1300) => reduces profit/margin. New column sales_order.shipping_pay_method ('tunai'=>Kas |
'transfer'=>Bank) selects the cash source for the SO_SHIP journal (Dr 6-1300 / Cr Kas|Bank). recalcSoTotals + Invoiced
transition add buyer shipping; SO detail returns buyerShipping/goodsRevenue and grossProfit=goodsRevenue-cogs-
sellerShipping. engine.salesProfitReport now excludes buyer shipping from revenue and subtracts seller shipping from GP.
Invoice PDF shows a "Biaya Kirim" line when buyer-borne. Backend tested 5/5. Files: route.js, lib/accounting/engine.js,
lib/pdf/invoice.js, lib/db/schema.js, lib/db/index.js, app/dashboard/sales-orders/[id]/page.js.
