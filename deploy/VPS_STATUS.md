# Status Deploy VPS Hostinger (KVM 2) — Handoff

Dibuat: 2026-09-17. Lanjutan dari sesi Claude Code sebelumnya (lihat juga `HANDOFF.md` untuk
konteks fitur aplikasi, dan `deploy/DEPLOY.md` untuk panduan deploy manual via SSH yang lebih
lengkap termasuk Nginx+HTTPS).

## Ringkasan environment

- **VPS**: Hostinger KVM 2, hostname `srv1956504.hstgr.cloud`, **VM ID `1956504`**, IP
  `148.230.102.34`, lokasi Jakarta.
- VM ini **sudah ada aplikasi lain** bernama **"Hermes Workspace"** (2 container, Aktif) —
  jangan diganggu/dihapus saat mengubah apa pun di VM ini.
- Akun Hostinger juga punya **KVM 1** (VPS terpisah, tidak dipakai untuk app ini).
- **Domain**: `erp.ladangpangan.id` — DNS A record sudah diarahkan ke `148.230.102.34`.
  Sebelumnya domain ini terhubung ke aplikasi ERP versi lama (dideploy lewat platform
  "Emergent", di belakang Cloudflare) — sudah diganti atas persetujuan user.

## Yang sudah dikerjakan

1. **Repo & branch**: kode dideploy dari `github.com/ladangpangan/Ladang-Pangan-ERP`, branch
   `main` (branch `main` dan `claude/serene-brahmagupta-wxd66w` isinya identik per commit
   `11979be`/`865ca63` — lihat `HANDOFF.md` untuk detail kenapa keduanya punya riwayat git
   terpisah/unrelated histories).
2. **Deploy**: dilakukan lewat Hostinger MCP tool `VPS_createNewProjectV1` (bukan SSH manual),
   membuat Docker Compose project bernama **`ladang-pangan-erp`** di VM `1956504`. Tool ini
   men-deploy langsung dari URL GitHub repo (auto-resolve `docker-compose.yaml` + clone source
   untuk build context).
3. **Docker port dibuat configurable**: `docker-compose.yml` diubah supaya port host bisa diatur
   lewat `APP_HOST_PORT` (default tetap 3000, tidak breaking untuk deploy lain). Ini karena VM
   sudah ada app lain yang mungkin pakai port 3000.
4. **Status saat ini: APP SUDAH JALAN & BISA DIAKSES** di `http://148.230.102.34:3001`
   (terverifikasi via screenshot user — halaman login render normal, "PT Ladang Pangan
   Indonesia ERP").
5. **Firewall**: dicek, tidak ada rule sama sekali di Hostinger Cloud Firewall untuk VM ini —
   bukan penyebab masalah apa pun ke depannya.
6. Env vars yang sudah ter-deploy di project `ladang-pangan-erp` (lewat parameter `environment`
   saat create project, TIDAK ditulis ke file/commit apa pun — hanya tersimpan di konfigurasi
   Docker project di VPS):
   - `NODE_ENV=production`
   - `DB_PATH=/app/data/erp.db`
   - `ATLAS_MONGO_URL=...` (connection string MongoDB Atlas produksi — **sudah pernah diketik
     user di chat lama, sebaiknya password-nya dirotasi** kalau belum, lalu update env var ini
     lagi kalau berubah)
   - `MONGO_DB_NAME=erp_prod`
   - `BETTER_AUTH_SECRET=...` (digenerate random sekali, tidak perlu diganti kecuali dicurigai bocor)
   - `BETTER_AUTH_URL`, `APP_URL`, `CORS_ORIGINS` — saat ini masih `http://erp.ladangpangan.id:3001`
   - `APP_BIND_IP=0.0.0.0`
   - `APP_HOST_PORT=3001`
   - `COOKIE_SECURE=0` (karena belum ada HTTPS)

## Yang BELUM selesai / pending

1. **Ganti port 3001 → 80** supaya `http://erp.ladangpangan.id` bisa diakses tanpa port di URL.
   Caranya: redeploy project `ladang-pangan-erp` dengan env `APP_HOST_PORT=80` dan
   `APP_URL`/`BETTER_AUTH_URL`/`CORS_ORIGINS` di-set ke `http://erp.ladangpangan.id` (tanpa
   port). **Sempat dicoba tapi gagal karena koneksi Hostinger Connector terputus di sesi
   sebelumnya** — perlu dieksekusi ulang begitu tool Hostinger tersedia lagi.
2. **Setup Nginx + HTTPS/SSL** supaya bisa akses `https://erp.ladangpangan.id` (bukan HTTP
   biasa). Ini **butuh akses SSH manual** ke VPS — di luar kemampuan tool Hostinger API yang
   dipakai sejauh ini. Ikuti `deploy/DEPLOY.md` bagian 5 (Nginx + Certbot) setelah port 80
   terpasang.
3. Setelah HTTPS aktif: balikin `COOKIE_SECURE` (hapus/kosongkan, jangan `0`) dan pastikan
   `APP_URL`/dst pakai `https://`.
4. **Rotasi password MongoDB Atlas** (`ladangpanganid` di cluster `ladangpanganid.ikxic8p...`)
   karena sempat diketik plaintext di chat.
5. Pertimbangkan apakah **KVM 1** masih dipakai untuk sesuatu, atau bisa dipertimbangkan
   di-nonaktifkan/dikonsolidasi — belum dibahas di sesi ini.
6. Cek dari jaringan LAIN (bukan cuma HP user) untuk pastikan app benar-benar reachable dari
   luar, bukan cuma dari 1 titik jaringan tertentu.

## Kendala teknis yang perlu diketahui

- Tool `Hostinger_Connector` MCP **sempat disconnect di tengah sesi** dan tidak reconnect
  otomatis meski status di pengaturan sudah menunjukkan "connected" — kalau ini terulang lagi,
  solusinya adalah pindah ke sesi/chat baru (bukan sesuatu yang bisa diperbaiki dari dalam sesi
  yang sama).
- Tidak ada tool untuk list VPS beserta ID-nya secara langsung — VM ID harus dicari manual dari
  hPanel (ada di URL: `hpanel.hostinger.com/vps/<ID>/overview`).
- Tidak ada tool untuk melihat log/status container di VPS — verifikasi harus lewat curl
  manual atau screenshot dari hPanel Docker Manager.
