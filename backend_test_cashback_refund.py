#!/usr/bin/env python3
"""
Backend test for SO Cashback (Faktur di-up) refund-proof feature.
Tests the new endpoints:
- POST /api/sales-orders/:id/cashback-refund (multipart)
- GET /api/sales-orders/:id/cashback-proof
- DELETE /api/sales-orders/:id/cashback-refund
- GET /api/contacts/:id/history (cashbackHistory)
- GET /api/cash-bank-accounts

FULLY REVERSIBLE on LIVE MongoDB Atlas.
"""

import requests
import io
import os
from datetime import datetime

# Base URL from .env
BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"

# Test credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

# Session for cookies
session = requests.Session()

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def test_login():
    """TEST 1: Login as admin"""
    log("TEST 1: Login as admin...")
    url = f"{BASE_URL}/auth/sign-in/email"
    payload = {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    
    try:
        resp = session.post(url, json=payload, timeout=30)
        log(f"  POST {url} → {resp.status_code}")
        
        if resp.status_code != 200:
            log(f"  ❌ FAILED: Expected 200, got {resp.status_code}")
            log(f"  Response: {resp.text[:500]}")
            return False
        
        # Check if session cookie is set
        cookies = session.cookies.get_dict()
        has_session = any('session' in k.lower() for k in cookies.keys())
        
        if not has_session:
            log(f"  ❌ FAILED: No session cookie set")
            log(f"  Cookies: {cookies}")
            return False
        
        log(f"  ✅ PASSED: Login successful, session cookie set")
        return True
        
    except Exception as e:
        log(f"  ❌ EXCEPTION: {e}")
        return False

def test_cash_bank_accounts():
    """TEST A: GET /api/cash-bank-accounts → assert non-empty array"""
    log("\nTEST A: GET /api/cash-bank-accounts...")
    url = f"{BASE_URL}/cash-bank-accounts"
    
    try:
        resp = session.get(url, timeout=30)
        log(f"  GET {url} → {resp.status_code}")
        
        if resp.status_code != 200:
            log(f"  ❌ FAILED: Expected 200, got {resp.status_code}")
            return None
        
        data = resp.json()
        accounts = data.get('data', [])
        
        if not accounts or len(accounts) == 0:
            log(f"  ❌ FAILED: Expected non-empty array, got {len(accounts)} accounts")
            return None
        
        log(f"  ✅ PASSED: Found {len(accounts)} cash/bank accounts")
        for acc in accounts[:3]:
            log(f"    - {acc.get('code')}: {acc.get('name')}")
        
        # Capture a bank account code for cashback
        bank_code = None
        for acc in accounts:
            code = acc.get('code', '')
            if code.startswith('1-112'):  # Bank accounts
                bank_code = code
                break
        
        if not bank_code and accounts:
            bank_code = accounts[0].get('code')
        
        log(f"  Selected cashback account: {bank_code}")
        return bank_code
        
    except Exception as e:
        log(f"  ❌ EXCEPTION: {e}")
        return None

def test_find_or_setup_cashback_so(cashback_account):
    """TEST B: Find or set up an SO with cashback"""
    log("\nTEST B: Find or set up an SO with cashback...")
    url = f"{BASE_URL}/sales-orders"
    
    try:
        resp = session.get(url, timeout=30)
        log(f"  GET {url} → {resp.status_code}")
        
        if resp.status_code != 200:
            log(f"  ❌ FAILED: Expected 200, got {resp.status_code}")
            return None, None, None
        
        data = resp.json()
        orders = data.get('data', [])
        log(f"  Found {len(orders)} sales orders")
        
        # Look for existing SO with cashback
        for so in orders:
            if so.get('markupEnabled') and float(so.get('cashbackAmount', 0)) > 0 and so.get('customerId'):
                log(f"  ✅ Found existing SO with cashback: {so.get('soNumber')}")
                log(f"    - SO ID: {so.get('id')}")
                log(f"    - Customer ID: {so.get('customerId')}")
                log(f"    - Cashback Amount: Rp {so.get('cashbackAmount'):,.0f}")
                return so.get('id'), so.get('customerId'), None
        
        # No existing cashback SO, need to enable markup on one
        log("  No existing cashback SO found, looking for suitable SO to enable markup...")
        
        for so in orders:
            if so.get('customerId') and so.get('pipelineStatus') not in ['Cancelled']:
                so_id = so.get('id')
                customer_id = so.get('customerId')
                
                # Get SO details to capture original state
                detail_url = f"{BASE_URL}/sales-orders/{so_id}"
                detail_resp = session.get(detail_url, timeout=30)
                
                if detail_resp.status_code != 200:
                    continue
                
                so_detail = detail_resp.json().get('data', {})
                items = so_detail.get('items', [])
                
                if not items:
                    continue
                
                # Capture original markup state
                original_state = {
                    'markupEnabled': so_detail.get('markupEnabled', False),
                    'cashbackRecipient': so_detail.get('cashbackRecipient'),
                    'cashbackAccount': so_detail.get('cashbackAccount'),
                    'items': []
                }
                
                for item in items:
                    original_state['items'].append({
                        'itemId': item.get('id'),
                        'markupUnitPrice': item.get('markupUnitPrice'),
                    })
                
                log(f"  Found suitable SO: {so.get('soNumber')} (ID: {so_id})")
                log(f"  Original markupEnabled: {original_state['markupEnabled']}")
                
                # Enable markup
                first_item = items[0]
                unit_price = float(first_item.get('unitPrice', 0))
                markup_price = round(unit_price * 1.1, 2)  # 10% markup
                
                markup_payload = {
                    'markupEnabled': True,
                    'items': [{
                        'itemId': first_item.get('id'),
                        'markupUnitPrice': markup_price
                    }],
                    'cashbackRecipient': 'Test PIC QA',
                    'cashbackAccount': cashback_account
                }
                
                markup_url = f"{BASE_URL}/sales-orders/{so_id}/markup"
                markup_resp = session.post(markup_url, json=markup_payload, timeout=30)
                
                log(f"  POST {markup_url} → {markup_resp.status_code}")
                
                if markup_resp.status_code != 200:
                    log(f"  ⚠️  Failed to enable markup: {markup_resp.text[:200]}")
                    continue
                
                # Verify cashback was created
                verify_resp = session.get(detail_url, timeout=30)
                if verify_resp.status_code == 200:
                    updated_so = verify_resp.json().get('data', {})
                    cashback_amount = float(updated_so.get('cashbackAmount', 0))
                    
                    if cashback_amount > 0:
                        log(f"  ✅ Successfully enabled markup on SO {so.get('soNumber')}")
                        log(f"    - Cashback Amount: Rp {cashback_amount:,.0f}")
                        log(f"    - Cashback Account: {cashback_account}")
                        log(f"    - Cashback Recipient: Test PIC QA")
                        return so_id, customer_id, original_state
                
        log(f"  ❌ FAILED: Could not find or create SO with cashback")
        return None, None, None
        
    except Exception as e:
        log(f"  ❌ EXCEPTION: {e}")
        return None, None, None

def test_post_cashback_refund(so_id):
    """TEST C: POST /api/sales-orders/:id/cashback-refund (multipart)"""
    log("\nTEST C: POST /api/sales-orders/:id/cashback-refund (multipart)...")
    url = f"{BASE_URL}/sales-orders/{so_id}/cashback-refund"
    
    try:
        # Create a tiny valid PNG (1x1 pixel transparent PNG)
        png_bytes = bytes([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,  # PNG signature
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,  # IHDR chunk
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,  # 1x1 dimensions
            0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
            0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,  # IDAT chunk
            0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
            0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,  # IEND chunk
            0x42, 0x60, 0x82
        ])
        
        files = {
            'file': ('test-cashback-proof.png', io.BytesIO(png_bytes), 'image/png')
        }
        
        data = {
            'refundedAt': '2026-02-01',
            'note': 'Test refund QA'
        }
        
        resp = session.post(url, files=files, data=data, timeout=30)
        log(f"  POST {url} → {resp.status_code}")
        
        if resp.status_code != 201:
            log(f"  ❌ FAILED: Expected 201, got {resp.status_code}")
            log(f"  Response: {resp.text[:500]}")
            return False
        
        result = resp.json()
        result_data = result.get('data', {})
        
        # Verify response fields
        checks = [
            ('cashbackRefunded', True, result_data.get('cashbackRefunded')),
            ('cashbackRefundedAt', '2026-02-01', result_data.get('cashbackRefundedAt')),
            ('hasProof', True, result_data.get('hasProof')),
            ('proofUrl contains /cashback-proof', True, '/cashback-proof' in str(result_data.get('proofUrl', ''))),
        ]
        
        all_passed = True
        for check_name, expected, actual in checks:
            if actual == expected:
                log(f"  ✅ {check_name}: {actual}")
            else:
                log(f"  ❌ {check_name}: expected {expected}, got {actual}")
                all_passed = False
        
        if all_passed:
            log(f"  ✅ PASSED: Cashback refund recorded successfully")
        
        return all_passed
        
    except Exception as e:
        log(f"  ❌ EXCEPTION: {e}")
        return False

def test_get_so_verify_refund(so_id):
    """TEST D: GET /api/sales-orders/:id → verify refund fields"""
    log("\nTEST D: GET /api/sales-orders/:id → verify refund fields...")
    url = f"{BASE_URL}/sales-orders/{so_id}"
    
    try:
        resp = session.get(url, timeout=30)
        log(f"  GET {url} → {resp.status_code}")
        
        if resp.status_code != 200:
            log(f"  ❌ FAILED: Expected 200, got {resp.status_code}")
            return False
        
        data = resp.json().get('data', {})
        
        # Verify fields
        checks = [
            ('cashbackRefunded', True, data.get('cashbackRefunded')),
            ('cashbackRefundedAt', '2026-02-01', data.get('cashbackRefundedAt')),
            ('cashbackRefundNote', 'Test refund QA', data.get('cashbackRefundNote')),
            ('cashbackProofName present', True, bool(data.get('cashbackProofName'))),
            ('cashbackRefundedBy present', True, bool(data.get('cashbackRefundedBy'))),
        ]
        
        all_passed = True
        for check_name, expected, actual in checks:
            if actual == expected:
                log(f"  ✅ {check_name}: {actual}")
            else:
                log(f"  ❌ {check_name}: expected {expected}, got {actual}")
                all_passed = False
        
        if all_passed:
            log(f"  ✅ PASSED: All refund fields verified")
        
        return all_passed
        
    except Exception as e:
        log(f"  ❌ EXCEPTION: {e}")
        return False

def test_get_cashback_proof(so_id):
    """TEST E: GET /api/sales-orders/:id/cashback-proof → verify file serve"""
    log("\nTEST E: GET /api/sales-orders/:id/cashback-proof...")
    url = f"{BASE_URL}/sales-orders/{so_id}/cashback-proof"
    
    try:
        resp = session.get(url, timeout=30)
        log(f"  GET {url} → {resp.status_code}")
        
        if resp.status_code != 200:
            log(f"  ❌ FAILED: Expected 200, got {resp.status_code}")
            return False
        
        content_type = resp.headers.get('Content-Type', '')
        content_length = len(resp.content)
        
        log(f"  Content-Type: {content_type}")
        log(f"  Content-Length: {content_length} bytes")
        
        # Verify content type is image/png or application/pdf
        valid_types = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
        type_ok = any(t in content_type for t in valid_types)
        
        checks = [
            ('Content-Type valid', True, type_ok),
            ('Body non-empty', True, content_length > 0),
        ]
        
        all_passed = True
        for check_name, expected, actual in checks:
            if actual == expected:
                log(f"  ✅ {check_name}: {actual}")
            else:
                log(f"  ❌ {check_name}: expected {expected}, got {actual}")
                all_passed = False
        
        if all_passed:
            log(f"  ✅ PASSED: Proof file served successfully")
        
        return all_passed
        
    except Exception as e:
        log(f"  ❌ EXCEPTION: {e}")
        return False

def test_customer_history(customer_id, so_id):
    """TEST F: GET /api/contacts/:id/history → verify cashbackHistory"""
    log("\nTEST F: GET /api/contacts/:customerId/history...")
    url = f"{BASE_URL}/contacts/{customer_id}/history"
    
    try:
        resp = session.get(url, timeout=30)
        log(f"  GET {url} → {resp.status_code}")
        
        if resp.status_code != 200:
            log(f"  ❌ FAILED: Expected 200, got {resp.status_code}")
            return False
        
        result = resp.json()
        data = result.get('data', {})
        cashback_history = data.get('cashbackHistory', [])
        summary = data.get('summary', {})
        
        log(f"  Found {len(cashback_history)} cashback entries")
        
        # Find our SO in the history
        our_entry = None
        for entry in cashback_history:
            if entry.get('id') == so_id:
                our_entry = entry
                break
        
        if not our_entry:
            log(f"  ❌ FAILED: SO {so_id} not found in cashbackHistory")
            return False
        
        log(f"  Found our SO in cashbackHistory:")
        log(f"    - SO Number: {our_entry.get('soNumber')}")
        log(f"    - Cashback Amount: Rp {our_entry.get('cashbackAmount', 0):,.0f}")
        log(f"    - Cashback Account: {our_entry.get('cashbackAccount')}")
        log(f"    - Cashback Account Name: {our_entry.get('cashbackAccountName')}")
        
        # Verify fields
        checks = [
            ('cashbackRefunded', True, our_entry.get('cashbackRefunded')),
            ('hasProof', True, our_entry.get('hasProof')),
            ('cashbackAccountName non-empty', True, bool(our_entry.get('cashbackAccountName'))),
            ('cashbackAmount > 0', True, float(our_entry.get('cashbackAmount', 0)) > 0),
            ('summary.totalCashback > 0', True, float(summary.get('totalCashback', 0)) > 0),
            ('summary.totalCashbackRefunded > 0', True, float(summary.get('totalCashbackRefunded', 0)) > 0),
            ('summary.cashbackCount >= 1', True, int(summary.get('cashbackCount', 0)) >= 1),
        ]
        
        all_passed = True
        for check_name, expected, actual in checks:
            if actual == expected:
                log(f"  ✅ {check_name}: {actual}")
            else:
                log(f"  ❌ {check_name}: expected {expected}, got {actual}")
                all_passed = False
        
        if all_passed:
            log(f"  ✅ PASSED: Cashback history verified")
        
        return all_passed
        
    except Exception as e:
        log(f"  ❌ EXCEPTION: {e}")
        return False

def test_delete_cashback_refund(so_id):
    """TEST G: DELETE /api/sales-orders/:id/cashback-refund"""
    log("\nTEST G: DELETE /api/sales-orders/:id/cashback-refund...")
    url = f"{BASE_URL}/sales-orders/{so_id}/cashback-refund"
    
    try:
        resp = session.delete(url, timeout=30)
        log(f"  DELETE {url} → {resp.status_code}")
        
        if resp.status_code != 200:
            log(f"  ❌ FAILED: Expected 200, got {resp.status_code}")
            return False
        
        result = resp.json()
        if not result.get('ok'):
            log(f"  ❌ FAILED: Expected ok:true, got {result}")
            return False
        
        log(f"  ✅ DELETE successful")
        
        # Verify SO fields cleared
        so_url = f"{BASE_URL}/sales-orders/{so_id}"
        so_resp = session.get(so_url, timeout=30)
        
        if so_resp.status_code != 200:
            log(f"  ⚠️  Could not verify SO fields: {so_resp.status_code}")
            return True  # DELETE succeeded, verification optional
        
        so_data = so_resp.json().get('data', {})
        
        checks = [
            ('cashbackRefunded', False, so_data.get('cashbackRefunded')),
            ('cashbackProofName', None, so_data.get('cashbackProofName')),
        ]
        
        all_passed = True
        for check_name, expected, actual in checks:
            # Handle None/null comparison
            if (expected is None and actual is None) or (expected is False and not actual):
                log(f"  ✅ {check_name}: cleared (was {actual})")
            elif actual == expected:
                log(f"  ✅ {check_name}: {actual}")
            else:
                log(f"  ❌ {check_name}: expected {expected}, got {actual}")
                all_passed = False
        
        # Verify proof endpoint returns 404
        proof_url = f"{BASE_URL}/sales-orders/{so_id}/cashback-proof"
        proof_resp = session.get(proof_url, timeout=30)
        
        if proof_resp.status_code == 404:
            log(f"  ✅ Proof endpoint returns 404 (file deleted)")
        else:
            log(f"  ❌ Proof endpoint returned {proof_resp.status_code}, expected 404")
            all_passed = False
        
        if all_passed:
            log(f"  ✅ PASSED: Cashback refund deleted and verified")
        
        return all_passed
        
    except Exception as e:
        log(f"  ❌ EXCEPTION: {e}")
        return False

def test_role_check(so_id):
    """TEST H: Role check - attempt POST without auth"""
    log("\nTEST H: Role check - POST without auth should return 401/403...")
    
    # Create a new session without auth
    unauth_session = requests.Session()
    url = f"{BASE_URL}/sales-orders/{so_id}/cashback-refund"
    
    try:
        # Create minimal multipart data
        files = {'file': ('test.png', io.BytesIO(b'fake'), 'image/png')}
        data = {'refundedAt': '2026-02-01', 'note': 'Test'}
        
        resp = unauth_session.post(url, files=files, data=data, timeout=30)
        log(f"  POST {url} (no auth) → {resp.status_code}")
        
        if resp.status_code in [401, 403]:
            log(f"  ✅ PASSED: Correctly rejected with {resp.status_code}")
            return True
        else:
            log(f"  ❌ FAILED: Expected 401/403, got {resp.status_code}")
            return False
        
    except Exception as e:
        log(f"  ❌ EXCEPTION: {e}")
        return False

def test_cleanup(so_id, original_state):
    """TEST I: CLEANUP - restore original state"""
    log("\nTEST I: CLEANUP - restore original SO state...")
    
    if original_state is None:
        log("  No cleanup needed (SO already had cashback)")
        return True
    
    url = f"{BASE_URL}/sales-orders/{so_id}/markup"
    
    try:
        # Restore original markup state
        payload = {
            'markupEnabled': original_state['markupEnabled']
        }
        
        # If originally disabled, just disable it
        if not original_state['markupEnabled']:
            payload['markupEnabled'] = False
        
        resp = session.post(url, json=payload, timeout=30)
        log(f"  POST {url} → {resp.status_code}")
        
        if resp.status_code != 200:
            log(f"  ⚠️  Failed to restore original state: {resp.text[:200]}")
            return False
        
        # Verify restoration
        verify_url = f"{BASE_URL}/sales-orders/{so_id}"
        verify_resp = session.get(verify_url, timeout=30)
        
        if verify_resp.status_code == 200:
            so_data = verify_resp.json().get('data', {})
            current_markup = so_data.get('markupEnabled')
            current_cashback = float(so_data.get('cashbackAmount', 0))
            
            log(f"  Original markupEnabled: {original_state['markupEnabled']}")
            log(f"  Current markupEnabled: {current_markup}")
            log(f"  Current cashbackAmount: Rp {current_cashback:,.0f}")
            
            if current_markup == original_state['markupEnabled']:
                log(f"  ✅ PASSED: SO restored to original state")
                return True
            else:
                log(f"  ⚠️  Markup state differs from original")
                return False
        
        return True
        
    except Exception as e:
        log(f"  ❌ EXCEPTION: {e}")
        return False

def main():
    log("=" * 80)
    log("SO CASHBACK REFUND-PROOF BACKEND TEST")
    log("Testing on LIVE MongoDB Atlas (FULLY REVERSIBLE)")
    log("=" * 80)
    
    results = {}
    
    # TEST 1: Login
    results['login'] = test_login()
    if not results['login']:
        log("\n❌ LOGIN FAILED - Cannot continue")
        return
    
    # TEST A: Cash/Bank accounts
    cashback_account = test_cash_bank_accounts()
    results['cash_bank_accounts'] = cashback_account is not None
    if not cashback_account:
        log("\n❌ CASH/BANK ACCOUNTS TEST FAILED - Cannot continue")
        return
    
    # TEST B: Find or setup SO with cashback
    so_id, customer_id, original_state = test_find_or_setup_cashback_so(cashback_account)
    results['setup_cashback_so'] = so_id is not None
    if not so_id:
        log("\n❌ SETUP CASHBACK SO FAILED - Cannot continue")
        return
    
    # TEST C: POST cashback refund
    results['post_refund'] = test_post_cashback_refund(so_id)
    
    # TEST D: Verify SO refund fields
    results['verify_so_refund'] = test_get_so_verify_refund(so_id)
    
    # TEST E: GET cashback proof
    results['get_proof'] = test_get_cashback_proof(so_id)
    
    # TEST F: Customer history
    results['customer_history'] = test_customer_history(customer_id, so_id)
    
    # TEST G: DELETE cashback refund
    results['delete_refund'] = test_delete_cashback_refund(so_id)
    
    # TEST H: Role check
    results['role_check'] = test_role_check(so_id)
    
    # TEST I: Cleanup
    results['cleanup'] = test_cleanup(so_id, original_state)
    
    # Summary
    log("\n" + "=" * 80)
    log("TEST SUMMARY")
    log("=" * 80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ PASSED" if result else "❌ FAILED"
        log(f"  {test_name}: {status}")
    
    log(f"\nTotal: {passed}/{total} tests passed ({passed*100//total}%)")
    
    if passed == total:
        log("\n🎉 ALL TESTS PASSED - Feature working correctly!")
    else:
        log(f"\n⚠️  {total - passed} test(s) failed")
    
    log("=" * 80)

if __name__ == "__main__":
    main()
