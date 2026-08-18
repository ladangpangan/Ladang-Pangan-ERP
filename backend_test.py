#!/usr/bin/env python3
"""
Backend test for Phase 2 CONTACTS MongoDB dual-write migration.
Tests all CRUD operations, filters, archive/restore, role checks, and regression.
"""
import requests
import json
import sys

BASE_URL = "http://localhost:3000/api"
ORIGIN = "http://localhost:3000"

# Track created resources for cleanup
created_contacts = []

def login(email, password):
    """Login and return session object with cookies"""
    session = requests.Session()
    url = f"{BASE_URL}/auth/sign-in/email"
    headers = {"Content-Type": "application/json", "Origin": ORIGIN}
    payload = {"email": email, "password": password}
    resp = session.post(url, json=payload, headers=headers)
    if resp.status_code != 200:
        print(f"❌ Login failed for {email}: {resp.status_code} {resp.text}")
        return None
    return session

def test_get_contacts_list(session):
    """TEST 1: GET /api/contacts → 200, ~102 records with categories as ARRAY"""
    print("\n=== TEST 1: GET /api/contacts (list) ===")
    try:
        resp = session.get(f"{BASE_URL}/contacts")
        if resp.status_code != 200:
            print(f"❌ GET /api/contacts failed: {resp.status_code} {resp.text}")
            return False
        
        data = resp.json().get('data', [])
        count = len(data)
        print(f"✅ GET /api/contacts → 200, {count} records")
        
        # Verify categories is an ARRAY
        if count > 0:
            sample = data[0]
            if 'categories' not in sample:
                print(f"❌ First record missing 'categories' field")
                return False
            if not isinstance(sample['categories'], list):
                print(f"❌ categories is not an ARRAY: {type(sample['categories'])} = {sample['categories']}")
                return False
            print(f"✅ categories is an ARRAY: {sample['categories']}")
        
        # Check count is around 102
        if count < 100 or count > 110:
            print(f"⚠️  Warning: Expected ~102 records, got {count}")
        
        return True
    except Exception as e:
        print(f"❌ Exception in test_get_contacts_list: {e}")
        return False

def test_get_contacts_filter_type(session):
    """TEST 1b: GET /api/contacts?type=Supplier → filtered to suppliers only"""
    print("\n=== TEST 1b: GET /api/contacts?type=Supplier ===")
    try:
        resp = session.get(f"{BASE_URL}/contacts?type=Supplier")
        if resp.status_code != 200:
            print(f"❌ GET /api/contacts?type=Supplier failed: {resp.status_code} {resp.text}")
            return False
        
        data = resp.json().get('data', [])
        print(f"✅ GET /api/contacts?type=Supplier → 200, {len(data)} records")
        
        # Verify all have Supplier in categories
        for item in data[:5]:  # Check first 5
            if 'Supplier' not in item.get('categories', []):
                print(f"❌ Record {item.get('code')} does not have 'Supplier' in categories: {item.get('categories')}")
                return False
        
        print(f"✅ All records have 'Supplier' in categories")
        return True
    except Exception as e:
        print(f"❌ Exception in test_get_contacts_filter_type: {e}")
        return False

def test_get_contacts_search(session):
    """TEST 1c: GET /api/contacts?q=<name/code> → search works"""
    print("\n=== TEST 1c: GET /api/contacts?q=search ===")
    try:
        # First get a contact to search for
        resp = session.get(f"{BASE_URL}/contacts")
        if resp.status_code != 200:
            print(f"❌ Failed to get contacts for search test")
            return False
        
        data = resp.json().get('data', [])
        if len(data) == 0:
            print(f"❌ No contacts to search")
            return False
        
        # Search by code
        search_code = data[0].get('code', '')
        if search_code:
            resp = session.get(f"{BASE_URL}/contacts?q={search_code}")
            if resp.status_code != 200:
                print(f"❌ GET /api/contacts?q={search_code} failed: {resp.status_code}")
                return False
            
            results = resp.json().get('data', [])
            print(f"✅ GET /api/contacts?q={search_code} → 200, {len(results)} results")
            
            # Verify the searched contact is in results
            found = any(c.get('code') == search_code for c in results)
            if not found:
                print(f"❌ Searched contact {search_code} not in results")
                return False
            print(f"✅ Search found the contact")
        
        return True
    except Exception as e:
        print(f"❌ Exception in test_get_contacts_search: {e}")
        return False

