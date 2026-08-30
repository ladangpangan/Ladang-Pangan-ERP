#!/usr/bin/env python3
"""
Backend Test: Karkas kode_simpan Product Assignment Bugfix
Tests that specific Karkas storage codes (kode_simpan) are correctly assigned to their
matching Karkas grade products after data fix.
"""

import requests
import json
from typing import Dict, List, Optional

# Test configuration
BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

# Expected kode_simpan -> product.name mappings (from 31-July stock report)
EXPECTED_MAPPINGS = {
    "620260179": "Karkas 0,6 (Premium)",
    "620260180": "Karkas 0,7 (Premium)",
    "620260191": "Karkas 0,9 (Premium)",
    "620260208": "Karkas 1,0 (Premium)",
    "620260222": "Karkas 1,1 (Premium)",
    "620260236": "Karkas 1,2 (Premium)",
    "620260243": "Karkas 1,3 (Premium)",
    "620260247": "Karkas 1,4 (Premium)",
    "620260399": "Karkas 1,5 (Premium)",
}

# Expected inventory summary
EXPECTED_ACTIVE_LOTS = 433
EXPECTED_TOTAL_WEIGHT = 5458.7  # kg (approximate)
WEIGHT_TOLERANCE = 5.0  # kg tolerance

session = requests.Session()

