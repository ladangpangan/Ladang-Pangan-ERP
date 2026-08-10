#!/usr/bin/env python3
"""
Backend API Testing Script for ERP System - Accounting Module (SAK EP)
Tests all accounting endpoints with comprehensive scenarios including idempotency checks.
"""

import requests
import json
import sys
import sqlite3
from datetime import datetime

# Configuration
BASE_URL = "http://localhost:3000/api"
DB_PATH = "/app/data/erp.db"

# Test credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

# Global session
session = requests.Session()

def print_test(msg):
    """Print test step"""
    print(f"\n{'='*80}")
    print(f"TEST: {msg}")
    print('='*80)

def print_result(success, msg, details=None):
    """Print test result"""
    status = "✅ PASS" if success else "❌ FAIL"
    print(f"{status}: {msg}")
    if details:
        print(f"Details: {details}")
    return success

def login():
    """Login and establish session"""
    print_test("Authentication - Login as admin")
    try:
        response = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            headers={"Content-Type": "application/json"}
        )
        
        # Debug: Print cookies
        print(f"   Response status: {response.status_code}")
        print(f"   Cookies received: {len(response.cookies)}")
        for cookie in response.cookies:
            print(f"   Cookie: {cookie.name} = {cookie.value[:20]}...")
        
        # Debug: Print session cookies
        print(f"   Session cookies: {len(session.cookies)}")
        for cookie in session.cookies:
            print(f"   Session cookie: {cookie.name}")
        
        if response.status_code == 200:
            return print_result(True, "Login successful")
        else:
            return print_result(False, f"Login failed with status {response.status_code}", response.text[:200])
    except Exception as e:
        return print_result(False, f"Login exception: {str(e)}")

def query_db(query, params=()):
    """Execute SQLite query and return results"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(query, params)
        results = cursor.fetchall()
        conn.close()
        return results
    except Exception as e:
        print(f"DB query error: {e}")
        return None

def count_db(query, params=()):
    """Execute SQLite count query and return count"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(query, params)
        result = cursor.fetchone()
        conn.close()
        return result[0] if result else 0
    except Exception as e:
        print(f"DB count error: {e}")
        return 0

# ============================================================================
# TEST 1: GET /accounting/accounts?archived=0
# ============================================================================
def test_get_accounts():
    print_test("1. GET /accounting/accounts?archived=0 - Verify seeded COA")
    try:
        response = session.get(f"{BASE_URL}/accounting/accounts?archived=0")
        if response.status_code != 200:
            return print_result(False, f"GET accounts failed with status {response.status_code}", response.text[:200])
        
        data = response.json()
        accounts = data.get('data', [])
        
        # Verify we have 51 accounts
        if len(accounts) != 51:
            return print_result(False, f"Expected 51 accounts, got {len(accounts)}")
        
        # Verify system accounts have is_system=1
        system_accounts = [a for a in accounts if a.get('is_system') == 1]
        print(f"   Found {len(system_accounts)} system accounts")
        
        # Verify header accounts have is_postable=0
        header_accounts = [a for a in accounts if a.get('is_postable') == 0]
        print(f"   Found {len(header_accounts)} header (non-postable) accounts")
        
        # Find Kas account (1-1110) - should be system
        kas_account = next((a for a in accounts if a.get('code') == '1-1110'), None)
        if not kas_account:
            return print_result(False, "Kas account (1-1110) not found")
        if kas_account.get('is_system') != 1:
            return print_result(False, "Kas account should be system account (is_system=1)")
        
        return print_result(True, f"GET accounts successful: {len(accounts)} accounts, {len(system_accounts)} system, {len(header_accounts)} headers")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 2: COA CRUD Operations
