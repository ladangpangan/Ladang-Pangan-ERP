#!/usr/bin/env python3
"""
Backend test for interactive-order-builder feature
Tests:
1. GET /api/ai/options (authenticated) - expect ok:true with arrays
2. GET /api/ai/options (unauthenticated) - expect 401
3. POST /api/ai/chat "Saya mau membuat sales order baru" - expect uiComponents with order_builder
4. POST /api/ai/chat "Buat purchase order" - expect uiComponents with order_builder
5. Verify existing endpoints: POST /api/sales-orders and POST /api/purchase-orders
"""

import requests
import json
import time

BASE_URL = "http://localhost:3000/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

def print_test(test_name, passed, details=""):
    status = "✅ PASSED" if passed else "❌ FAILED"
    print(f"\n{status}: {test_name}")
    if details:
        print(f"  Details: {details}")

def login(email, password):
    """Login via Better Auth and return session"""
    try:
        response = requests.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": email, "password": password},
            timeout=10
        )
        if response.status_code == 200:
            print(f"✅ Login successful for {email}")
            print(f"  Cookies received: {list(response.cookies.keys())}")
            # Create a session object to persist cookies
            session = requests.Session()
            session.cookies.update(response.cookies)
            return session
        else:
            print(f"❌ Login failed: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        print(f"❌ Login exception: {e}")
        return None

def test_ai_options_authenticated(session):
    """Test 1: GET /api/ai/options with authentication"""
    try:
        response = session.get(f"{BASE_URL}/ai/options", timeout=10)
        
        if response.status_code != 200:
            print_test("TEST 1: GET /api/ai/options (authenticated)", False, 
                      f"Expected 200, got {response.status_code}")
            return False
        
        data = response.json()
        
        # Check ok:true
        if not data.get('ok'):
            print_test("TEST 1: GET /api/ai/options (authenticated)", False, 
                      "Response missing 'ok: true'")
            return False
        
        # Check required arrays exist
        required_arrays = ['customers', 'suppliers', 'dropshippers', 'agents', 'products', 'poTypes', 'fulfillmentTypes']
        for arr in required_arrays:
            if arr not in data:
                print_test("TEST 1: GET /api/ai/options (authenticated)", False, 
                          f"Missing required array: {arr}")
                return False
        
        # Report lengths
        details = f"customers: {len(data['customers'])}, suppliers: {len(data['suppliers'])}, "
        details += f"products: {len(data['products'])}, poTypes: {len(data['poTypes'])}, "
        details += f"fulfillmentTypes: {len(data['fulfillmentTypes'])}"
        
        # Note if arrays are empty (not necessarily a failure)
        notes = []
        if len(data['customers']) == 0:
            notes.append("customers array is empty")
        if len(data['suppliers']) == 0:
            notes.append("suppliers array is empty")
        if len(data['products']) == 0:
            notes.append("products array is empty")
        
        if notes:
            details += f" | NOTE: {', '.join(notes)}"
        
        print_test("TEST 1: GET /api/ai/options (authenticated)", True, details)
        return True, data
        
    except Exception as e:
        print_test("TEST 1: GET /api/ai/options (authenticated)", False, f"Exception: {e}")
        return False

def test_ai_options_unauthenticated():
    """Test 2: GET /api/ai/options without authentication"""
    try:
        response = requests.get(f"{BASE_URL}/ai/options", timeout=10)
        
        if response.status_code == 401:
            print_test("TEST 2: GET /api/ai/options (unauthenticated)", True, 
                      "Correctly returned 401 Unauthorized")
            return True
        else:
            print_test("TEST 2: GET /api/ai/options (unauthenticated)", False, 
                      f"Expected 401, got {response.status_code}")
            return False
            
    except Exception as e:
        print_test("TEST 2: GET /api/ai/options (unauthenticated)", False, f"Exception: {e}")
        return False

def test_ai_chat_sales_order(session):
    """Test 3: POST /api/ai/chat for sales order creation"""
    try:
        payload = {
            "message": "Saya mau membuat sales order baru",
            "sessionId": "ob1",
            "history": []
        }
        
        response = session.post(
            f"{BASE_URL}/ai/chat",
            json=payload,
            timeout=90  # LLM is non-deterministic, 90s timeout
        )
        
        if response.status_code != 200:
            print_test("TEST 3: POST /api/ai/chat (sales order)", False, 
                      f"Expected 200, got {response.status_code}")
            return False
        
        data = response.json()
        
        # Check ok:true
        if not data.get('ok'):
            print_test("TEST 3: POST /api/ai/chat (sales order)", False, 
                      "Response missing 'ok: true'")
            return False
        
        # Check uiComponents array
        if 'uiComponents' not in data:
            print_test("TEST 3: POST /api/ai/chat (sales order)", False, 
                      "Response missing 'uiComponents'")
            return False
        
        ui_components = data['uiComponents']
        if not isinstance(ui_components, list) or len(ui_components) < 1:
            print_test("TEST 3: POST /api/ai/chat (sales order)", False, 
                      f"uiComponents should be array with length >= 1, got: {ui_components}")
            return False
        
        # Check first component type
        first_component = ui_components[0]
        if first_component.get('type') != 'order_builder':
            print_test("TEST 3: POST /api/ai/chat (sales order)", False, 
                      f"Expected uiComponents[0].type == 'order_builder', got: {first_component.get('type')}")
            return False
        
        # Check orderType (may be 'SO' or null, both acceptable)
        order_type = first_component.get('orderType')
        
        # Check answer is non-empty string
        answer = data.get('answer', '')
        if not isinstance(answer, str) or len(answer.strip()) == 0:
            print_test("TEST 3: POST /api/ai/chat (sales order)", False, 
                      "answer should be a non-empty string")
            return False
        
        details = f"uiComponents[0].type='order_builder', orderType={order_type}, answer length={len(answer)}"
        print_test("TEST 3: POST /api/ai/chat (sales order)", True, details)
        return True
        
    except Exception as e:
        print_test("TEST 3: POST /api/ai/chat (sales order)", False, f"Exception: {e}")
        return False

def test_ai_chat_purchase_order(session):
    """Test 4: POST /api/ai/chat for purchase order creation"""
    try:
        payload = {
            "message": "Buat purchase order",
            "sessionId": "ob2",
            "history": []
        }
        
        response = session.post(
            f"{BASE_URL}/ai/chat",
            json=payload,
            timeout=90  # LLM is non-deterministic, 90s timeout
        )
        
        if response.status_code != 200:
            print_test("TEST 4: POST /api/ai/chat (purchase order)", False, 
                      f"Expected 200, got {response.status_code}")
            return False
        
        data = response.json()
        
        # Check ok:true
        if not data.get('ok'):
            print_test("TEST 4: POST /api/ai/chat (purchase order)", False, 
                      "Response missing 'ok: true'")
            return False
        
        # Check uiComponents array
        if 'uiComponents' not in data:
            print_test("TEST 4: POST /api/ai/chat (purchase order)", False, 
                      "Response missing 'uiComponents'")
            return False
        
        ui_components = data['uiComponents']
        if not isinstance(ui_components, list) or len(ui_components) < 1:
            print_test("TEST 4: POST /api/ai/chat (purchase order)", False, 
                      f"uiComponents should be array with length >= 1, got: {ui_components}")
            return False
        
        # Check first component type
        first_component = ui_components[0]
        if first_component.get('type') != 'order_builder':
            print_test("TEST 4: POST /api/ai/chat (purchase order)", False, 
                      f"Expected uiComponents[0].type == 'order_builder', got: {first_component.get('type')}")
            return False
        
        # Check orderType (may be 'PO' or null, both acceptable)
        order_type = first_component.get('orderType')
        
        details = f"uiComponents[0].type='order_builder', orderType={order_type}"
        print_test("TEST 4: POST /api/ai/chat (purchase order)", True, details)
        return True
        
    except Exception as e:
        print_test("TEST 4: POST /api/ai/chat (purchase order)", False, f"Exception: {e}")
        return False

def test_existing_order_endpoints(session, options_data):
    """Test 5: Verify existing order endpoints still work"""
    try:
        # Get contacts
        contacts_response = session.get(f"{BASE_URL}/contacts", timeout=10)
        if contacts_response.status_code != 200:
            print_test("TEST 5: Existing endpoints - GET /api/contacts", False, 
                      f"Expected 200, got {contacts_response.status_code}")
            return False
        
        contacts = contacts_response.json().get('data', [])
        
        # Find a customer and a supplier
        customer_id = None
        supplier_id = None
        
        for contact in contacts:
            categories = contact.get('categories', [])
            if 'Customer' in categories and not customer_id:
                customer_id = contact['id']
            if 'Supplier' in categories and not supplier_id:
                supplier_id = contact['id']
            if customer_id and supplier_id:
                break
        
        if not customer_id:
            print_test("TEST 5: Existing endpoints", False, 
                      "No Customer contact found in database")
            return False
        
        if not supplier_id:
            print_test("TEST 5: Existing endpoints", False, 
                      "No Supplier contact found in database")
            return False
        
        # Get products
        products_response = session.get(f"{BASE_URL}/products", timeout=10)
        if products_response.status_code != 200:
            print_test("TEST 5: Existing endpoints - GET /api/products", False, 
                      f"Expected 200, got {products_response.status_code}")
            return False
        
        products = products_response.json().get('data', [])
        if len(products) == 0:
            print_test("TEST 5: Existing endpoints", False, 
                      "No products found in database")
            return False
        
        product_id = products[0]['id']
        
        # Create a sales order
        so_payload = {
            "customerId": customer_id,
            "fulfillmentType": "stock",
            "items": [{
                "productId": product_id,
                "weight": 10,
                "quantity": 0,
                "unitPrice": 30000,
                "discount": 0
            }]
        }
        
        so_response = requests.post(
            f"{BASE_URL}/sales-orders",
            json=so_payload,
            cookies=session.cookies,
            timeout=10
        )
        
        if so_response.status_code != 201:
            print_test("TEST 5: POST /api/sales-orders", False, 
                      f"Expected 201, got {so_response.status_code} - {so_response.text}")
            return False
        
        so_data = so_response.json().get('data', {})
        so_number = so_data.get('soNumber')
        so_id = so_data.get('id')
        
        if not so_number or not so_id:
            print_test("TEST 5: POST /api/sales-orders", False, 
                      "Response missing soNumber or id")
            return False
        
        if not so_number.startswith('SO/'):
            print_test("TEST 5: POST /api/sales-orders", False, 
                      f"soNumber should start with 'SO/', got: {so_number}")
            return False
        
        print(f"  ✅ Created Sales Order: {so_number} (ID: {so_id})")
        
        # Create a purchase order
        po_payload = {
            "supplierId": supplier_id,
            "poType": "Bahan Baku",
            "items": [{
                "productId": product_id,
                "weight": 10,
                "unitPrice": 25000
            }]
        }
        
        po_response = requests.post(
            f"{BASE_URL}/purchase-orders",
            json=po_payload,
            cookies=session.cookies,
            timeout=10
        )
        
        if po_response.status_code != 201:
            print_test("TEST 5: POST /api/purchase-orders", False, 
                      f"Expected 201, got {po_response.status_code} - {po_response.text}")
            return False
        
        po_data = po_response.json().get('data', {})
        po_number = po_data.get('poNumber')
        po_id = po_data.get('id')
        
        if not po_number or not po_id:
            print_test("TEST 5: POST /api/purchase-orders", False, 
                      "Response missing poNumber or id")
            return False
        
        if not po_number.startswith('PO/'):
            print_test("TEST 5: POST /api/purchase-orders", False, 
                      f"poNumber should start with 'PO/', got: {po_number}")
            return False
        
        print(f"  ✅ Created Purchase Order: {po_number} (ID: {po_id})")
        
        details = f"SO: {so_number}, PO: {po_number} (both remain as Draft)"
        print_test("TEST 5: Existing order endpoints", True, details)
        return True, so_number, po_number
        
    except Exception as e:
        print_test("TEST 5: Existing order endpoints", False, f"Exception: {e}")
        return False

def main():
    print("=" * 80)
    print("BACKEND TEST: Interactive Order Builder Feature")
    print("=" * 80)
    
    # Login
    print("\n--- AUTHENTICATION ---")
    session = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not session:
        print("\n❌ CRITICAL: Cannot proceed without authentication")
        return
    
    # Run tests
    print("\n--- RUNNING TESTS ---")
    
    results = []
    
    # Test 1: GET /api/ai/options (authenticated)
    test1_result = test_ai_options_authenticated(session)
    if isinstance(test1_result, tuple):
        results.append(test1_result[0])
        options_data = test1_result[1]
    else:
        results.append(test1_result)
        options_data = None
    
    # Test 2: GET /api/ai/options (unauthenticated)
    results.append(test_ai_options_unauthenticated())
    
    # Test 3: POST /api/ai/chat (sales order)
    results.append(test_ai_chat_sales_order(session))
    
    # Test 4: POST /api/ai/chat (purchase order)
    results.append(test_ai_chat_purchase_order(session))
    
    # Test 5: Existing order endpoints
    test5_result = test_existing_order_endpoints(session, options_data)
    if isinstance(test5_result, tuple):
        results.append(test5_result[0])
        so_number = test5_result[1]
        po_number = test5_result[2]
    else:
        results.append(test5_result)
        so_number = None
        po_number = None
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    passed = sum(1 for r in results if r)
    total = len(results)
    print(f"\nTotal: {passed}/{total} tests passed ({int(passed/total*100)}%)")
    
    if so_number and po_number:
        print(f"\nOrders created (remain as Draft):")
        print(f"  - Sales Order: {so_number}")
        print(f"  - Purchase Order: {po_number}")
    
    if passed == total:
        print("\n✅ ALL TESTS PASSED - Interactive Order Builder feature is working correctly")
    else:
        print(f"\n❌ {total - passed} TEST(S) FAILED - See details above")
    
    print("=" * 80)

if __name__ == "__main__":
    main()
