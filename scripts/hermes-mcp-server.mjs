#!/usr/bin/env node
// Standalone MCP (Model Context Protocol) server exposing this ERP's existing REST API to an
// MCP-capable AI agent (e.g. Hermes). It does not run inside the Next.js app — start it as its
// own process, pointed at a deployed ERP instance (Railway or the VPS):
//
//   ERP_BASE_URL=https://erp-staging-production-5bb1.up.railway.app \
//   ERP_AGENT_API_KEY=<same value as AGENT_API_KEY on the ERP server> \
//   node scripts/hermes-mcp-server.mjs
//
// See deploy/HERMES_INTEGRATION.md for the full setup (server-side AGENT_API_KEY, security notes,
// and how to point Hermes' MCP client config at this script).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = (process.env.ERP_BASE_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.ERP_AGENT_API_KEY || '';
if (!BASE_URL || !API_KEY) {
  console.error('[hermes-mcp-server] Missing ERP_BASE_URL or ERP_AGENT_API_KEY env vars.');
  process.exit(1);
}

async function callErp(method, path, { query, body } = {}) {
  const url = new URL(`/api${path.startsWith('/') ? path : '/' + path}`, BASE_URL);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

const API_OVERVIEW = `Ladang Pangan ERP REST API (frozen-chicken distribution, Next.js app under app/api/[[...path]]/route.js).
Common read paths: GET /sales-orders, /sales-orders/:id, /purchase-orders, /purchase-orders/:id,
  /contacts?type=Customer|Supplier|Dropshipper, /inventory/stocks, /finance/overview,
  /accounting/reports, /dashboard.
Common write paths (examples): POST /sales-orders (create), POST /sales-orders/:id/status {status},
  POST /sales-orders/:id/payments, POST /purchase-orders/:id/payments,
  POST /contacts/:id/commissions, POST /sales-orders/:id/rollback and
  POST /purchase-orders/:id/rollback {apply, full} — these two are DESTRUCTIVE and admin-only,
  ALWAYS call with apply:false first to preview before ever passing apply:true.
Every endpoint, role restriction and request body shape here is identical to what the ERP's own
web dashboard uses — when unsure of a path or body shape, say so rather than guessing.`;

const server = new McpServer({ name: 'ladang-pangan-erp', version: '1.0.0' });

server.registerTool('erp_read', {
  title: 'Read from Ladang Pangan ERP',
  description: `GET a path from the ERP REST API and return its JSON response.\n\n${API_OVERVIEW}`,
  inputSchema: {
    path: z.string().describe('API path after /api, e.g. "/sales-orders" or "/purchase-orders/abc-123"'),
    query: z.record(z.string()).optional().describe('Query string params, e.g. { "status": "Draft" }'),
  },
}, async ({ path, query }) => {
  const result = await callErp('GET', path, { query });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.ok };
});

server.registerTool('erp_write', {
  title: 'Write / execute an action in Ladang Pangan ERP',
  description: `POST, PUT, PATCH or DELETE a path on the ERP REST API to create/update/execute something (e.g. record a payment, change a status, create a Sales Order). Returns the JSON response.\n\n${API_OVERVIEW}`,
  inputSchema: {
    method: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']).describe('HTTP method'),
    path: z.string().describe('API path after /api, e.g. "/sales-orders/abc-123/payments"'),
    body: z.record(z.any()).optional().describe('JSON request body'),
  },
}, async ({ method, path, body }) => {
  const result = await callErp(method, path, { body });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.ok };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[hermes-mcp-server] connected via stdio. ERP base URL:', BASE_URL);
