#!/bin/bash
# Backend test for Shipping Cost (Biaya Kirim) on Sales Orders
# Tests buyer-borne vs seller-borne shipping cost handling

set -e

BASE_URL="http://localhost:3000/api"
ORIGIN="http://localhost:3000"
DB_PATH="/app/data/erp.db"
COOKIE_FILE="/tmp/test_cookies.txt"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test data IDs (will be generated)
TEST_CUSTOMER_ID=""
TEST_PRODUCT_ID=""
TEST_SO_ID=""
TEST_SO_ITEM_ID=""
TEST_SO_NUMBER=""

echo "================================================================================"
echo "SHIPPING COST (BIAYA KIRIM) BACKEND TEST"
echo "================================================================================"

# Login as admin
echo "Logging in as admin..."
LOGIN_RESPONSE=$(curl -s -c "$COOKIE_FILE" -X POST "$BASE_URL/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}')

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Login failed${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Login successful${NC}"

# Seed test data
echo "Seeding test data..."

TEST_CUSTOMER_ID=$(python3 -c "import uuid; print(str(uuid.uuid4()))")
TEST_PRODUCT_ID=$(python3 -c "import uuid; print(str(uuid.uuid4()))")
TEST_SO_ID=$(python3 -c "import uuid; print(str(uuid.uuid4()))")
TEST_SO_ITEM_ID=$(python3 -c "import uuid; print(str(uuid.uuid4()))")
TEST_SO_NUMBER="SO/TEST/$(date +%Y%m%d%H%M%S)"

python3 << EOF
import sqlite3
import json
from datetime import datetime

conn = sqlite3.connect('$DB_PATH')
cursor = conn.cursor()

try:
    # Create test customer
    cursor.execute("""
        INSERT INTO contacts (id, contact_type, code, display_name, categories, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        '$TEST_CUSTOMER_ID',
        'Customer',
        'CUST-TEST-$(date +%Y%m%d%H%M%S)',
        'Test Customer for Shipping',
        json.dumps(['Customer']),
        datetime.now().isoformat(),
        datetime.now().isoformat()
    ))
    
    # Create test product
    cursor.execute("""
        INSERT INTO products (id, sku, name, unit, base_price, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        '$TEST_PRODUCT_ID',
        'SHIP-TEST-$(date +%H%M%S)',
        'Test Product for Shipping',
        'kg',
        40000.0,
        datetime.now().isoformat(),
        datetime.now().isoformat()
    ))
    
    # Create test SO
    cursor.execute("""
        INSERT INTO sales_order (
            id, so_number, customer_id, pipeline_status, fulfillment_type,
            order_date, total_amount, shipping_cost, shipping_bearer, shipping_pay_method,
            created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        '$TEST_SO_ID',
        '$TEST_SO_NUMBER',
        '$TEST_CUSTOMER_ID',
        'Draft',
        'stock',
        datetime.now().isoformat(),
        400000.0,
        0.0,
        'seller',
        'transfer',
        datetime.now().isoformat(),
        datetime.now().isoformat()
    ))
    
    # Create test SO item
    cursor.execute("""
        INSERT INTO sales_order_items (
            id, sales_order_id, product_id, quantity, weight, unit_price, subtotal
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        '$TEST_SO_ITEM_ID',
        '$TEST_SO_ID',
        '$TEST_PRODUCT_ID',
        1,
        10.0,
        40000.0,
        400000.0
    ))
    
    conn.commit()
    print('✅ Test data seeded successfully')
    print(f'   Customer ID: $TEST_CUSTOMER_ID')
    print(f'   Product ID: $TEST_PRODUCT_ID')
    print(f'   SO ID: $TEST_SO_ID')
    print(f'   SO Number: $TEST_SO_NUMBER')
    
except Exception as e:
    conn.rollback()
    print(f'❌ Failed to seed test data: {e}')
    exit(1)
finally:
    conn.close()
EOF

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Failed to seed test data${NC}"
  exit 1
fi

# TEST A: BUYER-BORNE SHIPPING
echo ""
echo "================================================================================"
echo "TEST A: BUYER-BORNE SHIPPING (adds to invoice total)"
echo "================================================================================"

# PATCH SO with buyer-borne shipping
PATCH_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X PATCH "$BASE_URL/sales-orders/$TEST_SO_ID" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"shippingCost":50000,"shippingBearer":"buyer","shippingPayMethod":"transfer"}')

if echo "$PATCH_RESPONSE" | grep -q "error"; then
  echo -e "${RED}❌ PATCH failed: $PATCH_RESPONSE${NC}"
  TEST_A_PASSED=false
else
  echo -e "${GREEN}✅ PATCH successful${NC}"
  
  # GET SO to verify
  GET_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X GET "$BASE_URL/sales-orders/$TEST_SO_ID")
  
  if echo "$GET_RESPONSE" | grep -q "error"; then
    echo -e "${RED}❌ GET failed: $GET_RESPONSE${NC}"
    TEST_A_PASSED=false
  else
    echo ""
    echo "📊 ACTUAL VALUES:"
    echo "$GET_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
