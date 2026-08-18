// Seed the standard team accounts into MongoDB (Better Auth) on a fresh install.
// Idempotent: no-op once any user exists in the Mongo `user` collection.
import { getMongoDb } from '@/lib/db/mongo';
import { getAuth } from '@/lib/auth/auth';

const SEED_USERS = [
  { email: 'admin@lpi.co.id', password: 'admin123', name: 'Administrator', role: 'admin' },
  { email: 'supervisor@lpi.co.id', password: 'super123', name: 'Supervisor Ops', role: 'supervisor' },
  { email: 'direktur@lpi.co.id', password: 'direktur123', name: 'Direktur', role: 'direktur' },
  { email: 'operator@lpi.co.id', password: 'operator123', name: 'Operator RPH', role: 'operator' },
];

export async function seedAuthUsers() {
  try {
    const db = getMongoDb();
    const users = db.collection('user');
    const count = await users.countDocuments({});
    if (count > 0) return { seeded: false, reason: 'not-empty' };

    const auth = getAuth();
    let created = 0;
    for (const u of SEED_USERS) {
      try {
        await auth.api.signUpEmail({ body: { email: u.email, password: u.password, name: u.name } });
        await users.updateOne(
          { email: u.email },
          { $set: { role: u.role, status: 'active', emailVerified: true, updatedAt: new Date() } }
        );
        created++;
      } catch (e) {
        console.error('[seed-auth] failed for', u.email, ':', e?.message || e);
      }
    }
    // Note: the 4 auto-sign-in sessions created during seeding are ephemeral and expire on their
    // own — we intentionally do NOT bulk-delete the session collection (that would be destructive
    // and log out active users on multi-replica boots).
    console.log(`[seed-auth] seeded ${created} users into MongoDB`);
    return { seeded: true, created };
  } catch (e) {
    console.error('[seed-auth] failed:', e?.message || e);
    return { seeded: false, reason: 'error' };
  }
}
