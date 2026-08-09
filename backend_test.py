#!/usr/bin/env python3
"""
Backend test for soft-archive (Arsip) feature across 8 modules in LPI ERP.
Tests archive/restore endpoints, ?archived filter, RBAC, and guards.
"""

import requests
import json
import sys
from typing import Dict, Optional, List

BASE_URL = "http://localhost:3000/api"

# Test credentials
CREDENTIALS = {
    "admin": {"email": "admin@lpi.co.id", "password": "admin123"},
    "supervisor": {"email": "supervisor@lpi.co.id", "password": "super123"},
    "direktur": {"email": "direktur@lpi.co.id", "password": "direktur123"},
    "operator": {"email": "operator@lpi.co.id", "password": "operator123"},
}

# Resources to test with their list endpoints
RESOURCES = {
    "contacts": {"list": "/contacts", "create": "/contacts"},
    "products": {"list": "/products", "create": "/products"},
    "cold-storages": {"list": "/cold-storages", "create": "/cold-storages"},
    "purchase-orders": {"list": "/purchase-orders", "create": "/purchase-orders"},
    "sales-orders": {"list": "/sales-orders", "create": "/sales-orders"},
    "work-orders": {"list": "/work-orders", "create": "/work-orders"},
    "inventory-stocks": {"list": "/inventory/stocks", "create": None},  # Special case
    "users": {"list": "/users", "create": "/users"},
}


def login(role: str) -> Optional[requests.Session]:
    """Login and return session with cookies."""
    session = requests.Session()
    creds = CREDENTIALS[role]
    
    try:
        resp = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": creds["email"], "password": creds["password"]},
            timeout=10
        )
        
        if resp.status_code == 200:
            print(f"✓ Logged in as {role} ({creds['email']})")
            return session
        else:
            print(f"✗ Login failed for {role}: {resp.status_code} {resp.text[:200]}")
            return None
    except Exception as e:
        print(f"✗ Login exception for {role}: {e}")
        return None


def get_me(session: requests.Session) -> Optional[Dict]:
    """Get current user info."""
    try:
        resp = session.get(f"{BASE_URL}/me", timeout=10)
        if resp.status_code == 200:
            return resp.json()
        return None
    except Exception as e:
        print(f"✗ Get me exception: {e}")
        return None


def create_test_entity(session: requests.Session, resource: str) -> Optional[str]:
    """Create a test entity for the given resource and return its ID."""
    try:
        if resource == "contacts":
            payload = {
                "displayName": f"Test Contact Archive {resource}",
                "categories": ["Customer"],
                "code": f"TST-ARC-{resource[:3].upper()}",
            }
            resp = session.post(f"{BASE_URL}/contacts", json=payload, timeout=10)
            
        elif resource == "products":
            payload = {
                "sku": f"TST-ARC-{resource[:3].upper()}",
                "name": f"Test Product Archive",
                "category": "Karkas",
                "unit": "kg",
                "basePrice": 10000,
            }
            resp = session.post(f"{BASE_URL}/products", json=payload, timeout=10)
            
        elif resource == "cold-storages":
            payload = {
                "name": f"Test Cold Storage Archive",
                "code": f"TST-CS-ARC",
                "location": "Test Location",
            }
            resp = session.post(f"{BASE_URL}/cold-storages", json=payload, timeout=10)
            
        elif resource == "users":
            payload = {
                "email": f"test-archive-{resource}@lpi.co.id",
                "name": f"Test User Archive",
                "password": "test123",
                "role": "operator",
            }
            resp = session.post(f"{BASE_URL}/users", json=payload, timeout=10)
            
        else:
            # For PO, SO, WO - we'll use existing entities
            return None
        
        if resp.status_code in [200, 201]:
            data = resp.json()
            entity_id = data.get("data", {}).get("id") or data.get("id")
            if entity_id:
                print(f"  ✓ Created test {resource} entity: {entity_id}")
                return entity_id
            else:
                print(f"  ✗ No ID in response for {resource}: {data}")
                return None
        else:
            print(f"  ✗ Failed to create {resource}: {resp.status_code} {resp.text[:200]}")
            return None
            
    except Exception as e:
        print(f"  ✗ Exception creating {resource}: {e}")
        return None


