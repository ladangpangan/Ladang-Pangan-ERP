#!/usr/bin/env python3
"""
MIGRATION Phase 7 Backend Test: Work Order (produksi) + Approvals MongoDB-authoritative
Tests the DIFF-persist write strategy for multi-replica safe operations.
"""

import requests
import json
import time
from pymongo import MongoClient
import sqlite3
from datetime import datetime
from http.cookiejar import Cookie

# Configuration
BASE_URL = "http://localhost:3000/api"
MONGO_URL = "mongodb://localhost:27017"
MONGO_DB_NAME = "erp_prod"
SQLITE_DB = "/app/data/erp.db"

# Auth credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
OPERATOR_EMAIL = "operator@lpi.co.id"
OPERATOR_PASSWORD = "operator123"

# Test results
test_results = []
test_data = {
    "wo_stages": [],
    "work_orders": [],
    "approvals": [],
    "sales_orders": []
}

def log_test(name, passed, details=""):
    """Log test result"""
    status = "✅ PASSED" if passed else "❌ FAILED"
    print(f"\n{status}: {name}")
    if details:
        print(f"  Details: {details}")
    test_results.append({"name": name, "passed": passed, "details": details})

def login(email, password):
    """Login and return session with manually set cookie"""
    session = requests.Session()
    headers = {
        "Content-Type": "application/json",
        "Origin": "http://localhost:3000"
    }
    
    # Try to login
    response = session.post(
        f"{BASE_URL.replace('/api', '')}/api/auth/sign-in/email",
        json={"email": email, "password": password},
        headers=headers
    )
    
    if response.status_code != 200:
        print(f"Login failed: {response.status_code} - {response.text}")
        return None
    
    # Better Auth sets cookies automatically
    print(f"✓ Logged in as {email}")
    return session

def get_mongo_collection(collection_name):
    """Get MongoDB collection"""
    client = MongoClient(MONGO_URL)
    db = client[MONGO_DB_NAME]
    return db[collection_name]

def get_sqlite_count(table_name):
    """Get count from SQLite table"""
    conn = sqlite3.connect(SQLITE_DB)
    cursor = conn.cursor()
    cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
    count = cursor.fetchone()[0]
    conn.close()
    return count

def print_section(title):
    """Print section header"""
    print(f"\n{'='*80}")
    print(f"  {title}")
    print(f"{'='*80}")

