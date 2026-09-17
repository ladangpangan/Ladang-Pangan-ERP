# Deploy ke Hostinger VPS

Prasyarat di VPS (Ubuntu/Debian): `docker`, `docker compose` plugin, `nginx`, `certbot` (`python3-certbot-nginx`),
domain/subdomain yang sudah diarahkan (A record) ke IP VPS.

## 1. Siapkan MongoDB
Wajib — dipakai untuk login (Better Auth) dan backup durable file SQLite.
- Buat cluster gratis di MongoDB Atlas, buat database user, lalu di **Network Access** whitelist IP publik VPS ini.
- Salin connection string untuk `ATLAS_MONGO_URL` di `.env`.

## 2. Clone & konfigurasi
```bash
git clone <repo-url> /opt/erp
cd /opt/erp
cp .env.example .env
# edit .env: isi ATLAS_MONGO_URL, BETTER_AUTH_SECRET (openssl rand -base64 32),
# BETTER_AUTH_URL / APP_URL / CORS_ORIGINS = https://erp.yourdomain.id
```

## 3. Ganti kredensial default SEBELUM boot pertama
`lib/auth/seed-users.js` otomatis membuat 5 akun dengan password lemah (`admin123`, dst.) saat
koleksi user MongoDB masih kosong. Sebelum deploy publik: edit password di file itu, atau boot
sekali di jaringan tertutup lalu segera ganti password tiap akun lewat aplikasi, lalu hapus baris
kredensial dari `memory/PRD.md` (sudah ter-commit ke git, jangan biarkan publik).

## 4. Build & jalankan
```bash
mkdir -p data && chown -R 1001:1001 data   # container jalan sebagai uid 1001 (non-root)
docker compose build
docker compose up -d
docker compose logs -f app   # cek boot sukses (restore/seed, tidak ada error Mongo auth)
```
Data (`data/erp.db`, `data/uploads`) tersimpan di `./data` di host lewat volume — aman lintas rebuild.

Kalau lupa `chown` di atas dan Docker sudah keburu membuat `./data` sebagai `root`, log akan menunjukkan
`attempt to write a readonly database` — perbaiki dengan `docker compose down`, jalankan `chown` di atas,
lalu `docker compose up -d` lagi (tidak perlu build ulang).

## 4b. (Opsional) Preview cepat tanpa Nginx dulu
Untuk cek aplikasi jalan lewat `http://<VPS-IP>:3000` sebelum setup Nginx/domain: tambahkan
`APP_BIND_IP=0.0.0.0` **dan** `COOKIE_SECURE=0` ke `.env`, lalu `docker compose up -d` seperti
biasa (tidak perlu file compose kedua). Tanpa `COOKIE_SECURE=0`, login akan terlihat berhasil
tapi langsung terpental balik ke halaman login — browser diam-diam membuang cookie sesi karena
flag `Secure`-nya butuh HTTPS. Ini HTTP biasa (tanpa TLS) — jangan dibiarkan lama, dan buka port dulu:
```bash
sudo ufw allow 3000/tcp
```
Setelah selesai preview, hapus baris `APP_BIND_IP` dari `.env` (atau set balik ke `127.0.0.1`),
`docker compose up -d` lagi, dan tutup port: `sudo ufw delete allow 3000/tcp`.

## 5. Nginx + HTTPS
```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/erp.yourdomain.id
sudo ln -s /etc/nginx/sites-available/erp.yourdomain.id /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d erp.yourdomain.id
```

## 6. Firewall
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # 80 + 443
sudo ufw enable
```
Port 3000 tidak perlu dibuka ke publik — docker-compose sudah bind ke `127.0.0.1:3000` saja.

## 7. Update / redeploy berikutnya
```bash
cd /opt/erp
git pull
docker compose build
docker compose up -d
```

## Catatan penting
- **Jangan jalankan lebih dari 1 instance app** (`docker compose up -d --scale app=2` dilarang) —
  data transaksi masih di SQLite per-instance, replika ganda akan membuat data pecah.
- Fitur AI assistant butuh `EMERGENT_LLM_KEY` (opsional) — cek ke Emergent apakah key ini bisa
  dipakai dari luar platform mereka sebelum mengandalkannya di produksi.
- Backup tambahan disarankan: cron `cp ./data/erp.db` ke lokasi lain / off-site secara berkala,
  di luar mekanisme auto-backup GridFS bawaan aplikasi.
