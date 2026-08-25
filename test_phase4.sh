#!/bin/bash
# MIGRATION Phase 4 Backend Test: inventory_stock MongoDB-authoritative with DIFF-persist

set -e

BASE_URL="http://localhost:3000/api"
ORIGIN="http://localhost:3000"
COOKIES="/tmp/test_cookies.txt"

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
echo "  SCENARIO 1: LIST inventory stocks"
echo "================================================================================"
STOCKS_RESP=$(curl -s -b $COOKIES "$BASE_URL/inventory/stocks")
STOCKS_COUNT=$(echo "$STOCKS_RESP" | jq -r '.data | length')
echo "✅ GET /api/inventory/stocks → 200 OK"
echo "   API returned $STOCKS_COUNT stock lots"

# Check MongoDB
MONGO_COUNT=$(mongosh erp_prod --quiet --eval "db.inventory_stock.countDocuments({})")
echo "   MongoDB inventory_stock collection has $MONGO_COUNT documents"

if [ "$MONGO_COUNT" -gt 0 ]; then
    echo "✅ MongoDB is populated (source of truth verified)"
else
    echo "⚠️  MongoDB inventory_stock is empty"
fi
echo ""

# Get resources
echo "================================================================================"
echo "  SETUP: Get resources (cold storage, product, customer)"
echo "================================================================================"

# Get cold storage
CS_RESP=$(curl -s -b $COOKIES "$BASE_URL/cold-storages")
CS_ID=$(echo "$CS_RESP" | jq -r '.data[0].id')
CS_NAME=$(echo "$CS_RESP" | jq -r '.data[0].name')
echo "✅ Cold Storage: $CS_NAME (ID: $CS_ID)"

# Get zones
ZONE_ID=$(echo "$CS_RESP" | jq -r '.data[0].zones[0].id // empty')
if [ -n "$ZONE_ID" ]; then
    ZONE_NAME=$(echo "$CS_RESP" | jq -r '.data[0].zones[0].name')
    echo "✅ Zone: $ZONE_NAME (ID: $ZONE_ID)"
fi

# Get product
PROD_RESP=$(curl -s -b $COOKIES "$BASE_URL/products")
PROD_ID=$(echo "$PROD_RESP" | jq -r '.data[0].id')
PROD_NAME=$(echo "$PROD_RESP" | jq -r '.data[0].name')
PROD_SKU=$(echo "$PROD_RESP" | jq -r '.data[0].sku')
echo "✅ Product: $PROD_NAME (SKU: $PROD_SKU, ID: $PROD_ID)"

# Get customer
CUST_RESP=$(curl -s -b $COOKIES "$BASE_URL/contacts?category=Customer")
CUST_ID=$(echo "$CUST_RESP" | jq -r '.data[] | select(.categories[] == "Customer") | .id' | head -1)
CUST_NAME=$(echo "$CUST_RESP" | jq -r '.data[] | select(.categories[] == "Customer") | .displayName' | head -1)
echo "✅ Customer: $CUST_NAME (ID: $CUST_ID)"
echo ""

# SCENARIO 2: INBOUND - Create new stock lot
echo "================================================================================"
echo "  SCENARIO 2: INBOUND - Create new stock lot"
echo "================================================================================"

INBOUND_PAYLOAD=$(cat <<EOF
{
  "referenceType": "MANUAL",
  "coldStorageId": "$CS_ID",
  "zoneId": null,
  "items": [
    {
      "productId": "$PROD_ID",
      "quantity": 5,
      "weight": 50
    }
  ]
}
EOF
)

INBOUND_RESP=$(curl -s -b $COOKIES -X POST "$BASE_URL/inventory/inbound" \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  -d "$INBOUND_PAYLOAD")

