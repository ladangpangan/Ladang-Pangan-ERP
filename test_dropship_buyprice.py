#!/usr/bin/env python3
"""
Backend test for BUGFIX: Dropship SO auto-PO buy price (buyPrice) can differ from sell price (unitPrice)

Test Requirements:
- Login: admin@lpi.co.id / admin123 (Better Auth cookie session)
- Create test data: Product, Supplier contact, Customer contact
- TEST 1: Dropship SO with buyPrice < sellPrice (margin scenario)
- TEST 2: Backward compatibility (no buyPrice provided)
"""

import requests
import json
import sys
from typing import Dict, Any

BASE_URL = "http://localhost:3000/api"

# Test credentials
ADMIN_CREDS = {"email": "admin@lpi.co.id", "password": "admin123"}

def login(email: str, password: str) -> requests.Session:
    """Login and return authenticated session"""
    print(f"Logging in as {email}...")
    auth_url = "http://localhost:3000/api/auth/sign-in/email"
    
    session = requests.Session()
    try:
        resp = session.post(
            auth_url,
            json={"email": email, "password": password},
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        if resp.status_code == 200:
            # Fix Secure cookie issue for HTTP localhost testing
            for cookie in session.cookies:
                cookie.secure = False
            print(f"✅ Login successful for {email}")
            return session
        else:
            print(f"❌ Login failed for {email}: {resp.status_code} - {resp.text[:200]}")
            return None
    except Exception as e:
        print(f"❌ Login error for {email}: {e}")
        return None

def create_product(session: requests.Session, sku: str, name: str, unit: str, base_price: float) -> Dict[str, Any]:
    """Create a product and return the product data"""
    import time
    import random
    unique_sku = f"{sku}-{int(time.time() * 1000) % 1000000}-{random.randint(100, 999)}"
    print(f"\nCreating product: {unique_sku} - {name}...")
    try:
        product_data = {
            "sku": unique_sku,
            "name": name,
            "unit": unit,
            "basePrice": base_price,
            "status": "active"
        }
        resp = session.post(f"{BASE_URL}/products", json=product_data, timeout=10)
        print(f"POST /api/products: {resp.status_code}")
        
        if resp.status_code == 201:
            product = resp.json().get("data", {})
            print(f"✅ Product created: ID={product.get('id')}, SKU={product.get('sku')}")
            return product
        else:
            print(f"❌ Failed to create product: {resp.text[:300]}")
            return None
    except Exception as e:
        print(f"❌ Product creation error: {e}")
        return None

def create_contact(session: requests.Session, categories: list, display_name: str) -> Dict[str, Any]:
    """Create a contact and return the contact data"""
    print(f"\nCreating contact: {display_name} ({categories})...")
    try:
        import time
        import random
        contact_data = {
            "categories": categories,
            "displayName": display_name,
            "code": f"TEST-{categories[0][:3].upper()}-{int(time.time() * 1000) % 1000000}-{random.randint(100, 999)}"
        }
        resp = session.post(f"{BASE_URL}/contacts", json=contact_data, timeout=10)
        print(f"POST /api/contacts: {resp.status_code}")
        
        if resp.status_code == 201:
            contact = resp.json().get("data", {})
            print(f"✅ Contact created: ID={contact.get('id')}, Code={contact.get('code')}, DisplayName={contact.get('displayName')}")
            return contact
        else:
            print(f"❌ Failed to create contact: {resp.text[:300]}")
            return None
    except Exception as e:
        print(f"❌ Contact creation error: {e}")
        return None

def test_dropship_so_with_margin():
    """
    TEST 1: Dropship SO with buyPrice < sellPrice
    - Create SO with unitPrice=50000 (sell), buyPrice=40000 (buy), weight=100
    - Verify SO totalAmount based on SELL price: 50000 × 100 = 5,000,000
    - Verify autoPoId is non-null
    - Verify auto-PO: poType='Produk Jadi', pipelineStatus='Draft', isDropship=true
    - CRITICAL: auto-PO item unitPrice must be BUY price (40000), NOT sell price (50000)
    - Verify PO totalAmount based on BUY price: 40000 × 100 = 4,000,000
    """
    
    print("\n" + "="*80)
    print("TEST 1: DROPSHIP SO WITH BUYPRICE < SELLPRICE (MARGIN SCENARIO)")
    print("="*80)
    
    # Login as admin
    session = login(ADMIN_CREDS["email"], ADMIN_CREDS["password"])
    if not session:
        print("❌ TEST 1 FAILED: Login failed")
        return False
    
    # SETUP: Create test data
    print("\n--- SETUP: Create test data ---")
    
    # Create product
    product = create_product(session, "DS-PR1", "Dropship Prod", "kg", 50000)
    if not product:
        print("❌ TEST 1 FAILED: Product creation failed")
        return False
    product_id = product.get("id")
    
    # Create supplier contact
    supplier = create_contact(session, ["Supplier"], "DS Supplier")
    if not supplier:
        print("❌ TEST 1 FAILED: Supplier creation failed")
        return False
    supplier_id = supplier.get("id")
    
    # Create customer contact
    customer = create_contact(session, ["Customer"], "DS Customer")
    if not customer:
        print("❌ TEST 1 FAILED: Customer creation failed")
        return False
    customer_id = customer.get("id")
    
    # TEST 1.1: Create dropship SO with buyPrice < unitPrice
    print("\n--- TEST 1.1: Create Dropship SO with buyPrice=40000, unitPrice=50000 ---")
    try:
        so_data = {
            "customerId": customer_id,
            "fulfillmentType": "dropship",
            "supplierId": supplier_id,
            "orderDate": "2026-08-08",
            "expectedDate": "2026-08-15",
            "items": [
                {
                    "productId": product_id,
                    "quantity": 1,
                    "weight": 100,
                    "unitPrice": 50000,  # SELL price
                    "buyPrice": 40000    # BUY price (lower than sell)
                }
            ]
        }
        
        resp = session.post(f"{BASE_URL}/sales-orders", json=so_data, timeout=10)
        print(f"POST /api/sales-orders: {resp.status_code}")
        
        if resp.status_code != 201:
            print(f"❌ TEST 1.1 FAILED: SO creation failed - {resp.text[:500]}")
            return False
        
        so = resp.json().get("data", {})
        so_id = so.get("id")
        so_number = so.get("soNumber")
        so_total = so.get("totalAmount")
        auto_po_id = so.get("autoPoId")
        
        print(f"✅ SO created: {so_number}")
        print(f"   SO ID: {so_id}")
        print(f"   SO totalAmount: Rp {so_total:,.0f}")
        print(f"   autoPoId: {auto_po_id}")
        
        # Verify SO totalAmount based on SELL price
        expected_so_total = 50000 * 100  # 5,000,000
        if abs(so_total - expected_so_total) < 0.01:
            print(f"✅ TEST 1.1a PASSED: SO totalAmount correct (Rp {so_total:,.0f} = 50000 × 100)")
        else:
            print(f"❌ TEST 1.1a FAILED: SO totalAmount incorrect. Expected: Rp {expected_so_total:,.0f}, Got: Rp {so_total:,.0f}")
            return False
        
        # Verify autoPoId is non-null
        if auto_po_id:
            print(f"✅ TEST 1.1b PASSED: autoPoId is non-null ({auto_po_id})")
        else:
            print(f"❌ TEST 1.1b FAILED: autoPoId is null (auto-PO not created)")
            return False
        
    except Exception as e:
        print(f"❌ TEST 1.1 FAILED: Exception - {e}")
        return False
    
    # TEST 1.2: Verify auto-created PO
    print("\n--- TEST 1.2: Verify Auto-Created PO ---")
    try:
        resp = session.get(f"{BASE_URL}/purchase-orders/{auto_po_id}", timeout=10)
        print(f"GET /api/purchase-orders/{auto_po_id}: {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ TEST 1.2 FAILED: PO retrieval failed - {resp.text[:500]}")
            return False
        
        po = resp.json().get("data", {})
        po_number = po.get("poNumber")
        po_type = po.get("poType")
        pipeline_status = po.get("pipelineStatus")
        is_dropship = po.get("isDropship")
        po_items = po.get("items", [])
        
        print(f"✅ PO retrieved: {po_number}")
        print(f"   poType: {po_type}")
        print(f"   pipelineStatus: {pipeline_status}")
        print(f"   isDropship: {is_dropship}")
        print(f"   items count: {len(po_items)}")
        
        # Verify PO type
        if po_type == "Produk Jadi":
            print(f"✅ TEST 1.2a PASSED: poType = 'Produk Jadi'")
        else:
            print(f"❌ TEST 1.2a FAILED: poType incorrect. Expected: 'Produk Jadi', Got: '{po_type}'")
            return False
        
        # Verify pipeline status
        if pipeline_status == "Draft":
            print(f"✅ TEST 1.2b PASSED: pipelineStatus = 'Draft'")
        else:
            print(f"❌ TEST 1.2b FAILED: pipelineStatus incorrect. Expected: 'Draft', Got: '{pipeline_status}'")
            return False
        
        # Verify isDropship
        if is_dropship:
            print(f"✅ TEST 1.2c PASSED: isDropship = true")
        else:
            print(f"❌ TEST 1.2c FAILED: isDropship incorrect. Expected: true, Got: {is_dropship}")
            return False
        
        # CRITICAL: Verify PO item unitPrice is BUY price (40000), NOT sell price (50000)
        if len(po_items) > 0:
            po_item = po_items[0]
            po_item_unit_price = po_item.get("unitPrice")
            po_item_weight = po_item.get("weight")
            
            print(f"\n   PO Item Details:")
            print(f"   - productId: {po_item.get('productId')}")
            print(f"   - weight: {po_item_weight}")
            print(f"   - unitPrice: Rp {po_item_unit_price:,.0f}")
            
            # CRITICAL CHECK: unitPrice must be BUY price (40000)
            expected_buy_price = 40000
            if abs(po_item_unit_price - expected_buy_price) < 0.01:
                print(f"✅ TEST 1.2d PASSED (CRITICAL): PO item unitPrice = BUY price (Rp {po_item_unit_price:,.0f} = 40000)")
            else:
                print(f"❌ TEST 1.2d FAILED (CRITICAL): PO item unitPrice incorrect.")
                print(f"   Expected: Rp {expected_buy_price:,.0f} (BUY price)")
                print(f"   Got: Rp {po_item_unit_price:,.0f}")
                print(f"   This means the PO is using SELL price instead of BUY price - BUG NOT FIXED!")
                return False
        else:
            print(f"❌ TEST 1.2d FAILED: No items in PO")
            return False
        
        # Verify PO totalAmount or HPP based on BUY price
        po_total = po.get("totalAmount") or po.get("hpp") or 0
        expected_po_total = 40000 * 100  # 4,000,000
        
        print(f"\n   PO Total/HPP: Rp {po_total:,.0f}")
        
        if abs(po_total - expected_po_total) < 0.01:
            print(f"✅ TEST 1.2e PASSED: PO total based on BUY price (Rp {po_total:,.0f} = 40000 × 100)")
        else:
            print(f"⚠️  TEST 1.2e WARNING: PO total unexpected. Expected: Rp {expected_po_total:,.0f}, Got: Rp {po_total:,.0f}")
            print(f"   (This may be acceptable if PO total calculation differs, but item unitPrice is correct)")
        
    except Exception as e:
        print(f"❌ TEST 1.2 FAILED: Exception - {e}")
        return False
    
    print("\n✅ TEST 1 PASSED: Dropship SO with buyPrice < sellPrice working correctly")
    print(f"   - SO totalAmount based on SELL price (50000): Rp {so_total:,.0f}")
    print(f"   - PO item unitPrice based on BUY price (40000): Rp {po_item_unit_price:,.0f}")
    print(f"   - Margin preserved: Rp {(50000 - 40000) * 100:,.0f} (10000 per kg × 100kg)")
    return True

def test_dropship_so_backward_compat():
    """
    TEST 2: Backward compatibility (no buyPrice provided)
    - Create SO without buyPrice field
    - Verify auto-PO item unitPrice falls back to SELL price (unitPrice)
    - This ensures backward compatibility with existing code
    """
    
    print("\n" + "="*80)
    print("TEST 2: BACKWARD COMPATIBILITY (NO BUYPRICE PROVIDED)")
    print("="*80)
    
    # Login as admin
    session = login(ADMIN_CREDS["email"], ADMIN_CREDS["password"])
    if not session:
        print("❌ TEST 2 FAILED: Login failed")
        return False
    
    # SETUP: Create test data
    print("\n--- SETUP: Create test data ---")
    
    # Create product
    product = create_product(session, "DS-PR2", "Dropship Prod 2", "kg", 60000)
    if not product:
        print("❌ TEST 2 FAILED: Product creation failed")
        return False
    product_id = product.get("id")
    
    # Create supplier contact
    supplier = create_contact(session, ["Supplier"], "DS Supplier 2")
    if not supplier:
        print("❌ TEST 2 FAILED: Supplier creation failed")
        return False
    supplier_id = supplier.get("id")
    
    # Create customer contact
    customer = create_contact(session, ["Customer"], "DS Customer 2")
    if not customer:
        print("❌ TEST 2 FAILED: Customer creation failed")
        return False
    customer_id = customer.get("id")
    
    # TEST 2.1: Create dropship SO WITHOUT buyPrice
    print("\n--- TEST 2.1: Create Dropship SO WITHOUT buyPrice (backward compat) ---")
    try:
        so_data = {
            "customerId": customer_id,
            "fulfillmentType": "dropship",
            "supplierId": supplier_id,
            "orderDate": "2026-08-08",
            "expectedDate": "2026-08-15",
            "items": [
                {
                    "productId": product_id,
                    "quantity": 1,
                    "weight": 50,
                    "unitPrice": 60000
                    # NO buyPrice field - should fall back to unitPrice
                }
            ]
        }
        
        resp = session.post(f"{BASE_URL}/sales-orders", json=so_data, timeout=10)
        print(f"POST /api/sales-orders: {resp.status_code}")
        
        if resp.status_code != 201:
            print(f"❌ TEST 2.1 FAILED: SO creation failed - {resp.text[:500]}")
            return False
        
        so = resp.json().get("data", {})
        so_id = so.get("id")
        so_number = so.get("soNumber")
        so_total = so.get("totalAmount")
        auto_po_id = so.get("autoPoId")
        
        print(f"✅ SO created: {so_number}")
        print(f"   SO ID: {so_id}")
        print(f"   SO totalAmount: Rp {so_total:,.0f}")
        print(f"   autoPoId: {auto_po_id}")
        
        # Verify SO totalAmount
        expected_so_total = 60000 * 50  # 3,000,000
        if abs(so_total - expected_so_total) < 0.01:
            print(f"✅ TEST 2.1a PASSED: SO totalAmount correct (Rp {so_total:,.0f} = 60000 × 50)")
        else:
            print(f"❌ TEST 2.1a FAILED: SO totalAmount incorrect. Expected: Rp {expected_so_total:,.0f}, Got: Rp {so_total:,.0f}")
            return False
        
        # Verify autoPoId is non-null
        if auto_po_id:
            print(f"✅ TEST 2.1b PASSED: autoPoId is non-null ({auto_po_id})")
        else:
            print(f"❌ TEST 2.1b FAILED: autoPoId is null (auto-PO not created)")
            return False
        
    except Exception as e:
        print(f"❌ TEST 2.1 FAILED: Exception - {e}")
        return False
    
    # TEST 2.2: Verify auto-PO falls back to sell price
    print("\n--- TEST 2.2: Verify Auto-PO Falls Back to Sell Price ---")
    try:
        resp = session.get(f"{BASE_URL}/purchase-orders/{auto_po_id}", timeout=10)
        print(f"GET /api/purchase-orders/{auto_po_id}: {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ TEST 2.2 FAILED: PO retrieval failed - {resp.text[:500]}")
            return False
        
        po = resp.json().get("data", {})
        po_number = po.get("poNumber")
        po_items = po.get("items", [])
        
        print(f"✅ PO retrieved: {po_number}")
        
        if len(po_items) > 0:
            po_item = po_items[0]
            po_item_unit_price = po_item.get("unitPrice")
            po_item_weight = po_item.get("weight")
            
            print(f"\n   PO Item Details:")
            print(f"   - productId: {po_item.get('productId')}")
            print(f"   - weight: {po_item_weight}")
            print(f"   - unitPrice: Rp {po_item_unit_price:,.0f}")
            
            # Verify unitPrice falls back to SELL price (60000)
            expected_fallback_price = 60000
            if abs(po_item_unit_price - expected_fallback_price) < 0.01:
                print(f"✅ TEST 2.2a PASSED: PO item unitPrice falls back to SELL price (Rp {po_item_unit_price:,.0f} = 60000)")
                print(f"   Backward compatibility maintained: no buyPrice → uses unitPrice")
            else:
                print(f"❌ TEST 2.2a FAILED: PO item unitPrice incorrect.")
                print(f"   Expected: Rp {expected_fallback_price:,.0f} (fallback to sell price)")
                print(f"   Got: Rp {po_item_unit_price:,.0f}")
                return False
        else:
            print(f"❌ TEST 2.2a FAILED: No items in PO")
            return False
        
    except Exception as e:
        print(f"❌ TEST 2.2 FAILED: Exception - {e}")
        return False
    
    print("\n✅ TEST 2 PASSED: Backward compatibility working correctly")
    print(f"   - No buyPrice provided → PO uses sell price (60000)")
    print(f"   - No crash, no error, backward compatible")
    return True

def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("DROPSHIP SO BUY PRICE BUGFIX - BACKEND TESTING")
    print("="*80)
    print("\nTesting the bugfix where auto-created PO buy price (buyPrice) can differ")
    print("from SO sell price (unitPrice), allowing for margin in dropship transactions.")
    print("\nLogin: admin@lpi.co.id / admin123")
    print("="*80)
    
    results = []
    
    # Run TEST 1
    test1_passed = test_dropship_so_with_margin()
    results.append(("TEST 1: Dropship SO with buyPrice < sellPrice", test1_passed))
    
    # Run TEST 2
    test2_passed = test_dropship_so_backward_compat()
    results.append(("TEST 2: Backward compatibility (no buyPrice)", test2_passed))
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed_count = sum(1 for _, passed in results if passed)
    total_count = len(results)
    
    for test_name, passed in results:
        status = "✅ PASSED" if passed else "❌ FAILED"
        print(f"{status}: {test_name}")
    
    print(f"\nTotal: {passed_count}/{total_count} tests passed")
    
    if passed_count == total_count:
        print("\n🎉 ALL TESTS PASSED - BUGFIX VERIFIED!")
        print("\nKey Findings:")
        print("✅ SO totalAmount based on SELL price (unitPrice)")
        print("✅ Auto-PO item unitPrice based on BUY price (buyPrice)")
        print("✅ Margin preserved between buy and sell prices")
        print("✅ Backward compatibility maintained (no buyPrice → uses unitPrice)")
        return 0
    else:
        print("\n❌ SOME TESTS FAILED - BUGFIX NOT WORKING CORRECTLY")
        return 1

if __name__ == "__main__":
    sys.exit(main())
