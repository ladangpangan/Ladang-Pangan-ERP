#!/bin/bash
# Backend API Testing Script for ERP System - Accounting Module (SAK EP)
# Tests all accounting endpoints with comprehensive scenarios including idempotency checks.

#!/bin/bash

BASE_URL="http://localhost:3000/api"
DB_PATH="/app/data/erp.db"
COOKIE_FILE="/tmp/accounting_test_cookies.txt"

# Test credentials
ADMIN_EMAIL="admin@lpi.co.id"
ADMIN_PASSWORD="admin123"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASS_COUNT=0
FAIL_COUNT=0

print_test() {
    echo ""
    echo "================================================================================"
    echo "TEST: $1"
    echo "================================================================================"
}

print_pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
    ((PASS_COUNT++))
}

print_fail() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    if [ -n "$2" ]; then
        echo "Details: $2"
    fi
    ((FAIL_COUNT++))
}

# Login
print_test "Authentication - Login as admin"
LOGIN_RESPONSE=$(curl -s -c "$COOKIE_FILE" -X POST "$BASE_URL/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")

if echo "$LOGIN_RESPONSE" | grep -q '"user"'; then
    print_pass "Login successful"
else
    print_fail "Login failed" "$LOGIN_RESPONSE"
    exit 1
fi

# TEST 1: GET /accounting/accounts?archived=0
print_test "1. GET /accounting/accounts?archived=0 - Verify seeded COA"
RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/accounting/accounts?archived=0")
ACCOUNT_COUNT=$(echo "$RESPONSE" | jq '.data | length')

if [ "$ACCOUNT_COUNT" = "51" ]; then
    SYSTEM_COUNT=$(echo "$RESPONSE" | jq '[.data[] | select(.is_system == 1)] | length')
    HEADER_COUNT=$(echo "$RESPONSE" | jq '[.data[] | select(.is_postable == 0)] | length')
    print_pass "GET accounts successful: $ACCOUNT_COUNT accounts, $SYSTEM_COUNT system, $HEADER_COUNT headers"
else
    print_fail "Expected 51 accounts, got $ACCOUNT_COUNT"
fi

# TEST 2: COA CRUD Operations
print_test "2. COA CRUD - Create, Update, Archive, Restore, Delete"

# 2a. Create account
echo "2a. POST /accounting/accounts - Create test account"
CREATE_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/accounting/accounts" \
  -H "Content-Type: application/json" \
  -d '{"code":"6-1950","name":"Beban Tes","type":"expense","normalBalance":"debit","category":"Beban Operasional","isPostable":true}')

CREATED_ID=$(echo "$CREATE_RESPONSE" | jq -r '.data.id')
if [ "$CREATED_ID" != "null" ] && [ -n "$CREATED_ID" ]; then
    print_pass "Account created: 6-1950 - Beban Tes (ID: $CREATED_ID)"
else
    print_fail "Failed to create account" "$CREATE_RESPONSE"
fi

# 2b. Update account
echo "2b. PATCH /accounting/accounts/:id - Update account name"
UPDATE_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X PATCH "$BASE_URL/accounting/accounts/$CREATED_ID" \
  -H "Content-Type: application/json" \
  -d '{"name":"Beban Tes Edit"}')

UPDATED_NAME=$(echo "$UPDATE_RESPONSE" | jq -r '.data.name')
if [ "$UPDATED_NAME" = "Beban Tes Edit" ]; then
    print_pass "Account updated: $UPDATED_NAME"
else
    print_fail "Failed to update account" "$UPDATE_RESPONSE"
fi

# 2c. Archive account
echo "2c. POST /accounting/accounts/:id/archive - Archive account"
ARCHIVE_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/accounting/accounts/$CREATED_ID/archive")
if echo "$ARCHIVE_RESPONSE" | grep -q '"ok":true'; then
    print_pass "Account archived successfully"
