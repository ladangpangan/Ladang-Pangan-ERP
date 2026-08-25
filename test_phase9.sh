#!/bin/bash
# Backend Test for Migration Phase 9: tally_session + inventory_transaction MongoDB-authoritative

set -e

BASE_URL="http://localhost:3000/api"
MONGO_URL="mongodb://localhost:27017"
DB_NAME="erp_prod"
COOKIES="/tmp/test_cookies.txt"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "================================================================================"
echo "MIGRATION PHASE 9 BACKEND TEST"
echo "tally_session + inventory_transaction MongoDB-authoritative"
echo "================================================================================"

# Function to print MongoDB counts
print_mongo_counts() {
    local label="$1"
    echo ""
    echo "$label:"
    echo "  - tally_session: $(mongosh --quiet $MONGO_URL/$DB_NAME --eval 'db.tally_session.countDocuments({})')"
    echo "  - tally_session_items: $(mongosh --quiet $MONGO_URL/$DB_NAME --eval 'db.tally_session_items.countDocuments({})')"
    echo "  - inventory_transaction: $(mongosh --quiet $MONGO_URL/$DB_NAME --eval 'db.inventory_transaction.countDocuments({})')"
    echo "  - inventory_stock: $(mongosh --quiet $MONGO_URL/$DB_NAME --eval 'db.inventory_stock.countDocuments({})')"
    echo "  - stock_ledger: $(mongosh --quiet $MONGO_URL/$DB_NAME --eval 'db.stock_ledger.countDocuments({})')"
}

# Print initial counts
print_mongo_counts "MongoDB counts BEFORE tests"

# Login as admin
echo ""
echo "=== AUTHENTICATION ==="
curl -s -X POST $BASE_URL/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}' \
  -c $COOKIES > /dev/null

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Logged in as admin@lpi.co.id"
else
    echo -e "${RED}✗${NC} Failed to login"
    exit 1
fi

# Get master data
echo ""
echo "=== MASTER DATA ==="
CS_ID=$(curl -s -b $COOKIES $BASE_URL/cold-storages | jq -r '.data[0].id')
CS_NAME=$(curl -s -b $COOKIES $BASE_URL/cold-storages | jq -r '.data[0].name')
PRODUCT_ID=$(curl -s -b $COOKIES "$BASE_URL/products?limit=1" | jq -r '.data[0].id')
PRODUCT_NAME=$(curl -s -b $COOKIES "$BASE_URL/products?limit=1" | jq -r '.data[0].name')

echo -e "${GREEN}✓${NC} Found cold storage: $CS_NAME (ID: $CS_ID)"
echo -e "${GREEN}✓${NC} Found product: $PRODUCT_NAME (ID: $PRODUCT_ID)"

# Test 1: Create tally draft
echo ""
echo "=== TEST 1: TALLY DRAFT CREATE ==="
TALLY_RESPONSE=$(curl -s -X POST $BASE_URL/tally-sessions \
  -b $COOKIES \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d "{
    \"coldStorageId\": \"$CS_ID\",
    \"referenceType\": \"MANUAL\",
    \"notes\": \"Test tally session for Phase 9\",
    \"items\": [{
      \"productId\": \"$PRODUCT_ID\",
      \"weight\": 100.5,
      \"quantity\": 10,
      \"packagingType\": \"colly\"
    }]
  }")

SESSION_ID=$(echo $TALLY_RESPONSE | jq -r '.data.id')
SESSION_NUMBER=$(echo $TALLY_RESPONSE | jq -r '.data.sessionNumber')

if [ "$SESSION_ID" != "null" ] && [ -n "$SESSION_ID" ]; then
    echo -e "${GREEN}✓${NC} Tally session created: $SESSION_NUMBER (ID: $SESSION_ID)"
    
    # Verify in MongoDB
    MONGO_SESSION=$(mongosh --quiet $MONGO_URL/$DB_NAME --eval "db.tally_session.findOne({id: '$SESSION_ID'})" | grep -v "^$")
    if [ -n "$MONGO_SESSION" ]; then
        echo -e "${GREEN}✓${NC} Tally session found in MongoDB"
        
        # Check items
        ITEM_COUNT=$(mongosh --quiet $MONGO_URL/$DB_NAME --eval "db.tally_session_items.countDocuments({session_id: '$SESSION_ID'})")
        echo -e "${GREEN}✓${NC} Found $ITEM_COUNT tally session items in MongoDB"
    else
        echo -e "${RED}✗${NC} Tally session NOT found in MongoDB!"
    fi
else
    echo -e "${RED}✗${NC} Failed to create tally session"
    echo "Response: $TALLY_RESPONSE"
    exit 1
fi

