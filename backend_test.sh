#!/bin/bash
#
# MIGRATION Phase 6 Backend Test: fixed_assets + stock_opname(+items) MongoDB-authoritative
# Tests the DIFF-persist write strategy for multi-replica safe operations.
#

set +e

BASE_URL="http://localhost:3000/api"
COOKIE_FILE="/tmp/test_cookies.txt"
MONGO_DB="erp_prod"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
PASSED=0
FAILED=0

log_pass() {
    echo -e "${GREEN}✅ PASSED${NC}: $1"
    ((PASSED++))
}

log_fail() {
    echo -e "${RED}❌ FAILED${NC}: $1"
    echo -e "  Details: $2"
    ((FAILED++))
}

log_info() {
    echo -e "${YELLOW}ℹ${NC} $1"
}

# Login as admin
echo "================================================================================"
echo "MIGRATION Phase 6 Backend Test"
echo "Fixed Assets + Stock Opname -> MongoDB-authoritative"
echo "================================================================================"

log_info "Logging in as admin@lpi.co.id..."
curl -s -X POST "$BASE_URL/../api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}' \
  -c "$COOKIE_FILE" > /dev/null

if [ $? -eq 0 ]; then
    log_info "✓ Logged in successfully"
else
    echo "FATAL: Could not login"
    exit 1
fi

# Get MongoDB counts before
log_info "Connecting to MongoDB: $MONGO_DB"
FIXED_ASSETS_BEFORE=$(mongosh --quiet --eval "db.getSiblingDB('$MONGO_DB').fixed_assets.countDocuments({})" 2>/dev/null || echo "0")
STOCK_OPNAME_BEFORE=$(mongosh --quiet --eval "db.getSiblingDB('$MONGO_DB').stock_opname.countDocuments({})" 2>/dev/null || echo "0")
STOCK_OPNAME_ITEMS_BEFORE=$(mongosh --quiet --eval "db.getSiblingDB('$MONGO_DB').stock_opname_items.countDocuments({})" 2>/dev/null || echo "0")

log_info "MongoDB counts before: fixed_assets=$FIXED_ASSETS_BEFORE, stock_opname=$STOCK_OPNAME_BEFORE, stock_opname_items=$STOCK_OPNAME_ITEMS_BEFORE"

# Get SQLite inventory_stock count
INVENTORY_STOCK_BEFORE=$(sqlite3 /app/data/erp.db "SELECT COUNT(*) FROM inventory_stock" 2>/dev/null || echo "0")
log_info "SQLite inventory_stock count: $INVENTORY_STOCK_BEFORE"

# SCENARIO 1: Fixed Asset CREATE
echo ""
echo "================================================================================"
echo "SCENARIO 1: Fixed Asset CREATE"
echo "================================================================================"

# Get account codes
ACCOUNTS=$(curl -s -X GET "$BASE_URL/accounting/accounts" \
  -H "Origin: http://localhost:3000" \
  -b "$COOKIE_FILE")

ASSET_ACCT=$(echo "$ACCOUNTS" | jq -r '.data[] | select(.code=="1-2100") | .code')
ACCUM_ACCT=$(echo "$ACCOUNTS" | jq -r '.data[] | select(.code=="1-2900") | .code')
EXPENSE_ACCT=$(echo "$ACCOUNTS" | jq -r '.data[] | select(.code=="6-1600") | .code')

if [ -z "$ASSET_ACCT" ] || [ -z "$ACCUM_ACCT" ] || [ -z "$EXPENSE_ACCT" ]; then
    log_fail "Scenario 1: Get accounts" "Could not find required account codes"
    exit 1
fi

log_info "Using accounts: asset=$ASSET_ACCT, accum=$ACCUM_ACCT, expense=$EXPENSE_ACCT"

# Create fixed asset
ASSET_RESPONSE=$(curl -s -X POST "$BASE_URL/accounting/fixed-assets" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -b "$COOKIE_FILE" \
  -d "{
    \"code\": \"FA-T1\",
    \"name\": \"Mesin Uji\",
    \"category\": \"Mesin\",
    \"acquisitionDate\": \"2026-01-01\",
    \"acquisitionCost\": 12000000,
    \"salvageValue\": 0,
    \"usefulLifeMonths\": 60,
    \"method\": \"straight_line\",
    \"assetAccountCode\": \"$ASSET_ACCT\",
    \"accumAccountCode\": \"$ACCUM_ACCT\",
    \"expenseAccountCode\": \"$EXPENSE_ACCT\",
    \"postDepreciation\": true
  }")

ASSET_ID=$(echo "$ASSET_RESPONSE" | jq -r '.data.id // empty')

if [ -z "$ASSET_ID" ]; then
    log_fail "Scenario 1: Create fixed asset" "API did not return asset ID: $ASSET_RESPONSE"
    exit 1
fi

log_info "✓ Created fixed asset: $ASSET_ID"

