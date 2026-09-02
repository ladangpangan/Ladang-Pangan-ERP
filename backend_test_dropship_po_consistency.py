#!/usr/bin/env python3
"""
Backend Test: Dropship auto-PO consistency feature
Tests that PO numbers mirror SO numbers (SO/YYYYMM/NNNN -> PO/YYYYMM/NNNN)
and PO orderDate equals SO orderDate for dropship SOs.
"""

import requests
import sys
from datetime import datetime

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"
session = requests.Session()

def login():
    """Login as admin and capture session cookie"""
    print("\n" + "="*80)
    print("TEST 1: Login as admin")
    print("="*80)
    
    try:
        resp = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": "admin@lpi.co.id", "password": "admin123"},
            timeout=30
        )
        print(f"POST /api/auth/sign-in/email → {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ Login failed: {resp.status_code}")
            print(f"Response: {resp.text[:500]}")
            return False
        
        # Check if session cookie is set
        cookies = session.cookies.get_dict()
        if not any('session' in k.lower() for k in cookies.keys()):
            print(f"❌ No session cookie found")
            print(f"Cookies: {cookies}")
            return False
        
        print(f"✅ Login successful")
        print(f"Session cookies: {list(cookies.keys())}")
        return True
        
    except Exception as e:
        print(f"❌ Login exception: {e}")
        return False


