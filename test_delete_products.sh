#!/bin/bash
set +e

echo "================================================================================"
echo "BACKEND TEST: DELETE /api/products/:id BUGFIX"
echo "Testing fix for SQLITE_CONSTRAINT_FOREIGNKEY (500 → 409)"
echo "================================================================================"

BASE_URL="http://localhost:3000/api"
COOKIES="/tmp/test_cookies.txt"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass_count=0
fail_count=0

print_test() {
    echo ""
    echo "================================================================================"
    echo "TEST: $1"
    echo "================================================================================"
}

print_pass() {
    echo -e "${GREEN}✅ PASSED${NC}: $1"
    ((pass_count++))
}

print_fail() {
    echo -e "${RED}❌ FAILED${NC}: $1"
    ((fail_count++))
}

# Login as admin
print_test "Login as Admin"
echo "Logging in as admin@lpi.co.id..."
response=$(curl -c $COOKIES -X POST $BASE_URL/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}' \
  -s -w "\n%{http_code}")

status_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$status_code" = "200" ]; then
    print_pass "Admin login successful (status: $status_code)"
    user_email=$(echo "$body" | jq -r '.user.email')
    user_role=$(echo "$body" | jq -r '.user.role')
    echo "User: $user_email (role: $user_role)"
else
    print_fail "Login failed with status $status_code"
    echo "Response: $body"
    exit 1
fi

# Test /me endpoint to verify session
echo ""
echo "Verifying session with /me endpoint..."
me_response=$(curl -b $COOKIES $BASE_URL/me -s -w "\n%{http_code}")
me_status=$(echo "$me_response" | tail -n1)

if [ "$me_status" = "200" ]; then
    print_pass "Session verified (status: $me_status)"
else
    print_fail "Session verification failed (status: $me_status)"
    exit 1
fi

# ============================================================================
# SCENARIO A: Delete unused product (expect 200)
# ============================================================================
print_test "SCENARIO A: Delete Unused Product (Expect 200)"

echo ""
echo "Step 1: Creating new test product..."
create_response=$(curl -b $COOKIES -X POST $BASE_URL/products \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "TST-DEL-01",
    "name": "Produk Uji Hapus",
    "category": "Karkas",
    "unit": "kg",
    "packagingType": "colly",
    "basePrice": 1000
  }' \
  -s -w "\n%{http_code}")

create_status=$(echo "$create_response" | tail -n1)
create_body=$(echo "$create_response" | head -n-1)

if [ "$create_status" = "201" ]; then
    product_id=$(echo "$create_body" | jq -r '.data.id')
    product_name=$(echo "$create_body" | jq -r '.data.name')
    print_pass "Product created: $product_name (ID: $product_id)"
else
    print_fail "Failed to create product (status: $create_status)"
    echo "Response: $create_body"
    exit 1
fi

echo ""
echo "Step 2: Deleting product $product_id..."
delete_response=$(curl -b $COOKIES -X DELETE $BASE_URL/products/$product_id \
  -s -w "\n%{http_code}")

delete_status=$(echo "$delete_response" | tail -n1)
delete_body=$(echo "$delete_response" | head -n-1)

echo "Delete response status: $delete_status"
echo "Delete response body: $delete_body"

if [ "$delete_status" = "200" ]; then
    ok_value=$(echo "$delete_body" | jq -r '.ok')
    if [ "$ok_value" = "true" ]; then
        print_pass "Product deleted successfully with 200 OK and {ok: true}"
    else
        print_fail "Expected {ok: true}, got: $delete_body"
    fi
else
    print_fail "Expected 200, got $delete_status"
fi

echo ""
echo "Step 3: Verifying product is deleted..."
search_response=$(curl -b $COOKIES "$BASE_URL/products?q=TST-DEL-01" -s -w "\n%{http_code}")
search_status=$(echo "$search_response" | tail -n1)
search_body=$(echo "$search_response" | head -n-1)

if [ "$search_status" = "200" ]; then
    found=$(echo "$search_body" | jq '.data[] | select(.sku == "TST-DEL-01") | .sku' | wc -l)
    if [ "$found" = "0" ]; then
        print_pass "Product TST-DEL-01 not found in search results (correctly deleted)"
    else
        print_fail "Product TST-DEL-01 still exists after deletion"
    fi
else
    print_fail "Failed to search products (status: $search_status)"
fi

# ============================================================================
# SCENARIO B: Delete referenced product (expect 409, NOT 500)
# ============================================================================
print_test "SCENARIO B: Delete Referenced Product (Expect 409, NOT 500)"

