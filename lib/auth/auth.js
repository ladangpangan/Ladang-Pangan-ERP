import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { getMongoClient, getMongoDb } from '../db/mongo.js';

let _auth;

export function getAuth() {
  if (!_auth) {
    _auth = betterAuth({
      // Store users/sessions/accounts in MongoDB (shared across replicas) so login works
      // correctly on multi-replica production. transaction:false because the preview mongod is a
      // standalone (no replica set) and standalone Mongo does not support multi-doc transactions.
      database: mongodbAdapter(getMongoDb(), {
        client: getMongoClient(),
        transaction: false,
      }),
      secret: process.env.BETTER_AUTH_SECRET || 'lpi-erp-secret',
      // Resolve the canonical base URL from env only (never hardcode a domain). Emergent injects the
      // correct app URL (APP_URL / EMERGENT_APP_URL) at deploy time, which silences the "Base URL is
      // not set" warning and makes redirects/callbacks correct. If none resolve (e.g. local dev),
      // better-auth safely derives the origin from the incoming request.
      baseURL:
        process.env.BETTER_AUTH_URL ||
        process.env.NEXT_PUBLIC_BASE_URL ||
        process.env.APP_URL ||
        process.env.EMERGENT_APP_URL ||
        undefined,
      // Accept any origin (safe for internal ERP MVP behind ingress). Wildcard is
      // supported via a request-based function in better-auth.
      trustedOrigins: (request) => {
        const origin = request?.headers?.get('origin');
        return origin ? [origin] : ['*'];
      },
      advanced: {
        // Behind the Kubernetes ingress/load-balancer, `x-forwarded-for` is a CHAIN of IPs
        // (client, ingress, lb, ...). Without trustedProxies, better-auth only trusts a
        // single-value header, so it cannot resolve the client IP -> it falls back to ONE
        // shared rate-limit bucket for all replicas/clients, which can trigger spurious 429s
        // (breaking login / health probes on deploy). Trusting the internal PRIVATE proxy
        // hops lets it strip them and resolve the real client IP => per-client buckets.
        ipAddress: {
          ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
          trustedProxies: [
            '10.0.0.0/8',
            '172.16.0.0/12',
            '192.168.0.0/16',
            '127.0.0.0/8',
            '::1/128',
            'fc00::/7',
          ],
        },
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