def test_resource_archive_restore(session: requests.Session, resource: str, entity_id: str) -> bool:
    """
    Test archive/restore cycle for a resource.
    Returns True if all tests pass.
    """
    print(f"\n{'='*80}")
    print(f"Testing {resource.upper()} - Archive/Restore Cycle")
    print(f"{'='*80}")
    
    list_endpoint = RESOURCES[resource]["list"]
    
    try:
        # Step 1: Get initial list count (default = active only)
        resp = session.get(f"{BASE_URL}{list_endpoint}", timeout=10)
        if resp.status_code != 200:
            print(f"✗ Failed to get initial list: {resp.status_code}")
            return False
        
        initial_data = resp.json().get("data", [])
        initial_count = len(initial_data)
        print(f"✓ Initial active count: {initial_count}")
        
        # Verify entity is in active list
        entity_in_active = any(item.get("id") == entity_id for item in initial_data)
        if not entity_in_active:
            print(f"✗ Entity {entity_id} not found in initial active list")
            return False
        print(f"✓ Entity {entity_id} present in active list")
        
        # Step 2: Archive the entity
        archive_url = f"{BASE_URL}/{resource}/{entity_id}/archive"
        resp = session.post(archive_url, timeout=10)
        
        if resp.status_code != 200:
            print(f"✗ Archive failed: {resp.status_code} {resp.text[:200]}")
            return False
        
        archive_result = resp.json()
        if not (archive_result.get("ok") and archive_result.get("archived") == True):
            print(f"✗ Archive response incorrect: {archive_result}")
            return False
        print(f"✓ Archive successful: {archive_result}")
        
        # Step 3: Verify entity ABSENT from default list (active only)
        resp = session.get(f"{BASE_URL}{list_endpoint}", timeout=10)
        if resp.status_code != 200:
            print(f"✗ Failed to get list after archive: {resp.status_code}")
            return False
        
        active_data = resp.json().get("data", [])
        active_count = len(active_data)
        
        if active_count != initial_count - 1:
            print(f"✗ Active count mismatch: expected {initial_count - 1}, got {active_count}")
            return False
        
        entity_in_active = any(item.get("id") == entity_id for item in active_data)
        if entity_in_active:
            print(f"✗ Entity {entity_id} still in active list after archive")
            return False
        print(f"✓ Entity ABSENT from active list (count: {active_count})")
        
        # Step 4: Verify entity PRESENT in archived list (?archived=1)
        resp = session.get(f"{BASE_URL}{list_endpoint}?archived=1", timeout=10)
        if resp.status_code != 200:
            print(f"✗ Failed to get archived list: {resp.status_code}")
            return False
        
        archived_data = resp.json().get("data", [])
        entity_in_archived = any(item.get("id") == entity_id for item in archived_data)
        
        if not entity_in_archived:
            print(f"✗ Entity {entity_id} NOT in archived list")
            return False
        print(f"✓ Entity PRESENT in archived list (?archived=1)")
        
        # Step 5: Verify entity PRESENT in all list (?archived=all)
        resp = session.get(f"{BASE_URL}{list_endpoint}?archived=all", timeout=10)
        if resp.status_code != 200:
            print(f"✗ Failed to get all list: {resp.status_code}")
            return False
        
        all_data = resp.json().get("data", [])
        all_count = len(all_data)
        entity_in_all = any(item.get("id") == entity_id for item in all_data)
        
        if not entity_in_all:
            print(f"✗ Entity {entity_id} NOT in all list")
            return False
        
        if all_count < initial_count:
            print(f"✗ All count ({all_count}) less than initial ({initial_count})")
            return False
        print(f"✓ Entity PRESENT in all list (?archived=all, count: {all_count})")
        
        # Step 6: Restore the entity
        restore_url = f"{BASE_URL}/{resource}/{entity_id}/restore"
        resp = session.post(restore_url, timeout=10)
        
        if resp.status_code != 200:
            print(f"✗ Restore failed: {resp.status_code} {resp.text[:200]}")
            return False
        
        restore_result = resp.json()
        if not (restore_result.get("ok") and restore_result.get("archived") == False):
            print(f"✗ Restore response incorrect: {restore_result}")
            return False
        print(f"✓ Restore successful: {restore_result}")
        
        # Step 7: Verify entity PRESENT in active list again
        resp = session.get(f"{BASE_URL}{list_endpoint}", timeout=10)
        if resp.status_code != 200:
            print(f"✗ Failed to get list after restore: {resp.status_code}")
            return False
        
        final_data = resp.json().get("data", [])
        final_count = len(final_data)
        entity_in_final = any(item.get("id") == entity_id for item in final_data)
        
        if not entity_in_final:
            print(f"✗ Entity {entity_id} NOT in active list after restore")
            return False
        
        if final_count != initial_count:
            print(f"✗ Final count ({final_count}) != initial count ({initial_count})")
            return False
        print(f"✓ Entity PRESENT in active list after restore (count: {final_count})")
        
        print(f"\n✅ {resource.upper()} - ALL TESTS PASSED")
        return True
        
    except Exception as e:
        print(f"✗ Exception during {resource} test: {e}")
        return False


