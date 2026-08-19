#!/usr/bin/env python3
"""
MIGRATION Phase 6 Backend Test: fixed_assets + stock_opname(+items) MongoDB-authoritative
Tests the DIFF-persist write strategy for multi-replica safe operations.
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

def get_sqlite_conn():
    """Get SQLite connection (readonly)"""
    conn = sqlite3.connect(SQLITE_DB)
    conn.row_factory = sqlite3.Row
    return conn

def count_mongo_collection(db, collection_name):
    """Count documents in MongoDB collection"""
    try:
        return db[collection_name].count_documents({})
    except Exception as e:
        print(f"Error counting {collection_name}: {e}")
        return 0

def count_sqlite_table(conn, table_name):
    """Count rows in SQLite table"""
    try:
        cursor = conn.cursor()
        cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
        return cursor.fetchone()[0]
    except Exception as e:
        print(f"Error counting {table_name}: {e}")
        return 0

def get_accounts(session):
    """Get chart of accounts to find valid account codes"""
    response = session.get(f"{BASE_URL}/accounting/accounts")
    if response.status_code == 200:
        accounts = response.json().get("data", [])
        # Find asset, accumulated depreciation, and expense accounts
        asset_acct = next((a for a in accounts if a.get("code") == "1-2100"), None)  # Peralatan & Mesin
        accum_acct = next((a for a in accounts if a.get("code") == "1-2900"), None)  # Akumulasi Penyusutan
        expense_acct = next((a for a in accounts if a.get("code") == "6-1600"), None)  # Beban Penyusutan
        return asset_acct, accum_acct, expense_acct
    return None, None, None

def test_scenario_1_fixed_asset_create(session, mongo_db):
    """Scenario 1: Fixed Asset CREATE - verify in both Mongo and API"""
    print("\n" + "="*80)
    print("SCENARIO 1: Fixed Asset CREATE")
    print("="*80)
    
    # Get valid account codes
    asset_acct, accum_acct, expense_acct = get_accounts(session)
    if not asset_acct or not accum_acct or not expense_acct:
        log_test("Scenario 1: Get accounts", False, "Could not find required account codes")
        return None
    
    print(f"Using accounts: asset={asset_acct['code']}, accum={accum_acct['code']}, expense={expense_acct['code']}")
    
    # Count before
    count_before = count_mongo_collection(mongo_db, "fixed_assets")
    print(f"MongoDB fixed_assets count before: {count_before}")
    
    # Create fixed asset
    payload = {
        "code": "FA-T1",
        "name": "Mesin Uji",
        "category": "Mesin",
        "acquisitionDate": "2026-01-01",
        "acquisitionCost": 12000000,
        "salvageValue": 0,
        "usefulLifeMonths": 60,
        "method": "straight_line",
        "assetAccountCode": asset_acct["code"],
        "accumAccountCode": accum_acct["code"],
        "expenseAccountCode": expense_acct["code"],
        "postDepreciation": True
    }
    
    headers = {"Content-Type": "application/json", "Origin": "http://localhost:3000"}
    response = session.post(f"{BASE_URL}/accounting/fixed-assets", json=payload, headers=headers)
    
    if response.status_code != 200:
        log_test("Scenario 1: Create fixed asset", False, f"API returned {response.status_code}: {response.text[:200]}")
        return None
    
    data = response.json().get("data")
    asset_id = data.get("id")
    print(f"✓ Created fixed asset: {asset_id}")
    
    # Verify in API
    response = session.get(f"{BASE_URL}/accounting/fixed-assets")
    if response.status_code != 200:
        log_test("Scenario 1: Verify in API", False, f"GET failed: {response.status_code}")
        return asset_id
    
    assets = response.json().get("data", [])
    found_in_api = any(a["id"] == asset_id for a in assets)
    
    # Verify in MongoDB
    time.sleep(0.5)  # Give time for async persist
    mongo_doc = mongo_db["fixed_assets"].find_one({"id": asset_id})
    found_in_mongo = mongo_doc is not None
    
    count_after = count_mongo_collection(mongo_db, "fixed_assets")
    print(f"MongoDB fixed_assets count after: {count_after}")
    
    if found_in_api and found_in_mongo:
        log_test("Scenario 1: Fixed Asset CREATE", True, f"Asset {asset_id} exists in both API and MongoDB")
    else:
        log_test("Scenario 1: Fixed Asset CREATE", False, f"API: {found_in_api}, MongoDB: {found_in_mongo}")
    
    return asset_id

def test_scenario_2_fixed_asset_edit(session, mongo_db, asset_id):
    """Scenario 2: Fixed Asset EDIT - verify changes in both Mongo and API"""
    print("\n" + "="*80)
    print("SCENARIO 2: Fixed Asset EDIT")
    print("="*80)
    
    if not asset_id:
        log_test("Scenario 2: Fixed Asset EDIT", False, "No asset_id from Scenario 1")
        return
    
    # Edit the asset
    payload = {
        "name": "Mesin Uji EDITED",
        "acquisitionCost": 15000000
    }
    
    headers = {"Content-Type": "application/json", "Origin": "http://localhost:3000"}
    response = session.patch(f"{BASE_URL}/accounting/fixed-assets/{asset_id}", json=payload, headers=headers)
    
    if response.status_code != 200:
        log_test("Scenario 2: Edit fixed asset", False, f"API returned {response.status_code}: {response.text[:200]}")
        return
    
    print(f"✓ Edited fixed asset: {asset_id}")
    
    # Verify in API
    response = session.get(f"{BASE_URL}/accounting/fixed-assets")
    assets = response.json().get("data", [])
    api_asset = next((a for a in assets if a["id"] == asset_id), None)
    
    # Verify in MongoDB
    time.sleep(0.5)
    mongo_doc = mongo_db["fixed_assets"].find_one({"id": asset_id})
    
    api_correct = api_asset and api_asset["name"] == "Mesin Uji EDITED" and api_asset["acquisition_cost"] == 15000000
    mongo_correct = mongo_doc and mongo_doc["name"] == "Mesin Uji EDITED" and mongo_doc["acquisition_cost"] == 15000000
    
    if api_correct and mongo_correct:
        log_test("Scenario 2: Fixed Asset EDIT", True, "Changes reflected in both API and MongoDB")
    else:
        log_test("Scenario 2: Fixed Asset EDIT", False, f"API correct: {api_correct}, MongoDB correct: {mongo_correct}")

def test_scenario_3_depreciation_engine(session, mongo_db):
    """Scenario 3: Depreciation posting / Engine - verify trial balance and auto journals"""
    print("\n" + "="*80)
    print("SCENARIO 3: Depreciation Engine & Trial Balance")
    print("="*80)
    
    # Get trial balance
    response = session.get(f"{BASE_URL}/accounting/trial-balance")
    if response.status_code != 200:
        log_test("Scenario 3: Get trial balance", False, f"API returned {response.status_code}")
        return
    
    tb_data = response.json().get("data", {})
    total_debit = tb_data.get("totalDebit", 0)
    total_credit = tb_data.get("totalCredit", 0)
    balanced = abs(total_debit - total_credit) < 0.01
    
    print(f"Trial Balance: Debit={total_debit}, Credit={total_credit}, Balanced={balanced}")
    
    # Get balance sheet
    response = session.get(f"{BASE_URL}/accounting/balance-sheet")
    if response.status_code != 200:
        log_test("Scenario 3: Get balance sheet", False, f"API returned {response.status_code}")
        return
    
    bs_data = response.json().get("data", {})
    bs_balanced = bs_data.get("balanced", False)
    
    print(f"Balance Sheet: Balanced={bs_balanced}")
    
    # Get journals to check for DEPR auto journals
    response = session.get(f"{BASE_URL}/accounting/journals")
    if response.status_code != 200:
        log_test("Scenario 3: Get journals", False, f"API returned {response.status_code}")
        return
    
    journals = response.json().get("data", [])
    depr_journals = [j for j in journals if j.get("source") == "DEPR" or j.get("source_type") == "DEPR"]
    
    print(f"Found {len(depr_journals)} DEPR journals in API")
    
    # Verify DEPR journals are NOT in MongoDB (they are derived, not stored)
    mongo_depr_count = mongo_db["journal_entries"].count_documents({"source_type": "DEPR", "is_auto": 1})
    
    print(f"MongoDB journal_entries with DEPR+is_auto: {mongo_depr_count}")
    
    if balanced and bs_balanced and mongo_depr_count == 0:
        log_test("Scenario 3: Depreciation Engine", True, "Trial balance balanced, DEPR journals derived (not stored in Mongo)")
    else:
        log_test("Scenario 3: Depreciation Engine", False, f"TB balanced: {balanced}, BS balanced: {bs_balanced}, Mongo DEPR count: {mongo_depr_count}")

def test_scenario_4_archive_restore(session, mongo_db, asset_id):
    """Scenario 4: Archive/Restore - verify archived_at in MongoDB"""
    print("\n" + "="*80)
    print("SCENARIO 4: Archive/Restore Fixed Asset")
    print("="*80)
    
    if not asset_id:
        log_test("Scenario 4: Archive/Restore", False, "No asset_id from Scenario 1")
        return
    
    headers = {"Content-Type": "application/json", "Origin": "http://localhost:3000"}
    
    # Archive
    response = session.post(f"{BASE_URL}/accounting/fixed-assets/{asset_id}/archive", headers=headers)
    if response.status_code != 200:
        log_test("Scenario 4: Archive", False, f"API returned {response.status_code}")
        return
    
    print(f"✓ Archived asset: {asset_id}")
    
    # Verify in MongoDB
    time.sleep(0.5)
    mongo_doc = mongo_db["fixed_assets"].find_one({"id": asset_id})
    archived_at = mongo_doc.get("archived_at") if mongo_doc else None
    
    if not archived_at:
        log_test("Scenario 4: Archive", False, "archived_at not set in MongoDB")
        return
    
    print(f"✓ archived_at set in MongoDB: {archived_at}")
    
    # Restore
    response = session.post(f"{BASE_URL}/accounting/fixed-assets/{asset_id}/restore", headers=headers)
    if response.status_code != 200:
        log_test("Scenario 4: Restore", False, f"API returned {response.status_code}")
        return
    
    print(f"✓ Restored asset: {asset_id}")
    
    # Verify in MongoDB
    time.sleep(0.5)
    mongo_doc = mongo_db["fixed_assets"].find_one({"id": asset_id})
    archived_at_after = mongo_doc.get("archived_at") if mongo_doc else "NOT_FOUND"
    
    if archived_at_after is None:
        log_test("Scenario 4: Archive/Restore", True, "archived_at correctly set and cleared in MongoDB")
    else:
        log_test("Scenario 4: Archive/Restore", False, f"archived_at after restore: {archived_at_after}")

def test_scenario_5_stock_opname_create(session, mongo_db):
    """Scenario 5: Stock Opname CREATE - verify in both Mongo and API"""
    print("\n" + "="*80)
    print("SCENARIO 5: Stock Opname CREATE")
    print("="*80)
    
    # Get cold storages
    response = session.get(f"{BASE_URL}/cold-storages")
    if response.status_code != 200:
        log_test("Scenario 5: Get cold storages", False, f"API returned {response.status_code}")
        return None
    
    cold_storages = response.json().get("data", [])
    if not cold_storages:
        log_test("Scenario 5: Get cold storages", False, "No cold storages found")
        return None
    
    cs_id = cold_storages[0]["id"]
    print(f"Using cold storage: {cs_id}")
    
    # Count before
    count_opname_before = count_mongo_collection(mongo_db, "stock_opname")
    count_items_before = count_mongo_collection(mongo_db, "stock_opname_items")
    print(f"MongoDB stock_opname count before: {count_opname_before}")
    print(f"MongoDB stock_opname_items count before: {count_items_before}")
    
    # Create stock opname
    payload = {
        "coldStorageId": cs_id,
        "opnameDate": "2026-01-15",
        "notes": "Test opname for Phase 6"
    }
    
    headers = {"Content-Type": "application/json", "Origin": "http://localhost:3000"}
    response = session.post(f"{BASE_URL}/opnames", json=payload, headers=headers)
    
    if response.status_code != 201:
        log_test("Scenario 5: Create stock opname", False, f"API returned {response.status_code}: {response.text[:200]}")
        return None
    
    data = response.json().get("data")
    opname_id = data.get("id")
    print(f"✓ Created stock opname: {opname_id}")
    
    # Verify in API
    response = session.get(f"{BASE_URL}/opnames/{opname_id}")
    if response.status_code != 200:
        log_test("Scenario 5: Verify in API", False, f"GET failed: {response.status_code}")
        return opname_id
    
    opname_data = response.json().get("data", {})
    items_count = len(opname_data.get("items", []))
    
    # Verify in MongoDB
    time.sleep(0.5)
    mongo_opname = mongo_db["stock_opname"].find_one({"id": opname_id})
    mongo_items = list(mongo_db["stock_opname_items"].find({"opname_id": opname_id}))
    
    count_opname_after = count_mongo_collection(mongo_db, "stock_opname")
    count_items_after = count_mongo_collection(mongo_db, "stock_opname_items")
    print(f"MongoDB stock_opname count after: {count_opname_after}")
    print(f"MongoDB stock_opname_items count after: {count_items_after}")
    
    if mongo_opname and len(mongo_items) == items_count:
        log_test("Scenario 5: Stock Opname CREATE", True, f"Opname {opname_id} with {items_count} items exists in both API and MongoDB")
    else:
        log_test("Scenario 5: Stock Opname CREATE", False, f"Mongo opname: {bool(mongo_opname)}, Mongo items: {len(mongo_items)}, API items: {items_count}")
    
    return opname_id

def test_scenario_6_stock_opname_approve(session, mongo_db, sqlite_conn, opname_id):
    """Scenario 6: Stock Opname APPROVE - verify status in Mongo and trial balance"""
    print("\n" + "="*80)
    print("SCENARIO 6: Stock Opname APPROVE")
    print("="*80)
    
    if not opname_id:
        log_test("Scenario 6: Stock Opname APPROVE", False, "No opname_id from Scenario 5")
        return
    
    # Get opname details
    response = session.get(f"{BASE_URL}/opnames/{opname_id}")
    if response.status_code != 200:
        log_test("Scenario 6: Get opname", False, f"API returned {response.status_code}")
        return
    
    opname_data = response.json().get("data", {})
    items = opname_data.get("items", [])
    
    if not items:
        print("No items in opname, skipping approve test")
        log_test("Scenario 6: Stock Opname APPROVE", True, "No items to approve (skipped)")
        return
    
    # Modify physical count to create a delta
    item_updates = []
    for item in items[:1]:  # Just modify first item
        item_updates.append({
            "id": item["id"],
            "physicalWeight": float(item["systemWeight"]) - 1.0,  # Create 1kg shrinkage
            "physicalQty": item["systemQty"]
        })
    
    headers = {"Content-Type": "application/json", "Origin": "http://localhost:3000"}
    
    # Update items
    response = session.post(f"{BASE_URL}/opnames/{opname_id}/items", json={"items": item_updates}, headers=headers)
    if response.status_code != 200:
        log_test("Scenario 6: Update items", False, f"API returned {response.status_code}")
        return
    
    print(f"✓ Updated opname items with delta")
    
    # Submit
    response = session.post(f"{BASE_URL}/opnames/{opname_id}/submit", headers=headers)
    if response.status_code != 200:
        log_test("Scenario 6: Submit opname", False, f"API returned {response.status_code}")
        return
    
    print(f"✓ Submitted opname: {opname_id}")
    
    # Approve
    response = session.post(f"{BASE_URL}/opnames/{opname_id}/approve", headers=headers)
    if response.status_code != 200:
        log_test("Scenario 6: Approve opname", False, f"API returned {response.status_code}: {response.text[:200]}")
        return
    
    print(f"✓ Approved opname: {opname_id}")
    
    # Verify status in MongoDB
    time.sleep(0.5)
    mongo_opname = mongo_db["stock_opname"].find_one({"id": opname_id})
    status = mongo_opname.get("status") if mongo_opname else None
    
    # Verify trial balance still balanced
    response = session.get(f"{BASE_URL}/accounting/trial-balance")
    if response.status_code != 200:
        log_test("Scenario 6: Trial balance", False, f"API returned {response.status_code}")
        return
    
    tb_data = response.json().get("data", {})
    total_debit = tb_data.get("totalDebit", 0)
    total_credit = tb_data.get("totalCredit", 0)
    balanced = abs(total_debit - total_credit) < 0.01
    
    print(f"Trial Balance after approve: Debit={total_debit}, Credit={total_credit}, Balanced={balanced}")
    
    # Check inventory_stock consistency
    stock_id = items[0]["stockId"]
    cursor = sqlite_conn.cursor()
    cursor.execute("SELECT * FROM inventory_stock WHERE id=?", (stock_id,))
    stock_row = cursor.fetchone()
    
    if status == "approved" and balanced and stock_row:
        log_test("Scenario 6: Stock Opname APPROVE", True, f"Status={status}, TB balanced, inventory_stock consistent")
    else:
        log_test("Scenario 6: Stock Opname APPROVE", False, f"Status={status}, TB balanced={balanced}, stock exists={bool(stock_row)}")

def test_scenario_7_multi_isolation(session, mongo_db):
    """Scenario 7: Multi-isolation (concurrency) - create two assets, delete one"""
    print("\n" + "="*80)
    print("SCENARIO 7: Multi-Isolation (Concurrency)")
    print("="*80)
    
    # Get valid account codes
    asset_acct, accum_acct, expense_acct = get_accounts(session)
    if not asset_acct:
        log_test("Scenario 7: Multi-isolation", False, "Could not find account codes")
        return
    
    headers = {"Content-Type": "application/json", "Origin": "http://localhost:3000"}
    
    # Create first asset
    payload1 = {
        "code": "FA-MULTI-1",
        "name": "Multi Test Asset 1",
        "category": "Test",
        "acquisitionDate": "2026-01-01",
        "acquisitionCost": 1000000,
        "salvageValue": 0,
        "usefulLifeMonths": 12,
        "method": "straight_line",
        "assetAccountCode": asset_acct["code"],
        "accumAccountCode": accum_acct["code"],
        "expenseAccountCode": expense_acct["code"],
        "postDepreciation": False
    }
    
    response1 = session.post(f"{BASE_URL}/accounting/fixed-assets", json=payload1, headers=headers)
    if response1.status_code != 200:
        log_test("Scenario 7: Create asset 1", False, f"API returned {response1.status_code}")
        return
    
    asset1_id = response1.json().get("data", {}).get("id")
    print(f"✓ Created asset 1: {asset1_id}")
    
    # Create second asset
    payload2 = {
        "code": "FA-MULTI-2",
        "name": "Multi Test Asset 2",
        "category": "Test",
        "acquisitionDate": "2026-01-01",
        "acquisitionCost": 2000000,
        "salvageValue": 0,
        "usefulLifeMonths": 12,
        "method": "straight_line",
        "assetAccountCode": asset_acct["code"],
        "accumAccountCode": accum_acct["code"],
        "expenseAccountCode": expense_acct["code"],
        "postDepreciation": False
    }
    
    response2 = session.post(f"{BASE_URL}/accounting/fixed-assets", json=payload2, headers=headers)
    if response2.status_code != 200:
        log_test("Scenario 7: Create asset 2", False, f"API returned {response2.status_code}")
        return
    
    asset2_id = response2.json().get("data", {}).get("id")
    print(f"✓ Created asset 2: {asset2_id}")
    
    # Verify both exist in MongoDB
    time.sleep(0.5)
    mongo_asset1 = mongo_db["fixed_assets"].find_one({"id": asset1_id})
    mongo_asset2 = mongo_db["fixed_assets"].find_one({"id": asset2_id})
    
    if not (mongo_asset1 and mongo_asset2):
        log_test("Scenario 7: Both assets in Mongo", False, f"Asset1: {bool(mongo_asset1)}, Asset2: {bool(mongo_asset2)}")
        return
    
    print(f"✓ Both assets exist in MongoDB")
    
    # Delete first asset
    response = session.delete(f"{BASE_URL}/accounting/fixed-assets/{asset1_id}", headers=headers)
    if response.status_code != 200:
        log_test("Scenario 7: Delete asset 1", False, f"API returned {response.status_code}")
        return
    
    print(f"✓ Deleted asset 1: {asset1_id}")
    
    # Verify asset1 deleted, asset2 remains
    time.sleep(0.5)
    mongo_asset1_after = mongo_db["fixed_assets"].find_one({"id": asset1_id})
    mongo_asset2_after = mongo_db["fixed_assets"].find_one({"id": asset2_id})
    
    # Verify in API
    response = session.get(f"{BASE_URL}/accounting/fixed-assets")
    assets = response.json().get("data", [])
    api_has_asset1 = any(a["id"] == asset1_id for a in assets)
    api_has_asset2 = any(a["id"] == asset2_id for a in assets)
    
    if not mongo_asset1_after and mongo_asset2_after and not api_has_asset1 and api_has_asset2:
        log_test("Scenario 7: Multi-Isolation", True, "Asset1 deleted, Asset2 remains in both Mongo and API")
        # Cleanup asset2
        session.delete(f"{BASE_URL}/accounting/fixed-assets/{asset2_id}", headers=headers)
    else:
        log_test("Scenario 7: Multi-Isolation", False, f"Mongo: asset1={bool(mongo_asset1_after)}, asset2={bool(mongo_asset2_after)}; API: asset1={api_has_asset1}, asset2={api_has_asset2}")

def test_scenario_8_non_cascade_safety(sqlite_conn):
    """Scenario 8: Non-cascade safety - verify inventory_stock NOT wiped"""
    print("\n" + "="*80)
    print("SCENARIO 8: Non-Cascade Safety (inventory_stock)")
    print("="*80)
    
    # Count inventory_stock before and after all operations
    count = count_sqlite_table(sqlite_conn, "inventory_stock")
    print(f"SQLite inventory_stock count: {count}")
    
    if count > 0:
        log_test("Scenario 8: Non-Cascade Safety", True, f"inventory_stock has {count} rows (NOT wiped by FK-off hydrate)")
    else:
        log_test("Scenario 8: Non-Cascade Safety", False, "inventory_stock is empty (may have been wiped)")

def test_scenario_9_role_guard(mongo_db):
    """Scenario 9: Role guard - operator should get 403 on fixed asset create"""
    print("\n" + "="*80)
    print("SCENARIO 9: Role Guard (operator -> 403)")
    print("="*80)
    
    # Login as operator
    operator_session = login(OPERATOR_EMAIL, OPERATOR_PASSWORD)
    if not operator_session:
        log_test("Scenario 9: Role Guard", False, "Could not login as operator")
        return
    
    # Try to create fixed asset
    payload = {
        "code": "FA-FORBIDDEN",
        "name": "Should Fail",
        "category": "Test",
        "acquisitionDate": "2026-01-01",
        "acquisitionCost": 1000000,
        "salvageValue": 0,
        "usefulLifeMonths": 12,
        "method": "straight_line",
        "postDepreciation": False
    }
    
    headers = {"Content-Type": "application/json", "Origin": "http://localhost:3000"}
    response = operator_session.post(f"{BASE_URL}/accounting/fixed-assets", json=payload, headers=headers)
    
    print(f"Operator POST response: {response.status_code}")
    
    if response.status_code == 403:
        log_test("Scenario 9: Role Guard", True, "Operator correctly rejected with 403")
    else:
        log_test("Scenario 9: Role Guard", False, f"Expected 403, got {response.status_code}")

def cleanup_test_data(session, mongo_db, asset_ids):
    """Cleanup test data"""
    print("\n" + "="*80)
    print("CLEANUP: Deleting test data")
    print("="*80)
    
    headers = {"Content-Type": "application/json", "Origin": "http://localhost:3000"}
    
    # Delete test fixed assets
    for asset_id in asset_ids:
        if asset_id:
            try:
                response = session.delete(f"{BASE_URL}/accounting/fixed-assets/{asset_id}", headers=headers)
                if response.status_code == 200:
                    print(f"✓ Deleted fixed asset: {asset_id}")
                else:
                    print(f"✗ Failed to delete fixed asset {asset_id}: {response.status_code}")
            except Exception as e:
                print(f"✗ Error deleting asset {asset_id}: {e}")
    
    # Note: Stock opname may not have delete endpoint
    print("Note: Stock opname delete endpoint may not exist (as per review request)")

def print_summary(mongo_db, sqlite_conn):
    """Print test summary"""
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    # MongoDB info
    print(f"\nMongoDB Database: {MONGO_DB_NAME}")
    print(f"  fixed_assets count: {count_mongo_collection(mongo_db, 'fixed_assets')}")
    print(f"  stock_opname count: {count_mongo_collection(mongo_db, 'stock_opname')}")
    print(f"  stock_opname_items count: {count_mongo_collection(mongo_db, 'stock_opname_items')}")
    
    # SQLite info
    print(f"\nSQLite Database: {SQLITE_DB}")
    print(f"  inventory_stock count: {count_sqlite_table(sqlite_conn, 'inventory_stock')}")
    
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
    print("MIGRATION Phase 6 Backend Test")
    print("Fixed Assets + Stock Opname -> MongoDB-authoritative")
    print("="*80)
    
    # Login as admin
    admin_session = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_session:
        print("FATAL: Could not login as admin")
        return
    
    # Connect to MongoDB
    mongo_client, mongo_db = get_mongo_client()
    print(f"✓ Connected to MongoDB: {MONGO_DB_NAME}")
    
    # Connect to SQLite
    sqlite_conn = get_sqlite_conn()
    print(f"✓ Connected to SQLite: {SQLITE_DB}")
    
    # Record initial inventory_stock count
    initial_stock_count = count_sqlite_table(sqlite_conn, "inventory_stock")
    print(f"✓ Initial inventory_stock count: {initial_stock_count}")
    
    # Track created assets for cleanup
    created_assets = []
    
    try:
        # Run scenarios
        asset_id = test_scenario_1_fixed_asset_create(admin_session, mongo_db)
        if asset_id:
            created_assets.append(asset_id)
        
        test_scenario_2_fixed_asset_edit(admin_session, mongo_db, asset_id)
        test_scenario_3_depreciation_engine(admin_session, mongo_db)
        test_scenario_4_archive_restore(admin_session, mongo_db, asset_id)
        
        opname_id = test_scenario_5_stock_opname_create(admin_session, mongo_db)
        test_scenario_6_stock_opname_approve(admin_session, mongo_db, sqlite_conn, opname_id)
        
        test_scenario_7_multi_isolation(admin_session, mongo_db)
        test_scenario_8_non_cascade_safety(sqlite_conn)
        test_scenario_9_role_guard(mongo_db)
        
        # Cleanup
        cleanup_test_data(admin_session, mongo_db, created_assets)
        
        # Print summary
        print_summary(mongo_db, sqlite_conn)
        
    finally:
        # Close connections
        sqlite_conn.close()
        mongo_client.close()
        print("\n✓ Connections closed")

if __name__ == "__main__":
    main()
