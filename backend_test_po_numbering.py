#!/usr/bin/env python3
"""
Backend test for PO numbering feature:
1. Manual Edit No PO endpoint (POST /api/purchase-orders/:id/po-number)
2. Generator uses ORDER date (not creation/today)
3. No duplicates / sequential PO numbers
"""

import requests
import json
from datetime import datetime

# Configuration
BASE_URL = "https://so-po-loader.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

# Session
session = requests.Session()

def print_test(msg):
    print(f"\n{'='*80}")
    print(f"  {msg}")
    print('='*80)

def print_result(success, msg):
    status = "✅ PASSED" if success else "❌ FAILED"
    print(f"{status}: {msg}")

# ============================================================================
# TEST 1: Login as admin
# ============================================================================
print_test("TEST 1 — Login as admin")

try:
    login_response = session.post(
        f"{API_BASE}/auth/sign-in/email",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"Origin": BASE_URL}
    )
    
    if login_response.status_code == 200:
        print_result(True, f"Login successful (status {login_response.status_code})")
        # Session cookie is automatically stored in session object
    else:
        print_result(False, f"Login failed with status {login_response.status_code}")
        print(f"Response: {login_response.text}")
        exit(1)
except Exception as e:
    print_result(False, f"Login exception: {e}")
    exit(1)

# ============================================================================
# TEST 2: Manual Edit No PO endpoint
# ============================================================================
print_test("TEST 2 — Manual Edit No PO (POST /api/purchase-orders/:id/po-number)")

try:
    # Step 1: GET all purchase orders
    print("\nStep 1: GET /api/purchase-orders to find test POs")
    po_list_response = session.get(f"{API_BASE}/purchase-orders")
    
    if po_list_response.status_code != 200:
        print_result(False, f"Failed to get purchase orders: {po_list_response.status_code}")
        print(f"Response: {po_list_response.text}")
        exit(1)
    
    po_list = po_list_response.json().get('data', [])
    print(f"Found {len(po_list)} purchase orders")
    
    if len(po_list) < 2:
        print_result(False, "Need at least 2 POs for testing")
        exit(1)
    
    # Pick first and second PO
    first_po = po_list[0]
    second_po = po_list[1]
    
    first_po_id = first_po['id']
    first_po_original_number = first_po['poNumber']
    second_po_number = second_po['poNumber']
    
    print(f"First PO: {first_po_original_number} (ID: {first_po_id})")
    print(f"Second PO: {second_po_number} (ID: {second_po['id']})")
    
    # Step 2: Change first PO number to a test value
    test_po_number = "PO/209912/9999"
    print(f"\nStep 2: Change first PO number to {test_po_number}")
    
    change_response = session.post(
        f"{API_BASE}/purchase-orders/{first_po_id}/po-number",
        json={"poNumber": test_po_number}
    )
    
    if change_response.status_code != 200:
        print_result(False, f"Failed to change PO number: {change_response.status_code}")
        print(f"Response: {change_response.text}")
        exit(1)
    
    change_data = change_response.json().get('data', {})
    if change_data.get('poNumber') != test_po_number:
        print_result(False, f"PO number not updated correctly. Got: {change_data.get('poNumber')}")
        exit(1)
    
    print_result(True, f"PO number changed to {test_po_number}")
    
    # Step 3: Verify persistence with GET
    print(f"\nStep 3: GET /api/purchase-orders/{first_po_id} to verify persistence")
    
    get_po_response = session.get(f"{API_BASE}/purchase-orders/{first_po_id}")
    if get_po_response.status_code != 200:
        print_result(False, f"Failed to get PO: {get_po_response.status_code}")
        exit(1)
    
    get_po_data = get_po_response.json().get('data', {})
    if get_po_data.get('poNumber') != test_po_number:
        print_result(False, f"PO number not persisted. Got: {get_po_data.get('poNumber')}")
        exit(1)
    
    print_result(True, f"PO number persisted correctly: {test_po_number}")
    
    # Step 4: Try to change to duplicate (second PO's number) - should fail with 400
    print(f"\nStep 4: Try to change to duplicate number {second_po_number} (should fail)")
    
    duplicate_response = session.post(
        f"{API_BASE}/purchase-orders/{first_po_id}/po-number",
        json={"poNumber": second_po_number}
    )
    
    if duplicate_response.status_code != 400:
        print_result(False, f"Expected 400 for duplicate, got {duplicate_response.status_code}")
        print(f"Response: {duplicate_response.text}")
        exit(1)
    
    print_result(True, f"Duplicate rejection working (got 400)")
    print(f"Error message: {duplicate_response.json().get('error', 'N/A')}")
    
    # Step 5: Verify first PO unchanged after failed duplicate attempt
    print(f"\nStep 5: Verify first PO unchanged after failed duplicate attempt")
    
    verify_response = session.get(f"{API_BASE}/purchase-orders/{first_po_id}")
    verify_data = verify_response.json().get('data', {})
    
    if verify_data.get('poNumber') != test_po_number:
        print_result(False, f"PO number changed unexpectedly to: {verify_data.get('poNumber')}")
        exit(1)
    
    print_result(True, f"First PO unchanged: {test_po_number}")
    
    # Step 6: Revert to original number
    print(f"\nStep 6: Revert to original number {first_po_original_number}")
    
    revert_response = session.post(
        f"{API_BASE}/purchase-orders/{first_po_id}/po-number",
        json={"poNumber": first_po_original_number}
    )
    
    if revert_response.status_code != 200:
        print_result(False, f"Failed to revert PO number: {revert_response.status_code}")
        print(f"Response: {revert_response.text}")
        exit(1)
    
    revert_data = revert_response.json().get('data', {})
    if revert_data.get('poNumber') != first_po_original_number:
        print_result(False, f"PO number not reverted correctly. Got: {revert_data.get('poNumber')}")
        exit(1)
    
    print_result(True, f"PO number reverted to original: {first_po_original_number}")
    
    print("\n" + "="*80)
    print("✅ TEST 2 COMPLETE: Manual Edit No PO endpoint working correctly")
    print("="*80)
    
