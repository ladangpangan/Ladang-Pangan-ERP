# Handoff — Ladang Pangan ERP: Deploy Audit + Fitur Baru

Ringkasan lengkap untuk lanjut di percakapan baru. Repo: `ladangpangan/Ladang-Pangan-ERP`.
**Semua kerjaan ada di branch `claude/audit-hostinger-vps-deploy-vpmqyi`** — belum di-merge ke main, belum ada PR.

## Konteks project
Next.js 15 + SQLite (Drizzle) + MongoDB, ERP untuk PT Ladang Pangan Indonesia (distribusi ayam beku).
Awalnya dibangun di platform Emergent, sedang dipindah ke hosting sendiri.

## Environment yang sudah jalan
1. **VPS Hostinger** — IP `148.230.102.34`, Ubuntu 24.04, Docker+Compose terpasang, folder project di `/opt/erp`.
   Staging jalan di `http://148.230.102.34:3000` (HTTP polos, `.env` punya `APP_BIND_IP=0.0.0.0` + `COOKIE_SECURE=0` — **wajib dibalik ke default aman sebelum jadi produksi asli**, lihat DEPLOY.md).
2. **Railway (baru)** — project `ladang-pangan-erp-staging`, service `erp-staging`, deploy dari branch kerja kita, live di
   `https://erp-staging-production-5bb1.up.railway.app`. Terhubung ke **cluster MongoDB Atlas terpisah** (`stagginglpi.pjzvgz3.mongodb.net`, db `erp_prod`, hasil copy dari cluster produksi via `mongodump | mongorestore`). Ini dimaksudkan jadi "sandbox" testing sebelum rilis ke VPS — mirip alur kerja di Emergent dulu.
   **Catatan penting**: sesi Claude Code di sandbox web/cloud **tidak bisa browse ke URL Railway/VPS ini sendiri** (kebijakan jaringan sandbox memblokir domain di luar daftar putih, termasuk HTTPS biasa) — screenshot/verifikasi visual harus dilakukan user sendiri di browser.

## Yang SUDAH selesai & di-push
- **Setup deploy VPS**: `Dockerfile`, `docker-compose.yml`, `.env.example`, `deploy/DEPLOY.md`, `deploy/nginx.conf.example`.
- **6 bug diperbaiki**: privilege escalation lewat sign-up (`lib/auth/auth.js`), restore Mongo yang bisa menimpa data lokal saat restart (`lib/db/persistence.js` — sekarang cuma restore kalau file lokal kosong), race alokasi stok, dobel-ledger saat retry konfirmasi SO, SKU produk bisa duplikat, race nomor SO/PO/Invoice.
- **3 bug staging ditemukan & diperbaiki saat testing live**: port conflict Docker Compose (`APP_BIND_IP` env var), permission folder data (`chown 1001:1001`), cookie session gagal tersimpan di HTTP (`COOKIE_SECURE` env var).
- **`scripts/check_stale_deletes.js`** — diagnostik baca-saja untuk cek apakah 3 SO/PO yang pernah "dihapus" pakai script lama (`SO/202608/0021`, `0028`, `0029`) masih nyangkut di SQLite. **User belum menjalankan ini** — jalankan di VPS: `docker compose exec app node scripts/check_stale_deletes.js`.
- **Fitur #2 — Potongan Cashback untuk invoice kurang bayar**: SELESAI. `GET /sales-orders/:id/cashback-shortfall` (dipicu tombol "Hitung Kekurangan", tidak otomatis), `POST /cashback-refund` terima parameter `deduction`, `recomputeSoPaymentStatus` & jurnal akuntansi (`lib/accounting/engine.js`) disesuaikan supaya pakai nilai kas riil yang keluar. UI di `app/dashboard/sales-orders/[id]/page.js`. Sudah divalidasi lewat unit test logika murni (cocok dengan contoh user: SO 10jt→10,1jt, cashback 1jt, dibayar 10jt → kekurangan 100rb, cashback ditransfer 900rb, SO jadi Lunas). **Belum diverifikasi visual di browser** oleh user.

## Yang BELUM dikerjakan

