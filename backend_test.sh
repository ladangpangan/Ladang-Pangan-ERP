#!/bin/bash
# Backend test for interactive-order-builder feature using curl

BASE_URL="http://localhost:3000/api"
COOKIE_FILE="/tmp/test_cookies.txt"
ADMIN_EMAIL="admin@lpi.co.id"
ADMIN_PASSWORD="admin123"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "================================================================================"
echo "BACKEND TEST: Interactive Order Builder Feature"
echo "================================================================================"

# Test counter
PASSED=0
FAILED=0

print_test() {
    local test_name="$1"
    local status="$2"
    local details="$3"
    
    if [ "$status" = "PASS" ]; then
        echo -e "\n${GREEN}✅ PASSED${NC}: $test_name"
        PASSED=$((PASSED + 1))
    else
        echo -e "\n${RED}❌ FAILED${NC}: $test_name"
        FAILED=$((FAILED + 1))
    fi
    
    if [ -n "$details" ]; then
        echo "  Details: $details"
    fi
}

# Login
echo -e "\n--- AUTHENTICATION ---"
LOGIN_RESPONSE=$(curl -s -c "$COOKIE_FILE" -X POST "$BASE_URL/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")

if echo "$LOGIN_RESPONSE" | grep -q '"user"'; then
    echo "✅ Login successful for $ADMIN_EMAIL"
else
    echo "❌ Login failed"
    exit 1
fi

echo -e "\n--- RUNNING TESTS ---"

# TEST 1: GET /api/ai/options (authenticated)
echo -e "\nTEST 1: GET /api/ai/options (authenticated)"
RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/ai/options")
STATUS_CODE=$(curl -s -b "$COOKIE_FILE" -o /dev/null -w "%{http_code}" "$BASE_URL/ai/options")

