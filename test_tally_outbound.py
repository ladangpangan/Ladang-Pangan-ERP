#!/usr/bin/env python3
"""
Backend test for Tally Outbound + Inventory Logbook endpoints
Tests the NEW endpoints as specified in the review request
"""

import requests
import json
import sys
import subprocess
import os

BASE_URL = "http://localhost:3000/api"
ORIGIN = "http://localhost:3000"

# Test credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
OPERATOR_EMAIL = "operator@lpi.co.id"
OPERATOR_PASSWORD = "operator123"

class TestSession:
    def __init__(self, email, password, role_name):
        self.email = email
        self.password = password
        self.role_name = role_name
        self.session = requests.Session()
        self.login()
    
    def login(self):
        """Login and get session cookie"""
        print(f"\n🔐 Logging in as {self.role_name} ({self.email})...")
        response = self.session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": self.email, "password": self.password},
            headers={"Origin": ORIGIN}
        )
        if response.status_code != 200:
            print(f"❌ Login failed: {response.status_code} {response.text}")
            sys.exit(1)
        
        # Debug: print cookies
        cookies = self.session.cookies.get_dict()
        print(f"✅ Logged in as {self.role_name}")
        print(f"   Cookies: {list(cookies.keys())}")
        
        if not cookies:
            print(f"⚠️  WARNING: No cookies set after login!")
            print(f"   Response headers: {dict(response.headers)}")
    
    def get(self, path, params=None):
        """GET request"""
        return self.session.get(f"{BASE_URL}{path}", params=params)
    
    def post(self, path, data):
        """POST request with Origin header"""
        return self.session.post(
            f"{BASE_URL}{path}",
            json=data,
            headers={"Origin": ORIGIN}
        )

def run_node_script(command):
    """Run the Node.js seed script"""
    result = subprocess.run(
        ["node", "/app/seed_tally_test.js", command],
        capture_output=True,
        text=True
    )
    print(result.stdout)
    if result.returncode != 0:
        print(f"❌ Node script failed: {result.stderr}")
        sys.exit(1)
    return result.returncode == 0

def load_test_ids():
    """Load test IDs from JSON file"""
    with open('/app/test_ids.json', 'r') as f:
        return json.load(f)

