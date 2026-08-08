#!/usr/bin/env python3
"""
Backend test for BUGFIX: Real shipped weight (Surat Jalan) updates SO total + syncs dropship PO

Test Plan:
- TEST A: NON-dropship SO shipped weight → SO total
- TEST B: DROPSHIP SO shipped weight → SO total AND auto-PO
- TEST C: No shippedWeight in SJ (no crash)

Login: admin@lpi.co.id / admin123
"""

import requests
import json
from typing import Dict, Any

BASE_URL = "http://localhost:3000/api"
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
            return session
    except Exception as e:
        print(f"❌ Login error for {email}: {e}")
        return session

def create_product(session: requests.Session, sku: str, name: str, unit: str, base_price: int) -> Dict[str, Any]:
    """Create a product"""
    print(f"\nCreating product {sku}...")
    resp = session.post(
        f"{BASE_URL}/products",
        json={
            "sku": sku,
            "name": name,
            "unit": unit,
            "basePrice": base_price,
            "category": "Karkas"
        },
        timeout=10
    )
    if resp.status_code == 201:
        product = resp.json()["data"]
        print(f"✅ Product created: {product['id']} - {product['sku']}")
        return product
    else:
        print(f"❌ Product creation failed: {resp.status_code} - {resp.text[:200]}")
        return None

def create_contact(session: requests.Session, categories: list, display_name: str) -> Dict[str, Any]:
    """Create a contact"""
    print(f"\nCreating contact {display_name} with categories {categories}...")
    resp = session.post(
        f"{BASE_URL}/contacts",
        json={
            "categories": categories,
            "displayName": display_name
        },
        timeout=10
    )
    if resp.status_code == 201:
        contact = resp.json()["data"]
        print(f"✅ Contact created: {contact['id']} - {contact['code']} - {contact['displayName']}")
        return contact
    else:
        print(f"❌ Contact creation failed: {resp.status_code} - {resp.text[:200]}")
        return None

def create_sales_order(session: requests.Session, customer_id: str, items: list, fulfillment_type: str = None, supplier_id: str = None) -> Dict[str, Any]:
    """Create a sales order"""
    print(f"\nCreating sales order (fulfillmentType={fulfillment_type})...")
    payload = {
        "customerId": customer_id,
        "items": items
    }
    if fulfillment_type:
        payload["fulfillmentType"] = fulfillment_type
    if supplier_id:
        payload["supplierId"] = supplier_id
    
    resp = session.post(
        f"{BASE_URL}/sales-orders",
        json=payload,
        timeout=10
    )
    if resp.status_code == 201:
        so = resp.json()["data"]
        print(f"✅ Sales Order created: {so['id']} - {so['soNumber']}")
        print(f"   totalAmount: Rp {so.get('totalAmount', 0):,.0f}")
        print(f"   fulfillmentType: {so.get('fulfillmentType', 'N/A')}")
        print(f"   autoPoId: {so.get('autoPoId', 'N/A')}")
        return so
    else:
        print(f"❌ Sales Order creation failed: {resp.status_code} - {resp.text[:200]}")
        return None

def get_sales_order(session: requests.Session, so_id: str) -> Dict[str, Any]:
    """Get sales order details"""
    resp = session.get(f"{BASE_URL}/sales-orders/{so_id}", timeout=10)
    if resp.status_code == 200:
        return resp.json()["data"]
    else:
        print(f"❌ Failed to get SO: {resp.status_code} - {resp.text[:200]}")
        return None

def get_purchase_order(session: requests.Session, po_id: str) -> Dict[str, Any]:
    """Get purchase order details"""
    resp = session.get(f"{BASE_URL}/purchase-orders/{po_id}", timeout=10)
    if resp.status_code == 200:
        return resp.json()["data"]
    else:
        print(f"❌ Failed to get PO: {resp.status_code} - {resp.text[:200]}")
        return None

def update_so_status(session: requests.Session, so_id: str, status: str) -> bool:
    """Update sales order status"""
    print(f"\nUpdating SO status to {status}...")
    resp = session.post(
        f"{BASE_URL}/sales-orders/{so_id}/status",
        json={"status": status},
        timeout=10
    )
    if resp.status_code == 200:
        print(f"✅ SO status updated to {status}")
        return True
    else:
        print(f"❌ Failed to update SO status: {resp.status_code} - {resp.text[:200]}")
        return False

