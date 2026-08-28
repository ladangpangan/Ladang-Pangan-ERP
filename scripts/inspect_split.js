// One-off: find recently split stocks (children with parent_stock_id) + opened parents.
const { MongoClient } = require('mongodb');

(async () => {
  const fs = require('fs');
  const envTxt = fs.readFileSync('/app/.env', 'utf8');
  const env = {};
  for (const line of envTxt.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const url = env.ATLAS_MONGO_URL || env.MONGO_URL;
  const dbName = env.MONGO_DB_NAME || 'erp_prod';
  const client = new MongoClient(url);
  await client.connect();
  const db = client.db(dbName);
  const col = db.collection('inventory_stock');

  const opened = await col.find({ status: 'opened' }).toArray();
  console.log('=== OPENED parents:', opened.length);
  for (const o of opened) {
    console.log(JSON.stringify({ id: o.id, kode: o.kode_simpan, pkg: o.packaging_type, w: o.weight, hpp: o.hpp_per_kg, openedAt: o.opened_at, product: o.product_id }));
  }

  const children = await col.find({ parent_stock_id: { $ne: null } }).toArray();
  console.log('=== CHILDREN (parent_stock_id set):', children.length);
  for (const c of children) {
    console.log(JSON.stringify({ id: c.id, kode: c.kode_simpan, pkg: c.packaging_type, w: c.weight, hpp: c.hpp_per_kg, parent: c.parent_stock_id, status: c.status, createdAt: c.created_at }));
  }
  await client.close();
})().catch(e => { console.error(e); process.exit(1); });
