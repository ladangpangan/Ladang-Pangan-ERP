#!/bin/bash
# Backend test for Kartu Stok (Stock Card) feature using curl

set -e

BASE_URL="http://localhost:3000/api"
COOKIE_FILE="/tmp/kartu_stok_test_cookies.txt"
EMAIL="admin@lpi.co.id"
PASSWORD="admin123"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "================================================================================"
echo "KARTU STOK (STOCK CARD) BACKEND TEST"
echo "================================================================================"

# Login
echo ""
echo "=== LOGIN ==="
LOGIN_RESPONSE=$(curl -s -X POST "${BASE_URL}/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" \
  -c "${COOKIE_FILE}" -w "\n%{http_code}")

HTTP_CODE=$(echo "$LOGIN_RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✅ Login successful${NC}"
else
  echo -e "${RED}❌ Login failed (HTTP $HTTP_CODE)${NC}"
  exit 1
fi

# Get products
echo ""
echo "=== GET PRODUCTS ==="
PRODUCTS_RESPONSE=$(curl -s -X GET "${BASE_URL}/products" \
  -b "${COOKIE_FILE}" -w "\n%{http_code}")

HTTP_CODE=$(echo "$PRODUCTS_RESPONSE" | tail -n1)
PRODUCTS_DATA=$(echo "$PRODUCTS_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
  PRODUCT_ID=$(echo "$PRODUCTS_DATA" | jq -r '.data[0].id')
  PRODUCT_NAME=$(echo "$PRODUCTS_DATA" | jq -r '.data[0].name')
  PRODUCT_SKU=$(echo "$PRODUCTS_DATA" | jq -r '.data[0].sku')
  echo -e "${GREEN}✅ Found products${NC}"
  echo "   Using product: $PRODUCT_NAME (SKU: $PRODUCT_SKU, ID: $PRODUCT_ID)"
else
  echo -e "${RED}❌ Failed to get products (HTTP $HTTP_CODE)${NC}"
  echo "$PRODUCTS_DATA"
  exit 1
fi

# Get cold storages
echo ""
echo "=== GET COLD STORAGES ==="
CS_RESPONSE=$(curl -s -X GET "${BASE_URL}/cold-storages" \
  -b "${COOKIE_FILE}" -w "\n%{http_code}")

HTTP_CODE=$(echo "$CS_RESPONSE" | tail -n1)
CS_DATA=$(echo "$CS_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
  CS1_ID=$(echo "$CS_DATA" | jq -r '.data[0].id')
  CS1_NAME=$(echo "$CS_DATA" | jq -r '.data[0].name')
  CS1_CODE=$(echo "$CS_DATA" | jq -r '.data[0].code')
  
  CS_COUNT=$(echo "$CS_DATA" | jq '.data | length')
  echo -e "${GREEN}✅ Found $CS_COUNT cold storages${NC}"
  echo "   CS1: $CS1_NAME (Code: $CS1_CODE, ID: $CS1_ID)"
  
  if [ "$CS_COUNT" -lt 2 ]; then
    echo -e "${YELLOW}⚠️  Only 1 cold storage found, creating a second one${NC}"
    CS2_RESPONSE=$(curl -s -X POST "${BASE_URL}/cold-storages" \
      -H "Content-Type: application/json" \
      -d '{"code":"CS-TEST-2","name":"Test Cold Storage 2","location":"Test Location","temperatureRange":"-18 to -22 C","capacityKg":10000}' \
      -b "${COOKIE_FILE}" -w "\n%{http_code}")
    
    HTTP_CODE=$(echo "$CS2_RESPONSE" | tail -n1)
    CS2_DATA=$(echo "$CS2_RESPONSE" | head -n -1)
    
    if [ "$HTTP_CODE" = "201" ]; then
      CS2_ID=$(echo "$CS2_DATA" | jq -r '.data.id')
      CS2_NAME=$(echo "$CS2_DATA" | jq -r '.data.name')
      echo -e "${GREEN}✅ Created CS2: $CS2_NAME (ID: $CS2_ID)${NC}"
    else
      echo -e "${RED}❌ Failed to create CS2 (HTTP $HTTP_CODE)${NC}"
      exit 1
    fi
  else
    CS2_ID=$(echo "$CS_DATA" | jq -r '.data[1].id')
    CS2_NAME=$(echo "$CS_DATA" | jq -r '.data[1].name')
    CS2_CODE=$(echo "$CS_DATA" | jq -r '.data[1].code')
    echo "   CS2: $CS2_NAME (Code: $CS2_CODE, ID: $CS2_ID)"
  fi
else
  echo -e "${RED}❌ Failed to get cold storages (HTTP $HTTP_CODE)${NC}"
  exit 1
fi

echo ""
echo "=== TEST SETUP COMPLETE ==="
echo "Product: $PRODUCT_NAME (ID: $PRODUCT_ID)"
echo "CS1: $CS1_NAME (ID: $CS1_ID)"
echo "CS2: $CS2_NAME (ID: $CS2_ID)"

# Scenario A: Create inbound
echo ""
echo "=== SCENARIO A: CREATE INBOUND (weight=100, qty=2) ==="
INBOUND_RESPONSE=$(curl -s -X POST "${BASE_URL}/inventory/inbound" \
  -H "Content-Type: application/json" \
  -d "{\"referenceType\":\"MANUAL\",\"coldStorageId\":\"${CS1_ID}\",\"items\":[{\"productId\":\"${PRODUCT_ID}\",\"weight\":100,\"quantity\":2}]}" \
  -b "${COOKIE_FILE}" -w "\n%{http_code}")

HTTP_CODE=$(echo "$INBOUND_RESPONSE" | tail -n1)
INBOUND_DATA=$(echo "$INBOUND_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "201" ]; then
  TRANSACTION_ID=$(echo "$INBOUND_DATA" | jq -r '.data.transactionId')
  STOCK_IDS=$(echo "$INBOUND_DATA" | jq -r '.data.stockIds[0]')
  echo -e "${GREEN}✅ Inbound created successfully${NC}"
  echo "   Transaction ID: $TRANSACTION_ID"
  echo "   Stock IDs: $STOCK_IDS"
else
  echo -e "${RED}❌ Failed to create inbound (HTTP $HTTP_CODE)${NC}"
  echo "$INBOUND_DATA"
  exit 1
fi

# Scenario B: Verify stock card after inbound
echo ""
echo "=== SCENARIO B: VERIFY STOCK CARD AFTER INBOUND ==="
CARD_RESPONSE=$(curl -s -X GET "${BASE_URL}/inventory-reports/stock-card?productId=${PRODUCT_ID}" \
  -b "${COOKIE_FILE}" -w "\n%{http_code}")

HTTP_CODE=$(echo "$CARD_RESPONSE" | tail -n1)
CARD_DATA=$(echo "$CARD_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
  OPENING_WEIGHT=$(echo "$CARD_DATA" | jq -r '.data.opening.weight')
  TOTAL_IN=$(echo "$CARD_DATA" | jq -r '.data.summary.totalInWeight')
  CLOSING_WEIGHT=$(echo "$CARD_DATA" | jq -r '.data.summary.closingWeight')
  MOVEMENT_COUNT=$(echo "$CARD_DATA" | jq '.data.movements | length')
  FIRST_MOVEMENT_TYPE=$(echo "$CARD_DATA" | jq -r '.data.movements[0].movementType')
  FIRST_BALANCE=$(echo "$CARD_DATA" | jq -r '.data.movements[0].balanceWeight')
  
  echo -e "${GREEN}✅ Stock card retrieved${NC}"
  echo "   Opening weight: $OPENING_WEIGHT (expected: 0)"
  echo "   Total in weight: $TOTAL_IN (expected: 100)"
  echo "   Closing weight: $CLOSING_WEIGHT (expected: 100)"
  echo "   Movement count: $MOVEMENT_COUNT (expected: 1)"
  echo "   First movement type: $FIRST_MOVEMENT_TYPE (expected: IN)"
  echo "   First balance: $FIRST_BALANCE (expected: 100)"
  
  SCENARIO_B_PASS=true
  if [ "$OPENING_WEIGHT" != "0" ]; then
    echo -e "${RED}❌ Opening weight mismatch${NC}"
    SCENARIO_B_PASS=false
  fi
  if [ "$TOTAL_IN" != "100" ]; then
    echo -e "${RED}❌ Total in weight mismatch${NC}"
    SCENARIO_B_PASS=false
  fi
  if [ "$CLOSING_WEIGHT" != "100" ]; then
    echo -e "${RED}❌ Closing weight mismatch${NC}"
    SCENARIO_B_PASS=false
  fi
  if [ "$MOVEMENT_COUNT" != "1" ]; then
    echo -e "${RED}❌ Movement count mismatch${NC}"
    SCENARIO_B_PASS=false
  fi
  if [ "$FIRST_MOVEMENT_TYPE" != "IN" ]; then
    echo -e "${RED}❌ First movement type mismatch${NC}"
    SCENARIO_B_PASS=false
  fi
  if [ "$FIRST_BALANCE" != "100" ]; then
    echo -e "${RED}❌ First balance mismatch${NC}"
    SCENARIO_B_PASS=false
  fi
  
  if [ "$SCENARIO_B_PASS" = true ]; then
    echo -e "${GREEN}✅ SCENARIO B PASSED${NC}"
  else
    echo -e "${RED}❌ SCENARIO B FAILED${NC}"
  fi
else
  echo -e "${RED}❌ Failed to get stock card (HTTP $HTTP_CODE)${NC}"
  echo "$CARD_DATA"
  exit 1
fi

# Scenario C: Transfer to CS2
echo ""
echo "=== SCENARIO C: TRANSFER TO CS2 ==="
TRANSFER_RESPONSE=$(curl -s -X POST "${BASE_URL}/inventory/transfer-cs" \
  -H "Content-Type: application/json" \
  -d "{\"stockIds\":[\"${STOCK_IDS}\"],\"toColdStorageId\":\"${CS2_ID}\"}" \
  -b "${COOKIE_FILE}" -w "\n%{http_code}")

HTTP_CODE=$(echo "$TRANSFER_RESPONSE" | tail -n1)
TRANSFER_DATA=$(echo "$TRANSFER_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "201" ]; then
  TRANSFER_TX_ID=$(echo "$TRANSFER_DATA" | jq -r '.transactionId')
  echo -e "${GREEN}✅ Transfer successful${NC}"
  echo "   Transaction ID: $TRANSFER_TX_ID"
  
  # Verify stock card after transfer (no CS filter)
  echo ""
  echo "--- Test C.1: No CS filter ---"
  CARD_RESPONSE=$(curl -s -X GET "${BASE_URL}/inventory-reports/stock-card?productId=${PRODUCT_ID}" \
    -b "${COOKIE_FILE}" -w "\n%{http_code}")
  
  HTTP_CODE=$(echo "$CARD_RESPONSE" | tail -n1)
  CARD_DATA=$(echo "$CARD_RESPONSE" | head -n -1)
  
  if [ "$HTTP_CODE" = "200" ]; then
    CLOSING_WEIGHT=$(echo "$CARD_DATA" | jq -r '.data.summary.closingWeight')
    TRANSFER_OUT_FOUND=$(echo "$CARD_DATA" | jq '[.data.movements[] | select(.movementType == "TRANSFER_OUT")] | length > 0')
    TRANSFER_IN_FOUND=$(echo "$CARD_DATA" | jq '[.data.movements[] | select(.movementType == "TRANSFER_IN")] | length > 0')
    
    echo "   Closing weight: $CLOSING_WEIGHT (expected: 100, transfer is net-zero)"
    echo "   TRANSFER_OUT found: $TRANSFER_OUT_FOUND"
    echo "   TRANSFER_IN found: $TRANSFER_IN_FOUND"
    
    SCENARIO_C_PASS=true
    if [ "$CLOSING_WEIGHT" != "100" ]; then
      echo -e "${RED}❌ Closing weight mismatch${NC}"
      SCENARIO_C_PASS=false
    fi
    if [ "$TRANSFER_OUT_FOUND" != "true" ]; then
      echo -e "${RED}❌ TRANSFER_OUT not found${NC}"
      SCENARIO_C_PASS=false
    fi
    if [ "$TRANSFER_IN_FOUND" != "true" ]; then
      echo -e "${RED}❌ TRANSFER_IN not found${NC}"
      SCENARIO_C_PASS=false
    fi
  fi
  
  # Verify stock card with CS2 filter
  echo ""
  echo "--- Test C.2: Filter by CS2 (destination) ---"
  CARD_CS2_RESPONSE=$(curl -s -X GET "${BASE_URL}/inventory-reports/stock-card?productId=${PRODUCT_ID}&coldStorageId=${CS2_ID}" \
    -b "${COOKIE_FILE}" -w "\n%{http_code}")
  
  HTTP_CODE=$(echo "$CARD_CS2_RESPONSE" | tail -n1)
  CARD_CS2_DATA=$(echo "$CARD_CS2_RESPONSE" | head -n -1)
  
  if [ "$HTTP_CODE" = "200" ]; then
    CLOSING_WEIGHT_CS2=$(echo "$CARD_CS2_DATA" | jq -r '.data.summary.closingWeight')
    echo "   CS2 closing weight: $CLOSING_WEIGHT_CS2 (expected: 100)"
    
    if [ "$CLOSING_WEIGHT_CS2" != "100" ]; then
      echo -e "${RED}❌ CS2 closing weight mismatch${NC}"
      SCENARIO_C_PASS=false
    fi
  fi
  
  # Verify stock card with CS1 filter
  echo ""
  echo "--- Test C.3: Filter by CS1 (source) ---"
  CARD_CS1_RESPONSE=$(curl -s -X GET "${BASE_URL}/inventory-reports/stock-card?productId=${PRODUCT_ID}&coldStorageId=${CS1_ID}" \
    -b "${COOKIE_FILE}" -w "\n%{http_code}")
  
  HTTP_CODE=$(echo "$CARD_CS1_RESPONSE" | tail -n1)
  CARD_CS1_DATA=$(echo "$CARD_CS1_RESPONSE" | head -n -1)
  
  if [ "$HTTP_CODE" = "200" ]; then
    CLOSING_WEIGHT_CS1=$(echo "$CARD_CS1_DATA" | jq -r '.data.summary.closingWeight')
    echo "   CS1 closing weight: $CLOSING_WEIGHT_CS1 (expected: 0)"
    
    if [ "$CLOSING_WEIGHT_CS1" != "0" ]; then
      echo -e "${RED}❌ CS1 closing weight mismatch${NC}"
      SCENARIO_C_PASS=false
    fi
  fi
  
  if [ "$SCENARIO_C_PASS" = true ]; then
    echo -e "${GREEN}✅ SCENARIO C PASSED${NC}"
  else
    echo -e "${RED}❌ SCENARIO C FAILED${NC}"
  fi
else
  echo -e "${RED}❌ Failed to transfer (HTTP $HTTP_CODE)${NC}"
  echo "$TRANSFER_DATA"
  SCENARIO_C_PASS=false
fi

# Scenario D: Create outbound
echo ""
echo "=== SCENARIO D: CREATE OUTBOUND (subtype=non_sales, reason=sample) ==="
OUTBOUND_RESPONSE=$(curl -s -X POST "${BASE_URL}/inventory/outbound" \
  -H "Content-Type: application/json" \
  -d "{\"stockIds\":[\"${STOCK_IDS}\"],\"subtype\":\"non_sales\",\"reason\":\"sample\"}" \
  -b "${COOKIE_FILE}" -w "\n%{http_code}")

HTTP_CODE=$(echo "$OUTBOUND_RESPONSE" | tail -n1)
OUTBOUND_DATA=$(echo "$OUTBOUND_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "201" ]; then
  OUTBOUND_TX_ID=$(echo "$OUTBOUND_DATA" | jq -r '.transactionId')
  echo -e "${GREEN}✅ Outbound created successfully${NC}"
  echo "   Transaction ID: $OUTBOUND_TX_ID"
  
  # Verify stock card after outbound
  CARD_RESPONSE=$(curl -s -X GET "${BASE_URL}/inventory-reports/stock-card?productId=${PRODUCT_ID}" \
    -b "${COOKIE_FILE}" -w "\n%{http_code}")
  
  HTTP_CODE=$(echo "$CARD_RESPONSE" | tail -n1)
  CARD_DATA=$(echo "$CARD_RESPONSE" | head -n -1)
  
  if [ "$HTTP_CODE" = "200" ]; then
    CLOSING_WEIGHT=$(echo "$CARD_DATA" | jq -r '.data.summary.closingWeight')
    OUT_MOVEMENT_FOUND=$(echo "$CARD_DATA" | jq '[.data.movements[] | select(.movementType == "OUT" and .referenceType == "NON_SALES")] | length > 0')
    
    echo "   Closing weight: $CLOSING_WEIGHT (expected: 0)"
    echo "   OUT movement with NON_SALES found: $OUT_MOVEMENT_FOUND"
    
    SCENARIO_D_PASS=true
    if [ "$CLOSING_WEIGHT" != "0" ]; then
      echo -e "${RED}❌ Closing weight mismatch${NC}"
      SCENARIO_D_PASS=false
    fi
    if [ "$OUT_MOVEMENT_FOUND" != "true" ]; then
      echo -e "${RED}❌ OUT movement with NON_SALES not found${NC}"
      SCENARIO_D_PASS=false
    fi
    
    if [ "$SCENARIO_D_PASS" = true ]; then
      echo -e "${GREEN}✅ SCENARIO D PASSED${NC}"
    else
      echo -e "${RED}❌ SCENARIO D FAILED${NC}"
    fi
  fi
else
  echo -e "${RED}❌ Failed to create outbound (HTTP $HTTP_CODE)${NC}"
  echo "$OUTBOUND_DATA"
  SCENARIO_D_PASS=false
fi

# Scenario E: Date filter
echo ""
echo "=== SCENARIO E: VERIFY DATE FILTER ==="
TOMORROW=$(date -d "+1 day" +%Y-%m-%d)
NEXT_WEEK=$(date -d "+7 days" +%Y-%m-%d)
TODAY=$(date +%Y-%m-%d)

echo ""
echo "--- Test E.1: Future date range ($TOMORROW to $NEXT_WEEK) ---"
CARD_FUTURE_RESPONSE=$(curl -s -X GET "${BASE_URL}/inventory-reports/stock-card?productId=${PRODUCT_ID}&from=${TOMORROW}&to=${NEXT_WEEK}" \
  -b "${COOKIE_FILE}" -w "\n%{http_code}")

HTTP_CODE=$(echo "$CARD_FUTURE_RESPONSE" | tail -n1)
CARD_FUTURE_DATA=$(echo "$CARD_FUTURE_RESPONSE" | head -n -1)

SCENARIO_E_PASS=true
if [ "$HTTP_CODE" = "200" ]; then
  MOVEMENT_COUNT=$(echo "$CARD_FUTURE_DATA" | jq '.data.movements | length')
  OPENING_WEIGHT=$(echo "$CARD_FUTURE_DATA" | jq -r '.data.opening.weight')
  
  echo "   Movement count: $MOVEMENT_COUNT (expected: 0)"
  echo "   Opening weight: $OPENING_WEIGHT (expected: 0, reflects net of all prior rows)"
  
  if [ "$MOVEMENT_COUNT" != "0" ]; then
    echo -e "${RED}❌ Movement count mismatch${NC}"
    SCENARIO_E_PASS=false
  fi
  if [ "$OPENING_WEIGHT" != "0" ]; then
    echo -e "${RED}❌ Opening weight mismatch${NC}"
    SCENARIO_E_PASS=false
  fi
fi

echo ""
echo "--- Test E.2: Today's date ($TODAY) ---"
CARD_TODAY_RESPONSE=$(curl -s -X GET "${BASE_URL}/inventory-reports/stock-card?productId=${PRODUCT_ID}&from=${TODAY}" \
  -b "${COOKIE_FILE}" -w "\n%{http_code}")

HTTP_CODE=$(echo "$CARD_TODAY_RESPONSE" | tail -n1)
CARD_TODAY_DATA=$(echo "$CARD_TODAY_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
  MOVEMENT_COUNT=$(echo "$CARD_TODAY_DATA" | jq '.data.movements | length')
  echo "   Movement count: $MOVEMENT_COUNT (expected: > 0)"
  
  if [ "$MOVEMENT_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✅ Found movements for today${NC}"
  else
    echo -e "${YELLOW}⚠️  No movements found for today${NC}"
  fi
fi

if [ "$SCENARIO_E_PASS" = true ]; then
  echo -e "${GREEN}✅ SCENARIO E PASSED${NC}"
else
  echo -e "${RED}❌ SCENARIO E FAILED${NC}"
fi

# Scenario F: Regression test
echo ""
echo "=== SCENARIO F: REGRESSION TEST ==="
SCENARIO_F_PASS=true

echo ""
echo "--- Test F.1: GET /inventory-reports/by-product ---"
BY_PRODUCT_RESPONSE=$(curl -s -X GET "${BASE_URL}/inventory-reports/by-product" \
  -b "${COOKIE_FILE}" -w "\n%{http_code}")

HTTP_CODE=$(echo "$BY_PRODUCT_RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✅ by-product endpoint working${NC}"
else
  echo -e "${RED}❌ by-product endpoint failed (HTTP $HTTP_CODE)${NC}"
  SCENARIO_F_PASS=false
fi

echo ""
echo "--- Test F.2: GET /inventory-reports/by-cs ---"
BY_CS_RESPONSE=$(curl -s -X GET "${BASE_URL}/inventory-reports/by-cs" \
  -b "${COOKIE_FILE}" -w "\n%{http_code}")

HTTP_CODE=$(echo "$BY_CS_RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✅ by-cs endpoint working${NC}"
else
  echo -e "${RED}❌ by-cs endpoint failed (HTTP $HTTP_CODE)${NC}"
  SCENARIO_F_PASS=false
fi

if [ "$SCENARIO_F_PASS" = true ]; then
  echo -e "${GREEN}✅ SCENARIO F PASSED${NC}"
else
  echo -e "${RED}❌ SCENARIO F FAILED${NC}"
fi

# Scenario G: Edge case - no productId
echo ""
echo "=== SCENARIO G: EDGE CASE - NO PRODUCT ID ==="
EDGE_RESPONSE=$(curl -s -X GET "${BASE_URL}/inventory-reports/stock-card" \
  -b "${COOKIE_FILE}" -w "\n%{http_code}")

HTTP_CODE=$(echo "$EDGE_RESPONSE" | tail -n1)
EDGE_DATA=$(echo "$EDGE_RESPONSE" | head -n -1)

SCENARIO_G_PASS=false
if [ "$HTTP_CODE" = "400" ]; then
  ERROR_MSG=$(echo "$EDGE_DATA" | jq -r '.error')
  echo "   HTTP Status: $HTTP_CODE (expected: 400)"
  echo "   Error message: $ERROR_MSG"
  
  if echo "$ERROR_MSG" | grep -iq "productId.*required"; then
    echo -e "${GREEN}✅ Correctly rejected with 400 and appropriate error message${NC}"
    SCENARIO_G_PASS=true
  else
    echo -e "${YELLOW}⚠️  Error message doesn't match expected format${NC}"
  fi
else
  echo -e "${RED}❌ Expected 400, got $HTTP_CODE${NC}"
fi

if [ "$SCENARIO_G_PASS" = true ]; then
  echo -e "${GREEN}✅ SCENARIO G PASSED${NC}"
else
  echo -e "${RED}❌ SCENARIO G FAILED${NC}"
fi

# Summary
echo ""
echo "================================================================================"
echo "TEST SUMMARY"
echo "================================================================================"
echo "Scenario A (Inbound): ✅ PASS"
echo "Scenario B (Stock card after inbound): $([ "$SCENARIO_B_PASS" = true ] && echo -e "${GREEN}✅ PASS${NC}" || echo -e "${RED}❌ FAIL${NC}")"
echo "Scenario C (Transfer): $([ "$SCENARIO_C_PASS" = true ] && echo -e "${GREEN}✅ PASS${NC}" || echo -e "${RED}❌ FAIL${NC}")"
echo "Scenario D (Outbound): $([ "$SCENARIO_D_PASS" = true ] && echo -e "${GREEN}✅ PASS${NC}" || echo -e "${RED}❌ FAIL${NC}")"
echo "Scenario E (Date filter): $([ "$SCENARIO_E_PASS" = true ] && echo -e "${GREEN}✅ PASS${NC}" || echo -e "${RED}❌ FAIL${NC}")"
echo "Scenario F (Regression): $([ "$SCENARIO_F_PASS" = true ] && echo -e "${GREEN}✅ PASS${NC}" || echo -e "${RED}❌ FAIL${NC}")"
echo "Scenario G (Edge case): $([ "$SCENARIO_G_PASS" = true ] && echo -e "${GREEN}✅ PASS${NC}" || echo -e "${RED}❌ FAIL${NC}")"
echo "================================================================================"

# Cleanup
rm -f "${COOKIE_FILE}"
