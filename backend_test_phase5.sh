#!/bin/bash
set -e

# MIGRATION PHASE 5 Backend Test
# Tests PO aggregate + Commission + SO-extra (Surat Jalan/Retur/Penerimaan) MongoDB-authoritative

BASE_URL="http://localhost:3000"
COOKIE_FILE="/tmp/admin_cookies.txt"
OP_COOKIE_FILE="/tmp/operator_cookies.txt"

echo "================================================================================"
echo "MIGRATION PHASE 5 BACKEND TEST"
echo "PO aggregate + Commission + SO-extra (Surat Jalan/Retur/Penerimaan)"
echo "================================================================================"

# Login as admin
echo ""
echo "🔐 Logging in as admin@lpi.co.id..."
curl -s -c "$COOKIE_FILE" -X POST "$BASE_URL/api/auth/sign-in/email" \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}' > /dev/null

if [ $? -eq 0 ]; then
  echo "✅ Admin login successful"
else
  echo "❌ Admin login failed"
  exit 1
fi

# Login as operator
echo ""
echo "🔐 Logging in as operator@lpi.co.id..."
curl -s -c "$OP_COOKIE_FILE" -X POST "$BASE_URL/api/auth/sign-in/email" \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"email":"operator@lpi.co.id","password":"operator123"}' > /dev/null

if [ $? -eq 0 ]; then
  echo "✅ Operator login successful"
else
  echo "❌ Operator login failed"
fi

# Get MongoDB counts using Python
echo ""
echo "================================================================================"
echo "INITIAL STATE - MongoDB Collections"
echo "================================================================================"

python3 << 'PYTHON_SCRIPT'
from pymongo import MongoClient
import os

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
MONGO_DB_NAME = "erp_prod"

client = MongoClient(MONGO_URL)
db = client[MONGO_DB_NAME]

collections = [
    "purchase_order", "purchase_order_items", "grn", "grn_items", 
    "grn_documents", "purchase_payments", "purchase_returns",
    "surat_jalan", "sales_returns", "sales_order_receipts", 
    "sales_order_receipt_items", "commission_records", "commission_payments"
]

print("\nMongoDB collection counts:")
for coll in collections:
    count = db[coll].count_documents({})
    print(f"  {coll}: {count}")

# Save initial counts
with open("/tmp/initial_mongo_counts.txt", "w") as f:
    for coll in collections:
        count = db[coll].count_documents({})
        f.write(f"{coll}:{count}\n")
PYTHON_SCRIPT

# Get SQLite counts
echo ""
echo "SQLite non-owned table counts:"
sqlite3 /app/data/erp.db "SELECT 'sales_order: ' || COUNT(*) FROM sales_order;"
sqlite3 /app/data/erp.db "SELECT 'contacts: ' || COUNT(*) FROM contacts;"

# Save initial SQLite counts
sqlite3 /app/data/erp.db "SELECT COUNT(*) FROM sales_order;" > /tmp/initial_so_count.txt
sqlite3 /app/data/erp.db "SELECT COUNT(*) FROM contacts;" > /tmp/initial_contacts_count.txt

echo ""
echo "================================================================================"
echo "Running Python test script..."
echo "================================================================================"

# Run the comprehensive Python test
python3 /app/backend_test_phase5.py

echo ""
echo "================================================================================"
echo "Test complete!"
echo "================================================================================"
