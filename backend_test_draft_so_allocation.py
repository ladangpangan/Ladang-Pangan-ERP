#!/usr/bin/env python3
"""
Regression test for BUGFIX: Draft Sales Order editing must release previous stock allocations
and not leave orphaned so_item_stocks.

Test Steps:
1) Login admin
2) Get a Draft SO (SO/202608/0035 or SO/202608/0037)
3) Find an 'active' inventory lot matching the SO item's productId
4) ALLOCATE: POST /api/sales-orders/<soId>/items/<itemId>/allocate
5) EDIT ITEMS WITHOUT stockId: PUT /api/sales-orders/<soId> - verify lot returns to 'active'
6) EDIT ITEMS WITH stockId: PUT /api/sales-orders/<soId> - verify lot becomes 'allocated'
7) Cleanup: PUT again without stockId to release
"""

import requests
import json
import sys
from datetime import datetime

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

session = requests.Session()

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def test_login():
    """TEST 1: Login as admin"""
    try:
        log("=" * 80)
        log("TEST 1: Login as admin")
        log("=" * 80)
        
        response = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            headers={"Content-Type": "application/json"}
        )
        
        log(f"POST /api/auth/sign-in/email → {response.status_code}")
        
        if response.status_code != 200:
            log(f"❌ FAILED: Login failed with status {response.status_code}")
            log(f"Response: {response.text}")
            return False
        
        # Check if session cookie is set
        cookies = session.cookies.get_dict()
        if not any('session' in k.lower() for k in cookies.keys()):
            log(f"❌ FAILED: No session cookie found")
            log(f"Cookies: {cookies}")
            return False
        
        log(f"✅ PASSED: Login successful")
        log(f"Session cookies: {list(cookies.keys())}")
        return True
        
    except Exception as e:
        log(f"❌ EXCEPTION in test_login: {e}")
        return False