def test_dropship_po_consistency():
    """
    TEST 2: Verify dropship POs mirror SO numbers and dates
    For each dropship SO with autoPoId:
    - ASSERT po.poNumber == so.soNumber with 'SO/' -> 'PO/'
    - ASSERT po.orderDate == so.orderDate (date part)
    """
    print("\n" + "="*80)
    print("TEST 2: Verify dropship PO consistency (number & date mirroring)")
    print("="*80)
    
    try:
        # Get all sales orders
        resp = session.get(f"{BASE_URL}/sales-orders", timeout=30)
        print(f"GET /api/sales-orders → {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ Failed to get sales orders: {resp.status_code}")
            return False
        
        data = resp.json()
        all_sos = data.get('data', [])
        print(f"Total SOs: {len(all_sos)}")
        
        # Filter to dropship SOs with autoPoId
        dropship_sos = [
            so for so in all_sos 
            if so.get('fulfillmentType') == 'dropship' and so.get('autoPoId')
        ]
        
        print(f"Dropship SOs with autoPoId: {len(dropship_sos)}")
        
        if len(dropship_sos) == 0:
            print("❌ No dropship SOs with autoPoId found")
            return False
        
        # Get all purchase orders
        resp_po = session.get(f"{BASE_URL}/purchase-orders", timeout=30)
        print(f"GET /api/purchase-orders → {resp_po.status_code}")
        
        if resp_po.status_code != 200:
            print(f"❌ Failed to get purchase orders: {resp_po.status_code}")
            return False
        
        po_data = resp_po.json()
        all_pos = po_data.get('data', [])
        print(f"Total POs: {len(all_pos)}")
        
        # Create PO lookup by ID
        po_by_id = {po['id']: po for po in all_pos}
        
        # Test at least 3 dropship SOs (or all if less than 3)
        test_count = min(len(dropship_sos), 3)
        print(f"\nTesting {test_count} dropship SOs...")
        
        mismatches = []
        passed = 0
        
        for i, so in enumerate(dropship_sos[:test_count]):
            so_number = so.get('soNumber', 'N/A')
            so_order_date = so.get('orderDate', '')
            auto_po_id = so.get('autoPoId')
            
            print(f"\n--- Dropship SO #{i+1}: {so_number} ---")
            print(f"SO ID: {so['id']}")
            print(f"SO orderDate: {so_order_date}")
            print(f"autoPoId: {auto_po_id}")
            
            # Find linked PO
            linked_po = po_by_id.get(auto_po_id)
            
            if not linked_po:
                print(f"❌ Linked PO not found for autoPoId: {auto_po_id}")
                mismatches.append({
                    'so': so_number,
                    'issue': 'Linked PO not found',
                    'autoPoId': auto_po_id
                })
                continue
            
            po_number = linked_po.get('poNumber', 'N/A')
            po_order_date = linked_po.get('orderDate', '')
            
            print(f"Linked PO: {po_number}")
            print(f"PO orderDate: {po_order_date}")
            
            # ASSERT 1: PO number mirrors SO number (SO/ -> PO/)
            expected_po_number = so_number.replace('SO/', 'PO/')
            if po_number != expected_po_number:
                print(f"❌ PO NUMBER MISMATCH!")
                print(f"   Expected: {expected_po_number}")
                print(f"   Actual:   {po_number}")
                mismatches.append({
                    'so': so_number,
                    'issue': 'PO number does not mirror SO number',
                    'expected': expected_po_number,
                    'actual': po_number
                })
            else:
                print(f"✅ PO number mirrors SO number: {po_number}")
            
            # ASSERT 2: PO orderDate == SO orderDate (date part)
            # Extract date part (YYYY-MM-DD) from ISO strings
            so_date_part = so_order_date.split('T')[0] if 'T' in so_order_date else so_order_date[:10]
            po_date_part = po_order_date.split('T')[0] if 'T' in po_order_date else po_order_date[:10]
            
            if so_date_part != po_date_part:
                print(f"❌ ORDER DATE MISMATCH!")
                print(f"   SO date:  {so_date_part}")
                print(f"   PO date:  {po_date_part}")
                mismatches.append({
                    'so': so_number,
                    'po': po_number,
                    'issue': 'PO orderDate does not match SO orderDate',
                    'so_date': so_date_part,
                    'po_date': po_date_part
                })
            else:
                print(f"✅ PO orderDate matches SO orderDate: {so_date_part}")
            
            # If both checks passed
            if po_number == expected_po_number and so_date_part == po_date_part:
                passed += 1
        
        print(f"\n{'='*80}")
        print(f"SUMMARY: {passed}/{test_count} dropship SOs passed all checks")
        
        if mismatches:
            print(f"\n❌ FOUND {len(mismatches)} MISMATCHES:")
            for m in mismatches:
                print(f"  - SO: {m.get('so', 'N/A')}")
                print(f"    Issue: {m['issue']}")
                if 'expected' in m:
                    print(f"    Expected: {m['expected']}, Actual: {m['actual']}")
                if 'so_date' in m:
                    print(f"    SO date: {m['so_date']}, PO date: {m['po_date']}")
            return False
        else:
            print(f"✅ ALL DROPSHIP POs MIRROR SO NUMBERS AND DATES CORRECTLY")
            return True
        
    except Exception as e:
        print(f"❌ Test exception: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_auto_remirror_on_so_edit():
    """
    TEST 3: Auto re-mirror of linked PO on SO-number edit
    a. Pick one dropship SO with autoPoId
    b. POST /api/sales-orders/<soId>/so-number {"soNumber":"SO/209911/8888"} -> expect 200
    c. Fetch linked PO -> ASSERT poNumber == 'PO/209911/8888'
    d. REVERT: POST original soNumber -> expect 200
    e. Fetch linked PO -> ASSERT poNumber mirrors back to original
    """
    print("\n" + "="*80)
    print("TEST 3: Auto re-mirror of linked PO on SO-number edit")
    print("="*80)
    
    try:
        # Get all sales orders
        resp = session.get(f"{BASE_URL}/sales-orders", timeout=30)
        if resp.status_code != 200:
            print(f"❌ Failed to get sales orders: {resp.status_code}")
            return False
        
        data = resp.json()
        all_sos = data.get('data', [])
        
        # Find a dropship SO with autoPoId
        dropship_sos = [
            so for so in all_sos 
            if so.get('fulfillmentType') == 'dropship' and so.get('autoPoId')
        ]
        
        if not dropship_sos:
            print("❌ No dropship SOs with autoPoId found")
            return False
        
        # Pick the first one
        test_so = dropship_sos[0]
        so_id = test_so['id']
        original_so_number = test_so['soNumber']
        auto_po_id = test_so['autoPoId']
        
        print(f"Selected test SO: {original_so_number}")
        print(f"SO ID: {so_id}")
        print(f"autoPoId: {auto_po_id}")
        
        # Get original PO number
        resp_po = session.get(f"{BASE_URL}/purchase-orders/{auto_po_id}", timeout=30)
        if resp_po.status_code != 200:
            print(f"❌ Failed to get linked PO: {resp_po.status_code}")
            return False
        
        original_po = resp_po.json().get('data', {})
        original_po_number = original_po.get('poNumber', 'N/A')
        print(f"Original PO number: {original_po_number}")
        
        # Step b: Change SO number to test value
        test_so_number = "SO/209911/8888"
        print(f"\n[Step 1] Change SO number to: {test_so_number}")
        
        resp_change = session.post(
            f"{BASE_URL}/sales-orders/{so_id}/so-number",
            json={"soNumber": test_so_number},
            timeout=30
        )
        print(f"POST /api/sales-orders/{so_id}/so-number → {resp_change.status_code}")
        
        if resp_change.status_code != 200:
            print(f"❌ Failed to change SO number: {resp_change.status_code}")
            print(f"Response: {resp_change.text[:500]}")
            return False
        
        print(f"✅ SO number changed successfully")
        
        # Step c: Fetch linked PO and verify it mirrors the new SO number
        print(f"\n[Step 2] Verify linked PO number auto-mirrored")
        
        resp_po_after = session.get(f"{BASE_URL}/purchase-orders/{auto_po_id}", timeout=30)
        if resp_po_after.status_code != 200:
            print(f"❌ Failed to get linked PO after change: {resp_po_after.status_code}")
            return False
        
        updated_po = resp_po_after.json().get('data', {})
        updated_po_number = updated_po.get('poNumber', 'N/A')
        expected_po_number = test_so_number.replace('SO/', 'PO/')
        
        print(f"Expected PO number: {expected_po_number}")
        print(f"Actual PO number:   {updated_po_number}")
        
        if updated_po_number != expected_po_number:
            print(f"❌ PO NUMBER DID NOT AUTO RE-MIRROR!")
            print(f"   Expected: {expected_po_number}")
            print(f"   Actual:   {updated_po_number}")
            # Try to revert before returning
            session.post(
                f"{BASE_URL}/sales-orders/{so_id}/so-number",
                json={"soNumber": original_so_number},
                timeout=30
            )
            return False
        
        print(f"✅ PO number auto-mirrored correctly: {updated_po_number}")
        
        # Step d: REVERT to original SO number
        print(f"\n[Step 3] Revert SO number to original: {original_so_number}")
        
        resp_revert = session.post(
            f"{BASE_URL}/sales-orders/{so_id}/so-number",
            json={"soNumber": original_so_number},
            timeout=30
        )
        print(f"POST /api/sales-orders/{so_id}/so-number → {resp_revert.status_code}")
        
        if resp_revert.status_code != 200:
            print(f"❌ Failed to revert SO number: {resp_revert.status_code}")
            print(f"Response: {resp_revert.text[:500]}")
            return False
        
        print(f"✅ SO number reverted successfully")
        
        # Step e: Verify PO number mirrors back to original
        print(f"\n[Step 4] Verify PO number mirrored back to original")
        
        resp_po_final = session.get(f"{BASE_URL}/purchase-orders/{auto_po_id}", timeout=30)
        if resp_po_final.status_code != 200:
            print(f"❌ Failed to get linked PO after revert: {resp_po_final.status_code}")
            return False
        
        final_po = resp_po_final.json().get('data', {})
        final_po_number = final_po.get('poNumber', 'N/A')
        
        print(f"Expected PO number: {original_po_number}")
        print(f"Actual PO number:   {final_po_number}")
        
        if final_po_number != original_po_number:
            print(f"❌ PO NUMBER DID NOT REVERT CORRECTLY!")
            print(f"   Expected: {original_po_number}")
            print(f"   Actual:   {final_po_number}")
            return False
        
        print(f"✅ PO number reverted correctly: {final_po_number}")
        
        print(f"\n{'='*80}")
        print(f"✅ AUTO RE-MIRROR TEST PASSED")
        print(f"   - SO number changed: {original_so_number} → {test_so_number}")
        print(f"   - PO auto-mirrored: {original_po_number} → {expected_po_number}")
        print(f"   - SO number reverted: {test_so_number} → {original_so_number}")
        print(f"   - PO auto-mirrored back: {expected_po_number} → {original_po_number}")
        
        return True
        
    except Exception as e:
        print(f"❌ Test exception: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_sanity_checks():
    """
    TEST 4: Sanity checks
    - GET /api/purchase-orders -> no HTTP 500
    - Verify no September-2026 dropship POs remain mislabeled
    """
    print("\n" + "="*80)
    print("TEST 4: Sanity checks (no HTTP 500, no mislabeled POs)")
    print("="*80)
    
    try:
        # Check GET /api/purchase-orders
        resp = session.get(f"{BASE_URL}/purchase-orders", timeout=30)
        print(f"GET /api/purchase-orders → {resp.status_code}")
        
        if resp.status_code == 500:
            print(f"❌ HTTP 500 ERROR on GET /api/purchase-orders")
            print(f"Response: {resp.text[:500]}")
            return False
        
        if resp.status_code != 200:
            print(f"❌ Unexpected status code: {resp.status_code}")
            return False
        
        print(f"✅ No HTTP 500 error")
        
        # Get all POs
        po_data = resp.json()
        all_pos = po_data.get('data', [])
        print(f"Total POs: {len(all_pos)}")
        
        # Check for mislabeled September 2026 dropship POs
        # A mislabeled PO would have a different month in its number than its orderDate
        mislabeled = []
        
        for po in all_pos:
            if not po.get('isDropship'):
                continue
            
            po_number = po.get('poNumber', '')
            order_date = po.get('orderDate', '')
            
            # Extract month from PO number (PO/YYYYMM/NNNN)
            if '/' in po_number:
                parts = po_number.split('/')
                if len(parts) >= 2:
                    po_month = parts[1]  # YYYYMM
                else:
                    continue
            else:
                continue
            
            # Extract month from orderDate
            if order_date:
                order_date_part = order_date.split('T')[0] if 'T' in order_date else order_date[:10]
                # Convert YYYY-MM-DD to YYYYMM
                order_month = order_date_part.replace('-', '')[:6]
            else:
                continue
            
            # Check if months match
            if po_month != order_month:
                mislabeled.append({
                    'poNumber': po_number,
                    'orderDate': order_date_part,
                    'po_month': po_month,
                    'order_month': order_month
                })
        
        if mislabeled:
            print(f"\n❌ FOUND {len(mislabeled)} MISLABELED DROPSHIP POs:")
            for m in mislabeled:
                print(f"  - PO: {m['poNumber']}")
                print(f"    Order Date: {m['orderDate']}")
                print(f"    PO month: {m['po_month']}, Order month: {m['order_month']}")
            return False
        else:
            print(f"✅ No mislabeled dropship POs found")
            print(f"   All dropship POs have numbers matching their order month")
        
        print(f"\n{'='*80}")
        print(f"✅ SANITY CHECKS PASSED")
        
        return True
        
    except Exception as e:
        print(f"❌ Test exception: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("BACKEND TEST: Dropship auto-PO consistency feature")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Auth: Better Auth session cookie (admin@lpi.co.id / admin123)")
    print(f"Test execution: Python requests")
    
    results = []
    
    # Test 1: Login
    if not login():
        print("\n❌ LOGIN FAILED - Cannot proceed with tests")
        sys.exit(1)
    results.append(("Login", True))
    
    # Test 2: Dropship PO consistency
    test2_result = test_dropship_po_consistency()
    results.append(("Dropship PO consistency (number & date)", test2_result))
    
    # Test 3: Auto re-mirror on SO edit
    test3_result = test_auto_remirror_on_so_edit()
    results.append(("Auto re-mirror on SO-number edit", test3_result))
    
    # Test 4: Sanity checks
    test4_result = test_sanity_checks()
    results.append(("Sanity checks (no HTTP 500, no mislabeled POs)", test4_result))
    
    # Final summary
    print("\n" + "="*80)
    print("FINAL TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{status}: {test_name}")
    
    print(f"\n{'='*80}")
    print(f"TOTAL: {passed}/{total} tests passed ({passed*100//total}%)")
    
    if passed == total:
        print(f"✅ ALL TESTS PASSED - Dropship auto-PO consistency feature is working correctly")
        sys.exit(0)
    else:
        print(f"❌ SOME TESTS FAILED - See details above")
        sys.exit(1)


if __name__ == "__main__":
    main()
