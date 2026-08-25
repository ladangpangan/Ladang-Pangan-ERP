#!/usr/bin/env python3
"""
Backend test for PHASE 2/3: Tally inbound reconciliation (Surat Jalan vs re-weigh)
Tests GET /api/purchase-orders/:id returns tallyWeight, tallyDone, tallyVariance
Tests GET /api/inventory enriches source with sjWeight, tallyWeight, tallyVariance
"""

import subprocess
import json
import sqlite3
from datetime import datetime
import tempfile
import os

BASE_URL = "http://localhost:3000/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
DB_PATH = "/app/data/erp.db"
COOKIE_FILE = "/tmp/test_cookies.txt"

def print_step(step_num, description, passed=None, details=""):
    """Print test step with status"""
    if passed is None:
        print(f"\n{'='*80}")
        print(f"STEP {step_num}: {description}")
        print('='*80)
    else:
        status = "✅ PASSED" if passed else "❌ FAILED"
        print(f"\n{status}: STEP {step_num} - {description}")
        if details:
            print(f"  {details}")

def curl_request(method, endpoint, data=None, expect_json=True):
    """Make a curl request with authentication"""
    url = f"{BASE_URL}{endpoint}"
    
    cmd = [
        "curl", "-s", "-X", method, url,
        "-b", COOKIE_FILE,
        "-H", "Content-Type: application/json"
    ]
    
    if data:
        cmd.extend(["-d", json.dumps(data)])
    
    # Add -w to get status code
    cmd.extend(["-w", "\n%{http_code}"])
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        output = result.stdout
        
        # Split output and status code
        lines = output.strip().split('\n')
        status_code = int(lines[-1])
        response_body = '\n'.join(lines[:-1])
        
        if expect_json and response_body:
            try:
                response_data = json.loads(response_body)
            except json.JSONDecodeError:
                response_data = {"raw": response_body}
        else:
            response_data = {"raw": response_body}
        
        return status_code, response_data
        
    except Exception as e:
        print(f"  ❌ curl exception: {e}")
        return None, None

