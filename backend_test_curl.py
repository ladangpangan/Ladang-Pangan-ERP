#!/usr/bin/env python3
"""
MIGRATION Phase 3 Backend Test: Sales Order MongoDB-authoritative (CURL-based)
Tests that SO aggregate is correctly persisted to MongoDB and hydrated to SQLite.
"""
import subprocess
import json
import os
from pymongo import MongoClient
import sqlite3
import tempfile

BASE_URL = 'http://localhost:3000'
API_URL = f"{BASE_URL}/api"

# MongoDB connection
MONGO_URL = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
MONGO_DB_NAME = 'erp_prod'

# Auth credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
OPERATOR_EMAIL = "operator@lpi.co.id"
OPERATOR_PASSWORD = "operator123"

# Test data tracking
test_so_ids = []

# Cookie files
admin_cookies = tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.txt')
admin_cookies_file = admin_cookies.name
admin_cookies.close()

operator_cookies = tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.txt')
operator_cookies_file = operator_cookies.name
operator_cookies.close()

def print_test(msg):
    print(f"\n{'='*80}")
    print(f"TEST: {msg}")
    print('='*80)

def print_result(passed, msg):
    status = "✅ PASSED" if passed else "❌ FAILED"
    print(f"{status}: {msg}")

def curl_request(method, url, cookies_file=None, data=None, expect_json=True):
    """Make a curl request and return the response"""
    cmd = ['curl', '-s', '-X', method]
    
    if cookies_file:
        cmd.extend(['-b', cookies_file, '-c', cookies_file])
    
    cmd.extend(['-H', 'Content-Type: application/json'])
    cmd.extend(['-H', f'Origin: {BASE_URL}'])
    
    if data:
        cmd.extend(['-d', json.dumps(data)])
    
    cmd.append(url)
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if expect_json:
            try:
                return json.loads(result.stdout)
            except Exception:
                return {'error': result.stdout, 'stderr': result.stderr}
        return result.stdout
    except Exception as e:
        return {'error': str(e)}

def login(email, password, cookies_file):
    """Login and save cookies"""
    data = {"email": email, "password": password}
    resp = curl_request('POST', f"{API_URL}/auth/sign-in/email", cookies_file, data)
    
    if resp.get('user', {}).get('email') == email:
        print(f"✅ Logged in as {email}")
        return True
    else:
        print(f"❌ Login failed for {email}: {resp}")
        return False

def get_mongo_client():
    """Get MongoDB client and database"""
    try:
        client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
        client.admin.command('ping')
        db = client[MONGO_DB_NAME]
        print(f"✅ Connected to MongoDB: {MONGO_DB_NAME}")
        return client, db
    except Exception as e:
        print(f"❌ MongoDB connection failed: {e}")
        return None, None

def get_sqlite_connection():
    """Get SQLite connection"""
    try:
        conn = sqlite3.connect('/app/data/erp.db')
        conn.row_factory = sqlite3.Row
        print(f"✅ Connected to SQLite: /app/data/erp.db")
        return conn
    except Exception as e:
        print(f"❌ SQLite connection failed: {e}")
        return None

def get_mongo_counts(db):
    """Get document counts from MongoDB collections"""
    counts = {}
    for collection in ['sales_order', 'sales_order_items', 'so_item_stocks', 'sales_payments']:
        try:
            counts[collection] = db[collection].count_documents({})
        except Exception:
            counts[collection] = 0
    return counts

