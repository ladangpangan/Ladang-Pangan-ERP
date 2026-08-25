#!/usr/bin/env python3
"""
Backend test for Odoo August 2026 Integration Pilot
Tests the auto-generated journals and accounting reports through the running Next.js app API.
"""

import requests
import json
from datetime import datetime

# Configuration
BASE_URL = "http://localhost:3000/api"
AUTH_EMAIL = "admin@lpi.co.id"
AUTH_PASSWORD = "admin123"

# Color codes for output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

def print_test(name, passed, details=""):
    """Print test result with color"""
    status = f"{GREEN}✓ PASSED{RESET}" if passed else f"{RED}✗ FAILED{RESET}"
    print(f"\n{status} - {name}")
    if details:
        print(f"  {details}")

def print_section(title):
    """Print section header"""
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}{title}{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")

# Create session
session = requests.Session()

def login():
    """Login and get session cookie"""
    print_section("AUTHENTICATION")
    try:
        response = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": AUTH_EMAIL, "password": AUTH_PASSWORD}
        )
        if response.status_code == 200:
            print_test("Login", True, f"Authenticated as {AUTH_EMAIL}")
            return True
        else:
            print_test("Login", False, f"Status: {response.status_code}, Response: {response.text[:200]}")
            return False
    except Exception as e:
        print_test("Login", False, f"Exception: {str(e)}")
        return False

def test_me_endpoint():
    """Test GET /api/me"""
    try:
        response = session.get(f"{BASE_URL}/me")
        if response.status_code == 200:
            data = response.json()
            user = data.get('user', {})
            print_test("GET /api/me", True, f"User: {user.get('email')}, Role: {user.get('role')}")
            return True
        else:
            print_test("GET /api/me", False, f"Status: {response.status_code}")
            return False
    except Exception as e:
        print_test("GET /api/me", False, f"Exception: {str(e)}")
        return False