def test_rbac(admin_session: requests.Session, operator_session: requests.Session, 
              direktur_session: requests.Session, supervisor_session: requests.Session) -> bool:
    """Test RBAC for archive endpoints."""
    print(f"\n{'='*80}")
    print(f"Testing RBAC - Archive Permissions")
    print(f"{'='*80}")
    
    all_passed = True
    
    # Get a contact ID for testing
    resp = admin_session.get(f"{BASE_URL}/contacts", timeout=10)
    if resp.status_code != 200:
        print("✗ Failed to get contacts for RBAC test")
        return False
    
    contacts = resp.json().get("data", [])
    if not contacts:
        print("✗ No contacts available for RBAC test")
        return False
    
    contact_id = contacts[0]["id"]
    print(f"Using contact ID: {contact_id}")
    
    # Test 1: Operator cannot archive contacts (403)
    print("\nTest 1: Operator POST /contacts/:id/archive → expect 403")
    resp = operator_session.post(f"{BASE_URL}/contacts/{contact_id}/archive", timeout=10)
    if resp.status_code == 403:
        print("✓ Operator correctly denied (403)")
    else:
        print(f"✗ Expected 403, got {resp.status_code}")
        all_passed = False
    
    # Test 2: Direktur cannot archive contacts (403)
    print("\nTest 2: Direktur POST /contacts/:id/archive → expect 403")
    resp = direktur_session.post(f"{BASE_URL}/contacts/{contact_id}/archive", timeout=10)
    if resp.status_code == 403:
        print("✓ Direktur correctly denied (403)")
    else:
        print(f"✗ Expected 403, got {resp.status_code}")
        all_passed = False
    
    # Test 3: Supervisor CAN archive contacts (200)
    # Get a different contact or create one
    resp = admin_session.get(f"{BASE_URL}/contacts", timeout=10)
    contacts = resp.json().get("data", [])
    if len(contacts) > 1:
        test_contact_id = contacts[1]["id"]
    else:
        # Create a new contact
        payload = {
            "displayName": "RBAC Test Contact",
            "categories": ["Customer"],
            "code": "RBAC-TST-001",
        }
        resp = admin_session.post(f"{BASE_URL}/contacts", json=payload, timeout=10)
        if resp.status_code in [200, 201]:
            test_contact_id = resp.json().get("data", {}).get("id")
        else:
            print("✗ Failed to create test contact for RBAC")
            return False
    
    print(f"\nTest 3: Supervisor POST /contacts/{test_contact_id}/archive → expect 200")
    resp = supervisor_session.post(f"{BASE_URL}/contacts/{test_contact_id}/archive", timeout=10)
    if resp.status_code == 200:
        result = resp.json()
        if result.get("ok") and result.get("archived") == True:
            print(f"✓ Supervisor can archive contacts: {result}")
            # Restore it
            supervisor_session.post(f"{BASE_URL}/contacts/{test_contact_id}/restore", timeout=10)
        else:
            print(f"✗ Unexpected response: {result}")
            all_passed = False
    else:
        print(f"✗ Expected 200, got {resp.status_code}")
        all_passed = False
    
    # Test 4: For users resource - operator cannot archive (403)
    resp = admin_session.get(f"{BASE_URL}/users", timeout=10)
    if resp.status_code == 403:
        # Admin might not have access to users list, try supervisor
        resp = supervisor_session.get(f"{BASE_URL}/users", timeout=10)
    
    if resp.status_code == 200:
        users = resp.json().get("data", [])
        if users:
            # Find a non-admin user
            test_user = None
            for u in users:
                if u.get("role") == "operator":
                    test_user = u
                    break
            
            if test_user:
                user_id = test_user["id"]
                print(f"\nTest 4: Operator POST /users/{user_id}/archive → expect 403")
                resp = operator_session.post(f"{BASE_URL}/users/{user_id}/archive", timeout=10)
                if resp.status_code == 403:
                    print("✓ Operator correctly denied for users (403)")
                else:
                    print(f"✗ Expected 403, got {resp.status_code}")
                    all_passed = False
                
                # Test 5: Supervisor CAN archive users (200)
                print(f"\nTest 5: Supervisor POST /users/{user_id}/archive → expect 200")
                resp = supervisor_session.post(f"{BASE_URL}/users/{user_id}/archive", timeout=10)
                if resp.status_code == 200:
                    result = resp.json()
                    if result.get("ok") and result.get("archived") == True:
                        print(f"✓ Supervisor can archive users: {result}")
                        # Restore it
                        supervisor_session.post(f"{BASE_URL}/users/{user_id}/restore", timeout=10)
                    else:
                        print(f"✗ Unexpected response: {result}")
                        all_passed = False
                else:
                    print(f"✗ Expected 200, got {resp.status_code}")
                    all_passed = False
    
    if all_passed:
        print(f"\n✅ RBAC - ALL TESTS PASSED")
    else:
        print(f"\n❌ RBAC - SOME TESTS FAILED")
    
    return all_passed