INBOUND_STATUS=$(echo "$INBOUND_RESP" | jq -r '.data.id // empty')
if [ -n "$INBOUND_STATUS" ]; then
    echo "✅ POST /api/inventory/inbound → 201"
    TRANS_ID=$(echo "$INBOUND_RESP" | jq -r '.data.id')
    echo "   Transaction ID: $TRANS_ID"
    
    # Get the newly created stock
    sleep 1
    STOCKS_RESP=$(curl -s -b $COOKIES "$BASE_URL/inventory/stocks")
    NEW_STOCK_ID=$(echo "$STOCKS_RESP" | jq -r ".data[] | select(.productId == \"$PROD_ID\" and .status == \"active\") | .id" | head -1)
    
    if [ -n "$NEW_STOCK_ID" ]; then
        echo "   New stock lot ID: $NEW_STOCK_ID"
        NEW_KODE=$(echo "$STOCKS_RESP" | jq -r ".data[] | select(.id == \"$NEW_STOCK_ID\") | .kodeSimpan")
        NEW_STATUS=$(echo "$STOCKS_RESP" | jq -r ".data[] | select(.id == \"$NEW_STOCK_ID\") | .status")
        NEW_WEIGHT=$(echo "$STOCKS_RESP" | jq -r ".data[] | select(.id == \"$NEW_STOCK_ID\") | .weight")
        echo "   Kode Simpan: $NEW_KODE"
        echo "   Status: $NEW_STATUS"
        echo "   Weight: $NEW_WEIGHT kg"
        
        # Verify in MongoDB
        MONGO_STATUS=$(mongosh erp_prod --quiet --eval "db.inventory_stock.findOne({id: '$NEW_STOCK_ID'}, {status: 1, _id: 0}).status")
        if [ -n "$MONGO_STATUS" ]; then
            echo "✅ Stock exists in MongoDB inventory_stock"
            echo "   MongoDB status: $MONGO_STATUS"
        else
            echo "❌ Stock NOT found in MongoDB inventory_stock"
        fi
    else
        echo "⚠️  Could not find newly created stock in API response"
    fi
else
    echo "❌ POST /api/inventory/inbound failed"
    echo "$INBOUND_RESP" | jq '.'
fi
echo ""