# ============================================================================
def test_coa_crud():
    print_test("2. COA CRUD - Create, Update, Archive, Restore, Delete")
    
    created_account_id = None
    
    try:
        # 2a. POST /accounting/accounts - Create new account
        print("\n2a. POST /accounting/accounts - Create test account")
        response = session.post(
            f"{BASE_URL}/accounting/accounts",
            json={
                "code": "6-1950",
                "name": "Beban Tes",
                "type": "expense",
                "normalBalance": "debit",
                "category": "Beban Operasional",
                "isPostable": True
            }
        )
        if response.status_code != 200:
            print_result(False, f"POST account failed with status {response.status_code}", response.text[:200])
            return False
        
        data = response.json()
        created_account = data.get('data', {})
        created_account_id = created_account.get('id')
        
        if not created_account_id:
            print_result(False, "Created account ID not found in response")
            return False
        
        print_result(True, f"Account created: {created_account.get('code')} - {created_account.get('name')}")
        
        # 2b. PATCH /accounting/accounts/:id - Update account
        print("\n2b. PATCH /accounting/accounts/:id - Update account name")
        response = session.patch(
            f"{BASE_URL}/accounting/accounts/{created_account_id}",
            json={"name": "Beban Tes Edit"}
        )
        if response.status_code != 200:
            print_result(False, f"PATCH account failed with status {response.status_code}", response.text[:200])
            return False
        
        data = response.json()
        updated_account = data.get('data', {})
        if updated_account.get('name') != "Beban Tes Edit":
            print_result(False, f"Account name not updated correctly: {updated_account.get('name')}")
            return False
        
        print_result(True, f"Account updated: {updated_account.get('name')}")
        
        # 2c. POST /accounting/accounts/:id/archive - Archive account
        print("\n2c. POST /accounting/accounts/:id/archive - Archive account")
        response = session.post(f"{BASE_URL}/accounting/accounts/{created_account_id}/archive")
        if response.status_code != 200:
            print_result(False, f"Archive account failed with status {response.status_code}", response.text[:200])
            return False
        
        print_result(True, "Account archived successfully")
        
        # 2d. POST /accounting/accounts/:id/restore - Restore account
        print("\n2d. POST /accounting/accounts/:id/restore - Restore account")
        response = session.post(f"{BASE_URL}/accounting/accounts/{created_account_id}/restore")
        if response.status_code != 200:
            print_result(False, f"Restore account failed with status {response.status_code}", response.text[:200])
            return False
        
        print_result(True, "Account restored successfully")
        
        # 2e. DELETE /accounting/accounts/:id - Delete account
        print("\n2e. DELETE /accounting/accounts/:id - Delete test account")
        response = session.delete(f"{BASE_URL}/accounting/accounts/{created_account_id}")
        if response.status_code != 200:
            print_result(False, f"DELETE account failed with status {response.status_code}", response.text[:200])
            return False
        
        print_result(True, "Account deleted successfully")
        
        # 2f. NEGATIVE TEST: DELETE system account (Kas 1-1110)
        print("\n2f. NEGATIVE TEST: DELETE system account (should fail with 400)")
        # First, get Kas account ID
        response = session.get(f"{BASE_URL}/accounting/accounts?archived=0")
        accounts = response.json().get('data', [])
        kas_account = next((a for a in accounts if a.get('code') == '1-1110'), None)
        
        if not kas_account:
            print_result(False, "Kas account not found for negative test")
            return False
        
        response = session.delete(f"{BASE_URL}/accounting/accounts/{kas_account['id']}")
        if response.status_code == 400:
            print_result(True, "DELETE system account correctly rejected with 400")
        else:
            print_result(False, f"DELETE system account should return 400, got {response.status_code}")
            return False
        
        # 2g. NEGATIVE TEST: PATCH system account code (should keep old code)
        print("\n2g. NEGATIVE TEST: PATCH system account code (should keep old code)")
        response = session.patch(
            f"{BASE_URL}/accounting/accounts/{kas_account['id']}",
            json={"code": "1-9999", "name": "Kas Modified"}
        )
        if response.status_code != 200:
            print_result(False, f"PATCH system account failed with status {response.status_code}")
            return False
        
        data = response.json()
        updated = data.get('data', {})
        if updated.get('code') == '1-1110':
            print_result(True, "System account code protected (kept as 1-1110)")
        else:
            print_result(False, f"System account code should not change, got {updated.get('code')}")
            return False
        
        return True
        
    except Exception as e:
        print_result(False, f"Exception: {str(e)}")
        return False