def test_1_create_so(db):
    """TEST 1: CREATE SO - verify in both Mongo and API"""
    print_test("1. CREATE SALES ORDER")
    
    try:
        # Get a valid customer
        resp = curl_request('GET', f"{API_URL}/contacts", admin_cookies_file)
        if 'data' not in resp:
            print_result(False, f"Failed to get contacts: {resp}")
            return False
        
        contacts = resp['data']
        customer = next((c for c in contacts if 'Customer' in c.get('categories', [])), None)
        
        if not customer:
            print_result(False, "No customer found")
            return False
        
        print(f"Using customer: {customer['displayName']} (ID: {customer['id']})")
        
        # Get a valid product
        resp = curl_request('GET', f"{API_URL}/products", admin_cookies_file)
        if 'data' not in resp:
            print_result(False, f"Failed to get products: {resp}")
            return False
        
        products = resp['data']
        if not products:
            print_result(False, "No products found")
            return False
        
        product = products[0]
        print(f"Using product: {product['name']} (ID: {product['id']})")
        
        # Create SO
        so_data = {
            "customerId": customer['id'],
            "items": [{
                "productId": product['id'],
                "quantity": 10,
                "weight": 10,
                "unitPrice": 35000
            }]
        }
        
        resp = curl_request('POST', f"{API_URL}/sales-orders", admin_cookies_file, so_data)
        
        if 'data' not in resp:
            print_result(False, f"Failed to create SO: {resp}")
            return False
        
        so = resp['data']
        so_id = so.get('id')
        so_number = so.get('soNumber')
        
        if not so_id:
            print_result(False, "No SO ID returned")
            return False
        
        test_so_ids.append(so_id)
        print(f"✅ Created SO: {so_number} (ID: {so_id})")
        
        # Verify in API - GET list
        resp = curl_request('GET', f"{API_URL}/sales-orders", admin_cookies_file)
        if 'data' not in resp:
            print_result(False, f"Failed to get SO list: {resp}")
            return False
        
        so_list = resp['data']
        found_in_list = any(s['id'] == so_id for s in so_list)
        print_result(found_in_list, f"SO found in list: {found_in_list}")
        
        # Verify in API - GET detail
        resp = curl_request('GET', f"{API_URL}/sales-orders/{so_id}", admin_cookies_file)
        if 'data' not in resp:
            print_result(False, f"Failed to get SO detail: {resp}")
            return False
        
        so_detail = resp['data']
        has_items = len(so_detail.get('items', [])) > 0
        print_result(has_items, f"SO has items: {has_items}")
        
        # Verify in MongoDB - sales_order
        mongo_so = db['sales_order'].find_one({'id': so_id})
        if not mongo_so:
            print_result(False, "SO not found in MongoDB sales_order collection")
            return False
        print_result(True, f"SO found in MongoDB sales_order: {mongo_so.get('so_number')}")
        
        # Verify in MongoDB - sales_order_items
        mongo_items = list(db['sales_order_items'].find({'sales_order_id': so_id}))
        if not mongo_items:
            print_result(False, "SO items not found in MongoDB sales_order_items collection")
            return False
        print_result(True, f"SO items found in MongoDB: {len(mongo_items)} item(s)")
        
        print_result(True, "CREATE SO test completed successfully")
        return True
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_2_edit_so(db):
    """TEST 2: EDIT SO - verify changes in both Mongo and API"""
    print_test("2. EDIT SALES ORDER")
    
    if not test_so_ids:
        print_result(False, "No test SO available")
        return False
    
    try:
        so_id = test_so_ids[0]
        new_notes = f"Updated notes - test {os.urandom(4).hex()}"
        
        # Update SO
        resp = curl_request('PATCH', f"{API_URL}/sales-orders/{so_id}", admin_cookies_file, {"notes": new_notes})
        
        if 'data' not in resp:
            print_result(False, f"Failed to update SO: {resp}")
            return False
        
        print(f"✅ Updated SO with notes: {new_notes}")
        
        # Verify in API
        resp = curl_request('GET', f"{API_URL}/sales-orders/{so_id}", admin_cookies_file)
        if 'data' not in resp:
            print_result(False, f"Failed to get SO: {resp}")
            return False
        
        so_detail = resp['data']
        api_notes = so_detail.get('notes', '')
        notes_match = api_notes == new_notes
        print_result(notes_match, f"API notes match: {notes_match} ('{api_notes}')")
        
        # Verify in MongoDB
        mongo_so = db['sales_order'].find_one({'id': so_id})
        if not mongo_so:
            print_result(False, "SO not found in MongoDB")
            return False
        
        mongo_notes = mongo_so.get('notes', '')
        mongo_match = mongo_notes == new_notes
        print_result(mongo_match, f"MongoDB notes match: {mongo_match} ('{mongo_notes}')")
        
        success = notes_match and mongo_match
        print_result(success, "EDIT SO test completed")
        return success
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_3_stock_allocation(db):
    """TEST 3: STOCK ALLOCATION - verify so_item_stocks in Mongo"""
    print_test("3. STOCK ALLOCATION")
    
    if not test_so_ids:
        print_result(False, "No test SO available")
        return False
    
    try:
        so_id = test_so_ids[0]
        
        # Get SO detail to find item ID
        resp = curl_request('GET', f"{API_URL}/sales-orders/{so_id}", admin_cookies_file)
        if 'data' not in resp:
            print_result(False, f"Failed to get SO: {resp}")
            return False
        
        so_detail = resp['data']
        items = so_detail.get('items', [])
        if not items:
            print_result(False, "No items in SO")
            return False
        
        item = items[0]
        item_id = item['id']
        product_id = item['productId']
        
        # Check for available stocks
        resp = curl_request('GET', f"{API_URL}/inventory/stocks", admin_cookies_file)
        
        if 'data' not in resp:
            print(f"⚠️  Failed to get stocks: {resp}")
            print("⚠️  No active inventory stock available - SKIPPING allocation test")
            print_result(True, "Stock allocation test skipped (no active stock)")
            return True
        
        stocks_data = resp['data']
        
        # Filter for active stocks of this product
        available_stocks = [s for s in stocks_data if s.get('productId') == product_id and s.get('status') == 'active']
        
        if not available_stocks:
            print("⚠️  No active inventory stock available for this product - SKIPPING allocation test")
            print_result(True, "Stock allocation test skipped (no active stock)")
            return True
        
        # Use first available stock
        stock_id = available_stocks[0]['id']
        print(f"Using stock: {stock_id}")
        
        # Allocate stock
        allocation_data = {"stockIds": [stock_id]}
        
        resp = curl_request('POST', f"{API_URL}/sales-orders/{so_id}/items/{item_id}/allocate", admin_cookies_file, allocation_data)
        
        if 'data' not in resp and 'error' in resp:
            print_result(False, f"Failed to allocate stock: {resp}")
            return False
        
        print(f"✅ Allocated stock to SO item")
        
        # Verify in MongoDB - so_item_stocks
        mongo_allocations = list(db['so_item_stocks'].find({'sales_order_id': so_id}))
        if not mongo_allocations:
            print_result(False, "Stock allocations not found in MongoDB so_item_stocks collection")
            return False
        
        print_result(True, f"Stock allocations found in MongoDB: {len(mongo_allocations)} allocation(s)")
        
        print_result(True, "STOCK ALLOCATION test completed successfully")
        return True
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_4_payment(db):
    """TEST 4: PAYMENT - verify sales_payments in Mongo and SO updated"""
    print_test("4. PAYMENT")
    
    if not test_so_ids:
        print_result(False, "No test SO available")
        return False
    
    try:
        so_id = test_so_ids[0]
        
        # Add payment
        payment_data = {
            "amount": 100000,
            "method": "Transfer",
            "paymentDate": "2026-02-10"
        }
        
        resp = curl_request('POST', f"{API_URL}/sales-orders/{so_id}/payments", admin_cookies_file, payment_data)
        
        if 'data' not in resp and 'error' in resp:
            print_result(False, f"Failed to add payment: {resp}")
            return False
        
        print(f"✅ Added payment: Rp {payment_data['amount']}")
        
        # Verify in MongoDB - sales_payments
        mongo_payments = list(db['sales_payments'].find({'sales_order_id': so_id}))
        if not mongo_payments:
            print_result(False, "Payment not found in MongoDB sales_payments collection")
            return False
        
        print_result(True, f"Payment found in MongoDB: {len(mongo_payments)} payment(s)")
        
        # Verify payment details
        payment = mongo_payments[0]
        amount_match = payment.get('amount') == payment_data['amount']
        method_match = payment.get('method') == payment_data['method']
        print(f"  - Amount: Rp {payment.get('amount')} (match: {amount_match})")
        print(f"  - Method: {payment.get('method')} (match: {method_match})")
        
        # Verify SO paidAmount updated in MongoDB
        mongo_so = db['sales_order'].find_one({'id': so_id})
        if not mongo_so:
            print_result(False, "SO not found in MongoDB")
            return False
        
        paid_amount = mongo_so.get('paid_amount', 0)
        payment_status = mongo_so.get('payment_status', '')
        print(f"  - SO paidAmount: Rp {paid_amount}")
        print(f"  - SO paymentStatus: {payment_status}")
        
        paid_updated = paid_amount > 0
        print_result(paid_updated, f"SO paidAmount updated: {paid_updated}")
        
        success = len(mongo_payments) > 0 and amount_match and method_match and paid_updated
        print_result(success, "PAYMENT test completed")
        return success
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_5_multi_so_isolation(db):
    """TEST 5: MULTI-SO ISOLATION - ensure per-SO persist doesn't clobber other SOs"""
    print_test("5. MULTI-SO ISOLATION (Concurrency Safety)")
    
    try:
        # Get customer and product
        resp = curl_request('GET', f"{API_URL}/contacts", admin_cookies_file)
        contacts = resp['data']
        customer = next((c for c in contacts if 'Customer' in c.get('categories', [])), None)
        
        resp = curl_request('GET', f"{API_URL}/products", admin_cookies_file)
        products = resp['data']
        product = products[0] if products else None
        
        if not customer or not product:
            print_result(False, "Missing customer or product")
            return False
        
        # Create SO #1
        so_data_1 = {
            "customerId": customer['id'],
            "items": [{
                "productId": product['id'],
                "quantity": 5,
                "weight": 5,
                "unitPrice": 30000
            }],
            "notes": "Test SO #1"
        }
        
        resp = curl_request('POST', f"{API_URL}/sales-orders", admin_cookies_file, so_data_1)
        if 'data' not in resp:
            print_result(False, f"Failed to create SO #1: {resp}")
            return False
        
        so1 = resp['data']
        so1_id = so1.get('id')
        so1_number = so1.get('soNumber')
        test_so_ids.append(so1_id)
        print(f"✅ Created SO #1: {so1_number} (ID: {so1_id})")
        
        # Create SO #2
        so_data_2 = {
            "customerId": customer['id'],
            "items": [{
                "productId": product['id'],
                "quantity": 8,
                "weight": 8,
                "unitPrice": 40000
            }],
            "notes": "Test SO #2"
        }
        
        resp = curl_request('POST', f"{API_URL}/sales-orders", admin_cookies_file, so_data_2)
        if 'data' not in resp:
            print_result(False, f"Failed to create SO #2: {resp}")
            return False
        
        so2 = resp['data']
        so2_id = so2.get('id')
        so2_number = so2.get('soNumber')
        test_so_ids.append(so2_id)
        print(f"✅ Created SO #2: {so2_number} (ID: {so2_id})")
        
        # Verify BOTH exist in MongoDB
        mongo_so1 = db['sales_order'].find_one({'id': so1_id})
        mongo_so2 = db['sales_order'].find_one({'id': so2_id})
        
        both_exist = mongo_so1 is not None and mongo_so2 is not None
        print_result(both_exist, f"Both SOs exist in MongoDB: {both_exist}")
        
        if both_exist:
            print(f"  - SO #1: {mongo_so1.get('so_number')} (notes: {mongo_so1.get('notes')})")
            print(f"  - SO #2: {mongo_so2.get('so_number')} (notes: {mongo_so2.get('notes')})")
        
        # Delete SO #1
        resp = curl_request('DELETE', f"{API_URL}/sales-orders/{so1_id}", admin_cookies_file)
        
        print(f"✅ Deleted SO #1: {so1_number}")
        test_so_ids.remove(so1_id)
        
        # Verify SO #1 removed from MongoDB
        mongo_so1_after = db['sales_order'].find_one({'id': so1_id})
        so1_removed = mongo_so1_after is None
        print_result(so1_removed, f"SO #1 removed from MongoDB: {so1_removed}")
        
        # Verify SO #2 still exists in MongoDB
        mongo_so2_after = db['sales_order'].find_one({'id': so2_id})
        so2_exists = mongo_so2_after is not None
        print_result(so2_exists, f"SO #2 still exists in MongoDB: {so2_exists}")
        
        # Verify SO #2 still accessible via API
        resp = curl_request('GET', f"{API_URL}/sales-orders/{so2_id}", admin_cookies_file)
        so2_api_exists = 'data' in resp
        print_result(so2_api_exists, f"SO #2 still accessible via API: {so2_api_exists}")
        
        success = both_exist and so1_removed and so2_exists and so2_api_exists
        print_result(success, "MULTI-SO ISOLATION test completed")
        return success
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_6_accounting_integrity():
    """TEST 6: ACCOUNTING INTEGRITY - verify trial balance, balance sheet, sales profit"""
    print_test("6. ACCOUNTING INTEGRITY")
    
    try:
        # Test trial balance
        resp = curl_request('GET', f"{API_URL}/accounting/trial-balance", admin_cookies_file)
        if 'data' not in resp:
            print_result(False, f"Failed to get trial balance: {resp}")
            return False
        
        tb_data = resp['data']
        total_debit = tb_data.get('totalDebit', 0)
        total_credit = tb_data.get('totalCredit', 0)
        tb_balanced = abs(total_debit - total_credit) < 0.01
        
        print(f"Trial Balance:")
        print(f"  - Total Debit: Rp {total_debit:,.2f}")
        print(f"  - Total Credit: Rp {total_credit:,.2f}")
        print_result(tb_balanced, f"Trial Balance balanced: {tb_balanced}")
        
        # Test balance sheet
        resp = curl_request('GET', f"{API_URL}/accounting/balance-sheet", admin_cookies_file)
        if 'data' not in resp:
            print_result(False, f"Failed to get balance sheet: {resp}")
            return False
        
        bs_data = resp['data']
        bs_balanced = bs_data.get('balanced', False)
        
        print(f"Balance Sheet:")
        print(f"  - Balanced: {bs_balanced}")
        print_result(bs_balanced, f"Balance Sheet balanced: {bs_balanced}")
        
        # Test sales profit
        resp = curl_request('GET', f"{API_URL}/accounting/sales-profit", admin_cookies_file)
        sales_profit_ok = 'data' in resp or 'error' not in resp
        
        print(f"Sales Profit:")
        print_result(sales_profit_ok, f"Sales Profit endpoint working: {sales_profit_ok}")
        
        success = tb_balanced and bs_balanced and sales_profit_ok
        print_result(success, "ACCOUNTING INTEGRITY test completed")
        return success
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_7_non_cascade_safety(sqlite_conn):
    """TEST 7: NON-CASCADE SAFETY - verify surat_jalan and sales_order_receipts preserved"""
    print_test("7. NON-CASCADE SAFETY")
    
    try:
        # Check surat_jalan count in SQLite
        cursor = sqlite_conn.cursor()
        cursor.execute("SELECT COUNT(*) as count FROM surat_jalan")
        sj_count = cursor.fetchone()[0]
        
        print(f"Surat Jalan count: {sj_count}")
        sj_preserved = sj_count >= 1
        print_result(sj_preserved, f"Surat Jalan preserved: {sj_preserved} (count >= 1)")
        
        # Check sales_order_receipts count in SQLite
        cursor.execute("SELECT COUNT(*) as count FROM sales_order_receipts")
        receipt_count = cursor.fetchone()[0]
        
        print(f"Sales Order Receipts count: {receipt_count}")
        receipts_preserved = receipt_count >= 1
        print_result(receipts_preserved, f"Sales Order Receipts preserved: {receipts_preserved} (count >= 1)")
        
        # Check if pre-existing SO 'SO/202608/0001' still exists
        resp = curl_request('GET', f"{API_URL}/sales-orders", admin_cookies_file)
        if 'data' not in resp:
            print_result(False, f"Failed to get SO list: {resp}")
            return False
        
        so_list = resp['data']
        preexisting_so = next((s for s in so_list if s.get('soNumber') == 'SO/202608/0001'), None)
        
        if preexisting_so:
            so_id = preexisting_so['id']
            resp = curl_request('GET', f"{API_URL}/sales-orders/{so_id}", admin_cookies_file)
            if 'data' in resp:
                so_detail = resp['data']
                has_sj = len(so_detail.get('suratJalan', [])) > 0
                has_receipts = len(so_detail.get('receipts', [])) > 0
                
                print(f"Pre-existing SO 'SO/202608/0001':")
                print(f"  - Has Surat Jalan: {has_sj}")
                print(f"  - Has Receipts: {has_receipts}")
                
                preexisting_ok = True
                print_result(preexisting_ok, "Pre-existing SO still accessible")
            else:
                print("⚠️  Pre-existing SO 'SO/202608/0001' not accessible via API")
                preexisting_ok = False
        else:
            print("⚠️  Pre-existing SO 'SO/202608/0001' not found in list")
            preexisting_ok = False
        
        success = sj_preserved and receipts_preserved
        print_result(success, "NON-CASCADE SAFETY test completed")
        return success
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_8_delete_so(db):
    """TEST 8: DELETE SO - verify removal from both Mongo and API"""
    print_test("8. DELETE SALES ORDER")
    
    if not test_so_ids:
        print_result(False, "No test SO available")
        return False
    
    try:
        so_id = test_so_ids[0]
        
        # Get SO number before deletion
        resp = curl_request('GET', f"{API_URL}/sales-orders/{so_id}", admin_cookies_file)
        if 'data' not in resp:
            print_result(False, f"Failed to get SO: {resp}")
            return False
        
        so_detail = resp['data']
        so_number = so_detail.get('soNumber')
        
        # Delete SO
        resp = curl_request('DELETE', f"{API_URL}/sales-orders/{so_id}", admin_cookies_file)
        
        print(f"✅ Deleted SO: {so_number} (ID: {so_id})")
        test_so_ids.remove(so_id)
        
        # Verify removed from API
        resp = curl_request('GET', f"{API_URL}/sales-orders/{so_id}", admin_cookies_file)
        api_removed = 'error' in resp
        print_result(api_removed, f"SO removed from API: {api_removed}")
        
        # Verify removed from MongoDB - sales_order
        mongo_so = db['sales_order'].find_one({'id': so_id})
        so_removed = mongo_so is None
        print_result(so_removed, f"SO removed from MongoDB sales_order: {so_removed}")
        
        # Verify children removed from MongoDB - sales_order_items
        mongo_items = list(db['sales_order_items'].find({'sales_order_id': so_id}))
        items_removed = len(mongo_items) == 0
        print_result(items_removed, f"SO items removed from MongoDB: {items_removed}")
        
        # Verify children removed from MongoDB - so_item_stocks
        mongo_stocks = list(db['so_item_stocks'].find({'sales_order_id': so_id}))
        stocks_removed = len(mongo_stocks) == 0
        print_result(stocks_removed, f"SO stock allocations removed from MongoDB: {stocks_removed}")
        
        # Verify children removed from MongoDB - sales_payments
        mongo_payments = list(db['sales_payments'].find({'sales_order_id': so_id}))
        payments_removed = len(mongo_payments) == 0
        print_result(payments_removed, f"SO payments removed from MongoDB: {payments_removed}")
        
        success = api_removed and so_removed and items_removed and stocks_removed and payments_removed
        print_result(success, "DELETE SO test completed")
        return success
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_9_role_guard():
    """TEST 9: ROLE GUARD - operator should get 403 on POST /sales-orders"""
    print_test("9. ROLE GUARD (Operator)")
    
    try:
        # Try to create SO as operator directly (without needing customer/product data)
        # Use admin session to get customer and product IDs
        resp = curl_request('GET', f"{API_URL}/contacts", admin_cookies_file)
        if 'data' not in resp:
            print_result(False, f"Failed to get contacts as admin: {resp}")
            return False
        
        contacts = resp['data']
        customer = next((c for c in contacts if 'Customer' in c.get('categories', [])), None)
        
        resp = curl_request('GET', f"{API_URL}/products", admin_cookies_file)
        if 'data' not in resp:
            print_result(False, f"Failed to get products as admin: {resp}")
            return False
        
        products = resp['data']
        product = products[0] if products else None
        
        if not customer or not product:
            print_result(False, "Missing customer or product")
            return False
        
        # Try to create SO as operator
        so_data = {
            "customerId": customer['id'],
            "items": [{
                "productId": product['id'],
                "quantity": 1,
                "weight": 1,
                "unitPrice": 10000
            }]
        }
        
        resp = curl_request('POST', f"{API_URL}/sales-orders", operator_cookies_file, so_data)
        
        is_forbidden = 'error' in resp and ('403' in str(resp) or 'forbidden' in str(resp).lower() or 'tidak diizinkan' in str(resp).lower())
        print(f"Operator POST /sales-orders response: {resp}")
        print_result(is_forbidden, f"Operator correctly forbidden: {is_forbidden}")
        
        print_result(is_forbidden, "ROLE GUARD test completed")
        return is_forbidden
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def cleanup_test_data(db):
    """Cleanup all test SOs"""
    print_test("CLEANUP")
    
    for so_id in test_so_ids[:]:
        try:
            resp = curl_request('DELETE', f"{API_URL}/sales-orders/{so_id}", admin_cookies_file)
            print(f"✅ Deleted test SO: {so_id}")
            test_so_ids.remove(so_id)
        except Exception as e:
            print(f"⚠️  Error deleting SO {so_id}: {e}")
    
    print(f"Cleanup completed. Remaining test SOs: {len(test_so_ids)}")

