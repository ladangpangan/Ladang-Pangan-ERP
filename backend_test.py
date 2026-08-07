#!/usr/bin/env python3
"""
Backend API Test for End-Customer Link Feature (linkedContactId)
Tests the NEW feature: link end-customer to existing Customer contact via linkedContactId (reference, NOT a copy)
"""

import requests
import json
import sys
from datetime import datetime

BASE_URL = "http://localhost:3000/api"

# Test credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
OPERATOR_EMAIL = "operator@lpi.co.id"
OPERATOR_PASSWORD = "operator123"
DIREKTUR_EMAIL = "direktur@lpi.co.id"
DIREKTUR_PASSWORD = "direktur123"

session = requests.Session()

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def login(email, password):
    """Login and return cookies dict"""
    log(f"Logging in as {email}...")
    resp = requests.post(
        "http://localhost:3000/api/auth/sign-in/email",
        json={"email": email, "password": password},
        headers={"Content-Type": "application/json"}
    )
    if resp.status_code != 200:
        log(f"❌ Login failed: {resp.status_code} - {resp.text}")
        return None
    
    # Extract cookies as dict
    cookies = {cookie.name: cookie.value for cookie in resp.cookies}
    
    log(f"✅ Login successful as {email}")
    return cookies

def test_setup():
    """Setup: Create parent contact P and Customer contact C"""
    """Setup: Create parent contact P and Customer contact C"""
    log("\n=== SETUP: Creating test data ===")
    
    cookies = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not cookies:
        return None, None, None
    
    # Create parent contact P (Agen type)
    log("Creating parent contact P (Agen)...")
    parent_data = {
        "contactType": "Agen",
        "code": f"PARENT-{datetime.now().strftime('%H%M%S')}",
        "displayName": "Parent Agen",
        "agentDiscountPct": 5,
        "phone": "0811111111",
        "address": "Jl Parent 1",
        "city": "Jakarta"
    }
    resp = requests.post(f"{BASE_URL}/contacts", json=parent_data, cookies=cookies)
    if resp.status_code != 201:
        log(f"❌ Failed to create parent contact: {resp.status_code} - {resp.text}")
        return None, None, cookies
    parent = resp.json()["data"]
    log(f"✅ Parent contact created: {parent['id']} ({parent['code']})")
    
    # Create Customer contact C
    log("Creating Customer contact C...")
    customer_data = {
        "contactType": "Customer",
        "code": f"CUST-{datetime.now().strftime('%H%M%S')}",
        "displayName": "PT Cust Link",
        "phone": "0811111",
        "address": "Jl Live 1",
        "city": "Jakarta",
        "picName": "Budi"
    }
    resp = requests.post(f"{BASE_URL}/contacts", json=customer_data, cookies=cookies)
    if resp.status_code != 201:
        log(f"❌ Failed to create customer contact: {resp.status_code} - {resp.text}")
        return parent, None, cookies
    customer = resp.json()["data"]
    log(f"✅ Customer contact created: {customer['id']} ({customer['code']})")
    
    return parent, customer, cookies

def test_a_link_happy_path(parent_id, customer_id, cookies):
    """Test A: Link (happy path)"""
    log("\n=== TEST A: Link (happy path) ===")
    
    log(f"Linking customer {customer_id} to parent {parent_id}...")
    resp = requests.post(
        f"{BASE_URL}/contacts/{parent_id}/customers",
        json={"linkedContactId": customer_id}, cookies=cookies)
    
    if resp.status_code != 201:
        log(f"❌ FAIL: Expected 201, got {resp.status_code} - {resp.text}")
        return None
    
    data = resp.json()["data"]
    
    # Verify linkedContactId
    if data.get("linkedContactId") != customer_id:
        log(f"❌ FAIL: linkedContactId mismatch. Expected {customer_id}, got {data.get('linkedContactId')}")
        return None
    
    # Verify linkedContact object
    if "linkedContact" not in data:
        log(f"❌ FAIL: linkedContact object missing in response")
        return None
    
    linked = data["linkedContact"]
    if not all(k in linked for k in ["id", "code", "displayName", "phone"]):
        log(f"❌ FAIL: linkedContact missing required fields. Got: {linked.keys()}")
        return None
    
    log(f"✅ PASS: Link created successfully")
    log(f"   - linkedContactId: {data['linkedContactId']}")
    log(f"   - linkedContact.code: {linked['code']}")
    log(f"   - linkedContact.displayName: {linked['displayName']}")
    log(f"   - linkedContact.phone: {linked['phone']}")
    
    return data["id"]  # Return the linked row ID

