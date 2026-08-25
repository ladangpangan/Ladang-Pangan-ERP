// Seed script for Tally Outbound testing
// Usage: node seed_tally_test.js [seed|cleanup]

const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'erp.db');
const db = new Database(dbPath);

function uuid() {
  return crypto.randomUUID();
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function seed() {
  console.log('=== SEEDING TEST DATA ===');
  
  // Get existing product
  const product = db.prepare('SELECT id, name FROM products LIMIT 1').get();
  if (!product) {
    console.error('ERROR: No products found in database');
    process.exit(1);
  }
  console.log(`✓ Using product: ${product.name} (${product.id})`);
  
  // Get existing customer contact
  const customer = db.prepare("SELECT id, display_name FROM contacts WHERE categories LIKE '%Customer%' LIMIT 1").get();
  if (!customer) {
    console.error('ERROR: No customer contacts found');
    process.exit(1);
  }
  console.log(`✓ Using customer: ${customer.display_name} (${customer.id})`);
  
  // Get existing cold storage
  const coldStorage = db.prepare('SELECT id, code FROM cold_storages LIMIT 1').get();
  if (!coldStorage) {
    console.error('ERROR: No cold storages found');
    process.exit(1);
  }
  console.log(`✓ Using cold storage: ${coldStorage.code} (${coldStorage.id})`);
  
  // Get a zone for this cold storage
  const zone = db.prepare('SELECT id, code FROM zones WHERE cold_storage_id = ? LIMIT 1').get(coldStorage.id);
  if (!zone) {
    console.error('ERROR: No zones found for cold storage');
    process.exit(1);
  }
  console.log(`✓ Using zone: ${zone.code} (${zone.id})`);
  
  const now = unixNow();
  
  // Insert 3 inventory_stock rows
  const stocks = [
    { id: uuid(), kodeSimpan: 'QA-S1', weight: 45, productId: product.id, coldStorageId: coldStorage.id, zoneId: zone.id },
    { id: uuid(), kodeSimpan: 'QA-S2', weight: 55, productId: product.id, coldStorageId: coldStorage.id, zoneId: zone.id },
    { id: uuid(), kodeSimpan: 'QA-S3', weight: 120, productId: product.id, coldStorageId: coldStorage.id, zoneId: zone.id },
  ];
  
  const insertStock = db.prepare(`
    INSERT INTO inventory_stock (
      id, product_id, cold_storage_id, zone_id, kode_simpan, 
      packaging_type, quantity, weight, status, hpp_per_kg, 
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  for (const stock of stocks) {
    insertStock.run(
      stock.id, stock.productId, stock.coldStorageId, stock.zoneId, stock.kodeSimpan,
      'karung', 1, stock.weight, 'active', 20000,
      now, now
    );
    console.log(`✓ Created stock: ${stock.kodeSimpan} (${stock.weight} kg)`);
  }
  
  // Insert sales_order
  const soId = uuid();
  const soNumber = 'QA-SO-1';
  const orderDate = now;
  
  db.prepare(`
    INSERT INTO sales_order (
      id, customer_id, so_number, order_date, pipeline_status, 
      fulfillment_type, total_amount, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    soId, customer.id, soNumber, orderDate, 'Draft',
    'stock', 0, now, now
  );
  console.log(`✓ Created sales order: ${soNumber} (${soId})`);
  
  // Insert sales_order_items
  const itemId = uuid();
  const itemWeight = 100;
  const unitPrice = 25000;
  const subtotal = itemWeight * unitPrice;
  
  db.prepare(`
    INSERT INTO sales_order_items (
      id, sales_order_id, product_id, quantity, weight, 
      unit_price, subtotal
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    itemId, soId, product.id, 1, itemWeight,
    unitPrice, subtotal
  );
  console.log(`✓ Created SO item: ${itemWeight} kg @ Rp ${unitPrice}/kg`);
  
  // Update SO total
  db.prepare('UPDATE sales_order SET total_amount = ? WHERE id = ?').run(subtotal, soId);
  
  console.log('\n=== SEED DATA SUMMARY ===');
  console.log(`Product ID: ${product.id}`);
  console.log(`Customer ID: ${customer.id}`);
  console.log(`Cold Storage ID: ${coldStorage.id}`);
  console.log(`Zone ID: ${zone.id}`);
  console.log(`SO ID: ${soId}`);
  console.log(`SO Number: ${soNumber}`);
  console.log(`SO Item ID: ${itemId}`);
  console.log(`Stock IDs: ${stocks.map(s => s.id).join(', ')}`);
  console.log(`Stock Codes: ${stocks.map(s => s.kodeSimpan).join(', ')}`);
  
  // Write IDs to file for Python test to use
  const fs = require('fs');
  fs.writeFileSync('/app/test_ids.json', JSON.stringify({
    productId: product.id,
    customerId: customer.id,
    coldStorageId: coldStorage.id,
    zoneId: zone.id,
    soId: soId,
    soNumber: soNumber,
    itemId: itemId,
    stocks: stocks.map(s => ({ id: s.id, kodeSimpan: s.kodeSimpan, weight: s.weight }))
  }, null, 2));
  
  console.log('\n✓ Test IDs written to /app/test_ids.json');
}

function cleanup() {
  console.log('=== CLEANING UP TEST DATA ===');
  
  // Delete in correct order due to foreign keys
  const soId = db.prepare("SELECT id FROM sales_order WHERE so_number = 'QA-SO-1'").get()?.id;
  
  if (soId) {
    const deletedSoItemStocks = db.prepare('DELETE FROM so_item_stocks WHERE sales_order_id = ?').run(soId);
    console.log(`✓ Deleted ${deletedSoItemStocks.changes} so_item_stocks rows`);
    
    const deletedSoItems = db.prepare('DELETE FROM sales_order_items WHERE sales_order_id = ?').run(soId);
    console.log(`✓ Deleted ${deletedSoItems.changes} sales_order_items rows`);
    
    const deletedSo = db.prepare('DELETE FROM sales_order WHERE id = ?').run(soId);
    console.log(`✓ Deleted ${deletedSo.changes} sales_order rows`);
  } else {
    console.log('✓ No sales_order to delete');
  }
  
  const deletedStocks = db.prepare("DELETE FROM inventory_stock WHERE kode_simpan IN ('QA-S1', 'QA-S2', 'QA-S3')").run();
  console.log(`✓ Deleted ${deletedStocks.changes} inventory_stock rows`);
  
  // Verify cleanup
  console.log('\n=== VERIFICATION ===');
  const counts = {
    sales_order: db.prepare("SELECT COUNT(*) as c FROM sales_order WHERE so_number = 'QA-SO-1'").get().c,
    sales_order_items: db.prepare("SELECT COUNT(*) as c FROM sales_order_items WHERE sales_order_id = ?").get(soId || 'none').c,
    so_item_stocks: db.prepare("SELECT COUNT(*) as c FROM so_item_stocks WHERE sales_order_id = ?").get(soId || 'none').c,
    inventory_stock: db.prepare("SELECT COUNT(*) as c FROM inventory_stock WHERE kode_simpan IN ('QA-S1', 'QA-S2', 'QA-S3')").get().c,
  };
  
  console.log(`sales_order: ${counts.sales_order}`);
  console.log(`sales_order_items: ${counts.sales_order_items}`);
  console.log(`so_item_stocks: ${counts.so_item_stocks}`);
  console.log(`inventory_stock: ${counts.inventory_stock}`);
  
  if (counts.sales_order === 0 && counts.sales_order_items === 0 && counts.so_item_stocks === 0 && counts.inventory_stock === 0) {
    console.log('\n✅ CLEANUP SUCCESSFUL - All test data removed');
  } else {
    console.log('\n⚠️  WARNING - Some test data may remain');
  }
}

// Main
const command = process.argv[2] || 'seed';

if (command === 'seed') {
  seed();
} else if (command === 'cleanup') {
  cleanup();
} else {
  console.error('Usage: node seed_tally_test.js [seed|cleanup]');
  process.exit(1);
}

db.close();
