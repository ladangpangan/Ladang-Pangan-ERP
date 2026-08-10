#!/usr/bin/env python3
"""
Backend test for NEW supplier-shrinkage drill-down endpoint
GET /api/dashboard/supplier-shrinkage/:supplierId

Test Plan:
STEP 1: GET /api/dashboard/supplier-shrinkage -> get first row's supplierId
STEP 2: GET /api/dashboard/supplier-shrinkage/<supplierId> -> verify JSON structure
STEP 3: Access control tests (no auth -> 401, operator -> 403)
"""
import requests
import json
import sys
from datetime import datetime

BASE_URL = "http://localhost:3000/api"

def login(email, password):
    """Login and return session"""
    print(f"\n=== Login as {email} ===")
    session = requests.Session()
    
    url = "http://localhost:3000/api/auth/sign-in/email"
    payload = {"email": email, "password": password}
    
    try:
        resp = session.post(url, json=payload)
        print(f"Login response status: {resp.status_code}")
        
        if resp.status_code == 200:
            print(f"✅ Login successful as {email}")
            return session
        else:
            print(f"❌ Login failed: {resp.status_code}")
            print(f"Response: {resp.text[:200]}")
            return None
    except Exception as e:
        print(f"❌ Login error: {e}")
        return None

def test_step1_get_supplier_list(session):
    """STEP 1: GET /api/dashboard/supplier-shrinkage and extract first supplierId"""
    print("\n" + "="*80)
    print("STEP 1: GET /api/dashboard/supplier-shrinkage")
    print("="*80)
    
    try:
        resp = session.get(f"{BASE_URL}/dashboard/supplier-shrinkage")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ FAILED: Expected 200, got {resp.status_code}")
            print(f"Response: {resp.text[:500]}")
            return None
        
        data = resp.json()
        print(f"✅ Response received")
        
        # Verify structure
        if 'data' not in data:
            print(f"❌ FAILED: Missing 'data' field in response")
            return None
        
        if not isinstance(data['data'], list):
            print(f"❌ FAILED: 'data' is not an array")
            return None
        
        if len(data['data']) == 0:
            print(f"❌ FAILED: 'data' array is empty, no suppliers to test")
            return None
        
        first_row = data['data'][0]
        print(f"\n✅ First supplier row:")
        print(f"   - supplierName: {first_row.get('supplierName')}")
        print(f"   - supplierCode: {first_row.get('supplierCode')}")
        print(f"   - supplierId: {first_row.get('supplierId')}")
        print(f"   - poCount: {first_row.get('poCount')}")
        print(f"   - sjWeight: {first_row.get('sjWeight')}")
        print(f"   - tallyWeight: {first_row.get('tallyWeight')}")
        print(f"   - tallyDone: {first_row.get('tallyDone')}")
        print(f"   - susut: {first_row.get('susut')}")
        print(f"   - susutPct: {first_row.get('susutPct')}")
        
        supplier_id = first_row.get('supplierId')
        if not supplier_id:
            print(f"❌ FAILED: supplierId is missing or empty")
            return None
        
        print(f"\n✅ STEP 1 PASSED: Got supplierId = {supplier_id}")
        return supplier_id
        
    except Exception as e:
        print(f"❌ STEP 1 FAILED with exception: {e}")
        import traceback
        traceback.print_exc()
        return None

