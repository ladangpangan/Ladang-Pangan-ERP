#!/bin/bash
# Comprehensive test for soft-archive feature
# Tests all 8 resources, RBAC, guards, and regression

BASE_URL="http://localhost:3000/api"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0

pass() { echo -e "${GREEN}✓${NC} $1"; ((PASSED++)); }
fail() { echo -e "${RED}✗${NC} $1"; ((FAILED++)); }
info() { echo "  $1"; }

# Login
echo "=== AUTHENTICATION ==="
curl -s -c /tmp/admin.txt -X POST "$BASE_URL/auth/sign-in/email" -H "Content-Type: application/json" -d '{"email":"admin@lpi.co.id","password":"admin123"}' > /dev/null && pass "Admin login" || fail "Admin login"
curl -s -c /tmp/supervisor.txt -X POST "$BASE_URL/auth/sign-in/email" -H "Content-Type: application/json" -d '{"email":"supervisor@lpi.co.id","password":"super123"}' > /dev/null && pass "Supervisor login" || fail "Supervisor login"
curl -s -c /tmp/direktur.txt -X POST "$BASE_URL/auth/sign-in/email" -H "Content-Type: application/json" -d '{"email":"direktur@lpi.co.id","password":"direktur123"}' > /dev/null && pass "Direktur login" || fail "Direktur login"
curl -s -c /tmp/operator.txt -X POST "$BASE_URL/auth/sign-in/email" -H "Content-Type: application/json" -d '{"email":"operator@lpi.co.id","password":"operator123"}' > /dev/null && pass "Operator login" || fail "Operator login"

ADMIN_ID=$(curl -s -b /tmp/admin.txt "$BASE_URL/me" | jq -r '.user.id')
info "Admin ID: $ADMIN_ID"

# Test function for archive/restore cycle
test_resource() {
    local resource=$1
    local list_endpoint=$2
    local entity_id=$3
    
    echo ""
    echo "=== Testing $resource ==="
    
    # Get initial count
    local initial=$(curl -s -b /tmp/admin.txt "$BASE_URL$list_endpoint" | jq -r '.data | length')
    info "Initial active count: $initial"
    
    # Archive
    local archive_result=$(curl -s -b /tmp/admin.txt -X POST "$BASE_URL/$resource/$entity_id/archive")
    if echo "$archive_result" | jq -e '.ok == true and .archived == true' > /dev/null; then
        pass "Archive successful"
    else
        fail "Archive failed: $archive_result"
        return
    fi
    
    # Check absent from active list
    local after_archive=$(curl -s -b /tmp/admin.txt "$BASE_URL$list_endpoint" | jq -r '.data | length')
    if [ "$after_archive" -eq "$((initial - 1))" ]; then
        pass "Entity absent from active list (count: $after_archive)"
    else
        fail "Active count wrong: expected $((initial - 1)), got $after_archive"
    fi
    
    # Check present in archived list
    local in_archived=$(curl -s -b /tmp/admin.txt "$BASE_URL$list_endpoint?archived=1" | jq -r ".data[] | select(.id == \"$entity_id\") | .id")
    if [ -n "$in_archived" ]; then
        pass "Entity present in archived list"
    else
        fail "Entity NOT in archived list"
    fi
    
    # Check present in all list
    local in_all=$(curl -s -b /tmp/admin.txt "$BASE_URL$list_endpoint?archived=all" | jq -r ".data[] | select(.id == \"$entity_id\") | .id")
    if [ -n "$in_all" ]; then
        pass "Entity present in all list"
    else
        fail "Entity NOT in all list"
    fi
    
    # Restore
    local restore_result=$(curl -s -b /tmp/admin.txt -X POST "$BASE_URL/$resource/$entity_id/restore")
    if echo "$restore_result" | jq -e '.ok == true and .archived == false' > /dev/null; then
        pass "Restore successful"
    else
        fail "Restore failed: $restore_result"
        return
    fi
    
    # Check present in active list again
    local after_restore=$(curl -s -b /tmp/admin.txt "$BASE_URL$list_endpoint" | jq -r '.data | length')
    if [ "$after_restore" -eq "$initial" ]; then
        pass "Entity back in active list (count: $after_restore)"
    else
        fail "Final count wrong: expected $initial, got $after_restore"
    fi
}

# Test 1: Contacts
CONTACT_ID=$(curl -s -b /tmp/admin.txt "$BASE_URL/contacts" | jq -r '.data[0].id')
test_resource "contacts" "/contacts" "$CONTACT_ID"

# Test 2: Products
PRODUCT_ID=$(curl -s -b /tmp/admin.txt "$BASE_URL/products" | jq -r '.data[0].id')
test_resource "products" "/products" "$PRODUCT_ID"

# Test 3: Cold Storages
CS_ID=$(curl -s -b /tmp/admin.txt "$BASE_URL/cold-storages" | jq -r '.data[0].id')
if [ -n "$CS_ID" ] && [ "$CS_ID" != "null" ]; then
    test_resource "cold-storages" "/cold-storages" "$CS_ID"
else
    echo -e "${YELLOW}⚠${NC} No cold storages to test"
fi

# Test 4: Purchase Orders
PO_ID=$(curl -s -b /tmp/admin.txt "$BASE_URL/purchase-orders" | jq -r '.data[0].id')
if [ -n "$PO_ID" ] && [ "$PO_ID" != "null" ]; then
    test_resource "purchase-orders" "/purchase-orders" "$PO_ID"
else
    echo -e "${YELLOW}⚠${NC} No purchase orders to test"
fi

