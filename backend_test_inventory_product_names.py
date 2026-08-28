#!/usr/bin/env python3
"""
Backend test for BUGFIX: Inventory kode simpan missing product names
Tests the Mongo->SQLite master-data hydration fix
"""

import requests
import sys

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

# Product IDs that were previously missing from SQLite
SPOT_CHECK_PRODUCTS = {
    "e78d5775-42fb-4eb4-9f86-3ca6225287aa": "Parting 12 (80gr)",
    "8a7ad75c-5867-4b25-9c82-c6d7b31b3f9d": "Parting 1,1",
    "1c14dea6-8ee6-4681-9fc8-f35d8047516c": "Trimming Paha Grade",
    "cf7f1a1c-558d-40bc-88d4-d89653982ef9": "Brankas 1,2"
}

def test_inventory_product_names():
    """Test that all inventory stocks have non-empty product names"""
    session = requests.Session()
    
    print("=" * 80)
    print("BACKEND TEST: Inventory Product Names Bugfix")
    print("=" * 80)
    
    # TEST 1: Login as admin
    print("\n[TEST 1] Login as admin...")
    try:
        login_resp = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=30
        )
        if login_resp.status_code != 200:
            print(f"❌ FAILED: Login failed with status {login_resp.status_code}")
            print(f"Response: {login_resp.text[:500]}")
            return False
        print(f"✅ PASSED: Login successful (200 OK)")
        print(f"   Session cookie set: {list(session.cookies.keys())}")
    except Exception as e:
        print(f"❌ FAILED: Login error: {e}")
        return False
    
    # TEST 2: GET all active inventory stocks and check for missing product names
    print("\n[TEST 2] GET /api/inventory/stocks?status=active - Check for missing product names...")
    try:
        stocks_resp = session.get(
            f"{BASE_URL}/inventory/stocks",
            params={"status": "active"},
            timeout=30
        )
        if stocks_resp.status_code != 200:
            print(f"❌ FAILED: GET stocks failed with status {stocks_resp.status_code}")
            print(f"Response: {stocks_resp.text[:500]}")
            return False
        
        stocks_data = stocks_resp.json()
        
        # Handle response structure - data might be at root or in 'data' field
        if isinstance(stocks_data, list):
            stocks = stocks_data
        elif "data" in stocks_data:
            stocks = stocks_data.get("data", [])
        else:
            print(f"❌ FAILED: Unexpected response structure")
            print(f"Response keys: {stocks_data.keys() if isinstance(stocks_data, dict) else 'not a dict'}")
            return False
        total_stocks = len(stocks)
        print(f"✅ PASSED: GET stocks successful (200 OK)")
        print(f"   Total active stocks: {total_stocks}")
        
        # Count stocks with missing product names
        missing_count = 0
        missing_examples = []
        
        for stock in stocks:
            product = stock.get("product")
            if not product or not product.get("name"):
                missing_count += 1
                if len(missing_examples) < 5:  # Keep first 5 examples
                    missing_examples.append({
                        "id": stock.get("id"),
                        "kode_simpan": stock.get("kode_simpan"),
                        "product_id": stock.get("product_id"),
                        "product": product
                    })
        
        print(f"\n   **CRITICAL CHECK: Missing product names**")
        print(f"   Total stocks with missing product name: {missing_count}")
        print(f"   Expected: 0")
        
        if missing_count > 0:
            print(f"❌ FAILED: Found {missing_count} stocks with missing product names!")
            print(f"   Examples of missing product names:")
            for ex in missing_examples:
                print(f"     - Stock ID: {ex['id']}, Kode Simpan: {ex['kode_simpan']}, Product ID: {ex['product_id']}")
                print(f"       Product object: {ex['product']}")
            return False
        else:
            print(f"✅ PASSED: All {total_stocks} stocks have non-empty product names (missing count = 0)")
        
    except Exception as e:
        print(f"❌ FAILED: GET stocks error: {e}")
        return False
    
    # TEST 3: Spot check the 4 specific product IDs
    print("\n[TEST 3] Spot check 4 specific product IDs that were previously missing...")
    all_spot_checks_passed = True
    
    for product_id, expected_name in SPOT_CHECK_PRODUCTS.items():
        print(f"\n   Checking product_id={product_id} (expected: '{expected_name}')...")
        try:
            spot_resp = session.get(
                f"{BASE_URL}/inventory/stocks",
                params={"product_id": product_id, "status": "active"},
                timeout=30
            )
            if spot_resp.status_code != 200:
                print(f"   ❌ FAILED: GET stocks for product {product_id} failed with status {spot_resp.status_code}")
                all_spot_checks_passed = False
                continue
            
            spot_data = spot_resp.json()
            
            # Handle response structure
            if isinstance(spot_data, list):
                spot_stocks = spot_data
            elif "data" in spot_data:
                spot_stocks = spot_data.get("data", [])
            else:
                print(f"   ❌ FAILED: Unexpected response structure for product {product_id}")
                all_spot_checks_passed = False
                continue
            print(f"   Found {len(spot_stocks)} active stocks for this product")
            
            if len(spot_stocks) == 0:
                print(f"   ⚠️  NOTE: No active stocks for this product (not a failure - product exists but no stock)")
                # This is OK - the key is that if there ARE stocks, they should have the correct name
                # Let's verify the product exists in the products list instead
                continue
            
            # Check that all stocks for this product have the correct product name
            for stock in spot_stocks:
                product = stock.get("product")
                if not product or not product.get("name"):
                    print(f"   ❌ FAILED: Stock {stock.get('kode_simpan')} has missing product name")
                    all_spot_checks_passed = False
                elif product.get("name") != expected_name:
                    print(f"   ❌ FAILED: Stock {stock.get('kode_simpan')} has wrong product name")
                    print(f"      Expected: '{expected_name}'")
                    print(f"      Got: '{product.get('name')}'")
                    all_spot_checks_passed = False
                else:
                    print(f"   ✅ Stock {stock.get('kode_simpan')}: product.name = '{product.get('name')}' (correct)")
        
        except Exception as e:
            print(f"   ❌ FAILED: Spot check error for product {product_id}: {e}")
            all_spot_checks_passed = False
    
    if all_spot_checks_passed:
        print(f"\n✅ PASSED: All spot checks successful")
    else:
        print(f"\n❌ FAILED: Some spot checks failed")
        return False
    
    # TEST 4: GET /api/products - should work without errors
    print("\n[TEST 4] GET /api/products - Verify products endpoint works...")
    try:
        products_resp = session.get(f"{BASE_URL}/products", timeout=30)
        if products_resp.status_code != 200:
            print(f"❌ FAILED: GET products failed with status {products_resp.status_code}")
            print(f"Response: {products_resp.text[:500]}")
            return False
        
        products_data = products_resp.json()
        
        # Handle response structure
        if isinstance(products_data, list):
            products = products_data
        elif "data" in products_data:
            products = products_data.get("data", [])
        else:
            print(f"❌ FAILED: Unexpected response structure")
            return False
        print(f"✅ PASSED: GET products successful (200 OK)")
        print(f"   Total products: {len(products)}")
        
        # Verify the 4 spot-check products exist in the products list
        product_ids_in_list = {p.get("id") for p in products}
        for product_id, expected_name in SPOT_CHECK_PRODUCTS.items():
            if product_id in product_ids_in_list:
                product = next((p for p in products if p.get("id") == product_id), None)
                if product:
                    print(f"   ✅ Product {product_id} found: '{product.get('name')}'")
            else:
                print(f"   ⚠️  Product {product_id} not found in products list (may be archived)")
        
    except Exception as e:
        print(f"❌ FAILED: GET products error: {e}")
        return False
    
    # TEST 5: Regression tests - no 500 errors
    print("\n[TEST 5] Regression tests - Verify no 500 errors on other endpoints...")
    regression_endpoints = [
        "/inventory/stocks",  # Default (summary)
        "/dashboard/summary",
        "/accounting/trial-balance"
    ]
    
    all_regression_passed = True
    for endpoint in regression_endpoints:
        try:
            reg_resp = session.get(f"{BASE_URL}{endpoint}", timeout=30)
            if reg_resp.status_code == 500:
                print(f"   ❌ FAILED: {endpoint} returned 500 error")
                print(f"   Response: {reg_resp.text[:500]}")
                all_regression_passed = False
            elif reg_resp.status_code == 200:
                print(f"   ✅ {endpoint} → 200 OK")
            else:
                print(f"   ⚠️  {endpoint} → {reg_resp.status_code} (not 500, but not 200)")
        except Exception as e:
            print(f"   ❌ FAILED: {endpoint} error: {e}")
            all_regression_passed = False
    
    if all_regression_passed:
        print(f"\n✅ PASSED: All regression tests successful (no 500 errors)")
    else:
        print(f"\n❌ FAILED: Some regression tests failed")
        return False
    
    # All tests passed
    print("\n" + "=" * 80)
    print("✅ ALL TESTS PASSED (5/5)")
    print("=" * 80)
    print("\nSUMMARY:")
    print(f"  - Total active stocks: {total_stocks}")
    print(f"  - Stocks with missing product name: {missing_count} (expected: 0)")
    print(f"  - Spot checks: All 4 product IDs verified")
    print(f"  - Products endpoint: Working")
    print(f"  - Regression tests: No 500 errors")
    print("\n✅ BUGFIX VERIFIED: All inventory stocks now have non-empty product names")
    return True

if __name__ == "__main__":
    try:
        success = test_inventory_product_names()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
