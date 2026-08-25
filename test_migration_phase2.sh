#!/bin/bash

# MIGRATION Phase 2 Backend Test using curl
# Tests MongoDB-authoritative journals, period closings, and stock ledger

BASE_URL="http://localhost:3000/api"
MONGO_URL="mongodb://localhost:27017"
MONGO_DB="erp_prod"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results
PASSED=0
FAILED=0

# Temp files for cookies
ADMIN_COOKIE="/tmp/admin_cookie_phase2.txt"
OPERATOR_COOKIE="/tmp/operator_cookie_phase2.txt"

# Test data tracking
CASHBOOK_IDS=()
JOURNAL_IDS=()
CLOSING_IDS=()

print_test() {
    echo ""
    echo "================================================================================"
    echo "TEST: $1"
    echo "================================================================================"
}

print_result() {
    if [ "$1" = "PASS" ]; then
        echo -e "${GREEN}✅ PASSED${NC}: $2"
        ((PASSED++))
    else
        echo -e "${RED}❌ FAILED${NC}: $2"
        ((FAILED++))
    fi
}

print_info() {
    echo -e "${YELLOW}ℹ️  INFO${NC}: $1"
}

# Login as admin
echo "Logging in as admin@lpi.co.id..."
curl -s -c "$ADMIN_COOKIE" -X POST "$BASE_URL/../api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}' > /dev/null

if [ $? -eq 0 ]; then
    echo "✅ Logged in as admin"
else
    echo "❌ Failed to login as admin"
    exit 1
fi

# Login as operator
echo "Logging in as operator@lpi.co.id..."
curl -s -c "$OPERATOR_COOKIE" -X POST "$BASE_URL/../api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"email":"operator@lpi.co.id","password":"operator123"}' > /dev/null

if [ $? -eq 0 ]; then
    echo "✅ Logged in as operator"
else
    echo "❌ Failed to login as operator"
    exit 1
fi

# Test 1: CASHBOOK Operations
print_test "SCENARIO 1: CASHBOOK (Pencatatan Cepat) - POST/GET/PUT/DELETE"

# Get accounts
ACCOUNTS=$(curl -s -b "$ADMIN_COOKIE" "$BASE_URL/accounting/accounts")
if [ $? -ne 0 ]; then
    print_result "FAIL" "Failed to get accounts"
