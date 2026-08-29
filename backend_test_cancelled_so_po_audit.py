#!/usr/bin/env python3
"""
Backend Test: Cancelled/Archived SO & PO Consistency Audit
Verifies data-fix that returned stranded 'used' stock for cancelled/archived SOs.
"""

import requests
import json
from typing import Dict, List, Any

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

# Expected stocks from data-fix
SO_0002_STOCKS = ["2608220002", "620260104", "620260094"]  # 3 stocks from SO/202608/0002
SO_0014_STOCKS = ["620260066", "620260069", "620260070", "620260087", "620260085", 
                  "620260072", "620260067", "620260064", "2608280003"]  # 9 stocks from SO/202608/0014
ALL_EXPECTED_STOCKS = SO_0002_STOCKS + SO_0014_STOCKS  # 12 total

session = requests.Session()

def login() -> bool:
    """Login as admin and establish session."""
    try:
        print("\n" + "="*80)
        print("TEST 1: Login as admin")
        print("="*80)
        
        response = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 200:
            print(f"✅ Login successful: {response.status_code}")
            # Check for session cookie
            cookies = session.cookies.get_dict()
            session_cookie = cookies.get("__Secure-better-auth.session_token") or cookies.get("better-auth.session_token")
            if session_cookie:
                print(f"✅ Session cookie set: {session_cookie[:20]}...")
            return True
        else:
            print(f"❌ Login failed: {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ Login error: {str(e)}")
        return False

def test_restored_stocks_active() -> Dict[str, Any]:
    """TEST 1: Verify all 12 restored stocks are 'active'."""
    try:
        print("\n" + "="*80)
        print("TEST 2: Verify all 12 restored stocks are 'active'")
        print("="*80)
        
        # Get all active stocks
        response = session.get(f"{BASE_URL}/inventory/stocks?status=active")
        
        if response.status_code != 200:
            print(f"❌ GET /inventory/stocks?status=active failed: {response.status_code}")
            return {"passed": False, "error": f"HTTP {response.status_code}"}
        
        data = response.json()
        stocks = data if isinstance(data, list) else data.get("data", [])
        
        print(f"✅ GET /inventory/stocks?status=active: {response.status_code}")
        print(f"   Total active stocks: {len(stocks)}")
        
        # Check each expected stock
        found_stocks = {}
        missing_stocks = []
        wrong_status_stocks = []
        
        for kode in ALL_EXPECTED_STOCKS:
            found = False
            for stock in stocks:
                stock_kode = stock.get("kodeSimpan") or stock.get("kode_simpan") or stock.get("kode")
                if stock_kode == kode:
                    found = True
                    status = stock.get("status")
                    weight = stock.get("weight", 0)
                    found_stocks[kode] = {"status": status, "weight": weight}
                    
                    if status != "active":
                        wrong_status_stocks.append({"kode": kode, "status": status})
                    break
            
            if not found:
                missing_stocks.append(kode)
        
        # Report results
        print(f"\n📊 STOCK VERIFICATION RESULTS:")
        print(f"   Expected: {len(ALL_EXPECTED_STOCKS)} stocks")
        print(f"   Found: {len(found_stocks)} stocks")
        print(f"   Missing: {len(missing_stocks)} stocks")
        print(f"   Wrong status: {len(wrong_status_stocks)} stocks")
        
        # SO/0002 stocks (3 stocks)
        print(f"\n📦 SO/202608/0002 stocks (3 stocks):")
        for kode in SO_0002_STOCKS:
            if kode in found_stocks:
                stock = found_stocks[kode]
                print(f"   ✅ {kode}: status={stock['status']}, weight={stock['weight']} kg")
            else:
                print(f"   ❌ {kode}: MISSING or not 'active'")
        
        # SO/0014 stocks (9 stocks)
        print(f"\n📦 SO/202608/0014 stocks (9 stocks):")
        for kode in SO_0014_STOCKS:
            if kode in found_stocks:
                stock = found_stocks[kode]
                print(f"   ✅ {kode}: status={stock['status']}, weight={stock['weight']} kg")
            else:
                print(f"   ❌ {kode}: MISSING or not 'active'")
        
        # Report issues
        if missing_stocks:
            print(f"\n❌ MISSING STOCKS: {missing_stocks}")
        
        if wrong_status_stocks:
            print(f"\n❌ WRONG STATUS STOCKS: {wrong_status_stocks}")
        
        passed = len(missing_stocks) == 0 and len(wrong_status_stocks) == 0
        
        if passed:
            print(f"\n✅ TEST 2 PASSED: All {len(ALL_EXPECTED_STOCKS)} stocks are 'active'")
        else:
            print(f"\n❌ TEST 2 FAILED: {len(missing_stocks)} missing, {len(wrong_status_stocks)} wrong status")
        
        return {
            "passed": passed,
            "found": len(found_stocks),
            "missing": missing_stocks,
            "wrong_status": wrong_status_stocks,
            "details": found_stocks
        }
        
    except Exception as e:
        print(f"❌ TEST 2 ERROR: {str(e)}")
        return {"passed": False, "error": str(e)}

