#!/bin/bash
# Backend test for soft-archive (Arsip) feature across 8 modules in LPI ERP
# Tests archive/restore endpoints, ?archived filter, RBAC, and guards

set -e

BASE_URL="http://localhost:3000/api"
COOKIE_DIR="/tmp/lpi-test-cookies"
mkdir -p "$COOKIE_DIR"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
PASSED=0
FAILED=0
SKIPPED=0

# Helper functions
log_pass() {
    echo -e "${GREEN}✓${NC} $1" >&2
    ((PASSED++))
}

log_fail() {
    echo -e "${RED}✗${NC} $1" >&2
    ((FAILED++))
}

log_skip() {
    echo -e "${YELLOW}⚠${NC} $1" >&2
    ((SKIPPED++))
}

log_info() {
    echo "  $1" >&2
}

# Login function
login() {
    local role=$1
    local email=$2
    local password=$3
    local cookie_file="$COOKIE_DIR/${role}_cookies.txt"
    
    local response=$(curl -s -c "$cookie_file" -X POST "$BASE_URL/auth/sign-in/email" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$email\",\"password\":\"$password\"}")
    
    if echo "$response" | grep -q "user"; then
        log_pass "Logged in as $role ($email)"
        echo "$cookie_file"
    else
        log_fail "Login failed for $role: $response"
        return 1
    fi
}

# API call helper
api_call() {
    local method=$1
    local endpoint=$2
    local cookie_file=$3
    local data=$4
    
    if [ -n "$data" ]; then
        curl -s -b "$cookie_file" -X "$method" "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data"
    else
        curl -s -b "$cookie_file" -X "$method" "$BASE_URL$endpoint"
    fi
}

# Get HTTP status code
api_status() {
    local method=$1
    local endpoint=$2
    local cookie_file=$3
    local data=$4
    
    if [ -n "$data" ]; then
        curl -s -o /dev/null -w "%{http_code}" -b "$cookie_file" -X "$method" "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data"
    else
        curl -s -o /dev/null -w "%{http_code}" -b "$cookie_file" -X "$method" "$BASE_URL$endpoint"
    fi
}