print(f\"   total_amount: Rp {data.get('totalAmount', 0):,.0f}\")
print(f\"   buyerShipping: Rp {data.get('buyerShipping', 0):,.0f}\")
print(f\"   sellerShipping: Rp {data.get('sellerShipping', 0):,.0f}\")
print(f\"   goodsRevenue: Rp {data.get('goodsRevenue', 0):,.0f}\")
print(f\"   grossProfit: Rp {data.get('grossProfit', 0):,.0f}\")
print(f\"   shipping_pay_method: {data.get('shippingPayMethod', 'N/A')}\")

# Verify
goods_subtotal = 400000
expected_total = goods_subtotal + 50000

if data.get('totalAmount') == expected_total and \
   data.get('buyerShipping') == 50000 and \
   data.get('sellerShipping') == 0 and \
   data.get('goodsRevenue') == goods_subtotal and \
   data.get('shippingPayMethod') == 'transfer':
    print()
    print('✅ TEST A PASSED: Buyer-borne shipping adds to invoice total')
    sys.exit(0)
else:
    print()
    print('❌ TEST A FAILED: Values do not match expected')
    sys.exit(1)
"
    if [ $? -eq 0 ]; then
      TEST_A_PASSED=true
    else
      TEST_A_PASSED=false
    fi
  fi
fi

# TEST B: SELLER-BORNE SHIPPING
echo ""
echo "================================================================================"
echo "TEST B: SELLER-BORNE SHIPPING (reduces margin, NOT in invoice)"
echo "================================================================================"

# PATCH SO with seller-borne shipping
PATCH_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X PATCH "$BASE_URL/sales-orders/$TEST_SO_ID" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"shippingCost":50000,"shippingBearer":"seller"}')

if echo "$PATCH_RESPONSE" | grep -q "error"; then
  echo -e "${RED}❌ PATCH failed: $PATCH_RESPONSE${NC}"
  TEST_B_PASSED=false
else
  echo -e "${GREEN}✅ PATCH successful${NC}"
  
  # GET SO to verify
  GET_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X GET "$BASE_URL/sales-orders/$TEST_SO_ID")
  
  if echo "$GET_RESPONSE" | grep -q "error"; then
    echo -e "${RED}❌ GET failed: $GET_RESPONSE${NC}"
    TEST_B_PASSED=false
  else
    echo ""
    echo "📊 ACTUAL VALUES:"
    echo "$GET_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']
print(f\"   total_amount: Rp {data.get('totalAmount', 0):,.0f}\")
print(f\"   buyerShipping: Rp {data.get('buyerShipping', 0):,.0f}\")
print(f\"   sellerShipping: Rp {data.get('sellerShipping', 0):,.0f}\")
print(f\"   goodsRevenue: Rp {data.get('goodsRevenue', 0):,.0f}\")
print(f\"   grossProfit: Rp {data.get('grossProfit', 0):,.0f}\")

# Verify
goods_subtotal = 400000

if data.get('totalAmount') == goods_subtotal and \
   data.get('buyerShipping') == 0 and \
   data.get('sellerShipping') == 50000 and \
   data.get('goodsRevenue') == goods_subtotal:
    print()
    print('✅ TEST B PASSED: Seller-borne shipping NOT in invoice, reduces margin')
    sys.exit(0)
else:
    print()
    print('❌ TEST B FAILED: Values do not match expected')
    sys.exit(1)
"
    if [ $? -eq 0 ]; then
      TEST_B_PASSED=true
    else
      TEST_B_PASSED=false
    fi
  fi
fi

# TEST C: ACCOUNTING JOURNAL
echo ""
echo "================================================================================"
echo "TEST C: ACCOUNTING JOURNAL (SO_SHIP with Beban Ongkir)"
echo "================================================================================"

# Set SO to Invoiced status
python3 << EOF
import sqlite3
from datetime import datetime

conn = sqlite3.connect('$DB_PATH')
cursor = conn.cursor()

cursor.execute("""
    UPDATE sales_order 
    SET pipeline_status = 'Invoiced', 
        invoice_number = ?,
        invoice_date = ?
    WHERE id = ?
""", ('INV/TEST/$(date +%Y%m%d%H%M%S)', datetime.now().isoformat(), '$TEST_SO_ID'))

conn.commit()
conn.close()
print('✅ SO set to Invoiced status')
EOF

# Trigger accounting sync
SYNC_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/accounting/sync" \
  -H "Origin: $ORIGIN")

if echo "$SYNC_RESPONSE" | grep -q "error"; then
  echo -e "${RED}❌ Accounting sync failed: $SYNC_RESPONSE${NC}"
  TEST_C_PASSED=false
else
  echo -e "${GREEN}✅ Accounting sync successful${NC}"
  
  # Verify SO_SHIP journal in DB
  python3 << EOF
import sqlite3

conn = sqlite3.connect('$DB_PATH')
cursor = conn.cursor()

cursor.execute("""
    SELECT id, source_type, source_number, total_debit, total_credit
    FROM journal_entries
    WHERE source_type = 'SO_SHIP' AND source_id = ?
""", ('$TEST_SO_ID',))

journal = cursor.fetchone()

if not journal:
    print('❌ SO_SHIP journal not found')
    conn.close()
    exit(1)

journal_id = journal[0]
print(f'✅ SO_SHIP journal found: {journal[2]}')
print(f'   Total Debit: Rp {journal[3]:,.0f}')
print(f'   Total Credit: Rp {journal[4]:,.0f}')

# Get journal lines
cursor.execute("""
    SELECT account_code, debit, credit, description
    FROM journal_lines
    WHERE journal_id = ?
    ORDER BY debit DESC
""", (journal_id,))

lines = cursor.fetchall()

print()
print('📊 JOURNAL LINES:')
for line in lines:
    print(f'   Account: {line[0]}, Dr: Rp {line[1]:,.0f}, Cr: Rp {line[2]:,.0f}')

# Verify
debit_line = [l for l in lines if l[1] > 0][0]
credit_line = [l for l in lines if l[2] > 0][0]

if debit_line[0] == '6-1300' and debit_line[1] == 50000 and credit_line[2] == 50000:
    print()
    print('✅ TEST C PASSED: SO_SHIP journal created with correct accounts')
    conn.close()
    exit(0)
else:
    print()
    print(f'❌ TEST C FAILED: Expected Dr 6-1300 50000, got Dr {debit_line[0]} {debit_line[1]}')
    conn.close()
    exit(1)
EOF
  
  if [ $? -eq 0 ]; then
    TEST_C_PASSED=true
  else
    TEST_C_PASSED=false
  fi
fi

# TEST D: SALES PROFIT REPORT
echo ""
echo "================================================================================"
echo "TEST D: SALES PROFIT REPORT"
echo "================================================================================"

REPORT_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X GET "$BASE_URL/accounting/sales-profit?from=2020-01-01&to=2030-12-31")

if echo "$REPORT_RESPONSE" | grep -q "error"; then
  echo -e "${RED}❌ Sales profit report failed: $REPORT_RESPONSE${NC}"
  TEST_D_PASSED=false
else
  echo -e "${GREEN}✅ Sales profit report retrieved${NC}"
  TEST_D_PASSED=true
fi

# TEST E: REGRESSION
echo ""
echo "================================================================================"
echo "TEST E: REGRESSION - SO WITH NO SHIPPING"
echo "================================================================================"

TEST_SO_ID_2=$(python3 -c "import uuid; print(str(uuid.uuid4()))")
TEST_SO_ITEM_ID_2=$(python3 -c "import uuid; print(str(uuid.uuid4()))")
TEST_SO_NUMBER_2="SO/TEST2/$(date +%Y%m%d%H%M%S)"

python3 << EOF
import sqlite3
from datetime import datetime

conn = sqlite3.connect('$DB_PATH')
cursor = conn.cursor()

try:
    cursor.execute("""
        INSERT INTO sales_order (
            id, so_number, customer_id, pipeline_status, fulfillment_type,
            order_date, total_amount, shipping_cost, shipping_bearer, shipping_pay_method,
            created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        '$TEST_SO_ID_2',
        '$TEST_SO_NUMBER_2',
        '$TEST_CUSTOMER_ID',
        'Draft',
        'stock',
        datetime.now().isoformat(),
        400000.0,
        0.0,
        'seller',
        'transfer',
        datetime.now().isoformat(),
        datetime.now().isoformat()
    ))
    
    cursor.execute("""
        INSERT INTO sales_order_items (
            id, sales_order_id, product_id, quantity, weight, unit_price, subtotal
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        '$TEST_SO_ITEM_ID_2',
        '$TEST_SO_ID_2',
        '$TEST_PRODUCT_ID',
        1,
        10.0,
        40000.0,
        400000.0
    ))
    
    conn.commit()
    print('✅ Second SO created: $TEST_SO_NUMBER_2')
except Exception as e:
    conn.rollback()
    print(f'❌ Failed to create second SO: {e}')
    exit(1)
finally:
    conn.close()
EOF

GET_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X GET "$BASE_URL/sales-orders/$TEST_SO_ID_2")

if echo "$GET_RESPONSE" | grep -q "error"; then
  echo -e "${RED}❌ GET failed: $GET_RESPONSE${NC}"
  TEST_E_PASSED=false
else
  echo "$GET_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)['data']

if data.get('totalAmount') == 400000 and \
   data.get('buyerShipping') == 0 and \
   data.get('sellerShipping') == 0 and \
   data.get('goodsRevenue') == 400000:
    print('✅ TEST E PASSED: SO without shipping works correctly')
    sys.exit(0)
else:
    print('❌ TEST E FAILED: Values do not match expected')
    sys.exit(1)
"
  if [ $? -eq 0 ]; then
    TEST_E_PASSED=true
  else
    TEST_E_PASSED=false
  fi
fi

# Cleanup second SO
python3 << EOF
import sqlite3
conn = sqlite3.connect('$DB_PATH')
cursor = conn.cursor()
cursor.execute("DELETE FROM sales_order_items WHERE sales_order_id = ?", ('$TEST_SO_ID_2',))
cursor.execute("DELETE FROM sales_order WHERE id = ?", ('$TEST_SO_ID_2',))
conn.commit()
conn.close()
EOF

# CLEANUP
echo ""
echo "================================================================================"
echo "CLEANUP"
echo "================================================================================"

python3 << EOF
import sqlite3

conn = sqlite3.connect('$DB_PATH')
cursor = conn.cursor()

try:
    cursor.execute("DELETE FROM journal_lines WHERE journal_id IN (SELECT id FROM journal_entries WHERE source_id = ?)", ('$TEST_SO_ID',))
    cursor.execute("DELETE FROM journal_entries WHERE source_id = ?", ('$TEST_SO_ID',))
    cursor.execute("DELETE FROM sales_order_items WHERE sales_order_id = ?", ('$TEST_SO_ID',))
    cursor.execute("DELETE FROM sales_order WHERE id = ?", ('$TEST_SO_ID',))
    cursor.execute("DELETE FROM products WHERE id = ?", ('$TEST_PRODUCT_ID',))
    cursor.execute("DELETE FROM contacts WHERE id = ?", ('$TEST_CUSTOMER_ID',))
    
    conn.commit()
    
    cursor.execute("SELECT COUNT(*) FROM sales_order WHERE id = ?", ('$TEST_SO_ID',))
    so_count = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM journal_entries WHERE source_type IN ('SO_INV', 'SO_SHIP') AND source_id = ?", ('$TEST_SO_ID',))
    journal_count = cursor.fetchone()[0]
    
    print('✅ Cleanup complete')
    print(f'   Remaining SO count: {so_count}')
    print(f'   Remaining journal count: {journal_count}')
except Exception as e:
    conn.rollback()
    print(f'❌ Failed to cleanup: {e}')
finally:
    conn.close()
EOF

# SUMMARY
echo ""
echo "================================================================================"
echo "TEST SUMMARY"
echo "================================================================================"

PASSED_COUNT=0
TOTAL_COUNT=5

if [ "$TEST_A_PASSED" = true ]; then
  echo -e "${GREEN}✅ PASSED: TEST A (Buyer-borne)${NC}"
  PASSED_COUNT=$((PASSED_COUNT + 1))
else
  echo -e "${RED}❌ FAILED: TEST A (Buyer-borne)${NC}"
fi

if [ "$TEST_B_PASSED" = true ]; then
  echo -e "${GREEN}✅ PASSED: TEST B (Seller-borne)${NC}"
  PASSED_COUNT=$((PASSED_COUNT + 1))
else
  echo -e "${RED}❌ FAILED: TEST B (Seller-borne)${NC}"
fi

if [ "$TEST_C_PASSED" = true ]; then
  echo -e "${GREEN}✅ PASSED: TEST C (Accounting journal)${NC}"
  PASSED_COUNT=$((PASSED_COUNT + 1))
else
  echo -e "${RED}❌ FAILED: TEST C (Accounting journal)${NC}"
fi

if [ "$TEST_D_PASSED" = true ]; then
  echo -e "${GREEN}✅ PASSED: TEST D (Sales profit report)${NC}"
  PASSED_COUNT=$((PASSED_COUNT + 1))
else
  echo -e "${RED}❌ FAILED: TEST D (Sales profit report)${NC}"
fi

if [ "$TEST_E_PASSED" = true ]; then
  echo -e "${GREEN}✅ PASSED: TEST E (Regression)${NC}"
  PASSED_COUNT=$((PASSED_COUNT + 1))
else
  echo -e "${RED}❌ FAILED: TEST E (Regression)${NC}"
fi

echo ""
echo "Total: $PASSED_COUNT/$TOTAL_COUNT tests passed ($((PASSED_COUNT * 100 / TOTAL_COUNT))%)"

if [ $PASSED_COUNT -eq $TOTAL_COUNT ]; then
  echo -e "${GREEN}🎉 ALL TESTS PASSED!${NC}"
else
  echo -e "${YELLOW}⚠️  $((TOTAL_COUNT - PASSED_COUNT)) test(s) failed${NC}"
fi

# Cleanup cookie file
rm -f "$COOKIE_FILE"