# ============================================================================
# TEST 3: GET /accounting/mapping
# ============================================================================
def test_mapping():
    print_test("3. GET /accounting/mapping - Verify mapping data")
    try:
        response = session.get(f"{BASE_URL}/accounting/mapping")
        if response.status_code != 200:
            return print_result(False, f"GET mapping failed with status {response.status_code}", response.text[:200])
        
        data = response.json()
        mapping = data.get('data', {})
        labels = data.get('labels', {})
        
        # Verify key mappings exist
        required_keys = ['kas', 'bank', 'piutang_usaha', 'persediaan', 'utang_usaha', 'penjualan', 'hpp']
        missing_keys = [k for k in required_keys if k not in mapping]
        
        if missing_keys:
            return print_result(False, f"Missing mapping keys: {missing_keys}")
        
        print(f"   Mapping keys: {len(mapping)}")
        print(f"   Label keys: {len(labels)}")
        
        # 3b. PUT /accounting/mapping - Update mapping
        print("\n3b. PUT /accounting/mapping - Update mapping (merge)")
        current_mapping = mapping.copy()
        response = session.put(
            f"{BASE_URL}/accounting/mapping",
            json={"mapping": current_mapping}
        )
        if response.status_code != 200:
            return print_result(False, f"PUT mapping failed with status {response.status_code}", response.text[:200])
        
        data = response.json()
        merged_mapping = data.get('data', {})
        
        return print_result(True, f"Mapping operations successful: {len(merged_mapping)} keys")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 4: GET /accounting/settings
# ============================================================================
def test_settings():
    print_test("4. GET /accounting/settings - Verify settings")
    try:
        response = session.get(f"{BASE_URL}/accounting/settings")
        if response.status_code != 200:
            return print_result(False, f"GET settings failed with status {response.status_code}", response.text[:200])
        
        data = response.json()
        settings = data.get('data', {})
        
        # Verify required settings
        if 'ppnEnabled' not in settings:
            return print_result(False, "ppnEnabled not in settings")
        if 'ppnRate' not in settings:
            return print_result(False, "ppnRate not in settings")
        if 'openingDate' not in settings:
            return print_result(False, "openingDate not in settings")
        if 'autoPost' not in settings:
            return print_result(False, "autoPost not in settings")
        
        print(f"   ppnEnabled: {settings.get('ppnEnabled')}")
        print(f"   ppnRate: {settings.get('ppnRate')}")
        print(f"   openingDate: {settings.get('openingDate')}")
        print(f"   autoPost: {settings.get('autoPost')}")
        
        # 4b. PUT /accounting/settings - Update settings
        print("\n4b. PUT /accounting/settings - Update settings")
        response = session.put(
            f"{BASE_URL}/accounting/settings",
            json={"settings": {"ppnEnabled": False}}
        )
        if response.status_code != 200:
            return print_result(False, f"PUT settings failed with status {response.status_code}", response.text[:200])
        
        return print_result(True, "Settings operations successful")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 5: POST /accounting/sync - IDEMPOTENCY TEST (CRITICAL)
