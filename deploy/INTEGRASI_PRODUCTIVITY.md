# Integrasi ERP → Productivity App

ERP mengabarkan kejadian penting ke Productivity App (produktifitas.ladangpangan.id) lewat **jalur dalam server**
(jaringan Docker `lpi-internal` di VPS yang sama), tanpa lewat internet. Productivity App hanya menerima; ia tidak
pernah mengubah data ERP.

## Apa yang dikirim

| Kejadian di ERP | Kabar | Jadi apa di Productivity App |
|---|---|---|
| SO **Dikonfirmasi** (dan setiap perubahan kg/nilai/sales sesudahnya) | `penjualan.dibuat` | Realisasi kg target per saluran & per sales |
| SO dibatalkan / kembali Draft / dihapus | `penjualan.batal` | Realisasi dikurangi |
| Surat Jalan dibuat | `pengiriman.dibuat` | Tugas "Muat & kirim" untuk Kepala Gudang |
| Penerimaan barang di pelanggan / SO jadi faktur | `pengiriman.selesai` | Tugas itu selesai otomatis |
| Kontak Customer/Agen/Dropshipper baru | `pelanggan.dibuat` | Realisasi target klien baru |
| Pembayaran SO masuk | `pembayaran.diterima` | Dicatat |
| PO dikirim ke supplier (bukan Draft) | `pembelian.dibuat` | Tugas "Pastikan barang PO diterima" untuk Purchasing |
| PO Tanda Terima / Selesai | `pembelian.diterima` | Tugas selesai |
| PO dibatalkan / kembali Draft / dihapus | `pembelian.batal` | Tugas dibatalkan |
| Rekap tagihan diajukan ke Finance | `rekap.diajukan` | Tugas "Bayar rekap" untuk Finance |
| Rekap dibayar | `rekap.dibayar` | Tugas selesai |
| Pengajuan rekap dibatalkan / rekap dihapus | `rekap.dibatalkan` | Tugas dibatalkan |
| Invoice SO / PO belum lunas, jatuh tempo ≤ 3 hari lagi (atau lewat ≤ 90 hari) | `tagihan.jatuh_tempo` | Tugas "Tagih …" (piutang) atau "Bayar …" (utang) di tanggal jatuh tempo |
| Invoice itu lunas / batal | `tagihan.lunas` | Tugas selesai |
| Setiap hari setelah 06.00 WIB | `piutang.ringkasan`, `stok.ringkasan` | Angka piutang lewat 30/60 hari, stok kg, susut kirim bulan ini |

Yang **tidak pernah** dikirim: telepon, alamat, email, rekening, catatan bebas, password. Hanya data sejak tanggal mulai
(bawaan: awal bulan saat integrasi pertama kali aktif) yang dikirim, supaya riwayat lama tidak membanjiri.

**Sales di SO**: pilih di form Buat SO atau di detail SO (tab Info → Sales). Daftarnya = kontak berkategori
**Karyawan** atau **Mitra**. Kode kontaknya (mis. `KRY-0001`) diisi di Productivity App › Struktur Tim › Kode sales di ERP.

## Cara kerja singkat
- ERP memeriksa perubahan tiap ±1 menit, menyimpan kabar di antrean (MongoDB, koleksi `integrasi_outbox`), lalu
  mengirimnya berurutan dengan tanda tangan HMAC.
- Gagal kirim → dicoba lagi 1, 5, 15, 60 menit, lalu tiap jam sampai 24 jam.
- Productivity App juga **menarik** ulang tiap 15 menit dari `GET /api/integrasi/peristiwa` (pakai token), jadi kabar
  yang terlewat tetap sampai. Kabar ganda otomatis diabaikan.
- Pembatalan baru dikabarkan setelah terlihat 3 kali pemeriksaan berturut-turut (pengaman salah baca).
- Cek kesehatan (login admin/direktur/akuntan): buka `https://erp.ladangpangan.id/api/integrasi/status`.

## Langkah pasang (urut, sekali saja)

> Rahasia dan token **jangan** dikirim lewat chat, WhatsApp, atau ditulis di GitHub. Cukup ditempel di dua tempat:
> file `.env` ERP di VPS dan halaman Pengaturan Productivity App.

1. **Buat jaringan dalam server** (di VPS, terminal Hostinger):
   ```bash
   docker network create lpi-internal
   ```
   Kalau muncul "already exists", tidak apa-apa. **Langkah ini wajib sebelum Merge**, karena ERP versi baru
   bergabung ke jaringan ini; tanpa jaringan, update otomatis ERP berhenti (ERP lama tetap jalan).

2. **Buat rahasia dan token** (di VPS):
   ```bash
   openssl rand -hex 24   # hasil pertama = RAHASIA
   openssl rand -hex 24   # hasil kedua  = TOKEN
   ```
   Salin keduanya ke catatan sementara di komputer Anda (jangan ke chat).

3. **Isi `.env` ERP** (di VPS):
   ```bash
   cd /docker/ladang-pangan-erp
   nano .env
   ```
   Tambahkan di paling bawah (ganti tulisan dalam <> dengan hasil langkah 2):
   ```
   INTEGRASI_URL=http://produktivitas:3000/api/integrasi/erp
   INTEGRASI_RAHASIA=<RAHASIA>
   INTEGRASI_TOKEN=<TOKEN>
   ```
   Simpan: Ctrl+O, Enter, Ctrl+X.

4. **Merge Pull Request integrasi** di GitHub → ERP diperbarui otomatis (±10–20 menit).

5. **Perbarui Productivity App** dengan paket terbaru (folder di laptop sudah diperbarui), seperti biasa:
   ```bash
   bash deploy/pasang.sh produktifitas.ladangpangan.id
   ```

6. **Isi pengaturan di Productivity App**: Pengaturan › Integrasi › kartu **ERP**:
   - centang **Terima peristiwa dari ERP**
   - **Rahasia tanda tangan** = RAHASIA (sama persis dengan langkah 3)
   - **Token tarik** = TOKEN
   - **URL tarik peristiwa** = `http://erp:3000/api/integrasi/peristiwa`
   - pilih penerima tugas: **Pengiriman** (mis. Iqbal), **PO / pembelian** (otomatis Natasha), **Keuangan** (otomatis Aulia)
   - **Simpan**, lalu **Sinkron sekarang** → harus muncul "… baru, … sudah ada" (bukan "Gagal").

7. **Petakan** di kartu "Perlu dipetakan": jenis pelanggan ERP (`customer`, `agen`, `dropshipper`) ke saluran, dan
   kode sales yang belum dikenal ke orangnya. Antrean diproses ulang otomatis setelah dipetakan.

8. **Setelah data terbukti benar** (beberapa hari): di Struktur penjualan Productivity App, ubah sumber realisasi
   saluran Kontrak B2B dan Agen pasar menjadi **ERP**.

## Mematikan sementara
Kosongkan `INTEGRASI_RAHASIA` dan `INTEGRASI_TOKEN` di `.env`, lalu `docker compose up -d` di folder ERP; atau
hilangkan centang "Terima peristiwa dari ERP" di Productivity App (kabar ditolak, ERP menyimpan dan mengirim ulang nanti).

## Staging (Railway)
Isi `INTEGRASI_UJI=1` supaya semua kabar bertanda uji (tidak dihitung ke target). Railway tidak berada di jaringan
`lpi-internal`, jadi `INTEGRASI_URL` harus alamat publik (https://produktifitas.ladangpangan.id/api/integrasi/erp).
