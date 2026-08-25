#!/usr/bin/env python3
"""
Backend API Test for DELETE /api/products/:id bugfix
Tests the fix for SQLITE_CONSTRAINT_FOREIGNKEY error (500 → 409)
"""

import requests
import json
import sys

# Base URL for the API
BASE_URL = "http://localhost:3000/api"

# Test credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

def print_test_header(test_name):
    """Print a formatted test header"""
    print(f"\n{'='*80}")
    print(f"TEST: {test_name}")
    print(f"{'='*80}")

def print_result(passed, message):
    """Print test result"""
    status = "✅ PASSED" if passed else "❌ FAILED"
    print(f"{status}: {message}")

def login_admin():
    """Login as admin and return session cookies"""
    print_test_header("Login as Admin")
    
    # Create session first
    session = requests.Session()
    
    # Disable SSL warnings for localhost
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    
    # Better Auth uses /api/auth/sign-in/email endpoint
    login_url = "http://localhost:3000/api/auth/sign-in/email"
    payload = {
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    }
    
    try:
        response = session.post(login_url, json=payload, verify=False)
        print(f"Login response status: {response.status_code}")
        print(f"Cookies received: {dict(session.cookies)}")
        
        if response.status_code == 200:
            print_result(True, f"Admin login successful")
            # Check if we got session cookies
            if len(session.cookies) > 0:
                print(f"Session cookies: {list(session.cookies.keys())}")
                
                # Test the session by calling /me endpoint
                me_response = session.get(f"{BASE_URL}/me", verify=False)
                print(f"Test /me endpoint: {me_response.status_code}")
                if me_response.status_code == 200:
                    user = me_response.json().get('user', {})
                    print(f"Logged in as: {user.get('email')} (role: {user.get('role')})")
                    return session
                else:
                    print_result(False, f"Session validation failed: {me_response.status_code}")
                    return None
            else:
                print_result(False, "No session cookies received")
                return None
        else:
            print_result(False, f"Login failed with status {response.status_code}")
            print(f"Response: {response.text}")
            return None
    except Exception as e:
        print_result(False, f"Login error: {str(e)}")
        return None

def test_scenario_a_unused_product_delete(session):
    """
    TEST SCENARIO A: Unused product deletes successfully
    1. Create a new product via POST /api/products
    2. DELETE the product → expect 200 {ok: true}
    3. Verify product is gone via GET /api/products
    """
    print_test_header("SCENARIO A: Delete Unused Product (Expect 200)")
    
    # Step 1: Create a new product
    print("\nStep 1: Creating new test product...")
    create_url = f"{BASE_URL}/products"
    product_data = {
        "sku": "TST-DEL-01",
        "name": "Produk Uji Hapus",
        "category": "Karkas",
        "unit": "kg",
        "packagingType": "colly",
        "basePrice": 1000
    }
    
    try:
        response = session.post(create_url, json=product_data, verify=False)
        print(f"Create product response: {response.status_code}")
        
        if response.status_code == 201:
            product = response.json().get('data', {})
            product_id = product.get('id')
            print_result(True, f"Product created: {product.get('name')} (ID: {product_id})")
        else:
            print_result(False, f"Failed to create product: {response.status_code}")
            print(f"Response: {response.text}")
            return False
    except Exception as e:
        print_result(False, f"Error creating product: {str(e)}")
        return False
    
    # Step 2: Delete the product
    print(f"\nStep 2: Deleting product {product_id}...")
    delete_url = f"{BASE_URL}/products/{product_id}"
    
    try:
        response = session.delete(delete_url, verify=False)
        print(f"Delete response status: {response.status_code}")
        print(f"Delete response body: {response.text}")
        
        if response.status_code == 200:
            data = response.json()
            if data.get('ok') == True:
                print_result(True, f"Product deleted successfully with 200 OK")
            else:
                print_result(False, f"Expected {{ok: true}}, got: {data}")
                return False
        else:
            print_result(False, f"Expected 200, got {response.status_code}")
            return False
    except Exception as e:
        print_result(False, f"Error deleting product: {str(e)}")
        return False
    
    # Step 3: Verify product is gone
    print(f"\nStep 3: Verifying product is deleted...")
    search_url = f"{BASE_URL}/products?q=TST-DEL-01"
    
    try:
        response = session.get(search_url, verify=False)
        if response.status_code == 200:
            products = response.json().get('data', [])
            found = any(p.get('sku') == 'TST-DEL-01' for p in products)
            
            if not found:
                print_result(True, f"Product TST-DEL-01 not found in search results (correctly deleted)")
            else:
                print_result(False, f"Product TST-DEL-01 still exists after deletion")
                return False
        else:
            print_result(False, f"Failed to search products: {response.status_code}")
            return False
    except Exception as e:
        print_result(False, f"Error searching products: {str(e)}")
        return False
    
    return True

