// Durable persistence for the SQLite database on ephemeral production containers.
// Strategy: keep using SQLite for ALL app logic, but treat MongoDB (provided by Emergent
// in production via MONGO_URL) as a durable "safe box" for the whole SQLite file.
//   - On boot (see instrumentation.js): if the local DB is empty, restore the latest
//     backup from MongoDB (GridFS) so nothing entered online is lost across redeploys.
//   - After writes / periodically / on shutdown: back the SQLite file up to MongoDB.
// If MONGO_URL is not set (e.g. the preview sandbox), every function here is a safe no-op,
// so local development behaviour is unchanged.
// NOTE: 'mongodb' is loaded lazily via a RUNTIME require (createRequire) instead of a static
// import. This prevents webpack (dev + build) from trying to bundle mongodb's OPTIONAL peer
// deps (socks, aws4, gcp-metadata, kerberos, client-encryption, ...) which are not installed.
// It is still copied into the standalone output via `outputFileTracingIncludes` in next.config.
import { createRequire } from 'module';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

const _require = createRequire(import.meta.url);
let _mongoLib = null;
function mongoLib() {
  if (!_mongoLib) _mongoLib = _require('mongodb');
  return _mongoLib;
}

const DB_PATH = process.env.DB_PATH || '/app/data/erp.db';
const MONGO_URL = process.env.MONGO_URL || '';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || process.env.DB_NAME || '';
// Parse a db name from the connection string path: mongodb://host:port/<dbname>?opts
function dbNameFromUrl(url) {
  try {
    const afterScheme = String(url).replace(/^mongodb(\+srv)?:\/\//i, '');
    const slash = afterScheme.indexOf('/');
    if (slash === -1) return '';
    const dbPart = afterScheme.slice(slash + 1).split('?')[0];
    return decodeURIComponent(dbPart || '');
  } catch { return ''; }
}
// Managed Mongo clusters (Atlas) FORBID the shared system dbs for scoped users, and the
// driver default is "test" — never use any of these. Treat them as "no db name given".
function safeDbName(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  const reserved = ['test', 'admin', 'local', 'config'];
  return reserved.includes(n.toLowerCase()) ? '' : n;
}
const RESOLVED_DB_NAME =
  safeDbName(MONGO_DB_NAME) || safeDbName(dbNameFromUrl(MONGO_URL)) || 'erp_prod';
const BUCKET = 'sqlite_backups';
const FILENAME = 'erp-db-snapshot';

let _client = null;
let _connecting = null;

export function persistenceEnabled() {
  return !!MONGO_URL;
}

async function getMongo() {
  if (!MONGO_URL) return null;
  if (_client) return _client;
  if (_connecting) return _connecting;
  _connecting = (async () => {
    const { MongoClient } = mongoLib();
    const client = new MongoClient(MONGO_URL, {
      serverSelectionTimeoutMS: 6000,
      connectTimeoutMS: 6000,
      socketTimeoutMS: 20000,
    });
    await client.connect();
    _client = client;
    _connecting = null;
    return client;
  })().catch((e) => {
    _connecting = null;
    console.error('[persistence] Mongo connect failed:', e?.message || e);
    return null;
  });
  return _connecting;
}

function mongoDb(client) {
  return client.db(RESOLVED_DB_NAME);
}

function fileHasUsers(p) {
  try {
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) return false;
    const d = new Database(p, { readonly: true, fileMustExist: true });
    let c = 0;
    try { c = d.prepare('SELECT COUNT(*) AS c FROM user').get().c; } catch { c = 0; }
    d.close();
    return c > 0;
  } catch {
    return false;
  }
}

async function latestBackupFile(db) {
  const files = await db
    .collection(`${BUCKET}.files`)
    .find({ filename: FILENAME })
    .sort({ uploadDate: -1 })
    .limit(1)
    .toArray();
  return files[0] || null;
}

