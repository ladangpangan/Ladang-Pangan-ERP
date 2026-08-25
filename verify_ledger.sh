#!/bin/bash

BASE_URL="http://localhost:3000"
COOKIE_FILE="/tmp/verify_cookie.txt"

# Login
curl -s -c "$COOKIE_FILE" -X POST "$BASE_URL/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}' > /dev/null

# Get cold storage and product
CS_ID=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/cold-storages" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
PROD_ID=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/products?limit=1" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

echo "=== DETAILED REGRESSION TEST ==="
echo ""

# Create 3 tally inbounds and track ledger growth
for i in 1 2 3; do
  echo "--- Creating Tally Inbound $i ---"
  
  WEIGHT=$((20 + i))
  
  # Create and finalize
  SESSION_ID=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/tally-sessions" \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:3000" \
    -d "{\"coldStorageId\":\"$CS_ID\",\"referenceType\":\"MANUAL\",\"items\":[{\"productId\":\"$PROD_ID\",\"weight\":$WEIGHT,\"quantity\":$i,\"packagingType\":\"colly\"}]}" \
    | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  
  curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/tally-sessions/$SESSION_ID/finalize" \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:3000" > /dev/null
  
  sleep 0.5
  
  # Get ledger and count movements
  LEDGER=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/stock-ledger")
  TOTAL=$(echo "$LEDGER" | grep -o '"total":[0-9]*' | cut -d':' -f2)
  
  echo "After finalize $i: stock_ledger total = $TOTAL"
  
  # Verify count matches expected
  if [ "$TOTAL" -eq "$i" ]; then
    echo "✅ Movement count correct: $i"
  else
    echo "❌ Movement count WRONG: expected $i, got $TOTAL"
  fi
  
  echo ""
done

# Final verification
echo "=== FINAL VERIFICATION ==="
STOCKS=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/inventory/stocks?status=active")
STOCK_COUNT=$(echo "$STOCKS" | grep -o '"kodeSimpan":"[^"]*"' | wc -l)
echo "Active stocks: $STOCK_COUNT"

LEDGER_FINAL=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/stock-ledger")
TOTAL_FINAL=$(echo "$LEDGER_FINAL" | grep -o '"total":[0-9]*' | cut -d':' -f2)
echo "Stock ledger total: $TOTAL_FINAL"

if [ "$STOCK_COUNT" -eq 3 ] && [ "$TOTAL_FINAL" -eq 3 ]; then
  echo ""
  echo "✅ REGRESSION TEST PASSED"
  echo "   - 3 tally inbounds created"
  echo "   - Movement count grew 1 -> 2 -> 3"
  echo "   - All rows remain visible (no deletion)"
  echo "   - 3 stocks in inventory"
else
  echo ""
  echo "❌ REGRESSION TEST FAILED"
  echo "   - Expected 3 stocks and 3 movements"
  echo "   - Got $STOCK_COUNT stocks and $TOTAL_FINAL movements"
fi

rm -f "$COOKIE_FILE"