def login_admin() -> bool:
    """Login as admin and store session cookie."""
    try:
        print("\n" + "="*80)
        print("TEST 1: Login as admin")
        print("="*80)
        
        response = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            headers={"Content-Type": "application/json"}
        )
        
        print(f"POST /api/auth/sign-in/email")
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            # Check if session cookie is set
            cookies = session.cookies.get_dict()
            has_session = any('session' in k.lower() for k in cookies.keys())
            print(f"✅ Login successful")
            print(f"Session cookie set: {has_session}")
            return True
        else:
            print(f"❌ Login failed: {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return False
            
    except Exception as e:
        print(f"❌ Login error: {str(e)}")
        return False

def get_active_stocks() -> Optional[List[Dict]]:
    """Get all active inventory stocks."""
    try:
        print("\n" + "="*80)
        print("TEST 2: Get active inventory stocks")
        print("="*80)
        
        response = session.get(
            f"{BASE_URL}/inventory/stocks",
            params={"status": "active"}
        )
        
        print(f"GET /api/inventory/stocks?status=active")
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            stocks = data.get('data', [])
            total_rows = data.get('summary', {}).get('totalRows', len(stocks))
            
            print(f"✅ Retrieved {total_rows} active stocks")
            return stocks
        else:
            print(f"❌ Failed to get stocks: {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return None
            
    except Exception as e:
        print(f"❌ Error getting stocks: {str(e)}")
        return None

def verify_karkas_mappings(stocks: List[Dict]) -> Dict[str, bool]:
    """Verify that specific kode_simpan values map to correct product names."""
    try:
        print("\n" + "="*80)
        print("TEST 3: Verify Karkas kode_simpan -> product.name mappings")
        print("="*80)
        
        # Build a lookup dict: kode_simpan -> stock
        kode_lookup = {}
        for stock in stocks:
            kode = stock.get('kodeSimpan') or stock.get('kode_simpan')
            if kode:
                kode_lookup[str(kode)] = stock
        
        results = {}
        passed = 0
        failed = 0
        
        print(f"\nSpot-checking {len(EXPECTED_MAPPINGS)} Karkas kode_simpan values:\n")
        
        for kode, expected_product_name in EXPECTED_MAPPINGS.items():
            stock = kode_lookup.get(kode)
            
            if not stock:
                print(f"❌ {kode}: NOT FOUND in active stocks")
                results[kode] = False
                failed += 1
                continue
            
            # Get product name
            product = stock.get('product', {})
            actual_product_name = product.get('name', '')
            
            # Check if it matches
            if actual_product_name == expected_product_name:
                print(f"✅ {kode}: \"{actual_product_name}\" (CORRECT)")
                results[kode] = True
                passed += 1
            else:
                print(f"❌ {kode}: \"{actual_product_name}\" (EXPECTED: \"{expected_product_name}\")")
                results[kode] = False
                failed += 1
        
        print(f"\n{'='*80}")
        print(f"SPOT-CHECK RESULTS: {passed}/{len(EXPECTED_MAPPINGS)} PASSED, {failed}/{len(EXPECTED_MAPPINGS)} FAILED")
        print(f"{'='*80}")
        
        return results
        
    except Exception as e:
        print(f"❌ Error verifying mappings: {str(e)}")
        return {}

def verify_inventory_integrity(stocks: List[Dict]) -> Dict[str, any]:
    """Verify inventory integrity: count, weight, missing product names."""
    try:
        print("\n" + "="*80)
        print("TEST 4: Verify inventory integrity")
        print("="*80)
        
        # Count active lots
        active_count = len(stocks)
        
        # Calculate total weight
        total_weight = 0.0
        for stock in stocks:
            weight = stock.get('weight', 0) or 0
            total_weight += float(weight)
        
        # Count missing product names
        missing_names = 0
        for stock in stocks:
            product = stock.get('product', {})
            product_name = product.get('name', '')
            if not product_name or product_name.strip() == '':
                missing_names += 1
        
        # Check against expected values
        count_ok = active_count == EXPECTED_ACTIVE_LOTS
        weight_diff = abs(total_weight - EXPECTED_TOTAL_WEIGHT)
        weight_ok = weight_diff <= WEIGHT_TOLERANCE
        names_ok = missing_names == 0
        
        print(f"\nActive lots:")
        print(f"  Expected: {EXPECTED_ACTIVE_LOTS}")
        print(f"  Actual: {active_count}")
        print(f"  Status: {'✅ MATCH' if count_ok else '❌ MISMATCH'}")
        
        print(f"\nTotal weight:")
        print(f"  Expected: ~{EXPECTED_TOTAL_WEIGHT} kg")
        print(f"  Actual: {total_weight:.1f} kg")
        print(f"  Difference: {weight_diff:.1f} kg")
        print(f"  Status: {'✅ WITHIN TOLERANCE' if weight_ok else '❌ OUT OF TOLERANCE'}")
        
        print(f"\nMissing product names:")
        print(f"  Expected: 0")
        print(f"  Actual: {missing_names}")
        print(f"  Status: {'✅ NONE MISSING' if names_ok else '❌ SOME MISSING'}")
        
        all_ok = count_ok and weight_ok and names_ok
        
        print(f"\n{'='*80}")
        print(f"INVENTORY INTEGRITY: {'✅ ALL CHECKS PASSED' if all_ok else '❌ SOME CHECKS FAILED'}")
        print(f"{'='*80}")
        
        return {
            'active_count': active_count,
            'total_weight': total_weight,
            'missing_names': missing_names,
            'count_ok': count_ok,
            'weight_ok': weight_ok,
            'names_ok': names_ok,
            'all_ok': all_ok
        }
        
    except Exception as e:
        print(f"❌ Error verifying integrity: {str(e)}")
        return {'all_ok': False}

def check_http_errors() -> bool:
    """Check for HTTP 500 errors on key endpoints."""
    try:
        print("\n" + "="*80)
        print("TEST 5: Check for HTTP 500 errors")
        print("="*80)
        
        endpoints = [
            "/inventory/stocks?status=active",
            "/dashboard/summary",
        ]
        
        all_ok = True
        
        for endpoint in endpoints:
            response = session.get(f"{BASE_URL}{endpoint}")
            status_ok = response.status_code != 500
            
            print(f"GET {endpoint}")
            print(f"  Status: {response.status_code} {'✅' if status_ok else '❌ HTTP 500 ERROR'}")
            
            if not status_ok:
                all_ok = False
                print(f"  Response: {response.text[:200]}")
        
        print(f"\n{'='*80}")
        print(f"HTTP ERROR CHECK: {'✅ NO 500 ERRORS' if all_ok else '❌ SOME 500 ERRORS FOUND'}")
        print(f"{'='*80}")
        
        return all_ok
        
    except Exception as e:
        print(f"❌ Error checking HTTP errors: {str(e)}")
        return False

def main():
    """Run all tests."""
    print("\n" + "="*80)
    print("BACKEND TEST: Karkas kode_simpan Product Assignment Bugfix")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Testing {len(EXPECTED_MAPPINGS)} Karkas kode_simpan mappings")
    print("="*80)
    
    # Test 1: Login
    if not login_admin():
        print("\n❌ FATAL: Login failed. Cannot proceed with tests.")
        return
    
    # Test 2: Get active stocks
    stocks = get_active_stocks()
    if stocks is None:
        print("\n❌ FATAL: Failed to get active stocks. Cannot proceed with tests.")
        return
    
    # Test 3: Verify Karkas mappings
    mapping_results = verify_karkas_mappings(stocks)
    mappings_ok = all(mapping_results.values())
    
    # Test 4: Verify inventory integrity
    integrity_results = verify_inventory_integrity(stocks)
    integrity_ok = integrity_results.get('all_ok', False)
    
    # Test 5: Check HTTP errors
    no_http_errors = check_http_errors()
    
    # Final summary
    print("\n" + "="*80)
    print("FINAL TEST SUMMARY")
    print("="*80)
    
    all_tests_passed = mappings_ok and integrity_ok and no_http_errors
    
    print(f"\n✅ TEST 1: Login as admin - PASSED")
    print(f"✅ TEST 2: Get active stocks - PASSED")
    print(f"{'✅' if mappings_ok else '❌'} TEST 3: Karkas kode_simpan mappings - {'PASSED' if mappings_ok else 'FAILED'}")
    print(f"{'✅' if integrity_ok else '❌'} TEST 4: Inventory integrity - {'PASSED' if integrity_ok else 'FAILED'}")
    print(f"{'✅' if no_http_errors else '❌'} TEST 5: No HTTP 500 errors - {'PASSED' if no_http_errors else 'FAILED'}")
    
    print(f"\n{'='*80}")
    if all_tests_passed:
        print("✅ ALL TESTS PASSED (5/5, 100%)")
        print("="*80)
        print("\n🎉 BUGFIX VERIFIED: Karkas kode_simpan are correctly assigned to matching products")
    else:
        print("❌ SOME TESTS FAILED")
        print("="*80)
        
        if not mappings_ok:
            failed_kodes = [k for k, v in mapping_results.items() if not v]
            print(f"\n⚠️  Failed kode_simpan mappings: {', '.join(failed_kodes)}")
        
        if not integrity_ok:
            print(f"\n⚠️  Inventory integrity issues detected")
            if not integrity_results.get('count_ok'):
                print(f"    - Active lot count mismatch: {integrity_results.get('active_count')} (expected {EXPECTED_ACTIVE_LOTS})")
            if not integrity_results.get('weight_ok'):
                print(f"    - Total weight out of tolerance: {integrity_results.get('total_weight'):.1f} kg (expected ~{EXPECTED_TOTAL_WEIGHT} kg)")
            if not integrity_results.get('names_ok'):
                print(f"    - Missing product names: {integrity_results.get('missing_names')} stocks")
    
    print("\n" + "="*80)
    print("TEST COMPLETE")
    print("="*80)

if __name__ == "__main__":
    main()