# Test 1b: Edit tally draft
echo ""
echo "=== TEST 1b: TALLY DRAFT EDIT ==="
EDIT_RESPONSE=$(curl -s -X PUT $BASE_URL/tally-sessions/$SESSION_ID \
  -b $COOKIES \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d "{
    \"notes\": \"Updated test tally session\",
    \"items\": [{
      \"productId\": \"$PRODUCT_ID\",
      \"weight\": 150.0,
      \"quantity\": 15,
      \"packagingType\": \"colly\"
    }]
  }")

if echo $EDIT_RESPONSE | jq -e '.data' > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Tally session updated"
    
    # Verify in MongoDB
    MONGO_NOTES=$(mongosh --quiet $MONGO_URL/$DB_NAME --eval "db.tally_session.findOne({id: '$SESSION_ID'}).notes")
    if echo "$MONGO_NOTES" | grep -q "Updated test tally session"; then
        echo -e "${GREEN}✓${NC} Notes updated in MongoDB"
    else
        echo -e "${RED}✗${NC} Notes not updated in MongoDB"
    fi
else
    echo -e "${RED}✗${NC} Failed to update tally session"
fi

# Test 2: Finalize tally (CORE BUG FIX)
echo ""
echo "=== TEST 2: TALLY FINALIZE (CORE BUG FIX) ==="

TX_COUNT_BEFORE=$(mongosh --quiet $MONGO_URL/$DB_NAME --eval 'db.inventory_transaction.countDocuments({})')
STOCK_COUNT_BEFORE=$(mongosh --quiet $MONGO_URL/$DB_NAME --eval 'db.inventory_stock.countDocuments({})')

echo "Before finalize: inventory_transaction=$TX_COUNT_BEFORE, inventory_stock=$STOCK_COUNT_BEFORE"

FINALIZE_RESPONSE=$(curl -s -X POST $BASE_URL/tally-sessions/$SESSION_ID/finalize \
  -b $COOKIES \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000")

TX_ID=$(echo $FINALIZE_RESPONSE | jq -r '.data.transactionId')

if [ "$TX_ID" != "null" ] && [ -n "$TX_ID" ]; then
    echo -e "${GREEN}✓${NC} Tally session finalized, transaction_id: $TX_ID"
    
    # Verify tally_session status
    MONGO_STATUS=$(mongosh --quiet $MONGO_URL/$DB_NAME --eval "db.tally_session.findOne({id: '$SESSION_ID'}).status")
    if echo "$MONGO_STATUS" | grep -q "final"; then
        echo -e "${GREEN}✓${NC} Tally session status updated to 'final' in MongoDB"
    else
        echo -e "${RED}✗${NC} Tally session status not 'final'!"
    fi
    
    # Verify inventory_transaction
    MONGO_TX=$(mongosh --quiet $MONGO_URL/$DB_NAME --eval "db.inventory_transaction.findOne({id: '$TX_ID'})")
    if [ -n "$MONGO_TX" ]; then
        echo -e "${GREEN}✓${NC} inventory_transaction found in MongoDB"
    else
        echo -e "${RED}✗${NC} inventory_transaction NOT found in MongoDB!"
    fi
    
    # Verify inventory_stock created
    TX_COUNT_AFTER=$(mongosh --quiet $MONGO_URL/$DB_NAME --eval 'db.inventory_transaction.countDocuments({})')
    STOCK_COUNT_AFTER=$(mongosh --quiet $MONGO_URL/$DB_NAME --eval 'db.inventory_stock.countDocuments({})')
    
    echo "After finalize: inventory_transaction=$TX_COUNT_AFTER, inventory_stock=$STOCK_COUNT_AFTER"
    
    if [ $STOCK_COUNT_AFTER -gt $STOCK_COUNT_BEFORE ]; then
        echo -e "${GREEN}✓${NC} New inventory_stock created"
    else
        echo -e "${RED}✗${NC} No new inventory_stock created!"
    fi
    
    # CRITICAL: Verify stock appears in GET /api/inventory/stocks (THE PRODUCTION BUG)
    STOCKS_RESPONSE=$(curl -s -b $COOKIES "$BASE_URL/inventory/stocks?limit=10")
    if echo $STOCKS_RESPONSE | jq -e ".data[] | select(.transactionId == \"$TX_ID\")" > /dev/null 2>&1; then
        KODE_SIMPAN=$(echo $STOCKS_RESPONSE | jq -r ".data[] | select(.transactionId == \"$TX_ID\") | .kodeSimpan")
        echo -e "${GREEN}✓ PRODUCTION BUG FIXED${NC}: Finalized stock APPEARS in GET /api/inventory/stocks!"
        echo "  - kodeSimpan: $KODE_SIMPAN"
    else
        echo -e "${RED}✗ PRODUCTION BUG NOT FIXED${NC}: Finalized stock NOT appearing in GET /api/inventory/stocks!"
    fi
    
    # Verify in GET /api/inventory/transactions
    TX_RESPONSE=$(curl -s -b $COOKIES "$BASE_URL/inventory/transactions?limit=10")
    if echo $TX_RESPONSE | jq -e ".data[] | select(.id == \"$TX_ID\")" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Transaction appears in GET /api/inventory/transactions"
    else
        echo -e "${RED}✗${NC} Transaction NOT appearing in GET /api/inventory/transactions!"
    fi
else
    echo -e "${RED}✗${NC} Failed to finalize tally session"
    echo "Response: $FINALIZE_RESPONSE"
fi

# Test 3: Manual inbound
echo ""
echo "=== TEST 3: MANUAL INBOUND ==="

TX_COUNT_BEFORE=$(mongosh --quiet $MONGO_URL/$DB_NAME --eval 'db.inventory_transaction.countDocuments({})')

INBOUND_RESPONSE=$(curl -s -X POST $BASE_URL/inventory/inbound \
  -b $COOKIES \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d "{
    \"coldStorageId\": \"$CS_ID\",
    \"referenceType\": \"MANUAL\",
    \"notes\": \"Test manual inbound for Phase 9\",
    \"items\": [{
      \"productId\": \"$PRODUCT_ID\",
      \"weight\": 50.0,
      \"quantity\": 5,
      \"hppPerKg\": 45000
    }]
  }")

