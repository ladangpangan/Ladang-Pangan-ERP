# Deploy otomatis ke VPS (GitHub Actions)

Setiap ada perubahan masuk ke branch `main`, workflow `.github/workflows/deploy-vps.yml` masuk ke VPS
lewat SSH, mengambil kode terbaru ke `/docker/ladang-pangan-erp`, lalu menjalankan
`docker compose up -d --build`. Folder `data/` dan file `.env` di VPS tidak disentuh.
Deploy pertama juga menghubungkan folder itu ke git (sekali saja) dan membackup `data/` ke `/root/`.

## Setup (sekali saja)

### 1. Buat kunci SSH khusus deploy — di VPS (PowerShell → `ssh root@148.230.102.34`)
```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "github-actions-deploy"
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/github_deploy
```
Salin SELURUH teks yang muncul dari perintah terakhir (mulai `-----BEGIN OPENSSH PRIVATE KEY-----`
sampai `-----END OPENSSH PRIVATE KEY-----`). Jangan kirim teks ini ke siapa pun / chat mana pun.

### 2. Simpan di GitHub Secrets
GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, buat 3:

| Name | Value |
|---|---|
| `VPS_HOST` | `148.230.102.34` |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | teks private key dari langkah 1 |

### 3. Coba
GitHub repo → tab **Actions** → **Deploy ke VPS** → **Run workflow**. Tunggu ±5–10 menit sampai
centang hijau. Kalau merah, klik untuk lihat log-nya.

## Mencabut akses
Hapus baris `github-actions-deploy` dari `~/.ssh/authorized_keys` di VPS, lalu hapus secret di GitHub.

## (Opsional) Batasi kunci hanya untuk deploy
Supaya kunci `github-actions-deploy` tidak bisa dipakai untuk hal lain selain update ERP (tidak bisa buka
terminal, baca file, dll), kunci itu dipaksa menjalankan satu skrip saja. Jalankan di VPS:

```bash
cat > /root/erp-deploy.sh <<'SCRIPT'
#!/bin/bash
set -e
cd /docker/ladang-pangan-erp
if [ ! -d .git ]; then
  cp -a data "/root/erp-data-backup-$(date +%F-%H%M)"
  git init -q
  git remote add origin https://github.com/ladangpangan/Ladang-Pangan-ERP.git
fi
git fetch --depth 1 origin main
git checkout -q -f -B main origin/main
echo "Deploy commit: $(git log -1 --format='%h %s')"
docker compose up -d --build
docker image prune -f
docker compose ps
SCRIPT
chmod 700 /root/erp-deploy.sh
sed -i 's|^ssh-ed25519 \(.*github-actions-deploy\)$|command="/root/erp-deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 \1|' ~/.ssh/authorized_keys
grep -c '^command="/root/erp-deploy.sh"' ~/.ssh/authorized_keys
```
Angka `1` di akhir = berhasil. Setelah ini, skrip yang dijalankan saat deploy adalah `/root/erp-deploy.sh`
di VPS (isi `script:` di workflow diabaikan) — kalau langkah deploy berubah, perbarui file itu juga.