def test_journals():
    """Test 1: GET /api/accounting/journals - expect 29 journals"""
    print_section("TEST 1: JOURNALS LIST")
    try:
        response = session.get(f"{BASE_URL}/accounting/journals")
        if response.status_code != 200:
            print_test("GET /api/accounting/journals", False, f"Status: {response.status_code}")
            return False
        
        data = response.json()
        journals = data.get('data', [])
        total_count = len(journals)
        
        # Count by source_type
        source_counts = {}
        opening_journal = None
        for j in journals:
            st = j.get('source_type', 'UNKNOWN')
            source_counts[st] = source_counts.get(st, 0) + 1
            if st == 'OPENING':
                opening_journal = j
        
        # Expected counts
        expected_total = 29
        expected_counts = {'OPENING': 1, 'PO_INV': 4, 'SO_INV': 19, 'SPAY': 5}
        
        # Check total count
        total_match = total_count == expected_total
        print_test(
            f"Total journals count",
            total_match,
            f"Expected: {expected_total}, Actual: {total_count}"
        )
        
        # Check source_type breakdown
        breakdown_match = True
        for st, expected in expected_counts.items():
            actual = source_counts.get(st, 0)
            match = actual == expected
            breakdown_match = breakdown_match and match
            print_test(
                f"  {st} count",
                match,
                f"Expected: {expected}, Actual: {actual}"
            )
        
        # Check OPENING journal is unchanged
        if opening_journal:
            # Convert Unix timestamp to date string
            from datetime import datetime
            entry_date_ts = opening_journal.get('entry_date', 0)
            entry_date_str = datetime.fromtimestamp(entry_date_ts).strftime('%Y-%m-%d') if entry_date_ts else ''
            
            opening_checks = {
                'journal_number': ('OPENING', opening_journal.get('journal_number')),
                'entry_date': ('2026-07-31', entry_date_str),
                'total_debit': (384244000, opening_journal.get('total_debit'))
            }
            
            opening_match = True
            for field, (expected, actual) in opening_checks.items():
                match = expected == actual
                opening_match = opening_match and match
                print_test(
                    f"  OPENING journal {field}",
                    match,
                    f"Expected: {expected}, Actual: {actual}"
                )
        else:
            print_test("OPENING journal exists", False, "OPENING journal not found")
            opening_match = False
        
        return total_match and breakdown_match and opening_match
        
    except Exception as e:
        print_test("GET /api/accounting/journals", False, f"Exception: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_trial_balance():
    """Test 2: GET /api/accounting/trial-balance?to=2026-08-31"""
    print_section("TEST 2: TRIAL BALANCE")
    try:
        response = session.get(f"{BASE_URL}/accounting/trial-balance?to=2026-08-31")
        if response.status_code != 200:
            print_test("GET /api/accounting/trial-balance", False, f"Status: {response.status_code}")
            return False
        
        data = response.json().get('data', {})
        total_debit = data.get('totalDebit', 0)
        total_credit = data.get('totalCredit', 0)
        
        expected = 471880350
        balanced = total_debit == total_credit
        amount_match = total_debit == expected
        
        print_test(
            "Trial Balance BALANCED",
            balanced,
            f"Total Debit: {total_debit:,}, Total Credit: {total_credit:,}"
        )
        
        print_test(
            "Trial Balance amount",
            amount_match,
            f"Expected: {expected:,}, Actual: {total_debit:,}"
        )
        
        return balanced and amount_match
        
    except Exception as e:
        print_test("GET /api/accounting/trial-balance", False, f"Exception: {str(e)}")
        return False

def test_income_statement():
    """Test 3: GET /api/accounting/income-statement?from=2026-08-01&to=2026-08-31"""
    print_section("TEST 3: INCOME STATEMENT")
    try:
        response = session.get(f"{BASE_URL}/accounting/income-statement?from=2026-08-01&to=2026-08-31")
        if response.status_code != 200:
            print_test("GET /api/accounting/income-statement", False, f"Status: {response.status_code}")
            return False
        
        data = response.json().get('data', {})
        revenue = data.get('revenue', {})
        cogs = data.get('cogs', {})
        gross_profit = data.get('grossProfit', 0)
        
        revenue_total = revenue.get('total', 0)
        cogs_total = cogs.get('total', 0)
        
        expected_revenue = 54623100
        expected_cogs = 46884842
        expected_gross_profit = 7738258
        
        # Allow for small rounding differences (within 1 unit)
        revenue_match = abs(revenue_total - expected_revenue) < 1
        cogs_match = abs(cogs_total - expected_cogs) < 1
        gross_profit_match = abs(gross_profit - expected_gross_profit) < 1
        
        print_test(
            "Revenue total",
            revenue_match,
            f"Expected: {expected_revenue:,}, Actual: {revenue_total:,.2f}"
        )
        
        print_test(
            "COGS total",
            cogs_match,
            f"Expected: {expected_cogs:,}, Actual: {cogs_total:,.2f}"
        )
        
        print_test(
            "Gross Profit",
            gross_profit_match,
            f"Expected: {expected_gross_profit:,}, Actual: {gross_profit:,.2f}"
        )
        
        return revenue_match and cogs_match and gross_profit_match
        
    except Exception as e:
        print_test("GET /api/accounting/income-statement", False, f"Exception: {str(e)}")
        return False

def test_balance_sheet():
    """Test 4: GET /api/accounting/balance-sheet?asOf=2026-08-31"""
    print_section("TEST 4: BALANCE SHEET")
    try:
        response = session.get(f"{BASE_URL}/accounting/balance-sheet?asOf=2026-08-31")
        if response.status_code != 200:
            print_test("GET /api/accounting/balance-sheet", False, f"Status: {response.status_code}")
            return False
        
        data = response.json().get('data', {})
        balanced = data.get('balanced', False)
        
        # Extract accounts from nested structure
        account_values = {}
        assets = data.get('assets', {}).get('groups', [])
        for group in assets:
            for item in group.get('items', []):
                code = item.get('code', '')
                amount = item.get('amount', 0)
                account_values[code] = amount
        
        liabilities = data.get('liabilities', {}).get('groups', [])
        for group in liabilities:
            for item in group.get('items', []):
                code = item.get('code', '')
                amount = item.get('amount', 0)
                account_values[code] = amount
        
        expected_accounts = {
            '1-1120': 119199595,  # Bank
            '1-1200': 61312930,   # Piutang Usaha
            '1-1300': 94384995,   # Persediaan
            '2-1100': 33013250    # Utang Usaha
        }
        
        print_test(
            "Balance Sheet BALANCED",
            balanced,
            f"Balanced: {balanced}"
        )
        
        all_match = True
        for code, expected in expected_accounts.items():
            actual = account_values.get(code, 0)
            # Allow for small rounding differences (within 1 unit)
            match = abs(actual - expected) < 1
            all_match = all_match and match
            
            # Get account name from the data
            acc_name = code
            for group in assets + liabilities:
                for item in group.get('items', []):
                    if item.get('code') == code:
                        acc_name = item.get('name', code)
                        break
            
            print_test(
                f"  {acc_name} ({code})",
                match,
                f"Expected: {expected:,}, Actual: {actual:,.2f}"
            )
        
        return balanced and all_match
        
    except Exception as e:
        print_test("GET /api/accounting/balance-sheet", False, f"Exception: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_sales_orders():
    """Test 5: GET /api/sales-orders?year=2026&month=8"""
    print_section("TEST 5: SALES ORDERS (AUGUST 2026)")
    try:
        # Get all sales orders and filter by August 2026
        response = session.get(f"{BASE_URL}/sales-orders")
        if response.status_code != 200:
            print_test("GET /api/sales-orders", False, f"Status: {response.status_code}")
            return False
        
        data = response.json()
        all_orders = data.get('data', [])
        
        # Filter for August 2026 orders
        august_orders = []
        for o in all_orders:
            order_date = o.get('orderDate', '')
            if order_date and order_date.startswith('2026-08'):
                august_orders.append(o)
        
        count = len(august_orders)
        expected_count = 19
        count_match = count == expected_count
        
        print_test(
            "Sales Orders count (August 2026)",
            count_match,
            f"Expected: {expected_count}, Actual: {count}"
        )
        
        # Check all have pipeline_status='Invoiced'
        invoiced_count = sum(1 for o in august_orders if o.get('pipelineStatus') == 'Invoiced')
        all_invoiced = invoiced_count == count
        
        print_test(
            "All August SOs have pipeline_status='Invoiced'",
            all_invoiced,
            f"Invoiced: {invoiced_count}/{count}"
        )
        
        return count_match and all_invoiced
        
    except Exception as e:
        print_test("GET /api/sales-orders", False, f"Exception: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_purchase_orders():
    """Test 6: GET /api/purchase-orders?year=2026&month=8"""
    print_section("TEST 6: PURCHASE ORDERS (AUGUST 2026)")
    try:
        # Get all purchase orders and filter by August 2026
        response = session.get(f"{BASE_URL}/purchase-orders")
        if response.status_code != 200:
            print_test("GET /api/purchase-orders", False, f"Status: {response.status_code}")
            return False
        
        data = response.json()
        all_orders = data.get('data', [])
        
        # Filter for August 2026 orders
        august_orders = []
        for o in all_orders:
            order_date = o.get('orderDate', '')
            if order_date and order_date.startswith('2026-08'):
                august_orders.append(o)
        
        count = len(august_orders)
        expected_count = 4
        count_match = count == expected_count
        
        print_test(
            "Purchase Orders count (August 2026)",
            count_match,
            f"Expected: {expected_count}, Actual: {count}"
        )
        
        # Check all have pipeline_status='Selesai'
        selesai_count = sum(1 for o in august_orders if o.get('pipelineStatus') == 'Selesai')
        all_selesai = selesai_count == count
        
        print_test(
            "All August POs have pipeline_status='Selesai'",
            all_selesai,
            f"Selesai: {selesai_count}/{count}"
        )
        
        return count_match and all_selesai
        
    except Exception as e:
        print_test("GET /api/purchase-orders", False, f"Exception: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_regression():
    """Test 7: Regression - no 5xx on core endpoints"""
    print_section("TEST 7: REGRESSION (NO 5xx ERRORS)")
    
    endpoints = [
        ("GET /api/me", f"{BASE_URL}/me"),
        ("GET /api/contacts", f"{BASE_URL}/contacts"),
        ("GET /api/products", f"{BASE_URL}/products"),
        ("GET /api/accounting/settings", f"{BASE_URL}/accounting/settings"),
        ("GET /api/accounting/cashbook", f"{BASE_URL}/accounting/cashbook")
    ]
    
    all_passed = True
    for name, url in endpoints:
        try:
            response = session.get(url)
            passed = response.status_code < 500
            all_passed = all_passed and passed
            
            if passed:
                data = response.json()
                count = len(data.get('data', [])) if isinstance(data.get('data'), list) else 'N/A'
                print_test(name, True, f"Status: {response.status_code}, Count: {count}")
            else:
                print_test(name, False, f"Status: {response.status_code}")
        except Exception as e:
            print_test(name, False, f"Exception: {str(e)}")
            all_passed = False
    
    return all_passed

def test_non_august_not_journalized():
    """Test 8: Verify non-August months did NOT get journalized"""
    print_section("TEST 8: NON-AUGUST MONTHS NOT JOURNALIZED")
    try:
        # Get all journals
        response = session.get(f"{BASE_URL}/accounting/journals")
        if response.status_code != 200:
            print_test("GET /api/accounting/journals", False, f"Status: {response.status_code}")
            return False
        
        data = response.json()
        journals = data.get('data', [])
        
        # Check that all SO_INV and PO_INV journals are from August 2026 or are OPENING
        from datetime import datetime
        non_august_journals = []
        for j in journals:
            st = j.get('source_type', '')
            if st in ['SO_INV', 'PO_INV', 'SPAY']:
                entry_date_ts = j.get('entry_date', 0)
                if entry_date_ts:
                    entry_date_str = datetime.fromtimestamp(entry_date_ts).strftime('%Y-%m')
                    # Check if date is NOT in August 2026
                    if entry_date_str != '2026-08':
                        non_august_journals.append({
                            'journal_number': j.get('journal_number'),
                            'source_type': st,
                            'entry_date': datetime.fromtimestamp(entry_date_ts).strftime('%Y-%m-%d')
                        })
        
        no_non_august = len(non_august_journals) == 0
        
        if no_non_august:
            print_test(
                "Only August 2026 journals (+ OPENING)",
                True,
                "All SO_INV/PO_INV/SPAY journals are from August 2026"
            )
        else:
            print_test(
                "Only August 2026 journals (+ OPENING)",
                False,
                f"Found {len(non_august_journals)} non-August journals: {non_august_journals[:5]}"
            )
        
        return no_non_august
        
    except Exception as e:
        print_test("Non-August check", False, f"Exception: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Run all tests"""
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}ODOO AUGUST 2026 INTEGRATION PILOT - BACKEND VERIFICATION{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")
    print(f"Base URL: {BASE_URL}")
    print(f"Auth: {AUTH_EMAIL}")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Login
    if not login():
        print(f"\n{RED}FAILED: Could not authenticate. Aborting tests.{RESET}")
        return
    
    # Verify authentication
    if not test_me_endpoint():
        print(f"\n{RED}FAILED: Could not verify authentication. Aborting tests.{RESET}")
        return
    
    # Run all tests
    results = {
        "Test 1: Journals List": test_journals(),
        "Test 2: Trial Balance": test_trial_balance(),
        "Test 3: Income Statement": test_income_statement(),
        "Test 4: Balance Sheet": test_balance_sheet(),
        "Test 5: Sales Orders": test_sales_orders(),
        "Test 6: Purchase Orders": test_purchase_orders(),
        "Test 7: Regression": test_regression(),
        "Test 8: Non-August Not Journalized": test_non_august_not_journalized()
    }
    
    # Summary
    print_section("SUMMARY")
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, result in results.items():
        status = f"{GREEN}✓{RESET}" if result else f"{RED}✗{RESET}"
        print(f"{status} {test_name}")
    
    print(f"\n{BLUE}{'='*80}{RESET}")
    if passed == total:
        print(f"{GREEN}ALL TESTS PASSED: {passed}/{total}{RESET}")
    else:
        print(f"{YELLOW}TESTS PASSED: {passed}/{total}{RESET}")
        print(f"{RED}TESTS FAILED: {total - passed}/{total}{RESET}")
    print(f"{BLUE}{'='*80}{RESET}\n")

if __name__ == "__main__":
    main()
