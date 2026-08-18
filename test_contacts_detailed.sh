#!/bin/bash

BASE_URL="http://localhost:3000/api"
COOKIE_JAR="/tmp/admin_cookies.txt"

echo "================================================================================"
echo "DETAILED BACKEND TEST: Phase 2 CONTACTS MongoDB Dual-Write Migration"
echo "================================================================================"

# Login as admin
curl -s -c "$COOKIE_JAR" -X POST "$BASE_URL/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}' > /dev/null

echo ""
echo "=== DETAILED TEST 1: Verify categories parsing ==="
RESP=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/contacts")
echo "First 3 contacts categories:"
echo "$RESP" | jq -r '.data[0:3] | .[] | "\(.code): \(.categories)"'

echo ""
echo "=== DETAILED TEST 2: Search by name ==="
FIRST_NAME=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/contacts" | jq -r '.data[0].displayName' | head -c 5)
RESP=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/contacts?q=$FIRST_NAME")
COUNT=$(echo "$RESP" | jq -r '.data | length')
echo "Search for '$FIRST_NAME': found $COUNT results"

echo ""
echo "=== DETAILED TEST 3: Verify archived filter ==="
# Get default list count
DEFAULT_COUNT=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/contacts" | jq -r '.data | length')
# Get archived list count
ARCHIVED_COUNT=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/contacts?archived=1" | jq -r '.data | length')
# Get all list count
ALL_COUNT=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/contacts?archived=all" | jq -r '.data | length')
echo "Default (active): $DEFAULT_COUNT"
echo "Archived: $ARCHIVED_COUNT"
echo "All: $ALL_COUNT"
echo "Verification: $DEFAULT_COUNT + $ARCHIVED_COUNT = $ALL_COUNT? $((DEFAULT_COUNT + ARCHIVED_COUNT))"

echo ""
echo "=== DETAILED TEST 4: Verify next-code for different categories ==="
for CAT in Customer Supplier Agen Dropshipper; do
  CODE=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/contacts/next-code?category=$CAT" | jq -r '.code')
  echo "$CAT: $CODE"
done

echo ""
echo "=== DETAILED TEST 5: Verify dual-write (SQLite mirror) ==="
# Create a contact
RESP=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/contacts" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"displayName":"Dual Write Test","categories":["Customer"],"phone":"08123456789"}')
TEST_ID=$(echo "$RESP" | jq -r '.data.id')
TEST_CODE=$(echo "$RESP" | jq -r '.data.code')
echo "Created contact: $TEST_ID, code=$TEST_CODE"

# Check MongoDB (via API)
MONGO_CHECK=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/contacts/$TEST_ID" | jq -r '.data.displayName')
echo "MongoDB check (via API): $MONGO_CHECK"

# Check SQLite directly
SQLITE_CHECK=$(sqlite3 /app/data/erp.db "SELECT display_name FROM contacts WHERE id='$TEST_ID'")
echo "SQLite check (direct): $SQLITE_CHECK"

if [ "$MONGO_CHECK" = "Dual Write Test" ] && [ "$SQLITE_CHECK" = "Dual Write Test" ]; then
  echo "✅ Dual-write working: both MongoDB and SQLite have the record"
else
  echo "❌ Dual-write issue: MongoDB=$MONGO_CHECK, SQLite=$SQLITE_CHECK"
fi

# Update the contact
curl -s -b "$COOKIE_JAR" -X PATCH "$BASE_URL/contacts/$TEST_ID" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"phone":"08199999999"}' > /dev/null

# Check update in both stores
MONGO_PHONE=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/contacts/$TEST_ID" | jq -r '.data.phone')
SQLITE_PHONE=$(sqlite3 /app/data/erp.db "SELECT phone FROM contacts WHERE id='$TEST_ID'")
echo "After update - MongoDB phone: $MONGO_PHONE, SQLite phone: $SQLITE_PHONE"

if [ "$MONGO_PHONE" = "08199999999" ] && [ "$SQLITE_PHONE" = "08199999999" ]; then
  echo "✅ Dual-write update working"
else
  echo "❌ Dual-write update issue"
fi

# Delete the test contact
curl -s -b "$COOKIE_JAR" -X DELETE "$BASE_URL/contacts/$TEST_ID" \
  -H "Origin: http://localhost:3000" > /dev/null

# Verify deletion in both stores
MONGO_DEL=$(curl -s -w "\n%{http_code}" -b "$COOKIE_JAR" "$BASE_URL/contacts/$TEST_ID" | tail -1)
SQLITE_DEL=$(sqlite3 /app/data/erp.db "SELECT COUNT(*) FROM contacts WHERE id='$TEST_ID'")
echo "After delete - MongoDB status: $MONGO_DEL, SQLite count: $SQLITE_DEL"

if [ "$MONGO_DEL" = "404" ] && [ "$SQLITE_DEL" = "0" ]; then
  echo "✅ Dual-write delete working"
else
  echo "❌ Dual-write delete issue"
fi

echo ""
echo "=== FINAL VERIFICATION: Contact count ==="
FINAL_COUNT=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/contacts" | jq -r '.data | length')
STATS_COUNT=$(curl -s -b "$COOKIE_JAR" "$BASE_URL/stats" | jq -r '.contacts')
echo "GET /api/contacts: $FINAL_COUNT contacts"
echo "GET /api/stats: $STATS_COUNT contacts"

if [ "$FINAL_COUNT" = "102" ] && [ "$STATS_COUNT" = "102" ]; then
  echo "✅ Contact count is exactly 102 (all temp records cleaned up)"
else
  echo "⚠️  Contact count: expected 102, got $FINAL_COUNT (API) / $STATS_COUNT (stats)"
fi

echo ""
echo "================================================================================"
echo "DETAILED TESTS COMPLETE"
echo "================================================================================"