def test_get_contacts_archived(session):
    """TEST 1d: GET /api/contacts?archived=1 → only archived"""
    print("\n=== TEST 1d: GET /api/contacts?archived=1 ===")
    try:
        resp = session.get(f"{BASE_URL}/contacts?archived=1")
        if resp.status_code != 200:
            print(f"❌ GET /api/contacts?archived=1 failed: {resp.status_code} {resp.text}")
            return False
        
        data = resp.json().get('data', [])
        print(f"✅ GET /api/contacts?archived=1 → 200, {len(data)} archived records")
        return True
    except Exception as e:
        print(f"❌ Exception in test_get_contacts_archived: {e}")
        return False

def test_next_code(session):
    """TEST 2: GET /api/contacts/next-code?category=Customer → 200 with unique code"""
    print("\n=== TEST 2: GET /api/contacts/next-code?category=Customer ===")
    try:
        resp = session.get(f"{BASE_URL}/contacts/next-code?category=Customer")
        if resp.status_code != 200:
            print(f"❌ GET /api/contacts/next-code failed: {resp.status_code} {resp.text}")
            return False
        
        code = resp.json().get('code', '')
        print(f"✅ GET /api/contacts/next-code?category=Customer → 200, code={code}")
        
        # Verify code format (should be like CUST-0xx)
        if not code.startswith('CUST-'):
            print(f"❌ Code format incorrect: {code}")
            return False
        
        print(f"✅ Code format correct: {code}")
        return True
    except Exception as e:
        print(f"❌ Exception in test_next_code: {e}")
        return False

def test_create_contact(session):
    """TEST 3: POST /api/contacts → 201 with auto-generated code, categories as array, isAgent=true"""
    print("\n=== TEST 3: POST /api/contacts (create) ===")
    try:
        headers = {"Content-Type": "application/json", "Origin": ORIGIN}
        payload = {
            "displayName": "QA Kontak",
            "categories": ["Customer", "Agen"],
            "phone": "0812"
        }
        resp = session.post(f"{BASE_URL}/contacts", json=payload, headers=headers)
        if resp.status_code != 201:
            print(f"❌ POST /api/contacts failed: {resp.status_code} {resp.text}")
            return False, None
        
        contact = resp.json().get('data', {})
        contact_id = contact.get('id')
        code = contact.get('code')
        categories = contact.get('categories')
        is_agent = contact.get('isAgent')
        
        print(f"✅ POST /api/contacts → 201, id={contact_id}, code={code}")
        print(f"   categories={categories}, isAgent={is_agent}")
        
        # Verify categories is an ARRAY
        if not isinstance(categories, list):
            print(f"❌ categories is not an ARRAY: {type(categories)}")
            return False, None
        
        # Verify categories match
        if set(categories) != {"Customer", "Agen"}:
            print(f"❌ categories mismatch: expected ['Customer', 'Agen'], got {categories}")
            return False, None
        
        # Verify isAgent=true
        if not is_agent:
            print(f"❌ isAgent should be true, got {is_agent}")
            return False, None
        
        print(f"✅ categories is ARRAY, isAgent=true")
        
        # Track for cleanup
        created_contacts.append(contact_id)
        
        return True, contact_id
    except Exception as e:
        print(f"❌ Exception in test_create_contact: {e}")
        return False, None

def test_get_contact_by_id(session, contact_id):
    """TEST 3b: GET /api/contacts/:id → 200 matches"""
    print(f"\n=== TEST 3b: GET /api/contacts/{contact_id} ===")
    try:
        resp = session.get(f"{BASE_URL}/contacts/{contact_id}")
        if resp.status_code != 200:
            print(f"❌ GET /api/contacts/{contact_id} failed: {resp.status_code} {resp.text}")
            return False
        
        contact = resp.json().get('data', {})
        print(f"✅ GET /api/contacts/{contact_id} → 200")
        print(f"   displayName={contact.get('displayName')}, categories={contact.get('categories')}")
        
        # Verify data
        if contact.get('displayName') != 'QA Kontak':
            print(f"❌ displayName mismatch")
            return False
        
        return True
    except Exception as e:
        print(f"❌ Exception in test_get_contact_by_id: {e}")
        return False

