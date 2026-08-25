#!/bin/bash
# MIGRATION Phase 7 Backend Test using curl
# Work Order (produksi) + Approvals MongoDB-authoritative

set -e

BASE_URL="http://localhost:3000/api"
COOKIE_FILE="/tmp/admin_cookies.txt"
OPERATOR_COOKIE_FILE="/tmp/operator_cookies.txt"

echo "================================================================================"
echo "  MIGRATION PHASE 7 BACKEND TEST"
echo "  Work Order (produksi) + Approvals MongoDB-authoritative"
echo "================================================================================"

# Login as admin
echo ""
echo "Logging in as admin..."
curl -s -c "$COOKIE_FILE" -X POST \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}' \
  "http://localhost:3000/api/auth/sign-in/email" > /dev/null

if [ $? -eq 0 ]; then
  echo "✓ Logged in as admin@lpi.co.id"
else
  echo "✗ Failed to login as admin"
  exit 1
fi

# Get initial MongoDB counts
echo ""
echo "================================================================================"
echo "  INITIAL MONGODB STATE"
echo "================================================================================"

python3 << 'PYEOF'
from pymongo import MongoClient
client = MongoClient("mongodb://localhost:27017")
db = client["erp_prod"]
collections = ["wo_stages", "work_order", "work_order_details", "wo_stage_records", "wo_outputs", "wo_custom_costs", "approvals"]
for coll in collections:
    count = db[coll].count_documents({})
    print(f"  {coll}: {count} documents")
PYEOF

# ============================================================================
# SCENARIO 1: WO STAGES (master data)
# ============================================================================
echo ""
echo "================================================================================"
echo "  SCENARIO 1: WO STAGES (master data)"
echo "================================================================================"

# 1.1: GET /api/wo-stages
echo ""
echo "1.1) GET /api/wo-stages (list)"
RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/wo-stages")
INITIAL_COUNT=$(echo "$RESPONSE" | jq '.data | length')
echo "  Initial wo_stages count: $INITIAL_COUNT"
if [ "$INITIAL_COUNT" -ge 4 ]; then
  echo "  ✅ PASSED: Found $INITIAL_COUNT stages (expected >= 4)"
else
  echo "  ❌ FAILED: Found $INITIAL_COUNT stages (expected >= 4)"
fi

# 1.2: POST /api/wo-stages (create)
echo ""
echo "1.2) POST /api/wo-stages (create)"
CREATE_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"code":"TST","name":"Tahap Uji","sequenceOrder":9,"fieldsSchema":"[]"}' \
  "$BASE_URL/wo-stages")

STAGE_ID=$(echo "$CREATE_RESPONSE" | jq -r '.data.id // empty')
if [ -n "$STAGE_ID" ]; then
  echo "  Created stage ID: $STAGE_ID"
  
  # Verify in MongoDB
  MONGO_CHECK=$(python3 << PYEOF
from pymongo import MongoClient
client = MongoClient("mongodb://localhost:27017")
db = client["erp_prod"]
stage = db["wo_stages"].find_one({"id": "$STAGE_ID"})
if stage and stage.get("code") == "TST":
    print("FOUND")
else:
    print("NOT_FOUND")
PYEOF
)
  
  if [ "$MONGO_CHECK" = "FOUND" ]; then
    echo "  ✅ PASSED: Stage created in MongoDB with code TST"
  else
    echo "  ❌ FAILED: Stage not found in MongoDB"
  fi
else
  echo "  ❌ FAILED: Failed to create stage"
  echo "  Response: $CREATE_RESPONSE"
fi

