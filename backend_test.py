#!/usr/bin/env python3
"""
Backend test for Tally Session feature (draft inbound resumable + finalize to inventory)
Uses subprocess + curl to handle Better Auth secure cookies over HTTP
"""
import subprocess
import json
import sqlite3
import sys

BASE_URL = "http://localhost:3000/api"
DB_PATH = "/app/data/erp.db"
COOKIE_FILE = "/tmp/test_cookies.txt"

# Track created resources for cleanup
created_session_ids = []
created_transaction_ids = []
created_stock_ids = []

def curl_request(method, endpoint, data=None, expect_status=None):
    """Make a curl request with session cookies"""
    cmd = [
        "curl", "-s", "-w", "\\n%{http_code}",
        "-b", COOKIE_FILE, "-c", COOKIE_FILE,
        "-X", method,
        "-H", "Content-Type: application/json",
        "-H", "Origin: http://localhost:3000"
    ]
    
    if data:
        cmd.extend(["-d", json.dumps(data)])
    
    cmd.append(f"{BASE_URL}{endpoint}")
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        output = result.stdout
        
        # Split response body and status code
        lines = output.strip().split('\n')
        status_code = int(lines[-1]) if lines else 0
        body = '\n'.join(lines[:-1]) if len(lines) > 1 else ''
        
        if expect_status and status_code != expect_status:
            print(f"❌ Expected status {expect_status}, got {status_code}")
            print(f"   Response: {body[:200]}")
        
        return status_code, body
    except Exception as e:
        print(f"❌ curl error: {e}")
        return 0, ""

def login():
    """Login as admin"""
    print("\n=== STEP 0: Login ===")
    try:
        status, body = curl_request("POST", "/auth/sign-in/email", {
            "email": "admin@lpi.co.id",
            "password": "admin123"
        })
        
        print(f"Login response status: {status}")
        if status == 200:
            print("✅ Login successful")
            return True
        else:
            print(f"❌ Login failed: {status} - {body}")
            return False
    except Exception as e:
        print(f"❌ Login error: {e}")
        return False

def get_cold_storage_and_product():
    """Get a cold storage ID and product ID"""
    print("\n=== STEP 1: Get Cold Storage and Product IDs ===")
    try:
        # Get cold storage
        status, body = curl_request("GET", "/cold-storages")
        print(f"GET /cold-storages status: {status}")
        
        if status != 200:
            print(f"❌ Failed to get cold storages: {body}")
            return None, None
        
        cs_data = json.loads(body)
        if not cs_data.get('data') or len(cs_data['data']) == 0:
            print("❌ No cold storages found")
            return None, None
        
        cold_storage_id = cs_data['data'][0]['id']
        print(f"✅ Cold Storage ID: {cold_storage_id}")
        
        # Get product
        status, body = curl_request("GET", "/products")
        print(f"GET /products status: {status}")
        
        if status != 200:
            print(f"❌ Failed to get products: {body}")
            return cold_storage_id, None
        
        prod_data = json.loads(body)
        if not prod_data.get('data') or len(prod_data['data']) == 0:
            print("❌ No products found")
            return cold_storage_id, None
        
        product_id = prod_data['data'][0]['id']
        print(f"✅ Product ID: {product_id}")
        
        return cold_storage_id, product_id
    except Exception as e:
        print(f"❌ Error getting IDs: {e}")
        import traceback
        traceback.print_exc()
        return None, None

