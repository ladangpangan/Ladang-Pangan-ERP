#!/usr/bin/env python3
"""
MAINTENANCE Backend Test: stock_ledger reconcile-hydrate + reset-inventory route + Better Auth rate-limit
Tests the LAST appended block in test_result.md (MAINTENANCE section).
"""

import requests
import json
import time
from pymongo import MongoClient
import sqlite3
from datetime import datetime
from http.cookiejar import Cookie

# Configuration
BASE_URL = "http://localhost:3000/api"
MONGO_URL = "mongodb://localhost:27017"
MONGO_DB_NAME = "erp_prod"
SQLITE_DB = "/app/data/erp.db"

# Auth credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
OPERATOR_EMAIL = "operator@lpi.co.id"
OPERATOR_PASSWORD = "operator123"

# Test results
test_results = []

def log_test(name, passed, details=""):
    """Log test result"""
    status = "✅ PASSED" if passed else "❌ FAILED"
    print(f"\n{status}: {name}")
    if details:
        print(f"  Details: {details}")
    test_results.append({"name": name, "passed": passed, "details": details})

def login(email, password):
    """Login and return session with manually set cookie"""
    session = requests.Session()
    headers = {
        "Content-Type": "application/json",
        "Origin": "http://localhost:3000"
    }
    
    # Try to login
    response = session.post(
        f"{BASE_URL.replace('/api', '')}/api/auth/sign-in/email",
        json={"email": email, "password": password},
        headers=headers
    )
    
    if response.status_code == 200:
        # Extract the session token from Set-Cookie header
        set_cookie_header = response.headers.get('set-cookie', '')
        if '__Secure-better-auth.session_token=' in set_cookie_header:
            # Extract token value
            token_start = set_cookie_header.find('__Secure-better-auth.session_token=') + len('__Secure-better-auth.session_token=')
            token_end = set_cookie_header.find(';', token_start)
            token_value = set_cookie_header[token_start:token_end]
            
            # Manually add the cookie to the session (without Secure flag for HTTP)
            cookie = Cookie(
                version=0,
                name='__Secure-better-auth.session_token',
                value=token_value,
                port=None,
                port_specified=False,
                domain='localhost',
                domain_specified=True,
                domain_initial_dot=False,
                path='/',
                path_specified=True,
                secure=False,  # Set to False for HTTP
                expires=None,
                discard=True,
                comment=None,
                comment_url=None,
                rest={'HttpOnly': None},
                rfc2109=False
            )
            session.cookies.set_cookie(cookie)
            print(f"✓ Logged in as {email} (token: {token_value[:20]}...)")
            return session
        else:
            print(f"✗ No session token in response for {email}")
            return None
    else:
        print(f"✗ Login failed for {email}: {response.status_code} - {response.text[:200]}")
        return None

def get_mongo_client():
    """Get MongoDB client and database"""
    client = MongoClient(MONGO_URL)
    db = client[MONGO_DB_NAME]
    return client, db

def count_mongo_collection(db, collection_name):
    """Count documents in MongoDB collection"""
    try:
        return db[collection_name].count_documents({})
    except Exception as e:
        print(f"Error counting {collection_name}: {e}")
        return 0

def get_mongo_counts(db):
    """Get counts for all inventory-related collections"""
    collections = ['inventory_stock', 'stock_ledger', 'inventory_transaction', 
                   'tally_session', 'tally_session_items', 'stock_opname', 'stock_opname_items']
    counts = {}
    for coll in collections:
        counts[coll] = count_mongo_collection(db, coll)
    return counts

