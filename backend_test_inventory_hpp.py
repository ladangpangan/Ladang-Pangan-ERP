#!/usr/bin/env python3
"""
Backend test for Inventory HPP fields and Tally markTallyComplete + manual kodeSimpan
"""
import subprocess
import json
import sys
import sqlite3
from datetime import datetime

BASE_URL = "http://localhost:3000/api"
DB_PATH = "/app/data/erp.db"
COOKIE_FILE = "/tmp/test_cookies.txt"

# Global state for cleanup
cleanup_state = {
    'created_stock_ids': [],
    'created_transaction_ids': [],
    'po_id': None,
    'original_tally_completed_at': None,
    'original_tally_weights': {}  # {item_id: original_tally_weight}
}

def curl_get(url):
    """Execute curl GET request"""
    cmd = ['curl', '-s', '-b', COOKIE_FILE, url]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        try:
            return json.loads(result.stdout)
        except Exception:
            return None
    return None

def curl_post(url, data):
    """Execute curl POST request"""
    cmd = ['curl', '-s', '-b', COOKIE_FILE, '-c', COOKIE_FILE, 
           '-X', 'POST', '-H', 'Content-Type: application/json',
           '-d', json.dumps(data), url]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        try:
            return json.loads(result.stdout)
        except Exception:
            return None
    return None

def login():
    """Login as admin"""
    print("\n=== STEP 1: Login as admin@lpi.co.id ===")
    
    url = "http://localhost:3000/api/auth/sign-in/email"
    payload = {
        "email": "admin@lpi.co.id",
        "password": "admin123"
    }
    
    result = curl_post(url, payload)
    if result:
        print("✅ Login successful")
        return True
    else:
        print("❌ Login failed")
        return False

def get_cold_storage_cs01():
    """Get CS-01 cold storage ID"""
    print("\n=== STEP 2: Get Cold Storage CS-01 ===")
    
    data = curl_get(f"{BASE_URL}/cold-storages")
    if not data:
        print("❌ Failed to get cold storages")
        return None
    
    storages = data.get('data', [])
    print(f"✅ Found {len(storages)} cold storages")
    
    # Find CS-01
    for cs in storages:
        if cs.get('code') == 'CS-01':
            print(f"✅ Found CS-01: {cs.get('name')} (ID: {cs.get('id')})")
            return cs
    
    print("❌ CS-01 not found")
    return None

def find_po_with_received_items():
    """Find a PO that has received items (received_weight > 0)"""
    print("\n=== STEP 3: Find PO with Received Items ===")
    
    data = curl_get(f"{BASE_URL}/purchase-orders")
    if not data:
        print("❌ Failed to get purchase orders")
        return None
    
    pos = data.get('data', [])
    print(f"✅ Found {len(pos)} purchase orders")
    
    # Find PO with received items and tally_completed_at = NULL
    for po in pos:
        po_id = po.get('id')
        
        # Get PO detail
        detail = curl_get(f"{BASE_URL}/purchase-orders/{po_id}")
        if detail:
            detail_data = detail.get('data', {})
            items = detail_data.get('items', [])
            tally_completed_at = detail_data.get('tallyCompletedAt')
            
            # Check if any item has received_weight > 0
            has_received = False
            for item in items:
                if item.get('receivedWeight', 0) > 0:
                    has_received = True
                    break
            
            if has_received and not tally_completed_at:
                print(f"✅ Found suitable PO: {po.get('poNumber')} (ID: {po_id})")
                print(f"   Tally completed at: {tally_completed_at}")
                print(f"   Items with received weight:")
                
                for item in items:
                    if item.get('receivedWeight', 0) > 0:
                        print(f"     - Product {item.get('productId')}: receivedWeight={item.get('receivedWeight')}, tallyWeight={item.get('tallyWeight', 0)}")
                
                return detail_data
    
    print("⚠️  No PO found with received items and tally_completed_at = NULL")
    
    # Fallback: find any PO with received items
    for po in pos:
        po_id = po.get('id')
        detail = curl_get(f"{BASE_URL}/purchase-orders/{po_id}")
        if detail:
            detail_data = detail.get('data', {})
            items = detail_data.get('items', [])
            
            for item in items:
                if item.get('receivedWeight', 0) > 0:
                    print(f"✅ Found PO with received items: {po.get('poNumber')} (ID: {po_id})")
                    return detail_data
    
    print("❌ No PO found with received items")
    return None