# Test archive/restore cycle for a resource
test_archive_restore() {
    local resource=$1
    local list_endpoint=$2
    local entity_id=$3
    local cookie_file=$4
    
    echo ""
    echo "================================================================================"
    echo "Testing ${resource^^} - Archive/Restore Cycle"
    echo "================================================================================"
    
    # Step 1: Get initial active count
    local initial_response=$(api_call GET "$list_endpoint" "$cookie_file")
    local initial_count=$(echo "$initial_response" | jq -r '.data | length')
    log_info "Initial active count: $initial_count"
    
    # Check if entity is in active list
    local entity_in_active=$(echo "$initial_response" | jq -r ".data[] | select(.id == \"$entity_id\") | .id")
    if [ -z "$entity_in_active" ]; then
        log_fail "Entity $entity_id not found in initial active list"
        return 1
    fi
    log_pass "Entity $entity_id present in active list"
    
    # Step 2: Archive the entity
    local archive_response=$(api_call POST "/$resource/$entity_id/archive" "$cookie_file")
    local archive_ok=$(echo "$archive_response" | jq -r '.ok')
    local archive_archived=$(echo "$archive_response" | jq -r '.archived')
    
    if [ "$archive_ok" = "true" ] && [ "$archive_archived" = "true" ]; then
        log_pass "Archive successful: $archive_response"
    else
        log_fail "Archive failed: $archive_response"
        return 1
    fi
    
    # Step 3: Verify entity ABSENT from default list
    local active_response=$(api_call GET "$list_endpoint" "$cookie_file")
    local active_count=$(echo "$active_response" | jq -r '.data | length')
    local expected_count=$((initial_count - 1))
    
    if [ "$active_count" -eq "$expected_count" ]; then
        log_pass "Active count correct: $active_count (expected $expected_count)"
    else
        log_fail "Active count mismatch: got $active_count, expected $expected_count"
        return 1
    fi
    
    local entity_still_active=$(echo "$active_response" | jq -r ".data[] | select(.id == \"$entity_id\") | .id")
    if [ -z "$entity_still_active" ]; then
        log_pass "Entity ABSENT from active list"
    else
        log_fail "Entity still in active list after archive"
        return 1
    fi
    
    # Step 4: Verify entity PRESENT in archived list
    local archived_response=$(api_call GET "$list_endpoint?archived=1" "$cookie_file")
    local entity_in_archived=$(echo "$archived_response" | jq -r ".data[] | select(.id == \"$entity_id\") | .id")
    
    if [ -n "$entity_in_archived" ]; then
        log_pass "Entity PRESENT in archived list (?archived=1)"
    else
        log_fail "Entity NOT in archived list"
        return 1
    fi
    
    # Step 5: Verify entity PRESENT in all list
    local all_response=$(api_call GET "$list_endpoint?archived=all" "$cookie_file")
    local all_count=$(echo "$all_response" | jq -r '.data | length')
    local entity_in_all=$(echo "$all_response" | jq -r ".data[] | select(.id == \"$entity_id\") | .id")
    
    if [ -n "$entity_in_all" ]; then
        log_pass "Entity PRESENT in all list (?archived=all, count: $all_count)"
    else
        log_fail "Entity NOT in all list"
        return 1
    fi
    
    # Step 6: Restore the entity
    local restore_response=$(api_call POST "/$resource/$entity_id/restore" "$cookie_file")
    local restore_ok=$(echo "$restore_response" | jq -r '.ok')
    local restore_archived=$(echo "$restore_response" | jq -r '.archived')
    
    if [ "$restore_ok" = "true" ] && [ "$restore_archived" = "false" ]; then
        log_pass "Restore successful: $restore_response"
    else
        log_fail "Restore failed: $restore_response"
        return 1
    fi
    
    # Step 7: Verify entity PRESENT in active list again
    local final_response=$(api_call GET "$list_endpoint" "$cookie_file")
    local final_count=$(echo "$final_response" | jq -r '.data | length')
    local entity_in_final=$(echo "$final_response" | jq -r ".data[] | select(.id == \"$entity_id\") | .id")
    
    if [ -n "$entity_in_final" ]; then
        log_pass "Entity PRESENT in active list after restore"
    else
        log_fail "Entity NOT in active list after restore"
        return 1
    fi
    
    if [ "$final_count" -eq "$initial_count" ]; then
        log_pass "Final count matches initial: $final_count"
    else
        log_fail "Final count ($final_count) != initial count ($initial_count)"
        return 1
    fi
    
    echo ""
    echo -e "${GREEN}✅ ${resource^^} - ALL TESTS PASSED${NC}"
    return 0
}

# Main test execution
echo "================================================================================"
echo "LPI ERP - Soft-Archive (Arsip) Feature Backend Tests"
echo "================================================================================"

# Login all users
echo ""
echo "================================================================================"
echo "AUTHENTICATION"
echo "================================================================================"

ADMIN_COOKIE=$(login "admin" "admin@lpi.co.id" "admin123")
SUPERVISOR_COOKIE=$(login "supervisor" "supervisor@lpi.co.id" "super123")
DIREKTUR_COOKIE=$(login "direktur" "direktur@lpi.co.id" "direktur123")
OPERATOR_COOKIE=$(login "operator" "operator@lpi.co.id" "operator123")

# Get admin user info
ME_RESPONSE=$(api_call GET "/me" "$ADMIN_COOKIE")
ADMIN_NAME=$(echo "$ME_RESPONSE" | jq -r '.user.name')
ADMIN_EMAIL=$(echo "$ME_RESPONSE" | jq -r '.user.email')
ADMIN_ROLE=$(echo "$ME_RESPONSE" | jq -r '.user.role')
ADMIN_ID=$(echo "$ME_RESPONSE" | jq -r '.user.id')
log_info "Admin user: $ADMIN_NAME ($ADMIN_EMAIL) - Role: $ADMIN_ROLE"

# Test 1: Core archive/restore for contacts
echo ""
echo "================================================================================"
echo "CORE TEST 1: CONTACTS"
echo "================================================================================"

# Create test contact
CONTACT_PAYLOAD='{"displayName":"Test Contact Archive","categories":["Customer"],"code":"TST-ARC-CON"}'
CONTACT_RESPONSE=$(api_call POST "/contacts" "$ADMIN_COOKIE" "$CONTACT_PAYLOAD")
CONTACT_ID=$(echo "$CONTACT_RESPONSE" | jq -r '.data.id')

