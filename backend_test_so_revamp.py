#!/usr/bin/env python3
"""
Backend test for Sales Order revamp Phase A:
- TEST 1: Products avgHppPerKg field
- TEST 2: Create SO with PRODUCT-LEVEL items (NO kode simpan)
"""
import requests
import json
import sys
from datetime import datetime

BASE_URL = "http://localhost:3000/api"

def login():
    """Login as admin and return session"""
    print("\n=== LOGIN: admin@lpi.co.id ===")
    session = requests.Session()
    
    url = "http://localhost:3000/api/auth/sign-in/email"
    payload = {
        "email": "admin@lpi.co.id",
        "password": "admin123"
    }
    
    try:
        resp = session.post(url, json=payload)
        print(f"Login response status: {resp.status_code}")
        
        if resp.status_code == 200:
            print("✅ Login successful")
            return session
        else:
            print(f"❌ Login failed: {resp.status_code}")
            print(f"Response: {resp.text[:200]}")
            return None
    except Exception as e:
        print(f"❌ Login error: {e}")
        return None

def test_products_avg_hpp(session):
    """TEST 1: GET /api/products - verify avgHppPerKg field"""
    print("\n" + "="*80)
    print("TEST 1: Products avgHppPerKg field")
    print("="*80)
    
    try:
        resp = session.get(f"{BASE_URL}/products")
        print(f"\nGET /api/products status: {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ FAILED: Expected 200, got {resp.status_code}")
            print(f"Response: {resp.text[:500]}")
            return False
        
        data = resp.json()
        products = data.get('data', [])
        print(f"✅ Response 200 OK - Found {len(products)} products")
        
        if len(products) == 0:
            print("⚠️  No products found in database")
            return True
        
        # Check if avgHppPerKg field exists in all products
        products_with_hpp = []
        products_without_stock = []
        
        for product in products:
            if 'avgHppPerKg' not in product:
                print(f"❌ FAILED: Product {product.get('sku')} missing avgHppPerKg field")
                return False
            
            avg_hpp = product.get('avgHppPerKg')
            if not isinstance(avg_hpp, (int, float)):
                print(f"❌ FAILED: Product {product.get('sku')} avgHppPerKg is not numeric: {avg_hpp}")
                return False
            
            if avg_hpp > 0:
                products_with_hpp.append(product)
            else:
                products_without_stock.append(product)
        
        print(f"\n✅ All products have avgHppPerKg field (numeric)")
        print(f"   - Products with active stock (avgHppPerKg > 0): {len(products_with_hpp)}")
        print(f"   - Products without stock (avgHppPerKg = 0): {len(products_without_stock)}")
        
        # Show examples of products with stock
        if len(products_with_hpp) > 0:
            print(f"\n📊 Sample products with active stock:")
            for i, p in enumerate(products_with_hpp[:3]):  # Show up to 3 examples
                print(f"   {i+1}. SKU: {p.get('sku')}")
                print(f"      Name: {p.get('name')}")
                print(f"      avgHppPerKg: Rp {p.get('avgHppPerKg'):,.0f}")
                print(f"      ID: {p.get('id')}")
        
        # Show examples of products without stock
        if len(products_without_stock) > 0:
            print(f"\n📊 Sample products without stock:")
            for i, p in enumerate(products_without_stock[:2]):  # Show up to 2 examples
                print(f"   {i+1}. SKU: {p.get('sku')}")
                print(f"      Name: {p.get('name')}")
                print(f"      avgHppPerKg: {p.get('avgHppPerKg')} (no active stock)")
        
        print(f"\n✅ TEST 1 PASSED: avgHppPerKg field present and correct")
        return True
        
    except Exception as e:
        print(f"❌ TEST 1 FAILED with exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def get_customer_contact(session):
    """Get a customer contact for SO creation"""
    print("\n=== Get Customer Contact ===")
    try:
        resp = session.get(f"{BASE_URL}/contacts?type=Customer")
        if resp.status_code == 200:
            data = resp.json()
            contacts = data.get('data', [])
            if len(contacts) > 0:
                customer = contacts[0]
                print(f"✅ Found customer: {customer.get('displayName')} (ID: {customer.get('id')})")
                return customer
            else:
                print("❌ No customer contacts found")
                return None
        else:
            print(f"❌ Failed to get contacts: {resp.status_code}")
            return None
    except Exception as e:
        print(f"❌ Error getting contacts: {e}")
        return None

def get_product(session):
    """Get a product for SO creation"""
    print("\n=== Get Product ===")
    try:
        resp = session.get(f"{BASE_URL}/products")
        if resp.status_code == 200:
            data = resp.json()
            products = data.get('data', [])
            if len(products) > 0:
                product = products[0]
                print(f"✅ Found product: {product.get('name')} (SKU: {product.get('sku')}, ID: {product.get('id')})")
                return product
            else:
                print("❌ No products found")
                return None
        else:
            print(f"❌ Failed to get products: {resp.status_code}")
            return None
    except Exception as e:
        print(f"❌ Error getting products: {e}")
        return None

def test_product_level_so(session):
    """TEST 2: Create SO with PRODUCT-LEVEL items (NO kode simpan)"""
    print("\n" + "="*80)
    print("TEST 2: Create SO with PRODUCT-LEVEL items (NO stockCodeId)")
    print("="*80)
    
    # Get customer and product
    customer = get_customer_contact(session)
    if not customer:
        print("❌ TEST 2 FAILED: Cannot get customer contact")
        return False, None
    
    product = get_product(session)
    if not product:
        print("❌ TEST 2 FAILED: Cannot get product")
        return False, None
    
    # Create SO with product-level item (no stockId)
    print("\n=== Create SO with product-level item ===")
    so_payload = {
        "customerId": customer.get('id'),
        "fulfillmentType": "stock",
        "items": [
            {
                "productId": product.get('id'),
                "quantity": 2,
                "weight": 20,
                "unitPrice": 35000,
                "discount": 0
            }
        ]
    }
    
    print(f"\nPOST /api/sales-orders")
    print(f"Payload: {json.dumps(so_payload, indent=2)}")
    
    try:
        resp = session.post(f"{BASE_URL}/sales-orders", json=so_payload)
        print(f"\nResponse status: {resp.status_code}")
        
        if resp.status_code != 201:
            print(f"❌ FAILED: Expected 201, got {resp.status_code}")
            print(f"Response: {resp.text[:500]}")
            return False, None
        
        data = resp.json()
        so = data.get('data', {})
        so_id = so.get('id')
        so_number = so.get('soNumber')
        
        print(f"✅ SO created successfully")
        print(f"   SO Number: {so_number}")
        print(f"   SO ID: {so_id}")
        print(f"   Pipeline Status: {so.get('pipelineStatus')}")
        
        # Verify SO details
        print(f"\n=== Verify SO Details ===")
        resp = session.get(f"{BASE_URL}/sales-orders/{so_id}")
        if resp.status_code != 200:
            print(f"❌ FAILED: Cannot get SO details: {resp.status_code}")
            return False, so_id
        
        data = resp.json()
        so_detail = data.get('data', {})
        items = so_detail.get('items', [])
        
        print(f"✅ SO Details retrieved")
        print(f"   Total Amount: Rp {so_detail.get('totalAmount', 0):,.0f}")
        print(f"   Items count: {len(items)}")
        
        if len(items) == 0:
            print(f"❌ FAILED: No items in SO")
            return False, so_id
        
        item = items[0]
        print(f"\n📊 Item Details:")
        print(f"   Product ID: {item.get('productId')}")
        print(f"   Stock Code ID: {item.get('stockCodeId')}")
        print(f"   Weight: {item.get('weight')} kg")
        print(f"   Unit Price: Rp {item.get('unitPrice'):,.0f}")
        print(f"   Subtotal: Rp {item.get('subtotal', 0):,.0f}")
        
        # Verify expectations
        errors = []
        
        if item.get('productId') != product.get('id'):
            errors.append(f"Product ID mismatch: expected {product.get('id')}, got {item.get('productId')}")
        
        if item.get('stockCodeId') is not None:
            errors.append(f"Stock Code ID should be null, got {item.get('stockCodeId')}")
        
        if item.get('weight') != 20:
            errors.append(f"Weight mismatch: expected 20, got {item.get('weight')}")
        
        if item.get('unitPrice') != 35000:
            errors.append(f"Unit Price mismatch: expected 35000, got {item.get('unitPrice')}")
        
        expected_subtotal = 20 * 35000  # 700000
        if item.get('subtotal') != expected_subtotal:
            errors.append(f"Subtotal mismatch: expected {expected_subtotal}, got {item.get('subtotal')}")
        
        if so_detail.get('totalAmount') != expected_subtotal:
            errors.append(f"Total Amount mismatch: expected {expected_subtotal}, got {so_detail.get('totalAmount')}")
        
        if so_detail.get('pipelineStatus') != 'Draft':
            errors.append(f"Pipeline Status should be 'Draft', got {so_detail.get('pipelineStatus')}")
        
        if errors:
            print(f"\n❌ TEST 2 FAILED with errors:")
            for error in errors:
                print(f"   - {error}")
            return False, so_id
        
        print(f"\n✅ All verifications passed:")
        print(f"   ✓ Product ID set correctly")
        print(f"   ✓ Stock Code ID is null (product-level item)")
        print(f"   ✓ Weight: 20 kg")
        print(f"   ✓ Unit Price: Rp 35,000")
        print(f"   ✓ Subtotal: Rp 700,000")
        print(f"   ✓ Total Amount: Rp 700,000")
        print(f"   ✓ Pipeline Status: Draft")
        print(f"   ✓ No error about missing stock/kode simpan")
        
        print(f"\n✅ TEST 2 PASSED: Product-level SO created successfully")
        return True, so_id
        
    except Exception as e:
        print(f"❌ TEST 2 FAILED with exception: {e}")
        import traceback
        traceback.print_exc()
        return False, None

def cleanup_so(session, so_id):
    """Delete the created SO"""
    if not so_id:
        return
    
    print(f"\n=== CLEANUP: Delete SO {so_id} ===")
    try:
        resp = session.delete(f"{BASE_URL}/sales-orders/{so_id}")
        if resp.status_code == 200:
            print(f"✅ SO deleted successfully")
        else:
            print(f"⚠️  Failed to delete SO: {resp.status_code}")
            print(f"Response: {resp.text[:200]}")
    except Exception as e:
        print(f"⚠️  Error deleting SO: {e}")

def main():
    print("="*80)
    print("BACKEND TEST: Sales Order Revamp Phase A")
    print("="*80)
    
    # Login
    session = login()
    if not session:
        print("\n❌ OVERALL RESULT: FAILED (login failed)")
        sys.exit(1)
    
    # TEST 1: Products avgHppPerKg
    test1_passed = test_products_avg_hpp(session)
    
    # TEST 2: Create SO with product-level items
    test2_passed, so_id = test_product_level_so(session)
    
    # Cleanup
    if so_id:
        cleanup_so(session, so_id)
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    print(f"TEST 1 (Products avgHppPerKg): {'✅ PASSED' if test1_passed else '❌ FAILED'}")
    print(f"TEST 2 (Product-level SO): {'✅ PASSED' if test2_passed else '❌ FAILED'}")
    
    if test1_passed and test2_passed:
        print("\n✅ OVERALL RESULT: ALL TESTS PASSED (2/2)")
        sys.exit(0)
    else:
        print("\n❌ OVERALL RESULT: SOME TESTS FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
