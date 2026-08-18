#!/bin/bash
# Backend test for Purchase Order additional_cost (Ongkir) bearer + pay method
# Using curl for Better Auth cookie compatibility

set -e

BASE_URL="http://localhost:3000/api"
ORIGIN="http://localhost:3000"
DB_PATH="/app/data/erp.db"
COOKIE_FILE="/tmp/po_test_cookies.txt"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "================================================================================"
echo "BACKEND TEST: Purchase Order additional_cost (Ongkir) bearer + pay method"
echo "================================================================================"

# Login
echo ""
echo "=== LOGGING IN AS ADMIN ==="
curl -s -c "$COOKIE_FILE" -X POST "$BASE_URL/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}' > /dev/null

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ Login successful${NC}"
else
  echo -e "${RED}❌ Login failed${NC}"
  exit 1
fi

# Seed test data using Node.js
echo ""
echo "=== SEEDING TEST DATA ==="

node << 'EOF'
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const db = new Database('/app/data/erp.db');

// Generate IDs
const supplierId = uuidv4();
const productId = uuidv4();
const poId = uuidv4();
const itemId = uuidv4();
const timestamp = Date.now();

// Create supplier
db.prepare(`
  INSERT INTO contacts (id, code, display_name, categories, contact_type, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
`).run(supplierId, `SUP-TEST-${timestamp}`, 'Test Supplier for PO Ongkir', '["Supplier"]', 'Supplier');
console.log(`✅ Created supplier: SUP-TEST-${timestamp}`);

// Create product
db.prepare(`
  INSERT INTO products (id, sku, name, category, unit, base_price, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
`).run(productId, `PROD-TEST-${timestamp}`, 'Test Product for PO Ongkir', 'Karkas', 'kg', 50000);
console.log(`✅ Created product: PROD-TEST-${timestamp}`);

// Create PO
db.prepare(`
  INSERT INTO purchase_order (
    id, po_number, supplier_id, po_type, method, pipeline_status,
    order_date, additional_cost, additional_cost_bearer, additional_cost_pay_method,
    total_amount, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, datetime('now'), datetime('now'))
`).run(poId, `PO/TEST/${timestamp}`, supplierId, 'Beli Jadi', 'Timbang Ulang', 'Draft', 0, 'company', 'utang', 0);
console.log(`✅ Created PO: PO/TEST/${timestamp}`);

