#!/usr/bin/env python3
"""
Backend test for Kartu Stok (Stock Card) feature.
Tests the stock_ledger table, recordLedger hooks, and /inventory-reports/stock-card endpoint.
"""

import requests
import json
from datetime import datetime, timedelta

# Base URL for the API
BASE_URL = "http://localhost:3000/api"

# Test credentials
EMAIL = "admin@lpi.co.id"
PASSWORD = "admin123"

# Global session
session = requests.Session()

def login():
    """Login and get session cookie"""
    print("\n=== LOGIN ===")
    try:
        # Better Auth login endpoint - use curl since Python requests has issues with __Secure- cookies over HTTP
        import subprocess
        import os
        
        # Login with curl and save cookies
        cookie_file = "/tmp/test_cookies.txt"
        login_cmd = f'curl -s -X POST http://localhost:3000/api/auth/sign-in/email -H "Content-Type: application/json" -d \'{{"email":"{EMAIL}","password":"{PASSWORD}"}}\' -c {cookie_file}'
        result = subprocess.run(login_cmd, shell=True, capture_output=True, text=True)
        
        if result.returncode != 0:
            print(f"❌ Login failed: {result.stderr}")
            return False
        
        # Read the cookie file and extract the session token
        if os.path.exists(cookie_file):
            with open(cookie_file, 'r') as f:
                for line in f:
                    if '__Secure-better-auth.session_token' in line:
                        parts = line.strip().split('\t')
                        if len(parts) >= 7:
                            token = parts[6]
                            # Set the cookie in the session
                            session.cookies.set('__Secure-better-auth.session_token', token, domain='localhost', path='/')
                            print(f"✅ Login successful - session token extracted")
                            return True
        
        print(f"❌ Login failed: Could not extract session token")
        return False
    except Exception as e:
        print(f"❌ Login error: {e}")
        return False

def get_products():
    """Get list of products"""
    print("\n=== GET PRODUCTS ===")
    try:
        response = session.get(f"{BASE_URL}/products")
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            products = data.get('data', [])
            print(f"✅ Found {len(products)} products")
            if products:
                product = products[0]
                print(f"   Using product: {product.get('name')} (SKU: {product.get('sku')}, ID: {product.get('id')})")
                return product
        else:
            print(f"❌ Failed to get products: {response.text}")
        return None
    except Exception as e:
        print(f"❌ Error getting products: {e}")
        return None

def get_cold_storages():
    """Get list of cold storages"""
    print("\n=== GET COLD STORAGES ===")
    try:
        response = session.get(f"{BASE_URL}/cold-storages")
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            cold_storages = data.get('data', [])
            print(f"✅ Found {len(cold_storages)} cold storages")
            for cs in cold_storages[:2]:
                print(f"   - {cs.get('name')} (Code: {cs.get('code')}, ID: {cs.get('id')})")
            return cold_storages
        else:
            print(f"❌ Failed to get cold storages: {response.text}")
        return []
    except Exception as e:
        print(f"❌ Error getting cold storages: {e}")
        return []

def create_cold_storage(code, name):
    """Create a new cold storage"""
    print(f"\n=== CREATE COLD STORAGE: {name} ===")
    try:
        response = session.post(f"{BASE_URL}/cold-storages", json={
            "code": code,
            "name": name,
            "location": "Test Location",
            "temperatureRange": "-18 to -22 C",
            "capacityKg": 10000
        })
        print(f"Status: {response.status_code}")
        if response.status_code == 201:
            data = response.json()
            cs = data.get('data', {})
            print(f"✅ Created cold storage: {cs.get('name')} (ID: {cs.get('id')})")
            return cs
        else:
            print(f"❌ Failed to create cold storage: {response.text}")
        return None
    except Exception as e:
        print(f"❌ Error creating cold storage: {e}")
        return None

def create_inbound(product_id, cold_storage_id, weight, quantity):
    """Create inbound inventory"""
    print(f"\n=== SCENARIO A: CREATE INBOUND (weight={weight}, qty={quantity}) ===")
    try:
        response = session.post(f"{BASE_URL}/inventory/inbound", json={
            "referenceType": "MANUAL",
            "coldStorageId": cold_storage_id,
            "items": [{
                "productId": product_id,
                "weight": weight,
                "quantity": quantity
            }]
        })
        print(f"Status: {response.status_code}")
        if response.status_code == 201:
            data = response.json()
            print(f"✅ Inbound created successfully")
            print(f"   Transaction ID: {data.get('transactionId')}")
            stock_ids = data.get('stockIds', [])
            print(f"   Stock IDs: {stock_ids}")
            return data
        else:
            print(f"❌ Failed to create inbound: {response.text}")
        return None
    except Exception as e:
        print(f"❌ Error creating inbound: {e}")
        return None