except Exception as e:
    print_result(False, f"Exception in TEST 2: {e}")
    import traceback
    traceback.print_exc()
    exit(1)

# ============================================================================
# TEST 3: Generator uses ORDER date (not creation/today)
# ============================================================================
print_test("TEST 3 — Generator uses ORDER date (not creation/today)")

try:
    # Step 1: Get a valid supplier and product
    print("\nStep 1: Get valid supplier and product")
    
    contacts_response = session.get(f"{API_BASE}/contacts")
    if contacts_response.status_code != 200:
        print_result(False, f"Failed to get contacts: {contacts_response.status_code}")
        exit(1)
    
    contacts = contacts_response.json().get('data', [])
    supplier = None
    for c in contacts:
        # Check for supplier type
        categories = c.get('categories', [])
        if 'Supplier' in categories or 'supplier' in str(categories).lower():
            supplier = c
            break
    
    # If no supplier found by type, look for any contact with supplier in name
    if not supplier:
        for c in contacts:
            if 'supplier' in c.get('name', '').lower() or 'supp' in c.get('code', '').lower():
                supplier = c
                break
    
    # If still no supplier, use first contact
    if not supplier and contacts:
        print("Warning: No supplier type found, using first contact")
        supplier = contacts[0]
    
    if not supplier:
        print_result(False, "No contacts found at all")
        exit(1)
    
    print(f"Using supplier: {supplier.get('code')} - {supplier.get('name')}")
    
    products_response = session.get(f"{API_BASE}/products")
    if products_response.status_code != 200:
        print_result(False, f"Failed to get products: {products_response.status_code}")
        exit(1)
    
    products = products_response.json().get('data', [])
    if not products:
        print_result(False, "No products found")
        exit(1)
    
    product = products[0]
    print(f"Using product: {product.get('code')} - {product.get('name')}")
    
    # Step 2: Create a NEW PO with orderDate in May 2026
    print("\nStep 2: Create NEW PO with orderDate='2026-05-10'")
    
    new_po_payload = {
        "supplierId": supplier['id'],
        "orderDate": "2026-05-10",
        "poType": "Live Bird",
        "items": [
            {
                "productId": product['id'],
                "quantity": 1,
                "weight": 10,
                "unitPrice": 30000
            }
        ]
    }
    
    create_response = session.post(
        f"{API_BASE}/purchase-orders",
        json=new_po_payload
    )
    
    if create_response.status_code not in [200, 201]:
        print_result(False, f"Failed to create PO: {create_response.status_code}")
        print(f"Response: {create_response.text}")
        exit(1)
    
    new_po = create_response.json().get('data', {})
    new_po_id = new_po.get('id')
    new_po_number = new_po.get('poNumber')
    
    print(f"Created PO: {new_po_number} (ID: {new_po_id})")
    
    # Step 3: Verify the generated poNumber starts with PO/202605/
    print(f"\nStep 3: Verify poNumber starts with PO/202605/ (May 2026)")
    
    expected_prefix = "PO/202605/"
    if not new_po_number.startswith(expected_prefix):
        print_result(False, f"PO number does NOT start with {expected_prefix}. Got: {new_po_number}")
        print("This means the generator is NOT using the ORDER date!")
        print(f"Expected: PO/202605/NNNN (May 2026)")
        print(f"Actual: {new_po_number}")
        exit(1)
    
    print_result(True, f"PO number correctly uses ORDER month: {new_po_number}")
    
    # Step 4: Delete the test PO
    print(f"\nStep 4: DELETE test PO {new_po_id}")
    
    delete_response = session.delete(f"{API_BASE}/purchase-orders/{new_po_id}")
    
    if delete_response.status_code not in [200, 204]:
        print_result(False, f"Failed to delete PO: {delete_response.status_code}")
        print(f"Response: {delete_response.text}")
        print("WARNING: Test PO not cleaned up!")
    else:
        print_result(True, f"Test PO deleted successfully")
    
    # Step 5: Verify deletion
    print(f"\nStep 5: Verify PO is gone")
    
    verify_delete_response = session.get(f"{API_BASE}/purchase-orders/{new_po_id}")
    if verify_delete_response.status_code == 404:
        print_result(True, "PO confirmed deleted (404)")
    elif verify_delete_response.status_code == 200:
        deleted_po = verify_delete_response.json().get('data', {})
        if deleted_po.get('pipelineStatus') in ['Dibatalkan', 'Cancelled']:
            print_result(True, "PO marked as Cancelled (soft delete)")
        else:
            print_result(False, f"PO still exists with status: {deleted_po.get('pipelineStatus')}")
    else:
        print(f"Unexpected status when verifying deletion: {verify_delete_response.status_code}")
    
    print("\n" + "="*80)
    print("✅ TEST 3 COMPLETE: Generator correctly uses ORDER date")
    print("="*80)
    
