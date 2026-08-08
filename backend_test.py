#!/usr/bin/env python3
"""
Backend test for Receipt (Penerimaan) bugfix: 
Receipts must use REAL SHIPPED weight (from Surat Jalan) as basis, not original SO weight.
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
    """Login and return session"""
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
    print(f"Login response cookies: {session.cookies.get_dict()}")
    
    if resp.status_code != 200:
        print(f"❌ Login failed: {resp.status_code} {resp.text}")
        sys.exit(1)
    
    # Check if we got the session cookie
    if 'better-auth.session_token' not in session.cookies:
        print(f"❌ No session cookie received")
        print(f"Response headers: {resp.headers}")
        sys.exit(1)
    
    print(f"✅ Logged in as {email}")
    return session

def test_receipt_shipped_weight_basis():
    """
    Test that receipts use REAL SHIPPED weight as basis, not original SO weight.
    
    Steps:
    1. Create product PR (POST /api/products)
    2. Create customer CUST (POST /api/contacts)
    3. Create SO (non-dropship) with item weight=100, unitPrice=50000 → total 5,000,000
    4. Advance status Draft→Confirmed→Packed
    5. Create Surat Jalan with shippedWeight=80 → SO total should become 4,000,000
    6. Create receipt with receivedWeight=75 → verify orderedWeight (basis) == 80, shrinkageWeight == 5
    7. Try receipt with receivedWeight=85 (>80) → should be rejected with error about exceeding 80 kg
    """
    
    session = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    
    print("\n" + "="*80)
    print("TEST: Receipt (Penerimaan) uses REAL SHIPPED weight as basis")
    print("="*80)
    
    # Step 1: Create product
    print("\n--- STEP 1: Create Product ---")
    product_data = {
        "sku": "RCP-PR1",
        "name": "Rcp Prod",
        "unit": "kg",
        "basePrice": 50000
    }
    resp = session.post(f"{BASE_URL}/products", json=product_data, verify=False)
    print(f"Create product response: {resp.status_code}")
    if resp.status_code != 201:
        print(f"❌ Failed to create product: {resp.status_code} {resp.text}")
        return False
    product = resp.json()["data"]
    product_id = product["id"]
    print(f"✅ Product created: {product['sku']} (ID: {product_id})")
    
    # Step 2: Create customer
    print("\n--- STEP 2: Create Customer ---")
    customer_data = {
        "categories": ["Customer"],
        "displayName": "Rcp Cust",
        "code": "CUST-RCP1"
    }
    resp = session.post(f"{BASE_URL}/contacts", json=customer_data, verify=False)
    if resp.status_code != 201:
        print(f"❌ Failed to create customer: {resp.status_code} {resp.text}")
        return False
    customer = resp.json()["data"]
    customer_id = customer["id"]
    print(f"✅ Customer created: {customer['displayName']} (ID: {customer_id})")
    
    # Step 3: Create SO with item weight=100, unitPrice=50000
    print("\n--- STEP 3: Create Sales Order ---")
    so_data = {
        "customerId": customer_id,
        "orderDate": datetime.now().isoformat(),
        "fulfillmentType": "stock",  # non-dropship
        "items": [
            {
                "productId": product_id,
                "quantity": 1,
                "weight": 100,
                "unitPrice": 50000
            }
        ]
    }
    resp = session.post(f"{BASE_URL}/sales-orders", json=so_data, verify=False)
    if resp.status_code != 201:
        print(f"❌ Failed to create SO: {resp.status_code} {resp.text}")
        return False
    so = resp.json()["data"]
    so_id = so["id"]
    so_number = so["soNumber"]
    print(f"✅ SO created: {so_number} (ID: {so_id})")
    print(f"   Initial totalAmount: Rp {so['totalAmount']:,}")
    
    if so["totalAmount"] != 5000000:
        print(f"❌ FAIL: Expected SO total 5,000,000, got {so['totalAmount']}")
        return False
    print(f"✅ SO total correct: Rp 5,000,000 (50000 × 100kg)")
    
    # Get SO item ID
    resp = session.get(f"{BASE_URL}/sales-orders/{so_id}", verify=False)
    if resp.status_code != 200:
        print(f"❌ Failed to get SO detail: {resp.status_code}")
        return False
    so_detail = resp.json()["data"]
    so_item_id = so_detail["items"][0]["id"]
    print(f"   SO item ID: {so_item_id}")
    
    # Step 4: Advance status Draft→Confirmed→Packed
    print("\n--- STEP 4: Advance SO Status ---")
    
    # Draft → Confirmed
    resp = session.post(
        f"{BASE_URL}/sales-orders/{so_id}/status",
        json={"status": "Confirmed"},
        verify=False
    )
    if resp.status_code != 200:
        print(f"❌ Failed to advance to Confirmed: {resp.status_code} {resp.text}")
        return False
    print(f"✅ SO advanced to Confirmed")
    
    # Confirmed → Packed
    resp = session.post(
        f"{BASE_URL}/sales-orders/{so_id}/status",
        json={"status": "Packed"},
        verify=False
    )
    if resp.status_code != 200:
        print(f"❌ Failed to advance to Packed: {resp.status_code} {resp.text}")
        return False
    print(f"✅ SO advanced to Packed")
    
    # Step 5: Create Surat Jalan with shippedWeight=80
    print("\n--- STEP 5: Create Surat Jalan with shippedWeight=80 ---")
    sj_data = {
        "items": [
            {
                "itemId": so_item_id,
                "shippedWeight": 80
            }
        ]
    }
    resp = session.post(f"{BASE_URL}/sales-orders/{so_id}/surat-jalan", json=sj_data, verify=False)
    if resp.status_code != 201:
        print(f"❌ Failed to create Surat Jalan: {resp.status_code} {resp.text}")
        return False
    sj = resp.json()["data"]
    print(f"✅ Surat Jalan created: {sj['sjNumber']}")
    
    # Verify SO total recomputed to 4,000,000 (50000 × 80)
    resp = session.get(f"{BASE_URL}/sales-orders/{so_id}", verify=False)
    if resp.status_code != 200:
        print(f"❌ Failed to get SO detail: {resp.status_code}")
        return False
    so_detail = resp.json()["data"]
    print(f"   SO totalAmount after SJ: Rp {so_detail['totalAmount']:,}")
    
    if so_detail["totalAmount"] != 4000000:
        print(f"❌ FAIL: Expected SO total 4,000,000 after SJ, got {so_detail['totalAmount']}")
        return False
    print(f"✅ SO total recomputed correctly: Rp 4,000,000 (50000 × 80kg shipped)")
    
    # Verify item shippedWeight recorded
    item_shipped_weight = so_detail["items"][0].get("shippedWeight")
    print(f"   Item shippedWeight: {item_shipped_weight} kg")
    if item_shipped_weight != 80:
        print(f"❌ FAIL: Expected shippedWeight 80, got {item_shipped_weight}")
        return False
    print(f"✅ Item shippedWeight recorded correctly: 80 kg")
    
    # Step 6: CRITICAL TEST - Create receipt with receivedWeight=75
    print("\n--- STEP 6: CRITICAL TEST - Create Receipt with receivedWeight=75 ---")
    print("   Expected: orderedWeight (basis) = 80 (SHIPPED weight, NOT 100)")
    print("   Expected: shrinkageWeight = 5 (80 - 75)")
    
    receipt_data = {
        "items": [
            {
                "productId": product_id,
                "receivedWeight": 75
            }
        ]
    }
    resp = session.post(f"{BASE_URL}/sales-orders/{so_id}/receipts", json=receipt_data, verify=False)
    if resp.status_code != 201:
        print(f"❌ Failed to create receipt: {resp.status_code} {resp.text}")
        return False
    receipt = resp.json()["data"]
    print(f"✅ Receipt created: {receipt['receiptNumber']}")
    
    # Verify receipt line values
    receipt_item = receipt["items"][0]
    ordered_weight = receipt_item["orderedWeight"]
    received_weight = receipt_item["receivedWeight"]
    shrinkage_weight = receipt_item["shrinkageWeight"]
    
    print(f"\n   ACTUAL VALUES:")
    print(f"   - orderedWeight (basis): {ordered_weight} kg")
    print(f"   - receivedWeight: {received_weight} kg")
    print(f"   - shrinkageWeight: {shrinkage_weight} kg")
    
    # CRITICAL VERIFICATION
    if ordered_weight != 80:
        print(f"\n❌ FAIL: orderedWeight (basis) should be 80 (SHIPPED weight), got {ordered_weight}")
        print(f"   This means the receipt is using ORIGINAL SO weight (100) instead of SHIPPED weight (80)")
        return False
    print(f"\n✅ PASS: orderedWeight (basis) = 80 kg (SHIPPED weight, NOT original 100 kg)")
    
    if shrinkage_weight != 5:
        print(f"❌ FAIL: shrinkageWeight should be 5 (80-75), got {shrinkage_weight}")
        return False
    print(f"✅ PASS: shrinkageWeight = 5 kg (80 - 75)")
    
    # Step 7: Over-cap test - Try to create receipt with receivedWeight=85 (>80 shipped)
    print("\n--- STEP 7: Over-cap Test - receivedWeight=85 (exceeds shipped 80) ---")
    print("   Expected: 400 rejection with error about exceeding 80 kg")
    
    receipt_data_overcap = {
        "items": [
            {
                "productId": product_id,
                "receivedWeight": 85
            }
        ]
    }
    resp = session.post(f"{BASE_URL}/sales-orders/{so_id}/receipts", json=receipt_data_overcap, verify=False)
    
    if resp.status_code == 201:
        print(f"❌ FAIL: Receipt with receivedWeight=85 should be REJECTED, but got 201")
        return False
    
    if resp.status_code != 400:
        print(f"❌ FAIL: Expected 400 rejection, got {resp.status_code}")
        return False
    
    error_message = resp.json().get("error", "")
    print(f"\n   ACTUAL ERROR MESSAGE:")
    print(f"   {error_message}")
    
    # Verify error message mentions 80 kg (shipped weight), not 100 kg
    if "80" not in error_message:
        print(f"\n❌ FAIL: Error message should reference 80 kg (shipped weight), not 100 kg")
        print(f"   This means validation is using ORIGINAL SO weight instead of SHIPPED weight")
        return False
    
    if "85" not in error_message:
        print(f"❌ FAIL: Error message should mention received weight 85 kg")
        return False
    
    print(f"\n✅ PASS: Receipt correctly rejected with error referencing 80 kg (shipped weight)")
    
    print("\n" + "="*80)
    print("✅ ALL TESTS PASSED")
    print("="*80)
    print("\nSUMMARY:")
    print("✅ Step 1: Product created")
    print("✅ Step 2: Customer created")
    print("✅ Step 3: SO created with weight=100, total=5,000,000")
    print("✅ Step 4: SO advanced Draft→Confirmed→Packed")
    print("✅ Step 5: Surat Jalan created with shippedWeight=80, SO total→4,000,000")
    print("✅ Step 6: Receipt created with receivedWeight=75")
    print("   - orderedWeight (basis) = 80 kg (SHIPPED weight, NOT 100)")
    print("   - shrinkageWeight = 5 kg (80 - 75)")
    print("✅ Step 7: Receipt with receivedWeight=85 rejected (exceeds 80 kg shipped)")
    print("\n✅ BUGFIX VERIFIED: Receipts use REAL SHIPPED weight as basis")
    
    return True

if __name__ == "__main__":
    try:
        success = test_receipt_shipped_weight_basis()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ TEST FAILED WITH EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