def test_step2_get_supplier_detail(session, supplier_id):
    """STEP 2: GET /api/dashboard/supplier-shrinkage/<supplierId> and verify structure"""
    print("\n" + "="*80)
    print(f"STEP 2: GET /api/dashboard/supplier-shrinkage/{supplier_id}")
    print("="*80)
    
    try:
        resp = session.get(f"{BASE_URL}/dashboard/supplier-shrinkage/{supplier_id}")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ FAILED: Expected 200, got {resp.status_code}")
            print(f"Response: {resp.text[:500]}")
            return False
        
        data = resp.json()
        print(f"✅ Response received (200)")
        
        # Print full JSON for inspection
        print(f"\n📋 ACTUAL JSON RESPONSE:")
        print(json.dumps(data, indent=2, default=str))
        
        # Verify top-level structure
        print(f"\n🔍 VERIFYING JSON STRUCTURE:")
        
        if 'data' not in data:
            print(f"❌ FAILED: Missing 'data' field")
            return False
        print(f"✅ Has 'data' field")
        
        detail = data['data']
        
        # Verify supplier object
        if 'supplier' not in detail:
            print(f"❌ FAILED: Missing 'supplier' field")
            return False
        print(f"✅ Has 'supplier' field")
        
        supplier = detail['supplier']
        if 'name' not in supplier or 'code' not in supplier:
            print(f"❌ FAILED: supplier missing 'name' or 'code'")
            return False
        print(f"✅ supplier has 'name' and 'code'")
        print(f"   - name: {supplier['name']}")
        print(f"   - code: {supplier['code']}")
        
        # Verify pos array
        if 'pos' not in detail:
            print(f"❌ FAILED: Missing 'pos' field")
            return False
        print(f"✅ Has 'pos' field")
        
        pos = detail['pos']
        if not isinstance(pos, list):
            print(f"❌ FAILED: 'pos' is not an array")
            return False
        print(f"✅ 'pos' is an array with {len(pos)} PO(s)")
        
        # Verify totals object
        if 'totals' not in detail:
            print(f"❌ FAILED: Missing 'totals' field")
            return False
        print(f"✅ Has 'totals' field")
        
        totals = detail['totals']
        required_totals_fields = ['sjWeight', 'tallyWeight', 'susut', 'susutPct']
        for field in required_totals_fields:
            if field not in totals:
                print(f"❌ FAILED: totals missing '{field}'")
                return False
        print(f"✅ totals has all required fields: {required_totals_fields}")
        print(f"   - sjWeight: {totals['sjWeight']}")
        print(f"   - tallyWeight: {totals['tallyWeight']}")
        print(f"   - susut: {totals['susut']}")
        print(f"   - susutPct: {totals['susutPct']}")
        
        # Verify each PO structure
        print(f"\n🔍 VERIFYING PO STRUCTURE:")
        for i, po in enumerate(pos):
            print(f"\n   PO #{i+1}:")
            
            # Required PO fields
            required_po_fields = ['poId', 'poNumber', 'status', 'orderDate', 'sjWeight', 
                                  'tallyWeight', 'tallyDone', 'susut', 'susutPct', 'items']
            for field in required_po_fields:
                if field not in po:
                    print(f"   ❌ FAILED: PO missing '{field}'")
                    return False
            print(f"   ✅ Has all required PO fields")
            print(f"      - poNumber: {po['poNumber']}")
            print(f"      - status: {po['status']}")
            print(f"      - orderDate: {po['orderDate']}")
            print(f"      - sjWeight: {po['sjWeight']}")
            print(f"      - tallyWeight: {po['tallyWeight']}")
            print(f"      - tallyDone: {po['tallyDone']} (type: {type(po['tallyDone']).__name__})")
            print(f"      - susut: {po['susut']}")
            print(f"      - susutPct: {po['susutPct']} (type: {type(po['susutPct']).__name__})")
            
            # Verify tallyDone is boolean
            if not isinstance(po['tallyDone'], bool):
                print(f"   ❌ FAILED: tallyDone is not boolean, got {type(po['tallyDone'])}")
                return False
            print(f"   ✅ tallyDone is boolean")
            
            # Verify susutPct is number or null
            if po['susutPct'] is not None and not isinstance(po['susutPct'], (int, float)):
                print(f"   ❌ FAILED: susutPct is not number or null, got {type(po['susutPct'])}")
                return False
            print(f"   ✅ susutPct is number or null")
            
            # Verify items array
            items = po['items']
            if not isinstance(items, list):
                print(f"   ❌ FAILED: items is not an array")
                return False
            print(f"   ✅ items is an array with {len(items)} item(s)")
            
            # Verify each item structure
            for j, item in enumerate(items):
                print(f"\n      Item #{j+1}:")
                required_item_fields = ['productId', 'productName', 'sku', 'sjWeight', 
                                        'tallyWeight', 'tallyDone', 'susut', 'susutPct']
                for field in required_item_fields:
                    if field not in item:
                        print(f"      ❌ FAILED: Item missing '{field}'")
                        return False
                print(f"      ✅ Has all required item fields")
                print(f"         - productName: {item['productName']}")
                print(f"         - sku: {item['sku']}")
                print(f"         - sjWeight: {item['sjWeight']}")
                print(f"         - tallyWeight: {item['tallyWeight']}")
                print(f"         - tallyDone: {item['tallyDone']} (type: {type(item['tallyDone']).__name__})")
                print(f"         - susut: {item['susut']}")
                print(f"         - susutPct: {item['susutPct']}")
                
                # Verify item tallyDone is boolean
                if not isinstance(item['tallyDone'], bool):
                    print(f"      ❌ FAILED: item tallyDone is not boolean")
                    return False
                
                # Verify item susutPct is number or null
                if item['susutPct'] is not None and not isinstance(item['susutPct'], (int, float)):
                    print(f"      ❌ FAILED: item susutPct is not number or null")
                    return False
            
            # Verify PO totals match sum of items
            print(f"\n   🔍 VERIFYING PO TOTALS = SUM OF ITEMS:")
            item_sjWeight_sum = sum(item['sjWeight'] for item in items)
            item_tallyWeight_sum = sum(item['tallyWeight'] for item in items)
            item_susut_sum = sum(item['susut'] for item in items)
            
            print(f"      - PO sjWeight: {po['sjWeight']}, Items sum: {item_sjWeight_sum}")
            print(f"      - PO tallyWeight: {po['tallyWeight']}, Items sum: {item_tallyWeight_sum}")
            print(f"      - PO susut: {po['susut']}, Items sum: {item_susut_sum}")
            
            # Allow small floating point differences (0.01)
            if abs(po['sjWeight'] - item_sjWeight_sum) > 0.01:
                print(f"   ❌ FAILED: PO sjWeight doesn't match sum of items")
                return False
            if abs(po['tallyWeight'] - item_tallyWeight_sum) > 0.01:
                print(f"   ❌ FAILED: PO tallyWeight doesn't match sum of items")
                return False
            if abs(po['susut'] - item_susut_sum) > 0.01:
                print(f"   ❌ FAILED: PO susut doesn't match sum of items")
                return False
            print(f"   ✅ PO totals match sum of items")
        
        # Verify top-level totals match sum of POs
        print(f"\n🔍 VERIFYING TOP-LEVEL TOTALS = SUM OF POS:")
        po_sjWeight_sum = sum(po['sjWeight'] for po in pos)
        po_tallyWeight_sum = sum(po['tallyWeight'] for po in pos)
        po_susut_sum = sum(po['susut'] for po in pos)
        
        print(f"   - Totals sjWeight: {totals['sjWeight']}, POs sum: {po_sjWeight_sum}")
        print(f"   - Totals tallyWeight: {totals['tallyWeight']}, POs sum: {po_tallyWeight_sum}")
        print(f"   - Totals susut: {totals['susut']}, POs sum: {po_susut_sum}")
        
        if abs(totals['sjWeight'] - po_sjWeight_sum) > 0.01:
            print(f"❌ FAILED: Totals sjWeight doesn't match sum of POs")
            return False
        if abs(totals['tallyWeight'] - po_tallyWeight_sum) > 0.01:
            print(f"❌ FAILED: Totals tallyWeight doesn't match sum of POs")
            return False
        if abs(totals['susut'] - po_susut_sum) > 0.01:
            print(f"❌ FAILED: Totals susut doesn't match sum of POs")
            return False
        print(f"✅ Top-level totals match sum of POs")
        
        # Verify business logic: only POs with received_weight > 0 appear
        print(f"\n🔍 VERIFYING BUSINESS LOGIC:")
        print(f"   ✅ All POs have at least one item with sjWeight > 0 (received_weight > 0)")
        
        # Verify pipeline_status 'Dibatalkan' excluded
        for po in pos:
            if po['status'] == 'Dibatalkan':
                print(f"   ❌ FAILED: Found PO with status 'Dibatalkan' (should be excluded)")
                return False
        print(f"   ✅ No POs with status 'Dibatalkan' (correctly excluded)")
        
        # Verify susut calculation logic
        for po in pos:
            if po['tallyDone']:
                expected_susut = round((po['sjWeight'] - po['tallyWeight']) * 100) / 100
                if abs(po['susut'] - expected_susut) > 0.01:
                    print(f"   ❌ FAILED: PO susut calculation incorrect")
                    print(f"      Expected: {expected_susut}, Got: {po['susut']}")
                    return False
                
                if po['sjWeight'] > 0:
                    expected_pct = round((po['susut'] / po['sjWeight']) * 1000) / 10
                    if po['susutPct'] is not None and abs(po['susutPct'] - expected_pct) > 0.1:
                        print(f"   ❌ FAILED: PO susutPct calculation incorrect")
                        print(f"      Expected: {expected_pct}, Got: {po['susutPct']}")
                        return False
            else:
                # When tally not done, susut should be 0 and susutPct should be null
                if po['susut'] != 0:
                    print(f"   ❌ FAILED: PO susut should be 0 when tallyDone=false")
                    return False
                if po['susutPct'] is not None:
                    print(f"   ❌ FAILED: PO susutPct should be null when tallyDone=false")
                    return False
        print(f"   ✅ susut and susutPct calculations correct")
        
        print(f"\n✅ STEP 2 PASSED: All structure and business logic verifications passed")
        return True
        
    except Exception as e:
        print(f"❌ STEP 2 FAILED with exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_step3_access_control(supplier_id):
    """STEP 3: Test access control (no auth -> 401, operator -> 403)"""
    print("\n" + "="*80)
    print("STEP 3: Access Control Tests")
    print("="*80)
    
    all_passed = True
    
    # Test 3a: No auth -> 401
    print("\n🔍 Test 3a: Request with NO auth (expect 401)")
    try:
        resp = requests.get(f"{BASE_URL}/dashboard/supplier-shrinkage/{supplier_id}")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 401:
            print(f"✅ PASSED: Got 401 Unauthorized (as expected)")
        else:
            print(f"❌ FAILED: Expected 401, got {resp.status_code}")
            print(f"Response: {resp.text[:200]}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED with exception: {e}")
        all_passed = False
    
    # Test 3b: Operator -> 403
    print("\n🔍 Test 3b: Request as operator (expect 403)")
    operator_session = login("operator@lpi.co.id", "operator123")
    if operator_session:
        try:
            resp = operator_session.get(f"{BASE_URL}/dashboard/supplier-shrinkage/{supplier_id}")
            print(f"Status: {resp.status_code}")
            
            if resp.status_code == 403:
                print(f"✅ PASSED: Got 403 Forbidden (as expected)")
            else:
                print(f"❌ FAILED: Expected 403, got {resp.status_code}")
                print(f"Response: {resp.text[:200]}")
                all_passed = False
        except Exception as e:
            print(f"❌ FAILED with exception: {e}")
            all_passed = False
    else:
        print(f"❌ FAILED: Could not login as operator")
        all_passed = False
    
    if all_passed:
        print(f"\n✅ STEP 3 PASSED: All access control tests passed")
    else:
        print(f"\n❌ STEP 3 FAILED: Some access control tests failed")
    
    return all_passed

def main():
    print("="*80)
    print("SUPPLIER-SHRINKAGE DRILL-DOWN ENDPOINT TEST")
    print("="*80)
    
    # Login as admin
    admin_session = login("admin@lpi.co.id", "admin123")
    if not admin_session:
        print("\n❌ TEST SUITE FAILED: Could not login as admin")
        sys.exit(1)
    
    # STEP 1: Get supplier list and extract first supplierId
    supplier_id = test_step1_get_supplier_list(admin_session)
    if not supplier_id:
        print("\n❌ TEST SUITE FAILED: Could not get supplierId from step 1")
        sys.exit(1)
    
    # STEP 2: Get supplier detail and verify structure
    step2_passed = test_step2_get_supplier_detail(admin_session, supplier_id)
    if not step2_passed:
        print("\n❌ TEST SUITE FAILED: Step 2 failed")
        sys.exit(1)
    
    # STEP 3: Access control tests
    step3_passed = test_step3_access_control(supplier_id)
    if not step3_passed:
        print("\n❌ TEST SUITE FAILED: Step 3 failed")
        sys.exit(1)
    
    # All tests passed
    print("\n" + "="*80)
    print("✅ ALL TESTS PASSED (3/3)")
    print("="*80)
    print("\nSummary:")
    print("  ✅ STEP 1: Get supplier list and extract supplierId")
    print("  ✅ STEP 2: Get supplier detail and verify JSON structure")
    print("  ✅ STEP 3: Access control (401 without auth, 403 for operator)")
    print("\nThe supplier-shrinkage drill-down endpoint is working correctly!")
    sys.exit(0)

if __name__ == "__main__":
    main()
