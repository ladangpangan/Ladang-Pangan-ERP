#!/usr/bin/env python3
"""
Comprehensive Backend Testing for LPI ERP
Tests Purchase Orders, Sales Orders, and Sales Reports modules
"""

import requests
import json
from datetime import datetime, timedelta

# Base URL from .env
BASE_URL = "https://pangan-system.preview.emergentagent.com/api"

# Test credentials
CREDENTIALS = {
    "admin": {"email": "admin@lpi.co.id", "password": "admin123"},
    "supervisor": {"email": "supervisor@lpi.co.id", "password": "super123"},
    "direktur": {"email": "direktur@lpi.co.id", "password": "direktur123"},
    "operator": {"email": "operator@lpi.co.id", "password": "operator123"}
}

# Global session storage
sessions = {}
test_data = {}

def login(role):
    """Login and return session with cookies"""
    print(f"\n{'='*60}")
    print(f"🔐 Logging in as {role}...")
    session = requests.Session()
    creds = CREDENTIALS[role]
    
    try:
        resp = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json=creds,
            timeout=30
        )
        
        if resp.status_code == 200:
            print(f"✅ Login successful for {role}")
            sessions[role] = session
            return session
        else:
            print(f"❌ Login failed for {role}: {resp.status_code} - {resp.text[:200]}")
            return None
    except Exception as e:
        print(f"❌ Login exception for {role}: {str(e)}")
        return None

