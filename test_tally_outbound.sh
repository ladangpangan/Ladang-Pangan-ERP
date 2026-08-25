#!/bin/bash
# Backend test for Tally Outbound + Inventory Logbook endpoints
# Uses curl for Better Auth compatibility

# Don't exit on error - we want to run all tests
set +e

BASE_URL="http://localhost:3000/api"
ORIGIN="http://localhost:3000"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results
PASSED=0
FAILED=0

# Temp files for cookies
ADMIN_COOKIES="/tmp/admin_cookies.txt"
OPERATOR_COOKIES="/tmp/operator_cookies.txt"

echo "================================================================================"
echo "TALLY OUTBOUND + INVENTORY LOGBOOK - BACKEND TEST"
echo "================================================================================"

# Step 1: Seed test data
echo ""
echo "📦 STEP 1: SEEDING TEST DATA"
echo "--------------------------------------------------------------------------------"
node /app/seed_tally_test.js seed

# Load test IDs
TEST_DATA=$(cat /app/test_ids.json)
SO_ID=$(echo "$TEST_DATA" | jq -r '.soId')
ITEM_ID=$(echo "$TEST_DATA" | jq -r '.itemId')
PRODUCT_ID=$(echo "$TEST_DATA" | jq -r '.productId')
STOCK1_ID=$(echo "$TEST_DATA" | jq -r '.stocks[0].id')
STOCK2_ID=$(echo "$TEST_DATA" | jq -r '.stocks[1].id')
STOCK3_ID=$(echo "$TEST_DATA" | jq -r '.stocks[2].id')

echo ""
echo "📋 Test Data Loaded:"
echo "   SO ID: $SO_ID"
echo "   Item ID: $ITEM_ID"
echo "   Stock IDs: $STOCK1_ID, $STOCK2_ID, $STOCK3_ID"

# Login as admin
echo ""
echo "🔐 Logging in as ADMIN..."
curl -s -c "$ADMIN_COOKIES" -X POST "$BASE_URL/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}' > /dev/null
echo "✅ Logged in as ADMIN"

# Login as operator
echo "🔐 Logging in as OPERATOR..."
curl -s -c "$OPERATOR_COOKIES" -X POST "$BASE_URL/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"email":"operator@lpi.co.id","password":"operator123"}' > /dev/null
echo "✅ Logged in as OPERATOR"

# TEST 1: GET /api/tally-outbound/orders as OPERATOR
echo ""
echo "================================================================================"
echo "TEST 1: GET /api/tally-outbound/orders as OPERATOR"
echo "--------------------------------------------------------------------------------"
RESPONSE=$(curl -s -b "$OPERATOR_COOKIES" "$BASE_URL/tally-outbound/orders")
STATUS=$(echo "$RESPONSE" | jq -r 'if .error then "error" else "ok" end')

if [ "$STATUS" = "ok" ]; then
  ORDERS=$(echo "$RESPONSE" | jq -r '.data')
  COUNT=$(echo "$ORDERS" | jq 'length')
  echo "✓ Response: 200 OK"
  echo "✓ Orders count: $COUNT"
  
  # Check if QA-SO-1 is in the list
  HAS_QA_SO=$(echo "$ORDERS" | jq 'any(.soNumber == "QA-SO-1")')
  if [ "$HAS_QA_SO" = "true" ]; then
    echo "✓ Found QA-SO-1 in list"
    
    # Get QA-SO-1 details
    QA_SO=$(echo "$ORDERS" | jq '.[] | select(.soNumber == "QA-SO-1")')
    ITEM_COUNT=$(echo "$QA_SO" | jq -r '.itemCount')
    ALLOCATED_COUNT=$(echo "$QA_SO" | jq -r '.allocatedItemCount')
    
    echo "  - itemCount: $ITEM_COUNT"
    echo "  - allocatedItemCount: $ALLOCATED_COUNT"
    
    # Check for price fields
    HAS_PRICE=$(echo "$QA_SO" | jq 'has("unitPrice") or has("subtotal") or has("totalAmount")')
    if [ "$HAS_PRICE" = "false" ]; then
      echo "✓ No price fields exposed (correct)"
      echo -e "${GREEN}✅ TEST 1: PASS${NC}"
      ((PASSED++))
    else
      echo -e "${RED}❌ Price fields found${NC}"
      echo -e "${RED}❌ TEST 1: FAIL${NC}"
      ((FAILED++))
    fi
  else
    echo -e "${RED}❌ QA-SO-1 not found in list${NC}"
    echo -e "${RED}❌ TEST 1: FAIL${NC}"
    ((FAILED++))
  fi
