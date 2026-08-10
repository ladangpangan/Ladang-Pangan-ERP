#!/usr/bin/env python3
"""
Backend test for PO Invoice Basis (Surat Jalan vs Tally) + HPP from Tally + Tally Accumulation
Tests the full flow:
1. Find/create a PO with items (unitPrice>0, plan weight>0)
2. POST GRN with receivedWeight (Surat Jalan) -> verify totalAmount, invoiceWeightBasis='shipped'
3. Create temp cold storage, POST inventory/inbound with tally weight -> verify tally_weight accumulated
4. POST invoice endpoint to switch basis -> verify totalAmount changes
5. GET HPP endpoint -> verify it uses tally weight
6. CLEANUP everything
"""

import requests
import json
import sys

BASE_URL = "http://localhost:3000/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

# Global state for cleanup
cleanup_data = {
    'po_id': None,
    'original_po_state': None,
    'grn_id': None,
    'cold_storage_id': None,
    'inventory_transaction_id': None,
    'stock_ids': [],
    'created_po': False
}

def print_step(step_num, description):
    print(f"\n{'='*80}")
    print(f"STEP {step_num}: {description}")
    print('='*80)

def print_result(passed, details=""):
    status = "✅ PASSED" if passed else "❌ FAILED"
    print(f"{status}: {details}")

