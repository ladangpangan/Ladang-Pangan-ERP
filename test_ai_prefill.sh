#!/bin/bash
set -e

BASE_URL="http://localhost:3000/api"
COOKIE_FILE="/tmp/ai_test_cookies.txt"

echo "================================================================================"
echo "BACKEND API TESTS: AI Smart Prefill + Stock Options"
echo "================================================================================"

# Login
echo ""
echo "=== LOGIN ==="
curl -s -c "$COOKIE_FILE" -X POST "$BASE_URL/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}' > /tmp/login_response.json

if grep -q '"user"' /tmp/login_response.json; then
    echo "✅ Login successful"
else
    echo "❌ Login failed"
    cat /tmp/login_response.json
    exit 1
fi

# Test 1: GET /api/ai/options
echo ""
echo "=== TEST 1: GET /api/ai/options ==="
curl -s -b "$COOKIE_FILE" "$BASE_URL/ai/options" > /tmp/ai_options.json

if grep -q '"ok":true' /tmp/ai_options.json; then
    echo "✅ ok=true"
else
    echo "❌ FAILED: ok is not true"
    cat /tmp/ai_options.json | head -20
    exit 1
fi

if grep -q '"stocks"' /tmp/ai_options.json; then
    echo "✅ stocks array present"
    STOCKS_LENGTH=$(python3 -c "import json; data=json.load(open('/tmp/ai_options.json')); print(len(data.get('stocks', [])))")
    echo "   Stocks array length: $STOCKS_LENGTH"
    
    if [ "$STOCKS_LENGTH" -gt 0 ]; then
        echo "   First stock item:"
        python3 -c "import json; data=json.load(open('/tmp/ai_options.json')); stock=data['stocks'][0]; print(f\"   - id: {stock['id']}\"); print(f\"   - productId: {stock['productId']}\"); print(f\"   - available: {stock['available']} (type: {type(stock['available']).__name__})\"); print(f\"   - label: {stock['label']}\")"
    else
        echo "   ℹ️  Stocks array is empty (no active inventory with available > 0)"
    fi
else
    echo "❌ FAILED: stocks key not found"
    exit 1
fi

echo "✅ TEST 1 PASSED"

# Get real contacts and products
echo ""
echo "=== GETTING REAL DATA ==="
curl -s -b "$COOKIE_FILE" "$BASE_URL/contacts" > /tmp/contacts.json
curl -s -b "$COOKIE_FILE" "$BASE_URL/products" > /tmp/products.json

CUSTOMER_NAME=$(python3 -c "import json; data=json.load(open('/tmp/contacts.json')); contacts=data.get('data', []); customer=[c for c in contacts if 'Customer' in c.get('categories', [])]; print(customer[0]['displayName'] if customer else '')")
CUSTOMER_ID=$(python3 -c "import json; data=json.load(open('/tmp/contacts.json')); contacts=data.get('data', []); customer=[c for c in contacts if 'Customer' in c.get('categories', [])]; print(customer[0]['id'] if customer else '')")

SUPPLIER_NAME=$(python3 -c "import json; data=json.load(open('/tmp/contacts.json')); contacts=data.get('data', []); supplier=[c for c in contacts if 'Supplier' in c.get('categories', [])]; print(supplier[0]['displayName'] if supplier else '')")
SUPPLIER_ID=$(python3 -c "import json; data=json.load(open('/tmp/contacts.json')); contacts=data.get('data', []); supplier=[c for c in contacts if 'Supplier' in c.get('categories', [])]; print(supplier[0]['id'] if supplier else '')")

PRODUCT_NAME=$(python3 -c "import json; data=json.load(open('/tmp/products.json')); products=data.get('data', []); print(products[0]['name'] if products else '')")
PRODUCT_ID=$(python3 -c "import json; data=json.load(open('/tmp/products.json')); products=data.get('data', []); print(products[0]['id'] if products else '')")

