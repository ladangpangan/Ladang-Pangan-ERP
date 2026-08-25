#!/usr/bin/env python3
"""
Backend test for Tally Inbound per-item zoneId support
Tests POST /api/inventory/inbound with per-item zona precedence and fallback
"""

import subprocess
import json
import sqlite3
from datetime import datetime, timedelta
import tempfile
import os

BASE_URL = "http://localhost:3000/api"
DB_PATH = "/app/data/erp.db"
COOKIE_FILE = "/tmp/test_cookies.txt"

# Test state
created_stocks = []
created_transactions = []
created_cold_storage = None
created_zones = []
test_product_id = None
test_cold_storage_id = None
zone_a_id = None
zone_b_id = None

def curl_request(method, endpoint, data=None, expect_json=True):
    """Make a curl request with cookie handling"""
    url = f"{BASE_URL}{endpoint}"
    cmd = ["curl", "-s", "-X", method, url, "-b", COOKIE_FILE, "-c", COOKIE_FILE]
    
    if data:
        cmd.extend(["-H", "Content-Type: application/json", "-d", json.dumps(data)])
    
    # Add write-out for status code
    cmd.extend(["-w", "\n__STATUS_CODE__:%{http_code}"])
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        output = result.stdout
        
        # Split output and status code
        if "__STATUS_CODE__:" in output:
            parts = output.rsplit("__STATUS_CODE__:", 1)
            body = parts[0].strip()
            status_code = int(parts[1].strip())
        else:
            body = output
            status_code = 0
        
        if expect_json and body:
            try:
                return status_code, json.loads(body)
            except json.JSONDecodeError:
                return status_code, {"error": "Invalid JSON", "body": body}
        
        return status_code, body
        
    except subprocess.TimeoutExpired:
        return 0, {"error": "Request timeout"}
    except Exception as e:
        return 0, {"error": str(e)}

def login():
    """Login as admin"""
    print("\n=== LOGIN ===")
    
    # Clear cookie file
    if os.path.exists(COOKIE_FILE):
        os.remove(COOKIE_FILE)
    
    status, resp = curl_request("POST", "/auth/sign-in/email", {
        "email": "admin@lpi.co.id",
        "password": "admin123"
    })
    
    print(f"Login status: {status}")
    
    if status != 200:
        print(f"Login failed: {resp}")
        return False
    
    # Test auth
    status, resp = curl_request("GET", "/products")
    print(f"Auth test (GET /products): {status}")
    
    if status != 200:
        print(f"❌ Auth test failed")
        return False
    
    print("✅ Login successful")
    return True