# ============================================================================
def test_sync_idempotency():
    print_test("5. POST /accounting/sync - IDEMPOTENCY TEST (CRITICAL)")
    try:
        # First sync
        print("\n5a. First POST /accounting/sync")
        response = session.post(f"{BASE_URL}/accounting/sync")
        if response.status_code != 200:
            return print_result(False, f"First sync failed with status {response.status_code}", response.text[:200])
        
        data = response.json()
        first_count = data.get('count', 0)
        print(f"   First sync count: {first_count}")
        
        if first_count == 0:
            print_result(False, "First sync count is 0, expected > 0")
            return False
        
        # Count auto journals in DB
        auto_count_1 = count_db("SELECT COUNT(*) FROM journal_entries WHERE is_auto = 1")
        print(f"   Auto journals in DB after first sync: {auto_count_1}")
        
        # Count manual journals in DB
        manual_count_1 = count_db("SELECT COUNT(*) FROM journal_entries WHERE is_auto = 0")
        print(f"   Manual journals in DB after first sync: {manual_count_1}")
        
        # Second sync (idempotency test)
        print("\n5b. Second POST /accounting/sync (idempotency check)")
        response = session.post(f"{BASE_URL}/accounting/sync")
        if response.status_code != 200:
            return print_result(False, f"Second sync failed with status {response.status_code}", response.text[:200])
        
        data = response.json()
        second_count = data.get('count', 0)
        print(f"   Second sync count: {second_count}")
        
        # Count auto journals in DB after second sync
        auto_count_2 = count_db("SELECT COUNT(*) FROM journal_entries WHERE is_auto = 1")
        print(f"   Auto journals in DB after second sync: {auto_count_2}")
        
        # Count manual journals in DB after second sync
        manual_count_2 = count_db("SELECT COUNT(*) FROM journal_entries WHERE is_auto = 0")
        print(f"   Manual journals in DB after second sync: {manual_count_2}")
        
        # CRITICAL: Auto journal count should be the same (idempotent)
        if auto_count_1 != auto_count_2:
            return print_result(False, f"IDEMPOTENCY FAILED: Auto journal count changed from {auto_count_1} to {auto_count_2}")
        
        # CRITICAL: Manual journals should NOT be deleted
        if manual_count_1 != manual_count_2:
            return print_result(False, f"Manual journals were affected: {manual_count_1} -> {manual_count_2}")
        
        return print_result(True, f"Sync idempotency verified: {auto_count_1} auto journals unchanged, {manual_count_1} manual journals preserved")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 6: Journals CRUD
