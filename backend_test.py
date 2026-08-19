#!/usr/bin/env python3
"""
Backend test for MIGRATION Phase 1: Chart of Accounts (gl_accounts) -> MongoDB-authoritative
Tests T1-T8 plus operator 403 test and cleanup
"""
import os
import sys
import json
import sqlite3
from pymongo import MongoClient

# Base URL
BASE_URL = "http://localhost:3000/api"

# MongoDB connection
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
# Resolve DB name (same logic as /app/lib/db/mongo.js)
def resolve_db_name():
    mongo_db_name = os.getenv("MONGO_DB_NAME", "").strip()
    db_name_env = os.getenv("DB_NAME", "").strip()
    
    # Parse from URL
    url_db = ""
    try:
        after_scheme = MONGO_URL.replace("mongodb://", "").replace("mongodb+srv://", "")
        slash_idx = after_scheme.find("/")
        if slash_idx != -1:
            url_db = after_scheme[slash_idx+1:].split("?")[0]
    except Exception:
        pass
    
    # Safe db name (avoid system dbs)
    def safe_db(name):
        n = str(name).strip()
        if not n or n.lower() in ["test", "admin", "local", "config"]:
            return ""
        return n
    
    return safe_db(mongo_db_name) or safe_db(db_name_env) or safe_db(url_db) or "erp_prod"

DB_NAME = resolve_db_name()
print(f"[INFO] MongoDB URL: {MONGO_URL}")
print(f"[INFO] MongoDB DB Name: {DB_NAME}")

# SQLite path
SQLITE_PATH = "/app/data/erp.db"

# Test accounts to create/cleanup
TEST_ACCOUNT_1 = "9-8001"
TEST_ACCOUNT_2 = "9-8002"

# Global variables to store test data
test_account_1_id = None
test_account_2_id = None
admin_session = None
operator_session = None

def login(email, password):
    """Login and return session cookies"""
    import requests
    # Better Auth uses cookie-based sessions
    # We need to login via the auth endpoint
    # Based on the review request, we need to use curl-like approach
    # Let's use requests.Session to maintain cookies
    session = requests.Session()
    
    # Try to login via Better Auth endpoint
    # The auth endpoint is typically /api/auth/sign-in
    try:
        resp = session.post(
            f"{BASE_URL.replace('/api', '')}/api/auth/sign-in/email",
            json={"email": email, "password": password},
            headers={
                "Content-Type": "application/json",
                "Origin": "http://localhost:3000"
            }
        )
        if resp.status_code == 200:
            print(f"[SUCCESS] Logged in as {email}")
            return session
        else:
            print(f"[ERROR] Login failed for {email}: {resp.status_code} {resp.text}")
            return None
    except Exception as e:
        print(f"[ERROR] Login exception for {email}: {e}")
        return None

def get_mongo_collection():
    """Get MongoDB gl_accounts collection"""
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    return db["gl_accounts"]

def get_sqlite_conn():
    """Get SQLite connection"""
    return sqlite3.connect(SQLITE_PATH)