def test_b_get_enrichment_live(parent_id, customer_id, cookies):
    """Test B: GET enrichment (LIVE, not copy)"""
    log("\n=== TEST B: GET enrichment (LIVE, not copy) ===")
    
    # Step 1: GET linked customers
    log(f"Step 1: GET /contacts/{parent_id}/customers...")
    resp = requests.get(f"{BASE_URL}/contacts/{parent_id}/customers", cookies=cookies)
    
    if resp.status_code != 200:
        log(f"❌ FAIL: Expected 200, got {resp.status_code} - {resp.text}")
        return False
    
    data = resp.json()["data"]
    if not data:
        log(f"❌ FAIL: No linked customers found")
        return False
    
    linked_row = None
    for row in data:
        if row.get("linkedContactId") == customer_id:
            linked_row = row
            break
    
    if not linked_row:
        log(f"❌ FAIL: Linked customer not found in response")
        return False
    
    # Verify initial values
    initial_phone = linked_row.get("phone")
    initial_name = linked_row.get("name")
    log(f"✅ Initial values: name='{initial_name}', phone='{initial_phone}'")
    
    if initial_phone != "0811111":
        log(f"⚠️  WARNING: Expected phone '0811111', got '{initial_phone}'")
    
    # Step 2: Update the Customer contact C
    log(f"\nStep 2: PATCH Customer contact {customer_id}...")
    update_data = {
        "phone": "0899999",
        "displayName": "PT Cust Link Updated"
    }
    resp = requests.patch(f"{BASE_URL}/contacts/{customer_id}", json=update_data, cookies=cookies)
    
    if resp.status_code != 200:
        log(f"❌ FAIL: Failed to update customer: {resp.status_code} - {resp.text}")
        return False
    
    log(f"✅ Customer updated: phone='0899999', displayName='PT Cust Link Updated'")
    
    # Step 3: GET linked customers again to verify LIVE reference
    log(f"\nStep 3: GET /contacts/{parent_id}/customers again (verify LIVE data)...")
    resp = requests.get(f"{BASE_URL}/contacts/{parent_id}/customers", cookies=cookies)
    
    if resp.status_code != 200:
        log(f"❌ FAIL: Expected 200, got {resp.status_code} - {resp.text}")
        return False
    
    data = resp.json()["data"]
    linked_row = None
    for row in data:
        if row.get("linkedContactId") == customer_id:
            linked_row = row
            break
    
    if not linked_row:
        log(f"❌ FAIL: Linked customer not found in response")
        return False
    
    # Verify updated values (LIVE reference)
    updated_phone = linked_row.get("phone")
    updated_name = linked_row.get("name")
    
    log(f"Updated values: name='{updated_name}', phone='{updated_phone}'")
    
    if updated_phone != "0899999":
        log(f"❌ FAIL: Phone not updated. Expected '0899999', got '{updated_phone}'")
        log(f"   This proves it's NOT a live reference (it's a static copy)")
        return False
    
    if updated_name != "PT Cust Link Updated":
        log(f"❌ FAIL: Name not updated. Expected 'PT Cust Link Updated', got '{updated_name}'")
        log(f"   This proves it's NOT a live reference (it's a static copy)")
        return False
    
    log(f"✅ PASS: LIVE reference verified!")
    log(f"   - Phone changed from '{initial_phone}' to '{updated_phone}' ✓")
    log(f"   - Name changed from '{initial_name}' to '{updated_name}' ✓")
    log(f"   - This proves the data is fetched LIVE from the linked contact, not a static copy")
    
    return True

def test_c_duplicate_link_rejected(parent_id, customer_id, cookies):
    """Test C: Duplicate link rejected"""
    log("\n=== TEST C: Duplicate link rejected ===")
    
    log(f"Attempting to link customer {customer_id} to parent {parent_id} again...")
    resp = requests.post(
        f"{BASE_URL}/contacts/{parent_id}/customers",
        json={"linkedContactId": customer_id}, cookies=cookies)
    
    if resp.status_code != 400:
        log(f"❌ FAIL: Expected 400, got {resp.status_code}")
        return False
    
    error_msg = resp.json().get("error", "")
    if "sudah tertaut" not in error_msg.lower():
        log(f"❌ FAIL: Error message doesn't contain 'sudah tertaut'. Got: {error_msg}")
        return False
    
    log(f"✅ PASS: Duplicate link rejected with 400")
    log(f"   - Error message: {error_msg}")
    
    return True