# ============================================================================
def test_journals():
    print_test("6. Journals - List, Get, Create Manual, Delete")
    
    created_journal_id = None
    auto_journal_id = None
    
    try:
        # 6a. GET /accounting/journals - List journals
        print("\n6a. GET /accounting/journals?from=2025-01-01&to=2026-12-31")
        response = session.get(f"{BASE_URL}/accounting/journals?from=2025-01-01&to=2026-12-31")
        if response.status_code != 200:
            print_result(False, f"GET journals failed with status {response.status_code}", response.text[:200])
            return False
        
        data = response.json()
        journals = data.get('data', [])
        print(f"   Found {len(journals)} journals")
        
        # Find an auto journal for negative test
        auto_journals = [j for j in journals if j.get('is_auto') == 1]
        if auto_journals:
            auto_journal_id = auto_journals[0].get('id')
            print(f"   Found auto journal for negative test: {auto_journals[0].get('journal_number')}")
        
        # 6b. GET /accounting/journals/:id - Get journal detail
        if journals:
            print(f"\n6b. GET /accounting/journals/:id - Get journal detail")
            journal_id = journals[0].get('id')
            response = session.get(f"{BASE_URL}/accounting/journals/{journal_id}")
            if response.status_code != 200:
                print_result(False, f"GET journal detail failed with status {response.status_code}")
                return False
            
            data = response.json()
            journal = data.get('data', {})
            lines = journal.get('lines', [])
            print(f"   Journal {journal.get('journal_number')} has {len(lines)} lines")
            
            # Verify lines have required fields
            if lines:
                line = lines[0]
                required_fields = ['debit', 'credit', 'account_code', 'account_name']
                missing = [f for f in required_fields if f not in line]
                if missing:
                    print_result(False, f"Journal line missing fields: {missing}")
                    return False
            
            print_result(True, f"Journal detail retrieved successfully")
        
        # 6c. POST /accounting/journals - Create balanced manual journal
        print("\n6c. POST /accounting/journals - Create BALANCED manual journal")
        
        # Get Kas and Modal account IDs
        response = session.get(f"{BASE_URL}/accounting/accounts?archived=0")
        accounts = response.json().get('data', [])
        kas_account = next((a for a in accounts if a.get('code') == '1-1110'), None)
        modal_account = next((a for a in accounts if a.get('code') == '3-1100'), None)
        
        if not kas_account or not modal_account:
            print_result(False, "Could not find Kas or Modal accounts")
            return False
        
        response = session.post(
            f"{BASE_URL}/accounting/journals",
            json={
                "date": "2026-08-10",
                "description": "Test Manual Journal - Balanced",
                "lines": [
                    {
                        "accountId": kas_account['id'],
                        "debit": 100000,
                        "credit": 0,
                        "description": "Debit Kas"
                    },
                    {
                        "accountId": modal_account['id'],
                        "debit": 0,
                        "credit": 100000,
                        "description": "Credit Modal"
                    }
                ]
            }
        )
        if response.status_code != 200:
            print_result(False, f"POST balanced journal failed with status {response.status_code}", response.text[:200])
            return False
        
        data = response.json()
        created_journal_id = data.get('id')
        journal_number = data.get('journalNumber')
        
        if not journal_number or not journal_number.startswith('JU-'):
            print_result(False, f"Journal number format incorrect: {journal_number}")
            return False
        
        print_result(True, f"Balanced manual journal created: {journal_number}")
        
        # 6d. NEGATIVE TEST: POST unbalanced journal
        print("\n6d. NEGATIVE TEST: POST UNBALANCED manual journal (should fail with 400)")
        response = session.post(
            f"{BASE_URL}/accounting/journals",
            json={
                "date": "2026-08-10",
                "description": "Test Manual Journal - Unbalanced",
                "lines": [
                    {
                        "accountId": kas_account['id'],
                        "debit": 100000,
                        "credit": 0,
                        "description": "Debit Kas"
                    },
                    {
                        "accountId": modal_account['id'],
                        "debit": 0,
                        "credit": 50000,
                        "description": "Credit Modal (unbalanced)"
                    }
                ]
            }
        )
        if response.status_code == 400:
            print_result(True, "Unbalanced journal correctly rejected with 400")
        else:
            print_result(False, f"Unbalanced journal should return 400, got {response.status_code}")
            return False
        
        # 6e. DELETE manual journal
        print("\n6e. DELETE /accounting/journals/:id - Delete manual journal")
        if created_journal_id:
            response = session.delete(f"{BASE_URL}/accounting/journals/{created_journal_id}")
            if response.status_code != 200:
                print_result(False, f"DELETE manual journal failed with status {response.status_code}", response.text[:200])
                return False
            
            print_result(True, "Manual journal deleted successfully")
        
        # 6f. NEGATIVE TEST: DELETE auto journal
        print("\n6f. NEGATIVE TEST: DELETE auto journal (should fail with 400)")
        if auto_journal_id:
            response = session.delete(f"{BASE_URL}/accounting/journals/{auto_journal_id}")
            if response.status_code == 400:
                print_result(True, "DELETE auto journal correctly rejected with 400")
            else:
                print_result(False, f"DELETE auto journal should return 400, got {response.status_code}")
                return False
        else:
            print("   Skipping auto journal delete test (no auto journal found)")
        
        return True
        
    except Exception as e:
        print_result(False, f"Exception: {str(e)}")
        return False

# ============================================================================
# TEST 7: GET /accounting/trial-balance - CRITICAL BALANCE CHECK
# ============================================================================
def test_trial_balance():
    print_test("7. GET /accounting/trial-balance - CRITICAL BALANCE CHECK")
    try:
        response = session.get(f"{BASE_URL}/accounting/trial-balance?to=2026-12-31")
        if response.status_code != 200:
            return print_result(False, f"GET trial-balance failed with status {response.status_code}", response.text[:200])
        
        data = response.json()
        tb_data = data.get('data', {})
        
        total_debit = tb_data.get('totalDebit', 0)
        total_credit = tb_data.get('totalCredit', 0)
        rows = tb_data.get('rows', [])
        
        print(f"   Total Debit:  Rp {total_debit:,.2f}")
        print(f"   Total Credit: Rp {total_credit:,.2f}")
        print(f"   Accounts: {len(rows)}")
        
        # CRITICAL: Debit must equal Credit
        if abs(total_debit - total_credit) > 0.01:
            return print_result(False, f"TRIAL BALANCE NOT BALANCED: Debit {total_debit} ≠ Credit {total_credit}")
        
        return print_result(True, f"Trial Balance BALANCED: Debit = Credit = Rp {total_debit:,.2f}")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 8: GET /accounting/income-statement