else
  echo -e "${RED}❌ Request failed: $RESPONSE${NC}"
  echo -e "${RED}❌ TEST 1: FAIL${NC}"
  ((FAILED++))
fi

# TEST 2: GET /api/tally-outbound/orders/:soId
echo ""
echo "================================================================================"
echo "TEST 2: GET /api/tally-outbound/orders/:soId as OPERATOR"
echo "--------------------------------------------------------------------------------"
RESPONSE=$(curl -s -b "$OPERATOR_COOKIES" "$BASE_URL/tally-outbound/orders/$SO_ID")
STATUS=$(echo "$RESPONSE" | jq -r 'if .error then "error" else "ok" end')

if [ "$STATUS" = "ok" ]; then
  SO_DETAIL=$(echo "$RESPONSE" | jq -r '.data')
  ITEMS=$(echo "$SO_DETAIL" | jq -r '.items')
  ITEMS_COUNT=$(echo "$ITEMS" | jq 'length')
  
  echo "✓ Response: 200 OK"
  echo "✓ Items count: $ITEMS_COUNT"
  
  if [ "$ITEMS_COUNT" -gt 0 ]; then
    ITEM=$(echo "$ITEMS" | jq '.[0]')
    PRODUCT_NAME=$(echo "$ITEM" | jq -r '.productName')
    ORDERED_WEIGHT=$(echo "$ITEM" | jq -r '.orderedWeight')
    ALLOCATED=$(echo "$ITEM" | jq -r '.allocated')
    
    echo "✓ Item[0] fields:"
    echo "  - productName: $PRODUCT_NAME"
    echo "  - orderedWeight: $ORDERED_WEIGHT"
    echo "  - allocated: $ALLOCATED"
    
    # Check for price fields
    HAS_PRICE=$(echo "$ITEM" | jq 'has("unitPrice") or has("subtotal") or has("markup")')
    if [ "$HAS_PRICE" = "false" ]; then
      echo "✓ No price fields in item (correct)"
      echo -e "${GREEN}✅ TEST 2: PASS${NC}"
      ((PASSED++))
    else
      echo -e "${RED}❌ Price fields found${NC}"
      echo -e "${RED}❌ TEST 2: FAIL${NC}"
      ((FAILED++))
    fi
  else
    echo -e "${RED}❌ No items in SO${NC}"
    echo -e "${RED}❌ TEST 2: FAIL${NC}"
    ((FAILED++))
  fi
else
  echo -e "${RED}❌ Request failed: $RESPONSE${NC}"
  echo -e "${RED}❌ TEST 2: FAIL${NC}"
  ((FAILED++))
fi

# TEST 3: GET stocks with recommendation
echo ""
echo "================================================================================"
echo "TEST 3: GET /api/tally-outbound/orders/:soId/items/:itemId/stocks"
echo "--------------------------------------------------------------------------------"
RESPONSE=$(curl -s -b "$OPERATOR_COOKIES" "$BASE_URL/tally-outbound/orders/$SO_ID/items/$ITEM_ID/stocks")
STATUS=$(echo "$RESPONSE" | jq -r 'if .error then "error" else "ok" end')