def test_d_self_link_rejected(parent_id, cookies):
    """Test D: Self-link rejected"""
    log("\n=== TEST D: Self-link rejected ===")
    
    log(f"Attempting to link parent {parent_id} to itself...")
    resp = requests.post(
        f"{BASE_URL}/contacts/{parent_id}/customers",
        json={"linkedContactId": parent_id}, cookies=cookies)
    
    if resp.status_code != 400:
        log(f"❌ FAIL: Expected 400, got {resp.status_code}")
        return False
    
    error_msg = resp.json().get("error", "")
    log(f"✅ PASS: Self-link rejected with 400")
    log(f"   - Error message: {error_msg}")
    
    return True

def test_e_non_existent_linked_contact(parent_id, cookies):
    """Test E: Non-existent linked contact"""
    log("\n=== TEST E: Non-existent linked contact ===")
    
    fake_id = "non-existent-uuid-12345"
    log(f"Attempting to link non-existent contact {fake_id}...")
    resp = requests.post(
        f"{BASE_URL}/contacts/{parent_id}/customers",
        json={"linkedContactId": fake_id}, cookies=cookies)
    
    if resp.status_code != 404:
        log(f"❌ FAIL: Expected 404, got {resp.status_code}")
        return False
    
    error_msg = resp.json().get("error", "")
    log(f"✅ PASS: Non-existent contact rejected with 404")
    log(f"   - Error message: {error_msg}")
    
    return True

def test_f_legacy_manual_create(parent_id, cookies):
    """Test F: Legacy manual create still works"""
    log("\n=== TEST F: Legacy manual create still works ===")
    
    log(f"Creating manual end-customer (legacy path)...")
    manual_data = {
        "name": "Manual Cust",
        "phone": "0822"
    }
    resp = requests.post(
        f"{BASE_URL}/contacts/{parent_id}/customers",
        json=manual_data, cookies=cookies)
    
    if resp.status_code != 201:
        log(f"❌ FAIL: Expected 201, got {resp.status_code} - {resp.text}")
        return False
    
    data = resp.json()["data"]
    
    if data.get("linkedContactId") is not None:
        log(f"❌ FAIL: linkedContactId should be null for manual create. Got: {data.get('linkedContactId')}")
        return False
    
    if data.get("name") != "Manual Cust":
        log(f"❌ FAIL: Name mismatch. Expected 'Manual Cust', got '{data.get('name')}'")
        return False
    
    log(f"✅ PASS: Legacy manual create works")
    log(f"   - linkedContactId: null ✓")
    log(f"   - name: {data['name']} ✓")
    log(f"   - phone: {data['phone']} ✓")
    
    return True

def test_g_rbac(parent_id, customer_id):
    """Test G: RBAC"""
    log("\n=== TEST G: RBAC ===")
    
    # Test G.1: operator POST -> 403
    log("\nG.1: Operator POST /contacts/:id/customers -> 403")
    operator_cookies = login(OPERATOR_EMAIL, OPERATOR_PASSWORD)
    if not operator_cookies:
        log(f"❌ FAIL: Could not login as operator")
        return False
    
    resp = requests.post(
        f"{BASE_URL}/contacts/{parent_id}/customers",
        json={"linkedContactId": customer_id},
        cookies=operator_cookies
    )
    
    if resp.status_code != 403:
        log(f"❌ FAIL: Expected 403, got {resp.status_code}")
        return False
    
    log(f"✅ PASS: Operator POST rejected with 403")
    
    # Test G.2: direktur GET -> 200
    log("\nG.2: Direktur GET /contacts/:id/customers -> 200")
    direktur_cookies = login(DIREKTUR_EMAIL, DIREKTUR_PASSWORD)
    if not direktur_cookies:
        log(f"❌ FAIL: Could not login as direktur")
        return False
    
    resp = requests.get(f"{BASE_URL}/contacts/{parent_id}/customers", cookies=direktur_cookies)
    
    if resp.status_code != 200:
        log(f"❌ FAIL: Expected 200, got {resp.status_code}")
        return False
    
    log(f"✅ PASS: Direktur GET allowed with 200")
    
    # Test G.3: direktur POST -> 403
    log("\nG.3: Direktur POST /contacts/:id/customers -> 403")
    resp = requests.post(
        f"{BASE_URL}/contacts/{parent_id}/customers",
        json={"name": "Test", "phone": "123"},
        cookies=direktur_cookies
    )
    
    if resp.status_code != 403:
        log(f"❌ FAIL: Expected 403, got {resp.status_code}")
        return False
    
    log(f"✅ PASS: Direktur POST rejected with 403")
    
    return True