def get_stock_card(product_id, cold_storage_id=None, from_date=None, to_date=None):
    """Get stock card for a product"""
    params = {"productId": product_id}
    if cold_storage_id:
        params["coldStorageId"] = cold_storage_id
    if from_date:
        params["from"] = from_date
    if to_date:
        params["to"] = to_date
    
    filter_desc = f"productId={product_id}"
    if cold_storage_id:
        filter_desc += f", coldStorageId={cold_storage_id[:8]}..."
    if from_date:
        filter_desc += f", from={from_date}"
    if to_date:
        filter_desc += f", to={to_date}"
    
    print(f"\n=== GET STOCK CARD ({filter_desc}) ===")
    try:
        response = session.get(f"{BASE_URL}/inventory-reports/stock-card", params=params)
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            card_data = data.get('data', {})
            product = card_data.get('product', {})
            opening = card_data.get('opening', {})
            movements = card_data.get('movements', [])
            summary = card_data.get('summary', {})
            
            print(f"✅ Stock card retrieved")
            print(f"   Product: {product.get('name')} ({product.get('sku')})")
            print(f"   Opening: weight={opening.get('weight')}, qty={opening.get('qty')}")
            print(f"   Movements: {len(movements)} records")
            for i, m in enumerate(movements, 1):
                print(f"      {i}. {m.get('movementType')} - weight_in={m.get('weightIn')}, weight_out={m.get('weightOut')}, balance={m.get('balanceWeight')}")
            print(f"   Summary:")
            print(f"      Total In: {summary.get('totalInWeight')} kg")
            print(f"      Total Out: {summary.get('totalOutWeight')} kg")
            print(f"      Closing: {summary.get('closingWeight')} kg, {summary.get('closingQty')} qty")
            print(f"      Count: {summary.get('count')} movements")
            return card_data
        else:
            print(f"❌ Failed to get stock card: {response.text}")
        return None
    except Exception as e:
        print(f"❌ Error getting stock card: {e}")
        return None

def transfer_cold_storage(stock_ids, to_cold_storage_id):
    """Transfer stock to another cold storage"""
    print(f"\n=== SCENARIO C: TRANSFER TO CS (stockIds={stock_ids}, toCS={to_cold_storage_id[:8]}...) ===")
    try:
        response = session.post(f"{BASE_URL}/inventory/transfer-cs", json={
            "stockIds": stock_ids,
            "toColdStorageId": to_cold_storage_id
        })
        print(f"Status: {response.status_code}")
        if response.status_code == 201:
            data = response.json()
            print(f"✅ Transfer successful")
            print(f"   Transaction ID: {data.get('transactionId')}")
            return data
        else:
            print(f"❌ Failed to transfer: {response.text}")
        return None
    except Exception as e:
        print(f"❌ Error transferring: {e}")
        return None

def create_outbound(stock_ids, subtype, reason):
    """Create outbound inventory"""
    print(f"\n=== SCENARIO D: CREATE OUTBOUND (subtype={subtype}, reason={reason}) ===")
    try:
        response = session.post(f"{BASE_URL}/inventory/outbound", json={
            "stockIds": stock_ids,
            "subtype": subtype,
            "reason": reason
        })
        print(f"Status: {response.status_code}")
        if response.status_code == 201:
            data = response.json()
            print(f"✅ Outbound created successfully")
            print(f"   Transaction ID: {data.get('transactionId')}")
            return data
        else:
            print(f"❌ Failed to create outbound: {response.text}")
        return None
    except Exception as e:
        print(f"❌ Error creating outbound: {e}")
        return None

def test_edge_case_no_product_id():
    """Test edge case: GET stock-card without productId"""
    print("\n=== SCENARIO G: EDGE CASE - NO PRODUCT ID ===")
    try:
        response = session.get(f"{BASE_URL}/inventory-reports/stock-card")
        print(f"Status: {response.status_code}")
        if response.status_code == 400:
            data = response.json()
            error = data.get('error', '')
            print(f"✅ Correctly rejected with 400")
            print(f"   Error message: {error}")
            if 'productId' in error.lower() and 'required' in error.lower():
                print(f"✅ Error message mentions 'productId required'")
                return True
            else:
                print(f"⚠️  Error message doesn't match expected format")
                return False
        else:
            print(f"❌ Expected 400, got {response.status_code}: {response.text}")
        return False
    except Exception as e:
        print(f"❌ Error testing edge case: {e}")
        return False

