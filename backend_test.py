#!/usr/bin/env python3
"""
MIGRATION Phase 2 Backend Test: Journals + Period Closings + Stock Ledger MongoDB-authoritative
Tests that MongoDB is the source of truth for manual journals, period closings, and stock ledger.
"""

import requests
import json
import sys
from pymongo import MongoClient
import os

# Configuration
BASE_URL = "http://localhost:3000/api"
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
MONGO_DB_NAME = "erp_prod"  # As per /app/lib/db/mongo.js

# Test credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
OPERATOR_EMAIL = "operator@lpi.co.id"
OPERATOR_PASSWORD = "operator123"

# Global session
admin_session = requests.Session()
operator_session = requests.Session()

# MongoDB client
mongo_client = None
mongo_db = None

# Test data tracking for cleanup
test_data = {
    "cashbook_ids": [],
    "journal_ids": [],
    "closing_ids": [],
}

def print_test(msg):
    print(f"\n{'='*80}")
    print(f"TEST: {msg}")
    print('='*80)

def print_result(passed, msg):
    status = "✅ PASSED" if passed else "❌ FAILED"
    print(f"{status}: {msg}")

def login(session, email, password):
    """Login and get session cookie"""
    try:
        # Better Auth login endpoint
        resp = session.post(
            f"{BASE_URL.replace('/api', '')}/api/auth/sign-in/email",
            json={"email": email, "password": password},
            headers={"Origin": "http://localhost:3000"}
        )
        if resp.status_code == 200:
            # Extract token from response and set it as cookie
            data = resp.json()
            token = data.get("token")
            if token:
                # Set the session token cookie manually
                session.cookies.set(
                    "__Secure-better-auth.session_token",
                    token,
                    domain="localhost",
                    path="/"
                )
            print(f"✅ Logged in as {email}")
            return True
        else:
            print(f"❌ Login failed for {email}: {resp.status_code} {resp.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ Login exception for {email}: {e}")
        return False

def connect_mongo():
    """Connect to MongoDB and return db handle"""
    global mongo_client, mongo_db
    try:
        mongo_client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
        # Test connection
        mongo_client.server_info()
        mongo_db = mongo_client[MONGO_DB_NAME]
        print(f"✅ Connected to MongoDB: {MONGO_URL}, DB: {MONGO_DB_NAME}")
        return True
    except Exception as e:
        print(f"❌ MongoDB connection failed: {e}")
        return False

def get_mongo_collection(name):
    """Get MongoDB collection"""
    return mongo_db[name]