def test_guards(admin_session: requests.Session) -> bool:
    """Test guard conditions (cannot archive own account, non-existent id)."""
    print(f"\n{'='*80}")
    print(f"Testing GUARDS - Own Account & Non-existent ID")
    print(f"{'='*80}")
    
    all_passed = True
    
    # Test 1: Cannot archive own user account (400)
    me = get_me(admin_session)
    if not me:
        print("✗ Failed to get current user info")
        return False
    
    my_id = me.get("id")
    print(f"\nTest 1: Archive own account (user ID: {my_id}) → expect 400")
    resp = admin_session.post(f"{BASE_URL}/users/{my_id}/archive", timeout=10)
    
    if resp.status_code == 400:
        error_msg = resp.json().get("error", "")
        if "sendiri" in error_msg.lower() or "own" in error_msg.lower():
            print(f"✓ Cannot archive own account (400): {error_msg}")
        else:
            print(f"✓ Got 400 but unexpected message: {error_msg}")
    else:
        print(f"✗ Expected 400, got {resp.status_code}")
        all_passed = False
    
    # Test 2: Non-existent ID returns 404
    fake_id = "nonexistent-id-12345"
    print(f"\nTest 2: Archive non-existent contact → expect 404")
    resp = admin_session.post(f"{BASE_URL}/contacts/{fake_id}/archive", timeout=10)
    
    if resp.status_code == 404:
        error_msg = resp.json().get("error", "")
        print(f"✓ Non-existent ID returns 404: {error_msg}")
    else:
        print(f"✗ Expected 404, got {resp.status_code}")
        all_passed = False
    
    if all_passed:
        print(f"\n✅ GUARDS - ALL TESTS PASSED")
    else:
        print(f"\n❌ GUARDS - SOME TESTS FAILED")
    
    return all_passed