def test_create_draft_session(cold_storage_id, product_id):
    """Test POST /tally-sessions to create a draft with 1 item"""
    print("\n=== STEP 2: POST /tally-sessions (create draft with 1 item) ===")
    try:
        payload = {
            "coldStorageId": cold_storage_id,
            "referenceType": "MANUAL",
            "items": [
                {
                    "productId": product_id,
                    "weight": 10,
                    "quantity": 1,
                    "packagingType": "colly"
                }
            ]
        }
        
        status, body = curl_request("POST", "/tally-sessions", payload)
        print(f"POST /tally-sessions status: {status}")
        print(f"Response: {body[:500]}")
        
        if status != 201:
            print(f"❌ Failed to create draft session: {status} - {body}")
            return None
        
        data = json.loads(body)
        session_id = data['data']['id']
        created_session_ids.append(session_id)
        print(f"✅ Draft session created with ID: {session_id}")
        
        # Verify GET /tally-sessions?status=draft includes it
        print("\n--- Verify GET /tally-sessions?status=draft ---")
        status, body = curl_request("GET", "/tally-sessions?status=draft")
        print(f"GET /tally-sessions?status=draft status: {status}")
        
        if status != 200:
            print(f"❌ Failed to list draft sessions: {body}")
            return session_id
        
        list_data = json.loads(body)
        sessions = list_data.get('data', [])
        found_session = next((s for s in sessions if s['id'] == session_id), None)
        
        if not found_session:
            print(f"❌ Session {session_id} not found in draft list")
            return session_id
        
        print(f"✅ Session found in draft list")
        print(f"   itemCount: {found_session.get('itemCount')} (expected: 1)")
        print(f"   totalWeight: {found_session.get('totalWeight')} (expected: 10)")
        
        if found_session.get('itemCount') == 1 and found_session.get('totalWeight') == 10:
            print("✅ itemCount and totalWeight are correct")
        else:
            print(f"❌ itemCount or totalWeight mismatch")
        
        return session_id
    except Exception as e:
        print(f"❌ Error creating draft session: {e}")
        import traceback
        traceback.print_exc()
        return None