def verify_scenario_b(product_id, expected_total_in, expected_closing, expected_movement_count):
    """Verify scenario B: stock card after inbound"""
    print(f"\n=== SCENARIO B: VERIFY STOCK CARD AFTER INBOUND ===")
    card = get_stock_card(product_id)
    if not card:
        print("❌ Failed to get stock card")
        return False
    
    summary = card.get('summary', {})
    movements = card.get('movements', [])
    opening = card.get('opening', {})
    
    success = True
    
    # Check opening balance
    if opening.get('weight') == 0:
        print(f"✅ Opening weight is 0 (expected)")
    else:
        print(f"❌ Opening weight is {opening.get('weight')}, expected 0")
        success = False
    
    # Check total in weight
    if summary.get('totalInWeight') == expected_total_in:
        print(f"✅ Total in weight is {expected_total_in} (expected)")
    else:
        print(f"❌ Total in weight is {summary.get('totalInWeight')}, expected {expected_total_in}")
        success = False
    
    # Check closing weight
    if summary.get('closingWeight') == expected_closing:
        print(f"✅ Closing weight is {expected_closing} (expected)")
    else:
        print(f"❌ Closing weight is {summary.get('closingWeight')}, expected {expected_closing}")
        success = False
    
    # Check movement count
    if len(movements) == expected_movement_count:
        print(f"✅ Movement count is {expected_movement_count} (expected)")
    else:
        print(f"❌ Movement count is {len(movements)}, expected {expected_movement_count}")
        success = False
    
    # Check movement type
    if movements and movements[0].get('movementType') == 'IN':
        print(f"✅ First movement type is 'IN' (expected)")
    else:
        print(f"❌ First movement type is {movements[0].get('movementType') if movements else 'N/A'}, expected 'IN'")
        success = False
    
    # Check balance weight
    if movements and movements[0].get('balanceWeight') == expected_closing:
        print(f"✅ First movement balance weight is {expected_closing} (expected)")
    else:
        print(f"❌ First movement balance weight is {movements[0].get('balanceWeight') if movements else 'N/A'}, expected {expected_closing}")
        success = False
    
    return success

def verify_scenario_c(product_id, cs1_id, cs2_id, expected_closing):
    """Verify scenario C: stock card after transfer"""
    print(f"\n=== SCENARIO C: VERIFY STOCK CARD AFTER TRANSFER ===")
    
    # Test 1: No CS filter - closing should still be the same (transfer is net-zero)
    print("\n--- Test C.1: No CS filter ---")
    card = get_stock_card(product_id)
    if not card:
        print("❌ Failed to get stock card")
        return False
    
    summary = card.get('summary', {})
    movements = card.get('movements', [])
    
    success = True
    
    if summary.get('closingWeight') == expected_closing:
        print(f"✅ Closing weight is {expected_closing} (transfer is net-zero)")
    else:
        print(f"❌ Closing weight is {summary.get('closingWeight')}, expected {expected_closing}")
        success = False
    
    # Check for TRANSFER_OUT and TRANSFER_IN movements
    transfer_out_found = any(m.get('movementType') == 'TRANSFER_OUT' for m in movements)
    transfer_in_found = any(m.get('movementType') == 'TRANSFER_IN' for m in movements)
    
    if transfer_out_found:
        print(f"✅ TRANSFER_OUT movement found")
    else:
        print(f"❌ TRANSFER_OUT movement not found")
        success = False
    
    if transfer_in_found:
        print(f"✅ TRANSFER_IN movement found")
    else:
        print(f"❌ TRANSFER_IN movement not found")
        success = False
    
    # Test 2: Filter by CS2 - closing should be the transferred amount
    print("\n--- Test C.2: Filter by CS2 (destination) ---")
    card_cs2 = get_stock_card(product_id, cold_storage_id=cs2_id)
    if not card_cs2:
        print("❌ Failed to get stock card for CS2")
        return False
    
    summary_cs2 = card_cs2.get('summary', {})
    if summary_cs2.get('closingWeight') == expected_closing:
        print(f"✅ CS2 closing weight is {expected_closing} (expected)")
    else:
        print(f"❌ CS2 closing weight is {summary_cs2.get('closingWeight')}, expected {expected_closing}")
        success = False
    
    # Test 3: Filter by CS1 - closing should be 0
    print("\n--- Test C.3: Filter by CS1 (source) ---")
    card_cs1 = get_stock_card(product_id, cold_storage_id=cs1_id)
    if not card_cs1:
        print("❌ Failed to get stock card for CS1")
        return False
    
    summary_cs1 = card_cs1.get('summary', {})
    if summary_cs1.get('closingWeight') == 0:
        print(f"✅ CS1 closing weight is 0 (expected)")
    else:
        print(f"❌ CS1 closing weight is {summary_cs1.get('closingWeight')}, expected 0")
        success = False
    
    return success

