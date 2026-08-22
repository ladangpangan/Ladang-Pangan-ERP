#!/bin/bash
# Backend Test: ACCOUNTING REPORT CONSISTENCY using curl
# Tests the [DATA-SOURCE=MongoDB] verification log on accounting report endpoints

set -e

BASE_URL="http://localhost:3000/api"
COOKIE_FILE="/tmp/accounting_test_cookies.txt"

echo "================================================================================"
echo "ACCOUNTING REPORT CONSISTENCY TEST (using curl)"
echo "================================================================================"

# Clean up old cookie file
rm -f "$COOKIE_FILE"

# Test counters
PASSED=0
FAILED=0
TOTAL=0

log_test() {
    local name="$1"
    local status="$2"
    local details="$3"
    
    TOTAL=$((TOTAL + 1))
    if [ "$status" = "PASS" ]; then
        echo ""
        echo "✅ PASSED: $name"
        [ -n "$details" ] && echo "  Details: $details"
        PASSED=$((PASSED + 1))
    else
        echo ""
        echo "❌ FAILED: $name"
        [ -n "$details" ] && echo "  Details: $details"
        FAILED=$((FAILED + 1))
    fi
}

# Test 1: Login as admin
echo ""
echo "[1] Logging in as admin..."
LOGIN_RESPONSE=$(curl -s -c "$COOKIE_FILE" -X POST \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:3000" \
    -d '{"email":"admin@lpi.co.id","password":"admin123"}' \
    "http://localhost:3000/api/auth/sign-in/email")

if echo "$LOGIN_RESPONSE" | grep -q '"user"'; then
    log_test "Admin Login" "PASS" "Successfully logged in as admin"
else
    log_test "Admin Login" "FAIL" "Login failed: $LOGIN_RESPONSE"
    exit 1
fi

# Test 2: GET /api/accounting/balance-sheet (Neraca)
echo ""
echo "[2] Testing GET /api/accounting/balance-sheet..."
RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/accounting/balance-sheet")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    log_test "GET /api/accounting/balance-sheet" "PASS" "Status: $HTTP_CODE"
else
    log_test "GET /api/accounting/balance-sheet" "FAIL" "Expected 200, got $HTTP_CODE: ${BODY:0:200}"
fi

# Test 3: GET /api/accounting/income-statement (Laba-Rugi)
echo ""
echo "[3] Testing GET /api/accounting/income-statement..."
RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/accounting/income-statement")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    log_test "GET /api/accounting/income-statement" "PASS" "Status: $HTTP_CODE"
else
    log_test "GET /api/accounting/income-statement" "FAIL" "Expected 200, got $HTTP_CODE: ${BODY:0:200}"
fi

# Test 4: GET /api/accounting/trial-balance
echo ""
echo "[4] Testing GET /api/accounting/trial-balance..."
RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/accounting/trial-balance")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    log_test "GET /api/accounting/trial-balance" "PASS" "Status: $HTTP_CODE"
else
    log_test "GET /api/accounting/trial-balance" "FAIL" "Expected 200, got $HTTP_CODE: ${BODY:0:200}"
fi

# Test 5: GET /api/accounting/ledger
echo ""
echo "[5] Testing GET /api/accounting/ledger..."
RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/accounting/ledger")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    log_test "GET /api/accounting/ledger" "PASS" "Status: $HTTP_CODE"
else
    log_test "GET /api/accounting/ledger" "FAIL" "Expected 200, got $HTTP_CODE: ${BODY:0:200}"
fi

# Test 6: GET /api/accounting/cash-flow
echo ""
echo "[6] Testing GET /api/accounting/cash-flow..."
RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/accounting/cash-flow")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    log_test "GET /api/accounting/cash-flow" "PASS" "Status: $HTTP_CODE"
else
    log_test "GET /api/accounting/cash-flow" "FAIL" "Expected 200, got $HTTP_CODE: ${BODY:0:200}"
fi

# Test 7: GET /api/accounting/overview
echo ""
echo "[7] Testing GET /api/accounting/overview..."
RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/accounting/overview")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    log_test "GET /api/accounting/overview" "PASS" "Status: $HTTP_CODE"
else
    log_test "GET /api/accounting/overview" "FAIL" "Expected 200, got $HTTP_CODE: ${BODY:0:200}"
fi

# Test 8: REGRESSION - GET /api/accounting/accounts (COA list)
echo ""
echo "[8] Testing GET /api/accounting/accounts (REGRESSION)..."
RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/accounting/accounts")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    ACCOUNT_COUNT=$(echo "$BODY" | grep -o '"code"' | wc -l)
    log_test "GET /api/accounting/accounts" "PASS" "Status: $HTTP_CODE, Account count: $ACCOUNT_COUNT (expected ~52)"
else
    log_test "GET /api/accounting/accounts" "FAIL" "Expected 200, got $HTTP_CODE: ${BODY:0:200}"
fi

# Test 9: REGRESSION - GET /api/accounting/journals
echo ""
echo "[9] Testing GET /api/accounting/journals (REGRESSION)..."
RESPONSE=$(curl -s -b "$COOKIE_FILE" -w "\n%{http_code}" "$BASE_URL/accounting/journals")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    log_test "GET /api/accounting/journals" "PASS" "Status: $HTTP_CODE"
else
    log_test "GET /api/accounting/journals" "FAIL" "Expected 200, got $HTTP_CODE: ${BODY:0:200}"
fi

# Test 10: Unauthenticated request should return 401
echo ""
echo "[10] Testing unauthenticated request to /api/accounting/balance-sheet..."
RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/accounting/balance-sheet")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "401" ]; then
    log_test "Unauthenticated request returns 401" "PASS" "Status: $HTTP_CODE (correctly rejected)"
else
    log_test "Unauthenticated request returns 401" "FAIL" "Expected 401, got $HTTP_CODE"
fi

# Test 11: Check verification log in server logs
echo ""
echo "[11] Checking verification log in /var/log/supervisor/nextjs.out.log..."
LOG_ENTRIES=$(tail -n 200 /var/log/supervisor/nextjs.out.log | grep -c '\[DATA-SOURCE=MongoDB\].*accounting' || echo "0")

if [ "$LOG_ENTRIES" -gt 0 ]; then
    log_test "Verification log [DATA-SOURCE=MongoDB]" "PASS" "Found $LOG_ENTRIES verification log entries"
    echo ""
    echo "  Sample verification logs:"
    tail -n 200 /var/log/supervisor/nextjs.out.log | grep '\[DATA-SOURCE=MongoDB\].*accounting' | tail -n 3 | while read line; do
        echo "    ${line:0:150}..."
    done
else
    log_test "Verification log [DATA-SOURCE=MongoDB]" "FAIL" "No [DATA-SOURCE=MongoDB] log entries found for accounting routes"
fi

# Print summary
echo ""
echo "================================================================================"
echo "TEST SUMMARY"
echo "================================================================================"
echo ""
echo "Total: $PASSED/$TOTAL tests passed ($((PASSED * 100 / TOTAL))%)"
echo ""

# Clean up
rm -f "$COOKIE_FILE"

if [ "$PASSED" = "$TOTAL" ]; then
    echo "✅ ALL TESTS PASSED"
    exit 0
else
    echo "❌ SOME TESTS FAILED"
    exit 1
fi