def test_patch_contact(session, contact_id):
    """TEST 3c: PATCH /api/contacts/:id {phone:"0899"} → 200, phone updated"""
    print(f"\n=== TEST 3c: PATCH /api/contacts/{contact_id} ===")
    try:
        headers = {"Content-Type": "application/json", "Origin": ORIGIN}
        payload = {"phone": "0899"}
        resp = session.patch(f"{BASE_URL}/contacts/{contact_id}", json=payload, headers=headers)
        if resp.status_code != 200:
            print(f"❌ PATCH /api/contacts/{contact_id} failed: {resp.status_code} {resp.text}")
            return False
        
        contact = resp.json().get('data', {})
        phone = contact.get('phone')
        print(f"✅ PATCH /api/contacts/{contact_id} → 200, phone={phone}")
        
        if phone != '0899':
            print(f"❌ phone not updated: expected '0899', got '{phone}'")
            return False
        
        print(f"✅ phone updated successfully")
        return True
    except Exception as e:
        print(f"❌ Exception in test_patch_contact: {e}")
        return False

def test_duplicate_code(session):
    """TEST 4: POST /api/contacts with existing code → 409"""
    print("\n=== TEST 4: POST /api/contacts with duplicate code ===")
    try:
        # First get an existing code
        resp = session.get(f"{BASE_URL}/contacts")
        if resp.status_code != 200:
            print(f"❌ Failed to get contacts")
            return False
        
        data = resp.json().get('data', [])
        if len(data) == 0:
            print(f"❌ No contacts to get existing code")
            return False
        
        existing_code = data[0].get('code')
        print(f"   Using existing code: {existing_code}")
        
        # Try to create with duplicate code
        headers = {"Content-Type": "application/json", "Origin": ORIGIN}
        payload = {
            "displayName": "Duplicate Test",
            "categories": ["Customer"],
            "code": existing_code
        }
        resp = session.post(f"{BASE_URL}/contacts", json=payload, headers=headers)
        
        if resp.status_code != 409:
            print(f"❌ Expected 409, got {resp.status_code}: {resp.text}")
            return False
        
        print(f"✅ POST with duplicate code → 409 (correctly rejected)")
        return True
    except Exception as e:
        print(f"❌ Exception in test_duplicate_code: {e}")
        return False

def test_validation(session):
    """TEST 5: POST /api/contacts without displayName or categories → 400"""
    print("\n=== TEST 5: POST /api/contacts validation ===")
    try:
        headers = {"Content-Type": "application/json", "Origin": ORIGIN}
        
        # Test 5a: No displayName
        payload = {"phone": "123"}
        resp = session.post(f"{BASE_URL}/contacts", json=payload, headers=headers)
        if resp.status_code != 400:
            print(f"❌ Expected 400 for missing displayName, got {resp.status_code}")
            return False
        print(f"✅ POST without displayName → 400")
        
        # Test 5b: No categories
        payload = {"displayName": "Test", "phone": "123"}
        resp = session.post(f"{BASE_URL}/contacts", json=payload, headers=headers)
        if resp.status_code != 400:
            print(f"❌ Expected 400 for missing categories, got {resp.status_code}")
            return False
        print(f"✅ POST without categories → 400")
        
        return True
    except Exception as e:
        print(f"❌ Exception in test_validation: {e}")
        return False

def test_delete_contact(session, contact_id):
    """TEST 6: DELETE /api/contacts/:id → 200, then GET → 404"""
    print(f"\n=== TEST 6: DELETE /api/contacts/{contact_id} ===")
    try:
        headers = {"Origin": ORIGIN}
        resp = session.delete(f"{BASE_URL}/contacts/{contact_id}", headers=headers)
        if resp.status_code != 200:
            print(f"❌ DELETE /api/contacts/{contact_id} failed: {resp.status_code} {resp.text}")
            return False
        
        print(f"✅ DELETE /api/contacts/{contact_id} → 200")
        
        # Verify GET returns 404
        resp = session.get(f"{BASE_URL}/contacts/{contact_id}")
        if resp.status_code != 404:
            print(f"❌ Expected 404 after delete, got {resp.status_code}")
            return False
        
        print(f"✅ GET /api/contacts/{contact_id} → 404 (correctly deleted)")
        
        # Remove from cleanup list
        if contact_id in created_contacts:
            created_contacts.remove(contact_id)
        
        return True
    except Exception as e:
        print(f"❌ Exception in test_delete_contact: {e}")
        return False

