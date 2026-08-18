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
      // Resolve the canonical base URL from env (preferred — never rely on a hardcoded domain).
      // Emergent production may inject one of these. As a LAST RESORT in production only, fall back
      // to the known public domain so better-auth redirects/callbacks use the correct origin and the
      // "Base URL is not set" warning is silenced. Any env var above overrides this fallback.
      baseURL:
        process.env.BETTER_AUTH_URL ||
        process.env.NEXT_PUBLIC_BASE_URL ||
        process.env.APP_URL ||
        process.env.EMERGENT_APP_URL ||
        (process.env.NODE_ENV === 'production' ? 'https://erp.ladangpangan.id' : undefined),
      // Accept any origin (safe for internal ERP MVP behind ingress). Wildcard is
      // supported via a request-based function in better-auth.
      trustedOrigins: (request) => {
        const origin = request?.headers?.get('origin');
        return origin ? [origin] : ['*'];
      },
      advanced: {
        // Secure cookies over HTTPS in production; relaxed for local http during dev/testing.
        defaultCookieAttributes: {
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
        },
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