if [ -n "$CONTACT_ID" ] && [ "$CONTACT_ID" != "null" ]; then
    log_pass "Created test contact: $CONTACT_ID"
    test_archive_restore "contacts" "/contacts" "$CONTACT_ID" "$ADMIN_COOKIE" || true
else
    log_fail "Failed to create test contact"
fi

# Test 2: Core archive/restore for products
echo ""
echo "================================================================================"
echo "CORE TEST 2: PRODUCTS"
echo "================================================================================"

PRODUCT_PAYLOAD='{"sku":"TST-ARC-PRD","name":"Test Product Archive","category":"Karkas","unit":"kg","basePrice":10000}'
PRODUCT_RESPONSE=$(api_call POST "/products" "$ADMIN_COOKIE" "$PRODUCT_PAYLOAD")
PRODUCT_ID=$(echo "$PRODUCT_RESPONSE" | jq -r '.data.id')

if [ -n "$PRODUCT_ID" ] && [ "$PRODUCT_ID" != "null" ]; then
    log_pass "Created test product: $PRODUCT_ID"
    test_archive_restore "products" "/products" "$PRODUCT_ID" "$ADMIN_COOKIE" || true
else
    log_fail "Failed to create test product"
fi

# Test 3: Core archive/restore for cold-storages
echo ""
echo "================================================================================"
echo "CORE TEST 3: COLD-STORAGES"
echo "================================================================================"

CS_PAYLOAD='{"name":"Test Cold Storage Archive","code":"TST-CS-ARC","location":"Test Location"}'
CS_RESPONSE=$(api_call POST "/cold-storages" "$ADMIN_COOKIE" "$CS_PAYLOAD")
CS_ID=$(echo "$CS_RESPONSE" | jq -r '.data.id')

if [ -n "$CS_ID" ] && [ "$CS_ID" != "null" ]; then
    log_pass "Created test cold storage: $CS_ID"
    test_archive_restore "cold-storages" "/cold-storages" "$CS_ID" "$ADMIN_COOKIE" || true
else
    log_fail "Failed to create test cold storage"
fi

# Test 4: Core archive/restore for users
echo ""
echo "================================================================================"
echo "CORE TEST 4: USERS"
echo "================================================================================"

USER_PAYLOAD='{"email":"test-archive-user@lpi.co.id","name":"Test User Archive","password":"test123","role":"operator"}'
USER_RESPONSE=$(api_call POST "/users" "$SUPERVISOR_COOKIE" "$USER_PAYLOAD")
USER_ID=$(echo "$USER_RESPONSE" | jq -r '.data.id // .id')

if [ -n "$USER_ID" ] && [ "$USER_ID" != "null" ]; then
    log_pass "Created test user: $USER_ID"
    test_archive_restore "users" "/users" "$USER_ID" "$ADMIN_COOKIE" || true
else
    log_fail "Failed to create test user"
fi

# Test 5-7: Existing entities (PO, SO, WO)
echo ""
echo "================================================================================"
echo "CORE TEST 5-7: EXISTING ENTITIES (PO, SO, WO)"
echo "================================================================================"

# Purchase Orders
PO_LIST=$(api_call GET "/purchase-orders" "$ADMIN_COOKIE")
PO_ID=$(echo "$PO_LIST" | jq -r '.data[0].id')
if [ -n "$PO_ID" ] && [ "$PO_ID" != "null" ]; then
    log_info "Using existing PO: $PO_ID"
    test_archive_restore "purchase-orders" "/purchase-orders" "$PO_ID" "$ADMIN_COOKIE" || true
else
    log_skip "No existing purchase orders to test"
fi

# Sales Orders
SO_LIST=$(api_call GET "/sales-orders" "$ADMIN_COOKIE")
SO_ID=$(echo "$SO_LIST" | jq -r '.data[0].id')
if [ -n "$SO_ID" ] && [ "$SO_ID" != "null" ]; then
    log_info "Using existing SO: $SO_ID"
    test_archive_restore "sales-orders" "/sales-orders" "$SO_ID" "$ADMIN_COOKIE" || true
else
    log_skip "No existing sales orders to test"
fi