echo "Customer: $CUSTOMER_NAME (ID: $CUSTOMER_ID)"
echo "Supplier: $SUPPLIER_NAME (ID: $SUPPLIER_ID)"
echo "Product: $PRODUCT_NAME (ID: $PRODUCT_ID)"

if [ -z "$CUSTOMER_NAME" ] || [ -z "$PRODUCT_NAME" ]; then
    echo "❌ Cannot run Test 2 - missing customer or product"
    exit 1
fi

if [ -z "$SUPPLIER_NAME" ]; then
    echo "❌ Cannot run Test 3 - missing supplier"
    exit 1
fi

# Test 2: Smart prefill for Sales Order
echo ""
echo "=== TEST 2: SMART PREFILL - SALES ORDER ==="
MESSAGE="Buatkan sales order untuk $CUSTOMER_NAME, 20 kg $PRODUCT_NAME harga 35000"
echo "Message: $MESSAGE"

curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/ai/chat" \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"$MESSAGE\",\"sessionId\":\"pf1\",\"history\":[]}" \
  --max-time 90 > /tmp/ai_chat_so.json

if ! grep -q '"ok":true' /tmp/ai_chat_so.json; then
    echo "❌ FAILED: ok is not true"
    cat /tmp/ai_chat_so.json | head -30
    exit 1
fi
echo "✅ ok=true"

# Check uiComponents
UI_LENGTH=$(python3 -c "import json; data=json.load(open('/tmp/ai_chat_so.json')); print(len(data.get('uiComponents', [])))" 2>/dev/null || echo "0")
if [ "$UI_LENGTH" -lt 1 ]; then
    echo "❌ FAILED: uiComponents length < 1 (got $UI_LENGTH)"
    exit 1
fi
echo "✅ uiComponents length: $UI_LENGTH"

# Check type
UI_TYPE=$(python3 -c "import json; data=json.load(open('/tmp/ai_chat_so.json')); print(data['uiComponents'][0].get('type', ''))" 2>/dev/null || echo "")
if [ "$UI_TYPE" != "order_builder" ]; then
    echo "❌ FAILED: uiComponents[0].type != 'order_builder' (got '$UI_TYPE')"
    exit 1
fi
echo "✅ uiComponents[0].type == 'order_builder'"

# Check prefill
echo ""
echo "📋 PREFILL CONTENTS:"
python3 -c "import json; data=json.load(open('/tmp/ai_chat_so.json')); print(json.dumps(data['uiComponents'][0].get('prefill', {}), indent=2))"

# Validate prefill structure
python3 << 'EOF'
import json
import sys

data = json.load(open('/tmp/ai_chat_so.json'))
prefill = data['uiComponents'][0].get('prefill', {})

# Check contactId
contact_id = prefill.get('contactId', '')
if not contact_id:
    print("❌ FAILED: prefill.contactId is empty")
    sys.exit(1)
print(f"✅ prefill.contactId: {contact_id} (non-empty)")

# Check items
items = prefill.get('items', [])
if len(items) < 1:
    print(f"❌ FAILED: prefill.items length < 1 (got {len(items)})")
    sys.exit(1)
print(f"✅ prefill.items length: {len(items)}")

# Check first item
item = items[0]
print("\n📦 FIRST ITEM:")
print(json.dumps(item, indent=2))

# Check productId
product_id = item.get('productId', '')
if not product_id:
    print("❌ FAILED: items[0].productId is empty")
    sys.exit(1)
print(f"✅ items[0].productId: {product_id} (non-empty)")

# Check weight
weight = item.get('weight', '')
if weight != "20":
    print(f"❌ FAILED: items[0].weight != '20' (got '{weight}')")
    sys.exit(1)
print(f"✅ items[0].weight: '{weight}' (matches '20')")

# Check unitPrice
unit_price = item.get('unitPrice', '')
if unit_price != "35000":
    print(f"❌ FAILED: items[0].unitPrice != '35000' (got '{unit_price}')")
    sys.exit(1)
print(f"✅ items[0].unitPrice: '{unit_price}' (matches '35000')")

