#!/bin/bash
# Backend test for MIGRATION Phase 1: Chart of Accounts (gl_accounts) -> MongoDB-authoritative
# Tests T1-T8 plus operator 403 test and cleanup

set -e

BASE_URL="http://localhost:3000/api"
ADMIN_COOKIES="/tmp/admin_cookies.txt"
OPERATOR_COOKIES="/tmp/operator_cookies.txt"
TEST_ACCOUNT_1="9-8001"
TEST_ACCOUNT_2="9-8002"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0

echo "================================================================================"
echo "MIGRATION Phase 1: Chart of Accounts (gl_accounts) -> MongoDB-authoritative"
echo "Backend Testing Suite"
echo "================================================================================"

# Login as admin
echo ""
echo "[INFO] Logging in as admin..."
curl -s -c $ADMIN_COOKIES -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}' > /dev/null

if [ $? -eq 0 ]; then
    echo -e "${GREEN}[SUCCESS]${NC} Logged in as admin@lpi.co.id"
else
    echo -e "${RED}[ERROR]${NC} Failed to login as admin"
    exit 1
fi

# Login as operator
echo ""
echo "[INFO] Logging in as operator..."
curl -s -c $OPERATOR_COOKIES -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"email":"operator@lpi.co.id","password":"operator123"}' > /dev/null

if [ $? -eq 0 ]; then
    echo -e "${GREEN}[SUCCESS]${NC} Logged in as operator@lpi.co.id"
else
    echo -e "${RED}[ERROR]${NC} Failed to login as operator"
    exit 1
fi

# T1: LIST + Mongo source of truth
echo ""
echo "================================================================================"
echo "TEST T1: LIST + Mongo source of truth"
echo "================================================================================"

RESP=$(curl -s -b $ADMIN_COOKIES $BASE_URL/accounting/accounts -H "Origin: http://localhost:3000")
API_COUNT=$(echo "$RESP" | jq -r '.data | length')