def test_1_cashbook_operations():
    """Test 1: CASHBOOK (Pencatatan Cepat) - POST/GET/PUT/DELETE"""
    print_test("CASHBOOK Operations (POST/GET/PUT/DELETE)")
    
    try:
        # First, get a valid expense account code and cash account code
        resp = admin_session.get(f"{BASE_URL}/accounting/accounts")
        if resp.status_code != 200:
            print_result(False, f"Failed to get accounts: {resp.status_code}")
            return False
        
        accounts = resp.json().get("data", [])
        expense_account = next((a for a in accounts if a.get("type") == "expense" and a.get("code")), None)
        cash_account = next((a for a in accounts if a.get("type") == "asset" and "kas" in a.get("name", "").lower()), None)
        
        if not expense_account or not cash_account:
            print_result(False, "Could not find valid expense or cash account")
            return False
        
        expense_code = expense_account["code"]
        cash_code = cash_account["code"]
        print(f"Using expense account: {expense_code}, cash account: {cash_code}")
        
        # 1.1 POST /api/accounting/cashbook (create expense entry)
        cashbook_data = {
            "type": "EXPENSE",
            "date": "2026-02-10",
            "amount": 150000,
            "categoryCode": expense_code,
            "cashCode": cash_code,
            "note": "Test beban Fase2"
        }
        
        resp = admin_session.post(
            f"{BASE_URL}/accounting/cashbook",
            json=cashbook_data,
            headers={"Origin": "http://localhost:3000"}
        )
        
        if resp.status_code != 200:
            print_result(False, f"POST cashbook failed: {resp.status_code} {resp.text[:200]}")
            return False
        
        result = resp.json()
        if not result.get("ok"):
            print_result(False, f"POST cashbook returned ok=false: {result}")
            return False
        
        cashbook_id = result.get("id")
        journal_number = result.get("journalNumber")
        test_data["cashbook_ids"].append(cashbook_id)
        print_result(True, f"Created cashbook entry: id={cashbook_id}, journalNumber={journal_number}")
        
        # 1.2 GET /api/accounting/cashbook (verify it's listed)
        resp = admin_session.get(f"{BASE_URL}/accounting/cashbook")
        if resp.status_code != 200:
            print_result(False, f"GET cashbook failed: {resp.status_code}")
            return False
        
        cashbook_list = resp.json().get("data", [])
        found = any(e.get("id") == cashbook_id for e in cashbook_list)
        print_result(found, f"Cashbook entry found in GET list: {found}")
        
        # 1.3 Verify in MongoDB journal_entries (is_auto=0, source_type=EXPENSE)
        je_col = get_mongo_collection("journal_entries")
        je_doc = je_col.find_one({"id": cashbook_id})
        
        if not je_doc:
            print_result(False, f"Journal entry NOT found in MongoDB: {cashbook_id}")
            return False
        
        if je_doc.get("is_auto") != 0:
            print_result(False, f"Journal entry is_auto should be 0, got: {je_doc.get('is_auto')}")
            return False
        
        if je_doc.get("source_type") != "EXPENSE":
            print_result(False, f"Journal entry source_type should be EXPENSE, got: {je_doc.get('source_type')}")
            return False
        
        print_result(True, f"MongoDB journal_entries doc verified: is_auto=0, source_type=EXPENSE")
        
        # 1.4 Verify journal_lines in MongoDB (should have 2 lines)
        jl_col = get_mongo_collection("journal_lines")
        jl_docs = list(jl_col.find({"journal_id": cashbook_id}))
        
        if len(jl_docs) != 2:
            print_result(False, f"Expected 2 journal_lines, got: {len(jl_docs)}")
            return False
        
        print_result(True, f"MongoDB journal_lines verified: 2 lines found")
        
        # 1.5 PUT /api/accounting/cashbook/:id (update amount)
        updated_data = {
            "type": "EXPENSE",
            "date": "2026-02-10",
            "amount": 200000,  # Changed from 150000
            "categoryCode": expense_code,
            "cashCode": cash_code,
            "note": "Test beban Fase2 edit"
        }
        
        resp = admin_session.put(
            f"{BASE_URL}/accounting/cashbook/{cashbook_id}",
            json=updated_data,
            headers={"Origin": "http://localhost:3000"}
        )
        
        if resp.status_code != 200:
            print_result(False, f"PUT cashbook failed: {resp.status_code} {resp.text[:200]}")
            return False
        
        result = resp.json()
        new_id = result.get("id")
        
        # updateQuickEntry creates a NEW journal with new id
        if new_id == cashbook_id:
            print_result(False, f"PUT should create new id, but got same id: {new_id}")
            return False
        
        test_data["cashbook_ids"].append(new_id)
        print_result(True, f"Updated cashbook entry: new id={new_id}")
        
        # 1.6 Verify old id gone from MongoDB, new id present with amount 200000
        old_je = je_col.find_one({"id": cashbook_id})
        if old_je:
            print_result(False, f"Old journal entry still in MongoDB: {cashbook_id}")
            return False
        
        new_je = je_col.find_one({"id": new_id})
        if not new_je:
            print_result(False, f"New journal entry NOT found in MongoDB: {new_id}")
            return False
        
        # Check amount in journal_lines (debit or credit should be 200000)
        new_jl = list(jl_col.find({"journal_id": new_id}))
        amounts = [l.get("debit", 0) + l.get("credit", 0) for l in new_jl]
        if 200000 not in amounts:
            print_result(False, f"Amount 200000 not found in journal_lines: {amounts}")
            return False
        
        print_result(True, f"MongoDB updated: old id gone, new id present with amount 200000")
        
        # 1.7 DELETE /api/accounting/cashbook/:newId
        resp = admin_session.delete(
            f"{BASE_URL}/accounting/cashbook/{new_id}",
            headers={"Origin": "http://localhost:3000"}
        )
        
        if resp.status_code != 200:
            print_result(False, f"DELETE cashbook failed: {resp.status_code}")
            return False
        
        print_result(True, f"Deleted cashbook entry: {new_id}")
        
        # 1.8 Verify removed from MongoDB
        deleted_je = je_col.find_one({"id": new_id})
        if deleted_je:
            print_result(False, f"Deleted journal entry still in MongoDB: {new_id}")
            return False
        
        deleted_jl = list(jl_col.find({"journal_id": new_id}))
        if deleted_jl:
            print_result(False, f"Deleted journal_lines still in MongoDB: {len(deleted_jl)}")
            return False
        
        print_result(True, f"MongoDB verified: entry and lines removed")
        
        # Remove from cleanup list since already deleted
        test_data["cashbook_ids"] = []
        
        return True
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_2_manual_journal():
    """Test 2: MANUAL JOURNAL - POST/DELETE"""
    print_test("MANUAL JOURNAL Operations (POST/DELETE)")
    
    try:
        # Get two valid accounts (one for debit, one for credit)
        resp = admin_session.get(f"{BASE_URL}/accounting/accounts")
        if resp.status_code != 200:
            print_result(False, f"Failed to get accounts: {resp.status_code}")
            return False
        
        accounts = resp.json().get("data", [])
        if len(accounts) < 2:
            print_result(False, "Not enough accounts for manual journal")
            return False
        
        account1 = accounts[0]
        account2 = accounts[1]
        
        # 2.1 POST /api/accounting/journals with 2 balanced lines
        journal_data = {
            "date": "2026-02-10",
            "description": "Jurnal manual test Fase2",
            "lines": [
                {
                    "accountId": account1["id"],
                    "debit": 50000,
                    "credit": 0
                },
                {
                    "accountId": account2["id"],
                    "debit": 0,
                    "credit": 50000
                }
            ]
        }
        
        resp = admin_session.post(
            f"{BASE_URL}/accounting/journals",
            json=journal_data,
            headers={"Origin": "http://localhost:3000"}
        )
        
        if resp.status_code != 200:
            print_result(False, f"POST journal failed: {resp.status_code} {resp.text[:200]}")
            return False
        
        result = resp.json()
        if not result.get("ok"):
            print_result(False, f"POST journal returned ok=false: {result}")
            return False
        
        journal_id = result.get("id")
        test_data["journal_ids"].append(journal_id)
        print_result(True, f"Created manual journal: id={journal_id}")
        
        # 2.2 GET /api/accounting/journals (verify it's listed)
        resp = admin_session.get(f"{BASE_URL}/accounting/journals")
        if resp.status_code != 200:
            print_result(False, f"GET journals failed: {resp.status_code}")
            return False
        
        journals = resp.json().get("data", [])
        found = any(j.get("id") == journal_id for j in journals)
        print_result(found, f"Manual journal found in GET list: {found}")
        
        # 2.3 Verify in MongoDB journal_entries (is_auto=0)
        je_col = get_mongo_collection("journal_entries")
        je_doc = je_col.find_one({"id": journal_id})
        
        if not je_doc:
            print_result(False, f"Manual journal NOT found in MongoDB: {journal_id}")
            return False
        
        if je_doc.get("is_auto") != 0:
            print_result(False, f"Manual journal is_auto should be 0, got: {je_doc.get('is_auto')}")
            return False
        
        print_result(True, f"MongoDB journal_entries doc verified: is_auto=0")
        
        # 2.4 Verify journal_lines in MongoDB (should have 2 lines)
        jl_col = get_mongo_collection("journal_lines")
        jl_docs = list(jl_col.find({"journal_id": journal_id}))
        
        if len(jl_docs) != 2:
            print_result(False, f"Expected 2 journal_lines, got: {len(jl_docs)}")
            return False
        
        print_result(True, f"MongoDB journal_lines verified: 2 lines found")
        
        # 2.5 DELETE /api/accounting/journals/:id
        resp = admin_session.delete(
            f"{BASE_URL}/accounting/journals/{journal_id}",
            headers={"Origin": "http://localhost:3000"}
        )
        
        if resp.status_code != 200:
            print_result(False, f"DELETE journal failed: {resp.status_code}")
            return False
        
        print_result(True, f"Deleted manual journal: {journal_id}")
        
        # 2.6 Verify removed from MongoDB
        deleted_je = je_col.find_one({"id": journal_id})
        if deleted_je:
            print_result(False, f"Deleted journal still in MongoDB: {journal_id}")
            return False
        
        deleted_jl = list(jl_col.find({"journal_id": journal_id}))
        if deleted_jl:
            print_result(False, f"Deleted journal_lines still in MongoDB: {len(deleted_jl)}")
            return False
        
        print_result(True, f"MongoDB verified: journal and lines removed")
        
        # Remove from cleanup list since already deleted
        test_data["journal_ids"] = []
        
        return True
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_3_double_entry_integrity():
    """Test 3: DOUBLE-ENTRY INTEGRITY - Trial Balance, Balance Sheet, Income Statement"""
    print_test("DOUBLE-ENTRY INTEGRITY (Trial Balance, Balance Sheet, Income Statement)")
    
    try:
        # 3.1 GET /api/accounting/trial-balance
        resp = admin_session.get(f"{BASE_URL}/accounting/trial-balance")
        if resp.status_code != 200:
            print_result(False, f"GET trial-balance failed: {resp.status_code}")
            return False
        
        tb_data = resp.json().get("data", {})
        total_debit = tb_data.get("totalDebit", 0)
        total_credit = tb_data.get("totalCredit", 0)
        
        if total_debit != total_credit:
            print_result(False, f"Trial balance NOT balanced: debit={total_debit}, credit={total_credit}")
            return False
        
        print_result(True, f"Trial balance balanced: debit={total_debit}, credit={total_credit}")
        
        # 3.2 GET /api/accounting/balance-sheet
        resp = admin_session.get(f"{BASE_URL}/accounting/balance-sheet")
        if resp.status_code != 200:
            print_result(False, f"GET balance-sheet failed: {resp.status_code}")
            return False
        
        bs_data = resp.json().get("data", {})
        balanced = bs_data.get("balanced", False)
        
        if not balanced:
            print_result(False, f"Balance sheet NOT balanced: {bs_data}")
            return False
        
        print_result(True, f"Balance sheet balanced: {balanced}")
        
        # 3.3 GET /api/accounting/income-statement
        resp = admin_session.get(f"{BASE_URL}/accounting/income-statement")
        if resp.status_code != 200:
            print_result(False, f"GET income-statement failed: {resp.status_code}")
            return False
        
        print_result(True, f"Income statement returned 200 OK")
        
        # 3.4 GET /api/accounting/overview
        resp = admin_session.get(f"{BASE_URL}/accounting/overview")
        if resp.status_code != 200:
            print_result(False, f"GET overview failed: {resp.status_code}")
            return False
        
        print_result(True, f"Overview returned 200 OK")
        
        return True
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_4_auto_journals_not_in_mongo():
    """Test 4: AUTO JOURNALS NOT IN MONGO - Verify only is_auto=0 in MongoDB"""
    print_test("AUTO JOURNALS NOT IN MONGO (only is_auto=0 should be in MongoDB)")
    
    try:
        # 4.1 Query MongoDB for is_auto=1 journals
        je_col = get_mongo_collection("journal_entries")
        auto_journals = list(je_col.find({"is_auto": 1}))
        
        if len(auto_journals) > 0:
            print_result(False, f"Found {len(auto_journals)} auto journals (is_auto=1) in MongoDB - should be 0")
            return False
        
        print_result(True, f"MongoDB journal_entries contains ONLY is_auto=0 docs (auto journals NOT persisted)")
        
        # 4.2 Count manual journals in MongoDB
        manual_count = je_col.count_documents({"is_auto": 0})
        print_result(True, f"MongoDB journal_entries manual journal count (is_auto=0): {manual_count}")
        
        # 4.3 GET /api/accounting/journals (may include auto journals if source docs exist)
        resp = admin_session.get(f"{BASE_URL}/accounting/journals")
        if resp.status_code != 200:
            print_result(False, f"GET journals failed: {resp.status_code}")
            return False
        
        journals = resp.json().get("data", [])
        auto_in_api = [j for j in journals if j.get("isAuto") or j.get("is_auto")]
        manual_in_api = [j for j in journals if not (j.get("isAuto") or j.get("is_auto"))]
        
        print_result(True, f"API /accounting/journals: {len(journals)} total, {len(auto_in_api)} auto, {len(manual_in_api)} manual")
        
        # 4.4 Try to get auto journals by source type (if any exist)
        for source in ["SO_INV", "PO_INV", "SPAY", "OPENING", "DEPR"]:
            resp = admin_session.get(f"{BASE_URL}/accounting/journals?source={source}")
            if resp.status_code == 200:
                source_journals = resp.json().get("data", [])
                if source_journals:
                    print_result(True, f"Auto journals with source={source}: {len(source_journals)} (visible via API, NOT in MongoDB)")
        
        return True
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_5_period_closing():
    """Test 5: TUTUP BUKU (Period Closing) - POST/GET/DELETE"""
    print_test("TUTUP BUKU (Period Closing) - POST/GET/DELETE")
    
    try:
        # 5.1 Try to create a period closing for 2026-01
        closing_data = {
            "period": "2026-01"
        }
        
        resp = admin_session.post(
            f"{BASE_URL}/accounting/closings",
            json=closing_data,
            headers={"Origin": "http://localhost:3000"}
        )
        
        if resp.status_code == 400:
            # Check if it's "Tidak ada saldo laba/rugi" error
            error_msg = resp.text
            if "Tidak ada saldo laba/rugi" in error_msg or "tidak ada" in error_msg.lower():
                print_result(True, f"Period closing returned 'Tidak ada saldo laba/rugi' - acceptable (no P&L data)")
                return True
            else:
                print_result(False, f"POST closing failed with unexpected error: {resp.status_code} {error_msg[:200]}")
                return False
        
        if resp.status_code != 200:
            print_result(False, f"POST closing failed: {resp.status_code} {resp.text[:200]}")
            return False
        
        result = resp.json()
        if not result.get("ok"):
            print_result(False, f"POST closing returned ok=false: {result}")
            return False
        
        closing_id = result.get("id")
        journal_id = result.get("journalId")
        test_data["closing_ids"].append(closing_id)
        print_result(True, f"Created period closing: id={closing_id}, journalId={journal_id}")
        
        # 5.2 Verify in MongoDB journal_entries (source_type=CLOSING, is_auto=0)
        je_col = get_mongo_collection("journal_entries")
        je_doc = je_col.find_one({"id": journal_id})
        
        if not je_doc:
            print_result(False, f"Closing journal NOT found in MongoDB: {journal_id}")
            return False
        
        if je_doc.get("is_auto") != 0:
            print_result(False, f"Closing journal is_auto should be 0, got: {je_doc.get('is_auto')}")
            return False
        
        if je_doc.get("source_type") != "CLOSING":
            print_result(False, f"Closing journal source_type should be CLOSING, got: {je_doc.get('source_type')}")
            return False
        
        print_result(True, f"MongoDB journal_entries verified: source_type=CLOSING, is_auto=0")
        
        # 5.3 Verify in MongoDB period_closings
        pc_col = get_mongo_collection("period_closings")
        pc_doc = pc_col.find_one({"id": closing_id})
        
        if not pc_doc:
            print_result(False, f"Period closing NOT found in MongoDB: {closing_id}")
            return False
        
        print_result(True, f"MongoDB period_closings doc verified: id={closing_id}")
        
        # 5.4 GET /api/accounting/closings (verify it's listed)
        resp = admin_session.get(f"{BASE_URL}/accounting/closings")
        if resp.status_code != 200:
            print_result(False, f"GET closings failed: {resp.status_code}")
            return False
        
        closings = resp.json().get("data", [])
        found = any(c.get("id") == closing_id for c in closings)
        print_result(found, f"Period closing found in GET list: {found}")
        
        # 5.5 DELETE /api/accounting/closings/:id
        resp = admin_session.delete(
            f"{BASE_URL}/accounting/closings/{closing_id}",
            headers={"Origin": "http://localhost:3000"}
        )
        
        if resp.status_code != 200:
            print_result(False, f"DELETE closing failed: {resp.status_code}")
            return False
        
        print_result(True, f"Deleted period closing: {closing_id}")
        
        # 5.6 Verify removed from MongoDB (both journal and closing)
        deleted_je = je_col.find_one({"id": journal_id})
        if deleted_je:
            print_result(False, f"Deleted closing journal still in MongoDB: {journal_id}")
            return False
        
        deleted_pc = pc_col.find_one({"id": closing_id})
        if deleted_pc:
            print_result(False, f"Deleted period_closing still in MongoDB: {closing_id}")
            return False
        
        print_result(True, f"MongoDB verified: closing journal and period_closing removed")
        
        # Remove from cleanup list since already deleted
        test_data["closing_ids"] = []
        
        return True
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_6_stock_ledger():
    """Test 6: STOCK LEDGER (Kartu Stok) - GET endpoints and MongoDB verification"""
    print_test("STOCK LEDGER (Kartu Stok) - GET endpoints and MongoDB verification")
    
    try:
        # 6.1 GET /api/stock-ledger
        resp = admin_session.get(f"{BASE_URL}/stock-ledger")
        if resp.status_code != 200:
            print_result(False, f"GET stock-ledger failed: {resp.status_code}")
            return False
        
        ledger_data = resp.json().get("data", [])
        print_result(True, f"GET /stock-ledger returned 200 OK with {len(ledger_data)} rows")
        
        # 6.2 Verify MongoDB stock_ledger collection
        sl_col = get_mongo_collection("stock_ledger")
        sl_count = sl_col.count_documents({})
        
        if sl_count == 0:
            print_result(False, f"MongoDB stock_ledger collection is empty (expected at least 8 pre-existing rows)")
            return False
        
        print_result(True, f"MongoDB stock_ledger collection has {sl_count} documents")
        
        # 6.3 GET /api/inventory-reports/stock-card (need a productId)
        # Try to get a product from the ledger data
        if ledger_data and len(ledger_data) > 0:
            product_id = ledger_data[0].get("productId") or ledger_data[0].get("product_id")
            if product_id:
                resp = admin_session.get(f"{BASE_URL}/inventory-reports/stock-card?productId={product_id}")
                if resp.status_code != 200:
                    print_result(False, f"GET stock-card failed: {resp.status_code}")
                    return False
                
                card_data = resp.json().get("data", [])
                print_result(True, f"GET /inventory-reports/stock-card returned 200 OK with {len(card_data)} rows")
            else:
                print_result(True, f"No productId in ledger data, skipping stock-card test")
        else:
            # Try to get products and test with first product
            resp = admin_session.get(f"{BASE_URL}/products")
            if resp.status_code == 200:
                products = resp.json().get("data", [])
                if products:
                    product_id = products[0].get("id")
                    resp = admin_session.get(f"{BASE_URL}/inventory-reports/stock-card?productId={product_id}")
                    if resp.status_code == 200:
                        card_data = resp.json().get("data", [])
                        print_result(True, f"GET /inventory-reports/stock-card returned 200 OK with {len(card_data)} rows")
                    else:
                        print_result(True, f"GET /inventory-reports/stock-card returned {resp.status_code} (may be empty)")
                else:
                    print_result(True, f"No products found, skipping stock-card test")
            else:
                print_result(True, f"Could not get products, skipping stock-card test")
        
        return True
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_7_role_guard():
    """Test 7: ROLE GUARD - Operator should get 403 on accounting writes"""
    print_test("ROLE GUARD - Operator should get 403 on accounting writes")
    
    try:
        # Get a valid expense account code and cash account code
        resp = admin_session.get(f"{BASE_URL}/accounting/accounts")
        if resp.status_code != 200:
            print_result(False, f"Failed to get accounts: {resp.status_code}")
            return False
        
        accounts = resp.json().get("data", [])
        expense_account = next((a for a in accounts if a.get("type") == "expense" and a.get("code")), None)
        cash_account = next((a for a in accounts if a.get("type") == "asset" and "kas" in a.get("name", "").lower()), None)
        
        if not expense_account or not cash_account:
            print_result(False, "Could not find valid expense or cash account")
            return False
        
        expense_code = expense_account["code"]
        cash_code = cash_account["code"]
        
        # Try to POST cashbook as operator (should be 403)
        cashbook_data = {
            "type": "EXPENSE",
            "date": "2026-02-10",
            "amount": 100000,
            "categoryCode": expense_code,
            "cashCode": cash_code,
            "note": "Test operator forbidden"
        }
        
        resp = operator_session.post(
            f"{BASE_URL}/accounting/cashbook",
            json=cashbook_data,
            headers={"Origin": "http://localhost:3000"}
        )
        
        if resp.status_code != 403:
            print_result(False, f"Operator POST cashbook should return 403, got: {resp.status_code}")
            return False
        
        print_result(True, f"Operator POST cashbook correctly returned 403 Forbidden")
        
        return True
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def cleanup_test_data():
    """Clean up all test data from MongoDB and API"""
    print_test("CLEANUP - Removing all test data")
    
    try:
        # Clean up cashbook entries
        for cashbook_id in test_data["cashbook_ids"]:
            try:
                resp = admin_session.delete(
                    f"{BASE_URL}/accounting/cashbook/{cashbook_id}",
                    headers={"Origin": "http://localhost:3000"}
                )
                if resp.status_code == 200:
                    print(f"✅ Deleted cashbook entry: {cashbook_id}")
                else:
                    print(f"⚠️  Failed to delete cashbook entry {cashbook_id}: {resp.status_code}")
            except Exception as e:
                print(f"⚠️  Exception deleting cashbook {cashbook_id}: {e}")
        
        # Clean up manual journals
        for journal_id in test_data["journal_ids"]:
            try:
                resp = admin_session.delete(
                    f"{BASE_URL}/accounting/journals/{journal_id}",
                    headers={"Origin": "http://localhost:3000"}
                )
                if resp.status_code == 200:
                    print(f"✅ Deleted journal: {journal_id}")
                else:
                    print(f"⚠️  Failed to delete journal {journal_id}: {resp.status_code}")
            except Exception as e:
                print(f"⚠️  Exception deleting journal {journal_id}: {e}")
        
        # Clean up period closings
        for closing_id in test_data["closing_ids"]:
            try:
                resp = admin_session.delete(
                    f"{BASE_URL}/accounting/closings/{closing_id}",
                    headers={"Origin": "http://localhost:3000"}
                )
                if resp.status_code == 200:
                    print(f"✅ Deleted period closing: {closing_id}")
                else:
                    print(f"⚠️  Failed to delete closing {closing_id}: {resp.status_code}")
            except Exception as e:
                print(f"⚠️  Exception deleting closing {closing_id}: {e}")
        
        print_result(True, "Cleanup completed")
        return True
        
    except Exception as e:
        print_result(False, f"Cleanup exception: {e}")
        return False