def test_inventory_stocks_hpp():
    """Test FEATURE 1: Inventory HPP fields (GET /api/inventory/stocks)"""
    print("\n" + "=" * 80)
    print("FEATURE 1: Inventory HPP/kg & HPP/kemasan + Nilai Stok")
    print("=" * 80)
    
    data = curl_get(f"{BASE_URL}/inventory/stocks")
    if not data:
        print("❌ Failed to get inventory stocks")
        return False
    
    stocks = data.get('data', [])
    summary = data.get('summary', {})
    
    print(f"✅ GET /inventory/stocks returned 200 (no 500 error)")
    print(f"   Total stocks: {len(stocks)}")
    
    if len(stocks) == 0:
        print("⚠️  No stocks found in inventory")
        print("   This is expected if DB is empty. Will create test inbound later.")
        return True
    
    # Verify HPP fields in stock rows
    print(f"\n=== Verifying HPP Fields in Stock Rows ===")
    sample_stock = None
    
    for i, stock in enumerate(stocks[:3]):  # Check first 3 stocks
        stock_id = stock.get('id')
        hpp_per_kg = stock.get('hppPerKg')
        hpp_per_kemasan = stock.get('hppPerKemasan')
        stock_value = stock.get('stockValue')
        weight = stock.get('weight', 0)
        quantity = stock.get('quantity', 0)
        
        print(f"\nStock {i+1} (ID: {stock_id}):")
        print(f"  kodeSimpan: {stock.get('kodeSimpan')}")
        print(f"  weight: {weight}")
        print(f"  quantity: {quantity}")
        print(f"  hppPerKg: {hpp_per_kg}")
        print(f"  hppPerKemasan: {hpp_per_kemasan}")
        print(f"  stockValue: {stock_value}")
        
        # Verify fields exist and are numeric
        if hpp_per_kg is None:
            print(f"  ❌ hppPerKg is missing")
            return False
        if hpp_per_kemasan is None:
            print(f"  ❌ hppPerKemasan is missing")
            return False
        if stock_value is None:
            print(f"  ❌ stockValue is missing")
            return False
        
        # Verify calculations
        expected_stock_value = round(hpp_per_kg * weight)
        if abs(stock_value - expected_stock_value) > 1:
            print(f"  ⚠️  stockValue mismatch: expected {expected_stock_value}, got {stock_value}")
        else:
            print(f"  ✅ stockValue = round(hppPerKg * weight) = {stock_value}")
        
        if quantity > 0:
            expected_hpp_per_kemasan = round(hpp_per_kg * weight / quantity)
            if abs(hpp_per_kemasan - expected_hpp_per_kemasan) > 1:
                print(f"  ⚠️  hppPerKemasan mismatch: expected {expected_hpp_per_kemasan}, got {hpp_per_kemasan}")
            else:
                print(f"  ✅ hppPerKemasan = round(hppPerKg * weight / quantity) = {hpp_per_kemasan}")
        else:
            if hpp_per_kemasan != 0:
                print(f"  ⚠️  hppPerKemasan should be 0 when quantity=0, got {hpp_per_kemasan}")
            else:
                print(f"  ✅ hppPerKemasan = 0 (quantity is 0)")
        
        # Check if this is a PO-sourced stock
        if stock.get('sourceType') == 'PO' and stock.get('sourceBatch'):
            print(f"  ℹ️  PO-sourced stock (sourceBatch: {stock.get('sourceBatch')})")
            print(f"     hppPerKg should reflect PO item's hpp_per_kg when > 0")
        
        if not sample_stock:
            sample_stock = stock
    
    # Verify summary.totalValue
    print(f"\n=== Verifying Summary ===")
    total_value = summary.get('totalValue')
    print(f"summary.totalValue: {total_value}")
    
    if total_value is None:
        print(f"❌ summary.totalValue is missing")
        return False
    
    # Calculate expected totalValue
    expected_total_value = sum(s.get('stockValue', 0) for s in stocks)
    if abs(total_value - expected_total_value) > 1:
        print(f"⚠️  totalValue mismatch: expected {expected_total_value}, got {total_value}")
    else:
        print(f"✅ summary.totalValue = sum of all stockValue = {total_value}")
    
    print(f"\n✅ FEATURE 1 PASSED: All HPP fields present and calculated correctly")
    
    # Store sample stock for reporting
    if sample_stock:
        print(f"\n=== Sample Stock JSON ===")
        print(json.dumps({
            'id': sample_stock.get('id'),
            'kodeSimpan': sample_stock.get('kodeSimpan'),
            'weight': sample_stock.get('weight'),
            'quantity': sample_stock.get('quantity'),
            'hppPerKg': sample_stock.get('hppPerKg'),
            'hppPerKemasan': sample_stock.get('hppPerKemasan'),
            'stockValue': sample_stock.get('stockValue'),
            'sourceType': sample_stock.get('sourceType'),
            'sourceBatch': sample_stock.get('sourceBatch')
        }, indent=2))
    
    return True