# 1.3: PUT /api/wo-stages/:id (rename)
if [ -n "$STAGE_ID" ]; then
  echo ""
  echo "1.3) PUT /api/wo-stages/:id (rename)"
  UPDATE_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X PUT \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:3000" \
    -d '{"code":"TST","name":"Tahap Uji Updated","sequenceOrder":9,"fieldsSchema":"[]"}' \
    "$BASE_URL/wo-stages/$STAGE_ID")
  
  # Verify in MongoDB
  MONGO_CHECK=$(python3 << PYEOF
from pymongo import MongoClient
client = MongoClient("mongodb://localhost:27017")
db = client["erp_prod"]
stage = db["wo_stages"].find_one({"id": "$STAGE_ID"})
if stage and stage.get("name") == "Tahap Uji Updated":
    print("UPDATED")
else:
    print("NOT_UPDATED")
PYEOF
)
  
  if [ "$MONGO_CHECK" = "UPDATED" ]; then
    echo "  ✅ PASSED: Stage renamed in MongoDB"
  else
    echo "  ❌ FAILED: Stage name not updated in MongoDB"
  fi
  
  # 1.4: DELETE /api/wo-stages/:id
  echo ""
  echo "1.4) DELETE /api/wo-stages/:id"
  DELETE_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X DELETE \
    -H "Origin: http://localhost:3000" \
    "$BASE_URL/wo-stages/$STAGE_ID")
  
  # Verify removed from MongoDB
  MONGO_CHECK=$(python3 << PYEOF
from pymongo import MongoClient
client = MongoClient("mongodb://localhost:27017")
db = client["erp_prod"]
stage = db["wo_stages"].find_one({"id": "$STAGE_ID"})
if stage is None:
    print("DELETED")
else:
    print("STILL_EXISTS")
PYEOF
)
  
  if [ "$MONGO_CHECK" = "DELETED" ]; then
    echo "  ✅ PASSED: Stage removed from MongoDB"
  else
    echo "  ❌ FAILED: Stage still exists in MongoDB"
  fi
fi

# ============================================================================
# SCENARIO 2: WORK ORDER CREATE
# ============================================================================
echo ""
echo "================================================================================"
echo "  SCENARIO 2: WORK ORDER CREATE"
echo "================================================================================"

echo ""
echo "2.1) POST /api/work-orders (create)"
WO_CREATE_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d "{\"mode\":\"Internal\",\"startDate\":\"$(date -Iseconds)\",\"baseCost\":1000000,\"notes\":\"Test WO for Phase 7 migration\"}" \
  "$BASE_URL/work-orders")

WO_ID=$(echo "$WO_CREATE_RESPONSE" | jq -r '.data.id // empty')
WO_NUMBER=$(echo "$WO_CREATE_RESPONSE" | jq -r '.data.woNumber // empty')

if [ -n "$WO_ID" ]; then
  echo "  Created WO: $WO_NUMBER (ID: $WO_ID)"
  
  # Verify in MongoDB
  MONGO_CHECK=$(python3 << PYEOF
from pymongo import MongoClient
client = MongoClient("mongodb://localhost:27017")
db = client["erp_prod"]
wo = db["work_order"].find_one({"id": "$WO_ID"})
if wo and wo.get("woNumber") == "$WO_NUMBER":
    print("FOUND")
else:
    print("NOT_FOUND")
PYEOF
)
  
  if [ "$MONGO_CHECK" = "FOUND" ]; then
    echo "  ✅ PASSED: WO created in MongoDB: $WO_NUMBER"
  else
    echo "  ❌ FAILED: WO not found in MongoDB"
  fi
  
  # 2.2: GET /api/work-orders (list)
  echo ""
  echo "2.2) GET /api/work-orders (list)"
  WO_LIST=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/work-orders")
  WO_FOUND=$(echo "$WO_LIST" | jq ".data[] | select(.id == \"$WO_ID\") | .id" | wc -l)
  
  if [ "$WO_FOUND" -gt 0 ]; then
    echo "  ✅ PASSED: WO found in list"
  else
    echo "  ❌ FAILED: WO not in list"
  fi
  
  # 2.3: GET /api/work-orders/:id (detail)
  echo ""
  echo "2.3) GET /api/work-orders/:id (detail)"
  WO_DETAIL=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/work-orders/$WO_ID")
  WO_DETAIL_ID=$(echo "$WO_DETAIL" | jq -r '.data.id // empty')
  
  if [ "$WO_DETAIL_ID" = "$WO_ID" ]; then
    echo "  ✅ PASSED: WO detail retrieved: $WO_NUMBER"
  else
    echo "  ❌ FAILED: WO detail mismatch"
  fi
else
  echo "  ❌ FAILED: Failed to create WO"
  echo "  Response: $WO_CREATE_RESPONSE"