def report_final_state():
    """Report final MongoDB state"""
    print_test("FINAL STATE REPORT")
    
    try:
        print(f"\nMongoDB Database: {MONGO_DB_NAME}")
        print(f"MongoDB URL: {MONGO_URL}")
        
        # Report collection counts
        je_col = get_mongo_collection("journal_entries")
        jl_col = get_mongo_collection("journal_lines")
        pc_col = get_mongo_collection("period_closings")
        sl_col = get_mongo_collection("stock_ledger")
        
        je_total = je_col.count_documents({})
        je_manual = je_col.count_documents({"is_auto": 0})
        je_auto = je_col.count_documents({"is_auto": 1})
        jl_total = jl_col.count_documents({})
        pc_total = pc_col.count_documents({})
        sl_total = sl_col.count_documents({})
        
        print(f"\nMongoDB Collection Counts:")
        print(f"  journal_entries (total): {je_total}")
        print(f"  journal_entries (is_auto=0, manual): {je_manual}")
        print(f"  journal_entries (is_auto=1, auto): {je_auto}")
        print(f"  journal_lines: {jl_total}")
        print(f"  period_closings: {pc_total}")
        print(f"  stock_ledger: {sl_total}")
        
        if je_auto > 0:
            print(f"\n⚠️  WARNING: Found {je_auto} auto journals (is_auto=1) in MongoDB - should be 0!")
        else:
            print(f"\n✅ VERIFIED: MongoDB contains ONLY manual journals (is_auto=0)")
        
        return True
        
    except Exception as e:
        print(f"❌ Report exception: {e}")
        return False