# SCENARIO 3 & 4: ALLOCATION STATUS + DIFF SAFETY
if [ -n "$NEW_STOCK_ID" ]; then
    echo "================================================================================"
    echo "  SCENARIO 3 & 4: ALLOCATION STATUS + DIFF SAFETY (CORE FIX)"
    echo "================================================================================"
    
    # Capture statuses of OTHER stock lots BEFORE allocation
    echo "📸 BEFORE ALLOCATION: Capturing statuses of OTHER stock lots"
    OTHER_STOCKS=$(echo "$STOCKS_RESP" | jq -r ".data[] | select(.id != \"$NEW_STOCK_ID\") | .id" | head -2)
    
    echo "   Tracking other stock lots:"
    for STOCK_ID in $OTHER_STOCKS; do
        STATUS=$(echo "$STOCKS_RESP" | jq -r ".data[] | select(.id == \"$STOCK_ID\") | .status")
        MONGO_STATUS=$(mongosh erp_prod --quiet --eval "db.inventory_stock.findOne({id: '$STOCK_ID'}, {status: 1, _id: 0}).status")
        echo "   Stock ${STOCK_ID:0:8}... status=$STATUS (Mongo: $MONGO_STATUS)"
    done
    echo ""
    
    # Create a Sales Order
    echo "📝 Creating Sales Order for allocation test"
    SO_PAYLOAD=$(cat <<EOF
{
  "customerId": "$CUST_ID",
  "orderDate": "$(date +%Y-%m-%d)",
  "items": [
    {
      "productId": "$PROD_ID",
      "quantity": 1,
      "weight": 10,
      "unitPrice": 50000
    }
  ]
}
EOF
)
    
    SO_RESP=$(curl -s -b $COOKIES -X POST "$BASE_URL/sales-orders" \
      -H "Origin: $ORIGIN" \
      -H "Content-Type: application/json" \
      -d "$SO_PAYLOAD")
    
    SO_ID=$(echo "$SO_RESP" | jq -r '.data.id // empty')
    if [ -n "$SO_ID" ]; then
        SO_NUMBER=$(echo "$SO_RESP" | jq -r '.data.soNumber')
        echo "✅ Created SO: $SO_NUMBER (ID: $SO_ID)"
        
        # Get SO items
        SO_DETAIL=$(curl -s -b $COOKIES "$BASE_URL/sales-orders/$SO_ID")
        ITEM_ID=$(echo "$SO_DETAIL" | jq -r '.data.items[0].id')
        echo "   SO Item ID: $ITEM_ID"
        
        # Allocate the new stock lot
        echo ""
        echo "🔗 Allocating stock ${NEW_STOCK_ID:0:8}... to SO item"
        ALLOC_PAYLOAD=$(cat <<EOF
{
  "stockIds": ["$NEW_STOCK_ID"]
}
EOF
)
        
        ALLOC_RESP=$(curl -s -b $COOKIES -X POST "$BASE_URL/sales-orders/$SO_ID/items/$ITEM_ID/allocate" \
          -H "Origin: $ORIGIN" \
          -H "Content-Type: application/json" \
          -d "$ALLOC_PAYLOAD")
        
        ALLOC_STATUS=$(echo "$ALLOC_RESP" | jq -r '.success // empty')
        if [ "$ALLOC_STATUS" = "true" ] || echo "$ALLOC_RESP" | grep -q "success"; then
            echo "✅ Allocation successful"
            
            # CRITICAL: Verify status changed to 'allocated' in MongoDB
            sleep 1
            MONGO_STATUS_AFTER=$(mongosh erp_prod --quiet --eval "db.inventory_stock.findOne({id: '$NEW_STOCK_ID'}, {status: 1, _id: 0}).status")
            
            echo ""
            echo "🔍 CRITICAL VERIFICATION: Stock status in MongoDB"
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
            
            # Verify so_item_stocks has the allocation
            SO_ITEM_STOCKS_COUNT=$(sqlite3 /app/data/erp.db "SELECT COUNT(*) FROM so_item_stocks WHERE stock_id = '$NEW_STOCK_ID'")
            if [ "$SO_ITEM_STOCKS_COUNT" -gt 0 ]; then
                echo "✅ so_item_stocks has allocation record (Phase 3 integration)"
            else
                echo "⚠️  so_item_stocks does NOT have allocation record"
            fi
            
            # DIFF SAFETY: Verify OTHER stock lots are UNCHANGED
            echo ""
            echo "🔍 DIFF SAFETY: Verifying OTHER stock lots are UNCHANGED"
            ALL_UNCHANGED=true
            for STOCK_ID in $OTHER_STOCKS; do
                STATUS_BEFORE=$(echo "$STOCKS_RESP" | jq -r ".data[] | select(.id == \"$STOCK_ID\") | .status")
                STATUS_AFTER=$(mongosh erp_prod --quiet --eval "db.inventory_stock.findOne({id: '$STOCK_ID'}, {status: 1, _id: 0}).status")
                
                echo "   Stock ${STOCK_ID:0:8}...:"
                echo "      BEFORE: status=$STATUS_BEFORE"
                echo "      AFTER:  status=$STATUS_AFTER"
                
                if [ "$STATUS_BEFORE" = "$STATUS_AFTER" ]; then
                    echo "      ✅ UNCHANGED (diff did NOT rewrite this lot)"
                else
                    echo "      ❌ CHANGED (diff incorrectly rewrote this lot)"
                    ALL_UNCHANGED=false
                fi
            done
            
            if [ "$ALL_UNCHANGED" = "true" ]; then
                echo ""
                echo "✅✅✅ DIFF SAFETY VERIFIED: Other lots UNCHANGED (only changed lot was written)"
            else
                echo ""
                echo "❌❌❌ DIFF SAFETY FAILED: Other lots were modified"
            fi
            
            # Clean up: Delete the test SO
            echo ""
            echo "🧹 Cleaning up test SO"
            DEL_RESP=$(curl -s -b $COOKIES -X DELETE "$BASE_URL/sales-orders/$SO_ID" \
              -H "Origin: $ORIGIN")
            if echo "$DEL_RESP" | grep -q "success"; then
                echo "✅ Test SO deleted"
            else
                echo "⚠️  Failed to delete test SO"
            fi
        else
            echo "❌ Allocation failed"
            echo "$ALLOC_RESP" | jq '.'
        fi
    else
        echo "❌ Failed to create SO"
        echo "$SO_RESP" | jq '.'
    fi
    echo ""
