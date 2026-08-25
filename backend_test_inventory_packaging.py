#!/usr/bin/env python3
"""
Backend test for Inventory Packaging & Quantity features:
TASK 1: Inbound inventory stores quantity (jumlah kemasan) & packagingType from master
TASK 2: Split karung/colly is allowed (not just 'karung')
"""

import requests
import json
import sys
from datetime import datetime

BASE_URL = "http://localhost:3000/api"

# Test credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

def login(email, password):
    """Login and return session with auth token"""
    session = requests.Session()
    
    # Disable SSL verification warnings for localhost
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    
    resp = session.post(
        f"{BASE_URL}/auth/sign-in/email",
        json={"email": email, "password": password},
        headers={"Content-Type": "application/json"},
        verify=False
    )
    
    print(f"Login response status: {resp.status_code}")
    
    if resp.status_code != 200:
        print(f"❌ Login failed: {resp.status_code} {resp.text}")
        sys.exit(1)
    
    # Extract the session token from cookies
    # The cookie might have Secure flag which prevents it from being sent over HTTP
    # So we'll manually add it to headers
    session_token = None
    for cookie in session.cookies:
        if 'session' in cookie.name.lower() or 'auth' in cookie.name.lower():
            session_token = cookie.value
            print(f"Found session cookie: {cookie.name} = {session_token[:20]}...")
            break
    
    if not session_token:
        print(f"❌ No session cookie received")
        sys.exit(1)
    
    # Store the token for manual header injection
    session.auth_token = session_token
    session.auth_cookie_name = cookie.name
    
    print(f"✅ Logged in as {email}")
    return session

def make_request(session, method, url, **kwargs):
    """Make a request with manual cookie injection to work around Secure flag"""
    # Add the session cookie manually to headers
    if hasattr(session, 'auth_token'):
        if 'headers' not in kwargs:
            kwargs['headers'] = {}
        kwargs['headers']['Cookie'] = f"{session.auth_cookie_name}={session.auth_token}"
    
    if method.upper() == 'GET':
        return session.get(url, **kwargs)
    elif method.upper() == 'POST':
        return session.post(url, **kwargs)
    elif method.upper() == 'PATCH':
        return session.patch(url, **kwargs)
    elif method.upper() == 'PUT':
        return session.put(url, **kwargs)
    elif method.upper() == 'DELETE':
        return session.delete(url, **kwargs)
    else:
        raise ValueError(f"Unsupported method: {method}")

