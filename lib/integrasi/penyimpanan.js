// =====================================================================
// INTEGRASI PRODUCTIVITY APP — PENYIMPANAN (outbox, state, meta, kunci).
// ---------------------------------------------------------------------
// Disimpan di MongoDB (sumber data utama ERP) supaya tidak hilang saat kontainer dibangun ulang dan aman bila
// suatu saat ada lebih dari satu pod (kunci/lease mencegah dua pod memindai bersamaan). Koleksi baru, terpisah
// dari tabel ERP — tidak ikut mekanisme hidrasi/diff-persist route.js:
//   integrasi_outbox  { seq, id, jenis, waktu, uji, data, status: menunggu|terkirim|gagal, percobaan, berikut_at, galat, dibuat_at, terkirim_at }
//   integrasi_state   { _id: key, ...keadaan }   (lihat pemindai.js)
//   integrasi_meta    { _id: nama, ... }         (seq, mulai, ringkasan:<tgl>, kunci)
// Implementasi memori (buatPenyimpananMemori) dipakai uji.
// =====================================================================

export function buatPenyimpananMongo(getMongoDb) {
  const col = (n) => getMongoDb().collection(n);
  let indexed = false;
  async function siap() {
    if (indexed) return;
    await Promise.all([
      col('integrasi_outbox').createIndex({ seq: 1 }, { unique: true }),
      col('integrasi_outbox').createIndex({ status: 1, seq: 1 }),
    ]);
    indexed = true;
  }
  return {
    async muatState() { await siap(); const rows = await col('integrasi_state').find({}).toArray(); const m = new Map(); for (const r of rows) { const { _id, ...rest } = r; m.set(_id, rest); } return m; },
    async simpanState(entries) {
      if (!entries.length) return;
      await col('integrasi_state').bulkWrite(entries.map(([k, v]) => ({ replaceOne: { filter: { _id: k }, replacement: { ...v }, upsert: true } })), { ordered: false });
    },
    async tambah(peristiwa, nowMs) {
      if (!peristiwa.length) return [];
      const r = await col('integrasi_meta').findOneAndUpdate({ _id: 'seq' }, { $inc: { n: peristiwa.length } }, { upsert: true, returnDocument: 'after' });
      const akhir = (r && (r.value ? r.value.n : r.n)) || peristiwa.length; let seq = akhir - peristiwa.length;
      const docs = peristiwa.map((p) => ({ seq: ++seq, ...p, status: 'menunggu', percobaan: 0, berikut_at: nowMs, galat: null, dibuat_at: nowMs, terkirim_at: null }));
      await col('integrasi_outbox').insertMany(docs, { ordered: true });
      return docs;
    },
    async antrean(limit = 50) { return col('integrasi_outbox').find({ status: 'menunggu' }, { projection: { _id: 0 } }).sort({ seq: 1 }).limit(limit).toArray(); },
    async ubah(seq, patch) { await col('integrasi_outbox').updateOne({ seq }, { $set: patch }); },
    async sejak(seq, limit = 500) { return col('integrasi_outbox').find({ seq: { $gt: seq } }, { projection: { _id: 0 } }).sort({ seq: 1 }).limit(limit).toArray(); },
    async ringkas() {
      const agg = await col('integrasi_outbox').aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray();
      const terakhir = await col('integrasi_outbox').find({ status: 'terkirim' }).sort({ seq: -1 }).limit(1).toArray();
      const galat = await col('integrasi_outbox').find({ galat: { $ne: null } }).sort({ seq: -1 }).limit(1).toArray();
      return { jumlah: Object.fromEntries(agg.map((x) => [x._id, x.n])), terkirimTerakhir: terakhir[0]?.terkirim_at || null, galatTerakhir: galat[0]?.galat || null };
    },
    async meta(nama) { const r = await col('integrasi_meta').findOne({ _id: nama }); return r || null; },
    async setMeta(nama, nilai) { await col('integrasi_meta').updateOne({ _id: nama }, { $set: nilai }, { upsert: true }); },
    // Lease sederhana: siapa pun yang memegang kunci yang belum kedaluwarsa menang; pemilik boleh memperpanjang.
    async kunci(pemilik, nowMs, ttlMs) {
      try {
        const r = await col('integrasi_meta').findOneAndUpdate(
          { _id: 'kunci', $or: [{ sampai: { $lt: nowMs } }, { pemilik }] },
          { $set: { pemilik, sampai: nowMs + ttlMs } },
          { upsert: true, returnDocument: 'after' },
        );
        const doc = r && (r.value !== undefined ? r.value : r);
        return !!doc && doc.pemilik === pemilik;
      } catch (e) {
        if (e && e.code === 11000) return false; // dokumen kunci dipegang pod lain (upsert bentrok)
        throw e;
      }
    },
  };
}

export function buatPenyimpananMemori() {
  const state = new Map(); const outbox = []; const meta = new Map(); let seq = 0;
  const salin = (o) => JSON.parse(JSON.stringify(o));
  return {
    _outbox: outbox,
    async muatState() { return new Map([...state].map(([k, v]) => [k, salin(v)])); },
    async simpanState(entries) { for (const [k, v] of entries) state.set(k, salin(v)); },
    async tambah(peristiwa, nowMs) { const docs = peristiwa.map((p) => ({ seq: ++seq, ...salin(p), status: 'menunggu', percobaan: 0, berikut_at: nowMs, galat: null, dibuat_at: nowMs, terkirim_at: null })); outbox.push(...docs); return docs; },
    async antrean(limit = 50) { return outbox.filter((x) => x.status === 'menunggu').slice(0, limit).map(salin); },
    async ubah(s, patch) { const x = outbox.find((o) => o.seq === s); if (x) Object.assign(x, patch); },
    async sejak(s, limit = 500) { return outbox.filter((x) => x.seq > s).slice(0, limit).map(salin); },
    async ringkas() { const j = {}; for (const x of outbox) j[x.status] = (j[x.status] || 0) + 1; return { jumlah: j }; },
    async meta(n) { return meta.has(n) ? salin(meta.get(n)) : null; },
    async setMeta(n, v) { meta.set(n, { ...(meta.get(n) || {}), ...salin(v) }); },
    async kunci(pemilik, nowMs, ttlMs) { const k = meta.get('kunci'); if (k && k.sampai >= nowMs && k.pemilik !== pemilik) return false; meta.set('kunci', { pemilik, sampai: nowMs + ttlMs }); return true; },
  };
}