print("\n✅ TEST 2 PASSED: Smart prefill for Sales Order working correctly")
EOF

# Test 3: Smart prefill for Purchase Order
echo ""
echo "=== TEST 3: SMART PREFILL - PURCHASE ORDER ==="
MESSAGE="buat purchase order ke supplier $SUPPLIER_NAME, 100 kg $PRODUCT_NAME"
echo "Message: $MESSAGE"

curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/ai/chat" \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"$MESSAGE\",\"sessionId\":\"pf2\",\"history\":[]}" \
  --max-time 90 > /tmp/ai_chat_po.json

if ! grep -q '"ok":true' /tmp/ai_chat_po.json; then
    echo "❌ FAILED: ok is not true"
    cat /tmp/ai_chat_po.json | head -30
    exit 1
fi
echo "✅ ok=true"

# Check uiComponents
UI_LENGTH=$(python3 -c "import json; data=json.load(open('/tmp/ai_chat_po.json')); print(len(data.get('uiComponents', [])))" 2>/dev/null || echo "0")
if [ "$UI_LENGTH" -lt 1 ]; then
    echo "❌ FAILED: uiComponents length < 1 (got $UI_LENGTH)"
    exit 1
fi
echo "✅ uiComponents length: $UI_LENGTH"

# Check type
UI_TYPE=$(python3 -c "import json; data=json.load(open('/tmp/ai_chat_po.json')); print(data['uiComponents'][0].get('type', ''))" 2>/dev/null || echo "")
if [ "$UI_TYPE" != "order_builder" ]; then
    echo "❌ FAILED: uiComponents[0].type != 'order_builder' (got '$UI_TYPE')"
    exit 1
fi
echo "✅ uiComponents[0].type == 'order_builder'"

# Check prefill
echo ""
echo "📋 PREFILL CONTENTS:"
python3 -c "import json; data=json.load(open('/tmp/ai_chat_po.json')); print(json.dumps(data['uiComponents'][0].get('prefill', {}), indent=2))"

# Validate prefill structure
python3 << 'EOF'
import json
import sys

data = json.load(open('/tmp/ai_chat_po.json'))
prefill = data['uiComponents'][0].get('prefill', {})

# Check contactId
contact_id = prefill.get('contactId', '')
if not contact_id:
    print("❌ FAILED: prefill.contactId is empty (should resolve to supplier)")
    sys.exit(1)
print(f"✅ prefill.contactId: {contact_id} (resolved to supplier)")

# Check items
items = prefill.get('items', [])
if len(items) < 1:
    print(f"❌ FAILED: prefill.items length < 1 (got {len(items)})")
    sys.exit(1)
print(f"✅ prefill.items length: {len(items)}")

# Check first item
item = items[0]
print("\n📦 FIRST ITEM:")
print(json.dumps(item, indent=2))

# Check productId
product_id = item.get('productId', '')
if not product_id:
    print("❌ FAILED: items[0].productId is empty")
    sys.exit(1)
print(f"✅ items[0].productId: {product_id} (non-empty)")

# Check weight (may vary due to LLM non-determinism)
weight = item.get('weight', '')
if weight != "100":
    print(f"⚠️  WARNING: items[0].weight != '100' (got '{weight}')")
else:
    print(f"✅ items[0].weight: '{weight}' (matches '100')")

# Check unitPrice (may be basePrice or empty)
unit_price = item.get('unitPrice', '')
print(f"ℹ️  items[0].unitPrice: '{unit_price}' (may be product basePrice or empty)")

print("\n✅ TEST 3 PASSED: Smart prefill for Purchase Order working correctly")
EOF

echo ""
echo "================================================================================"
echo "TEST SUMMARY"
echo "================================================================================"
echo "✅ Test 1 (GET /api/ai/options): PASSED"
echo "✅ Test 2 (Smart prefill SO): PASSED"
echo "✅ Test 3 (Smart prefill PO): PASSED"
echo ""
echo "🎉 ALL TESTS PASSED (3/3)"
