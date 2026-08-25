#!/bin/bash
# Backend test for Master Data Import (Phase 2)
# Tests GET /api/import/templates and POST /api/import/:module endpoints

# Don't exit on error - we want to continue testing
set +e

BASE_URL="http://localhost:3000/api"
ORIGIN="http://localhost:3000"
COOKIE_FILE="/tmp/test_import_cookies.txt"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
PASSED=0
FAILED=0

print_test() {
    echo ""
    echo "================================================================================"
    echo "  $1"
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

# Login as admin
print_test "AUTHENTICATION"
echo "🔐 Logging in as admin@lpi.co.id..."

LOGIN_RESP=$(curl -s -w "\n%{http_code}" -c "$COOKIE_FILE" -X POST \
    "$ORIGIN/api/auth/sign-in/email" \
    -H "Origin: $ORIGIN" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@lpi.co.id","password":"admin123"}')

LOGIN_CODE=$(echo "$LOGIN_RESP" | tail -1)
if [ "$LOGIN_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Login successful${NC}"
else
    echo -e "${RED}❌ Login failed: $LOGIN_CODE${NC}"
    exit 1
fi

# T1: GET /api/import/templates - Auth & RBAC
print_test "TEST T1: GET /api/import/templates - Auth & RBAC"

# T1a: No auth -> 401
echo ""
echo "[T1a] Testing without authentication..."
RESP=$(curl -s -w "\n%{http_code}" -X GET \
    "$BASE_URL/import/templates" \
    -H "Origin: $ORIGIN")
CODE=$(echo "$RESP" | tail -1)
if [ "$CODE" = "401" ]; then
    print_result "PASS" "No auth -> $CODE (expected 401)"
else
    print_result "FAIL" "No auth -> $CODE (expected 401)"
fi

# T1b: Operator -> 403
echo ""
echo "[T1b] Testing as operator..."
OPERATOR_COOKIE="/tmp/test_import_operator_cookies.txt"
curl -s -c "$OPERATOR_COOKIE" -X POST \
    "$ORIGIN/api/auth/sign-in/email" \
    -H "Origin: $ORIGIN" \
    -H "Content-Type: application/json" \
    -d '{"email":"operator@lpi.co.id","password":"operator123"}' > /dev/null

RESP=$(curl -s -w "\n%{http_code}" -b "$OPERATOR_COOKIE" -X GET \
    "$BASE_URL/import/templates" \
    -H "Origin: $ORIGIN")
CODE=$(echo "$RESP" | tail -1)
if [ "$CODE" = "403" ]; then
    print_result "PASS" "Operator -> $CODE (expected 403)"
else
    print_result "FAIL" "Operator -> $CODE (expected 403)"
fi

# T1c: Admin -> 200 with templates
echo ""
echo "[T1c] Testing as admin..."
RESP=$(curl -s -w "\n%{http_code}" -b "$COOKIE_FILE" -X GET \
    "$BASE_URL/import/templates" \
    -H "Origin: $ORIGIN")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)

if [ "$CODE" = "200" ]; then
    # Check if response has all required keys
    HAS_PRODUCTS=$(echo "$BODY" | grep -o '"products"' | wc -l)
    HAS_CONTACTS=$(echo "$BODY" | grep -o '"contacts"' | wc -l)
    HAS_COA=$(echo "$BODY" | grep -o '"chart-of-accounts"' | wc -l)
    
    if [ "$HAS_PRODUCTS" -gt 0 ] && [ "$HAS_CONTACTS" -gt 0 ] && [ "$HAS_COA" -gt 0 ]; then
        echo "  Response has all templates: products, contacts, chart-of-accounts"
        print_result "PASS" "Admin -> 200 with all templates"
    else
        print_result "FAIL" "Admin -> 200 but missing templates"
    fi
else
    print_result "FAIL" "Admin -> $CODE (expected 200)"
fi

# T2: POST /api/import/products - Insert, Update, Error Handling
print_test "TEST T2: POST /api/import/products - Insert, Update, Error Handling"

# T2a: Insert new product
echo ""
echo "[T2a] Inserting new product..."
RESP=$(curl -s -w "\n%{http_code}" -b "$COOKIE_FILE" -X POST \
    "$BASE_URL/import/products" \
    -H "Origin: $ORIGIN" \
    -H "Content-Type: application/json" \
    -d '{"rows":[{"SKU":"IMP-TEST-1","Nama":"Produk Uji","Satuan":"kg","Harga Jual":25000,"Kategori":"FG"}]}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)

if [ "$CODE" = "200" ]; then
    CREATED=$(echo "$BODY" | grep -o '"created":[0-9]*' | grep -o '[0-9]*')
    UPDATED=$(echo "$BODY" | grep -o '"updated":[0-9]*' | grep -o '[0-9]*')
    echo "  Created: $CREATED, Updated: $UPDATED"
    
    if [ "$CREATED" = "1" ] && [ "$UPDATED" = "0" ]; then
        print_result "PASS" "Product created (created=1, updated=0)"
        
        # Verify via GET /api/products
        echo "  Verifying product via GET /api/products..."
        PROD_RESP=$(curl -s -b "$COOKIE_FILE" -X GET "$BASE_URL/products" -H "Origin: $ORIGIN")
        if echo "$PROD_RESP" | grep -q '"sku":"IMP-TEST-1"'; then
            PRICE=$(echo "$PROD_RESP" | grep -o '"sku":"IMP-TEST-1"[^}]*"basePrice":[0-9]*' | grep -o '"basePrice":[0-9]*' | grep -o '[0-9]*')
            echo "  Found product: SKU=IMP-TEST-1, basePrice=$PRICE"
            if [ "$PRICE" = "25000" ]; then
                print_result "PASS" "Product basePrice = 25000"
            else
                print_result "FAIL" "Product basePrice = $PRICE (expected 25000)"
            fi
        else
            print_result "FAIL" "Product not found in GET /api/products"
        fi
    else
        print_result "FAIL" "Product created (created=$CREATED, updated=$UPDATED, expected created=1, updated=0)"
    fi
else
    print_result "FAIL" "Insert failed: $CODE - $BODY"
fi

# T2b: Update existing product (upsert)
echo ""
echo "[T2b] Updating existing product (same SKU, different price)..."
RESP=$(curl -s -w "\n%{http_code}" -b "$COOKIE_FILE" -X POST \
    "$BASE_URL/import/products" \
    -H "Origin: $ORIGIN" \
    -H "Content-Type: application/json" \
    -d '{"rows":[{"SKU":"IMP-TEST-1","Nama":"Produk Uji Updated","Satuan":"kg","Harga Jual":30000,"Kategori":"FG"}]}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)

if [ "$CODE" = "200" ]; then
    CREATED=$(echo "$BODY" | grep -o '"created":[0-9]*' | grep -o '[0-9]*')
    UPDATED=$(echo "$BODY" | grep -o '"updated":[0-9]*' | grep -o '[0-9]*')
    echo "  Created: $CREATED, Updated: $UPDATED"
    
    if [ "$CREATED" = "0" ] && [ "$UPDATED" = "1" ]; then
        print_result "PASS" "Product updated (created=0, updated=1)"
        
        # Verify updated price
        echo "  Verifying updated price via GET /api/products..."
        PROD_RESP=$(curl -s -b "$COOKIE_FILE" -X GET "$BASE_URL/products" -H "Origin: $ORIGIN")
        PRICE=$(echo "$PROD_RESP" | grep -o '"sku":"IMP-TEST-1"[^}]*"basePrice":[0-9]*' | grep -o '"basePrice":[0-9]*' | grep -o '[0-9]*')
        echo "  Found product: SKU=IMP-TEST-1, basePrice=$PRICE"
        
        if [ "$PRICE" = "30000" ]; then
            print_result "PASS" "Product basePrice updated to 30000"
            
            # Check for duplicates
            COUNT=$(echo "$PROD_RESP" | grep -o '"sku":"IMP-TEST-1"' | wc -l)
            if [ "$COUNT" = "1" ]; then
                print_result "PASS" "Only ONE product with SKU IMP-TEST-1 (upsert, not duplicated)"
            else
                print_result "FAIL" "Found $COUNT products with SKU IMP-TEST-1 (expected 1)"
            fi
        else
            print_result "FAIL" "Product basePrice = $PRICE (expected 30000)"
        fi
    else
        print_result "FAIL" "Product updated (created=$CREATED, updated=$UPDATED, expected created=0, updated=1)"
    fi
else
    print_result "FAIL" "Update failed: $CODE - $BODY"
fi

# T2c: Error handling - missing SKU
echo ""
echo "[T2c] Testing error handling (missing SKU)..."
RESP=$(curl -s -w "\n%{http_code}" -b "$COOKIE_FILE" -X POST \
    "$BASE_URL/import/products" \
    -H "Origin: $ORIGIN" \
    -H "Content-Type: application/json" \
    -d '{"rows":[{"Nama":"Tanpa SKU","Satuan":"kg","Harga Jual":10000}]}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)

if [ "$CODE" = "200" ]; then
    CREATED=$(echo "$BODY" | grep -o '"created":[0-9]*' | grep -o '[0-9]*')
    HAS_ERROR=$(echo "$BODY" | grep -o '"errors":\[' | wc -l)
    echo "  Created: $CREATED, Has errors: $HAS_ERROR"
    
    if [ "$CREATED" = "0" ] && [ "$HAS_ERROR" -gt 0 ]; then
        if echo "$BODY" | grep -q "SKU"; then
            print_result "PASS" "Missing SKU error captured"
        else
            print_result "FAIL" "Error captured but doesn't mention SKU"
        fi
    else
        print_result "FAIL" "Error handling (created=$CREATED, has_error=$HAS_ERROR)"
    fi
else
    print_result "FAIL" "Error test failed: $CODE - $BODY"
fi

# T3: POST /api/import/contacts - Insert, Update, Type Alias
print_test "TEST T3: POST /api/import/contacts - Insert, Update, Type Alias"

# T3a: Insert new contact
echo ""
echo "[T3a] Inserting new contact..."
RESP=$(curl -s -w "\n%{http_code}" -b "$COOKIE_FILE" -X POST \
    "$BASE_URL/import/contacts" \
    -H "Origin: $ORIGIN" \
    -H "Content-Type: application/json" \
    -d '{"rows":[{"Nama":"IMP TEST Pelanggan","Tipe":"Customer","Telepon":"0812","Kota":"Jakarta"}]}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)

if [ "$CODE" = "200" ]; then
    CREATED=$(echo "$BODY" | grep -o '"created":[0-9]*' | grep -o '[0-9]*')
    UPDATED=$(echo "$BODY" | grep -o '"updated":[0-9]*' | grep -o '[0-9]*')
    echo "  Created: $CREATED, Updated: $UPDATED"
    
    if [ "$CREATED" = "1" ] && [ "$UPDATED" = "0" ]; then
        print_result "PASS" "Contact created (created=1, updated=0)"
        
        # Verify via GET /api/contacts
        echo "  Verifying contact via GET /api/contacts..."
        CONT_RESP=$(curl -s -b "$COOKIE_FILE" -X GET "$BASE_URL/contacts" -H "Origin: $ORIGIN")
        if echo "$CONT_RESP" | grep -q '"displayName":"IMP TEST Pelanggan"'; then
            TYPE=$(echo "$CONT_RESP" | grep -o '"displayName":"IMP TEST Pelanggan"[^}]*"contactType":"[^"]*"' | grep -o '"contactType":"[^"]*"' | cut -d'"' -f4)
            CODE_VAL=$(echo "$CONT_RESP" | grep -o '"displayName":"IMP TEST Pelanggan"[^}]*"code":"[^"]*"' | grep -o '"code":"[^"]*"' | cut -d'"' -f4)
            echo "  Found contact: displayName=IMP TEST Pelanggan, contactType=$TYPE, code=$CODE_VAL"
            
            if [ "$TYPE" = "Customer" ]; then
                print_result "PASS" "Contact contactType = Customer"
            else
                print_result "FAIL" "Contact contactType = $TYPE (expected Customer)"
            fi
            
            if [ -n "$CODE_VAL" ]; then
                print_result "PASS" "Auto-generated code: $CODE_VAL"
            else
                print_result "FAIL" "No auto-generated code"
            fi
        else
            print_result "FAIL" "Contact not found in GET /api/contacts"
        fi
    else
        print_result "FAIL" "Contact created (created=$CREATED, updated=$UPDATED, expected created=1, updated=0)"
    fi
else
    print_result "FAIL" "Insert failed: $CODE - $BODY"
fi

# T3b: Update existing contact (same Nama+Tipe)
echo ""
echo "[T3b] Updating existing contact (same Nama+Tipe)..."
RESP=$(curl -s -w "\n%{http_code}" -b "$COOKIE_FILE" -X POST \
    "$BASE_URL/import/contacts" \
    -H "Origin: $ORIGIN" \
    -H "Content-Type: application/json" \
    -d '{"rows":[{"Nama":"IMP TEST Pelanggan","Tipe":"Customer","Telepon":"0813","Kota":"Bandung"}]}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)

if [ "$CODE" = "200" ]; then
    CREATED=$(echo "$BODY" | grep -o '"created":[0-9]*' | grep -o '[0-9]*')
    UPDATED=$(echo "$BODY" | grep -o '"updated":[0-9]*' | grep -o '[0-9]*')
    echo "  Created: $CREATED, Updated: $UPDATED"
    
    if [ "$CREATED" = "0" ] && [ "$UPDATED" = "1" ]; then
        print_result "PASS" "Contact updated (created=0, updated=1)"
        
        # Verify only one contact exists
        echo "  Verifying no duplicate contacts..."
        CONT_RESP=$(curl -s -b "$COOKIE_FILE" -X GET "$BASE_URL/contacts" -H "Origin: $ORIGIN")
        COUNT=$(echo "$CONT_RESP" | grep -o '"displayName":"IMP TEST Pelanggan"' | wc -l)
        
        if [ "$COUNT" = "1" ]; then
            print_result "PASS" "Only ONE contact with name 'IMP TEST Pelanggan' (upsert, not duplicated)"
        else
            print_result "FAIL" "Found $COUNT contacts (expected 1)"
        fi
    else
        print_result "FAIL" "Contact updated (created=$CREATED, updated=$UPDATED, expected created=0, updated=1)"
    fi
else
    print_result "FAIL" "Update failed: $CODE - $BODY"
fi

# T3c: Test type alias (Pemasok -> Supplier)
echo ""
echo "[T3c] Testing type alias (Pemasok -> Supplier)..."
RESP=$(curl -s -w "\n%{http_code}" -b "$COOKIE_FILE" -X POST \
    "$BASE_URL/import/contacts" \
    -H "Origin: $ORIGIN" \
    -H "Content-Type: application/json" \
    -d '{"rows":[{"Nama":"IMP TEST Pemasok","Tipe":"Pemasok"}]}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)

if [ "$CODE" = "200" ]; then
    CREATED=$(echo "$BODY" | grep -o '"created":[0-9]*' | grep -o '[0-9]*')
    echo "  Created: $CREATED"
    
    if [ "$CREATED" = "1" ]; then
        print_result "PASS" "Contact created with alias (created=1)"
        
        # Verify contactType is 'Supplier' (not 'Pemasok')
        echo "  Verifying type alias mapping..."
        CONT_RESP=$(curl -s -b "$COOKIE_FILE" -X GET "$BASE_URL/contacts" -H "Origin: $ORIGIN")
        if echo "$CONT_RESP" | grep -q '"displayName":"IMP TEST Pemasok"'; then
            TYPE=$(echo "$CONT_RESP" | grep -o '"displayName":"IMP TEST Pemasok"[^}]*"contactType":"[^"]*"' | grep -o '"contactType":"[^"]*"' | cut -d'"' -f4)
            echo "  Found contact: displayName=IMP TEST Pemasok, contactType=$TYPE"
            
            if [ "$TYPE" = "Supplier" ]; then
                print_result "PASS" "Type alias 'Pemasok' mapped to 'Supplier'"
            else
                print_result "FAIL" "Type alias mapping failed: contactType=$TYPE (expected Supplier)"
            fi
        else
            print_result "FAIL" "Contact not found in GET /api/contacts"
        fi
    else
        print_result "FAIL" "Contact created with alias (created=$CREATED, expected 1)"
    fi
else
    print_result "FAIL" "Alias test failed: $CODE - $BODY"
fi

# T4: POST /api/import/chart-of-accounts - Insert, Update, Error Handling
print_test "TEST T4: POST /api/import/chart-of-accounts - Insert, Update, Error Handling"

# T4a: Insert new account
echo ""
echo "[T4a] Inserting new account..."
RESP=$(curl -s -w "\n%{http_code}" -b "$COOKIE_FILE" -X POST \
    "$BASE_URL/import/chart-of-accounts" \
    -H "Origin: $ORIGIN" \
    -H "Content-Type: application/json" \
    -d '{"rows":[{"Kode Akun":"9-9001","Nama Akun":"Akun Uji Impor","Tipe":"expense","Saldo Normal":"debit","Saldo Awal":0}]}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)

if [ "$CODE" = "200" ]; then
    CREATED=$(echo "$BODY" | grep -o '"created":[0-9]*' | grep -o '[0-9]*')
    UPDATED=$(echo "$BODY" | grep -o '"updated":[0-9]*' | grep -o '[0-9]*')
    echo "  Created: $CREATED, Updated: $UPDATED"
    
    if [ "$CREATED" = "1" ] && [ "$UPDATED" = "0" ]; then
        print_result "PASS" "Account created (created=1, updated=0)"
        
        # Verify via direct SQLite query
        echo "  Verifying account via SQLite query..."
        ACCT=$(sqlite3 /app/data/erp.db "SELECT code, name, type, normal_balance FROM gl_accounts WHERE code = '9-9001'")
        if [ -n "$ACCT" ]; then
            echo "  Found account: $ACCT"
            if echo "$ACCT" | grep -q "expense"; then
                print_result "PASS" "Account type = expense"
            else
                print_result "FAIL" "Account type mismatch"
            fi
            if echo "$ACCT" | grep -q "debit"; then
                print_result "PASS" "Account normal_balance = debit"
            else
                print_result "FAIL" "Account normal_balance mismatch"
            fi
        else
            print_result "FAIL" "Account not found in gl_accounts"
        fi
    else
        print_result "FAIL" "Account created (created=$CREATED, updated=$UPDATED, expected created=1, updated=0)"
    fi
else
    print_result "FAIL" "Insert failed: $CODE - $BODY"
fi

# T4b: Update existing account
echo ""
echo "[T4b] Updating existing account (same code, different name)..."
RESP=$(curl -s -w "\n%{http_code}" -b "$COOKIE_FILE" -X POST \
    "$BASE_URL/import/chart-of-accounts" \
    -H "Origin: $ORIGIN" \
    -H "Content-Type: application/json" \
    -d '{"rows":[{"Kode Akun":"9-9001","Nama Akun":"Akun Uji 2","Tipe":"expense","Saldo Normal":"debit","Saldo Awal":0}]}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)

if [ "$CODE" = "200" ]; then
    CREATED=$(echo "$BODY" | grep -o '"created":[0-9]*' | grep -o '[0-9]*')
    UPDATED=$(echo "$BODY" | grep -o '"updated":[0-9]*' | grep -o '[0-9]*')
    echo "  Created: $CREATED, Updated: $UPDATED"
    
    if [ "$CREATED" = "0" ] && [ "$UPDATED" = "1" ]; then
        print_result "PASS" "Account updated (created=0, updated=1)"
        
        # Verify updated name
        echo "  Verifying updated name via SQLite query..."
        NAME=$(sqlite3 /app/data/erp.db "SELECT name FROM gl_accounts WHERE code = '9-9001'")
        echo "  Account name: $NAME"
        
        if [ "$NAME" = "Akun Uji 2" ]; then
            print_result "PASS" "Account name updated to 'Akun Uji 2'"
        else
            print_result "FAIL" "Account name = '$NAME' (expected 'Akun Uji 2')"
        fi
    else
        print_result "FAIL" "Account updated (created=$CREATED, updated=$UPDATED, expected created=0, updated=1)"
    fi
else
    print_result "FAIL" "Update failed: $CODE - $BODY"
fi

# T4c: Error handling - invalid type
echo ""
echo "[T4c] Testing error handling (invalid type)..."
RESP=$(curl -s -w "\n%{http_code}" -b "$COOKIE_FILE" -X POST \
    "$BASE_URL/import/chart-of-accounts" \
    -H "Origin: $ORIGIN" \
    -H "Content-Type: application/json" \
    -d '{"rows":[{"Kode Akun":"9-9002","Nama Akun":"X","Tipe":"xyz","Saldo Normal":"debit"}]}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)

if [ "$CODE" = "200" ]; then
    CREATED=$(echo "$BODY" | grep -o '"created":[0-9]*' | grep -o '[0-9]*')
    HAS_ERROR=$(echo "$BODY" | grep -o '"errors":\[' | wc -l)
    echo "  Created: $CREATED, Has errors: $HAS_ERROR"
    
    if [ "$CREATED" = "0" ] && [ "$HAS_ERROR" -gt 0 ]; then
        if echo "$BODY" | grep -qi "tidak valid"; then
            print_result "PASS" "Invalid type error captured"
        else
            print_result "FAIL" "Error captured but doesn't mention invalid type"
        fi
    else
        print_result "FAIL" "Error handling (created=$CREATED, has_error=$HAS_ERROR)"
    fi
else
    print_result "FAIL" "Error test failed: $CODE - $BODY"
fi

# T5: POST /api/import/foo - Unknown Module
print_test "TEST T5: POST /api/import/foo - Unknown Module"

RESP=$(curl -s -w "\n%{http_code}" -b "$COOKIE_FILE" -X POST \
    "$BASE_URL/import/foo" \
    -H "Origin: $ORIGIN" \
    -H "Content-Type: application/json" \
    -d '{"rows":[{"a":1}]}')
CODE=$(echo "$RESP" | tail -1)

if [ "$CODE" = "404" ]; then
    print_result "PASS" "Unknown module -> $CODE (expected 404)"
else
    print_result "FAIL" "Unknown module -> $CODE (expected 404)"
fi

# CLEANUP
print_test "CLEANUP: Removing all test data"

echo ""
echo "[1] Getting test products and contacts..."

# Get and delete products
PROD_RESP=$(curl -s -b "$COOKIE_FILE" -X GET "$BASE_URL/products" -H "Origin: $ORIGIN")
PROD_IDS=$(echo "$PROD_RESP" | grep -o '"sku":"IMP-TEST-[^"]*"[^}]*"id":"[^"]*"' | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -n "$PROD_IDS" ]; then
    echo "  Found test products to delete"
    for ID in $PROD_IDS; do
        echo "  Deleting product ID: $ID"
        curl -s -b "$COOKIE_FILE" -X DELETE "$BASE_URL/products/$ID" -H "Origin: $ORIGIN" > /dev/null
    done
fi

# Get and delete contacts
CONT_RESP=$(curl -s -b "$COOKIE_FILE" -X GET "$BASE_URL/contacts" -H "Origin: $ORIGIN")
CONT_IDS=$(echo "$CONT_RESP" | grep -o '"displayName":"IMP TEST [^"]*"[^}]*"id":"[^"]*"' | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -n "$CONT_IDS" ]; then
    echo "  Found test contacts to delete"
    for ID in $CONT_IDS; do
        echo "  Deleting contact ID: $ID"
        curl -s -b "$COOKIE_FILE" -X DELETE "$BASE_URL/contacts/$ID" -H "Origin: $ORIGIN" > /dev/null
    done
fi

# Delete test accounts from gl_accounts
echo ""
echo "[2] Deleting test accounts from gl_accounts..."
sqlite3 /app/data/erp.db "DELETE FROM gl_accounts WHERE code IN ('9-9001', '9-9002')"
echo "  ✅ Deleted test accounts from SQLite"

# Verify cleanup
echo ""
echo "[3] Verifying cleanup..."

# Verify products
PROD_RESP=$(curl -s -b "$COOKIE_FILE" -X GET "$BASE_URL/products" -H "Origin: $ORIGIN")
PROD_COUNT=$(echo "$PROD_RESP" | grep -o '"sku":"IMP-TEST-' | wc -l)
if [ "$PROD_COUNT" = "0" ]; then
    echo -e "${GREEN}✅ VERIFIED${NC}: No test products remaining"
else
    echo -e "${RED}❌ FAILED${NC}: Found $PROD_COUNT test products remaining"
fi

# Verify contacts
CONT_RESP=$(curl -s -b "$COOKIE_FILE" -X GET "$BASE_URL/contacts" -H "Origin: $ORIGIN")
CONT_COUNT=$(echo "$CONT_RESP" | grep -o '"displayName":"IMP TEST ' | wc -l)
if [ "$CONT_COUNT" = "0" ]; then
    echo -e "${GREEN}✅ VERIFIED${NC}: No test contacts remaining"
else
    echo -e "${RED}❌ FAILED${NC}: Found $CONT_COUNT test contacts remaining"
fi

# Verify accounts
ACCT_COUNT=$(sqlite3 /app/data/erp.db "SELECT COUNT(*) FROM gl_accounts WHERE code IN ('9-9001', '9-9002')")
if [ "$ACCT_COUNT" = "0" ]; then
    echo -e "${GREEN}✅ VERIFIED${NC}: No test accounts remaining"
else
    echo -e "${RED}❌ FAILED${NC}: Found $ACCT_COUNT test accounts remaining"
fi

# Summary
print_test "TEST SUMMARY"

TOTAL=$((PASSED + FAILED))
PERCENT=$((PASSED * 100 / TOTAL))

echo ""
echo "Total: $PASSED/$TOTAL tests passed ($PERCENT%)"
echo ""

if [ "$FAILED" = "0" ]; then
    echo -e "${GREEN}🎉 ALL TESTS PASSED!${NC}"
    exit 0
else
    echo -e "${YELLOW}⚠️ $FAILED test(s) failed${NC}"
    exit 1
fi