def create_surat_jalan(session: requests.Session, so_id: str, items: list = None) -> Dict[str, Any]:
    """Create surat jalan"""
    print(f"\nCreating Surat Jalan...")
    payload = {}
    if items:
        payload["items"] = items
    
    resp = session.post(
        f"{BASE_URL}/sales-orders/{so_id}/surat-jalan",
        json=payload,
        timeout=10
    )
    if resp.status_code == 201:
        sj = resp.json()["data"]
        print(f"✅ Surat Jalan created: {sj['sjNumber']}")
        return sj
    else:
        print(f"❌ Surat Jalan creation failed: {resp.status_code} - {resp.text[:200]}")
        return None

def test_a_non_dropship_so_shipped_weight():
    """
    TEST A: NON-dropship (stock/legacy) SO shipped weight → SO total
    1. Create SO WITHOUT dropship with item weight=100, unitPrice=50000 → total 5,000,000
    2. Advance Draft→Confirmed→Packed
    3. POST surat-jalan with shippedWeight=90
    4. Verify SO totalAmount recomputed to 4,500,000 (50000 × 90)
    """
    print("\n" + "="*80)
    print("TEST A: NON-DROPSHIP SO SHIPPED WEIGHT → SO TOTAL")
    print("="*80)
    
    session = login(ADMIN_CREDS["email"], ADMIN_CREDS["password"])
    
    # Setup: Create product, customer
    product = create_product(session, "SJW-PR1", "SJ Weight Prod", "kg", 50000)
    if not product:
        print("❌ TEST A FAILED: Product creation failed")
        return False
    
    customer = create_contact(session, ["Customer"], "SJ Cust")
    if not customer:
        print("❌ TEST A FAILED: Customer creation failed")
        return False
    
    # Step 1: Create SO WITHOUT dropship
    so = create_sales_order(
        session,
        customer["id"],
        [{
            "productId": product["id"],
            "quantity": 1,
            "weight": 100,
            "unitPrice": 50000
        }]
    )
    if not so:
        print("❌ TEST A FAILED: SO creation failed")
        return False
    
    # Verify initial total
    if so["totalAmount"] != 5000000:
        print(f"❌ TEST A FAILED: Initial SO totalAmount = {so['totalAmount']}, expected 5,000,000")
        return False
    print(f"✅ Step 1: SO created with totalAmount = Rp {so['totalAmount']:,.0f}")
    
    # Get SO item ID
    so_detail = get_sales_order(session, so["id"])
    if not so_detail or not so_detail.get("items") or len(so_detail["items"]) == 0:
        print("❌ TEST A FAILED: Could not get SO items")
        return False
    so_item_id = so_detail["items"][0]["id"]
    print(f"   SO item ID: {so_item_id}")
    
    # Step 2: Advance Draft→Confirmed→Packed
    if not update_so_status(session, so["id"], "Confirmed"):
        print("❌ TEST A FAILED: Could not advance to Confirmed")
        return False
    
    if not update_so_status(session, so["id"], "Packed"):
        print("❌ TEST A FAILED: Could not advance to Packed")
        return False
    print("✅ Step 2: SO advanced to Packed")
    
    # Step 3: Create Surat Jalan with shippedWeight=90
    sj = create_surat_jalan(
        session,
        so["id"],
        [{"itemId": so_item_id, "shippedWeight": 90}]
    )
    if not sj:
        print("❌ TEST A FAILED: Surat Jalan creation failed")
        return False
    print("✅ Step 3: Surat Jalan created with shippedWeight=90")
    
    # Step 4: Verify SO totalAmount recomputed
    so_updated = get_sales_order(session, so["id"])
    if not so_updated:
        print("❌ TEST A FAILED: Could not get updated SO")
        return False
    
    expected_total = 4500000  # 50000 × 90
    actual_total = so_updated["totalAmount"]
    item_shipped_weight = so_updated["items"][0].get("shippedWeight")
    
    print(f"\n📊 TEST A RESULTS:")
    print(f"   Item shippedWeight: {item_shipped_weight} kg (expected: 90)")
    print(f"   SO totalAmount: Rp {actual_total:,.0f} (expected: Rp {expected_total:,.0f})")
    
    if item_shipped_weight != 90:
        print(f"❌ TEST A FAILED: Item shippedWeight = {item_shipped_weight}, expected 90")
        return False
    
    if actual_total != expected_total:
        print(f"❌ TEST A FAILED: SO totalAmount = {actual_total}, expected {expected_total}")
        return False
    
    print("✅ TEST A PASSED: SO totalAmount correctly recomputed based on shipped weight")
    return True

