#!/usr/bin/env python3
"""
Retry failed Purchase Order tests
"""

import requests
import time

BASE_URL = "https://data-management-hub-13.preview.emergentagent.com/api"

def login_admin():
    session = requests.Session()
    resp = session.post(
        f"{BASE_URL}/auth/sign-in/email",
        json={"email": "admin@lpi.co.id", "password": "admin123"},
        timeout=30
    )
    if resp.status_code == 200:
        print("✅ Admin logged in")
        return session
    else:
        print(f"❌ Login failed: {resp.status_code}")
        return None

def get_test_data(session):
    """Get IDs needed for testing"""
    data = {}
    
    # Get contacts
    resp = session.get(f"{BASE_URL}/contacts", timeout=30)
    if resp.status_code == 200:
        contacts = resp.json().get('data', [])
        for c in contacts:
            if c.get('code') == 'SUP-001':
                data['supplier_id'] = c['id']
            elif c.get('code') == 'CUST-001':
                data['customer_id'] = c['id']
    
    # Get products
    resp = session.get(f"{BASE_URL}/products", timeout=30)
    if resp.status_code == 200:
        products = resp.json().get('data', [])
        for p in products:
            if p.get('sku') == 'LB-001':
                data['product_lb_id'] = p['id']
    
    return data

def test_po_payment_completion():
    """Test PO payment completion flow"""
    print("\n" + "="*60)
    print("TEST: PO Payment Completion")
    print("="*60)
    
    session = login_admin()
    if not session:
        return False
    
    time.sleep(2)  # Wait for server
    
    data = get_test_data(session)
    if not all(k in data for k in ['supplier_id', 'product_lb_id']):
        print("❌ Missing test data")
        return False
    
    # Create a new PO
    po_data = {
        "supplierId": data['supplier_id'],
        "poType": "Live Bird",
        "method": "Timbang Ulang",
        "orderDate": "2025-06-20",
        "additionalCost": 100000,
        "paymentTerm": "Cash",
        "items": [{
            "productId": data['product_lb_id'],
            "quantity": 50,
            "weight": 50,
            "unitPrice": 22000
        }]
    }
    
    time.sleep(2)
    resp = session.post(f"{BASE_URL}/purchase-orders", json=po_data, timeout=30)
    
    if resp.status_code != 201:
        print(f"❌ Failed to create PO: {resp.status_code}")
        return False
    
    po = resp.json().get('data', {})
    po_id = po['id']
    total = po.get('totalAmount', 0)
    print(f"✅ PO created: {po.get('poNumber')}, total: {total}")
    
    # Transition to Tanda Terima
    time.sleep(2)
    for status in ['Menunggu Konfirmasi', 'Diproses', 'Dikirim']:
        resp = session.post(f"{BASE_URL}/purchase-orders/{po_id}/status",
                           json={"status": status}, timeout=30)
        if resp.status_code != 200:
            print(f"❌ Failed to transition to {status}: {resp.status_code}")
            return False
        time.sleep(1)
    
    # Create GRN
    time.sleep(2)
    resp = session.post(f"{BASE_URL}/purchase-orders/{po_id}/grn",
                       json={"receivedDate": "2025-06-20", "notes": "test"}, timeout=30)
    
    if resp.status_code != 201:
        print(f"❌ Failed to create GRN: {resp.status_code}")
        return False
    
    print(f"✅ GRN created")
    
    # Make full payment
    time.sleep(2)
    resp = session.post(f"{BASE_URL}/purchase-orders/{po_id}/payments",
                       json={"amount": total, "method": "Transfer", "reference": "TEST-001"},
                       timeout=30)
    
    if resp.status_code != 201:
        print(f"❌ Failed to create payment: {resp.status_code}")
        return False
    
    print(f"✅ Payment created: {total}")
    
    # Check final status
    time.sleep(2)
    resp = session.get(f"{BASE_URL}/purchase-orders/{po_id}", timeout=30)
    
    if resp.status_code != 200:
        print(f"❌ Failed to get PO: {resp.status_code}")
        return False
    
    po_final = resp.json().get('data', {})
    
    if po_final.get('paymentStatus') == 'paid' and po_final.get('pipelineStatus') == 'Selesai':
        print(f"✅ Payment complete: paymentStatus=paid, pipelineStatus=Selesai")
        return True
    else:
        print(f"❌ Status incorrect: paymentStatus={po_final.get('paymentStatus')}, pipelineStatus={po_final.get('pipelineStatus')}")
        return False

