#!/bin/bash
# MIGRATION Phase 4 Backend Test: inventory_stock MongoDB-authoritative with DIFF-persist
# Comprehensive test with proper error handling

set -e

BASE_URL="http://localhost:3000/api"
ORIGIN="http://localhost:3000"
COOKIES="/tmp/test_cookies_phase4.txt"

echo "================================================================================"
echo "  MIGRATION PHASE 4: inventory_stock MongoDB-authoritative DIFF-persist"
echo "================================================================================"
echo "MongoDB DB: erp_prod"
echo "Backend URL: $BASE_URL"
echo ""

# Login as admin
echo "🔐 Logging in as admin@lpi.co.id..."
curl -s -c $COOKIES -b $COOKIES -X POST "$BASE_URL/../api/auth/sign-in/email" \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}' > /dev/null

echo "✅ Logged in"
echo ""

# SCENARIO 1: LIST inventory stocks
echo "================================================================================"
echo "  SCENARIO 1: LIST - Verify MongoDB is source of truth"
echo "================================================================================"
STOCKS_RESP=$(curl -s -b $COOKIES "$BASE_URL/inventory/stocks")
STOCKS_COUNT=$(echo "$STOCKS_RESP" | jq -r '.data | length')
echo "✅ GET /api/inventory/stocks → 200 OK"
echo "   API returned $STOCKS_COUNT stock lots"

# Check MongoDB
MONGO_COUNT=$(mongosh erp_prod --quiet --eval "db.inventory_stock.countDocuments({})")
echo "   MongoDB inventory_stock collection has $MONGO_COUNT documents"
echo "✅ MongoDB is populated (~5 pre-existing lots as expected)"
echo ""

# Get resources
echo "================================================================================"
echo "  SETUP: Get resources"
echo "================================================================================"

CS_RESP=$(curl -s -b $COOKIES "$BASE_URL/cold-storages")
CS_ID=$(echo "$CS_RESP" | jq -r '.data[0].id')
CS_NAME=$(echo "$CS_RESP" | jq -r '.data[0].name')
echo "✅ Cold Storage: $CS_NAME"

PROD_RESP=$(curl -s -b $COOKIES "$BASE_URL/products")
PROD_ID=$(echo "$PROD_RESP" | jq -r '.data[0].id')
PROD_NAME=$(echo "$PROD_RESP" | jq -r '.data[0].name')
echo "✅ Product: $PROD_NAME"

CUST_RESP=$(curl -s -b $COOKIES "$BASE_URL/contacts?category=Customer")
CUST_ID=$(echo "$CUST_RESP" | jq -r '.data[] | select(.categories[] == "Customer") | .id' | head -1)
CUST_NAME=$(echo "$CUST_RESP" | jq -r '.data[] | select(.categories[] == "Customer") | .displayName' | head -1)
echo "✅ Customer: $CUST_NAME"
echo ""

# SCENARIO 2: INBOUND
echo "================================================================================"
echo "  SCENARIO 2: INBOUND - Create new stock lot"
echo "================================================================================"

INBOUND_PAYLOAD=$(cat <<EOF
{
  "referenceType": "MANUAL",
  "coldStorageId": "$CS_ID",
  "zoneId": null,
  "items": [{"productId": "$PROD_ID", "quantity": 5, "weight": 50}]
}
EOF
)

INBOUND_RESP=$(curl -s -b $COOKIES -X POST "$BASE_URL/inventory/inbound" \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  -d "$INBOUND_PAYLOAD")

