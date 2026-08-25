#!/bin/bash

BASE_URL="http://localhost:3000"
COOKIE_FILE="/tmp/cleanup_cookie.txt"

# Login
curl -s -c "$COOKIE_FILE" -X POST "$BASE_URL/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}' > /dev/null

echo "=== CLEANUP: Resetting inventory data ==="
echo ""

# Execute reset
RESET=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/maintenance/reset-inventory" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"token":"LPI-RESET-INV-2026-9f3a7c1e5b8d42a6","confirm":"HAPUS-INVENTORY"}')

if echo "$RESET" | grep -q '"ok":true'; then
  echo "✅ Cleanup successful"
else
  echo "❌ Cleanup failed"
  echo "Response: $RESET"
fi

rm -f "$COOKIE_FILE"