def main():
    print("=" * 80)
    print("TALLY OUTBOUND + INVENTORY LOGBOOK - BACKEND TEST")
    print("=" * 80)
    
    # Step 1: Seed test data
    print("\n📦 STEP 1: SEEDING TEST DATA")
    print("-" * 80)
    run_node_script("seed")
    
    # Load test IDs
    test_data = load_test_ids()
    so_id = test_data['soId']
    item_id = test_data['itemId']
    stocks = test_data['stocks']
    product_id = test_data['productId']
    
    print(f"\n📋 Test Data Loaded:")
    print(f"   SO ID: {so_id}")
    print(f"   SO Number: {test_data['soNumber']}")
    print(f"   Item ID: {item_id}")
    print(f"   Stocks: {', '.join([s['kodeSimpan'] for s in stocks])}")
    
    # Create sessions
    admin = TestSession(ADMIN_EMAIL, ADMIN_PASSWORD, "ADMIN")
    operator = TestSession(OPERATOR_EMAIL, OPERATOR_PASSWORD, "OPERATOR")
    
    test_results = []
    
    # TEST 1: GET /api/tally-outbound/orders as OPERATOR
    print("\n" + "=" * 80)
    print("TEST 1: GET /api/tally-outbound/orders as OPERATOR")
    print("-" * 80)
    try:
        response = operator.get("/tally-outbound/orders")
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            orders = data.get('data', [])
            print(f"✓ Response: 200 OK")
            print(f"✓ Orders count: {len(orders)}")
            
            # Find QA-SO-1
            qa_so = next((o for o in orders if o['soNumber'] == 'QA-SO-1'), None)
            if qa_so:
                print(f"✓ Found QA-SO-1 in list")
                print(f"  - itemCount: {qa_so.get('itemCount')}")
                print(f"  - allocatedItemCount: {qa_so.get('allocatedItemCount')}")
                print(f"  - totalWeight: {qa_so.get('totalWeight')}")
                
                # Verify no price fields
                has_price_fields = any(k in qa_so for k in ['unitPrice', 'subtotal', 'totalAmount', 'price'])
                if not has_price_fields:
                    print(f"✓ No price fields exposed (correct)")
                    test_results.append(("TEST 1", "PASS", "Orders list includes QA-SO-1, no price fields"))
                else:
                    print(f"❌ Price fields found: {[k for k in qa_so.keys() if 'price' in k.lower() or 'amount' in k.lower()]}")
                    test_results.append(("TEST 1", "FAIL", "Price fields exposed"))
            else:
                print(f"❌ QA-SO-1 not found in orders list")
                test_results.append(("TEST 1", "FAIL", "QA-SO-1 not in list"))
        else:
            print(f"❌ Expected 200, got {response.status_code}")
            print(f"Response: {response.text}")
            test_results.append(("TEST 1", "FAIL", f"Status {response.status_code}"))
    except Exception as e:
        print(f"❌ Exception: {e}")
        test_results.append(("TEST 1", "FAIL", str(e)))
    
    # TEST 2: GET /api/tally-outbound/orders/:soId as operator
    print("\n" + "=" * 80)
    print("TEST 2: GET /api/tally-outbound/orders/:soId as OPERATOR")
    print("-" * 80)
    try:
        response = operator.get(f"/tally-outbound/orders/{so_id}")
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            so_detail = data.get('data', {})
            items = so_detail.get('items', [])
            print(f"✓ Response: 200 OK")
            print(f"✓ Items count: {len(items)}")
            
            if len(items) > 0:
                item = items[0]
                print(f"✓ Item[0] fields:")
                print(f"  - productName: {item.get('productName')}")
                print(f"  - orderedWeight: {item.get('orderedWeight')}")
                print(f"  - allocated: {item.get('allocated')}")
                print(f"  - allocations: {item.get('allocations')}")
                
                # Verify NO price fields
                price_fields = [k for k in item.keys() if any(p in k.lower() for p in ['price', 'subtotal', 'markup', 'amount'])]
                if not price_fields:
                    print(f"✓ No price fields in item (correct)")
                    test_results.append(("TEST 2", "PASS", "SO detail has items with no price fields"))
                else:
                    print(f"❌ Price fields found: {price_fields}")
                    test_results.append(("TEST 2", "FAIL", f"Price fields exposed: {price_fields}"))
            else:
                print(f"❌ No items in SO")
                test_results.append(("TEST 2", "FAIL", "No items"))
        else:
            print(f"❌ Expected 200, got {response.status_code}")
            print(f"Response: {response.text}")
            test_results.append(("TEST 2", "FAIL", f"Status {response.status_code}"))
    except Exception as e:
        print(f"❌ Exception: {e}")
        test_results.append(("TEST 2", "FAIL", str(e)))
    
    # TEST 3: GET /api/tally-outbound/orders/:soId/items/:itemId/stocks
    print("\n" + "=" * 80)
    print("TEST 3: GET /api/tally-outbound/orders/:soId/items/:itemId/stocks")
    print("-" * 80)
    try:
        response = operator.get(f"/tally-outbound/orders/{so_id}/items/{item_id}/stocks")
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            result = data.get('data', {})
            ordered_weight = result.get('orderedWeight')
            stocks_list = result.get('stocks', [])
            
            print(f"✓ Response: 200 OK")
            print(f"✓ orderedWeight: {ordered_weight}")
            print(f"✓ Stocks count: {len(stocks_list)}")
            
            # Verify sorted by |diff|
            diffs = [abs(s['diff']) for s in stocks_list]
            is_sorted = all(diffs[i] <= diffs[i+1] for i in range(len(diffs)-1))
            print(f"✓ Sorted by |diff|: {is_sorted}")
            
            # Find recommended stock
            recommended = [s for s in stocks_list if s.get('recommended')]
            print(f"✓ Recommended stocks: {len(recommended)}")
            
            if len(recommended) == 1:
                rec = recommended[0]
                print(f"✓ Recommended stock:")
                print(f"  - kodeSimpan: {rec['kodeSimpan']}")
                print(f"  - weight: {rec['weight']}")
                print(f"  - diff: {rec['diff']}")
                print(f"  - csCode: {rec.get('csCode')}")
                
                # Verify it's the 120kg lot (closest to 100)
                if rec['weight'] == 120:
                    print(f"✓ Correct recommendation: 120kg lot (closest to 100kg)")
                    test_results.append(("TEST 3", "PASS", "Stocks sorted, 120kg lot recommended"))
                else:
                    print(f"❌ Wrong recommendation: expected 120kg, got {rec['weight']}kg")
                    test_results.append(("TEST 3", "FAIL", f"Wrong recommendation: {rec['weight']}kg"))
            else:
                print(f"❌ Expected exactly 1 recommended stock, got {len(recommended)}")
                test_results.append(("TEST 3", "FAIL", f"{len(recommended)} recommended stocks"))
        else:
            print(f"❌ Expected 200, got {response.status_code}")
            print(f"Response: {response.text}")
            test_results.append(("TEST 3", "FAIL", f"Status {response.status_code}"))
    except Exception as e:
        print(f"❌ Exception: {e}")
        test_results.append(("TEST 3", "FAIL", str(e)))
    
    # TEST 4: POST allocate with QA-S1 + QA-S2
    print("\n" + "=" * 80)
    print("TEST 4: POST /api/tally-outbound/orders/:soId/items/:itemId/allocate")
    print("        Allocating QA-S1 (45kg) + QA-S2 (55kg) = 100kg")
    print("-" * 80)
    try:
        stock_ids = [stocks[0]['id'], stocks[1]['id']]  # QA-S1, QA-S2
        response = operator.post(
            f"/tally-outbound/orders/{so_id}/items/{item_id}/allocate",
            {"stockIds": stock_ids}
        )
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            result = data.get('data', {})
            allocated_weight = result.get('allocatedWeight')
            
            print(f"✓ Response: 200 OK")
            print(f"✓ allocatedWeight: {allocated_weight}")
            
            if allocated_weight == 100:
                print(f"✓ Correct allocated weight: 100kg")
                
                # Verify in SQLite
                verify_result = subprocess.run(
                    ["node", "-e", f"""
const Database = require('better-sqlite3');
const db = new Database('/app/data/erp.db');
const stocks = db.prepare("SELECT id, kode_simpan, status FROM inventory_stock WHERE kode_simpan IN ('QA-S1', 'QA-S2')").all();
const soItemStocks = db.prepare("SELECT COUNT(*) as c FROM so_item_stocks WHERE so_item_id = '{item_id}'").get();
console.log(JSON.stringify({{stocks, soItemStocksCount: soItemStocks.c}}));
db.close();
                    """],
                    capture_output=True,
                    text=True
                )
                
                if verify_result.returncode == 0:
                    verify_data = json.loads(verify_result.stdout.strip())
                    stocks_status = verify_data['stocks']
                    so_item_stocks_count = verify_data['soItemStocksCount']
                    
                    print(f"✓ SQLite verification:")
                    for s in stocks_status:
                        print(f"  - {s['kode_simpan']}: status={s['status']}")
                    print(f"  - so_item_stocks rows: {so_item_stocks_count}")
                    
                    all_allocated = all(s['status'] == 'allocated' for s in stocks_status)
                    if all_allocated and so_item_stocks_count == 2:
                        print(f"✓ All stocks allocated, 2 so_item_stocks rows created")
                        test_results.append(("TEST 4", "PASS", "Allocation successful, stocks locked"))
                    else:
                        print(f"❌ Verification failed")
                        test_results.append(("TEST 4", "FAIL", "SQLite verification failed"))
                else:
                    print(f"❌ SQLite verification error")
                    test_results.append(("TEST 4", "FAIL", "SQLite verification error"))
            else:
                print(f"❌ Expected 100kg, got {allocated_weight}kg")
                test_results.append(("TEST 4", "FAIL", f"Wrong weight: {allocated_weight}kg"))
        else:
            print(f"❌ Expected 200, got {response.status_code}")
            print(f"Response: {response.text}")
            test_results.append(("TEST 4", "FAIL", f"Status {response.status_code}"))
    except Exception as e:
        print(f"❌ Exception: {e}")
        test_results.append(("TEST 4", "FAIL", str(e)))
    
    # TEST 5: Re-POST allocate with QA-S3
    print("\n" + "=" * 80)
    print("TEST 5: Re-POST allocate with QA-S3 (120kg)")
    print("        Should free QA-S1 & QA-S2, allocate QA-S3")
    print("-" * 80)
    try:
        stock_ids = [stocks[2]['id']]  # QA-S3
        response = operator.post(
            f"/tally-outbound/orders/{so_id}/items/{item_id}/allocate",
            {"stockIds": stock_ids}
        )
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            result = data.get('data', {})
            allocated_weight = result.get('allocatedWeight')
            
            print(f"✓ Response: 200 OK")
            print(f"✓ allocatedWeight: {allocated_weight}")
            
            if allocated_weight == 120:
                print(f"✓ Correct allocated weight: 120kg")
                
                # Verify in SQLite
                verify_result = subprocess.run(
                    ["node", "-e", f"""
const Database = require('better-sqlite3');
const db = new Database('/app/data/erp.db');
const stocks = db.prepare("SELECT id, kode_simpan, status FROM inventory_stock WHERE kode_simpan IN ('QA-S1', 'QA-S2', 'QA-S3')").all();
const soItemStocks = db.prepare("SELECT COUNT(*) as c FROM so_item_stocks WHERE so_item_id = '{item_id}'").get();
console.log(JSON.stringify({{stocks, soItemStocksCount: soItemStocks.c}}));
db.close();
                    """],
                    capture_output=True,
                    text=True
                )
                
                if verify_result.returncode == 0:
                    verify_data = json.loads(verify_result.stdout.strip())
                    stocks_status = verify_data['stocks']
                    so_item_stocks_count = verify_data['soItemStocksCount']
                    
                    print(f"✓ SQLite verification:")
                    for s in stocks_status:
                        print(f"  - {s['kode_simpan']}: status={s['status']}")
                    print(f"  - so_item_stocks rows: {so_item_stocks_count}")
                    
                    s1_active = next((s for s in stocks_status if s['kode_simpan'] == 'QA-S1'), {}).get('status') == 'active'
                    s2_active = next((s for s in stocks_status if s['kode_simpan'] == 'QA-S2'), {}).get('status') == 'active'
                    s3_allocated = next((s for s in stocks_status if s['kode_simpan'] == 'QA-S3'), {}).get('status') == 'allocated'
                    
                    if s1_active and s2_active and s3_allocated and so_item_stocks_count == 1:
                        print(f"✓ QA-S1 & QA-S2 freed, QA-S3 allocated, 1 so_item_stocks row")
                        test_results.append(("TEST 5", "PASS", "Re-allocation successful"))
                    else:
                        print(f"❌ Verification failed: S1={s1_active}, S2={s2_active}, S3={s3_allocated}, rows={so_item_stocks_count}")
                        test_results.append(("TEST 5", "FAIL", "SQLite verification failed"))
                else:
                    print(f"❌ SQLite verification error")
                    test_results.append(("TEST 5", "FAIL", "SQLite verification error"))
            else:
                print(f"❌ Expected 120kg, got {allocated_weight}kg")
                test_results.append(("TEST 5", "FAIL", f"Wrong weight: {allocated_weight}kg"))
        else:
            print(f"❌ Expected 200, got {response.status_code}")
            print(f"Response: {response.text}")
            test_results.append(("TEST 5", "FAIL", f"Status {response.status_code}"))
    except Exception as e:
        print(f"❌ Exception: {e}")
        test_results.append(("TEST 5", "FAIL", str(e)))
    
    # TEST 6: GET orders again - should be absent (fully allocated)
    print("\n" + "=" * 80)
    print("TEST 6: GET /api/tally-outbound/orders (should NOT include QA-SO-1)")
    print("-" * 80)
    try:
        response = operator.get("/tally-outbound/orders")
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            orders = data.get('data', [])
            print(f"✓ Response: 200 OK")
            print(f"✓ Orders count: {len(orders)}")
            
            qa_so = next((o for o in orders if o['soNumber'] == 'QA-SO-1'), None)
            if qa_so is None:
                print(f"✓ QA-SO-1 NOT in list (correct - fully allocated)")
                test_results.append(("TEST 6", "PASS", "Fully allocated SO hidden from list"))
            else:
                print(f"❌ QA-SO-1 still in list (should be hidden)")
                test_results.append(("TEST 6", "FAIL", "Fully allocated SO still visible"))
        else:
            print(f"❌ Expected 200, got {response.status_code}")
            test_results.append(("TEST 6", "FAIL", f"Status {response.status_code}"))
    except Exception as e:
        print(f"❌ Exception: {e}")
        test_results.append(("TEST 6", "FAIL", str(e)))
    
    # TEST 7: Change SO to non-Draft, try allocate -> 400
    print("\n" + "=" * 80)
    print("TEST 7: POST allocate on non-Draft SO (should fail with 400)")
    print("-" * 80)
    try:
        # Change SO to Confirmed
        subprocess.run(
            ["node", "-e", f"""
const Database = require('better-sqlite3');
const db = new Database('/app/data/erp.db');
db.prepare("UPDATE sales_order SET pipeline_status = 'Confirmed' WHERE id = '{so_id}'").run();
console.log('✓ Changed SO to Confirmed');
db.close();
            """],
            capture_output=True,
            text=True
        )
        
        # Try to allocate
        response = operator.post(
            f"/tally-outbound/orders/{so_id}/items/{item_id}/allocate",
            {"stockIds": [stocks[0]['id']]}
        )
        print(f"Status: {response.status_code}")
        
        if response.status_code == 400:
            print(f"✓ Response: 400 (correct - Draft-only)")
            print(f"✓ Error message: {response.text}")
            test_results.append(("TEST 7", "PASS", "Non-Draft SO allocation rejected"))
        else:
            print(f"❌ Expected 400, got {response.status_code}")
            test_results.append(("TEST 7", "FAIL", f"Status {response.status_code}"))
        
        # Set back to Draft
        subprocess.run(
            ["node", "-e", f"""
const Database = require('better-sqlite3');
const db = new Database('/app/data/erp.db');
db.prepare("UPDATE sales_order SET pipeline_status = 'Draft' WHERE id = '{so_id}'").run();
console.log('✓ Changed SO back to Draft');
db.close();
            """],
            capture_output=True,
            text=True
        )
    except Exception as e:
        print(f"❌ Exception: {e}")
        test_results.append(("TEST 7", "FAIL", str(e)))
    
    # TEST 8: GET /api/stock-ledger
    print("\n" + "=" * 80)
    print("TEST 8: GET /api/stock-ledger")
    print("-" * 80)
    try:
        # As ADMIN -> 200
        print("8a) As ADMIN:")
        response = admin.get("/stock-ledger")
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            result = data.get('data', {})
            movements = result.get('movements', [])
            summary = result.get('summary', {})
            
            print(f"   ✓ Response: 200 OK")
            print(f"   ✓ Movements count: {len(movements)}")
            print(f"   ✓ Summary: {summary}")
            
            # Test query params
            print("\n8b) Test query params:")
            response2 = admin.get("/stock-ledger", params={"movementType": "IN"})
            print(f"   ?movementType=IN: {response2.status_code}")
            
            response3 = admin.get("/stock-ledger", params={"productId": product_id})
            print(f"   ?productId={product_id[:8]}...: {response3.status_code}")
            
            # As OPERATOR -> 403
            print("\n8c) As OPERATOR:")
            response4 = operator.get("/stock-ledger")
            print(f"   Status: {response4.status_code}")
            
            if response4.status_code == 403:
                print(f"   ✓ Response: 403 (correct - operator forbidden)")
                test_results.append(("TEST 8", "PASS", "Stock ledger: admin 200, operator 403"))
            else:
                print(f"   ❌ Expected 403, got {response4.status_code}")
                test_results.append(("TEST 8", "FAIL", f"Operator got {response4.status_code}"))
        else:
            print(f"   ❌ Expected 200, got {response.status_code}")
            test_results.append(("TEST 8", "FAIL", f"Admin got {response.status_code}"))
    except Exception as e:
        print(f"❌ Exception: {e}")
        test_results.append(("TEST 8", "FAIL", str(e)))
    
    # TEST 9: Regression tests
    print("\n" + "=" * 80)
    print("TEST 9: Regression tests")
    print("-" * 80)
    try:
        endpoints = [
            "/products",
            "/contacts",
            "/stats",
            "/me"
        ]
        
        all_ok = True
        for endpoint in endpoints:
            response = admin.get(endpoint)
            status_ok = response.status_code == 200
            print(f"   GET {endpoint}: {response.status_code} {'✓' if status_ok else '❌'}")
            if not status_ok:
                all_ok = False
        
        if all_ok:
            test_results.append(("TEST 9", "PASS", "All regression endpoints OK"))
        else:
            test_results.append(("TEST 9", "FAIL", "Some regression endpoints failed"))
    except Exception as e:
        print(f"❌ Exception: {e}")
        test_results.append(("TEST 9", "FAIL", str(e)))
    
    # CLEANUP
    print("\n" + "=" * 80)
    print("CLEANUP: Removing all test data")
    print("-" * 80)
    run_node_script("cleanup")
    
    # SUMMARY
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for t in test_results if t[1] == "PASS")
    failed = sum(1 for t in test_results if t[1] == "FAIL")
    
    for test_name, status, message in test_results:
        icon = "✅" if status == "PASS" else "❌"
        print(f"{icon} {test_name}: {status} - {message}")
    
    print(f"\n{'=' * 80}")
    print(f"TOTAL: {passed} passed, {failed} failed out of {len(test_results)} tests")
    print(f"{'=' * 80}")
    
    if failed > 0:
        sys.exit(1)
    else:
        print("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)

if __name__ == "__main__":
    main()