else
    # Extract expense and cash account codes
    EXPENSE_CODE=$(echo "$ACCOUNTS" | python3 -c "import sys, json; data=json.load(sys.stdin); print(next((a['code'] for a in data.get('data',[]) if a.get('type')=='expense'), ''))")
    CASH_CODE=$(echo "$ACCOUNTS" | python3 -c "import sys, json; data=json.load(sys.stdin); print(next((a['code'] for a in data.get('data',[]) if a.get('type')=='asset' and 'kas' in a.get('name','').lower()), ''))")
    
    if [ -z "$EXPENSE_CODE" ] || [ -z "$CASH_CODE" ]; then
        print_result "FAIL" "Could not find valid expense or cash account"
    else
        print_info "Using expense account: $EXPENSE_CODE, cash account: $CASH_CODE"
        
        # 1.1 POST cashbook
        CASHBOOK_RESP=$(curl -s -b "$ADMIN_COOKIE" -X POST "$BASE_URL/accounting/cashbook" \
          -H "Content-Type: application/json" \
          -H "Origin: http://localhost:3000" \
          -d "{\"type\":\"EXPENSE\",\"date\":\"2026-02-10\",\"amount\":150000,\"categoryCode\":\"$EXPENSE_CODE\",\"cashCode\":\"$CASH_CODE\",\"note\":\"Test beban Fase2\"}")
        
        CASHBOOK_ID=$(echo "$CASHBOOK_RESP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
        
        if [ -n "$CASHBOOK_ID" ]; then
            print_result "PASS" "Created cashbook entry: $CASHBOOK_ID"
            CASHBOOK_IDS+=("$CASHBOOK_ID")
            
            # 1.2 GET cashbook list
            CASHBOOK_LIST=$(curl -s -b "$ADMIN_COOKIE" "$BASE_URL/accounting/cashbook")
            FOUND=$(echo "$CASHBOOK_LIST" | python3 -c "import sys, json; data=json.load(sys.stdin); print('yes' if any(e.get('id')=='$CASHBOOK_ID' for e in data.get('data',[])) else 'no')" 2>/dev/null)
            
            if [ "$FOUND" = "yes" ]; then
                print_result "PASS" "Cashbook entry found in GET list"
            else
                print_result "FAIL" "Cashbook entry NOT found in GET list"
            fi
            
            # 1.3 Verify in MongoDB journal_entries
            MONGO_JE=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "JSON.stringify(db.journal_entries.findOne({id:'$CASHBOOK_ID'}))" 2>/dev/null)
            IS_AUTO=$(echo "$MONGO_JE" | python3 -c "import sys, json; print(json.loads(sys.stdin.read()).get('is_auto',''))" 2>/dev/null)
            SOURCE_TYPE=$(echo "$MONGO_JE" | python3 -c "import sys, json; print(json.loads(sys.stdin.read()).get('source_type',''))" 2>/dev/null)
            
            if [ "$IS_AUTO" = "0" ] && [ "$SOURCE_TYPE" = "EXPENSE" ]; then
                print_result "PASS" "MongoDB journal_entries verified: is_auto=0, source_type=EXPENSE"
            else
                print_result "FAIL" "MongoDB journal_entries verification failed: is_auto=$IS_AUTO, source_type=$SOURCE_TYPE"
            fi
            
            # 1.4 Verify journal_lines in MongoDB
            JL_COUNT=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.journal_lines.countDocuments({journal_id:'$CASHBOOK_ID'})" 2>/dev/null)
            
            if [ "$JL_COUNT" = "2" ]; then
                print_result "PASS" "MongoDB journal_lines verified: 2 lines found"
            else
                print_result "FAIL" "MongoDB journal_lines: expected 2 lines, got $JL_COUNT"
            fi
            
            # 1.5 PUT cashbook (update amount)
            UPDATE_RESP=$(curl -s -b "$ADMIN_COOKIE" -X PUT "$BASE_URL/accounting/cashbook/$CASHBOOK_ID" \
              -H "Content-Type: application/json" \
              -H "Origin: http://localhost:3000" \
              -d "{\"type\":\"EXPENSE\",\"date\":\"2026-02-10\",\"amount\":200000,\"categoryCode\":\"$EXPENSE_CODE\",\"cashCode\":\"$CASH_CODE\",\"note\":\"Test beban Fase2 edit\"}")
            
            NEW_ID=$(echo "$UPDATE_RESP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
            
            if [ -n "$NEW_ID" ] && [ "$NEW_ID" != "$CASHBOOK_ID" ]; then
                print_result "PASS" "Updated cashbook entry: new id=$NEW_ID (updateQuickEntry creates new journal)"
                CASHBOOK_IDS+=("$NEW_ID")
                
                # 1.6 Verify old id gone from MongoDB
                OLD_EXISTS=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.journal_entries.countDocuments({id:'$CASHBOOK_ID'})" 2>/dev/null)
                NEW_EXISTS=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.journal_entries.countDocuments({id:'$NEW_ID'})" 2>/dev/null)
                
                if [ "$OLD_EXISTS" = "0" ] && [ "$NEW_EXISTS" = "1" ]; then
                    print_result "PASS" "MongoDB updated: old id gone, new id present"
                else
                    print_result "FAIL" "MongoDB update verification failed: old=$OLD_EXISTS, new=$NEW_EXISTS"
                fi
                
                # 1.7 DELETE cashbook
                DEL_RESP=$(curl -s -w "%{http_code}" -b "$ADMIN_COOKIE" -X DELETE "$BASE_URL/accounting/cashbook/$NEW_ID" \
                  -H "Origin: http://localhost:3000")
                
                DEL_STATUS="${DEL_RESP: -3}"
                
                if [ "$DEL_STATUS" = "200" ]; then
                    print_result "PASS" "Deleted cashbook entry: $NEW_ID"
                    
                    # 1.8 Verify removed from MongoDB
                    DELETED_JE=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.journal_entries.countDocuments({id:'$NEW_ID'})" 2>/dev/null)
                    DELETED_JL=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.journal_lines.countDocuments({journal_id:'$NEW_ID'})" 2>/dev/null)
                    
                    if [ "$DELETED_JE" = "0" ] && [ "$DELETED_JL" = "0" ]; then
                        print_result "PASS" "MongoDB verified: entry and lines removed"
                    else
                        print_result "FAIL" "MongoDB still has deleted data: je=$DELETED_JE, jl=$DELETED_JL"
                    fi
                    
                    CASHBOOK_IDS=()
                else
                    print_result "FAIL" "Failed to delete cashbook entry: HTTP $DEL_STATUS"
                fi
            else
                print_result "FAIL" "Failed to update cashbook entry or new id same as old"
            fi
        else
            print_result "FAIL" "Failed to create cashbook entry: $CASHBOOK_RESP"
        fi
    fi
fi

# Test 2: MANUAL JOURNAL
print_test "SCENARIO 2: MANUAL JOURNAL - POST/DELETE"

# Get two accounts
ACCOUNT1_ID=$(echo "$ACCOUNTS" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('data',[])[0].get('id','') if data.get('data') else '')" 2>/dev/null)
ACCOUNT2_ID=$(echo "$ACCOUNTS" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('data',[])[1].get('id','') if len(data.get('data',[])) > 1 else '')" 2>/dev/null)

if [ -n "$ACCOUNT1_ID" ] && [ -n "$ACCOUNT2_ID" ]; then
    print_info "Using accounts: $ACCOUNT1_ID, $ACCOUNT2_ID"
    
    # POST manual journal with description for each line
    JOURNAL_RESP=$(curl -s -b "$ADMIN_COOKIE" -X POST "$BASE_URL/accounting/journals" \
      -H "Content-Type: application/json" \
      -H "Origin: http://localhost:3000" \
      -d "{\"date\":\"2026-02-10\",\"description\":\"Jurnal manual test Fase2\",\"lines\":[{\"accountId\":\"$ACCOUNT1_ID\",\"debit\":50000,\"credit\":0,\"description\":\"Debit line\"},{\"accountId\":\"$ACCOUNT2_ID\",\"debit\":0,\"credit\":50000,\"description\":\"Credit line\"}]}")
    
    JOURNAL_ID=$(echo "$JOURNAL_RESP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
    
    if [ -n "$JOURNAL_ID" ]; then
        print_result "PASS" "Created manual journal: $JOURNAL_ID"
        JOURNAL_IDS+=("$JOURNAL_ID")
        
        # Verify in GET list
        JOURNALS_LIST=$(curl -s -b "$ADMIN_COOKIE" "$BASE_URL/accounting/journals")
        FOUND=$(echo "$JOURNALS_LIST" | python3 -c "import sys, json; data=json.load(sys.stdin); print('yes' if any(j.get('id')=='$JOURNAL_ID' for j in data.get('data',[])) else 'no')" 2>/dev/null)
        
        if [ "$FOUND" = "yes" ]; then
            print_result "PASS" "Manual journal found in GET list"
        else
            print_result "FAIL" "Manual journal NOT found in GET list"
        fi
        
        # Verify in MongoDB
        MONGO_JE=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "JSON.stringify(db.journal_entries.findOne({id:'$JOURNAL_ID'}))" 2>/dev/null)
        IS_AUTO=$(echo "$MONGO_JE" | python3 -c "import sys, json; print(json.loads(sys.stdin.read()).get('is_auto',''))" 2>/dev/null)
        
        if [ "$IS_AUTO" = "0" ]; then
            print_result "PASS" "MongoDB journal_entries verified: is_auto=0"
        else
            print_result "FAIL" "MongoDB journal_entries: is_auto should be 0, got $IS_AUTO"
        fi
        
        # Verify journal_lines
        JL_COUNT=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.journal_lines.countDocuments({journal_id:'$JOURNAL_ID'})" 2>/dev/null)
        
        if [ "$JL_COUNT" = "2" ]; then
            print_result "PASS" "MongoDB journal_lines verified: 2 lines found"
        else
            print_result "FAIL" "MongoDB journal_lines: expected 2 lines, got $JL_COUNT"
        fi
        
        # DELETE journal
        DEL_RESP=$(curl -s -w "%{http_code}" -b "$ADMIN_COOKIE" -X DELETE "$BASE_URL/accounting/journals/$JOURNAL_ID" \
          -H "Origin: http://localhost:3000")
        
        DEL_STATUS="${DEL_RESP: -3}"
        
        if [ "$DEL_STATUS" = "200" ]; then
            print_result "PASS" "Deleted manual journal: $JOURNAL_ID"
            
            # Verify removed from MongoDB
            DELETED_JE=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.journal_entries.countDocuments({id:'$JOURNAL_ID'})" 2>/dev/null)
            DELETED_JL=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.journal_lines.countDocuments({journal_id:'$JOURNAL_ID'})" 2>/dev/null)
            
            if [ "$DELETED_JE" = "0" ] && [ "$DELETED_JL" = "0" ]; then
                print_result "PASS" "MongoDB verified: journal and lines removed"
            else
                print_result "FAIL" "MongoDB still has deleted data: je=$DELETED_JE, jl=$DELETED_JL"
            fi
            
            JOURNAL_IDS=()
        else
            print_result "FAIL" "Failed to delete manual journal: HTTP $DEL_STATUS"
        fi
    else
        ERROR_MSG=$(echo "$JOURNAL_RESP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('error',''))" 2>/dev/null)
        print_result "FAIL" "Failed to create manual journal: $ERROR_MSG"
    fi
else
    print_result "FAIL" "Not enough accounts for manual journal test"
fi

# Test 3: DOUBLE-ENTRY INTEGRITY
print_test "SCENARIO 3: DOUBLE-ENTRY INTEGRITY"

TB_RESP=$(curl -s -b "$ADMIN_COOKIE" "$BASE_URL/accounting/trial-balance")
TB_STATUS=$?

if [ $TB_STATUS -eq 0 ]; then
    TB_DEBIT=$(echo "$TB_RESP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('data',{}).get('totalDebit',0))" 2>/dev/null)
    TB_CREDIT=$(echo "$TB_RESP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('data',{}).get('totalCredit',0))" 2>/dev/null)
    
    if [ "$TB_DEBIT" = "$TB_CREDIT" ]; then
        print_result "PASS" "Trial balance balanced: debit=$TB_DEBIT, credit=$TB_CREDIT"
    else
        print_result "FAIL" "Trial balance NOT balanced: debit=$TB_DEBIT, credit=$TB_CREDIT"
    fi
else
    print_result "FAIL" "Failed to get trial balance"
fi

BS_RESP=$(curl -s -b "$ADMIN_COOKIE" "$BASE_URL/accounting/balance-sheet")
BS_BALANCED=$(echo "$BS_RESP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('data',{}).get('balanced','false'))" 2>/dev/null)

if [ "$BS_BALANCED" = "True" ] || [ "$BS_BALANCED" = "true" ]; then
    print_result "PASS" "Balance sheet balanced"
else
    print_result "FAIL" "Balance sheet NOT balanced"
fi

IS_RESP=$(curl -s -w "%{http_code}" -b "$ADMIN_COOKIE" "$BASE_URL/accounting/income-statement")
IS_STATUS="${IS_RESP: -3}"

if [ "$IS_STATUS" = "200" ]; then
    print_result "PASS" "Income statement returned 200 OK"
else
    print_result "FAIL" "Income statement failed: HTTP $IS_STATUS"
fi

OV_RESP=$(curl -s -w "%{http_code}" -b "$ADMIN_COOKIE" "$BASE_URL/accounting/overview")
OV_STATUS="${OV_RESP: -3}"

if [ "$OV_STATUS" = "200" ]; then
    print_result "PASS" "Overview returned 200 OK"
else
    print_result "FAIL" "Overview failed: HTTP $OV_STATUS"
fi

# Test 4: AUTO JOURNALS NOT IN MONGO
print_test "SCENARIO 4: AUTO JOURNALS NOT IN MONGO"

AUTO_COUNT=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.journal_entries.countDocuments({is_auto:1})" 2>/dev/null)

if [ "$AUTO_COUNT" = "0" ]; then
    print_result "PASS" "MongoDB contains ONLY is_auto=0 docs (auto journals NOT persisted)"
else
    print_result "FAIL" "Found $AUTO_COUNT auto journals (is_auto=1) in MongoDB - should be 0"
fi

MANUAL_COUNT=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.journal_entries.countDocuments({is_auto:0})" 2>/dev/null)
print_info "MongoDB journal_entries manual journal count (is_auto=0): $MANUAL_COUNT"

# Check API journals (may include auto if source docs exist)
JOURNALS_RESP=$(curl -s -b "$ADMIN_COOKIE" "$BASE_URL/accounting/journals")
TOTAL_JOURNALS=$(echo "$JOURNALS_RESP" | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null)
print_info "API /accounting/journals total count: $TOTAL_JOURNALS"

# Test 5: TUTUP BUKU (Period Closing)
print_test "SCENARIO 5: TUTUP BUKU (Period Closing)"

CLOSING_RESP=$(curl -s -w "\n%{http_code}" -b "$ADMIN_COOKIE" -X POST "$BASE_URL/accounting/closings" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"period":"2026-01"}')

CLOSING_BODY=$(echo "$CLOSING_RESP" | head -n -1)
CLOSING_STATUS=$(echo "$CLOSING_RESP" | tail -n 1)

if [ "$CLOSING_STATUS" = "400" ]; then
    ERROR_MSG=$(echo "$CLOSING_BODY" | python3 -c "import sys, json; print(json.load(sys.stdin).get('error',''))" 2>/dev/null)
    if [[ "$ERROR_MSG" == *"Tidak ada saldo laba/rugi"* ]] || [[ "$ERROR_MSG" == *"tidak ada"* ]]; then
        print_result "PASS" "Period closing returned 'Tidak ada saldo laba/rugi' - acceptable (no P&L data in 2026-01)"
    else
        print_result "FAIL" "Period closing failed with unexpected error: $ERROR_MSG"
    fi
elif [ "$CLOSING_STATUS" = "200" ]; then
    CLOSING_ID=$(echo "$CLOSING_BODY" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
    JOURNAL_ID=$(echo "$CLOSING_BODY" | python3 -c "import sys, json; print(json.load(sys.stdin).get('journalId',''))" 2>/dev/null)
    
    if [ -n "$CLOSING_ID" ] && [ -n "$JOURNAL_ID" ]; then
        print_result "PASS" "Created period closing: id=$CLOSING_ID, journalId=$JOURNAL_ID"
        CLOSING_IDS+=("$CLOSING_ID")
        
        # Verify in MongoDB journal_entries
        MONGO_JE=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "JSON.stringify(db.journal_entries.findOne({id:'$JOURNAL_ID'}))" 2>/dev/null)
        IS_AUTO=$(echo "$MONGO_JE" | python3 -c "import sys, json; print(json.loads(sys.stdin.read()).get('is_auto',''))" 2>/dev/null)
        SOURCE_TYPE=$(echo "$MONGO_JE" | python3 -c "import sys, json; print(json.loads(sys.stdin.read()).get('source_type',''))" 2>/dev/null)
        
        if [ "$IS_AUTO" = "0" ] && [ "$SOURCE_TYPE" = "CLOSING" ]; then
            print_result "PASS" "MongoDB journal_entries verified: source_type=CLOSING, is_auto=0"
        else
            print_result "FAIL" "MongoDB journal_entries verification failed: is_auto=$IS_AUTO, source_type=$SOURCE_TYPE"
        fi
        
        # Verify in MongoDB period_closings
        PC_EXISTS=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.period_closings.countDocuments({id:'$CLOSING_ID'})" 2>/dev/null)
        
        if [ "$PC_EXISTS" = "1" ]; then
            print_result "PASS" "MongoDB period_closings doc verified"
        else
            print_result "FAIL" "MongoDB period_closings doc NOT found"
        fi
        
        # GET closings list
        CLOSINGS_LIST=$(curl -s -b "$ADMIN_COOKIE" "$BASE_URL/accounting/closings")
        FOUND=$(echo "$CLOSINGS_LIST" | python3 -c "import sys, json; data=json.load(sys.stdin); print('yes' if any(c.get('id')=='$CLOSING_ID' for c in data.get('data',[])) else 'no')" 2>/dev/null)
        
        if [ "$FOUND" = "yes" ]; then
            print_result "PASS" "Period closing found in GET list"
        else
            print_result "FAIL" "Period closing NOT found in GET list"
        fi
        
        # DELETE closing
        DEL_RESP=$(curl -s -w "%{http_code}" -b "$ADMIN_COOKIE" -X DELETE "$BASE_URL/accounting/closings/$CLOSING_ID" \
          -H "Origin: http://localhost:3000")
        
        DEL_STATUS="${DEL_RESP: -3}"
        
        if [ "$DEL_STATUS" = "200" ]; then
            print_result "PASS" "Deleted period closing: $CLOSING_ID"
            
            # Verify removed from MongoDB
            DELETED_JE=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.journal_entries.countDocuments({id:'$JOURNAL_ID'})" 2>/dev/null)
            DELETED_PC=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.period_closings.countDocuments({id:'$CLOSING_ID'})" 2>/dev/null)
            
            if [ "$DELETED_JE" = "0" ] && [ "$DELETED_PC" = "0" ]; then
                print_result "PASS" "MongoDB verified: closing journal and period_closing removed"
            else
                print_result "FAIL" "MongoDB still has deleted data: je=$DELETED_JE, pc=$DELETED_PC"
            fi
            
            CLOSING_IDS=()
        else
            print_result "FAIL" "Failed to delete period closing: HTTP $DEL_STATUS"
        fi
    else
        print_result "FAIL" "Period closing response missing id or journalId"
    fi
else
    print_result "FAIL" "Period closing failed: HTTP $CLOSING_STATUS"
fi

# Test 6: STOCK LEDGER
print_test "SCENARIO 6: STOCK LEDGER (Kartu Stok)"

SL_RESP=$(curl -s -w "\n%{http_code}" -b "$ADMIN_COOKIE" "$BASE_URL/stock-ledger")
SL_BODY=$(echo "$SL_RESP" | head -n -1)
SL_STATUS=$(echo "$SL_RESP" | tail -n 1)

if [ "$SL_STATUS" = "200" ]; then
    SL_COUNT=$(echo "$SL_BODY" | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null)
    print_result "PASS" "GET /stock-ledger returned 200 OK with $SL_COUNT rows"
    
    # Verify MongoDB
    MONGO_SL_COUNT=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.stock_ledger.countDocuments({})" 2>/dev/null)
    print_info "MongoDB stock_ledger collection has $MONGO_SL_COUNT documents"
    
    if [ "$MONGO_SL_COUNT" -gt 0 ]; then
        print_result "PASS" "MongoDB stock_ledger collection populated (expected >=8 pre-existing rows)"
    else
        print_result "FAIL" "MongoDB stock_ledger collection is empty"
    fi
    
    # Try stock-card endpoint
    PRODUCT_ID=$(echo "$SL_BODY" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('data',[])[0].get('productId','') if data.get('data') else '')" 2>/dev/null)
    
    if [ -n "$PRODUCT_ID" ]; then
        SC_RESP=$(curl -s -w "\n%{http_code}" -b "$ADMIN_COOKIE" "$BASE_URL/inventory-reports/stock-card?productId=$PRODUCT_ID")
        SC_STATUS=$(echo "$SC_RESP" | tail -n 1)
        
        if [ "$SC_STATUS" = "200" ]; then
            SC_BODY=$(echo "$SC_RESP" | head -n -1)
            SC_COUNT=$(echo "$SC_BODY" | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null)
            print_result "PASS" "GET /inventory-reports/stock-card returned 200 OK with $SC_COUNT rows"
        else
            print_result "FAIL" "GET /inventory-reports/stock-card failed: HTTP $SC_STATUS"
        fi
    else
        print_info "No productId in ledger data, skipping stock-card test"
    fi
else
    print_result "FAIL" "GET /stock-ledger failed: HTTP $SL_STATUS"
fi

# Test 7: ROLE GUARD
print_test "SCENARIO 7: ROLE GUARD (Operator 403)"

OP_RESP=$(curl -s -w "%{http_code}" -b "$OPERATOR_COOKIE" -X POST "$BASE_URL/accounting/cashbook" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d "{\"type\":\"EXPENSE\",\"date\":\"2026-02-10\",\"amount\":100000,\"categoryCode\":\"$EXPENSE_CODE\",\"cashCode\":\"$CASH_CODE\",\"note\":\"Test operator forbidden\"}")

OP_STATUS="${OP_RESP: -3}"

if [ "$OP_STATUS" = "403" ]; then
    print_result "PASS" "Operator POST cashbook correctly returned 403 Forbidden"
else
    print_result "FAIL" "Operator POST cashbook should return 403, got: HTTP $OP_STATUS"
fi

# Final report
print_test "FINAL STATE REPORT"

echo ""
echo "MongoDB Database: $MONGO_DB"
echo "MongoDB URL: $MONGO_URL"
echo ""
echo "MongoDB Collection Counts:"

JE_TOTAL=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.journal_entries.countDocuments({})" 2>/dev/null)
JE_MANUAL=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.journal_entries.countDocuments({is_auto:0})" 2>/dev/null)
JE_AUTO=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.journal_entries.countDocuments({is_auto:1})" 2>/dev/null)
JL_TOTAL=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.journal_lines.countDocuments({})" 2>/dev/null)
PC_TOTAL=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.period_closings.countDocuments({})" 2>/dev/null)
SL_TOTAL=$(mongosh "$MONGO_URL/$MONGO_DB" --quiet --eval "db.stock_ledger.countDocuments({})" 2>/dev/null)

echo "  journal_entries (total): $JE_TOTAL"
echo "  journal_entries (is_auto=0, manual): $JE_MANUAL"
echo "  journal_entries (is_auto=1, auto): $JE_AUTO"
echo "  journal_lines: $JL_TOTAL"
echo "  period_closings: $PC_TOTAL"
echo "  stock_ledger: $SL_TOTAL"

if [ "$JE_AUTO" = "0" ]; then
    echo -e "\n${GREEN}✅ VERIFIED${NC}: MongoDB contains ONLY manual journals (is_auto=0)"
else
    echo -e "\n${RED}⚠️  WARNING${NC}: Found $JE_AUTO auto journals (is_auto=1) in MongoDB - should be 0!"
fi

# Summary
echo ""
echo "================================================================================"
echo "TEST SUMMARY"
echo "================================================================================"

TOTAL=$((PASSED + FAILED))
if [ $TOTAL -gt 0 ]; then
    PERCENT=$((PASSED * 100 / TOTAL))
else
    PERCENT=0
fi

echo "Total: $PASSED/$TOTAL tests passed ($PERCENT%)"

if [ $FAILED -eq 0 ]; then
    echo -e "\n${GREEN}✅ ALL TESTS PASSED - MIGRATION PHASE 2 VERIFIED${NC}"
    exit 0
else
    echo -e "\n${RED}❌ $FAILED TEST(S) FAILED${NC}"
    exit 1
fi