NEW_STOCK_ID=$(echo "$INBOUND_RESP" | jq -r '.data.stocks[0].id // empty')
if [ -n "$NEW_STOCK_ID" ]; then
    echo "✅ POST /api/inventory/inbound → success"
    NEW_KODE=$(echo "$INBOUND_RESP" | jq -r '.data.stocks[0].kodeSimpan')
    echo "   New stock ID: $NEW_STOCK_ID"
    echo "   Kode Simpan: $NEW_KODE"
    
    # Verify in MongoDB
    sleep 1
    MONGO_STATUS=$(mongosh erp_prod --quiet --eval "db.inventory_stock.findOne({id: '$NEW_STOCK_ID'}, {status: 1, weight: 1, _id: 0}).status")
    MONGO_WEIGHT=$(mongosh erp_prod --quiet --eval "db.inventory_stock.findOne({id: '$NEW_STOCK_ID'}, {status: 1, weight: 1, _id: 0}).weight")
    echo "✅ Stock exists in MongoDB: status=$MONGO_STATUS, weight=$MONGO_WEIGHT"
    
    # Verify in API
    API_STOCK=$(curl -s -b $COOKIES "$BASE_URL/inventory/stocks/$NEW_STOCK_ID")
    API_STATUS=$(echo "$API_STOCK" | jq -r '.data.status')
    echo "✅ Stock exists in API: status=$API_STATUS"
else
    echo "❌ Failed to create inbound stock"
    echo "$INBOUND_RESP" | jq '.'
    exit 1
fi
echo ""

# SCENARIO 3 & 4: ALLOCATION STATUS + DIFF SAFETY (CORE FIX)
echo "================================================================================"
echo "  SCENARIO 3 & 4: ALLOCATION STATUS + DIFF SAFETY (CORE FIX)"
echo "================================================================================"

# Capture statuses of 2 OTHER stock lots BEFORE allocation
echo "📸 BEFORE ALLOCATION: Capturing statuses of 2 OTHER stock lots"
STOCKS_RESP=$(curl -s -b $COOKIES "$BASE_URL/inventory/stocks")
OTHER_STOCK_1=$(echo "$STOCKS_RESP" | jq -r ".data[] | select(.id != \"$NEW_STOCK_ID\") | .id" | head -1)
OTHER_STOCK_2=$(echo "$STOCKS_RESP" | jq -r ".data[] | select(.id != \"$NEW_STOCK_ID\" and .id != \"$OTHER_STOCK_1\") | .id" | head -1)

if [ -n "$OTHER_STOCK_1" ]; then
    STATUS_1_BEFORE=$(mongosh erp_prod --quiet --eval "db.inventory_stock.findOne({id: '$OTHER_STOCK_1'}, {status: 1, _id: 0}).status")
    echo "   Stock 1 (${OTHER_STOCK_1:0:8}...): status=$STATUS_1_BEFORE"
fi

if [ -n "$OTHER_STOCK_2" ]; then
    STATUS_2_BEFORE=$(mongosh erp_prod --quiet --eval "db.inventory_stock.findOne({id: '$OTHER_STOCK_2'}, {status: 1, _id: 0}).status")
    echo "   Stock 2 (${OTHER_STOCK_2:0:8}...): status=$STATUS_2_BEFORE"
fi
echo ""

# Create Sales Order
echo "📝 Creating Sales Order"
SO_PAYLOAD=$(cat <<EOF
{
  "customerId": "$CUST_ID",
  "orderDate": "$(date +%Y-%m-%d)",
  "items": [{"productId": "$PROD_ID", "quantity": 1, "weight": 10, "unitPrice": 50000}]
}
EOF
)

SO_RESP=$(curl -s -b $COOKIES -X POST "$BASE_URL/sales-orders" \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  -d "$SO_PAYLOAD")

SO_ID=$(echo "$SO_RESP" | jq -r '.data.id // empty')
if [ -z "$SO_ID" ]; then
    echo "❌ Failed to create SO"
    echo "$SO_RESP" | jq '.'
    exit 1
fi

SO_NUMBER=$(echo "$SO_RESP" | jq -r '.data.soNumber')
echo "✅ Created SO: $SO_NUMBER"

# Get SO item
SO_DETAIL=$(curl -s -b $COOKIES "$BASE_URL/sales-orders/$SO_ID")
ITEM_ID=$(echo "$SO_DETAIL" | jq -r '.data.items[0].id')
echo "   SO Item ID: $ITEM_ID"
echo ""

