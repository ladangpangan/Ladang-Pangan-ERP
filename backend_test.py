#!/usr/bin/env python3
"""
LPI ERP Backend API Test Suite
Tests all backend endpoints with RBAC verification
"""

import requests
import json
import sys
import time
from typing import Dict, Optional

# Base URL from environment
BASE_URL = "https://pangan-system.preview.emergentagent.com/api"

# Test users
USERS = {
    "admin": {"email": "admin@lpi.co.id", "password": "admin123"},
    "supervisor": {"email": "supervisor@lpi.co.id", "password": "super123"},
    "direktur": {"email": "direktur@lpi.co.id", "password": "direktur123"},
    "operator": {"email": "operator@lpi.co.id", "password": "operator123"},
}

# Test results tracking
test_results = {
    "passed": 0,
    "failed": 0,
    "errors": []
}

def log_test(test_name: str, passed: bool, message: str = ""):
    """Log test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {test_name}")
    if message:
        print(f"   {message}")
    
    if passed:
        test_results["passed"] += 1
    else:
        test_results["failed"] += 1
        test_results["errors"].append(f"{test_name}: {message}")

def test_health():
    """Test 1: Health check"""
    print("\n=== TEST 1: HEALTH CHECK ===")
    try:
        resp = requests.get(f"{BASE_URL}/root", timeout=10)
        data = resp.json()
        
        if resp.status_code == 200 and data.get("ok") and data.get("service") == "LPI ERP API":
            log_test("Health check", True, f"Response: {data}")
        else:
            log_test("Health check", False, f"Expected 200 with {{ok: true, service: 'LPI ERP API'}}, got {resp.status_code}: {data}")
    except Exception as e:
        log_test("Health check", False, f"Exception: {str(e)}")

def test_seed():
    """Test 2: Seed endpoint (idempotent)"""
    print("\n=== TEST 2: SEED ENDPOINT ===")
    try:
        resp = requests.post(f"{BASE_URL}/seed", timeout=30)
        data = resp.json()
        
        if resp.status_code == 200 and data.get("ok"):
            log_test("Seed endpoint", True, f"Seeded: {data.get('seeded')}, Message: {data.get('message', 'N/A')}")
        else:
            log_test("Seed endpoint", False, f"Expected 200 with {{ok: true}}, got {resp.status_code}: {data}")
    except Exception as e:
        log_test("Seed endpoint", False, f"Exception: {str(e)}")

def test_unauthenticated():
    """Test 3: Unauthenticated access should return 401"""
    print("\n=== TEST 3: UNAUTHENTICATED CHECK ===")
    try:
        resp = requests.get(f"{BASE_URL}/contacts", timeout=10)
        
        if resp.status_code == 401:
            log_test("Unauthenticated access returns 401", True, f"Correctly returned 401")
        else:
            log_test("Unauthenticated access returns 401", False, f"Expected 401, got {resp.status_code}")
    except Exception as e:
        log_test("Unauthenticated access returns 401", False, f"Exception: {str(e)}")

def login_user(role: str, retry_count: int = 3) -> Optional[requests.Session]:
    """Test 4: Login for each role and return session with cookies"""
    user = USERS[role]
    
    for attempt in range(retry_count):
        session = requests.Session()
        
        try:
            # Add delay between attempts to avoid rate limiting
            if attempt > 0:
                time.sleep(3)
            
            # Better Auth sign-in endpoint
            resp = session.post(
                f"{BASE_URL}/auth/sign-in/email",
                json={"email": user["email"], "password": user["password"]},
                timeout=15,
                headers={"User-Agent": "LPI-ERP-Test/1.0"}
            )
            
            if resp.status_code == 200:
                # Check if cookies are set
                if session.cookies:
                    log_test(f"Login as {role}", True, f"Logged in successfully, cookies: {len(session.cookies)} cookie(s)")
                    return session
                else:
                    log_test(f"Login as {role}", False, "Login returned 200 but no cookies set")
                    return None
            elif resp.status_code == 502 and attempt < retry_count - 1:
                # Retry on 502
                print(f"   Attempt {attempt + 1} failed with 502, retrying...")
                continue
            else:
                log_test(f"Login as {role}", False, f"Expected 200, got {resp.status_code}: {resp.text[:200]}")
                return None
        except Exception as e:
            if attempt < retry_count - 1:
                print(f"   Attempt {attempt + 1} failed with exception, retrying...")
                continue
            else:
                log_test(f"Login as {role}", False, f"Exception: {str(e)}")
                return None
    
    return None

def test_all_logins():
    """Test 4: Login all 4 roles"""
    print("\n=== TEST 4: LOGIN ALL ROLES ===")
    sessions = {}
    for i, role in enumerate(USERS.keys()):
        # Add delay between logins to avoid rate limiting
        if i > 0:
            time.sleep(2)
        session = login_user(role)
        if session:
            sessions[role] = session
    return sessions

def test_contacts_rbac(sessions: Dict[str, requests.Session]):
    """Test 5: Contacts RBAC matrix"""
    print("\n=== TEST 5: CONTACTS RBAC MATRIX ===")
    
    # Test 5a: GET /api/contacts
    print("\n--- 5a: GET /api/contacts ---")
    for role, expected_status in [("admin", 200), ("supervisor", 200), ("direktur", 200), ("operator", 403)]:
        if role not in sessions:
            log_test(f"GET /api/contacts as {role}", False, f"No session for {role}")
            continue
        
        try:
            resp = sessions[role].get(f"{BASE_URL}/contacts", timeout=10)
            if resp.status_code == expected_status:
                log_test(f"GET /api/contacts as {role}", True, f"Expected {expected_status}, got {expected_status}")
            else:
                log_test(f"GET /api/contacts as {role}", False, f"Expected {expected_status}, got {resp.status_code}")
        except Exception as e:
            log_test(f"GET /api/contacts as {role}", False, f"Exception: {str(e)}")
    
    # Test 5b: POST /api/contacts
    print("\n--- 5b: POST /api/contacts ---")
    created_ids = {}
    for role, expected_status in [("admin", 201), ("supervisor", 201), ("direktur", 403), ("operator", 403)]:
        if role not in sessions:
            log_test(f"POST /api/contacts as {role}", False, f"No session for {role}")
            continue
        
        try:
            contact_data = {
                "contactType": "Supplier",
                "code": f"SUP-TEST-{role.upper()}",
                "displayName": f"Test Supplier {role.title()}"
            }
            resp = sessions[role].post(f"{BASE_URL}/contacts", json=contact_data, timeout=10)
            
            if resp.status_code == expected_status:
                log_test(f"POST /api/contacts as {role}", True, f"Expected {expected_status}, got {expected_status}")
                if resp.status_code == 201:
                    data = resp.json()
                    created_ids[role] = data.get("data", {}).get("id")
            else:
                log_test(f"POST /api/contacts as {role}", False, f"Expected {expected_status}, got {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            log_test(f"POST /api/contacts as {role}", False, f"Exception: {str(e)}")
    
    # Get a seeded contact ID for PATCH/DELETE tests (SUP-001)
    seeded_contact_id = None
    if "admin" in sessions:
        try:
            resp = sessions["admin"].get(f"{BASE_URL}/contacts?type=Supplier", timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                contacts = data.get("data", [])
                for c in contacts:
                    if c.get("code") == "SUP-001":
                        seeded_contact_id = c.get("id")
                        break
        except:
            pass
    
    # Test 5c: PATCH /api/contacts/:id
    print("\n--- 5c: PATCH /api/contacts/:id ---")
    if seeded_contact_id:
        for role, expected_status in [("admin", 200), ("supervisor", 200), ("direktur", 403), ("operator", 403)]:
            if role not in sessions:
                log_test(f"PATCH /api/contacts/:id as {role}", False, f"No session for {role}")
                continue
            
            try:
                patch_data = {"notes": f"updated by {role}"}
                resp = sessions[role].patch(f"{BASE_URL}/contacts/{seeded_contact_id}", json=patch_data, timeout=10)
                
                if resp.status_code == expected_status:
                    log_test(f"PATCH /api/contacts/:id as {role}", True, f"Expected {expected_status}, got {expected_status}")
                else:
                    log_test(f"PATCH /api/contacts/:id as {role}", False, f"Expected {expected_status}, got {resp.status_code}")
            except Exception as e:
                log_test(f"PATCH /api/contacts/:id as {role}", False, f"Exception: {str(e)}")
    else:
        log_test("PATCH /api/contacts/:id", False, "Could not find seeded contact SUP-001")
    
    # Test 5d: DELETE /api/contacts/:id
    print("\n--- 5d: DELETE /api/contacts/:id ---")
    # Delete the contacts created by admin and supervisor
    for role, expected_status in [("admin", 200), ("supervisor", 403), ("direktur", 403), ("operator", 403)]:
        if role not in sessions:
            log_test(f"DELETE /api/contacts/:id as {role}", False, f"No session for {role}")
            continue
        
        # Use the contact created by this role if available, otherwise use admin's
        contact_id = created_ids.get(role) or created_ids.get("admin")
        if not contact_id:
            log_test(f"DELETE /api/contacts/:id as {role}", False, f"No contact ID to delete for {role}")
            continue
        
        try:
            resp = sessions[role].delete(f"{BASE_URL}/contacts/{contact_id}", timeout=10)
            
            if resp.status_code == expected_status:
                log_test(f"DELETE /api/contacts/:id as {role}", True, f"Expected {expected_status}, got {expected_status}")
            else:
                log_test(f"DELETE /api/contacts/:id as {role}", False, f"Expected {expected_status}, got {resp.status_code}")
        except Exception as e:
            log_test(f"DELETE /api/contacts/:id as {role}", False, f"Exception: {str(e)}")

def test_contacts_search_filter(sessions: Dict[str, requests.Session]):
    """Test 6: Contacts search & filter"""
    print("\n=== TEST 6: CONTACTS SEARCH & FILTER ===")
    
    if "admin" not in sessions:
        log_test("Contacts search & filter", False, "No admin session")
        return
    
    admin = sessions["admin"]
    
    # Test 6a: Filter by type=Supplier
    print("\n--- 6a: GET /api/contacts?type=Supplier ---")
    try:
        resp = admin.get(f"{BASE_URL}/contacts?type=Supplier", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            contacts = data.get("data", [])
            all_suppliers = all(c.get("contactType") == "Supplier" for c in contacts)
            if all_suppliers and len(contacts) > 0:
                log_test("Filter by type=Supplier", True, f"Found {len(contacts)} suppliers")
            else:
                log_test("Filter by type=Supplier", False, f"Expected only Supplier type, got mixed or empty: {len(contacts)} contacts")
        else:
            log_test("Filter by type=Supplier", False, f"Expected 200, got {resp.status_code}")
    except Exception as e:
        log_test("Filter by type=Supplier", False, f"Exception: {str(e)}")
    
    # Test 6b: Filter by type=Customer
    print("\n--- 6b: GET /api/contacts?type=Customer ---")
    try:
        resp = admin.get(f"{BASE_URL}/contacts?type=Customer", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            contacts = data.get("data", [])
            all_customers = all(c.get("contactType") == "Customer" for c in contacts)
            if all_customers and len(contacts) > 0:
                log_test("Filter by type=Customer", True, f"Found {len(contacts)} customers")
            else:
                log_test("Filter by type=Customer", False, f"Expected only Customer type, got mixed or empty: {len(contacts)} contacts")
        else:
            log_test("Filter by type=Customer", False, f"Expected 200, got {resp.status_code}")
    except Exception as e:
        log_test("Filter by type=Customer", False, f"Exception: {str(e)}")
    
    # Test 6c: Search by name (q=Sejahtera)
    print("\n--- 6c: GET /api/contacts?q=Sejahtera ---")
    try:
        resp = admin.get(f"{BASE_URL}/contacts?q=Sejahtera", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            contacts = data.get("data", [])
            found_sejahtera = any("Sejahtera" in c.get("displayName", "") or "Sejahtera" in c.get("companyName", "") for c in contacts)
            if found_sejahtera:
                log_test("Search by q=Sejahtera", True, f"Found {len(contacts)} contacts with 'Sejahtera'")
            else:
                log_test("Search by q=Sejahtera", False, f"Expected to find 'PT Ayam Sejahtera', got {len(contacts)} contacts")
        else:
            log_test("Search by q=Sejahtera", False, f"Expected 200, got {resp.status_code}")
    except Exception as e:
        log_test("Search by q=Sejahtera", False, f"Exception: {str(e)}")
    
    # Test 6d: Search by phone (q=021-5551001)
    print("\n--- 6d: GET /api/contacts?q=021-5551001 ---")
    try:
        resp = admin.get(f"{BASE_URL}/contacts?q=021-5551001", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            contacts = data.get("data", [])
            found_phone = any("021-5551001" in c.get("phone", "") for c in contacts)
            if found_phone:
                log_test("Search by phone q=021-5551001", True, f"Found {len(contacts)} contacts with phone '021-5551001'")
            else:
                log_test("Search by phone q=021-5551001", False, f"Expected to find contact with phone '021-5551001', got {len(contacts)} contacts")
        else:
            log_test("Search by phone q=021-5551001", False, f"Expected 200, got {resp.status_code}")
    except Exception as e:
        log_test("Search by phone q=021-5551001", False, f"Exception: {str(e)}")

def test_contact_history(sessions: Dict[str, requests.Session]):
    """Test 7: Contact history endpoint"""
    print("\n=== TEST 7: CONTACT HISTORY ===")
    
    if "admin" not in sessions:
        log_test("Contact history", False, "No admin session")
        return
    
    admin = sessions["admin"]
    
    # Get a contact ID first
    try:
        resp = admin.get(f"{BASE_URL}/contacts?type=Supplier", timeout=10)
        if resp.status_code != 200:
            log_test("Contact history", False, "Could not fetch contacts to get ID")
            return
        
        data = resp.json()
        contacts = data.get("data", [])
        if not contacts:
            log_test("Contact history", False, "No contacts found")
            return
        
        contact_id = contacts[0].get("id")
        
        # Test GET /api/contacts/:id/history
        resp = admin.get(f"{BASE_URL}/contacts/{contact_id}/history", timeout=10)
        if resp.status_code == 200:
            data = resp.json().get("data", {})
            
            # Verify structure
            has_contact = "contact" in data
            has_sales = "salesOrders" in data
            has_purchase = "purchaseOrders" in data
            has_work = "workOrders" in data
            has_summary = "summary" in data
            
            if has_contact and has_sales and has_purchase and has_work and has_summary:
                summary = data.get("summary", {})
                has_counts = "salesCount" in summary and "purchaseCount" in summary and "workOrderCount" in summary
                has_amounts = "totalSalesAmount" in summary and "totalPurchaseAmount" in summary
                
                if has_counts and has_amounts:
                    log_test("Contact history structure", True, f"All fields present: {list(data.keys())}")
                else:
                    log_test("Contact history structure", False, f"Summary missing fields: {summary.keys()}")
            else:
                log_test("Contact history structure", False, f"Missing fields. Got: {data.keys()}")
        else:
            log_test("Contact history", False, f"Expected 200, got {resp.status_code}")
    except Exception as e:
        log_test("Contact history", False, f"Exception: {str(e)}")

def test_products_crud(sessions: Dict[str, requests.Session]):
    """Test 8: Products CRUD"""
    print("\n=== TEST 8: PRODUCTS CRUD ===")
    
    if "admin" not in sessions:
        log_test("Products CRUD", False, "No admin session")
        return
    
    admin = sessions["admin"]
    
    # Test 8a: GET /api/products
    print("\n--- 8a: GET /api/products ---")
    try:
        resp = admin.get(f"{BASE_URL}/products", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            products = data.get("data", [])
            if len(products) >= 5:
                log_test("GET /api/products", True, f"Found {len(products)} products (expected at least 5)")
            else:
                log_test("GET /api/products", False, f"Expected at least 5 seeded products, got {len(products)}")
        else:
            log_test("GET /api/products", False, f"Expected 200, got {resp.status_code}")
    except Exception as e:
        log_test("GET /api/products", False, f"Exception: {str(e)}")
    
    # Test 8b: POST /api/products
    print("\n--- 8b: POST /api/products ---")
    created_product_id = None
    try:
        product_data = {
            "sku": "TEST-001",
            "name": "Test Product",
            "category": "Karkas",
            "unit": "kg",
            "basePrice": 10000
        }
        resp = admin.post(f"{BASE_URL}/products", json=product_data, timeout=10)
        if resp.status_code == 201:
            data = resp.json()
            created_product_id = data.get("data", {}).get("id")
            log_test("POST /api/products", True, f"Created product with ID: {created_product_id}")
        else:
            log_test("POST /api/products", False, f"Expected 201, got {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("POST /api/products", False, f"Exception: {str(e)}")
    
    # Test 8c: PATCH /api/products/:id
    print("\n--- 8c: PATCH /api/products/:id ---")
    if created_product_id:
        try:
            patch_data = {"basePrice": 15000}
            resp = admin.patch(f"{BASE_URL}/products/{created_product_id}", json=patch_data, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                updated_price = data.get("data", {}).get("basePrice")
                if updated_price == 15000:
                    log_test("PATCH /api/products/:id", True, f"Price updated to {updated_price}")
                else:
                    log_test("PATCH /api/products/:id", False, f"Expected basePrice=15000, got {updated_price}")
            else:
                log_test("PATCH /api/products/:id", False, f"Expected 200, got {resp.status_code}")
        except Exception as e:
            log_test("PATCH /api/products/:id", False, f"Exception: {str(e)}")
    else:
        log_test("PATCH /api/products/:id", False, "No product ID to patch")
    
    # Test 8d: DELETE /api/products/:id
    print("\n--- 8d: DELETE /api/products/:id ---")
    if created_product_id:
        try:
            resp = admin.delete(f"{BASE_URL}/products/{created_product_id}", timeout=10)
            if resp.status_code == 200:
                log_test("DELETE /api/products/:id", True, "Product deleted successfully")
            else:
                log_test("DELETE /api/products/:id", False, f"Expected 200, got {resp.status_code}")
        except Exception as e:
            log_test("DELETE /api/products/:id", False, f"Exception: {str(e)}")
    else:
        log_test("DELETE /api/products/:id", False, "No product ID to delete")
    
    # Test 8e: Filter by category
    print("\n--- 8e: GET /api/products?category=Karkas ---")
    try:
        resp = admin.get(f"{BASE_URL}/products?category=Karkas", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            products = data.get("data", [])
            all_karkas = all(p.get("category") == "Karkas" for p in products)
            if all_karkas and len(products) > 0:
                log_test("Filter by category=Karkas", True, f"Found {len(products)} Karkas products")
            else:
                log_test("Filter by category=Karkas", False, f"Expected only Karkas category, got mixed or empty: {len(products)} products")
        else:
            log_test("Filter by category=Karkas", False, f"Expected 200, got {resp.status_code}")
    except Exception as e:
        log_test("Filter by category=Karkas", False, f"Exception: {str(e)}")
    
    # Test 8f: Search by name
    print("\n--- 8f: GET /api/products?q=Boneless ---")
    try:
        resp = admin.get(f"{BASE_URL}/products?q=Boneless", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            products = data.get("data", [])
            found_boneless = any("Boneless" in p.get("name", "") for p in products)
            if found_boneless:
                log_test("Search by q=Boneless", True, f"Found {len(products)} products with 'Boneless'")
            else:
                log_test("Search by q=Boneless", False, f"Expected to find 'Boneless' products, got {len(products)} products")
        else:
            log_test("Search by q=Boneless", False, f"Expected 200, got {resp.status_code}")
    except Exception as e:
        log_test("Search by q=Boneless", False, f"Exception: {str(e)}")
    
    # Test 8g: Operator can view but not create
    print("\n--- 8g: Products RBAC - Operator ---")
    if "operator" in sessions:
        try:
            # GET should work
            resp = sessions["operator"].get(f"{BASE_URL}/products", timeout=10)
            if resp.status_code == 200:
                log_test("GET /api/products as operator", True, "Operator can view products")
            else:
                log_test("GET /api/products as operator", False, f"Expected 200, got {resp.status_code}")
            
            # POST should fail with 403
            product_data = {"sku": "OP-TEST", "name": "Operator Test", "category": "Test", "unit": "kg", "basePrice": 1000}
            resp = sessions["operator"].post(f"{BASE_URL}/products", json=product_data, timeout=10)
            if resp.status_code == 403:
                log_test("POST /api/products as operator", True, "Operator correctly denied (403)")
            else:
                log_test("POST /api/products as operator", False, f"Expected 403, got {resp.status_code}")
        except Exception as e:
            log_test("Products RBAC - Operator", False, f"Exception: {str(e)}")
    else:
        log_test("Products RBAC - Operator", False, "No operator session")

def test_cold_storages_zones(sessions: Dict[str, requests.Session]):
    """Test 9: Cold Storages + Zones"""
    print("\n=== TEST 9: COLD STORAGES + ZONES ===")
    
    if "admin" not in sessions:
        log_test("Cold Storages + Zones", False, "No admin session")
        return
    
    admin = sessions["admin"]
    
    # Test 9a: GET /api/cold-storages
    print("\n--- 9a: GET /api/cold-storages ---")
    try:
        resp = admin.get(f"{BASE_URL}/cold-storages", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            storages = data.get("data", [])
            if len(storages) >= 2:
                has_zone_count = all("zoneCount" in cs for cs in storages)
                if has_zone_count:
                    log_test("GET /api/cold-storages", True, f"Found {len(storages)} cold storages with zoneCount")
                else:
                    log_test("GET /api/cold-storages", False, "Some cold storages missing zoneCount field")
            else:
                log_test("GET /api/cold-storages", False, f"Expected at least 2 seeded cold storages, got {len(storages)}")
        else:
            log_test("GET /api/cold-storages", False, f"Expected 200, got {resp.status_code}")
    except Exception as e:
        log_test("GET /api/cold-storages", False, f"Exception: {str(e)}")
    
    # Test 9b: POST /api/cold-storages
    print("\n--- 9b: POST /api/cold-storages ---")
    created_cs_id = None
    try:
        cs_data = {
            "code": "CS-TEST",
            "name": "Test CS",
            "capacityKg": 10000
        }
        resp = admin.post(f"{BASE_URL}/cold-storages", json=cs_data, timeout=10)
        if resp.status_code == 201:
            data = resp.json()
            created_cs_id = data.get("data", {}).get("id")
            log_test("POST /api/cold-storages", True, f"Created cold storage with ID: {created_cs_id}")
        else:
            log_test("POST /api/cold-storages", False, f"Expected 201, got {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log_test("POST /api/cold-storages", False, f"Exception: {str(e)}")
    
    # Test 9c: GET /api/cold-storages/:id (with zones array)
    print("\n--- 9c: GET /api/cold-storages/:id ---")
    if created_cs_id:
        try:
            resp = admin.get(f"{BASE_URL}/cold-storages/{created_cs_id}", timeout=10)
            if resp.status_code == 200:
                data = resp.json().get("data", {})
                if "zones" in data and isinstance(data["zones"], list):
                    log_test("GET /api/cold-storages/:id", True, f"Cold storage has zones array: {len(data['zones'])} zones")
                else:
                    log_test("GET /api/cold-storages/:id", False, "Cold storage missing zones array")
            else:
                log_test("GET /api/cold-storages/:id", False, f"Expected 200, got {resp.status_code}")
        except Exception as e:
            log_test("GET /api/cold-storages/:id", False, f"Exception: {str(e)}")
    else:
        log_test("GET /api/cold-storages/:id", False, "No cold storage ID to fetch")
    
    # Test 9d: POST /api/zones
    print("\n--- 9d: POST /api/zones ---")
    created_zone_id = None
    if created_cs_id:
        try:
            zone_data = {
                "coldStorageId": created_cs_id,
                "code": "Z-TEST",
                "name": "Test Zone"
            }
            resp = admin.post(f"{BASE_URL}/zones", json=zone_data, timeout=10)
            if resp.status_code == 201:
                data = resp.json()
                created_zone_id = data.get("data", {}).get("id")
                log_test("POST /api/zones", True, f"Created zone with ID: {created_zone_id}")
            else:
                log_test("POST /api/zones", False, f"Expected 201, got {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            log_test("POST /api/zones", False, f"Exception: {str(e)}")
    else:
        log_test("POST /api/zones", False, "No cold storage ID to create zone")
    
    # Test 9e: GET /api/zones?cold_storage_id=xxx
    print("\n--- 9e: GET /api/zones?cold_storage_id=xxx ---")
    if created_cs_id:
        try:
            resp = admin.get(f"{BASE_URL}/zones?cold_storage_id={created_cs_id}", timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                zones = data.get("data", [])
                log_test("GET /api/zones with filter", True, f"Found {len(zones)} zones for cold storage")
            else:
                log_test("GET /api/zones with filter", False, f"Expected 200, got {resp.status_code}")
        except Exception as e:
            log_test("GET /api/zones with filter", False, f"Exception: {str(e)}")
    else:
        log_test("GET /api/zones with filter", False, "No cold storage ID to filter zones")
    
    # Test 9f: PATCH /api/zones/:id
    print("\n--- 9f: PATCH /api/zones/:id ---")
    if created_zone_id:
        try:
            patch_data = {"name": "Renamed Zone"}
            resp = admin.patch(f"{BASE_URL}/zones/{created_zone_id}", json=patch_data, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                updated_name = data.get("data", {}).get("name")
                if updated_name == "Renamed Zone":
                    log_test("PATCH /api/zones/:id", True, f"Zone renamed to '{updated_name}'")
                else:
                    log_test("PATCH /api/zones/:id", False, f"Expected name='Renamed Zone', got '{updated_name}'")
            else:
                log_test("PATCH /api/zones/:id", False, f"Expected 200, got {resp.status_code}")
        except Exception as e:
            log_test("PATCH /api/zones/:id", False, f"Exception: {str(e)}")
    else:
        log_test("PATCH /api/zones/:id", False, "No zone ID to patch")
    
    # Test 9g: DELETE /api/zones/:id
    print("\n--- 9g: DELETE /api/zones/:id ---")
    if created_zone_id:
        try:
            resp = admin.delete(f"{BASE_URL}/zones/{created_zone_id}", timeout=10)
            if resp.status_code == 200:
                log_test("DELETE /api/zones/:id", True, "Zone deleted successfully")
            else:
                log_test("DELETE /api/zones/:id", False, f"Expected 200, got {resp.status_code}")
        except Exception as e:
            log_test("DELETE /api/zones/:id", False, f"Exception: {str(e)}")
    else:
        log_test("DELETE /api/zones/:id", False, "No zone ID to delete")
    
    # Test 9h: DELETE /api/cold-storages/:id (should cascade zones)
    print("\n--- 9h: DELETE /api/cold-storages/:id ---")
    if created_cs_id:
        try:
            resp = admin.delete(f"{BASE_URL}/cold-storages/{created_cs_id}", timeout=10)
            if resp.status_code == 200:
                log_test("DELETE /api/cold-storages/:id", True, "Cold storage deleted successfully")
            else:
                log_test("DELETE /api/cold-storages/:id", False, f"Expected 200, got {resp.status_code}")
        except Exception as e:
            log_test("DELETE /api/cold-storages/:id", False, f"Exception: {str(e)}")
    else:
        log_test("DELETE /api/cold-storages/:id", False, "No cold storage ID to delete")
    
    # Test 9i: RBAC - Supervisor can create, Direktur/Operator cannot
    print("\n--- 9i: Cold Storage RBAC ---")
    for role, expected_status in [("supervisor", 201), ("direktur", 403), ("operator", 403)]:
        if role not in sessions:
            log_test(f"POST /api/cold-storages as {role}", False, f"No session for {role}")
            continue
        
        try:
            cs_data = {
                "code": f"CS-{role.upper()}",
                "name": f"Test CS {role.title()}",
                "capacityKg": 5000
            }
            resp = sessions[role].post(f"{BASE_URL}/cold-storages", json=cs_data, timeout=10)
            
            if resp.status_code == expected_status:
                log_test(f"POST /api/cold-storages as {role}", True, f"Expected {expected_status}, got {expected_status}")
                # Clean up if created
                if resp.status_code == 201:
                    cs_id = resp.json().get("data", {}).get("id")
                    if cs_id and role == "supervisor":
                        # Supervisor can create but only admin can delete, so use admin to clean up
                        if "admin" in sessions:
                            sessions["admin"].delete(f"{BASE_URL}/cold-storages/{cs_id}", timeout=10)
            else:
                log_test(f"POST /api/cold-storages as {role}", False, f"Expected {expected_status}, got {resp.status_code}")
        except Exception as e:
            log_test(f"POST /api/cold-storages as {role}", False, f"Exception: {str(e)}")

def test_stats(sessions: Dict[str, requests.Session]):
    """Test 10: Stats endpoint"""
    print("\n=== TEST 10: STATS ENDPOINT ===")
    
    if "admin" not in sessions:
        log_test("Stats endpoint", False, "No admin session")
        return
    
    try:
        resp = sessions["admin"].get(f"{BASE_URL}/stats", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            required_fields = ["contacts", "products", "coldStorages", "zones", "users"]
            has_all_fields = all(field in data for field in required_fields)
            
            if has_all_fields:
                log_test("GET /api/stats", True, f"Stats: {data}")
            else:
                log_test("GET /api/stats", False, f"Missing fields. Got: {data.keys()}")
        else:
            log_test("GET /api/stats", False, f"Expected 200, got {resp.status_code}")
    except Exception as e:
        log_test("GET /api/stats", False, f"Exception: {str(e)}")

def print_summary():
    """Print test summary"""
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)
    print(f"✅ Passed: {test_results['passed']}")
    print(f"❌ Failed: {test_results['failed']}")
    print(f"Total: {test_results['passed'] + test_results['failed']}")
    
    if test_results['errors']:
        print("\n" + "="*60)
        print("FAILED TESTS:")
        print("="*60)
        for error in test_results['errors']:
            print(f"  • {error}")
    
    print("\n" + "="*60)
    
    return test_results['failed'] == 0

def main():
    """Run all tests"""
    print("="*60)
    print("LPI ERP BACKEND API TEST SUITE")
    print("="*60)
    print(f"Base URL: {BASE_URL}")
    print("="*60)
    
    # Run tests in order
    test_health()
    test_seed()
    test_unauthenticated()
    sessions = test_all_logins()
    
    if sessions:
        test_contacts_rbac(sessions)
        test_contacts_search_filter(sessions)
        test_contact_history(sessions)
        test_products_crud(sessions)
        test_cold_storages_zones(sessions)
        test_stats(sessions)
    else:
        print("\n❌ No sessions available, skipping authenticated tests")
    
    # Print summary
    success = print_summary()
    
    # Exit with appropriate code
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