def test_archive_restore(session):
    """TEST 7: Archive/restore contact"""
    print("\n=== TEST 7: Archive/restore contact ===")
    try:
        # Create a temp contact for archive test
        headers = {"Content-Type": "application/json", "Origin": ORIGIN}
        payload = {
            "displayName": "Archive Test Contact",
            "categories": ["Customer"],
            "phone": "0888"
        }
        resp = session.post(f"{BASE_URL}/contacts", json=payload, headers=headers)
        if resp.status_code != 201:
            print(f"❌ Failed to create temp contact for archive test")
            return False
        
        contact_id = resp.json().get('data', {}).get('id')
        created_contacts.append(contact_id)
        print(f"   Created temp contact: {contact_id}")
        
        # Archive the contact
        resp = session.post(f"{BASE_URL}/contacts/{contact_id}/archive", headers=headers)
        if resp.status_code != 200:
            print(f"❌ POST /api/contacts/{contact_id}/archive failed: {resp.status_code} {resp.text}")
            return False
        print(f"✅ POST /api/contacts/{contact_id}/archive → 200")
        
        # Verify NOT in default list
        resp = session.get(f"{BASE_URL}/contacts")
        data = resp.json().get('data', [])
        if any(c.get('id') == contact_id for c in data):
            print(f"❌ Archived contact still in default list")
            return False
        print(f"✅ Archived contact NOT in default list")
        
        # Verify IS in archived list
        resp = session.get(f"{BASE_URL}/contacts?archived=1")
        data = resp.json().get('data', [])
        if not any(c.get('id') == contact_id for c in data):
            print(f"❌ Archived contact NOT in archived list")
            return False
        print(f"✅ Archived contact IS in archived list")
        
        # Restore the contact
        resp = session.post(f"{BASE_URL}/contacts/{contact_id}/restore", headers=headers)
        if resp.status_code != 200:
            print(f"❌ POST /api/contacts/{contact_id}/restore failed: {resp.status_code} {resp.text}")
            return False
        print(f"✅ POST /api/contacts/{contact_id}/restore → 200")
        
        # Verify back in default list
        resp = session.get(f"{BASE_URL}/contacts")
        data = resp.json().get('data', [])
        if not any(c.get('id') == contact_id for c in data):
            print(f"❌ Restored contact NOT in default list")
            return False
        print(f"✅ Restored contact back in default list")
        
        # Delete the temp contact
        resp = session.delete(f"{BASE_URL}/contacts/{contact_id}", headers=headers)
        if resp.status_code == 200:
            created_contacts.remove(contact_id)
            print(f"✅ Temp contact deleted")
        
        return True
    except Exception as e:
        print(f"❌ Exception in test_archive_restore: {e}")
        return False

def test_role_checks(operator_session):
    """TEST 8: Role checks - operator should get 403"""
    print("\n=== TEST 8: Role checks (operator) ===")
    try:
        # Test GET /api/contacts as operator
        resp = session.get(f"{BASE_URL}/contacts", cookies=operator_session)
        if resp.status_code != 403:
            print(f"❌ Expected 403 for operator GET /api/contacts, got {resp.status_code}")
            return False
        print(f"✅ Operator GET /api/contacts → 403")
        
        # Test POST /api/contacts as operator
        headers = {"Content-Type": "application/json", "Origin": ORIGIN}
        payload = {"displayName": "Test", "categories": ["Customer"]}
        resp = session.post(f"{BASE_URL}/contacts", json=payload, headers=headers, cookies=operator_session)
        if resp.status_code != 403:
            print(f"❌ Expected 403 for operator POST /api/contacts, got {resp.status_code}")
            return False
        print(f"✅ Operator POST /api/contacts → 403")
        
        return True
    except Exception as e:
        print(f"❌ Exception in test_role_checks: {e}")
        return False