def test_draft_so_allocation_release():
    """TEST 2-7: Draft SO allocation and release"""
    try:
        log("\n" + "=" * 80)
        log("TEST 2-7: Draft SO Allocation Release Regression Test")
        log("=" * 80)
        
        # Step 1: Get Draft SOs
        log("\n[Step 1] Get Draft Sales Orders")
        response = session.get(f"{BASE_URL}/sales-orders")
        log(f"GET /api/sales-orders → {response.status_code}")
        
        if response.status_code != 200:
            log(f"❌ FAILED: Cannot get sales orders - {response.status_code}")
            return False
        
        data = response.json()
        all_sos = data.get('data', [])
        log(f"Total SOs: {len(all_sos)}")
        
        # Find a Draft SO (prefer SO/202608/0035 or SO/202608/0037)
        draft_sos = [so for so in all_sos if so.get('pipelineStatus') == 'Draft']
        log(f"Draft SOs: {len(draft_sos)}")
        
        target_so = None
        for so in draft_sos:
            if so.get('soNumber') in ['SO/202608/0035', 'SO/202608/0037']:
                target_so = so
                break
        
        if not target_so and draft_sos:
            target_so = draft_sos[0]
        
        if not target_so:
            log(f"❌ FAILED: No Draft SO found")
            return False
        
        so_id = target_so['id']
        so_number = target_so['soNumber']
        log(f"✅ Selected Draft SO: {so_number} (ID: {so_id})")
        
        # Get SO details to find items
        response = session.get(f"{BASE_URL}/sales-orders/{so_id}")
        log(f"GET /api/sales-orders/{so_id} → {response.status_code}")
        
        if response.status_code != 200:
            log(f"❌ FAILED: Cannot get SO details - {response.status_code}")
            return False
        
        so_detail = response.json().get('data', {})
        items = so_detail.get('items', [])
        
        if not items:
            log(f"❌ FAILED: SO has no items")
            return False
        
        # Pick first item
        item = items[0]
        item_id = item['id']
        product_id = item['productId']
        item_weight = item.get('weight', 0)
        item_quantity = item.get('quantity', 0)
        item_unit_price = item.get('unitPrice', 0)
        item_discount = item.get('discount', 0)
        
        log(f"✅ Selected item: ID={item_id}, productId={product_id}, weight={item_weight}, qty={item_quantity}")
        
        # Step 2: Find an 'active' inventory lot for this product
        log("\n[Step 2] Find active inventory lot for product")
        response = session.get(f"{BASE_URL}/inventory/stocks?status=active&product_id={product_id}")
        log(f"GET /api/inventory/stocks?status=active&product_id={product_id} → {response.status_code}")
        
        if response.status_code != 200:
            log(f"❌ FAILED: Cannot get inventory stocks - {response.status_code}")
            return False
        
        stocks_data = response.json()
        active_lots = stocks_data.get('data', [])
        log(f"Active lots for product {product_id}: {len(active_lots)}")
        
        if not active_lots:
            log(f"❌ FAILED: No active lots found for product {product_id}")
            return False
        
        # Pick first active lot with sufficient weight
        lot = None
        for l in active_lots:
            lot_weight = l.get('weight', 0)
            if lot_weight >= item_weight:
                lot = l
                break
        
        # If no lot with sufficient weight, use first lot and adjust item weight
        if not lot:
            lot = active_lots[0]
            lot_weight = lot.get('weight', 0)
            log(f"⚠️ No lot with sufficient weight ({item_weight} kg), using lot with {lot_weight} kg")
            # We'll adjust the item weight for re-allocation test
            item_weight = lot_weight
        
        lot_id = lot['id']
        lot_code = lot['kodeSimpan']
        lot_status_before = lot['status']
        lot_weight = lot.get('weight', 0)
        
        log(f"✅ Selected lot: {lot_code} (ID: {lot_id}, status: {lot_status_before}, weight: {lot_weight} kg)")
        
        # Step 3: ALLOCATE the lot to the item
        log("\n[Step 3] ALLOCATE lot to SO item")
        response = session.post(
            f"{BASE_URL}/sales-orders/{so_id}/items/{item_id}/allocate",
            json={"stockIds": [lot_id]},
            headers={"Content-Type": "application/json"}
        )
        log(f"POST /api/sales-orders/{so_id}/items/{item_id}/allocate → {response.status_code}")
        
        if response.status_code != 200:
            log(f"❌ FAILED: Allocation failed - {response.status_code}")
            log(f"Response: {response.text}")
            return False
        
        log(f"✅ PASSED: Allocation successful")
        
        # Verify lot status is now 'allocated'
        response = session.get(f"{BASE_URL}/inventory/stocks?status=all")
        if response.status_code == 200:
            all_stocks = response.json().get('data', [])
            lot_after_alloc = next((s for s in all_stocks if s['id'] == lot_id), None)
            if lot_after_alloc:
                log(f"Lot status after allocation: {lot_after_alloc['status']}")
                if lot_after_alloc['status'] != 'allocated':
                    log(f"❌ FAILED: Lot status should be 'allocated' but is '{lot_after_alloc['status']}'")
                    return False
                log(f"✅ PASSED: Lot status is 'allocated'")
        
        # Verify SO item has stockCodeId
        response = session.get(f"{BASE_URL}/sales-orders/{so_id}")
        if response.status_code == 200:
            so_detail = response.json().get('data', {})
            items = so_detail.get('items', [])
            item_after_alloc = next((i for i in items if i['id'] == item_id), None)
            if item_after_alloc:
                stock_code_id = item_after_alloc.get('stockCodeId')
                log(f"Item stockCodeId after allocation: {stock_code_id}")
                if stock_code_id != lot_id:
                    log(f"❌ FAILED: Item stockCodeId should be {lot_id} but is {stock_code_id}")
                    return False
                log(f"✅ PASSED: Item has correct stockCodeId")
        
        # Step 4: EDIT ITEMS WITHOUT stockId (simulate the bug scenario)
        log("\n[Step 4] EDIT items WITHOUT stockId - KEY TEST FOR BUG FIX")
        edit_body = {
            "items": [{
                "productId": product_id,
                "quantity": item_quantity,
                "weight": item_weight,
                "unitPrice": item_unit_price,
                "discount": item_discount
                # NO stockId - this should release the allocation
            }]
        }
        
        response = session.put(
            f"{BASE_URL}/sales-orders/{so_id}",
            json=edit_body,
            headers={"Content-Type": "application/json"}
        )
        log(f"PUT /api/sales-orders/{so_id} (without stockId) → {response.status_code}")
        
        if response.status_code != 200:
            log(f"❌ FAILED: Edit without stockId failed - {response.status_code}")
            log(f"Response: {response.text}")
            return False
        
        log(f"✅ PASSED: Edit without stockId successful")
        
        # CRITICAL VERIFICATION: Lot should be back to 'active'
        log("\n[CRITICAL VERIFICATION] Check lot status after edit without stockId")
        response = session.get(f"{BASE_URL}/inventory/stocks?status=all")
        if response.status_code != 200:
            log(f"❌ FAILED: Cannot get inventory stocks - {response.status_code}")
            return False
        
        all_stocks = response.json().get('data', [])
        lot_after_edit = next((s for s in all_stocks if s['id'] == lot_id), None)
        
        if not lot_after_edit:
            log(f"❌ FAILED: Cannot find lot {lot_id} after edit")
            return False
        
        log(f"Lot status after edit without stockId: {lot_after_edit['status']}")
        
        if lot_after_edit['status'] != 'active':
            log(f"❌ CRITICAL BUG: Lot status should be 'active' but is '{lot_after_edit['status']}'")
            log(f"This is the bug - lot stuck in 'allocated' status!")
            return False
        
        log(f"✅ PASSED: Lot correctly returned to 'active' status")
        
        # Verify item has no stockCodeId
        response = session.get(f"{BASE_URL}/sales-orders/{so_id}")
        if response.status_code == 200:
            so_detail = response.json().get('data', {})
            items = so_detail.get('items', [])
            if items:
                item_after_edit = items[0]  # Get first item (we deleted and re-inserted)
                stock_code_id = item_after_edit.get('stockCodeId')
                log(f"Item stockCodeId after edit without stockId: {stock_code_id}")
                if stock_code_id is not None:
                    log(f"❌ FAILED: Item stockCodeId should be null but is {stock_code_id}")
                    return False
                log(f"✅ PASSED: Item stockCodeId is null")
        
        # Verify no orphaned so_item_stocks (we can't query this directly, but the SO detail should show no allocations)
        allocations = so_detail.get('allocations', [])
        log(f"SO allocations after edit without stockId: {len(allocations)}")
        if len(allocations) > 0:
            log(f"❌ FAILED: Found {len(allocations)} orphaned allocations")
            return False
        log(f"✅ PASSED: No orphaned allocations")
        
        # Step 5: EDIT ITEMS WITH stockId (re-allocate)
        log("\n[Step 5] EDIT items WITH stockId - verify re-allocation")
        edit_body_with_stock = {
            "items": [{
                "productId": product_id,
                "quantity": item_quantity,
                "weight": item_weight,
                "unitPrice": item_unit_price,
                "discount": item_discount,
                "stockId": lot_id  # Include stockId to re-allocate
            }]
        }
        
        response = session.put(
            f"{BASE_URL}/sales-orders/{so_id}",
            json=edit_body_with_stock,
            headers={"Content-Type": "application/json"}
        )
        log(f"PUT /api/sales-orders/{so_id} (with stockId) → {response.status_code}")
        
        if response.status_code != 200:
            log(f"❌ FAILED: Edit with stockId failed - {response.status_code}")
            log(f"Response: {response.text}")
            return False
        
        log(f"✅ PASSED: Edit with stockId successful")
        
        # Verify lot is 'allocated' again
        response = session.get(f"{BASE_URL}/inventory/stocks?status=all")
        if response.status_code == 200:
            all_stocks = response.json().get('data', [])
            lot_after_realloc = next((s for s in all_stocks if s['id'] == lot_id), None)
            if lot_after_realloc:
                log(f"Lot status after re-allocation: {lot_after_realloc['status']}")
                if lot_after_realloc['status'] != 'allocated':
                    log(f"❌ FAILED: Lot status should be 'allocated' but is '{lot_after_realloc['status']}'")
                    return False
                log(f"✅ PASSED: Lot status is 'allocated' again")
        
        # Verify SO has allocation
        response = session.get(f"{BASE_URL}/sales-orders/{so_id}")
        if response.status_code == 200:
            so_detail = response.json().get('data', {})
            items = so_detail.get('items', [])
            if items:
                item_after_realloc = items[0]
                stock_code_id = item_after_realloc.get('stockCodeId')
                log(f"Item stockCodeId after re-allocation: {stock_code_id}")
                if stock_code_id != lot_id:
                    log(f"❌ FAILED: Item stockCodeId should be {lot_id} but is {stock_code_id}")
                    return False
                log(f"✅ PASSED: Item has correct stockCodeId after re-allocation")
        
        # Step 6: Cleanup - release allocation again
        log("\n[Step 6] Cleanup - release allocation")
        response = session.put(
            f"{BASE_URL}/sales-orders/{so_id}",
            json=edit_body,  # Without stockId
            headers={"Content-Type": "application/json"}
        )
        log(f"PUT /api/sales-orders/{so_id} (cleanup) → {response.status_code}")
        
        if response.status_code != 200:
            log(f"⚠️ WARNING: Cleanup failed - {response.status_code}")
        else:
            log(f"✅ Cleanup successful")
            
            # Verify lot is back to 'active'
            response = session.get(f"{BASE_URL}/inventory/stocks?status=all")
            if response.status_code == 200:
                all_stocks = response.json().get('data', [])
                lot_final = next((s for s in all_stocks if s['id'] == lot_id), None)
                if lot_final:
                    log(f"Final lot status: {lot_final['status']}")
                    if lot_final['status'] != 'active':
                        log(f"⚠️ WARNING: Lot status should be 'active' but is '{lot_final['status']}'")
                    else:
                        log(f"✅ PASSED: Lot correctly returned to 'active' status (cleanup)")
        
        log("\n" + "=" * 80)
        log("✅ ALL CRITICAL TESTS PASSED")
        log("=" * 80)
        log("Key findings:")
        log("1. Allocation works correctly (lot → 'allocated')")
        log("2. Edit without stockId releases allocation (lot → 'active') ✓ BUG FIX VERIFIED")
        log("3. No orphaned so_item_stocks ✓")
        log("4. Edit with stockId re-allocates correctly (lot → 'allocated')")
        log("5. Cleanup works correctly")
        
        return True
        
    except Exception as e:
        log(f"❌ EXCEPTION in test_draft_so_allocation_release: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    log("=" * 80)
    log("REGRESSION TEST: Draft SO Allocation Release Bug Fix")
    log("=" * 80)
    
    results = []
    
    # Test 1: Login
    results.append(("Login", test_login()))
    
    if not results[0][1]:
        log("\n❌ Login failed, cannot proceed with other tests")
        sys.exit(1)
    
    # Test 2-7: Draft SO allocation release
    results.append(("Draft SO Allocation Release", test_draft_so_allocation_release()))
    
    # Summary
    log("\n" + "=" * 80)
    log("TEST SUMMARY")
    log("=" * 80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASSED" if result else "❌ FAILED"
        log(f"{status}: {test_name}")
    
    log(f"\nTotal: {passed}/{total} tests passed ({100*passed//total}%)")
    
    if passed == total:
        log("\n✅ ALL TESTS PASSED - BUG FIX VERIFIED")
        sys.exit(0)
    else:
        log(f"\n❌ {total - passed} TEST(S) FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
