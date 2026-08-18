#!/usr/bin/env python3
"""
Backend API Test: Operator role-permission fix for purchase-orders
Tests that operator can GET /purchase-orders and /purchase-orders/:id
but cannot POST/PUT/PATCH/DELETE purchase-orders.
"""

import requests
import json
import sys
import re

BASE_URL = "http://localhost:3000/api"

# Test credentials
CREDENTIALS = {
    "operator": {"email": "operator@lpi.co.id", "password": "operator123"},
    "admin": {"email": "admin@lpi.co.id", "password": "admin123"},
    "supervisor": {"email": "supervisor@lpi.co.id", "password": "super123"},
}

# Store cookie headers for each role
cookie_headers = {}

def login(role):
    """Login and return cookie header"""
    print(f"\n{'='*60}")
    print(f"Logging in as {role.upper()}...")
    print(f"{'='*60}")
    
    creds = CREDENTIALS[role]
    
    # Better Auth login endpoint
    login_url = "http://localhost:3000/api/auth/sign-in/email"
    payload = {
        "email": creds["email"],
        "password": creds["password"]
    }
    
    try:
        response = requests.post(login_url, json=payload)
        print(f"Login response status: {response.status_code}")
        
        if response.status_code == 200:
            # Extract cookie from Set-Cookie header
            cookie_header = response.headers.get('set-cookie', '')
            match = re.search(r'__Secure-better-auth\.session_token=([^;]+)', cookie_header)
            if match:
                cookie_value = match.group(1)
                cookie_headers[role] = {'Cookie': f'__Secure-better-auth.session_token={cookie_value}'}
                print(f"✅ Login successful as {role}")
                return cookie_headers[role]
            else:
                print(f"❌ Failed to extract cookie from response")
                return None
        else:
            print(f"❌ Login failed: {response.status_code}")
            print(f"Response: {response.text}")
            return None
    except Exception as e:
        print(f"❌ Login error: {e}")
        return None

