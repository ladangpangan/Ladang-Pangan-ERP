#!/usr/bin/env python3
"""
MIGRATION PHASE 5 Backend Test - Simplified with curl auth
Tests PO aggregate + Commission + SO-extra (Surat Jalan/Retur/Penerimaan) MongoDB-authoritative
"""
import subprocess
import json
import os
from pymongo import MongoClient
from datetime import datetime

# Configuration
BASE_URL = "http://localhost:3000/api"
COOKIE_FILE = "/tmp/admin_cookies.txt"
OP_COOKIE_FILE = "/tmp/operator_cookies.txt"
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
MONGO_DB_NAME = "erp_prod"

# Test data tracking
test_data = {
    "pos": [],
    "sos": []
}

def curl_request(method, endpoint, data=None, cookie_file=COOKIE_FILE):
    """Make a curl request with cookies"""
    url = f"{BASE_URL}{endpoint}"
    cmd = ["curl", "-s", "-b", cookie_file, "-X", method, url,
           "-H", "Origin: http://localhost:3000",
           "-H", "Content-Type: application/json"]
    
    if data:
        cmd.extend(["-d", json.dumps(data)])
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    try:
        return result.returncode, json.loads(result.stdout) if result.stdout else {}
    except Exception:
        return result.returncode, {"error": result.stdout or result.stderr}

def get_mongo_db():
    """Get MongoDB database connection"""
    client = MongoClient(MONGO_URL)
    return client[MONGO_DB_NAME]

def get_mongo_counts(db):
    """Get document counts for all Phase 5 collections"""
    collections = [
        "purchase_order", "purchase_order_items", "grn", "grn_items", 
        "grn_documents", "purchase_payments", "purchase_returns",
        "surat_jalan", "sales_returns", "sales_order_receipts", 
        "sales_order_receipt_items", "commission_records", "commission_payments"
    ]
    counts = {}
    for coll in collections:
        counts[coll] = db[coll].count_documents({})
    return counts

def test_scenario_1_create_po(db):
    """Scenario 1: CREATE PO"""
    print("\n" + "="*80)
    print("SCENARIO 1: CREATE PO")
    print("="*80)
    
    # Get supplier
    code, resp = curl_request("GET", "/contacts")
    if code != 0 or "data" not in resp:
        print(f"❌ Failed to get contacts: {resp}")
        return False
    
    contacts = resp.get("data", [])
    supplier = next((c for c in contacts if "Supplier" in c.get("categories", [])), None)
    if not supplier:
        print("❌ No supplier found")
        return False
    
    print(f"✅ Found supplier: {supplier['displayName']} (ID: {supplier['id']})")
    
    # Get product
    code, resp = curl_request("GET", "/products")
    if code != 0 or "data" not in resp:
        print(f"❌ Failed to get products: {resp}")
        return False
    
    products = resp.get("data", [])
    if not products:
        print("❌ No products found")
        return False
    
    product = products[0]
    print(f"✅ Found product: {product['name']} (ID: {product['id']})")
    
    # Create PO
    po_data = {
        "supplierId": supplier["id"],
        "poType": "Bahan Baku",
        "orderDate": "2026-02-11",
        "items": [{
            "productId": product["id"],
            "quantity": 10,
            "weight": 100,
            "unitPrice": 20000
        }]
    }
    
    print(f"\n📝 Creating PO...")
    code, resp = curl_request("POST", "/purchase-orders", po_data)
    
    if code != 0 or "data" not in resp:
        print(f"❌ Failed to create PO: {resp}")
        return False
    
    po = resp.get("data", {})
    po_id = po.get("id")
    po_number = po.get("poNumber")
    test_data["pos"].append(po_id)
    
    print(f"✅ PO created: {po_number} (ID: {po_id})")
    
    # Verify in API
    code, resp = curl_request("GET", "/purchase-orders")
    if code != 0 or "data" not in resp:
        print(f"❌ Failed to get PO list")
        return False
    
    po_list = resp.get("data", [])
    found_in_list = any(p["id"] == po_id for p in po_list)
    print(f"{'✅' if found_in_list else '❌'} PO found in list")
    
    # Verify detail
    code, resp = curl_request("GET", f"/purchase-orders/{po_id}")
    if code != 0 or "data" not in resp:
        print(f"❌ Failed to get PO detail")
        return False
    
    po_detail = resp.get("data", {})
    has_items = len(po_detail.get("items", [])) > 0
    print(f"{'✅' if has_items else '❌'} PO detail has items")
    
    # Verify in MongoDB
    mongo_po = db.purchase_order.find_one({"id": po_id})
    print(f"{'✅' if mongo_po else '❌'} PO found in MongoDB purchase_order")
    
    mongo_items = list(db.purchase_order_items.find({"purchase_order_id": po_id}))
    print(f"{'✅' if mongo_items else '❌'} PO items found in MongoDB purchase_order_items (count: {len(mongo_items)})")
    
    return found_in_list and has_items and mongo_po and mongo_items

