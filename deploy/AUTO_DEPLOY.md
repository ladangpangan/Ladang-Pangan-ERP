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