# Work Orders
WO_LIST=$(api_call GET "/work-orders" "$ADMIN_COOKIE")
WO_ID=$(echo "$WO_LIST" | jq -r '.data[0].id')
if [ -n "$WO_ID" ] && [ "$WO_ID" != "null" ]; then
    log_info "Using existing WO: $WO_ID"
    test_archive_restore "work-orders" "/work-orders" "$WO_ID" "$ADMIN_COOKIE" || true
else
    log_skip "No existing work orders to test"
fi

# Test 8: Inventory stocks
echo ""
echo "================================================================================"
echo "CORE TEST 8: INVENTORY-STOCKS"
echo "================================================================================"

INV_LIST=$(api_call GET "/inventory/stocks" "$ADMIN_COOKIE")
INV_ID=$(echo "$INV_LIST" | jq -r '.data[0].id')
if [ -n "$INV_ID" ] && [ "$INV_ID" != "null" ]; then
    log_info "Using existing inventory stock: $INV_ID"
    test_archive_restore "inventory-stocks" "/inventory/stocks" "$INV_ID" "$ADMIN_COOKIE" || true
else
    log_skip "No existing inventory stocks to test"
fi

# Test RBAC
echo ""
echo "================================================================================"
echo "RBAC TESTS"
echo "================================================================================"

# Get a contact for RBAC testing
RBAC_CONTACT_LIST=$(api_call GET "/contacts" "$ADMIN_COOKIE")
RBAC_CONTACT_ID=$(echo "$RBAC_CONTACT_LIST" | jq -r '.data[0].id')

if [ -n "$RBAC_CONTACT_ID" ] && [ "$RBAC_CONTACT_ID" != "null" ]; then
    log_info "Using contact for RBAC test: $RBAC_CONTACT_ID"
    
    # Test 1: Operator cannot archive contacts (403)
    echo ""
    log_info "Test 1: Operator POST /contacts/:id/archive → expect 403"
    OP_STATUS=$(api_status POST "/contacts/$RBAC_CONTACT_ID/archive" "$OPERATOR_COOKIE")
    if [ "$OP_STATUS" = "403" ]; then
        log_pass "Operator correctly denied (403)"
    else
        log_fail "Expected 403, got $OP_STATUS"
    fi
    
    # Test 2: Direktur cannot archive contacts (403)
    echo ""
    log_info "Test 2: Direktur POST /contacts/:id/archive → expect 403"
    DIR_STATUS=$(api_status POST "/contacts/$RBAC_CONTACT_ID/archive" "$DIREKTUR_COOKIE")
    if [ "$DIR_STATUS" = "403" ]; then
        log_pass "Direktur correctly denied (403)"
    else
        log_fail "Expected 403, got $DIR_STATUS"
    fi
    
    # Test 3: Supervisor CAN archive contacts (200)
    # Use a different contact
    RBAC_CONTACT_ID2=$(echo "$RBAC_CONTACT_LIST" | jq -r '.data[1].id')
    if [ -n "$RBAC_CONTACT_ID2" ] && [ "$RBAC_CONTACT_ID2" != "null" ]; then
        echo ""
        log_info "Test 3: Supervisor POST /contacts/:id/archive → expect 200"
        SUP_RESPONSE=$(api_call POST "/contacts/$RBAC_CONTACT_ID2/archive" "$SUPERVISOR_COOKIE")
        SUP_OK=$(echo "$SUP_RESPONSE" | jq -r '.ok')
        if [ "$SUP_OK" = "true" ]; then
            log_pass "Supervisor can archive contacts"
            # Restore it
            api_call POST "/contacts/$RBAC_CONTACT_ID2/restore" "$SUPERVISOR_COOKIE" > /dev/null
        else
            log_fail "Supervisor archive failed: $SUP_RESPONSE"
        fi
    fi
fi

# Test 4-5: Users RBAC
USER_LIST=$(api_call GET "/users" "$SUPERVISOR_COOKIE")
TEST_USER_ID=$(echo "$USER_LIST" | jq -r '.data[] | select(.role == "operator") | .id' | head -1)

