# Integrasi Hermes Agent (AI/LLM agent eksternal)

Cara Hermes (atau AI agent lain) bisa **membaca data dan mengeksekusi aksi** di ERP ini,
lewat REST API yang sama yang dipakai dashboard web-nya sendiri — tidak ada endpoint
terpisah yang perlu dijaga sinkron dari sekarang. Ada dua cara pakai, keduanya jalan di
atas mekanisme auth yang sama:

1. **Langsung lewat REST API** (paling simpel, cocok kalau Hermes bisa memanggil HTTP API sendiri).
2. **Lewat MCP server** (`scripts/hermes-mcp-server.mjs`) — kalau Hermes adalah MCP client
   (seperti Claude Code/Claude Desktop) yang lebih suka bicara protokol MCP daripada
   memanggil REST API mentah.

Kenapa bukan fitur "AI Assistant" yang sudah ada di dashboard (`/dashboard/ai-assistant`,
`POST /api/ai/chat`)? Fitur itu memanggil LLM-nya sendiri lewat Emergent LLM proxy
(`EMERGENT_LLM_KEY`) untuk menerjemahkan bahasa natural jadi aksi — cocok untuk user manusia
mengetik di dashboard, tapi kalau Hermes sendiri sudah punya "otak" LLM, memanggil LLM lain
di dalamnya jadi berlebihan (dan bergantung ke kredensial Emergent yang belum tentu masih
aktif di luar platform Emergent). Jalur di dokumen ini murni REST API biasa — tanpa
dependensi LLM apa pun di sisi ERP.

## 1. Setup di server ERP (sekali saja)

Di `.env` (VPS/Railway):

```
AGENT_API_KEY=<generate dengan: openssl rand -base64 32>
AGENT_ROLE=admin
```

- **Opt-in total**: kalau `AGENT_API_KEY` kosong/tidak diset, jalur ini tidak aktif sama
  sekali — nol perubahan perilaku untuk deployment yang belum butuh ini.
- `AGENT_ROLE` menentukan level akses Hermes, memakai role yang PERSIS sama dengan yang
  dipakai user manusia (`admin`, `supervisor`, `akuntan`, `direktur`, `operator`) — setiap
  endpoint yang sudah ada otomatis menerapkan pembatasan role yang sama ke Hermes. Default
  `admin` (akses ke hampir semua endpoint operasional). Endpoint **Rollback & Hapus SO/PO**
  khusus untuk role `direktur` (bukan `admin`) — set `AGENT_ROLE=direktur` kalau memang mau
  Hermes bisa memicu rollback/hapus juga; kalau tidak, biarkan `admin`/`supervisor`/`akuntan`
  supaya endpoint destruktif itu otomatis tertutup untuk Hermes. Turunkan ke `supervisor` atau
  `akuntan` kalau mau Hermes lebih terbatas ke baca-baca + aksi operasional biasa.
- **JANGAN** pernah tempel nilai `AGENT_API_KEY` yang asli ke chat/tiket/commit — perlakukan
  seperti password (pelajaran dari insiden password MongoDB Atlas yang sempat ke-expose di
  sesi sebelumnya).

Restart app setelah mengubah `.env` (`docker compose restart app` di VPS, atau redeploy di Railway).

## 2A. Opsi cepat: panggil REST API langsung

Setiap request cukup kirim header `Authorization: Bearer <AGENT_API_KEY>` (atau
`X-API-Key: <AGENT_API_KEY>`) — tidak perlu login/cookie sesi sama sekali.

```bash
# Baca daftar Sales Order
curl -H "Authorization: Bearer $AGENT_API_KEY" https://erp.example.com/api/sales-orders

# Catat pembayaran SO (eksekusi aksi)
curl -X POST -H "Authorization: Bearer $AGENT_API_KEY" -H "Content-Type: application/json" \
  -d '{"amount": 1000000, "method": "Transfer"}' \
  https://erp.example.com/api/sales-orders/<id>/payments
```

Semua endpoint yang ada di `app/api/[[...path]]/route.js` bisa dipanggil dengan cara yang
sama — path, method, dan bentuk body-nya identik dengan yang dipakai dashboard web.
Endpoint destruktif (`/sales-orders/:id/rollback`, `/purchase-orders/:id/rollback`) selalu
mendukung `{"apply": false}` untuk pratinjau sebelum `{"apply": true}` — Hermes (atau siapa
pun yang mengintegrasikannya) sebaiknya selalu preview dulu sebelum eksekusi sungguhan.

## 2B. Opsi MCP: `scripts/hermes-mcp-server.mjs`

Kalau Hermes adalah MCP client, jalankan script ini sebagai proses terpisah (bukan bagian
dari app Next.js) — dia jadi jembatan MCP ⇄ REST API di atas:

```bash
ERP_BASE_URL=https://erp.example.com \
ERP_AGENT_API_KEY=<sama dengan AGENT_API_KEY di server> \
node scripts/hermes-mcp-server.mjs
```

Transport-nya **stdio** (paling universal, dipakai Claude Desktop/Claude Code dan
kebanyakan MCP client lain) — di config MCP milik Hermes, daftarkan sebagai:

```json
{
  "mcpServers": {
    "ladang-pangan-erp": {
      "command": "node",
      "args": ["/path/ke/repo/scripts/hermes-mcp-server.mjs"],
      "env": {
        "ERP_BASE_URL": "https://erp.example.com",
        "ERP_AGENT_API_KEY": "<AGENT_API_KEY>"
      }
    }
  }
}
```

Server ini expose 2 tool generik (bukan satu tool per endpoint — supaya tidak perlu
diupdate tiap kali API-nya berubah):

- **`erp_read`** — `{ path, query? }` → `GET /api<path>?<query>`, kembalikan JSON.
- **`erp_write`** — `{ method, path, body? }` → `POST/PUT/PATCH/DELETE /api<path>` dengan
  `body`, kembalikan JSON.

Deskripsi tool-nya sudah memuat daftar path yang umum dipakai (SO, PO, kontak, inventory,
finance, accounting reports) supaya Hermes bisa menalar sendiri endpoint mana yang perlu
dipanggil, tanpa saya harus menulis ulang skema untuk tiap satu dari ~150 endpoint yang ada.

Sudah diuji end-to-end (handshake MCP, `tools/list`, pemanggilan `erp_read`/`erp_write`,
propagasi error) memakai MCP SDK resmi (`@modelcontextprotocol/sdk`) terhadap dev server
ERP sungguhan — lihat riwayat commit untuk detail skenario yang dicoba.

## Yang belum dikerjakan / perlu diputuskan nanti

- **Webhook keluar** (ERP → Hermes, mis. notifikasi "SO baru dibuat") belum dibangun — perlu
  tahu dulu URL & format penerima webhook di sisi Hermes. Dokumen ini baru menangani arah
  Hermes → ERP (Hermes yang memanggil masuk untuk baca/eksekusi).
- Kalau ternyata Hermes tidak mendukung MCP sama sekali, opsi 2A (REST API + Bearer token)
  saja sudah cukup — tidak perlu jalankan `hermes-mcp-server.mjs`.
- Audit trail: semua aksi lewat jalur ini tercatat dengan `createdBy: hermes-agent@integration.local`
  di kolom yang relevan (sama seperti user manusia lain), jadi bisa dibedakan dari aksi manual.