// Restore the SQLite file from Mongo IF the local DB has no users yet (fresh container).
export async function restoreDbFromMongoIfNeeded() {
  if (!MONGO_URL) return { restored: false, reason: 'no-mongo-url' };
  if (fileHasUsers(DB_PATH)) return { restored: false, reason: 'local-has-data' };

  const client = await getMongo();
  if (!client) return { restored: false, reason: 'mongo-unavailable' };
  try {
    const db = mongoDb(client);
    const { GridFSBucket } = mongoLib();
    const bucket = new GridFSBucket(db, { bucketName: BUCKET });
    const file = await latestBackupFile(db);
    if (!file) return { restored: false, reason: 'no-backup-yet' };

    const tmp = `${DB_PATH}.restore.tmp`;
    try { fs.mkdirSync(path.dirname(DB_PATH), { recursive: true }); } catch {}
    await pipeline(bucket.openDownloadStream(file._id), fs.createWriteStream(tmp));

    if (!fileHasUsers(tmp)) {
      fs.rmSync(tmp, { force: true });
      return { restored: false, reason: 'backup-invalid' };
    }
    // Replace the live DB file (drop stale WAL/SHM so SQLite reads the restored file).
    for (const ext of ['-wal', '-shm']) fs.rmSync(DB_PATH + ext, { force: true });
    fs.renameSync(tmp, DB_PATH);
    console.log(`[persistence] Restored SQLite from MongoDB backup (${(file.length / 1024).toFixed(0)} KB).`);
    return { restored: true, size: file.length };
  } catch (e) {
    console.error('[persistence] restore failed:', e?.message || e);
    return { restored: false, reason: 'error' };
  }
}

// Back up the current SQLite file to Mongo (GridFS). Keeps only the latest snapshot.
export async function backupDbToMongo() {
  if (!MONGO_URL) return { ok: false, reason: 'no-mongo-url' };
  const client = await getMongo();
  if (!client) return { ok: false, reason: 'mongo-unavailable' };

  const tmp = path.join(path.dirname(DB_PATH), `.erp-backup-${Date.now()}.db`);
  try {
    // Consistent online snapshot (safe even with concurrent reads/writes).
    const { getRawSqlite } = await import('./index.js');
    const sqlite = getRawSqlite();
    await sqlite.backup(tmp);
    const size = fs.statSync(tmp).size;

    const db = mongoDb(client);
    const { GridFSBucket } = mongoLib();
    const bucket = new GridFSBucket(db, { bucketName: BUCKET });
    const old = await db.collection(`${BUCKET}.files`).find({ filename: FILENAME }).toArray();

    await pipeline(
      fs.createReadStream(tmp),
      bucket.openUploadStream(FILENAME, { metadata: { updatedAt: new Date() } })
    );
    // Remove previous snapshots (retain only the newest one just uploaded).
    for (const f of old) { try { await bucket.delete(f._id); } catch {} }

    return { ok: true, size };
  } catch (e) {
    console.error('[persistence] backup failed:', e?.message || e);
    return { ok: false, reason: 'error' };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ---- Debounced + periodic + shutdown backup orchestration ----
let _timer = null;
let _running = false;
let _pending = false;
let _started = false;

async function runBackupSafe() {
  if (_running) { _pending = true; return; }
  _running = true;
  try { await backupDbToMongo(); } catch (e) { /* logged inside */ }
  _running = false;
  if (_pending) { _pending = false; scheduleBackup(1500); }
}

// Called after successful mutating API requests; coalesces bursts into one backup.
export function scheduleBackup(delayMs = 8000) {
  if (!MONGO_URL) return;
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => { _timer = null; runBackupSafe(); }, delayMs);
}

// Periodic safety-net backup + flush-on-shutdown (SIGTERM on redeploy/scale-down).
export function startAutoBackup(intervalMs = 60000) {
  if (_started || !MONGO_URL) return;
  _started = true;
  const iv = setInterval(() => runBackupSafe(), intervalMs);
  if (typeof iv.unref === 'function') iv.unref();

  let shuttingDown = false;
  const flushAndExit = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { clearInterval(iv); await backupDbToMongo(); } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', flushAndExit);
  process.on('SIGINT', flushAndExit);
}