def test_get_purchase_orders_list(headers, role, expect_status=200):
    """Test GET /api/purchase-orders"""
    print(f"\n--- Test: GET /api/purchase-orders as {role.upper()} ---")
    
    try:
        response = requests.get(f"{BASE_URL}/purchase-orders", headers=headers)
        print(f"Status: {response.status_code} (expected: {expect_status})")
        
        if response.status_code == expect_status:
            if response.status_code == 200:
                data = response.json()
                print(f"✅ PASS: Got 200 OK")
                print(f"Response has 'data' key: {'data' in data}")
                if 'data' in data:
                    print(f"Number of POs: {len(data['data'])}")
                return True, data
            else:
                print(f"✅ PASS: Got expected status {expect_status}")
                return True, None
        else:
            print(f"❌ FAIL: Expected {expect_status}, got {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return False, None
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False, None

def test_get_purchase_order_detail(headers, role, po_id, expect_status=200):
    """Test GET /api/purchase-orders/:id"""
    print(f"\n--- Test: GET /api/purchase-orders/{po_id} as {role.upper()} ---")
    
    try:
        response = requests.get(f"{BASE_URL}/purchase-orders/{po_id}", headers=headers)
        print(f"Status: {response.status_code} (expected: {expect_status})")
        
        if response.status_code == expect_status:
            if response.status_code == 200:
                data = response.json()
                print(f"✅ PASS: Got 200 OK")
                print(f"Response has 'data' key: {'data' in data}")
                if 'data' in data:
                    po = data['data']
                    print(f"PO Number: {po.get('poNumber', 'N/A')}")
                    print(f"PO has items: {'items' in po}")
                return True, data
            else:
                print(f"✅ PASS: Got expected status {expect_status}")
                return True, None
        else:
            print(f"❌ FAIL: Expected {expect_status}, got {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return False, None
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False, None

def get_supplier_and_product(headers):
    """Get a supplier and product for creating PO"""
    print(f"\n--- Getting supplier and product for PO creation ---")
    
    try:
        # Get suppliers
        response = requests.get(f"{BASE_URL}/contacts?category=Supplier", headers=headers)
        if response.status_code == 200:
            suppliers = response.json().get('data', [])
            if suppliers:
                supplier_id = suppliers[0]['id']
                print(f"✅ Found supplier: {suppliers[0].get('displayName', 'N/A')} (ID: {supplier_id})")
            else:
                print("⚠️ No suppliers found, creating one...")
                # Create a supplier
                create_response = requests.post(f"{BASE_URL}/contacts", json={
                    "displayName": "Test Supplier for PO",
                    "categories": ["Supplier"],
                    "code": "TEST-SUP-PO"
                }, headers=headers)
                if create_response.status_code == 201:
                    supplier_id = create_response.json()['data']['id']
                    print(f"✅ Created supplier (ID: {supplier_id})")
                else:
                    print(f"❌ Failed to create supplier: {create_response.status_code}")
                    return None, None
        else:
            print(f"❌ Failed to get suppliers: {response.status_code}")
            return None, None
        
        # Get products
        response = requests.get(f"{BASE_URL}/products", headers=headers)
        if response.status_code == 200:
            products = response.json().get('data', [])
            if products:
                product_id = products[0]['id']
                print(f"✅ Found product: {products[0].get('name', 'N/A')} (ID: {product_id})")
            else:
                print("⚠️ No products found, creating one...")
                # Create a product
                create_response = requests.post(f"{BASE_URL}/products", json={
                    "name": "Test Product for PO",
                    "sku": "TEST-PROD-PO",
                    "unit": "kg",
                    "basePrice": 50000
                }, headers=headers)
                if create_response.status_code == 201:
                    product_id = create_response.json()['data']['id']
                    print(f"✅ Created product (ID: {product_id})")
                else:
                    print(f"❌ Failed to create product: {create_response.status_code}")
                    return None, None
        else:
            print(f"❌ Failed to get products: {response.status_code}")
            return None, None
        
        return supplier_id, product_id
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return None, None

def create_purchase_order(headers, supplier_id, product_id):
    """Create a purchase order as admin"""
    print(f"\n--- Creating Purchase Order as ADMIN ---")
    
    payload = {
        "supplierId": supplier_id,
        "poType": "regular",
        "orderDate": "2026-08-11",
        "items": [
            {
                "productId": product_id,
                "quantity": 10,
                "weight": 100,
                "unitPrice": 50000
            }
        ]
    }
    
    try:
        response = requests.post(f"{BASE_URL}/purchase-orders", json=payload, headers=headers)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 201:
            data = response.json()
            po_id = data['data']['id']
            po_number = data['data']['poNumber']
            print(f"✅ PO created successfully")
            print(f"PO ID: {po_id}")
            print(f"PO Number: {po_number}")
            return po_id
        else:
            print(f"❌ Failed to create PO: {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return None
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return None

def test_post_purchase_order(headers, role, supplier_id, product_id, expect_status=403):
    """Test POST /api/purchase-orders (should be forbidden for operator)"""
    print(f"\n--- Test: POST /api/purchase-orders as {role.upper()} ---")
    
    payload = {
        "supplierId": supplier_id,
        "poType": "regular",
        "orderDate": "2026-08-11",
        "items": [
            {
                "productId": product_id,
                "quantity": 1,
                "weight": 10,
                "unitPrice": 50000
            }
        ]
    }
    
    try:
        response = requests.post(f"{BASE_URL}/purchase-orders", json=payload, headers=headers)
        print(f"Status: {response.status_code} (expected: {expect_status})")
        
        if response.status_code == expect_status:
            print(f"✅ PASS: Got expected status {expect_status}")
            return True
        else:
            print(f"❌ FAIL: Expected {expect_status}, got {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False

def test_put_purchase_order(headers, role, po_id, expect_status=403):
    """Test PUT /api/purchase-orders/:id (should be forbidden for operator)"""
    print(f"\n--- Test: PUT /api/purchase-orders/{po_id} as {role.upper()} ---")
    
    payload = {
        "notes": "Test update by operator"
    }
    
    try:
        response = requests.put(f"{BASE_URL}/purchase-orders/{po_id}", json=payload, headers=headers)
        print(f"Status: {response.status_code} (expected: {expect_status})")
        
        if response.status_code == expect_status:
            print(f"✅ PASS: Got expected status {expect_status}")
            return True
        else:
            print(f"❌ FAIL: Expected {expect_status}, got {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False

def test_patch_purchase_order(headers, role, po_id, expect_status=403):
    """Test PATCH /api/purchase-orders/:id (should be forbidden for operator)"""
    print(f"\n--- Test: PATCH /api/purchase-orders/{po_id} as {role.upper()} ---")
    
    payload = {
        "notes": "Test patch by operator"
    }
    
    try:
        response = requests.patch(f"{BASE_URL}/purchase-orders/{po_id}", json=payload, headers=headers)
        print(f"Status: {response.status_code} (expected: {expect_status})")
        
        if response.status_code == expect_status:
            print(f"✅ PASS: Got expected status {expect_status}")
            return True
        else:
            print(f"❌ FAIL: Expected {expect_status}, got {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False

def test_delete_purchase_order(headers, role, po_id, expect_status=403):
    """Test DELETE /api/purchase-orders/:id (should be forbidden for operator)"""
    print(f"\n--- Test: DELETE /api/purchase-orders/{po_id} as {role.upper()} ---")
    
    try:
        response = requests.delete(f"{BASE_URL}/purchase-orders/{po_id}", headers=headers)
        print(f"Status: {response.status_code} (expected: {expect_status})")
        
        if response.status_code == expect_status:
            print(f"✅ PASS: Got expected status {expect_status}")
            return True
        else:
            print(f"❌ FAIL: Expected {expect_status}, got {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False

def test_get_work_orders(headers, role, expect_status=200):
    """Test GET /api/work-orders (regression test)"""
    print(f"\n--- Test: GET /api/work-orders as {role.upper()} (REGRESSION) ---")
    
    try:
        response = requests.get(f"{BASE_URL}/work-orders", headers=headers)
        print(f"Status: {response.status_code} (expected: {expect_status})")
        
        if response.status_code == expect_status:
            if response.status_code == 200:
                data = response.json()
                print(f"✅ PASS: Got 200 OK")
                print(f"Response has 'data' key: {'data' in data}")
                if 'data' in data:
                    print(f"Number of WOs: {len(data['data'])}")
                return True
            else:
                print(f"✅ PASS: Got expected status {expect_status}")
                return True
        else:
            print(f"❌ FAIL: Expected {expect_status}, got {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False

def main():
    print("\n" + "="*60)
    print("BACKEND TEST: Operator Purchase Orders Role-Permission Fix")
    print("="*60)
    
    results = {
        "passed": 0,
        "failed": 0,
        "total": 0
    }
    
    # Step 1: Login as operator
    operator_headers = login("operator")
    if not operator_headers:
        print("\n❌ CRITICAL: Failed to login as operator")
        sys.exit(1)
    
    # Step 2: Test GET /api/purchase-orders as operator (expect 200, not 403)
    print("\n" + "="*60)
    print("TEST 1: Operator can GET /api/purchase-orders (list)")
    print("="*60)
    success, data = test_get_purchase_orders_list(operator_headers, "operator", expect_status=200)
    results["total"] += 1
    if success:
        results["passed"] += 1
    else:
        results["failed"] += 1
    
    # Step 3: Login as admin and create a PO
    admin_headers = login("admin")
    if not admin_headers:
        print("\n❌ CRITICAL: Failed to login as admin")
        sys.exit(1)
    
    # Get supplier and product
    supplier_id, product_id = get_supplier_and_product(admin_headers)
    if not supplier_id or not product_id:
        print("\n❌ CRITICAL: Failed to get supplier and product")
        sys.exit(1)
    
    # Create PO
    po_id = create_purchase_order(admin_headers, supplier_id, product_id)
    if not po_id:
        print("\n⚠️ WARNING: Failed to create PO, will skip detail tests")
        po_id = None
    
    # Step 4: Test GET /api/purchase-orders/:id as operator (expect 200)
    if po_id:
        print("\n" + "="*60)
        print("TEST 2: Operator can GET /api/purchase-orders/:id (detail)")
        print("="*60)
        success, data = test_get_purchase_order_detail(operator_headers, "operator", po_id, expect_status=200)
        results["total"] += 1
        if success:
            results["passed"] += 1
        else:
            results["failed"] += 1
    
    # Step 5: Test GET /api/purchase-orders as admin (no regression)
    print("\n" + "="*60)
    print("TEST 3: Admin can still GET /api/purchase-orders (no regression)")
    print("="*60)
    success, data = test_get_purchase_orders_list(admin_headers, "admin", expect_status=200)
    results["total"] += 1
    if success:
        results["passed"] += 1
    else:
        results["failed"] += 1
    
    # Step 6: Test GET /api/purchase-orders/:id as admin (no regression)
    if po_id:
        print("\n" + "="*60)
        print("TEST 4: Admin can still GET /api/purchase-orders/:id (no regression)")
        print("="*60)
        success, data = test_get_purchase_order_detail(admin_headers, "admin", po_id, expect_status=200)
        results["total"] += 1
        if success:
            results["passed"] += 1
        else:
            results["failed"] += 1
    
    # Step 7: Login as supervisor and test (no regression)
    supervisor_headers = login("supervisor")
    if supervisor_headers:
        print("\n" + "="*60)
        print("TEST 5: Supervisor can still GET /api/purchase-orders (no regression)")
        print("="*60)
        success, data = test_get_purchase_orders_list(supervisor_headers, "supervisor", expect_status=200)
        results["total"] += 1
        if success:
            results["passed"] += 1
        else:
            results["failed"] += 1
        
        if po_id:
            print("\n" + "="*60)
            print("TEST 6: Supervisor can still GET /api/purchase-orders/:id (no regression)")
            print("="*60)
            success, data = test_get_purchase_order_detail(supervisor_headers, "supervisor", po_id, expect_status=200)
            results["total"] += 1
            if success:
                results["passed"] += 1
            else:
                results["failed"] += 1
    
    # Step 8: Test write operations as operator (should be forbidden)
    print("\n" + "="*60)
    print("TEST 7: Operator CANNOT POST /api/purchase-orders (security)")
    print("="*60)
    success = test_post_purchase_order(operator_headers, "operator", supplier_id, product_id, expect_status=403)
    results["total"] += 1
    if success:
        results["passed"] += 1
    else:
        results["failed"] += 1
    
    if po_id:
        print("\n" + "="*60)
        print("TEST 8: Operator CANNOT PUT /api/purchase-orders/:id (security)")
        print("="*60)
        success = test_put_purchase_order(operator_headers, "operator", po_id, expect_status=403)
        results["total"] += 1
        if success:
            results["passed"] += 1
        else:
            results["failed"] += 1
        
        print("\n" + "="*60)
        print("TEST 9: Operator CANNOT PATCH /api/purchase-orders/:id (security)")
        print("="*60)
        success = test_patch_purchase_order(operator_headers, "operator", po_id, expect_status=403)
        results["total"] += 1
        if success:
            results["passed"] += 1
        else:
            results["failed"] += 1
        
        print("\n" + "="*60)
        print("TEST 10: Operator CANNOT DELETE /api/purchase-orders/:id (security)")
        print("="*60)
        success = test_delete_purchase_order(operator_headers, "operator", po_id, expect_status=403)
        results["total"] += 1
        if success:
            results["passed"] += 1
        else:
            results["failed"] += 1
    
    # Step 9: Test GET /api/work-orders as operator (regression)
    print("\n" + "="*60)
    print("TEST 11: Operator can still GET /api/work-orders (regression)")
    print("="*60)
    success = test_get_work_orders(operator_headers, "operator", expect_status=200)
    results["total"] += 1
    if success:
        results["passed"] += 1
    else:
        results["failed"] += 1
    
    # Summary
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)
    print(f"Total tests: {results['total']}")
    print(f"Passed: {results['passed']}")
    print(f"Failed: {results['failed']}")
    print(f"Success rate: {results['passed']/results['total']*100:.1f}%")
    
    if results['failed'] == 0:
        print("\n✅ ALL TESTS PASSED")
        return 0
    else:
        print(f"\n❌ {results['failed']} TEST(S) FAILED")
        return 1

if __name__ == "__main__":
    sys.exit(main())