def test_regression(session):
    """TEST 9: Regression - stats, me, products, cold-storages, zones"""
    print("\n=== TEST 9: Regression tests ===")
    try:
        # Test GET /api/stats
        resp = session.get(f"{BASE_URL}/stats")
        if resp.status_code != 200:
            print(f"❌ GET /api/stats failed: {resp.status_code}")
            return False
        
        stats = resp.json()
        contacts_count = stats.get('contacts', 0)
        print(f"✅ GET /api/stats → 200, contacts count={contacts_count}")
        
        if contacts_count < 100 or contacts_count > 110:
            print(f"⚠️  Warning: Expected ~102 contacts, got {contacts_count}")
        
        # Test GET /api/me
        resp = session.get(f"{BASE_URL}/me")
        if resp.status_code != 200:
            print(f"❌ GET /api/me failed: {resp.status_code}")
            return False
        print(f"✅ GET /api/me → 200")
        
        # Test GET /api/products
        resp = session.get(f"{BASE_URL}/products")
        if resp.status_code != 200:
            print(f"❌ GET /api/products failed: {resp.status_code}")
            return False
        products_count = len(resp.json().get('data', []))
        print(f"✅ GET /api/products → 200, {products_count} products")
        
        # Test GET /api/cold-storages
        resp = session.get(f"{BASE_URL}/cold-storages")
        if resp.status_code != 200:
            print(f"❌ GET /api/cold-storages failed: {resp.status_code}")
            return False
        cs_count = len(resp.json().get('data', []))
        print(f"✅ GET /api/cold-storages → 200, {cs_count} cold storages")
        
        # Test GET /api/zones
        resp = session.get(f"{BASE_URL}/zones")
        if resp.status_code != 200:
            print(f"❌ GET /api/zones failed: {resp.status_code}")
            return False
        zones_count = len(resp.json().get('data', []))
        print(f"✅ GET /api/zones → 200, {zones_count} zones")
        
        return True
    except Exception as e:
        print(f"❌ Exception in test_regression: {e}")
        return False

def cleanup(session):
    """Clean up all created contacts"""
    print("\n=== CLEANUP ===")
    headers = {"Origin": ORIGIN}
    for contact_id in created_contacts[:]:
        try:
            resp = session.delete(f"{BASE_URL}/contacts/{contact_id}", headers=headers)
            if resp.status_code == 200:
                print(f"✅ Deleted contact {contact_id}")
                created_contacts.remove(contact_id)
            else:
                print(f"⚠️  Failed to delete contact {contact_id}: {resp.status_code}")
        except Exception as e:
            print(f"⚠️  Exception deleting contact {contact_id}: {e}")
    
    if len(created_contacts) == 0:
        print(f"✅ All temp contacts cleaned up")
    else:
        print(f"⚠️  {len(created_contacts)} contacts not cleaned up: {created_contacts}")

def main():
    print("=" * 80)
    print("BACKEND TEST: Phase 2 CONTACTS MongoDB Dual-Write Migration")
    print("=" * 80)
    
    # Login as admin
    print("\n=== LOGIN AS ADMIN ===")
    admin_session = login("admin@lpi.co.id", "admin123")
    if not admin_session:
        print("❌ Failed to login as admin")
        sys.exit(1)
    print("✅ Logged in as admin")
    
    # Login as operator
    print("\n=== LOGIN AS OPERATOR ===")
    operator_session = login("operator@lpi.co.id", "operator123")
    if not operator_session:
        print("❌ Failed to login as operator")
        sys.exit(1)
    print("✅ Logged in as operator")
    
    results = []
    
    # Run tests
    results.append(("GET /api/contacts (list)", test_get_contacts_list(admin_session)))
    results.append(("GET /api/contacts?type=Supplier", test_get_contacts_filter_type(admin_session)))
    results.append(("GET /api/contacts?q=search", test_get_contacts_search(admin_session)))
    results.append(("GET /api/contacts?archived=1", test_get_contacts_archived(admin_session)))
    results.append(("GET /api/contacts/next-code", test_next_code(admin_session)))
    
    # Create, get, patch contact
    success, contact_id = test_create_contact(admin_session)
    results.append(("POST /api/contacts (create)", success))
    
    if success and contact_id:
        results.append(("GET /api/contacts/:id", test_get_contact_by_id(admin_session, contact_id)))
        results.append(("PATCH /api/contacts/:id", test_patch_contact(admin_session, contact_id)))
    
    results.append(("Duplicate code handling", test_duplicate_code(admin_session)))
    results.append(("Validation (missing fields)", test_validation(admin_session)))
    
    # Delete contact (if created)
    if contact_id:
        results.append(("DELETE /api/contacts/:id", test_delete_contact(admin_session, contact_id)))
    
    results.append(("Archive/restore", test_archive_restore(admin_session)))
    results.append(("Role checks (operator)", test_role_checks(operator_session)))
    results.append(("Regression tests", test_regression(admin_session)))
    
    # Cleanup
    cleanup(admin_session)
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{status}: {test_name}")
    
    print(f"\nTotal: {passed}/{total} tests passed ({passed*100//total}%)")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)
    else:
        print(f"\n❌ {total - passed} test(s) failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