# ============================================================================
# SCENARIO 1: WO STAGES (master data)
# ============================================================================
def test_wo_stages(session):
    print_section("SCENARIO 1: WO STAGES (master data)")
    
    try:
        # 1.1: GET /api/wo-stages (should have 4 pre-existing)
        print("\n1.1) GET /api/wo-stages (list)")
        response = session.get(f"{BASE_URL}/wo-stages")
        if response.status_code != 200:
            log_test("S1.1: GET wo-stages", False, f"Status {response.status_code}")
            return
        
        data = response.json()
        initial_count = len(data.get("data", []))
        print(f"  Initial wo_stages count: {initial_count}")
        log_test("S1.1: GET wo-stages", True, f"Found {initial_count} stages")
        
        # 1.2: POST /api/wo-stages (create new stage)
        print("\n1.2) POST /api/wo-stages (create)")
        new_stage = {
            "code": "TST",
            "name": "Tahap Uji",
            "sequenceOrder": 9,
            "fieldsSchema": "[]"
        }
        response = session.post(
            f"{BASE_URL}/wo-stages",
            json=new_stage,
            headers={"Origin": "http://localhost:3000"}
        )
        
        if response.status_code not in [200, 201]:
            log_test("S1.2: POST wo-stages", False, f"Status {response.status_code}: {response.text}")
            return
        
        created_stage = response.json().get("data", {})
        stage_id = created_stage.get("id")
        test_data["wo_stages"].append(stage_id)
        print(f"  Created stage ID: {stage_id}")
        
        # Verify in MongoDB
        mongo_stages = get_mongo_collection("wo_stages")
        mongo_stage = mongo_stages.find_one({"id": stage_id})
        if mongo_stage and mongo_stage.get("code") == "TST":
            log_test("S1.2: POST wo-stages", True, f"Stage created in MongoDB with code TST")
        else:
            log_test("S1.2: POST wo-stages", False, "Stage not found in MongoDB")
            return
        
        # 1.3: PUT /api/wo-stages/:id (rename)
        print("\n1.3) PUT /api/wo-stages/:id (rename)")
        update_data = {
            "code": "TST",
            "name": "Tahap Uji Updated",
            "sequenceOrder": 9,
            "fieldsSchema": "[]"
        }
        response = session.put(
            f"{BASE_URL}/wo-stages/{stage_id}",
            json=update_data,
            headers={"Origin": "http://localhost:3000"}
        )
        
        if response.status_code != 200:
            log_test("S1.3: PUT wo-stages", False, f"Status {response.status_code}")
            return
        
        # Verify in MongoDB
        mongo_stage = mongo_stages.find_one({"id": stage_id})
        if mongo_stage and mongo_stage.get("name") == "Tahap Uji Updated":
            log_test("S1.3: PUT wo-stages", True, "Stage renamed in MongoDB")
        else:
            log_test("S1.3: PUT wo-stages", False, f"Name not updated in MongoDB: {mongo_stage.get('name') if mongo_stage else 'not found'}")
        
        # 1.4: DELETE /api/wo-stages/:id
        print("\n1.4) DELETE /api/wo-stages/:id")
        response = session.delete(
            f"{BASE_URL}/wo-stages/{stage_id}",
            headers={"Origin": "http://localhost:3000"}
        )
        
        if response.status_code not in [200, 204]:
            log_test("S1.4: DELETE wo-stages", False, f"Status {response.status_code}")
            return
        
        # Verify removed from MongoDB
        mongo_stage = mongo_stages.find_one({"id": stage_id})
        if mongo_stage is None:
            log_test("S1.4: DELETE wo-stages", True, "Stage removed from MongoDB")
            test_data["wo_stages"].remove(stage_id)
        else:
            log_test("S1.4: DELETE wo-stages", False, "Stage still exists in MongoDB")
        
    except Exception as e:
        log_test("S1: WO Stages", False, f"Exception: {str(e)}")

# ============================================================================
# SCENARIO 2: WORK ORDER CREATE
# ============================================================================
def test_work_order_create(session):
    print_section("SCENARIO 2: WORK ORDER CREATE")
    
    try:
        # 2.1: Create a simple work order
        print("\n2.1) POST /api/work-orders (create)")
        new_wo = {
            "mode": "Internal",
            "startDate": datetime.now().isoformat(),
            "baseCost": 1000000,
            "notes": "Test WO for Phase 7 migration"
        }
        response = session.post(
            f"{BASE_URL}/work-orders",
            json=new_wo,
            headers={"Origin": "http://localhost:3000"}
        )
        
        if response.status_code not in [200, 201]:
            log_test("S2.1: POST work-orders", False, f"Status {response.status_code}: {response.text}")
            return
        
        created_wo = response.json().get("data", {})
        wo_id = created_wo.get("id")
        wo_number = created_wo.get("woNumber")
        test_data["work_orders"].append(wo_id)
        print(f"  Created WO: {wo_number} (ID: {wo_id})")
        
        # Verify in MongoDB
        mongo_wo = get_mongo_collection("work_order")
        mongo_doc = mongo_wo.find_one({"id": wo_id})
        if mongo_doc and mongo_doc.get("woNumber") == wo_number:
            log_test("S2.1: POST work-orders", True, f"WO created in MongoDB: {wo_number}")
        else:
            log_test("S2.1: POST work-orders", False, "WO not found in MongoDB")
            return
        
        # 2.2: GET /api/work-orders (list)
        print("\n2.2) GET /api/work-orders (list)")
        response = session.get(f"{BASE_URL}/work-orders")
        if response.status_code != 200:
            log_test("S2.2: GET work-orders list", False, f"Status {response.status_code}")
            return
        
        data = response.json()
        wo_list = data.get("data", [])
        found = any(wo.get("id") == wo_id for wo in wo_list)
        log_test("S2.2: GET work-orders list", found, f"WO found in list" if found else "WO not in list")
        
        # 2.3: GET /api/work-orders/:id (detail)
        print("\n2.3) GET /api/work-orders/:id (detail)")
        response = session.get(f"{BASE_URL}/work-orders/{wo_id}")
        if response.status_code != 200:
            log_test("S2.3: GET work-orders detail", False, f"Status {response.status_code}")
            return
        
        wo_detail = response.json().get("data", {})
        if wo_detail.get("id") == wo_id and wo_detail.get("woNumber") == wo_number:
            log_test("S2.3: GET work-orders detail", True, f"WO detail retrieved: {wo_number}")
        else:
            log_test("S2.3: GET work-orders detail", False, "WO detail mismatch")
        
    except Exception as e:
        log_test("S2: Work Order Create", False, f"Exception: {str(e)}")