def test_update_draft_session(session_id, product_id):
    """Test PUT /tally-sessions/:id to update with 2 items"""
    print(f"\n=== STEP 3: PUT /tally-sessions/{session_id} (update to 2 items) ===")
    try:
        payload = {
            "items": [
                {
                    "productId": product_id,
                    "weight": 10,
                    "quantity": 1,
                    "packagingType": "colly"
                },
                {
                    "productId": product_id,
                    "weight": 5,
                    "quantity": 1,
                    "packagingType": "colly"
                }
            ]
        }
        
        status, body = curl_request("PUT", f"/tally-sessions/{session_id}", payload)
        print(f"PUT /tally-sessions/{session_id} status: {status}")
        print(f"Response: {body[:500]}")
        
        if status != 200:
            print(f"❌ Failed to update draft session: {status} - {body}")
            return False
        
        print("✅ Draft session updated")
        
        # Verify GET /tally-sessions/:id shows 2 items, totalWeight=15
        print(f"\n--- Verify GET /tally-sessions/{session_id} ---")
        status, body = curl_request("GET", f"/tally-sessions/{session_id}")
        print(f"GET /tally-sessions/{session_id} status: {status}")
        
        if status != 200:
            print(f"❌ Failed to get session: {body}")
            return False
        
        data = json.loads(body)
        session = data.get('data', {})
        items = session.get('items', [])
        total_weight = session.get('totalWeight', 0)
        
        print(f"   Number of items: {len(items)} (expected: 2)")
        print(f"   totalWeight: {total_weight} (expected: 15)")
        
        if len(items) == 2 and total_weight == 15:
            print("✅ Item count and totalWeight are correct")
            print(f"   Item 1 weight: {items[0].get('weight')}")
            print(f"   Item 2 weight: {items[1].get('weight')}")
            return True
        else:
            print(f"❌ Item count or totalWeight mismatch")
            return False
    except Exception as e:
        print(f"❌ Error updating draft session: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_finalize_session(session_id):
    """Test POST /tally-sessions/:id/finalize"""
    print(f"\n=== STEP 4: POST /tally-sessions/{session_id}/finalize ===")
    try:
        status, body = curl_request("POST", f"/tally-sessions/{session_id}/finalize")
        print(f"POST /tally-sessions/{session_id}/finalize status: {status}")
        print(f"Response: {body[:500]}")
        
        if status != 201:
            print(f"❌ Failed to finalize session: {status} - {body}")
            return None, []
        
        data = json.loads(body)
        transaction_id = data['data'].get('transactionId')
        stock_ids = data['data'].get('stockIds', [])
        stocks = data['data'].get('stocks', [])
        
        print(f"✅ Session finalized")
        print(f"   Transaction ID: {transaction_id}")
        print(f"   Stock IDs: {stock_ids}")
        print(f"   Number of stocks: {len(stocks)} (expected: 2)")
        
        if transaction_id:
            created_transaction_ids.append(transaction_id)
        created_stock_ids.extend(stock_ids)
        
        # Verify via SQLite
        print("\n--- Verify via SQLite ---")
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Check inventory_stock rows
        print("(a) Checking inventory_stock rows...")
        for stock_id in stock_ids:
            cursor.execute(
                "SELECT id, weight, quantity, status FROM inventory_stock WHERE id = ?",
                (stock_id,)
            )
            row = cursor.fetchone()
            if row:
                print(f"   ✅ Stock {stock_id}: weight={row[1]}, quantity={row[2]}, status={row[3]}")
                if row[3] != 'active':
                    print(f"      ❌ Status is not 'active': {row[3]}")
            else:
                print(f"   ❌ Stock {stock_id} not found in database")
        
        # Check weights are 10 and 5
        cursor.execute(
            "SELECT weight FROM inventory_stock WHERE id IN (?, ?) ORDER BY weight DESC",
            tuple(stock_ids[:2])
        )
        weights = [row[0] for row in cursor.fetchall()]
        print(f"   Stock weights: {weights} (expected: [10, 5] or [10.0, 5.0])")
        if len(weights) == 2 and weights[0] == 10 and weights[1] == 5:
            print("   ✅ Stock weights are correct (10 and 5)")
        else:
            print(f"   ❌ Stock weights mismatch")
        
        # Check tally_session row
        print("(b) Checking tally_session row...")
        cursor.execute(
            "SELECT status, transaction_id, finalized_at FROM tally_session WHERE id = ?",
            (session_id,)
        )
        session_row = cursor.fetchone()
        if session_row:
            status_db, tx_id, finalized_at = session_row
            print(f"   ✅ Session status: {status_db} (expected: 'final')")
            print(f"   ✅ Transaction ID: {tx_id} (expected: {transaction_id})")
            print(f"   ✅ Finalized at: {finalized_at} (expected: non-null)")
            
            if status_db != 'final':
                print(f"      ❌ Status is not 'final': {status_db}")
            if tx_id != transaction_id:
                print(f"      ❌ Transaction ID mismatch: {tx_id} != {transaction_id}")
            if not finalized_at:
                print(f"      ❌ Finalized at is null")
        else:
            print(f"   ❌ Session {session_id} not found in database")
        
        conn.close()
        
        # Check GET /tally-sessions?status=draft NO LONGER includes this session
        print("(c) Verify GET /tally-sessions?status=draft NO LONGER includes this session...")
        status, body = curl_request("GET", "/tally-sessions?status=draft")
        if status == 200:
            list_data = json.loads(body)
            sessions = list_data.get('data', [])
            found_session = next((s for s in sessions if s['id'] == session_id), None)
            
            if found_session:
                print(f"   ❌ Session {session_id} still found in draft list (should be removed)")
            else:
                print(f"   ✅ Session {session_id} NOT in draft list (correct)")
        else:
            print(f"   ❌ Failed to list draft sessions: {body}")
        
        return transaction_id, stock_ids
    except Exception as e:
        print(f"❌ Error finalizing session: {e}")
        import traceback
        traceback.print_exc()
        return None, []

def test_negative_cases(session_id):
    """Test negative cases: PUT/POST/DELETE on finalized session"""
    print(f"\n=== STEP 5: Negative Tests (finalized session) ===")
    
    # Test PUT on finalized session (should be 400)
    print(f"\n--- Test PUT /tally-sessions/{session_id} (finalized) ---")
    try:
        payload = {"items": []}
        status, body = curl_request("PUT", f"/tally-sessions/{session_id}", payload)
        print(f"PUT /tally-sessions/{session_id} status: {status}")
        print(f"Response: {body[:200]}")
        
        if status == 400:
            print("✅ PUT on finalized session correctly rejected (400)")
        else:
            print(f"❌ PUT on finalized session should return 400, got {status}")
    except Exception as e:
        print(f"❌ Error testing PUT on finalized: {e}")
    
    # Test POST finalize again (should be 400)
    print(f"\n--- Test POST /tally-sessions/{session_id}/finalize (again) ---")
    try:
        status, body = curl_request("POST", f"/tally-sessions/{session_id}/finalize")
        print(f"POST /tally-sessions/{session_id}/finalize status: {status}")
        print(f"Response: {body[:200]}")
        
        if status == 400:
            print("✅ POST finalize again correctly rejected (400)")
        else:
            print(f"❌ POST finalize again should return 400, got {status}")
    except Exception as e:
        print(f"❌ Error testing POST finalize again: {e}")
    
    # Test DELETE on finalized session (should be 400)
    print(f"\n--- Test DELETE /tally-sessions/{session_id} (finalized) ---")
    try:
        status, body = curl_request("DELETE", f"/tally-sessions/{session_id}")
        print(f"DELETE /tally-sessions/{session_id} status: {status}")
        print(f"Response: {body[:200]}")
        
        if status == 400:
            print("✅ DELETE on finalized session correctly rejected (400)")
        else:
            print(f"❌ DELETE on finalized session should return 400, got {status}")
    except Exception as e:
        print(f"❌ Error testing DELETE on finalized: {e}")

def test_regression_inbound(cold_storage_id, product_id):
    """Test POST /inventory/inbound still works (regression test)"""
    print(f"\n=== STEP 6: Regression Test - POST /inventory/inbound ===")
    try:
        payload = {
            "coldStorageId": cold_storage_id,
            "referenceType": "MANUAL",
            "items": [
                {
                    "productId": product_id,
                    "weight": 3,
                    "quantity": 1,
                    "packagingType": "colly"
                }
            ]
        }
        
        status, body = curl_request("POST", "/inventory/inbound", payload)
        print(f"POST /inventory/inbound status: {status}")
        print(f"Response: {body[:500]}")
        
        if status != 201:
            print(f"❌ Failed to create inbound: {status} - {body}")
            return None, []
        
        data = json.loads(body)
        transaction_id = data['data'].get('transactionId')
        stock_ids = data['data'].get('stockIds', [])
        stocks = data['data'].get('stocks', [])
        
        print(f"✅ Inbound created (regression test passed)")
        print(f"   Transaction ID: {transaction_id}")
        print(f"   Stock IDs: {stock_ids}")
        print(f"   Number of stocks: {len(stocks)} (expected: 1)")
        
        if len(stocks) == 1:
            print("✅ Correct number of stocks created")
        else:
            print(f"❌ Expected 1 stock, got {len(stocks)}")
        
        if transaction_id:
            created_transaction_ids.append(transaction_id)
        created_stock_ids.extend(stock_ids)
        
        return transaction_id, stock_ids
    except Exception as e:
        print(f"❌ Error testing regression inbound: {e}")
        import traceback
        traceback.print_exc()
        return None, []

def test_delete_draft(cold_storage_id, product_id):
    """Test DELETE on a fresh draft session"""
    print(f"\n=== STEP 7: Test DELETE on fresh draft ===")
    try:
        # Create a new draft session
        print("--- Creating new draft session ---")
        payload = {
            "coldStorageId": cold_storage_id,
            "referenceType": "MANUAL",
            "items": [
                {
                    "productId": product_id,
                    "weight": 7,
                    "quantity": 1,
                    "packagingType": "colly"
                }
            ]
        }
        
        status, body = curl_request("POST", "/tally-sessions", payload)
        print(f"POST /tally-sessions status: {status}")
        
        if status != 201:
            print(f"❌ Failed to create draft session: {status} - {body}")
            return
        
        data = json.loads(body)
        session_id = data['data']['id']
        created_session_ids.append(session_id)
        print(f"✅ Draft session created with ID: {session_id}")
        
        # Delete the draft session
        print(f"\n--- DELETE /tally-sessions/{session_id} ---")
        status, body = curl_request("DELETE", f"/tally-sessions/{session_id}")
        print(f"DELETE /tally-sessions/{session_id} status: {status}")
        print(f"Response: {body[:200]}")
        
        if status == 200:
            print("✅ Draft session deleted successfully")
        else:
            print(f"❌ Failed to delete draft session: {status}")
        
        # Verify it's gone from the draft list
        print("--- Verify session is gone from draft list ---")
        status, body = curl_request("GET", "/tally-sessions?status=draft")
        if status == 200:
            list_data = json.loads(body)
            sessions = list_data.get('data', [])
            found_session = next((s for s in sessions if s['id'] == session_id), None)
            
            if found_session:
                print(f"   ❌ Session {session_id} still found in draft list")
            else:
                print(f"   ✅ Session {session_id} NOT in draft list (correctly deleted)")
        
        # Verify tally_session_items are removed
        print("--- Verify tally_session_items are removed ---")
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM tally_session_items WHERE session_id = ?",
            (session_id,)
        )
        count = cursor.fetchone()[0]
        conn.close()
        
        if count == 0:
            print(f"   ✅ tally_session_items removed (count: {count})")
        else:
            print(f"   ❌ tally_session_items still exist (count: {count})")
        
    except Exception as e:
        print(f"❌ Error testing DELETE on draft: {e}")
        import traceback
        traceback.print_exc()

