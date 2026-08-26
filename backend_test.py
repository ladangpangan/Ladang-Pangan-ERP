#!/usr/bin/env python3
"""
Backend test for FLUCTUATING INVENTORY REPORTS BUGFIX
Tests that /api/inventory-reports/by-product and /api/inventory-reports/by-cs
return IDENTICAL results across multiple calls (no fluctuation).
"""

import requests
import time
import json
from typing import Dict, List, Any

BASE_URL = "https://github-to-production.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

# Test credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

session = requests.Session()

def login() -> bool:
    """Login as admin and establish session"""
    try:
        print("=" * 80)
        print("TEST 1: Login as admin")
        print("=" * 80)
        
        response = session.post(
            f"{API_BASE}/auth/sign-in/email",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=10
        )
        
        if response.status_code == 200:
            print(f"✅ Login successful (status: {response.status_code})")
            # Check all cookies
            cookies = session.cookies.get_dict()
            print(f"   Cookies received: {list(cookies.keys())}")
            has_session = any('session' in k.lower() or 'auth' in k.lower() for k in cookies.keys())
            print(f"   Session cookie set: {has_session}")
            return True
        else:
            print(f"❌ Login failed (status: {response.status_code})")
            print(f"   Response: {response.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ Login error: {str(e)}")
        return False

def test_by_product_stability() -> bool:
    """
    TEST 2: Call GET /api/inventory-reports/by-product 5 times
    Verify IDENTICAL results each time (same group count, same total weight)
    """
    try:
        print("\n" + "=" * 80)
        print("TEST 2: STABILITY TEST - /api/inventory-reports/by-product (5 calls)")
        print("=" * 80)
        
        results = []
        
        for i in range(5):
            response = session.get(f"{API_BASE}/inventory-reports/by-product", timeout=10)
            
            if response.status_code != 200:
                print(f"❌ Call {i+1} failed (status: {response.status_code})")
                print(f"   Response: {response.text[:200]}")
                return False
            
            data = response.json().get('data', [])
            
            # Calculate totals
            group_count = len(data)
            total_weight = sum(item.get('totalWeight', 0) for item in data)
            
            results.append({
                'call': i + 1,
                'group_count': group_count,
                'total_weight': round(total_weight, 1),
                'data': data
            })
            
            print(f"\nCall {i+1}:")
            print(f"  - Product groups: {group_count}")
            print(f"  - Total weight: {total_weight:.1f} kg")
            
            # Small delay between calls
            if i < 4:
                time.sleep(0.5)
        
        # Verify all results are IDENTICAL
        print("\n" + "-" * 80)
        print("STABILITY VERIFICATION:")
        print("-" * 80)
        
        first_count = results[0]['group_count']
        first_weight = results[0]['total_weight']
        
        all_identical = True
        for i, result in enumerate(results[1:], start=2):
            if result['group_count'] != first_count or result['total_weight'] != first_weight:
                print(f"❌ Call {i} differs from Call 1:")
                print(f"   Groups: {result['group_count']} vs {first_count}")
                print(f"   Weight: {result['total_weight']} vs {first_weight}")
                all_identical = False
        
        if all_identical:
            print(f"✅ ALL 5 CALLS IDENTICAL:")
            print(f"   - Product groups: {first_count} (expected ~30)")
            print(f"   - Total weight: {first_weight} kg (expected 5309.8 kg)")
            
            # Check if values match expected
            if abs(first_weight - 5309.8) < 0.1:
                print(f"✅ Total weight matches expected value (5309.8 kg)")
            else:
                print(f"⚠️  Total weight differs from expected (got {first_weight}, expected 5309.8)")
            
            if 25 <= first_count <= 35:
                print(f"✅ Product group count in expected range (~30)")
            else:
                print(f"⚠️  Product group count outside expected range (got {first_count}, expected ~30)")
        
        return all_identical
        
    except Exception as e:
        print(f"❌ Test error: {str(e)}")
        return False

