// Shared MongoDB connection (singleton).
// Used by Better Auth (mongodbAdapter) for user/session/account/verification storage so that
// auth works correctly across MULTIPLE stateless replicas (shared store, not per-pod SQLite).
// In preview a local standalone mongod runs on localhost:27017; in production Emergent injects MONGO_URL (Atlas).
import { MongoClient } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';

// Parse a db name from the connection string path: mongodb://host:port/<dbname>?opts
function dbNameFromUrl(url) {
  try {
    const afterScheme = String(url).replace(/^mongodb(\+srv)?:\/\//i, '');
    const slash = afterScheme.indexOf('/');
    if (slash === -1) return '';
    return decodeURIComponent(afterScheme.slice(slash + 1).split('?')[0] || '');
  } catch { return ''; }
}
// Managed Mongo clusters (Atlas) forbid the shared system dbs for scoped users, and the driver
// default is "test" — never use any of these. Treat them as "no db name given".
function safeDbName(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  return ['test', 'admin', 'local', 'config'].includes(n.toLowerCase()) ? '' : n;
}

export const MONGO_DB_NAME =
  safeDbName(process.env.MONGO_DB_NAME) ||
  safeDbName(process.env.DB_NAME) ||
  safeDbName(dbNameFromUrl(MONGO_URL)) ||
  'erp_prod';

let _client = null;
let _db = null;

export function getMongoClient() {
  if (!_client) {
    _client = new MongoClient(MONGO_URL, { maxPoolSize: 10 });
  }
  return _client;
}

// The mongodb driver auto-connects on first command (v4+), so returning an unconnected
// client/db is safe — the connection is established lazily on the first query.
export function getMongoDb() {
  if (!_db) {
    _db = getMongoClient().db(MONGO_DB_NAME);
  }
  return _db;
}
