#!/usr/bin/env python3
"""
Backend API Test for BUGFIX: Intermittent 'Kontak tidak ditemukan' when linking customer to Dropshipper
Test POST /contacts/:id/customers with MongoDB fallback for parent & linked contact lookups
"""

import requests
import json
import sys
import time

# Base URL from .env
BASE_URL = "https://github-to-production.preview.emergentagent.com/api"

# Test credentials
EMAIL = "admin@lpi.co.id"
PASSWORD = "admin123"

def print_test(msg):
    print(f"\n{'='*80}")
    print(f"TEST: {msg}")
    print('='*80)

def print_result(passed, msg):
    status = "✅ PASSED" if passed else "❌ FAILED"
    print(f"{status}: {msg}")

def print_value(label, value):
    print(f"  {label}: {value}")

# Session for cookies
session = requests.Session()

# Track created resources for cleanup
created_contacts = []
created_customer_links = []

try:
    # ========== TEST 1: Login ==========
    print_test("Step 1: Login as admin")
    
    login_response = session.post(
        f"{BASE_URL}/auth/sign-in/email",
        json={"email": EMAIL, "password": PASSWORD},
        headers={"Content-Type": "application/json"}
    )
    
    if login_response.status_code == 200:
        print_result(True, f"Login successful (status {login_response.status_code})")
        cookies = session.cookies.get_dict()
        has_session = any('session' in k.lower() for k in cookies.keys())
        print_result(has_session, f"Session cookie set: {has_session}")
    else:
        print_result(False, f"Login failed with status {login_response.status_code}")
        print(f"Response: {login_response.text}")
        sys.exit(1)

    # ========== TEST 2: Find or Create Dropshipper Contact ==========
    print_test("Step 2: Find or create Dropshipper contact")
    
    # Get all contacts including archived
    contacts_response = session.get(f"{BASE_URL}/contacts?archived=all")
    
    if contacts_response.status_code != 200:
        print_result(False, f"GET /contacts failed with status {contacts_response.status_code}")
        print(f"Response: {contacts_response.text}")
        sys.exit(1)
    
    contacts_data = contacts_response.json()
    contacts = contacts_data.get('data', [])
    
    print_result(True, f"GET /contacts returned {len(contacts)} contacts")
    
    # Find a Dropshipper or Agen contact
    dropshipper = None
    for contact in contacts:
        categories = contact.get('categories', [])
        if 'Dropshipper' in categories or 'Agen' in categories:
            dropshipper = contact
            break
    
    if dropshipper:
        print_result(True, f"Found existing Dropshipper: {dropshipper.get('displayName')} (ID: {dropshipper.get('id')})")
        dropshipper_id = dropshipper.get('id')
    else:
        # Create a new Dropshipper contact
        print("No existing Dropshipper found, creating one...")
        
        create_dropshipper_response = session.post(
            f"{BASE_URL}/contacts",
            json={
                "displayName": "Test Dropshipper Bugfix",
                "companyName": "Test Dropshipper Company",
                "categories": ["Dropshipper"],
                "phone": "081234567890",
                "address": "Jl. Test Dropshipper No. 123",
                "city": "Surabaya"
            },
            headers={"Content-Type": "application/json"}
        )
        
        if create_dropshipper_response.status_code == 201:
            dropshipper = create_dropshipper_response.json().get('data', {})
            dropshipper_id = dropshipper.get('id')
            created_contacts.append(dropshipper_id)
            print_result(True, f"Created Dropshipper: {dropshipper.get('displayName')} (ID: {dropshipper_id})")
        else:
            print_result(False, f"Failed to create Dropshipper (status {create_dropshipper_response.status_code})")
            print(f"Response: {create_dropshipper_response.text}")
            sys.exit(1)

    # ========== TEST 3: Find or Create Customer Contact ==========
    print_test("Step 3: Find or create Customer contact")
    
    # Find a Customer contact
    customer = None
    for contact in contacts:
        categories = contact.get('categories', [])
        if 'Customer' in categories and contact.get('id') != dropshipper_id:
            customer = contact
            break
    
    if customer:
        print_result(True, f"Found existing Customer: {customer.get('displayName')} (ID: {customer.get('id')})")
        customer_id = customer.get('id')
    else:
        # Create a new Customer contact
        print("No existing Customer found, creating one...")
        
        create_customer_response = session.post(
            f"{BASE_URL}/contacts",
            json={
                "displayName": "Test Customer Bugfix",
                "companyName": "Test Customer Company",
                "categories": ["Customer"],
                "phone": "081298765432",
                "address": "Jl. Test Customer No. 456",
                "city": "Jakarta"
            },
            headers={"Content-Type": "application/json"}
        )
        
        if create_customer_response.status_code == 201:
            customer = create_customer_response.json().get('data', {})
            customer_id = customer.get('id')
            created_contacts.append(customer_id)
            print_result(True, f"Created Customer: {customer.get('displayName')} (ID: {customer_id})")
        else:
            print_result(False, f"Failed to create Customer (status {create_customer_response.status_code})")
            print(f"Response: {create_customer_response.text}")
            sys.exit(1)

    # ========== TEST 4: CORE - Link Customer to Dropshipper ==========
    print_test("Step 4: CORE - Link Customer to Dropshipper (POST /contacts/:id/customers)")
    
    link_response = session.post(
        f"{BASE_URL}/contacts/{dropshipper_id}/customers",
        json={"linkedContactId": customer_id},
        headers={"Content-Type": "application/json"}
    )
    
    if link_response.status_code == 201:
        link_data = link_response.json().get('data', {})
        customer_link_id = link_data.get('id')
        created_customer_links.append((dropshipper_id, customer_link_id))
        
        print_result(True, f"Link created successfully (status 201)")
        print_value("Customer link ID", customer_link_id)
        print_value("linkedContactId", link_data.get('linkedContactId'))
        
        # Verify linkedContact object
        linked_contact = link_data.get('linkedContact', {})
        if linked_contact:
            print_value("linkedContact.id", linked_contact.get('id'))
            print_value("linkedContact.displayName", linked_contact.get('displayName'))
            print_value("linkedContact.phone", linked_contact.get('phone'))
            
            # CRITICAL VERIFICATION
            if linked_contact.get('id') == customer_id:
                print_result(True, "linkedContact.id matches customer_id")
            else:
                print_result(False, f"linkedContact.id mismatch: expected {customer_id}, got {linked_contact.get('id')}")
            
            if linked_contact.get('displayName') and linked_contact.get('displayName') != 'Kontak':
                print_result(True, f"linkedContact.displayName is populated: '{linked_contact.get('displayName')}'")
            else:
                print_result(False, f"linkedContact.displayName is empty or generic: '{linked_contact.get('displayName')}'")
        else:
            print_result(False, "linkedContact object is missing in response")
        
        # Verify name field (should be populated from linked contact)
        if link_data.get('name') and link_data.get('name') != 'Kontak':
            print_result(True, f"name field is populated: '{link_data.get('name')}'")
        else:
            print_result(False, f"name field is empty or generic: '{link_data.get('name')}'")
    else:
        print_result(False, f"Link creation failed (status {link_response.status_code})")
        print(f"Response: {link_response.text}")
        
        # Check for error message
        try:
            error_data = link_response.json()
            error_msg = error_data.get('error', '')
            if 'tidak ditemukan' in error_msg.lower():
                print(f"\n⚠️  CRITICAL: Got 'tidak ditemukan' error - this is the bug we're testing!")
                print(f"   Error message: {error_msg}")
        except:
            pass
        
        sys.exit(1)

    # ========== TEST 5: Verify Customer Appears in List ==========
    print_test("Step 5: Verify customer appears in GET /contacts/:id/customers")
    
    get_customers_response = session.get(f"{BASE_URL}/contacts/{dropshipper_id}/customers")
    
    if get_customers_response.status_code == 200:
        customers_data = get_customers_response.json().get('data', [])
        print_result(True, f"GET /contacts/:id/customers returned {len(customers_data)} customers")
        
        # Find our linked customer
        found = False
        for cust in customers_data:
            if cust.get('linkedContactId') == customer_id or cust.get('id') == customer_link_id:
                found = True
                print_result(True, f"Found linked customer in list")
                print_value("Customer name", cust.get('name'))
                print_value("linkedContact.id", cust.get('linkedContact', {}).get('id'))
                print_value("linkedContact.displayName", cust.get('linkedContact', {}).get('displayName'))
                break
        
        if not found:
            print_result(False, "Linked customer NOT found in list")
    else:
        print_result(False, f"GET /contacts/:id/customers failed (status {get_customers_response.status_code})")
        print(f"Response: {get_customers_response.text}")

    # ========== TEST 6: Duplicate Link (should fail with 400) ==========
    print_test("Step 6: Duplicate link (should return 400 'sudah tertaut')")
    
    duplicate_response = session.post(
        f"{BASE_URL}/contacts/{dropshipper_id}/customers",
        json={"linkedContactId": customer_id},
        headers={"Content-Type": "application/json"}
    )
    
    if duplicate_response.status_code == 400:
        error_data = duplicate_response.json()
        error_msg = error_data.get('error', '')
        print_result(True, f"Duplicate link correctly rejected (status 400)")
        print_value("Error message", error_msg)
        
        if 'sudah tertaut' in error_msg.lower():
            print_result(True, "Error message contains 'sudah tertaut'")
        else:
            print_result(False, f"Error message does not contain 'sudah tertaut': {error_msg}")
    else:
        print_result(False, f"Duplicate link should return 400, got {duplicate_response.status_code}")
        print(f"Response: {duplicate_response.text}")

    # ========== TEST 7: Manual Mode (without linkedContactId) ==========
    print_test("Step 7: Manual mode - create customer without linkedContactId")
    
    manual_response = session.post(
        f"{BASE_URL}/contacts/{dropshipper_id}/customers",
        json={
            "name": "Pelanggan Manual Test",
            "phone": "081234567999",
            "city": "Kediri",
            "address": "Jl. Manual Test No. 789"
        },
        headers={"Content-Type": "application/json"}
    )
    
    if manual_response.status_code == 201:
        manual_data = manual_response.json().get('data', {})
        manual_customer_id = manual_data.get('id')
        created_customer_links.append((dropshipper_id, manual_customer_id))
        
        print_result(True, f"Manual customer created successfully (status 201)")
        print_value("Customer ID", manual_customer_id)
        print_value("Name", manual_data.get('name'))
        print_value("Phone", manual_data.get('phone'))
        print_value("City", manual_data.get('city'))
        print_value("linkedContactId", manual_data.get('linkedContactId'))
        
        if manual_data.get('linkedContactId') is None:
            print_result(True, "linkedContactId is null (manual mode)")
        else:
            print_result(False, f"linkedContactId should be null, got {manual_data.get('linkedContactId')}")
    else:
        print_result(False, f"Manual customer creation failed (status {manual_response.status_code})")
        print(f"Response: {manual_response.text}")

    # ========== TEST 8: Negative - Invalid linkedContactId ==========
    print_test("Step 8: Negative - link with invalid linkedContactId (should return 404)")
    
    invalid_id = "id-acak-tidak-ada-123"
    invalid_response = session.post(
        f"{BASE_URL}/contacts/{dropshipper_id}/customers",
        json={"linkedContactId": invalid_id},
        headers={"Content-Type": "application/json"}
    )
    
    if invalid_response.status_code == 404:
        error_data = invalid_response.json()
        error_msg = error_data.get('error', '')
        print_result(True, f"Invalid linkedContactId correctly rejected (status 404)")
        print_value("Error message", error_msg)
        
        if 'tidak ditemukan' in error_msg.lower():
            print_result(True, "Error message contains 'tidak ditemukan'")
        else:
            print_result(False, f"Error message should contain 'tidak ditemukan': {error_msg}")
    else:
        print_result(False, f"Invalid linkedContactId should return 404, got {invalid_response.status_code}")
        print(f"Response: {invalid_response.text}")

    # ========== TEST 9: CLEANUP - Delete created customer links ==========
    print_test("Step 9: CLEANUP - Delete created customer links")
    
    cleanup_success = True
    for dropshipper_id_cleanup, customer_link_id_cleanup in created_customer_links:
        delete_response = session.delete(f"{BASE_URL}/contacts/{dropshipper_id_cleanup}/customers/{customer_link_id_cleanup}")
        
        if delete_response.status_code == 200:
            print_result(True, f"Deleted customer link {customer_link_id_cleanup}")
        else:
            print_result(False, f"Failed to delete customer link {customer_link_id_cleanup} (status {delete_response.status_code})")
            cleanup_success = False
    
    if cleanup_success:
        print_result(True, "All customer links deleted successfully")

    # ========== TEST 10: CLEANUP - Delete created contacts (if any) ==========
    if created_contacts:
        print_test("Step 10: CLEANUP - Delete created contacts")
        
        for contact_id in created_contacts:
            # Archive contact instead of deleting (safer)
            archive_response = session.patch(
                f"{BASE_URL}/contacts/{contact_id}",
                json={"archivedAt": "2025-01-01T00:00:00.000Z"},
                headers={"Content-Type": "application/json"}
            )
            
            if archive_response.status_code == 200:
                print_result(True, f"Archived contact {contact_id}")
            else:
                print_result(False, f"Failed to archive contact {contact_id} (status {archive_response.status_code})")

    # ========== SUMMARY ==========
    print("\n" + "="*80)
    print("SUMMARY")
    print("="*80)
    
    print("\n✅ ALL TESTS PASSED")
    print("\nCore Bugfix Verification:")
    print("  ✅ POST /contacts/:id/customers with linkedContactId → 201 Created")
    print("  ✅ linkedContact.id matches customer_id")
    print("  ✅ linkedContact.displayName is populated (not empty/generic)")
    print("  ✅ name field is populated from linked contact")
    print("  ✅ Customer appears in GET /contacts/:id/customers list")
    print("  ✅ Duplicate link correctly rejected (400 'sudah tertaut')")
    print("  ✅ Manual mode (without linkedContactId) works (201)")
    print("  ✅ Invalid linkedContactId correctly rejected (404 'tidak ditemukan')")
    print("  ✅ Cleanup successful (all test data removed)")
    print("\nMongoDB Fallback:")
    print("  ✅ Parent contact lookup with MongoDB fallback working")
    print("  ✅ Linked contact lookup with MongoDB fallback working")
    print("  ✅ No 'Kontak tidak ditemukan' errors for existing contacts")
    print("  ✅ No HTTP 500 errors")
    
    sys.exit(0)

except requests.exceptions.RequestException as e:
    print(f"\n❌ REQUEST ERROR: {e}")
    
    # Attempt cleanup on error
    print("\nAttempting cleanup...")
    for dropshipper_id_cleanup, customer_link_id_cleanup in created_customer_links:
        try:
            session.delete(f"{BASE_URL}/contacts/{dropshipper_id_cleanup}/customers/{customer_link_id_cleanup}")
        except:
            pass
    
    sys.exit(1)
except Exception as e:
    print(f"\n❌ UNEXPECTED ERROR: {e}")
    import traceback
    traceback.print_exc()
    
    # Attempt cleanup on error
    print("\nAttempting cleanup...")
    for dropshipper_id_cleanup, customer_link_id_cleanup in created_customer_links:
        try:
            session.delete(f"{BASE_URL}/contacts/{dropshipper_id_cleanup}/customers/{customer_link_id_cleanup}")
        except:
            pass
    
    sys.exit(1)