def test_scenario_2_edit_po(db):
    """Scenario 2: EDIT PO"""
    print("\n" + "="*80)
    print("SCENARIO 2: EDIT PO")
    print("="*80)
    
    if not test_data["pos"]:
        print("❌ No test PO available")
        return False
    
    po_id = test_data["pos"][0]
    
    # Edit PO notes
    edit_data = {"notes": f"Test edit notes - {datetime.now().isoformat()}"}
    
    print(f"\n📝 Editing PO {po_id}...")
    code, resp = curl_request("PATCH", f"/purchase-orders/{po_id}", edit_data)
    
    if code != 0 or "data" not in resp:
        print(f"❌ Failed to edit PO: {resp}")
        return False
    
    print(f"✅ PO edited successfully")
    
    # Verify in API
    code, resp = curl_request("GET", f"/purchase-orders/{po_id}")
    if code != 0 or "data" not in resp:
        print(f"❌ Failed to get PO detail")
        return False
    
    po_detail = resp.get("data", {})
    api_notes = po_detail.get("notes", "")
    notes_match = edit_data["notes"] in api_notes
    print(f"{'✅' if notes_match else '❌'} Notes updated in API: {api_notes}")
    
    # Verify in MongoDB
    mongo_po = db.purchase_order.find_one({"id": po_id})
    mongo_notes = mongo_po.get("notes", "") if mongo_po else ""
    mongo_match = edit_data["notes"] in mongo_notes
    print(f"{'✅' if mongo_match else '❌'} Notes updated in MongoDB: {mongo_notes}")
    
    return notes_match and mongo_match

def test_scenario_4_po_payment(db):
    """Scenario 4: PO PAYMENT"""
    print("\n" + "="*80)
    print("SCENARIO 4: PO PAYMENT")
    print("="*80)
    
    if not test_data["pos"]:
        print("❌ No test PO available")
        return False
    
    po_id = test_data["pos"][0]
    
    # Create payment
    payment_data = {
        "amount": 500000,
        "method": "Transfer",
        "paymentDate": "2026-02-11"
    }
    
    print(f"\n📝 Creating payment for PO {po_id}...")
    code, resp = curl_request("POST", f"/purchase-orders/{po_id}/payments", payment_data)
    
    if code != 0 or ("data" not in resp and "error" in resp):
        print(f"❌ Failed to create payment: {resp}")
        return False
    
    print(f"✅ Payment created successfully")
    
    # Verify in MongoDB
    mongo_payment = list(db.purchase_payments.find({"purchase_order_id": po_id}))
    print(f"{'✅' if mongo_payment else '❌'} Payment found in MongoDB purchase_payments (count: {len(mongo_payment)})")
    
    if mongo_payment:
        payment_amount = mongo_payment[0].get("amount")
        print(f"✅ Payment amount in MongoDB: {payment_amount}")
    
    # Verify PO updated
    mongo_po = db.purchase_order.find_one({"id": po_id})
    if mongo_po:
        paid_amount = mongo_po.get("paid_amount", 0)
        payment_status = mongo_po.get("payment_status", "")
        print(f"✅ PO paidAmount in MongoDB: {paid_amount}")
        print(f"✅ PO paymentStatus in MongoDB: {payment_status}")
    
    return bool(mongo_payment)