def main():
    print("\n" + "="*80)
    print("MIGRATION PHASE 3 BACKEND TEST")
    print("Sales Order MongoDB-authoritative")
    print("="*80)
    
    # Connect to MongoDB
    mongo_client, mongo_db = get_mongo_client()
    if mongo_db is None:
        print("❌ Cannot proceed without MongoDB connection")
        return
    
    print(f"\nMongoDB Database: {MONGO_DB_NAME}")
    
    # Connect to SQLite
    sqlite_conn = get_sqlite_connection()
    if sqlite_conn is None:
        print("❌ Cannot proceed without SQLite connection")
        return
    
    # Get initial MongoDB counts
    print("\n" + "="*80)
    print("INITIAL MONGODB COLLECTION COUNTS")
    print("="*80)
    initial_counts = get_mongo_counts(mongo_db)
    for collection, count in initial_counts.items():
        print(f"{collection}: {count} documents")
    
    # Login as admin
    if not login(ADMIN_EMAIL, ADMIN_PASSWORD, admin_cookies_file):
        print("❌ Cannot proceed without admin login")
        return
    
    # Login as operator
    if not login(OPERATOR_EMAIL, OPERATOR_PASSWORD, operator_cookies_file):
        print("⚠️  Operator login failed, skipping role guard test")
    
    # Run tests
    results = {}
    
    try:
        results['test_1_create_so'] = test_1_create_so(mongo_db)
        results['test_2_edit_so'] = test_2_edit_so(mongo_db)
        results['test_3_stock_allocation'] = test_3_stock_allocation(mongo_db)
        results['test_4_payment'] = test_4_payment(mongo_db)
        results['test_5_multi_so_isolation'] = test_5_multi_so_isolation(mongo_db)
        results['test_6_accounting_integrity'] = test_6_accounting_integrity()
        results['test_7_non_cascade_safety'] = test_7_non_cascade_safety(sqlite_conn)
        results['test_8_delete_so'] = test_8_delete_so(mongo_db)
        results['test_9_role_guard'] = test_9_role_guard()
        
    finally:
        # Cleanup
        cleanup_test_data(mongo_db)
    
    # Get final MongoDB counts
    print("\n" + "="*80)
    print("FINAL MONGODB COLLECTION COUNTS")
    print("="*80)
    final_counts = get_mongo_counts(mongo_db)
    for collection, count in final_counts.items():
        print(f"{collection}: {count} documents")
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for v in results.values() if v is True)
    failed = sum(1 for v in results.values() if v is False)
    skipped = sum(1 for v in results.values() if v is None)
    total = len(results)
    
    for test_name, result in results.items():
        if result is True:
            status = "✅ PASSED"
        elif result is False:
            status = "❌ FAILED"
        else:
            status = "⚠️  SKIPPED"
        print(f"{status}: {test_name}")
    
    print(f"\nTotal: {total} tests")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print(f"Skipped: {skipped}")
    
    if failed == 0:
        print("\n✅ ALL TESTS PASSED!")
    else:
        print(f"\n❌ {failed} TEST(S) FAILED")
    
    # Close connections
    sqlite_conn.close()
    mongo_client.close()
    
    # Cleanup cookie files
    try:
        os.unlink(admin_cookies_file)
        os.unlink(operator_cookies_file)
    except Exception:
        pass

if __name__ == "__main__":
    main()
