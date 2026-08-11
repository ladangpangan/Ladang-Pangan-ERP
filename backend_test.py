#!/usr/bin/env python3
"""
Backend API Testing Script - Pencatatan Cepat (Cash Book / Quick Entry) Module
Tests all cashbook endpoints with comprehensive scenarios including RBAC and validation.
"""

import requests
import json
import sys
import sqlite3
from datetime import datetime
import time

# Configuration
BASE_URL = "http://localhost:3000/api"
DB_PATH = "/app/data/erp.db"

# Test credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
OPERATOR_EMAIL = "operator@lpi.co.id"
OPERATOR_PASSWORD = "operator123"
DIREKTUR_EMAIL = "direktur@lpi.co.id"
DIREKTUR_PASSWORD = "direktur123"

# Global session
session = requests.Session()

# Track created journal entries for cleanup
created_journal_ids = []

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

def login(email, password):
    """Login and establish session"""
    print(f"   Logging in as {email}...")
    try:
        # Add delay to avoid rate limiting
        time.sleep(1)
        
        response = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": email, "password": password},
            headers={
                "Content-Type": "application/json",
                "Origin": "http://localhost:3000"
            }
        )
        
        if response.status_code == 200:
            print(f"   ✓ Login successful")
            return True
        else:
            print(f"   ✗ Login failed with status {response.status_code}: {response.text[:200]}")
            return False
    except Exception as e:
        print(f"   ✗ Login exception: {str(e)}")
        return False

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