def test_regression(admin_session: requests.Session) -> bool:
    """Test that existing filters still work with archive filter."""
    print(f"\n{'='*80}")
    print(f"Testing REGRESSION - Existing Filters + Archive")
    print(f"{'='*80}")
    
    all_passed = True
    
    # Test 1: Contacts with ?type filter + archive default
    print("\nTest 1: GET /contacts?type=Customer (default active only)")
    resp = admin_session.get(f"{BASE_URL}/contacts?type=Customer", timeout=10)
    if resp.status_code == 200:
        data = resp.json().get("data", [])
        print(f"✓ Got {len(data)} Customer contacts (active only)")
        # Verify all are customers
        all_customers = all("Customer" in item.get("categories", []) for item in data)
        if all_customers:
            print("✓ All results have Customer category")
        else:
            print("✗ Some results don't have Customer category")
            all_passed = False
    else:
        print(f"✗ Failed: {resp.status_code}")
        all_passed = False
    
    # Test 2: Products with ?category filter + archive default
    print("\nTest 2: GET /products?category=Karkas (default active only)")
    resp = admin_session.get(f"{BASE_URL}/products?category=Karkas", timeout=10)
    if resp.status_code == 200:
        data = resp.json().get("data", [])
        print(f"✓ Got {len(data)} Karkas products (active only)")
        # Verify all are Karkas
        all_karkas = all(item.get("category") == "Karkas" for item in data)
        if all_karkas:
            print("✓ All results have Karkas category")
        else:
            print("✗ Some results don't have Karkas category")
            all_passed = False
    else:
        print(f"✗ Failed: {resp.status_code}")
        all_passed = False
    
    # Test 3: Sales orders with ?status filter + archive default
    print("\nTest 3: GET /sales-orders?status=Draft (default active only)")
    resp = admin_session.get(f"{BASE_URL}/sales-orders?status=Draft", timeout=10)
    if resp.status_code == 200:
        data = resp.json().get("data", [])
        print(f"✓ Got {len(data)} Draft sales orders (active only)")
        # Verify all are Draft
        all_draft = all(item.get("pipelineStatus") == "Draft" for item in data)
        if all_draft:
            print("✓ All results have Draft status")
        else:
            print("✗ Some results don't have Draft status")
            all_passed = False
    else:
        print(f"✗ Failed: {resp.status_code}")
        all_passed = False
    
    # Test 4: Contacts with ?q search + archive default
    print("\nTest 4: GET /contacts?q=Test (default active only)")
    resp = admin_session.get(f"{BASE_URL}/contacts?q=Test", timeout=10)
    if resp.status_code == 200:
        data = resp.json().get("data", [])
        print(f"✓ Got {len(data)} contacts matching 'Test' (active only)")
    else:
        print(f"✗ Failed: {resp.status_code}")
        all_passed = False
    
    if all_passed:
        print(f"\n✅ REGRESSION - ALL TESTS PASSED")
    else:
        print(f"\n❌ REGRESSION - SOME TESTS FAILED")
    
    return all_passed