def test_po_returns():
    """Test PO returns"""
    print("\n" + "="*60)
    print("TEST: PO Returns")
    print("="*60)
    
    session = login_admin()
    if not session:
        return False
    
    time.sleep(2)
    
    data = get_test_data(session)
    if not all(k in data for k in ['supplier_id', 'product_lb_id']):
        print("❌ Missing test data")
        return False
    
    # Create a new PO
    po_data = {
        "supplierId": data['supplier_id'],
        "poType": "Live Bird",
        "method": "Timbang Ulang",
        "orderDate": "2025-06-21",
        "additionalCost": 0,
        "paymentTerm": "Cash",
        "items": [{
            "productId": data['product_lb_id'],
            "quantity": 50,
            "weight": 50,
            "unitPrice": 22000
        }]
    }
    
    time.sleep(2)
    resp = session.post(f"{BASE_URL}/purchase-orders", json=po_data, timeout=30)
    
    if resp.status_code != 201:
        print(f"❌ Failed to create PO: {resp.status_code}")
        return False
    
    po = resp.json().get('data', {})
    po_id = po['id']
    print(f"✅ PO created: {po.get('poNumber')}")
    
    # Create return
    time.sleep(2)
    return_data = {
        "reason": "Test return - 5kg rusak",
        "resolution": "potong_invoice",
        "totalAmount": 110000,
        "totalWeight": 5
    }
    
    resp = session.post(f"{BASE_URL}/purchase-orders/{po_id}/returns",
                       json=return_data, timeout=30)
    
    if resp.status_code == 201:
        ret = resp.json().get('data', {})
        notification = ret.get('notification', {})
        
        if notification.get('to') == ['supervisor', 'direktur']:
            print(f"✅ Return created with correct notification")
            return True
        else:
            print(f"❌ Notification incorrect: {notification.get('to')}")
            return False
    else:
        print(f"❌ Failed to create return: {resp.status_code} - {resp.text[:200]}")
        return False

def test_po_timbang_kandang():
    """Test PO with Timbang Kandang method"""
    print("\n" + "="*60)
    print("TEST: PO Timbang Kandang")
    print("="*60)
    
    session = login_admin()
    if not session:
        return False
    
    time.sleep(2)
    
    data = get_test_data(session)
    if not all(k in data for k in ['supplier_id', 'product_lb_id']):
        print("❌ Missing test data")
        return False
    
    # Create PO with Timbang Kandang
    po_data = {
        "supplierId": data['supplier_id'],
        "poType": "Live Bird",
        "method": "Timbang Kandang",
        "orderDate": "2025-06-22",
        "additionalCost": 0,
        "paymentTerm": "Cash",
        "items": [{
            "productId": data['product_lb_id'],
            "quantity": 100,
            "weight": 100,
            "unitPrice": 22000
        }]
    }
    
    time.sleep(2)
    resp = session.post(f"{BASE_URL}/purchase-orders", json=po_data, timeout=30)
    
    if resp.status_code != 201:
        print(f"❌ Failed to create PO: {resp.status_code}")
        return False
    
    po = resp.json().get('data', {})
    po_id = po['id']
    print(f"✅ PO Timbang Kandang created: {po.get('poNumber')}")
    
    # Get items
    time.sleep(2)
    resp = session.get(f"{BASE_URL}/purchase-orders/{po_id}", timeout=30)
    
    if resp.status_code != 200:
        print(f"❌ Failed to get PO: {resp.status_code}")
        return False
    
    items = resp.json().get('data', {}).get('items', [])
    if not items:
        print("❌ No items found")
        return False
    
    item_id = items[0]['id']
    
    # Update weighings
    time.sleep(2)
    weighing_data = {
        "items": [{
            "id": item_id,
            "weightSupplier": 100,
            "weightRph": 95,
            "headSupplier": 100,
            "headRph": 100
        }]
    }
    
    resp = session.post(f"{BASE_URL}/purchase-orders/{po_id}/weighings",
                       json=weighing_data, timeout=30)
    
    if resp.status_code != 200:
        print(f"❌ Failed to update weighings: {resp.status_code}")
        return False
    
    print(f"✅ Weighings updated")
    
    # Get HPP
    time.sleep(2)
    resp = session.get(f"{BASE_URL}/purchase-orders/{po_id}/hpp", timeout=30)
    
    if resp.status_code != 200:
        print(f"❌ Failed to get HPP: {resp.status_code}")
        return False
    
    hpp_data = resp.json().get('data', {})
    hpp_items = hpp_data.get('items', [])
    
    if not hpp_items:
        print("❌ No HPP items")
        return False
    
    item = hpp_items[0]
    weight_billed = item.get('weightBilled')
    weight_actual = item.get('weightActual')
    susut = item.get('susut')
    
    print(f"   - Weight Billed: {weight_billed} (should be 100)")
    print(f"   - Weight Actual: {weight_actual} (should be 95)")
    print(f"   - Susut: {susut} kg (should be 5)")
    
    if weight_billed == 100 and weight_actual == 95 and susut == 5:
        print(f"✅ Timbang Kandang logic correct")
        return True
    else:
        print(f"❌ Timbang Kandang logic incorrect")
        return False

def main():
    print("\n" + "="*60)
    print("🔄 RETRYING FAILED PURCHASE ORDER TESTS")
    print("="*60)
    
    results = {
        "Payment Completion": test_po_payment_completion(),
        "Returns": test_po_returns(),
        "Timbang Kandang": test_po_timbang_kandang()
    }
    
    print("\n" + "="*60)
    print("RETRY RESULTS")
    print("="*60)
    
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{test_name}: {status}")
    
    passed_count = sum(1 for v in results.values() if v)
    total_count = len(results)
    
    print(f"\nTotal: {passed_count}/{total_count} passed")

if __name__ == "__main__":
    main()
