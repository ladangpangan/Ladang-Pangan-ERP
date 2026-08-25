#!/usr/bin/env python3
"""
Test script for 2 NEW backend features:
1. Sales Return restores stock (with items array)
2. Soft Reservation for Draft SOs
"""

import requests
import json
import sys

BASE_URL = "https://github-to-production.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

session = requests.Session()
session.headers.update({"Content-Type": "application/json"})

# Global IDs
COLD_STORAGE_ID = None
PRODUCT_KRK_ID = None
CUSTOMER_ID = None

def login():
    """Login as admin and fetch required IDs"""
    global COLD_STORAGE_ID, PRODUCT_KRK_ID, CUSTOMER_ID
    
    print("\n=== LOGIN AS ADMIN ===")
    try:
        resp = session.post(f"{BASE_URL}/auth/sign-in/email", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        if resp.status_code != 200:
            print(f"❌ Login failed: {resp.status_code}")
            return False
        print(f"✅ Login successful")
        
        # Fetch IDs
        cs_resp = session.get(f"{BASE_URL}/cold-storages")
        COLD_STORAGE_ID = cs_resp.json()["data"][0]["id"]
        
        prod_resp = session.get(f"{BASE_URL}/products")
        products = prod_resp.json()["data"]
        PRODUCT_KRK_ID = [p for p in products if p["sku"] == "KRK-001"][0]["id"]
        
        cust_resp = session.get(f"{BASE_URL}/contacts?type=Customer")
        customers = cust_resp.json()["data"]
        CUSTOMER_ID = [c for c in customers if c["code"] == "CUST-001"][0]["id"]
        
        print(f"✅ IDs fetched: CS={COLD_STORAGE_ID[:8]}..., Product={PRODUCT_KRK_ID[:8]}..., Customer={CUSTOMER_ID[:8]}...")
        return True
    except Exception as e:
        print(f"❌ Login error: {e}")
        return False

def create_stock(weight, qty):
    """Helper to create inventory stock"""
    resp = session.post(f"{BASE_URL}/inventory/inbound", json={
        "coldStorageId": COLD_STORAGE_ID,
        "items": [{"productId": PRODUCT_KRK_ID, "weight": weight, "quantity": qty, "expiredDate": "2025-12-31"}]
    })
    if resp.status_code != 201:
        raise Exception(f"Failed to create stock: {resp.status_code} - {resp.text}")
    return resp.json()["data"]["stocks"][0]

def create_so(stock_id, weight, qty):
    """Helper to create sales order"""
    resp = session.post(f"{BASE_URL}/sales-orders", json={
        "customerId": CUSTOMER_ID,
        "orderDate": "2025-07-01",
        "items": [{"stockId": stock_id, "weight": weight, "quantity": qty, "unitPrice": 40000}]
    })
    if resp.status_code != 201:
        raise Exception(f"Failed to create SO: {resp.status_code} - {resp.text}")
    return resp.json()["data"]

def get_stock(stock_id):
    """Helper to get stock details"""
    resp = session.get(f"{BASE_URL}/inventory/stocks/{stock_id}")
    if resp.status_code != 200:
        raise Exception(f"Failed to get stock: {resp.status_code}")
    return resp.json()["data"]

def get_stocks():
    """Helper to get all stocks"""
    resp = session.get(f"{BASE_URL}/inventory/stocks?status=active")
    if resp.status_code != 200:
        raise Exception(f"Failed to get stocks: {resp.status_code}")
    return resp.json()

def test_feature_1():
    """Test Feature 1: Sales Return restores stock"""
    print("\n" + "="*80)
    print("FEATURE 1: SALES RETURN RESTORES STOCK")
    print("="*80)
    
    results = []
    
    # Test 1.1: Return WITH items array restores stock
    print("\n--- Test 1.1: Return WITH items restores stock ---")
    try:
        stock = create_stock(50, 5)
        stock_id = stock["id"]
        print(f"✅ Stock created: {stock['kodeSimpan']}, 50kg")
        
        so = create_so(stock_id, 30, 3)
        so_id = so["id"]
        print(f"✅ SO created: {so['soNumber']}")
        
        # Get SO item ID
        so_detail = session.get(f"{BASE_URL}/sales-orders/{so_id}").json()["data"]
        so_item_id = so_detail["items"][0]["id"]
        
        # Confirm SO
        session.post(f"{BASE_URL}/sales-orders/{so_id}/status", json={"status": "Confirmed"})
        print(f"✅ SO confirmed")
        
        # Verify stock deducted
        stock_after = get_stock(stock_id)
        assert abs(stock_after["weight"] - 20) < 0.01, f"Expected 20kg, got {stock_after['weight']}"
        print(f"✅ Stock deducted to 20kg")
        
        # POST return
        return_resp = session.post(f"{BASE_URL}/sales-orders/{so_id}/returns", json={
            "returnDate": "2025-07-01",
            "reason": "Customer complaint",
            "resolution": "potong_invoice",
            "items": [{"soItemId": so_item_id, "weight": 10, "quantity": 1}]
        })
        assert return_resp.status_code == 201, f"Expected 201, got {return_resp.status_code}"
        return_data = return_resp.json()["data"]
        print(f"✅ Return created: {return_data['returnNumber']}")
        
        # Verify restoredStocks
        assert "restoredStocks" in return_data and len(return_data["restoredStocks"]) > 0
        print(f"✅ restoredStocks present: {return_data['restoredStocks'][0]['kodeSimpan']}")
        
        # Verify stock restored
        stock_final = get_stock(stock_id)
        assert abs(stock_final["weight"] - 30) < 0.01, f"Expected 30kg, got {stock_final['weight']}"
        assert stock_final["status"] == "active"
        print(f"✅ Stock restored to 30kg, status=active")
        
        results.append(("Test 1.1 - Return WITH items restores stock", True))
    except Exception as e:
        print(f"❌ Test 1.1 failed: {e}")
        results.append(("Test 1.1 - Return WITH items restores stock", False))
    
    # Test 1.2: Return reactivates 'used' stock
    print("\n--- Test 1.2: Return reactivates 'used' stock ---")
    try:
        stock = create_stock(20, 2)
        stock_id = stock["id"]
        
        so = create_so(stock_id, 20, 2)
        so_id = so["id"]
        so_detail = session.get(f"{BASE_URL}/sales-orders/{so_id}").json()["data"]
        so_item_id = so_detail["items"][0]["id"]
        
        session.post(f"{BASE_URL}/sales-orders/{so_id}/status", json={"status": "Confirmed"})
        
        stock_after = get_stock(stock_id)
        assert stock_after["status"] == "used", f"Expected 'used', got {stock_after['status']}"
        print(f"✅ Stock depleted to 'used'")
        
        # Return full weight
        session.post(f"{BASE_URL}/sales-orders/{so_id}/returns", json={
            "returnDate": "2025-07-01",
            "reason": "Full return",
            "resolution": "potong_invoice",
            "items": [{"soItemId": so_item_id, "weight": 20, "quantity": 2}]
        })
        
        stock_final = get_stock(stock_id)
        assert stock_final["status"] == "active", f"Expected 'active', got {stock_final['status']}"
        assert abs(stock_final["weight"] - 20) < 0.01
        print(f"✅ Stock reactivated to 'active', 20kg")
        
        results.append(("Test 1.2 - Return reactivates 'used' stock", True))
    except Exception as e:
        print(f"❌ Test 1.2 failed: {e}")
        results.append(("Test 1.2 - Return reactivates 'used' stock", False))
    
    # Test 1.3: Return validation
    print("\n--- Test 1.3: Return validation ---")
    try:
        stock = create_stock(30, 3)
        so = create_so(stock["id"], 20, 2)
        so_id = so["id"]
        so_detail = session.get(f"{BASE_URL}/sales-orders/{so_id}").json()["data"]
        so_item_id = so_detail["items"][0]["id"]
        session.post(f"{BASE_URL}/sales-orders/{so_id}/status", json={"status": "Confirmed"})
        
        # Test: weight > SO item weight
        resp = session.post(f"{BASE_URL}/sales-orders/{so_id}/returns", json={
            "returnDate": "2025-07-01",
            "reason": "Test",
            "resolution": "potong_invoice",
            "items": [{"soItemId": so_item_id, "weight": 25, "quantity": 1}]
        })
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        print(f"✅ Validation: weight > SO item rejected (400)")
        
        # Test: invalid soItemId
        resp = session.post(f"{BASE_URL}/sales-orders/{so_id}/returns", json={
            "returnDate": "2025-07-01",
            "reason": "Test",
            "resolution": "potong_invoice",
            "items": [{"soItemId": "00000000-0000-0000-0000-000000000000", "weight": 10, "quantity": 1}]
        })
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        print(f"✅ Validation: invalid soItemId rejected (400)")
        
        # Test: SO not found
        resp = session.post(f"{BASE_URL}/sales-orders/00000000-0000-0000-0000-000000000000/returns", json={
            "returnDate": "2025-07-01",
            "reason": "Test",
            "resolution": "potong_invoice",
            "items": [{"soItemId": so_item_id, "weight": 10, "quantity": 1}]
        })
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print(f"✅ Validation: SO not found rejected (404)")
        
        results.append(("Test 1.3 - Return validation", True))
    except Exception as e:
        print(f"❌ Test 1.3 failed: {e}")
        results.append(("Test 1.3 - Return validation", False))
    
    # Test 1.4: Legacy return (no items array)
    print("\n--- Test 1.4: Legacy return (no items array) ---")
    try:
        # Create SO without stock linkage (using productId directly)
        resp = session.post(f"{BASE_URL}/sales-orders", json={
            "customerId": CUSTOMER_ID,
            "orderDate": "2025-07-01",
            "items": [{"productId": PRODUCT_KRK_ID, "weight": 10, "quantity": 1, "unitPrice": 40000}]
        })
        so_id = resp.json()["data"]["id"]
        
        # Legacy return
        resp = session.post(f"{BASE_URL}/sales-orders/{so_id}/returns", json={
            "returnDate": "2025-07-01",
            "reason": "Legacy return",
            "resolution": "potong_invoice",
            "totalAmount": 100000,
            "totalWeight": 5
        })
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}"
        return_data = resp.json()["data"]
        assert "restoredStocks" not in return_data or len(return_data["restoredStocks"]) == 0
        print(f"✅ Legacy return created, no stock restoration")
        
        results.append(("Test 1.4 - Legacy return (no items array)", True))
    except Exception as e:
        print(f"❌ Test 1.4 failed: {e}")
        results.append(("Test 1.4 - Legacy return (no items array)", False))
    
    return results