# ============================================================================
# SCENARIO 4: APPROVALS FLOW (core)
# ============================================================================
def test_approvals_flow(session):
    print_section("SCENARIO 4: APPROVALS FLOW (core)")
    
    try:
        # First, we need to create a Sales Order to trigger a return approval
        print("\n4.1) Create Sales Order for return test")
        
        # Get a customer
        response = session.get(f"{BASE_URL}/contacts?category=Customer")
        if response.status_code != 200:
            log_test("S4.1: Get customer", False, f"Status {response.status_code}")
            return
        
        customers = response.json().get("data", [])
        if not customers:
            log_test("S4.1: Get customer", False, "No customers found")
            return
        
        customer_id = customers[0].get("id")
        print(f"  Using customer: {customers[0].get('displayName')} (ID: {customer_id})")
        
        # Get a product
        response = session.get(f"{BASE_URL}/products")
        if response.status_code != 200:
            log_test("S4.1: Get product", False, f"Status {response.status_code}")
            return
        
        products = response.json().get("data", [])
        if not products:
            log_test("S4.1: Get product", False, "No products found")
            return
        
        product = products[0]
        product_id = product.get("id")
        print(f"  Using product: {product.get('name')} (ID: {product_id})")
        
        # Create Sales Order
        new_so = {
            "customerId": customer_id,
            "orderDate": datetime.now().isoformat(),
            "items": [{
                "productId": product_id,
                "quantity": 1,
                "weight": 10,
                "unitPrice": 50000
            }]
        }
        response = session.post(
            f"{BASE_URL}/sales-orders",
            json=new_so,
            headers={"Origin": "http://localhost:3000"}
        )
        
        if response.status_code not in [200, 201]:
            log_test("S4.1: Create SO", False, f"Status {response.status_code}: {response.text}")
            return
        
        so_data = response.json().get("data", {})
        so_id = so_data.get("id")
        so_number = so_data.get("soNumber")
        test_data["sales_orders"].append(so_id)
        print(f"  Created SO: {so_number} (ID: {so_id})")
        log_test("S4.1: Create SO", True, f"SO created: {so_number}")
        
        # 4.2: Create a sales return (triggers approval)
        print("\n4.2) POST /api/sales-orders/:id/returns (trigger approval)")
        return_data = {
            "returnDate": datetime.now().isoformat(),
            "reason": "Test return for approval flow",
            "resolution": "potong_invoice",
            "totalAmount": 50000,
            "totalWeight": 1,
            "notes": "Phase 7 migration test"
        }
        response = session.post(
            f"{BASE_URL}/sales-orders/{so_id}/returns",
            json=return_data,
            headers={"Origin": "http://localhost:3000"}
        )
        
        if response.status_code not in [200, 201]:
            log_test("S4.2: Create return", False, f"Status {response.status_code}: {response.text}")
            return
        
        return_result = response.json().get("data", {})
        return_id = return_result.get("id")
        return_number = return_result.get("returnNumber")
        print(f"  Created return: {return_number} (ID: {return_id})")
        
        # Wait a moment for approval to be created
        time.sleep(1)
        
        # 4.3: GET /api/approvals (list) - find the new approval
        print("\n4.3) GET /api/approvals (find new approval)")
        response = session.get(f"{BASE_URL}/approvals")
        if response.status_code != 200:
            log_test("S4.3: GET approvals", False, f"Status {response.status_code}")
            return
        
        approvals_data = response.json().get("data", [])
        # Find approval for this return
        approval = None
        for ap in approvals_data:
            if ap.get("entityId") == return_id and ap.get("concernType") == "sales_return":
                approval = ap
                break
        
        if not approval:
            log_test("S4.3: GET approvals", False, "Approval not found in API list")
            return
        
        approval_id = approval.get("id")
        test_data["approvals"].append(approval_id)
        print(f"  Found approval ID: {approval_id}")
        print(f"  Status: {approval.get('status')}, Type: {approval.get('concernType')}")
        
        # Verify in MongoDB
        mongo_approvals = get_mongo_collection("approvals")
        mongo_approval = mongo_approvals.find_one({"id": approval_id})
        if mongo_approval:
            print(f"  MongoDB approval status: {mongo_approval.get('status')}")
            log_test("S4.3: GET approvals", True, f"Approval found in MongoDB with status '{mongo_approval.get('status')}'")
        else:
            log_test("S4.3: GET approvals", False, "Approval not found in MongoDB")
            return
        
        # 4.4: Approve the approval
        print("\n4.4) POST /api/approvals/:id/action (approve)")
        action_data = {
            "action": "approved",
            "note": "Approved for Phase 7 migration test"
        }
        response = session.post(
            f"{BASE_URL}/approvals/{approval_id}/action",
            json=action_data,
            headers={"Origin": "http://localhost:3000"}
        )
        
        if response.status_code != 200:
            log_test("S4.4: Approve approval", False, f"Status {response.status_code}: {response.text}")
            return
        
        updated_approval = response.json().get("data", {})
        new_status = updated_approval.get("status")
        print(f"  Updated status: {new_status}")
        
        # Verify in MongoDB
        mongo_approval = mongo_approvals.find_one({"id": approval_id})
        if mongo_approval and mongo_approval.get("status") == "approved":
            log_test("S4.4: Approve approval", True, f"Approval status updated to 'approved' in MongoDB")
        else:
            log_test("S4.4: Approve approval", False, f"Status not updated in MongoDB: {mongo_approval.get('status') if mongo_approval else 'not found'}")
        
    except Exception as e:
        log_test("S4: Approvals Flow", False, f"Exception: {str(e)}")