def test_b_dropship_so_shipped_weight():
    """
    TEST B: DROPSHIP SO shipped weight → SO total AND auto-PO
    1. Create dropship SO with weight=100, unitPrice=50000, buyPrice=40000
       → SO total 5,000,000, auto-PO total 4,000,000
    2. Advance Draft→Confirmed→Packed
    3. POST surat-jalan with shippedWeight=80
    4. Verify SO totalAmount=4,000,000 (50000×80)
    5. Verify PO item weight=80 AND PO totalAmount=3,200,000 (40000×80)
    """
    print("\n" + "="*80)
    print("TEST B: DROPSHIP SO SHIPPED WEIGHT → SO TOTAL AND AUTO-PO")
    print("="*80)
    
    session = login(ADMIN_CREDS["email"], ADMIN_CREDS["password"])
    
    # Setup: Create product, customer, supplier
    product = create_product(session, "SJW-PR2", "SJ Weight Prod 2", "kg", 50000)
    if not product:
        print("❌ TEST B FAILED: Product creation failed")
        return False
    
    customer = create_contact(session, ["Customer"], "SJ Cust 2")
    if not customer:
        print("❌ TEST B FAILED: Customer creation failed")
        return False
    
    supplier = create_contact(session, ["Supplier"], "SJ Supplier")
    if not supplier:
        print("❌ TEST B FAILED: Supplier creation failed")
        return False
    
    # Step 1: Create dropship SO
    so = create_sales_order(
        session,
        customer["id"],
        [{
            "productId": product["id"],
            "quantity": 1,
            "weight": 100,
            "unitPrice": 50000,
            "buyPrice": 40000
        }],
        fulfillment_type="dropship",
        supplier_id=supplier["id"]
    )
    if not so:
        print("❌ TEST B FAILED: SO creation failed")
        return False
    
    # Verify initial SO total
    if so["totalAmount"] != 5000000:
        print(f"❌ TEST B FAILED: Initial SO totalAmount = {so['totalAmount']}, expected 5,000,000")
        return False
    print(f"✅ Step 1a: SO created with totalAmount = Rp {so['totalAmount']:,.0f}")
    
    # Verify autoPoId present
    if not so.get("autoPoId"):
        print("❌ TEST B FAILED: autoPoId not present")
        return False
    print(f"✅ Step 1b: autoPoId present: {so['autoPoId']}")
    
    # Get auto-PO and verify initial total
    po = get_purchase_order(session, so["autoPoId"])
    if not po:
        print("❌ TEST B FAILED: Could not get auto-PO")
        return False
    
    if po["totalAmount"] != 4000000:
        print(f"❌ TEST B FAILED: Initial PO totalAmount = {po['totalAmount']}, expected 4,000,000")
        return False
    print(f"✅ Step 1c: Auto-PO created with totalAmount = Rp {po['totalAmount']:,.0f}")
    
    # Get SO item ID
    so_detail = get_sales_order(session, so["id"])
    if not so_detail or not so_detail.get("items") or len(so_detail["items"]) == 0:
        print("❌ TEST B FAILED: Could not get SO items")
        return False
    so_item_id = so_detail["items"][0]["id"]
    print(f"   SO item ID: {so_item_id}")
    
    # Step 2: Advance Draft→Confirmed→Packed
    if not update_so_status(session, so["id"], "Confirmed"):
        print("❌ TEST B FAILED: Could not advance to Confirmed")
        return False
    
    if not update_so_status(session, so["id"], "Packed"):
        print("❌ TEST B FAILED: Could not advance to Packed")
        return False
    print("✅ Step 2: SO advanced to Packed")
    
    # Step 3: Create Surat Jalan with shippedWeight=80
    sj = create_surat_jalan(
        session,
        so["id"],
        [{"itemId": so_item_id, "shippedWeight": 80}]
    )
    if not sj:
        print("❌ TEST B FAILED: Surat Jalan creation failed")
        return False
    print("✅ Step 3: Surat Jalan created with shippedWeight=80")
    
    # Step 4: Verify SO totalAmount recomputed
    so_updated = get_sales_order(session, so["id"])
    if not so_updated:
        print("❌ TEST B FAILED: Could not get updated SO")
        return False
    
    expected_so_total = 4000000  # 50000 × 80
    actual_so_total = so_updated["totalAmount"]
    item_shipped_weight = so_updated["items"][0].get("shippedWeight")
    
    print(f"\n📊 TEST B RESULTS (SO):")
    print(f"   Item shippedWeight: {item_shipped_weight} kg (expected: 80)")
    print(f"   SO totalAmount: Rp {actual_so_total:,.0f} (expected: Rp {expected_so_total:,.0f})")
    
    if item_shipped_weight != 80:
        print(f"❌ TEST B FAILED: Item shippedWeight = {item_shipped_weight}, expected 80")
        return False
    
    if actual_so_total != expected_so_total:
        print(f"❌ TEST B FAILED: SO totalAmount = {actual_so_total}, expected {expected_so_total}")
        return False
    
    print("✅ Step 4: SO totalAmount correctly recomputed")
    
    # Step 5: Verify PO item weight and totalAmount
    po_updated = get_purchase_order(session, so["autoPoId"])
    if not po_updated:
        print("❌ TEST B FAILED: Could not get updated PO")
        return False
    
    if not po_updated.get("items") or len(po_updated["items"]) == 0:
        print("❌ TEST B FAILED: PO has no items")
        return False
    
    po_item_weight = po_updated["items"][0].get("weight")
    expected_po_total = 3200000  # 40000 × 80
    actual_po_total = po_updated["totalAmount"]
    
    print(f"\n📊 TEST B RESULTS (PO):")
    print(f"   PO item weight: {po_item_weight} kg (expected: 80)")
    print(f"   PO totalAmount: Rp {actual_po_total:,.0f} (expected: Rp {expected_po_total:,.0f})")
    
    if po_item_weight != 80:
        print(f"❌ TEST B FAILED: PO item weight = {po_item_weight}, expected 80")
        return False
    
    if actual_po_total != expected_po_total:
        print(f"❌ TEST B FAILED: PO totalAmount = {actual_po_total}, expected {expected_po_total}")
        return False
    
    print("✅ Step 5: PO item weight and totalAmount correctly updated")
    print("✅ TEST B PASSED: Shipped weight flowed to BOTH SO and PO")
    return True