def test_scenario_1_regression_reconcile_hydrate(session, mongo_db):
    """
    Scenario 1: REGRESSION - normal Kartu Stok not broken by reconcile-hydrate
    Do THREE separate tally inbounds and confirm movement count GROWS (1, 2, 3)
    and all rows remain visible (reconcile must NOT delete rows that ARE in Mongo).
    """
    print("\n" + "="*80)
    print("SCENARIO 1: REGRESSION - stock_ledger reconcile-hydrate")
    print("="*80)
    
    # Get cold storage
    response = session.get(f"{BASE_URL}/cold-storages")
    if response.status_code != 200:
        log_test("Scenario 1: Get cold storages", False, f"API returned {response.status_code}")
        return []
    
    cold_storages = response.json().get("data", [])
    if not cold_storages:
        log_test("Scenario 1: Get cold storages", False, "No cold storages found")
        return []
    
    cs_id = cold_storages[0]["id"]
    cs_name = cold_storages[0].get("name", "Unknown")
    print(f"Using cold storage: {cs_name} ({cs_id})")
    
    # Get a product
    response = session.get(f"{BASE_URL}/products?limit=1")
    if response.status_code != 200:
        log_test("Scenario 1: Get products", False, f"API returned {response.status_code}")
        return []
    
    products = response.json().get("data", [])
    if not products:
        log_test("Scenario 1: Get products", False, "No products found")
        return []
    
    product_id = products[0]["id"]
    product_name = products[0].get("name", "Unknown")
    print(f"Using product: {product_name} ({product_id})")
    
    headers = {"Content-Type": "application/json", "Origin": "http://localhost:3000"}
    created_sessions = []
    
    # Do THREE separate tally inbounds
    for i in range(1, 4):
        print(f"\n--- Tally Inbound {i}/3 ---")
        
        # Create tally session
        payload = {
            "coldStorageId": cs_id,
            "referenceType": "MANUAL",
            "items": [{
                "productId": product_id,
                "weight": 10.0 + i,  # Different weights: 11, 12, 13
                "quantity": i,
                "packagingType": "colly"
            }]
        }
        
        response = session.post(f"{BASE_URL}/tally-sessions", json=payload, headers=headers)
        if response.status_code != 201:
            log_test(f"Scenario 1: Create tally session {i}", False, f"API returned {response.status_code}: {response.text[:200]}")
            return created_sessions
        
        data = response.json().get("data", {})
        session_id = data.get("id")
        print(f"✓ Created tally session {i}: {session_id}")
        created_sessions.append(session_id)
        
        # Finalize the session
        response = session.post(f"{BASE_URL}/tally-sessions/{session_id}/finalize", headers=headers)
        if response.status_code != 201:
            log_test(f"Scenario 1: Finalize tally session {i}", False, f"API returned {response.status_code}: {response.text[:200]}")
            return created_sessions
        
        finalize_data = response.json().get("data", {})
        transaction_id = finalize_data.get("transactionId")
        print(f"✓ Finalized tally session {i}, transaction: {transaction_id}")
        
        # Wait a bit for async persist
        time.sleep(0.5)
        
        # Get stock ledger and verify count
        response = session.get(f"{BASE_URL}/stock-ledger")
        if response.status_code != 200:
            log_test(f"Scenario 1: Get stock ledger after {i}", False, f"API returned {response.status_code}")
            return created_sessions
        
        ledger_data = response.json().get("data", {})
        movements = ledger_data.get("movements", [])
        total = ledger_data.get("total", 0)
        
        print(f"✓ Stock ledger after finalize {i}: {len(movements)} movements (total: {total})")
        
        # CRITICAL: Verify movement count GROWS
        if len(movements) != i:
            log_test(f"Scenario 1: Movement count after {i}", False, f"Expected {i} movements, got {len(movements)}")
            return created_sessions
        
        print(f"✓ Movement count correct: {i}")
        
        # Verify all previous movements still exist (check by transaction_id or created_at)
        if i > 1:
            # Check that we have movements from all previous finalizes
            movement_ids = [m.get("id") for m in movements]
            print(f"✓ All {i} movements present: {len(movement_ids)} unique IDs")
    
    # Final verification: Get inventory stocks
    response = session.get(f"{BASE_URL}/inventory/stocks?status=active&sort=FEFO")
    if response.status_code != 200:
        log_test("Scenario 1: Get inventory stocks", False, f"API returned {response.status_code}")
        return created_sessions
    
    stocks = response.json().get("data", [])
    print(f"✓ Inventory stocks: {len(stocks)} active stocks")
    
    # Verify we have 3 stocks from our 3 finalizes
    if len(stocks) >= 3:
        log_test("Scenario 1: REGRESSION - reconcile-hydrate", True, 
                 f"All 3 tally inbounds created stocks and ledger entries. Movement count grew 1->2->3. No valid rows deleted.")
    else:
        log_test("Scenario 1: REGRESSION - reconcile-hydrate", False, 
                 f"Expected at least 3 stocks, got {len(stocks)}")
    
    return created_sessions