def test_feature_2():
    """Test Feature 2: Soft Reservation for Draft SOs"""
    print("\n" + "="*80)
    print("FEATURE 2: SOFT RESERVATION FOR DRAFT SOs")
    print("="*80)
    
    results = []
    
    # Test 2.1: GET /inventory/stocks includes reservation fields
    print("\n--- Test 2.1: GET /inventory/stocks includes reservation fields ---")
    try:
        stock = create_stock(100, 10)
        stock_id = stock["id"]
        print(f"✅ Stock created: 100kg")
        
        stocks_data = get_stocks()
        our_stock = [s for s in stocks_data["data"] if s["id"] == stock_id][0]
        
        required_fields = ["reservedWeight", "availableWeight", "reservedSoCount", "reservedQty", "availableQty"]
        for field in required_fields:
            assert field in our_stock, f"Missing field: {field}"
        print(f"✅ All reservation fields present")
        
        assert "totalAvailableWeight" in stocks_data["summary"]
        assert "totalReservedWeight" in stocks_data["summary"]
        print(f"✅ Summary fields present")
        
        assert our_stock["reservedWeight"] == 0
        assert abs(our_stock["availableWeight"] - 100) < 0.01
        print(f"✅ Initial values: reserved=0, available=100")
        
        results.append(("Test 2.1 - GET /inventory/stocks includes reservation fields", True))
    except Exception as e:
        print(f"❌ Test 2.1 failed: {e}")
        results.append(("Test 2.1 - GET /inventory/stocks includes reservation fields", False))
        return results
    
    # Test 2.2: Draft SO reserves stock
    print("\n--- Test 2.2: Draft SO reserves stock ---")
    try:
        so = create_so(stock_id, 40, 4)
        print(f"✅ Draft SO created: {so['soNumber']}")
        
        stocks_data = get_stocks()
        our_stock = [s for s in stocks_data["data"] if s["id"] == stock_id][0]
        
        assert abs(our_stock["weight"] - 100) < 0.01, "Weight should remain 100"
        assert abs(our_stock["reservedWeight"] - 40) < 0.01, f"Expected reserved=40, got {our_stock['reservedWeight']}"
        assert abs(our_stock["availableWeight"] - 60) < 0.01, f"Expected available=60, got {our_stock['availableWeight']}"
        assert our_stock["reservedSoCount"] == 1
        print(f"✅ Reservation: weight=100, reserved=40, available=60, count=1")
        
        # Test: Confirmed SO does NOT count as reservation
        stock2 = create_stock(50, 5)
        so2 = create_so(stock2["id"], 20, 2)
        session.post(f"{BASE_URL}/sales-orders/{so2['id']}/status", json={"status": "Confirmed"})
        
        stocks_data = get_stocks()
        stock2_data = [s for s in stocks_data["data"] if s["id"] == stock2["id"]][0]
        assert stock2_data["reservedWeight"] == 0, "Confirmed SO should not count as reservation"
        print(f"✅ Confirmed SO does NOT count as reservation")
        
        results.append(("Test 2.2 - Draft SO reserves stock", True))
    except Exception as e:
        print(f"❌ Test 2.2 failed: {e}")
        results.append(("Test 2.2 - Draft SO reserves stock", False))
        return results
    
    # Test 2.3: Multi-SO reservation
    print("\n--- Test 2.3: Multi-SO reservation ---")
    try:
        stock3 = create_stock(50, 5)
        stock3_id = stock3["id"]
        
        create_so(stock3_id, 20, 2)
        create_so(stock3_id, 10, 1)
        print(f"✅ Created 2 Draft SOs")
        
        stocks_data = get_stocks()
        stock3_data = [s for s in stocks_data["data"] if s["id"] == stock3_id][0]
        
        assert abs(stock3_data["reservedWeight"] - 30) < 0.01, f"Expected reserved=30, got {stock3_data['reservedWeight']}"
        assert abs(stock3_data["availableWeight"] - 20) < 0.01, f"Expected available=20, got {stock3_data['availableWeight']}"
        assert stock3_data["reservedSoCount"] == 2
        print(f"✅ Multi-SO reservation: reserved=30, available=20, count=2")
        
        results.append(("Test 2.3 - Multi-SO reservation", True))
    except Exception as e:
        print(f"❌ Test 2.3 failed: {e}")
        results.append(("Test 2.3 - Multi-SO reservation", False))
        return results
    
    # Test 2.4: Reservation blocks over-allocation
    print("\n--- Test 2.4: Reservation blocks over-allocation ---")
    try:
        # Continue with stock3 (reserved=30, available=20)
        resp = session.post(f"{BASE_URL}/sales-orders", json={
            "customerId": CUSTOMER_ID,
            "orderDate": "2025-07-01",
            "items": [{"stockId": stock3_id, "weight": 25, "quantity": 2, "unitPrice": 40000}]
        })
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        assert "direservasi" in resp.text.lower() or "reserved" in resp.text.lower() or "melebihi" in resp.text.lower()
        print(f"✅ Over-allocation blocked (400)")
        
        results.append(("Test 2.4 - Reservation blocks over-allocation", True))
    except Exception as e:
        print(f"❌ Test 2.4 failed: {e}")
        results.append(("Test 2.4 - Reservation blocks over-allocation", False))
    
    # Test 2.5: Confirm removes reservation
    print("\n--- Test 2.5: Confirm removes reservation ---")
    try:
        stock4 = create_stock(80, 8)
        stock4_id = stock4["id"]
        
        so = create_so(stock4_id, 30, 3)
        so_id = so["id"]
        
        stocks_data = get_stocks()
        stock4_before = [s for s in stocks_data["data"] if s["id"] == stock4_id][0]
        assert abs(stock4_before["reservedWeight"] - 30) < 0.01
        print(f"✅ Before confirm: reserved=30")
        
        session.post(f"{BASE_URL}/sales-orders/{so_id}/status", json={"status": "Confirmed"})
        
        stocks_data = get_stocks()
        stock4_after = [s for s in stocks_data["data"] if s["id"] == stock4_id][0]
        assert abs(stock4_after["weight"] - 50) < 0.01, f"Expected weight=50, got {stock4_after['weight']}"
        assert stock4_after["reservedWeight"] == 0, f"Expected reserved=0, got {stock4_after['reservedWeight']}"
        assert abs(stock4_after["availableWeight"] - 50) < 0.01
        print(f"✅ After confirm: weight=50, reserved=0, available=50")
        
        results.append(("Test 2.5 - Confirm removes reservation", True))
    except Exception as e:
        print(f"❌ Test 2.5 failed: {e}")
        results.append(("Test 2.5 - Confirm removes reservation", False))
    
    # Test 2.6: exclude_so param
    print("\n--- Test 2.6: exclude_so param ---")
    try:
        stock5 = create_stock(100, 10)
        stock5_id = stock5["id"]
        
        so = create_so(stock5_id, 60, 6)
        so_id = so["id"]
        
        # Without exclude_so
        stocks_data = get_stocks()
        stock5_data = [s for s in stocks_data["data"] if s["id"] == stock5_id][0]
        assert abs(stock5_data["reservedWeight"] - 60) < 0.01
        print(f"✅ Without exclude_so: reserved=60")
        
        # With exclude_so
        resp = session.get(f"{BASE_URL}/inventory/stocks?status=active&exclude_so={so_id}")
        stocks_data = resp.json()
        stock5_data = [s for s in stocks_data["data"] if s["id"] == stock5_id][0]
        assert stock5_data["reservedWeight"] == 0, f"Expected reserved=0, got {stock5_data['reservedWeight']}"
        assert abs(stock5_data["availableWeight"] - 100) < 0.01
        print(f"✅ With exclude_so: reserved=0, available=100")
        
        results.append(("Test 2.6 - exclude_so param", True))
    except Exception as e:
        print(f"❌ Test 2.6 failed: {e}")
        results.append(("Test 2.6 - exclude_so param", False))
    
    # Test 2.7: PATCH SO with reservation
    print("\n--- Test 2.7: PATCH SO with reservation ---")
    try:
        stock6 = create_stock(50, 5)
        stock6_id = stock6["id"]
        
        so1 = create_so(stock6_id, 20, 2)
        so2 = create_so(stock6_id, 20, 2)
        so2_id = so2["id"]
        print(f"✅ Created 2 Draft SOs (20kg each)")
        
        # Try to PATCH SO2 to 40kg (should fail)
        resp = session.patch(f"{BASE_URL}/sales-orders/{so2_id}", json={
            "items": [{"stockId": stock6_id, "weight": 40, "quantity": 4, "unitPrice": 40000}]
        })
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        print(f"✅ PATCH increase blocked (400)")
        
        # PATCH SO2 to 10kg (should succeed)
        resp = session.patch(f"{BASE_URL}/sales-orders/{so2_id}", json={
            "items": [{"stockId": stock6_id, "weight": 10, "quantity": 1, "unitPrice": 40000}]
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        print(f"✅ PATCH reduce succeeded (200)")
        
        # Verify reservation updated
        stocks_data = get_stocks()
        stock6_data = [s for s in stocks_data["data"] if s["id"] == stock6_id][0]
        assert abs(stock6_data["reservedWeight"] - 30) < 0.01, f"Expected reserved=30, got {stock6_data['reservedWeight']}"
        print(f"✅ Reservation updated: reserved=30 (20+10)")
        
        results.append(("Test 2.7 - PATCH SO with reservation", True))
    except Exception as e:
        print(f"❌ Test 2.7 failed: {e}")
        results.append(("Test 2.7 - PATCH SO with reservation", False))
    
    return results

def test_regression():
    """Quick regression check"""
    print("\n" + "="*80)
    print("REGRESSION QUICK CHECK")
    print("="*80)
    
    results = []
    
    endpoints = [
        ("/sales-orders", 200),
        ("/inventory/stocks", 200),
        ("/dashboard/summary", 200)
    ]
    
    for endpoint, expected in endpoints:
        try:
            resp = session.get(f"{BASE_URL}{endpoint}")
            assert resp.status_code == expected, f"Expected {expected}, got {resp.status_code}"
            print(f"✅ GET {endpoint}: {resp.status_code}")
            results.append((f"Regression: {endpoint}", True))
        except Exception as e:
            print(f"❌ GET {endpoint}: {e}")
            results.append((f"Regression: {endpoint}", False))
    
    # Test POST /inventory/inbound
    try:
        resp = session.post(f"{BASE_URL}/inventory/inbound", json={
            "coldStorageId": COLD_STORAGE_ID,
            "items": [{"productId": PRODUCT_KRK_ID, "weight": 10, "quantity": 1, "expiredDate": "2025-12-31"}]
        })
        assert resp.status_code == 201
        data = resp.json()["data"]
        assert "stocks" in data and len(data["stocks"]) > 0 and "kodeSimpan" in data["stocks"][0]
        print(f"✅ POST /inventory/inbound: 201 with kodeSimpan")
        results.append(("Regression: POST /inventory/inbound", True))
    except Exception as e:
        print(f"❌ POST /inventory/inbound: {e}")
        results.append(("Regression: POST /inventory/inbound", False))
    
    return results

def main():
    print("="*80)
    print("BACKEND TESTING: 2 NEW FEATURES")
    print("="*80)
    
    if not login():
        print("\n❌ Login failed. Cannot proceed.")
        sys.exit(1)
    
    all_results = []
    
    all_results.extend(test_feature_1())
    all_results.extend(test_feature_2())
    all_results.extend(test_regression())
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for _, result in all_results if result)
    failed = sum(1 for _, result in all_results if not result)
    total = len(all_results)
    
    print(f"\nTotal: {total} | Passed: {passed} ✅ | Failed: {failed} ❌ | Success: {(passed/total*100):.1f}%")
    
    print("\nDetailed Results:")
    for test_name, result in all_results:
        status = "✅" if result else "❌"
        print(f"  {status} {test_name}")
    
    if failed > 0:
        sys.exit(1)
    else:
        print("\n🎉 All tests passed!")
        sys.exit(0)

if __name__ == "__main__":
    main()
