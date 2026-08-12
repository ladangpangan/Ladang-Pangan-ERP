// First-boot self-seed for fresh/empty databases (e.g. a new production container).
// The bundled snapshot (seed-snapshot.json) is a JSON dump of the preview DB taken at
// build time. If the running DB has NO users (fresh install), we restore the snapshot so
// production comes up with the admin login + all migrated data already present.
//
// Idempotent: once any user exists, this is a no-op. Safe on every boot.
import snapshot from './seed-snapshot.json';

// Insert parents before children so data is consistent even though we also disable FK
// enforcement during the bulk load.
const INSERT_ORDER = [
  'user', 'account', 'app_settings',
  'contacts', 'products', 'cold_storages', 'zones', 'wo_stages',
  'gl_accounts', 'journal_entries', 'journal_lines',
  'inventory_transaction', 'inventory_stock',
  'sales_order', 'sales_order_items',
  'purchase_order', 'purchase_order_items',
];

export function seedIfEmpty(sqlite) {
  // Only seed a truly fresh DB (no users => Better Auth "User not found").
  let userCount;
  try {
    userCount = sqlite.prepare('SELECT COUNT(*) AS c FROM user').get().c;
  } catch (e) {
    return { seeded: false, reason: 'user-table-missing' };
  }
  if (userCount > 0) return { seeded: false, reason: 'db-not-empty' };

  const tablesInSnapshot = Object.keys(snapshot || {});
  if (!tablesInSnapshot.length) return { seeded: false, reason: 'empty-snapshot' };

  const ordered = [
    ...INSERT_ORDER.filter((t) => tablesInSnapshot.includes(t)),
    ...tablesInSnapshot.filter((t) => !INSERT_ORDER.includes(t)),
  ];

  sqlite.pragma('foreign_keys = OFF');
  let insertedRows = 0;
  let insertedTables = 0;
  try {
    const tx = sqlite.transaction(() => {
      for (const table of ordered) {
        const rows = snapshot[table];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        // Only insert columns that actually exist in the freshly-created schema.
        const info = sqlite.prepare(`PRAGMA table_info(${table})`).all();
        const validCols = new Set(info.map((c) => c.name));
        if (validCols.size === 0) continue;
        const cols = Object.keys(rows[0]).filter((c) => validCols.has(c));
        if (cols.length === 0) continue;
        const placeholders = cols.map(() => '?').join(', ');
        const colList = cols.map((c) => `"${c}"`).join(', ');
        const stmt = sqlite.prepare(`INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${placeholders})`);
        for (const row of rows) {
          const info2 = stmt.run(cols.map((c) => (row[c] === undefined ? null : row[c])));
          insertedRows += info2.changes;
        }
        insertedTables += 1;
      }
    });
    tx();
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }

  console.log(`[seed] Fresh DB detected — restored snapshot: ${insertedRows} rows across ${insertedTables} tables.`);
  return { seeded: true, insertedRows, insertedTables };
}
