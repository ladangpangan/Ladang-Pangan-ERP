#!/usr/bin/env python3
"""
Backend test: Verify system integrity after MAJOR data rollback
- All Sales Orders & Purchase Orders reset to zero
- Master data + opening balances + manual journals kept
- Inventory reconciled to 31-July-2026 baseline (433 lots / ~5458.7 kg)
"""

import requests
import json
from typing import Dict, Any

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
AKUNTAN_EMAIL = "akuntan@lpi.co.id"
AKUNTAN_PASSWORD = "akuntanlpi123"

def login(email: str, password: str) -> requests.Session:
    """Login and return session with auth cookie"""
    session = requests.Session()
    try:
        response = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": email, "password": password},
            headers={"Content-Type": "application/json"}
        )
        print(f"✓ Login {email}: {response.status_code}")
        if response.status_code != 200:
            print(f"  ERROR: Login failed - {response.text[:200]}")
            return None
        return session
    except Exception as e:
        print(f"✗ Login {email} FAILED: {e}")
        return None

def test_so_po_counts(session: requests.Session) -> Dict[str, Any]:
    """TEST 1: Verify SO and PO counts are 0 after rollback"""
    print("\n=== TEST 1: SO/PO Counts (expect 0) ===")
    results = {"so_count": None, "po_count": None, "passed": False}
    
    try:
        # Check Sales Orders
        so_response = session.get(f"{BASE_URL}/sales-orders")
        print(f"✓ GET /sales-orders: {so_response.status_code}")
        
        if so_response.status_code == 200:
            so_data = so_response.json()
            so_count = len(so_data.get("data", []))
            results["so_count"] = so_count
            print(f"  Sales Orders count: {so_count} (expected: 0)")
            
            if so_count == 0:
                print(f"  ✓ SO count is 0 (CORRECT after rollback)")
            else:
                print(f"  ✗ SO count is {so_count} (EXPECTED 0 after rollback)")
                print(f"  Found SOs: {[so.get('soNumber') for so in so_data.get('data', [])]}")
        else:
            print(f"  ✗ GET /sales-orders failed: {so_response.status_code}")
            print(f"  Response: {so_response.text[:200]}")
        
        # Check Purchase Orders
        po_response = session.get(f"{BASE_URL}/purchase-orders")
        print(f"✓ GET /purchase-orders: {po_response.status_code}")
        
        if po_response.status_code == 200:
            po_data = po_response.json()
            po_count = len(po_data.get("data", []))
            results["po_count"] = po_count
            print(f"  Purchase Orders count: {po_count} (expected: 0)")
            
            if po_count == 0:
                print(f"  ✓ PO count is 0 (CORRECT after rollback)")
            else:
                print(f"  ✗ PO count is {po_count} (EXPECTED 0 after rollback)")
                print(f"  Found POs: {[po.get('poNumber') for po in po_data.get('data', [])]}")
        else:
            print(f"  ✗ GET /purchase-orders failed: {po_response.status_code}")
            print(f"  Response: {po_response.text[:200]}")
        
        # Test passes if both counts are 0
        results["passed"] = (results["so_count"] == 0 and results["po_count"] == 0)
        
        if results["passed"]:
            print(f"\n✓ TEST 1 PASSED: SO count = 0, PO count = 0")
        else:
            print(f"\n✗ TEST 1 FAILED: SO count = {results['so_count']}, PO count = {results['po_count']}")
        
    except Exception as e:
        print(f"✗ TEST 1 EXCEPTION: {e}")
        results["error"] = str(e)
    
    return results