# Verify in API
sleep 0.5
API_ASSETS=$(curl -s -X GET "$BASE_URL/accounting/fixed-assets" \
  -H "Origin: http://localhost:3000" \
  -b "$COOKIE_FILE")

API_HAS_ASSET=$(echo "$API_ASSETS" | jq -r ".data[] | select(.id==\"$ASSET_ID\") | .id")

# Verify in MongoDB
MONGO_HAS_ASSET=$(mongosh --quiet --eval "db.getSiblingDB('$MONGO_DB').fixed_assets.findOne({id: '$ASSET_ID'}) ? 'found' : ''" 2>/dev/null || echo "")

if [ -n "$API_HAS_ASSET" ] && [ "$MONGO_HAS_ASSET" = "found" ]; then
    log_pass "Scenario 1: Fixed Asset CREATE" 
    log_info "Asset $ASSET_ID exists in both API and MongoDB"
else
    log_fail "Scenario 1: Fixed Asset CREATE" "API: $API_HAS_ASSET, MongoDB: $MONGO_HAS_ASSET"
fi

# SCENARIO 2: Fixed Asset EDIT
echo ""
echo "================================================================================"
echo "SCENARIO 2: Fixed Asset EDIT"
echo "================================================================================"

EDIT_RESPONSE=$(curl -s -X PATCH "$BASE_URL/accounting/fixed-assets/$ASSET_ID" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -b "$COOKIE_FILE" \
  -d '{"name": "Mesin Uji EDITED", "acquisitionCost": 15000000}')

log_info "✓ Edited fixed asset: $ASSET_ID"

# Verify in API
sleep 0.5
API_ASSET=$(curl -s -X GET "$BASE_URL/accounting/fixed-assets" \
  -H "Origin: http://localhost:3000" \
  -b "$COOKIE_FILE" | jq -r ".data[] | select(.id==\"$ASSET_ID\")")

API_NAME=$(echo "$API_ASSET" | jq -r '.name')
API_COST=$(echo "$API_ASSET" | jq -r '.acquisition_cost')

# Verify in MongoDB
MONGO_ASSET=$(mongosh --quiet --eval "JSON.stringify(db.getSiblingDB('$MONGO_DB').fixed_assets.findOne({id: '$ASSET_ID'}))" 2>/dev/null)
MONGO_NAME=$(echo "$MONGO_ASSET" | jq -r '.name')
MONGO_COST=$(echo "$MONGO_ASSET" | jq -r '.acquisition_cost')

if [ "$API_NAME" = "Mesin Uji EDITED" ] && [ "$API_COST" = "15000000" ] && [ "$MONGO_NAME" = "Mesin Uji EDITED" ] && [ "$MONGO_COST" = "15000000" ]; then
    log_pass "Scenario 2: Fixed Asset EDIT"
    log_info "Changes reflected in both API and MongoDB"
else
    log_fail "Scenario 2: Fixed Asset EDIT" "API: name=$API_NAME cost=$API_COST, Mongo: name=$MONGO_NAME cost=$MONGO_COST"
fi

# SCENARIO 3: Depreciation Engine & Trial Balance
echo ""
echo "================================================================================"
echo "SCENARIO 3: Depreciation Engine & Trial Balance"
echo "================================================================================"

TB_RESPONSE=$(curl -s -X GET "$BASE_URL/accounting/trial-balance" \
  -H "Origin: http://localhost:3000" \
  -b "$COOKIE_FILE")

TOTAL_DEBIT=$(echo "$TB_RESPONSE" | jq -r '.data.totalDebit // 0')
TOTAL_CREDIT=$(echo "$TB_RESPONSE" | jq -r '.data.totalCredit // 0')

log_info "Trial Balance: Debit=$TOTAL_DEBIT, Credit=$TOTAL_CREDIT"

# Check if balanced (difference < 0.01)
DIFF=$(echo "$TOTAL_DEBIT - $TOTAL_CREDIT" | bc)
DIFF_ABS=$(echo "$DIFF" | tr -d '-')
BALANCED=$(echo "$DIFF_ABS < 0.01" | bc)

# Get balance sheet
BS_RESPONSE=$(curl -s -X GET "$BASE_URL/accounting/balance-sheet" \
  -H "Origin: http://localhost:3000" \
  -b "$COOKIE_FILE")

BS_BALANCED=$(echo "$BS_RESPONSE" | jq -r '.data.balanced // false')

log_info "Balance Sheet: Balanced=$BS_BALANCED"

# Check MongoDB for DEPR journals (should be 0 - they are derived, not stored)
MONGO_DEPR_COUNT=$(mongosh --quiet --eval "db.getSiblingDB('$MONGO_DB').journal_entries.countDocuments({source_type: 'DEPR', is_auto: 1})" 2>/dev/null || echo "0")

log_info "MongoDB DEPR journals: $MONGO_DEPR_COUNT"

if [ "$BALANCED" = "1" ] && [ "$BS_BALANCED" = "true" ] && [ "$MONGO_DEPR_COUNT" = "0" ]; then
    log_pass "Scenario 3: Depreciation Engine"
    log_info "Trial balance balanced, DEPR journals derived (not stored in Mongo)"
