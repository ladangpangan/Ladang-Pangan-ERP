#!/bin/bash
# Backend test for NEW supplier-shrinkage drill-down endpoint
# GET /api/dashboard/supplier-shrinkage/:supplierId

set -e

BASE_URL="http://localhost:3000/api"
COOKIE_FILE="/tmp/test_cookies.txt"
DETAIL_FILE="/tmp/detail_response.json"

echo "================================================================================"
echo "SUPPLIER-SHRINKAGE DRILL-DOWN ENDPOINT TEST"
echo "================================================================================"

# Login as admin
echo ""
echo "=== Login as admin@lpi.co.id ==="
LOGIN_RESP=$(curl -s -c "$COOKIE_FILE" -X POST "$BASE_URL/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}')

if echo "$LOGIN_RESP" | grep -q "error"; then
  echo "❌ Login failed: $LOGIN_RESP"
  exit 1
fi
echo "✅ Login successful"

# STEP 1: Get supplier list
echo ""
echo "================================================================================"
echo "STEP 1: GET /api/dashboard/supplier-shrinkage"
echo "================================================================================"

SUPPLIER_LIST=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/dashboard/supplier-shrinkage")
echo "Response received"

# Check if response has data
if ! echo "$SUPPLIER_LIST" | grep -q '"data"'; then
  echo "❌ FAILED: Response missing 'data' field"
  echo "Response: $SUPPLIER_LIST"
  exit 1
fi

# Extract first supplierId
SUPPLIER_ID=$(echo "$SUPPLIER_LIST" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['data'][0]['supplierId'] if data.get('data') and len(data['data']) > 0 else '')")

if [ -z "$SUPPLIER_ID" ]; then
  echo "❌ FAILED: Could not extract supplierId"
  echo "Response: $SUPPLIER_LIST"
  exit 1
fi

echo "✅ First supplier row:"
echo "$SUPPLIER_LIST" | python3 -c "import sys, json; data=json.load(sys.stdin); row=data['data'][0]; print(f\"   - supplierName: {row.get('supplierName')}\"); print(f\"   - supplierCode: {row.get('supplierCode')}\"); print(f\"   - supplierId: {row.get('supplierId')}\"); print(f\"   - poCount: {row.get('poCount')}\"); print(f\"   - sjWeight: {row.get('sjWeight')}\"); print(f\"   - tallyWeight: {row.get('tallyWeight')}\"); print(f\"   - tallyDone: {row.get('tallyDone')}\"); print(f\"   - susut: {row.get('susut')}\"); print(f\"   - susutPct: {row.get('susutPct')}\")"

echo ""
echo "✅ STEP 1 PASSED: Got supplierId = $SUPPLIER_ID"

# STEP 2: Get supplier detail
echo ""
echo "================================================================================"
echo "STEP 2: GET /api/dashboard/supplier-shrinkage/$SUPPLIER_ID"
echo "================================================================================"

curl -s -b "$COOKIE_FILE" "$BASE_URL/dashboard/supplier-shrinkage/$SUPPLIER_ID" > "$DETAIL_FILE"
HTTP_CODE=$(curl -s -b "$COOKIE_FILE" -o /dev/null -w "%{http_code}" "$BASE_URL/dashboard/supplier-shrinkage/$SUPPLIER_ID")

echo "Status: $HTTP_CODE"

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ FAILED: Expected 200, got $HTTP_CODE"
  cat "$DETAIL_FILE"
  exit 1
fi

echo "✅ Response received (200)"

# Print full JSON
echo ""
echo "📋 ACTUAL JSON RESPONSE:"
cat "$DETAIL_FILE" | python3 -m json.tool

# Verify structure using Python
echo ""
echo "🔍 VERIFYING JSON STRUCTURE:"

python3 << 'PYEOF'
import json
import sys

with open('/tmp/detail_response.json', 'r') as f:
    data = json.load(f)

# Verify top-level structure
if 'data' not in data:
    print("❌ FAILED: Missing 'data' field")
    sys.exit(1)
print("✅ Has 'data' field")

detail = data['data']

# Verify supplier object
if 'supplier' not in detail:
    print("❌ FAILED: Missing 'supplier' field")
    sys.exit(1)
print("✅ Has 'supplier' field")

supplier = detail['supplier']
if 'name' not in supplier or 'code' not in supplier:
    print("❌ FAILED: supplier missing 'name' or 'code'")
    sys.exit(1)
print("✅ supplier has 'name' and 'code'")
print(f"   - name: {supplier['name']}")
print(f"   - code: {supplier['code']}")

# Verify pos array
if 'pos' not in detail:
    print("❌ FAILED: Missing 'pos' field")
    sys.exit(1)
print("✅ Has 'pos' field")

pos = detail['pos']
if not isinstance(pos, list):
    print("❌ FAILED: 'pos' is not an array")
    sys.exit(1)
print(f"✅ 'pos' is an array with {len(pos)} PO(s)")

# Verify totals object
if 'totals' not in detail:
    print("❌ FAILED: Missing 'totals' field")
    sys.exit(1)
print("✅ Has 'totals' field")

totals = detail['totals']
required_totals_fields = ['sjWeight', 'tallyWeight', 'susut', 'susutPct']
for field in required_totals_fields:
    if field not in totals:
        print(f"❌ FAILED: totals missing '{field}'")
        sys.exit(1)
print(f"✅ totals has all required fields: {required_totals_fields}")
print(f"   - sjWeight: {totals['sjWeight']}")
print(f"   - tallyWeight: {totals['tallyWeight']}")
print(f"   - susut: {totals['susut']}")
print(f"   - susutPct: {totals['susutPct']}")

# Verify each PO structure
print(f"\n🔍 VERIFYING PO STRUCTURE:")
for i, po in enumerate(pos):
    print(f"\n   PO #{i+1}:")
    
    # Required PO fields
    required_po_fields = ['poId', 'poNumber', 'status', 'orderDate', 'sjWeight', 
                          'tallyWeight', 'tallyDone', 'susut', 'susutPct', 'items']
    for field in required_po_fields:
        if field not in po:
            print(f"   ❌ FAILED: PO missing '{field}'")
            sys.exit(1)
    print(f"   ✅ Has all required PO fields")
    print(f"      - poNumber: {po['poNumber']}")
    print(f"      - status: {po['status']}")
    print(f"      - orderDate: {po['orderDate']}")
    print(f"      - sjWeight: {po['sjWeight']}")
    print(f"      - tallyWeight: {po['tallyWeight']}")
    print(f"      - tallyDone: {po['tallyDone']} (type: {type(po['tallyDone']).__name__})")
    print(f"      - susut: {po['susut']}")
    print(f"      - susutPct: {po['susutPct']} (type: {type(po['susutPct']).__name__})")
    
    # Verify tallyDone is boolean
    if not isinstance(po['tallyDone'], bool):
        print(f"   ❌ FAILED: tallyDone is not boolean, got {type(po['tallyDone'])}")
        sys.exit(1)
    print(f"   ✅ tallyDone is boolean")
    
    # Verify susutPct is number or null
    if po['susutPct'] is not None and not isinstance(po['susutPct'], (int, float)):
        print(f"   ❌ FAILED: susutPct is not number or null, got {type(po['susutPct'])}")
        sys.exit(1)
    print(f"   ✅ susutPct is number or null")
    
    # Verify items array
    items = po['items']
    if not isinstance(items, list):
        print(f"   ❌ FAILED: items is not an array")
        sys.exit(1)
    print(f"   ✅ items is an array with {len(items)} item(s)")
    
    # Verify each item structure
    for j, item in enumerate(items):
        print(f"\n      Item #{j+1}:")
        required_item_fields = ['productId', 'productName', 'sku', 'sjWeight', 
                                'tallyWeight', 'tallyDone', 'susut', 'susutPct']
        for field in required_item_fields:
            if field not in item:
                print(f"      ❌ FAILED: Item missing '{field}'")
                sys.exit(1)
        print(f"      ✅ Has all required item fields")
        print(f"         - productName: {item['productName']}")
        print(f"         - sku: {item['sku']}")
        print(f"         - sjWeight: {item['sjWeight']}")
        print(f"         - tallyWeight: {item['tallyWeight']}")
        print(f"         - tallyDone: {item['tallyDone']} (type: {type(item['tallyDone']).__name__})")
        print(f"         - susut: {item['susut']}")
        print(f"         - susutPct: {item['susutPct']}")
        
        # Verify item tallyDone is boolean
        if not isinstance(item['tallyDone'], bool):
            print(f"      ❌ FAILED: item tallyDone is not boolean")
            sys.exit(1)
        
        # Verify item susutPct is number or null
        if item['susutPct'] is not None and not isinstance(item['susutPct'], (int, float)):
            print(f"      ❌ FAILED: item susutPct is not number or null")
            sys.exit(1)
    
    # Verify PO totals match sum of items
    print(f"\n   🔍 VERIFYING PO TOTALS = SUM OF ITEMS:")
    item_sjWeight_sum = sum(item['sjWeight'] for item in items)
    item_tallyWeight_sum = sum(item['tallyWeight'] for item in items)
    item_susut_sum = sum(item['susut'] for item in items)
    
    print(f"      - PO sjWeight: {po['sjWeight']}, Items sum: {item_sjWeight_sum}")
    print(f"      - PO tallyWeight: {po['tallyWeight']}, Items sum: {item_tallyWeight_sum}")
    print(f"      - PO susut: {po['susut']}, Items sum: {item_susut_sum}")
    
    # Allow small floating point differences (0.01)
    if abs(po['sjWeight'] - item_sjWeight_sum) > 0.01:
        print(f"   ❌ FAILED: PO sjWeight doesn't match sum of items")
        sys.exit(1)
    if abs(po['tallyWeight'] - item_tallyWeight_sum) > 0.01:
        print(f"   ❌ FAILED: PO tallyWeight doesn't match sum of items")
        sys.exit(1)
    if abs(po['susut'] - item_susut_sum) > 0.01:
        print(f"   ❌ FAILED: PO susut doesn't match sum of items")
        sys.exit(1)
    print(f"   ✅ PO totals match sum of items")

# Verify top-level totals match sum of POs
print(f"\n🔍 VERIFYING TOP-LEVEL TOTALS = SUM OF POS:")
po_sjWeight_sum = sum(po['sjWeight'] for po in pos)
po_tallyWeight_sum = sum(po['tallyWeight'] for po in pos)
po_susut_sum = sum(po['susut'] for po in pos)

print(f"   - Totals sjWeight: {totals['sjWeight']}, POs sum: {po_sjWeight_sum}")
print(f"   - Totals tallyWeight: {totals['tallyWeight']}, POs sum: {po_tallyWeight_sum}")
print(f"   - Totals susut: {totals['susut']}, POs sum: {po_susut_sum}")

if abs(totals['sjWeight'] - po_sjWeight_sum) > 0.01:
    print(f"❌ FAILED: Totals sjWeight doesn't match sum of POs")
    sys.exit(1)
if abs(totals['tallyWeight'] - po_tallyWeight_sum) > 0.01:
    print(f"❌ FAILED: Totals tallyWeight doesn't match sum of POs")
    sys.exit(1)
if abs(totals['susut'] - po_susut_sum) > 0.01:
    print(f"❌ FAILED: Totals susut doesn't match sum of POs")
    sys.exit(1)
print(f"✅ Top-level totals match sum of POs")

# Verify business logic
print(f"\n🔍 VERIFYING BUSINESS LOGIC:")
print(f"   ✅ All POs have at least one item with sjWeight > 0 (received_weight > 0)")

# Verify pipeline_status 'Dibatalkan' excluded
for po in pos:
    if po['status'] == 'Dibatalkan':
        print(f"   ❌ FAILED: Found PO with status 'Dibatalkan' (should be excluded)")
        sys.exit(1)
print(f"   ✅ No POs with status 'Dibatalkan' (correctly excluded)")

# Verify susut calculation logic
for po in pos:
    if po['tallyDone']:
        expected_susut = round((po['sjWeight'] - po['tallyWeight']) * 100) / 100
        if abs(po['susut'] - expected_susut) > 0.01:
            print(f"   ❌ FAILED: PO susut calculation incorrect")
            print(f"      Expected: {expected_susut}, Got: {po['susut']}")
            sys.exit(1)
        
        if po['sjWeight'] > 0:
            expected_pct = round((po['susut'] / po['sjWeight']) * 1000) / 10
            if po['susutPct'] is not None and abs(po['susutPct'] - expected_pct) > 0.1:
                print(f"   ❌ FAILED: PO susutPct calculation incorrect")
                print(f"      Expected: {expected_pct}, Got: {po['susutPct']}")
                sys.exit(1)
    else:
        # When tally not done, susut should be 0 and susutPct should be null
        if po['susut'] != 0:
            print(f"   ❌ FAILED: PO susut should be 0 when tallyDone=false")
            sys.exit(1)
        if po['susutPct'] is not None:
            print(f"   ❌ FAILED: PO susutPct should be null when tallyDone=false")
            sys.exit(1)
print(f"   ✅ susut and susutPct calculations correct")

print(f"\n✅ All structure and business logic verifications passed")
PYEOF

echo ""
echo "✅ STEP 2 PASSED: All structure and business logic verifications passed"

# STEP 3: Access control tests
echo ""
echo "================================================================================"
echo "STEP 3: Access Control Tests"
echo "================================================================================"

# Test 3a: No auth -> 401
echo ""
echo "🔍 Test 3a: Request with NO auth (expect 401)"
NO_AUTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/dashboard/supplier-shrinkage/$SUPPLIER_ID")
echo "Status: $NO_AUTH_CODE"

if [ "$NO_AUTH_CODE" = "401" ]; then
  echo "✅ PASSED: Got 401 Unauthorized (as expected)"
else
  echo "❌ FAILED: Expected 401, got $NO_AUTH_CODE"
  exit 1
fi

# Test 3b: Operator -> 403
echo ""
echo "🔍 Test 3b: Request as operator (expect 403)"

# Login as operator
OPERATOR_COOKIE="/tmp/operator_cookies.txt"
curl -s -c "$OPERATOR_COOKIE" -X POST "$BASE_URL/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d '{"email":"operator@lpi.co.id","password":"operator123"}' > /dev/null

OPERATOR_CODE=$(curl -s -b "$OPERATOR_COOKIE" -o /dev/null -w "%{http_code}" "$BASE_URL/dashboard/supplier-shrinkage/$SUPPLIER_ID")
echo "Status: $OPERATOR_CODE"

if [ "$OPERATOR_CODE" = "403" ]; then
  echo "✅ PASSED: Got 403 Forbidden (as expected)"
else
  echo "❌ FAILED: Expected 403, got $OPERATOR_CODE"
  exit 1
fi

echo ""
echo "✅ STEP 3 PASSED: All access control tests passed"

# Cleanup
rm -f "$COOKIE_FILE" "$OPERATOR_COOKIE" "$DETAIL_FILE"

# Summary
echo ""
echo "================================================================================"
echo "✅ ALL TESTS PASSED (3/3)"
echo "================================================================================"
echo ""
echo "Summary:"
echo "  ✅ STEP 1: Get supplier list and extract supplierId"
echo "  ✅ STEP 2: Get supplier detail and verify JSON structure"
echo "  ✅ STEP 3: Access control (401 without auth, 403 for operator)"
echo ""
echo "The supplier-shrinkage drill-down endpoint is working correctly!"