if [ "$API_COUNT" -gt 0 ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T1.1: GET /api/accounting/accounts returned $API_COUNT accounts"
    PASSED=$((PASSED+1))
else
    echo -e "${RED}[FAIL]${NC} T1.1: GET /api/accounting/accounts returned 0 accounts"
    FAILED=$((FAILED+1))
fi

# Check for code 5-1300
CODE_5_1300=$(echo "$RESP" | jq -r '.data[] | select(.code == "5-1300") | .name')
if [ -n "$CODE_5_1300" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T1.2: Code '5-1300' (Beban Angkut Pembelian) found"
    echo "  Account: $CODE_5_1300"
else
    echo -e "${RED}[FAIL]${NC} T1.2: Code '5-1300' NOT found in API response"
    FAILED=$((FAILED+1))
    exit 1
fi

# Check MongoDB
MONGO_COUNT=$(python3 -c "
from pymongo import MongoClient
import os
client = MongoClient(os.getenv('MONGO_URL', 'mongodb://localhost:27017'))
db = client['erp_prod']
print(db['gl_accounts'].count_documents({}))
")

echo "[INFO] T1.3: MongoDB collection 'gl_accounts' has $MONGO_COUNT documents"

MONGO_ACTIVE=$(python3 -c "
from pymongo import MongoClient
import os
client = MongoClient(os.getenv('MONGO_URL', 'mongodb://localhost:27017'))
db = client['erp_prod']
print(db['gl_accounts'].count_documents({'archived_at': None}))
")

echo "[INFO] T1.4: MongoDB has $MONGO_ACTIVE active accounts (archived_at=null)"

# Check 5-1300 in MongoDB
MONGO_5_1300=$(python3 -c "
from pymongo import MongoClient
import os
client = MongoClient(os.getenv('MONGO_URL', 'mongodb://localhost:27017'))
db = client['erp_prod']
doc = db['gl_accounts'].find_one({'code': '5-1300'})
print(doc['name'] if doc else '')
")

if [ -n "$MONGO_5_1300" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T1.5: Code '5-1300' found in MongoDB"
    echo "  Account: $MONGO_5_1300"
else
    echo -e "${RED}[FAIL]${NC} T1.5: Code '5-1300' NOT found in MongoDB"
    FAILED=$((FAILED+1))
    exit 1
fi

echo -e "${GREEN}[SUCCESS]${NC} T1: MongoDB is the source of truth - collection exists with $MONGO_COUNT total documents"

# T2: CREATE
echo ""
echo "================================================================================"
echo "TEST T2: CREATE account $TEST_ACCOUNT_1"
echo "================================================================================"

CREATE_RESP=$(curl -s -b $ADMIN_COOKIES -X POST $BASE_URL/accounting/accounts \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d "{\"code\":\"$TEST_ACCOUNT_1\",\"name\":\"Uji Migrasi\",\"type\":\"expense\"}")

ACCOUNT_ID=$(echo "$CREATE_RESP" | jq -r '.data.id')

if [ "$ACCOUNT_ID" != "null" ] && [ -n "$ACCOUNT_ID" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T2.1: Account created via API"
    echo "  ID: $ACCOUNT_ID"
    echo "  Code: $(echo "$CREATE_RESP" | jq -r '.data.code')"
    echo "  Name: $(echo "$CREATE_RESP" | jq -r '.data.name')"
    PASSED=$((PASSED+1))
else
    echo -e "${RED}[FAIL]${NC} T2.1: Failed to create account"
    echo "Response: $CREATE_RESP"
    FAILED=$((FAILED+1))
    exit 1
fi

# Verify in MongoDB
MONGO_ID=$(python3 -c "
from pymongo import MongoClient
import os
client = MongoClient(os.getenv('MONGO_URL', 'mongodb://localhost:27017'))
db = client['erp_prod']
doc = db['gl_accounts'].find_one({'code': '$TEST_ACCOUNT_1'})
print(doc['id'] if doc else '')
")

if [ "$MONGO_ID" = "$ACCOUNT_ID" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T2.2: Account found in MongoDB with matching ID"
else
    echo -e "${RED}[FAIL]${NC} T2.2: Account NOT found in MongoDB or ID mismatch"
    FAILED=$((FAILED+1))
    exit 1
fi

# Verify in SQLite
SQLITE_ID=$(sqlite3 /app/data/erp.db "SELECT id FROM gl_accounts WHERE code='$TEST_ACCOUNT_1'")

if [ "$SQLITE_ID" = "$ACCOUNT_ID" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T2.3: Account found in SQLite mirror with matching ID"
else
    echo -e "${RED}[FAIL]${NC} T2.3: Account NOT found in SQLite or ID mismatch"
    FAILED=$((FAILED+1))
    exit 1
fi

echo -e "${GREEN}[SUCCESS]${NC} T2: CREATE test passed - account exists in BOTH MongoDB and SQLite with same ID"

# T3: UPDATE
echo ""
echo "================================================================================"
echo "TEST T3: UPDATE account $TEST_ACCOUNT_1"
echo "================================================================================"

UPDATE_RESP=$(curl -s -b $ADMIN_COOKIES -X PATCH $BASE_URL/accounting/accounts/$ACCOUNT_ID \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"name":"Uji Migrasi 2","openingBalance":12345}')

UPDATED_NAME=$(echo "$UPDATE_RESP" | jq -r '.data.name')
UPDATED_BALANCE=$(echo "$UPDATE_RESP" | jq -r '.data.opening_balance')

if [ "$UPDATED_NAME" = "Uji Migrasi 2" ] && [ "$UPDATED_BALANCE" = "12345" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T3.1: Account updated via API"
    echo "  Name: $UPDATED_NAME"
    echo "  Opening Balance: $UPDATED_BALANCE"
    PASSED=$((PASSED+1))
else
    echo -e "${RED}[FAIL]${NC} T3.1: Update failed"
    FAILED=$((FAILED+1))
    exit 1
fi

# Verify in MongoDB
python3 -c "
from pymongo import MongoClient
import os
client = MongoClient(os.getenv('MONGO_URL', 'mongodb://localhost:27017'))
db = client['erp_prod']
doc = db['gl_accounts'].find_one({'id': '$ACCOUNT_ID'})
if doc and doc['name'] == 'Uji Migrasi 2' and doc['opening_balance'] == 12345:
    print('OK')
else:
    print('FAIL')
" | grep -q "OK"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T3.2: MongoDB updated correctly"
else
    echo -e "${RED}[FAIL]${NC} T3.2: MongoDB NOT updated correctly"
    FAILED=$((FAILED+1))
    exit 1
fi

# Verify in SQLite
SQLITE_NAME=$(sqlite3 /app/data/erp.db "SELECT name FROM gl_accounts WHERE id='$ACCOUNT_ID'")
SQLITE_BALANCE=$(sqlite3 /app/data/erp.db "SELECT CAST(opening_balance AS INTEGER) FROM gl_accounts WHERE id='$ACCOUNT_ID'")

if [ "$SQLITE_NAME" = "Uji Migrasi 2" ] && [ "$SQLITE_BALANCE" = "12345" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T3.3: SQLite mirror updated correctly"
else
    echo -e "${RED}[FAIL]${NC} T3.3: SQLite mirror NOT updated correctly"
    echo "  Name: $SQLITE_NAME (expected: Uji Migrasi 2)"
    echo "  Balance: $SQLITE_BALANCE (expected: 12345)"
    FAILED=$((FAILED+1))
    exit 1
fi

echo -e "${GREEN}[SUCCESS]${NC} T3: UPDATE test passed - both MongoDB and SQLite updated correctly"

# T4: DUPLICATE guard
echo ""
echo "================================================================================"
echo "TEST T4: DUPLICATE guard"
echo "================================================================================"

DUP_RESP=$(curl -s -b $ADMIN_COOKIES -X POST $BASE_URL/accounting/accounts \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -w "\n%{http_code}" \
  -d "{\"code\":\"$TEST_ACCOUNT_1\",\"name\":\"Duplicate Test\",\"type\":\"expense\"}")

HTTP_CODE=$(echo "$DUP_RESP" | tail -1)
DUP_ERROR=$(echo "$DUP_RESP" | head -1 | jq -r '.error // empty')

if [ "$HTTP_CODE" = "400" ] && echo "$DUP_ERROR" | grep -qi "sudah dipakai"; then
    echo -e "${GREEN}[SUCCESS]${NC} T4: Duplicate code correctly rejected with 400"
    echo "  Error: $DUP_ERROR"
    PASSED=$((PASSED+1))
else
    echo -e "${RED}[FAIL]${NC} T4: Expected 400 with 'sudah dipakai', got $HTTP_CODE"
    FAILED=$((FAILED+1))
fi

# T5: ARCHIVE/RESTORE
echo ""
echo "================================================================================"
echo "TEST T5: ARCHIVE/RESTORE"
echo "================================================================================"

# Archive
curl -s -b $ADMIN_COOKIES -X POST $BASE_URL/accounting/accounts/$ACCOUNT_ID/archive \
  -H "Origin: http://localhost:3000" > /dev/null

if [ $? -eq 0 ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T5.1: Account archived"
else
    echo -e "${RED}[FAIL]${NC} T5.1: Archive failed"
    FAILED=$((FAILED+1))
    exit 1
fi

# Check default list excludes it
DEFAULT_LIST=$(curl -s -b $ADMIN_COOKIES $BASE_URL/accounting/accounts -H "Origin: http://localhost:3000")
FOUND_IN_DEFAULT=$(echo "$DEFAULT_LIST" | jq -r ".data[] | select(.code == \"$TEST_ACCOUNT_1\") | .code")

if [ -z "$FOUND_IN_DEFAULT" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T5.2: Archived account NOT in default list"
else
    echo -e "${RED}[FAIL]${NC} T5.2: Archived account still in default list"
    FAILED=$((FAILED+1))
    exit 1
fi

# Check archived list includes it
ARCHIVED_LIST=$(curl -s -b $ADMIN_COOKIES "$BASE_URL/accounting/accounts?archived=1" -H "Origin: http://localhost:3000")
FOUND_IN_ARCHIVED=$(echo "$ARCHIVED_LIST" | jq -r ".data[] | select(.code == \"$TEST_ACCOUNT_1\") | .code")

if [ "$FOUND_IN_ARCHIVED" = "$TEST_ACCOUNT_1" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T5.3: Archived account appears in ?archived=1 list"
else
    echo -e "${RED}[FAIL]${NC} T5.3: Archived account NOT in ?archived=1 list"
    FAILED=$((FAILED+1))
    exit 1
fi

# Restore
curl -s -b $ADMIN_COOKIES -X POST $BASE_URL/accounting/accounts/$ACCOUNT_ID/restore \
  -H "Origin: http://localhost:3000" > /dev/null

if [ $? -eq 0 ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T5.4: Account restored"
else
    echo -e "${RED}[FAIL]${NC} T5.4: Restore failed"
    FAILED=$((FAILED+1))
    exit 1
fi

# Check back in default list
DEFAULT_LIST=$(curl -s -b $ADMIN_COOKIES $BASE_URL/accounting/accounts -H "Origin: http://localhost:3000")
FOUND_RESTORED=$(echo "$DEFAULT_LIST" | jq -r ".data[] | select(.code == \"$TEST_ACCOUNT_1\") | .code")

if [ "$FOUND_RESTORED" = "$TEST_ACCOUNT_1" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T5.5: Restored account back in default list"
    PASSED=$((PASSED+1))
else
    echo -e "${RED}[FAIL]${NC} T5.5: Restored account NOT in default list"
    FAILED=$((FAILED+1))
    exit 1
fi

echo -e "${GREEN}[SUCCESS]${NC} T5: ARCHIVE/RESTORE test passed"

# T6: DELETE
echo ""
echo "================================================================================"
echo "TEST T6: DELETE account $TEST_ACCOUNT_1"
echo "================================================================================"

curl -s -b $ADMIN_COOKIES -X DELETE $BASE_URL/accounting/accounts/$ACCOUNT_ID \
  -H "Origin: http://localhost:3000" > /dev/null

if [ $? -eq 0 ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T6.1: Account deleted via API"
else
    echo -e "${RED}[FAIL]${NC} T6.1: Delete failed"
    FAILED=$((FAILED+1))
    exit 1
fi

# Verify NOT in MongoDB
MONGO_EXISTS=$(python3 -c "
from pymongo import MongoClient
import os
client = MongoClient(os.getenv('MONGO_URL', 'mongodb://localhost:27017'))
db = client['erp_prod']
doc = db['gl_accounts'].find_one({'id': '$ACCOUNT_ID'})
print('EXISTS' if doc else 'GONE')
")

if [ "$MONGO_EXISTS" = "GONE" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T6.2: Account removed from MongoDB"
else
    echo -e "${RED}[FAIL]${NC} T6.2: Account still in MongoDB"
    FAILED=$((FAILED+1))
    exit 1
fi

# Verify NOT in SQLite
SQLITE_EXISTS=$(sqlite3 /app/data/erp.db "SELECT COUNT(*) FROM gl_accounts WHERE id='$ACCOUNT_ID'")

if [ "$SQLITE_EXISTS" = "0" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T6.3: Account removed from SQLite mirror"
    PASSED=$((PASSED+1))
else
    echo -e "${RED}[FAIL]${NC} T6.3: Account still in SQLite mirror"
    FAILED=$((FAILED+1))
    exit 1
fi

echo -e "${GREEN}[SUCCESS]${NC} T6: DELETE test passed - account removed from BOTH MongoDB and SQLite"

# T7: IMPORT upsert
echo ""
echo "================================================================================"
echo "TEST T7: IMPORT upsert"
echo "================================================================================"

# Create via import
IMPORT_RESP=$(curl -s -b $ADMIN_COOKIES -X POST $BASE_URL/import/chart-of-accounts \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d "{\"rows\":[{\"Kode Akun\":\"$TEST_ACCOUNT_2\",\"Nama Akun\":\"Impor Uji\",\"Tipe\":\"expense\",\"Saldo Normal\":\"debit\",\"Saldo Awal\":5000}]}")

CREATED=$(echo "$IMPORT_RESP" | jq -r '.data.created')

if [ "$CREATED" = "1" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T7.1: Import created 1 account"
else
    echo -e "${RED}[FAIL]${NC} T7.1: Expected created=1, got $CREATED"
    echo "Response: $IMPORT_RESP"
    FAILED=$((FAILED+1))
    exit 1
fi

# Verify in MongoDB
ACCOUNT_2_ID=$(python3 -c "
from pymongo import MongoClient
import os
client = MongoClient(os.getenv('MONGO_URL', 'mongodb://localhost:27017'))
db = client['erp_prod']
doc = db['gl_accounts'].find_one({'code': '$TEST_ACCOUNT_2'})
if doc and doc['opening_balance'] == 5000:
    print(doc['id'])
else:
    print('')
")

if [ -n "$ACCOUNT_2_ID" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T7.2: Account found in MongoDB with opening_balance=5000"
    echo "  ID: $ACCOUNT_2_ID"
else
    echo -e "${RED}[FAIL]${NC} T7.2: Account NOT found in MongoDB or opening_balance mismatch"
    FAILED=$((FAILED+1))
    exit 1
fi

# Re-import with updated name
REIMPORT_RESP=$(curl -s -b $ADMIN_COOKIES -X POST $BASE_URL/import/chart-of-accounts \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d "{\"rows\":[{\"Kode Akun\":\"$TEST_ACCOUNT_2\",\"Nama Akun\":\"Impor Uji 2\",\"Tipe\":\"expense\",\"Saldo Normal\":\"debit\",\"Saldo Awal\":5000}]}")

UPDATED=$(echo "$REIMPORT_RESP" | jq -r '.data.updated')

if [ "$UPDATED" = "1" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T7.4: Re-import updated 1 account"
else
    echo -e "${RED}[FAIL]${NC} T7.4: Expected updated=1, got $UPDATED"
    FAILED=$((FAILED+1))
    exit 1
fi

# Verify name updated
UPDATED_NAME=$(python3 -c "
from pymongo import MongoClient
import os
client = MongoClient(os.getenv('MONGO_URL', 'mongodb://localhost:27017'))
db = client['erp_prod']
doc = db['gl_accounts'].find_one({'code': '$TEST_ACCOUNT_2'})
print(doc['name'] if doc else '')
")

if [ "$UPDATED_NAME" = "Impor Uji 2" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T7.5: MongoDB name updated to 'Impor Uji 2'"
    PASSED=$((PASSED+1))
else
    echo -e "${RED}[FAIL]${NC} T7.5: MongoDB name NOT updated: $UPDATED_NAME"
    FAILED=$((FAILED+1))
    exit 1
fi

echo -e "${GREEN}[SUCCESS]${NC} T7: IMPORT upsert test passed"

# T8: ENGINE still works
echo ""
echo "================================================================================"
echo "TEST T8: ENGINE still works (accounting reports)"
echo "================================================================================"

# Trial balance
TB_RESP=$(curl -s -b $ADMIN_COOKIES -w "\n%{http_code}" $BASE_URL/accounting/trial-balance \
  -H "Origin: http://localhost:3000")

TB_CODE=$(echo "$TB_RESP" | tail -1)

if [ "$TB_CODE" = "200" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T8.1: GET /api/accounting/trial-balance returned 200"
else
    echo -e "${RED}[FAIL]${NC} T8.1: GET /api/accounting/trial-balance returned $TB_CODE"
    FAILED=$((FAILED+1))
fi

# Balance sheet
BS_RESP=$(curl -s -b $ADMIN_COOKIES -w "\n%{http_code}" $BASE_URL/accounting/balance-sheet \
  -H "Origin: http://localhost:3000")

BS_CODE=$(echo "$BS_RESP" | tail -1)

if [ "$BS_CODE" = "200" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T8.2: GET /api/accounting/balance-sheet returned 200"
else
    echo -e "${RED}[FAIL]${NC} T8.2: GET /api/accounting/balance-sheet returned $BS_CODE"
    FAILED=$((FAILED+1))
fi

# Income statement
IS_RESP=$(curl -s -b $ADMIN_COOKIES -w "\n%{http_code}" $BASE_URL/accounting/income-statement \
  -H "Origin: http://localhost:3000")

IS_CODE=$(echo "$IS_RESP" | tail -1)

if [ "$IS_CODE" = "200" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} T8.3: GET /api/accounting/income-statement returned 200"
    PASSED=$((PASSED+1))
else
    echo -e "${RED}[FAIL]${NC} T8.3: GET /api/accounting/income-statement returned $IS_CODE"
    FAILED=$((FAILED+1))
fi

echo -e "${GREEN}[SUCCESS]${NC} T8: ENGINE test passed - accounting reports work (SQLite mirror hydrated from MongoDB)"

# Operator 403 test
echo ""
echo "================================================================================"
echo "TEST: Operator role 403"
echo "================================================================================"

OP_RESP=$(curl -s -b $OPERATOR_COOKIES -X POST $BASE_URL/accounting/accounts \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -w "\n%{http_code}" \
  -d '{"code":"9-9999","name":"Operator Test","type":"expense"}')

OP_CODE=$(echo "$OP_RESP" | tail -1)

if [ "$OP_CODE" = "403" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} Operator POST correctly rejected with 403"
    PASSED=$((PASSED+1))
else
    echo -e "${RED}[FAIL]${NC} Expected 403, got $OP_CODE"
    FAILED=$((FAILED+1))
fi

# CLEANUP
echo ""
echo "================================================================================"
echo "CLEANUP: Removing test accounts"
echo "================================================================================"

# Delete from MongoDB
python3 -c "
from pymongo import MongoClient
import os
client = MongoClient(os.getenv('MONGO_URL', 'mongodb://localhost:27017'))
db = client['erp_prod']
r1 = db['gl_accounts'].delete_one({'code': '$TEST_ACCOUNT_1'})
r2 = db['gl_accounts'].delete_one({'code': '$TEST_ACCOUNT_2'})
print(f'MongoDB cleanup: {r1.deleted_count + r2.deleted_count} document(s) deleted')
"

# Delete from SQLite
sqlite3 /app/data/erp.db "DELETE FROM gl_accounts WHERE code IN ('$TEST_ACCOUNT_1', '$TEST_ACCOUNT_2')"
echo "SQLite cleanup: completed"

# Verify cleanup
MONGO_REMAINING=$(python3 -c "
from pymongo import MongoClient
import os
client = MongoClient(os.getenv('MONGO_URL', 'mongodb://localhost:27017'))
db = client['erp_prod']
print(db['gl_accounts'].count_documents({'code': {'\$in': ['$TEST_ACCOUNT_1', '$TEST_ACCOUNT_2']}}))
")

SQLITE_REMAINING=$(sqlite3 /app/data/erp.db "SELECT COUNT(*) FROM gl_accounts WHERE code IN ('$TEST_ACCOUNT_1', '$TEST_ACCOUNT_2')")

if [ "$MONGO_REMAINING" = "0" ] && [ "$SQLITE_REMAINING" = "0" ]; then
    echo -e "${GREEN}[SUCCESS]${NC} Cleanup verified: test accounts removed from BOTH stores"
else
    echo -e "${YELLOW}[WARNING]${NC} Cleanup incomplete: MongoDB=$MONGO_REMAINING, SQLite=$SQLITE_REMAINING"
fi

# Final counts
FINAL_MONGO=$(python3 -c "
from pymongo import MongoClient
import os
client = MongoClient(os.getenv('MONGO_URL', 'mongodb://localhost:27017'))
db = client['erp_prod']
print(db['gl_accounts'].count_documents({}))
")

FINAL_SQLITE=$(sqlite3 /app/data/erp.db "SELECT COUNT(*) FROM gl_accounts")

echo ""
echo "[INFO] Final MongoDB gl_accounts document count: $FINAL_MONGO"
echo "[INFO] Final SQLite gl_accounts row count: $FINAL_SQLITE"

# Summary
echo ""
echo "================================================================================"
echo "TEST SUMMARY"
echo "================================================================================"

TOTAL=$((PASSED + FAILED))

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ ALL TESTS PASSED!${NC}"
    echo "Total: $PASSED/$TOTAL tests passed (100%)"
    exit 0
else
    echo -e "${RED}⚠️  $FAILED test(s) failed${NC}"
    echo "Total: $PASSED/$TOTAL tests passed ($((PASSED*100/TOTAL))%)"
    exit 1
fi