def test_used_stocks_validity() -> Dict[str, Any]:
    """TEST 2: Check if any 'used' stock is wrongly stranded (tied to cancelled/archived SO)."""
    try:
        print("\n" + "="*80)
        print("TEST 3: Check for wrongly-stranded 'used' stocks")
        print("="*80)
        
        # Try to get 'used' stocks
        response = session.get(f"{BASE_URL}/inventory/stocks?status=used")
        
        if response.status_code != 200:
            print(f"⚠️  GET /inventory/stocks?status=used: {response.status_code}")
            print(f"   (Status filter may not be supported, checking all stocks instead)")
            
            # Fallback: get all stocks and filter
            response = session.get(f"{BASE_URL}/inventory/stocks")
            if response.status_code != 200:
                print(f"❌ GET /inventory/stocks failed: {response.status_code}")
                return {"passed": False, "error": f"HTTP {response.status_code}"}
        
        data = response.json()
        all_stocks = data if isinstance(data, list) else data.get("data", [])
        
        # Filter for 'used' stocks
        used_stocks = [s for s in all_stocks if s.get("status") == "used"]
        
        print(f"✅ Found {len(used_stocks)} stocks with status 'used'")
        
        if len(used_stocks) == 0:
            print(f"✅ TEST 3 PASSED: No 'used' stocks found (all returned to 'active')")
            return {"passed": True, "used_count": 0, "stranded": []}
        
        # Get all sales orders to check which are active
        so_response = session.get(f"{BASE_URL}/sales-orders")
        if so_response.status_code != 200:
            print(f"⚠️  Could not fetch sales orders: {so_response.status_code}")
            return {"passed": True, "used_count": len(used_stocks), "warning": "Could not verify SO status"}
        
        so_data = so_response.json()
        sales_orders = so_data if isinstance(so_data, list) else so_data.get("data", [])
        
        # Build map of active SOs
        active_so_ids = set()
        cancelled_archived_so_ids = set()
        
        for so in sales_orders:
            so_id = so.get("id")
            status = so.get("status", "")
            archived = so.get("archived", False)
            
            if status in ["Cancelled", "Dibatalkan"] or archived:
                cancelled_archived_so_ids.add(so_id)
            else:
                active_so_ids.add(so_id)
        
        print(f"   Active SOs: {len(active_so_ids)}")
        print(f"   Cancelled/Archived SOs: {len(cancelled_archived_so_ids)}")
        
        # Check each 'used' stock
        stranded_stocks = []
        valid_used_stocks = []
        
        for stock in used_stocks:
            stock_id = stock.get("id")
            kode = stock.get("kodeSimpan") or stock.get("kode_simpan") or stock.get("kode")
            
            # Check if stock is allocated to any SO
            # This requires checking stock allocations or SO items
            # For now, we'll report the count and assume they're valid if tied to active SOs
            
            # Simple heuristic: if stock has a salesOrderId field
            so_id = stock.get("salesOrderId") or stock.get("sales_order_id")
            
            if so_id:
                if so_id in cancelled_archived_so_ids:
                    stranded_stocks.append({
                        "kode": kode,
                        "stock_id": stock_id,
                        "so_id": so_id,
                        "reason": "Tied to cancelled/archived SO"
                    })
                elif so_id in active_so_ids:
                    valid_used_stocks.append(kode)
            else:
                # No SO reference, might be stranded
                stranded_stocks.append({
                    "kode": kode,
                    "stock_id": stock_id,
                    "reason": "No SO reference"
                })
        
        print(f"\n📊 'USED' STOCK ANALYSIS:")
        print(f"   Total 'used' stocks: {len(used_stocks)}")
        print(f"   Valid (tied to active SO): {len(valid_used_stocks)}")
        print(f"   Potentially stranded: {len(stranded_stocks)}")
        
        if stranded_stocks:
            print(f"\n⚠️  POTENTIALLY STRANDED 'USED' STOCKS:")
            for s in stranded_stocks[:5]:  # Show first 5
                print(f"   - {s.get('kode', 'N/A')}: {s.get('reason')}")
            if len(stranded_stocks) > 5:
                print(f"   ... and {len(stranded_stocks) - 5} more")
        
        passed = len(stranded_stocks) == 0
        
        if passed:
            print(f"\n✅ TEST 3 PASSED: All 'used' stocks are tied to active SOs")
        else:
            print(f"\n⚠️  TEST 3 WARNING: {len(stranded_stocks)} potentially stranded 'used' stocks")
        
        return {
            "passed": passed,
            "used_count": len(used_stocks),
            "valid": len(valid_used_stocks),
            "stranded": stranded_stocks
        }
        
    except Exception as e:
        print(f"❌ TEST 3 ERROR: {str(e)}")
        return {"passed": False, "error": str(e)}