if [ "$STATUS_CODE" = "200" ]; then
    if echo "$RESPONSE" | grep -q '"ok":true'; then
        # Check for required arrays
        CUSTOMERS_COUNT=$(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(len(data.get('customers', [])))")
        SUPPLIERS_COUNT=$(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(len(data.get('suppliers', [])))")
        PRODUCTS_COUNT=$(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(len(data.get('products', [])))")
        POTYPES_COUNT=$(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(len(data.get('poTypes', [])))")
        FULFILLMENT_COUNT=$(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(len(data.get('fulfillmentTypes', [])))")
        
        DETAILS="customers: $CUSTOMERS_COUNT, suppliers: $SUPPLIERS_COUNT, products: $PRODUCTS_COUNT, poTypes: $POTYPES_COUNT, fulfillmentTypes: $FULFILLMENT_COUNT"
        
        # Note if arrays are empty
        if [ "$CUSTOMERS_COUNT" = "0" ]; then
            DETAILS="$DETAILS | NOTE: customers array is empty"
        fi
        if [ "$SUPPLIERS_COUNT" = "0" ]; then
            DETAILS="$DETAILS | NOTE: suppliers array is empty"
        fi
        if [ "$PRODUCTS_COUNT" = "0" ]; then
            DETAILS="$DETAILS | NOTE: products array is empty"
        fi
        
        print_test "TEST 1: GET /api/ai/options (authenticated)" "PASS" "$DETAILS"
    else
        print_test "TEST 1: GET /api/ai/options (authenticated)" "FAIL" "Response missing 'ok: true'"
    fi
else
    print_test "TEST 1: GET /api/ai/options (authenticated)" "FAIL" "Expected 200, got $STATUS_CODE"
fi

# TEST 2: GET /api/ai/options (unauthenticated)
echo -e "\nTEST 2: GET /api/ai/options (unauthenticated)"
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/ai/options")

if [ "$STATUS_CODE" = "401" ]; then
    print_test "TEST 2: GET /api/ai/options (unauthenticated)" "PASS" "Correctly returned 401 Unauthorized"
else
    print_test "TEST 2: GET /api/ai/options (unauthenticated)" "FAIL" "Expected 401, got $STATUS_CODE"
fi

# TEST 3: POST /api/ai/chat (sales order)
echo -e "\nTEST 3: POST /api/ai/chat (sales order) - LLM call, may take up to 90s"
RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/ai/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"Saya mau membuat sales order baru","sessionId":"ob1","history":[]}' \
  --max-time 90)

STATUS_CODE=$(curl -s -b "$COOKIE_FILE" -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/ai/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"Saya mau membuat sales order baru","sessionId":"ob1","history":[]}' \
  --max-time 90)

if [ "$STATUS_CODE" = "200" ]; then
    if echo "$RESPONSE" | grep -q '"ok":true'; then
        # Check uiComponents
        UI_TYPE=$(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); ui=data.get('uiComponents',[]); print(ui[0].get('type','') if len(ui)>0 else '')" 2>/dev/null)
        ORDER_TYPE=$(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); ui=data.get('uiComponents',[]); print(ui[0].get('orderType','null') if len(ui)>0 else '')" 2>/dev/null)
        ANSWER_LEN=$(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(len(data.get('answer','')))" 2>/dev/null)
        
        if [ "$UI_TYPE" = "order_builder" ]; then
            if [ "$ANSWER_LEN" -gt "0" ]; then
                print_test "TEST 3: POST /api/ai/chat (sales order)" "PASS" "uiComponents[0].type='order_builder', orderType=$ORDER_TYPE, answer length=$ANSWER_LEN"
            else
                print_test "TEST 3: POST /api/ai/chat (sales order)" "FAIL" "answer should be non-empty string"
            fi
        else
            print_test "TEST 3: POST /api/ai/chat (sales order)" "FAIL" "Expected uiComponents[0].type='order_builder', got '$UI_TYPE'"
        fi
    else
        print_test "TEST 3: POST /api/ai/chat (sales order)" "FAIL" "Response missing 'ok: true'"
    fi
else
    print_test "TEST 3: POST /api/ai/chat (sales order)" "FAIL" "Expected 200, got $STATUS_CODE"
fi

# TEST 4: POST /api/ai/chat (purchase order)
echo -e "\nTEST 4: POST /api/ai/chat (purchase order) - LLM call, may take up to 90s"
RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/ai/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"Buat purchase order","sessionId":"ob2","history":[]}' \
  --max-time 90)

STATUS_CODE=$(curl -s -b "$COOKIE_FILE" -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/ai/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"Buat purchase order","sessionId":"ob2","history":[]}' \
  --max-time 90)

if [ "$STATUS_CODE" = "200" ]; then
    if echo "$RESPONSE" | grep -q '"ok":true'; then
        # Check uiComponents
        UI_TYPE=$(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); ui=data.get('uiComponents',[]); print(ui[0].get('type','') if len(ui)>0 else '')" 2>/dev/null)
        ORDER_TYPE=$(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); ui=data.get('uiComponents',[]); print(ui[0].get('orderType','null') if len(ui)>0 else '')" 2>/dev/null)
        
        if [ "$UI_TYPE" = "order_builder" ]; then
            print_test "TEST 4: POST /api/ai/chat (purchase order)" "PASS" "uiComponents[0].type='order_builder', orderType=$ORDER_TYPE"
        else
            print_test "TEST 4: POST /api/ai/chat (purchase order)" "FAIL" "Expected uiComponents[0].type='order_builder', got '$UI_TYPE'"
        fi
    else
        print_test "TEST 4: POST /api/ai/chat (purchase order)" "FAIL" "Response missing 'ok: true'"
    fi
else
    print_test "TEST 4: POST /api/ai/chat (purchase order)" "FAIL" "Expected 200, got $STATUS_CODE"
fi

# TEST 5: Existing order endpoints
echo -e "\nTEST 5: Existing order endpoints"

# Get contacts
CONTACTS=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/contacts")
CUSTOMER_ID=$(echo "$CONTACTS" | python3 -c "import sys, json; data=json.load(sys.stdin); contacts=data.get('data',[]); print(next((c['id'] for c in contacts if 'Customer' in c.get('categories',[])), ''))" 2>/dev/null)
SUPPLIER_ID=$(echo "$CONTACTS" | python3 -c "import sys, json; data=json.load(sys.stdin); contacts=data.get('data',[]); print(next((c['id'] for c in contacts if 'Supplier' in c.get('categories',[])), ''))" 2>/dev/null)

if [ -z "$CUSTOMER_ID" ] || [ -z "$SUPPLIER_ID" ]; then
    print_test "TEST 5: Existing order endpoints" "FAIL" "Could not find Customer or Supplier contact"
else
    # Get products
    PRODUCTS=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/products")
    PRODUCT_ID=$(echo "$PRODUCTS" | python3 -c "import sys, json; data=json.load(sys.stdin); products=data.get('data',[]); print(products[0]['id'] if len(products)>0 else '')" 2>/dev/null)
    
    if [ -z "$PRODUCT_ID" ]; then
        print_test "TEST 5: Existing order endpoints" "FAIL" "No products found"
    else
        # Create sales order
        SO_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/sales-orders" \
          -H "Content-Type: application/json" \
          -d "{\"customerId\":\"$CUSTOMER_ID\",\"fulfillmentType\":\"stock\",\"items\":[{\"productId\":\"$PRODUCT_ID\",\"weight\":10,\"quantity\":0,\"unitPrice\":30000,\"discount\":0}]}")
        
        SO_STATUS=$(curl -s -b "$COOKIE_FILE" -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/sales-orders" \
          -H "Content-Type: application/json" \
          -d "{\"customerId\":\"$CUSTOMER_ID\",\"fulfillmentType\":\"stock\",\"items\":[{\"productId\":\"$PRODUCT_ID\",\"weight\":10,\"quantity\":0,\"unitPrice\":30000,\"discount\":0}]}")
        
        if [ "$SO_STATUS" = "201" ]; then
            SO_NUMBER=$(echo "$SO_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('data',{}).get('soNumber',''))" 2>/dev/null)
            echo "  ✅ Created Sales Order: $SO_NUMBER"
            
            # Create purchase order
            PO_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/purchase-orders" \
              -H "Content-Type: application/json" \
              -d "{\"supplierId\":\"$SUPPLIER_ID\",\"poType\":\"Bahan Baku\",\"items\":[{\"productId\":\"$PRODUCT_ID\",\"weight\":10,\"unitPrice\":25000}]}")
            
            PO_STATUS=$(curl -s -b "$COOKIE_FILE" -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/purchase-orders" \
              -H "Content-Type: application/json" \
              -d "{\"supplierId\":\"$SUPPLIER_ID\",\"poType\":\"Bahan Baku\",\"items\":[{\"productId\":\"$PRODUCT_ID\",\"weight\":10,\"unitPrice\":25000}]}")
            
            if [ "$PO_STATUS" = "201" ]; then
                PO_NUMBER=$(echo "$PO_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('data',{}).get('poNumber',''))" 2>/dev/null)
                echo "  ✅ Created Purchase Order: $PO_NUMBER"
                
                print_test "TEST 5: Existing order endpoints" "PASS" "SO: $SO_NUMBER, PO: $PO_NUMBER (both remain as Draft)"
            else
                print_test "TEST 5: POST /api/purchase-orders" "FAIL" "Expected 201, got $PO_STATUS"
            fi
        else
            print_test "TEST 5: POST /api/sales-orders" "FAIL" "Expected 201, got $SO_STATUS"
        fi
    fi
fi

# Summary
echo ""
echo "================================================================================"
echo "TEST SUMMARY"
echo "================================================================================"
TOTAL=$((PASSED + FAILED))
PERCENTAGE=$((PASSED * 100 / TOTAL))
echo ""
echo "Total: $PASSED/$TOTAL tests passed ($PERCENTAGE%)"

if [ $PASSED -eq $TOTAL ]; then
    echo -e "\n${GREEN}✅ ALL TESTS PASSED${NC} - Interactive Order Builder feature is working correctly"
else
    echo -e "\n${RED}❌ $FAILED TEST(S) FAILED${NC} - See details above"
fi

echo "================================================================================"

# Cleanup
rm -f "$COOKIE_FILE"

exit $FAILED