def verify_scenario_d(product_id, expected_closing):
    """Verify scenario D: stock card after outbound"""
    print(f"\n=== SCENARIO D: VERIFY STOCK CARD AFTER OUTBOUND ===")
    card = get_stock_card(product_id)
    if not card:
        print("❌ Failed to get stock card")
        return False
    
    summary = card.get('summary', {})
    movements = card.get('movements', [])
    
    success = True
    
    # Check closing weight
    if summary.get('closingWeight') == expected_closing:
        print(f"✅ Closing weight is {expected_closing} (expected)")
    else:
        print(f"❌ Closing weight is {summary.get('closingWeight')}, expected {expected_closing}")
        success = False
    
    # Check for OUT movement with NON_SALES reference type
    out_movement = None
    for m in movements:
        if m.get('movementType') == 'OUT' and m.get('referenceType') == 'NON_SALES':
            out_movement = m
            break
    
    if out_movement:
        print(f"✅ OUT movement with NON_SALES reference type found")
    else:
        print(f"❌ OUT movement with NON_SALES reference type not found")
        success = False
    
    return success

def verify_scenario_e(product_id, expected_opening_weight):
    """Verify scenario E: date filter"""
    print(f"\n=== SCENARIO E: VERIFY DATE FILTER ===")
    
    # Test 1: Future date range - should have no movements but opening balance
    tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
    next_week = (datetime.now() + timedelta(days=7)).strftime('%Y-%m-%d')
    
    print(f"\n--- Test E.1: Future date range ({tomorrow} to {next_week}) ---")
    card_future = get_stock_card(product_id, from_date=tomorrow, to_date=next_week)
    if not card_future:
        print("❌ Failed to get stock card for future dates")
        return False
    
    movements_future = card_future.get('movements', [])
    opening_future = card_future.get('opening', {})
    
    success = True
    
    if len(movements_future) == 0:
        print(f"✅ No movements in future date range (expected)")
    else:
        print(f"❌ Found {len(movements_future)} movements in future date range, expected 0")
        success = False
    
    if opening_future.get('weight') == expected_opening_weight:
        print(f"✅ Opening weight is {expected_opening_weight} (reflects net of all prior rows)")
    else:
        print(f"❌ Opening weight is {opening_future.get('weight')}, expected {expected_opening_weight}")
        success = False
    
    # Test 2: Today's date - should include today's movements
    today = datetime.now().strftime('%Y-%m-%d')
    
    print(f"\n--- Test E.2: Today's date ({today}) ---")
    card_today = get_stock_card(product_id, from_date=today)
    if not card_today:
        print("❌ Failed to get stock card for today")
        return False
    
    movements_today = card_today.get('movements', [])
    
    if len(movements_today) > 0:
        print(f"✅ Found {len(movements_today)} movements for today (expected)")
    else:
        print(f"⚠️  No movements found for today (might be expected if all movements are from earlier)")
    
    return success

def verify_scenario_f():
    """Verify scenario F: regression test"""
    print(f"\n=== SCENARIO F: REGRESSION TEST ===")
    
    success = True
    
    # Test 1: GET /inventory-reports/by-product
    print("\n--- Test F.1: GET /inventory-reports/by-product ---")
    try:
        response = session.get(f"{BASE_URL}/inventory-reports/by-product")
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            print(f"✅ by-product endpoint working")
        else:
            print(f"❌ by-product endpoint failed: {response.text}")
            success = False
    except Exception as e:
        print(f"❌ Error testing by-product: {e}")
        success = False
    
    # Test 2: GET /inventory-reports/by-cs
    print("\n--- Test F.2: GET /inventory-reports/by-cs ---")
    try:
        response = session.get(f"{BASE_URL}/inventory-reports/by-cs")
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            print(f"✅ by-cs endpoint working")
        else:
            print(f"❌ by-cs endpoint failed: {response.text}")
            success = False
    except Exception as e:
        print(f"❌ Error testing by-cs: {e}")
        success = False
    
    return success