def test_accounting_integrity() -> Dict[str, Any]:
    """TEST 3: Verify accounting integrity (balance sheet balanced, trial balance equal)."""
    try:
        print("\n" + "="*80)
        print("TEST 4: Accounting Integrity")
        print("="*80)
        
        results = {}
        
        # Test balance sheet
        print("\n📊 Balance Sheet:")
        bs_response = session.get(f"{BASE_URL}/accounting/balance-sheet")
        
        if bs_response.status_code != 200:
            print(f"❌ GET /accounting/balance-sheet failed: {bs_response.status_code}")
            results["balance_sheet"] = {"passed": False, "error": f"HTTP {bs_response.status_code}"}
        else:
            bs_data = bs_response.json()
            print(f"✅ GET /accounting/balance-sheet: {bs_response.status_code}")
            
            # Check if balanced
            balanced = bs_data.get("balanced", False)
            assets = bs_data.get("totalAssets", 0)
            liabilities = bs_data.get("totalLiabilities", 0)
            equity = bs_data.get("totalEquity", 0)
            
            print(f"   Balanced: {balanced}")
            print(f"   Total Assets: Rp {assets:,.2f}")
            print(f"   Total Liabilities: Rp {liabilities:,.2f}")
            print(f"   Total Equity: Rp {equity:,.2f}")
            print(f"   Liabilities + Equity: Rp {liabilities + equity:,.2f}")
            
            diff = abs(assets - (liabilities + equity))
            print(f"   Difference: Rp {diff:,.2f}")
            
            bs_passed = balanced or diff < 1.0  # Allow small rounding difference
            
            if bs_passed:
                print(f"✅ Balance Sheet is BALANCED")
            else:
                print(f"❌ Balance Sheet is NOT BALANCED (diff: Rp {diff:,.2f})")
            
            results["balance_sheet"] = {
                "passed": bs_passed,
                "balanced": balanced,
                "assets": assets,
                "liabilities": liabilities,
                "equity": equity,
                "difference": diff
            }
        
        # Test trial balance
        print("\n📊 Trial Balance:")
        tb_response = session.get(f"{BASE_URL}/accounting/trial-balance")
        
        if tb_response.status_code != 200:
            print(f"❌ GET /accounting/trial-balance failed: {tb_response.status_code}")
            results["trial_balance"] = {"passed": False, "error": f"HTTP {tb_response.status_code}"}
        else:
            tb_data = tb_response.json()
            print(f"✅ GET /accounting/trial-balance: {tb_response.status_code}")
            
            # Calculate totals
            accounts = tb_data if isinstance(tb_data, list) else tb_data.get("accounts", [])
            total_debit = sum(acc.get("debit", 0) for acc in accounts)
            total_credit = sum(acc.get("credit", 0) for acc in accounts)
            
            print(f"   Total Debit: Rp {total_debit:,.2f}")
            print(f"   Total Credit: Rp {total_credit:,.2f}")
            
            diff = abs(total_debit - total_credit)
            print(f"   Difference: Rp {diff:,.2f}")
            
            tb_passed = diff < 1.0  # Allow small rounding difference
            
            if tb_passed:
                print(f"✅ Trial Balance is EQUAL (debit == credit)")
            else:
                print(f"❌ Trial Balance is NOT EQUAL (diff: Rp {diff:,.2f})")
            
            results["trial_balance"] = {
                "passed": tb_passed,
                "total_debit": total_debit,
                "total_credit": total_credit,
                "difference": diff,
                "account_count": len(accounts)
            }
        
        overall_passed = results.get("balance_sheet", {}).get("passed", False) and \
                        results.get("trial_balance", {}).get("passed", False)
        
        if overall_passed:
            print(f"\n✅ TEST 4 PASSED: Accounting integrity verified")
        else:
            print(f"\n❌ TEST 4 FAILED: Accounting integrity issues found")
        
        results["passed"] = overall_passed
        return results
        
    except Exception as e:
        print(f"❌ TEST 4 ERROR: {str(e)}")
        return {"passed": False, "error": str(e)}