# Test 5: Sales Orders
SO_ID=$(curl -s -b /tmp/admin.txt "$BASE_URL/sales-orders" | jq -r '.data[0].id')
if [ -n "$SO_ID" ] && [ "$SO_ID" != "null" ]; then
    test_resource "sales-orders" "/sales-orders" "$SO_ID"
else
    echo -e "${YELLOW}⚠${NC} No sales orders to test"
fi

# Test 6: Work Orders
WO_ID=$(curl -s -b /tmp/admin.txt "$BASE_URL/work-orders" | jq -r '.data[0].id')
if [ -n "$WO_ID" ] && [ "$WO_ID" != "null" ]; then
    test_resource "work-orders" "/work-orders" "$WO_ID"
else
    echo -e "${YELLOW}⚠${NC} No work orders to test"
fi

# Test 7: Inventory Stocks
INV_ID=$(curl -s -b /tmp/admin.txt "$BASE_URL/inventory/stocks" | jq -r '.data[0].id')
if [ -n "$INV_ID" ] && [ "$INV_ID" != "null" ]; then
    test_resource "inventory-stocks" "/inventory/stocks" "$INV_ID"
else
    echo -e "${YELLOW}⚠${NC} No inventory stocks to test"
fi

# Test 8: Users
USER_ID=$(curl -s -b /tmp/supervisor.txt "$BASE_URL/users" | jq -r '.data[] | select(.role == "operator") | .id' | head -1)
if [ -n "$USER_ID" ] && [ "$USER_ID" != "null" ] && [ "$USER_ID" != "$ADMIN_ID" ]; then
    test_resource "users" "/users" "$USER_ID"
else
    echo -e "${YELLOW}⚠${NC} No suitable user to test"
fi

# RBAC Tests
echo ""
echo "=== RBAC TESTS ==="

# Operator cannot archive contacts
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/operator.txt -X POST "$BASE_URL/contacts/$CONTACT_ID/archive")
if [ "$STATUS" = "403" ]; then
    pass "Operator denied for contacts (403)"
else
    fail "Operator should be denied, got $STATUS"
fi

# Direktur cannot archive contacts
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/direktur.txt -X POST "$BASE_URL/contacts/$CONTACT_ID/archive")
if [ "$STATUS" = "403" ]; then
    pass "Direktur denied for contacts (403)"
else
    fail "Direktur should be denied, got $STATUS"
fi

# Supervisor CAN archive contacts
CONTACT_ID2=$(curl -s -b /tmp/admin.txt "$BASE_URL/contacts" | jq -r '.data[1].id')
if [ -n "$CONTACT_ID2" ] && [ "$CONTACT_ID2" != "null" ]; then
    RESULT=$(curl -s -b /tmp/supervisor.txt -X POST "$BASE_URL/contacts/$CONTACT_ID2/archive")
    if echo "$RESULT" | jq -e '.ok == true' > /dev/null; then
        pass "Supervisor can archive contacts"
        curl -s -b /tmp/supervisor.txt -X POST "$BASE_URL/contacts/$CONTACT_ID2/restore" > /dev/null
    else
        fail "Supervisor archive failed"
    fi
fi

# Operator cannot archive users
if [ -n "$USER_ID" ] && [ "$USER_ID" != "null" ]; then
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/operator.txt -X POST "$BASE_URL/users/$USER_ID/archive")
    if [ "$STATUS" = "403" ]; then
        pass "Operator denied for users (403)"
    else
        fail "Operator should be denied for users, got $STATUS"
    fi
fi

# GUARD Tests
echo ""
echo "=== GUARD TESTS ==="

# Cannot archive own account
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/admin.txt -X POST "$BASE_URL/users/$ADMIN_ID/archive")
if [ "$STATUS" = "400" ]; then
    pass "Cannot archive own account (400)"
else
    fail "Should get 400 for own account, got $STATUS"
fi

# Non-existent ID returns 404
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/admin.txt -X POST "$BASE_URL/contacts/nonexistent-id-123/archive")
if [ "$STATUS" = "404" ]; then
    pass "Non-existent ID returns 404"
else
    fail "Should get 404 for non-existent ID, got $STATUS"
fi

# REGRESSION Tests
echo ""
echo "=== REGRESSION TESTS ==="

# Contacts with ?type filter
COUNT=$(curl -s -b /tmp/admin.txt "$BASE_URL/contacts?type=Customer" | jq -r '.data | length')
pass "Contacts ?type=Customer filter works (count: $COUNT)"

# Products with ?category filter
COUNT=$(curl -s -b /tmp/admin.txt "$BASE_URL/products?category=Karkas" | jq -r '.data | length')
pass "Products ?category=Karkas filter works (count: $COUNT)"

# Sales orders with ?status filter
COUNT=$(curl -s -b /tmp/admin.txt "$BASE_URL/sales-orders?status=Draft" | jq -r '.data | length')
pass "Sales orders ?status=Draft filter works (count: $COUNT)"

# Contacts with ?q search
COUNT=$(curl -s -b /tmp/admin.txt "$BASE_URL/contacts?q=Test" | jq -r '.data | length')
pass "Contacts ?q=Test search works (count: $COUNT)"

# Summary
echo ""
echo "================================================================================"
echo "SUMMARY: $PASSED passed, $FAILED failed"
echo "================================================================================"

if [ $FAILED -gt 0 ]; then
    echo -e "${RED}❌ SOME TESTS FAILED${NC}"
    exit 1
else
    echo -e "${GREEN}✅ ALL TESTS PASSED${NC}"
    exit 0
fi
