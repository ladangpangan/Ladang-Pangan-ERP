# Model angka tulisan spidol (Tally)

Model kecil pengenal angka (0–9 + "bukan angka") yang dipakai `lib/ocr/digit-ocr.js` untuk membaca
kode simpan yang ditulis spidol di karung. Hasilnya `public/ocr-model/digits-v1.json` (bobot int8).

Data latih:
- MNIST (angka tulisan tangan), diunduh ke `data/`.
- Angka sintetis dari ±50 font tulisan tangan, dipotong dengan segmentasi yang sama dengan aplikasi
  (`gen-synth.cjs`, dijalankan di Chromium/Playwright; menulis `data/synth-x.bin` dan `data/synth-y.bin`).

Melatih ulang (butuh Python, `numpy`, `torch`): `python train.py`, lalu salin `digits-v1.json` ke `public/ocr-model/`.

Kalau nanti ada foto tulisan asli dari gudang, tambahkan potongan angkanya ke data latih supaya
model makin cocok dengan gaya tulisan petugas.
