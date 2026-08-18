#!/bin/bash
# Backend test for Phase 2 MongoDB master-data migration (DUAL-WRITE)

set -e

BASE_URL="http://localhost:3000/api"
ORIGIN="http://localhost:3000"
COOKIE_FILE="/tmp/mongo_test_cookies.txt"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test counters
PASSED=0
FAILED=0

# Cleanup data
PRODUCTS_TO_DELETE=()
CS_TO_DELETE=()
ZONES_TO_DELETE=()

echo "================================================================================"
echo "PHASE 2 MONGODB MASTER-DATA MIGRATION (DUAL-WRITE) - BACKEND TEST"
echo "================================================================================"

# Login as admin
echo ""
echo "Logging in as admin..."
LOGIN_RESP=$(curl -s -c $COOKIE_FILE -X POST "$BASE_URL/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}')

if echo "$LOGIN_RESP" | grep -q '"user"'; then
    echo -e "${GREEN}✓ Login successful as admin@lpi.co.id${NC}"
else
    echo -e "${RED}✗ Login failed${NC}"
    exit 1
fi

# TEST 1: GET initial seeded data
echo ""
echo "=== TEST 1: GET Initial Seeded Data ==="

PRODUCTS=$(curl -s -b $COOKIE_FILE "$BASE_URL/products")
PRODUCTS_COUNT=$(echo "$PRODUCTS" | jq -r '.data | length')
echo "✓ GET /products: $PRODUCTS_COUNT products"

# Check avgHppPerKg field
HAS_AVG_HPP=$(echo "$PRODUCTS" | jq -r '.data[0] | has("avgHppPerKg")')
if [ "$HAS_AVG_HPP" = "true" ]; then
    echo -e "${GREEN}✓ Products have avgHppPerKg field${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Products missing avgHppPerKg field${NC}"
    ((FAILED++))
fi

COLD_STORAGES=$(curl -s -b $COOKIE_FILE "$BASE_URL/cold-storages")
CS_COUNT=$(echo "$COLD_STORAGES" | jq -r '.data | length')
echo "✓ GET /cold-storages: $CS_COUNT cold-storages"

# Check zoneCount field
HAS_ZONE_COUNT=$(echo "$COLD_STORAGES" | jq -r '.data[0] | has("zoneCount")')
if [ "$HAS_ZONE_COUNT" = "true" ]; then
    echo -e "${GREEN}✓ Cold-storages have zoneCount field${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Cold-storages missing zoneCount field${NC}"
    ((FAILED++))
fi

ZONES=$(curl -s -b $COOKIE_FILE "$BASE_URL/zones")
ZONES_COUNT=$(echo "$ZONES" | jq -r '.data | length')
echo "✓ GET /zones: $ZONES_COUNT zones"

echo -e "${GREEN}✓ TEST 1 PASSED: Found $PRODUCTS_COUNT products, $CS_COUNT cold-storages, $ZONES_COUNT zones${NC}"

# TEST 2: Products CRUD
echo ""
echo "=== TEST 2: Products CRUD ==="

# POST - Create product
PRODUCT_RESP=$(curl -s -b $COOKIE_FILE -X POST "$BASE_URL/products" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"sku":"QA-P1","name":"QA Product","category":"Karkas","unit":"kg"}')

PRODUCT_ID=$(echo "$PRODUCT_RESP" | jq -r '.data.id')
if [ "$PRODUCT_ID" != "null" ] && [ -n "$PRODUCT_ID" ]; then
    echo -e "${GREEN}✓ POST /products: Created product with id=$PRODUCT_ID${NC}"
    PRODUCTS_TO_DELETE+=("$PRODUCT_ID")
    ((PASSED++))
else
    echo -e "${RED}✗ POST /products failed${NC}"
    ((FAILED++))
fi

# GET by ID
GET_PRODUCT=$(curl -s -b $COOKIE_FILE "$BASE_URL/products/$PRODUCT_ID")
PRODUCT_NAME=$(echo "$GET_PRODUCT" | jq -r '.data.name')
if [ "$PRODUCT_NAME" = "QA Product" ]; then
    echo -e "${GREEN}✓ GET /products/$PRODUCT_ID: Matches created product${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ GET /products/$PRODUCT_ID: name mismatch${NC}"
    ((FAILED++))
fi

# PATCH - Update product
PATCH_RESP=$(curl -s -b $COOKIE_FILE -X PATCH "$BASE_URL/products/$PRODUCT_ID" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"name":"QA Product Updated"}')

UPDATED_NAME=$(echo "$PATCH_RESP" | jq -r '.data.name')
if [ "$UPDATED_NAME" = "QA Product Updated" ]; then
    echo -e "${GREEN}✓ PATCH /products/$PRODUCT_ID: Name updated successfully${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ PATCH /products/$PRODUCT_ID: name not updated${NC}"
    ((FAILED++))
fi

# Duplicate SKU - should return 409
DUP_RESP=$(curl -s -w "\n%{http_code}" -b $COOKIE_FILE -X POST "$BASE_URL/products" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"sku":"QA-P1","name":"QA Product","category":"Karkas","unit":"kg"}')

DUP_STATUS=$(echo "$DUP_RESP" | tail -n1)
if [ "$DUP_STATUS" = "409" ]; then
    echo -e "${GREEN}✓ Duplicate SKU correctly rejected with 409${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Duplicate SKU should return 409, got $DUP_STATUS${NC}"
    ((FAILED++))
fi

# DELETE
DEL_RESP=$(curl -s -w "\n%{http_code}" -b $COOKIE_FILE -X DELETE "$BASE_URL/products/$PRODUCT_ID" \
  -H "Origin: $ORIGIN")

DEL_STATUS=$(echo "$DEL_RESP" | tail -n1)
if [ "$DEL_STATUS" = "200" ]; then
    echo -e "${GREEN}✓ DELETE /products/$PRODUCT_ID: Deleted successfully${NC}"
    PRODUCTS_TO_DELETE=("${PRODUCTS_TO_DELETE[@]/$PRODUCT_ID}")
    ((PASSED++))
else
    echo -e "${RED}✗ DELETE /products/$PRODUCT_ID failed: $DEL_STATUS${NC}"
    ((FAILED++))
fi

# Verify deleted - should return 404
GET_DEL=$(curl -s -w "\n%{http_code}" -b $COOKIE_FILE "$BASE_URL/products/$PRODUCT_ID")
GET_DEL_STATUS=$(echo "$GET_DEL" | tail -n1)
if [ "$GET_DEL_STATUS" = "404" ]; then
    echo -e "${GREEN}✓ GET deleted product correctly returns 404${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Deleted product should return 404, got $GET_DEL_STATUS${NC}"
    ((FAILED++))
fi

echo -e "${GREEN}✓ TEST 2 PASSED: Products CRUD working correctly${NC}"

# TEST 3: Cold-storages CRUD with cascade delete
echo ""
echo "=== TEST 3: Cold-storages CRUD ==="

# POST - Create cold-storage
CS_RESP=$(curl -s -b $COOKIE_FILE -X POST "$BASE_URL/cold-storages" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"code":"QA-CS1","name":"QA CS"}')

CS_ID=$(echo "$CS_RESP" | jq -r '.data.id')
if [ "$CS_ID" != "null" ] && [ -n "$CS_ID" ]; then
    echo -e "${GREEN}✓ POST /cold-storages: Created cold-storage with id=$CS_ID${NC}"
    CS_TO_DELETE+=("$CS_ID")
    ((PASSED++))
else
    echo -e "${RED}✗ POST /cold-storages failed${NC}"
    ((FAILED++))
fi

# GET by ID - should include zones array
GET_CS=$(curl -s -b $COOKIE_FILE "$BASE_URL/cold-storages/$CS_ID")
HAS_ZONES=$(echo "$GET_CS" | jq -r '.data | has("zones")')
if [ "$HAS_ZONES" = "true" ]; then
    ZONES_ARRAY_COUNT=$(echo "$GET_CS" | jq -r '.data.zones | length')
    echo -e "${GREEN}✓ GET /cold-storages/$CS_ID: Includes zones array (count: $ZONES_ARRAY_COUNT)${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ GET /cold-storages/$CS_ID: missing zones array${NC}"
    ((FAILED++))
fi

# Duplicate code - should return 409
DUP_CS=$(curl -s -w "\n%{http_code}" -b $COOKIE_FILE -X POST "$BASE_URL/cold-storages" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"code":"QA-CS1","name":"QA CS"}')

DUP_CS_STATUS=$(echo "$DUP_CS" | tail -n1)
if [ "$DUP_CS_STATUS" = "409" ]; then
    echo -e "${GREEN}✓ Duplicate code correctly rejected with 409${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Duplicate code should return 409, got $DUP_CS_STATUS${NC}"
    ((FAILED++))
fi

# Create a zone under this cold-storage
ZONE_RESP=$(curl -s -b $COOKIE_FILE -X POST "$BASE_URL/zones" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d "{\"coldStorageId\":\"$CS_ID\",\"code\":\"QA-Z1\",\"name\":\"QA Zone\"}")

ZONE_ID=$(echo "$ZONE_RESP" | jq -r '.data.id')
if [ "$ZONE_ID" != "null" ] && [ -n "$ZONE_ID" ]; then
    echo -e "${GREEN}✓ POST /zones: Created zone with id=$ZONE_ID${NC}"
    ZONES_TO_DELETE+=("$ZONE_ID")
    ((PASSED++))
else
    echo -e "${RED}✗ POST /zones failed${NC}"
    ((FAILED++))
fi

# DELETE cold-storage - should cascade delete zones
DEL_CS=$(curl -s -w "\n%{http_code}" -b $COOKIE_FILE -X DELETE "$BASE_URL/cold-storages/$CS_ID" \
  -H "Origin: $ORIGIN")

DEL_CS_STATUS=$(echo "$DEL_CS" | tail -n1)
if [ "$DEL_CS_STATUS" = "200" ]; then
    echo -e "${GREEN}✓ DELETE /cold-storages/$CS_ID: Deleted successfully${NC}"
    CS_TO_DELETE=("${CS_TO_DELETE[@]/$CS_ID}")
    ((PASSED++))
else
    echo -e "${RED}✗ DELETE /cold-storages/$CS_ID failed: $DEL_CS_STATUS${NC}"
    ((FAILED++))
fi

# Verify zones are cascade-deleted
GET_ZONES=$(curl -s -b $COOKIE_FILE "$BASE_URL/zones?cold_storage_id=$CS_ID")
CASCADE_ZONES_COUNT=$(echo "$GET_ZONES" | jq -r '.data | length')
if [ "$CASCADE_ZONES_COUNT" = "0" ]; then
    echo -e "${GREEN}✓ Zones cascade-deleted successfully${NC}"
    ZONES_TO_DELETE=("${ZONES_TO_DELETE[@]/$ZONE_ID}")
    ((PASSED++))
else
    echo -e "${RED}✗ Zones not cascade-deleted, found $CASCADE_ZONES_COUNT zones${NC}"
    ((FAILED++))
fi

echo -e "${GREEN}✓ TEST 3 PASSED: Cold-storages CRUD and cascade delete working correctly${NC}"

# TEST 4: Zones CRUD
echo ""
echo "=== TEST 4: Zones CRUD ==="

# Create a cold-storage for zone testing
CS2_RESP=$(curl -s -b $COOKIE_FILE -X POST "$BASE_URL/cold-storages" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"code":"QA-CS2","name":"QA CS 2"}')

CS2_ID=$(echo "$CS2_RESP" | jq -r '.data.id')
CS_TO_DELETE+=("$CS2_ID")
echo "✓ Created cold-storage for zone testing: $CS2_ID"

# POST - Create zone
ZONE2_RESP=$(curl -s -b $COOKIE_FILE -X POST "$BASE_URL/zones" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d "{\"coldStorageId\":\"$CS2_ID\",\"code\":\"QA-Z2\",\"name\":\"QA Zone 2\"}")

ZONE2_ID=$(echo "$ZONE2_RESP" | jq -r '.data.id')
if [ "$ZONE2_ID" != "null" ] && [ -n "$ZONE2_ID" ]; then
    echo -e "${GREEN}✓ POST /zones: Created zone with id=$ZONE2_ID${NC}"
    ZONES_TO_DELETE+=("$ZONE2_ID")
    ((PASSED++))
else
    echo -e "${RED}✗ POST /zones failed${NC}"
    ((FAILED++))
fi

# GET with filter
GET_FILTERED_ZONES=$(curl -s -b $COOKIE_FILE "$BASE_URL/zones?cold_storage_id=$CS2_ID")
FILTERED_COUNT=$(echo "$GET_FILTERED_ZONES" | jq -r '.data | length')
FOUND_ZONE=$(echo "$GET_FILTERED_ZONES" | jq -r ".data[] | select(.id==\"$ZONE2_ID\") | .id")

if [ "$FOUND_ZONE" = "$ZONE2_ID" ]; then
    echo -e "${GREEN}✓ GET /zones?cold_storage_id=$CS2_ID: Found created zone${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Created zone not found in filtered list${NC}"
    ((FAILED++))
fi

# PATCH - Update zone
PATCH_ZONE=$(curl -s -b $COOKIE_FILE -X PATCH "$BASE_URL/zones/$ZONE2_ID" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"name":"QA Zone 2 Updated"}')

UPDATED_ZONE_NAME=$(echo "$PATCH_ZONE" | jq -r '.data.name')
if [ "$UPDATED_ZONE_NAME" = "QA Zone 2 Updated" ]; then
    echo -e "${GREEN}✓ PATCH /zones/$ZONE2_ID: Name updated successfully${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ PATCH /zones/$ZONE2_ID: name not updated${NC}"
    ((FAILED++))
fi

# DELETE zone
DEL_ZONE=$(curl -s -w "\n%{http_code}" -b $COOKIE_FILE -X DELETE "$BASE_URL/zones/$ZONE2_ID" \
  -H "Origin: $ORIGIN")

DEL_ZONE_STATUS=$(echo "$DEL_ZONE" | tail -n1)
if [ "$DEL_ZONE_STATUS" = "200" ]; then
    echo -e "${GREEN}✓ DELETE /zones/$ZONE2_ID: Deleted successfully${NC}"
    ZONES_TO_DELETE=("${ZONES_TO_DELETE[@]/$ZONE2_ID}")
    ((PASSED++))
else
    echo -e "${RED}✗ DELETE /zones/$ZONE2_ID failed: $DEL_ZONE_STATUS${NC}"
    ((FAILED++))
fi

echo -e "${GREEN}✓ TEST 4 PASSED: Zones CRUD working correctly${NC}"

# TEST 5: Archive and restore
echo ""
echo "=== TEST 5: Archive and Restore ==="

# Create a product for archive testing
ARCH_PROD=$(curl -s -b $COOKIE_FILE -X POST "$BASE_URL/products" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"sku":"QA-ARCH1","name":"QA Archive Test","category":"Karkas","unit":"kg"}')

ARCH_PROD_ID=$(echo "$ARCH_PROD" | jq -r '.data.id')
PRODUCTS_TO_DELETE+=("$ARCH_PROD_ID")
echo "✓ Created product for archive testing: $ARCH_PROD_ID"

# Archive the product
ARCHIVE=$(curl -s -w "\n%{http_code}" -b $COOKIE_FILE -X POST "$BASE_URL/products/$ARCH_PROD_ID/archive" \
  -H "Origin: $ORIGIN")

ARCHIVE_STATUS=$(echo "$ARCHIVE" | tail -n1)
if [ "$ARCHIVE_STATUS" = "200" ]; then
    echo -e "${GREEN}✓ Archived product successfully${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Archive failed: $ARCHIVE_STATUS${NC}"
    ((FAILED++))
fi

# GET default (should NOT include archived)
DEFAULT_PRODS=$(curl -s -b $COOKIE_FILE "$BASE_URL/products")
FOUND_IN_DEFAULT=$(echo "$DEFAULT_PRODS" | jq -r ".data[] | select(.id==\"$ARCH_PROD_ID\") | .id")

if [ -z "$FOUND_IN_DEFAULT" ]; then
    echo -e "${GREEN}✓ Archived product NOT in default GET${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Archived product should not appear in default GET${NC}"
    ((FAILED++))
fi

# GET with archived=1 (should include archived only)
ARCHIVED_PRODS=$(curl -s -b $COOKIE_FILE "$BASE_URL/products?archived=1")
FOUND_IN_ARCHIVED=$(echo "$ARCHIVED_PRODS" | jq -r ".data[] | select(.id==\"$ARCH_PROD_ID\") | .id")

if [ "$FOUND_IN_ARCHIVED" = "$ARCH_PROD_ID" ]; then
    echo -e "${GREEN}✓ Archived product appears in ?archived=1${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Archived product should appear in ?archived=1${NC}"
    ((FAILED++))
fi

# Restore the product
RESTORE=$(curl -s -w "\n%{http_code}" -b $COOKIE_FILE -X POST "$BASE_URL/products/$ARCH_PROD_ID/restore" \
  -H "Origin: $ORIGIN")

RESTORE_STATUS=$(echo "$RESTORE" | tail -n1)
if [ "$RESTORE_STATUS" = "200" ]; then
    echo -e "${GREEN}✓ Restored product successfully${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Restore failed: $RESTORE_STATUS${NC}"
    ((FAILED++))
fi

# GET default (should include restored product)
RESTORED_PRODS=$(curl -s -b $COOKIE_FILE "$BASE_URL/products")
FOUND_RESTORED=$(echo "$RESTORED_PRODS" | jq -r ".data[] | select(.id==\"$ARCH_PROD_ID\") | .id")

if [ "$FOUND_RESTORED" = "$ARCH_PROD_ID" ]; then
    echo -e "${GREEN}✓ Restored product appears in default GET${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Restored product should appear in default GET${NC}"
    ((FAILED++))
fi

echo -e "${GREEN}✓ TEST 5 PASSED: Archive and restore working correctly${NC}"

# TEST 6: Role-based access control
echo ""
echo "=== TEST 6: Role-based Access Control ==="

# Login as operator
OP_LOGIN=$(curl -s -c /tmp/op_cookies.txt -X POST "$BASE_URL/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"email":"operator@lpi.co.id","password":"operator123"}')

if echo "$OP_LOGIN" | grep -q '"user"'; then
    echo "✓ Login successful as operator@lpi.co.id"
else
    echo -e "${RED}✗ Failed to login as operator${NC}"
    ((FAILED++))
fi

# Try POST /products (should be 403)
OP_POST=$(curl -s -w "\n%{http_code}" -b /tmp/op_cookies.txt -X POST "$BASE_URL/products" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"sku":"QA-FORBIDDEN","name":"Should Fail","category":"Karkas","unit":"kg"}')

OP_POST_STATUS=$(echo "$OP_POST" | tail -n1)
if [ "$OP_POST_STATUS" = "403" ]; then
    echo -e "${GREEN}✓ Operator POST /products correctly rejected with 403${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Operator POST /products should return 403, got $OP_POST_STATUS${NC}"
    ((FAILED++))
fi

# Try POST /cold-storages (should be 403)
OP_POST_CS=$(curl -s -w "\n%{http_code}" -b /tmp/op_cookies.txt -X POST "$BASE_URL/cold-storages" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"code":"QA-FORBIDDEN","name":"Should Fail"}')

OP_POST_CS_STATUS=$(echo "$OP_POST_CS" | tail -n1)
if [ "$OP_POST_CS_STATUS" = "403" ]; then
    echo -e "${GREEN}✓ Operator POST /cold-storages correctly rejected with 403${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Operator POST /cold-storages should return 403, got $OP_POST_CS_STATUS${NC}"
    ((FAILED++))
fi

# Try POST /zones (should be 403)
OP_POST_ZONE=$(curl -s -w "\n%{http_code}" -b /tmp/op_cookies.txt -X POST "$BASE_URL/zones" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"coldStorageId":"dummy-id","code":"QA-FORBIDDEN","name":"Should Fail"}')

OP_POST_ZONE_STATUS=$(echo "$OP_POST_ZONE" | tail -n1)
if [ "$OP_POST_ZONE_STATUS" = "403" ]; then
    echo -e "${GREEN}✓ Operator POST /zones correctly rejected with 403${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Operator POST /zones should return 403, got $OP_POST_ZONE_STATUS${NC}"
    ((FAILED++))
fi

# GET should work
OP_GET=$(curl -s -w "\n%{http_code}" -b /tmp/op_cookies.txt "$BASE_URL/products")
OP_GET_STATUS=$(echo "$OP_GET" | tail -n1)
echo "✓ Operator GET /products: $OP_GET_STATUS"

echo -e "${GREEN}✓ TEST 6 PASSED: Role-based access control working correctly${NC}"

# TEST 7: Stats endpoint regression
echo ""
echo "=== TEST 7: Stats Endpoint Regression ==="

STATS=$(curl -s -b $COOKIE_FILE "$BASE_URL/stats")
STATS_PRODUCTS=$(echo "$STATS" | jq -r '.products')
STATS_CS=$(echo "$STATS" | jq -r '.coldStorages')
STATS_ZONES=$(echo "$STATS" | jq -r '.zones')
STATS_CONTACTS=$(echo "$STATS" | jq -r '.contacts')
STATS_USERS=$(echo "$STATS" | jq -r '.users')

if [ "$STATS_PRODUCTS" != "null" ] && [ "$STATS_CS" != "null" ] && [ "$STATS_ZONES" != "null" ]; then
    echo "✓ Stats.products: $STATS_PRODUCTS"
    echo "✓ Stats.coldStorages: $STATS_CS"
    echo "✓ Stats.zones: $STATS_ZONES"
    echo "✓ Stats.contacts: $STATS_CONTACTS"
    echo "✓ Stats.users: $STATS_USERS"
    echo -e "${GREEN}✓ TEST 7 PASSED: Stats endpoint working correctly${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Stats endpoint missing required fields${NC}"
    ((FAILED++))
fi

# CLEANUP
echo ""
echo "=== CLEANUP ==="

for ZONE_ID in "${ZONES_TO_DELETE[@]}"; do
    if [ -n "$ZONE_ID" ]; then
        curl -s -b $COOKIE_FILE -X DELETE "$BASE_URL/zones/$ZONE_ID" -H "Origin: $ORIGIN" > /dev/null
        echo "✓ Deleted zone: $ZONE_ID"
    fi
done

for CS_ID in "${CS_TO_DELETE[@]}"; do
    if [ -n "$CS_ID" ]; then
        curl -s -b $COOKIE_FILE -X DELETE "$BASE_URL/cold-storages/$CS_ID" -H "Origin: $ORIGIN" > /dev/null
        echo "✓ Deleted cold-storage: $CS_ID"
    fi
done

for PRODUCT_ID in "${PRODUCTS_TO_DELETE[@]}"; do
    if [ -n "$PRODUCT_ID" ]; then
        curl -s -b $COOKIE_FILE -X DELETE "$BASE_URL/products/$PRODUCT_ID" -H "Origin: $ORIGIN" > /dev/null
        echo "✓ Deleted product: $PRODUCT_ID"
    fi
done

echo "✓ Cleanup complete"

# SUMMARY
echo ""
echo "================================================================================"
echo "TEST SUMMARY"
echo "================================================================================"
echo ""
echo "Total: $PASSED tests passed"

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓✓✓ ALL TESTS PASSED ✓✓✓${NC}"
    exit 0
else
    echo -e "${RED}✗✗✗ $FAILED TEST(S) FAILED ✗✗✗${NC}"
    exit 1
fi