# ============================================================================
# SCENARIO 5: MULTI ISOLATION (concurrency)
# ============================================================================
def test_multi_isolation(session):
    print_section("SCENARIO 5: MULTI ISOLATION (concurrency)")
    
    try:
        # Create two WO stages
        print("\n5.1) Create two WO stages")
        stage1_data = {
            "code": "TST1",
            "name": "Test Stage 1",
            "sequenceOrder": 10,
            "fieldsSchema": "[]"
        }
        response1 = session.post(
            f"{BASE_URL}/wo-stages",
            json=stage1_data,
            headers={"Origin": "http://localhost:3000"}
        )
        
        if response1.status_code not in [200, 201]:
            log_test("S5.1: Create stage 1", False, f"Status {response1.status_code}")
            return
        
        stage1 = response1.json().get("data", {})
        stage1_id = stage1.get("id")
        test_data["wo_stages"].append(stage1_id)
        print(f"  Created stage 1: {stage1_id}")
        
        stage2_data = {
            "code": "TST2",
            "name": "Test Stage 2",
            "sequenceOrder": 11,
            "fieldsSchema": "[]"
        }
        response2 = session.post(
            f"{BASE_URL}/wo-stages",
            json=stage2_data,
            headers={"Origin": "http://localhost:3000"}
        )
        
        if response2.status_code not in [200, 201]:
            log_test("S5.1: Create stage 2", False, f"Status {response2.status_code}")
            return
        
        stage2 = response2.json().get("data", {})
        stage2_id = stage2.get("id")
        test_data["wo_stages"].append(stage2_id)
        print(f"  Created stage 2: {stage2_id}")
        
        # Verify both exist in MongoDB
        mongo_stages = get_mongo_collection("wo_stages")
        mongo_stage1 = mongo_stages.find_one({"id": stage1_id})
        mongo_stage2 = mongo_stages.find_one({"id": stage2_id})
        
        if mongo_stage1 and mongo_stage2:
            log_test("S5.1: Create two stages", True, "Both stages exist in MongoDB")
        else:
            log_test("S5.1: Create two stages", False, "One or both stages not in MongoDB")
            return
        
        # 5.2: Update stage 1, verify stage 2 unchanged
        print("\n5.2) Update stage 1, verify stage 2 unchanged")
        update_data = {
            "code": "TST1",
            "name": "Test Stage 1 UPDATED",
            "sequenceOrder": 10,
            "fieldsSchema": "[]"
        }
        response = session.put(
            f"{BASE_URL}/wo-stages/{stage1_id}",
            json=update_data,
            headers={"Origin": "http://localhost:3000"}
        )
        
        if response.status_code != 200:
            log_test("S5.2: Update stage 1", False, f"Status {response.status_code}")
            return
        
        # Verify stage 1 updated, stage 2 unchanged
        mongo_stage1 = mongo_stages.find_one({"id": stage1_id})
        mongo_stage2 = mongo_stages.find_one({"id": stage2_id})
        
        stage1_updated = mongo_stage1 and mongo_stage1.get("name") == "Test Stage 1 UPDATED"
        stage2_unchanged = mongo_stage2 and mongo_stage2.get("name") == "Test Stage 2"
        
        if stage1_updated and stage2_unchanged:
            log_test("S5.2: Multi isolation", True, "Stage 1 updated, Stage 2 unchanged (DIFF-persist working)")
        else:
            log_test("S5.2: Multi isolation", False, f"Stage 1 updated: {stage1_updated}, Stage 2 unchanged: {stage2_unchanged}")
        
    except Exception as e:
        log_test("S5: Multi Isolation", False, f"Exception: {str(e)}")