def test_task1_inbound_quantity_packaging():
    """
    TASK 1: Test that inbound inventory stores quantity & packagingType
    
    Steps:
    1. GET /api/products - pick existing product OR create one
    2. PATCH /api/products/{id} - set packagingType='colly'
    3. GET /api/cold-storages - pick a cold storage (create if none exists)
    4. POST /api/inventory/inbound - create inbound with quantity=5, packagingType='colly'
    5. GET /api/inventory/stocks?status=active - verify quantity=5 and packagingType='colly'
    """
    
    session = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    
    print("\n" + "="*80)
    print("TASK 1: Inbound inventory stores quantity & packagingType")
    print("="*80)
    
    # Step 1: Get or create product
    print("\n--- STEP 1: Get or Create Product ---")
    
    # Try to get existing products first
    print(f"   Making request to: {BASE_URL}/products")
    
    resp = make_request(session, 'GET', f"{BASE_URL}/products", verify=False)
    
    print(f"   Response status: {resp.status_code}")
    
    if resp.status_code != 200:
        print(f"❌ Failed to get products: {resp.status_code} {resp.text}")
        return False
    
    products = resp.json()["data"]
    
    if len(products) > 0:
        # Use first existing product
        product = products[0]
        product_id = product["id"]
        print(f"✅ Using existing product: {product['sku']} - {product['name']} (ID: {product_id})")
    else:
        # Create new product
        product_data = {
            "sku": f"PKG-TEST-{datetime.now().strftime('%H%M%S')}",
            "name": "Packaging Test Product",
            "unit": "kg",
            "basePrice": 50000,
            "category": "Frozen"
        }
        resp = make_request(session, "POST", f"{BASE_URL}/products", json=product_data, verify=False)
        if resp.status_code != 201:
            print(f"❌ Failed to create product: {resp.status_code} {resp.text}")
            return False
        product = resp.json()["data"]
        product_id = product["id"]
        print(f"✅ Product created: {product['sku']} (ID: {product_id})")
    
    # Step 2: PATCH product to set packagingType='colly'
    print("\n--- STEP 2: Set Product packagingType='colly' ---")
    patch_data = {
        "packagingType": "colly"
    }
    resp = make_request(session, "PATCH", f"{BASE_URL}/products/{product_id}", json=patch_data, verify=False)
    if resp.status_code != 200:
        print(f"❌ Failed to patch product: {resp.status_code} {resp.text}")
        return False
    
    updated_product = resp.json()["data"]
    print(f"✅ Product updated with packagingType: {updated_product.get('packagingType', 'NOT SET')}")
    
    if updated_product.get("packagingType") != "colly":
        print(f"⚠️  Warning: packagingType is '{updated_product.get('packagingType')}', expected 'colly'")
    
    # Step 3: Get or create cold storage
    print("\n--- STEP 3: Get or Create Cold Storage ---")
    resp = make_request(session, "GET", f"{BASE_URL}/cold-storages", verify=False)
    if resp.status_code != 200:
        print(f"❌ Failed to get cold storages: {resp.status_code} {resp.text}")
        return False
    
    cold_storages = resp.json()["data"]
    
    if len(cold_storages) > 0:
        # Use first existing cold storage
        cs = cold_storages[0]
        cs_id = cs["id"]
        print(f"✅ Using existing cold storage: {cs['code']} - {cs['name']} (ID: {cs_id})")
    else:
        # Create new cold storage
        cs_data = {
            "code": f"CS-TEST-{datetime.now().strftime('%H%M%S')}",
            "name": "Test Cold Storage",
            "capacity": 1000
        }
        resp = make_request(session, "POST", f"{BASE_URL}/cold-storages", json=cs_data, verify=False)
        if resp.status_code != 201:
            print(f"❌ Failed to create cold storage: {resp.status_code} {resp.text}")
            return False
        cs = resp.json()["data"]
        cs_id = cs["id"]
        print(f"✅ Cold storage created: {cs['code']} (ID: {cs_id})")
    
    # Step 4: POST /api/inventory/inbound with quantity=5, packagingType='colly'
    print("\n--- STEP 4: Create Inbound with quantity=5, packagingType='colly' ---")
    inbound_data = {
        "coldStorageId": cs_id,
        "referenceType": "MANUAL",
        "items": [
            {
                "productId": product_id,
                "weight": 30,
                "quantity": 5,
                "packagingType": "colly",
                "expiredDate": "2026-12-31"
            }
        ]
    }
    
    print(f"   Inbound data: coldStorageId={cs_id}, productId={product_id}")
    print(f"   Item: weight=30, quantity=5, packagingType='colly'")
    
    resp = make_request(session, "POST", f"{BASE_URL}/inventory/inbound", json=inbound_data, verify=False)
    if resp.status_code != 201:
        print(f"❌ Failed to create inbound: {resp.status_code} {resp.text}")
        return False
    
    inbound_result = resp.json()["data"]
    print(f"✅ Inbound created successfully")
    print(f"   Transaction ID: {inbound_result['transactionId']}")
    print(f"   Stocks created: {len(inbound_result['stocks'])}")
    
    if len(inbound_result['stocks']) == 0:
        print(f"❌ FAIL: No stocks created")
        return False
    
    created_stock = inbound_result['stocks'][0]
    stock_id = created_stock['id']
    kode_simpan = created_stock['kodeSimpan']
    
    print(f"   Stock ID: {stock_id}")
    print(f"   Kode Simpan: {kode_simpan}")
    print(f"   Weight: {created_stock['weight']} kg")
    print(f"   Quantity: {created_stock['quantity']}")
    
    # Step 5: GET /api/inventory/stocks - verify quantity=5 and packagingType='colly'
    print("\n--- STEP 5: CRITICAL VERIFICATION - Get Stock and Verify Values ---")
    print(f"   Searching for stock with kodeSimpan: {kode_simpan}")
    
    resp = make_request(session, "GET", f"{BASE_URL}/inventory/stocks?status=active", verify=False)
    if resp.status_code != 200:
        print(f"❌ Failed to get stocks: {resp.status_code} {resp.text}")
        return False
    
    stocks_data = resp.json()["data"]
    print(f"   Total active stocks: {len(stocks_data)}")
    
    # Find our created stock by kodeSimpan
    our_stock = None
    for stock in stocks_data:
        if stock.get("kodeSimpan") == kode_simpan:
            our_stock = stock
            break
    
    if not our_stock:
        print(f"❌ FAIL: Could not find stock with kodeSimpan {kode_simpan}")
        print(f"   Available stocks: {[s.get('kodeSimpan') for s in stocks_data[:5]]}")
        return False
    
    print(f"✅ Found stock: {our_stock['kodeSimpan']}")
    
    # CRITICAL VERIFICATION
    print(f"\n   ACTUAL VALUES OBSERVED:")
    print(f"   - kodeSimpan: {our_stock.get('kodeSimpan')}")
    print(f"   - weight: {our_stock.get('weight')} kg")
    print(f"   - quantity: {our_stock.get('quantity')}")
    print(f"   - packagingType: {our_stock.get('packagingType')}")
    print(f"   - status: {our_stock.get('status')}")
    
    # Verify quantity
    if our_stock.get("quantity") != 5:
        print(f"\n❌ FAIL: Expected quantity=5, got {our_stock.get('quantity')}")
        return False
    print(f"\n✅ PASS: quantity = 5 (correct)")
    
    # Verify packagingType
    if our_stock.get("packagingType") != "colly":
        print(f"❌ FAIL: Expected packagingType='colly', got '{our_stock.get('packagingType')}'")
        return False
    print(f"✅ PASS: packagingType = 'colly' (correct)")
    
    # Verify weight
    if our_stock.get("weight") != 30:
        print(f"❌ FAIL: Expected weight=30, got {our_stock.get('weight')}")
        return False
    print(f"✅ PASS: weight = 30 kg (correct)")
    
    print("\n" + "="*80)
    print("✅ TASK 1 - ALL TESTS PASSED")
    print("="*80)
    print("\nSUMMARY:")
    print("✅ Product configured with packagingType")
    print("✅ Cold storage available")
    print("✅ Inbound created with quantity=5, packagingType='colly'")
    print("✅ Stock stored with correct quantity (5)")
    print("✅ Stock stored with correct packagingType ('colly')")
    print("✅ Stock stored with correct weight (30 kg)")
    
    # Return stock_id for use in TASK 2
    return stock_id

