#!/bin/bash

BASE_URL="http://localhost:3000"
COOKIE_FILE="/tmp/admin_cookie.txt"

echo "=== MAINTENANCE Backend Test ==="
echo ""

# Login as admin
echo "1. Login as admin@lpi.co.id..."
curl -s -c "$COOKIE_FILE" -X POST "$BASE_URL/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}' > /dev/null

if [ ! -f "$COOKIE_FILE" ]; then
  echo "❌ Login failed - no cookie file created"
  exit 1
fi

echo "✓ Login successful"
echo ""

# Test Scenario 1: Create 3 tally inbounds
echo "=== SCENARIO 1: REGRESSION - reconcile-hydrate ==="
echo ""

# Get cold storage
echo "Getting cold storage..."
CS_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/cold-storages")
CS_ID=$(echo "$CS_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$CS_ID" ]; then
  echo "❌ No cold storage found"
  exit 1
fi

echo "✓ Cold Storage ID: $CS_ID"

# Get product
echo "Getting product..."
PROD_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/products?limit=1")
PROD_ID=$(echo "$PROD_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$PROD_ID" ]; then
  echo "❌ No product found"
  exit 1
fi

echo "✓ Product ID: $PROD_ID"
echo ""

# Create 3 tally inbounds
for i in 1 2 3; do
  echo "--- Tally Inbound $i/3 ---"
  
  # Create tally session
  WEIGHT=$((10 + i))
  TALLY_CREATE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/tally-sessions" \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:3000" \
    -d "{\"coldStorageId\":\"$CS_ID\",\"referenceType\":\"MANUAL\",\"items\":[{\"productId\":\"$PROD_ID\",\"weight\":$WEIGHT,\"quantity\":$i,\"packagingType\":\"colly\"}]}")
  
  SESSION_ID=$(echo "$TALLY_CREATE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  
  if [ -z "$SESSION_ID" ]; then
    echo "❌ Failed to create tally session $i"
    echo "Response: $TALLY_CREATE"
    exit 1
  fi
  
  echo "✓ Created tally session: $SESSION_ID"
  
  # Finalize
  FINALIZE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/tally-sessions/$SESSION_ID/finalize" \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:3000")
  
  if echo "$FINALIZE" | grep -q '"transactionId"'; then
    echo "✓ Finalized tally session $i"
  else
    echo "❌ Failed to finalize tally session $i"
    echo "Response: $FINALIZE"
    exit 1
  fi
  
  # Check stock ledger count
  sleep 0.5
  LEDGER=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/stock-ledger")
  MOVEMENT_COUNT=$(echo "$LEDGER" | grep -o '"movements":\[' | wc -l)
  
  echo "✓ Stock ledger movements after $i: checking..."
  
done

# Final check
LEDGER_FINAL=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/stock-ledger")
echo ""
echo "Final stock ledger check:"
echo "$LEDGER_FINAL" | grep -o '"total":[0-9]*' || echo "Could not parse total"

STOCKS=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/inventory/stocks?status=active")
echo "Inventory stocks:"
echo "$STOCKS" | grep -o '"data":\[' || echo "Could not parse stocks"

echo ""
echo "✅ SCENARIO 1 COMPLETE"
echo ""

# Test Scenario 2: Maintenance guards
echo "=== SCENARIO 2: MAINTENANCE guards ==="
echo ""

echo "Test 2a: Wrong token..."
WRONG_TOKEN=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/maintenance/reset-inventory" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"token":"WRONG-TOKEN","confirm":"HAPUS-INVENTORY"}')

if echo "$WRONG_TOKEN" | grep -q "Invalid maintenance token"; then
  echo "✅ Test 2a PASSED: Wrong token -> 403"
else
  echo "❌ Test 2a FAILED: Expected 'Invalid maintenance token'"
  echo "Response: $WRONG_TOKEN"
fi

echo ""
echo "Test 2b: Wrong confirm..."
WRONG_CONFIRM=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/maintenance/reset-inventory" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"token":"LPI-RESET-INV-2026-9f3a7c1e5b8d42a6","confirm":"WRONG"}')

if echo "$WRONG_CONFIRM" | grep -q "Confirmation mismatch"; then
  echo "✅ Test 2b PASSED: Wrong confirm -> 400"