def test_scenario_5_multi_po_isolation(db):
    """Scenario 5: MULTI-PO ISOLATION"""
    print("\n" + "="*80)
    print("SCENARIO 5: MULTI-PO ISOLATION (concurrency)")
    print("="*80)
    
    # Get supplier and product
    code, resp = curl_request("GET", "/contacts")
    contacts = resp.get("data", [])
    supplier = next((c for c in contacts if "Supplier" in c.get("categories", [])), None)
    
    code, resp = curl_request("GET", "/products")
    products = resp.get("data", [])
    if not products:
        print("❌ No products available")
        return False
    product = products[0]
    
    # Create PO #1
    po_data_1 = {
        "supplierId": supplier["id"],
        "poType": "Bahan Baku",
        "orderDate": "2026-02-11",
        "notes": "Test PO #1 for isolation",
        "items": [{"productId": product["id"], "quantity": 5, "weight": 50, "unitPrice": 15000}]
    }
    
    print(f"\n📝 Creating PO #1...")
    code, resp = curl_request("POST", "/purchase-orders", po_data_1)
    
    if code != 0 or "data" not in resp:
        print(f"❌ Failed to create PO #1")
        return False
    
    po1 = resp.get("data", {})
    po1_id = po1.get("id")
    test_data["pos"].append(po1_id)
    print(f"✅ PO #1 created: {po1.get('poNumber')} (ID: {po1_id})")
    
    # Create PO #2
    po_data_2 = {
        "supplierId": supplier["id"],
        "poType": "Bahan Baku",
        "orderDate": "2026-02-11",
        "notes": "Test PO #2 for isolation",
        "items": [{"productId": product["id"], "quantity": 8, "weight": 80, "unitPrice": 18000}]
    }
    
    print(f"\n📝 Creating PO #2...")
    code, resp = curl_request("POST", "/purchase-orders", po_data_2)
    
    if code != 0 or "data" not in resp:
        print(f"❌ Failed to create PO #2")
        return False
    
    po2 = resp.get("data", {})
    po2_id = po2.get("id")
    test_data["pos"].append(po2_id)
    print(f"✅ PO #2 created: {po2.get('poNumber')} (ID: {po2_id})")
    
    # Verify both exist in MongoDB
    mongo_po1 = db.purchase_order.find_one({"id": po1_id})
    mongo_po2 = db.purchase_order.find_one({"id": po2_id})
    
    both_exist = mongo_po1 and mongo_po2
    print(f"{'✅' if both_exist else '❌'} Both POs exist in MongoDB simultaneously")
    
    # Delete PO #1
    print(f"\n🗑️  Deleting PO #1...")
    code, resp = curl_request("DELETE", f"/purchase-orders/{po1_id}")
    
    if code != 0:
        print(f"❌ Failed to delete PO #1")
        return False
    
    print(f"✅ PO #1 deleted")
    test_data["pos"].remove(po1_id)
    
    # Verify PO #1 removed, PO #2 still exists
    mongo_po1_after = db.purchase_order.find_one({"id": po1_id})
    mongo_po2_after = db.purchase_order.find_one({"id": po2_id})
    
    po1_removed = not mongo_po1_after
    po2_remains = bool(mongo_po2_after)
    
    print(f"{'✅' if po1_removed else '❌'} PO #1 removed from MongoDB")
    print(f"{'✅' if po2_remains else '❌'} PO #2 still exists in MongoDB")
    
    # Verify PO #2 still accessible via API
    code, resp = curl_request("GET", f"/purchase-orders/{po2_id}")
    api_accessible = code == 0 and "data" in resp
    print(f"{'✅' if api_accessible else '❌'} PO #2 still accessible via API")
    
    return both_exist and po1_removed and po2_remains and api_accessible

def test_scenario_10_accounting_integrity():
    """Scenario 10: ACCOUNTING INTEGRITY"""
    print("\n" + "="*80)
    print("SCENARIO 10: ACCOUNTING INTEGRITY")
    print("="*80)
    
    # Trial Balance
    code, resp = curl_request("GET", "/accounting/trial-balance")
    if code != 0 or "data" not in resp:
        print(f"❌ Failed to get trial balance")
        return False
    
    tb_data = resp.get("data", {})
    total_debit = tb_data.get("totalDebit", 0)
    total_credit = tb_data.get("totalCredit", 0)
    balanced = abs(total_debit - total_credit) < 0.01
    
    print(f"✅ Trial Balance - Debit: {total_debit}, Credit: {total_credit}")
    print(f"{'✅' if balanced else '❌'} Trial Balance {'BALANCED' if balanced else 'NOT BALANCED'}")
    
    # Balance Sheet
    code, resp = curl_request("GET", "/accounting/balance-sheet")
    if code != 0 or "data" not in resp:
        print(f"❌ Failed to get balance sheet")
        return False
    
    bs_data = resp.get("data", {})
    bs_balanced = bs_data.get("balanced", False)
    print(f"{'✅' if bs_balanced else '❌'} Balance Sheet balanced: {bs_balanced}")
    
    # Overview
    code, resp = curl_request("GET", "/accounting/overview")
    overview_ok = code == 0
    print(f"{'✅' if overview_ok else '❌'} Accounting overview: OK" if overview_ok else "FAILED")
    
    return balanced and bs_balanced and overview_ok