fi

# ============================================================================
# SCENARIO 4: APPROVALS FLOW (core)
# ============================================================================
echo ""
echo "================================================================================"
echo "  SCENARIO 4: APPROVALS FLOW (core)"
echo "================================================================================"

# Get a customer
echo ""
echo "4.1) Create Sales Order for return test"
CUSTOMERS=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/contacts?category=Customer")
CUSTOMER_ID=$(echo "$CUSTOMERS" | jq -r '.data[0].id // empty')
CUSTOMER_NAME=$(echo "$CUSTOMERS" | jq -r '.data[0].displayName // empty')

if [ -z "$CUSTOMER_ID" ]; then
  echo "  ❌ FAILED: No customers found"
else
  echo "  Using customer: $CUSTOMER_NAME (ID: $CUSTOMER_ID)"
  
  # Get a product
  PRODUCTS=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/products")
  PRODUCT_ID=$(echo "$PRODUCTS" | jq -r '.data[0].id // empty')
  PRODUCT_NAME=$(echo "$PRODUCTS" | jq -r '.data[0].name // empty')
  
  if [ -z "$PRODUCT_ID" ]; then
    echo "  ❌ FAILED: No products found"
  else
    echo "  Using product: $PRODUCT_NAME (ID: $PRODUCT_ID)"
    
    # Create Sales Order
    SO_CREATE=$(curl -s -b "$COOKIE_FILE" -X POST \
      -H "Content-Type: application/json" \
      -H "Origin: http://localhost:3000" \
      -d "{\"customerId\":\"$CUSTOMER_ID\",\"orderDate\":\"$(date -Iseconds)\",\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":1,\"weight\":10,\"unitPrice\":50000}]}" \
      "$BASE_URL/sales-orders")
    
    SO_ID=$(echo "$SO_CREATE" | jq -r '.data.id // empty')
    SO_NUMBER=$(echo "$SO_CREATE" | jq -r '.data.soNumber // empty')
    
    if [ -n "$SO_ID" ]; then
      echo "  Created SO: $SO_NUMBER (ID: $SO_ID)"
      echo "  ✅ PASSED: SO created"
      
      # 4.2: Create a sales return (triggers approval)
      echo ""
      echo "4.2) POST /api/sales-orders/:id/returns (trigger approval)"
      RETURN_CREATE=$(curl -s -b "$COOKIE_FILE" -X POST \
        -H "Content-Type: application/json" \
        -H "Origin: http://localhost:3000" \
        -d "{\"returnDate\":\"$(date -Iseconds)\",\"reason\":\"Test return for approval flow\",\"resolution\":\"potong_invoice\",\"totalAmount\":50000,\"totalWeight\":1,\"notes\":\"Phase 7 migration test\"}" \
        "$BASE_URL/sales-orders/$SO_ID/returns")
      
      RETURN_ID=$(echo "$RETURN_CREATE" | jq -r '.data.id // empty')
      RETURN_NUMBER=$(echo "$RETURN_CREATE" | jq -r '.data.returnNumber // empty')
      
      if [ -n "$RETURN_ID" ]; then
        echo "  Created return: $RETURN_NUMBER (ID: $RETURN_ID)"
        
        # Wait for approval to be created
        sleep 2
        
        # 4.3: GET /api/approvals (find the new approval)
        echo ""
        echo "4.3) GET /api/approvals (find new approval)"
        APPROVALS=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/approvals")
        APPROVAL_ID=$(echo "$APPROVALS" | jq -r ".data[] | select(.entityId == \"$RETURN_ID\" and .concernType == \"sales_return\") | .id" | head -1)
        
        if [ -n "$APPROVAL_ID" ]; then
          echo "  Found approval ID: $APPROVAL_ID"
          
          # Verify in MongoDB
          MONGO_APPROVAL=$(python3 << PYEOF
from pymongo import MongoClient
client = MongoClient("mongodb://localhost:27017")
db = client["erp_prod"]
approval = db["approvals"].find_one({"id": "$APPROVAL_ID"})
if approval:
    print(f"FOUND:{approval.get('status')}")
else:
    print("NOT_FOUND")
PYEOF
)
          
          if [[ "$MONGO_APPROVAL" == FOUND:* ]]; then
            STATUS="${MONGO_APPROVAL#FOUND:}"
            echo "  MongoDB approval status: $STATUS"
            echo "  ✅ PASSED: Approval found in MongoDB with status '$STATUS'"
            
            # 4.4: Approve the approval
            echo ""
            echo "4.4) POST /api/approvals/:id/action (approve)"
            APPROVE_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST \
              -H "Content-Type: application/json" \
              -H "Origin: http://localhost:3000" \
              -d '{"action":"approved","note":"Approved for Phase 7 migration test"}' \
              "$BASE_URL/approvals/$APPROVAL_ID/action")
            
            NEW_STATUS=$(echo "$APPROVE_RESPONSE" | jq -r '.data.status // empty')
            echo "  Updated status: $NEW_STATUS"
            
            # Verify in MongoDB
            MONGO_STATUS=$(python3 << PYEOF
from pymongo import MongoClient
client = MongoClient("mongodb://localhost:27017")
db = client["erp_prod"]
approval = db["approvals"].find_one({"id": "$APPROVAL_ID"})
if approval and approval.get("status") == "approved":
    print("APPROVED")
else:
    print("NOT_APPROVED")
PYEOF
)
            
            if [ "$MONGO_STATUS" = "APPROVED" ]; then
              echo "  ✅ PASSED: Approval status updated to 'approved' in MongoDB"
            else
              echo "  ❌ FAILED: Status not updated in MongoDB"
            fi
          else
            echo "  ❌ FAILED: Approval not found in MongoDB"
          fi
        else
          echo "  ❌ FAILED: Approval not found in API list"
        fi
      else
        echo "  ❌ FAILED: Failed to create return"
      fi
      
      # Cleanup: Delete SO
      echo ""
      echo "Cleanup: Deleting test SO..."
      curl -s -b "$COOKIE_FILE" -X DELETE \
        -H "Origin: http://localhost:3000" \
        "$BASE_URL/sales-orders/$SO_ID" > /dev/null
      echo "  ✓ Deleted SO $SO_ID"
    else
      echo "  ❌ FAILED: Failed to create SO"
    fi
  fi