### Keamanan (sebelum go-live produksi asli)
- Ganti password default yang di-seed otomatis (`admin@lpi.co.id`/`admin123`, dst. — di `lib/auth/seed-users.js`).
- Hapus kredensial admin yang ter-commit plaintext di `memory/PRD.md` (masih ada di riwayat git).
- **Rotate 3 password MongoDB Atlas** yang sempat terketik di chat sepanjang sesi ini (jangan pernah paste password ke chat lagi ke depannya):
  1. Cluster `customer-apps`, user `github-to-production`
  2. Cluster `ladangpanganid`, user `ladangpanganid`
  3. Cluster staging `stagginglpi`, user `ladangpanganindonesia4_db_user`
- Setup Nginx + domain asli + HTTPS di VPS, lalu balikin `APP_BIND_IP`/`COOKIE_SECURE` ke default aman, tutup port 3000 di firewall.
- Buat Pull Request untuk branch ini (ditawarkan, belum dibuat — user belum putuskan).

### 4 Fitur baru yang diminta user
1. **Rollback & Hapus SO/PO** (semua status termasuk Invoiced, admin-only, perlu preview sebelum eksekusi + backup otomatis seperti script lama) — **BELUM dikerjakan**. Nunggu hasil `check_stale_deletes.js` dulu. **Catatan arsitektur penting**: Sales Order itu MongoDB-authoritative (`lib/db/sales-mongo.js`, "Phase 3"), tapi Purchase Order **SQLite-only** (tidak ada `purchase-order-mongo.js`) — script lama (`scripts/rollback_so_po.js`, `delete_so_po.js`) salah asumsi PO ada di Mongo, jadi kemungkinan PO tidak benar-benar terhapus dulu. Endpoint baru harus push balik ke Mongo untuk perubahan SO (`persistSalesOrderToMongo`/`deleteSalesOrderFromMongo`), murni SQLite untuk PO.
2. Potongan cashback — selesai, lihat di atas. Tinggal verifikasi visual.
3. **Edit/tambah komisi kapan saja sebelum dibayar** (status SO apa pun, selama `commission_records.status != 'paid'`) — spek sudah dikonfirmasi user, **belum dikerjakan**.
4. **Integrasi Hermes Agent** (webhook atau MCP) — **masih belum jelas**: user belum jawab apakah Hermes itu agent AI/LLM atau automation biasa, dan apakah cuma perlu baca data atau juga bisa eksekusi aksi. Perlu ditanya ulang di awal sesi baru.

## Fakta arsitektur penting (biar tidak salah asumsi lagi)
- **SQLite** = otoritatif untuk: Purchase Order (+items, GRN, payments).
- **MongoDB** = otoritatif (SQLite jadi cache per-pod yang di-hydrate) untuk: Sales Order, Inventory, COA, Journals, POTX, Assets Opname, WO Approval, Tally TX, Misc — masing-masing punya file `lib/*/xxx-mongo.js` dengan pola `ensureXxxReady()`.
- **MongoDB murni** (tanpa SQLite sama sekali) untuk: Auth (Better Auth), dual-write master data (products/cold-storages/contacts via `lib/db/masterdata.js`).
- `next start` **selalu** memaksa `NODE_ENV=production` secara internal, apa pun isi `.env` — makanya dulu perlu env var `COOKIE_SECURE` terpisah, bukan andalkan `NODE_ENV`.
- Sandbox Claude Code di sesi cloud/web **tidak bisa**: konek raw-TCP (Mongo, SSH langsung ke VPS), atau browse ke domain sembarang (termasuk HTTPS biasa) di luar daftar putih kebijakan organisasi (npm, pypi, API Anthropic, dll). Semua kerja VPS harus lewat instruksi copy-paste ke user; semua kerja Railway lewat MCP tools (yang jalan normal), tapi cek visual hasilnya tetap harus user sendiri buka browser.

## Saran urutan lanjut
1. User verifikasi visual Fitur #2 (cashback) di Railway staging atau VPS.
2. User jalankan `check_stale_deletes.js`, laporkan hasilnya.
3. Lanjut desain & implementasi Fitur #1 (Rollback & Hapus) berdasarkan hasil no. 2.
4. Kerjakan Fitur #3 (edit komisi) — spek sudah jelas.
5. Tanya ulang detail Hermes Agent untuk Fitur #4.
6. Baru masuk ke daftar keamanan pra-produksi (ganti password, rotate Mongo, Nginx+HTTPS, PR).
