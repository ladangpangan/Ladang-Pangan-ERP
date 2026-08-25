// Node.js-only server startup logic (SQLite restore/seed + MongoDB durable backups).
// Imported dynamically from instrumentation.js ONLY when NEXT_RUNTIME === 'nodejs'.
// Placed under lib/ and imported via the '@/' alias so Next's instrumentation compilation
// resolves it reliably (relative sibling imports of the root instrumentation file break).
import { restoreDbFromMongoIfNeeded, backupDbToMongo, startAutoBackup, persistenceEnabled } from './persistence.js';
import { getDb } from './index.js';
import { seedAuthUsers } from '@/lib/auth/seed-users';
import { refreshUserCache } from '@/lib/auth/users';

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

    if (persistenceEnabled()) {
      console.log(`[persistence] ready (restored=${res.restored}${res.reason ? `, reason=${res.reason}` : ''}).`);
    }
  } catch (e) {
    console.error('[boot] persistence init failed:', e?.message || e);
  }
}