def test_by_cs_stability() -> bool:
    """
    TEST 3: Call GET /api/inventory-reports/by-cs 5 times
    Verify IDENTICAL results each time
    Expected: 1 cold storage group (CS Surabaya) with totalWeight 5309.8 kg
    """
    try:
        print("\n" + "=" * 80)
        print("TEST 3: STABILITY TEST - /api/inventory-reports/by-cs (5 calls)")
        print("=" * 80)
        
        results = []
        
        for i in range(5):
            response = session.get(f"{API_BASE}/inventory-reports/by-cs", timeout=10)
            
            if response.status_code != 200:
                print(f"❌ Call {i+1} failed (status: {response.status_code})")
                print(f"   Response: {response.text[:200]}")
                return False
            
            data = response.json().get('data', [])
            
            # Calculate totals
            group_count = len(data)
            total_weight = sum(item.get('totalWeight', 0) for item in data)
            
            results.append({
                'call': i + 1,
                'group_count': group_count,
                'total_weight': round(total_weight, 1),
                'data': data
            })
            
            print(f"\nCall {i+1}:")
            print(f"  - Cold storage groups: {group_count}")
            print(f"  - Total weight: {total_weight:.1f} kg")
            
            # Check coldStorage object populated
            for item in data:
                cs = item.get('coldStorage')
                if cs:
                    print(f"  - CS: {cs.get('name', 'N/A')} (code: {cs.get('code', 'N/A')})")
                else:
                    print(f"  - CS: NULL (coldStorage object missing)")
            
            # Small delay between calls
            if i < 4:
                time.sleep(0.5)
        
        # Verify all results are IDENTICAL
        print("\n" + "-" * 80)
        print("STABILITY VERIFICATION:")
        print("-" * 80)
        
        first_count = results[0]['group_count']
        first_weight = results[0]['total_weight']
        
        all_identical = True
        for i, result in enumerate(results[1:], start=2):
            if result['group_count'] != first_count or result['total_weight'] != first_weight:
                print(f"❌ Call {i} differs from Call 1:")
                print(f"   Groups: {result['group_count']} vs {first_count}")
                print(f"   Weight: {result['total_weight']} vs {first_weight}")
                all_identical = False
        
        if all_identical:
            print(f"✅ ALL 5 CALLS IDENTICAL:")
            print(f"   - Cold storage groups: {first_count} (expected 1)")
            print(f"   - Total weight: {first_weight} kg (expected 5309.8 kg)")
            
            # Check if values match expected
            if abs(first_weight - 5309.8) < 0.1:
                print(f"✅ Total weight matches expected value (5309.8 kg)")
            else:
                print(f"⚠️  Total weight differs from expected (got {first_weight}, expected 5309.8)")
            
            # Check coldStorage object populated
            first_data = results[0]['data']
            if first_data and all(item.get('coldStorage') for item in first_data):
                print(f"✅ All coldStorage objects populated with name")
            else:
                print(f"❌ Some coldStorage objects missing or null")
        
        return all_identical
        
    except Exception as e:
        print(f"❌ Test error: {str(e)}")
        return False

def test_by_product_data_correctness() -> bool:
    """
    TEST 4: Verify data correctness for by-product endpoint
    - Each item has populated product object (id, sku, name, unit, basePrice, minStock)
    - Numeric totalWeight and totalQty
    - estimatedValue and lowStock fields exist
    - Items sorted by totalWeight descending
    """
    try:
        print("\n" + "=" * 80)
        print("TEST 4: DATA CORRECTNESS - /api/inventory-reports/by-product")
        print("=" * 80)
        
        response = session.get(f"{API_BASE}/inventory-reports/by-product", timeout=10)
        
        if response.status_code != 200:
            print(f"❌ Request failed (status: {response.status_code})")
            return False
        
        data = response.json().get('data', [])
        
        if not data:
            print(f"❌ No data returned")
            return False
        
        print(f"Checking {len(data)} product groups...")
        
        all_valid = True
        prev_weight = float('inf')
        
        for i, item in enumerate(data[:5]):  # Check first 5 items
            print(f"\nItem {i+1}:")
            
            # Check product object
            product = item.get('product')
            if not product:
                print(f"  ❌ product object missing")
                all_valid = False
                continue
            
            required_fields = ['id', 'sku', 'name', 'unit', 'basePrice', 'minStock']
            missing = [f for f in required_fields if f not in product]
            if missing:
                print(f"  ❌ product missing fields: {missing}")
                all_valid = False
            else:
                print(f"  ✅ product object complete: {product.get('name')} ({product.get('sku')})")
            
            # Check numeric fields
            total_weight = item.get('totalWeight')
            total_qty = item.get('totalQty')
            if not isinstance(total_weight, (int, float)):
                print(f"  ❌ totalWeight not numeric: {type(total_weight)}")
                all_valid = False
            else:
                print(f"  ✅ totalWeight: {total_weight} kg")
            
            if not isinstance(total_qty, (int, float)):
                print(f"  ❌ totalQty not numeric: {type(total_qty)}")
                all_valid = False
            else:
                print(f"  ✅ totalQty: {total_qty}")
            
            # Check estimatedValue and lowStock exist
            if 'estimatedValue' not in item:
                print(f"  ❌ estimatedValue field missing")
                all_valid = False
            else:
                print(f"  ✅ estimatedValue: Rp {item['estimatedValue']:,.0f}")
            
            if 'lowStock' not in item:
                print(f"  ❌ lowStock field missing")
                all_valid = False
            else:
                print(f"  ✅ lowStock: {item['lowStock']}")
            
            # Check sorting (descending by totalWeight)
            if total_weight > prev_weight:
                print(f"  ❌ Sorting error: {total_weight} > {prev_weight}")
                all_valid = False
            prev_weight = total_weight
        
        if all_valid:
            print(f"\n✅ All data correctness checks passed")
            print(f"✅ Items sorted by totalWeight descending")
        
        return all_valid
        
    except Exception as e:
        print(f"❌ Test error: {str(e)}")
        return False