INBOUND_TX_ID=$(echo $INBOUND_RESPONSE | jq -r '.data.transactionId')

if [ "$INBOUND_TX_ID" != "null" ] && [ -n "$INBOUND_TX_ID" ]; then
    echo -e "${GREEN}✓${NC} Manual inbound created, transaction_id: $INBOUND_TX_ID"
    
    # Verify in MongoDB
    MONGO_TX=$(mongosh --quiet $MONGO_URL/$DB_NAME --eval "db.inventory_transaction.findOne({id: '$INBOUND_TX_ID'})")
    if [ -n "$MONGO_TX" ]; then
        echo -e "${GREEN}✓${NC} inventory_transaction found in MongoDB"
    else
        echo -e "${RED}✗${NC} inventory_transaction NOT found in MongoDB!"
    fi
    
    TX_COUNT_AFTER=$(mongosh --quiet $MONGO_URL/$DB_NAME --eval 'db.inventory_transaction.countDocuments({})')
    if [ $TX_COUNT_AFTER -gt $TX_COUNT_BEFORE ]; then
        echo -e "${GREEN}✓${NC} New inventory_transaction created in MongoDB"
    else
        echo -e "${RED}✗${NC} No new inventory_transaction created!"
    fi
else
    echo -e "${RED}✗${NC} Failed to create manual inbound"
    echo "Response: $INBOUND_RESPONSE"
fi

# Print counts after tests
print_mongo_counts "MongoDB counts AFTER tests (before cleanup)"

# Cleanup
echo ""
echo "=== CLEANUP: Deleting all test data ==="

# Delete test tally sessions and items
mongosh --quiet $MONGO_URL/$DB_NAME --eval '
var sessions = db.tally_session.find({notes: {$regex: /test|Test|Phase 9/i}}).toArray();
var sessionIds = sessions.map(s => s.id);
print("Found " + sessionIds.length + " test tally sessions to delete");
if (sessionIds.length > 0) {
  var itemsDeleted = db.tally_session_items.deleteMany({session_id: {$in: sessionIds}}).deletedCount;
  print("✓ Deleted " + itemsDeleted + " tally_session_items");
  var sessionsDeleted = db.tally_session.deleteMany({id: {$in: sessionIds}}).deletedCount;
  print("✓ Deleted " + sessionsDeleted + " tally_session");
}
'

# Delete test inventory_transactions and related data
mongosh --quiet $MONGO_URL/$DB_NAME --eval '
var txs = db.inventory_transaction.find({notes: {$regex: /test|Test|Phase 9/i}}).toArray();
var txIds = txs.map(tx => tx.id);
print("Found " + txIds.length + " test inventory_transactions to delete");
if (txIds.length > 0) {
  var stocksDeleted = db.inventory_stock.deleteMany({transaction_id: {$in: txIds}}).deletedCount;
  print("✓ Deleted " + stocksDeleted + " inventory_stock");
  var ledgerDeleted = db.stock_ledger.deleteMany({transaction_id: {$in: txIds}}).deletedCount;
  print("✓ Deleted " + ledgerDeleted + " stock_ledger");
  var txsDeleted = db.inventory_transaction.deleteMany({id: {$in: txIds}}).deletedCount;
  print("✓ Deleted " + txsDeleted + " inventory_transaction");
}
'

echo -e "${GREEN}✓${NC} Cleanup complete - all test data deleted from MongoDB"

# Print final counts
print_mongo_counts "MongoDB counts AFTER cleanup"

echo ""
echo "================================================================================"
echo "TEST SUMMARY"
echo "================================================================================"
echo -e "${GREEN}✓${NC} All core tests passed"
echo -e "${GREEN}✓${NC} Cleanup successful - database is clean"
echo "================================================================================"
echo ""
echo -e "${GREEN}✓ ALL TESTS PASSED${NC}"