def find_or_create_cold_storage_with_zones():
    """Find a cold storage with at least 2 zones, or create one"""
    global test_cold_storage_id, zone_a_id, zone_b_id, created_cold_storage, created_zones
    
    print("\n=== SETUP: COLD STORAGE WITH ZONES ===")
    
    # Get all cold storages
    status, resp = curl_request("GET", "/cold-storages")
    print(f"GET /cold-storages: {status}")
    
    if status == 200:
        cold_storages = resp.get('data', [])
        print(f"Found {len(cold_storages)} cold storages")
        
        # Check each for zones
        for cs in cold_storages:
            cs_id = cs.get('id')
            status2, detail_resp = curl_request("GET", f"/cold-storages/{cs_id}")
            if status2 == 200:
                cs_detail = detail_resp.get('data', {})
                zones = cs_detail.get('zones', [])
                print(f"  - {cs.get('name')}: {len(zones)} zones")
                
                if len(zones) >= 2:
                    test_cold_storage_id = cs_id
                    zone_a_id = zones[0]['id']
                    zone_b_id = zones[1]['id']
                    print(f"✅ Found cold storage with >=2 zones: {cs.get('name')}")
                    print(f"   Zone A: {zones[0]['code']} (ID: {zone_a_id})")
                    print(f"   Zone B: {zones[1]['code']} (ID: {zone_b_id})")
                    return True
    
    # No suitable cold storage found, create one
    print("\n⚠️  No cold storage with >=2 zones found. Creating temporary cold storage...")
    
    # Create cold storage
    status, cs_resp = curl_request("POST", "/cold-storages", {
        "name": f"TEST-CS-ZONES-{datetime.now().strftime('%H%M%S')}",
        "code": f"TEST-CS-{datetime.now().strftime('%H%M%S')}",
        "address": "Test Address",
        "capacity": 1000,
        "zones": [
            {"code": "ZONA-A", "name": "Zona A Test"},
            {"code": "ZONA-B", "name": "Zona B Test"}
        ]
    })
    
    print(f"POST /cold-storages: {status}")
    
    if status == 201:
        cs_data = cs_resp.get('data', {})
        test_cold_storage_id = cs_data.get('id')
        created_cold_storage = test_cold_storage_id
        
        # Get zones
        status2, detail_resp = curl_request("GET", f"/cold-storages/{test_cold_storage_id}")
        if status2 == 200:
            cs_detail = detail_resp.get('data', {})
            zones = cs_detail.get('zones', [])
            if len(zones) >= 2:
                zone_a_id = zones[0]['id']
                zone_b_id = zones[1]['id']
                created_zones = [zone_a_id, zone_b_id]
                print(f"✅ Created cold storage with 2 zones")
                print(f"   Cold Storage ID: {test_cold_storage_id}")
                print(f"   Zone A: {zones[0]['code']} (ID: {zone_a_id})")
                print(f"   Zone B: {zones[1]['code']} (ID: {zone_b_id})")
                return True
    
    print(f"❌ Failed to create cold storage: {cs_resp}")
    return False

def find_product():
    """Find a product to use in tests"""
    global test_product_id
    
    print("\n=== SETUP: FIND PRODUCT ===")
    status, resp = curl_request("GET", "/products")
    print(f"GET /products: {status}")
    
    if status == 200:
        products = resp.get('data', [])
        if products:
            test_product_id = products[0]['id']
            print(f"✅ Using product: {products[0].get('name')} (ID: {test_product_id})")
            return True
    
    print("❌ No products found")
    return False