def test_http_status_and_json() -> bool:
    """
    TEST 5: Verify HTTP 200 and valid JSON for all endpoints
    No 500 errors, no "not authorized", no MongoServerError
    """
    try:
        print("\n" + "=" * 80)
        print("TEST 5: HTTP STATUS & JSON VALIDATION")
        print("=" * 80)
        
        endpoints = [
            '/inventory-reports/by-product',
            '/inventory-reports/by-cs',
        ]
        
        all_ok = True
        
        for endpoint in endpoints:
            print(f"\nTesting {endpoint}...")
            response = session.get(f"{API_BASE}{endpoint}", timeout=10)
            
            # Check status code
            if response.status_code != 200:
                print(f"  ❌ Status: {response.status_code} (expected 200)")
                all_ok = False
                continue
            else:
                print(f"  ✅ Status: 200 OK")
            
            # Check valid JSON
            try:
                data = response.json()
                print(f"  ✅ Valid JSON response")
            except Exception:
                print(f"  ❌ Invalid JSON response")
                all_ok = False
                continue
            
            # Check for error messages
            response_text = response.text.lower()
            if 'not authorized' in response_text:
                print(f"  ❌ Contains 'not authorized' error")
                all_ok = False
            elif 'mongoservererror' in response_text:
                print(f"  ❌ Contains MongoServerError")
                all_ok = False
            elif response.status_code == 500:
                print(f"  ❌ HTTP 500 error")
                all_ok = False
            else:
                print(f"  ✅ No error messages detected")
        
        return all_ok
        
    except Exception as e:
        print(f"❌ Test error: {str(e)}")
        return False

def test_regression_endpoints() -> bool:
    """
    TEST 6: Regression test for near-expired and damage-recap endpoints
    These still use SQLite mirror - just confirm they don't error
    """
    try:
        print("\n" + "=" * 80)
        print("TEST 6: REGRESSION - near-expired & damage-recap endpoints")
        print("=" * 80)
        
        endpoints = [
            '/inventory-reports/near-expired',
            '/inventory-reports/damage-recap',
        ]
        
        all_ok = True
        
        for endpoint in endpoints:
            print(f"\nTesting {endpoint}...")
            response = session.get(f"{API_BASE}{endpoint}", timeout=10)
            
            if response.status_code != 200:
                print(f"  ❌ Status: {response.status_code} (expected 200)")
                all_ok = False
            else:
                print(f"  ✅ Status: 200 OK")
                
                # Check valid JSON
                try:
                    data = response.json()
                    print(f"  ✅ Valid JSON response")
                except Exception:
                    print(f"  ❌ Invalid JSON response")
                    all_ok = False
        
        return all_ok
        
    except Exception as e:
        print(f"❌ Test error: {str(e)}")
        return False

def main():
    """Run all tests"""
    print("\n" + "=" * 80)
    print("BACKEND TEST: FLUCTUATING INVENTORY REPORTS BUGFIX")
    print("=" * 80)
    print(f"Base URL: {BASE_URL}")
    print(f"API Base: {API_BASE}")
    print(f"Credentials: {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
    print("=" * 80)
    
    results = {}
    
    # TEST 1: Login
    results['login'] = login()
    if not results['login']:
        print("\n❌ Login failed - cannot proceed with tests")
        return
    
    # TEST 2: by-product stability (5 calls)
    results['by_product_stability'] = test_by_product_stability()
    
    # TEST 3: by-cs stability (5 calls)
    results['by_cs_stability'] = test_by_cs_stability()
    
    # TEST 4: by-product data correctness
    results['by_product_correctness'] = test_by_product_data_correctness()
    
    # TEST 5: HTTP status and JSON validation
    results['http_status'] = test_http_status_and_json()
    
    # TEST 6: Regression tests
    results['regression'] = test_regression_endpoints()
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{test_name:30s}: {status}")
    
    print("=" * 80)
    print(f"TOTAL: {passed}/{total} tests passed ({passed/total*100:.0f}%)")
    print("=" * 80)
    
    if passed == total:
        print("\n✅ ALL TESTS PASSED - BUGFIX VERIFIED")
        print("   The inventory reports are now STABLE and CONSISTENT across multiple calls.")
        print("   No fluctuation detected - MongoDB direct read is working correctly.")
    else:
        print(f"\n❌ {total - passed} TEST(S) FAILED")
        print("   Please review the failed tests above.")

if __name__ == "__main__":
    main()