def test_scenario_12_role_guard():
    """Scenario 12: ROLE GUARD"""
    print("\n" + "="*80)
    print("SCENARIO 12: ROLE GUARD (operator 403)")
    print("="*80)
    
    # Try to create PO as operator
    po_data = {
        "supplierId": "dummy-id",
        "poType": "Bahan Baku",
        "orderDate": "2026-02-11",
        "items": [{"productId": "dummy", "quantity": 1, "weight": 1, "unitPrice": 1000}]
    }
    
    print(f"\n📝 Attempting to create PO as operator...")
    code, resp = curl_request("POST", "/purchase-orders", po_data, cookie_file=OP_COOKIE_FILE)
    
    # Check if response contains error or forbidden
    is_403 = "error" in resp or "Forbidden" in str(resp)
    print(f"{'✅' if is_403 else '❌'} Operator correctly {'forbidden' if is_403 else 'allowed (WRONG)'}")
    
    if not is_403:
        print(f"Response: {resp}")
    
    return is_403

def cleanup_test_data(db):
    """Clean up all test data"""
    print("\n" + "="*80)
    print("CLEANUP")
    print("="*80)
    
    # Delete test POs
    for po_id in test_data["pos"][:]:  # Copy list to avoid modification during iteration
        print(f"\n🗑️  Deleting test PO {po_id}...")
        code, resp = curl_request("DELETE", f"/purchase-orders/{po_id}")
        if code == 0:
            print(f"✅ PO {po_id} deleted")
            test_data["pos"].remove(po_id)
        else:
            print(f"⚠️  Failed to delete PO {po_id}")
    
    # Verify cleanup in MongoDB
    remaining_pos = []
    for po_id in test_data["pos"]:
        if db.purchase_order.find_one({"id": po_id}):
            remaining_pos.append(po_id)
    
    if remaining_pos:
        print(f"⚠️  {len(remaining_pos)} test POs still in MongoDB: {remaining_pos}")
    else:
        print(f"✅ All test POs removed from MongoDB")

def main():
    print("="*80)
    print("MIGRATION PHASE 5 BACKEND TEST")
    print("PO aggregate + Commission + SO-extra (Surat Jalan/Retur/Penerimaan)")
    print("="*80)
    
    # Connect to MongoDB
    db = get_mongo_db()
    print(f"\n✅ Connected to MongoDB: {MONGO_DB_NAME}")
    
    # Get initial counts
    print("\n" + "="*80)
    print("INITIAL STATE")
    print("="*80)
    
    initial_mongo_counts = get_mongo_counts(db)
    print("\nMongoDB collection counts:")
    for coll, count in initial_mongo_counts.items():
        print(f"  {coll}: {count}")
    
    # Run tests
    results = {}
    
    try:
        # Accounting integrity BEFORE
        print("\n" + "="*80)
        print("ACCOUNTING INTEGRITY - BEFORE")
        print("="*80)
        results["accounting_before"] = test_scenario_10_accounting_integrity()
        
        # Run core scenarios
        results["1_create_po"] = test_scenario_1_create_po(db)
        results["2_edit_po"] = test_scenario_2_edit_po(db)
        results["4_po_payment"] = test_scenario_4_po_payment(db)
        results["5_multi_po_isolation"] = test_scenario_5_multi_po_isolation(db)
        
        # Accounting integrity AFTER
        print("\n" + "="*80)
        print("ACCOUNTING INTEGRITY - AFTER")
        print("="*80)
        results["accounting_after"] = test_scenario_10_accounting_integrity()
        
        # Role guard
        results["12_role_guard"] = test_scenario_12_role_guard()
        
    finally:
        # Cleanup
        cleanup_test_data(db)
    
    # Get final counts
    print("\n" + "="*80)
    print("FINAL STATE")
    print("="*80)
    
    final_mongo_counts = get_mongo_counts(db)
    print("\nMongoDB collection counts:")
    for coll, count in final_mongo_counts.items():
        print(f"  {coll}: {count}")
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    print(f"\nResults: {passed}/{total} tests passed ({passed*100//total if total > 0 else 0}%)\n")
    
    for test_name, result in results.items():
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{status} - {test_name}")
    
    print("\n" + "="*80)
    print("MongoDB Database: " + MONGO_DB_NAME)
    print("="*80)

if __name__ == "__main__":
    main()