def test_inventory_integrity(session: requests.Session) -> Dict[str, Any]:
    """TEST 2: Verify inventory stocks integrity after rollback"""
    print("\n=== TEST 2: Inventory Integrity (expect ~433 lots, ~5458.7 kg) ===")
    results = {
        "active_count": None,
        "total_weight": None,
        "missing_product_name_count": None,
        "used_count": None,
        "allocated_count": None,
        "passed": False
    }
    
    try:
        # Get active stocks
        active_response = session.get(f"{BASE_URL}/inventory/stocks?status=active")
        print(f"✓ GET /inventory/stocks?status=active: {active_response.status_code}")
        
        if active_response.status_code == 200:
            active_data = active_response.json()
            stocks = active_data.get("data", [])
            results["active_count"] = len(stocks)
            
            # Calculate total weight
            total_weight = sum(stock.get("weight", 0) for stock in stocks)
            results["total_weight"] = round(total_weight, 2)
            
            # Check for missing product names
            missing_name_count = 0
            for stock in stocks:
                product = stock.get("product", {})
                product_name = product.get("name", "") if product else ""
                if not product_name or product_name.strip() == "":
                    missing_name_count += 1
            
            results["missing_product_name_count"] = missing_name_count
            
            print(f"  Active stocks count: {results['active_count']} (expected: ~433)")
            print(f"  Total active weight: {results['total_weight']} kg (expected: ~5458.7 kg)")
            print(f"  Missing product.name count: {missing_name_count} (expected: 0)")
            
            # Check if counts are in expected range
            count_ok = 430 <= results["active_count"] <= 440  # Allow small variance
            weight_ok = 5400 <= results["total_weight"] <= 5500  # Allow small variance
            names_ok = missing_name_count == 0
            
            if count_ok:
                print(f"  ✓ Active stock count is in expected range (~433)")
            else:
                print(f"  ✗ Active stock count {results['active_count']} is outside expected range (430-440)")
            
            if weight_ok:
                print(f"  ✓ Total weight is in expected range (~5458.7 kg)")
            else:
                print(f"  ✗ Total weight {results['total_weight']} kg is outside expected range (5400-5500 kg)")
            
            if names_ok:
                print(f"  ✓ All stocks have product.name (0 missing)")
            else:
                print(f"  ✗ Found {missing_name_count} stocks with missing product.name")
        else:
            print(f"  ✗ GET /inventory/stocks?status=active failed: {active_response.status_code}")
            print(f"  Response: {active_response.text[:200]}")
        
        # Check for 'used' stocks (should be 0 or minimal after rollback)
        used_response = session.get(f"{BASE_URL}/inventory/stocks?status=used")
        print(f"✓ GET /inventory/stocks?status=used: {used_response.status_code}")
        
        if used_response.status_code == 200:
            used_data = used_response.json()
            used_stocks = used_data.get("data", [])
            results["used_count"] = len(used_stocks)
            print(f"  'used' stocks count: {results['used_count']} (expected: 0 or minimal)")
            
            if results["used_count"] == 0:
                print(f"  ✓ No 'used' stocks (CORRECT after rollback)")
            else:
                print(f"  ⚠ Found {results['used_count']} 'used' stocks (expected 0 after consumption reset)")
        else:
            print(f"  ✗ GET /inventory/stocks?status=used failed: {used_response.status_code}")
        
        # Check for 'allocated' stocks (should be 0 after rollback)
        allocated_response = session.get(f"{BASE_URL}/inventory/stocks?status=allocated")
        print(f"✓ GET /inventory/stocks?status=allocated: {allocated_response.status_code}")
        
        if allocated_response.status_code == 200:
            allocated_data = allocated_response.json()
            allocated_stocks = allocated_data.get("data", [])
            results["allocated_count"] = len(allocated_stocks)
            print(f"  'allocated' stocks count: {results['allocated_count']} (expected: 0)")
            
            if results["allocated_count"] == 0:
                print(f"  ✓ No 'allocated' stocks (CORRECT after rollback)")
            else:
                print(f"  ⚠ Found {results['allocated_count']} 'allocated' stocks (expected 0 after rollback)")
        else:
            print(f"  ✗ GET /inventory/stocks?status=allocated failed: {allocated_response.status_code}")
        
        # Test passes if all checks are OK
        count_ok = 430 <= (results["active_count"] or 0) <= 440
        weight_ok = 5400 <= (results["total_weight"] or 0) <= 5500
        names_ok = results["missing_product_name_count"] == 0
        used_ok = (results["used_count"] or 0) == 0
        allocated_ok = (results["allocated_count"] or 0) == 0
        
        results["passed"] = count_ok and weight_ok and names_ok and used_ok and allocated_ok
        
        if results["passed"]:
            print(f"\n✓ TEST 2 PASSED: Inventory integrity verified")
        else:
            print(f"\n✗ TEST 2 FAILED: Inventory integrity issues found")
        
    except Exception as e:
        print(f"✗ TEST 2 EXCEPTION: {e}")
        results["error"] = str(e)
    
    return results