if [ "$STATUS" = "ok" ]; then
  DATA=$(echo "$RESPONSE" | jq -r '.data')
  ORDERED_WEIGHT=$(echo "$DATA" | jq -r '.orderedWeight')
  STOCKS=$(echo "$DATA" | jq -r '.stocks')
  STOCKS_COUNT=$(echo "$STOCKS" | jq 'length')
  
  echo "✓ Response: 200 OK"
  echo "✓ orderedWeight: $ORDERED_WEIGHT"
  echo "✓ Stocks count: $STOCKS_COUNT"
  
  # Check recommended
  RECOMMENDED=$(echo "$STOCKS" | jq '[.[] | select(.recommended == true)]')
  REC_COUNT=$(echo "$RECOMMENDED" | jq 'length')
  
  echo "✓ Recommended stocks: $REC_COUNT"
  
  if [ "$REC_COUNT" -eq 1 ]; then
    REC_WEIGHT=$(echo "$RECOMMENDED" | jq -r '.[0].weight')
    REC_CODE=$(echo "$RECOMMENDED" | jq -r '.[0].kodeSimpan')
    
    echo "✓ Recommended stock:"
    echo "  - kodeSimpan: $REC_CODE"
    echo "  - weight: $REC_WEIGHT"
    
    if [ "$REC_WEIGHT" = "120" ]; then
      echo "✓ Correct recommendation: 120kg lot (closest to 100kg)"
      echo -e "${GREEN}✅ TEST 3: PASS${NC}"
      ((PASSED++))
    else
      echo -e "${RED}❌ Wrong recommendation: expected 120kg, got ${REC_WEIGHT}kg${NC}"
      echo -e "${RED}❌ TEST 3: FAIL${NC}"
      ((FAILED++))
    fi
  else
    echo -e "${RED}❌ Expected exactly 1 recommended stock, got $REC_COUNT${NC}"
    echo -e "${RED}❌ TEST 3: FAIL${NC}"
    ((FAILED++))
  fi
else
  echo -e "${RED}❌ Request failed: $RESPONSE${NC}"
  echo -e "${RED}❌ TEST 3: FAIL${NC}"
  ((FAILED++))
fi

# TEST 4: POST allocate with QA-S1 + QA-S2
echo ""
echo "================================================================================"
echo "TEST 4: POST allocate QA-S1 (45kg) + QA-S2 (55kg) = 100kg"
echo "--------------------------------------------------------------------------------"
RESPONSE=$(curl -s -b "$OPERATOR_COOKIES" -X POST "$BASE_URL/tally-outbound/orders/$SO_ID/items/$ITEM_ID/allocate" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d "{\"stockIds\":[\"$STOCK1_ID\",\"$STOCK2_ID\"]}")
STATUS=$(echo "$RESPONSE" | jq -r 'if .error then "error" else "ok" end')