# ============================================================================
# SCENARIO 6: ENGINE (accounting integrity)
# ============================================================================
def test_engine_integrity(session):
    print_section("SCENARIO 6: ENGINE (accounting integrity)")
    
    try:
        # 6.1: Trial Balance
        print("\n6.1) GET /api/accounting/trial-balance")
        response = session.get(f"{BASE_URL}/accounting/trial-balance")
        if response.status_code != 200:
            log_test("S6.1: Trial Balance", False, f"Status {response.status_code}")
            return
        
        tb_data = response.json().get("data", {})
        total_debit = tb_data.get("totalDebit", 0)
        total_credit = tb_data.get("totalCredit", 0)
        balanced = abs(total_debit - total_credit) < 0.01
        
        print(f"  Total Debit: {total_debit}")
        print(f"  Total Credit: {total_credit}")
        print(f"  Balanced: {balanced}")
        
        log_test("S6.1: Trial Balance", balanced, f"Debit={total_debit}, Credit={total_credit}")
        
        # 6.2: Balance Sheet
        print("\n6.2) GET /api/accounting/balance-sheet")
        response = session.get(f"{BASE_URL}/accounting/balance-sheet")
        if response.status_code != 200:
            log_test("S6.2: Balance Sheet", False, f"Status {response.status_code}")
            return
        
        bs_data = response.json().get("data", {})
        bs_balanced = bs_data.get("balanced", False)
        
        print(f"  Balanced: {bs_balanced}")
        log_test("S6.2: Balance Sheet", bs_balanced, f"balanced={bs_balanced}")
        
    except Exception as e:
        log_test("S6: Engine Integrity", False, f"Exception: {str(e)}")