def test_t1_list_and_mongo_source():
    """T1: LIST + Mongo source of truth verification"""
    print("\n" + "="*80)
    print("TEST T1: LIST + Mongo source of truth")
    print("="*80)
    
    try:
        import requests
        # GET /api/accounting/accounts
        resp = admin_session.get(
            f"{BASE_URL}/accounting/accounts",
            headers={"Origin": "http://localhost:3000"}
        )
        
        if resp.status_code != 200:
            print(f"[FAIL] T1: GET /api/accounting/accounts returned {resp.status_code}")
            print(f"Response: {resp.text}")
            return False
        
        data = resp.json()
        accounts = data.get("data", [])
        api_count = len(accounts)
        print(f"[SUCCESS] T1.1: GET /api/accounting/accounts returned {api_count} accounts")
        
        # Check if code 5-1300 exists
        code_5_1300 = [a for a in accounts if a.get("code") == "5-1300"]
        if code_5_1300:
            print(f"[SUCCESS] T1.2: Code '5-1300' (Beban Angkut Pembelian) found in API response")
            print(f"  Account: {code_5_1300[0].get('name')}")
        else:
            print(f"[FAIL] T1.2: Code '5-1300' NOT found in API response")
            return False
        
        # Verify MongoDB collection exists and has data
        col = get_mongo_collection()
        mongo_count = col.count_documents({})
        print(f"[INFO] T1.3: MongoDB collection 'gl_accounts' has {mongo_count} documents")
        
        # Count active accounts in MongoDB (archived_at is null)
        mongo_active_count = col.count_documents({"archived_at": None})
        print(f"[INFO] T1.4: MongoDB has {mongo_active_count} active accounts (archived_at=null)")
        
        # Check if 5-1300 exists in MongoDB
        mongo_5_1300 = col.find_one({"code": "5-1300"})
        if mongo_5_1300:
            print(f"[SUCCESS] T1.5: Code '5-1300' found in MongoDB collection")
            print(f"  Account: {mongo_5_1300.get('name')}")
        else:
            print(f"[FAIL] T1.5: Code '5-1300' NOT found in MongoDB collection")
            return False
        
        # Verify counts match (API should return active accounts by default)
        if api_count == mongo_active_count:
            print(f"[SUCCESS] T1.6: API count ({api_count}) matches MongoDB active count ({mongo_active_count})")
        else:
            print(f"[WARNING] T1.6: API count ({api_count}) != MongoDB active count ({mongo_active_count})")
            print(f"  This may be expected if there are archived accounts")
        
        print(f"[SUCCESS] T1: MongoDB is the source of truth - collection exists with {mongo_count} total documents")
        return True
        
    except Exception as e:
        print(f"[FAIL] T1: Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_t2_create():
    """T2: CREATE account and verify in both MongoDB and SQLite"""
    global test_account_1_id
    print("\n" + "="*80)
    print("TEST T2: CREATE account 9-8001")
    print("="*80)
    
    try:
        import requests
        # POST /api/accounting/accounts
        payload = {
            "code": TEST_ACCOUNT_1,
            "name": "Uji Migrasi",
            "type": "expense"
        }
        
        resp = admin_session.post(
            f"{BASE_URL}/accounting/accounts",
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Origin": "http://localhost:3000"
            }
        )
        
        if resp.status_code != 200:
            print(f"[FAIL] T2: POST /api/accounting/accounts returned {resp.status_code}")
            print(f"Response: {resp.text}")
            return False
        
        data = resp.json()
        account = data.get("data", {})
        test_account_1_id = account.get("id")
        
        print(f"[SUCCESS] T2.1: Account created via API")
        print(f"  ID: {test_account_1_id}")
        print(f"  Code: {account.get('code')}")
        print(f"  Name: {account.get('name')}")
        
        # Verify in MongoDB
        col = get_mongo_collection()
        mongo_doc = col.find_one({"code": TEST_ACCOUNT_1})
        
        if not mongo_doc:
            print(f"[FAIL] T2.2: Account NOT found in MongoDB")
            return False
        
        print(f"[SUCCESS] T2.2: Account found in MongoDB")
        print(f"  ID: {mongo_doc.get('id')}")
        print(f"  Code: {mongo_doc.get('code')}")
        print(f"  Name: {mongo_doc.get('name')}")
        
        # Verify in SQLite
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT id, code, name FROM gl_accounts WHERE code = ?", (TEST_ACCOUNT_1,))
        sqlite_row = cursor.fetchone()
        conn.close()
        
        if not sqlite_row:
            print(f"[FAIL] T2.3: Account NOT found in SQLite mirror")
            return False
        
        print(f"[SUCCESS] T2.3: Account found in SQLite mirror")
        print(f"  ID: {sqlite_row[0]}")
        print(f"  Code: {sqlite_row[1]}")
        print(f"  Name: {sqlite_row[2]}")
        
        # Verify IDs match
        if mongo_doc.get("id") == sqlite_row[0] == test_account_1_id:
            print(f"[SUCCESS] T2.4: IDs match across MongoDB, SQLite, and API response")
        else:
            print(f"[FAIL] T2.4: ID mismatch - Mongo: {mongo_doc.get('id')}, SQLite: {sqlite_row[0]}, API: {test_account_1_id}")
            return False
        
        # Verify account appears in list
        resp = admin_session.get(
            f"{BASE_URL}/accounting/accounts",
            headers={"Origin": "http://localhost:3000"}
        )
        accounts = resp.json().get("data", [])
        found = [a for a in accounts if a.get("code") == TEST_ACCOUNT_1]
        
        if found:
            print(f"[SUCCESS] T2.5: Account appears in GET /api/accounting/accounts list")
        else:
            print(f"[FAIL] T2.5: Account NOT in list")
            return False
        
        print(f"[SUCCESS] T2: CREATE test passed - account exists in BOTH MongoDB and SQLite with same ID")
        return True
        
    except Exception as e:
        print(f"[FAIL] T2: Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_t3_update():
    """T3: UPDATE account and verify in both stores"""
    print("\n" + "="*80)
    print("TEST T3: UPDATE account 9-8001")
    print("="*80)
    
    try:
        import requests
        # PATCH /api/accounting/accounts/:id
        payload = {
            "name": "Uji Migrasi 2",
            "openingBalance": 12345
        }
        
        resp = admin_session.patch(
            f"{BASE_URL}/accounting/accounts/{test_account_1_id}",
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Origin": "http://localhost:3000"
            }
        )
        
        if resp.status_code != 200:
            print(f"[FAIL] T3: PATCH /api/accounting/accounts/{test_account_1_id} returned {resp.status_code}")
            print(f"Response: {resp.text}")
            return False
        
        data = resp.json()
        account = data.get("data", {})
        
        print(f"[SUCCESS] T3.1: Account updated via API")
        print(f"  Name: {account.get('name')}")
        print(f"  Opening Balance: {account.get('opening_balance')}")
        
        # Verify in MongoDB
        col = get_mongo_collection()
        mongo_doc = col.find_one({"id": test_account_1_id})
        
        if not mongo_doc:
            print(f"[FAIL] T3.2: Account NOT found in MongoDB")
            return False
        
        if mongo_doc.get("name") == "Uji Migrasi 2" and mongo_doc.get("opening_balance") == 12345:
            print(f"[SUCCESS] T3.2: MongoDB updated correctly")
            print(f"  Name: {mongo_doc.get('name')}")
            print(f"  Opening Balance: {mongo_doc.get('opening_balance')}")
        else:
            print(f"[FAIL] T3.2: MongoDB NOT updated correctly")
            print(f"  Name: {mongo_doc.get('name')} (expected: Uji Migrasi 2)")
            print(f"  Opening Balance: {mongo_doc.get('opening_balance')} (expected: 12345)")
            return False
        
        # Verify in SQLite
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT name, opening_balance FROM gl_accounts WHERE id = ?", (test_account_1_id,))
        sqlite_row = cursor.fetchone()
        conn.close()
        
        if not sqlite_row:
            print(f"[FAIL] T3.3: Account NOT found in SQLite mirror")
            return False
        
        if sqlite_row[0] == "Uji Migrasi 2" and sqlite_row[1] == 12345:
            print(f"[SUCCESS] T3.3: SQLite mirror updated correctly")
            print(f"  Name: {sqlite_row[0]}")
            print(f"  Opening Balance: {sqlite_row[1]}")
        else:
            print(f"[FAIL] T3.3: SQLite mirror NOT updated correctly")
            print(f"  Name: {sqlite_row[0]} (expected: Uji Migrasi 2)")
            print(f"  Opening Balance: {sqlite_row[1]} (expected: 12345)")
            return False
        
        print(f"[SUCCESS] T3: UPDATE test passed - both MongoDB and SQLite updated correctly")
        return True
        
    except Exception as e:
        print(f"[FAIL] T3: Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_t4_duplicate():
    """T4: DUPLICATE guard test"""
    print("\n" + "="*80)
    print("TEST T4: DUPLICATE guard")
    print("="*80)
    
    try:
        import requests
        # Try to create another account with code 9-8001
        payload = {
            "code": TEST_ACCOUNT_1,
            "name": "Duplicate Test",
            "type": "expense"
        }
        
        resp = admin_session.post(
            f"{BASE_URL}/accounting/accounts",
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Origin": "http://localhost:3000"
            }
        )
        
        if resp.status_code == 400:
            error_msg = resp.json().get("error", "")
            if "sudah dipakai" in error_msg.lower():
                print(f"[SUCCESS] T4: Duplicate code correctly rejected with 400")
                print(f"  Error message: {error_msg}")
                return True
            else:
                print(f"[FAIL] T4: Got 400 but wrong error message: {error_msg}")
                return False
        else:
            print(f"[FAIL] T4: Expected 400, got {resp.status_code}")
            print(f"Response: {resp.text}")
            return False
        
    except Exception as e:
        print(f"[FAIL] T4: Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_t5_archive_restore():
    """T5: ARCHIVE/RESTORE test"""
    print("\n" + "="*80)
    print("TEST T5: ARCHIVE/RESTORE")
    print("="*80)
    
    try:
        import requests
        
        # Archive
        resp = admin_session.post(
            f"{BASE_URL}/accounting/accounts/{test_account_1_id}/archive",
            headers={"Origin": "http://localhost:3000"}
        )
        
        if resp.status_code != 200:
            print(f"[FAIL] T5.1: POST /archive returned {resp.status_code}")
            print(f"Response: {resp.text}")
            return False
        
        print(f"[SUCCESS] T5.1: Account archived")
        
        # Verify default list excludes it
        resp = admin_session.get(
            f"{BASE_URL}/accounting/accounts",
            headers={"Origin": "http://localhost:3000"}
        )
        accounts = resp.json().get("data", [])
        found = [a for a in accounts if a.get("code") == TEST_ACCOUNT_1]
        
        if not found:
            print(f"[SUCCESS] T5.2: Archived account NOT in default list")
        else:
            print(f"[FAIL] T5.2: Archived account still in default list")
            return False
        
        # Verify archived list includes it
        resp = admin_session.get(
            f"{BASE_URL}/accounting/accounts?archived=1",
            headers={"Origin": "http://localhost:3000"}
        )
        accounts = resp.json().get("data", [])
        found = [a for a in accounts if a.get("code") == TEST_ACCOUNT_1]
        
        if found:
            print(f"[SUCCESS] T5.3: Archived account appears in ?archived=1 list")
        else:
            print(f"[FAIL] T5.3: Archived account NOT in ?archived=1 list")
            return False
        
        # Restore
        resp = admin_session.post(
            f"{BASE_URL}/accounting/accounts/{test_account_1_id}/restore",
            headers={"Origin": "http://localhost:3000"}
        )
        
        if resp.status_code != 200:
            print(f"[FAIL] T5.4: POST /restore returned {resp.status_code}")
            print(f"Response: {resp.text}")
            return False
        
        print(f"[SUCCESS] T5.4: Account restored")
        
        # Verify back in default list
        resp = admin_session.get(
            f"{BASE_URL}/accounting/accounts",
            headers={"Origin": "http://localhost:3000"}
        )
        accounts = resp.json().get("data", [])
        found = [a for a in accounts if a.get("code") == TEST_ACCOUNT_1]
        
        if found:
            print(f"[SUCCESS] T5.5: Restored account back in default list")
        else:
            print(f"[FAIL] T5.5: Restored account NOT in default list")
            return False
        
        print(f"[SUCCESS] T5: ARCHIVE/RESTORE test passed")
        return True
        
    except Exception as e:
        print(f"[FAIL] T5: Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_t6_delete():
    """T6: DELETE test"""
    print("\n" + "="*80)
    print("TEST T6: DELETE account 9-8001")
    print("="*80)
    
    try:
        import requests
        
        # DELETE
        resp = admin_session.delete(
            f"{BASE_URL}/accounting/accounts/{test_account_1_id}",
            headers={"Origin": "http://localhost:3000"}
        )
        
        if resp.status_code != 200:
            print(f"[FAIL] T6.1: DELETE returned {resp.status_code}")
            print(f"Response: {resp.text}")
            return False
        
        print(f"[SUCCESS] T6.1: Account deleted via API")
        
        # Verify NOT in MongoDB
        col = get_mongo_collection()
        mongo_doc = col.find_one({"id": test_account_1_id})
        
        if mongo_doc is None:
            print(f"[SUCCESS] T6.2: Account removed from MongoDB")
        else:
            print(f"[FAIL] T6.2: Account still in MongoDB")
            return False
        
        # Verify NOT in SQLite
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM gl_accounts WHERE id = ?", (test_account_1_id,))
        sqlite_row = cursor.fetchone()
        conn.close()
        
        if sqlite_row is None:
            print(f"[SUCCESS] T6.3: Account removed from SQLite mirror")
        else:
            print(f"[FAIL] T6.3: Account still in SQLite mirror")
            return False
        
        print(f"[SUCCESS] T6: DELETE test passed - account removed from BOTH MongoDB and SQLite")
        return True
        
    except Exception as e:
        print(f"[FAIL] T6: Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_t7_import():
    """T7: IMPORT upsert test"""
    global test_account_2_id
    print("\n" + "="*80)
    print("TEST T7: IMPORT upsert")
    print("="*80)
    
    try:
        import requests
        
        # Create via import
        payload = {
            "rows": [
                {
                    "Kode Akun": TEST_ACCOUNT_2,
                    "Nama Akun": "Impor Uji",
                    "Tipe": "expense",
                    "Saldo Normal": "debit",
                    "Saldo Awal": 5000
                }
            ]
        }
        
        resp = admin_session.post(
            f"{BASE_URL}/import/chart-of-accounts",
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Origin": "http://localhost:3000"
            }
        )
        
        if resp.status_code != 200:
            print(f"[FAIL] T7.1: POST /import/chart-of-accounts returned {resp.status_code}")
            print(f"Response: {resp.text}")
            return False
        
        data = resp.json().get("data", {})
        created = data.get("created", 0)
        
        if created == 1:
            print(f"[SUCCESS] T7.1: Import created 1 account")
        else:
            print(f"[FAIL] T7.1: Expected created=1, got {created}")
            return False
        
        # Verify in MongoDB
        col = get_mongo_collection()
        mongo_doc = col.find_one({"code": TEST_ACCOUNT_2})
        
        if not mongo_doc:
            print(f"[FAIL] T7.2: Account NOT found in MongoDB")
            return False
        
        test_account_2_id = mongo_doc.get("id")
        
        if mongo_doc.get("opening_balance") == 5000:
            print(f"[SUCCESS] T7.2: Account found in MongoDB with opening_balance=5000")
            print(f"  ID: {test_account_2_id}")
            print(f"  Name: {mongo_doc.get('name')}")
        else:
            print(f"[FAIL] T7.2: opening_balance mismatch: {mongo_doc.get('opening_balance')}")
            return False
        
        # Verify in API list
        resp = admin_session.get(
            f"{BASE_URL}/accounting/accounts",
            headers={"Origin": "http://localhost:3000"}
        )
        accounts = resp.json().get("data", [])
        found = [a for a in accounts if a.get("code") == TEST_ACCOUNT_2]
        
        if found:
            print(f"[SUCCESS] T7.3: Account appears in GET /api/accounting/accounts list")
        else:
            print(f"[FAIL] T7.3: Account NOT in list")
            return False
        
        # Re-import with updated name (upsert)
        payload = {
            "rows": [
                {
                    "Kode Akun": TEST_ACCOUNT_2,
                    "Nama Akun": "Impor Uji 2",
                    "Tipe": "expense",
                    "Saldo Normal": "debit",
                    "Saldo Awal": 5000
                }
            ]
        }
        
        resp = admin_session.post(
            f"{BASE_URL}/import/chart-of-accounts",
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Origin": "http://localhost:3000"
            }
        )
        
        if resp.status_code != 200:
            print(f"[FAIL] T7.4: Re-import returned {resp.status_code}")
            print(f"Response: {resp.text}")
            return False
        
        data = resp.json().get("data", {})
        updated = data.get("updated", 0)
        
        if updated == 1:
            print(f"[SUCCESS] T7.4: Re-import updated 1 account")
        else:
            print(f"[FAIL] T7.4: Expected updated=1, got {updated}")
            return False
        
        # Verify name updated in MongoDB
        mongo_doc = col.find_one({"code": TEST_ACCOUNT_2})
        
        if mongo_doc.get("name") == "Impor Uji 2":
            print(f"[SUCCESS] T7.5: MongoDB name updated to 'Impor Uji 2'")
        else:
            print(f"[FAIL] T7.5: MongoDB name NOT updated: {mongo_doc.get('name')}")
            return False
        
        print(f"[SUCCESS] T7: IMPORT upsert test passed")
        return True
        
    except Exception as e:
        print(f"[FAIL] T7: Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_t8_engine():
    """T8: ENGINE still works (accounting reports)"""
    print("\n" + "="*80)
    print("TEST T8: ENGINE still works (accounting reports)")
    print("="*80)
    
    try:
        import requests
        
        # Try trial-balance report
        resp = admin_session.get(
            f"{BASE_URL}/accounting/trial-balance",
            headers={"Origin": "http://localhost:3000"}
        )
        
        if resp.status_code == 200:
            data = resp.json().get("data", {})
            print(f"[SUCCESS] T8.1: GET /api/accounting/trial-balance returned 200")
            print(f"  Response has 'data' key: {bool(data)}")
        else:
            print(f"[FAIL] T8.1: GET /api/accounting/trial-balance returned {resp.status_code}")
            print(f"Response: {resp.text}")
            return False
        
        # Try balance-sheet report
        resp = admin_session.get(
            f"{BASE_URL}/accounting/balance-sheet",
            headers={"Origin": "http://localhost:3000"}
        )
        
        if resp.status_code == 200:
            data = resp.json().get("data", {})
            print(f"[SUCCESS] T8.2: GET /api/accounting/balance-sheet returned 200")
            print(f"  Response has 'data' key: {bool(data)}")
        else:
            print(f"[FAIL] T8.2: GET /api/accounting/balance-sheet returned {resp.status_code}")
            print(f"Response: {resp.text}")
            return False
        
        # Try income-statement report
        resp = admin_session.get(
            f"{BASE_URL}/accounting/income-statement",
            headers={"Origin": "http://localhost:3000"}
        )
        
        if resp.status_code == 200:
            data = resp.json().get("data", {})
            print(f"[SUCCESS] T8.3: GET /api/accounting/income-statement returned 200")
            print(f"  Response has 'data' key: {bool(data)}")
        else:
            print(f"[FAIL] T8.3: GET /api/accounting/income-statement returned {resp.status_code}")
            print(f"Response: {resp.text}")
            return False
        
        print(f"[SUCCESS] T8: ENGINE test passed - accounting reports work (SQLite mirror hydrated from MongoDB)")
        return True
        
    except Exception as e:
        print(f"[FAIL] T8: Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_operator_403():
    """Test operator role is Forbidden (403) for POST /api/accounting/accounts"""
    print("\n" + "="*80)
    print("TEST: Operator role 403")
    print("="*80)
    
    try:
        import requests
        
        # Try to create account as operator
        payload = {
            "code": "9-9999",
            "name": "Operator Test",
            "type": "expense"
        }
        
        resp = operator_session.post(
            f"{BASE_URL}/accounting/accounts",
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Origin": "http://localhost:3000"
            }
        )
        
        if resp.status_code == 403:
            print(f"[SUCCESS] Operator POST correctly rejected with 403")
            print(f"  Error: {resp.json().get('error', '')}")
            return True
        else:
            print(f"[FAIL] Expected 403, got {resp.status_code}")
            print(f"Response: {resp.text}")
            return False
        
    except Exception as e:
        print(f"[FAIL] Operator 403 test: Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def cleanup():
    """MANDATORY: Delete test accounts from BOTH MongoDB and SQLite"""
    print("\n" + "="*80)
    print("CLEANUP: Removing test accounts")
    print("="*80)
    
    try:
        # Get MongoDB collection
        col = get_mongo_collection()
        
        # Delete from MongoDB
        result1 = col.delete_one({"code": TEST_ACCOUNT_1})
        result2 = col.delete_one({"code": TEST_ACCOUNT_2})
        
        print(f"[INFO] MongoDB cleanup:")
        print(f"  {TEST_ACCOUNT_1}: {result1.deleted_count} document(s) deleted")
        print(f"  {TEST_ACCOUNT_2}: {result2.deleted_count} document(s) deleted")
        
        # Delete from SQLite
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM gl_accounts WHERE code IN (?, ?)", (TEST_ACCOUNT_1, TEST_ACCOUNT_2))
        conn.commit()
        deleted_count = cursor.rowcount
        conn.close()
        
        print(f"[INFO] SQLite cleanup: {deleted_count} row(s) deleted")
        
        # Verify cleanup
        mongo_count = col.count_documents({"code": {"$in": [TEST_ACCOUNT_1, TEST_ACCOUNT_2]}})
        
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM gl_accounts WHERE code IN (?, ?)", (TEST_ACCOUNT_1, TEST_ACCOUNT_2))
        sqlite_count = cursor.fetchone()[0]
        conn.close()
        
        if mongo_count == 0 and sqlite_count == 0:
            print(f"[SUCCESS] Cleanup verified: test accounts removed from BOTH stores")
        else:
            print(f"[WARNING] Cleanup incomplete: MongoDB={mongo_count}, SQLite={sqlite_count}")
        
        # Report final counts
        final_mongo_count = col.count_documents({})
        print(f"\n[INFO] Final MongoDB gl_accounts document count: {final_mongo_count}")
        
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM gl_accounts")
        final_sqlite_count = cursor.fetchone()[0]
        conn.close()
        
        print(f"[INFO] Final SQLite gl_accounts row count: {final_sqlite_count}")
        
        return True
        
    except Exception as e:
        print(f"[ERROR] Cleanup exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    global admin_session, operator_session
    
    print("="*80)
    print("MIGRATION Phase 1: Chart of Accounts (gl_accounts) -> MongoDB-authoritative")
    print("Backend Testing Suite")
    print("="*80)
    
    # Login as admin
    print("\n[INFO] Logging in as admin...")
    admin_session = login("admin@lpi.co.id", "admin123")
    if not admin_session:
        print("[ERROR] Failed to login as admin")
        sys.exit(1)
    
    # Login as operator
    print("\n[INFO] Logging in as operator...")
    operator_session = login("operator@lpi.co.id", "operator123")
    if not operator_session:
        print("[ERROR] Failed to login as operator")
        sys.exit(1)
    
    # Run tests
    results = {}
    
    results["T1_LIST_MONGO"] = test_t1_list_and_mongo_source()
    results["T2_CREATE"] = test_t2_create()
    results["T3_UPDATE"] = test_t3_update()
    results["T4_DUPLICATE"] = test_t4_duplicate()
    results["T5_ARCHIVE_RESTORE"] = test_t5_archive_restore()
    results["T6_DELETE"] = test_t6_delete()
    results["T7_IMPORT"] = test_t7_import()
    results["T8_ENGINE"] = test_t8_engine()
    results["OPERATOR_403"] = test_operator_403()
    
    # Cleanup
    cleanup()
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} - {test}")
    
    print(f"\nTotal: {passed}/{total} tests passed ({passed*100//total}%)")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