def login():
    """Login via Better Auth and save cookies"""
    print("\n🔐 Logging in as admin...")
    
    cmd = [
        "curl", "-s", "-X", "POST", f"{BASE_URL}/auth/sign-in/email",
        "-H", "Content-Type: application/json",
        "-d", json.dumps({"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}),
        "-c", COOKIE_FILE,
        "-w", "\n%{http_code}"
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        lines = result.stdout.strip().split('\n')
        status_code = int(lines[-1])
        
        if status_code == 200:
            print(f"✅ Login successful")
            return True
        else:
            print(f"❌ Login failed: {status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Login exception: {e}")
        return False

def cleanup_database(po_id, grn_id, transaction_id, temp_cs_id, original_total, original_status):
    """Cleanup database to restore original state"""
    print_step(7, "CLEANUP - Restore original state")
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Delete inventory stocks
        print(f"  Deleting inventory_stock where transaction_id = '{transaction_id}'...")
        cursor.execute("DELETE FROM inventory_stock WHERE transaction_id = ?", (transaction_id,))
        deleted_stocks = cursor.rowcount
        print(f"  ✓ Deleted {deleted_stocks} stock records")
        
        # Delete inventory transaction
        print(f"  Deleting inventory_transaction where id = '{transaction_id}'...")
        cursor.execute("DELETE FROM inventory_transaction WHERE id = ?", (transaction_id,))
        deleted_tx = cursor.rowcount
        print(f"  ✓ Deleted {deleted_tx} transaction record")
        
        # Delete GRN documents
        print(f"  Deleting grn_documents where grn_id = '{grn_id}'...")
        cursor.execute("DELETE FROM grn_documents WHERE grn_id = ?", (grn_id,))
        deleted_docs = cursor.rowcount
        print(f"  ✓ Deleted {deleted_docs} GRN document records")
        
        # Delete GRN items
        print(f"  Deleting grn_items where grn_id = '{grn_id}'...")
        cursor.execute("DELETE FROM grn_items WHERE grn_id = ?", (grn_id,))
        deleted_items = cursor.rowcount
        print(f"  ✓ Deleted {deleted_items} GRN item records")
        
        # Delete GRN
        print(f"  Deleting grn where id = '{grn_id}'...")
        cursor.execute("DELETE FROM grn WHERE id = ?", (grn_id,))
        deleted_grn = cursor.rowcount
        print(f"  ✓ Deleted {deleted_grn} GRN record")
        
        # Restore PO original state
        print(f"  Restoring purchase_order total_amount = {original_total}, pipeline_status = '{original_status}'...")
        cursor.execute(
            "UPDATE purchase_order SET total_amount = ?, pipeline_status = ? WHERE id = ?",
            (original_total, original_status, po_id)
        )
        updated_po = cursor.rowcount
        print(f"  ✓ Updated {updated_po} PO record")
        
        # Reset received_weight
        print(f"  Resetting purchase_order_items received_weight to 0...")
        cursor.execute(
            "UPDATE purchase_order_items SET received_weight = 0 WHERE purchase_order_id = ?",
            (po_id,)
        )
        updated_items = cursor.rowcount
        print(f"  ✓ Updated {updated_items} PO item records")
        
        # Delete temp cold storage
        print(f"  Deleting cold_storages where id = '{temp_cs_id}'...")
        cursor.execute("DELETE FROM cold_storages WHERE id = ?", (temp_cs_id,))
        deleted_cs = cursor.rowcount
        print(f"  ✓ Deleted {deleted_cs} cold storage record")
        
        conn.commit()
        conn.close()
        
        print_step(7, "CLEANUP", True, "All cleanup operations completed successfully")
        return True
        
    except Exception as e:
        print_step(7, "CLEANUP", False, f"Exception: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return False

def verify_cleanup(po_id, original_total):
    """Verify cleanup was successful"""
    print("\n📋 Verifying cleanup...")
    
    try:
        # Verify PO total restored
        status, data = curl_request("GET", f"/purchase-orders/{po_id}")
        if status == 200:
            po = data.get('data', {})
            current_total = po.get('totalAmount', 0)
            tally_done = po.get('tallyDone', False)
            
            if abs(current_total - original_total) < 0.01 and not tally_done:
                print(f"  ✅ PO total restored to {current_total} (original: {original_total})")
                print(f"  ✅ tallyDone = {tally_done} (should be false)")
            else:
                print(f"  ⚠️  PO total: {current_total} (expected: {original_total})")
                print(f"  ⚠️  tallyDone: {tally_done} (expected: false)")
        
        # Verify temp cold storage removed
        status, data = curl_request("GET", "/cold-storages")
        if status == 200:
            storages = data.get('data', [])
            temp_exists = any(cs.get('code') == 'CS-TMP-P23' for cs in storages)
            
            if not temp_exists:
                print(f"  ✅ Temp cold storage CS-TMP-P23 removed")
            else:
                print(f"  ⚠️  Temp cold storage CS-TMP-P23 still exists")
        
        return True
        
    except Exception as e:
        print(f"  ❌ Verification exception: {e}")
        return False

def main():
    print("\n" + "="*80)
    print("PHASE 2/3: TALLY RECONCILIATION TEST")
    print("="*80)
    
    # Login
    if not login():
        print("\n❌ TEST ABORTED: Login failed")
        return
    
    # Variables to track for cleanup
    po_id = None
    grn_id = None
    transaction_id = None
    temp_cs_id = None
    original_total = None
    original_status = None
    po_items = []
    
    try:
        # STEP 1: Find PO/202608/0006 and capture original state
        print_step(1, "Find PO/202608/0006 and capture original state")
        
        status, data = curl_request("GET", "/purchase-orders")
        if status != 200:
            print_step(1, "GET /api/purchase-orders", False, f"Status: {status}")
            return
        
        pos = data.get('data', [])
        target_po = None
        
        for po in pos:
            if po.get('poNumber') == 'PO/202608/0006':
                target_po = po
                po_id = po.get('id')
                break
        
        if not target_po:
            print_step(1, "Find PO/202608/0006", False, "PO/202608/0006 not found")
            return
        
        print(f"  ✓ Found PO/202608/0006, ID: {po_id}")
        
        # Get detailed PO info
        status, data = curl_request("GET", f"/purchase-orders/{po_id}")
        if status != 200:
            print_step(1, "GET PO details", False, f"Status: {status}")
            return
        
        po_detail = data.get('data', {})
        original_total = po_detail.get('totalAmount', 0)
        original_status = po_detail.get('pipelineStatus', 'Draft')
        po_items = po_detail.get('items', [])
        
        print(f"  ✓ Original total_amount: {original_total}")
        print(f"  ✓ Original pipeline_status: {original_status}")
        print(f"  ✓ Items count: {len(po_items)}")
        for item in po_items:
            print(f"    - Product ID: {item.get('productId')}, Weight: {item.get('weight')}, Quantity: {item.get('quantity')}")
        
        print_step(1, "Capture original state", True, f"PO ID: {po_id}, Total: {original_total}, Status: {original_status}")
        
        # STEP 2: Create GRN
        print_step(2, "Create GRN with Surat Jalan weight")
        
        today = datetime.now().strftime("%Y-%m-%d")
        grn_items = []
        for item in po_items:
            grn_items.append({
                "productId": item.get('productId'),
                "receivedWeight": item.get('weight'),
                "receivedQuantity": item.get('quantity')
            })
        
        grn_payload = {
            "receivedDate": today,
            "sjNumber": "SJ-P23",
            "items": grn_items
        }
        
        print(f"  Payload: {json.dumps(grn_payload, indent=2)}")
        
        status, data = curl_request("POST", f"/purchase-orders/{po_id}/grn", grn_payload)
        
        if status != 201:
            print_step(2, "Create GRN", False, f"Status: {status}, Response: {data}")
            return
        
        grn_id = data.get('data', {}).get('id')
        
        print(f"  ✓ GRN created successfully")
        print(f"  ✓ GRN ID: {grn_id}")
        
        print_step(2, "Create GRN", True, f"GRN ID: {grn_id}")
        
        # STEP 3: Create temporary cold storage
        print_step(3, "Create temporary cold storage")
        
        cs_payload = {
            "code": "CS-TMP-P23",
            "name": "Temp P23",
            "capacityKg": 100000,
            "location": "Test Location"
        }
        
        status, data = curl_request("POST", "/cold-storages", cs_payload)
        
        if status == 400:
            # Check error and retry with more fields if needed
            print(f"  ⚠️  400 error: {data}")
            print(f"  Retrying with additional fields...")
            
            cs_payload.update({
                "address": "Test Address",
                "phone": "081234567890"
            })
            
            status, data = curl_request("POST", "/cold-storages", cs_payload)
        
        if status != 201:
            print_step(3, "Create cold storage", False, f"Status: {status}, Response: {data}")
            return
        
        temp_cs_id = data.get('data', {}).get('id')
        
        print(f"  ✓ Cold storage created successfully")
        print(f"  ✓ Cold storage ID: {temp_cs_id}")
        
        print_step(3, "Create cold storage", True, f"CS ID: {temp_cs_id}")
        
        # STEP 4: Tally inbound with reduced weight (susut)
        print_step(4, "Create tally inbound with reduced weight (susut)")
        
        tally_items = []
        for item in po_items:
            tally_items.append({
                "productId": item.get('productId'),
                "weight": item.get('weight') - 2,  # Reduce by 2 kg (susut)
                "quantity": item.get('quantity'),
                "packagingType": "karung"
            })
        
        tally_payload = {
            "referenceType": "PO",
            "referenceId": po_id,
            "coldStorageId": temp_cs_id,
            "items": tally_items
        }
        
        print(f"  Payload: {json.dumps(tally_payload, indent=2)}")
        
        status, data = curl_request("POST", "/inventory/inbound", tally_payload)
        
        if status != 201:
            print_step(4, "Create tally inbound", False, f"Status: {status}, Response: {data}")
            return
        
        transaction_id = data.get('data', {}).get('transactionId')
        stock_ids = data.get('data', {}).get('stockIds', [])
        
        print(f"  ✓ Tally inbound created successfully")
        print(f"  ✓ Transaction ID: {transaction_id}")
        print(f"  ✓ Stock IDs: {stock_ids}")
        
        print_step(4, "Create tally inbound", True, f"Transaction ID: {transaction_id}, Stocks: {len(stock_ids)}")
        
        # STEP 5: Verify PO tallyWeight, tallyDone, tallyVariance
        print_step(5, "Verify PO tally reconciliation fields")
        
        status, data = curl_request("GET", f"/purchase-orders/{po_id}")
        if status != 200:
            print_step(5, "GET PO details", False, f"Status: {status}")
            return
        
        po_detail = data.get('data', {})
        
        tally_done = po_detail.get('tallyDone')
        tally_weight = po_detail.get('tallyWeight')
        tally_variance = po_detail.get('tallyVariance')
        total_received_weight = po_detail.get('totalReceivedWeight', 0)
        
        print(f"  tallyDone: {tally_done}")
        print(f"  tallyWeight: {tally_weight}")
        print(f"  tallyVariance: {tally_variance}")
        print(f"  totalReceivedWeight: {total_received_weight}")
        
        # Calculate expected values
        expected_tally_weight = sum(item.get('weight') - 2 for item in po_items)
        expected_variance = expected_tally_weight - total_received_weight
        
        print(f"  Expected tallyWeight: ~{expected_tally_weight}")
        print(f"  Expected tallyVariance: ~{expected_variance} (negative = susut)")
        
        # Verify
        checks = []
        if tally_done == True:
            checks.append("✓ tallyDone == true")
        else:
            checks.append(f"✗ tallyDone == {tally_done} (expected: true)")
        
        if tally_weight is not None and abs(tally_weight - expected_tally_weight) < 0.1:
            checks.append(f"✓ tallyWeight ≈ {expected_tally_weight}")
        else:
            checks.append(f"✗ tallyWeight = {tally_weight} (expected: ~{expected_tally_weight})")
        
        if tally_variance is not None and tally_variance < 0:
            checks.append(f"✓ tallyVariance = {tally_variance} (negative = susut)")
        else:
            checks.append(f"✗ tallyVariance = {tally_variance} (expected: negative)")
        
        all_passed_step5 = all("✓" in check for check in checks)
        
        for check in checks:
            print(f"  {check}")
        
        print_step(5, "Verify PO tally fields", all_passed_step5, 
                  f"tallyDone={tally_done}, tallyWeight={tally_weight}, tallyVariance={tally_variance}")
        
        # STEP 6: Verify inventory source enrichment
        print_step(6, "Verify inventory source enrichment")
        
        status, data = curl_request("GET", "/inventory/stocks")
        if status != 200:
            print_step(6, "GET inventory", False, f"Status: {status}")
            return
        
        stocks = data.get('data', [])
        
        # Find stock with sourceType='PO' and source.number='PO/202608/0006'
        target_stock = None
        for stock in stocks:
            if stock.get('sourceType') == 'PO':
                source = stock.get('source', {})
                if source.get('number') == 'PO/202608/0006':
                    target_stock = stock
                    break
        
        if not target_stock:
            print_step(6, "Find PO-sourced stock", False, "No stock found with sourceType='PO' and source.number='PO/202608/0006'")
            return
        
        source = target_stock.get('source', {})
        sj_weight = source.get('sjWeight')
        source_tally_weight = source.get('tallyWeight')
        source_tally_variance = source.get('tallyVariance')
        
        print(f"  Found stock: {target_stock.get('id')}")
        print(f"  source.sjWeight: {sj_weight}")
        print(f"  source.tallyWeight: {source_tally_weight}")
        print(f"  source.tallyVariance: {source_tally_variance}")
        
        # Verify
        checks = []
        if sj_weight is not None and sj_weight > 0:
            checks.append(f"✓ source.sjWeight = {sj_weight} (> 0)")
        else:
            checks.append(f"✗ source.sjWeight = {sj_weight} (expected: > 0)")
        
        if source_tally_weight is not None and source_tally_weight > 0:
            checks.append(f"✓ source.tallyWeight = {source_tally_weight} (> 0)")
        else:
            checks.append(f"✗ source.tallyWeight = {source_tally_weight} (expected: > 0)")
        
        if source_tally_variance is not None and isinstance(source_tally_variance, (int, float)):
            checks.append(f"✓ source.tallyVariance = {source_tally_variance} (is a number)")
        else:
            checks.append(f"✗ source.tallyVariance = {source_tally_variance} (expected: number)")
        
        all_passed_step6 = all("✓" in check for check in checks)
        
        for check in checks:
            print(f"  {check}")
        
        print_step(6, "Verify inventory source", all_passed_step6,
                  f"sjWeight={sj_weight}, tallyWeight={source_tally_weight}, tallyVariance={source_tally_variance}")
        
        # STEP 7: Cleanup
        cleanup_success = cleanup_database(
            po_id, grn_id, transaction_id, temp_cs_id,
            original_total, original_status
        )
        
        if cleanup_success:
            verify_cleanup(po_id, original_total)
        
        # Final summary
        print("\n" + "="*80)
        print("TEST SUMMARY")
        print("="*80)
        print("✅ STEP 1: Find PO and capture original state")
        print("✅ STEP 2: Create GRN with SJ weight")
        print("✅ STEP 3: Create temporary cold storage")
        print("✅ STEP 4: Create tally inbound with susut")
        print(f"{'✅' if all_passed_step5 else '❌'} STEP 5: Verify PO tally fields")
        print(f"{'✅' if all_passed_step6 else '❌'} STEP 6: Verify inventory source enrichment")
        print(f"{'✅' if cleanup_success else '❌'} STEP 7: Cleanup and restore")
        print("="*80)
        
        # Overall result
        if all_passed_step5 and all_passed_step6 and cleanup_success:
            print("\n🎉 ALL TESTS PASSED!")
        else:
            print("\n⚠️  SOME TESTS FAILED - See details above")
        
    except Exception as e:
        print(f"\n❌ TEST EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
        
        # Attempt cleanup even on failure
        if all([po_id, grn_id, transaction_id, temp_cs_id, original_total, original_status]):
            print("\n⚠️  Attempting cleanup after exception...")
            cleanup_database(
                po_id, grn_id, transaction_id, temp_cs_id,
                original_total, original_status
            )

if __name__ == "__main__":
    main()