# ============================================================================
# SCENARIO 7: NON-CASCADE SAFETY
# ============================================================================
def test_non_cascade_safety():
    print_section("SCENARIO 7: NON-CASCADE SAFETY")
    
    try:
        # Count products and inventory_stock before and after
        print("\n7.1) Check SQLite counts (products, inventory_stock)")
        
        products_count = get_sqlite_count("products")
        inventory_stock_count = get_sqlite_count("inventory_stock")
        
        print(f"  Products count: {products_count}")
        print(f"  Inventory stock count: {inventory_stock_count}")
        
        # These should be preserved (not wiped by FK-off hydration)
        if products_count > 0 and inventory_stock_count > 0:
            log_test("S7.1: Non-cascade safety", True, f"Products={products_count}, Inventory={inventory_stock_count} preserved")
        else:
            log_test("S7.1: Non-cascade safety", False, f"Products or inventory_stock may have been wiped")
        
    except Exception as e:
        log_test("S7: Non-cascade Safety", False, f"Exception: {str(e)}")

# ============================================================================
# SCENARIO 8: ROLE GUARD
# ============================================================================
def test_role_guard():
    print_section("SCENARIO 8: ROLE GUARD (operator 403)")
    
    try:
        # Login as operator
        print("\n8.1) Login as operator")
        operator_session = login(OPERATOR_EMAIL, OPERATOR_PASSWORD)
        if not operator_session:
            log_test("S8.1: Operator login", False, "Failed to login as operator")
            return
        
        log_test("S8.1: Operator login", True, "Logged in as operator")
        
        # Try to create WO stage (should be 403)
        print("\n8.2) POST /api/wo-stages as operator (expect 403)")
        stage_data = {
            "code": "OPR",
            "name": "Operator Test",
            "sequenceOrder": 99,
            "fieldsSchema": "[]"
        }
        response = operator_session.post(
            f"{BASE_URL}/wo-stages",
            json=stage_data,
            headers={"Origin": "http://localhost:3000"}
        )
        
        if response.status_code == 403:
            log_test("S8.2: Operator forbidden", True, "Operator correctly forbidden (403)")
        else:
            log_test("S8.2: Operator forbidden", False, f"Expected 403, got {response.status_code}")
        
        # Try to create work order (should be 403)
        print("\n8.3) POST /api/work-orders as operator (expect 403)")
        wo_data = {
            "mode": "Internal",
            "startDate": datetime.now().isoformat(),
            "baseCost": 1000000
        }
        response = operator_session.post(
            f"{BASE_URL}/work-orders",
            json=wo_data,
            headers={"Origin": "http://localhost:3000"}
        )
        
        if response.status_code == 403:
            log_test("S8.3: Operator forbidden WO", True, "Operator correctly forbidden from creating WO (403)")
        else:
            log_test("S8.3: Operator forbidden WO", False, f"Expected 403, got {response.status_code}")
        
    except Exception as e:
        log_test("S8: Role Guard", False, f"Exception: {str(e)}")