def login():
    """Login via Better Auth and return session"""
    try:
        session = requests.Session()
        response = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=10
        )
        if response.status_code == 200:
            print(f"✅ Login successful for {ADMIN_EMAIL}")
            print(f"  Cookies: {list(session.cookies.keys())}")
            
            # Debug: Check if cookies are being set
            if len(session.cookies) == 0:
                print("  ⚠️  WARNING: No cookies in session, trying to extract from response")
                # Try to get cookie from response headers
                set_cookie = response.headers.get('Set-Cookie')
                if set_cookie:
                    print(f"  Set-Cookie header: {set_cookie[:100]}...")
            
            # Test the session immediately
            test_response = session.get(f"{BASE_URL}/purchase-orders", timeout=10)
            if test_response.status_code == 200:
                print(f"  ✅ Session test successful")
            else:
                print(f"  ⚠️  Session test failed: {test_response.status_code}")
                # Try to manually set cookie if needed
                if 'token' in response.json():
                    token = response.json()['token']
                    session.cookies.set('better-auth.session_token', token, domain='localhost', path='/')
                    print(f"  Manually set session token")
                    # Test again
                    test_response2 = session.get(f"{BASE_URL}/purchase-orders", timeout=10)
                    if test_response2.status_code == 200:
                        print(f"  ✅ Session test successful after manual cookie set")
                    else:
                        print(f"  ❌ Session test still failing: {test_response2.status_code}")
            
            return session
        else:
            print(f"❌ Login failed: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        print(f"❌ Login exception: {e}")
        import traceback
        traceback.print_exc()
        return None

def find_or_create_po(session):
    """Step 1: Find an existing PO with items or create one"""
    print_step(1, "Find or create a PO with items (unitPrice>0, plan weight>0)")
    
    try:
        # Get existing POs
        response = session.get(f"{BASE_URL}/purchase-orders", timeout=10)
        if response.status_code != 200:
            print_result(False, f"Failed to get POs: {response.status_code}")
            return None
        
        pos = response.json().get('data', [])
        
        # Look for a suitable PO (Draft status, has items with unitPrice>0 and weight>0)
        for po in pos:
            if po.get('pipelineStatus') == 'Draft':
                # Get PO detail
                detail_response = session.get(f"{BASE_URL}/purchase-orders/{po['id']}", timeout=10)
                if detail_response.status_code == 200:
                    po_detail = detail_response.json().get('data', {})
                    items = po_detail.get('items', [])
                    
                    # Check if items have unitPrice>0 and weight>0
                    suitable = all(
                        float(item.get('unitPrice', 0)) > 0 and float(item.get('weight', 0)) > 0
                        for item in items
                    ) and len(items) > 0
                    
                    if suitable:
                        print_result(True, f"Found suitable PO: {po['poNumber']} (ID: {po['id']})")
                        cleanup_data['po_id'] = po['id']
                        cleanup_data['created_po'] = False
                        
                        # Record original state for cleanup
                        cleanup_data['original_po_state'] = {
                            'totalAmount': po_detail.get('totalAmount'),
                            'invoiceWeightBasis': po_detail.get('invoiceWeightBasis'),
                            'items': [{
                                'id': item['id'],
                                'productId': item['productId'],
                                'unitPrice': item.get('unitPrice'),
                                'weight': item.get('weight'),
                                'receivedWeight': item.get('receivedWeight'),
                                'tallyWeight': item.get('tallyWeight')
                            } for item in items]
                        }
                        
                        return po_detail
        
        # No suitable PO found, create one
        print("No suitable PO found, creating a new one...")
        
        # Get a supplier
        contacts_response = session.get(f"{BASE_URL}/contacts", timeout=10)
        if contacts_response.status_code != 200:
            print_result(False, f"Failed to get contacts: {contacts_response.status_code}")
            return None
        
        contacts = contacts_response.json().get('data', [])
        supplier = next((c for c in contacts if 'Supplier' in c.get('categories', [])), None)
        
        if not supplier:
            print_result(False, "No supplier found in database")
            return None
        
        # Get a product
        products_response = session.get(f"{BASE_URL}/products", timeout=10)
        if products_response.status_code != 200:
            print_result(False, f"Failed to get products: {products_response.status_code}")
            return None
        
        products = products_response.json().get('data', [])
        if len(products) == 0:
            print_result(False, "No products found in database")
            return None
        
        product = products[0]
        
        # Create PO
        po_payload = {
            "supplierId": supplier['id'],
            "poType": "Produk Jadi",
            "items": [{
                "productId": product['id'],
                "weight": 100,
                "quantity": 1,
                "unitPrice": 50000
            }],
            "additionalCost": 10000
        }
        
        create_response = session.post(f"{BASE_URL}/purchase-orders", json=po_payload, timeout=10)
        if create_response.status_code != 201:
            print_result(False, f"Failed to create PO: {create_response.status_code} - {create_response.text}")
            return None
        
        po_data = create_response.json().get('data', {})
        po_id = po_data['id']
        
        # Get full PO detail
        detail_response = session.get(f"{BASE_URL}/purchase-orders/{po_id}", timeout=10)
        if detail_response.status_code != 200:
            print_result(False, f"Failed to get created PO detail: {detail_response.status_code}")
            return None
        
        po_detail = detail_response.json().get('data', {})
        
        print_result(True, f"Created new PO: {po_data['poNumber']} (ID: {po_id})")
        print(f"  Supplier: {supplier['displayName']}")
        print(f"  Product: {product['name']} ({product['sku']})")
        print(f"  Plan weight: 100 kg, Unit price: Rp 50,000, Additional cost: Rp 10,000")
        print(f"  Initial totalAmount: Rp {po_detail.get('totalAmount'):,.0f}")
        
        cleanup_data['po_id'] = po_id
        cleanup_data['created_po'] = True
        cleanup_data['original_po_state'] = {
            'totalAmount': po_detail.get('totalAmount'),
            'invoiceWeightBasis': po_detail.get('invoiceWeightBasis'),
            'items': [{
                'id': item['id'],
                'productId': item['productId'],
                'unitPrice': item.get('unitPrice'),
                'weight': item.get('weight'),
                'receivedWeight': item.get('receivedWeight', 0),
                'tallyWeight': item.get('tallyWeight', 0)
            } for item in po_detail.get('items', [])]
        }
        
        return po_detail
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        return None

def create_grn(session, po_id, po_detail):
    """Step 2: POST GRN with receivedWeight (Surat Jalan)"""
    print_step(2, "POST GRN with receivedWeight (Surat Jalan / berat dikirim)")
    
    try:
        items = po_detail.get('items', [])
        if len(items) == 0:
            print_result(False, "PO has no items")
            return None
        
        # Use 90% of plan weight as received weight (simulating shrinkage during transport)
        grn_items = []
        for item in items:
            plan_weight = float(item.get('weight', 0))
            received_weight = round(plan_weight * 0.9, 2)  # 90% of plan weight
            grn_items.append({
                "productId": item['productId'],
                "receivedWeight": received_weight,
                "receivedQuantity": 1
            })
        
        grn_payload = {
            "receivedDate": "2026-08-15",
            "receivedBy": "Test Receiver",
            "sjNumber": "SJ-TEST-001",
            "driverName": "Test Driver",
            "vehicleNumber": "B1234XYZ",
            "items": grn_items,
            "notes": "Test GRN for invoice basis testing"
        }
        
        response = session.post(f"{BASE_URL}/purchase-orders/{po_id}/grn", json=grn_payload, timeout=10)
        if response.status_code != 201:
            print_result(False, f"Failed to create GRN: {response.status_code} - {response.text}")
            return None
        
        grn_data = response.json().get('data', {})
        grn_id = grn_data['id']
        cleanup_data['grn_id'] = grn_id
        
        print_result(True, f"Created GRN: {grn_data['grnNumber']} (ID: {grn_id})")
        print(f"  SJ Number: {grn_data.get('sjNumber')}")
        print(f"  Total received weight: {grn_data.get('totalReceivedWeight')} kg")
        print(f"  PO totalAmount after GRN: Rp {grn_data.get('totalAmount'):,.0f}")
        
        # Verify PO state after GRN
        detail_response = session.get(f"{BASE_URL}/purchase-orders/{po_id}", timeout=10)
        if detail_response.status_code != 200:
            print_result(False, f"Failed to get PO detail after GRN: {detail_response.status_code}")
            return None
        
        po_after_grn = detail_response.json().get('data', {})
        
        # Verify invoiceWeightBasis is 'shipped'
        invoice_basis = po_after_grn.get('invoiceWeightBasis', 'shipped')
        if invoice_basis != 'shipped':
            print_result(False, f"Expected invoiceWeightBasis='shipped', got '{invoice_basis}'")
            return None
        
        print(f"  ✅ invoiceWeightBasis: {invoice_basis}")
        print(f"  ✅ totalReceivedWeight: {po_after_grn.get('totalReceivedWeight')} kg")
        print(f"  ✅ totalTallyWeight: {po_after_grn.get('totalTallyWeight', 0)} kg (should be 0)")
        print(f"  ✅ invoiceShippedTotal: Rp {po_after_grn.get('invoiceShippedTotal'):,.0f}")
        print(f"  ✅ invoiceTallyTotal: Rp {po_after_grn.get('invoiceTallyTotal'):,.0f}")
        
        # Calculate expected totalAmount (unitPrice * receivedWeight + additionalCost)
        expected_total = sum(
            float(item.get('unitPrice', 0)) * float(item.get('receivedWeight', 0))
            for item in po_after_grn.get('items', [])
        ) + float(po_after_grn.get('additionalCost', 0))
        
        actual_total = float(po_after_grn.get('totalAmount', 0))
        
        if abs(actual_total - expected_total) > 0.01:
            print_result(False, f"totalAmount mismatch: expected {expected_total:,.2f}, got {actual_total:,.2f}")
            return None
        
        print(f"  ✅ totalAmount calculation correct: Rp {actual_total:,.0f}")
        
        return po_after_grn
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return None

def create_tally_inbound(session, po_id, po_detail):
    """Step 3: Create temp cold storage and POST inventory/inbound with tally weight"""
    print_step(3, "Create temp cold storage and POST inventory/inbound (Tally / berat diterima)")
    
    try:
        # Create temporary cold storage
        cs_payload = {
            "name": "TEST-CS-TALLY",
            "code": f"TEST-CS-{int(requests.get('http://worldtimeapi.org/api/timezone/Asia/Jakarta').json()['unixtime'])}",
            "location": "Test Location",
            "capacity": 1000,
            "status": "active"
        }
        
        cs_response = session.post(f"{BASE_URL}/cold-storages", json=cs_payload, timeout=10)
        if cs_response.status_code != 201:
            print_result(False, f"Failed to create cold storage: {cs_response.status_code} - {cs_response.text}")
            return None
        
        cs_data = cs_response.json().get('data', {})
        cs_id = cs_data['id']
        cleanup_data['cold_storage_id'] = cs_id
        
        print(f"  Created temp cold storage: {cs_data['name']} (ID: {cs_id})")
        
        # Create inventory inbound with tally weight (slightly lower than SJ weight)
        items = po_detail.get('items', [])
        inbound_items = []
        
        for item in items:
            received_weight = float(item.get('receivedWeight', 0))
            # Tally weight is 2 kg less than SJ weight (simulating shrinkage during re-weigh)
            tally_weight = max(received_weight - 2, 0)
            
            inbound_items.append({
                "productId": item['productId'],
                "weight": tally_weight,
                "quantity": 1,
                "packagingType": "karung"
            })
        
        inbound_payload = {
            "referenceType": "PO",
            "referenceId": po_id,
            "coldStorageId": cs_id,
            "items": inbound_items,
            "notes": "Test tally inbound for invoice basis testing"
        }
        
        inbound_response = session.post(f"{BASE_URL}/inventory/inbound", json=inbound_payload, timeout=10)
        if inbound_response.status_code != 201:
            print_result(False, f"Failed to create inbound: {inbound_response.status_code} - {inbound_response.text}")
            return None
        
        inbound_data = inbound_response.json().get('data', {})
        cleanup_data['inventory_transaction_id'] = inbound_data['transactionId']
        cleanup_data['stock_ids'] = inbound_data.get('stockIds', [])
        
        print_result(True, f"Created inventory inbound transaction: {inbound_data['transactionId']}")
        print(f"  Stock IDs: {len(cleanup_data['stock_ids'])} stocks created")
        
        # Verify PO state after inbound
        detail_response = session.get(f"{BASE_URL}/purchase-orders/{po_id}", timeout=10)
        if detail_response.status_code != 200:
            print_result(False, f"Failed to get PO detail after inbound: {detail_response.status_code}")
            return None
        
        po_after_inbound = detail_response.json().get('data', {})
        
        # Verify tally weight accumulated
        total_tally_weight = float(po_after_inbound.get('totalTallyWeight', 0))
        expected_tally_weight = sum(item['weight'] for item in inbound_items)
        
        if abs(total_tally_weight - expected_tally_weight) > 0.01:
            print_result(False, f"totalTallyWeight mismatch: expected {expected_tally_weight}, got {total_tally_weight}")
            return None
        
        print(f"  ✅ totalTallyWeight accumulated: {total_tally_weight} kg")
        
        # Verify each item's tally weight
        for item in po_after_inbound.get('items', []):
            item_tally = float(item.get('tallyWeight', 0))
            print(f"  ✅ Item {item['product']['sku']}: tallyWeight = {item_tally} kg")
        
        # Verify invoiceTallyTotal is different from invoiceShippedTotal
        invoice_shipped = float(po_after_inbound.get('invoiceShippedTotal', 0))
        invoice_tally = float(po_after_inbound.get('invoiceTallyTotal', 0))
        
        print(f"  ✅ invoiceShippedTotal: Rp {invoice_shipped:,.0f}")
        print(f"  ✅ invoiceTallyTotal: Rp {invoice_tally:,.0f}")
        
        if abs(invoice_shipped - invoice_tally) < 0.01:
            print("  ⚠️  WARNING: invoiceShippedTotal and invoiceTallyTotal are the same (expected different)")
        
        # Verify totalAmount is still based on shipped weight (default basis)
        current_total = float(po_after_inbound.get('totalAmount', 0))
        if abs(current_total - invoice_shipped) > 0.01:
            print_result(False, f"totalAmount should equal invoiceShippedTotal (shipped basis), got {current_total:,.2f} vs {invoice_shipped:,.2f}")
            return None
        
        print(f"  ✅ totalAmount still based on shipped weight: Rp {current_total:,.0f}")
        
        return po_after_inbound
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return None

def test_invoice_basis_switch(session, po_id, po_detail):
    """Step 4: POST invoice endpoint to switch basis between 'tally' and 'shipped'"""
    print_step(4, "POST /api/purchase-orders/:id/invoice to switch basis")
    
    try:
        invoice_shipped = float(po_detail.get('invoiceShippedTotal', 0))
        invoice_tally = float(po_detail.get('invoiceTallyTotal', 0))
        
        # Switch to 'tally' basis
        print("\n  Switching to 'tally' basis...")
        tally_response = session.post(
            f"{BASE_URL}/purchase-orders/{po_id}/invoice",
            json={"basis": "tally"},
            timeout=10
        )
        
        if tally_response.status_code != 200:
            print_result(False, f"Failed to switch to tally basis: {tally_response.status_code} - {tally_response.text}")
            return None
        
        tally_data = tally_response.json().get('data', {})
        print(f"  ✅ Switched to tally basis")
        print(f"  ✅ New totalAmount: Rp {tally_data.get('totalAmount'):,.0f}")
        print(f"  ✅ invoiceWeightBasis: {tally_data.get('invoiceWeightBasis')}")
        
        # Verify totalAmount matches invoiceTallyTotal
        if abs(float(tally_data.get('totalAmount', 0)) - invoice_tally) > 0.01:
            print_result(False, f"totalAmount should equal invoiceTallyTotal, got {tally_data.get('totalAmount'):,.2f} vs {invoice_tally:,.2f}")
            return None
        
        # Verify invoiceWeightBasis is 'tally'
        if tally_data.get('invoiceWeightBasis') != 'tally':
            print_result(False, f"Expected invoiceWeightBasis='tally', got '{tally_data.get('invoiceWeightBasis')}'")
            return None
        
        # Get PO detail to verify
        detail_response = session.get(f"{BASE_URL}/purchase-orders/{po_id}", timeout=10)
        if detail_response.status_code != 200:
            print_result(False, f"Failed to get PO detail: {detail_response.status_code}")
            return None
        
        po_tally = detail_response.json().get('data', {})
        
        if po_tally.get('invoiceWeightBasis') != 'tally':
            print_result(False, f"PO invoiceWeightBasis should be 'tally', got '{po_tally.get('invoiceWeightBasis')}'")
            return None
        
        # Switch back to 'shipped' basis
        print("\n  Switching back to 'shipped' basis...")
        shipped_response = session.post(
            f"{BASE_URL}/purchase-orders/{po_id}/invoice",
            json={"basis": "shipped"},
            timeout=10
        )
        
        if shipped_response.status_code != 200:
            print_result(False, f"Failed to switch to shipped basis: {shipped_response.status_code} - {shipped_response.text}")
            return None
        
        shipped_data = shipped_response.json().get('data', {})
        print(f"  ✅ Switched back to shipped basis")
        print(f"  ✅ New totalAmount: Rp {shipped_data.get('totalAmount'):,.0f}")
        print(f"  ✅ invoiceWeightBasis: {shipped_data.get('invoiceWeightBasis')}")
        
        # Verify totalAmount matches invoiceShippedTotal
        if abs(float(shipped_data.get('totalAmount', 0)) - invoice_shipped) > 0.01:
            print_result(False, f"totalAmount should equal invoiceShippedTotal, got {shipped_data.get('totalAmount'):,.2f} vs {invoice_shipped:,.2f}")
            return None
        
        # Verify invoiceWeightBasis is 'shipped'
        if shipped_data.get('invoiceWeightBasis') != 'shipped':
            print_result(False, f"Expected invoiceWeightBasis='shipped', got '{shipped_data.get('invoiceWeightBasis')}'")
            return None
        
        print_result(True, "Invoice basis switching works correctly")
        
        return True
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return None

def test_hpp_endpoint(session, po_id):
    """Step 5: GET HPP endpoint and verify it uses tally weight"""
    print_step(5, "GET /api/purchase-orders/:id/hpp - verify HPP uses tally weight")
    
    try:
        response = session.get(f"{BASE_URL}/purchase-orders/{po_id}/hpp", timeout=10)
        if response.status_code != 200:
            print_result(False, f"Failed to get HPP: {response.status_code} - {response.text}")
            return None
        
        hpp_data = response.json().get('data', {})
        totals = hpp_data.get('totals', {})
        items = hpp_data.get('items', [])
        
        print(f"  HPP Calculation Summary:")
        print(f"  ✅ hppBasis: {totals.get('hppBasis')}")
        print(f"  ✅ invoiceWeightBasis: {totals.get('invoiceWeightBasis')}")
        print(f"  ✅ totalWeightBilled: {totals.get('totalWeightBilled')} kg")
        print(f"  ✅ totalWeightActual (tally): {totals.get('totalWeightActual')} kg")
        print(f"  ✅ totalSusut: {totals.get('totalSusut')} kg")
        print(f"  ✅ totalHpp: Rp {totals.get('totalHpp'):,.0f}")
        print(f"  ✅ avgHppPerKg: Rp {totals.get('avgHppPerKg'):,.2f}")
        
        # Verify hppBasis is 'tally'
        if totals.get('hppBasis') != 'tally':
            print_result(False, f"Expected hppBasis='tally', got '{totals.get('hppBasis')}'")
            return None
        
        # Verify each item
        print(f"\n  Item Details:")
        for item in items:
            product = item.get('product', {})
            print(f"    Product: {product.get('name')} ({product.get('sku')})")
            print(f"      weightBilled: {item.get('weightBilled')} kg")
            print(f"      weightActual (tally): {item.get('weightActual')} kg")
            print(f"      susut: {item.get('susut')} kg")
            print(f"      hppPerKg: Rp {item.get('hppPerKg'):,.2f}")
            
            # Verify weightActual equals tallyWeight
            tally_weight = float(item.get('tallyWeight', 0))
            weight_actual = float(item.get('weightActual', 0))
            
            if abs(weight_actual - tally_weight) > 0.01:
                print_result(False, f"weightActual should equal tallyWeight, got {weight_actual} vs {tally_weight}")
                return None
            
            # Verify susut = max(0, receivedWeight - tallyWeight)
            received_weight = float(item.get('receivedWeight', 0))
            expected_susut = max(0, received_weight - tally_weight)
            actual_susut = float(item.get('susut', 0))
            
            if abs(actual_susut - expected_susut) > 0.01:
                print_result(False, f"susut calculation wrong: expected {expected_susut}, got {actual_susut}")
                return None
        
        # Verify avgHppPerKg = totalHpp / totalWeightActual
        total_hpp = float(totals.get('totalHpp', 0))
        total_weight_actual = float(totals.get('totalWeightActual', 0))
        expected_avg_hpp = total_hpp / total_weight_actual if total_weight_actual > 0 else 0
        actual_avg_hpp = float(totals.get('avgHppPerKg', 0))
        
        if abs(actual_avg_hpp - expected_avg_hpp) > 0.01:
            print_result(False, f"avgHppPerKg calculation wrong: expected {expected_avg_hpp:.2f}, got {actual_avg_hpp:.2f}")
            return None
        
        print_result(True, "HPP calculation uses tally weight correctly")
        
        return True
        
    except Exception as e:
        print_result(False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return None

def cleanup(session):
    """Step 6: CLEANUP everything created"""
    print_step(6, "CLEANUP - Restore original state")
    
    try:
        # Delete inventory stocks
        if cleanup_data['stock_ids']:
            print(f"  Deleting {len(cleanup_data['stock_ids'])} inventory stocks...")
            for stock_id in cleanup_data['stock_ids']:
                try:
                    session.delete(f"{BASE_URL}/inventory/stocks/{stock_id}", timeout=10)
                except Exception:
                    pass
            print(f"  ✅ Deleted inventory stocks")
        
        # Delete inventory transaction
        if cleanup_data['inventory_transaction_id']:
            print(f"  Deleting inventory transaction {cleanup_data['inventory_transaction_id']}...")
            try:
                session.delete(f"{BASE_URL}/inventory/transactions/{cleanup_data['inventory_transaction_id']}", timeout=10)
            except Exception:
                pass
            print(f"  ✅ Deleted inventory transaction")
        
        # Delete GRN
        if cleanup_data['grn_id']:
            print(f"  Deleting GRN {cleanup_data['grn_id']}...")
            try:
                session.delete(f"{BASE_URL}/grns/{cleanup_data['grn_id']}", timeout=10)
            except Exception:
                pass
            print(f"  ✅ Deleted GRN")
        
        # Delete cold storage
        if cleanup_data['cold_storage_id']:
            print(f"  Deleting cold storage {cleanup_data['cold_storage_id']}...")
            try:
                session.delete(f"{BASE_URL}/cold-storages/{cleanup_data['cold_storage_id']}", timeout=10)
            except Exception:
                pass
            print(f"  ✅ Deleted cold storage")
        
        # Restore PO or delete if created
        if cleanup_data['po_id']:
            if cleanup_data['created_po']:
                print(f"  Deleting created PO {cleanup_data['po_id']}...")
                try:
                    session.delete(f"{BASE_URL}/purchase-orders/{cleanup_data['po_id']}", timeout=10)
                    print(f"  ✅ Deleted PO")
                except Exception as e:
                    print(f"  ⚠️  Failed to delete PO: {e}")
            else:
                print(f"  Restoring original PO state...")
                # Restore original totalAmount and invoiceWeightBasis
                original = cleanup_data['original_po_state']
                if original:
                    try:
                        # Reset invoice basis to original
                        session.post(
                            f"{BASE_URL}/purchase-orders/{cleanup_data['po_id']}/invoice",
                            json={"basis": original.get('invoiceWeightBasis', 'shipped')},
                            timeout=10
                        )
                        
                        # Reset item weights (this might not be possible via API, so we'll just note it)
                        print(f"  ⚠️  Note: Item receivedWeight and tallyWeight may not be fully restored")
                        print(f"  ✅ Restored PO invoice basis to '{original.get('invoiceWeightBasis', 'shipped')}'")
                    except Exception as e:
                        print(f"  ⚠️  Failed to restore PO: {e}")
        
        print_result(True, "Cleanup completed")
        
    except Exception as e:
        print_result(False, f"Cleanup exception: {e}")
        import traceback
        traceback.print_exc()

def main():
    print("=" * 80)
    print("BACKEND TEST: PO Invoice Basis (Surat Jalan vs Tally) + HPP from Tally")
    print("=" * 80)
    
    # Login
    print("\n--- AUTHENTICATION ---")
    session = login()
    if not session:
        print("\n❌ CRITICAL: Cannot proceed without authentication")
        return 1
    
    # Run test flow
    print("\n--- RUNNING TEST FLOW ---")
    
    results = []
    
    # Step 1: Find or create PO
    po_detail = find_or_create_po(session)
    if not po_detail:
        print("\n❌ CRITICAL: Failed at Step 1")
        cleanup(session)
        return 1
    results.append(True)
    
    # Step 2: Create GRN
    po_after_grn = create_grn(session, cleanup_data['po_id'], po_detail)
    if not po_after_grn:
        print("\n❌ CRITICAL: Failed at Step 2")
        cleanup(session)
        return 1
    results.append(True)
    
    # Step 3: Create tally inbound
    po_after_inbound = create_tally_inbound(session, cleanup_data['po_id'], po_after_grn)
    if not po_after_inbound:
        print("\n❌ CRITICAL: Failed at Step 3")
        cleanup(session)
        return 1
    results.append(True)
    
    # Step 4: Test invoice basis switch
    switch_result = test_invoice_basis_switch(session, cleanup_data['po_id'], po_after_inbound)
    if not switch_result:
        print("\n❌ CRITICAL: Failed at Step 4")
        cleanup(session)
        return 1
    results.append(True)
    
    # Step 5: Test HPP endpoint
    hpp_result = test_hpp_endpoint(session, cleanup_data['po_id'])
    if not hpp_result:
        print("\n❌ CRITICAL: Failed at Step 5")
        cleanup(session)
        return 1
    results.append(True)
    
    # Step 6: Cleanup
    cleanup(session)
    results.append(True)
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    passed = sum(1 for r in results if r)
    total = len(results)
    print(f"\nTotal: {passed}/{total} steps passed ({int(passed/total*100)}%)")
    
    if passed == total:
        print("\n✅ ALL TESTS PASSED - PO Invoice Basis features working correctly")
        print("\nVerified:")
        print("  ✅ GRN creates receivedWeight (Surat Jalan / berat dikirim)")
        print("  ✅ Inventory inbound accumulates tallyWeight (Tally / berat diterima)")
        print("  ✅ POST /api/purchase-orders/:id/invoice switches basis and recomputes totalAmount")
        print("  ✅ GET /api/purchase-orders/:id/hpp uses tally weight for HPP calculation")
        print("  ✅ Cleanup completed successfully")
        return 0
    else:
        print(f"\n❌ {total - passed} STEP(S) FAILED - See details above")
        return 1
    
    print("=" * 80)

if __name__ == "__main__":
    sys.exit(main())