# ============================================================================
def test_income_statement():
    print_test("8. GET /accounting/income-statement")
    try:
        response = session.get(f"{BASE_URL}/accounting/income-statement?from=2025-01-01&to=2026-12-31")
        if response.status_code != 200:
            return print_result(False, f"GET income-statement failed with status {response.status_code}", response.text[:200])
        
        data = response.json()
        is_data = data.get('data', {})
        
        # Verify required fields
        required_fields = ['revenue', 'cogs', 'grossProfit', 'expense', 'otherIncome', 'otherExpense', 'netIncome']
        missing = [f for f in required_fields if f not in is_data]
        if missing:
            return print_result(False, f"Income statement missing fields: {missing}")
        
        # Verify all are numeric
        for field in required_fields:
            value = is_data.get(field)
            if isinstance(value, dict):
                value = value.get('total', 0)
            if not isinstance(value, (int, float)):
                return print_result(False, f"Field {field} is not numeric: {value}")
        
        revenue = is_data.get('revenue', {}).get('total', 0) if isinstance(is_data.get('revenue'), dict) else is_data.get('revenue', 0)
        cogs = is_data.get('cogs', {}).get('total', 0) if isinstance(is_data.get('cogs'), dict) else is_data.get('cogs', 0)
        gross_profit = is_data.get('grossProfit', 0)
        expense = is_data.get('expense', {}).get('total', 0) if isinstance(is_data.get('expense'), dict) else is_data.get('expense', 0)
        net_income = is_data.get('netIncome', 0)
        
        print(f"   Revenue:      Rp {revenue:,.2f}")
        print(f"   COGS:         Rp {cogs:,.2f}")
        print(f"   Gross Profit: Rp {gross_profit:,.2f}")
        print(f"   Expense:      Rp {expense:,.2f}")
        print(f"   Net Income:   Rp {net_income:,.2f}")
        
        return print_result(True, "Income statement retrieved successfully")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 9: GET /accounting/balance-sheet - CRITICAL BALANCE CHECK
# ============================================================================
def test_balance_sheet():
    print_test("9. GET /accounting/balance-sheet - CRITICAL BALANCE CHECK")
    try:
        response = session.get(f"{BASE_URL}/accounting/balance-sheet?asOf=2026-12-31")
        if response.status_code != 200:
            return print_result(False, f"GET balance-sheet failed with status {response.status_code}", response.text[:200])
        
        data = response.json()
        bs_data = data.get('data', {})
        
        total_assets = bs_data.get('totalAssets', 0)
        total_liab_equity = bs_data.get('totalLiabilitiesEquity', 0)
        balanced = bs_data.get('balanced', False)
        
        print(f"   Total Assets:              Rp {total_assets:,.2f}")
        print(f"   Total Liabilities + Equity: Rp {total_liab_equity:,.2f}")
        print(f"   Balanced: {balanced}")
        
        # CRITICAL: Assets must equal Liabilities + Equity
        if not balanced:
            return print_result(False, f"BALANCE SHEET NOT BALANCED: Assets {total_assets} ≠ Liab+Equity {total_liab_equity}")
        
        if abs(total_assets - total_liab_equity) > 1:
            return print_result(False, f"BALANCE SHEET NOT BALANCED: Assets {total_assets} ≠ Liab+Equity {total_liab_equity}")
        
        return print_result(True, f"Balance Sheet BALANCED: Assets = Liab+Equity = Rp {total_assets:,.2f}")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 10: GET /accounting/cash-flow