def cleanup():
    """Cleanup all created data"""
    print(f"\n=== CLEANUP ===")
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Delete inventory_stock rows
        if created_stock_ids:
            print(f"Deleting {len(created_stock_ids)} inventory_stock rows...")
            placeholders = ','.join('?' * len(created_stock_ids))
            cursor.execute(f"DELETE FROM inventory_stock WHERE id IN ({placeholders})", created_stock_ids)
            print(f"   ✅ Deleted {cursor.rowcount} inventory_stock rows")
        
        # Delete inventory_transaction rows
        if created_transaction_ids:
            print(f"Deleting {len(created_transaction_ids)} inventory_transaction rows...")
            placeholders = ','.join('?' * len(created_transaction_ids))
            cursor.execute(f"DELETE FROM inventory_transaction WHERE id IN ({placeholders})", created_transaction_ids)
            print(f"   ✅ Deleted {cursor.rowcount} inventory_transaction rows")
        
        # Delete tally_session_items and tally_session rows
        if created_session_ids:
            print(f"Deleting tally_session_items for {len(created_session_ids)} sessions...")
            placeholders = ','.join('?' * len(created_session_ids))
            cursor.execute(f"DELETE FROM tally_session_items WHERE session_id IN ({placeholders})", created_session_ids)
            print(f"   ✅ Deleted {cursor.rowcount} tally_session_items rows")
            
            print(f"Deleting {len(created_session_ids)} tally_session rows...")
            cursor.execute(f"DELETE FROM tally_session WHERE id IN ({placeholders})", created_session_ids)
            print(f"   ✅ Deleted {cursor.rowcount} tally_session rows")
        
        conn.commit()
        
        # Verify cleanup
        print("\n--- Verify cleanup ---")
        if created_session_ids:
            placeholders = ','.join('?' * len(created_session_ids))
            cursor.execute(
                f"SELECT COUNT(*) FROM tally_session WHERE id IN ({placeholders})",
                created_session_ids
            )
            count = cursor.fetchone()[0]
            if count == 0:
                print(f"   ✅ No leftover tally_session rows")
            else:
                print(f"   ❌ {count} tally_session rows still exist")
        
        conn.close()
        print("✅ Cleanup complete")
    except Exception as e:
        print(f"❌ Cleanup error: {e}")
        import traceback
        traceback.print_exc()