def main():
    """Main test flow"""
    print("=" * 80)
    print("KARTU STOK (STOCK CARD) BACKEND TEST")
    print("=" * 80)
    
    # Login
    if not login():
        print("\n❌ LOGIN FAILED - ABORTING TESTS")
        return
    
    # Get products
    product = get_products()
    if not product:
        print("\n❌ NO PRODUCTS FOUND - ABORTING TESTS")
        return
    
    product_id = product.get('id')
    
    # Get cold storages
    cold_storages = get_cold_storages()
    if len(cold_storages) < 1:
        print("\n❌ NO COLD STORAGES FOUND - ABORTING TESTS")
        return
    
    cs1 = cold_storages[0]
    cs1_id = cs1.get('id')
    
    # Create second cold storage if needed
    if len(cold_storages) < 2:
        print("\n⚠️  Only 1 cold storage found, creating a second one for transfer test")
        cs2 = create_cold_storage("CS-TEST-2", "Test Cold Storage 2")
        if not cs2:
            print("\n❌ FAILED TO CREATE SECOND COLD STORAGE - ABORTING TESTS")
            return
    else:
        cs2 = cold_storages[1]
    
    cs2_id = cs2.get('id')
    
    print(f"\n=== TEST SETUP COMPLETE ===")
    print(f"Product: {product.get('name')} (ID: {product_id})")
    print(f"CS1: {cs1.get('name')} (ID: {cs1_id})")
    print(f"CS2: {cs2.get('name')} (ID: {cs2_id})")
    
    # Scenario A: Create inbound
    inbound_result = create_inbound(product_id, cs1_id, 100, 2)
    if not inbound_result:
        print("\n❌ SCENARIO A FAILED - ABORTING TESTS")
        return
    
    stock_ids = inbound_result.get('stockIds', [])
    if not stock_ids:
        print("\n❌ NO STOCK IDS RETURNED - ABORTING TESTS")
        return
    
    # Scenario B: Verify stock card after inbound
    scenario_b_pass = verify_scenario_b(product_id, 100, 100, 1)
    
    # Scenario C: Transfer to CS2
    transfer_result = transfer_cold_storage(stock_ids, cs2_id)
    if not transfer_result:
        print("\n❌ SCENARIO C FAILED - CONTINUING WITH OTHER TESTS")
        scenario_c_pass = False
    else:
        # Verify stock card after transfer
        scenario_c_pass = verify_scenario_c(product_id, cs1_id, cs2_id, 100)
    
    # Scenario D: Create outbound
    outbound_result = create_outbound(stock_ids, 'non_sales', 'sample')
    if not outbound_result:
        print("\n❌ SCENARIO D FAILED - CONTINUING WITH OTHER TESTS")
        scenario_d_pass = False
    else:
        # Verify stock card after outbound
        scenario_d_pass = verify_scenario_d(product_id, 0)
    
    # Scenario E: Date filter
    scenario_e_pass = verify_scenario_e(product_id, 0)
    
    # Scenario F: Regression test
    scenario_f_pass = verify_scenario_f()
    
    # Scenario G: Edge case - no productId
    scenario_g_pass = test_edge_case_no_product_id()
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"Scenario A (Inbound): {'✅ PASS' if inbound_result else '❌ FAIL'}")
    print(f"Scenario B (Stock card after inbound): {'✅ PASS' if scenario_b_pass else '❌ FAIL'}")
    print(f"Scenario C (Transfer): {'✅ PASS' if transfer_result and scenario_c_pass else '❌ FAIL'}")
    print(f"Scenario D (Outbound): {'✅ PASS' if outbound_result and scenario_d_pass else '❌ FAIL'}")
    print(f"Scenario E (Date filter): {'✅ PASS' if scenario_e_pass else '❌ FAIL'}")
    print(f"Scenario F (Regression): {'✅ PASS' if scenario_f_pass else '❌ FAIL'}")
    print(f"Scenario G (Edge case): {'✅ PASS' if scenario_g_pass else '❌ FAIL'}")
    print("=" * 80)

if __name__ == "__main__":
    main()