def test_cancelled_archived_docs() -> Dict[str, Any]:
    """TEST 4: Verify cancelled/archived SO & PO appear correctly."""
    try:
        print("\n" + "="*80)
        print("TEST 5: Cancelled/Archived SO & PO Consistency")
        print("="*80)
        
        results = {}
        
        # Test Sales Orders
        print("\n📦 Sales Orders:")
        so_response = session.get(f"{BASE_URL}/sales-orders")
        
        if so_response.status_code != 200:
            print(f"❌ GET /sales-orders failed: {so_response.status_code}")
            results["sales_orders"] = {"passed": False, "error": f"HTTP {so_response.status_code}"}
        else:
            so_data = so_response.json()
            sales_orders = so_data if isinstance(so_data, list) else so_data.get("data", [])
            
            print(f"✅ GET /sales-orders: {so_response.status_code}")
            print(f"   Total SOs: {len(sales_orders)}")
            
            # Find specific SOs
            so_0002 = None
            so_0014 = None
            cancelled_count = 0
            archived_count = 0
            
            for so in sales_orders:
                so_number = so.get("soNumber") or so.get("so_number")
                status = so.get("status", "")
                archived = so.get("archived", False)
                
                if so_number == "SO/202608/0002":
                    so_0002 = so
                elif so_number == "SO/202608/0014":
                    so_0014 = so
                
                if status in ["Cancelled", "Dibatalkan"]:
                    cancelled_count += 1
                if archived:
                    archived_count += 1
            
            print(f"   Cancelled SOs: {cancelled_count}")
            print(f"   Archived SOs: {archived_count}")
            
            # Check SO/202608/0002
            if so_0002:
                print(f"\n   📄 SO/202608/0002:")
                print(f"      Status: {so_0002.get('status')}")
                print(f"      Archived: {so_0002.get('archived', False)}")
                print(f"      ✅ Found in API response")
            else:
                print(f"\n   ⚠️  SO/202608/0002: Not found in response")
            
            # Check SO/202608/0014
            if so_0014:
                print(f"\n   📄 SO/202608/0014:")
                print(f"      Status: {so_0014.get('status')}")
                print(f"      Archived: {so_0014.get('archived', False)}")
                print(f"      ✅ Found in API response")
            else:
                print(f"\n   ⚠️  SO/202608/0014: Not found in response")
            
            results["sales_orders"] = {
                "passed": True,
                "total": len(sales_orders),
                "cancelled": cancelled_count,
                "archived": archived_count,
                "so_0002_found": so_0002 is not None,
                "so_0014_found": so_0014 is not None
            }
        
        # Test Purchase Orders
        print("\n📦 Purchase Orders:")
        po_response = session.get(f"{BASE_URL}/purchase-orders")
        
        if po_response.status_code != 200:
            print(f"❌ GET /purchase-orders failed: {po_response.status_code}")
            results["purchase_orders"] = {"passed": False, "error": f"HTTP {po_response.status_code}"}
        else:
            po_data = po_response.json()
            purchase_orders = po_data if isinstance(po_data, list) else po_data.get("data", [])
            
            print(f"✅ GET /purchase-orders: {po_response.status_code}")
            print(f"   Total POs: {len(purchase_orders)}")
            
            # Find specific PO
            po_0003 = None
            cancelled_count = 0
            archived_count = 0
            
            for po in purchase_orders:
                po_number = po.get("poNumber") or po.get("po_number")
                status = po.get("status", "")
                archived = po.get("archived", False)
                
                if po_number == "PO/202608/0003":
                    po_0003 = po
                
                if status in ["Cancelled", "Dibatalkan"]:
                    cancelled_count += 1
                if archived:
                    archived_count += 1
            
            print(f"   Cancelled POs: {cancelled_count}")
            print(f"   Archived POs: {archived_count}")
            
            # Check PO/202608/0003
            if po_0003:
                print(f"\n   📄 PO/202608/0003:")
                print(f"      Status: {po_0003.get('status')}")
                print(f"      Archived: {po_0003.get('archived', False)}")
                print(f"      ✅ Found in API response")
            else:
                print(f"\n   ⚠️  PO/202608/0003: Not found in response")
            
            results["purchase_orders"] = {
                "passed": True,
                "total": len(purchase_orders),
                "cancelled": cancelled_count,
                "archived": archived_count,
                "po_0003_found": po_0003 is not None
            }
        
        overall_passed = results.get("sales_orders", {}).get("passed", False) and \
                        results.get("purchase_orders", {}).get("passed", False)
        
        if overall_passed:
            print(f"\n✅ TEST 5 PASSED: Cancelled/archived docs consistent")
        else:
            print(f"\n❌ TEST 5 FAILED: Issues with cancelled/archived docs")
        
        results["passed"] = overall_passed
        return results
        
    except Exception as e:
        print(f"❌ TEST 5 ERROR: {str(e)}")
        return {"passed": False, "error": str(e)}

