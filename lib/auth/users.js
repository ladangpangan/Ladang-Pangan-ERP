// MongoDB-backed user helpers. Better Auth stores users/accounts/sessions in MongoDB (collections
// `user`, `account`, `session`) with _id / userId as BSON ObjectId. These helpers give the rest of
// the app a clean interface (string ids, camelCase fields) for user management.
import { ObjectId } from 'mongodb';
import { getMongoDb } from '@/lib/db/mongo';
import { getAuth } from '@/lib/auth/auth';

const usersCol = () => getMongoDb().collection('user');
const accountsCol = () => getMongoDb().collection('account');
const sessionsCol = () => getMongoDb().collection('session');

export function toObjectId(id) {
  try { return new ObjectId(String(id)); } catch { return null; }
}

export function serializeUser(d) {
  if (!d) return null;
  return {
    id: String(d._id),
    name: d.name || null,
    email: d.email,
    role: d.role || 'operator',
    status: d.status || 'active',
    archivedAt: d.archivedAt ? new Date(d.archivedAt).toISOString() : null,
    createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
  };
}

// archived: undefined/'0' => active only; '1'|'true' => archived only; 'all' => both
export async function listUsers(archived) {
  const q = {};
  if (archived === '1' || archived === 'true') q.archivedAt = { $ne: null };
  else if (archived === 'all') { /* no filter */ }
  else q.archivedAt = null; // null also matches missing field in Mongo
  const rows = await usersCol().find(q).sort({ createdAt: -1 }).toArray();
  return rows.map(serializeUser);
}

export async function findUserRawById(id) {
  const oid = toObjectId(id); if (!oid) return null;
  return usersCol().findOne({ _id: oid });
}
export async function findUserRawByEmail(email) {
  return usersCol().findOne({ email });
}
export async function findUsersByRoles(roles) {
  const rows = await usersCol().find({ role: { $in: roles } }).toArray();
  return rows.map(serializeUser);
}
export async function countUsers() {
  return usersCol().countDocuments({});
}

export async function updateUserById(id, patch) {
  const oid = toObjectId(id); if (!oid) return false;
  const set = { ...patch, updatedAt: new Date() };
  const r = await usersCol().updateOne({ _id: oid }, { $set: set });
  await refreshUserCache();
  return r.matchedCount > 0;
}

export async function deleteUserById(id) {
  const oid = toObjectId(id); if (!oid) return false;
  await accountsCol().deleteMany({ userId: oid });
  await sessionsCol().deleteMany({ userId: oid });
  const r = await usersCol().deleteOne({ _id: oid });
  await refreshUserCache();
  return r.deletedCount > 0;
}

export async function resetUserPassword(id, newPassword) {
  const oid = toObjectId(id); if (!oid) return false;
  const ctx = await getAuth().$context;
  const hashed = await ctx.password.hash(newPassword);
  const r = await accountsCol().updateOne(
    { userId: oid, providerId: 'credential' },
    { $set: { password: hashed, updatedAt: new Date() } }
  );
  return r.matchedCount > 0;
}

// Create a user via Better Auth (handles id/ObjectId + password hashing), then set role/status.
export async function createUser({ name, email, password, role, status = 'active' }) {
  const auth = getAuth();
  await auth.api.signUpEmail({ body: { email, password, name } });
  await usersCol().updateOne({ email }, { $set: { role, status, updatedAt: new Date() } });
  await refreshUserCache();
  return serializeUser(await usersCol().findOne({ email }));
}

// -----------------------
// Sync recipient cache (for createNotification which must stay synchronous).
// Holds a lightweight {id, role, status} list, refreshed on boot and after any user change.
// -----------------------
let _userCache = [];
export function getCachedRecipients(roles) {
  return _userCache.filter((u) => roles.includes(u.role) && (u.status === 'active' || !u.status));
}
export async function refreshUserCache() {
  try {
    const rows = await usersCol().find({}).project({ role: 1, status: 1 }).toArray();
    _userCache = rows.map((r) => ({ id: String(r._id), role: r.role, status: r.status }));
  } catch (e) {
    console.error('[users] refreshUserCache failed:', e?.message || e);
  }
  return _userCache;
}

// Warm the recipient cache lazily FROM WITHIN the request lifecycle. boot.js primes the cache in the
// instrumentation module instance, but Next.js may load this module in a separate instance for the
// route handlers — leaving their _userCache empty so createNotification finds no recipients. Calling
// this at the top of the API handler guarantees the cache is populated in the SAME module instance the
// handlers read from. Idempotent + cheap: only queries Mongo when the cache is still empty (mutations
// already refresh it), so warm requests are a no-op.
export async function ensureUserCache() {
  if (!_userCache || _userCache.length === 0) {
    await refreshUserCache();
  }
  return _userCache;
}