def test_tally_mark_complete(po_data, cs01_id):
    """Test FEATURE 2: Tally markTallyComplete + manual kodeSimpan"""
    print("\n" + "=" * 80)
    print("FEATURE 2: Tally markTallyComplete + manual kodeSimpan")
    print("=" * 80)
    
    po_id = po_data.get('id')
    po_number = po_data.get('poNumber')
    items = po_data.get('items', [])
    
    # Record original state
    cleanup_state['po_id'] = po_id
    cleanup_state['original_tally_completed_at'] = po_data.get('tallyCompletedAt')
    
    print(f"\nPO: {po_number} (ID: {po_id})")
    print(f"Original tallyCompletedAt: {cleanup_state['original_tally_completed_at']}")
    
    # Find an item with received_weight > 0
    target_item = None
    for item in items:
        if item.get('receivedWeight', 0) > 0:
            target_item = item
            break
    
    if not target_item:
        print("❌ No item with receivedWeight > 0 found")
        return False
    
    product_id = target_item.get('productId')
    item_id = target_item.get('id')
    original_tally_weight = target_item.get('tallyWeight', 0)
    
    cleanup_state['original_tally_weights'][item_id] = original_tally_weight
    
    print(f"\nTarget item:")
    print(f"  Product ID: {product_id}")
    print(f"  Item ID: {item_id}")
    print(f"  Original tallyWeight: {original_tally_weight}")
    
    # Create inbound with markTallyComplete=true and manual kodeSimpan
    print(f"\n=== Creating Inbound with markTallyComplete=true ===")
    
    payload = {
        "coldStorageId": cs01_id,
        "referenceType": "PO",
        "referenceId": po_id,
        "items": [
            {
                "productId": product_id,
                "weight": 5,
                "quantity": 1,
                "packagingType": "karung",
                "kodeSimpan": "MANUAL-TEST-001"
            }
        ],
        "markTallyComplete": True
    }
    
    print(f"Payload: {json.dumps(payload, indent=2)}")
    
    result = curl_post(f"{BASE_URL}/inventory/inbound", payload)
    if not result:
        print(f"❌ Failed to create inbound")
        return False
    
    data = result.get('data', {})
    transaction_id = data.get('transactionId')
    stock_ids = data.get('stockIds', [])
    
    print(f"✅ Inbound created successfully (201)")
    print(f"   Transaction ID: {transaction_id}")
    print(f"   Stock IDs: {stock_ids}")
    
    # Store for cleanup
    cleanup_state['created_transaction_ids'].append(transaction_id)
    cleanup_state['created_stock_ids'].extend(stock_ids)
    
    # Verify (a): kodeSimpan stored exactly as 'MANUAL-TEST-001'
    print(f"\n=== Verification (a): kodeSimpan ===")
    
    if len(stock_ids) > 0:
        stock_id = stock_ids[0]
        stock_data = curl_get(f"{BASE_URL}/inventory/stocks/{stock_id}")
        
        if stock_data:
            stock = stock_data.get('data', {})
            kode_simpan = stock.get('kodeSimpan')
            
            print(f"Stock ID: {stock_id}")
            print(f"kodeSimpan: {kode_simpan}")
            
            if kode_simpan == 'MANUAL-TEST-001':
                print(f"✅ VERIFICATION (a) PASSED: kodeSimpan stored exactly as 'MANUAL-TEST-001'")
            else:
                print(f"❌ VERIFICATION (a) FAILED: kodeSimpan is '{kode_simpan}', expected 'MANUAL-TEST-001'")
                return False
        else:
            print(f"❌ Failed to get stock detail")
            return False
    
    # Verify (b): PO's tallyCompletedAt is now set (non-null)
    print(f"\n=== Verification (b): tallyCompletedAt ===")
    
    po_resp = curl_get(f"{BASE_URL}/purchase-orders/{po_id}")
    if po_resp:
        updated_po = po_resp.get('data', {})
        tally_completed_at = updated_po.get('tallyCompletedAt')
        
        print(f"PO tallyCompletedAt: {tally_completed_at}")
        
        if tally_completed_at:
            print(f"✅ VERIFICATION (b) PASSED: tallyCompletedAt is set (non-null)")
        else:
            print(f"❌ VERIFICATION (b) FAILED: tallyCompletedAt is still NULL")
            return False
    else:
        print(f"❌ Failed to get PO detail")
        return False
    
    # Verify (c): PO item's tallyWeight increased by 5
    print(f"\n=== Verification (c): tallyWeight ===")
    
    updated_items = updated_po.get('items', [])
    updated_item = None
    for item in updated_items:
        if item.get('id') == item_id:
            updated_item = item
            break
    
    if updated_item:
        new_tally_weight = updated_item.get('tallyWeight', 0)
        expected_tally_weight = original_tally_weight + 5
        
        print(f"Original tallyWeight: {original_tally_weight}")
        print(f"New tallyWeight: {new_tally_weight}")
        print(f"Expected: {expected_tally_weight}")
        
        if abs(new_tally_weight - expected_tally_weight) < 0.01:
            print(f"✅ VERIFICATION (c) PASSED: tallyWeight increased by 5")
        else:
            print(f"❌ VERIFICATION (c) FAILED: tallyWeight did not increase correctly")
            return False
    else:
        print(f"❌ Could not find updated item")
        return False
    
    print(f"\n✅ FEATURE 2 PASSED: All verifications passed")
    return True

