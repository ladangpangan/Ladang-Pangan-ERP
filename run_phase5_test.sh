#!/bin/bash
set -e

# MIGRATION PHASE 5 Backend Test Wrapper
# Handles authentication and runs the Python test script

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

# Run the Python test script
echo ""
python3 /app/backend_test_phase5_simple.py

echo ""
echo "================================================================================"
echo "Test complete!"
echo "================================================================================"
