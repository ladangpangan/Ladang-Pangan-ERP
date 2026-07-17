import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb } from '../db/index.js';
import * as schema from '../db/schema.js';

let _auth;

export function getAuth() {
  if (!_auth) {
    const db = getDb();
    _auth = betterAuth({
      database: drizzleAdapter(db, {
        provider: 'sqlite',
        schema: {
          user: schema.user,
          session: schema.session,
          account: schema.account,
          verification: schema.verification,
        },
      }),
      secret: process.env.BETTER_AUTH_SECRET || 'lpi-erp-secret',
      baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_BASE_URL,
      // Accept any origin (safe for internal ERP MVP behind ingress). Wildcard is
      // supported via a request-based function in better-auth.
      trustedOrigins: (request) => {
        const origin = request?.headers?.get('origin');
        return origin ? [origin] : ['*'];
      },
      advanced: {
        defaultCookieAttributes: { sameSite: 'lax', secure: true },
      },
      emailAndPassword: {
        enabled: true,
        autoSignIn: true,
        minPasswordLength: 6,
      },
      user: {
        additionalFields: {
          role: { type: 'string', defaultValue: 'operator', input: true },
          status: { type: 'string', defaultValue: 'active', input: true },
        },
      },
      session: {
        expiresIn: 60 * 60 * 24 * 7, // 7 days
        updateAge: 60 * 60 * 24, // 1 day
      },
    });
  }
  return _auth;
}