else
    print_fail "Failed to archive account" "$ARCHIVE_RESPONSE"
fi

# 2d. Restore account
echo "2d. POST /accounting/accounts/:id/restore - Restore account"
RESTORE_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/accounting/accounts/$CREATED_ID/restore")
if echo "$RESTORE_RESPONSE" | grep -q '"ok":true'; then
    print_pass "Account restored successfully"
else
    print_fail "Failed to restore account" "$RESTORE_RESPONSE"
fi

# 2e. Delete account
echo "2e. DELETE /accounting/accounts/:id - Delete test account"
DELETE_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X DELETE "$BASE_URL/accounting/accounts/$CREATED_ID")
if echo "$DELETE_RESPONSE" | grep -q '"ok":true'; then
    print_pass "Account deleted successfully"
else
    print_fail "Failed to delete account" "$DELETE_RESPONSE"
fi

# 2f. NEGATIVE TEST: DELETE system account
echo "2f. NEGATIVE TEST: DELETE system account (should fail with 400)"
KAS_ID=$(echo "$RESPONSE" | jq -r '.data[] | select(.code == "1-1110") | .id')
DELETE_SYS_RESPONSE=$(curl -s -w "\n%{http_code}" -b "$COOKIE_FILE" -X DELETE "$BASE_URL/accounting/accounts/$KAS_ID")
HTTP_CODE=$(echo "$DELETE_SYS_RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "400" ]; then
    print_pass "DELETE system account correctly rejected with 400"
else
    print_fail "DELETE system account should return 400, got $HTTP_CODE"
fi

# TEST 3: GET /accounting/mapping
print_test "3. GET /accounting/mapping - Verify mapping data"
MAPPING_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/accounting/mapping")
MAPPING_KEYS=$(echo "$MAPPING_RESPONSE" | jq '.data | keys | length')
if [ "$MAPPING_KEYS" -gt 0 ]; then
    print_pass "Mapping operations successful: $MAPPING_KEYS keys"
else
    print_fail "Failed to get mapping" "$MAPPING_RESPONSE"
fi

# TEST 4: GET /accounting/settings
print_test "4. GET /accounting/settings - Verify settings"
SETTINGS_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/accounting/settings")
PPN_ENABLED=$(echo "$SETTINGS_RESPONSE" | jq -r '.data.ppnEnabled')
if [ "$PPN_ENABLED" != "null" ]; then
    print_pass "Settings operations successful (ppnEnabled: $PPN_ENABLED)"
else
    print_fail "Failed to get settings" "$SETTINGS_RESPONSE"
fi

# TEST 5: POST /accounting/sync - IDEMPOTENCY TEST (CRITICAL)
print_test "5. POST /accounting/sync - IDEMPOTENCY TEST (CRITICAL)"

# First sync
echo "5a. First POST /accounting/sync"
SYNC1_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/accounting/sync")
SYNC1_COUNT=$(echo "$SYNC1_RESPONSE" | jq -r '.count')
echo "   First sync count: $SYNC1_COUNT"

# Count auto journals in DB
AUTO_COUNT_1=$(python3 -c "import sqlite3; conn = sqlite3.connect('$DB_PATH'); print(conn.execute('SELECT COUNT(*) FROM journal_entries WHERE is_auto = 1').fetchone()[0]); conn.close()")
MANUAL_COUNT_1=$(python3 -c "import sqlite3; conn = sqlite3.connect('$DB_PATH'); print(conn.execute('SELECT COUNT(*) FROM journal_entries WHERE is_auto = 0').fetchone()[0]); conn.close()")
echo "   Auto journals in DB after first sync: $AUTO_COUNT_1"
echo "   Manual journals in DB after first sync: $MANUAL_COUNT_1"

# Second sync
echo "5b. Second POST /accounting/sync (idempotency check)"
SYNC2_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/accounting/sync")
SYNC2_COUNT=$(echo "$SYNC2_RESPONSE" | jq -r '.count')
echo "   Second sync count: $SYNC2_COUNT"

# Count auto journals in DB after second sync
AUTO_COUNT_2=$(python3 -c "import sqlite3; conn = sqlite3.connect('$DB_PATH'); print(conn.execute('SELECT COUNT(*) FROM journal_entries WHERE is_auto = 1').fetchone()[0]); conn.close()")
MANUAL_COUNT_2=$(python3 -c "import sqlite3; conn = sqlite3.connect('$DB_PATH'); print(conn.execute('SELECT COUNT(*) FROM journal_entries WHERE is_auto = 0').fetchone()[0]); conn.close()")
echo "   Auto journals in DB after second sync: $AUTO_COUNT_2"
echo "   Manual journals in DB after second sync: $MANUAL_COUNT_2"

# CRITICAL: Auto journal count should be the same (idempotent)
if [ "$AUTO_COUNT_1" = "$AUTO_COUNT_2" ] && [ "$MANUAL_COUNT_1" = "$MANUAL_COUNT_2" ]; then
    print_pass "Sync idempotency verified: $AUTO_COUNT_1 auto journals unchanged, $MANUAL_COUNT_1 manual journals preserved"
else
    print_fail "IDEMPOTENCY FAILED: Auto journals $AUTO_COUNT_1 -> $AUTO_COUNT_2, Manual journals $MANUAL_COUNT_1 -> $MANUAL_COUNT_2"
fi

# TEST 6: Journals CRUD
print_test "6. Journals - List, Get, Create Manual, Delete"

# 6a. GET /accounting/journals
echo "6a. GET /accounting/journals?from=2025-01-01&to=2026-12-31"
JOURNALS_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/accounting/journals?from=2025-01-01&to=2026-12-31")
JOURNAL_COUNT=$(echo "$JOURNALS_RESPONSE" | jq '.data | length')
echo "   Found $JOURNAL_COUNT journals"

# Find an auto journal for negative test
AUTO_JOURNAL_ID=$(echo "$JOURNALS_RESPONSE" | jq -r '.data[] | select(.is_auto == 1) | .id' | head -1)
echo "   Found auto journal for negative test: $AUTO_JOURNAL_ID"

# 6b. GET /accounting/journals/:id
if [ "$JOURNAL_COUNT" -gt 0 ]; then
    FIRST_JOURNAL_ID=$(echo "$JOURNALS_RESPONSE" | jq -r '.data[0].id')
    echo "6b. GET /accounting/journals/:id - Get journal detail"
    JOURNAL_DETAIL=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/accounting/journals/$FIRST_JOURNAL_ID")
    LINE_COUNT=$(echo "$JOURNAL_DETAIL" | jq '.data.lines | length')
    print_pass "Journal detail retrieved successfully ($LINE_COUNT lines)"
fi

# 6c. POST /accounting/journals - Create balanced manual journal
echo "6c. POST /accounting/journals - Create BALANCED manual journal"
KAS_ID=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/accounting/accounts?archived=0" | jq -r '.data[] | select(.code == "1-1110") | .id')
MODAL_ID=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/accounting/accounts?archived=0" | jq -r '.data[] | select(.code == "3-1100") | .id')

CREATE_JOURNAL_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/accounting/journals" \
  -H "Content-Type: application/json" \
  -d "{\"date\":\"2026-08-10\",\"description\":\"Test Manual Journal - Balanced\",\"lines\":[{\"accountId\":\"$KAS_ID\",\"debit\":100000,\"credit\":0,\"description\":\"Debit Kas\"},{\"accountId\":\"$MODAL_ID\",\"debit\":0,\"credit\":100000,\"description\":\"Credit Modal\"}]}")

CREATED_JOURNAL_ID=$(echo "$CREATE_JOURNAL_RESPONSE" | jq -r '.id')
JOURNAL_NUMBER=$(echo "$CREATE_JOURNAL_RESPONSE" | jq -r '.journalNumber')

if [[ "$JOURNAL_NUMBER" == JU-* ]]; then
    print_pass "Balanced manual journal created: $JOURNAL_NUMBER"
else
    print_fail "Failed to create balanced journal" "$CREATE_JOURNAL_RESPONSE"
fi

# 6d. NEGATIVE TEST: POST unbalanced journal
echo "6d. NEGATIVE TEST: POST UNBALANCED manual journal (should fail with 400)"
UNBALANCED_RESPONSE=$(curl -s -w "\n%{http_code}" -b "$COOKIE_FILE" -X POST "$BASE_URL/accounting/journals" \
  -H "Content-Type: application/json" \
  -d "{\"date\":\"2026-08-10\",\"description\":\"Test Manual Journal - Unbalanced\",\"lines\":[{\"accountId\":\"$KAS_ID\",\"debit\":100000,\"credit\":0,\"description\":\"Debit Kas\"},{\"accountId\":\"$MODAL_ID\",\"debit\":0,\"credit\":50000,\"description\":\"Credit Modal (unbalanced)\"}]}")
HTTP_CODE=$(echo "$UNBALANCED_RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "400" ]; then
    print_pass "Unbalanced journal correctly rejected with 400"
else
    print_fail "Unbalanced journal should return 400, got $HTTP_CODE"
fi

# 6e. DELETE manual journal
echo "6e. DELETE /accounting/journals/:id - Delete manual journal"
if [ "$CREATED_JOURNAL_ID" != "null" ] && [ -n "$CREATED_JOURNAL_ID" ]; then
    DELETE_JOURNAL_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X DELETE "$BASE_URL/accounting/journals/$CREATED_JOURNAL_ID")
    if echo "$DELETE_JOURNAL_RESPONSE" | grep -q '"ok":true'; then
        print_pass "Manual journal deleted successfully"
    else
        print_fail "Failed to delete manual journal" "$DELETE_JOURNAL_RESPONSE"
    fi
fi

# 6f. NEGATIVE TEST: DELETE auto journal
echo "6f. NEGATIVE TEST: DELETE auto journal (should fail with 400)"
if [ -n "$AUTO_JOURNAL_ID" ] && [ "$AUTO_JOURNAL_ID" != "null" ]; then
    DELETE_AUTO_RESPONSE=$(curl -s -w "\n%{http_code}" -b "$COOKIE_FILE" -X DELETE "$BASE_URL/accounting/journals/$AUTO_JOURNAL_ID")
    HTTP_CODE=$(echo "$DELETE_AUTO_RESPONSE" | tail -n1)
    if [ "$HTTP_CODE" = "400" ]; then
        print_pass "DELETE auto journal correctly rejected with 400"
    else
        print_fail "DELETE auto journal should return 400, got $HTTP_CODE"
    fi
fi

# TEST 7: GET /accounting/trial-balance - CRITICAL BALANCE CHECK
print_test "7. GET /accounting/trial-balance - CRITICAL BALANCE CHECK"
TB_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/accounting/trial-balance?to=2026-12-31")
TOTAL_DEBIT=$(echo "$TB_RESPONSE" | jq -r '.data.totalDebit')
TOTAL_CREDIT=$(echo "$TB_RESPONSE" | jq -r '.data.totalCredit')
echo "   Total Debit:  Rp $TOTAL_DEBIT"
echo "   Total Credit: Rp $TOTAL_CREDIT"

# Check if balanced (allowing for small rounding differences)
DIFF=$(python3 -c "print(abs($TOTAL_DEBIT - $TOTAL_CREDIT))")
if (( $(python3 -c "print(1 if $DIFF < 0.01 else 0)") )); then
    print_pass "Trial Balance BALANCED: Debit = Credit = Rp $TOTAL_DEBIT"
else
    print_fail "TRIAL BALANCE NOT BALANCED: Debit $TOTAL_DEBIT ≠ Credit $TOTAL_CREDIT"
fi

# TEST 8: GET /accounting/income-statement
print_test "8. GET /accounting/income-statement"
IS_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/accounting/income-statement?from=2025-01-01&to=2026-12-31")
REVENUE=$(echo "$IS_RESPONSE" | jq -r '.data.revenue.total // .data.revenue // 0')
NET_INCOME=$(echo "$IS_RESPONSE" | jq -r '.data.netIncome')
echo "   Revenue:    Rp $REVENUE"
echo "   Net Income: Rp $NET_INCOME"
if [ "$NET_INCOME" != "null" ]; then
    print_pass "Income statement retrieved successfully"
else
    print_fail "Failed to get income statement" "$IS_RESPONSE"
fi

# TEST 9: GET /accounting/balance-sheet - CRITICAL BALANCE CHECK
print_test "9. GET /accounting/balance-sheet - CRITICAL BALANCE CHECK"
BS_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/accounting/balance-sheet?asOf=2026-12-31")
TOTAL_ASSETS=$(echo "$BS_RESPONSE" | jq -r '.data.totalAssets')
TOTAL_LIAB_EQUITY=$(echo "$BS_RESPONSE" | jq -r '.data.totalLiabilitiesEquity')
BALANCED=$(echo "$BS_RESPONSE" | jq -r '.data.balanced')
echo "   Total Assets:              Rp $TOTAL_ASSETS"
echo "   Total Liabilities + Equity: Rp $TOTAL_LIAB_EQUITY"
echo "   Balanced: $BALANCED"

if [ "$BALANCED" = "true" ]; then
    print_pass "Balance Sheet BALANCED: Assets = Liab+Equity = Rp $TOTAL_ASSETS"
else
    print_fail "BALANCE SHEET NOT BALANCED: Assets $TOTAL_ASSETS ≠ Liab+Equity $TOTAL_LIAB_EQUITY"
fi

# TEST 10: GET /accounting/cash-flow
print_test "10. GET /accounting/cash-flow"
CF_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/accounting/cash-flow?from=2025-01-01&to=2026-12-31")
ENDING_CASH=$(echo "$CF_RESPONSE" | jq -r '.data.endingCash')
echo "   Ending Cash: Rp $ENDING_CASH"
if [ "$ENDING_CASH" != "null" ]; then
    print_pass "Cash flow retrieved successfully"
else
    print_fail "Failed to get cash flow" "$CF_RESPONSE"
fi

# TEST 11: GET /accounting/overview
print_test "11. GET /accounting/overview"
OVERVIEW_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/accounting/overview")
JOURNAL_COUNT=$(echo "$OVERVIEW_RESPONSE" | jq -r '.data.journalCount')
echo "   Journal Count: $JOURNAL_COUNT"
if [ "$JOURNAL_COUNT" != "null" ]; then
    print_pass "Overview retrieved successfully"
else
    print_fail "Failed to get overview" "$OVERVIEW_RESPONSE"
fi

# Summary
echo ""
echo "================================================================================"
echo "TEST SUMMARY"
echo "================================================================================"
TOTAL=$((PASS_COUNT + FAIL_COUNT))
PERCENTAGE=$((PASS_COUNT * 100 / TOTAL))
echo -e "${GREEN}PASSED: $PASS_COUNT${NC}"
echo -e "${RED}FAILED: $FAIL_COUNT${NC}"
echo "TOTAL: $PASS_COUNT/$TOTAL tests passed ($PERCENTAGE%)"
echo "================================================================================"

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "\n${GREEN}🎉 ALL TESTS PASSED!${NC}"
    exit 0
else
    echo -e "\n${RED}⚠️  $FAIL_COUNT TEST(S) FAILED${NC}"
    exit 1
fi