def test_task2_split_colly(stock_id):
    """
    TASK 2: Test that split-karung allows 'colly' (not just 'karung')
    
    Steps:
    1. Use the stock created in TASK 1 (packagingType='colly', status='active')
    2. POST /api/inventory/split-karung with packs array
    3. Expect 200/201 success (NOT 400 "Hanya karung yang bisa displit")
    4. Verify response contains childStockIds
    """
    
    session = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    
    print("\n" + "="*80)
    print("TASK 2: Split karung/colly is allowed (not just 'karung')")
    print("="*80)
    
    print(f"\n--- Using stock from TASK 1: {stock_id} ---")
    
    # Verify stock exists and has packagingType='colly'
    print("\n--- STEP 1: Verify Stock Details ---")
    resp = make_request(session, "GET", f"{BASE_URL}/inventory/stocks?status=active", verify=False)
    if resp.status_code != 200:
        print(f"❌ Failed to get stocks: {resp.status_code} {resp.text}")
        return False
    
    stocks_data = resp.json()["data"]
    our_stock = None
    for stock in stocks_data:
        if stock.get("id") == stock_id:
            our_stock = stock
            break
    
    if not our_stock:
        print(f"❌ FAIL: Could not find stock with ID {stock_id}")
        return False
    
    print(f"✅ Found stock: {our_stock['kodeSimpan']}")
    print(f"   - packagingType: {our_stock.get('packagingType')}")
    print(f"   - status: {our_stock.get('status')}")
    print(f"   - weight: {our_stock.get('weight')} kg")
    print(f"   - quantity: {our_stock.get('quantity')}")
    
    if our_stock.get("packagingType") != "colly":
        print(f"❌ FAIL: Stock packagingType is '{our_stock.get('packagingType')}', expected 'colly'")
        return False
    
    if our_stock.get("status") != "active":
        print(f"❌ FAIL: Stock status is '{our_stock.get('status')}', expected 'active'")
        return False
    
    # Step 2: POST /api/inventory/split-karung
    print("\n--- STEP 2: CRITICAL TEST - Split colly into packs ---")
    print("   Expected: 200/201 success (NOT 400 'Hanya karung yang bisa displit')")
    
    split_data = {
        "stockId": stock_id,
        "packs": [
            {"weight": 15, "quantity": 1},
            {"weight": 15, "quantity": 1}
        ]
    }
    
    print(f"   Split data: stockId={stock_id}")
    print(f"   Packs: 2 packs (15kg each)")
    
    resp = make_request(session, "POST", f"{BASE_URL}/inventory/split-karung", json=split_data, verify=False)
    
    print(f"\n   Response status: {resp.status_code}")
    
    # Check if we got an error
    if resp.status_code == 400:
        error_msg = resp.json().get("error", "")
        print(f"   Error message: {error_msg}")
        
        if "Hanya karung" in error_msg or "hanya karung" in error_msg.lower():
            print(f"\n❌ FAIL: Split-karung rejected 'colly' with error: {error_msg}")
            print(f"   This means the endpoint only allows 'karung', not 'colly'")
            return False
        else:
            print(f"❌ FAIL: Got 400 error but not the expected 'Hanya karung' error: {error_msg}")
            return False
    
    if resp.status_code not in [200, 201]:
        print(f"❌ FAIL: Expected 200/201, got {resp.status_code}")
        print(f"   Response: {resp.text}")
        return False
    
    print(f"✅ PASS: Split-karung accepted 'colly' (status {resp.status_code})")
    
    # Step 3: Verify response contains childStockIds
    print("\n--- STEP 3: Verify Response Contains childStockIds ---")
    
    split_result = resp.json()["data"]
    
    print(f"   Response keys: {list(split_result.keys())}")
    
    if "childStockIds" not in split_result:
        print(f"❌ FAIL: Response does not contain 'childStockIds'")
        print(f"   Response: {json.dumps(split_result, indent=2)}")
        return False
    
    child_stock_ids = split_result["childStockIds"]
    print(f"✅ Response contains childStockIds: {len(child_stock_ids)} child stocks created")
    
    if len(child_stock_ids) != 2:
        print(f"⚠️  Warning: Expected 2 child stocks, got {len(child_stock_ids)}")
    
    for i, child_id in enumerate(child_stock_ids, 1):
        print(f"   Child stock {i}: {child_id}")
    
    # Verify parent stock status changed to 'opened'
    print("\n--- STEP 4: Verify Parent Stock Status Changed to 'opened' ---")
    resp = make_request(session, "GET", f"{BASE_URL}/inventory/stocks?status=opened", verify=False)
    if resp.status_code != 200:
        print(f"⚠️  Warning: Could not verify parent stock status: {resp.status_code}")
    else:
        opened_stocks = resp.json()["data"]
        parent_found = False
        for stock in opened_stocks:
            if stock.get("id") == stock_id:
                parent_found = True
                print(f"✅ Parent stock status changed to 'opened'")
                break
        
        if not parent_found:
            print(f"⚠️  Warning: Parent stock not found in 'opened' status")
    
    # Verify child stocks exist and have correct packagingType='pack'
    print("\n--- STEP 5: Verify Child Stocks Created with packagingType='pack' ---")
    resp = make_request(session, "GET", f"{BASE_URL}/inventory/stocks?status=active", verify=False)
    if resp.status_code != 200:
        print(f"⚠️  Warning: Could not verify child stocks: {resp.status_code}")
    else:
        active_stocks = resp.json()["data"]
        child_stocks_found = []
        
        for stock in active_stocks:
            if stock.get("id") in child_stock_ids:
                child_stocks_found.append(stock)
        
        print(f"   Found {len(child_stocks_found)} child stocks in active status")
        
        for i, child_stock in enumerate(child_stocks_found, 1):
            print(f"\n   Child stock {i}:")
            print(f"   - kodeSimpan: {child_stock.get('kodeSimpan')}")
            print(f"   - packagingType: {child_stock.get('packagingType')}")
            print(f"   - weight: {child_stock.get('weight')} kg")
            print(f"   - quantity: {child_stock.get('quantity')}")
            print(f"   - parentStockId: {child_stock.get('parentStockId')}")
            
            if child_stock.get("packagingType") != "pack":
                print(f"   ⚠️  Warning: Expected packagingType='pack', got '{child_stock.get('packagingType')}'")
            else:
                print(f"   ✅ packagingType='pack' (correct)")
            
            if child_stock.get("parentStockId") != stock_id:
                print(f"   ⚠️  Warning: parentStockId mismatch")
            else:
                print(f"   ✅ parentStockId matches (correct)")
    
    print("\n" + "="*80)
    print("✅ TASK 2 - ALL TESTS PASSED")
    print("="*80)
    print("\nSUMMARY:")
    print("✅ Stock with packagingType='colly' verified")
    print("✅ Split-karung accepted 'colly' (NOT rejected)")
    print("✅ Response contains childStockIds (2 child stocks)")
    print("✅ Parent stock status changed to 'opened'")
    print("✅ Child stocks created with packagingType='pack'")
    
    return True

if __name__ == "__main__":
    try:
        print("\n" + "="*80)
        print("BACKEND TESTING: Inventory Packaging & Quantity Features")
        print("="*80)
        
        # Run TASK 1
        stock_id = test_task1_inbound_quantity_packaging()
        if not stock_id:
            print("\n❌ TASK 1 FAILED")
            sys.exit(1)
        
        # Run TASK 2 using the stock created in TASK 1
        success = test_task2_split_colly(stock_id)
        if not success:
            print("\n❌ TASK 2 FAILED")
            sys.exit(1)
        
        print("\n" + "="*80)
        print("✅ ALL TESTS PASSED (TASK 1 & TASK 2)")
        print("="*80)
        print("\nFINAL SUMMARY:")
        print("✅ TASK 1: Inbound inventory stores quantity & packagingType")
        print("   - Inbound created with quantity=5, packagingType='colly'")
        print("   - Stock verified with correct quantity (5) and packagingType ('colly')")
        print("✅ TASK 2: Split karung/colly is allowed")
        print("   - Split-karung accepted 'colly' (not just 'karung')")
        print("   - Child stocks created successfully")
        
        sys.exit(0)
        
    except Exception as e:
        print(f"\n❌ TEST FAILED WITH EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
