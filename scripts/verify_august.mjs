import Database from 'better-sqlite3';
import * as acct from '/app/lib/accounting/engine.js';

const db = new Database('/app/data/erp.db');
const fmt = (n) => (Math.round(n)).toLocaleString('id-ID');
const AUG_FROM = Math.floor(Date.UTC(2026, 7, 1, 0, 0, 0) / 1000);
const AUG_TO = Math.floor(Date.UTC(2026, 7, 31, 23, 59, 59) / 1000);

console.log('=== LABA RUGI Agustus 2026 ===');
const is = acct.incomeStatement(db, { from: AUG_FROM, to: AUG_TO });
console.log('Pendapatan (Penjualan):', fmt(is.revenue.total));
is.revenue.items.forEach(i => console.log('   ', i.code, i.name, fmt(i.amount)));
console.log('HPP:', fmt(is.cogs.total));
is.cogs.items.forEach(i => console.log('   ', i.code, i.name, fmt(i.amount)));
console.log('LABA KOTOR:', fmt(is.grossProfit));
console.log('Beban Operasional:', fmt(is.expense.total));
is.expense.items.forEach(i => console.log('   ', i.code, i.name, fmt(i.amount)));
console.log('LABA OPERASIONAL:', fmt(is.operatingProfit));
console.log('LABA BERSIH:', fmt(is.netIncome));

console.log('\n=== NERACA per 31 Agustus 2026 ===');
const bs = acct.balanceSheet(db, { asOf: AUG_TO });
console.log('-- ASET --');
bs.assets.groups.forEach(g => { console.log(' ', g.category, fmt(g.total)); g.items.forEach(i => console.log('     ', i.code, i.name, fmt(i.amount))); });
console.log('TOTAL ASET:', fmt(bs.totalAssets));
console.log('-- LIABILITAS --');
bs.liabilities.groups.forEach(g => { console.log(' ', g.category, fmt(g.total)); g.items.forEach(i => console.log('     ', i.code, i.name, fmt(i.amount))); });
console.log('  Total Liabilitas:', fmt(bs.liabilities.total));
console.log('-- EKUITAS --');
bs.equity.groups.forEach(g => { console.log(' ', g.category, fmt(g.total)); g.items.forEach(i => console.log('     ', i.code, i.name, fmt(i.amount))); });
console.log('  Total Ekuitas:', fmt(bs.equity.total));
console.log('TOTAL LIAB+EKUITAS:', fmt(bs.totalLiabilitiesEquity));
console.log('BALANCED?', bs.balanced);

console.log('\n=== NERACA SALDO (Trial Balance) per 31 Agu 2026 ===');
const tb = acct.trialBalance(db, { to: AUG_TO });
console.log('Total Debit :', fmt(tb.totalDebit));
console.log('Total Kredit:', fmt(tb.totalCredit));
console.log('BALANCED?', Math.abs(tb.totalDebit - tb.totalCredit) < 1);

console.log('\n=== KAS/BANK & PIUTANG/UTANG (kumulatif s/d 31 Agu) ===');
const ov = acct.overview(db);
console.log('Kas:', fmt(ov.kas), '| Bank:', fmt(ov.bank), '| Piutang:', fmt(ov.piutang), '| Utang:', fmt(ov.utang), '| Persediaan:', fmt(ov.persediaan));
db.close();
