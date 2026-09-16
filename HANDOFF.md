# Handoff — Ladang Pangan ERP: Deploy Audit + Fitur Baru

Ringkasan lengkap untuk lanjut di percakapan baru. Repo: `ladangpangan/Ladang-Pangan-ERP`.
**Semua kerjaan ada di branch `claude/serene-brahmagupta-wxd66w`** — belum di-merge ke main, belum ada PR.
(Branch lama `claude/audit-hostinger-vps-deploy-vpmqyi` sudah di-fast-forward-merge ke sini di awal sesi ini — isinya sama, lanjutkan di branch baru ini saja.)

## Konteks project
Next.js 15 + SQLite (Drizzle) + MongoDB, ERP untuk PT Ladang Pangan Indonesia (distribusi ayam beku).
Awalnya dibangun di platform Emergent, sedang dipindah ke hosting sendiri.

## Environment yang sudah jalan
1. **VPS Hostinger** — IP `148.230.102.34`, Ubuntu 24.04, Docker+Compose terpasang, folder project di `/opt/erp`.
   Staging jalan di `http://148.230.102.34:3000` (HTTP polos, `.env` punya `APP_BIND_IP=0.0.0.0` + `COOKIE_SECURE=0` — **wajib dibalik ke default aman sebelum jadi produksi asli**, lihat DEPLOY.md).
