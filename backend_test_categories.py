#!/usr/bin/env python3
"""
Backend API Test for Multi-Category Contacts Feature
Tests the NEW feature: contacts can belong to MULTIPLE categories via a `categories` JSON array
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

def test_1_multi_category_create():
    """TEST 1 — Multi-category create (Customer + Supplier)"""
    log("\n" + "="*80)
    log("TEST 1 — Multi-category create (Customer + Supplier)")
    log("="*80)
    
    cookies = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not cookies:
        log("❌ TEST 1 FAILED: Login failed")
        return False
    
    # Create contact with multiple categories
    log("Creating contact with categories=['Customer','Supplier']...")
    contact_data = {
        "categories": ["Customer", "Supplier"],
        "code": f"MC-DUAL1-{datetime.now().strftime('%H%M%S')}",
        "displayName": "Dual CS",
        "creditLimit": 1000000
    }
    
    try:
        resp = requests.post(f"{BASE_URL}/contacts", json=contact_data, cookies=cookies)
        log(f"Response status: {resp.status_code}")
        
        if resp.status_code != 201:
            log(f"❌ TEST 1 FAILED: Expected 201, got {resp.status_code}")
            log(f"Response: {resp.text}")
            return False
        
        data = resp.json()["data"]
        log(f"✅ Contact created: {data['id']} ({data['code']})")
        
        # Verify categories array
        if not isinstance(data.get("categories"), list):
            log(f"❌ TEST 1 FAILED: categories is not an array: {data.get('categories')}")
            return False
        
        if data["categories"] != ["Customer", "Supplier"]:
            log(f"❌ TEST 1 FAILED: categories mismatch. Expected ['Customer','Supplier'], got {data['categories']}")
            return False
        log(f"✅ categories == {data['categories']}")
        
        # Verify contactType (should be first category)
        if data.get("contactType") != "Customer":
            log(f"❌ TEST 1 FAILED: contactType should be 'Customer', got {data.get('contactType')}")
            return False
        log(f"✅ contactType == 'Customer' (first category)")
        
        # Verify derived flags
        if data.get("isAgent") != False and data.get("isAgent") != 0:
            log(f"❌ TEST 1 FAILED: isAgent should be false, got {data.get('isAgent')}")
            return False
        log(f"✅ isAgent == false")
        
        if data.get("isDropshipper") != False and data.get("isDropshipper") != 0:
            log(f"❌ TEST 1 FAILED: isDropshipper should be false, got {data.get('isDropshipper')}")
            return False
        log(f"✅ isDropshipper == false")
        
        log("✅ TEST 1 PASSED: Multi-category create (Customer + Supplier)")
        return data
        
    except Exception as e:
        log(f"❌ TEST 1 FAILED: Exception - {str(e)}")
        return False

def test_2_membership_filter(contact_code):
    """TEST 2 — Membership filter"""
    log("\n" + "="*80)
    log("TEST 2 — Membership filter")
    log("="*80)
    
    cookies = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not cookies:
        log("❌ TEST 2 FAILED: Login failed")
        return False
    
    try:
        # Test 2a: GET ?type=Supplier should include MC-DUAL1
        log("Testing GET /api/contacts?type=Supplier...")
        resp = requests.get(f"{BASE_URL}/contacts?type=Supplier", cookies=cookies)
        if resp.status_code != 200:
            log(f"❌ TEST 2a FAILED: Expected 200, got {resp.status_code}")
            return False
        
        data = resp.json()["data"]
        found = any(c["code"] == contact_code for c in data)
        if not found:
            log(f"❌ TEST 2a FAILED: MC-DUAL1 not found in Supplier filter")
            log(f"Contacts found: {[c['code'] for c in data]}")
            return False
        log(f"✅ MC-DUAL1 found in Supplier filter (multi-category membership works)")
        
        # Test 2b: GET ?type=Customer should also include MC-DUAL1
        log("Testing GET /api/contacts?type=Customer...")
        resp = requests.get(f"{BASE_URL}/contacts?type=Customer", cookies=cookies)
        if resp.status_code != 200:
            log(f"❌ TEST 2b FAILED: Expected 200, got {resp.status_code}")
            return False
        
        data = resp.json()["data"]
        found = any(c["code"] == contact_code for c in data)
        if not found:
            log(f"❌ TEST 2b FAILED: MC-DUAL1 not found in Customer filter")
            return False
        log(f"✅ MC-DUAL1 found in Customer filter")
        
        # Test 2c: GET ?type=RPH should NOT include MC-DUAL1
        log("Testing GET /api/contacts?type=RPH...")
        resp = requests.get(f"{BASE_URL}/contacts?type=RPH", cookies=cookies)
        if resp.status_code != 200:
            log(f"❌ TEST 2c FAILED: Expected 200, got {resp.status_code}")
            return False
        
        data = resp.json()["data"]
        found = any(c["code"] == contact_code for c in data)
        if found:
            log(f"❌ TEST 2c FAILED: MC-DUAL1 should NOT be in RPH filter")
            return False
        log(f"✅ MC-DUAL1 NOT found in RPH filter (correct)")
        
        log("✅ TEST 2 PASSED: Membership filter")
        return True
        
    except Exception as e:
        log(f"❌ TEST 2 FAILED: Exception - {str(e)}")
        return False

def test_3_agen_dropshipper_create():
    """TEST 3 — Agen + Dropshipper create with role fields"""
    log("\n" + "="*80)
    log("TEST 3 — Agen + Dropshipper create with role fields")
    log("="*80)
    
    cookies = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not cookies:
        log("❌ TEST 3 FAILED: Login failed")
        return False
    
    try:
        log("Creating contact with categories=['Agen','Dropshipper']...")
        contact_data = {
            "categories": ["Agen", "Dropshipper"],
            "code": f"MC-AD1-{datetime.now().strftime('%H%M%S')}",
            "displayName": "Agen Drop 1",
            "agentDiscountPct": 7,
            "commissionType": "per_kg",
            "commissionValue": 200
        }
        
        resp = requests.post(f"{BASE_URL}/contacts", json=contact_data, cookies=cookies)
        log(f"Response status: {resp.status_code}")
        
        if resp.status_code != 201:
            log(f"❌ TEST 3 FAILED: Expected 201, got {resp.status_code}")
            log(f"Response: {resp.text}")
            return False
        
        data = resp.json()["data"]
        log(f"✅ Contact created: {data['id']} ({data['code']})")
        
        # Verify categories
        if data["categories"] != ["Agen", "Dropshipper"]:
            log(f"❌ TEST 3 FAILED: categories mismatch. Expected ['Agen','Dropshipper'], got {data['categories']}")
            return False
        log(f"✅ categories == ['Agen','Dropshipper']")
        
        # Verify contactType
        if data.get("contactType") != "Agen":
            log(f"❌ TEST 3 FAILED: contactType should be 'Agen', got {data.get('contactType')}")
            return False
        log(f"✅ contactType == 'Agen'")
        
        # Verify isAgent
        if not data.get("isAgent"):
            log(f"❌ TEST 3 FAILED: isAgent should be true, got {data.get('isAgent')}")
            return False
        log(f"✅ isAgent == true")
        
        # Verify isDropshipper
        if not data.get("isDropshipper"):
            log(f"❌ TEST 3 FAILED: isDropshipper should be true, got {data.get('isDropshipper')}")
            return False
        log(f"✅ isDropshipper == true")
        
        # Verify role fields
        if data.get("agentDiscountPct") != 7:
            log(f"❌ TEST 3 FAILED: agentDiscountPct should be 7, got {data.get('agentDiscountPct')}")
            return False
        log(f"✅ agentDiscountPct == 7")
        
        if data.get("commissionType") != "per_kg":
            log(f"❌ TEST 3 FAILED: commissionType should be 'per_kg', got {data.get('commissionType')}")
            return False
        log(f"✅ commissionType == 'per_kg'")
        
        if data.get("commissionValue") != 200:
            log(f"❌ TEST 3 FAILED: commissionValue should be 200, got {data.get('commissionValue')}")
            return False
        log(f"✅ commissionValue == 200")
        
        # Test membership in both filters
        log("Testing GET /api/contacts?type=Dropshipper...")
        resp = requests.get(f"{BASE_URL}/contacts?type=Dropshipper", cookies=cookies)
        if resp.status_code != 200:
            log(f"❌ TEST 3 FAILED: GET Dropshipper filter failed")
            return False
        
        data_list = resp.json()["data"]
        found = any(c["code"] == data["code"] for c in data_list)
        if not found:
            log(f"❌ TEST 3 FAILED: MC-AD1 not found in Dropshipper filter")
            return False
        log(f"✅ MC-AD1 found in Dropshipper filter")
        
        log("Testing GET /api/contacts?type=Agen...")
        resp = requests.get(f"{BASE_URL}/contacts?type=Agen", cookies=cookies)
        if resp.status_code != 200:
            log(f"❌ TEST 3 FAILED: GET Agen filter failed")
            return False
        
        data_list = resp.json()["data"]
        found = any(c["code"] == data["code"] for c in data_list)
        if not found:
            log(f"❌ TEST 3 FAILED: MC-AD1 not found in Agen filter")
            return False
        log(f"✅ MC-AD1 found in Agen filter")
        
        log("✅ TEST 3 PASSED: Agen + Dropshipper create with role fields")
        return data
        
    except Exception as e:
        log(f"❌ TEST 3 FAILED: Exception - {str(e)}")
        return False

def test_4_patch_categories_change(contact_id, contact_code):
    """TEST 4 — PATCH categories change updates derived + filters"""
    log("\n" + "="*80)
    log("TEST 4 — PATCH categories change updates derived + filters")
    log("="*80)
    
    cookies = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not cookies:
        log("❌ TEST 4 FAILED: Login failed")
        return False
    
    try:
        # PATCH to change categories from ['Customer','Supplier'] to ['Customer','Agen']
        log(f"PATCH /api/contacts/{contact_id} to change categories to ['Customer','Agen']...")
        patch_data = {
            "categories": ["Customer", "Agen"]
        }
        
        resp = requests.patch(f"{BASE_URL}/contacts/{contact_id}", json=patch_data, cookies=cookies)
        log(f"Response status: {resp.status_code}")
        
        if resp.status_code != 200:
            log(f"❌ TEST 4 FAILED: Expected 200, got {resp.status_code}")
            log(f"Response: {resp.text}")
            return False
        
        data = resp.json()["data"]
        
        # Verify categories updated
        if data["categories"] != ["Customer", "Agen"]:
            log(f"❌ TEST 4 FAILED: categories not updated. Expected ['Customer','Agen'], got {data['categories']}")
            return False
        log(f"✅ categories == ['Customer','Agen']")
        
        # Verify contactType still Customer (first category)
        if data.get("contactType") != "Customer":
            log(f"❌ TEST 4 FAILED: contactType should be 'Customer', got {data.get('contactType')}")
            return False
        log(f"✅ contactType == 'Customer'")
        
        # Verify isAgent now true
        if not data.get("isAgent"):
            log(f"❌ TEST 4 FAILED: isAgent should be true after adding Agen, got {data.get('isAgent')}")
            return False
        log(f"✅ isAgent == true")
        
        # Verify isDropshipper now false
        if data.get("isDropshipper") != False and data.get("isDropshipper") != 0:
            log(f"❌ TEST 4 FAILED: isDropshipper should be false, got {data.get('isDropshipper')}")
            return False
        log(f"✅ isDropshipper == false")
        
        # Test filter: should NOT be in Supplier anymore
        log("Testing GET /api/contacts?type=Supplier (should NOT include MC-DUAL1)...")
        resp = requests.get(f"{BASE_URL}/contacts?type=Supplier", cookies=cookies)
        if resp.status_code != 200:
            log(f"❌ TEST 4 FAILED: GET Supplier filter failed")
            return False
        
        data_list = resp.json()["data"]
        found = any(c["code"] == contact_code for c in data_list)
        if found:
            log(f"❌ TEST 4 FAILED: MC-DUAL1 should NOT be in Supplier filter after PATCH")
            return False
        log(f"✅ MC-DUAL1 NOT in Supplier filter (correct)")
        
        # Test filter: should NOW be in Agen
        log("Testing GET /api/contacts?type=Agen (should include MC-DUAL1)...")
        resp = requests.get(f"{BASE_URL}/contacts?type=Agen", cookies=cookies)
        if resp.status_code != 200:
            log(f"❌ TEST 4 FAILED: GET Agen filter failed")
            return False
        
        data_list = resp.json()["data"]
        found = any(c["code"] == contact_code for c in data_list)
        if not found:
            log(f"❌ TEST 4 FAILED: MC-DUAL1 should be in Agen filter after PATCH")
            return False
        log(f"✅ MC-DUAL1 found in Agen filter")
        
        log("✅ TEST 4 PASSED: PATCH categories change updates derived + filters")
        return True
        
    except Exception as e:
        log(f"❌ TEST 4 FAILED: Exception - {str(e)}")
        return False

def test_5_legacy_create():
    """TEST 5 — Legacy create (contactType only, no categories)"""
    log("\n" + "="*80)
    log("TEST 5 — Legacy create (contactType only, no categories)")
    log("="*80)
    
    cookies = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not cookies:
        log("❌ TEST 5 FAILED: Login failed")
        return False
    
    try:
        log("Creating contact with contactType='RPH' (no categories field)...")
        contact_data = {
            "contactType": "RPH",
            "code": f"MC-LEG1-{datetime.now().strftime('%H%M%S')}",
            "displayName": "Legacy RPH"
        }
        
        resp = requests.post(f"{BASE_URL}/contacts", json=contact_data, cookies=cookies)
        log(f"Response status: {resp.status_code}")
        
        if resp.status_code != 201:
            log(f"❌ TEST 5 FAILED: Expected 201, got {resp.status_code}")
            log(f"Response: {resp.text}")
            return False
        
        data = resp.json()["data"]
        log(f"✅ Contact created: {data['id']} ({data['code']})")
        
        # Verify categories array created from contactType
        if data["categories"] != ["RPH"]:
            log(f"❌ TEST 5 FAILED: categories should be ['RPH'], got {data['categories']}")
            return False
        log(f"✅ categories == ['RPH'] (auto-created from contactType)")
        
        # Verify contactType
        if data.get("contactType") != "RPH":
            log(f"❌ TEST 5 FAILED: contactType should be 'RPH', got {data.get('contactType')}")
            return False
        log(f"✅ contactType == 'RPH'")
        
        log("✅ TEST 5 PASSED: Legacy create (contactType only)")
        return True
        
    except Exception as e:
        log(f"❌ TEST 5 FAILED: Exception - {str(e)}")
        return False

def test_6_validation():
    """TEST 6 — Validation"""
    log("\n" + "="*80)
    log("TEST 6 — Validation")
    log("="*80)
    
    cookies = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not cookies:
        log("❌ TEST 6 FAILED: Login failed")
        return False
    
    try:
        # Test 6a: Empty categories array
        log("Test 6a: Creating contact with empty categories array...")
        contact_data = {
            "categories": [],
            "code": f"MC-BAD1-{datetime.now().strftime('%H%M%S')}",
            "displayName": "Bad"
        }
        
        resp = requests.post(f"{BASE_URL}/contacts", json=contact_data, cookies=cookies)
        log(f"Response status: {resp.status_code}")
        
        if resp.status_code != 400:
            log(f"❌ TEST 6a FAILED: Expected 400, got {resp.status_code}")
            return False
        log(f"✅ Empty categories rejected with 400")
        
        # Test 6b: Invalid category
        log("Test 6b: Creating contact with invalid category...")
        contact_data = {
            "categories": ["NotAReal"],
            "code": f"MC-BAD2-{datetime.now().strftime('%H%M%S')}",
            "displayName": "Bad2"
        }
        
        resp = requests.post(f"{BASE_URL}/contacts", json=contact_data, cookies=cookies)
        log(f"Response status: {resp.status_code}")
        
        if resp.status_code != 400:
            log(f"❌ TEST 6b FAILED: Expected 400, got {resp.status_code}")
            return False
        log(f"✅ Invalid category rejected with 400")
        
        # Test 6c: Missing code
        log("Test 6c: Creating contact with missing code...")
        contact_data = {
            "categories": ["Customer"],
            "displayName": "NoCode"
        }
        
        resp = requests.post(f"{BASE_URL}/contacts", json=contact_data, cookies=cookies)
        log(f"Response status: {resp.status_code}")
        
        if resp.status_code != 400:
            log(f"❌ TEST 6c FAILED: Expected 400, got {resp.status_code}")
            return False
        log(f"✅ Missing code rejected with 400")
        
        log("✅ TEST 6 PASSED: Validation")
        return True
        
    except Exception as e:
        log(f"❌ TEST 6 FAILED: Exception - {str(e)}")
        return False

def test_7_rbac():
    """TEST 7 — RBAC"""
    log("\n" + "="*80)
    log("TEST 7 — RBAC")
    log("="*80)
    
    cookies = login(OPERATOR_EMAIL, OPERATOR_PASSWORD)
    if not cookies:
        log("❌ TEST 7 FAILED: Login failed")
        return False
    
    try:
        log("Operator attempting to create contact...")
        contact_data = {
            "categories": ["Customer"],
            "code": f"MC-OP1-{datetime.now().strftime('%H%M%S')}",
            "displayName": "Op"
        }
        
        resp = requests.post(f"{BASE_URL}/contacts", json=contact_data, cookies=cookies)
        log(f"Response status: {resp.status_code}")
        
        if resp.status_code != 403:
            log(f"❌ TEST 7 FAILED: Expected 403, got {resp.status_code}")
            return False
        log(f"✅ Operator POST rejected with 403")
        
        log("✅ TEST 7 PASSED: RBAC")
        return True
        
    except Exception as e:
        log(f"❌ TEST 7 FAILED: Exception - {str(e)}")
        return False

def test_8_backfill_sanity():
    """TEST 8 — Backfill sanity"""
    log("\n" + "="*80)
    log("TEST 8 — Backfill sanity")
    log("="*80)
    
    cookies = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not cookies:
        log("❌ TEST 8 FAILED: Login failed")
        return False
    
    try:
        log("Getting all contacts to check backfill...")
        resp = requests.get(f"{BASE_URL}/contacts", cookies=cookies)
        
        if resp.status_code != 200:
            log(f"❌ TEST 8 FAILED: Expected 200, got {resp.status_code}")
            return False
        
        data = resp.json()["data"]
        log(f"Found {len(data)} contacts")
        
        # Check every contact has non-empty categories array
        empty_categories = []
        for contact in data:
            if not contact.get("categories") or len(contact.get("categories", [])) == 0:
                empty_categories.append(contact.get("code", contact.get("id")))
        
        if empty_categories:
            log(f"❌ TEST 8 FAILED: Found {len(empty_categories)} contacts with empty/missing categories:")
            for code in empty_categories[:10]:  # Show first 10
                log(f"  - {code}")
            return False
        
        log(f"✅ All {len(data)} contacts have non-empty categories array")
        log("✅ TEST 8 PASSED: Backfill sanity")
        return True
        
    except Exception as e:
        log(f"❌ TEST 8 FAILED: Exception - {str(e)}")
        return False

def main():
    log("="*80)
    log("BACKEND TEST: Multi-Category Contacts Feature")
    log("="*80)
    
    results = {
        "passed": 0,
        "failed": 0,
        "total": 8
    }
    
    # TEST 1: Multi-category create
    test1_result = test_1_multi_category_create()
    if test1_result:
        results["passed"] += 1
        contact1_id = test1_result["id"]
        contact1_code = test1_result["code"]
    else:
        results["failed"] += 1
        log("\n❌ TEST 1 FAILED - Stopping dependent tests")
        print_summary(results)
        return 1
    
    # TEST 2: Membership filter
    if test_2_membership_filter(contact1_code):
        results["passed"] += 1
    else:
        results["failed"] += 1
    
    # TEST 3: Agen + Dropshipper create
    test3_result = test_3_agen_dropshipper_create()
    if test3_result:
        results["passed"] += 1
    else:
        results["failed"] += 1
    
    # TEST 4: PATCH categories change
    if test_4_patch_categories_change(contact1_id, contact1_code):
        results["passed"] += 1
    else:
        results["failed"] += 1
    
    # TEST 5: Legacy create
    if test_5_legacy_create():
        results["passed"] += 1
    else:
        results["failed"] += 1
    
    # TEST 6: Validation
    if test_6_validation():
        results["passed"] += 1
    else:
        results["failed"] += 1
    
    # TEST 7: RBAC
    if test_7_rbac():
        results["passed"] += 1
    else:
        results["failed"] += 1
    
    # TEST 8: Backfill sanity
    if test_8_backfill_sanity():
        results["passed"] += 1
    else:
        results["failed"] += 1
    
    print_summary(results)
    
    return 0 if results["failed"] == 0 else 1

def print_summary(results):
    log("\n" + "="*80)
    log("TEST SUMMARY")
    log("="*80)
    log(f"Total Tests: {results['total']}")
    log(f"✅ Passed: {results['passed']}")
    log(f"❌ Failed: {results['failed']}")
    log(f"Success Rate: {results['passed']/results['total']*100:.1f}%")
    log("="*80)

if __name__ == "__main__":
    sys.exit(main())