def test_scenario_b_referenced_product_delete(session):
    """
    TEST SCENARIO B: Referenced product cannot be deleted (409, not 500)
    1. Find a product that IS referenced by inventory or transactions
    2. DELETE the product → expect 409 (NOT 500)
    3. Verify error message is in Indonesian and mentions "sudah dipakai di transaksi"
    4. Verify product still exists
    """
    print_test_header("SCENARIO B: Delete Referenced Product (Expect 409)")
    
    # Step 1: Find a product with inventory stock (referenced)
    print("\nStep 1: Finding a product with inventory stock...")
    stocks_url = f"{BASE_URL}/inventory/stocks?status=all"
    
    try:
        response = session.get(stocks_url, verify=False)
        print(f"Get stocks response: {response.status_code}")
        
        if response.status_code == 200:
            stocks = response.json().get('data', [])
            if len(stocks) == 0:
                print_result(False, "No inventory stocks found. Cannot test referenced product deletion.")
                return False
            
            # Get the first stock's product ID
            referenced_product_id = stocks[0].get('productId')
            product_name = stocks[0].get('productName', 'Unknown')
            print_result(True, f"Found referenced product: {product_name} (ID: {referenced_product_id})")
        else:
            print_result(False, f"Failed to get inventory stocks: {response.status_code}")
            return False
    except Exception as e:
        print_result(False, f"Error getting inventory stocks: {str(e)}")
        return False
    
    # Step 2: Try to delete the referenced product
    print(f"\nStep 2: Attempting to delete referenced product {referenced_product_id}...")
    delete_url = f"{BASE_URL}/products/{referenced_product_id}"
    
    try:
        response = session.delete(delete_url, verify=False)
        print(f"Delete response status: {response.status_code}")
        print(f"Delete response body: {response.text}")
        
        # CRITICAL: Must be 409, NOT 500
        if response.status_code == 409:
            print_result(True, f"Correctly returned 409 Conflict (NOT 500)")
            
            # Check error message
            data = response.json()
            error_message = data.get('error', '')
            
            # Verify Indonesian message
            if 'sudah dipakai di transaksi' in error_message.lower():
                print_result(True, f"Error message contains 'sudah dipakai di transaksi'")
            else:
                print_result(False, f"Error message missing expected Indonesian text")
                print(f"Actual message: {error_message}")
            
            # Verify it suggests setting status Inactive
            if 'inactive' in error_message.lower():
                print_result(True, f"Error message suggests setting status Inactive")
            else:
                print_result(False, f"Error message doesn't suggest Inactive status")
            
            print(f"\n📝 Full error message: {error_message}")
            
        elif response.status_code == 500:
            print_result(False, f"❌ CRITICAL BUG: Got 500 error (should be 409)")
            print(f"This is the bug that was supposed to be fixed!")
            return False
        else:
            print_result(False, f"Expected 409, got {response.status_code}")
            return False
    except Exception as e:
        print_result(False, f"Error deleting referenced product: {str(e)}")
        return False
    
    # Step 3: Verify product still exists
    print(f"\nStep 3: Verifying product still exists...")
    get_url = f"{BASE_URL}/products/{referenced_product_id}"
    
    try:
        response = session.get(get_url, verify=False)
        if response.status_code == 200:
            product = response.json().get('data', {})
            print_result(True, f"Product still exists: {product.get('name')}")
        else:
            print_result(False, f"Product was deleted or not found: {response.status_code}")
            return False
    except Exception as e:
        print_result(False, f"Error verifying product: {str(e)}")
        return False
    
    return True

def test_scenario_c_auth_guard(session):
    """
    TEST SCENARIO C: Auth guard - DELETE without login should return 401
    """
    print_test_header("SCENARIO C: Auth Guard (Expect 401)")
    
    print("\nAttempting to DELETE product without authentication...")
    
    # Create a new session without cookies (no login)
    unauthenticated_session = requests.Session()
    
    # Try to delete any product (use a fake ID)
    delete_url = f"{BASE_URL}/products/fake-product-id"
    
    try:
        response = unauthenticated_session.delete(delete_url, verify=False)
        print(f"Delete response status: {response.status_code}")
        print(f"Delete response body: {response.text}")
        
        if response.status_code == 401:
            print_result(True, f"Correctly returned 401 Unauthorized")
            return True
        else:
            print_result(False, f"Expected 401, got {response.status_code}")
            return False
    except Exception as e:
        print_result(False, f"Error testing auth guard: {str(e)}")
        return False

def main():
    """Run all test scenarios"""
    print("\n" + "="*80)
    print("BACKEND TEST: DELETE /api/products/:id BUGFIX")
    print("Testing fix for SQLITE_CONSTRAINT_FOREIGNKEY (500 → 409)")
    print("="*80)
    
    # Login as admin
    session = login_admin()
    if not session:
        print("\n❌ FATAL: Could not login as admin. Aborting tests.")
        sys.exit(1)
    
    # Run test scenarios
    results = {
        "Scenario A (Unused Product Delete)": test_scenario_a_unused_product_delete(session),
        "Scenario B (Referenced Product 409)": test_scenario_b_referenced_product_delete(session),
        "Scenario C (Auth Guard 401)": test_scenario_c_auth_guard(session),
    }
    
    # Print summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{status}: {test_name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED! Bugfix verified successfully.")
        sys.exit(0)
    else:
        print(f"\n⚠️  {total - passed} test(s) failed. Review the output above.")
        sys.exit(1)

if __name__ == "__main__":
    main()