echo ""
echo "Step 1: Finding a product with inventory stock..."
stocks_response=$(curl -b $COOKIES "$BASE_URL/inventory/stocks?status=all" -s -w "\n%{http_code}")
stocks_status=$(echo "$stocks_response" | tail -n1)
stocks_body=$(echo "$stocks_response" | head -n-1)

if [ "$stocks_status" = "200" ]; then
    stock_count=$(echo "$stocks_body" | jq '.data | length')
    if [ "$stock_count" -gt "0" ]; then
        referenced_product_id=$(echo "$stocks_body" | jq -r '.data[0].productId')
        product_name=$(echo "$stocks_body" | jq -r '.data[0].productName')
        print_pass "Found referenced product: $product_name (ID: $referenced_product_id)"
    else
        print_fail "No inventory stocks found. Cannot test referenced product deletion."
        exit 1
    fi
else
    print_fail "Failed to get inventory stocks (status: $stocks_status)"
    exit 1
fi

echo ""
echo "Step 2: Attempting to delete referenced product $referenced_product_id..."
delete_ref_response=$(curl -b $COOKIES -X DELETE $BASE_URL/products/$referenced_product_id \
  -s -w "\n%{http_code}")

delete_ref_status=$(echo "$delete_ref_response" | tail -n1)
delete_ref_body=$(echo "$delete_ref_response" | head -n-1)

echo "Delete response status: $delete_ref_status"
echo "Delete response body: $delete_ref_body"

# CRITICAL: Must be 409, NOT 500
if [ "$delete_ref_status" = "409" ]; then
    print_pass "Correctly returned 409 Conflict (NOT 500)"
    
    # Check error message
    error_message=$(echo "$delete_ref_body" | jq -r '.error')
    
    # Verify Indonesian message contains "sudah dipakai di transaksi"
    if echo "$error_message" | grep -qi "sudah dipakai di transaksi"; then
        print_pass "Error message contains 'sudah dipakai di transaksi'"
    else
        print_fail "Error message missing expected Indonesian text"
        echo "Actual message: $error_message"
    fi
    
    # Verify it suggests setting status Inactive
    if echo "$error_message" | grep -qi "inactive"; then
        print_pass "Error message suggests setting status Inactive"
    else
        print_fail "Error message doesn't suggest Inactive status"
    fi
    
    echo ""
    echo "📝 Full error message: $error_message"
    
elif [ "$delete_ref_status" = "500" ]; then
    print_fail "❌ CRITICAL BUG: Got 500 error (should be 409)"
    echo "This is the bug that was supposed to be fixed!"
    echo "Response: $delete_ref_body"
else
    print_fail "Expected 409, got $delete_ref_status"
fi

echo ""
echo "Step 3: Verifying product still exists..."
get_ref_response=$(curl -b $COOKIES $BASE_URL/products/$referenced_product_id -s -w "\n%{http_code}")
get_ref_status=$(echo "$get_ref_response" | tail -n1)
get_ref_body=$(echo "$get_ref_response" | head -n-1)

if [ "$get_ref_status" = "200" ]; then
    product_name=$(echo "$get_ref_body" | jq -r '.data.name')
    print_pass "Product still exists: $product_name"
else
    print_fail "Product was deleted or not found (status: $get_ref_status)"
fi

# ============================================================================
# SCENARIO C: Auth guard (expect 401)
# ============================================================================
print_test "SCENARIO C: Auth Guard (Expect 401)"

echo ""
echo "Attempting to DELETE product without authentication..."
unauth_response=$(curl -X DELETE $BASE_URL/products/fake-product-id \
  -s -w "\n%{http_code}")

unauth_status=$(echo "$unauth_response" | tail -n1)
unauth_body=$(echo "$unauth_response" | head -n-1)

echo "Delete response status: $unauth_status"
echo "Delete response body: $unauth_body"

if [ "$unauth_status" = "401" ]; then
    print_pass "Correctly returned 401 Unauthorized"
else
    print_fail "Expected 401, got $unauth_status"
fi

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo "================================================================================"
echo "TEST SUMMARY"
echo "================================================================================"

total=$((pass_count + fail_count))
echo "Total: $pass_count/$total tests passed"

if [ $fail_count -eq 0 ]; then
    echo -e "\n${GREEN}🎉 ALL TESTS PASSED! Bugfix verified successfully.${NC}"
    exit 0
else
    echo -e "\n${YELLOW}⚠️  $fail_count test(s) failed. Review the output above.${NC}"
    exit 1
fi
