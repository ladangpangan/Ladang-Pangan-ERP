// Shared master-data constants (dipakai lintas modul: Produk, SO, PO, Inventory, Tally)

// Jenis Kemasan sesuai Master Produk
export const PACKAGING_TYPES = [
  { value: 'colly', label: 'Colly (Karung)' },
  { value: 'pack', label: 'Pack' },
  { value: 'keranjang', label: 'Keranjang' },
  { value: 'kardus', label: 'Kardus' },
];

// Label lengkap (termasuk pemetaan nilai legacy inventory: karung/box/drum/curah/lain)
export const PACKAGING_LABEL = {
  colly: 'Colly (Karung)',
  karung: 'Colly (Karung)',
  pack: 'Pack',
  keranjang: 'Keranjang',
  kardus: 'Kardus',
  box: 'Box',
  drum: 'Drum',
  curah: 'Curah',
  lain: 'Lainnya',
};

// Label ringkas untuk penanda Qty (mis. "Qty (Colly)")
export const PACKAGING_SHORT = {
  colly: 'Colly',
  karung: 'Colly',
  pack: 'Pack',
  keranjang: 'Keranjang',
  kardus: 'Kardus',
  box: 'Box',
  drum: 'Drum',
  curah: 'Curah',
  lain: 'Lainnya',
};

// Satuan Berat
export const WEIGHT_UNITS = [
  { value: 'kg', label: 'Kg (Kilogram)' },
  { value: 'gram', label: 'Gram' },
  { value: 'ton', label: 'Tonase (Ton)' },
];
export const WEIGHT_UNIT_LABEL = { kg: 'Kg', gram: 'Gram', ton: 'Ton' };

export const pkgLabel = (v) => PACKAGING_LABEL[v] || v || '-';
export const pkgShort = (v) => PACKAGING_SHORT[v] || v || 'Kemasan';
export const weightUnitLabel = (v) => WEIGHT_UNIT_LABEL[v] || v || 'Kg';
