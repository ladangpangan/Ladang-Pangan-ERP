// Node.js-only server startup logic (SQLite restore/seed + MongoDB durable backups).
// Imported dynamically from instrumentation.js ONLY when NEXT_RUNTIME === 'nodejs'.
// Placed under lib/ and imported via the '@/' alias so Next's instrumentation compilation
// resolves it reliably (relative sibling imports of the root instrumentation file break).
import { restoreDbFromMongoIfNeeded, backupDbToMongo, startAutoBackup, persistenceEnabled } from './persistence.js';
import { getDb, getRawSqlite } from './index.js';
import { seedAuthUsers } from '@/lib/auth/seed-users';
import { refreshUserCache } from '@/lib/auth/users';
import * as md from '@/lib/db/masterdata';
import * as salesMongo from '@/lib/db/sales-mongo';
import * as invMongo from '@/lib/db/inventory-mongo';
import * as potxMongo from '@/lib/db/potx-mongo';
import * as assetsOpnameMongo from '@/lib/db/assets-opname-mongo';
import * as woApprovalMongo from '@/lib/db/wo-approval-mongo';
import * as tallyTxMongo from '@/lib/db/tally-tx-mongo';
import * as miscMongo from '@/lib/db/misc-mongo';
import * as coaMongo from '@/lib/accounting/coa-mongo';
import * as jmongo from '@/lib/accounting/journal-mongo';

// Background cache warm-up: hydrate the per-pod SQLite mirror from MongoDB right after boot so the
// FIRST user request is already warm (otherwise the first request pays a one-time ~10s cold cost:
// ensureMasterSync + one-time seeds/index creation + the initial full-collection hydrations). Runs
// fire-and-forget so it NEVER blocks container readiness; on failure the normal per-request hydration
// path still kicks in. Sets globalThis.__hydrateTs so the first request skips the (now redundant) sync.
async function warmCaches() {
  try {
    const raw = getRawSqlite();
    const g = (globalThis.__hydrateTs = globalThis.__hydrateTs || {});
    try { await md.ensureMasterSync(); } catch { /* best-effort */ }
    try { await md.hydrateMasterFromMongo(); g.master = Date.now(); } catch { /* best-effort */ }
    await Promise.all([
      (async () => { try { await salesMongo.ensureSalesReady(raw); g.sales = Date.now(); } catch { /* best-effort */ } })(),
      (async () => { try { await invMongo.ensureInventoryReady(raw); g.inventory = Date.now(); } catch { /* best-effort */ } })(),
      (async () => { try { await potxMongo.ensureReady(raw); g.potx = Date.now(); } catch { /* best-effort */ } })(),
      (async () => { try { await assetsOpnameMongo.ensureReady(raw); g.assetsOpname = Date.now(); } catch { /* best-effort */ } })(),
      (async () => { try { await woApprovalMongo.ensureReady(raw); g.woApproval = Date.now(); } catch { /* best-effort */ } })(),
      (async () => { try { await tallyTxMongo.ensureReady(raw); g.tallyTx = Date.now(); } catch { /* best-effort */ } })(),
      (async () => { try { await miscMongo.ensureReady(raw); g.misc = Date.now(); } catch { /* best-effort */ } })(),
      (async () => { try { await coaMongo.ensureCoaReady(raw); g.coa = Date.now(); } catch { /* best-effort */ } })(),
      (async () => { try { await jmongo.ensureJournalsReady(raw); g.journals = Date.now(); } catch { /* best-effort */ } })(),
    ]);
    console.log('[boot] cache warm-up complete (first request will be warm).');
  } catch (e) { console.error('[boot] cache warm-up failed (non-fatal):', e?.message || e); }
}


export async function register() {
  try {
    // 1) Restore latest durable backup if this container's DB is empty.
    const res = await restoreDbFromMongoIfNeeded();

    // 2) Open the DB (creates schema + seeds bundled snapshot if still empty).
    getDb();

    // 2b) Seed the standard team accounts into MongoDB (Better Auth) if the user collection is empty.
    await seedAuthUsers();
    // 2c) Prime the in-memory user cache used for notification recipient lookups.
    await refreshUserCache();

    // 3) Establish the FIRST durable backup ONLY on a genuinely fresh Atlas (no snapshot yet).
    //    We must NOT auto-backup on boot for any other non-restore reason (e.g. Mongo was
    //    momentarily unavailable), otherwise a stale local baseline could clobber the
    //    authoritative Atlas backup. Runtime writes still trigger debounced backups normally.
    if (persistenceEnabled() && !res.restored && res.reason === 'no-backup-yet') {
      await backupDbToMongo();
    }

    // 4) Start periodic + shutdown backups.
    startAutoBackup();

    // 5) Warm the per-pod SQLite caches from MongoDB in the BACKGROUND (fire-and-forget) so the first
    //    user request is already warm. Never awaited -> does not delay container readiness.
    setTimeout(() => { warmCaches(); }, 50);

    if (persistenceEnabled()) {
      console.log(`[persistence] ready (restored=${res.restored}${res.reason ? `, reason=${res.reason}` : ''}).`);
    }
  } catch (e) {
    console.error('[boot] persistence init failed:', e?.message || e);
  }
}