# ============================================================================
def test_cash_flow():
    print_test("10. GET /accounting/cash-flow")
    try:
        response = session.get(f"{BASE_URL}/accounting/cash-flow?from=2025-01-01&to=2026-12-31")
        if response.status_code != 200:
            return print_result(False, f"GET cash-flow failed with status {response.status_code}", response.text[:200])
        
        data = response.json()
        cf_data = data.get('data', {})
        
        # Verify required fields
        required_fields = ['beginningCash', 'operating', 'investing', 'financing', 'netChange', 'endingCash']
        missing = [f for f in required_fields if f not in cf_data]
        if missing:
            return print_result(False, f"Cash flow missing fields: {missing}")
        
        # Verify all are numeric
        for field in required_fields:
            if not isinstance(cf_data.get(field), (int, float)):
                return print_result(False, f"Field {field} is not numeric: {cf_data.get(field)}")
        
        beginning = cf_data.get('beginningCash', 0)
        operating = cf_data.get('operating', 0)
        investing = cf_data.get('investing', 0)
        financing = cf_data.get('financing', 0)
        net_change = cf_data.get('netChange', 0)
        ending = cf_data.get('endingCash', 0)
        
        print(f"   Beginning Cash: Rp {beginning:,.2f}")
        print(f"   Operating:      Rp {operating:,.2f}")
        print(f"   Investing:      Rp {investing:,.2f}")
        print(f"   Financing:      Rp {financing:,.2f}")
        print(f"   Net Change:     Rp {net_change:,.2f}")
        print(f"   Ending Cash:    Rp {ending:,.2f}")
        
        return print_result(True, "Cash flow retrieved successfully")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 11: GET /accounting/overview
# ============================================================================
def test_overview():
    print_test("11. GET /accounting/overview")
    try:
        response = session.get(f"{BASE_URL}/accounting/overview")
        if response.status_code != 200:
            return print_result(False, f"GET overview failed with status {response.status_code}", response.text[:200])
        
        data = response.json()
        overview = data.get('data', {})
        
        # Verify required fields
        required_fields = ['cash', 'kas', 'bank', 'piutang', 'utang', 'persediaan', 'netIncomeYtd', 'revenueYtd', 'netIncomeMonth', 'journalCount']
        missing = [f for f in required_fields if f not in overview]
        if missing:
            return print_result(False, f"Overview missing fields: {missing}")
        
        print(f"   Cash:            Rp {overview.get('cash', 0):,.2f}")
        print(f"   Kas:             Rp {overview.get('kas', 0):,.2f}")
        print(f"   Bank:            Rp {overview.get('bank', 0):,.2f}")
        print(f"   Piutang:         Rp {overview.get('piutang', 0):,.2f}")
        print(f"   Utang:           Rp {overview.get('utang', 0):,.2f}")
        print(f"   Persediaan:      Rp {overview.get('persediaan', 0):,.2f}")
        print(f"   Net Income YTD:  Rp {overview.get('netIncomeYtd', 0):,.2f}")
        print(f"   Revenue YTD:     Rp {overview.get('revenueYtd', 0):,.2f}")
        print(f"   Net Income Month: Rp {overview.get('netIncomeMonth', 0):,.2f}")
        print(f"   Journal Count:   {overview.get('journalCount', 0)}")
        
        return print_result(True, "Overview retrieved successfully")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================
def main():
    print("\n" + "="*80)
    print("ACCOUNTING MODULE (SAK EP) - BACKEND API TESTING")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Database: {DB_PATH}")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*80)
    
    results = []
    
    # Login
    if not login():
        print("\n❌ LOGIN FAILED - Cannot proceed with tests")
        sys.exit(1)
    
    # Run all tests
    results.append(("GET /accounting/accounts", test_get_accounts()))
    results.append(("COA CRUD Operations", test_coa_crud()))
    results.append(("GET /accounting/mapping", test_mapping()))
    results.append(("GET /accounting/settings", test_settings()))
    results.append(("POST /accounting/sync (Idempotency)", test_sync_idempotency()))
    results.append(("Journals CRUD", test_journals()))
    results.append(("GET /accounting/trial-balance (CRITICAL)", test_trial_balance()))
    results.append(("GET /accounting/income-statement", test_income_statement()))
    results.append(("GET /accounting/balance-sheet (CRITICAL)", test_balance_sheet()))
    results.append(("GET /accounting/cash-flow", test_cash_flow()))
    results.append(("GET /accounting/overview", test_overview()))
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    print("="*80)
    print(f"TOTAL: {passed}/{total} tests passed ({passed*100//total}%)")
    print("="*80)
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)
    else:
        print(f"\n⚠️  {total - passed} TEST(S) FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