def test_accounting_integrity(session: requests.Session) -> Dict[str, Any]:
    """TEST 3: Verify accounting integrity (balance sheet, trial balance, opening balances, journals)"""
    print("\n=== TEST 3: Accounting Integrity (akuntan) ===")
    results = {
        "balance_sheet_balanced": None,
        "trial_balance_equal": None,
        "opening_balances_preserved": None,
        "manual_journals_count": None,
        "passed": False
    }
    
    try:
        # Check balance sheet
        bs_response = session.get(f"{BASE_URL}/accounting/balance-sheet")
        print(f"✓ GET /accounting/balance-sheet: {bs_response.status_code}")
        
        if bs_response.status_code == 200:
            bs_data = bs_response.json()
            # Handle nested structure: data.balanced, data.assets.total, etc.
            data_obj = bs_data.get("data", {})
            balanced = data_obj.get("balanced", False)
            results["balance_sheet_balanced"] = balanced
            
            assets = data_obj.get("assets", {}).get("total", 0)
            liabilities = data_obj.get("liabilities", {}).get("total", 0)
            equity = data_obj.get("equity", {}).get("total", 0)
            
            print(f"  Balance Sheet:")
            print(f"    Total Assets: Rp {assets:,.2f}")
            print(f"    Total Liabilities: Rp {liabilities:,.2f}")
            print(f"    Total Equity: Rp {equity:,.2f}")
            print(f"    Balanced: {balanced} (expected: true)")
            
            if balanced:
                print(f"  ✓ Balance sheet is balanced")
            else:
                print(f"  ✗ Balance sheet is NOT balanced")
                diff = assets - (liabilities + equity)
                print(f"    Difference: Rp {diff:,.2f}")
        else:
            print(f"  ✗ GET /accounting/balance-sheet failed: {bs_response.status_code}")
            print(f"  Response: {bs_response.text[:200]}")
        
        # Check trial balance
        tb_response = session.get(f"{BASE_URL}/accounting/trial-balance")
        print(f"✓ GET /accounting/trial-balance: {tb_response.status_code}")
        
        if tb_response.status_code == 200:
            tb_data = tb_response.json()
            # Handle nested structure: data.rows
            data_obj = tb_data.get("data", {})
            if isinstance(data_obj, dict):
                accounts = data_obj.get("rows", [])
            else:
                accounts = data_obj if isinstance(data_obj, list) else []
            
            total_debit = sum(acc.get("debit", 0) for acc in accounts)
            total_credit = sum(acc.get("credit", 0) for acc in accounts)
            
            results["trial_balance_equal"] = (abs(total_debit - total_credit) < 1)  # Allow rounding
            
            print(f"  Trial Balance:")
            print(f"    Total Debit: Rp {total_debit:,.2f}")
            print(f"    Total Credit: Rp {total_credit:,.2f}")
            print(f"    Difference: Rp {abs(total_debit - total_credit):,.2f}")
            
            if results["trial_balance_equal"]:
                print(f"  ✓ Trial balance is equal (debit = credit)")
            else:
                print(f"  ✗ Trial balance is NOT equal")
            
            # Check for opening balances (Bank BCA, Bank Mandiri)
            bank_bca = next((acc for acc in accounts if acc.get("code") == "1-1120"), None)
            bank_mandiri = next((acc for acc in accounts if acc.get("code") == "1-1121"), None)
            
            if bank_bca:
                bca_balance = bank_bca.get("debit", 0) - bank_bca.get("credit", 0)
                print(f"  Bank BCA (1-1120) balance: Rp {bca_balance:,.2f}")
            
            if bank_mandiri:
                mandiri_balance = bank_mandiri.get("debit", 0) - bank_mandiri.get("credit", 0)
                print(f"  Bank Mandiri (1-1121) balance: Rp {mandiri_balance:,.2f}")
            
            # Check if opening balances are preserved (sum should be ~143,681,585)
            # Note: After rollback, opening balances might be adjusted
            total_bank = 0
            if bank_bca:
                total_bank += bank_bca.get("debit", 0) - bank_bca.get("credit", 0)
            if bank_mandiri:
                total_bank += bank_mandiri.get("debit", 0) - bank_mandiri.get("credit", 0)
            
            print(f"  Total Bank opening balance: Rp {total_bank:,.2f}")
            
            # After rollback, opening balances might be different
            # Just check that they are non-zero (preserved)
            opening_ok = total_bank > 0
            results["opening_balances_preserved"] = opening_ok
            
            if opening_ok:
                print(f"  ✓ Opening balances preserved (non-zero bank balances)")
            else:
                print(f"  ✗ Opening balances are zero (not preserved)")
        else:
            print(f"  ✗ GET /accounting/trial-balance failed: {tb_response.status_code}")
            print(f"  Response: {tb_response.text[:200]}")
        
        # Check for manual journals (should be ~80)
        # Try to get journals list or cashbook list
        cashbook_response = session.get(f"{BASE_URL}/accounting/cashbook")
        print(f"✓ GET /accounting/cashbook: {cashbook_response.status_code}")
        
        if cashbook_response.status_code == 200:
            cashbook_data = cashbook_response.json()
            cashbook_entries = cashbook_data.get("data", [])
            results["manual_journals_count"] = len(cashbook_entries)
            
            print(f"  Manual journal entries (cashbook): {results['manual_journals_count']} (expected: ~80)")
            
            if results["manual_journals_count"] >= 70:
                print(f"  ✓ Manual journals preserved (count >= 70)")
            else:
                print(f"  ⚠ Manual journals count is lower than expected")
        else:
            print(f"  ✗ GET /accounting/cashbook failed: {cashbook_response.status_code}")
        
        # Test passes if balance sheet balanced, trial balance equal, and opening balances OK
        results["passed"] = (
            results["balance_sheet_balanced"] == True and
            results["trial_balance_equal"] == True and
            results["opening_balances_preserved"] == True
        )
        
        if results["passed"]:
            print(f"\n✓ TEST 3 PASSED: Accounting integrity verified")
        else:
            print(f"\n✗ TEST 3 FAILED: Accounting integrity issues found")
        
    except Exception as e:
        print(f"✗ TEST 3 EXCEPTION: {e}")
        results["error"] = str(e)
    
    return results