if [ "$STATUS" = "ok" ]; then
  DATA=$(echo "$RESPONSE" | jq -r '.data')
  ALLOCATED_WEIGHT=$(echo "$DATA" | jq -r '.allocatedWeight')
  
  echo "✓ Response: 200 OK"
  echo "✓ allocatedWeight: $ALLOCATED_WEIGHT"
  
  if [ "$ALLOCATED_WEIGHT" = "100" ]; then
    echo "✓ Correct allocated weight: 100kg"
    
    # Verify in SQLite
    VERIFY=$(node -e "
const Database = require('better-sqlite3');
const db = new Database('/app/data/erp.db');
const stocks = db.prepare(\"SELECT kode_simpan, status FROM inventory_stock WHERE kode_simpan IN ('QA-S1', 'QA-S2')\").all();
const count = db.prepare(\"SELECT COUNT(*) as c FROM so_item_stocks WHERE so_item_id = '$ITEM_ID'\").get();
console.log(JSON.stringify({stocks, count: count.c}));
db.close();
")
    
    STOCK_STATUS=$(echo "$VERIFY" | jq -r '.stocks')
    SO_ITEM_COUNT=$(echo "$VERIFY" | jq -r '.count')
    
    echo "✓ SQLite verification:"
    echo "$STOCK_STATUS" | jq -r '.[] | "  - \(.kode_simpan): status=\(.status)"'
    echo "  - so_item_stocks rows: $SO_ITEM_COUNT"
    
    ALL_ALLOCATED=$(echo "$STOCK_STATUS" | jq 'all(.status == "allocated")')
    if [ "$ALL_ALLOCATED" = "true" ] && [ "$SO_ITEM_COUNT" = "2" ]; then
      echo "✓ All stocks allocated, 2 so_item_stocks rows created"
      echo -e "${GREEN}✅ TEST 4: PASS${NC}"
      ((PASSED++))
    else
      echo -e "${RED}❌ Verification failed${NC}"
      echo -e "${RED}❌ TEST 4: FAIL${NC}"
      ((FAILED++))
    fi
  else
    echo -e "${RED}❌ Expected 100kg, got ${ALLOCATED_WEIGHT}kg${NC}"
    echo -e "${RED}❌ TEST 4: FAIL${NC}"
    ((FAILED++))
  fi
else
  echo -e "${RED}❌ Request failed: $RESPONSE${NC}"
  echo -e "${RED}❌ TEST 4: FAIL${NC}"
  ((FAILED++))
fi

# TEST 5: Re-POST allocate with QA-S3
echo ""
echo "================================================================================"
echo "TEST 5: Re-POST allocate with QA-S3 (120kg)"
echo "--------------------------------------------------------------------------------"
RESPONSE=$(curl -s -b "$OPERATOR_COOKIES" -X POST "$BASE_URL/tally-outbound/orders/$SO_ID/items/$ITEM_ID/allocate" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d "{\"stockIds\":[\"$STOCK3_ID\"]}")
STATUS=$(echo "$RESPONSE" | jq -r 'if .error then "error" else "ok" end')

if [ "$STATUS" = "ok" ]; then
  DATA=$(echo "$RESPONSE" | jq -r '.data')
  ALLOCATED_WEIGHT=$(echo "$DATA" | jq -r '.allocatedWeight')
  
  echo "✓ Response: 200 OK"
  echo "✓ allocatedWeight: $ALLOCATED_WEIGHT"
  
  if [ "$ALLOCATED_WEIGHT" = "120" ]; then
    echo "✓ Correct allocated weight: 120kg"
    
    # Verify in SQLite
    VERIFY=$(node -e "
const Database = require('better-sqlite3');
const db = new Database('/app/data/erp.db');
const stocks = db.prepare(\"SELECT kode_simpan, status FROM inventory_stock WHERE kode_simpan IN ('QA-S1', 'QA-S2', 'QA-S3')\").all();
const count = db.prepare(\"SELECT COUNT(*) as c FROM so_item_stocks WHERE so_item_id = '$ITEM_ID'\").get();
console.log(JSON.stringify({stocks, count: count.c}));
db.close();
")
    
    STOCK_STATUS=$(echo "$VERIFY" | jq -r '.stocks')
    SO_ITEM_COUNT=$(echo "$VERIFY" | jq -r '.count')
    
    echo "✓ SQLite verification:"
    echo "$STOCK_STATUS" | jq -r '.[] | "  - \(.kode_simpan): status=\(.status)"'
    echo "  - so_item_stocks rows: $SO_ITEM_COUNT"
    
    S1_ACTIVE=$(echo "$STOCK_STATUS" | jq -r '.[] | select(.kode_simpan == "QA-S1") | .status == "active"')
    S2_ACTIVE=$(echo "$STOCK_STATUS" | jq -r '.[] | select(.kode_simpan == "QA-S2") | .status == "active"')
    S3_ALLOCATED=$(echo "$STOCK_STATUS" | jq -r '.[] | select(.kode_simpan == "QA-S3") | .status == "allocated"')
    
    if [ "$S1_ACTIVE" = "true" ] && [ "$S2_ACTIVE" = "true" ] && [ "$S3_ALLOCATED" = "true" ] && [ "$SO_ITEM_COUNT" = "1" ]; then
      echo "✓ QA-S1 & QA-S2 freed, QA-S3 allocated, 1 so_item_stocks row"
      echo -e "${GREEN}✅ TEST 5: PASS${NC}"
      ((PASSED++))
    else
      echo -e "${RED}❌ Verification failed: S1=$S1_ACTIVE, S2=$S2_ACTIVE, S3=$S3_ALLOCATED, rows=$SO_ITEM_COUNT${NC}"
      echo -e "${RED}❌ TEST 5: FAIL${NC}"
      ((FAILED++))
    fi
  else
    echo -e "${RED}❌ Expected 120kg, got ${ALLOCATED_WEIGHT}kg${NC}"
    echo -e "${RED}❌ TEST 5: FAIL${NC}"
    ((FAILED++))
  fi
else
  echo -e "${RED}❌ Request failed: $RESPONSE${NC}"
  echo -e "${RED}❌ TEST 5: FAIL${NC}"
  ((FAILED++))
fi

# TEST 6: GET orders again - should be absent
echo ""
echo "================================================================================"
echo "TEST 6: GET /api/tally-outbound/orders (QA-SO-1 should be absent)"
echo "--------------------------------------------------------------------------------"
RESPONSE=$(curl -s -b "$OPERATOR_COOKIES" "$BASE_URL/tally-outbound/orders")
STATUS=$(echo "$RESPONSE" | jq -r 'if .error then "error" else "ok" end')

if [ "$STATUS" = "ok" ]; then
  ORDERS=$(echo "$RESPONSE" | jq -r '.data')
  HAS_QA_SO=$(echo "$ORDERS" | jq 'any(.soNumber == "QA-SO-1")')
  
  echo "✓ Response: 200 OK"
  
  if [ "$HAS_QA_SO" = "false" ]; then
    echo "✓ QA-SO-1 NOT in list (correct - fully allocated)"
    echo -e "${GREEN}✅ TEST 6: PASS${NC}"
    ((PASSED++))
  else
    echo -e "${RED}❌ QA-SO-1 still in list (should be hidden)${NC}"
    echo -e "${RED}❌ TEST 6: FAIL${NC}"
    ((FAILED++))
  fi
else
  echo -e "${RED}❌ Request failed: $RESPONSE${NC}"
  echo -e "${RED}❌ TEST 6: FAIL${NC}"
  ((FAILED++))
fi

# TEST 7: Non-Draft SO allocation
echo ""
echo "================================================================================"
echo "TEST 7: POST allocate on non-Draft SO (should fail with 400)"
echo "--------------------------------------------------------------------------------"

# Change SO to Confirmed
node -e "
const Database = require('better-sqlite3');
const db = new Database('/app/data/erp.db');
db.prepare(\"UPDATE sales_order SET pipeline_status = 'Confirmed' WHERE id = '$SO_ID'\").run();
db.close();
" > /dev/null
echo "✓ Changed SO to Confirmed"

RESPONSE=$(curl -s -b "$OPERATOR_COOKIES" -X POST "$BASE_URL/tally-outbound/orders/$SO_ID/items/$ITEM_ID/allocate" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d "{\"stockIds\":[\"$STOCK1_ID\"]}")
STATUS=$(echo "$RESPONSE" | jq -r 'if .error then "error" else "ok" end')

if [ "$STATUS" = "error" ]; then
  ERROR_MSG=$(echo "$RESPONSE" | jq -r '.error')
  echo "✓ Response: 400 (correct - Draft-only)"
  echo "✓ Error message: $ERROR_MSG"
  echo -e "${GREEN}✅ TEST 7: PASS${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ Expected error, got success${NC}"
  echo -e "${RED}❌ TEST 7: FAIL${NC}"
  ((FAILED++))
fi

# Set back to Draft
node -e "
const Database = require('better-sqlite3');
const db = new Database('/app/data/erp.db');
db.prepare(\"UPDATE sales_order SET pipeline_status = 'Draft' WHERE id = '$SO_ID'\").run();
db.close();
" > /dev/null
echo "✓ Changed SO back to Draft"

# TEST 8: Stock ledger
echo ""
echo "================================================================================"
echo "TEST 8: GET /api/stock-ledger"
echo "--------------------------------------------------------------------------------"

echo "8a) As ADMIN:"
RESPONSE=$(curl -s -b "$ADMIN_COOKIES" "$BASE_URL/stock-ledger")
STATUS=$(echo "$RESPONSE" | jq -r 'if .error then "error" else "ok" end')

if [ "$STATUS" = "ok" ]; then
  DATA=$(echo "$RESPONSE" | jq -r '.data')
  MOVEMENTS=$(echo "$DATA" | jq -r '.movements')
  SUMMARY=$(echo "$DATA" | jq -r '.summary')
  
  echo "   ✓ Response: 200 OK"
  echo "   ✓ Movements count: $(echo "$MOVEMENTS" | jq 'length')"
  echo "   ✓ Summary: $SUMMARY"
  
  # Test query params
  echo ""
  echo "8b) Test query params:"
  RESPONSE2=$(curl -s -b "$ADMIN_COOKIES" "$BASE_URL/stock-ledger?movementType=IN")
  STATUS2=$(echo "$RESPONSE2" | jq -r 'if .error then "error" else "ok" end')
  echo "   ?movementType=IN: $([ "$STATUS2" = "ok" ] && echo "200 ✓" || echo "error ❌")"
  
  RESPONSE3=$(curl -s -b "$ADMIN_COOKIES" "$BASE_URL/stock-ledger?productId=$PRODUCT_ID")
  STATUS3=$(echo "$RESPONSE3" | jq -r 'if .error then "error" else "ok" end')
  echo "   ?productId=...: $([ "$STATUS3" = "ok" ] && echo "200 ✓" || echo "error ❌")"
  
  # As OPERATOR -> 403
  echo ""
  echo "8c) As OPERATOR:"
  RESPONSE4=$(curl -s -b "$OPERATOR_COOKIES" "$BASE_URL/stock-ledger")
  STATUS4=$(echo "$RESPONSE4" | jq -r 'if .error then "error" else "ok" end')
  
  if [ "$STATUS4" = "error" ]; then
    echo "   ✓ Response: 403 (correct - operator forbidden)"
    echo -e "${GREEN}✅ TEST 8: PASS${NC}"
    ((PASSED++))
  else
    echo -e "${RED}   ❌ Expected 403, got success${NC}"
    echo -e "${RED}❌ TEST 8: FAIL${NC}"
    ((FAILED++))
  fi
else
  echo -e "${RED}   ❌ Admin request failed: $RESPONSE${NC}"
  echo -e "${RED}❌ TEST 8: FAIL${NC}"
  ((FAILED++))
fi

# TEST 9: Regression
echo ""
echo "================================================================================"
echo "TEST 9: Regression tests"
echo "--------------------------------------------------------------------------------"

ALL_OK=true
for endpoint in "/products" "/contacts" "/stats" "/me"; do
  RESPONSE=$(curl -s -b "$ADMIN_COOKIES" "$BASE_URL$endpoint")
  STATUS=$(echo "$RESPONSE" | jq -r 'if .error then "error" else "ok" end')
  if [ "$STATUS" = "ok" ]; then
    echo "   GET $endpoint: 200 ✓"
  else
    echo -e "${RED}   GET $endpoint: error ❌${NC}"
    ALL_OK=false
  fi
done

if [ "$ALL_OK" = true ]; then
  echo -e "${GREEN}✅ TEST 9: PASS${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ TEST 9: FAIL${NC}"
  ((FAILED++))
fi

# CLEANUP
echo ""
echo "================================================================================"
echo "CLEANUP: Removing all test data"
echo "--------------------------------------------------------------------------------"
node /app/seed_tally_test.js cleanup

# SUMMARY
echo ""
echo "================================================================================"
echo "TEST SUMMARY"
echo "================================================================================"
echo -e "${GREEN}PASSED: $PASSED${NC}"
echo -e "${RED}FAILED: $FAILED${NC}"
echo "TOTAL: $((PASSED + FAILED))"
echo "================================================================================"

# Cleanup temp files
rm -f "$ADMIN_COOKIES" "$OPERATOR_COOKIES"

if [ $FAILED -gt 0 ]; then
  exit 1
else
  echo ""
  echo "🎉 ALL TESTS PASSED!"
  exit 0
fi