def test_scenario_2_maintenance_guards(session, mongo_db):
    """
    Scenario 2: MAINTENANCE guards
    - Wrong token -> 403
    - Correct token but wrong confirm -> 400
    - As operator -> 403
    """
    print("\n" + "="*80)
    print("SCENARIO 2: MAINTENANCE guards")
    print("="*80)
    
    headers = {"Content-Type": "application/json", "Origin": "http://localhost:3000"}
    
    # Test 2a: Wrong token
    print("\n--- Test 2a: Wrong token ---")
    payload = {
        "token": "WRONG-TOKEN",
        "confirm": "HAPUS-INVENTORY"
    }
    response = session.post(f"{BASE_URL}/maintenance/reset-inventory", json=payload, headers=headers)
    print(f"Response: {response.status_code} - {response.text[:200]}")
    
    if response.status_code == 403 and "Invalid maintenance token" in response.text:
        log_test("Scenario 2a: Wrong token -> 403", True, "Correctly rejected with 403")
    else:
        log_test("Scenario 2a: Wrong token -> 403", False, f"Expected 403 with 'Invalid maintenance token', got {response.status_code}")
    
    # Test 2b: Correct token but wrong confirm
    print("\n--- Test 2b: Correct token but wrong confirm ---")
    payload = {
        "token": "LPI-RESET-INV-2026-9f3a7c1e5b8d42a6",
        "confirm": "WRONG-CONFIRM"
    }
    response = session.post(f"{BASE_URL}/maintenance/reset-inventory", json=payload, headers=headers)
    print(f"Response: {response.status_code} - {response.text[:200]}")
    
    if response.status_code == 400 and "Confirmation mismatch" in response.text:
        log_test("Scenario 2b: Wrong confirm -> 400", True, "Correctly rejected with 400")
    else:
        log_test("Scenario 2b: Wrong confirm -> 400", False, f"Expected 400 with 'Confirmation mismatch', got {response.status_code}")
    
    # Test 2c: As operator
    print("\n--- Test 2c: As operator ---")
    operator_session = login(OPERATOR_EMAIL, OPERATOR_PASSWORD)
    if not operator_session:
        log_test("Scenario 2c: Operator login", False, "Could not login as operator")
        return
    
    payload = {
        "token": "LPI-RESET-INV-2026-9f3a7c1e5b8d42a6",
        "confirm": "HAPUS-INVENTORY"
    }
    response = operator_session.post(f"{BASE_URL}/maintenance/reset-inventory", json=payload, headers=headers)
    print(f"Response: {response.status_code} - {response.text[:200]}")
    
    if response.status_code == 403 and "Forbidden - admin only" in response.text:
        log_test("Scenario 2c: Operator -> 403", True, "Correctly rejected with 403 'Forbidden - admin only'")
    else:
        log_test("Scenario 2c: Operator -> 403", False, f"Expected 403 with 'Forbidden - admin only', got {response.status_code}")

def test_scenario_3_maintenance_reset(session, mongo_db):
    """
    Scenario 3: MAINTENANCE reset
    As admin with correct token+confirm -> 200
    Verify all collections are 0
    """
    print("\n" + "="*80)
    print("SCENARIO 3: MAINTENANCE reset")
    print("="*80)
    
    # Get counts BEFORE reset
    print("\n--- MongoDB counts BEFORE reset ---")
    counts_before = get_mongo_counts(mongo_db)
    for coll, count in counts_before.items():
        print(f"  {coll}: {count}")
    
    # Execute reset
    headers = {"Content-Type": "application/json", "Origin": "http://localhost:3000"}
    payload = {
        "token": "LPI-RESET-INV-2026-9f3a7c1e5b8d42a6",
        "confirm": "HAPUS-INVENTORY"
    }
    
    print("\n--- Executing reset ---")
    response = session.post(f"{BASE_URL}/maintenance/reset-inventory", json=payload, headers=headers)
    print(f"Response: {response.status_code}")
    
    if response.status_code != 200:
        log_test("Scenario 3: Reset execution", False, f"Expected 200, got {response.status_code}: {response.text[:500]}")
        return
    
    reset_data = response.json()
    print(f"Reset response: {json.dumps(reset_data, indent=2)}")
    
    # Verify response structure
    if not reset_data.get("ok"):
        log_test("Scenario 3: Reset response", False, "Response ok field is not true")
        return
    
    print(f"✓ Reset executed by: {reset_data.get('by')}")
    print(f"✓ Durable backup: {reset_data.get('durableBackup')}")
    
    # Wait for async operations
    time.sleep(1.0)
    
    # Get counts AFTER reset
    print("\n--- MongoDB counts AFTER reset ---")
    counts_after = get_mongo_counts(mongo_db)
    for coll, count in counts_after.items():
        print(f"  {coll}: {count}")
    
    # Verify all collections are 0
    all_zero = all(count == 0 for count in counts_after.values())
    
    if not all_zero:
        non_zero = {k: v for k, v in counts_after.items() if v != 0}
        log_test("Scenario 3: All collections zero", False, f"Some collections not zero: {non_zero}")
    else:
        print("✓ All MongoDB collections are 0")
    
    # Verify via API: GET /api/inventory/stocks -> 0 rows
    response = session.get(f"{BASE_URL}/inventory/stocks")
    if response.status_code != 200:
        log_test("Scenario 3: Verify stocks API", False, f"API returned {response.status_code}")
        return
    
    stocks = response.json().get("data", [])
    stocks_count = len(stocks)
    print(f"✓ GET /api/inventory/stocks: {stocks_count} rows")
    
    # Verify via API: GET /api/stock-ledger -> total 0
    response = session.get(f"{BASE_URL}/stock-ledger")
    if response.status_code != 200:
        log_test("Scenario 3: Verify ledger API", False, f"API returned {response.status_code}")
        return
    
    ledger_data = response.json().get("data", {})
    ledger_total = ledger_data.get("total", -1)
    print(f"✓ GET /api/stock-ledger total: {ledger_total}")
    
    # Final verification
    if all_zero and stocks_count == 0 and ledger_total == 0:
        log_test("Scenario 3: MAINTENANCE reset", True, 
                 "All collections wiped (Mongo=0, stocks API=0, ledger total=0)")
    else:
        log_test("Scenario 3: MAINTENANCE reset", False, 
                 f"Not all zero: Mongo all_zero={all_zero}, stocks={stocks_count}, ledger_total={ledger_total}")