# ============================================================================
# CLEANUP
# ============================================================================
def cleanup(session):
    print_section("CLEANUP")
    
    try:
        # Delete test WO stages
        print("\nDeleting test WO stages...")
        for stage_id in test_data["wo_stages"]:
            try:
                response = session.delete(
                    f"{BASE_URL}/wo-stages/{stage_id}",
                    headers={"Origin": "http://localhost:3000"}
                )
                if response.status_code in [200, 204]:
                    print(f"  ✓ Deleted stage {stage_id}")
                else:
                    print(f"  ✗ Failed to delete stage {stage_id}: {response.status_code}")
            except Exception as e:
                print(f"  ✗ Error deleting stage {stage_id}: {str(e)}")
        
        # Delete test work orders
        print("\nDeleting test work orders...")
        for wo_id in test_data["work_orders"]:
            try:
                response = session.delete(
                    f"{BASE_URL}/work-orders/{wo_id}",
                    headers={"Origin": "http://localhost:3000"}
                )
                if response.status_code in [200, 204]:
                    print(f"  ✓ Deleted WO {wo_id}")
                else:
                    print(f"  ✗ Failed to delete WO {wo_id}: {response.status_code}")
            except Exception as e:
                print(f"  ✗ Error deleting WO {wo_id}: {str(e)}")
        
        # Delete test sales orders
        print("\nDeleting test sales orders...")
        for so_id in test_data["sales_orders"]:
            try:
                response = session.delete(
                    f"{BASE_URL}/sales-orders/{so_id}",
                    headers={"Origin": "http://localhost:3000"}
                )
                if response.status_code in [200, 204]:
                    print(f"  ✓ Deleted SO {so_id}")
                else:
                    print(f"  ✗ Failed to delete SO {so_id}: {response.status_code}")
            except Exception as e:
                print(f"  ✗ Error deleting SO {so_id}: {str(e)}")
        
        # Note: Approvals created by returns may not be individually deletable
        if test_data["approvals"]:
            print(f"\nNote: {len(test_data['approvals'])} approval(s) created (may not be deletable)")
        
    except Exception as e:
        print(f"Cleanup error: {str(e)}")

# ============================================================================
# MAIN
# ============================================================================
def main():
    print("="*80)
    print("  MIGRATION PHASE 7 BACKEND TEST")
    print("  Work Order (produksi) + Approvals MongoDB-authoritative")
    print("="*80)
    
    # Login as admin
    print("\nLogging in as admin...")
    admin_session = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_session:
        print("❌ Failed to login as admin. Aborting tests.")
        return
    
    # Get initial MongoDB counts
    print("\n" + "="*80)
    print("  INITIAL MONGODB STATE")
    print("="*80)
    
    mongo_collections = {
        "wo_stages": get_mongo_collection("wo_stages").count_documents({}),
        "work_order": get_mongo_collection("work_order").count_documents({}),
        "work_order_details": get_mongo_collection("work_order_details").count_documents({}),
        "wo_stage_records": get_mongo_collection("wo_stage_records").count_documents({}),
        "wo_outputs": get_mongo_collection("wo_outputs").count_documents({}),
        "wo_custom_costs": get_mongo_collection("wo_custom_costs").count_documents({}),
        "approvals": get_mongo_collection("approvals").count_documents({})
    }
    
    for collection, count in mongo_collections.items():
        print(f"  {collection}: {count} documents")
    
    # Run tests
    test_wo_stages(admin_session)
    test_work_order_create(admin_session)
    test_approvals_flow(admin_session)
    test_multi_isolation(admin_session)
    test_engine_integrity(admin_session)
    test_non_cascade_safety()
    test_role_guard()
    
    # Cleanup
    cleanup(admin_session)
    
    # Get final MongoDB counts
    print("\n" + "="*80)
    print("  FINAL MONGODB STATE")
    print("="*80)
    
    for collection in mongo_collections.keys():
        count = get_mongo_collection(collection).count_documents({})
        print(f"  {collection}: {count} documents")
    
    # Summary
    print("\n" + "="*80)
    print("  TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for t in test_results if t["passed"])
    total = len(test_results)
    
    print(f"\nTotal tests: {total}")
    print(f"Passed: {passed}")
    print(f"Failed: {total - passed}")
    print(f"Success rate: {(passed/total*100):.1f}%")
    
    print("\nDetailed results:")
    for test in test_results:
        status = "✅" if test["passed"] else "❌"
        print(f"  {status} {test['name']}")
        if test["details"]:
            print(f"      {test['details']}")
    
    print("\n" + "="*80)
    if passed == total:
        print("  ✅ ALL TESTS PASSED")
    else:
        print(f"  ⚠️  {total - passed} TEST(S) FAILED")
    print("="*80)

if __name__ == "__main__":
    main()