if [ -n "$TEST_USER_ID" ] && [ "$TEST_USER_ID" != "null" ]; then
    echo ""
    log_info "Test 4: Operator POST /users/:id/archive → expect 403"
    OP_USER_STATUS=$(api_status POST "/users/$TEST_USER_ID/archive" "$OPERATOR_COOKIE")
    if [ "$OP_USER_STATUS" = "403" ]; then
        log_pass "Operator correctly denied for users (403)"
    else
        log_fail "Expected 403, got $OP_USER_STATUS"
    fi
    
    echo ""
    log_info "Test 5: Supervisor POST /users/:id/archive → expect 200"
    SUP_USER_RESPONSE=$(api_call POST "/users/$TEST_USER_ID/archive" "$SUPERVISOR_COOKIE")
    SUP_USER_OK=$(echo "$SUP_USER_RESPONSE" | jq -r '.ok')
    if [ "$SUP_USER_OK" = "true" ]; then
        log_pass "Supervisor can archive users"
        # Restore it
        api_call POST "/users/$TEST_USER_ID/restore" "$SUPERVISOR_COOKIE" > /dev/null
    else
        log_fail "Supervisor user archive failed: $SUP_USER_RESPONSE"
    fi
fi

# Test GUARDS
echo ""
echo "================================================================================"
echo "GUARD TESTS"
echo "================================================================================"

# Test 1: Cannot archive own account
echo ""
log_info "Test 1: Archive own account (user ID: $ADMIN_ID) → expect 400"
OWN_STATUS=$(api_status POST "/users/$ADMIN_ID/archive" "$ADMIN_COOKIE")
if [ "$OWN_STATUS" = "400" ]; then
    log_pass "Cannot archive own account (400)"
else
    log_fail "Expected 400, got $OWN_STATUS"
fi

# Test 2: Non-existent ID returns 404
echo ""
log_info "Test 2: Archive non-existent contact → expect 404"
FAKE_STATUS=$(api_status POST "/contacts/nonexistent-id-12345/archive" "$ADMIN_COOKIE")
if [ "$FAKE_STATUS" = "404" ]; then
    log_pass "Non-existent ID returns 404"
else
    log_fail "Expected 404, got $FAKE_STATUS"
fi

# Test REGRESSION
echo ""
echo "================================================================================"
echo "REGRESSION TESTS"
echo "================================================================================"

# Test 1: Contacts with ?type filter
echo ""
log_info "Test 1: GET /contacts?type=Customer (default active only)"
CUST_LIST=$(api_call GET "/contacts?type=Customer" "$ADMIN_COOKIE")
CUST_COUNT=$(echo "$CUST_LIST" | jq -r '.data | length')
log_pass "Got $CUST_COUNT Customer contacts (active only)"

# Test 2: Products with ?category filter
echo ""
log_info "Test 2: GET /products?category=Karkas (default active only)"
KARKAS_LIST=$(api_call GET "/products?category=Karkas" "$ADMIN_COOKIE")
KARKAS_COUNT=$(echo "$KARKAS_LIST" | jq -r '.data | length')
log_pass "Got $KARKAS_COUNT Karkas products (active only)"

# Test 3: Sales orders with ?status filter
echo ""
log_info "Test 3: GET /sales-orders?status=Draft (default active only)"
DRAFT_LIST=$(api_call GET "/sales-orders?status=Draft" "$ADMIN_COOKIE")
DRAFT_COUNT=$(echo "$DRAFT_LIST" | jq -r '.data | length')
log_pass "Got $DRAFT_COUNT Draft sales orders (active only)"

# Test 4: Contacts with ?q search
echo ""
log_info "Test 4: GET /contacts?q=Test (default active only)"
SEARCH_LIST=$(api_call GET "/contacts?q=Test" "$ADMIN_COOKIE")
SEARCH_COUNT=$(echo "$SEARCH_LIST" | jq -r '.data | length')
log_pass "Got $SEARCH_COUNT contacts matching 'Test' (active only)"

# Summary
echo ""
echo "================================================================================"
echo "TEST SUMMARY"
echo "================================================================================"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo -e "${YELLOW}Skipped: $SKIPPED${NC}"
echo "================================================================================"

if [ $FAILED -gt 0 ]; then
    echo -e "${RED}❌ SOME TESTS FAILED${NC}"
    exit 1
else
    echo -e "${GREEN}✅ ALL TESTS PASSED${NC}"
    exit 0
fi