def test_scenario_4_auth_regression(session):
    """
    Scenario 4: AUTH regression
    Confirm login still works after rate-limit config change
    """
    print("\n" + "="*80)
    print("SCENARIO 4: AUTH regression (rate-limit config)")
    print("="*80)
    
    # Login should already work (we're using the session), but let's verify a protected GET
    response = session.get(f"{BASE_URL}/inventory/stocks")
    
    if response.status_code == 200:
        log_test("Scenario 4: AUTH regression", True, 
                 "Login works, protected GET /api/inventory/stocks returns 200")
    elif response.status_code == 401:
        log_test("Scenario 4: AUTH regression", False, 
                 "Protected GET returned 401 - auth may be broken")
    else:
        log_test("Scenario 4: AUTH regression", False, 
                 f"Protected GET returned unexpected status: {response.status_code}")

def print_summary(mongo_db):
    """Print test summary"""
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    # MongoDB info
    print(f"\nMongoDB Database: {MONGO_DB_NAME}")
    counts = get_mongo_counts(mongo_db)
    for coll, count in counts.items():
        print(f"  {coll}: {count}")
    
    # Test results
    print(f"\nTest Results:")
    passed = sum(1 for t in test_results if t["passed"])
    total = len(test_results)
    print(f"  Passed: {passed}/{total}")
    
    for test in test_results:
        status = "✅" if test["passed"] else "❌"
        print(f"  {status} {test['name']}")
        if test["details"]:
            print(f"      {test['details']}")
    
    print("\n" + "="*80)

def main():
    """Main test execution"""
    print("="*80)
    print("MAINTENANCE Backend Test")
    print("stock_ledger reconcile-hydrate + reset-inventory + Better Auth rate-limit")
    print("="*80)
    
    # Login as admin
    admin_session = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_session:
        print("FATAL: Could not login as admin")
        return
    
    # Connect to MongoDB
    mongo_client, mongo_db = get_mongo_client()
    print(f"✓ Connected to MongoDB: {MONGO_DB_NAME}")
    
    # Get initial counts
    print("\n--- Initial MongoDB counts ---")
    initial_counts = get_mongo_counts(mongo_db)
    for coll, count in initial_counts.items():
        print(f"  {coll}: {count}")
    
    try:
        # Run scenarios
        # Scenario 1: REGRESSION - reconcile-hydrate (creates 3 tally inbounds)
        created_sessions = test_scenario_1_regression_reconcile_hydrate(admin_session, mongo_db)
        
        # Scenario 4: AUTH regression (before reset, to verify auth works)
        test_scenario_4_auth_regression(admin_session)
        
        # Scenario 2: MAINTENANCE guards
        test_scenario_2_maintenance_guards(admin_session, mongo_db)
        
        # Scenario 3: MAINTENANCE reset (this will wipe all data)
        test_scenario_3_maintenance_reset(admin_session, mongo_db)
        
        # Print summary
        print_summary(mongo_db)
        
    finally:
        # Close connections
        mongo_client.close()
        print("\n✓ MongoDB connection closed")

if __name__ == "__main__":
    main()