def test_h_delete_link(parent_id, customer_id, cookies):
    """Test H: Delete link"""
    log("\n=== TEST H: Delete link ===")
    
    # First, get the linked row ID
    log(f"Getting linked row ID...")
    resp = requests.get(f"{BASE_URL}/contacts/{parent_id}/customers", cookies=cookies)
    
    if resp.status_code != 200:
        log(f"❌ FAIL: Could not get customers: {resp.status_code}")
        return False
    
    data = resp.json()["data"]
    linked_row = None
    for row in data:
        if row.get("linkedContactId") == customer_id:
            linked_row = row
            break
    
    if not linked_row:
        log(f"❌ FAIL: Could not find linked row")
        return False
    
    linked_row_id = linked_row["id"]
    log(f"Found linked row ID: {linked_row_id}")
    
    # Delete the link
    log(f"Deleting link...")
    resp = requests.delete(
        f"{BASE_URL}/contacts/{parent_id}/customers/{linked_row_id}", cookies=cookies)
    
    if resp.status_code != 200:
        log(f"❌ FAIL: Expected 200, got {resp.status_code} - {resp.text}")
        return False
    
    log(f"✅ Link deleted successfully")
    
    # Verify the underlying Customer contact C still exists
    log(f"Verifying Customer contact {customer_id} still exists...")
    resp = requests.get(f"{BASE_URL}/contacts/{customer_id}", cookies=cookies)
    
    if resp.status_code != 200:
        log(f"❌ FAIL: Customer contact was deleted! Expected 200, got {resp.status_code}")
        log(f"   The underlying contact should NOT be deleted when the link is removed")
        return False
    
    contact = resp.json()["data"]
    log(f"✅ PASS: Customer contact still exists")
    log(f"   - ID: {contact['id']}")
    log(f"   - Code: {contact['code']}")
    log(f"   - DisplayName: {contact['displayName']}")
    log(f"   - Link removed, but contact NOT deleted ✓")
    
    return True

def main():
    log("=" * 80)
    log("BACKEND TEST: End-Customer Link Feature (linkedContactId)")
    log("=" * 80)
    
    # Setup
    parent, customer, cookies = test_setup()
    if not parent or not customer or not cookies:
        log("\n❌ SETUP FAILED - Cannot continue tests")
        sys.exit(1)
    
    parent_id = parent["id"]
    customer_id = customer["id"]
    
    # Run tests
    results = {}
    
    # Test A: Link (happy path)
    linked_row_id = test_a_link_happy_path(parent_id, customer_id, cookies=cookies)
    results["A_link_happy_path"] = linked_row_id is not None
    
    # Test B: GET enrichment (LIVE, not copy)
    results["B_get_enrichment_live"] = test_b_get_enrichment_live(parent_id, customer_id, cookies=cookies)
    
    # Test C: Duplicate link rejected
    results["C_duplicate_link_rejected"] = test_c_duplicate_link_rejected(parent_id, customer_id, cookies=cookies)
    
    # Test D: Self-link rejected
    results["D_self_link_rejected"] = test_d_self_link_rejected(parent_id, cookies=cookies)
    
    # Test E: Non-existent linked contact
    results["E_non_existent_linked_contact"] = test_e_non_existent_linked_contact(parent_id, cookies=cookies)
    
    # Test F: Legacy manual create still works
    results["F_legacy_manual_create"] = test_f_legacy_manual_create(parent_id, cookies=cookies)
    
    # Test G: RBAC
    results["G_rbac"] = test_g_rbac(parent_id, customer_id)
    
    # Test H: Delete link
    results["H_delete_link"] = test_h_delete_link(parent_id, customer_id, cookies=cookies)
    
    # Summary
    log("\n" + "=" * 80)
    log("TEST SUMMARY")
    log("=" * 80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        log(f"{status}: {test_name}")
    
    log("\n" + "=" * 80)
    log(f"TOTAL: {passed}/{total} tests passed ({passed*100//total}%)")
    log("=" * 80)
    
    if passed == total:
        log("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)
    else:
        log(f"\n⚠️  {total - passed} test(s) failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