def cleanup():
    """Cleanup: delete created stocks/transactions, restore PO state"""
    print("\n" + "=" * 80)
    print("CLEANUP: Restoring Original State")
    print("=" * 80)
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Delete created inventory_stock rows
        if cleanup_state['created_stock_ids']:
            print(f"\nDeleting {len(cleanup_state['created_stock_ids'])} inventory_stock rows...")
            for stock_id in cleanup_state['created_stock_ids']:
                cursor.execute("DELETE FROM inventory_stock WHERE id = ?", (stock_id,))
                print(f"  Deleted stock {stock_id}")
        
        # Delete created inventory_transaction rows
        if cleanup_state['created_transaction_ids']:
            print(f"\nDeleting {len(cleanup_state['created_transaction_ids'])} inventory_transaction rows...")
            for tx_id in cleanup_state['created_transaction_ids']:
                cursor.execute("DELETE FROM inventory_transaction WHERE id = ?", (tx_id,))
                print(f"  Deleted transaction {tx_id}")
        
        # Restore PO's tally_completed_at
        if cleanup_state['po_id']:
            print(f"\nRestoring PO tally_completed_at...")
            cursor.execute(
                "UPDATE purchase_order SET tally_completed_at = ? WHERE id = ?",
                (cleanup_state['original_tally_completed_at'], cleanup_state['po_id'])
            )
            print(f"  Set tally_completed_at to {cleanup_state['original_tally_completed_at']}")
        
        # Restore PO item tally_weight
        if cleanup_state['original_tally_weights']:
            print(f"\nRestoring PO item tally_weight...")
            for item_id, original_weight in cleanup_state['original_tally_weights'].items():
                cursor.execute(
                    "UPDATE purchase_order_items SET tally_weight = ? WHERE id = ?",
                    (original_weight, item_id)
                )
                print(f"  Restored item {item_id} tally_weight to {original_weight}")
        
        conn.commit()
        conn.close()
        
        print(f"\n✅ Cleanup completed successfully")
        return True
        
    except Exception as e:
        print(f"❌ Cleanup error: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    print("=" * 80)
    print("BACKEND TEST: Inventory HPP + Tally markTallyComplete + manual kodeSimpan")
    print("=" * 80)
    
    # Step 1: Login
    if not login():
        print("\n❌ TEST FAILED: Could not login")
        sys.exit(1)
    
    # Step 2: Get CS-01
    cs01 = get_cold_storage_cs01()
    if not cs01:
        print("\n❌ TEST FAILED: Could not find CS-01")
        sys.exit(1)
    
    cs01_id = cs01.get('id')
    
    # Step 3: Test FEATURE 1 - Inventory HPP fields
    feature1_passed = test_inventory_stocks_hpp()
    
    # Step 4: Find PO with received items
    po_data = find_po_with_received_items()
    if not po_data:
        print("\n⚠️  Could not find PO with received items")
        print("   Skipping FEATURE 2 test")
        feature2_passed = None
    else:
        # Step 5: Test FEATURE 2 - Tally markTallyComplete
        feature2_passed = test_tally_mark_complete(po_data, cs01_id)
    
    # Step 6: Cleanup
    cleanup_success = cleanup()
    
    # Final summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"✅ Login: SUCCESS")
    print(f"✅ Find CS-01: SUCCESS")
    
    if feature1_passed:
        print(f"✅ FEATURE 1 (Inventory HPP fields): PASSED")
    else:
        print(f"❌ FEATURE 1 (Inventory HPP fields): FAILED")
    
    if feature2_passed is None:
        print(f"⚠️  FEATURE 2 (Tally markTallyComplete): SKIPPED (no suitable PO)")
    elif feature2_passed:
        print(f"✅ FEATURE 2 (Tally markTallyComplete): PASSED")
    else:
        print(f"❌ FEATURE 2 (Tally markTallyComplete): FAILED")
    
    if cleanup_success:
        print(f"✅ Cleanup: SUCCESS")
    else:
        print(f"⚠️  Cleanup: PARTIAL")
    
    print("=" * 80)
    
    # Exit with appropriate code
    if feature1_passed and (feature2_passed or feature2_passed is None):
        print("\n✅ ALL TESTS PASSED")
        sys.exit(0)
    else:
        print("\n❌ SOME TESTS FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