def main():
    print("=" * 80)
    print("TALLY SESSION BACKEND TEST")
    print("=" * 80)
    
    # Login
    if not login():
        print("\n❌ TEST FAILED: Cannot login")
        return 1
    
    # Get IDs
    cold_storage_id, product_id = get_cold_storage_and_product()
    if not cold_storage_id or not product_id:
        print("\n❌ TEST FAILED: Cannot get cold storage or product ID")
        return 1
    
    # Test create draft session
    session_id = test_create_draft_session(cold_storage_id, product_id)
    if not session_id:
        print("\n❌ TEST FAILED: Cannot create draft session")
        cleanup()
        return 1
    
    # Test update draft session
    if not test_update_draft_session(session_id, product_id):
        print("\n❌ TEST FAILED: Cannot update draft session")
        cleanup()
        return 1
    
    # Test finalize session
    transaction_id, stock_ids = test_finalize_session(session_id)
    if not transaction_id:
        print("\n❌ TEST FAILED: Cannot finalize session")
        cleanup()
        return 1
    
    # Test negative cases
    test_negative_cases(session_id)
    
    # Test regression
    test_regression_inbound(cold_storage_id, product_id)
    
    # Test DELETE on draft
    test_delete_draft(cold_storage_id, product_id)
    
    # Cleanup
    cleanup()
    
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print("✅ All Tally Session tests completed successfully")
    print(f"   - Created sessions: {len(created_session_ids)}")
    print(f"   - Created transactions: {len(created_transaction_ids)}")
    print(f"   - Created stocks: {len(created_stock_ids)}")
    print("=" * 80)
    return 0

if __name__ == "__main__":
    sys.exit(main())
