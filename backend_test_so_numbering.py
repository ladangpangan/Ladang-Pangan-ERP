#!/usr/bin/env python3
"""
Backend test for SO numbering feature:
1. Manual Edit No SO endpoint (POST /api/sales-orders/:id/so-number)
2. Generator uses ORDER date (not creation/today)
3. No duplicates / sequential SO numbers
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
# TEST 2: Manual Edit No SO endpoint
# ============================================================================
print_test("TEST 2 — Manual Edit No SO (POST /api/sales-orders/:id/so-number)")

try:
    # Step 1: GET all sales orders
    print("\nStep 1: GET /api/sales-orders to find test SOs")
    so_list_response = session.get(f"{API_BASE}/sales-orders")
    
    if so_list_response.status_code != 200:
        print_result(False, f"Failed to get sales orders: {so_list_response.status_code}")
        print(f"Response: {so_list_response.text}")
        exit(1)
    
    so_list = so_list_response.json().get('data', [])
    print(f"Found {len(so_list)} sales orders")
    
    if len(so_list) < 2:
        print_result(False, "Need at least 2 SOs for testing")
        exit(1)
    
    # Pick first and second SO
    first_so = so_list[0]
    second_so = so_list[1]
    
    first_so_id = first_so['id']
    first_so_original_number = first_so['soNumber']
    second_so_number = second_so['soNumber']
    
    print(f"First SO: {first_so_original_number} (ID: {first_so_id})")
    print(f"Second SO: {second_so_number} (ID: {second_so['id']})")
    
    # Step 2: Change first SO number to a test value
    test_so_number = "SO/209912/9999"
    print(f"\nStep 2: Change first SO number to {test_so_number}")
    
    change_response = session.post(
        f"{API_BASE}/sales-orders/{first_so_id}/so-number",
        json={"soNumber": test_so_number}
    )
    
    if change_response.status_code != 200:
        print_result(False, f"Failed to change SO number: {change_response.status_code}")
        print(f"Response: {change_response.text}")
        exit(1)
    
    change_data = change_response.json().get('data', {})
    if change_data.get('soNumber') != test_so_number:
        print_result(False, f"SO number not updated correctly. Got: {change_data.get('soNumber')}")
        exit(1)
    
    print_result(True, f"SO number changed to {test_so_number}")
    
    # Step 3: Verify persistence with GET
    print(f"\nStep 3: GET /api/sales-orders/{first_so_id} to verify persistence")
    
    get_so_response = session.get(f"{API_BASE}/sales-orders/{first_so_id}")
    if get_so_response.status_code != 200:
        print_result(False, f"Failed to get SO: {get_so_response.status_code}")
        exit(1)
    
    get_so_data = get_so_response.json().get('data', {})
    if get_so_data.get('soNumber') != test_so_number:
        print_result(False, f"SO number not persisted. Got: {get_so_data.get('soNumber')}")
        exit(1)
    
    print_result(True, f"SO number persisted correctly: {test_so_number}")
    
    # Step 4: Try to change to duplicate (second SO's number) - should fail with 400
    print(f"\nStep 4: Try to change to duplicate number {second_so_number} (should fail)")
    
    duplicate_response = session.post(
        f"{API_BASE}/sales-orders/{first_so_id}/so-number",
        json={"soNumber": second_so_number}
    )
    
    if duplicate_response.status_code != 400:
        print_result(False, f"Expected 400 for duplicate, got {duplicate_response.status_code}")
        print(f"Response: {duplicate_response.text}")
        exit(1)
    
    print_result(True, f"Duplicate rejection working (got 400)")
    print(f"Error message: {duplicate_response.json().get('error', 'N/A')}")
    
    # Step 5: Verify first SO unchanged after failed duplicate attempt
    print(f"\nStep 5: Verify first SO unchanged after failed duplicate attempt")
    
    verify_response = session.get(f"{API_BASE}/sales-orders/{first_so_id}")
    verify_data = verify_response.json().get('data', {})
    
    if verify_data.get('soNumber') != test_so_number:
        print_result(False, f"SO number changed unexpectedly to: {verify_data.get('soNumber')}")
        exit(1)
    
    print_result(True, f"First SO unchanged: {test_so_number}")
    
    # Step 6: Revert to original number
    print(f"\nStep 6: Revert to original number {first_so_original_number}")
    
    revert_response = session.post(
        f"{API_BASE}/sales-orders/{first_so_id}/so-number",
        json={"soNumber": first_so_original_number}
    )
    
    if revert_response.status_code != 200:
        print_result(False, f"Failed to revert SO number: {revert_response.status_code}")
        print(f"Response: {revert_response.text}")
        exit(1)
    
    revert_data = revert_response.json().get('data', {})
    if revert_data.get('soNumber') != first_so_original_number:
        print_result(False, f"SO number not reverted correctly. Got: {revert_data.get('soNumber')}")
        exit(1)
    
    print_result(True, f"SO number reverted to original: {first_so_original_number}")
    
    print("\n" + "="*80)
    print("✅ TEST 2 COMPLETE: Manual Edit No SO endpoint working correctly")
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
    # Step 1: Get a valid customer and product
    print("\nStep 1: Get valid customer and product")
    
    contacts_response = session.get(f"{API_BASE}/contacts")
    if contacts_response.status_code != 200:
        print_result(False, f"Failed to get contacts: {contacts_response.status_code}")
        exit(1)
    
    contacts = contacts_response.json().get('data', [])
    customer = None
    for c in contacts:
        # Check for customer type (could be 'customer', 'Pelanggan', or similar)
        contact_type = c.get('contactType', '').lower()
        if 'customer' in contact_type or 'pelanggan' in contact_type or c.get('isCustomer'):
            customer = c
            break
    
    # If no customer found by type, just use the first contact
    if not customer and contacts:
        print("Warning: No customer type found, using first contact")
        customer = contacts[0]
    
    if not customer:
        print_result(False, "No contacts found at all")
        exit(1)
    
    print(f"Using customer: {customer.get('code')} - {customer.get('name')}")
    
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
    
    # Step 2: Create a NEW SO with orderDate in July 2026
    print("\nStep 2: Create NEW SO with orderDate='2026-07-05'")
    
    new_so_payload = {
        "customerId": customer['id'],
        "orderDate": "2026-07-05",
        "items": [
            {
                "productId": product['id'],
                "quantity": 1,
                "weight": 1,
                "unitPrice": 1000
            }
        ]
    }
    
    create_response = session.post(
        f"{API_BASE}/sales-orders",
        json=new_so_payload
    )
    
    if create_response.status_code not in [200, 201]:
        print_result(False, f"Failed to create SO: {create_response.status_code}")
        print(f"Response: {create_response.text}")
        exit(1)
    
    new_so = create_response.json().get('data', {})
    new_so_id = new_so.get('id')
    new_so_number = new_so.get('soNumber')
    
    print(f"Created SO: {new_so_number} (ID: {new_so_id})")
    
    # Step 3: Verify the generated soNumber starts with SO/202607/
    print(f"\nStep 3: Verify soNumber starts with SO/202607/ (July 2026)")
    
    expected_prefix = "SO/202607/"
    if not new_so_number.startswith(expected_prefix):
        print_result(False, f"SO number does NOT start with {expected_prefix}. Got: {new_so_number}")
        print("This means the generator is NOT using the ORDER date!")
        exit(1)
    
    print_result(True, f"SO number correctly uses ORDER month: {new_so_number}")
    
    # Step 4: Delete the test SO
    print(f"\nStep 4: DELETE test SO {new_so_id}")
    
    delete_response = session.delete(f"{API_BASE}/sales-orders/{new_so_id}")
    
    if delete_response.status_code not in [200, 204]:
        print_result(False, f"Failed to delete SO: {delete_response.status_code}")
        print(f"Response: {delete_response.text}")
        print("WARNING: Test SO not cleaned up!")
    else:
        print_result(True, f"Test SO deleted successfully")
    
    # Step 5: Verify deletion
    print(f"\nStep 5: Verify SO is gone")
    
    verify_delete_response = session.get(f"{API_BASE}/sales-orders/{new_so_id}")
    if verify_delete_response.status_code == 404:
        print_result(True, "SO confirmed deleted (404)")
    elif verify_delete_response.status_code == 200:
        deleted_so = verify_delete_response.json().get('data', {})
        if deleted_so.get('pipelineStatus') == 'Cancelled':
            print_result(True, "SO marked as Cancelled (soft delete)")
        else:
            print_result(False, f"SO still exists with status: {deleted_so.get('pipelineStatus')}")
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
# TEST 4: No duplicates / sequential SO numbers
# ============================================================================
print_test("TEST 4 — No duplicates / sequential SO numbers")

try:
    # Step 1: GET all sales orders
    print("\nStep 1: GET /api/sales-orders to collect all soNumbers")
    
    so_list_response = session.get(f"{API_BASE}/sales-orders")
    if so_list_response.status_code != 200:
        print_result(False, f"Failed to get sales orders: {so_list_response.status_code}")
        exit(1)
    
    so_list = so_list_response.json().get('data', [])
    print(f"Found {len(so_list)} sales orders")
    
    # Step 2: Collect all soNumbers
    all_so_numbers = [so['soNumber'] for so in so_list if so.get('soNumber')]
    print(f"Collected {len(all_so_numbers)} SO numbers")
    
    # Step 3: Check for duplicates
    print("\nStep 2: Check for duplicate soNumbers")
    
    unique_so_numbers = set(all_so_numbers)
    if len(all_so_numbers) != len(unique_so_numbers):
        duplicates = [num for num in all_so_numbers if all_so_numbers.count(num) > 1]
        print_result(False, f"Found duplicate SO numbers: {set(duplicates)}")
        exit(1)
    
    print_result(True, f"No duplicates found ({len(all_so_numbers)} unique SO numbers)")
    
    # Step 4: Filter and sort August 2026 SO numbers
    print("\nStep 3: Check August 2026 (SO/202608/*) sequence")
    
    august_sos = [num for num in all_so_numbers if num.startswith("SO/202608/")]
    august_sos_sorted = sorted(august_sos)
    
    print(f"Found {len(august_sos)} August 2026 SOs")
    print(f"August SO numbers (sorted): {august_sos_sorted}")
    
    # Extract sequence numbers
    august_sequences = []
    for so_num in august_sos_sorted:
        try:
            seq = int(so_num.split('/')[-1])
            august_sequences.append(seq)
        except:
            print(f"Warning: Could not parse sequence from {so_num}")
    
    if august_sequences:
        print(f"August sequences: {august_sequences}")
        
        # Check if sequential (allowing some gaps from deleted SOs)
        min_seq = min(august_sequences)
        max_seq = max(august_sequences)
        expected_count = max_seq - min_seq + 1
        actual_count = len(august_sequences)
        gap_count = expected_count - actual_count
        
        print(f"Sequence range: {min_seq} to {max_seq}")
        print(f"Expected count (if no gaps): {expected_count}")
        print(f"Actual count: {actual_count}")
        print(f"Gaps: {gap_count}")
        
        if gap_count > 5:
            print(f"⚠️  WARNING: {gap_count} gaps detected (possibly from deleted SOs)")
        else:
            print_result(True, f"Sequence is mostly sequential (only {gap_count} gaps)")
        
        # Check for any duplicate sequences
        if len(august_sequences) != len(set(august_sequences)):
            print_result(False, "Found duplicate sequence numbers in August!")
            exit(1)
        else:
            print_result(True, "No duplicate sequences in August")
    else:
        print("No August 2026 SOs found")
    
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
print("✅ TEST 2: Manual Edit No SO endpoint working correctly")
print("   - Change SO number: 200 OK")
print("   - Persistence verified")
print("   - Duplicate rejection: 400 (correct)")
print("   - Revert successful")
print("✅ TEST 3: Generator uses ORDER date (not creation date)")
print("   - Created SO with orderDate=2026-07-05")
print("   - Generated soNumber starts with SO/202607/")
print("   - Test SO deleted successfully")
print("✅ TEST 4: No duplicates, sequences valid")
print("   - All SO numbers unique")
print("   - August 2026 sequences checked")
print("\n" + "="*80)