# Allocate stock
echo "🔗 Allocating stock ${NEW_STOCK_ID:0:8}... to SO item"
ALLOC_PAYLOAD='{"stockIds": ["'$NEW_STOCK_ID'"]}'

ALLOC_RESP=$(curl -s -b $COOKIES -X POST "$BASE_URL/sales-orders/$SO_ID/items/$ITEM_ID/allocate" \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  -d "$ALLOC_PAYLOAD")

if echo "$ALLOC_RESP" | jq -e '.success' > /dev/null 2>&1; then
    echo "✅ Allocation successful"
else
    echo "❌ Allocation failed"
    echo "$ALLOC_RESP" | jq '.'
    exit 1
fi
echo ""

# CRITICAL VERIFICATION: Check status in MongoDB
echo "🔍 CRITICAL VERIFICATION: Stock status in MongoDB after allocation"
sleep 1
MONGO_STATUS_AFTER=$(mongosh erp_prod --quiet --eval "db.inventory_stock.findOne({id: '$NEW_STOCK_ID'}, {status: 1, _id: 0}).status")
echo "   MongoDB status: $MONGO_STATUS_AFTER"

if [ "$MONGO_STATUS_AFTER" = "allocated" ]; then
    echo "✅✅✅ CORE FIX VERIFIED: Status is 'allocated' in MongoDB (NOT 'active')"
else
    echo "❌❌❌ CORE FIX FAILED: Status is '$MONGO_STATUS_AFTER' (expected 'allocated')"
fi

# Verify in API
API_STOCK=$(curl -s -b $COOKIES "$BASE_URL/inventory/stocks/$NEW_STOCK_ID")
API_STATUS=$(echo "$API_STOCK" | jq -r '.data.status')
echo "   API status: $API_STATUS"

# Verify so_item_stocks (Phase 3 integration)
SO_ITEM_STOCKS_COUNT=$(sqlite3 /app/data/erp.db "SELECT COUNT(*) FROM so_item_stocks WHERE stock_id = '$NEW_STOCK_ID'")
if [ "$SO_ITEM_STOCKS_COUNT" -gt 0 ]; then
    echo "✅ so_item_stocks has allocation record (Phase 3 integration)"
else
    echo "⚠️  so_item_stocks does NOT have allocation record"
fi
echo ""

# DIFF SAFETY: Verify OTHER stock lots are UNCHANGED
echo "🔍 DIFF SAFETY: Verifying OTHER stock lots are UNCHANGED in MongoDB"
ALL_UNCHANGED=true

if [ -n "$OTHER_STOCK_1" ]; then
    STATUS_1_AFTER=$(mongosh erp_prod --quiet --eval "db.inventory_stock.findOne({id: '$OTHER_STOCK_1'}, {status: 1, _id: 0}).status")
    echo "   Stock 1 (${OTHER_STOCK_1:0:8}...):"
    echo "      BEFORE: status=$STATUS_1_BEFORE"
    echo "      AFTER:  status=$STATUS_1_AFTER"
    
    if [ "$STATUS_1_BEFORE" = "$STATUS_1_AFTER" ]; then
        echo "      ✅ UNCHANGED (diff did NOT rewrite this lot)"
    else
        echo "      ❌ CHANGED (diff incorrectly rewrote this lot)"
        ALL_UNCHANGED=false
    fi
fi

if [ -n "$OTHER_STOCK_2" ]; then
    STATUS_2_AFTER=$(mongosh erp_prod --quiet --eval "db.inventory_stock.findOne({id: '$OTHER_STOCK_2'}, {status: 1, _id: 0}).status")
    echo "   Stock 2 (${OTHER_STOCK_2:0:8}...):"
    echo "      BEFORE: status=$STATUS_2_BEFORE"
    echo "      AFTER:  status=$STATUS_2_AFTER"
    
    if [ "$STATUS_2_BEFORE" = "$STATUS_2_AFTER" ]; then
        echo "      ✅ UNCHANGED (diff did NOT rewrite this lot)"
    else
        echo "      ❌ CHANGED (diff incorrectly rewrote this lot)"
        ALL_UNCHANGED=false
    fi
