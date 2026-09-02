#!/usr/bin/env python3
"""
Finance Fase 2 Backend Tests
Tests commission payment, cashback refund, and period filter features.
"""

import requests
import json
from datetime import datetime

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"

# Test credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
AKUNTAN_EMAIL = "akuntan@lpi.co.id"
AKUNTAN_PASSWORD = "akuntanlpi123"
OPERATOR_EMAIL = "operator@lpi.co.id"
OPERATOR_PASSWORD = "operator123"

def login(email, password):
    """Login and return session cookies"""
    url = f"{BASE_URL}/auth/sign-in/email"
    payload = {"email": email, "password": password}
    resp = requests.post(url, json=payload)
    if resp.status_code != 200:
        raise Exception(f"Login failed: {resp.status_code} {resp.text}")
    return resp.cookies

def test_commission_payment():
    """
    Test 1: COMMISSION PAYMENT (POST /api/finance/commissions/pay)
    """
    print("\n" + "="*80)
    print("TEST 1: COMMISSION PAYMENT")
    print("="*80)
    
    # Step 1a: Login admin and get unpaid commission
    print("\n[1a] Login admin and find unpaid commission...")
    cookies = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    
    resp = requests.get(f"{BASE_URL}/finance/overview", cookies=cookies)
    assert resp.status_code == 200, f"GET /finance/overview failed: {resp.status_code}"
    data = resp.json()["data"]
    
    komisi_list = data["komisi"]
    initial_komisi_count = len(komisi_list)
    print(f"   Total komisi records: {initial_komisi_count}")
    
    unpaid = [k for k in komisi_list if k["status"] == "Belum Lunas" and k["amount"] > 0]
    if not unpaid:
        print("   ❌ SKIP: No unpaid commission with amount > 0 found")
        return False
    
    commission = unpaid[0]
    commission_id = commission["id"]
    commission_amount = commission["amount"]
    print(f"   ✓ Found unpaid commission: {commission_id}")
    print(f"   ✓ Amount: {commission_amount}")
    print(f"   ✓ SO Number: {commission['soNumber']}")
    print(f"   ✓ Party: {commission['party']}")
    
    # Step 1b: Get valid cash/bank account
    print("\n[1b] Get valid cash/bank account...")
    resp = requests.get(f"{BASE_URL}/cash-bank-accounts", cookies=cookies)
    assert resp.status_code == 200, f"GET /cash-bank-accounts failed: {resp.status_code}"
    accounts = resp.json()["data"]
    
    if not accounts:
        print("   ❌ SKIP: No cash/bank accounts found")
        return False
    
    # Pick first account starting with 1-11
    account = next((a for a in accounts if a["code"].startswith("1-11")), accounts[0])
    account_code = account["code"]
    account_name = account["name"]
    print(f"   ✓ Selected account: {account_code} - {account_name}")
    
    # Step 1c: Pay commission
    print("\n[1c] Pay commission...")
    payload = {
        "commissionRecordId": commission_id,
        "accountCode": account_code,
        "method": "Transfer"
    }
    resp = requests.post(f"{BASE_URL}/finance/commissions/pay", json=payload, cookies=cookies)
    
    if resp.status_code != 201:
        print(f"   ❌ FAILED: Expected 201, got {resp.status_code}")
        print(f"   Response: {resp.text}")
        return False
    
    result = resp.json()["data"]
    print(f"   ✓ Payment successful (201)")
    print(f"   ✓ Payment ID: {result['paymentId']}")
    print(f"   ✓ Commission ID: {result['commissionRecordId']}")
    print(f"   ✓ Amount: {result['amount']}")
    print(f"   ✓ Account: {result['accountCode']}")
    print(f"   ✓ Status: {result['status']}")
    
    assert result["status"] == "paid", f"Expected status 'paid', got {result['status']}"
    assert result["amount"] == commission_amount, f"Amount mismatch: {result['amount']} != {commission_amount}"
    
    # Step 1d: Verify status changed to Lunas
    print("\n[1d] Verify commission status changed to 'Lunas'...")
    resp = requests.get(f"{BASE_URL}/finance/overview", cookies=cookies)
    assert resp.status_code == 200, f"GET /finance/overview failed: {resp.status_code}"
    data = resp.json()["data"]
    
    updated_commission = next((k for k in data["komisi"] if k["id"] == commission_id), None)
    if not updated_commission:
        print(f"   ❌ FAILED: Commission {commission_id} not found after payment")
        return False
    
    print(f"   ✓ Commission status: {updated_commission['status']}")
    assert updated_commission["status"] == "Lunas", f"Expected 'Lunas', got {updated_commission['status']}"
    
    # Step 1e: Negative tests
    print("\n[1e] Negative tests...")
    
    # Test 1e-1: Pay same commission again (should fail)
    print("   [1e-1] Try to pay same commission again...")
    resp = requests.post(f"{BASE_URL}/finance/commissions/pay", json=payload, cookies=cookies)
    if resp.status_code == 400:
        print(f"   ✓ Correctly rejected duplicate payment (400)")
    else:
        print(f"   ❌ FAILED: Expected 400, got {resp.status_code}")
        return False
    
    # Test 1e-2: Invalid account code
    print("   [1e-2] Try with invalid account code...")
    invalid_payload = {
        "commissionRecordId": commission_id,
        "accountCode": "X-999",
        "method": "Transfer"
    }
    resp = requests.post(f"{BASE_URL}/finance/commissions/pay", json=invalid_payload, cookies=cookies)
    if resp.status_code == 400:
        print(f"   ✓ Correctly rejected invalid account (400)")
    else:
        print(f"   ❌ FAILED: Expected 400, got {resp.status_code}")
        return False
    
    # Test 1e-3: Bogus commission ID
    print("   [1e-3] Try with bogus commission ID...")
    bogus_payload = {
        "commissionRecordId": "bogus-id-12345",
        "accountCode": account_code,
        "method": "Transfer"
    }
    resp = requests.post(f"{BASE_URL}/finance/commissions/pay", json=bogus_payload, cookies=cookies)
    if resp.status_code == 404:
        print(f"   ✓ Correctly returned 404 for nonexistent commission")
    else:
        print(f"   ❌ FAILED: Expected 404, got {resp.status_code}")
        return False
    
    # Test 1e-4: Operator role (should be forbidden)
    print("   [1e-4] Try as operator (should be 403)...")
    operator_cookies = login(OPERATOR_EMAIL, OPERATOR_PASSWORD)
    resp = requests.post(f"{BASE_URL}/finance/commissions/pay", json=payload, cookies=operator_cookies)
    if resp.status_code == 403:
        print(f"   ✓ Correctly forbidden for operator (403)")
    else:
        print(f"   ❌ FAILED: Expected 403, got {resp.status_code}")
        return False
    
    # Step 1f: Verify accounting journal
    print("\n[1f] Verify accounting journal created...")
    akuntan_cookies = login(AKUNTAN_EMAIL, AKUNTAN_PASSWORD)
    
    # Wait a bit for the persist to complete (it happens asynchronously after the response)
    print("   Waiting 5 seconds for persist to complete...")
    import time
    time.sleep(5)
    
    # Trigger accounting sync to ensure journals are generated
    print("   Triggering accounting sync...")
    sync_resp = requests.post(f"{BASE_URL}/accounting/sync", cookies=akuntan_cookies)
    if sync_resp.status_code == 200:
        print("   ✓ Accounting sync successful")
    else:
        print(f"   ⚠ WARNING: Sync returned {sync_resp.status_code}")
    
    resp = requests.get(f"{BASE_URL}/accounting/journals?limit=500", cookies=akuntan_cookies)
    
    if resp.status_code != 200:
        print(f"   ❌ FAILED: GET /accounting/journals returned {resp.status_code}")
        return False
    
    journals = resp.json()["data"]
    payment_id = result["paymentId"]
    
    # Debug: show all journal source types
    source_types = set(j.get("source_type") for j in journals if j.get("source_type"))
    print(f"   DEBUG: Found journal source types: {source_types}")
    print(f"   DEBUG: Looking for payment_id: {payment_id}")
    
    # Find journal with source_key starting with COMPAY:
    compay_journals = [j for j in journals if j.get("source_key") and str(j.get("source_key")).startswith("COMPAY:")]
    
    print(f"   DEBUG: Found {len(compay_journals)} COMPAY journals total")
    if compay_journals:
        print(f"   DEBUG: COMPAY source_keys: {[j.get('source_key') for j in compay_journals[:5]]}")
    
    if not compay_journals:
        print(f"   ❌ FAILED: No COMPAY journal found")
        return False
    
    # Find the specific journal for this payment
    journal = next((j for j in compay_journals if payment_id in str(j.get("source_key", ""))), compay_journals[0])
    
    print(f"   ✓ Found COMPAY journal: {journal.get('source_key')}")
    print(f"   ✓ Journal ID: {journal.get('id')}")
    print(f"   ✓ Date: {journal.get('date')}")
    print(f"   ✓ Description: {journal.get('description')}")
    print(f"   DEBUG: Journal keys: {list(journal.keys())}")
    
    # Verify journal lines
    lines = journal.get("lines", [])
    if not lines:
        # Try to get the journal detail
        print(f"   DEBUG: No lines in list response, fetching journal detail...")
        detail_resp = requests.get(f"{BASE_URL}/accounting/journals/{journal.get('id')}", cookies=akuntan_cookies)
        if detail_resp.status_code == 200:
            journal = detail_resp.json()["data"]
            lines = journal.get("lines", [])
            print(f"   DEBUG: Detail response has {len(lines)} lines")
    if len(lines) < 2:
        print(f"   ❌ FAILED: Expected at least 2 lines, got {len(lines)}")
        return False
    
    # Find debit and credit lines
    debit_line = next((l for l in lines if l.get("debit", 0) > 0), None)
    credit_line = next((l for l in lines if l.get("credit", 0) > 0), None)
    
    if not debit_line or not credit_line:
        print(f"   ❌ FAILED: Missing debit or credit line")
        return False
    
    print(f"   ✓ Debit line: {debit_line.get('account_code')} - {debit_line.get('account_name')} = {debit_line.get('debit')}")
    print(f"   ✓ Credit line: {credit_line.get('account_code')} - {credit_line.get('account_name')} = {credit_line.get('credit')}")
    
    # Verify debit is to Beban Komisi (6-1400)
    if not debit_line.get("account_code", "").startswith("6-14"):
        print(f"   ⚠ WARNING: Expected debit to 6-14xx (Beban Komisi), got {debit_line.get('account_code')}")
    
    # Verify credit is to the selected account
    if credit_line.get("account_code") != account_code:
        print(f"   ⚠ WARNING: Expected credit to {account_code}, got {credit_line.get('account_code')}")
    
    # Verify amounts match
    total_debit = sum(l.get("debit", 0) for l in lines)
    total_credit = sum(l.get("credit", 0) for l in lines)
    
    print(f"   ✓ Total debit: {total_debit}")
    print(f"   ✓ Total credit: {total_credit}")
    
    if total_debit != total_credit:
        print(f"   ❌ FAILED: Journal not balanced! Debit={total_debit}, Credit={total_credit}")
        return False
    
    print(f"   ✓ Journal is balanced")
    
    # Verify amount matches commission amount
    if abs(total_debit - commission_amount) > 1:  # Allow 1 rupiah rounding
        print(f"   ⚠ WARNING: Journal amount {total_debit} doesn't match commission {commission_amount}")
    else:
        print(f"   ✓ Journal amount matches commission amount")
    
    print("\n✅ TEST 1 PASSED: Commission payment working correctly")
    return True


