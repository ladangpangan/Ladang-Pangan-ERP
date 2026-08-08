#!/bin/bash
# Backend test for Receipt (Penerimaan) bugfix using curl
# Receipts must use REAL SHIPPED weight (from Surat Jalan) as basis, not original SO weight.

set -e

BASE_URL="http://localhost:3000/api"
COOKIE_FILE="/tmp/test_cookies.txt"

echo "================================================================================"
echo "TEST: Receipt (Penerimaan) uses REAL SHIPPED weight as basis"
echo "================================================================================"

# Step 0: Login
echo ""
echo "--- STEP 0: Login ---"
curl -s -X POST "$BASE_URL/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}' \
  -c "$COOKIE_FILE" > /dev/null

if [ ! -f "$COOKIE_FILE" ]; then
    echo "❌ Login failed - no cookie file created"
    exit 1
fi

echo "✅ Logged in as admin@lpi.co.id"

# Step 1: Create product
echo ""
echo "--- STEP 1: Create Product ---"
PRODUCT_RESP=$(curl -s -X POST "$BASE_URL/products" \
  -b "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -d '{"sku":"RCP-PR1","name":"Rcp Prod","unit":"kg","basePrice":50000}')

PRODUCT_ID=$(echo "$PRODUCT_RESP" | jq -r '.data.id')
if [ "$PRODUCT_ID" = "null" ] || [ -z "$PRODUCT_ID" ]; then
    echo "❌ Failed to create product"
    echo "$PRODUCT_RESP"
    exit 1
fi

echo "✅ Product created: RCP-PR1 (ID: $PRODUCT_ID)"

# Step 2: Create customer
echo ""
echo "--- STEP 2: Create Customer ---"
CUSTOMER_RESP=$(curl -s -X POST "$BASE_URL/contacts" \
  -b "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -d '{"categories":["Customer"],"displayName":"Rcp Cust","code":"CUST-RCP1"}')

CUSTOMER_ID=$(echo "$CUSTOMER_RESP" | jq -r '.data.id')
if [ "$CUSTOMER_ID" = "null" ] || [ -z "$CUSTOMER_ID" ]; then
    echo "❌ Failed to create customer"
    echo "$CUSTOMER_RESP"
    exit 1
fi

echo "✅ Customer created: Rcp Cust (ID: $CUSTOMER_ID)"

# Step 3: Create SO
echo ""
echo "--- STEP 3: Create Sales Order ---"
SO_RESP=$(curl -s -X POST "$BASE_URL/sales-orders" \
  -b "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -d "{\"customerId\":\"$CUSTOMER_ID\",\"orderDate\":\"$(date -Iseconds)\",\"fulfillmentType\":\"stock\",\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":1,\"weight\":100,\"unitPrice\":50000}]}")

SO_ID=$(echo "$SO_RESP" | jq -r '.data.id')
SO_NUMBER=$(echo "$SO_RESP" | jq -r '.data.soNumber')
SO_TOTAL=$(echo "$SO_RESP" | jq -r '.data.totalAmount')

if [ "$SO_ID" = "null" ] || [ -z "$SO_ID" ]; then
    echo "❌ Failed to create SO"
    echo "$SO_RESP"
    exit 1
fi

echo "✅ SO created: $SO_NUMBER (ID: $SO_ID)"
echo "   Initial totalAmount: Rp $(printf "%'d" $SO_TOTAL)"

if [ "$SO_TOTAL" != "5000000" ]; then
    echo "❌ FAIL: Expected SO total 5,000,000, got $SO_TOTAL"
    exit 1
fi
echo "✅ SO total correct: Rp 5,000,000 (50000 × 100kg)"

# Get SO item ID
SO_DETAIL=$(curl -s -X GET "$BASE_URL/sales-orders/$SO_ID" -b "$COOKIE_FILE")
SO_ITEM_ID=$(echo "$SO_DETAIL" | jq -r '.data.items[0].id')
echo "   SO item ID: $SO_ITEM_ID"

# Step 4: Advance status
echo ""
echo "--- STEP 4: Advance SO Status ---"

# Draft → Confirmed
curl -s -X POST "$BASE_URL/sales-orders/$SO_ID/status" \
  -b "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -d '{"status":"Confirmed"}' > /dev/null
echo "✅ SO advanced to Confirmed"

# Confirmed → Packed
curl -s -X POST "$BASE_URL/sales-orders/$SO_ID/status" \
  -b "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -d '{"status":"Packed"}' > /dev/null
echo "✅ SO advanced to Packed"

# Step 5: Create Surat Jalan with shippedWeight=80
echo ""
echo "--- STEP 5: Create Surat Jalan with shippedWeight=80 ---"
SJ_RESP=$(curl -s -X POST "$BASE_URL/sales-orders/$SO_ID/surat-jalan" \
  -b "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -d "{\"items\":[{\"itemId\":\"$SO_ITEM_ID\",\"shippedWeight\":80}]}")

SJ_NUMBER=$(echo "$SJ_RESP" | jq -r '.data.sjNumber')
if [ "$SJ_NUMBER" = "null" ] || [ -z "$SJ_NUMBER" ]; then
    echo "❌ Failed to create Surat Jalan"
    echo "$SJ_RESP"
    exit 1
fi
echo "✅ Surat Jalan created: $SJ_NUMBER"

# Verify SO total recomputed
SO_DETAIL=$(curl -s -X GET "$BASE_URL/sales-orders/$SO_ID" -b "$COOKIE_FILE")
SO_TOTAL_AFTER=$(echo "$SO_DETAIL" | jq -r '.data.totalAmount')
SHIPPED_WEIGHT=$(echo "$SO_DETAIL" | jq -r '.data.items[0].shippedWeight')

echo "   SO totalAmount after SJ: Rp $(printf "%'d" $SO_TOTAL_AFTER)"

if [ "$SO_TOTAL_AFTER" != "4000000" ]; then
    echo "❌ FAIL: Expected SO total 4,000,000 after SJ, got $SO_TOTAL_AFTER"
    exit 1
fi
echo "✅ SO total recomputed correctly: Rp 4,000,000 (50000 × 80kg shipped)"

echo "   Item shippedWeight: $SHIPPED_WEIGHT kg"
if [ "$SHIPPED_WEIGHT" != "80" ]; then
    echo "❌ FAIL: Expected shippedWeight 80, got $SHIPPED_WEIGHT"
    exit 1
fi
echo "✅ Item shippedWeight recorded correctly: 80 kg"

# Step 6: CRITICAL TEST - Create receipt with receivedWeight=75
echo ""
echo "--- STEP 6: CRITICAL TEST - Create Receipt with receivedWeight=75 ---"
echo "   Expected: orderedWeight (basis) = 80 (SHIPPED weight, NOT 100)"
echo "   Expected: shrinkageWeight = 5 (80 - 75)"

RECEIPT_RESP=$(curl -s -X POST "$BASE_URL/sales-orders/$SO_ID/receipts" \
  -b "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -d "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"receivedWeight\":75}]}")

RECEIPT_NUMBER=$(echo "$RECEIPT_RESP" | jq -r '.data.receiptNumber')
if [ "$RECEIPT_NUMBER" = "null" ] || [ -z "$RECEIPT_NUMBER" ]; then
    echo "❌ Failed to create receipt"
    echo "$RECEIPT_RESP"
    exit 1
fi
echo "✅ Receipt created: $RECEIPT_NUMBER"

# Verify receipt line values
ORDERED_WEIGHT=$(echo "$RECEIPT_RESP" | jq -r '.data.items[0].orderedWeight')
RECEIVED_WEIGHT=$(echo "$RECEIPT_RESP" | jq -r '.data.items[0].receivedWeight')
SHRINKAGE_WEIGHT=$(echo "$RECEIPT_RESP" | jq -r '.data.items[0].shrinkageWeight')

echo ""
echo "   ACTUAL VALUES:"
echo "   - orderedWeight (basis): $ORDERED_WEIGHT kg"
echo "   - receivedWeight: $RECEIVED_WEIGHT kg"
echo "   - shrinkageWeight: $SHRINKAGE_WEIGHT kg"

# CRITICAL VERIFICATION
if [ "$ORDERED_WEIGHT" != "80" ]; then
    echo ""
    echo "❌ FAIL: orderedWeight (basis) should be 80 (SHIPPED weight), got $ORDERED_WEIGHT"
    echo "   This means the receipt is using ORIGINAL SO weight (100) instead of SHIPPED weight (80)"
    exit 1
fi
echo ""
echo "✅ PASS: orderedWeight (basis) = 80 kg (SHIPPED weight, NOT original 100 kg)"

if [ "$SHRINKAGE_WEIGHT" != "5" ]; then
    echo "❌ FAIL: shrinkageWeight should be 5 (80-75), got $SHRINKAGE_WEIGHT"
    exit 1
fi
echo "✅ PASS: shrinkageWeight = 5 kg (80 - 75)"

# Step 7: Over-cap test
echo ""
echo "--- STEP 7: Over-cap Test - receivedWeight=85 (exceeds shipped 80) ---"
echo "   Expected: 400 rejection with error about exceeding 80 kg"

OVERCAP_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/sales-orders/$SO_ID/receipts" \
  -b "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -d "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"receivedWeight\":85}]}")

HTTP_CODE=$(echo "$OVERCAP_RESP" | tail -n1)
ERROR_MSG=$(echo "$OVERCAP_RESP" | head -n-1 | jq -r '.error // empty')

if [ "$HTTP_CODE" = "201" ]; then
    echo "❌ FAIL: Receipt with receivedWeight=85 should be REJECTED, but got 201"
    exit 1
fi

if [ "$HTTP_CODE" != "400" ]; then
    echo "❌ FAIL: Expected 400 rejection, got $HTTP_CODE"
    exit 1
fi

echo ""
echo "   ACTUAL ERROR MESSAGE:"
echo "   $ERROR_MSG"

# Verify error message mentions 80 kg (shipped weight)
if ! echo "$ERROR_MSG" | grep -q "80"; then
    echo ""
    echo "❌ FAIL: Error message should reference 80 kg (shipped weight), not 100 kg"
    echo "   This means validation is using ORIGINAL SO weight instead of SHIPPED weight"
    exit 1
fi

if ! echo "$ERROR_MSG" | grep -q "85"; then
    echo "❌ FAIL: Error message should mention received weight 85 kg"
    exit 1
fi

echo ""
echo "✅ PASS: Receipt correctly rejected with error referencing 80 kg (shipped weight)"

echo ""
echo "================================================================================"
echo "✅ ALL TESTS PASSED"
echo "================================================================================"
echo ""
echo "SUMMARY:"
echo "✅ Step 1: Product created"
echo "✅ Step 2: Customer created"
echo "✅ Step 3: SO created with weight=100, total=5,000,000"
echo "✅ Step 4: SO advanced Draft→Confirmed→Packed"
echo "✅ Step 5: Surat Jalan created with shippedWeight=80, SO total→4,000,000"
echo "✅ Step 6: Receipt created with receivedWeight=75"
echo "   - orderedWeight (basis) = 80 kg (SHIPPED weight, NOT 100)"
echo "   - shrinkageWeight = 5 kg (80 - 75)"
echo "✅ Step 7: Receipt with receivedWeight=85 rejected (exceeds 80 kg shipped)"
echo ""
echo "✅ BUGFIX VERIFIED: Receipts use REAL SHIPPED weight as basis"

# Cleanup
rm -f "$COOKIE_FILE"
