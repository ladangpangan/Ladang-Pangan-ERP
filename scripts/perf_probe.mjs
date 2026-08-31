// Perf probe: login then time key endpoints (cold + warm). Uses NEXT_PUBLIC_BASE_URL.
import fs from 'fs';
const env = fs.readFileSync('/app/.env', 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const BASE = (get('NEXT_PUBLIC_BASE_URL') || 'http://localhost:3000').replace(/\/$/, '');
const API = BASE + '/api';

async function login(email, password) {
  const r = await fetch(API + '/auth/sign-in/email', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, referer: BASE + '/login' },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

async function time(cookie, path) {
  const t0 = Date.now();
  const r = await fetch(API + path, { headers: { cookie } });
  const ms = Date.now() - t0;
  let n = '';
  try { const j = await r.json(); n = Array.isArray(j.data) ? `${j.data.length} rows` : (j.data ? 'obj' : ''); } catch {}
  return { path, status: r.status, ms, n };
}

const adminEps = ['/sales-orders', '/purchase-orders', '/inventory/stocks', '/dashboard/summary'];
const acctEps = ['/accounting/overview', '/accounting/trial-balance', '/accounting/balance-sheet', '/accounting/journals'];

const admin = await login('admin@lpi.co.id', 'admin123');
const akuntan = await login('akuntan@lpi.co.id', 'akuntanlpi123');
console.log('BASE=', BASE, '\n');
for (let round = 1; round <= 3; round++) {
  console.log(`--- ROUND ${round} (${round === 1 ? 'COLD' : 'warm'}) ---`);
  for (const e of adminEps) { const res = await time(admin, e); console.log(`${res.ms.toString().padStart(6)}ms  ${res.status}  ${res.path}  ${res.n}`); }
  for (const e of acctEps) { const res = await time(akuntan, e); console.log(`${res.ms.toString().padStart(6)}ms  ${res.status}  ${res.path}  ${res.n}`); }
  console.log('');
}