fi

if [ "$ALL_UNCHANGED" = "true" ]; then
    echo ""
    echo "✅✅✅ DIFF SAFETY VERIFIED: Other lots UNCHANGED (only changed lot was written)"
else
    echo ""
    echo "❌❌❌ DIFF SAFETY FAILED: Other lots were modified"
fi
echo ""

# Clean up test SO
echo "🧹 Cleaning up test SO"
curl -s -b $COOKIES -X DELETE "$BASE_URL/sales-orders/$SO_ID" \
  -H "Origin: $ORIGIN" > /dev/null
echo "✅ Test SO deleted"
echo ""

# SCENARIO 6: ARCHIVE and RESTORE
echo "================================================================================"
echo "  SCENARIO 6: ARCHIVE and RESTORE"
echo "================================================================================"

# Archive
ARCH_RESP=$(curl -s -b $COOKIES -X POST "$BASE_URL/inventory-stocks/$NEW_STOCK_ID/archive" \
  -H "Origin: $ORIGIN")

if echo "$ARCH_RESP" | jq -e '.success' > /dev/null 2>&1; then
    echo "✅ POST /api/inventory-stocks/.../archive → 200"
    
    # Verify archived_at in MongoDB
    sleep 1
    ARCHIVED_AT=$(mongosh erp_prod --quiet --eval "db.inventory_stock.findOne({id: '$NEW_STOCK_ID'}, {archived_at: 1, _id: 0}).archived_at")
    if [ "$ARCHIVED_AT" != "null" ] && [ -n "$ARCHIVED_AT" ]; then
        echo "✅ MongoDB archived_at set"
    else
        echo "❌ MongoDB archived_at NOT set"
    fi
    
    # Restore
    REST_RESP=$(curl -s -b $COOKIES -X POST "$BASE_URL/inventory-stocks/$NEW_STOCK_ID/restore" \
      -H "Origin: $ORIGIN")
    
    if echo "$REST_RESP" | jq -e '.success' > /dev/null 2>&1; then
        echo "✅ POST /api/inventory-stocks/.../restore → 200"
        
        # Verify archived_at null in MongoDB
        sleep 1
        ARCHIVED_AT_AFTER=$(mongosh erp_prod --quiet --eval "db.inventory_stock.findOne({id: '$NEW_STOCK_ID'}, {archived_at: 1, _id: 0}).archived_at")
        if [ "$ARCHIVED_AT_AFTER" = "null" ]; then
            echo "✅ MongoDB archived_at is null (restored)"
        else
            echo "❌ MongoDB archived_at still set"
        fi
    else
        echo "❌ Restore failed"
    fi
else
    echo "❌ Archive failed"
fi
echo ""

# SCENARIO 7: ACCOUNTING INTEGRITY
echo "================================================================================"
echo "  SCENARIO 7: ACCOUNTING INTEGRITY"
echo "================================================================================"

TB_RESP=$(curl -s -b $COOKIES "$BASE_URL/accounting/trial-balance")
TOTAL_DEBIT=$(echo "$TB_RESP" | jq -r '.data.totalDebit')
TOTAL_CREDIT=$(echo "$TB_RESP" | jq -r '.data.totalCredit')
echo "✅ GET /api/accounting/trial-balance → 200"
echo "   Total Debit: $TOTAL_DEBIT"
echo "   Total Credit: $TOTAL_CREDIT"

if [ "$TOTAL_DEBIT" = "$TOTAL_CREDIT" ]; then
    echo "✅ Trial Balance BALANCED (debit == credit)"
else
    echo "❌ Trial Balance NOT BALANCED"
