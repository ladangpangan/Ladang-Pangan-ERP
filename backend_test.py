#!/usr/bin/env python3
"""
Backend Test Script for Dropship SO + SJ Shipped Weight + Invoice Weight Basis
Tests NEW features:
- A. Dropship SO (no stock, auto-PO)
- B. SJ real shipped weight + received column
- C. Invoice weight basis (shipped vs received)
"""

import requests
import json
from datetime import datetime, timedelta

# Configuration
BASE_URL = "https://erp-builder-48.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

# Create session for cookie persistence
session = requests.Session()

def print_test(msg):
    print(f"\n{'='*80}")
    print(f"TEST: {msg}")
    print('='*80)

def print_result(success, msg, data=None):
    status = "✅ PASS" if success else "❌ FAIL"
    print(f"{status}: {msg}")
    if data:
        print(f"Data: {json.dumps(data, indent=2, default=str)}")

def login():
    """Login as admin and store session cookie"""
    print_test("Login as admin")
    try:
        resp = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=10
        )
        if resp.status_code == 200:
            print_result(True, f"Login successful: {ADMIN_EMAIL}")
            return True
        else:
            print_result(False, f"Login failed: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        print_result(False, f"Login error: {str(e)}")
        return False

def create_supplier():
    """Create a Supplier contact for testing"""
    print_test("Create Supplier contact (SUP-T1)")
    try:
        resp = session.post(
            f"{BASE_URL}/contacts",
            json={
                "contactType": "Supplier",
                "code": "SUP-T1",
                "displayName": "Sup T1",
                "companyName": "Supplier Test 1",
                "phone": "081234567890"
            },
            timeout=10
        )
        if resp.status_code == 201:
            data = resp.json().get('data', {})
            print_result(True, f"Supplier created: {data.get('id')}", data)
            return data.get('id')
        else:
            print_result(False, f"Failed to create supplier: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print_result(False, f"Error creating supplier: {str(e)}")
        return None

def create_customer():
    """Create a Customer contact for testing"""
    print_test("Create Customer contact (CUST-T1)")
    try:
        resp = session.post(
            f"{BASE_URL}/contacts",
            json={
                "contactType": "Customer",
                "code": "CUST-T1",
                "displayName": "Cust T1",
                "companyName": "Customer Test 1",
                "phone": "081234567891"
            },
            timeout=10
        )
        if resp.status_code == 201:
            data = resp.json().get('data', {})
            print_result(True, f"Customer created: {data.get('id')}", data)
            return data.get('id')
        else:
            print_result(False, f"Failed to create customer: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print_result(False, f"Error creating customer: {str(e)}")
        return None

def create_product():
    """Create a Product for testing"""
    print_test("Create Product (PRD-T1)")
    try:
        resp = session.post(
            f"{BASE_URL}/products",
            json={
                "sku": "PRD-T1",
                "name": "Prod T1",
                "unit": "kg",
                "basePrice": 40000,
                "category": "Test"
            },
            timeout=10
        )
        if resp.status_code == 201:
            data = resp.json().get('data', {})
            print_result(True, f"Product created: {data.get('id')}", data)
            return data.get('id')
        else:
            print_result(False, f"Failed to create product: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print_result(False, f"Error creating product: {str(e)}")
        return None

def test_dropship_so_creation(customer_id, supplier_id, product_id):
    """
    A.1: Create dropship SO and verify auto-PO creation
    """
    print_test("A.1: Create Dropship SO with auto-PO")
    try:
        resp = session.post(
            f"{BASE_URL}/sales-orders",
            json={
                "customerId": customer_id,
                "fulfillmentType": "dropship",
                "supplierId": supplier_id,
                "orderDate": datetime.now().isoformat(),
                "expectedDate": (datetime.now() + timedelta(days=7)).isoformat(),
                "items": [
                    {
                        "productId": product_id,
                        "quantity": 1,
                        "weight": 100,
                        "unitPrice": 40000
                    }
                ]
            },
            timeout=10
        )
        
        if resp.status_code != 201:
            print_result(False, f"Failed to create SO: {resp.status_code} - {resp.text}")
            return None
        
        data = resp.json().get('data', {})
        so_id = data.get('id')
        
        # Verify SO properties
        print_result(True, f"SO created: {data.get('soNumber')}")
        
        # Get SO detail to verify all properties
        detail_resp = session.get(f"{BASE_URL}/sales-orders/{so_id}", timeout=10)
        if detail_resp.status_code != 200:
            print_result(False, f"Failed to get SO detail: {detail_resp.status_code}")
            return so_id
        
        so_detail = detail_resp.json().get('data', {})
        
        # Verify fulfillmentType
        fulfillment_type = so_detail.get('fulfillmentType')
        print_result(
            fulfillment_type == 'dropship',
            f"fulfillmentType == 'dropship': {fulfillment_type}"
        )
        
        # Verify supplierId
        supplier_id_set = so_detail.get('supplierId')
        print_result(
            supplier_id_set == supplier_id,
            f"supplierId set: {supplier_id_set}"
        )
        
        # Verify autoPoId
        auto_po_id = so_detail.get('autoPoId')
        print_result(
            auto_po_id is not None,
            f"autoPoId is non-null: {auto_po_id}"
        )
        
        # Verify totalAmount (weight-based: 40000 * 100 = 4,000,000)
        total_amount = so_detail.get('totalAmount')
        expected_total = 4000000
        print_result(
            total_amount == expected_total,
            f"totalAmount == {expected_total}: {total_amount}"
        )
        
        return so_id, auto_po_id
        
    except Exception as e:
        print_result(False, f"Error in dropship SO creation: {str(e)}")
        return None

def test_auto_po_verification(auto_po_id):
    """
    A.2: Verify the auto-created PO exists with correct properties
    """
    print_test("A.2: Verify auto-created PO")
    try:
        # Get all POs and find the one with matching ID
        resp = session.get(f"{BASE_URL}/purchase-orders", timeout=10)
        if resp.status_code != 200:
            print_result(False, f"Failed to get POs: {resp.status_code}")
            return False
        
        pos = resp.json().get('data', [])
        auto_po = None
        for po in pos:
            if po.get('id') == auto_po_id:
                auto_po = po
                break
        
        if not auto_po:
            print_result(False, f"Auto-PO not found in list: {auto_po_id}")
            return False
        
        print_result(True, f"Auto-PO found: {auto_po.get('poNumber')}")
        
        # Verify poType
        po_type = auto_po.get('poType')
        print_result(
            po_type == 'Produk Jadi',
            f"poType == 'Produk Jadi': {po_type}"
        )
        
        # Verify pipelineStatus
        pipeline_status = auto_po.get('pipelineStatus')
        print_result(
            pipeline_status == 'Draft',
            f"pipelineStatus == 'Draft': {pipeline_status}"
        )
        
        # Verify isDropship
        is_dropship = auto_po.get('isDropship')
        print_result(
            is_dropship == True or is_dropship == 1,
            f"isDropship == true: {is_dropship}"
        )
        
        # Get PO detail to verify items
        detail_resp = session.get(f"{BASE_URL}/purchase-orders/{auto_po_id}", timeout=10)
        if detail_resp.status_code == 200:
            po_detail = detail_resp.json().get('data', {})
            items = po_detail.get('items', [])
            print_result(
                len(items) == 1,
                f"PO has 1 item: {len(items)} items"
            )
            if items:
                print(f"PO item: productId={items[0].get('productId')}, weight={items[0].get('weight')}")
        
        return True
        
    except Exception as e:
        print_result(False, f"Error verifying auto-PO: {str(e)}")
        return False

def test_confirm_dropship_so(so_id):
    """
    A.3: Confirm dropship SO - should NOT error about stock and NOT deduct inventory
    """
    print_test("A.3: Confirm Dropship SO (no stock deduction)")
    try:
        # Get inventory stock count before confirmation
        inv_resp = session.get(f"{BASE_URL}/inventory/stocks", timeout=10)
        stock_count_before = 0
        if inv_resp.status_code == 200:
            stock_count_before = len(inv_resp.json().get('data', []))
            print(f"Inventory stock count before confirm: {stock_count_before}")
        
        # Confirm the SO
        resp = session.post(
            f"{BASE_URL}/sales-orders/{so_id}/status",
            json={"status": "Confirmed"},
            timeout=10
        )
        
        if resp.status_code != 200:
            print_result(False, f"Failed to confirm SO: {resp.status_code} - {resp.text}")
            return False
        
        print_result(True, "SO confirmed successfully (no stock error)")
        
        # Verify pipelineStatus changed to Confirmed
        detail_resp = session.get(f"{BASE_URL}/sales-orders/{so_id}", timeout=10)
        if detail_resp.status_code == 200:
            so_detail = detail_resp.json().get('data', {})
            pipeline_status = so_detail.get('pipelineStatus')
            print_result(
                pipeline_status == 'Confirmed',
                f"pipelineStatus == 'Confirmed': {pipeline_status}"
            )
        
        # Verify no inventory stock was created/deducted
        inv_resp_after = session.get(f"{BASE_URL}/inventory/stocks", timeout=10)
        stock_count_after = 0
        if inv_resp_after.status_code == 200:
            stock_count_after = len(inv_resp_after.json().get('data', []))
            print(f"Inventory stock count after confirm: {stock_count_after}")
            print_result(
                stock_count_after == stock_count_before,
                f"No inventory stock created/deducted: {stock_count_before} -> {stock_count_after}"
            )
        
        return True
        
    except Exception as e:
        print_result(False, f"Error confirming dropship SO: {str(e)}")
        return False

def test_sj_shipped_weight(so_id):
    """
    B: Create Surat Jalan with real shipped weight and received column
    """
    print_test("B: Advance SO to Packed and create SJ with shipped weight")
    try:
        # Advance to Packed (Confirmed -> Packed)
        resp = session.post(
            f"{BASE_URL}/sales-orders/{so_id}/status",
            json={"status": "Packed"},
            timeout=10
        )
        if resp.status_code != 200:
            print_result(False, f"Failed to advance to Packed: {resp.status_code} - {resp.text}")
            return None
        
        print_result(True, "SO advanced to Packed")
        
        # Get SO detail to get item IDs
        detail_resp = session.get(f"{BASE_URL}/sales-orders/{so_id}", timeout=10)
        if detail_resp.status_code != 200:
            print_result(False, f"Failed to get SO detail: {detail_resp.status_code}")
            return None
        
        so_detail = detail_resp.json().get('data', {})
        items = so_detail.get('items', [])
        if not items:
            print_result(False, "No items found in SO")
            return None
        
        item_id = items[0].get('id')
        print(f"SO item ID: {item_id}")
        
        # Create Surat Jalan with shippedWeight=95 (less than ordered 100)
        sj_resp = session.post(
            f"{BASE_URL}/sales-orders/{so_id}/surat-jalan",
            json={
                "deliveryDate": "2026-07-20",
                "showReceivedColumn": True,
                "items": [
                    {
                        "itemId": item_id,
                        "shippedWeight": 95
                    }
                ]
            },
            timeout=10
        )
        
        if sj_resp.status_code != 201:
            print_result(False, f"Failed to create SJ: {sj_resp.status_code} - {sj_resp.text}")
            return None
        
        sj_data = sj_resp.json().get('data', {})
        print_result(True, f"SJ created: {sj_data.get('sjNumber')}")
        
        # Verify SO detail shows updated shippedWeight and showReceivedColumn
        detail_resp2 = session.get(f"{BASE_URL}/sales-orders/{so_id}", timeout=10)
        if detail_resp2.status_code == 200:
            so_detail2 = detail_resp2.json().get('data', {})
            items2 = so_detail2.get('items', [])
            if items2:
                shipped_weight = items2[0].get('shippedWeight')
                print_result(
                    shipped_weight == 95,
                    f"item.shippedWeight == 95: {shipped_weight}"
                )
            
            surat_jalan = so_detail2.get('suratJalan', [])
            if surat_jalan:
                show_received = surat_jalan[0].get('showReceivedColumn')
                print_result(
                    show_received == True or show_received == 1,
                    f"suratJalan[0].showReceivedColumn == true: {show_received}"
                )
            
            # Verify pipeline auto-moved to Shipped
            pipeline_status = so_detail2.get('pipelineStatus')
            print_result(
                pipeline_status == 'Shipped',
                f"Pipeline auto-moved Packed→Shipped: {pipeline_status}"
            )
        
        return True
        
    except Exception as e:
        print_result(False, f"Error in SJ shipped weight test: {str(e)}")
        return None

def test_invoice_shipped_basis(so_id):
    """
    C.6: Transition to Invoiced with SHIPPED basis
    """
    print_test("C.6: Invoice with SHIPPED weight basis")
    try:
        resp = session.post(
            f"{BASE_URL}/sales-orders/{so_id}/status",
            json={
                "status": "Invoiced",
                "invoiceWeightBasis": "shipped"
            },
            timeout=10
        )
        
        if resp.status_code != 200:
            print_result(False, f"Failed to invoice: {resp.status_code} - {resp.text}")
            return False
        
        print_result(True, "SO transitioned to Invoiced with shipped basis")
        
        # Verify SO detail
        detail_resp = session.get(f"{BASE_URL}/sales-orders/{so_id}", timeout=10)
        if detail_resp.status_code == 200:
            so_detail = detail_resp.json().get('data', {})
            
            # Verify invoiceWeightBasis
            invoice_weight_basis = so_detail.get('invoiceWeightBasis')
            print_result(
                invoice_weight_basis == 'shipped',
                f"invoiceWeightBasis == 'shipped': {invoice_weight_basis}"
            )
            
            # Verify totalAmount recomputed (40000 * 95 = 3,800,000)
            total_amount = so_detail.get('totalAmount')
            expected_total = 3800000
            print_result(
                total_amount == expected_total,
                f"totalAmount == {expected_total} (40000*95): {total_amount}"
            )
            
            # Verify invoice number generated
            invoice_number = so_detail.get('invoiceNumber')
            print_result(
                invoice_number is not None and invoice_number != '',
                f"invoiceNumber generated: {invoice_number}"
            )
        
        return True
        
    except Exception as e:
        print_result(False, f"Error in invoice shipped basis test: {str(e)}")
        return False

def test_invoice_received_basis(customer_id, product_id):
    """
    C.7: Create second SO, advance to Shipped, create receipts, invoice with RECEIVED basis
    """
    print_test("C.7: Create second SO for RECEIVED weight basis test")
    try:
        # Create regular SO (not dropship)
        resp = session.post(
            f"{BASE_URL}/sales-orders",
            json={
                "customerId": customer_id,
                "orderDate": datetime.now().isoformat(),
                "expectedDate": (datetime.now() + timedelta(days=7)).isoformat(),
                "items": [
                    {
                        "productId": product_id,
                        "quantity": 1,
                        "weight": 100,
                        "unitPrice": 40000
                    }
                ]
            },
            timeout=10
        )
        
        if resp.status_code != 201:
            print_result(False, f"Failed to create second SO: {resp.status_code} - {resp.text}")
            return False
        
        data = resp.json().get('data', {})
        so_id2 = data.get('id')
        print_result(True, f"Second SO created: {data.get('soNumber')}")
        
        # Advance Draft→Confirmed→Packed→Shipped
        for status in ['Confirmed', 'Packed']:
            resp = session.post(
                f"{BASE_URL}/sales-orders/{so_id2}/status",
                json={"status": status},
                timeout=10
            )
            if resp.status_code != 200:
                print_result(False, f"Failed to advance to {status}: {resp.status_code}")
                return False
        
        # Get item ID for SJ
        detail_resp = session.get(f"{BASE_URL}/sales-orders/{so_id2}", timeout=10)
        if detail_resp.status_code != 200:
            print_result(False, f"Failed to get SO detail: {detail_resp.status_code}")
            return False
        
        so_detail = detail_resp.json().get('data', {})
        items = so_detail.get('items', [])
        if not items:
            print_result(False, "No items found in SO")
            return False
        
        item_id = items[0].get('id')
        
        # Create SJ with shippedWeight=100
        sj_resp = session.post(
            f"{BASE_URL}/sales-orders/{so_id2}/surat-jalan",
            json={
                "deliveryDate": "2026-07-20",
                "items": [
                    {
                        "itemId": item_id,
                        "shippedWeight": 100
                    }
                ]
            },
            timeout=10
        )
        
        if sj_resp.status_code != 201:
            print_result(False, f"Failed to create SJ: {sj_resp.status_code}")
            return False
        
        print_result(True, "SO advanced to Shipped with shippedWeight=100")
        
        # Create receipt with receivedWeight=90
        receipt_resp = session.post(
            f"{BASE_URL}/sales-orders/{so_id2}/receipts",
            json={
                "receivedDate": "2026-07-21",
                "items": [
                    {
                        "productId": product_id,
                        "receivedWeight": 90
                    }
                ]
            },
            timeout=10
        )
        
        if receipt_resp.status_code != 201:
            print_result(False, f"Failed to create receipt: {receipt_resp.status_code} - {receipt_resp.text}")
            return False
        
        receipt_data = receipt_resp.json().get('data', {})
        print_result(True, f"Receipt created: {receipt_data.get('receiptNumber')}")
        
        # Transition to Invoiced with received basis
        invoice_resp = session.post(
            f"{BASE_URL}/sales-orders/{so_id2}/status",
            json={
                "status": "Invoiced",
                "invoiceWeightBasis": "received"
            },
            timeout=10
        )
        
        if invoice_resp.status_code != 200:
            print_result(False, f"Failed to invoice: {invoice_resp.status_code} - {invoice_resp.text}")
            return False
        
        print_result(True, "SO transitioned to Invoiced with received basis")
        
        # Verify SO detail
        detail_resp2 = session.get(f"{BASE_URL}/sales-orders/{so_id2}", timeout=10)
        if detail_resp2.status_code == 200:
            so_detail2 = detail_resp2.json().get('data', {})
            
            # Verify invoiceWeightBasis
            invoice_weight_basis = so_detail2.get('invoiceWeightBasis')
            print_result(
                invoice_weight_basis == 'received',
                f"invoiceWeightBasis == 'received': {invoice_weight_basis}"
            )
            
            # Verify totalAmount recomputed (40000 * 90 = 3,600,000)
            total_amount = so_detail2.get('totalAmount')
            expected_total = 3600000
            print_result(
                total_amount == expected_total,
                f"totalAmount == {expected_total} (40000*90): {total_amount}"
            )
        
        return True
        
    except Exception as e:
        print_result(False, f"Error in invoice received basis test: {str(e)}")
        return False

def main():
    """Main test execution"""
    print("\n" + "="*80)
    print("BACKEND TEST: Dropship SO + SJ Shipped Weight + Invoice Weight Basis")
    print("="*80)
    
    # Login
    if not login():
        print("\n❌ LOGIN FAILED - Cannot proceed with tests")
        return
    
    # Create test data
    supplier_id = create_supplier()
    if not supplier_id:
        print("\n❌ SUPPLIER CREATION FAILED - Cannot proceed")
        return
    
    customer_id = create_customer()
    if not customer_id:
        print("\n❌ CUSTOMER CREATION FAILED - Cannot proceed")
        return
    
    product_id = create_product()
    if not product_id:
        print("\n❌ PRODUCT CREATION FAILED - Cannot proceed")
        return
    
    print("\n" + "="*80)
    print("TEST DATA CREATED SUCCESSFULLY")
    print(f"Supplier ID: {supplier_id}")
    print(f"Customer ID: {customer_id}")
    print(f"Product ID: {product_id}")
    print("="*80)
    
    # A. DROPSHIP SO TESTS
    result = test_dropship_so_creation(customer_id, supplier_id, product_id)
    if not result:
        print("\n❌ DROPSHIP SO CREATION FAILED - Cannot proceed")
        return
    
    so_id, auto_po_id = result
    
    if not test_auto_po_verification(auto_po_id):
        print("\n⚠️ AUTO-PO VERIFICATION FAILED")
    
    if not test_confirm_dropship_so(so_id):
        print("\n❌ DROPSHIP SO CONFIRMATION FAILED - Cannot proceed")
        return
    
    # B. SJ SHIPPED WEIGHT TEST
    if not test_sj_shipped_weight(so_id):
        print("\n❌ SJ SHIPPED WEIGHT TEST FAILED - Cannot proceed")
        return
    
    # C. INVOICE WEIGHT BASIS TESTS
    if not test_invoice_shipped_basis(so_id):
        print("\n⚠️ INVOICE SHIPPED BASIS TEST FAILED")
    
    if not test_invoice_received_basis(customer_id, product_id):
        print("\n⚠️ INVOICE RECEIVED BASIS TEST FAILED")
    
    print("\n" + "="*80)
    print("ALL TESTS COMPLETED")
    print("="*80)

if __name__ == "__main__":
    main()