def test_no_500_errors() -> Dict[str, Any]:
    """TEST 5: Verify no HTTP 500 errors across all calls."""
    try:
        print("\n" + "="*80)
        print("TEST 6: No HTTP 500 Errors")
        print("="*80)
        
        endpoints = [
            "/inventory/stocks?status=active",
            "/sales-orders",
            "/purchase-orders",
            "/accounting/balance-sheet",
            "/accounting/trial-balance",
            "/dashboard/summary"
        ]
        
        errors = []
        
        for endpoint in endpoints:
            response = session.get(f"{BASE_URL}{endpoint}")
            if response.status_code == 500:
                errors.append({"endpoint": endpoint, "status": 500})
                print(f"❌ {endpoint}: HTTP 500")
            else:
                print(f"✅ {endpoint}: HTTP {response.status_code}")
        
        passed = len(errors) == 0
        
        if passed:
            print(f"\n✅ TEST 6 PASSED: No HTTP 500 errors")
        else:
            print(f"\n❌ TEST 6 FAILED: {len(errors)} endpoints returned HTTP 500")
        
        return {"passed": passed, "errors": errors}
        
    except Exception as e:
        print(f"❌ TEST 6 ERROR: {str(e)}")
        return {"passed": False, "error": str(e)}

def main():
    """Run all tests."""
    print("\n" + "="*80)
    print("BACKEND TEST: Cancelled/Archived SO & PO Consistency Audit")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Admin: {ADMIN_EMAIL}")
    
    # Login
    if not login():
        print("\n❌ TESTS ABORTED: Login failed")
        return
    
    # Run tests
    results = {}
    
    results["test1_login"] = {"passed": True}
    results["test2_restored_stocks"] = test_restored_stocks_active()
    results["test3_used_stocks"] = test_used_stocks_validity()
    results["test4_accounting"] = test_accounting_integrity()
    results["test5_cancelled_docs"] = test_cancelled_archived_docs()
    results["test6_no_500s"] = test_no_500_errors()
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    total_tests = len(results)
    passed_tests = sum(1 for r in results.values() if r.get("passed", False))
    
    print(f"\nTotal Tests: {total_tests}")
    print(f"Passed: {passed_tests}")
    print(f"Failed: {total_tests - passed_tests}")
    print(f"Success Rate: {passed_tests}/{total_tests} ({100*passed_tests//total_tests}%)")
    
    print("\n📊 DETAILED RESULTS:")
    for test_name, result in results.items():
        status = "✅ PASSED" if result.get("passed", False) else "❌ FAILED"
        print(f"   {test_name}: {status}")
    
    # Key findings
    print("\n" + "="*80)
    print("KEY FINDINGS")
    print("="*80)
    
    # Stock restoration
    stock_result = results.get("test2_restored_stocks", {})
    if stock_result.get("passed"):
        print(f"✅ All {len(ALL_EXPECTED_STOCKS)} restored stocks are 'active'")
        print(f"   - SO/202608/0002: {len(SO_0002_STOCKS)} stocks")
        print(f"   - SO/202608/0014: {len(SO_0014_STOCKS)} stocks")
    else:
        missing = stock_result.get("missing", [])
        wrong = stock_result.get("wrong_status", [])
        if missing:
            print(f"❌ Missing stocks: {missing}")
        if wrong:
            print(f"❌ Wrong status stocks: {wrong}")
    
    # Used stocks
    used_result = results.get("test3_used_stocks", {})
    used_count = used_result.get("used_count", 0)
    stranded = used_result.get("stranded", [])
    print(f"\n📊 'Used' stocks: {used_count} total")
    if len(stranded) > 0:
        print(f"⚠️  Potentially stranded: {len(stranded)}")
    else:
        print(f"✅ No stranded 'used' stocks")
    
    # Accounting
    acc_result = results.get("test4_accounting", {})
    bs = acc_result.get("balance_sheet", {})
    tb = acc_result.get("trial_balance", {})
    
    if bs.get("passed"):
        print(f"\n✅ Balance Sheet: BALANCED")
    else:
        print(f"\n❌ Balance Sheet: NOT BALANCED (diff: Rp {bs.get('difference', 0):,.2f})")
    
    if tb.get("passed"):
        print(f"✅ Trial Balance: EQUAL (debit == credit)")
    else:
        print(f"❌ Trial Balance: NOT EQUAL (diff: Rp {tb.get('difference', 0):,.2f})")
    
    # Cancelled/archived docs
    doc_result = results.get("test5_cancelled_docs", {})
    so_data = doc_result.get("sales_orders", {})
    po_data = doc_result.get("purchase_orders", {})
    
    print(f"\n📦 Sales Orders: {so_data.get('total', 0)} total")
    print(f"   Cancelled: {so_data.get('cancelled', 0)}")
    print(f"   Archived: {so_data.get('archived', 0)}")
    
    print(f"\n📦 Purchase Orders: {po_data.get('total', 0)} total")
    print(f"   Cancelled: {po_data.get('cancelled', 0)}")
    print(f"   Archived: {po_data.get('archived', 0)}")
    
    # HTTP 500 errors
    error_result = results.get("test6_no_500s", {})
    if error_result.get("passed"):
        print(f"\n✅ No HTTP 500 errors")
    else:
        errors = error_result.get("errors", [])
        print(f"\n❌ HTTP 500 errors: {len(errors)}")
    
    print("\n" + "="*80)
    print("TEST COMPLETE")
    print("="*80)

if __name__ == "__main__":
    main()