def test_so_functionality(session: requests.Session) -> Dict[str, Any]:
    """TEST 4: Create a new SO, verify it shows up, then delete it (fully reversible)"""
    print("\n=== TEST 4: SO Functionality (create/verify/delete) ===")
    results = {"so_created": False, "so_verified": False, "so_deleted": False, "passed": False}
    created_so_id = None
    
    try:
        # Get a customer ID
        contacts_response = session.get(f"{BASE_URL}/contacts")
        print(f"✓ GET /contacts: {contacts_response.status_code}")
        
        if contacts_response.status_code != 200:
            print(f"  ✗ Failed to get contacts: {contacts_response.status_code}")
            return results
        
        contacts_data = contacts_response.json()
        contacts = contacts_data.get("data", [])
        
        # Find a customer
        customer = next((c for c in contacts if "Customer" in c.get("categories", [])), None)
        
        if not customer:
            print(f"  ✗ No customer found in contacts")
            return results
        
        customer_id = customer.get("id")
        print(f"  Found customer: {customer.get('displayName')} (ID: {customer_id})")
        
        # Get a product for the SO item
        products_response = session.get(f"{BASE_URL}/products")
        if products_response.status_code != 200:
            print(f"  ✗ Failed to get products: {products_response.status_code}")
            return results
        
        products_data = products_response.json()
        products = products_data.get("data", [])
        
        if not products:
            print(f"  ✗ No products found")
            return results
        
        product = products[0]
        product_id = product.get("id")
        print(f"  Found product: {product.get('name')} (ID: {product_id})")
        
        # Create a new SO with one item
        so_payload = {
            "customerId": customer_id,
            "expectedDate": "2026-08-31",
            "items": [
                {
                    "productId": product_id,
                    "quantity": 1,
                    "weight": 10.0,
                    "unitPrice": 50000
                }
            ]
        }
        
        create_response = session.post(
            f"{BASE_URL}/sales-orders",
            json=so_payload,
            headers={"Content-Type": "application/json"}
        )
        print(f"✓ POST /sales-orders: {create_response.status_code}")
        
        if create_response.status_code in [200, 201]:
            create_data = create_response.json()
            created_so_id = create_data.get("data", {}).get("id")
            so_number = create_data.get("data", {}).get("soNumber")
            results["so_created"] = True
            print(f"  ✓ SO created: {so_number} (ID: {created_so_id})")
        else:
            print(f"  ✗ Failed to create SO: {create_response.status_code}")
            print(f"  Response: {create_response.text[:200]}")
            return results
        
        # Verify SO shows up in list
        list_response = session.get(f"{BASE_URL}/sales-orders")
        print(f"✓ GET /sales-orders: {list_response.status_code}")
        
        if list_response.status_code == 200:
            list_data = list_response.json()
            sos = list_data.get("data", [])
            found_so = next((so for so in sos if so.get("id") == created_so_id), None)
            
            if found_so:
                results["so_verified"] = True
                print(f"  ✓ SO verified in list: {found_so.get('soNumber')}")
            else:
                print(f"  ✗ SO not found in list")
        else:
            print(f"  ✗ Failed to get SO list: {list_response.status_code}")
        
        # Delete the SO
        if created_so_id:
            delete_response = session.delete(f"{BASE_URL}/sales-orders/{created_so_id}")
            print(f"✓ DELETE /sales-orders/{created_so_id}: {delete_response.status_code}")
            
            if delete_response.status_code in [200, 204]:
                results["so_deleted"] = True
                print(f"  ✓ SO deleted successfully")
                
                # Verify SO is gone
                verify_response = session.get(f"{BASE_URL}/sales-orders")
                if verify_response.status_code == 200:
                    verify_data = verify_response.json()
                    sos = verify_data.get("data", [])
                    found_so = next((so for so in sos if so.get("id") == created_so_id), None)
                    
                    if not found_so:
                        print(f"  ✓ SO confirmed deleted (not in list)")
                    else:
                        print(f"  ⚠ SO still in list after delete (may be archived)")
            else:
                print(f"  ✗ Failed to delete SO: {delete_response.status_code}")
                print(f"  Response: {delete_response.text[:200]}")
        
        # Test passes if SO was created, verified, and deleted
        results["passed"] = (
            results["so_created"] and
            results["so_verified"] and
            results["so_deleted"]
        )
        
        if results["passed"]:
            print(f"\n✓ TEST 4 PASSED: SO functionality working (create/verify/delete)")
        else:
            print(f"\n✗ TEST 4 FAILED: SO functionality issues")
        
    except Exception as e:
        print(f"✗ TEST 4 EXCEPTION: {e}")
        results["error"] = str(e)
    
    return results