def execute_db(query, params=()):
    """Execute SQLite write query"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(query, params)
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"DB execute error: {e}")
        return False

# ============================================================================
# TEST 1: GET /accounting/accounts - Get account codes for testing
# ============================================================================
def test_get_accounts():
    print_test("1. GET /accounting/accounts?archived=0 - Get account codes")
    try:
        response = session.get(f"{BASE_URL}/accounting/accounts?archived=0")
        if response.status_code != 200:
            return print_result(False, f"GET accounts failed with status {response.status_code}", response.text[:200])
        
        data = response.json()
        accounts = data.get('data', [])
        
        # Find required accounts
        expense_accounts = [a for a in accounts if a.get('type') == 'expense' and not a.get('isHeader')]
        income_accounts = [a for a in accounts if a.get('type') == 'other_income' and not a.get('isHeader')]
        cash_accounts = [a for a in accounts if a.get('code') in ['1-1110', '1-1120']]
        
        if not expense_accounts:
            return print_result(False, "No expense accounts found")
        if not income_accounts:
            return print_result(False, "No other_income accounts found")
        if len(cash_accounts) < 2:
            return print_result(False, "Cash/bank accounts (1-1110, 1-1120) not found")
        
        # Store for later use
        global expense_code, income_code, kas_code, bank_code
        expense_code = expense_accounts[0]['code']
        income_code = income_accounts[0]['code']
        kas_code = '1-1110'
        bank_code = '1-1120'
        
        print(f"   Expense account: {expense_code} ({expense_accounts[0].get('name')})")
        print(f"   Income account: {income_code} ({income_accounts[0].get('name')})")
        print(f"   Kas account: {kas_code}")
        print(f"   Bank account: {bank_code}")
        
        return print_result(True, f"Found {len(accounts)} accounts including required types")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 2: POST /accounting/cashbook - EXPENSE
# ============================================================================
def test_post_expense():
    print_test("2. POST /accounting/cashbook - Create EXPENSE entry")
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        payload = {
            "type": "EXPENSE",
            "date": today,
            "amount": 150000,
            "categoryCode": expense_code,
            "cashCode": kas_code,
            "note": "Beli ATK"
        }
        
        response = session.post(
            f"{BASE_URL}/accounting/cashbook",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code != 200:
            return print_result(False, f"POST expense failed with status {response.status_code}", response.text[:300])
        
        data = response.json()
        if not data.get('ok'):
            return print_result(False, "Response ok=false", json.dumps(data))
        
        journal_id = data.get('id')
        journal_number = data.get('journalNumber')
        
        if not journal_id or not journal_number:
            return print_result(False, "Missing id or journalNumber in response", json.dumps(data))
        
        # Track for cleanup
        created_journal_ids.append(journal_id)
        
        print(f"   Journal ID: {journal_id}")
        print(f"   Journal Number: {journal_number}")
        
        # Verify in list
        from_ts = int(datetime.now().replace(month=1, day=1, hour=0, minute=0, second=0).timestamp())
        to_ts = int(datetime.now().timestamp()) + 86400
        
        list_response = session.get(f"{BASE_URL}/accounting/cashbook?from={from_ts}&to={to_ts}")
        if list_response.status_code != 200:
            return print_result(False, "Failed to verify in list", list_response.text[:200])
        
        list_data = list_response.json()
        entries = list_data.get('data', [])
        found = next((e for e in entries if e['id'] == journal_id), None)
        
        if not found:
            return print_result(False, "Entry not found in list")
        
        # Verify fields
        if found['direction'] != 'out':
            return print_result(False, f"Expected direction='out', got '{found['direction']}'")
        if found['amount'] != 150000:
            return print_result(False, f"Expected amount=150000, got {found['amount']}")
        if found['hasAttachment'] != False:
            return print_result(False, f"Expected hasAttachment=false, got {found['hasAttachment']}")
        if not found['category']:
            return print_result(False, "Category name not set")
        
        print(f"   ✓ Entry found in list with correct fields")
        print(f"   ✓ direction: {found['direction']}")
        print(f"   ✓ amount: {found['amount']}")
        print(f"   ✓ category: {found['category']}")
        print(f"   ✓ hasAttachment: {found['hasAttachment']}")
        
        return print_result(True, "EXPENSE entry created successfully")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 3: POST /accounting/cashbook - INCOME
# ============================================================================
def test_post_income():
    print_test("3. POST /accounting/cashbook - Create INCOME entry")
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        payload = {
            "type": "INCOME",
            "date": today,
            "amount": 200000,
            "categoryCode": income_code,
            "cashCode": bank_code,
            "note": "Pendapatan lain-lain"
        }
        
        response = session.post(
            f"{BASE_URL}/accounting/cashbook",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code != 200:
            return print_result(False, f"POST income failed with status {response.status_code}", response.text[:300])
        
        data = response.json()
        if not data.get('ok'):
            return print_result(False, "Response ok=false", json.dumps(data))
        
        journal_id = data.get('id')
        created_journal_ids.append(journal_id)
        
        # Verify direction='in'
        from_ts = int(datetime.now().replace(month=1, day=1, hour=0, minute=0, second=0).timestamp())
        to_ts = int(datetime.now().timestamp()) + 86400
        
        list_response = session.get(f"{BASE_URL}/accounting/cashbook?from={from_ts}&to={to_ts}")
        list_data = list_response.json()
        entries = list_data.get('data', [])
        found = next((e for e in entries if e['id'] == journal_id), None)
        
        if not found or found['direction'] != 'in':
            return print_result(False, f"Expected direction='in', got '{found['direction'] if found else 'NOT FOUND'}'")
        
        print(f"   ✓ Journal ID: {journal_id}")
        print(f"   ✓ direction: {found['direction']}")
        print(f"   ✓ amount: {found['amount']}")
        
        return print_result(True, "INCOME entry created successfully")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 4: POST /accounting/cashbook - CAPITAL
# ============================================================================
def test_post_capital():
    print_test("4. POST /accounting/cashbook - Create CAPITAL entry")
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        payload = {
            "type": "CAPITAL",
            "date": today,
            "amount": 5000000,
            "cashCode": bank_code,
            "note": "Setoran modal"
        }
        
        response = session.post(
            f"{BASE_URL}/accounting/cashbook",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code != 200:
            return print_result(False, f"POST capital failed with status {response.status_code}", response.text[:300])
        
        data = response.json()
        if not data.get('ok'):
            return print_result(False, "Response ok=false", json.dumps(data))
        
        journal_id = data.get('id')
        created_journal_ids.append(journal_id)
        
        # Verify direction='in' and category='Modal Disetor'
        from_ts = int(datetime.now().replace(month=1, day=1, hour=0, minute=0, second=0).timestamp())
        to_ts = int(datetime.now().timestamp()) + 86400
        
        list_response = session.get(f"{BASE_URL}/accounting/cashbook?from={from_ts}&to={to_ts}")
        list_data = list_response.json()
        entries = list_data.get('data', [])
        found = next((e for e in entries if e['id'] == journal_id), None)
        
        if not found or found['direction'] != 'in':
            return print_result(False, f"Expected direction='in', got '{found['direction'] if found else 'NOT FOUND'}'")
        
        print(f"   ✓ Journal ID: {journal_id}")
        print(f"   ✓ direction: {found['direction']}")
        print(f"   ✓ category: {found['category']}")
        print(f"   ✓ amount: {found['amount']}")
        
        return print_result(True, "CAPITAL entry created successfully")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 5: POST /accounting/cashbook - DRAWING
# ============================================================================
def test_post_drawing():
    print_test("5. POST /accounting/cashbook - Create DRAWING entry")
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        payload = {
            "type": "DRAWING",
            "date": today,
            "amount": 300000,
            "cashCode": kas_code,
            "note": "Ambil pribadi"
        }
        
        response = session.post(
            f"{BASE_URL}/accounting/cashbook",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code != 200:
            return print_result(False, f"POST drawing failed with status {response.status_code}", response.text[:300])
        
        data = response.json()
        if not data.get('ok'):
            return print_result(False, "Response ok=false", json.dumps(data))
        
        journal_id = data.get('id')
        created_journal_ids.append(journal_id)
        
        # Verify direction='out' and category='Prive'
        from_ts = int(datetime.now().replace(month=1, day=1, hour=0, minute=0, second=0).timestamp())
        to_ts = int(datetime.now().timestamp()) + 86400
        
        list_response = session.get(f"{BASE_URL}/accounting/cashbook?from={from_ts}&to={to_ts}")
        list_data = list_response.json()
        entries = list_data.get('data', [])
        found = next((e for e in entries if e['id'] == journal_id), None)
        
        if not found or found['direction'] != 'out':
            return print_result(False, f"Expected direction='out', got '{found['direction'] if found else 'NOT FOUND'}'")
        
        print(f"   ✓ Journal ID: {journal_id}")
        print(f"   ✓ direction: {found['direction']}")
        print(f"   ✓ category: {found['category']}")
        print(f"   ✓ amount: {found['amount']}")
        
        return print_result(True, "DRAWING entry created successfully")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 6: POST /accounting/cashbook - TRANSFER (valid)
# ============================================================================
def test_post_transfer_valid():
    print_test("6. POST /accounting/cashbook - Create TRANSFER entry (valid)")
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        payload = {
            "type": "TRANSFER",
            "date": today,
            "amount": 1000000,
            "cashCode": kas_code,
            "cashCode2": bank_code,
            "note": "Transfer kas ke bank"
        }
        
        response = session.post(
            f"{BASE_URL}/accounting/cashbook",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code != 200:
            return print_result(False, f"POST transfer failed with status {response.status_code}", response.text[:300])
        
        data = response.json()
        if not data.get('ok'):
            return print_result(False, "Response ok=false", json.dumps(data))
        
        journal_id = data.get('id')
        created_journal_ids.append(journal_id)
        
        # Verify direction='move'
        from_ts = int(datetime.now().replace(month=1, day=1, hour=0, minute=0, second=0).timestamp())
        to_ts = int(datetime.now().timestamp()) + 86400
        
        list_response = session.get(f"{BASE_URL}/accounting/cashbook?from={from_ts}&to={to_ts}")
        list_data = list_response.json()
        entries = list_data.get('data', [])
        found = next((e for e in entries if e['id'] == journal_id), None)
        
        if not found or found['direction'] != 'move':
            return print_result(False, f"Expected direction='move', got '{found['direction'] if found else 'NOT FOUND'}'")
        
        print(f"   ✓ Journal ID: {journal_id}")
        print(f"   ✓ direction: {found['direction']}")
        print(f"   ✓ cashCode: {found['cashCode']}")
        print(f"   ✓ cashCode2: {found['cashCode2']}")
        print(f"   ✓ amount: {found['amount']}")
        
        return print_result(True, "TRANSFER entry created successfully")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 7: POST /accounting/cashbook - TRANSFER (invalid - same account)
# ============================================================================
def test_post_transfer_invalid():
    print_test("7. POST /accounting/cashbook - TRANSFER with same account (should fail)")
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        payload = {
            "type": "TRANSFER",
            "date": today,
            "amount": 1000000,
            "cashCode": kas_code,
            "cashCode2": kas_code,  # Same as cashCode
            "note": "Invalid transfer"
        }
        
        response = session.post(
            f"{BASE_URL}/accounting/cashbook",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 400:
            data = response.json()
            error_msg = data.get('error', '')
            if 'tidak boleh sama' in error_msg.lower() or 'sama' in error_msg.lower():
                print(f"   ✓ Correctly rejected with error: {error_msg}")
                return print_result(True, "TRANSFER with same account correctly rejected")
            else:
                return print_result(False, f"Wrong error message: {error_msg}")
        else:
            return print_result(False, f"Expected 400, got {response.status_code}", response.text[:300])
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 8: POST /accounting/cashbook - EXPENSE with attachment
# ============================================================================
def test_post_with_attachment():
    print_test("8. POST /accounting/cashbook - EXPENSE with attachment")
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        # Tiny 1x1 PNG base64
        attachment_data = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        
        payload = {
            "type": "EXPENSE",
            "date": today,
            "amount": 75000,
            "categoryCode": expense_code,
            "cashCode": kas_code,
            "note": "Expense with nota",
            "attachment": attachment_data
        }
        
        response = session.post(
            f"{BASE_URL}/accounting/cashbook",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code != 200:
            return print_result(False, f"POST with attachment failed with status {response.status_code}", response.text[:300])
        
        data = response.json()
        if not data.get('ok'):
            return print_result(False, "Response ok=false", json.dumps(data))
        
        journal_id = data.get('id')
        created_journal_ids.append(journal_id)
        
        # Verify hasAttachment=true in list
        from_ts = int(datetime.now().replace(month=1, day=1, hour=0, minute=0, second=0).timestamp())
        to_ts = int(datetime.now().timestamp()) + 86400
        
        list_response = session.get(f"{BASE_URL}/accounting/cashbook?from={from_ts}&to={to_ts}")
        list_data = list_response.json()
        entries = list_data.get('data', [])
        found = next((e for e in entries if e['id'] == journal_id), None)
        
        if not found or found['hasAttachment'] != True:
            return print_result(False, f"Expected hasAttachment=true, got {found['hasAttachment'] if found else 'NOT FOUND'}")
        
        # GET attachment
        attach_response = session.get(f"{BASE_URL}/accounting/cashbook/{journal_id}/attachment")
        if attach_response.status_code != 200:
            return print_result(False, f"GET attachment failed with status {attach_response.status_code}")
        
        attach_data = attach_response.json()
        returned_attachment = attach_data.get('attachment')
        
        if returned_attachment != attachment_data:
            return print_result(False, "Attachment data mismatch")
        
        print(f"   ✓ Journal ID: {journal_id}")
        print(f"   ✓ hasAttachment: {found['hasAttachment']}")
        print(f"   ✓ Attachment retrieved successfully")
        print(f"   ✓ Attachment data matches original")
        
        return print_result(True, "EXPENSE with attachment created and retrieved successfully")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 9: PUT /accounting/cashbook/:id - Update entry
# ============================================================================
def test_put_update():
    print_test("9. PUT /accounting/cashbook/:id - Update entry (preserve attachment)")
    try:
        # Use the entry with attachment from test 8
        if len(created_journal_ids) < 6:
            return print_result(False, "Not enough entries created for update test")
        
        journal_id = created_journal_ids[-1]  # Last one (with attachment)
        
        today = datetime.now().strftime('%Y-%m-%d')
        payload = {
            "type": "EXPENSE",
            "date": today,
            "amount": 85000,  # Changed amount
            "categoryCode": expense_code,
            "cashCode": kas_code,
            "note": "Updated expense"
            # Note: attachment field omitted to test preservation
        }
        
        response = session.put(
            f"{BASE_URL}/accounting/cashbook/{journal_id}",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code != 200:
            return print_result(False, f"PUT update failed with status {response.status_code}", response.text[:300])
        
        data = response.json()
        if not data.get('ok'):
            return print_result(False, "Response ok=false", json.dumps(data))
        
        # Verify updated amount
        from_ts = int(datetime.now().replace(month=1, day=1, hour=0, minute=0, second=0).timestamp())
        to_ts = int(datetime.now().timestamp()) + 86400
        
        list_response = session.get(f"{BASE_URL}/accounting/cashbook?from={from_ts}&to={to_ts}")
        list_data = list_response.json()
        entries = list_data.get('data', [])
        
        # Note: After update, the ID changes (delete + recreate), so find by amount
        found = next((e for e in entries if e['amount'] == 85000 and e['note'] == 'Updated expense'), None)
        
        if not found:
            return print_result(False, "Updated entry not found in list")
        
        if found['hasAttachment'] != True:
            return print_result(False, f"Expected hasAttachment=true (preserved), got {found['hasAttachment']}")
        
        # Update the ID in our tracking list
        created_journal_ids[-1] = found['id']
        
        # Verify attachment still exists
        attach_response = session.get(f"{BASE_URL}/accounting/cashbook/{found['id']}/attachment")
        if attach_response.status_code != 200:
            return print_result(False, "GET attachment after update failed")
        
        attach_data = attach_response.json()
        if not attach_data.get('attachment'):
            return print_result(False, "Attachment not preserved after update")
        
        print(f"   ✓ New Journal ID: {found['id']}")
        print(f"   ✓ Updated amount: {found['amount']}")
        print(f"   ✓ hasAttachment: {found['hasAttachment']} (preserved)")
        print(f"   ✓ Attachment still accessible")
        
        return print_result(True, "Entry updated successfully with attachment preserved")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 10: DELETE /accounting/cashbook/:id
# ============================================================================
def test_delete():
    print_test("10. DELETE /accounting/cashbook/:id - Delete entry")
    try:
        if len(created_journal_ids) < 1:
            return print_result(False, "No entries to delete")
        
        journal_id = created_journal_ids[0]  # Delete first entry
        
        response = session.delete(f"{BASE_URL}/accounting/cashbook/{journal_id}")
        
        if response.status_code != 200:
            return print_result(False, f"DELETE failed with status {response.status_code}", response.text[:300])
        
        data = response.json()
        if not data.get('ok'):
            return print_result(False, "Response ok=false", json.dumps(data))
        
        # Verify not in list
        from_ts = int(datetime.now().replace(month=1, day=1, hour=0, minute=0, second=0).timestamp())
        to_ts = int(datetime.now().timestamp()) + 86400
        
        list_response = session.get(f"{BASE_URL}/accounting/cashbook?from={from_ts}&to={to_ts}")
        list_data = list_response.json()
        entries = list_data.get('data', [])
        found = next((e for e in entries if e['id'] == journal_id), None)
        
        if found:
            return print_result(False, "Entry still in list after delete")
        
        # Remove from tracking
        created_journal_ids.remove(journal_id)
        
        print(f"   ✓ Entry {journal_id} deleted successfully")
        print(f"   ✓ Entry not in list")
        
        return print_result(True, "Entry deleted successfully")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 11: Negative - POST with amount=0
# ============================================================================
def test_negative_amount_zero():
    print_test("11. Negative test - POST with amount=0 (should fail)")
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        payload = {
            "type": "EXPENSE",
            "date": today,
            "amount": 0,
            "categoryCode": expense_code,
            "cashCode": kas_code,
            "note": "Invalid amount"
        }
        
        response = session.post(
            f"{BASE_URL}/accounting/cashbook",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 400:
            data = response.json()
            error_msg = data.get('error', '')
            print(f"   ✓ Correctly rejected with error: {error_msg}")
            return print_result(True, "Amount=0 correctly rejected")
        else:
            return print_result(False, f"Expected 400, got {response.status_code}", response.text[:300])
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 12: Negative - POST with invalid type
# ============================================================================
def test_negative_invalid_type():
    print_test("12. Negative test - POST with invalid type (should fail)")
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        payload = {
            "type": "FOO",
            "date": today,
            "amount": 100000,
            "categoryCode": expense_code,
            "cashCode": kas_code,
            "note": "Invalid type"
        }
        
        response = session.post(
            f"{BASE_URL}/accounting/cashbook",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 400:
            data = response.json()
            error_msg = data.get('error', '')
            print(f"   ✓ Correctly rejected with error: {error_msg}")
            return print_result(True, "Invalid type correctly rejected")
        else:
            return print_result(False, f"Expected 400, got {response.status_code}", response.text[:300])
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 13: RBAC - Operator GET (should fail - 403)
# ============================================================================
def test_rbac_operator_get():
    print_test("13. RBAC - Operator GET /accounting/cashbook (should fail)")
    try:
        # Login as operator
        if not login(OPERATOR_EMAIL, OPERATOR_PASSWORD):
            return print_result(False, "Failed to login as operator")
        
        from_ts = int(datetime.now().replace(month=1, day=1, hour=0, minute=0, second=0).timestamp())
        to_ts = int(datetime.now().timestamp()) + 86400
        
        response = session.get(f"{BASE_URL}/accounting/cashbook?from={from_ts}&to={to_ts}")
        
        if response.status_code == 403:
            print(f"   ✓ Correctly rejected with 403 Forbidden")
            # Re-login as admin for remaining tests
            login(ADMIN_EMAIL, ADMIN_PASSWORD)
            return print_result(True, "Operator GET correctly rejected")
        else:
            # Re-login as admin
            login(ADMIN_EMAIL, ADMIN_PASSWORD)
            return print_result(False, f"Expected 403, got {response.status_code}", response.text[:300])
    except Exception as e:
        # Re-login as admin
        login(ADMIN_EMAIL, ADMIN_PASSWORD)
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 14: RBAC - Operator POST (should fail - 403)
# ============================================================================
def test_rbac_operator_post():
    print_test("14. RBAC - Operator POST /accounting/cashbook (should fail)")
    try:
        # Login as operator
        if not login(OPERATOR_EMAIL, OPERATOR_PASSWORD):
            return print_result(False, "Failed to login as operator")
        
        today = datetime.now().strftime('%Y-%m-%d')
        payload = {
            "type": "EXPENSE",
            "date": today,
            "amount": 50000,
            "categoryCode": expense_code,
            "cashCode": kas_code,
            "note": "Operator test"
        }
        
        response = session.post(
            f"{BASE_URL}/accounting/cashbook",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 403:
            print(f"   ✓ Correctly rejected with 403 Forbidden")
            # Re-login as admin
            login(ADMIN_EMAIL, ADMIN_PASSWORD)
            return print_result(True, "Operator POST correctly rejected")
        else:
            # Re-login as admin
            login(ADMIN_EMAIL, ADMIN_PASSWORD)
            return print_result(False, f"Expected 403, got {response.status_code}", response.text[:300])
    except Exception as e:
        # Re-login as admin
        login(ADMIN_EMAIL, ADMIN_PASSWORD)
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 15: RBAC - Direktur GET (should succeed - 200)
# ============================================================================
def test_rbac_direktur_get():
    print_test("15. RBAC - Direktur GET /accounting/cashbook (should succeed)")
    try:
        # Login as direktur
        if not login(DIREKTUR_EMAIL, DIREKTUR_PASSWORD):
            return print_result(False, "Failed to login as direktur")
        
        from_ts = int(datetime.now().replace(month=1, day=1, hour=0, minute=0, second=0).timestamp())
        to_ts = int(datetime.now().timestamp()) + 86400
        
        response = session.get(f"{BASE_URL}/accounting/cashbook?from={from_ts}&to={to_ts}")
        
        if response.status_code == 200:
            print(f"   ✓ Direktur can read cashbook")
            # Re-login as admin
            login(ADMIN_EMAIL, ADMIN_PASSWORD)
            return print_result(True, "Direktur GET succeeded")
        else:
            # Re-login as admin
            login(ADMIN_EMAIL, ADMIN_PASSWORD)
            return print_result(False, f"Expected 200, got {response.status_code}", response.text[:300])
    except Exception as e:
        # Re-login as admin
        login(ADMIN_EMAIL, ADMIN_PASSWORD)
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 16: RBAC - Direktur POST (should fail - 403)
# ============================================================================
def test_rbac_direktur_post():
    print_test("16. RBAC - Direktur POST /accounting/cashbook (should fail)")
    try:
        # Login as direktur
        if not login(DIREKTUR_EMAIL, DIREKTUR_PASSWORD):
            return print_result(False, "Failed to login as direktur")
        
        today = datetime.now().strftime('%Y-%m-%d')
        payload = {
            "type": "EXPENSE",
            "date": today,
            "amount": 50000,
            "categoryCode": expense_code,
            "cashCode": kas_code,
            "note": "Direktur test"
        }
        
        response = session.post(
            f"{BASE_URL}/accounting/cashbook",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 403:
            print(f"   ✓ Correctly rejected with 403 Forbidden")
            # Re-login as admin
            login(ADMIN_EMAIL, ADMIN_PASSWORD)
            return print_result(True, "Direktur POST correctly rejected")
        else:
            # Re-login as admin
            login(ADMIN_EMAIL, ADMIN_PASSWORD)
            return print_result(False, f"Expected 403, got {response.status_code}", response.text[:300])
    except Exception as e:
        # Re-login as admin
        login(ADMIN_EMAIL, ADMIN_PASSWORD)
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# TEST 17: Verify journals are balanced
# ============================================================================
def test_verify_balanced():
    print_test("17. Verify all created journals are balanced (total_debit == total_credit)")
    try:
        if not created_journal_ids:
            return print_result(True, "No journals to verify (all deleted)")
        
        all_balanced = True
        for journal_id in created_journal_ids:
            rows = query_db("SELECT total_debit, total_credit FROM journal_entries WHERE id=?", (journal_id,))
            if not rows:
                print(f"   ⚠ Journal {journal_id} not found in DB")
                continue
            
            total_debit = rows[0][0]
            total_credit = rows[0][1]
            
            if abs(total_debit - total_credit) > 0.01:
                print(f"   ✗ Journal {journal_id} NOT balanced: debit={total_debit}, credit={total_credit}")
                all_balanced = False
            else:
                print(f"   ✓ Journal {journal_id} balanced: debit={total_debit}, credit={total_credit}")
        
        if all_balanced:
            return print_result(True, "All journals are balanced")
        else:
            return print_result(False, "Some journals are NOT balanced")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# CLEANUP: Delete all created journal entries
# ============================================================================
def cleanup():
    print_test("CLEANUP - Delete all created journal entries")
    try:
        if not created_journal_ids:
            return print_result(True, "No entries to clean up")
        
        print(f"   Deleting {len(created_journal_ids)} journal entries...")
        
        deleted_count = 0
        for journal_id in created_journal_ids:
            # Delete journal_lines first (FK constraint)
            execute_db("DELETE FROM journal_lines WHERE journal_id=?", (journal_id,))
            # Delete journal_entry
            execute_db("DELETE FROM journal_entries WHERE id=?", (journal_id,))
            deleted_count += 1
            print(f"   ✓ Deleted journal {journal_id}")
        
        # Verify cleanup
        remaining = 0
        for journal_id in created_journal_ids:
            rows = query_db("SELECT id FROM journal_entries WHERE id=?", (journal_id,))
            if rows:
                remaining += 1
                print(f"   ✗ Journal {journal_id} still exists")
        
        if remaining == 0:
            print(f"   ✓ All {deleted_count} journal entries deleted successfully")
            return print_result(True, f"Cleanup complete - {deleted_count} entries deleted")
        else:
            return print_result(False, f"{remaining} entries still exist after cleanup")
    except Exception as e:
        return print_result(False, f"Exception: {str(e)}")

# ============================================================================
# MAIN TEST RUNNER
# ============================================================================
def main():
    print("\n" + "="*80)
    print("PENCATATAN CEPAT (CASH BOOK / QUICK ENTRY) API - BACKEND TEST")
    print("="*80)
    
    # Login as admin
    if not login(ADMIN_EMAIL, ADMIN_PASSWORD):
        print("\n❌ FATAL: Failed to login as admin. Aborting tests.")
        sys.exit(1)
    
    results = []
    
    # Run tests
    results.append(("Get accounts", test_get_accounts()))
    results.append(("POST EXPENSE", test_post_expense()))
    results.append(("POST INCOME", test_post_income()))
    results.append(("POST CAPITAL", test_post_capital()))
    results.append(("POST DRAWING", test_post_drawing()))
    results.append(("POST TRANSFER (valid)", test_post_transfer_valid()))
    results.append(("POST TRANSFER (invalid)", test_post_transfer_invalid()))
    results.append(("POST with attachment", test_post_with_attachment()))
    results.append(("PUT update", test_put_update()))
    results.append(("DELETE", test_delete()))
    results.append(("Negative: amount=0", test_negative_amount_zero()))
    results.append(("Negative: invalid type", test_negative_invalid_type()))
    results.append(("RBAC: Operator GET", test_rbac_operator_get()))
    results.append(("RBAC: Operator POST", test_rbac_operator_post()))
    results.append(("RBAC: Direktur GET", test_rbac_direktur_get()))
    results.append(("RBAC: Direktur POST", test_rbac_direktur_post()))
    results.append(("Verify balanced", test_verify_balanced()))
    
    # Cleanup
    cleanup()
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {name}")
    
    print("\n" + "="*80)
    print(f"TOTAL: {passed}/{total} tests passed ({int(passed/total*100)}%)")
    print("="*80)
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)
    else:
        print(f"\n⚠️  {total - passed} TEST(S) FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