def test_c_no_shipped_weight():
    """
    TEST C: No shippedWeight in SJ
    - Create SO, advance to Packed, POST surat-jalan with NO items array
    - Verify: 201, no crash, SO totalAmount unchanged
    """
    print("\n" + "="*80)
    print("TEST C: NO SHIPPED WEIGHT IN SJ")
    print("="*80)
    
    session = login(ADMIN_CREDS["email"], ADMIN_CREDS["password"])
    
    # Setup: Create product, customer
    product = create_product(session, "SJW-PR3", "SJ Weight Prod 3", "kg", 50000)
    if not product:
        print("❌ TEST C FAILED: Product creation failed")
        return False
    
    customer = create_contact(session, ["Customer"], "SJ Cust 3")
    if not customer:
        print("❌ TEST C FAILED: Customer creation failed")
        return False
    
    # Create SO
    so = create_sales_order(
        session,
        customer["id"],
        [{
            "productId": product["id"],
            "quantity": 1,
            "weight": 100,
            "unitPrice": 50000
        }]
    )
    if not so:
        print("❌ TEST C FAILED: SO creation failed")
        return False
    
    initial_total = so["totalAmount"]
    print(f"✅ SO created with totalAmount = Rp {initial_total:,.0f}")
    
    # Advance to Packed
    if not update_so_status(session, so["id"], "Confirmed"):
        print("❌ TEST C FAILED: Could not advance to Confirmed")
        return False
    
    if not update_so_status(session, so["id"], "Packed"):
        print("❌ TEST C FAILED: Could not advance to Packed")
        return False
    print("✅ SO advanced to Packed")
    
    # Create Surat Jalan with NO items array
    sj = create_surat_jalan(session, so["id"], items=None)
    if not sj:
        print("❌ TEST C FAILED: Surat Jalan creation failed")
        return False
    print("✅ Surat Jalan created with NO items array")
    
    # Verify SO totalAmount unchanged
    so_updated = get_sales_order(session, so["id"])
    if not so_updated:
        print("❌ TEST C FAILED: Could not get updated SO")
        return False
    
    actual_total = so_updated["totalAmount"]
    
    print(f"\n📊 TEST C RESULTS:")
    print(f"   SO totalAmount: Rp {actual_total:,.0f} (expected: Rp {initial_total:,.0f})")
    
    if actual_total != initial_total:
        print(f"❌ TEST C FAILED: SO totalAmount changed from {initial_total} to {actual_total}")
        return False
    
    print("✅ TEST C PASSED: No crash, SO totalAmount unchanged")
    return True

def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("BUGFIX TEST: REAL SHIPPED WEIGHT UPDATES SO TOTAL + SYNCS DROPSHIP PO")
    print("="*80)
    
    results = {
        "TEST A (Non-dropship SO)": test_a_non_dropship_so_shipped_weight(),
        "TEST B (Dropship SO)": test_b_dropship_so_shipped_weight(),
        "TEST C (No shipped weight)": test_c_no_shipped_weight()
    }
    
    print("\n" + "="*80)
    print("FINAL SUMMARY")
    print("="*80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{status}: {test_name}")
    
    print(f"\nTotal: {passed}/{total} tests passed ({passed*100//total}%)")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED - BUGFIX VERIFIED")
        return 0
    else:
        print(f"\n⚠️  {total - passed} TEST(S) FAILED")
        return 1

if __name__ == "__main__":
    exit(main())