def main():
    """Main test runner."""
    print("="*80)
    print("LPI ERP - Soft-Archive (Arsip) Feature Backend Tests")
    print("="*80)
    
    # Login all users
    print("\n" + "="*80)
    print("AUTHENTICATION")
    print("="*80)
    
    admin_session = login("admin")
    supervisor_session = login("supervisor")
    direktur_session = login("direktur")
    operator_session = login("operator")
    
    if not all([admin_session, supervisor_session, direktur_session, operator_session]):
        print("\n❌ FAILED: Could not authenticate all users")
        sys.exit(1)
    
    # Get admin user info
    me = get_me(admin_session)
    if me:
        print(f"✓ Admin user: {me.get('name')} ({me.get('email')}) - Role: {me.get('role')}")
    
    # Track results
    results = {}
    
    # Test 1: Core archive/restore for each resource
    print("\n" + "="*80)
    print("CORE TESTS - Archive/Restore Cycle per Resource")
    print("="*80)
    
    # Test resources that we can create entities for
    testable_resources = ["contacts", "products", "cold-storages", "users"]
    
    for resource in testable_resources:
        # Create test entity
        entity_id = create_test_entity(admin_session, resource)
        
        if entity_id:
            # Test archive/restore cycle
            results[resource] = test_resource_archive_restore(admin_session, resource, entity_id)
        else:
            print(f"\n✗ Skipping {resource} - could not create test entity")
            results[resource] = False
    
    # For PO, SO, WO, inventory - test with existing entities
    print("\n" + "="*80)
    print("Testing existing entities (PO, SO, WO, Inventory)")
    print("="*80)
    
    for resource in ["purchase-orders", "sales-orders", "work-orders"]:
        list_endpoint = RESOURCES[resource]["list"]
        resp = admin_session.get(f"{BASE_URL}{list_endpoint}", timeout=10)
        
        if resp.status_code == 200:
            data = resp.json().get("data", [])
            if data:
                entity_id = data[0]["id"]
                print(f"\nUsing existing {resource} entity: {entity_id}")
                results[resource] = test_resource_archive_restore(admin_session, resource, entity_id)
            else:
                print(f"\n⚠ No existing {resource} entities to test")
                results[resource] = None
        else:
            print(f"\n✗ Failed to get {resource} list: {resp.status_code}")
            results[resource] = False
    
    # Special case: inventory-stocks
    resp = admin_session.get(f"{BASE_URL}/inventory/stocks", timeout=10)
    if resp.status_code == 200:
        data = resp.json().get("data", [])
        if data:
            entity_id = data[0]["id"]
            print(f"\nUsing existing inventory-stocks entity: {entity_id}")
            results["inventory-stocks"] = test_resource_archive_restore(admin_session, "inventory-stocks", entity_id)
        else:
            print(f"\n⚠ No existing inventory-stocks entities to test")
            results["inventory-stocks"] = None
    else:
        print(f"\n✗ Failed to get inventory/stocks list: {resp.status_code}")
        results["inventory-stocks"] = False
    
    # Test 2: RBAC
    results["rbac"] = test_rbac(admin_session, operator_session, direktur_session, supervisor_session)
    
    # Test 3: Guards
    results["guards"] = test_guards(admin_session)
    
    # Test 4: Regression
    results["regression"] = test_regression(admin_session)
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = 0
    failed = 0
    skipped = 0
    
    for test_name, result in results.items():
        if result is True:
            print(f"✅ {test_name.upper()}: PASSED")
            passed += 1
        elif result is False:
            print(f"❌ {test_name.upper()}: FAILED")
            failed += 1
        else:
            print(f"⚠️  {test_name.upper()}: SKIPPED (no data)")
            skipped += 1
    
    print(f"\n{'='*80}")
    print(f"Total: {passed} passed, {failed} failed, {skipped} skipped")
    print(f"{'='*80}")
    
    if failed > 0:
        print("\n❌ SOME TESTS FAILED")
        sys.exit(1)
    else:
        print("\n✅ ALL TESTS PASSED")
        sys.exit(0)


if __name__ == "__main__":
    main()