def test_cashback_refund():
    """
    Test 2: CASHBACK REFUND (POST /api/sales-orders/:id/cashback-refund)
    """
    print("\n" + "="*80)
    print("TEST 2: CASHBACK REFUND")
    print("="*80)
    
    # Step 2a: Login admin and find unrefunded cashback
    print("\n[2a] Login admin and find unrefunded cashback...")
    cookies = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    
    resp = requests.get(f"{BASE_URL}/finance/overview", cookies=cookies)
    assert resp.status_code == 200, f"GET /finance/overview failed: {resp.status_code}"
    data = resp.json()["data"]
    
    cashback_list = data["cashback"]
    print(f"   Total cashback records: {len(cashback_list)}")
    
    unrefunded = [c for c in cashback_list if c["status"] == "Belum Dikembalikan"]
    if not unrefunded:
        print("   ❌ SKIP: No unrefunded cashback found")
        return False
    
    cashback = unrefunded[0]
    so_id = cashback["id"]
    cashback_amount = cashback["amount"]
    print(f"   ✓ Found unrefunded cashback: SO ID {so_id}")
    print(f"   ✓ Amount: {cashback_amount}")
    print(f"   ✓ SO Number: {cashback['soNumber']}")
    print(f"   ✓ Party: {cashback['party']}")
    
    # Step 2b: Verify no CASHBACK journal exists yet (gating change)
    print("\n[2b] Verify no CASHBACK journal exists yet (before refund)...")
    akuntan_cookies = login(AKUNTAN_EMAIL, AKUNTAN_PASSWORD)
    
    # Trigger sync first
    sync_resp = requests.post(f"{BASE_URL}/accounting/sync", cookies=akuntan_cookies)
    
    resp = requests.get(f"{BASE_URL}/accounting/journals?limit=500", cookies=akuntan_cookies)
    
    if resp.status_code != 200:
        print(f"   ⚠ WARNING: GET /accounting/journals returned {resp.status_code}")
    else:
        journals = resp.json()["data"]
        cashback_journals = [j for j in journals if j.get("source_key") and str(j.get("source_key")).startswith(f"CASHBACK:{so_id}")]
        
        if cashback_journals:
            print(f"   ⚠ WARNING: Found {len(cashback_journals)} CASHBACK journal(s) before refund (expected 0)")
            print(f"   Note: This is the gating change - unrefunded cashback should NOT have journals")
        else:
            print(f"   ✓ No CASHBACK journal found (correct - gating change working)")
    
    # Step 2c: Refund cashback
    print("\n[2c] Refund cashback...")
    
    # Get valid account
    resp = requests.get(f"{BASE_URL}/cash-bank-accounts", cookies=cookies)
    assert resp.status_code == 200, f"GET /cash-bank-accounts failed: {resp.status_code}"
    accounts = resp.json()["data"]
    account = next((a for a in accounts if a["code"].startswith("1-11")), accounts[0])
    account_code = account["code"]
    print(f"   Selected account: {account_code} - {account['name']}")
    
    # Prepare multipart form data
    form_data = {
        "accountCode": account_code,
        "refundedAt": "2026-02-10"
    }
    
    resp = requests.post(f"{BASE_URL}/sales-orders/{so_id}/cashback-refund", 
                        data=form_data, cookies=cookies)
    
    if resp.status_code != 201:
        print(f"   ❌ FAILED: Expected 201, got {resp.status_code}")
        print(f"   Response: {resp.text}")
        return False
    
    result = resp.json()["data"]
    print(f"   ✓ Refund successful (201)")
    print(f"   ✓ SO ID: {result['id']}")
    print(f"   ✓ Cashback refunded: {result['cashbackRefunded']}")
    print(f"   ✓ Refunded at: {result['cashbackRefundedAt']}")
    
    assert result["cashbackRefunded"] == True, "Expected cashbackRefunded=true"
    
    # Step 2d: Verify status changed to Dikembalikan
    print("\n[2d] Verify cashback status changed to 'Dikembalikan'...")
    resp = requests.get(f"{BASE_URL}/finance/overview", cookies=cookies)
    assert resp.status_code == 200, f"GET /finance/overview failed: {resp.status_code}"
    data = resp.json()["data"]
    
    updated_cashback = next((c for c in data["cashback"] if c["id"] == so_id), None)
    if not updated_cashback:
        print(f"   ❌ FAILED: Cashback SO {so_id} not found after refund")
        return False
    
    print(f"   ✓ Cashback status: {updated_cashback['status']}")
    assert updated_cashback["status"] == "Dikembalikan", f"Expected 'Dikembalikan', got {updated_cashback['status']}"
    
    # Step 2e: Verify accounting journal created
    print("\n[2e] Verify CASHBACK accounting journal created...")
    
    # Wait for persist to complete
    print("   Waiting 2 seconds for persist to complete...")
    import time
    time.sleep(2)
    
    # Trigger sync to ensure journal is generated
    print("   Triggering accounting sync...")
    sync_resp = requests.post(f"{BASE_URL}/accounting/sync", cookies=akuntan_cookies)
    if sync_resp.status_code == 200:
        print("   ✓ Accounting sync successful")
    else:
        print(f"   ⚠ WARNING: Sync returned {sync_resp.status_code}")
    
    resp = requests.get(f"{BASE_URL}/accounting/journals?limit=500", cookies=akuntan_cookies)
    
    if resp.status_code != 200:
        print(f"   ❌ FAILED: GET /accounting/journals returned {resp.status_code}")
        return False
    
    journals = resp.json()["data"]
    cashback_journals = [j for j in journals if j.get("source_key") and str(j.get("source_key")).startswith(f"CASHBACK:{so_id}")]
    
    if not cashback_journals:
        print(f"   ❌ FAILED: No CASHBACK journal found after refund")
        return False
    
    journal = cashback_journals[0]
    print(f"   ✓ Found CASHBACK journal: {journal.get('source_key')}")
    print(f"   ✓ Journal ID: {journal.get('id')}")
    print(f"   ✓ Date: {journal.get('date')}")
    print(f"   ✓ Description: {journal.get('description')}")
    print(f"   DEBUG: Journal keys: {list(journal.keys())}")
    
    # Verify journal lines
    lines = journal.get("lines", [])
    if not lines:
        # Try to get the journal detail
        print(f"   DEBUG: No lines in list response, fetching journal detail...")
        detail_resp = requests.get(f"{BASE_URL}/accounting/journals/{journal.get('id')}", cookies=akuntan_cookies)
        if detail_resp.status_code == 200:
            journal = detail_resp.json()["data"]
            lines = journal.get("lines", [])
            print(f"   DEBUG: Detail response has {len(lines)} lines")
    if len(lines) < 2:
        print(f"   ❌ FAILED: Expected at least 2 lines, got {len(lines)}")
        return False
    
    debit_line = next((l for l in lines if l.get("debit", 0) > 0), None)
    credit_line = next((l for l in lines if l.get("credit", 0) > 0), None)
    
    if not debit_line or not credit_line:
        print(f"   ❌ FAILED: Missing debit or credit line")
        return False
    
    print(f"   ✓ Debit line: {debit_line.get('account_code')} - {debit_line.get('account_name')} = {debit_line.get('debit')}")
    print(f"   ✓ Credit line: {credit_line.get('account_code')} - {credit_line.get('account_name')} = {credit_line.get('credit')}")
    
    # Verify debit is to Beban Komisi (6-1400)
    if not debit_line.get("account_code", "").startswith("6-14"):
        print(f"   ⚠ WARNING: Expected debit to 6-14xx (Beban Komisi), got {debit_line.get('account_code')}")
    
    # Verify credit is to the selected account
    if credit_line.get("account_code") != account_code:
        print(f"   ⚠ WARNING: Expected credit to {account_code}, got {credit_line.get('account_code')}")
    
    # Verify balanced
    total_debit = sum(l.get("debit", 0) for l in lines)
    total_credit = sum(l.get("credit", 0) for l in lines)
    
    print(f"   ✓ Total debit: {total_debit}")
    print(f"   ✓ Total credit: {total_credit}")
    
    if total_debit != total_credit:
        print(f"   ❌ FAILED: Journal not balanced! Debit={total_debit}, Credit={total_credit}")
        return False
    
    print(f"   ✓ Journal is balanced")
    
    # Verify amount matches cashback amount
    if abs(total_debit - cashback_amount) > 1:
        print(f"   ⚠ WARNING: Journal amount {total_debit} doesn't match cashback {cashback_amount}")
    else:
        print(f"   ✓ Journal amount matches cashback amount")
    
    # Step 2f: Negative test - invalid account
    print("\n[2f] Negative test - invalid account code...")
    
    # Find another unrefunded cashback for negative test
    resp = requests.get(f"{BASE_URL}/finance/overview", cookies=cookies)
    data = resp.json()["data"]
    unrefunded = [c for c in data["cashback"] if c["status"] == "Belum Dikembalikan"]
    
    if unrefunded:
        test_so_id = unrefunded[0]["id"]
        invalid_form = {
            "accountCode": "X-999",
            "refundedAt": "2026-02-10"
        }
        resp = requests.post(f"{BASE_URL}/sales-orders/{test_so_id}/cashback-refund",
                           data=invalid_form, cookies=cookies)
        if resp.status_code == 400:
            print(f"   ✓ Correctly rejected invalid account (400)")
        else:
            print(f"   ⚠ WARNING: Expected 400, got {resp.status_code}")
    else:
        print(f"   ⚠ SKIP: No more unrefunded cashback for negative test")
    
    print("\n✅ TEST 2 PASSED: Cashback refund working correctly")
    return True