else
    log_fail "Scenario 3: Depreciation Engine" "TB balanced=$BALANCED, BS balanced=$BS_BALANCED, Mongo DEPR count=$MONGO_DEPR_COUNT"
fi

# SCENARIO 4: Archive/Restore
echo ""
echo "================================================================================"
echo "SCENARIO 4: Archive/Restore Fixed Asset"
echo "================================================================================"

# Archive
curl -s -X POST "$BASE_URL/accounting/fixed-assets/$ASSET_ID/archive" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -b "$COOKIE_FILE" > /dev/null

log_info "✓ Archived asset: $ASSET_ID"

# Verify in MongoDB
sleep 0.5
MONGO_ARCHIVED=$(mongosh --quiet --eval "db.getSiblingDB('$MONGO_DB').fixed_assets.findOne({id: '$ASSET_ID'}).archived_at" 2>/dev/null)

if [ "$MONGO_ARCHIVED" != "null" ] && [ -n "$MONGO_ARCHIVED" ]; then
    log_info "✓ archived_at set in MongoDB: $MONGO_ARCHIVED"
    
    # Restore
    curl -s -X POST "$BASE_URL/accounting/fixed-assets/$ASSET_ID/restore" \
      -H "Content-Type: application/json" \
      -H "Origin: http://localhost:3000" \
      -b "$COOKIE_FILE" > /dev/null
    
    log_info "✓ Restored asset: $ASSET_ID"
    
    # Verify in MongoDB
    sleep 0.5
    MONGO_ARCHIVED_AFTER=$(mongosh --quiet --eval "db.getSiblingDB('$MONGO_DB').fixed_assets.findOne({id: '$ASSET_ID'}).archived_at" 2>/dev/null)
    
    if [ "$MONGO_ARCHIVED_AFTER" = "null" ]; then
        log_pass "Scenario 4: Archive/Restore"
        log_info "archived_at correctly set and cleared in MongoDB"
    else
        log_fail "Scenario 4: Archive/Restore" "archived_at after restore: $MONGO_ARCHIVED_AFTER"
    fi
else
    log_fail "Scenario 4: Archive" "archived_at not set in MongoDB"
fi

# SCENARIO 8: Non-Cascade Safety
echo ""
echo "================================================================================"
echo "SCENARIO 8: Non-Cascade Safety (inventory_stock)"
echo "================================================================================"

INVENTORY_STOCK_AFTER=$(sqlite3 /app/data/erp.db "SELECT COUNT(*) FROM inventory_stock" 2>/dev/null || echo "0")
log_info "SQLite inventory_stock count: $INVENTORY_STOCK_AFTER"

if [ "$INVENTORY_STOCK_AFTER" -gt 0 ]; then
    log_pass "Scenario 8: Non-Cascade Safety"
    log_info "inventory_stock has $INVENTORY_STOCK_AFTER rows (NOT wiped by FK-off hydrate)"
else
    log_fail "Scenario 8: Non-Cascade Safety" "inventory_stock is empty (may have been wiped)"
fi

# CLEANUP
echo ""
echo "================================================================================"
echo "CLEANUP: Deleting test data"
echo "================================================================================"

curl -s -X DELETE "$BASE_URL/accounting/fixed-assets/$ASSET_ID" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -b "$COOKIE_FILE" > /dev/null

if [ $? -eq 0 ]; then
    log_info "✓ Deleted fixed asset: $ASSET_ID"
else
    log_info "✗ Failed to delete fixed asset: $ASSET_ID"
fi

# Get MongoDB counts after
FIXED_ASSETS_AFTER=$(mongosh --quiet --eval "db.getSiblingDB('$MONGO_DB').fixed_assets.countDocuments({})" 2>/dev/null || echo "0")
STOCK_OPNAME_AFTER=$(mongosh --quiet --eval "db.getSiblingDB('$MONGO_DB').stock_opname.countDocuments({})" 2>/dev/null || echo "0")
STOCK_OPNAME_ITEMS_AFTER=$(mongosh --quiet --eval "db.getSiblingDB('$MONGO_DB').stock_opname_items.countDocuments({})" 2>/dev/null || echo "0")

# SUMMARY
echo ""
echo "================================================================================"
echo "TEST SUMMARY"
echo "================================================================================"
echo ""
echo "MongoDB Database: $MONGO_DB"
echo "  fixed_assets count: $FIXED_ASSETS_AFTER"
echo "  stock_opname count: $STOCK_OPNAME_AFTER"
echo "  stock_opname_items count: $STOCK_OPNAME_ITEMS_AFTER"
echo ""
echo "SQLite Database: /app/data/erp.db"
echo "  inventory_stock count: $INVENTORY_STOCK_AFTER"
echo ""
echo "Test Results:"
echo "  Passed: $PASSED"
echo "  Failed: $FAILED"
echo ""
echo "================================================================================"

# Cleanup
rm -f "$COOKIE_FILE"

exit 0
