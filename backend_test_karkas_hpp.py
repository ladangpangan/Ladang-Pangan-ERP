#!/usr/bin/env python3
"""
Backend test for Karkas HPP/kg standardization data fix.
Verifies that all Karkas grade products have uniform hppPerKg per grade (matching basePrice).
"""

import requests
import json
from collections import defaultdict

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"

# Expected hppPerKg values per Karkas grade (from review request)
EXPECTED_HPP = {
    "Karkas 0,6 (Premium)": 34000,
    "Karkas 0,7 (Premium)": 35000,
    "Karkas 0,8 (Premium)": 35000,
    "Karkas 0,9 (Premium)": 35000,
    "Karkas 1,0 (Premium)": 35000,
    "Karkas 1,1 (Premium)": 34000,
    "Karkas 1,2 (Premium)": 34000,
    "Karkas 1,3 (Premium)": 34000,
    "Karkas 1,4 (Premium)": 34000,
    "Karkas 1,5 (Premium)": 34000,
}

def test_karkas_hpp_standardization():
    """Test Karkas HPP/kg standardization."""
    session = requests.Session()
    
    print("=" * 80)
    print("BACKEND TEST: Karkas HPP/kg Standardization Data Fix")
    print("=" * 80)
    print()
    
    # TEST 1: Login as admin
    print("TEST 1: Login as admin")
    print("-" * 80)
    try:
        login_response = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={
                "email": "admin@lpi.co.id",
                "password": "admin123"
            },
            timeout=30
        )
        
        if login_response.status_code == 200:
            print(f"✅ Login successful: {login_response.status_code}")
            # Check if session cookie is set
            cookies = session.cookies.get_dict()
            if any('session' in key.lower() for key in cookies.keys()):
                print(f"✅ Session cookie set")
            else:
                print(f"⚠️  No session cookie found in response")
        else:
            print(f"❌ Login failed: {login_response.status_code}")
            print(f"Response: {login_response.text[:200]}")
            return
    except Exception as e:
        print(f"❌ Login error: {e}")
        return
    
    print()
    
    # TEST 2: GET /api/inventory/stocks?status=active
    print("TEST 2: GET /api/inventory/stocks?status=active")
    print("-" * 80)
    try:
        stocks_response = session.get(
            f"{BASE_URL}/inventory/stocks",
            params={"status": "active"},
            timeout=30
        )
        
        if stocks_response.status_code != 200:
            print(f"❌ Failed to get stocks: {stocks_response.status_code}")
            print(f"Response: {stocks_response.text[:500]}")
            return
        
        stocks_data = stocks_response.json()
        stocks = stocks_data.get("data", [])
        
        print(f"✅ GET /api/inventory/stocks?status=active → {stocks_response.status_code}")
        print(f"✅ Total active stocks: {len(stocks)}")
        
    except Exception as e:
        print(f"❌ Error getting stocks: {e}")
        return
    
    print()
    
    # TEST 3: Verify inventory count and missing product names
    print("TEST 3: Verify inventory integrity")
    print("-" * 80)
    
    expected_count = 433
    actual_count = len(stocks)
    
    # Count stocks with missing/empty product.name
    missing_names = 0
    for stock in stocks:
        product = stock.get("product", {})
        product_name = product.get("name", "").strip() if product else ""
        if not product_name:
            missing_names += 1
    
    print(f"Expected active lots: {expected_count}")
    print(f"Actual active lots: {actual_count}")
    
    if actual_count == expected_count:
        print(f"✅ Inventory count matches: {actual_count} active lots")
    else:
        print(f"⚠️  Inventory count mismatch: expected {expected_count}, got {actual_count}")
    
    print(f"Missing/empty product names: {missing_names}")
    if missing_names == 0:
        print(f"✅ No missing product names")
    else:
        print(f"❌ Found {missing_names} stocks with missing product names")
    
    print()
    
    # TEST 4: Group Karkas lots by product.name and verify hppPerKg uniformity
    print("TEST 4: Verify Karkas HPP/kg uniformity per grade")
    print("-" * 80)
    
    # Group stocks by product name
    karkas_groups = defaultdict(list)
    
    for stock in stocks:
        product = stock.get("product", {})
        product_name = product.get("name", "").strip() if product else ""
        
        # Filter for Karkas grades
        if product_name.startswith("Karkas") and "(Premium)" in product_name:
            hpp_per_kg = stock.get("hppPerKg", 0)
            karkas_groups[product_name].append({
                "kodeSimpan": stock.get("kodeSimpan", ""),
                "hppPerKg": hpp_per_kg,
                "weight": stock.get("weight", 0)
            })
    
    print(f"Found {len(karkas_groups)} Karkas grade groups")
    print()
    
    # Verify each Karkas grade
    all_passed = True
    total_karkas_lots = 0
    
    for grade_name in sorted(EXPECTED_HPP.keys()):
        expected_hpp = EXPECTED_HPP[grade_name]
        lots = karkas_groups.get(grade_name, [])
        
        if not lots:
            print(f"⚠️  {grade_name}: NO LOTS FOUND (expected HPP: {expected_hpp})")
            continue
        
        # Get distinct hppPerKg values
        distinct_hpp = set(lot["hppPerKg"] for lot in lots)
        total_karkas_lots += len(lots)
        
        print(f"{grade_name}:")
        print(f"  - Expected HPP/kg: Rp {expected_hpp:,}")
        print(f"  - Lot count: {len(lots)}")
        print(f"  - Distinct HPP/kg values: {sorted(distinct_hpp)}")
        
        # Check uniformity
        if len(distinct_hpp) == 1 and expected_hpp in distinct_hpp:
            print(f"  ✅ PASS: All lots have uniform HPP/kg = Rp {expected_hpp:,}")
        elif len(distinct_hpp) == 1:
            actual_hpp = list(distinct_hpp)[0]
            print(f"  ❌ FAIL: All lots have HPP/kg = Rp {actual_hpp:,}, but expected Rp {expected_hpp:,}")
            all_passed = False
        else:
            print(f"  ❌ FAIL: Non-uniform HPP/kg values found!")
            # Show breakdown
            hpp_counts = defaultdict(int)
            for lot in lots:
                hpp_counts[lot["hppPerKg"]] += 1
            for hpp_val, count in sorted(hpp_counts.items()):
                print(f"     - Rp {hpp_val:,}: {count} lots")
            all_passed = False
        
        print()
    
    print(f"Total Karkas lots checked: {total_karkas_lots}")
    print()
    
    # TEST 5: Summary
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    if all_passed and missing_names == 0 and actual_count == expected_count:
        print("✅ ALL TESTS PASSED")
        print(f"✅ Inventory: {actual_count} active lots (expected {expected_count})")
        print(f"✅ Missing product names: {missing_names}")
        print(f"✅ Karkas HPP/kg uniformity: VERIFIED for all {len(EXPECTED_HPP)} grades")
        print(f"✅ Total Karkas lots: {total_karkas_lots}")
    else:
        print("❌ SOME TESTS FAILED")
        if actual_count != expected_count:
            print(f"❌ Inventory count: {actual_count} (expected {expected_count})")
        if missing_names > 0:
            print(f"❌ Missing product names: {missing_names}")
        if not all_passed:
            print(f"❌ Karkas HPP/kg uniformity: FAILED for some grades")
    
    print()
    
    # TEST 6: Check for HTTP 500 errors
    print("TEST 6: Check for HTTP 500 errors")
    print("-" * 80)
    
    # Test a few more endpoints to ensure no 500 errors
    test_endpoints = [
        "/inventory/stocks?status=active",
        "/dashboard/summary",
    ]
    
    has_500_errors = False
    for endpoint in test_endpoints:
        try:
            response = session.get(f"{BASE_URL}{endpoint}", timeout=30)
            if response.status_code == 500:
                print(f"❌ HTTP 500 error on {endpoint}")
                has_500_errors = True
            else:
                print(f"✅ {endpoint} → {response.status_code}")
        except Exception as e:
            print(f"⚠️  Error testing {endpoint}: {e}")
    
    if not has_500_errors:
        print(f"✅ No HTTP 500 errors detected")
    
    print()
    print("=" * 80)
    print("TEST COMPLETE")
    print("=" * 80)

if __name__ == "__main__":
    test_karkas_hpp_standardization()
