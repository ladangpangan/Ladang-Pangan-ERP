// Node.js-only server startup logic (SQLite restore/seed + MongoDB durable backups).
// Imported dynamically from instrumentation.js ONLY when NEXT_RUNTIME === 'nodejs'.
// Placed under lib/ and imported via the '@/' alias so Next's instrumentation compilation
// resolves it reliably (relative sibling imports of the root instrumentation file break).
import { restoreDbFromMongoIfNeeded, backupDbToMongo, startAutoBackup, persistenceEnabled } from './persistence.js';
import { getDb } from './index.js';

export async function register() {
  try {
    // 1) Restore latest durable backup if this container's DB is empty.
    const res = await restoreDbFromMongoIfNeeded();

    // 2) Open the DB (creates schema + seeds bundled snapshot if still empty).
    getDb();

    // 3) If nothing was restored (very first deploy), persist the freshly-seeded baseline so
    //    subsequent boots restore from Mongo instead of the static snapshot.
    if (persistenceEnabled() && !res.restored) {
      await backupDbToMongo();
    }

    // 4) Start periodic + shutdown backups.
    startAutoBackup();

    if (persistenceEnabled()) {
      console.log(`[persistence] ready (restored=${res.restored}${res.reason ? `, reason=${res.reason}` : ''}).`);
    }
  } catch (e) {
    console.error('[boot] persistence init failed:', e?.message || e);
  }
}