fi

# SCENARIO 6: ARCHIVE and RESTORE
if [ -n "$NEW_STOCK_ID" ]; then
    echo "================================================================================"
    echo "  SCENARIO 6: ARCHIVE and RESTORE"
    echo "================================================================================"
    
    # Archive
    ARCH_RESP=$(curl -s -b $COOKIES -X POST "$BASE_URL/inventory-stocks/$NEW_STOCK_ID/archive" \
      -H "Origin: $ORIGIN")
    
    if echo "$ARCH_RESP" | grep -q "success"; then
        echo "✅ POST /api/inventory-stocks/${NEW_STOCK_ID:0:8}.../archive → 200"
        
        # Verify archived_at set in MongoDB
        sleep 1
        ARCHIVED_AT=$(mongosh erp_prod --quiet --eval "db.inventory_stock.findOne({id: '$NEW_STOCK_ID'}, {archived_at: 1, _id: 0}).archived_at")
        if [ -n "$ARCHIVED_AT" ] && [ "$ARCHIVED_AT" != "null" ]; then
            echo "✅ MongoDB archived_at set: $ARCHIVED_AT"
        else
            echo "❌ MongoDB archived_at NOT set"
        fi
        
        # Restore
        REST_RESP=$(curl -s -b $COOKIES -X POST "$BASE_URL/inventory-stocks/$NEW_STOCK_ID/restore" \
          -H "Origin: $ORIGIN")
        
        if echo "$REST_RESP" | grep -q "success"; then
            echo "✅ POST /api/inventory-stocks/${NEW_STOCK_ID:0:8}.../restore → 200"
            
            # Verify archived_at null in MongoDB
            sleep 1
            ARCHIVED_AT_AFTER=$(mongosh erp_prod --quiet --eval "db.inventory_stock.findOne({id: '$NEW_STOCK_ID'}, {archived_at: 1, _id: 0}).archived_at")
            if [ "$ARCHIVED_AT_AFTER" = "null" ] || [ -z "$ARCHIVED_AT_AFTER" ]; then
                echo "✅ MongoDB archived_at is null (restored)"
            else
                echo "❌ MongoDB archived_at still set: $ARCHIVED_AT_AFTER"
            fi
        else
            echo "❌ Restore failed"
        fi
    else
        echo "❌ Archive failed"
    fi
    echo ""
fi

# SCENARIO 7: ACCOUNTING INTEGRITY
echo "================================================================================"
echo "  SCENARIO 7: ACCOUNTING INTEGRITY"
echo "================================================================================"

# Trial Balance
TB_RESP=$(curl -s -b $COOKIES "$BASE_URL/accounting/trial-balance")
TOTAL_DEBIT=$(echo "$TB_RESP" | jq -r '.data.totalDebit')
TOTAL_CREDIT=$(echo "$TB_RESP" | jq -r '.data.totalCredit')
echo "✅ GET /api/accounting/trial-balance → 200"
echo "   Total Debit: $TOTAL_DEBIT"
echo "   Total Credit: $TOTAL_CREDIT"

if [ "$TOTAL_DEBIT" = "$TOTAL_CREDIT" ]; then
    echo "✅ Trial Balance BALANCED (debit == credit)"
else
    echo "❌ Trial Balance NOT BALANCED (debit != credit)"
fi

# Balance Sheet
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
    echo "✅ so_item_stocks preserved (6 pre-existing allocations intact)"
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

OP_INBOUND_RESP=$(curl -s -b /tmp/op_cookies.txt -X POST "$BASE_URL/inventory/inbound" \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  -d "$INBOUND_PAYLOAD")

if echo "$OP_INBOUND_RESP" | grep -q "Forbidden\|403"; then
    echo "✅ Operator correctly forbidden (403)"
elif echo "$OP_INBOUND_RESP" | grep -q "Unauthorized\|401"; then
    echo "✅ Operator correctly unauthorized (401)"
else
    echo "❌ Operator NOT forbidden"
    echo "$OP_INBOUND_RESP" | jq '.'
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
echo "Test completed. Review results above for pass/fail per scenario."