fi

# ============================================================================
# SCENARIO 5: MULTI ISOLATION (concurrency)
# ============================================================================
echo ""
echo "================================================================================"
echo "  SCENARIO 5: MULTI ISOLATION (concurrency)"
echo "================================================================================"

echo ""
echo "5.1) Create two WO stages"
STAGE1_CREATE=$(curl -s -b "$COOKIE_FILE" -X POST \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"code":"TST1","name":"Test Stage 1","sequenceOrder":10,"fieldsSchema":"[]"}' \
  "$BASE_URL/wo-stages")

STAGE1_ID=$(echo "$STAGE1_CREATE" | jq -r '.data.id // empty')

STAGE2_CREATE=$(curl -s -b "$COOKIE_FILE" -X POST \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"code":"TST2","name":"Test Stage 2","sequenceOrder":11,"fieldsSchema":"[]"}' \
  "$BASE_URL/wo-stages")

STAGE2_ID=$(echo "$STAGE2_CREATE" | jq -r '.data.id // empty')

if [ -n "$STAGE1_ID" ] && [ -n "$STAGE2_ID" ]; then
  echo "  Created stage 1: $STAGE1_ID"
  echo "  Created stage 2: $STAGE2_ID"
  
  # Verify both exist in MongoDB
  MONGO_CHECK=$(python3 << PYEOF
from pymongo import MongoClient
client = MongoClient("mongodb://localhost:27017")
db = client["erp_prod"]
stage1 = db["wo_stages"].find_one({"id": "$STAGE1_ID"})
stage2 = db["wo_stages"].find_one({"id": "$STAGE2_ID"})
if stage1 and stage2:
    print("BOTH_FOUND")
else:
    print("NOT_FOUND")
PYEOF
)
  
  if [ "$MONGO_CHECK" = "BOTH_FOUND" ]; then
    echo "  ✅ PASSED: Both stages exist in MongoDB"
    
    # 5.2: Update stage 1, verify stage 2 unchanged
    echo ""
    echo "5.2) Update stage 1, verify stage 2 unchanged"
    curl -s -b "$COOKIE_FILE" -X PUT \
      -H "Content-Type: application/json" \
      -H "Origin: http://localhost:3000" \
      -d '{"code":"TST1","name":"Test Stage 1 UPDATED","sequenceOrder":10,"fieldsSchema":"[]"}' \
      "$BASE_URL/wo-stages/$STAGE1_ID" > /dev/null
    
    # Verify stage 1 updated, stage 2 unchanged
    MONGO_CHECK=$(python3 << PYEOF
from pymongo import MongoClient
client = MongoClient("mongodb://localhost:27017")
db = client["erp_prod"]
stage1 = db["wo_stages"].find_one({"id": "$STAGE1_ID"})
stage2 = db["wo_stages"].find_one({"id": "$STAGE2_ID"})
stage1_updated = stage1 and stage1.get("name") == "Test Stage 1 UPDATED"
stage2_unchanged = stage2 and stage2.get("name") == "Test Stage 2"
if stage1_updated and stage2_unchanged:
    print("DIFF_WORKING")
else:
    print(f"FAILED:stage1_updated={stage1_updated},stage2_unchanged={stage2_unchanged}")
PYEOF
)
    
    if [ "$MONGO_CHECK" = "DIFF_WORKING" ]; then
      echo "  ✅ PASSED: Stage 1 updated, Stage 2 unchanged (DIFF-persist working)"
    else
      echo "  ❌ FAILED: $MONGO_CHECK"
    fi
    
    # Cleanup
    echo ""
    echo "Cleanup: Deleting test stages..."
    curl -s -b "$COOKIE_FILE" -X DELETE -H "Origin: http://localhost:3000" "$BASE_URL/wo-stages/$STAGE1_ID" > /dev/null
    curl -s -b "$COOKIE_FILE" -X DELETE -H "Origin: http://localhost:3000" "$BASE_URL/wo-stages/$STAGE2_ID" > /dev/null
    echo "  ✓ Deleted stages"
  else
    echo "  ❌ FAILED: One or both stages not in MongoDB"
  fi