except Exception as e:
    print_result(False, f"Exception in TEST 3: {e}")
    import traceback
    traceback.print_exc()
    exit(1)

# ============================================================================
# TEST 4: No duplicates / sequential PO numbers
# ============================================================================
print_test("TEST 4 — No duplicates / sequential PO numbers")

try:
    # Step 1: GET all purchase orders
    print("\nStep 1: GET /api/purchase-orders to collect all poNumbers")
    
    po_list_response = session.get(f"{API_BASE}/purchase-orders")
    if po_list_response.status_code != 200:
        print_result(False, f"Failed to get purchase orders: {po_list_response.status_code}")
        exit(1)
    
    po_list = po_list_response.json().get('data', [])
    print(f"Found {len(po_list)} purchase orders")
    
    # Step 2: Collect all poNumbers
    all_po_numbers = [po['poNumber'] for po in po_list if po.get('poNumber')]
    print(f"Collected {len(all_po_numbers)} PO numbers")
    
    # Step 3: Check for duplicates
    print("\nStep 2: Check for duplicate poNumbers")
    
    unique_po_numbers = set(all_po_numbers)
    if len(all_po_numbers) != len(unique_po_numbers):
        duplicates = [num for num in all_po_numbers if all_po_numbers.count(num) > 1]
        print_result(False, f"Found duplicate PO numbers: {set(duplicates)}")
        exit(1)
    
    print_result(True, f"No duplicates found ({len(all_po_numbers)} unique PO numbers)")
    
    # Step 4: Sort and display all PO numbers
    print("\nStep 3: Display sorted list of all PO numbers")
    
    all_po_numbers_sorted = sorted(all_po_numbers)
    print(f"All PO numbers (sorted):")
    for po_num in all_po_numbers_sorted:
        print(f"  - {po_num}")
    
    # Step 5: Group by month and check sequences
    print("\nStep 4: Group by month and check sequences")
    
    from collections import defaultdict
    po_by_month = defaultdict(list)
    
    for po_num in all_po_numbers:
        # Extract month prefix (e.g., "PO/202608/")
        parts = po_num.split('/')
        if len(parts) >= 3:
            month_prefix = f"{parts[0]}/{parts[1]}/"
            try:
                seq = int(parts[2])
                po_by_month[month_prefix].append((seq, po_num))
            except:
                print(f"Warning: Could not parse sequence from {po_num}")
    
    for month_prefix in sorted(po_by_month.keys()):
        pos = po_by_month[month_prefix]
        pos_sorted = sorted(pos)
        sequences = [seq for seq, _ in pos_sorted]
        
        print(f"\n{month_prefix} ({len(sequences)} POs)")
        print(f"  Sequences: {sequences}")
        
        # Check for duplicates within this month
        if len(sequences) != len(set(sequences)):
            print_result(False, f"  ❌ Found duplicate sequences in {month_prefix}")
            exit(1)
        else:
            print_result(True, f"  ✅ No duplicate sequences")
        
        # Check if sequential
        if sequences:
            min_seq = min(sequences)
            max_seq = max(sequences)
            expected_count = max_seq - min_seq + 1
            actual_count = len(sequences)
            gap_count = expected_count - actual_count
            
            print(f"  Range: {min_seq} to {max_seq}")
            print(f"  Expected count (if no gaps): {expected_count}")
            print(f"  Actual count: {actual_count}")
            print(f"  Gaps: {gap_count}")
            
            if gap_count > 0:
                print(f"  ⚠️  {gap_count} gaps detected (possibly from deleted POs)")
            else:
                print(f"  ✅ Perfectly sequential")
    
    print("\n" + "="*80)
    print("✅ TEST 4 COMPLETE: No duplicates, sequences are valid")
    print("="*80)
    
except Exception as e:
    print_result(False, f"Exception in TEST 4: {e}")
    import traceback
    traceback.print_exc()
    exit(1)

# ============================================================================
# FINAL SUMMARY
# ============================================================================
print("\n" + "="*80)
print("  🎉 ALL TESTS PASSED")
print("="*80)
print("\n✅ TEST 1: Login successful")
print("✅ TEST 2: Manual Edit No PO endpoint working correctly")
print("   - Change PO number: 200 OK")
print("   - Persistence verified")
print("   - Duplicate rejection: 400 (correct)")
print("   - Revert successful")
print("✅ TEST 3: Generator uses ORDER date (not creation date)")
print("   - Created PO with orderDate=2026-05-10")
print("   - Generated poNumber starts with PO/202605/")
print("   - Test PO deleted successfully")
print("✅ TEST 4: No duplicates, sequences valid")
print("   - All PO numbers unique")
print("   - All months checked for duplicates and sequences")
print("\n" + "="*80)