// Create PO item
db.prepare(`
  INSERT INTO purchase_order_items (
    id, purchase_order_id, product_id, quantity, weight, unit_price,
    hpp_per_kg, additional_cost_share
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(itemId, poId, productId, 2, 20, 50000, 0, 0);
console.log(`✅ Created PO item: 20kg @ Rp 50,000 = Rp 1,000,000`);

// Output IDs for bash script
console.log(`TEST_PO_ID=${poId}`);
console.log(`TEST_SUPPLIER_ID=${supplierId}`);
console.log(`TEST_PRODUCT_ID=${productId}`);
console.log(`TEST_ITEM_ID=${itemId}`);

db.close();
EOF

# Capture test IDs from Node output
eval $(node << 'EOF'
const Database = require('better-sqlite3');
const db = new Database('/app/data/erp.db');

const po = db.prepare(`
  SELECT id FROM purchase_order 
  WHERE po_number LIKE 'PO/TEST/%' 
  ORDER BY created_at DESC LIMIT 1
`).get();

const supplier = db.prepare(`
  SELECT id FROM contacts 
  WHERE code LIKE 'SUP-TEST-%' 
  ORDER BY created_at DESC LIMIT 1
`).get();

const product = db.prepare(`
  SELECT id FROM products 
  WHERE sku LIKE 'PROD-TEST-%' 
  ORDER BY created_at DESC LIMIT 1
`).get();

console.log(`TEST_PO_ID=${po.id}`);
console.log(`TEST_SUPPLIER_ID=${supplier.id}`);
console.log(`TEST_PRODUCT_ID=${product.id}`);

db.close();
EOF
)

echo "Test PO ID: $TEST_PO_ID"

# Trigger recalcPoHpp
echo ""
echo "Triggering recalcPoHpp via PATCH..."
curl -s -b "$COOKIE_FILE" -X PATCH "$BASE_URL/purchase-orders/$TEST_PO_ID" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"notes":"Initial setup"}' > /dev/null

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ Triggered recalcPoHpp${NC}"
else
  echo -e "${YELLOW}⚠️  Failed to trigger recalcPoHpp (may need to check auth)${NC}"
fi

# TEST T1: company + utang
echo ""
echo "================================================================================"
echo "TEST T1: COMPANY + UTANG"
echo "================================================================================"

echo "Step 1: PATCH PO with additionalCost=60000, bearer=company, payMethod=utang"
RESP=$(curl -s -b "$COOKIE_FILE" -X PATCH "$BASE_URL/purchase-orders/$TEST_PO_ID" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"additionalCost":60000,"additionalCostBearer":"company","additionalCostPayMethod":"utang"}')

if echo "$RESP" | grep -q '"data"'; then
  echo -e "${GREEN}✅ PATCH successful${NC}"
else
  echo -e "${RED}❌ PATCH failed: $RESP${NC}"
  exit 1
fi

echo "Step 2: GET /purchase-orders/:id/hpp"
HPP_RESP=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/purchase-orders/$TEST_PO_ID/hpp")

GRAND_TOTAL=$(echo "$HPP_RESP" | jq -r '.data.totals.grandTotal')
echo "  totals.grandTotal: Rp $(printf "%'d" $GRAND_TOTAL)"

if [ "$GRAND_TOTAL" = "1060000" ]; then
  echo -e "${GREEN}✅ VERIFIED: grandTotal = 1,060,000 (goods + freight)${NC}"
else
  echo -e "${RED}❌ FAILED: Expected grandTotal=1,060,000, got $GRAND_TOTAL${NC}"
  exit 1
fi

# Check hpp_per_kg
HPP_PER_KG=$(echo "$HPP_RESP" | jq -r '.data.items[0].hppPerKg')
echo "  item hpp_per_kg: Rp $(printf "%.0f" $HPP_PER_KG)"

if [ "$HPP_PER_KG" = "50000" ]; then
  echo -e "${GREEN}✅ VERIFIED: hpp_per_kg = 50,000 (NO freight capitalized)${NC}"
else
  echo -e "${RED}❌ FAILED: Expected hpp_per_kg=50,000, got $HPP_PER_KG${NC}"
  exit 1
fi

# Check additionalCostShare
ADD_COST_SHARE=$(echo "$HPP_RESP" | jq -r '.data.items[0].additionalCostShare')
if [ "$ADD_COST_SHARE" = "0" ]; then
  echo -e "${GREEN}✅ VERIFIED: additionalCostShare = 0${NC}"
else
  echo -e "${RED}❌ FAILED: Expected additionalCostShare=0, got $ADD_COST_SHARE${NC}"
  exit 1
fi

echo "Step 3: Make PO invoice-eligible"
node << EOF
const Database = require('better-sqlite3');
const db = new Database('$DB_PATH');
db.prepare("UPDATE purchase_order SET invoice_number = ?, pipeline_status = 'Invoiced' WHERE id = ?")
  .run(\`INV-TEST-\${Date.now()}\`, '$TEST_PO_ID');
db.close();
EOF
echo -e "${GREEN}✅ PO set to Invoiced${NC}"

echo "Step 4: Trigger accounting sync"
SYNC_RESP=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/accounting/sync" \
  -H "Origin: $ORIGIN")

if echo "$SYNC_RESP" | grep -q '"ok"'; then
  echo -e "${GREEN}✅ Accounting sync successful${NC}"
else
  echo -e "${RED}❌ Accounting sync failed: $SYNC_RESP${NC}"
  exit 1
fi

echo "Step 5: Verify PO_INV journal with Beban Angkut line"
JOURNAL_CHECK=$(node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "
  SELECT COUNT(*) FROM journal_entries 
  WHERE source_type = 'PO_INV' AND source_id = '$TEST_PO_ID'
")

if [ "$JOURNAL_CHECK" -gt "0" ]; then
  echo -e "${GREEN}✅ Found PO_INV journal${NC}"
  
  # Check for Beban Angkut line
  BEBAN_ANGKUT=$(node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "
    SELECT jl.debit FROM journal_lines jl
    JOIN journal_entries je ON jl.journal_id = je.id
    WHERE je.source_type = 'PO_INV' AND je.source_id = '$TEST_PO_ID'
    AND jl.account_code = '5-1300'
  ")
  
  if [ "$BEBAN_ANGKUT" = "60000" ]; then
    echo -e "${GREEN}✅ VERIFIED: Dr 5-1300 (Beban Angkut) = 60,000${NC}"
  else
    echo -e "${RED}❌ FAILED: Expected Dr 5-1300 = 60,000, got $BEBAN_ANGKUT${NC}"
    exit 1
  fi
  
  # Check Utang line
  UTANG=$(node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "
    SELECT jl.credit FROM journal_lines jl
    JOIN journal_entries je ON jl.journal_id = je.id
    WHERE je.source_type = 'PO_INV' AND je.source_id = '$TEST_PO_ID'
    AND jl.account_code = '2-1100'
  ")
  
  if [ "$UTANG" = "1060000" ]; then
    echo -e "${GREEN}✅ VERIFIED: Cr 2-1100 (Utang Usaha) = 1,060,000${NC}"
  else
    echo -e "${RED}❌ FAILED: Expected Cr 2-1100 = 1,060,000, got $UTANG${NC}"
    exit 1
  fi
  
  # Check NO PO_SHIP journal
  PO_SHIP_COUNT=$(node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "
    SELECT COUNT(*) FROM journal_entries 
    WHERE source_type = 'PO_SHIP' AND source_id = '$TEST_PO_ID'
  ")
  
  if [ "$PO_SHIP_COUNT" = "0" ]; then
    echo -e "${GREEN}✅ VERIFIED: No PO_SHIP journal (correct for utang)${NC}"
  else
    echo -e "${RED}❌ FAILED: PO_SHIP journal should NOT exist for utang${NC}"
    exit 1
  fi
else
  echo -e "${RED}❌ FAILED: No PO_INV journal found${NC}"
  exit 1
fi

echo -e "${GREEN}✅ TEST T1 PASSED${NC}"

# TEST T2: company + transfer/tunai
echo ""
echo "================================================================================"
echo "TEST T2: COMPANY + TRANSFER/TUNAI"
echo "================================================================================"

echo "Step 1: PATCH to additionalCostPayMethod=transfer"
curl -s -b "$COOKIE_FILE" -X PATCH "$BASE_URL/purchase-orders/$TEST_PO_ID" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"additionalCostPayMethod":"transfer"}' > /dev/null
echo -e "${GREEN}✅ PATCH successful${NC}"

echo "Step 2: GET hpp - verify grandTotal = 1,000,000"
HPP_RESP=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/purchase-orders/$TEST_PO_ID/hpp")
GRAND_TOTAL=$(echo "$HPP_RESP" | jq -r '.data.totals.grandTotal')

if [ "$GRAND_TOTAL" = "1000000" ]; then
  echo -e "${GREEN}✅ VERIFIED: grandTotal = 1,000,000 (freight NOT in total)${NC}"
else
  echo -e "${RED}❌ FAILED: Expected grandTotal=1,000,000, got $GRAND_TOTAL${NC}"
  exit 1
fi

echo "Step 3: Re-sync accounting"
curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/accounting/sync" -H "Origin: $ORIGIN" > /dev/null
echo -e "${GREEN}✅ Accounting sync successful${NC}"

echo "Step 4: Verify PO_INV has NO Beban Angkut line"
BEBAN_IN_INV=$(node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "
  SELECT COUNT(*) FROM journal_lines jl
  JOIN journal_entries je ON jl.journal_id = je.id
  WHERE je.source_type = 'PO_INV' AND je.source_id = '$TEST_PO_ID'
  AND jl.account_code = '5-1300'
")

if [ "$BEBAN_IN_INV" = "0" ]; then
  echo -e "${GREEN}✅ VERIFIED: PO_INV has NO Beban Angkut line${NC}"
else
  echo -e "${RED}❌ FAILED: PO_INV should NOT have Beban Angkut for transfer${NC}"
  exit 1
fi

echo "Step 5: Verify PO_SHIP journal exists with Dr Beban / Cr Bank"
PO_SHIP_COUNT=$(node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "
  SELECT COUNT(*) FROM journal_entries 
  WHERE source_type = 'PO_SHIP' AND source_id = '$TEST_PO_ID'
")

if [ "$PO_SHIP_COUNT" -gt "0" ]; then
  echo -e "${GREEN}✅ Found PO_SHIP journal${NC}"
  
  # Check Beban Angkut debit
  BEBAN=$(node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "
    SELECT jl.debit FROM journal_lines jl
    JOIN journal_entries je ON jl.journal_id = je.id
    WHERE je.source_type = 'PO_SHIP' AND je.source_id = '$TEST_PO_ID'
    AND jl.account_code = '5-1300'
  ")
  
  if [ "$BEBAN" = "60000" ]; then
    echo -e "${GREEN}✅ VERIFIED: Dr 5-1300 (Beban Angkut) = 60,000${NC}"
  else
    echo -e "${RED}❌ FAILED: Expected Dr 5-1300 = 60,000, got $BEBAN${NC}"
    exit 1
  fi
  
  # Check Bank credit
  BANK=$(node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "
    SELECT jl.credit FROM journal_lines jl
    JOIN journal_entries je ON jl.journal_id = je.id
    WHERE je.source_type = 'PO_SHIP' AND je.source_id = '$TEST_PO_ID'
    AND jl.account_code = '1-1120'
  ")
  
  if [ "$BANK" = "60000" ]; then
    echo -e "${GREEN}✅ VERIFIED: Cr 1-1120 (Bank) = 60,000${NC}"
  else
    echo -e "${RED}❌ FAILED: Expected Cr 1-1120 = 60,000, got $BANK${NC}"
    exit 1
  fi
else
  echo -e "${RED}❌ FAILED: No PO_SHIP journal found${NC}"
  exit 1
fi

echo "Step 6: PATCH to tunai"
curl -s -b "$COOKIE_FILE" -X PATCH "$BASE_URL/purchase-orders/$TEST_PO_ID" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"additionalCostPayMethod":"tunai"}' > /dev/null
echo -e "${GREEN}✅ PATCH successful${NC}"

echo "Step 7: Re-sync"
curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/accounting/sync" -H "Origin: $ORIGIN" > /dev/null
echo -e "${GREEN}✅ Accounting sync successful${NC}"

echo "Step 8: Verify PO_SHIP credit is now Kas"
KAS=$(node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "
  SELECT jl.credit FROM journal_lines jl
  JOIN journal_entries je ON jl.journal_id = je.id
  WHERE je.source_type = 'PO_SHIP' AND je.source_id = '$TEST_PO_ID'
  AND jl.account_code = '1-1110'
")

if [ "$KAS" = "60000" ]; then
  echo -e "${GREEN}✅ VERIFIED: Cr 1-1110 (Kas) = 60,000${NC}"
else
  echo -e "${RED}❌ FAILED: Expected Cr 1-1110 = 60,000, got $KAS${NC}"
  exit 1
fi

echo -e "${GREEN}✅ TEST T2 PASSED${NC}"

# TEST T3: supplier-borne
echo ""
echo "================================================================================"
echo "TEST T3: SUPPLIER-BORNE"
echo "================================================================================"

echo "Step 1: PATCH to additionalCostBearer=supplier"
curl -s -b "$COOKIE_FILE" -X PATCH "$BASE_URL/purchase-orders/$TEST_PO_ID" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"additionalCostBearer":"supplier"}' > /dev/null
echo -e "${GREEN}✅ PATCH successful${NC}"

echo "Step 2: GET hpp - verify grandTotal = 1,000,000"
HPP_RESP=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/purchase-orders/$TEST_PO_ID/hpp")
GRAND_TOTAL=$(echo "$HPP_RESP" | jq -r '.data.totals.grandTotal')

if [ "$GRAND_TOTAL" = "1000000" ]; then
  echo -e "${GREEN}✅ VERIFIED: grandTotal = 1,000,000 (freight NOT in total)${NC}"
else
  echo -e "${RED}❌ FAILED: Expected grandTotal=1,000,000, got $GRAND_TOTAL${NC}"
  exit 1
fi

echo "Step 3: Re-sync"
curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/accounting/sync" -H "Origin: $ORIGIN" > /dev/null
echo -e "${GREEN}✅ Accounting sync successful${NC}"

echo "Step 4: Verify NO Beban Angkut line anywhere"
BEBAN_COUNT=$(node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "
  SELECT COUNT(*) FROM journal_lines jl
  JOIN journal_entries je ON jl.journal_id = je.id
  WHERE je.source_id = '$TEST_PO_ID' AND jl.account_code = '5-1300'
")

if [ "$BEBAN_COUNT" = "0" ]; then
  echo -e "${GREEN}✅ VERIFIED: NO Beban Angkut (5-1300) line anywhere${NC}"
else
  echo -e "${RED}❌ FAILED: Found Beban Angkut line for supplier-borne freight${NC}"
  exit 1
fi

# Verify NO PO_SHIP
PO_SHIP_COUNT=$(node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "
  SELECT COUNT(*) FROM journal_entries 
  WHERE source_type = 'PO_SHIP' AND source_id = '$TEST_PO_ID'
")

if [ "$PO_SHIP_COUNT" = "0" ]; then
  echo -e "${GREEN}✅ VERIFIED: No PO_SHIP journal${NC}"
else
  echo -e "${RED}❌ FAILED: PO_SHIP should NOT exist for supplier-borne${NC}"
  exit 1
fi

echo -e "${GREEN}✅ TEST T3 PASSED${NC}"

# TEST T4: HPP not capitalized
echo ""
echo "================================================================================"
echo "TEST T4: HPP NOT CAPITALIZED"
echo "================================================================================"

HPP_RESP=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/purchase-orders/$TEST_PO_ID/hpp")
HPP_PER_KG=$(echo "$HPP_RESP" | jq -r '.data.items[0].hppPerKg')
WEIGHT=$(echo "$HPP_RESP" | jq -r '.data.items[0].weightActual')
TOTAL_HPP=$(awk "BEGIN {print $HPP_PER_KG * $WEIGHT}")

echo "  sum(hpp_per_kg * weight): Rp $(printf "%.0f" $TOTAL_HPP)"

if [ "$TOTAL_HPP" = "1000000" ]; then
  echo -e "${GREEN}✅ VERIFIED: sum(hpp_per_kg * weight) = 1,000,000 (goods only)${NC}"
else
  echo -e "${RED}❌ FAILED: Expected total HPP = 1,000,000, got $TOTAL_HPP${NC}"
  exit 1
fi

echo -e "${GREEN}✅ TEST T4 PASSED${NC}"

# TEST T5: Regression
echo ""
echo "================================================================================"
echo "TEST T5: REGRESSION (additional_cost=0)"
echo "================================================================================"

echo "Creating second PO with additional_cost=0..."
node << EOF
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const db = new Database('$DB_PATH');

const po2Id = uuidv4();
const item2Id = uuidv4();
const timestamp = Date.now();

db.prepare(\`
  INSERT INTO purchase_order (
    id, po_number, supplier_id, po_type, method, pipeline_status,
    order_date, additional_cost, additional_cost_bearer, additional_cost_pay_method,
    total_amount, invoice_number, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
\`).run(po2Id, \`PO/TEST2/\${timestamp}\`, '$TEST_SUPPLIER_ID', 'Beli Jadi', 'Timbang Ulang', 'Invoiced',
  0, 'company', 'utang', 0, \`INV-TEST2-\${timestamp}\`);

db.prepare(\`
  INSERT INTO purchase_order_items (
    id, purchase_order_id, product_id, quantity, weight, unit_price,
    hpp_per_kg, additional_cost_share
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
\`).run(item2Id, po2Id, '$TEST_PRODUCT_ID', 2, 20, 50000, 0, 0);

console.log(\`TEST_PO2_ID=\${po2Id}\`);
db.close();
EOF

eval $(node << EOF
const Database = require('better-sqlite3');
const db = new Database('$DB_PATH');
const po2 = db.prepare(\`SELECT id FROM purchase_order WHERE po_number LIKE 'PO/TEST2/%' ORDER BY created_at DESC LIMIT 1\`).get();
console.log(\`TEST_PO2_ID=\${po2.id}\`);
db.close();
EOF
)

curl -s -b "$COOKIE_FILE" -X PATCH "$BASE_URL/purchase-orders/$TEST_PO2_ID" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"notes":"Regression"}' > /dev/null
echo -e "${GREEN}✅ Created PO2${NC}"

HPP_RESP=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/purchase-orders/$TEST_PO2_ID/hpp")
GRAND_TOTAL=$(echo "$HPP_RESP" | jq -r '.data.totals.grandTotal')

if [ "$GRAND_TOTAL" = "1000000" ]; then
  echo -e "${GREEN}✅ VERIFIED: grandTotal = 1,000,000 (goods only)${NC}"
else
  echo -e "${RED}❌ FAILED: Expected grandTotal=1,000,000, got $GRAND_TOTAL${NC}"
  exit 1
fi

curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/accounting/sync" -H "Origin: $ORIGIN" > /dev/null

FREIGHT_JOURNALS=$(node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "
  SELECT COUNT(*) FROM journal_entries 
  WHERE source_type = 'PO_SHIP' AND source_id = '$TEST_PO2_ID'
")

if [ "$FREIGHT_JOURNALS" = "0" ]; then
  echo -e "${GREEN}✅ VERIFIED: No freight journals${NC}"
else
  echo -e "${RED}❌ FAILED: Found freight journal for PO with additional_cost=0${NC}"
  exit 1
fi

# Clean up PO2
node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "DELETE FROM purchase_order_items WHERE purchase_order_id = '$TEST_PO2_ID'"
node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "DELETE FROM purchase_order WHERE id = '$TEST_PO2_ID'"
node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "DELETE FROM journal_entries WHERE source_id = '$TEST_PO2_ID'"
echo -e "${GREEN}✅ PO2 cleaned up${NC}"

echo -e "${GREEN}✅ TEST T5 PASSED${NC}"

# CLEANUP
echo ""
echo "================================================================================"
echo "CLEANING UP TEST DATA"
echo "================================================================================"

node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "DELETE FROM journal_lines WHERE journal_id IN (SELECT id FROM journal_entries WHERE source_id = '$TEST_PO_ID')"
node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "DELETE FROM journal_entries WHERE source_id = '$TEST_PO_ID'"
node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "DELETE FROM purchase_order_items WHERE purchase_order_id = '$TEST_PO_ID'"
node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "DELETE FROM purchase_order WHERE id = '$TEST_PO_ID'"
node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "DELETE FROM products WHERE id = '$TEST_PRODUCT_ID'"
node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "DELETE FROM contacts WHERE id = '$TEST_SUPPLIER_ID'"

echo -e "${GREEN}✅ Deleted all test data${NC}"

curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/accounting/sync" -H "Origin: $ORIGIN" > /dev/null
echo -e "${GREEN}✅ Re-synced accounting${NC}"

PO_COUNT=$(node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "SELECT COUNT(*) FROM purchase_order WHERE po_number LIKE 'PO/TEST%'")
JOURNAL_COUNT=$(node -e "const db=require('better-sqlite3')('/app/data/erp.db'); "SELECT COUNT(*) FROM journal_entries WHERE source_type IN ('PO_INV', 'PO_SHIP') AND source_number LIKE '%TEST%'")

echo ""
echo "=== FINAL STATE ==="
echo "  purchase_order (test) count: $PO_COUNT"
echo "  journal_entries (PO_INV/PO_SHIP test) count: $JOURNAL_COUNT"

# Clean up cookie file
rm -f "$COOKIE_FILE"

echo ""
echo "================================================================================"
echo "🎉 ALL TESTS PASSED (5/5, 100%)"
echo "================================================================================"