2. **Railway (baru)** — project `ladang-pangan-erp-staging`, service `erp-staging`, deploy dari branch kerja kita, live di
   `https://erp-staging-production-5bb1.up.railway.app`. Terhubung ke **cluster MongoDB Atlas terpisah** (`stagginglpi.pjzvgz3.mongodb.net`, db `erp_prod`, hasil copy dari cluster produksi via `mongodump | mongorestore`). Ini dimaksudkan jadi "sandbox" testing sebelum rilis ke VPS — mirip alur kerja di Emergent dulu.
   **Catatan penting**: sesi Claude Code di sandbox web/cloud **tidak bisa browse ke URL Railway/VPS ini sendiri** (kebijakan jaringan sandbox memblokir domain di luar daftar putih, termasuk HTTPS biasa) — screenshot/verifikasi visual harus dilakukan user sendiri di browser. Juga **tidak bisa konek raw-TCP ke MongoDB** — semua kerja backend di sandbox diuji lewat SQLite temp DB murni (lihat catatan testing di Fitur #1 di bawah), bukan lewat live Mongo.

## Yang SUDAH selesai & di-push
- **Setup deploy VPS**: `Dockerfile`, `docker-compose.yml`, `.env.example`, `deploy/DEPLOY.md`, `deploy/nginx.conf.example`.
- **6 bug diperbaiki**: privilege escalation lewat sign-up (`lib/auth/auth.js`), restore Mongo yang bisa menimpa data lokal saat restart (`lib/db/persistence.js`), race alokasi stok, dobel-ledger saat retry konfirmasi SO, SKU produk bisa duplikat, race nomor SO/PO/Invoice.
- **3 bug staging**: port conflict Docker Compose (`APP_BIND_IP`), permission folder data (`chown 1001:1001`), cookie session gagal di HTTP (`COOKIE_SECURE`).
- **`scripts/check_stale_deletes.js`** — diagnostik baca-saja untuk cek apakah 3 SO/PO yang pernah "dihapus" pakai script lama (`SO/202608/0021`, `0028`, `0029`) masih nyangkut di SQLite. **User belum menjalankan ini** — jalankan di VPS: `docker compose exec app node scripts/check_stale_deletes.js`. Tidak lagi blocking untuk lanjut ke fitur lain (user memutuskan lanjut duluan).
- **Fitur #2 — Potongan Cashback untuk invoice kurang bayar**: SELESAI, **user sudah verifikasi visual** dan konfirmasi OK.
- **Fitur #3 — Edit/tambah komisi kapan saja sebelum dibayar**: ternyata **sudah ada dari awal** (bukan fitur baru) — `CommissionTab` di halaman Kontak → tab Komisi (`app/dashboard/contacts/page.js`), backend `POST/PUT/DELETE /contacts/:id/commissions[/:rid]` di `route.js`, sudah sepenuhnya lepas dari status SO, hanya gated oleh `commission_records.status != 'paid'`. Dikonfirmasi aman secara akuntansi: komisi unpaid tidak pernah dijurnal (jurnal komisi lahir dari `commission_payments` saat dibayar, lihat `lib/accounting/engine.js` `syncLedger()`). Yang ditambahkan sesi ini: shortcut edit/tambah komisi langsung dari halaman detail SO (`components lewat CommissionCard` di `app/dashboard/sales-orders/[id]/page.js`), tanpa perlu pindah ke halaman Kontak.
- **Fitur #1 — Rollback & Hapus Total SO/PO**: SELESAI. `POST /sales-orders/:id/rollback` dan `POST /purchase-orders/:id/rollback` (body `{ apply, full }`), admin-only. `apply=false` = preview (baca saja), `apply=true` = eksekusi (backup JSON otomatis ke `data/backups/` dulu). `full=false` = rollback ke Draft (item dipertahankan), `full=true` = hapus total. PO dropship otomatis milik sebuah SO ikut diproses dalam aksi yang sama. Diblokir (SEBELUM ada mutasi apa pun) kalau: PO dipakai Work Order (Maklon), atau ada kode simpan hasil inbound PO yang sudah bergerak (allocated/used) di tempat lain. Komisi yang sudah **paid** tidak dihapus (uangnya sudah keluar, lewat `commission_payments` yang lintas-SO) — hanya dilepas tautannya. Logic ada di `lib/ops/so-po-rollback.js`, `recordLedger()` dipindah dari `route.js` ke `lib/inventory/ledger.js` biar bisa dipakai bareng. UI "Zona Berbahaya" (preview + ketik-nomor-untuk-konfirmasi) di `components/danger-zone-rollback.jsx`, dipasang di halaman detail SO & PO. **Divalidasi dengan test fungsional standalone** (SQLite temp real schema, tanpa Mongo live) — cek `git log` untuk detail skenario yang diuji (preview vs apply, rollback vs full delete, cascade SO→PO, komisi paid dipertahankan, kedua kondisi blocking gagal sebelum mutasi apa pun). **Belum diuji di browser sungguhan oleh user** (sandbox ini tidak bisa akses Mongo/browser Railway-VPS).

## Koreksi arsitektur penting (session ini menemukan info yang salah di versi handoff sebelumnya)
- **Purchase Order BUKAN SQLite-only** seperti dugaan sebelumnya — PO (+items, GRN, payments, returns), **komisi** (`commission_records`/`commission_payments`), dan SO-extras (surat_jalan, sales_returns, sales_order_receipts+items) semuanya MongoDB-authoritative lewat `lib/db/potx-mongo.js` ("Phase 5" — bukan `purchase-order-mongo.js`, makanya kelewat sebelumnya). Ditemukan & diverifikasi langsung baca kodenya, bukan cuma dari laporan riset.
- Sinkronisasi ke Mongo untuk PO/SO-extra/komisi (potx-mongo), inventory_stock (inventory-mongo), inventory_transaction (tally-tx-mongo), approvals (wo-approval-mongo), notifications (misc-mongo) semuanya **otomatis** lewat mekanisme `captureSnapshot`/`persistSnapshotDiff` terpusat di `route.js`, asal `path[0]` request ada di *_PATHS Set yang relevan (`SALES_PATHS`, `INVENTORY_PATHS`, `POTX_PATHS`, dst. — lihat `route.js` baris ~240-315). **Sudah ditambahkan**: `'purchase-orders'` ke `INVENTORY_PATHS` (sebelumnya tidak ada, padahal endpoint rollback PO baru bisa mengubah `inventory_stock`).
- `stock_ledger` (Kartu Stok) **BEDA POLA** — bukan diff-persist, tapi insert fire-and-forget + merge-hydrate (`lib/accounting/journal-mongo.js`). Kalau menghapus baris `stock_ledger`, HARUS eksplisit hapus di kedua sisi (SQLite lokal + koleksi Mongo `stock_ledger`), tidak otomatis seperti tabel lain.
- Jurnal akuntansi (`journal_entries`) untuk SO/PO **selalu** `is_auto=1`, diregenerasi otomatis oleh `acct.syncLedger()` — tidak pernah perlu dihapus manual, cukup hapus baris sumbernya (payment, retur, dst.) dan jurnalnya otomatis hilang di render berikutnya.
- `commission_payments` **TIDAK PUNYA** kolom `sales_order_id` — satu pembayaran komisi bisa mencakup beberapa `commission_records` lintas SO ("Lunasi Semua"). Makanya saat SO dihapus/rollback, commission_records yang **unpaid** aman dihapus, tapi yang **paid** harus dipertahankan (skema sudah sedia `onDelete:'set null'` untuk pola ini) — script lama (`rollback_so_po.js`/`delete_so_po.js`) tidak menangani ini dengan benar.

## Temuan lain (belum ditindaklanjuti, perlu keputusan user)
- **`data/erp.db`, `data/erp.db-wal/-shm`, dan beberapa file di `data/uploads/` (termasuk dokumen upload asli, mis. GRN/kontak) TER-COMMIT di git**, padahal `.gitignore` sudah melarang pola ini sejak lama — kemungkinan file-file ini masuk SEBELUM aturan `.gitignore` itu ditambahkan, dan `.gitignore` tidak retroaktif meng-untrack. Ini berarti data transaksi (mungkin termasuk data nyata) ada di riwayat git. **Belum saya hapus** karena ini perubahan sensitif (riwayat git, mungkin perlu BFG/filter-repo untuk benar-benar bersih) — perlu keputusan & konfirmasi eksplisit dari user sebelum bertindak.

## Yang BELUM dikerjakan

### Keamanan (sebelum go-live produksi asli)
- Ganti password default yang di-seed otomatis (`admin@lpi.co.id`/`admin123`, dst. — di `lib/auth/seed-users.js`).
- Hapus kredensial admin yang ter-commit plaintext di `memory/PRD.md` (masih ada di riwayat git).
- **Rotate 3 password MongoDB Atlas** yang sempat terketik di chat (jangan pernah paste password ke chat lagi ke depannya):
  1. Cluster `customer-apps`, user `github-to-production`
  2. Cluster `ladangpanganid`, user `ladangpanganid`
  3. Cluster staging `stagginglpi`, user `ladangpanganindonesia4_db_user`
- Setup Nginx + domain asli + HTTPS di VPS, lalu balikin `APP_BIND_IP`/`COOKIE_SECURE` ke default aman, tutup port 3000 di firewall.
- Bersihkan `data/erp.db`/`data/uploads/*` dari riwayat git (lihat "Temuan lain" di atas) — perlu keputusan user dulu.
- Buat Pull Request untuk branch ini (ditawarkan, belum dibuat — user belum putuskan).

### Fitur baru yang diminta user
1. Rollback & Hapus SO/PO — **SELESAI**, lihat di atas. User perlu coba di Railway/VPS.
2. Potongan cashback — **SELESAI**, sudah diverifikasi user.
3. Edit/tambah komisi kapan saja sebelum dibayar — **SELESAI** (ternyata sudah ada + ditambah shortcut UI di SO).
4. **Integrasi Hermes Agent** (webhook atau MCP) — user sudah konfirmasi Hermes = **AI/LLM agent**. Masih perlu dikonfirmasi: (a) cuma baca data ERP, atau juga bisa eksekusi aksi (buat SO, catat pembayaran, dst.)? (b) mekanisme: webhook masuk ke ERP, MCP server yang ERP expose untuk dikonsumsi Hermes, atau ERP yang jadi client memanggil Hermes? Belum dikerjakan — perlu jawaban ini dulu.

## Fakta arsitektur penting (biar tidak salah asumsi lagi)
- **SQLite** = TIDAK ADA yang murni SQLite-only lagi di antara tabel transaksional utama (lihat koreksi PO di atas). SQLite sekarang murni cache per-pod yang di-hydrate dari Mongo untuk hampir semua tabel transaksi.
- **MongoDB** = otoritatif untuk: Sales Order (`sales-mongo.js`), Inventory Stock (`inventory-mongo.js`), COA & Journal & Stock Ledger (`coa-mongo.js`/`journal-mongo.js`), PO+Komisi+SO-extra (`potx-mongo.js`), Fixed Assets & Stock Opname (`assets-opname-mongo.js`), Work Order & Approvals (`wo-approval-mongo.js`), Tally Session & Inventory Transaction (`tally-tx-mongo.js`), Notifications & beberapa tabel kecil (`misc-mongo.js`).
- **MongoDB murni** (tanpa SQLite sama sekali) untuk: Auth (Better Auth), dual-write master data (products/cold-storages/contacts via `lib/db/masterdata.js`).
- `next start` **selalu** memaksa `NODE_ENV=production` secara internal, apa pun isi `.env` — makanya perlu env var `COOKIE_SECURE` terpisah, bukan andalkan `NODE_ENV`.
- Sandbox Claude Code di sesi cloud/web **tidak bisa**: konek raw-TCP (Mongo, SSH langsung ke VPS), atau browse ke domain sembarang di luar daftar putih. Kode backend yang menyentuh SQLite bisa diuji langsung di sandbox pakai temp DB (lihat pola test Fitur #1 di git log), tapi jalur Mongo/UI browser tetap harus dicoba user sendiri.

## Saran urutan lanjut
1. User coba Fitur #1 (Rollback & Hapus) di Railway/VPS — mulai dari SO/PO test/tidak penting dulu, cek hasilnya di UI & (kalau perlu) langsung ke Mongo.
2. User jalankan `check_stale_deletes.js` di VPS kapan sempat, laporkan hasilnya (tidak lagi blocking, tapi masih relevan untuk bersih-bersih data lama).
3. Jawab pertanyaan Fitur #4 (Hermes Agent) di atas supaya bisa mulai desain integrasinya.
4. Putuskan soal `data/erp.db` yang ter-commit di git (lihat "Temuan lain").
5. Masuk ke daftar keamanan pra-produksi (ganti password, rotate Mongo, Nginx+HTTPS, PR).
