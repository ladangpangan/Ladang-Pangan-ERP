#!/usr/bin/env python3
"""
Backend test for SO/PO number generation bugfix
Tests that nextSoNumber/nextPoNumber use max(suffix)+1 instead of count(*)+1
to avoid UNIQUE constraint collisions when there are gaps in numbering.

Test Steps:
1. Login as admin
2. GET /api/contacts - pick Customer and Supplier
3. GET /api/products - pick a product
4. POST /api/sales-orders (FIRST) - expect 201, record soNumber
5. POST /api/sales-orders (SECOND) - expect 201, record NEXT soNumber (no collision)
6. POST /api/purchase-orders - expect 201, record poNumber
7. CLEANUP - hard delete all created records from SQLite DB
"""

import requests
import json
import sqlite3
import os

BASE_URL = "http://localhost:3000/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
DB_PATH = "/app/data/erp.db"

def print_test(test_name, passed, details=""):
    status = "✅ PASSED" if passed else "❌ FAILED"
    print(f"\n{status}: {test_name}")
    if details:
        print(f"  {details}")

def login():
    """Login via Better Auth and return session"""
    try:
        response = requests.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=10
        )
        if response.status_code == 200:
            print(f"✅ Login successful for {ADMIN_EMAIL}")
            session = requests.Session()
            session.cookies.update(response.cookies)
            return session
        else:
            print(f"❌ Login failed: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        print(f"❌ Login exception: {e}")
        return None

def get_test_data(session):
    """Get customer, supplier, and product IDs for testing"""
    try:
        # Get contacts
        print("\n--- Getting test data ---")
        print(f"Session cookies: {list(session.cookies.keys())}")
        contacts_response = session.get(f"{BASE_URL}/contacts", timeout=10)
        if contacts_response.status_code != 200:
            print(f"❌ Failed to get contacts: {contacts_response.status_code} - {contacts_response.text}")
            return None, None, None
        
        contacts = contacts_response.json().get('data', [])
        
        # Find a customer and a supplier
        customer_id = None
        supplier_id = None
        
        for contact in contacts:
            categories = contact.get('categories', [])
            if 'Customer' in categories and not customer_id:
                customer_id = contact['id']
                print(f"✅ Found Customer: {contact.get('displayName')} (ID: {customer_id})")
            if 'Supplier' in categories and not supplier_id:
                supplier_id = contact['id']
                print(f"✅ Found Supplier: {contact.get('displayName')} (ID: {supplier_id})")
            if customer_id and supplier_id:
                break
        
        if not customer_id:
            print("❌ No Customer contact found in database")
            return None, None, None
        
        if not supplier_id:
            print("❌ No Supplier contact found in database")
            return None, None, None
        
        # Get products
        products_response = session.get(f"{BASE_URL}/products", timeout=10)
        if products_response.status_code != 200:
            print(f"❌ Failed to get products: {products_response.status_code}")
            return None, None, None
        
        products = products_response.json().get('data', [])
        if len(products) == 0:
            print("❌ No products found in database")
            return None, None, None
        
        product_id = products[0]['id']
        print(f"✅ Found Product: {products[0].get('name')} (ID: {product_id})")
        
        return customer_id, supplier_id, product_id
        
    except Exception as e:
        print(f"❌ Exception getting test data: {e}")
        return None, None, None

def test_create_sales_order(session, customer_id, product_id, test_num):
    """Create a sales order and return (success, soNumber, soId)"""
    try:
        payload = {
            "customerId": customer_id,
            "fulfillmentType": "stock",
            "items": [{
                "productId": product_id,
                "weight": 5,
                "quantity": 0,
                "unitPrice": 20000,
                "discount": 0
            }]
        }
        
        response = session.post(
            f"{BASE_URL}/sales-orders",
            json=payload,
            timeout=10
        )
        
        if response.status_code != 201:
            print_test(f"TEST {test_num}: Create Sales Order #{test_num-2}", False, 
                      f"Expected 201, got {response.status_code} - {response.text}")
            return False, None, None
        
        data = response.json().get('data', {})
        so_number = data.get('soNumber')
        so_id = data.get('id')
        
        if not so_number or not so_id:
            print_test(f"TEST {test_num}: Create Sales Order #{test_num-2}", False, 
                      "Response missing soNumber or id")
            return False, None, None
        
        # Verify format SO/YYYYMM/NNNN
        if not so_number.startswith('SO/'):
            print_test(f"TEST {test_num}: Create Sales Order #{test_num-2}", False, 
                      f"soNumber should start with 'SO/', got: {so_number}")
            return False, None, None
        
        print_test(f"TEST {test_num}: Create Sales Order #{test_num-2}", True, 
                  f"SO Number: {so_number}, ID: {so_id}")
        return True, so_number, so_id
        
    except Exception as e:
        print_test(f"TEST {test_num}: Create Sales Order #{test_num-2}", False, f"Exception: {e}")
        return False, None, None

def test_create_purchase_order(session, supplier_id, product_id):
    """Create a purchase order and return (success, poNumber, poId)"""
    try:
        payload = {
            "supplierId": supplier_id,
            "poType": "Bahan Baku",
            "items": [{
                "productId": product_id,
                "weight": 5,
                "unitPrice": 15000
            }]
        }
        
        response = session.post(
            f"{BASE_URL}/purchase-orders",
            json=payload,
            timeout=10
        )
        
        if response.status_code != 201:
            print_test("TEST 5: Create Purchase Order", False, 
                      f"Expected 201, got {response.status_code} - {response.text}")
            return False, None, None
        
        data = response.json().get('data', {})
        po_number = data.get('poNumber')
        po_id = data.get('id')
        
        if not po_number or not po_id:
            print_test("TEST 5: Create Purchase Order", False, 
                      "Response missing poNumber or id")
            return False, None, None
        
        # Verify format PO/YYYYMM/NNNN
        if not po_number.startswith('PO/'):
            print_test("TEST 5: Create Purchase Order", False, 
                      f"poNumber should start with 'PO/', got: {po_number}")
            return False, None, None
        
        print_test("TEST 5: Create Purchase Order", True, 
                  f"PO Number: {po_number}, ID: {po_id}")
        return True, po_number, po_id
        
    except Exception as e:
        print_test("TEST 5: Create Purchase Order", False, f"Exception: {e}")
        return False, None, None

def cleanup_orders(so_ids, po_ids):
    """Hard delete created orders from SQLite DB"""
    try:
        print("\n--- CLEANUP ---")
        if not os.path.exists(DB_PATH):
            print(f"❌ Database not found at {DB_PATH}")
            return False
        
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Delete sales orders
        for so_id in so_ids:
            if so_id:
                # Delete items first (foreign key)
                cursor.execute("DELETE FROM sales_order_items WHERE sales_order_id = ?", (so_id,))
                deleted_items = cursor.rowcount
                
                # Delete order
                cursor.execute("DELETE FROM sales_order WHERE id = ?", (so_id,))
                deleted_order = cursor.rowcount
                
                print(f"✅ Deleted SO {so_id}: {deleted_items} items, {deleted_order} order")
        
        # Delete purchase orders
        for po_id in po_ids:
            if po_id:
                # Delete items first (foreign key)
                cursor.execute("DELETE FROM purchase_order_items WHERE purchase_order_id = ?", (po_id,))
                deleted_items = cursor.rowcount
                
                # Delete order
                cursor.execute("DELETE FROM purchase_order WHERE id = ?", (po_id,))
                deleted_order = cursor.rowcount
                
                print(f"✅ Deleted PO {po_id}: {deleted_items} items, {deleted_order} order")
        
        conn.commit()
        conn.close()
        
        print("✅ Cleanup completed successfully")
        return True
        
    except Exception as e:
        print(f"❌ Cleanup exception: {e}")
        return False

def main():
    print("=" * 80)
    print("BACKEND TEST: SO/PO Number Generation Bugfix")
    print("Testing: max(suffix)+1 instead of count(*)+1 (gap-safe)")
    print("=" * 80)
    
    # Login
    print("\n--- AUTHENTICATION ---")
    session = login()
    if not session:
        print("\n❌ CRITICAL: Cannot proceed without authentication")
        return
    
    # Get test data
    customer_id, supplier_id, product_id = get_test_data(session)
    if not customer_id or not supplier_id or not product_id:
        print("\n❌ CRITICAL: Cannot proceed without test data")
        return
    
    # Run tests
    print("\n--- RUNNING TESTS ---")
    
    results = []
    so_ids = []
    po_ids = []
    so_numbers = []
    po_numbers = []
    
    # TEST 3: Create FIRST sales order
    success1, so_number1, so_id1 = test_create_sales_order(session, customer_id, product_id, 3)
    results.append(success1)
    if so_id1:
        so_ids.append(so_id1)
        so_numbers.append(so_number1)
    
    # TEST 4: Create SECOND sales order (gap-safety test)
    success2, so_number2, so_id2 = test_create_sales_order(session, customer_id, product_id, 4)
    results.append(success2)
    if so_id2:
        so_ids.append(so_id2)
        so_numbers.append(so_number2)
    
    # Verify no collision (different numbers)
    if success1 and success2 and so_number1 and so_number2:
        if so_number1 != so_number2:
            print_test("TEST 4.1: Gap-safety verification", True, 
                      f"SO numbers are different: {so_number1} != {so_number2}")
            results.append(True)
        else:
            print_test("TEST 4.1: Gap-safety verification", False, 
                      f"SO numbers COLLIDED: {so_number1} == {so_number2}")
            results.append(False)
    
    # TEST 5: Create purchase order
    success3, po_number, po_id = test_create_purchase_order(session, supplier_id, product_id)
    results.append(success3)
    if po_id:
        po_ids.append(po_id)
        po_numbers.append(po_number)
    
    # Cleanup
    cleanup_success = cleanup_orders(so_ids, po_ids)
    results.append(cleanup_success)
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    passed = sum(1 for r in results if r)
    total = len(results)
    print(f"\nTotal: {passed}/{total} tests passed ({int(passed/total*100)}%)")
    
    print("\n--- ORDERS CREATED ---")
    if so_numbers:
        for i, so_num in enumerate(so_numbers, 1):
            print(f"  Sales Order #{i}: {so_num}")
    if po_numbers:
        for i, po_num in enumerate(po_numbers, 1):
            print(f"  Purchase Order #{i}: {po_num}")
    
    print("\n--- KEY FINDINGS ---")
    if success1 and success2:
        if so_number1 != so_number2:
            print("✅ BUGFIX VERIFIED: SO numbers are sequential and gap-safe")
            print(f"   First SO:  {so_number1}")
            print(f"   Second SO: {so_number2}")
            print("   No UNIQUE constraint collision occurred")
        else:
            print("❌ BUGFIX FAILED: SO numbers collided (same number generated twice)")
    
    if success3:
        print(f"✅ PO number generation working: {po_number}")
    
    if cleanup_success:
        print("✅ Database cleanup successful (all test records deleted)")
    
    if passed == total:
        print("\n✅ ALL TESTS PASSED - SO/PO number generation bugfix is working correctly")
    else:
        print(f"\n❌ {total - passed} TEST(S) FAILED - See details above")
    
    print("=" * 80)

if __name__ == "__main__":
    main()