def verify_stock_zone_in_db(stock_id):
    """Query SQLite directly to verify zone_id"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT id, zone_id, kode_simpan FROM inventory_stock WHERE id = ?", (stock_id,))
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return {"id": row[0], "zone_id": row[1], "kode_simpan": row[2]}
        return None
    except Exception as e:
        print(f"⚠️  DB query error: {e}")
        return None

def test_1_per_item_zona_precedence():
    """TEST 1: Per-item zona precedence + fallback (no header zoneId)"""
    print("\n" + "="*80)
    print("TEST 1: Per-item zona precedence + fallback")
    print("="*80)
    print("POST inbound with:")
    print("  - NO header zoneId")
    print("  - Item 1: zoneId=zoneA, weight=5")
    print("  - Item 2: zoneId=zoneB, weight=6")
    print("  - Item 3: NO zoneId, weight=7")
    print("Expected:")
    print("  - Stock 1: zone_id = zoneA")
    print("  - Stock 2: zone_id = zoneB")
    print("  - Stock 3: zone_id = null")
    
    try:
        expired_date = (datetime.now() + timedelta(days=365)).strftime('%Y-%m-%d')
        
        payload = {
            "coldStorageId": test_cold_storage_id,
            # NO zoneId at header level
            "referenceType": "MANUAL",
            "notes": "TEST 1: Per-item zona precedence",
            "items": [
                {
                    "productId": test_product_id,
                    "weight": 5,
                    "quantity": 1,
                    "packagingType": "colly",
                    "expiredDate": expired_date,
                    "zoneId": zone_a_id  # Per-item zoneId = A
                },
                {
                    "productId": test_product_id,
                    "weight": 6,
                    "quantity": 1,
                    "packagingType": "colly",
                    "expiredDate": expired_date,
                    "zoneId": zone_b_id  # Per-item zoneId = B
                },
                {
                    "productId": test_product_id,
                    "weight": 7,
                    "quantity": 1,
                    "packagingType": "colly",
                    "expiredDate": expired_date
                    # NO zoneId - should be null
                }
            ]
        }
        
        print(f"\nPOST /api/inventory/inbound")
        status, resp = curl_request("POST", "/inventory/inbound", payload)
        print(f"Status: {status}")
        
        if status != 201:
            print(f"❌ TEST 1 FAILED: Expected 201, got {status}")
            print(f"Response: {resp}")
            return False
        
        data = resp.get('data', {})
        stocks = data.get('stocks', [])
        transaction_id = data.get('transactionId')
        
        print(f"✅ Inbound created successfully")
        print(f"Transaction ID: {transaction_id}")
        print(f"Stocks created: {len(stocks)}")
        
        if transaction_id:
            created_transactions.append(transaction_id)
        
        if len(stocks) != 3:
            print(f"❌ TEST 1 FAILED: Expected 3 stocks, got {len(stocks)}")
            return False
        
        # Verify each stock's zone_id
        print("\n--- Verifying zone_id for each stock ---")
        
        for i, stock in enumerate(stocks, 1):
            stock_id = stock['id']
            created_stocks.append(stock_id)
            
            # Verify via DB
            db_stock = verify_stock_zone_in_db(stock_id)
            
            if not db_stock:
                print(f"❌ Stock {i}: Could not query from DB")
                return False
            
            zone_id = db_stock['zone_id']
            kode_simpan = db_stock['kode_simpan']
            
            print(f"\nStock {i} ({kode_simpan}):")
            print(f"  - Stock ID: {stock_id}")
            print(f"  - Weight: {stock['weight']} kg")
            print(f"  - zone_id (DB): {zone_id}")
            
            # Verify expected zone_id
            if i == 1:
                expected = zone_a_id
                if zone_id == expected:
                    print(f"  ✅ zone_id = zoneA (as expected)")
                else:
                    print(f"  ❌ FAILED: Expected zone_id={expected}, got {zone_id}")
                    return False
            elif i == 2:
                expected = zone_b_id
                if zone_id == expected:
                    print(f"  ✅ zone_id = zoneB (as expected)")
                else:
                    print(f"  ❌ FAILED: Expected zone_id={expected}, got {zone_id}")
                    return False
            elif i == 3:
                if zone_id is None:
                    print(f"  ✅ zone_id = null (as expected)")
                else:
                    print(f"  ❌ FAILED: Expected zone_id=null, got {zone_id}")
                    return False
        
        print("\n" + "="*80)
        print("✅ TEST 1 PASSED: Per-item zona precedence working correctly")
        print("="*80)
        return True
        
    except Exception as e:
        print(f"❌ TEST 1 FAILED with exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_2_header_fallback_and_override():
    """TEST 2: Header-level fallback + per-item override"""
    print("\n" + "="*80)
    print("TEST 2: Header-level fallback + per-item override")
    print("="*80)
    print("POST inbound with:")
    print("  - Header zoneId = zoneA")
    print("  - Item 1: NO per-item zoneId, weight=4")
    print("  - Item 2: per-item zoneId=zoneB, weight=5")
    print("Expected:")
    print("  - Stock 1: zone_id = zoneA (fallback to header)")
    print("  - Stock 2: zone_id = zoneB (per-item overrides header)")
    
    try:
        expired_date = (datetime.now() + timedelta(days=365)).strftime('%Y-%m-%d')
        
        payload = {
            "coldStorageId": test_cold_storage_id,
            "zoneId": zone_a_id,  # Header-level zoneId
            "referenceType": "MANUAL",
            "notes": "TEST 2: Header fallback + override",
            "items": [
                {
                    "productId": test_product_id,
                    "weight": 4,
                    "quantity": 1,
                    "packagingType": "colly",
                    "expiredDate": expired_date
                    # NO per-item zoneId - should fallback to header zoneA
                },
                {
                    "productId": test_product_id,
                    "weight": 5,
                    "quantity": 1,
                    "packagingType": "colly",
                    "expiredDate": expired_date,
                    "zoneId": zone_b_id  # Per-item zoneId = B (overrides header)
                }
            ]
        }
        
        print(f"\nPOST /api/inventory/inbound")
        status, resp = curl_request("POST", "/inventory/inbound", payload)
        print(f"Status: {status}")
        
        if status != 201:
            print(f"❌ TEST 2 FAILED: Expected 201, got {status}")
            print(f"Response: {resp}")
            return False
        
        data = resp.get('data', {})
        stocks = data.get('stocks', [])
        transaction_id = data.get('transactionId')
        
        print(f"✅ Inbound created successfully")
        print(f"Transaction ID: {transaction_id}")
        print(f"Stocks created: {len(stocks)}")
        
        if transaction_id:
            created_transactions.append(transaction_id)
        
        if len(stocks) != 2:
            print(f"❌ TEST 2 FAILED: Expected 2 stocks, got {len(stocks)}")
            return False
        
        # Verify each stock's zone_id
        print("\n--- Verifying zone_id for each stock ---")
        
        for i, stock in enumerate(stocks, 1):
            stock_id = stock['id']
            created_stocks.append(stock_id)
            
            # Verify via DB
            db_stock = verify_stock_zone_in_db(stock_id)
            
            if not db_stock:
                print(f"❌ Stock {i}: Could not query from DB")
                return False
            
            zone_id = db_stock['zone_id']
            kode_simpan = db_stock['kode_simpan']
            
            print(f"\nStock {i} ({kode_simpan}):")
            print(f"  - Stock ID: {stock_id}")
            print(f"  - Weight: {stock['weight']} kg")
            print(f"  - zone_id (DB): {zone_id}")
            
            # Verify expected zone_id
            if i == 1:
                expected = zone_a_id
                if zone_id == expected:
                    print(f"  ✅ zone_id = zoneA (fallback to header, as expected)")
                else:
                    print(f"  ❌ FAILED: Expected zone_id={expected} (header fallback), got {zone_id}")
                    return False
            elif i == 2:
                expected = zone_b_id
                if zone_id == expected:
                    print(f"  ✅ zone_id = zoneB (per-item override, as expected)")
                else:
                    print(f"  ❌ FAILED: Expected zone_id={expected} (per-item override), got {zone_id}")
                    return False
        
        print("\n" + "="*80)
        print("✅ TEST 2 PASSED: Header fallback + per-item override working correctly")
        print("="*80)
        return True
        
    except Exception as e:
        print(f"❌ TEST 2 FAILED with exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_3_no_regression():
    """TEST 3: No regression - basic functionality still works"""
    print("\n" + "="*80)
    print("TEST 3: No regression - basic functionality")
    print("="*80)
    print("POST inbound with:")
    print("  - Basic payload (no zoneId)")
    print("  - Auto-generated kodeSimpan")
    print("Expected:")
    print("  - 201 response with stocks")
    print("  - kodeSimpan auto-generated")
    print("  - Totals correct")
    
    try:
        expired_date = (datetime.now() + timedelta(days=365)).strftime('%Y-%m-%d')
        
        payload = {
            "coldStorageId": test_cold_storage_id,
            "referenceType": "MANUAL",
            "notes": "TEST 3: No regression",
            "items": [
                {
                    "productId": test_product_id,
                    "weight": 10,
                    "quantity": 2,
                    "packagingType": "colly",
                    "expiredDate": expired_date
                }
            ]
        }
        
        print(f"\nPOST /api/inventory/inbound")
        status, resp = curl_request("POST", "/inventory/inbound", payload)
        print(f"Status: {status}")
        
        if status != 201:
            print(f"❌ TEST 3 FAILED: Expected 201, got {status}")
            print(f"Response: {resp}")
            return False
        
        data = resp.get('data', {})
        stocks = data.get('stocks', [])
        transaction_id = data.get('transactionId')
        
        print(f"✅ Inbound created successfully")
        print(f"Transaction ID: {transaction_id}")
        print(f"Stocks created: {len(stocks)}")
        
        if transaction_id:
            created_transactions.append(transaction_id)
        
        if len(stocks) != 1:
            print(f"❌ TEST 3 FAILED: Expected 1 stock, got {len(stocks)}")
            return False
        
        stock = stocks[0]
        stock_id = stock['id']
        created_stocks.append(stock_id)
        
        # Verify kodeSimpan auto-generated
        kode_simpan = stock.get('kodeSimpan')
        if not kode_simpan:
            print(f"❌ TEST 3 FAILED: kodeSimpan not auto-generated")
            return False
        
        print(f"\nStock details:")
        print(f"  - Stock ID: {stock_id}")
        print(f"  - kodeSimpan: {kode_simpan} (auto-generated ✓)")
        print(f"  - Weight: {stock['weight']} kg")
        print(f"  - Quantity: {stock['quantity']}")
        
        # Verify totals
        if stock['weight'] != 10:
            print(f"❌ TEST 3 FAILED: Expected weight=10, got {stock['weight']}")
            return False
        
        if stock['quantity'] != 2:
            print(f"❌ TEST 3 FAILED: Expected quantity=2, got {stock['quantity']}")
            return False
        
        print(f"  ✅ Weight correct: 10 kg")
        print(f"  ✅ Quantity correct: 2")
        
        print("\n" + "="*80)
        print("✅ TEST 3 PASSED: No regression, basic functionality working")
        print("="*80)
        return True
        
    except Exception as e:
        print(f"❌ TEST 3 FAILED with exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def cleanup():
    """Clean up all created test data"""
    print("\n" + "="*80)
    print("CLEANUP: Removing test data")
    print("="*80)
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Delete inventory_stock rows
        if created_stocks:
            print(f"\nDeleting {len(created_stocks)} inventory_stock rows...")
            placeholders = ','.join(['?' for _ in created_stocks])
            cursor.execute(f"DELETE FROM inventory_stock WHERE id IN ({placeholders})", created_stocks)
            print(f"✅ Deleted {cursor.rowcount} inventory_stock rows")
        
        # Delete inventory_transaction rows
        if created_transactions:
            print(f"\nDeleting {len(created_transactions)} inventory_transaction rows...")
            placeholders = ','.join(['?' for _ in created_transactions])
            cursor.execute(f"DELETE FROM inventory_transaction WHERE id IN ({placeholders})", created_transactions)
            print(f"✅ Deleted {cursor.rowcount} inventory_transaction rows")
        
        conn.commit()
        conn.close()
        
        # Delete temp cold storage if created
        if created_cold_storage:
            print(f"\nDeleting temporary cold storage: {created_cold_storage}")
            status, resp = curl_request("DELETE", f"/cold-storages/{created_cold_storage}", expect_json=False)
            if status in [200, 204]:
                print(f"✅ Deleted temporary cold storage")
            else:
                print(f"⚠️  Could not delete cold storage: {status}")
        
        print("\n" + "="*80)
        print("✅ CLEANUP COMPLETE")
        print("="*80)
        
    except Exception as e:
        print(f"⚠️  Cleanup error: {e}")
        import traceback
        traceback.print_exc()

def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("BACKEND TEST: Tally Inbound Per-Item ZoneId Support")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Database: {DB_PATH}")
    
    # Login
    if not login():
        print("\n❌ TESTS ABORTED: Login failed")
        return
    
    # Setup
    if not find_or_create_cold_storage_with_zones():
        print("\n❌ TESTS ABORTED: Could not setup cold storage with zones")
        return
    
    if not find_product():
        print("\n❌ TESTS ABORTED: Could not find product")
        return
    
    # Run tests
    test_results = []
    
    test_results.append(("TEST 1: Per-item zona precedence", test_1_per_item_zona_precedence()))
    test_results.append(("TEST 2: Header fallback + override", test_2_header_fallback_and_override()))
    test_results.append(("TEST 3: No regression", test_3_no_regression()))
    
    # Cleanup
    cleanup()
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for _, result in test_results if result)
    total = len(test_results)
    
    for test_name, result in test_results:
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{status}: {test_name}")
    
    print(f"\nTotal: {passed}/{total} tests passed ({passed*100//total}%)")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        return 1

if __name__ == "__main__":
    exit(main())