else
  echo "  ❌ FAILED: Failed to create stages"
fi

# ============================================================================
# SCENARIO 6: ENGINE (accounting integrity)
# ============================================================================
echo ""
echo "================================================================================"
echo "  SCENARIO 6: ENGINE (accounting integrity)"
echo "================================================================================"

echo ""
echo "6.1) GET /api/accounting/trial-balance"
TB_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/accounting/trial-balance")
TOTAL_DEBIT=$(echo "$TB_RESPONSE" | jq -r '.data.totalDebit // 0')
TOTAL_CREDIT=$(echo "$TB_RESPONSE" | jq -r '.data.totalCredit // 0')

echo "  Total Debit: $TOTAL_DEBIT"
echo "  Total Credit: $TOTAL_CREDIT"

# Check if balanced (allow small floating point difference)
DIFF=$(python3 -c "print(abs($TOTAL_DEBIT - $TOTAL_CREDIT))")
BALANCED=$(python3 -c "print('true' if abs($TOTAL_DEBIT - $TOTAL_CREDIT) < 0.01 else 'false')")

if [ "$BALANCED" = "true" ]; then
  echo "  ✅ PASSED: Trial Balance balanced (Debit=$TOTAL_DEBIT, Credit=$TOTAL_CREDIT)"
else
  echo "  ❌ FAILED: Trial Balance not balanced (diff=$DIFF)"
fi

echo ""
echo "6.2) GET /api/accounting/balance-sheet"
BS_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/accounting/balance-sheet")
BS_BALANCED=$(echo "$BS_RESPONSE" | jq -r '.data.balanced // false')

echo "  Balanced: $BS_BALANCED"

if [ "$BS_BALANCED" = "true" ]; then
  echo "  ✅ PASSED: Balance Sheet balanced"
else
  echo "  ❌ FAILED: Balance Sheet not balanced"
fi

# ============================================================================
# SCENARIO 7: NON-CASCADE SAFETY
# ============================================================================
echo ""
echo "================================================================================"
echo "  SCENARIO 7: NON-CASCADE SAFETY"
echo "================================================================================"