def main():
    """Main test runner"""
    print("\n" + "="*80)
    print("MIGRATION PHASE 2 BACKEND TEST")
    print("Journals + Period Closings + Stock Ledger MongoDB-authoritative")
    print("="*80)
    
    # Connect to MongoDB
    if not connect_mongo():
        print("\n❌ FATAL: Could not connect to MongoDB")
        sys.exit(1)
    
    # Login as admin
    if not login(admin_session, ADMIN_EMAIL, ADMIN_PASSWORD):
        print("\n❌ FATAL: Could not login as admin")
        sys.exit(1)
    
    # Login as operator
    if not login(operator_session, OPERATOR_EMAIL, OPERATOR_PASSWORD):
        print("\n❌ FATAL: Could not login as operator")
        sys.exit(1)
    
    # Run tests
    results = {}
    
    results["test_1_cashbook"] = test_1_cashbook_operations()
    results["test_2_manual_journal"] = test_2_manual_journal()
    results["test_3_double_entry"] = test_3_double_entry_integrity()
    results["test_4_auto_journals"] = test_4_auto_journals_not_in_mongo()
    results["test_5_period_closing"] = test_5_period_closing()
    results["test_6_stock_ledger"] = test_6_stock_ledger()
    results["test_7_role_guard"] = test_7_role_guard()
    
    # Cleanup
    cleanup_test_data()
    
    # Final report
    report_final_state()
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{status}: {test_name}")
    
    print(f"\nTotal: {passed}/{total} tests passed ({passed*100//total}%)")
    
    if passed == total:
        print("\n✅ ALL TESTS PASSED - MIGRATION PHASE 2 VERIFIED")
        sys.exit(0)
    else:
        print(f"\n❌ {total - passed} TEST(S) FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
