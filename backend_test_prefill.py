#!/usr/bin/env python3
"""
Backend API tests for AI smart prefill + stock options
Tests GET /api/ai/options and POST /api/ai/chat with order builder prefill
"""

import requests
import json
import time

BASE_URL = "http://localhost:3000/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

# Session to maintain cookies
session = requests.Session()

def login():
    """Login as admin and get session cookie"""
    print("\n=== LOGIN ===")
    url = f"{BASE_URL}/auth/sign-in/email"
    payload = {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    
    try:
        resp = session.post(url, json=payload, timeout=10)
        print(f"POST {url}")
        print(f"Status: {resp.status_code}")
        print(f"Cookies received: {list(resp.cookies.keys())}")
        print(f"Session cookies: {list(session.cookies.keys())}")
        
        if resp.status_code == 200:
            print("✅ Login successful")
            return True
        else:
            print(f"❌ Login failed: {resp.status_code}")
            print(f"Response: {resp.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ Login error: {e}")
        return False

def test_ai_options():
    """Test 1: GET /api/ai/options - should return stocks array"""
    print("\n=== TEST 1: GET /api/ai/options ===")
    url = f"{BASE_URL}/ai/options"
    
    try:
        resp = session.get(url, timeout=10)
        print(f"GET {url}")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ FAILED: Expected 200, got {resp.status_code}")
            print(f"Response: {resp.text[:500]}")
            return False
        
        data = resp.json()
        
        # Check ok:true
        if not data.get('ok'):
            print(f"❌ FAILED: ok is not true")
            print(f"Response: {json.dumps(data, indent=2)[:500]}")
            return False
        
        # Check stocks array exists
        if 'stocks' not in data:
            print(f"❌ FAILED: 'stocks' key not found in response")
            print(f"Response keys: {list(data.keys())}")
            return False
        
        stocks = data['stocks']
        if not isinstance(stocks, list):
            print(f"❌ FAILED: 'stocks' is not an array")
            return False
        
        print(f"✅ PASSED: ok=true, stocks array present")
        print(f"   Stocks array length: {len(stocks)}")
        
        # Check stock structure if non-empty
        if len(stocks) > 0:
            stock = stocks[0]
            required_fields = ['id', 'productId', 'available', 'label']
            missing = [f for f in required_fields if f not in stock]
            
            if missing:
                print(f"❌ WARNING: Stock item missing fields: {missing}")
                print(f"   Stock item: {json.dumps(stock, indent=2)}")
            else:
                print(f"✅ Stock structure valid:")
                print(f"   - id: {stock['id']}")
                print(f"   - productId: {stock['productId']}")
                print(f"   - available: {stock['available']} (type: {type(stock['available']).__name__})")
                print(f"   - label: {stock['label']}")
                
                # Check available is a number
                if not isinstance(stock['available'], (int, float)):
                    print(f"❌ WARNING: 'available' is not a number")
        else:
            print(f"   ℹ️  Stocks array is empty (no active inventory with available > 0)")
        
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def get_real_contacts_and_products():
    """Get real customer, supplier, and product names for testing"""
    print("\n=== GETTING REAL DATA ===")
    
    # Get contacts
    try:
        resp = session.get(f"{BASE_URL}/contacts", timeout=10)
        if resp.status_code == 200:
            contacts_data = resp.json()
            contacts = contacts_data.get('data', [])
            
            # Find a customer
            customer = None
            for c in contacts:
                categories = c.get('categories', [])
                if 'Customer' in categories:
                    customer = c
                    break
            
            # Find a supplier
            supplier = None
            for c in contacts:
                categories = c.get('categories', [])
                if 'Supplier' in categories:
                    supplier = c
                    break
            
            print(f"Found {len(contacts)} contacts")
            if customer:
                print(f"✅ Customer: {customer.get('displayName')} (ID: {customer.get('id')})")
            else:
                print(f"❌ No customer found")
            
            if supplier:
                print(f"✅ Supplier: {supplier.get('displayName')} (ID: {supplier.get('id')})")
            else:
                print(f"❌ No supplier found")
        else:
            print(f"❌ Failed to get contacts: {resp.status_code}")
            customer = None
            supplier = None
    except Exception as e:
        print(f"❌ Error getting contacts: {e}")
        customer = None
        supplier = None
    
    # Get products
    try:
        resp = session.get(f"{BASE_URL}/products", timeout=10)
        if resp.status_code == 200:
            products_data = resp.json()
            products = products_data.get('data', [])
            product = products[0] if products else None
            
            print(f"Found {len(products)} products")
            if product:
                print(f"✅ Product: {product.get('name')} (ID: {product.get('id')})")
            else:
                print(f"❌ No product found")
        else:
            print(f"❌ Failed to get products: {resp.status_code}")
            product = None
    except Exception as e:
        print(f"❌ Error getting products: {e}")
        product = None
    
    return customer, supplier, product

def test_smart_prefill_sales_order(customer_name, product_name):
    """Test 2: Smart prefill for Sales Order"""
    print(f"\n=== TEST 2: SMART PREFILL - SALES ORDER ===")
    print(f"Customer: {customer_name}")
    print(f"Product: {product_name}")
    
    url = f"{BASE_URL}/ai/chat"
    message = f"Buatkan sales order untuk {customer_name}, 20 kg {product_name} harga 35000"
    payload = {
        "message": message,
        "sessionId": "pf1",
        "history": []
    }
    
    print(f"Message: {message}")
    
    try:
        resp = session.post(url, json=payload, timeout=90)
        print(f"POST {url}")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ FAILED: Expected 200, got {resp.status_code}")
            print(f"Response: {resp.text[:500]}")
            return False
        
        data = resp.json()
        
        # Check ok:true
        if not data.get('ok'):
            print(f"❌ FAILED: ok is not true")
            print(f"Response: {json.dumps(data, indent=2)[:500]}")
            return False
        
        print(f"✅ ok=true")
        
        # Check uiComponents
        ui_components = data.get('uiComponents', [])
        if len(ui_components) < 1:
            print(f"❌ FAILED: uiComponents length < 1 (got {len(ui_components)})")
            return False
        
        print(f"✅ uiComponents length: {len(ui_components)}")
        
        # Check first component type
        first_component = ui_components[0]
        if first_component.get('type') != 'order_builder':
            print(f"❌ FAILED: uiComponents[0].type != 'order_builder' (got '{first_component.get('type')}')")
            return False
        
        print(f"✅ uiComponents[0].type == 'order_builder'")
        
        # Check prefill
        prefill = first_component.get('prefill')
        if not prefill:
            print(f"❌ FAILED: uiComponents[0].prefill is missing or null")
            return False
        
        print(f"✅ prefill object present")
        print(f"\n📋 PREFILL CONTENTS:")
        print(json.dumps(prefill, indent=2))
        
        # Check contactId
        contact_id = prefill.get('contactId')
        if not contact_id:
            print(f"❌ FAILED: prefill.contactId is empty")
            return False
        
        print(f"\n✅ prefill.contactId: {contact_id} (non-empty)")
        
        # Check items array
        items = prefill.get('items', [])
        if len(items) < 1:
            print(f"❌ FAILED: prefill.items length < 1 (got {len(items)})")
            return False
        
        print(f"✅ prefill.items length: {len(items)}")
        
        # Check first item
        item = items[0]
        print(f"\n📦 FIRST ITEM:")
        print(json.dumps(item, indent=2))
        
        # Check productId
        product_id = item.get('productId')
        if not product_id:
            print(f"❌ FAILED: items[0].productId is empty")
            return False
        
        print(f"✅ items[0].productId: {product_id} (non-empty)")
        
        # Check weight
        weight = item.get('weight')
        if weight != "20":
            print(f"❌ FAILED: items[0].weight != '20' (got '{weight}')")
            return False
        
        print(f"✅ items[0].weight: '{weight}' (matches '20')")
        
        # Check unitPrice
        unit_price = item.get('unitPrice')
        if unit_price != "35000":
            print(f"❌ FAILED: items[0].unitPrice != '35000' (got '{unit_price}')")
            return False
        
        print(f"✅ items[0].unitPrice: '{unit_price}' (matches '35000')")
        
        print(f"\n✅ TEST 2 PASSED: Smart prefill for Sales Order working correctly")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_smart_prefill_purchase_order(supplier_name, product_name):
    """Test 3: Smart prefill for Purchase Order"""
    print(f"\n=== TEST 3: SMART PREFILL - PURCHASE ORDER ===")
    print(f"Supplier: {supplier_name}")
    print(f"Product: {product_name}")
    
    url = f"{BASE_URL}/ai/chat"
    message = f"buat purchase order ke supplier {supplier_name}, 100 kg {product_name}"
    payload = {
        "message": message,
        "sessionId": "pf2",
        "history": []
    }
    
    print(f"Message: {message}")
    
    try:
        resp = session.post(url, json=payload, timeout=90)
        print(f"POST {url}")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ FAILED: Expected 200, got {resp.status_code}")
            print(f"Response: {resp.text[:500]}")
            return False
        
        data = resp.json()
        
        # Check ok:true
        if not data.get('ok'):
            print(f"❌ FAILED: ok is not true")
            print(f"Response: {json.dumps(data, indent=2)[:500]}")
            return False
        
        print(f"✅ ok=true")
        
        # Check uiComponents
        ui_components = data.get('uiComponents', [])
        if len(ui_components) < 1:
            print(f"❌ FAILED: uiComponents length < 1 (got {len(ui_components)})")
            return False
        
        print(f"✅ uiComponents length: {len(ui_components)}")
        
        # Check first component type
        first_component = ui_components[0]
        if first_component.get('type') != 'order_builder':
            print(f"❌ FAILED: uiComponents[0].type != 'order_builder' (got '{first_component.get('type')}')")
            return False
        
        print(f"✅ uiComponents[0].type == 'order_builder'")
        
        # Check prefill
        prefill = first_component.get('prefill')
        if not prefill:
            print(f"❌ FAILED: uiComponents[0].prefill is missing or null")
            return False
        
        print(f"✅ prefill object present")
        print(f"\n📋 PREFILL CONTENTS:")
        print(json.dumps(prefill, indent=2))
        
        # Check contactId (should resolve to supplier)
        contact_id = prefill.get('contactId')
        if not contact_id:
            print(f"❌ FAILED: prefill.contactId is empty (should resolve to supplier)")
            return False
        
        print(f"\n✅ prefill.contactId: {contact_id} (resolved to supplier)")
        
        # Check items array
        items = prefill.get('items', [])
        if len(items) < 1:
            print(f"❌ FAILED: prefill.items length < 1 (got {len(items)})")
            return False
        
        print(f"✅ prefill.items length: {len(items)}")
        
        # Check first item
        item = items[0]
        print(f"\n📦 FIRST ITEM:")
        print(json.dumps(item, indent=2))
        
        # Check productId
        product_id = item.get('productId')
        if not product_id:
            print(f"❌ FAILED: items[0].productId is empty")
            return False
        
        print(f"✅ items[0].productId: {product_id} (non-empty)")
        
        # Check weight
        weight = item.get('weight')
        if weight != "100":
            print(f"⚠️  WARNING: items[0].weight != '100' (got '{weight}')")
        else:
            print(f"✅ items[0].weight: '{weight}' (matches '100')")
        
        # Check unitPrice (may be basePrice or empty)
        unit_price = item.get('unitPrice', '')
        print(f"ℹ️  items[0].unitPrice: '{unit_price}' (may be product basePrice or empty)")
        
        print(f"\n✅ TEST 3 PASSED: Smart prefill for Purchase Order working correctly")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    print("=" * 80)
    print("BACKEND API TESTS: AI Smart Prefill + Stock Options")
    print("=" * 80)
    
    # Login
    if not login():
        print("\n❌ LOGIN FAILED - Cannot proceed with tests")
        return
    
    # Test 1: GET /api/ai/options
    test1_passed = test_ai_options()
    
    # Get real data for prefill tests
    customer, supplier, product = get_real_contacts_and_products()
    
    if not customer or not product:
        print("\n❌ Cannot run Test 2 (Sales Order prefill) - missing customer or product")
        test2_passed = False
    else:
        # Test 2: Smart prefill for Sales Order
        test2_passed = test_smart_prefill_sales_order(
            customer.get('displayName'),
            product.get('name')
        )
    
    if not supplier or not product:
        print("\n❌ Cannot run Test 3 (Purchase Order prefill) - missing supplier or product")
        test3_passed = False
    else:
        # Test 3: Smart prefill for Purchase Order
        test3_passed = test_smart_prefill_purchase_order(
            supplier.get('displayName'),
            product.get('name')
        )
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"Test 1 (GET /api/ai/options): {'✅ PASSED' if test1_passed else '❌ FAILED'}")
    print(f"Test 2 (Smart prefill SO): {'✅ PASSED' if test2_passed else '❌ FAILED'}")
    print(f"Test 3 (Smart prefill PO): {'✅ PASSED' if test3_passed else '❌ FAILED'}")
    
    total = sum([test1_passed, test2_passed, test3_passed])
    print(f"\nTotal: {total}/3 tests passed")
    
    if total == 3:
        print("\n🎉 ALL TESTS PASSED")
    else:
        print(f"\n⚠️  {3 - total} test(s) failed")

if __name__ == "__main__":
    main()
