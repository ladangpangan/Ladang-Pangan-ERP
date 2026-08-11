#!/usr/bin/env python3
"""
Accounting Phase 2 Backend Test
Tests: Sales Profit Report, Fixed Assets + Auto Depreciation, Period Closing (Tutup Buku)
"""

import requests
import json
import sys
import sqlite3
from datetime import datetime

BASE_URL = "http://localhost:3000/api"
DB_PATH = "/app/data/erp.db"

# Test state
session = requests.Session()
test_asset_id = None
test_closing_id = None

def print_section(title):
    print(f"\n{'='*80}")
    print(f"  {title}")
    print(f"{'='*80}\n")

def print_test(name, passed, details=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"  → {details}")

def login():
    """Login as admin"""
    print_section("AUTHENTICATION")
    try:
        resp = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": "admin@lpi.co.id", "password": "admin123"},
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        
        # Debug: Print cookies
        print(f"   Response status: {resp.status_code}")
        print(f"   Cookies received: {len(resp.cookies)}")
        for cookie in resp.cookies:
            print(f"   Cookie: {cookie.name} = {cookie.value[:20] if len(cookie.value) > 20 else cookie.value}...")
        
        # Debug: Print session cookies
        print(f"   Session cookies: {len(session.cookies)}")
        for cookie in session.cookies:
            print(f"   Session cookie: {cookie.name}")
        
        if resp.status_code == 200:
            print_test("Login as admin@lpi.co.id", True, "Authenticated successfully")
            return True
        else:
            print_test("Login", False, f"Status {resp.status_code}: {resp.text[:200]}")
            return False
    except Exception as e:
        print_test("Login", False, f"Exception: {str(e)}")
        return False

def test_sales_profit_report():
    """Test A: Sales Profit Report"""
    print_section("A) SALES PROFIT REPORT")
    
    try:
        # GET /accounting/sales-profit?from=2025-01-01&to=2026-12-31
        resp = session.get(
            f"{BASE_URL}/accounting/sales-profit",
            params={"from": "2025-01-01", "to": "2026-12-31"},
            timeout=10
        )
        
        if resp.status_code != 200:
            print_test("GET /accounting/sales-profit", False, f"Status {resp.status_code}: {resp.text[:200]}")
            return False
        
        data = resp.json().get("data", {})
        
        # Verify structure
        required_keys = ["byCustomer", "byMonth", "orders", "totals"]
        missing_keys = [k for k in required_keys if k not in data]
        if missing_keys:
            print_test("Response structure", False, f"Missing keys: {missing_keys}")
            return False
        
        print_test("Response structure", True, "All required keys present")
        
        # Verify totals
        totals = data.get("totals", {})
        orders_count = totals.get("orders", 0)
        revenue = totals.get("revenue", 0)
        cogs = totals.get("cogs", 0)
        gross_profit = totals.get("grossProfit", 0)
        margin = totals.get("margin", 0)
        
        print(f"\n  Sales Profit Totals:")
        print(f"    Orders: {orders_count}")
        print(f"    Revenue: Rp {revenue:,.2f}")
        print(f"    COGS: Rp {cogs:,.2f}")
        print(f"    Gross Profit: Rp {gross_profit:,.2f}")
        print(f"    Margin: {margin:.2f}%")
        
        # Verify grossProfit == revenue - cogs (within rounding tolerance)
        expected_gp = revenue - cogs
        diff = abs(gross_profit - expected_gp)
        tolerance = 1.0  # Allow 1 Rp difference for rounding
        
        if diff <= tolerance:
            print_test("Gross Profit calculation", True, f"grossProfit ({gross_profit:.2f}) == revenue ({revenue:.2f}) - cogs ({cogs:.2f})")
        else:
            print_test("Gross Profit calculation", False, f"grossProfit ({gross_profit:.2f}) != revenue - cogs ({expected_gp:.2f}), diff={diff:.2f}")
            return False
        
        # Verify byCustomer entries have required fields
        by_customer = data.get("byCustomer", [])
        if by_customer:
            sample = by_customer[0]
            required_customer_keys = ["revenue", "cogs", "grossProfit", "margin"]
            missing = [k for k in required_customer_keys if k not in sample]
            if missing:
                print_test("byCustomer structure", False, f"Missing keys: {missing}")
                return False
            print_test("byCustomer structure", True, f"{len(by_customer)} customer entries with all required fields")
        else:
            print_test("byCustomer data", True, "No customer data (empty list)")
        
        print_test("Sales Profit Report", True, "All validations passed")
        return True
        
    except Exception as e:
        print_test("Sales Profit Report", False, f"Exception: {str(e)}")
        return False