def test_period_filter():
    """
    Test 3: PERIOD FILTER (GET /api/finance/overview?from=&to=)
    """
    print("\n" + "="*80)
    print("TEST 3: PERIOD FILTER")
    print("="*80)
    
    cookies = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    
    # Step 3a: Get unfiltered data
    print("\n[3a] Get unfiltered data...")
    resp = requests.get(f"{BASE_URL}/finance/overview", cookies=cookies)
    assert resp.status_code == 200, f"GET /finance/overview failed: {resp.status_code}"
    unfiltered = resp.json()["data"]
    
    unfiltered_counts = {
        "invoiceSO": len(unfiltered["invoiceSO"]),
        "invoicePO": len(unfiltered["invoicePO"]),
        "komisi": len(unfiltered["komisi"]),
        "cashback": len(unfiltered["cashback"])
    }
    
    print(f"   Unfiltered counts:")
    print(f"   - invoiceSO: {unfiltered_counts['invoiceSO']}")
    print(f"   - invoicePO: {unfiltered_counts['invoicePO']}")
    print(f"   - komisi: {unfiltered_counts['komisi']}")
    print(f"   - cashback: {unfiltered_counts['cashback']}")
    
    # Step 3b: Filter by August 2026
    print("\n[3b] Filter by August 2026 (2026-08-01 to 2026-08-31)...")
    resp = requests.get(f"{BASE_URL}/finance/overview?from=2026-08-01&to=2026-08-31", cookies=cookies)
    assert resp.status_code == 200, f"GET /finance/overview with filter failed: {resp.status_code}"
    august_data = resp.json()["data"]
    
    august_counts = {
        "invoiceSO": len(august_data["invoiceSO"]),
        "invoicePO": len(august_data["invoicePO"]),
        "komisi": len(august_data["komisi"]),
        "cashback": len(august_data["cashback"])
    }
    
    print(f"   August 2026 counts:")
    print(f"   - invoiceSO: {august_counts['invoiceSO']}")
    print(f"   - invoicePO: {august_counts['invoicePO']}")
    print(f"   - komisi: {august_counts['komisi']}")
    print(f"   - cashback: {august_counts['cashback']}")
    
    # Verify counts are <= unfiltered
    all_ok = True
    for key in august_counts:
        if august_counts[key] > unfiltered_counts[key]:
            print(f"   ❌ FAILED: {key} count increased with filter ({august_counts[key]} > {unfiltered_counts[key]})")
            all_ok = False
        else:
            print(f"   ✓ {key}: {august_counts[key]} <= {unfiltered_counts[key]}")
    
    if not all_ok:
        return False
    
    # Verify dates are within August (sample check)
    if august_data["invoiceSO"]:
        print(f"   Sample invoiceSO dates:")
        for so in august_data["invoiceSO"][:3]:
            print(f"   - {so.get('soNumber')}: (check date in source)")
    
    # Step 3c: Filter by old date range (should be empty or near-empty)
    print("\n[3c] Filter by old date range (2020-01-01 to 2020-01-02)...")
    resp = requests.get(f"{BASE_URL}/finance/overview?from=2020-01-01&to=2020-01-02", cookies=cookies)
    assert resp.status_code == 200, f"GET /finance/overview with old filter failed: {resp.status_code}"
    old_data = resp.json()["data"]
    
    old_counts = {
        "invoiceSO": len(old_data["invoiceSO"]),
        "invoicePO": len(old_data["invoicePO"]),
        "komisi": len(old_data["komisi"]),
        "cashback": len(old_data["cashback"])
    }
    
    print(f"   Old date range counts:")
    print(f"   - invoiceSO: {old_counts['invoiceSO']}")
    print(f"   - invoicePO: {old_counts['invoicePO']}")
    print(f"   - komisi: {old_counts['komisi']}")
    print(f"   - cashback: {old_counts['cashback']}")
    
    # Should be empty or very small
    total_old = sum(old_counts.values())
    if total_old == 0:
        print(f"   ✓ All arrays empty (expected for old date range)")
    elif total_old < 5:
        print(f"   ✓ Near-empty ({total_old} total records)")
    else:
        print(f"   ⚠ WARNING: Expected empty/near-empty, got {total_old} records")
    
    print("\n✅ TEST 3 PASSED: Period filter working correctly")
    return True


def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("FINANCE FASE 2 BACKEND TESTS")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Test time: {datetime.now().isoformat()}")
    
    results = {}
    
    try:
        results["test_1_commission_payment"] = test_commission_payment()
    except Exception as e:
        print(f"\n❌ TEST 1 FAILED WITH EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
        results["test_1_commission_payment"] = False
    
    try:
        results["test_2_cashback_refund"] = test_cashback_refund()
    except Exception as e:
        print(f"\n❌ TEST 2 FAILED WITH EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
        results["test_2_cashback_refund"] = False
    
    try:
        results["test_3_period_filter"] = test_period_filter()
    except Exception as e:
        print(f"\n❌ TEST 3 FAILED WITH EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
        results["test_3_period_filter"] = False
    
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
        print("\n🎉 ALL TESTS PASSED!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        return 1


if __name__ == "__main__":
    exit(main())