def run_seed():
    """Run seed endpoint to ensure data exists"""
    print(f"\n{'='*60}")
    print("🌱 Running seed endpoint...")
    
    try:
        resp = requests.post(f"{BASE_URL}/seed", timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            print(f"✅ Seed endpoint: {data.get('message', 'Success')}")
            return True
        else:
            print(f"❌ Seed failed: {resp.status_code}")
            return False
    except Exception as e:
        print(f"❌ Seed exception: {str(e)}")
        return False

def get_master_data():
    """Get contact and product IDs needed for testing"""
    print(f"\n{'='*60}")
    print("📋 Fetching master data (contacts & products)...")
    
    session = sessions.get('admin')
    if not session:
        print("❌ No admin session available")
        return False
    
    try:
        # Get contacts
        resp = session.get(f"{BASE_URL}/contacts", timeout=30)
        if resp.status_code != 200:
            print(f"❌ Failed to get contacts: {resp.status_code}")
            return False
        
        contacts = resp.json().get('data', [])
        
        # Find specific contacts
        for contact in contacts:
            code = contact.get('code')
            if code == 'SUP-001':
                test_data['supplier_id'] = contact['id']
                print(f"✅ Found Supplier SUP-001: {contact['displayName']} (ID: {contact['id']})")
            elif code == 'CUST-001':
                test_data['customer_regular_id'] = contact['id']
                print(f"✅ Found Customer CUST-001: {contact['displayName']} (ID: {contact['id']})")
            elif code == 'CUST-002':
                test_data['customer_subscriber_id'] = contact['id']
                test_data['subscriber_initial_balance'] = contact.get('prepaidBalance', 0)
                print(f"✅ Found Subscriber CUST-002: {contact['displayName']} (ID: {contact['id']}, Balance: {contact.get('prepaidBalance', 0)})")
        
        # Get products
        resp = session.get(f"{BASE_URL}/products", timeout=30)
        if resp.status_code != 200:
            print(f"❌ Failed to get products: {resp.status_code}")
            return False
        
        products = resp.json().get('data', [])
        
        # Find specific products
        for product in products:
            sku = product.get('sku')
            if sku == 'LB-001':
                test_data['product_lb_id'] = product['id']
                print(f"✅ Found Product LB-001: {product['name']} (ID: {product['id']})")
            elif sku == 'KRK-001':
                test_data['product_krk_id'] = product['id']
                print(f"✅ Found Product KRK-001: {product['name']} (ID: {product['id']})")
            elif sku == 'BN-001':
                test_data['product_bn_id'] = product['id']
                print(f"✅ Found Product BN-001: {product['name']} (ID: {product['id']})")
        
        # Verify all required data found
        required = ['supplier_id', 'customer_regular_id', 'customer_subscriber_id', 
                   'product_lb_id', 'product_krk_id', 'product_bn_id']
        missing = [k for k in required if k not in test_data]
        
        if missing:
            print(f"❌ Missing required data: {missing}")
            return False
        
        print("✅ All master data retrieved successfully")
        return True
        
    except Exception as e:
        print(f"❌ Exception getting master data: {str(e)}")
        return False

def test_purchase_orders():
    """Test Purchase Orders module comprehensively"""
    print(f"\n{'='*60}")
    print("🛒 TESTING PURCHASE ORDERS MODULE")
    print(f"{'='*60}")
    
    session = sessions.get('admin')
    if not session:
        print("❌ No admin session")
        return False
    
    results = {"passed": 0, "failed": 0, "tests": []}
    
    # Test 1: Create PO with Timbang Ulang method
    print("\n[TEST 1] Create PO with Timbang Ulang method")
    try:
        po_data = {
            "supplierId": test_data['supplier_id'],
            "poType": "Live Bird",
            "method": "Timbang Ulang",
            "orderDate": "2025-06-15",
            "additionalCost": 500000,
            "paymentTerm": "TOP 14",
            "items": [{
                "productId": test_data['product_lb_id'],
                "quantity": 100,
                "weight": 150,
                "unitPrice": 22000
            }]
        }
        
        resp = session.post(f"{BASE_URL}/purchase-orders", json=po_data, timeout=30)
        
        if resp.status_code == 201:
            po = resp.json().get('data', {})
            po_number = po.get('poNumber', '')
            
            # Verify PO number format
            import re
            if re.match(r'^PO/\d{6}/\d{4}$', po_number):
                print(f"✅ PO created: {po_number}")
                print(f"   - Pipeline Status: {po.get('pipelineStatus')}")
                print(f"   - Method: {po.get('method')}")
                print(f"   - Total Amount: {po.get('totalAmount')}")
                
                test_data['po_timbang_ulang_id'] = po['id']
                test_data['po_timbang_ulang_number'] = po_number
                
                # Verify expected total: (22000 * 150) + 500000 = 3800000
                expected_total = 3800000
                actual_total = po.get('totalAmount', 0)
                
                if abs(actual_total - expected_total) < 1:
                    print(f"✅ Total amount correct: {actual_total}")
                    results["passed"] += 1
                    results["tests"].append("Create PO Timbang Ulang: PASS")
                else:
                    print(f"❌ Total amount mismatch: expected {expected_total}, got {actual_total}")
                    results["failed"] += 1
                    results["tests"].append("Create PO Timbang Ulang: FAIL (amount)")
            else:
                print(f"❌ Invalid PO number format: {po_number}")
                results["failed"] += 1
                results["tests"].append("Create PO Timbang Ulang: FAIL (format)")
        else:
            print(f"❌ Failed to create PO: {resp.status_code} - {resp.text[:200]}")
            results["failed"] += 1
            results["tests"].append("Create PO Timbang Ulang: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("Create PO Timbang Ulang: FAIL (exception)")
    
    # Test 2: GET PO list with status filter
    print("\n[TEST 2] GET /purchase-orders?status=Draft")
    try:
        resp = session.get(f"{BASE_URL}/purchase-orders?status=Draft", timeout=30)
        
        if resp.status_code == 200:
            pos = resp.json().get('data', [])
            found = any(p.get('id') == test_data.get('po_timbang_ulang_id') for p in pos)
            
            if found:
                print(f"✅ PO found in Draft list (total: {len(pos)} POs)")
                results["passed"] += 1
                results["tests"].append("GET PO list Draft: PASS")
            else:
                print(f"❌ Created PO not found in Draft list")
                results["failed"] += 1
                results["tests"].append("GET PO list Draft: FAIL")
        else:
            print(f"❌ Failed to get PO list: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("GET PO list Draft: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("GET PO list Draft: FAIL (exception)")
    
    # Test 3: GET PO detail
    print("\n[TEST 3] GET /purchase-orders/:id (detail)")
    try:
        po_id = test_data.get('po_timbang_ulang_id')
        resp = session.get(f"{BASE_URL}/purchase-orders/{po_id}", timeout=30)
        
        if resp.status_code == 200:
            po_detail = resp.json().get('data', {})
            
            # Verify structure
            has_items = 'items' in po_detail and len(po_detail['items']) > 0
            has_supplier = 'supplier' in po_detail
            has_grn = 'grn' in po_detail
            has_payments = 'payments' in po_detail
            has_returns = 'returns' in po_detail
            has_outstanding = 'outstanding' in po_detail
            
            if all([has_items, has_supplier, has_grn, has_payments, has_returns, has_outstanding]):
                print(f"✅ PO detail structure correct")
                print(f"   - Items: {len(po_detail['items'])}")
                print(f"   - Supplier: {po_detail['supplier'].get('name')}")
                print(f"   - Outstanding: {po_detail['outstanding']}")
                
                # Store first item ID for weighing test
                if po_detail['items']:
                    test_data['po_item_id'] = po_detail['items'][0]['id']
                
                results["passed"] += 1
                results["tests"].append("GET PO detail: PASS")
            else:
                print(f"❌ PO detail structure incomplete")
                results["failed"] += 1
                results["tests"].append("GET PO detail: FAIL (structure)")
        else:
            print(f"❌ Failed to get PO detail: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("GET PO detail: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("GET PO detail: FAIL (exception)")
    
    # Test 4: Update weighings
    print("\n[TEST 4] POST /purchase-orders/:id/weighings")
    try:
        po_id = test_data.get('po_timbang_ulang_id')
        item_id = test_data.get('po_item_id')
        
        weighing_data = {
            "items": [{
                "id": item_id,
                "weightSupplier": 150,
                "weightRph": 145,
                "headSupplier": 100,
                "headRph": 100
            }]
        }
        
        resp = session.post(f"{BASE_URL}/purchase-orders/{po_id}/weighings", 
                           json=weighing_data, timeout=30)
        
        if resp.status_code == 200:
            print(f"✅ Weighings updated successfully")
            results["passed"] += 1
            results["tests"].append("Update weighings: PASS")
        else:
            print(f"❌ Failed to update weighings: {resp.status_code} - {resp.text[:200]}")
            results["failed"] += 1
            results["tests"].append("Update weighings: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("Update weighings: FAIL (exception)")
    
    # Test 5: GET HPP calculation
    print("\n[TEST 5] GET /purchase-orders/:id/hpp")
    try:
        po_id = test_data.get('po_timbang_ulang_id')
        resp = session.get(f"{BASE_URL}/purchase-orders/{po_id}/hpp", timeout=30)
        
        if resp.status_code == 200:
            hpp_data = resp.json().get('data', {})
            items = hpp_data.get('items', [])
            
            if items:
                item = items[0]
                print(f"✅ HPP calculation retrieved")
                print(f"   - Weight Billed: {item.get('weightBilled')} (should be 145 for Timbang Ulang)")
                print(f"   - Weight Actual: {item.get('weightActual')}")
                print(f"   - Susut: {item.get('susut')} kg")
                print(f"   - HPP per Kg: {item.get('hppPerKg')}")
                
                # For Timbang Ulang: weightBilled should be weightRph (145)
                if item.get('weightBilled') == 145:
                    print(f"✅ Timbang Ulang logic correct (billed = weightRph)")
                    results["passed"] += 1
                    results["tests"].append("HPP calculation Timbang Ulang: PASS")
                else:
                    print(f"❌ Timbang Ulang logic incorrect: weightBilled = {item.get('weightBilled')}")
                    results["failed"] += 1
                    results["tests"].append("HPP calculation Timbang Ulang: FAIL")
            else:
                print(f"❌ No items in HPP response")
                results["failed"] += 1
                results["tests"].append("HPP calculation: FAIL (no items)")
        else:
            print(f"❌ Failed to get HPP: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("HPP calculation: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("HPP calculation: FAIL (exception)")
    
    # Test 6: Method lock - try to change method
    print("\n[TEST 6] Method lock - try to change Timbang Ulang to Timbang Kandang")
    try:
        po_id = test_data.get('po_timbang_ulang_id')
        resp = session.patch(f"{BASE_URL}/purchase-orders/{po_id}", 
                            json={"method": "Timbang Kandang"}, timeout=30)
        
        if resp.status_code == 400:
            error_msg = resp.json().get('error', '')
            if 'terkunci' in error_msg.lower() or 'locked' in error_msg.lower():
                print(f"✅ Method lock working: {error_msg}")
                results["passed"] += 1
                results["tests"].append("Method lock: PASS")
            else:
                print(f"❌ Wrong error message: {error_msg}")
                results["failed"] += 1
                results["tests"].append("Method lock: FAIL (wrong error)")
        else:
            print(f"❌ Method lock not working: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("Method lock: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("Method lock: FAIL (exception)")
    
    # Test 7: Status transitions
    print("\n[TEST 7] Status pipeline transitions")
    try:
        po_id = test_data.get('po_timbang_ulang_id')
        transitions = [
            ("Menunggu Konfirmasi", True),
            ("Diproses", True),
            ("Dikirim", True),
            ("Selesai", False),  # Should fail - need Tanda Terima first
        ]
        
        transition_passed = 0
        for target_status, should_succeed in transitions:
            resp = session.post(f"{BASE_URL}/purchase-orders/{po_id}/status",
                               json={"status": target_status}, timeout=30)
            
            if should_succeed:
                if resp.status_code == 200:
                    print(f"✅ Transition to {target_status}: SUCCESS")
                    transition_passed += 1
                else:
                    print(f"❌ Transition to {target_status} failed: {resp.status_code}")
            else:
                if resp.status_code == 400:
                    print(f"✅ Invalid transition to {target_status} correctly rejected")
                    transition_passed += 1
                else:
                    print(f"❌ Invalid transition to {target_status} should return 400, got {resp.status_code}")
        
        if transition_passed == len(transitions):
            results["passed"] += 1
            results["tests"].append("Status transitions: PASS")
        else:
            results["failed"] += 1
            results["tests"].append("Status transitions: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("Status transitions: FAIL (exception)")
    
    # Test 8: Create GRN
    print("\n[TEST 8] POST /purchase-orders/:id/grn")
    try:
        po_id = test_data.get('po_timbang_ulang_id')
        grn_data = {
            "receivedDate": "2025-06-16",
            "notes": "received ok"
        }
        
        resp = session.post(f"{BASE_URL}/purchase-orders/{po_id}/grn",
                           json=grn_data, timeout=30)
        
        if resp.status_code == 201:
            grn = resp.json().get('data', {})
            grn_number = grn.get('grnNumber', '')
            
            import re
            if re.match(r'^GRN/\d{6}/\d{4}$', grn_number):
                print(f"✅ GRN created: {grn_number}")
                
                # Check if PO auto-transitioned to Tanda Terima
                resp2 = session.get(f"{BASE_URL}/purchase-orders/{po_id}", timeout=30)
                if resp2.status_code == 200:
                    po = resp2.json().get('data', {})
                    if po.get('pipelineStatus') == 'Tanda Terima':
                        print(f"✅ PO auto-transitioned to Tanda Terima")
                        results["passed"] += 1
                        results["tests"].append("Create GRN + auto-transition: PASS")
                    else:
                        print(f"❌ PO status is {po.get('pipelineStatus')}, expected Tanda Terima")
                        results["failed"] += 1
                        results["tests"].append("Create GRN: FAIL (no auto-transition)")
                else:
                    results["failed"] += 1
                    results["tests"].append("Create GRN: FAIL (can't verify)")
            else:
                print(f"❌ Invalid GRN number format: {grn_number}")
                results["failed"] += 1
                results["tests"].append("Create GRN: FAIL (format)")
        else:
            print(f"❌ Failed to create GRN: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("Create GRN: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("Create GRN: FAIL (exception)")
    
    # Test 9: Payments (partial then full)
    print("\n[TEST 9] POST /purchase-orders/:id/payments (partial + full)")
    try:
        po_id = test_data.get('po_timbang_ulang_id')
        
        # First payment (partial)
        payment1 = {
            "amount": 1000000,
            "method": "Transfer",
            "reference": "BCA-1",
            "isDp": True
        }
        
        resp = session.post(f"{BASE_URL}/purchase-orders/{po_id}/payments",
                           json=payment1, timeout=30)
        
        if resp.status_code == 201:
            print(f"✅ First payment recorded: 1,000,000")
            
            # Check payment status
            resp2 = session.get(f"{BASE_URL}/purchase-orders/{po_id}", timeout=30)
            if resp2.status_code == 200:
                po = resp2.json().get('data', {})
                if po.get('paymentStatus') == 'partial' and po.get('paidAmount') == 1000000:
                    print(f"✅ Payment status: partial, paidAmount: {po.get('paidAmount')}")
                    
                    # Second payment (complete)
                    payment2 = {
                        "amount": 2800000,
                        "method": "Transfer",
                        "reference": "BCA-2",
                        "isDp": False
                    }
                    
                    resp3 = session.post(f"{BASE_URL}/purchase-orders/{po_id}/payments",
                                        json=payment2, timeout=30)
                    
                    if resp3.status_code == 201:
                        print(f"✅ Second payment recorded: 2,800,000")
                        
                        # Check final status
                        resp4 = session.get(f"{BASE_URL}/purchase-orders/{po_id}", timeout=30)
                        if resp4.status_code == 200:
                            po_final = resp4.json().get('data', {})
                            
                            if (po_final.get('paymentStatus') == 'paid' and 
                                po_final.get('paidAmount') == 3800000 and
                                po_final.get('pipelineStatus') == 'Selesai'):
                                print(f"✅ Payment complete: status=paid, pipelineStatus=Selesai")
                                results["passed"] += 1
                                results["tests"].append("Payments + auto-complete: PASS")
                            else:
                                print(f"❌ Final status incorrect: paymentStatus={po_final.get('paymentStatus')}, pipelineStatus={po_final.get('pipelineStatus')}")
                                results["failed"] += 1
                                results["tests"].append("Payments: FAIL (final status)")
                        else:
                            results["failed"] += 1
                            results["tests"].append("Payments: FAIL (can't verify final)")
                    else:
                        print(f"❌ Second payment failed: {resp3.status_code}")
                        results["failed"] += 1
                        results["tests"].append("Payments: FAIL (second payment)")
                else:
                    print(f"❌ Partial payment status incorrect")
                    results["failed"] += 1
                    results["tests"].append("Payments: FAIL (partial status)")
            else:
                results["failed"] += 1
                results["tests"].append("Payments: FAIL (can't verify)")
        else:
            print(f"❌ First payment failed: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("Payments: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("Payments: FAIL (exception)")
    
    # Test 10: Returns
    print("\n[TEST 10] POST /purchase-orders/:id/returns")
    try:
        po_id = test_data.get('po_timbang_ulang_id')
        return_data = {
            "reason": "5kg rusak",
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
                print(f"✅ Return created with notification to supervisor & direktur")
                results["passed"] += 1
                results["tests"].append("Create return: PASS")
            else:
                print(f"❌ Notification recipients incorrect: {notification.get('to')}")
                results["failed"] += 1
                results["tests"].append("Create return: FAIL (notification)")
        else:
            print(f"❌ Failed to create return: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("Create return: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("Create return: FAIL (exception)")
    
    # Test 11: Create PO with Timbang Kandang method
    print("\n[TEST 11] Create PO with Timbang Kandang method")
    try:
        po_data = {
            "supplierId": test_data['supplier_id'],
            "poType": "Live Bird",
            "method": "Timbang Kandang",
            "orderDate": "2025-06-16",
            "additionalCost": 0,
            "paymentTerm": "Cash",
            "items": [{
                "productId": test_data['product_lb_id'],
                "quantity": 100,
                "weight": 100,
                "unitPrice": 22000
            }]
        }
        
        resp = session.post(f"{BASE_URL}/purchase-orders", json=po_data, timeout=30)
        
        if resp.status_code == 201:
            po = resp.json().get('data', {})
            test_data['po_timbang_kandang_id'] = po['id']
            print(f"✅ PO Timbang Kandang created: {po.get('poNumber')}")
            
            # Update weighings
            resp2 = session.get(f"{BASE_URL}/purchase-orders/{po['id']}", timeout=30)
            if resp2.status_code == 200:
                items = resp2.json().get('data', {}).get('items', [])
                if items:
                    item_id = items[0]['id']
                    
                    weighing_data = {
                        "items": [{
                            "id": item_id,
                            "weightSupplier": 100,
                            "weightRph": 95,
                            "headSupplier": 100,
                            "headRph": 100
                        }]
                    }
                    
                    resp3 = session.post(f"{BASE_URL}/purchase-orders/{po['id']}/weighings",
                                        json=weighing_data, timeout=30)
                    
                    if resp3.status_code == 200:
                        # Get HPP
                        resp4 = session.get(f"{BASE_URL}/purchase-orders/{po['id']}/hpp", timeout=30)
                        
                        if resp4.status_code == 200:
                            hpp_data = resp4.json().get('data', {})
                            hpp_items = hpp_data.get('items', [])
                            
                            if hpp_items:
                                item = hpp_items[0]
                                weight_billed = item.get('weightBilled')
                                weight_actual = item.get('weightActual')
                                susut = item.get('susut')
                                hpp_per_kg = item.get('hppPerKg')
                                
                                print(f"   - Weight Billed: {weight_billed} (should be 100 for Timbang Kandang)")
                                print(f"   - Weight Actual: {weight_actual} (should be 95)")
                                print(f"   - Susut: {susut} kg")
                                print(f"   - HPP per Kg: {hpp_per_kg}")
                                
                                # For Timbang Kandang: weightBilled = weightSupplier (100), weightActual = weightRph (95)
                                # HPP per kg should be higher than unit price due to susut
                                if weight_billed == 100 and weight_actual == 95 and susut == 5:
                                    print(f"✅ Timbang Kandang logic correct")
                                    results["passed"] += 1
                                    results["tests"].append("PO Timbang Kandang HPP: PASS")
                                else:
                                    print(f"❌ Timbang Kandang logic incorrect")
                                    results["failed"] += 1
                                    results["tests"].append("PO Timbang Kandang HPP: FAIL")
                            else:
                                results["failed"] += 1
                                results["tests"].append("PO Timbang Kandang HPP: FAIL (no items)")
                        else:
                            results["failed"] += 1
                            results["tests"].append("PO Timbang Kandang HPP: FAIL (can't get)")
                    else:
                        results["failed"] += 1
                        results["tests"].append("PO Timbang Kandang: FAIL (weighing)")
                else:
                    results["failed"] += 1
                    results["tests"].append("PO Timbang Kandang: FAIL (no items)")
            else:
                results["failed"] += 1
                results["tests"].append("PO Timbang Kandang: FAIL (can't get detail)")
        else:
            print(f"❌ Failed to create PO Timbang Kandang: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("PO Timbang Kandang: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("PO Timbang Kandang: FAIL (exception)")
    
    # Test 12: RBAC on Purchase Orders
    print("\n[TEST 12] RBAC on Purchase Orders")
    try:
        rbac_passed = 0
        rbac_total = 0
        
        # Operator: cannot create PO
        operator_session = sessions.get('operator')
        if operator_session:
            rbac_total += 1
            resp = operator_session.post(f"{BASE_URL}/purchase-orders", 
                                        json={"supplierId": test_data['supplier_id'], "items": []}, 
                                        timeout=30)
            if resp.status_code == 403:
                print(f"✅ Operator cannot create PO (403)")
                rbac_passed += 1
            else:
                print(f"❌ Operator create PO should return 403, got {resp.status_code}")
        
        # Operator: can update weighings
        if operator_session and test_data.get('po_timbang_ulang_id'):
            rbac_total += 1
            resp = operator_session.post(f"{BASE_URL}/purchase-orders/{test_data['po_timbang_ulang_id']}/weighings",
                                        json={"items": []}, timeout=30)
            if resp.status_code in [200, 400]:  # 200 or 400 (bad data) both mean allowed
                print(f"✅ Operator can update weighings")
                rbac_passed += 1
            else:
                print(f"❌ Operator weighings should be allowed, got {resp.status_code}")
        
        # Operator: can create returns
        if operator_session and test_data.get('po_timbang_ulang_id'):
            rbac_total += 1
            resp = operator_session.post(f"{BASE_URL}/purchase-orders/{test_data['po_timbang_ulang_id']}/returns",
                                        json={"reason": "test", "totalAmount": 1000, "totalWeight": 1}, 
                                        timeout=30)
            if resp.status_code in [200, 201]:
                print(f"✅ Operator can create returns")
                rbac_passed += 1
            else:
                print(f"❌ Operator returns should be allowed, got {resp.status_code}")
        
        # Operator: cannot create payments
        if operator_session and test_data.get('po_timbang_ulang_id'):
            rbac_total += 1
            resp = operator_session.post(f"{BASE_URL}/purchase-orders/{test_data['po_timbang_ulang_id']}/payments",
                                        json={"amount": 1000, "method": "Transfer"}, 
                                        timeout=30)
            if resp.status_code == 403:
                print(f"✅ Operator cannot create payments (403)")
                rbac_passed += 1
            else:
                print(f"❌ Operator payments should return 403, got {resp.status_code}")
        
        # Direktur: can view
        direktur_session = sessions.get('direktur')
        if direktur_session:
            rbac_total += 1
            resp = direktur_session.get(f"{BASE_URL}/purchase-orders", timeout=30)
            if resp.status_code == 200:
                print(f"✅ Direktur can view POs")
                rbac_passed += 1
            else:
                print(f"❌ Direktur view should return 200, got {resp.status_code}")
        
        # Direktur: cannot create
        if direktur_session:
            rbac_total += 1
            resp = direktur_session.post(f"{BASE_URL}/purchase-orders",
                                        json={"supplierId": test_data['supplier_id'], "items": []},
                                        timeout=30)
            if resp.status_code == 403:
                print(f"✅ Direktur cannot create PO (403)")
                rbac_passed += 1
            else:
                print(f"❌ Direktur create should return 403, got {resp.status_code}")
        
        if rbac_passed == rbac_total:
            results["passed"] += 1
            results["tests"].append("PO RBAC: PASS")
        else:
            print(f"❌ RBAC: {rbac_passed}/{rbac_total} passed")
            results["failed"] += 1
            results["tests"].append("PO RBAC: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("PO RBAC: FAIL (exception)")
    
    # Test 13: DELETE PO (only Draft, only admin)
    print("\n[TEST 13] DELETE /purchase-orders/:id")
    try:
        # Create a draft PO to delete
        po_data = {
            "supplierId": test_data['supplier_id'],
            "poType": "Live Bird",
            "method": "Timbang Ulang",
            "orderDate": "2025-06-17",
            "items": [{
                "productId": test_data['product_lb_id'],
                "quantity": 10,
                "weight": 10,
                "unitPrice": 22000
            }]
        }
        
        resp = session.post(f"{BASE_URL}/purchase-orders", json=po_data, timeout=30)
        
        if resp.status_code == 201:
            draft_po_id = resp.json().get('data', {}).get('id')
            
            # Try to delete non-draft PO (should fail)
            resp2 = session.delete(f"{BASE_URL}/purchase-orders/{test_data['po_timbang_ulang_id']}", 
                                  timeout=30)
            
            if resp2.status_code == 400:
                print(f"✅ Cannot delete non-Draft PO (400)")
                
                # Delete draft PO (should succeed)
                resp3 = session.delete(f"{BASE_URL}/purchase-orders/{draft_po_id}", timeout=30)
                
                if resp3.status_code == 200:
                    print(f"✅ Draft PO deleted successfully")
                    
                    # Try as supervisor (should fail)
                    supervisor_session = sessions.get('supervisor')
                    if supervisor_session:
                        # Create another draft
                        resp4 = session.post(f"{BASE_URL}/purchase-orders", json=po_data, timeout=30)
                        if resp4.status_code == 201:
                            draft_po_id2 = resp4.json().get('data', {}).get('id')
                            
                            resp5 = supervisor_session.delete(f"{BASE_URL}/purchase-orders/{draft_po_id2}",
                                                             timeout=30)
                            
                            if resp5.status_code == 403:
                                print(f"✅ Supervisor cannot delete PO (403)")
                                results["passed"] += 1
                                results["tests"].append("DELETE PO: PASS")
                            else:
                                print(f"❌ Supervisor delete should return 403, got {resp5.status_code}")
                                results["failed"] += 1
                                results["tests"].append("DELETE PO: FAIL (supervisor)")
                        else:
                            results["failed"] += 1
                            results["tests"].append("DELETE PO: FAIL (can't create test PO)")
                    else:
                        results["failed"] += 1
                        results["tests"].append("DELETE PO: FAIL (no supervisor session)")
                else:
                    print(f"❌ Failed to delete draft PO: {resp3.status_code}")
                    results["failed"] += 1
                    results["tests"].append("DELETE PO: FAIL (delete)")
            else:
                print(f"❌ Delete non-draft should return 400, got {resp2.status_code}")
                results["failed"] += 1
                results["tests"].append("DELETE PO: FAIL (non-draft)")
        else:
            print(f"❌ Failed to create test PO: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("DELETE PO: FAIL (create)")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("DELETE PO: FAIL (exception)")
    
    print(f"\n{'='*60}")
    print(f"PURCHASE ORDERS TEST SUMMARY")
    print(f"{'='*60}")
    print(f"✅ Passed: {results['passed']}")
    print(f"❌ Failed: {results['failed']}")
    print(f"Total: {results['passed'] + results['failed']}")
    
    return results

def test_sales_orders():
    """Test Sales Orders module comprehensively"""
    print(f"\n{'='*60}")
    print("💰 TESTING SALES ORDERS MODULE")
    print(f"{'='*60}")
    
    session = sessions.get('admin')
    if not session:
        print("❌ No admin session")
        return False
    
    results = {"passed": 0, "failed": 0, "tests": []}
    
    # Test 1: Create SO
    print("\n[TEST 1] Create Sales Order")
    try:
        so_data = {
            "customerId": test_data['customer_regular_id'],
            "orderDate": "2025-06-15",
            "paymentTerm": "TOP 14",
            "items": [{
                "productId": test_data['product_krk_id'],
                "quantity": 50,
                "weight": 50,
                "unitPrice": 40000,
                "discount": 50000
            }]
        }
        
        resp = session.post(f"{BASE_URL}/sales-orders", json=so_data, timeout=30)
        
        if resp.status_code == 201:
            so = resp.json().get('data', {})
            so_number = so.get('soNumber', '')
            
            import re
            if re.match(r'^SO/\d{6}/\d{4}$', so_number):
                print(f"✅ SO created: {so_number}")
                print(f"   - Pipeline Status: {so.get('pipelineStatus')}")
                print(f"   - Total Amount: {so.get('totalAmount')}")
                
                test_data['so_regular_id'] = so['id']
                test_data['so_regular_number'] = so_number
                
                # Verify total: 50 * 40000 - 50000 = 1950000
                expected_total = 1950000
                actual_total = so.get('totalAmount', 0)
                
                if abs(actual_total - expected_total) < 1:
                    print(f"✅ Total amount correct: {actual_total}")
                    results["passed"] += 1
                    results["tests"].append("Create SO: PASS")
                else:
                    print(f"❌ Total amount mismatch: expected {expected_total}, got {actual_total}")
                    results["failed"] += 1
                    results["tests"].append("Create SO: FAIL (amount)")
            else:
                print(f"❌ Invalid SO number format: {so_number}")
                results["failed"] += 1
                results["tests"].append("Create SO: FAIL (format)")
        else:
            print(f"❌ Failed to create SO: {resp.status_code} - {resp.text[:200]}")
            results["failed"] += 1
            results["tests"].append("Create SO: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("Create SO: FAIL (exception)")
    
    # Test 2: GET SO list
    print("\n[TEST 2] GET /sales-orders?status=Draft")
    try:
        resp = session.get(f"{BASE_URL}/sales-orders?status=Draft", timeout=30)
        
        if resp.status_code == 200:
            sos = resp.json().get('data', [])
            found = any(s.get('id') == test_data.get('so_regular_id') for s in sos)
            
            if found:
                print(f"✅ SO found in Draft list (total: {len(sos)} SOs)")
                results["passed"] += 1
                results["tests"].append("GET SO list Draft: PASS")
            else:
                print(f"❌ Created SO not found in Draft list")
                results["failed"] += 1
                results["tests"].append("GET SO list Draft: FAIL")
        else:
            print(f"❌ Failed to get SO list: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("GET SO list Draft: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("GET SO list Draft: FAIL (exception)")
    
    # Test 3: GET SO detail
    print("\n[TEST 3] GET /sales-orders/:id (detail)")
    try:
        so_id = test_data.get('so_regular_id')
        resp = session.get(f"{BASE_URL}/sales-orders/{so_id}", timeout=30)
        
        if resp.status_code == 200:
            so_detail = resp.json().get('data', {})
            
            has_items = 'items' in so_detail and len(so_detail['items']) > 0
            has_customer = 'customer' in so_detail
            has_sj = 'suratJalan' in so_detail
            has_payments = 'payments' in so_detail
            has_returns = 'returns' in so_detail
            has_outstanding = 'outstanding' in so_detail
            
            if all([has_items, has_customer, has_sj, has_payments, has_returns, has_outstanding]):
                print(f"✅ SO detail structure correct")
                print(f"   - Items: {len(so_detail['items'])}")
                print(f"   - Customer: {so_detail['customer'].get('name')}")
                print(f"   - Outstanding: {so_detail['outstanding']}")
                
                results["passed"] += 1
                results["tests"].append("GET SO detail: PASS")
            else:
                print(f"❌ SO detail structure incomplete")
                results["failed"] += 1
                results["tests"].append("GET SO detail: FAIL (structure)")
        else:
            print(f"❌ Failed to get SO detail: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("GET SO detail: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("GET SO detail: FAIL (exception)")
    
    # Test 4: Status transitions + invalid transitions
    print("\n[TEST 4] Status pipeline transitions")
    try:
        so_id = test_data.get('so_regular_id')
        
        # Valid: Draft -> Confirmed
        resp = session.post(f"{BASE_URL}/sales-orders/{so_id}/status",
                           json={"status": "Confirmed"}, timeout=30)
        
        if resp.status_code == 200:
            print(f"✅ Transition Draft -> Confirmed: SUCCESS")
            
            # Invalid: try to go back to Draft
            resp2 = session.post(f"{BASE_URL}/sales-orders/{so_id}/status",
                                json={"status": "Draft"}, timeout=30)
            
            if resp2.status_code == 400:
                print(f"✅ Invalid transition Confirmed -> Draft correctly rejected")
                
                # Invalid: skip Packed, go directly to Shipped
                resp3 = session.post(f"{BASE_URL}/sales-orders/{so_id}/status",
                                    json={"status": "Shipped"}, timeout=30)
                
                if resp3.status_code == 400:
                    print(f"✅ Invalid transition Confirmed -> Shipped correctly rejected")
                    
                    # Valid: Confirmed -> Packed
                    resp4 = session.post(f"{BASE_URL}/sales-orders/{so_id}/status",
                                        json={"status": "Packed"}, timeout=30)
                    
                    if resp4.status_code == 200:
                        print(f"✅ Transition Confirmed -> Packed: SUCCESS")
                        results["passed"] += 1
                        results["tests"].append("SO status transitions: PASS")
                    else:
                        print(f"❌ Transition to Packed failed: {resp4.status_code}")
                        results["failed"] += 1
                        results["tests"].append("SO status transitions: FAIL (Packed)")
                else:
                    print(f"❌ Invalid transition should return 400, got {resp3.status_code}")
                    results["failed"] += 1
                    results["tests"].append("SO status transitions: FAIL (skip validation)")
            else:
                print(f"❌ Invalid transition should return 400, got {resp2.status_code}")
                results["failed"] += 1
                results["tests"].append("SO status transitions: FAIL (back validation)")
        else:
            print(f"❌ Transition to Confirmed failed: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("SO status transitions: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("SO status transitions: FAIL (exception)")
    
    # Test 5: Subscriber prepaid deduction
    print("\n[TEST 5] Subscriber prepaid deduction")
    try:
        # Create SO for subscriber
        so_data = {
            "customerId": test_data['customer_subscriber_id'],
            "orderDate": "2025-06-15",
            "paymentTerm": "TOP 14",
            "items": [{
                "productId": test_data['product_krk_id'],
                "quantity": 25,
                "weight": 25,
                "unitPrice": 40000,
                "discount": 0
            }]
        }
        
        resp = session.post(f"{BASE_URL}/sales-orders", json=so_data, timeout=30)
        
        if resp.status_code == 201:
            so = resp.json().get('data', {})
            so_subscriber_id = so['id']
            so_total = so.get('totalAmount', 0)  # Should be 25 * 40000 = 1000000
            
            print(f"✅ SO for subscriber created: {so.get('soNumber')}, total: {so_total}")
            
            # Get initial balance
            resp2 = session.get(f"{BASE_URL}/contacts/{test_data['customer_subscriber_id']}", timeout=30)
            
            if resp2.status_code == 200:
                initial_balance = resp2.json().get('data', {}).get('prepaidBalance', 0)
                print(f"   - Initial prepaid balance: {initial_balance}")
                
                # Confirm SO (should deduct balance)
                resp3 = session.post(f"{BASE_URL}/sales-orders/{so_subscriber_id}/status",
                                    json={"status": "Confirmed"}, timeout=30)
                
                if resp3.status_code == 200:
                    print(f"✅ SO confirmed")
                    
                    # Check balance after confirmation
                    resp4 = session.get(f"{BASE_URL}/contacts/{test_data['customer_subscriber_id']}", 
                                       timeout=30)
                    
                    if resp4.status_code == 200:
                        final_balance = resp4.json().get('data', {}).get('prepaidBalance', 0)
                        expected_balance = initial_balance - so_total
                        
                        print(f"   - Final prepaid balance: {final_balance}")
                        print(f"   - Expected balance: {expected_balance}")
                        
                        if abs(final_balance - expected_balance) < 1:
                            print(f"✅ Prepaid balance correctly deducted")
                            results["passed"] += 1
                            results["tests"].append("Subscriber prepaid deduction: PASS")
                        else:
                            print(f"❌ Balance mismatch: expected {expected_balance}, got {final_balance}")
                            results["failed"] += 1
                            results["tests"].append("Subscriber prepaid deduction: FAIL (amount)")
                    else:
                        results["failed"] += 1
                        results["tests"].append("Subscriber prepaid deduction: FAIL (can't verify)")
                else:
                    print(f"❌ Failed to confirm SO: {resp3.status_code}")
                    results["failed"] += 1
                    results["tests"].append("Subscriber prepaid deduction: FAIL (confirm)")
            else:
                results["failed"] += 1
                results["tests"].append("Subscriber prepaid deduction: FAIL (get balance)")
        else:
            print(f"❌ Failed to create SO for subscriber: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("Subscriber prepaid deduction: FAIL (create)")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("Subscriber prepaid deduction: FAIL (exception)")
    
    # Test 6: Surat Jalan + auto-transition
    print("\n[TEST 6] POST /sales-orders/:id/surat-jalan")
    try:
        so_id = test_data.get('so_regular_id')
        
        # SO should be in Packed status from earlier test
        sj_data = {
            "deliveryDate": "2025-06-16",
            "driverName": "Budi",
            "vehicleNumber": "B 123 XYZ"
        }
        
        resp = session.post(f"{BASE_URL}/sales-orders/{so_id}/surat-jalan",
                           json=sj_data, timeout=30)
        
        if resp.status_code == 201:
            sj = resp.json().get('data', {})
            sj_number = sj.get('sjNumber', '')
            
            import re
            if re.match(r'^SJ/\d{6}/\d{4}$', sj_number):
                print(f"✅ Surat Jalan created: {sj_number}")
                
                # Check if SO auto-transitioned to Shipped
                resp2 = session.get(f"{BASE_URL}/sales-orders/{so_id}", timeout=30)
                
                if resp2.status_code == 200:
                    so = resp2.json().get('data', {})
                    
                    if so.get('pipelineStatus') == 'Shipped':
                        print(f"✅ SO auto-transitioned to Shipped")
                        results["passed"] += 1
                        results["tests"].append("Surat Jalan + auto-transition: PASS")
                    else:
                        print(f"❌ SO status is {so.get('pipelineStatus')}, expected Shipped")
                        results["failed"] += 1
                        results["tests"].append("Surat Jalan: FAIL (no auto-transition)")
                else:
                    results["failed"] += 1
                    results["tests"].append("Surat Jalan: FAIL (can't verify)")
            else:
                print(f"❌ Invalid SJ number format: {sj_number}")
                results["failed"] += 1
                results["tests"].append("Surat Jalan: FAIL (format)")
        else:
            print(f"❌ Failed to create Surat Jalan: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("Surat Jalan: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("Surat Jalan: FAIL (exception)")
    
    # Test 7: Transition to Invoiced + auto-generate invoice
    print("\n[TEST 7] Transition to Invoiced + auto-generate invoice number")
    try:
        so_id = test_data.get('so_regular_id')
        
        # Transition Shipped -> Invoiced
        resp = session.post(f"{BASE_URL}/sales-orders/{so_id}/status",
                           json={"status": "Invoiced"}, timeout=30)
        
        if resp.status_code == 200:
            so = resp.json().get('data', {})
            invoice_number = so.get('invoiceNumber', '')
            invoice_date = so.get('invoiceDate')
            due_date = so.get('dueDate')
            
            import re
            if re.match(r'^INV/\d{6}/\d{4}$', invoice_number):
                print(f"✅ Invoice number auto-generated: {invoice_number}")
                
                if invoice_date:
                    print(f"✅ Invoice date set: {invoice_date}")
                    
                    if due_date:
                        print(f"✅ Due date set: {due_date} (TOP 14)")
                        results["passed"] += 1
                        results["tests"].append("Invoiced + auto-generate: PASS")
                    else:
                        print(f"❌ Due date not set")
                        results["failed"] += 1
                        results["tests"].append("Invoiced: FAIL (no due date)")
                else:
                    print(f"❌ Invoice date not set")
                    results["failed"] += 1
                    results["tests"].append("Invoiced: FAIL (no invoice date)")
            else:
                print(f"❌ Invalid invoice number format: {invoice_number}")
                results["failed"] += 1
                results["tests"].append("Invoiced: FAIL (format)")
        else:
            print(f"❌ Failed to transition to Invoiced: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("Invoiced: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("Invoiced: FAIL (exception)")
    
    # Test 8: Payments
    print("\n[TEST 8] POST /sales-orders/:id/payments")
    try:
        so_id = test_data.get('so_regular_id')
        
        # First payment (partial)
        payment1 = {
            "amount": 975000,
            "method": "QRIS",
            "reference": "QR-001"
        }
        
        resp = session.post(f"{BASE_URL}/sales-orders/{so_id}/payments",
                           json=payment1, timeout=30)
        
        if resp.status_code == 201:
            print(f"✅ First payment recorded: 975,000")
            
            # Check payment status
            resp2 = session.get(f"{BASE_URL}/sales-orders/{so_id}", timeout=30)
            
            if resp2.status_code == 200:
                so = resp2.json().get('data', {})
                
                if so.get('paymentStatus') == 'partial':
                    print(f"✅ Payment status: partial")
                    
                    # Second payment (complete)
                    payment2 = {
                        "amount": 975000,
                        "method": "Transfer",
                        "reference": "BCA-3"
                    }
                    
                    resp3 = session.post(f"{BASE_URL}/sales-orders/{so_id}/payments",
                                        json=payment2, timeout=30)
                    
                    if resp3.status_code == 201:
                        print(f"✅ Second payment recorded: 975,000")
                        
                        # Check final status
                        resp4 = session.get(f"{BASE_URL}/sales-orders/{so_id}", timeout=30)
                        
                        if resp4.status_code == 200:
                            so_final = resp4.json().get('data', {})
                            
                            if so_final.get('paymentStatus') == 'paid':
                                print(f"✅ Payment status: paid")
                                results["passed"] += 1
                                results["tests"].append("SO payments: PASS")
                            else:
                                print(f"❌ Payment status should be paid, got {so_final.get('paymentStatus')}")
                                results["failed"] += 1
                                results["tests"].append("SO payments: FAIL (final status)")
                        else:
                            results["failed"] += 1
                            results["tests"].append("SO payments: FAIL (can't verify final)")
                    else:
                        print(f"❌ Second payment failed: {resp3.status_code}")
                        results["failed"] += 1
                        results["tests"].append("SO payments: FAIL (second payment)")
                else:
                    print(f"❌ Payment status should be partial, got {so.get('paymentStatus')}")
                    results["failed"] += 1
                    results["tests"].append("SO payments: FAIL (partial status)")
            else:
                results["failed"] += 1
                results["tests"].append("SO payments: FAIL (can't verify)")
        else:
            print(f"❌ First payment failed: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("SO payments: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("SO payments: FAIL (exception)")
    
    # Test 9: Returns
    print("\n[TEST 9] POST /sales-orders/:id/returns")
    try:
        so_id = test_data.get('so_regular_id')
        
        return_data = {
            "reason": "Karkas rusak",
            "resolution": "kirim_pengganti",
            "totalAmount": 100000,
            "totalWeight": 2
        }
        
        resp = session.post(f"{BASE_URL}/sales-orders/{so_id}/returns",
                           json=return_data, timeout=30)
        
        if resp.status_code == 201:
            ret = resp.json().get('data', {})
            notification = ret.get('notification', {})
            
            if notification.get('to') == ['supervisor', 'direktur']:
                print(f"✅ Return created with notification to supervisor & direktur")
                results["passed"] += 1
                results["tests"].append("SO return: PASS")
            else:
                print(f"❌ Notification recipients incorrect: {notification.get('to')}")
                results["failed"] += 1
                results["tests"].append("SO return: FAIL (notification)")
        else:
            print(f"❌ Failed to create return: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("SO return: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("SO return: FAIL (exception)")
    
    # Test 10: RBAC on Sales Orders
    print("\n[TEST 10] RBAC on Sales Orders")
    try:
        rbac_passed = 0
        rbac_total = 0
        
        # Operator: cannot create SO
        operator_session = sessions.get('operator')
        if operator_session:
            rbac_total += 1
            resp = operator_session.post(f"{BASE_URL}/sales-orders",
                                        json={"customerId": test_data['customer_regular_id'], "items": []},
                                        timeout=30)
            if resp.status_code == 403:
                print(f"✅ Operator cannot create SO (403)")
                rbac_passed += 1
            else:
                print(f"❌ Operator create SO should return 403, got {resp.status_code}")
        
        # Operator: can create returns
        if operator_session and test_data.get('so_regular_id'):
            rbac_total += 1
            resp = operator_session.post(f"{BASE_URL}/sales-orders/{test_data['so_regular_id']}/returns",
                                        json={"reason": "test", "totalAmount": 1000, "totalWeight": 1},
                                        timeout=30)
            if resp.status_code in [200, 201]:
                print(f"✅ Operator can create returns")
                rbac_passed += 1
            else:
                print(f"❌ Operator returns should be allowed, got {resp.status_code}")
        
        # Operator: cannot create payments
        if operator_session and test_data.get('so_regular_id'):
            rbac_total += 1
            resp = operator_session.post(f"{BASE_URL}/sales-orders/{test_data['so_regular_id']}/payments",
                                        json={"amount": 1000, "method": "Transfer"},
                                        timeout=30)
            if resp.status_code == 403:
                print(f"✅ Operator cannot create payments (403)")
                rbac_passed += 1
            else:
                print(f"❌ Operator payments should return 403, got {resp.status_code}")
        
        # Direktur: can view
        direktur_session = sessions.get('direktur')
        if direktur_session:
            rbac_total += 1
            resp = direktur_session.get(f"{BASE_URL}/sales-orders", timeout=30)
            if resp.status_code == 200:
                print(f"✅ Direktur can view SOs")
                rbac_passed += 1
            else:
                print(f"❌ Direktur view should return 200, got {resp.status_code}")
        
        # Direktur: cannot create
        if direktur_session:
            rbac_total += 1
            resp = direktur_session.post(f"{BASE_URL}/sales-orders",
                                        json={"customerId": test_data['customer_regular_id'], "items": []},
                                        timeout=30)
            if resp.status_code == 403:
                print(f"✅ Direktur cannot create SO (403)")
                rbac_passed += 1
            else:
                print(f"❌ Direktur create should return 403, got {resp.status_code}")
        
        if rbac_passed == rbac_total:
            results["passed"] += 1
            results["tests"].append("SO RBAC: PASS")
        else:
            print(f"❌ RBAC: {rbac_passed}/{rbac_total} passed")
            results["failed"] += 1
            results["tests"].append("SO RBAC: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("SO RBAC: FAIL (exception)")
    
    print(f"\n{'='*60}")
    print(f"SALES ORDERS TEST SUMMARY")
    print(f"{'='*60}")
    print(f"✅ Passed: {results['passed']}")
    print(f"❌ Failed: {results['failed']}")
    print(f"Total: {results['passed'] + results['failed']}")
    
    return results

def test_sales_reports():
    """Test Sales Reports endpoints"""
    print(f"\n{'='*60}")
    print("📊 TESTING SALES REPORTS")
    print(f"{'='*60}")
    
    session = sessions.get('admin')
    if not session:
        print("❌ No admin session")
        return False
    
    results = {"passed": 0, "failed": 0, "tests": []}
    
    # Test 1: Daily report
    print("\n[TEST 1] GET /sales-reports/daily")
    try:
        resp = session.get(f"{BASE_URL}/sales-reports/daily?from=2025-06-01&to=2025-06-30", 
                          timeout=30)
        
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            
            if 'rows' in data and 'totalRevenue' in data and 'totalOrders' in data:
                print(f"✅ Daily report structure correct")
                print(f"   - Total Orders: {data['totalOrders']}")
                print(f"   - Total Revenue: {data['totalRevenue']}")
                print(f"   - Daily rows: {len(data['rows'])}")
                
                results["passed"] += 1
                results["tests"].append("Daily report: PASS")
            else:
                print(f"❌ Daily report structure incomplete")
                results["failed"] += 1
                results["tests"].append("Daily report: FAIL (structure)")
        else:
            print(f"❌ Failed to get daily report: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("Daily report: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("Daily report: FAIL (exception)")
    
    # Test 2: AR Aging report
    print("\n[TEST 2] GET /sales-reports/ar-aging")
    try:
        resp = session.get(f"{BASE_URL}/sales-reports/ar-aging", timeout=30)
        
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            
            if 'buckets' in data and 'details' in data and 'totalOutstanding' in data:
                buckets = data['buckets']
                
                if all(k in buckets for k in ['0-30', '31-60', '61-90', '90+']):
                    print(f"✅ AR Aging report structure correct")
                    print(f"   - 0-30 days: {buckets['0-30']}")
                    print(f"   - 31-60 days: {buckets['31-60']}")
                    print(f"   - 61-90 days: {buckets['61-90']}")
                    print(f"   - 90+ days: {buckets['90+']}")
                    print(f"   - Total Outstanding: {data['totalOutstanding']}")
                    print(f"   - Details count: {len(data['details'])}")
                    
                    results["passed"] += 1
                    results["tests"].append("AR Aging report: PASS")
                else:
                    print(f"❌ AR Aging buckets incomplete")
                    results["failed"] += 1
                    results["tests"].append("AR Aging report: FAIL (buckets)")
            else:
                print(f"❌ AR Aging report structure incomplete")
                results["failed"] += 1
                results["tests"].append("AR Aging report: FAIL (structure)")
        else:
            print(f"❌ Failed to get AR Aging report: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("AR Aging report: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("AR Aging report: FAIL (exception)")
    
    # Test 3: By Customer report
    print("\n[TEST 3] GET /sales-reports/by-customer")
    try:
        resp = session.get(f"{BASE_URL}/sales-reports/by-customer", timeout=30)
        
        if resp.status_code == 200:
            data = resp.json().get('data', [])
            
            if isinstance(data, list):
                print(f"✅ By Customer report retrieved")
                print(f"   - Customer count: {len(data)}")
                
                if data:
                    first = data[0]
                    if all(k in first for k in ['customer', 'count', 'total', 'paid', 'outstanding']):
                        print(f"   - Sample: {first['customer'].get('name')} - Total: {first['total']}")
                        results["passed"] += 1
                        results["tests"].append("By Customer report: PASS")
                    else:
                        print(f"❌ By Customer row structure incomplete")
                        results["failed"] += 1
                        results["tests"].append("By Customer report: FAIL (row structure)")
                else:
                    print(f"✅ By Customer report empty (no data yet)")
                    results["passed"] += 1
                    results["tests"].append("By Customer report: PASS (empty)")
            else:
                print(f"❌ By Customer report should be array")
                results["failed"] += 1
                results["tests"].append("By Customer report: FAIL (not array)")
        else:
            print(f"❌ Failed to get By Customer report: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("By Customer report: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("By Customer report: FAIL (exception)")
    
    # Test 4: By Product report
    print("\n[TEST 4] GET /sales-reports/by-product")
    try:
        resp = session.get(f"{BASE_URL}/sales-reports/by-product", timeout=30)
        
        if resp.status_code == 200:
            data = resp.json().get('data', [])
            
            if isinstance(data, list):
                print(f"✅ By Product report retrieved")
                print(f"   - Product count: {len(data)}")
                
                if data:
                    first = data[0]
                    if all(k in first for k in ['product', 'totalQty', 'totalWeight', 'orderCount', 'totalRevenue']):
                        print(f"   - Sample: {first['product'].get('name')} - Revenue: {first['totalRevenue']}")
                        results["passed"] += 1
                        results["tests"].append("By Product report: PASS")
                    else:
                        print(f"❌ By Product row structure incomplete")
                        results["failed"] += 1
                        results["tests"].append("By Product report: FAIL (row structure)")
                else:
                    print(f"✅ By Product report empty (no data yet)")
                    results["passed"] += 1
                    results["tests"].append("By Product report: PASS (empty)")
            else:
                print(f"❌ By Product report should be array")
                results["failed"] += 1
                results["tests"].append("By Product report: FAIL (not array)")
        else:
            print(f"❌ Failed to get By Product report: {resp.status_code}")
            results["failed"] += 1
            results["tests"].append("By Product report: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results["failed"] += 1
        results["tests"].append("By Product report: FAIL (exception)")
    
    print(f"\n{'='*60}")
    print(f"SALES REPORTS TEST SUMMARY")
    print(f"{'='*60}")
    print(f"✅ Passed: {results['passed']}")
    print(f"❌ Failed: {results['failed']}")
    print(f"Total: {results['passed'] + results['failed']}")
    
    return results

def main():
    """Main test execution"""
    print(f"\n{'='*60}")
    print("🚀 LPI ERP BACKEND TESTING - PURCHASE & SALES MODULES")
    print(f"{'='*60}")
    print(f"Base URL: {BASE_URL}")
    print(f"Start Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Step 1: Run seed
    if not run_seed():
        print("\n❌ Seed failed, cannot continue")
        return
    
    # Step 2: Login all users
    print(f"\n{'='*60}")
    print("🔐 LOGGING IN ALL USERS")
    print(f"{'='*60}")
    
    for role in ['admin', 'supervisor', 'direktur', 'operator']:
        login(role)
    
    if 'admin' not in sessions:
        print("\n❌ Admin login failed, cannot continue")
        return
    
    # Step 3: Get master data
    if not get_master_data():
        print("\n❌ Failed to get master data, cannot continue")
        return
    
    # Step 4: Test Purchase Orders
    po_results = test_purchase_orders()
    
    # Step 5: Test Sales Orders
    so_results = test_sales_orders()
    
    # Step 6: Test Sales Reports
    reports_results = test_sales_reports()
    
    # Final summary
    print(f"\n{'='*60}")
    print("📊 FINAL TEST SUMMARY")
    print(f"{'='*60}")
    
    total_passed = po_results['passed'] + so_results['passed'] + reports_results['passed']
    total_failed = po_results['failed'] + so_results['failed'] + reports_results['failed']
    total_tests = total_passed + total_failed
    
    print(f"\nPurchase Orders: {po_results['passed']}/{po_results['passed'] + po_results['failed']} passed")
    print(f"Sales Orders: {so_results['passed']}/{so_results['passed'] + so_results['failed']} passed")
    print(f"Sales Reports: {reports_results['passed']}/{reports_results['passed'] + reports_results['failed']} passed")
    
    print(f"\n{'='*60}")
    print(f"OVERALL: {total_passed}/{total_tests} tests passed")
    print(f"{'='*60}")
    
    if total_failed == 0:
        print("\n✅ ALL TESTS PASSED!")
    else:
        print(f"\n❌ {total_failed} TESTS FAILED")
        print("\nFailed tests:")
        for test in po_results['tests'] + so_results['tests'] + reports_results['tests']:
            if 'FAIL' in test:
                print(f"  - {test}")
    
    print(f"\nEnd Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == "__main__":
    main()