echo ""
echo "7.1) Check SQLite counts (products, inventory_stock)"

PRODUCTS_COUNT=$(sqlite3 /app/data/erp.db "SELECT COUNT(*) FROM products")
INVENTORY_COUNT=$(sqlite3 /app/data/erp.db "SELECT COUNT(*) FROM inventory_stock")

echo "  Products count: $PRODUCTS_COUNT"
echo "  Inventory stock count: $INVENTORY_COUNT"

if [ "$PRODUCTS_COUNT" -gt 0 ] && [ "$INVENTORY_COUNT" -gt 0 ]; then
  echo "  ✅ PASSED: Products=$PRODUCTS_COUNT, Inventory=$INVENTORY_COUNT preserved"
else
  echo "  ❌ FAILED: Products or inventory_stock may have been wiped"
fi

# ============================================================================
# SCENARIO 8: ROLE GUARD
# ============================================================================
echo ""
echo "================================================================================"
echo "  SCENARIO 8: ROLE GUARD (operator 403)"
echo "================================================================================"

echo ""
echo "8.1) Login as operator"
curl -s -c "$OPERATOR_COOKIE_FILE" -X POST \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"email":"operator@lpi.co.id","password":"operator123"}' \
  "http://localhost:3000/api/auth/sign-in/email" > /dev/null

if [ $? -eq 0 ]; then
  echo "  ✓ Logged in as operator@lpi.co.id"
  echo "  ✅ PASSED: Operator login"
  
  # Try to create WO stage (should be 403)
  echo ""
  echo "8.2) POST /api/wo-stages as operator (expect 403)"
  STAGE_RESPONSE=$(curl -s -b "$OPERATOR_COOKIE_FILE" -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:3000" \
    -d '{"code":"OPR","name":"Operator Test","sequenceOrder":99,"fieldsSchema":"[]"}' \
    "$BASE_URL/wo-stages")
  
  HTTP_CODE=$(echo "$STAGE_RESPONSE" | tail -1)
  
  if [ "$HTTP_CODE" = "403" ]; then
    echo "  ✅ PASSED: Operator correctly forbidden (403)"
  else
    echo "  ❌ FAILED: Expected 403, got $HTTP_CODE"
  fi
  
  # Try to create work order (should be 403)
  echo ""
  echo "8.3) POST /api/work-orders as operator (expect 403)"
  WO_RESPONSE=$(curl -s -b "$OPERATOR_COOKIE_FILE" -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:3000" \
    -d "{\"mode\":\"Internal\",\"startDate\":\"$(date -Iseconds)\",\"baseCost\":1000000}" \
    "$BASE_URL/work-orders")
  
  HTTP_CODE=$(echo "$WO_RESPONSE" | tail -1)
  
  if [ "$HTTP_CODE" = "403" ]; then
    echo "  ✅ PASSED: Operator correctly forbidden from creating WO (403)"
  else
    echo "  ❌ FAILED: Expected 403, got $HTTP_CODE"
  fi
else
  echo "  ❌ FAILED: Failed to login as operator"
fi

# Cleanup WO if created
if [ -n "$WO_ID" ]; then
  echo ""
  echo "Cleanup: Deleting test WO..."
  curl -s -b "$COOKIE_FILE" -X DELETE \
    -H "Origin: http://localhost:3000" \
    "$BASE_URL/work-orders/$WO_ID" > /dev/null
  echo "  ✓ Deleted WO $WO_ID"
fi

# Get final MongoDB counts
echo ""
echo "================================================================================"
echo "  FINAL MONGODB STATE"
echo "================================================================================"

python3 << 'PYEOF'
from pymongo import MongoClient
client = MongoClient("mongodb://localhost:27017")
db = client["erp_prod"]
collections = ["wo_stages", "work_order", "work_order_details", "wo_stage_records", "wo_outputs", "wo_custom_costs", "approvals"]
for coll in collections:
    count = db[coll].count_documents({})
    print(f"  {coll}: {count} documents")
PYEOF

echo ""
echo "================================================================================"
echo "  TEST COMPLETE"
echo "================================================================================"