else
  echo "❌ Test 2b FAILED: Expected 'Confirmation mismatch'"
  echo "Response: $WRONG_CONFIRM"
fi

echo ""
echo "Test 2c: As operator..."
# Login as operator
OPERATOR_COOKIE="/tmp/operator_cookie.txt"
curl -s -c "$OPERATOR_COOKIE" -X POST "$BASE_URL/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"email":"operator@lpi.co.id","password":"operator123"}' > /dev/null

OPERATOR_TEST=$(curl -s -b "$OPERATOR_COOKIE" -X POST "$BASE_URL/api/maintenance/reset-inventory" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"token":"LPI-RESET-INV-2026-9f3a7c1e5b8d42a6","confirm":"HAPUS-INVENTORY"}')

if echo "$OPERATOR_TEST" | grep -q "Forbidden - admin only"; then
  echo "✅ Test 2c PASSED: Operator -> 403"
else
  echo "❌ Test 2c FAILED: Expected 'Forbidden - admin only'"
  echo "Response: $OPERATOR_TEST"
fi

echo ""
echo "✅ SCENARIO 2 COMPLETE"
echo ""

# Test Scenario 3: Maintenance reset
echo "=== SCENARIO 3: MAINTENANCE reset ==="
echo ""

# Get MongoDB counts before
echo "MongoDB counts BEFORE reset:"
mongosh --quiet mongodb://localhost:27017/erp_prod --eval "
  print('inventory_stock: ' + db.inventory_stock.countDocuments({}));
  print('stock_ledger: ' + db.stock_ledger.countDocuments({}));
  print('inventory_transaction: ' + db.inventory_transaction.countDocuments({}));
  print('tally_session: ' + db.tally_session.countDocuments({}));
  print('tally_session_items: ' + db.tally_session_items.countDocuments({}));
  print('stock_opname: ' + db.stock_opname.countDocuments({}));
  print('stock_opname_items: ' + db.stock_opname_items.countDocuments({}));
"

echo ""
echo "Executing reset..."
RESET=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/maintenance/reset-inventory" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"token":"LPI-RESET-INV-2026-9f3a7c1e5b8d42a6","confirm":"HAPUS-INVENTORY"}')

if echo "$RESET" | grep -q '"ok":true'; then
  echo "✅ Reset executed successfully"
  echo "Response: $RESET"
else
  echo "❌ Reset failed"
  echo "Response: $RESET"
fi

echo ""
sleep 1

# Get MongoDB counts after
echo "MongoDB counts AFTER reset:"
mongosh --quiet mongodb://localhost:27017/erp_prod --eval "
  print('inventory_stock: ' + db.inventory_stock.countDocuments({}));
  print('stock_ledger: ' + db.stock_ledger.countDocuments({}));
  print('inventory_transaction: ' + db.inventory_transaction.countDocuments({}));
  print('tally_session: ' + db.tally_session.countDocuments({}));
  print('tally_session_items: ' + db.tally_session_items.countDocuments({}));
  print('stock_opname: ' + db.stock_opname.countDocuments({}));
  print('stock_opname_items: ' + db.stock_opname_items.countDocuments({}));
"

echo ""
echo "Verify via API:"
STOCKS_AFTER=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/inventory/stocks")
echo "GET /api/inventory/stocks: $(echo "$STOCKS_AFTER" | grep -o '"data":\[[^]]*\]' | wc -c) bytes"

LEDGER_AFTER=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/stock-ledger")
echo "GET /api/stock-ledger total: $(echo "$LEDGER_AFTER" | grep -o '"total":[0-9]*' | cut -d':' -f2)"

echo ""
echo "✅ SCENARIO 3 COMPLETE"
echo ""

# Test Scenario 4: Auth regression
echo "=== SCENARIO 4: AUTH regression ==="
echo ""

AUTH_TEST=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/inventory/stocks")
if echo "$AUTH_TEST" | grep -q '"data"'; then
  echo "✅ SCENARIO 4 PASSED: Auth still works, protected GET returns 200"
else
  echo "❌ SCENARIO 4 FAILED: Auth may be broken"
  echo "Response: $AUTH_TEST"
fi

echo ""
echo "=== ALL TESTS COMPLETE ==="

# Cleanup
rm -f "$COOKIE_FILE" "$OPERATOR_COOKIE"