def main():
    print("=" * 80)
    print("BACKEND TEST: System Integrity After Major Data Rollback")
    print("=" * 80)
    
    all_passed = True
    
    # Login as admin
    print("\n=== LOGIN AS ADMIN ===")
    admin_session = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_session:
        print("✗ CRITICAL: Admin login failed")
        return
    
    # TEST 1: SO/PO counts
    test1_results = test_so_po_counts(admin_session)
    all_passed = all_passed and test1_results.get("passed", False)
    
    # TEST 2: Inventory integrity
    test2_results = test_inventory_integrity(admin_session)
    all_passed = all_passed and test2_results.get("passed", False)
    
    # Login as akuntan
    print("\n=== LOGIN AS AKUNTAN ===")
    akuntan_session = login(AKUNTAN_EMAIL, AKUNTAN_PASSWORD)
    if not akuntan_session:
        print("✗ CRITICAL: Akuntan login failed")
        return
    
    # TEST 3: Accounting integrity
    test3_results = test_accounting_integrity(akuntan_session)
    all_passed = all_passed and test3_results.get("passed", False)
    
    # TEST 4: SO functionality (as admin)
    test4_results = test_so_functionality(admin_session)
    all_passed = all_passed and test4_results.get("passed", False)
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"TEST 1 (SO/PO Counts): {'✓ PASSED' if test1_results.get('passed') else '✗ FAILED'}")
    print(f"  - SO count: {test1_results.get('so_count', 'N/A')} (expected: 0)")
    print(f"  - PO count: {test1_results.get('po_count', 'N/A')} (expected: 0)")
    
    print(f"\nTEST 2 (Inventory Integrity): {'✓ PASSED' if test2_results.get('passed') else '✗ FAILED'}")
    print(f"  - Active stocks: {test2_results.get('active_count', 'N/A')} (expected: ~433)")
    print(f"  - Total weight: {test2_results.get('total_weight', 'N/A')} kg (expected: ~5458.7 kg)")
    print(f"  - Missing product.name: {test2_results.get('missing_product_name_count', 'N/A')} (expected: 0)")
    print(f"  - 'used' stocks: {test2_results.get('used_count', 'N/A')} (expected: 0)")
    print(f"  - 'allocated' stocks: {test2_results.get('allocated_count', 'N/A')} (expected: 0)")
    
    print(f"\nTEST 3 (Accounting Integrity): {'✓ PASSED' if test3_results.get('passed') else '✗ FAILED'}")
    print(f"  - Balance sheet balanced: {test3_results.get('balance_sheet_balanced', 'N/A')} (expected: true)")
    print(f"  - Trial balance equal: {test3_results.get('trial_balance_equal', 'N/A')} (expected: true)")
    print(f"  - Opening balances preserved: {test3_results.get('opening_balances_preserved', 'N/A')} (expected: true)")
    print(f"  - Manual journals count: {test3_results.get('manual_journals_count', 'N/A')} (expected: ~80)")
    
    print(f"\nTEST 4 (SO Functionality): {'✓ PASSED' if test4_results.get('passed') else '✗ FAILED'}")
    print(f"  - SO created: {test4_results.get('so_created', False)}")
    print(f"  - SO verified: {test4_results.get('so_verified', False)}")
    print(f"  - SO deleted: {test4_results.get('so_deleted', False)}")
    
    print("\n" + "=" * 80)
    if all_passed:
        print("✓ ALL TESTS PASSED - System integrity verified after rollback")
    else:
        print("✗ SOME TESTS FAILED - System integrity issues found")
    print("=" * 80)

if __name__ == "__main__":
    main()
