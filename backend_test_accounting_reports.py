#!/usr/bin/env python3
"""
Backend Test: ACCOUNTING REPORT CONSISTENCY
Tests the [DATA-SOURCE=MongoDB] verification log on accounting report endpoints
(Neraca/balance-sheet & Laba-Rugi/income-statement) mirroring Dashboard behavior.
"""

import requests
import json
import time
from http.cookiejar import Cookie

# Configuration
BASE_URL = "http://localhost:3000/api"

# Auth credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

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

def test_accounting_reports():
    """Test all accounting report endpoints"""
    print("\n" + "="*80)
    print("ACCOUNTING REPORT CONSISTENCY TEST")
    print("="*80)
    
    # Login as admin
    print("\n[1] Logging in as admin...")
    admin_session = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_session:
        log_test("Admin Login", False, "Failed to login as admin")
        return
    log_test("Admin Login", True, "Successfully logged in as admin")
    
    # Test 1: GET /api/accounting/balance-sheet (Neraca)
    print("\n[2] Testing GET /api/accounting/balance-sheet...")
    try:
        response = admin_session.get(f"{BASE_URL}/accounting/balance-sheet")
        if response.status_code == 200:
            data = response.json()
            # Check if response has expected structure (assets/liabilities/equity)
            if 'data' in data:
                report_data = data['data']
                has_structure = any(key in str(report_data) for key in ['assets', 'liabilities', 'equity', 'aset', 'kewajiban', 'ekuitas'])
                log_test("GET /api/accounting/balance-sheet", True, 
                        f"Status: {response.status_code}, Has expected structure: {has_structure}")
            else:
                log_test("GET /api/accounting/balance-sheet", True, 
                        f"Status: {response.status_code}, Response: {str(data)[:200]}")
        else:
            log_test("GET /api/accounting/balance-sheet", False, 
                    f"Expected 200, got {response.status_code}: {response.text[:200]}")
    except Exception as e:
        log_test("GET /api/accounting/balance-sheet", False, f"Exception: {str(e)}")
    
    # Test 2: GET /api/accounting/income-statement (Laba-Rugi)
    print("\n[3] Testing GET /api/accounting/income-statement...")
    try:
        response = admin_session.get(f"{BASE_URL}/accounting/income-statement")
        if response.status_code == 200:
            data = response.json()
            if 'data' in data:
                report_data = data['data']
                has_structure = any(key in str(report_data) for key in ['revenue', 'expense', 'netIncome', 'pendapatan', 'beban', 'laba'])
                log_test("GET /api/accounting/income-statement", True, 
                        f"Status: {response.status_code}, Has expected structure: {has_structure}")
            else:
                log_test("GET /api/accounting/income-statement", True, 
                        f"Status: {response.status_code}, Response: {str(data)[:200]}")
        else:
            log_test("GET /api/accounting/income-statement", False, 
                    f"Expected 200, got {response.status_code}: {response.text[:200]}")
    except Exception as e:
        log_test("GET /api/accounting/income-statement", False, f"Exception: {str(e)}")
    
    # Test 3: GET /api/accounting/trial-balance
    print("\n[4] Testing GET /api/accounting/trial-balance...")
    try:
        response = admin_session.get(f"{BASE_URL}/accounting/trial-balance")
        if response.status_code == 200:
            log_test("GET /api/accounting/trial-balance", True, f"Status: {response.status_code}")
        else:
            log_test("GET /api/accounting/trial-balance", False, 
                    f"Expected 200, got {response.status_code}: {response.text[:200]}")
    except Exception as e:
        log_test("GET /api/accounting/trial-balance", False, f"Exception: {str(e)}")
    
    # Test 4: GET /api/accounting/ledger
    print("\n[5] Testing GET /api/accounting/ledger...")
    try:
        response = admin_session.get(f"{BASE_URL}/accounting/ledger")
        if response.status_code == 200:
            log_test("GET /api/accounting/ledger", True, f"Status: {response.status_code}")
        else:
            log_test("GET /api/accounting/ledger", False, 
                    f"Expected 200, got {response.status_code}: {response.text[:200]}")
    except Exception as e:
        log_test("GET /api/accounting/ledger", False, f"Exception: {str(e)}")
    
    # Test 5: GET /api/accounting/cash-flow
    print("\n[6] Testing GET /api/accounting/cash-flow...")
    try:
        response = admin_session.get(f"{BASE_URL}/accounting/cash-flow")
        if response.status_code == 200:
            log_test("GET /api/accounting/cash-flow", True, f"Status: {response.status_code}")
        else:
            log_test("GET /api/accounting/cash-flow", False, 
                    f"Expected 200, got {response.status_code}: {response.text[:200]}")
    except Exception as e:
        log_test("GET /api/accounting/cash-flow", False, f"Exception: {str(e)}")
    
    # Test 6: GET /api/accounting/overview
    print("\n[7] Testing GET /api/accounting/overview...")
    try:
        response = admin_session.get(f"{BASE_URL}/accounting/overview")
        if response.status_code == 200:
            log_test("GET /api/accounting/overview", True, f"Status: {response.status_code}")
        else:
            log_test("GET /api/accounting/overview", False, 
                    f"Expected 200, got {response.status_code}: {response.text[:200]}")
    except Exception as e:
        log_test("GET /api/accounting/overview", False, f"Exception: {str(e)}")
    
    # Test 7: REGRESSION - GET /api/accounting/accounts (COA list)
    print("\n[8] Testing GET /api/accounting/accounts (REGRESSION)...")
    try:
        response = admin_session.get(f"{BASE_URL}/accounting/accounts")
        if response.status_code == 200:
            data = response.json()
            if 'data' in data:
                account_count = len(data['data'])
                log_test("GET /api/accounting/accounts", True, 
                        f"Status: {response.status_code}, Account count: {account_count} (expected ~52)")
            else:
                log_test("GET /api/accounting/accounts", True, 
                        f"Status: {response.status_code}")
        else:
            log_test("GET /api/accounting/accounts", False, 
                    f"Expected 200, got {response.status_code}: {response.text[:200]}")
    except Exception as e:
        log_test("GET /api/accounting/accounts", False, f"Exception: {str(e)}")
    
    # Test 8: REGRESSION - GET /api/accounting/journals
    print("\n[9] Testing GET /api/accounting/journals (REGRESSION)...")
    try:
        response = admin_session.get(f"{BASE_URL}/accounting/journals")
        if response.status_code == 200:
            log_test("GET /api/accounting/journals", True, f"Status: {response.status_code}")
        else:
            log_test("GET /api/accounting/journals", False, 
                    f"Expected 200, got {response.status_code}: {response.text[:200]}")
    except Exception as e:
        log_test("GET /api/accounting/journals", False, f"Exception: {str(e)}")
    
    # Test 9: Unauthenticated request should return 401
    print("\n[10] Testing unauthenticated request to /api/accounting/balance-sheet...")
    try:
        unauth_session = requests.Session()
        response = unauth_session.get(f"{BASE_URL}/accounting/balance-sheet")
        if response.status_code == 401:
            log_test("Unauthenticated request returns 401", True, 
                    f"Status: {response.status_code} (correctly rejected)")
        else:
            log_test("Unauthenticated request returns 401", False, 
                    f"Expected 401, got {response.status_code}")
    except Exception as e:
        log_test("Unauthenticated request returns 401", False, f"Exception: {str(e)}")
    
    # Test 10: Check verification log in server logs
    print("\n[11] Checking verification log in /var/log/supervisor/nextjs.out.log...")
    try:
        import subprocess
        # Read last 200 lines of the log file
        result = subprocess.run(
            ['tail', '-n', '200', '/var/log/supervisor/nextjs.out.log'],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        log_content = result.stdout
        
        # Look for [DATA-SOURCE=MongoDB] messages
        verification_logs = []
        for line in log_content.split('\n'):
            if '[DATA-SOURCE=MongoDB]' in line and 'accounting' in line:
                verification_logs.append(line)
        
        if verification_logs:
            log_test("Verification log [DATA-SOURCE=MongoDB]", True, 
                    f"Found {len(verification_logs)} verification log entries")
            print("\n  Sample verification logs:")
            for log_line in verification_logs[:3]:  # Show first 3
                print(f"    {log_line[:150]}...")
        else:
            log_test("Verification log [DATA-SOURCE=MongoDB]", False, 
                    "No [DATA-SOURCE=MongoDB] log entries found for accounting routes")
    except Exception as e:
        log_test("Verification log [DATA-SOURCE=MongoDB]", False, f"Exception: {str(e)}")
    
    # Print summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    passed = sum(1 for t in test_results if t['passed'])
    total = len(test_results)
    print(f"\nTotal: {passed}/{total} tests passed ({100*passed//total}%)")
    
    print("\nDetailed Results:")
    for i, result in enumerate(test_results, 1):
        status = "✅" if result['passed'] else "❌"
        print(f"{i}. {status} {result['name']}")
        if result['details']:
            print(f"   {result['details']}")
    
    return passed == total

if __name__ == "__main__":
    try:
        success = test_accounting_reports()
        exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        exit(1)