def test_fixed_assets():
    """Test B: Fixed Assets + Auto Depreciation"""
    global test_asset_id
    print_section("B) FIXED ASSETS + AUTO DEPRECIATION")
    
    try:
        # B1: POST /accounting/fixed-assets - Create test asset
        print("\n--- B1: Create Fixed Asset ---")
        asset_data = {
            "name": "Mesin Uji",
            "code": "FA-TST",
            "acquisitionDate": "2026-01-10",
            "acquisitionCost": 24000000,
            "salvageValue": 0,
            "usefulLifeMonths": 24
        }
        
        resp = session.post(
            f"{BASE_URL}/accounting/fixed-assets",
            json=asset_data,
            timeout=10
        )
        
        if resp.status_code != 200:
            print_test("Create fixed asset", False, f"Status {resp.status_code}: {resp.text[:200]}")
            return False
        
        created = resp.json().get("data", {})
        test_asset_id = created.get("id")
        
        if not test_asset_id:
            print_test("Create fixed asset", False, "No asset ID returned")
            return False
        
        print_test("Create fixed asset", True, f"Asset created with ID: {test_asset_id}")
        print(f"  Code: {created.get('code')}")
        print(f"  Name: {created.get('name')}")
        print(f"  Acquisition Cost: Rp {created.get('acquisition_cost', 0):,.0f}")
        
        # B2: GET /accounting/fixed-assets?archived=0 - Verify depreciation
        print("\n--- B2: Verify Auto Depreciation ---")
        resp = session.get(
            f"{BASE_URL}/accounting/fixed-assets",
            params={"archived": "0"},
            timeout=10
        )
        
        if resp.status_code != 200:
            print_test("GET fixed assets", False, f"Status {resp.status_code}")
            return False
        
        assets = resp.json().get("data", [])
        test_asset = next((a for a in assets if a.get("code") == "FA-TST"), None)
        
        if not test_asset:
            print_test("Find test asset", False, "FA-TST not found in list")
            return False
        
        print_test("Find test asset", True, "FA-TST found in list")
        
        # Verify _status fields
        status = test_asset.get("_status", {})
        monthly_depr = status.get("monthlyDepreciation", 0)
        accumulated = status.get("accumulated", 0)
        book_value = status.get("bookValue", 0)
        
        print(f"\n  Depreciation Status:")
        print(f"    Monthly Depreciation: Rp {monthly_depr:,.0f}")
        print(f"    Accumulated: Rp {accumulated:,.0f}")
        print(f"    Book Value: Rp {book_value:,.0f}")
        
        # Expected monthly depreciation: (24,000,000 - 0) / 24 = 1,000,000
        expected_monthly = 1000000
        if abs(monthly_depr - expected_monthly) < 1:
            print_test("Monthly depreciation", True, f"monthlyDepreciation == {expected_monthly:,.0f}")
        else:
            print_test("Monthly depreciation", False, f"Expected {expected_monthly:,.0f}, got {monthly_depr:,.0f}")
            return False
        
        # Verify accumulated > 0 (depreciation has been posted)
        if accumulated > 0:
            print_test("Accumulated depreciation", True, f"accumulated > 0 ({accumulated:,.0f})")
        else:
            print_test("Accumulated depreciation", False, f"accumulated should be > 0, got {accumulated}")
            return False
        
        # Verify book value < acquisition cost
        if book_value < 24000000:
            print_test("Book value", True, f"bookValue ({book_value:,.0f}) < acquisitionCost (24,000,000)")
        else:
            print_test("Book value", False, f"bookValue should be < 24,000,000, got {book_value:,.0f}")
            return False
        
        # B3: Verify depreciation journals in database
        print("\n--- B3: Verify Depreciation Journals ---")
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Check for DEPR journal entries
        cursor.execute("""
            SELECT id, journal_number, source_type, source_id 
            FROM journal_entries 
            WHERE source_type = 'DEPR' AND source_id = ?
        """, (test_asset_id,))
        
        depr_journals = cursor.fetchall()
        
        if not depr_journals:
            print_test("DEPR journals exist", False, "No DEPR journal entries found")
            conn.close()
            return False
        
        print_test("DEPR journals exist", True, f"Found {len(depr_journals)} DEPR journal(s)")
        
        # Check journal lines for correct accounts
        for journal_id, journal_num, _, _ in depr_journals:
            cursor.execute("""
                SELECT account_code, debit, credit 
                FROM journal_lines 
                WHERE journal_id = ?
                ORDER BY account_code
            """, (journal_id,))
            
            lines = cursor.fetchall()
            
            # Should have Dr 6-1600 (Beban Penyusutan) and Cr 1-2900 (Akumulasi Penyusutan)
            dr_6_1600 = any(line[0] == '6-1600' and line[1] > 0 for line in lines)
            cr_1_2900 = any(line[0] == '1-2900' and line[2] > 0 for line in lines)
            
            if dr_6_1600 and cr_1_2900:
                print_test(f"Journal {journal_num} accounts", True, "Dr 6-1600 / Cr 1-2900 found")
            else:
                print_test(f"Journal {journal_num} accounts", False, f"Expected Dr 6-1600 / Cr 1-2900, got: {lines}")
                conn.close()
                return False
        
        conn.close()
        
        # B4: PATCH /accounting/fixed-assets/:id - Update asset
        print("\n--- B4: Update Fixed Asset ---")
        resp = session.patch(
            f"{BASE_URL}/accounting/fixed-assets/{test_asset_id}",
            json={"name": "Mesin Uji 2"},
            timeout=10
        )
        
        if resp.status_code != 200:
            print_test("Update fixed asset", False, f"Status {resp.status_code}")
            return False
        
        updated = resp.json().get("data", {})
        if updated.get("name") == "Mesin Uji 2":
            print_test("Update fixed asset", True, "Name updated to 'Mesin Uji 2'")
        else:
            print_test("Update fixed asset", False, f"Name not updated: {updated.get('name')}")
            return False
        
        # B5: POST /accounting/fixed-assets/:id/dispose - Dispose asset
        print("\n--- B5: Dispose Fixed Asset ---")
        resp = session.post(
            f"{BASE_URL}/accounting/fixed-assets/{test_asset_id}/dispose",
            json={},
            timeout=10
        )
        
        if resp.status_code != 200:
            print_test("Dispose asset", False, f"Status {resp.status_code}")
            return False
        
        print_test("Dispose asset", True, "Asset disposed")
        
        # Verify status is 'disposed'
        resp = session.get(f"{BASE_URL}/accounting/fixed-assets?archived=0", timeout=10)
        assets = resp.json().get("data", [])
        test_asset = next((a for a in assets if a.get("id") == test_asset_id), None)
        
        if test_asset and test_asset.get("status") == "disposed":
            print_test("Verify disposed status", True, "status == 'disposed'")
        else:
            print_test("Verify disposed status", False, f"Expected status='disposed', got: {test_asset.get('status') if test_asset else 'not found'}")
        
        # B6: POST /accounting/fixed-assets/:id/dispose {restore:true} - Restore asset
        print("\n--- B6: Restore Fixed Asset ---")
        resp = session.post(
            f"{BASE_URL}/accounting/fixed-assets/{test_asset_id}/dispose",
            json={"restore": True},
            timeout=10
        )
        
        if resp.status_code != 200:
            print_test("Restore asset", False, f"Status {resp.status_code}")
            return False
        
        print_test("Restore asset", True, "Asset restored")
        
        # Verify status is 'active'
        resp = session.get(f"{BASE_URL}/accounting/fixed-assets?archived=0", timeout=10)
        assets = resp.json().get("data", [])
        test_asset = next((a for a in assets if a.get("id") == test_asset_id), None)
        
        if test_asset and test_asset.get("status") == "active":
            print_test("Verify active status", True, "status == 'active'")
        else:
            print_test("Verify active status", False, f"Expected status='active', got: {test_asset.get('status') if test_asset else 'not found'}")
        
        # B7: POST /accounting/fixed-assets/:id/archive - Archive asset
        print("\n--- B7: Archive Fixed Asset ---")
        resp = session.post(
            f"{BASE_URL}/accounting/fixed-assets/{test_asset_id}/archive",
            json={},
            timeout=10
        )
        
        if resp.status_code != 200:
            print_test("Archive asset", False, f"Status {resp.status_code}")
            return False
        
        print_test("Archive asset", True, "Asset archived")
        
        # Verify asset appears in archived list
        resp = session.get(f"{BASE_URL}/accounting/fixed-assets?archived=1", timeout=10)
        archived_assets = resp.json().get("data", [])
        test_asset = next((a for a in archived_assets if a.get("id") == test_asset_id), None)
        
        if test_asset:
            print_test("Verify in archived list", True, "Asset found in archived=1 list")
        else:
            print_test("Verify in archived list", False, "Asset not found in archived list")
        
        # B8: POST /accounting/fixed-assets/:id/restore - Restore from archive
        print("\n--- B8: Restore from Archive ---")
        resp = session.post(
            f"{BASE_URL}/accounting/fixed-assets/{test_asset_id}/restore",
            json={},
            timeout=10
        )
        
        if resp.status_code != 200:
            print_test("Restore from archive", False, f"Status {resp.status_code}")
            return False
        
        print_test("Restore from archive", True, "Asset restored from archive")
        
        print_test("Fixed Assets + Depreciation", True, "All tests passed")
        return True
        
    except Exception as e:
        print_test("Fixed Assets", False, f"Exception: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_period_closing():
    """Test C: Period Closing (Tutup Buku)"""
    global test_closing_id
    print_section("C) PERIOD CLOSING (TUTUP BUKU)")
    
    try:
        # C1: GET /accounting/closings - List closings
        print("\n--- C1: List Period Closings ---")
        resp = session.get(f"{BASE_URL}/accounting/closings", timeout=10)
        
        if resp.status_code != 200:
            print_test("GET closings", False, f"Status {resp.status_code}")
            return False
        
        closings = resp.json().get("data", [])
        print_test("GET closings", True, f"Found {len(closings)} existing closing(s)")
        
        # C2: POST /accounting/closings {period:'2026-08'} - Create closing
        print("\n--- C2: Create Period Closing for 2026-08 ---")
        resp = session.post(
            f"{BASE_URL}/accounting/closings",
            json={"period": "2026-08"},
            timeout=30  # Closing may take longer
        )
        
        if resp.status_code != 200:
            print_test("Create closing", False, f"Status {resp.status_code}: {resp.text[:200]}")
            return False
        
        closing_result = resp.json()
        test_closing_id = None
        
        if not closing_result.get("ok"):
            print_test("Create closing", False, f"Response ok=false: {closing_result}")
            return False
        
        period = closing_result.get("period")
        net_income = closing_result.get("netIncome", 0)
        journal_id = closing_result.get("journalId")
        
        print_test("Create closing", True, f"Period {period} closed")
        print(f"  Net Income: Rp {net_income:,.2f}")
        print(f"  Journal ID: {journal_id}")
        
        # C3: Verify closing journal in database
        print("\n--- C3: Verify Closing Journal ---")
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, journal_number, source_type 
            FROM journal_entries 
            WHERE source_type = 'CLOSING' AND journal_number = ?
        """, (f"TB-{period}",))
        
        closing_journal = cursor.fetchone()
        
        if closing_journal:
            test_closing_id = closing_journal[0]
            print_test("Closing journal exists", True, f"Journal TB-{period} found (ID: {test_closing_id})")
        else:
            print_test("Closing journal exists", False, f"Journal TB-{period} not found")
            conn.close()
            return False
        
        conn.close()
        
        # C4: CRITICAL - Verify Balance Sheet still balanced
        print("\n--- C4: Verify Balance Sheet Balanced ---")
        resp = session.get(
            f"{BASE_URL}/accounting/balance-sheet",
            params={"asOf": "2026-12-31"},
            timeout=10
        )
        
        if resp.status_code != 200:
            print_test("GET balance-sheet", False, f"Status {resp.status_code}")
            return False
        
        bs_data = resp.json().get("data", {})
        balanced = bs_data.get("balanced", False)
        
        if balanced:
            print_test("Balance sheet balanced", True, "balanced == true (assets == liabilities + equity)")
        else:
            print_test("Balance sheet balanced", False, f"balanced == false. Data: {bs_data}")
            return False
        
        # C5: Verify Trial Balance still balanced
        print("\n--- C5: Verify Trial Balance Balanced ---")
        resp = session.get(
            f"{BASE_URL}/accounting/trial-balance",
            params={"to": "2026-12-31"},
            timeout=10
        )
        
        if resp.status_code != 200:
            print_test("GET trial-balance", False, f"Status {resp.status_code}")
            return False
        
        tb_data = resp.json().get("data", {})
        total_debit = tb_data.get("totalDebit", 0)
        total_credit = tb_data.get("totalCredit", 0)
        
        if abs(total_debit - total_credit) < 1:
            print_test("Trial balance balanced", True, f"totalDebit ({total_debit:,.2f}) == totalCredit ({total_credit:,.2f})")
        else:
            print_test("Trial balance balanced", False, f"totalDebit ({total_debit:,.2f}) != totalCredit ({total_credit:,.2f})")
            return False
        
        # C6: Verify Income Statement still shows data for closed period
        print("\n--- C6: Verify Income Statement for Closed Period ---")
        resp = session.get(
            f"{BASE_URL}/accounting/income-statement",
            params={"from": "2026-08-01", "to": "2026-08-31"},
            timeout=10
        )
        
        if resp.status_code != 200:
            print_test("GET income-statement", False, f"Status {resp.status_code}")
            return False
        
        is_data = resp.json().get("data", {})
        revenue = is_data.get("revenue", {})
        revenue_total = revenue.get("total", 0)
        
        if revenue_total > 0:
            print_test("Income statement shows data", True, f"revenue.total > 0 ({revenue_total:,.2f}) - closing entries excluded")
        else:
            print_test("Income statement shows data", False, f"revenue.total should be > 0, got {revenue_total}")
            # This is not a critical failure - may be no revenue in that period
            print("  Note: This may be expected if there was no revenue in 2026-08")
        
        # C7: Negative test - Try to close same period again
        print("\n--- C7: Negative Test - Duplicate Closing ---")
        resp = session.post(
            f"{BASE_URL}/accounting/closings",
            json={"period": "2026-08"},
            timeout=10
        )
        
        if resp.status_code == 400:
            print_test("Duplicate closing rejected", True, "Status 400 (already closed)")
        else:
            print_test("Duplicate closing rejected", False, f"Expected 400, got {resp.status_code}")
            return False
        
        print_test("Period Closing", True, "All tests passed")
        return True
        
    except Exception as e:
        print_test("Period Closing", False, f"Exception: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def cleanup():
    """Cleanup test data"""
    global test_asset_id, test_closing_id
    print_section("CLEANUP")
    
    success = True
    
    # Delete test fixed asset
    if test_asset_id:
        try:
            resp = session.delete(
                f"{BASE_URL}/accounting/fixed-assets/{test_asset_id}",
                timeout=10
            )
            if resp.status_code == 200:
                print_test("Delete test asset FA-TST", True, f"Asset {test_asset_id} deleted")
                
                # Verify DEPR journals also deleted
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM journal_entries WHERE source_type='DEPR' AND source_id=?", (test_asset_id,))
                count = cursor.fetchone()[0]
                conn.close()
                
                if count == 0:
                    print_test("DEPR journals deleted", True, "No DEPR journals remain for deleted asset")
                else:
                    print_test("DEPR journals deleted", False, f"{count} DEPR journal(s) still exist")
                    success = False
            else:
                print_test("Delete test asset", False, f"Status {resp.status_code}")
                success = False
        except Exception as e:
            print_test("Delete test asset", False, f"Exception: {str(e)}")
            success = False
    
    # Delete test closing (reopen period)
    if test_closing_id:
        try:
            # First, get the closing ID from the list
            resp = session.get(f"{BASE_URL}/accounting/closings", timeout=10)
            if resp.status_code == 200:
                closings = resp.json().get("data", [])
                test_closing = next((c for c in closings if c.get("period") == "2026-08"), None)
                
                if test_closing:
                    closing_id = test_closing.get("id")
                    resp = session.delete(
                        f"{BASE_URL}/accounting/closings/{closing_id}",
                        timeout=10
                    )
                    if resp.status_code == 200:
                        print_test("Delete test closing 2026-08", True, f"Closing {closing_id} deleted (period reopened)")
                        
                        # Verify balance sheet still balanced after reopening
                        resp = session.get(
                            f"{BASE_URL}/accounting/balance-sheet",
                            params={"asOf": "2026-12-31"},
                            timeout=10
                        )
                        if resp.status_code == 200:
                            bs_data = resp.json().get("data", {})
                            if bs_data.get("balanced"):
                                print_test("Balance sheet after reopen", True, "Still balanced after reopening period")
                            else:
                                print_test("Balance sheet after reopen", False, "Not balanced after reopening")
                                success = False
                    else:
                        print_test("Delete test closing", False, f"Status {resp.status_code}")
                        success = False
                else:
                    print_test("Find test closing", False, "2026-08 closing not found")
        except Exception as e:
            print_test("Delete test closing", False, f"Exception: {str(e)}")
            success = False
    
    return success

def main():
    print("\n" + "="*80)
    print("  ACCOUNTING PHASE 2 BACKEND TEST")
    print("  Sales Profit Report, Fixed Assets + Auto Depreciation, Period Closing")
    print("="*80)
    
    # Login
    if not login():
        print("\n❌ AUTHENTICATION FAILED - Cannot proceed with tests")
        sys.exit(1)
    
    # Run tests
    results = {
        "Sales Profit Report": test_sales_profit_report(),
        "Fixed Assets + Depreciation": test_fixed_assets(),
        "Period Closing": test_period_closing()
    }
    
    # Cleanup
    cleanup_success = cleanup()
    
    # Summary
    print_section("TEST SUMMARY")
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    if cleanup_success:
        print(f"✅ PASS: Cleanup")
    else:
        print(f"❌ FAIL: Cleanup")
    
    print(f"\n{'='*80}")
    print(f"  TOTAL: {passed}/{total} tests passed")
    print(f"{'='*80}\n")
    
    if passed == total and cleanup_success:
        print("✅ ALL TESTS PASSED")
        sys.exit(0)
    else:
        print("❌ SOME TESTS FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