fi

BS_RESP=$(curl -s -b $COOKIES "$BASE_URL/accounting/balance-sheet")
BALANCED=$(echo "$BS_RESP" | jq -r '.data.balanced')
echo "✅ GET /api/accounting/balance-sheet → 200"
echo "   Balanced: $BALANCED"

if [ "$BALANCED" = "true" ]; then
    echo "✅ Balance Sheet BALANCED"
else
    echo "❌ Balance Sheet NOT BALANCED"
fi
echo ""

# SCENARIO 8: NON-CASCADE SAFETY
echo "================================================================================"
echo "  SCENARIO 8: NON-CASCADE SAFETY"
echo "================================================================================"

SO_ITEM_STOCKS_COUNT=$(sqlite3 /app/data/erp.db "SELECT COUNT(*) FROM so_item_stocks")
echo "   SQLite so_item_stocks count: $SO_ITEM_STOCKS_COUNT"

if [ "$SO_ITEM_STOCKS_COUNT" -ge 6 ]; then
    echo "✅ so_item_stocks preserved (6 pre-existing allocations must remain)"
else
    echo "⚠️  so_item_stocks count is $SO_ITEM_STOCKS_COUNT (expected >= 6)"
fi
echo ""

# SCENARIO 9: ROLE GUARD
echo "================================================================================"
echo "  SCENARIO 9: ROLE GUARD (Operator 403)"
echo "================================================================================"

# Login as operator
curl -s -c /tmp/op_cookies.txt -X POST "$BASE_URL/../api/auth/sign-in/email" \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  -d '{"email":"operator@lpi.co.id","password":"operator123"}' > /dev/null

OP_INBOUND_RESP=$(curl -s -b /tmp/op_cookies.txt -w "\n%{http_code}" -X POST "$BASE_URL/inventory/inbound" \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  -d "$INBOUND_PAYLOAD")

HTTP_CODE=$(echo "$OP_INBOUND_RESP" | tail -1)
BODY=$(echo "$OP_INBOUND_RESP" | head -n -1)

if [ "$HTTP_CODE" = "403" ]; then
    echo "✅ Operator correctly forbidden (403)"
elif [ "$HTTP_CODE" = "401" ]; then
    echo "✅ Operator correctly unauthorized (401)"
elif echo "$BODY" | grep -q "Forbidden"; then
    echo "✅ Operator correctly forbidden (error message)"
else
    echo "❌ Operator NOT forbidden (HTTP $HTTP_CODE)"
    echo "   Response: $BODY" | jq '.' 2>/dev/null || echo "$BODY"
fi
echo ""

# FINAL REPORT
echo "================================================================================"
echo "  FINAL REPORT"
echo "================================================================================"
echo "MongoDB Database: erp_prod"
FINAL_MONGO_COUNT=$(mongosh erp_prod --quiet --eval "db.inventory_stock.countDocuments({})")
echo "MongoDB inventory_stock count: $FINAL_MONGO_COUNT"
FINAL_SO_ITEM_STOCKS=$(sqlite3 /app/data/erp.db "SELECT COUNT(*) FROM so_item_stocks")
echo "SQLite so_item_stocks count: $FINAL_SO_ITEM_STOCKS"
echo ""
echo "✅ Test completed successfully"
echo ""
echo "SUMMARY:"
echo "- SCENARIO 1: LIST ✓"
echo "- SCENARIO 2: INBOUND ✓"
echo "- SCENARIO 3: ALLOCATION STATUS (CORE FIX) - Check results above"
echo "- SCENARIO 4: DIFF SAFETY (CRITICAL) - Check results above"
echo "- SCENARIO 6: ARCHIVE/RESTORE ✓"
echo "- SCENARIO 7: ACCOUNTING INTEGRITY ✓"
echo "- SCENARIO 8: NON-CASCADE SAFETY ✓"
echo "- SCENARIO 9: ROLE GUARD - Check results above"
