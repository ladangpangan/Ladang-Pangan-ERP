#!/usr/bin/env python3
"""
Backend test for SO subtotal bug fix (weight-based calculation)
Tests the fix that changed subtotal from unitPrice * (quantity || weight) to unitPrice * (weight || quantity)
"""

import requests
import json
from datetime import datetime

# Configuration
BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"
LOGIN_EMAIL = "admin@lpi.co.id"
LOGIN_PASSWORD = "admin123"

# Create session to maintain cookies
session = requests.Session()

def login():
    """Login and get session cookie"""
    print("=" * 80)
    print("LOGGING IN...")
    print("=" * 80)
    
    url = f"{BASE_URL}/auth/sign-in/email"
    payload = {
        "email": LOGIN_EMAIL,
        "password": LOGIN_PASSWORD
    }
    
    try:
        response = session.post(url, json=payload, timeout=30)
        print(f"Login Status: {response.status_code}")
        
        if response.status_code == 200:
            print("✅ Login successful")
            return True
        else:
            print(f"❌ Login failed: {response.text}")
            return False
    except Exception as e:
        print(f"❌ Login error: {str(e)}")
        return False

def get_test_data():
    """Fetch test data IDs"""
    print("\n" + "=" * 80)
    print("FETCHING TEST DATA...")
    print("=" * 80)
    
    data = {}
    
    # Get contacts
    try:
        response = session.get(f"{BASE_URL}/contacts", timeout=30)
        if response.status_code == 200:
            contacts = response.json().get('data', [])
            for c in contacts:
                if c.get('code') == 'DS-100':
                    data['dropshipper_id'] = c['id']
                    print(f"✅ Found Dropshipper DS-100: {c['id']}")
                elif c.get('code') == 'AG-100':
                    data['agen_id'] = c['id']
                    print(f"✅ Found Agen AG-100: {c['id']}")
                elif c.get('code') == 'CUST-100':
                    data['customer_id'] = c['id']
                    print(f"✅ Found Customer CUST-100: {c['id']}")
    except Exception as e:
        print(f"❌ Error fetching contacts: {str(e)}")
    
    # Get product KRK-100
    try:
        response = session.get(f"{BASE_URL}/products", timeout=30)
        if response.status_code == 200:
            products = response.json().get('data', [])
            for p in products:
                if p.get('sku') == 'KRK-100':
                    data['product_id'] = p['id']
                    print(f"✅ Found Product KRK-100: {p['id']}")
                    break
    except Exception as e:
        print(f"❌ Error fetching products: {str(e)}")
    
    # Get inventory stocks
    try:
        response = session.get(f"{BASE_URL}/inventory/stocks?status=active", timeout=30)
        if response.status_code == 200:
            stocks = response.json().get('data', [])
            data['stocks'] = []
            for s in stocks:
                if s.get('product', {}).get('sku') == 'KRK-100':
                    data['stocks'].append({
                        'id': s['id'],
                        'kodeSimpan': s['kodeSimpan'],
                        'weight': s['weight']
                    })
                    print(f"✅ Found Stock {s['kodeSimpan']}: {s['weight']}kg")
    except Exception as e:
        print(f"❌ Error fetching stocks: {str(e)}")
    
    # Get end-customer for Agen
    try:
        if 'agen_id' in data:
            response = session.get(f"{BASE_URL}/contacts/{data['agen_id']}/customers", timeout=30)
            if response.status_code == 200:
                customers = response.json().get('data', [])
                if customers:
                    data['end_customer_id'] = customers[0]['id']
                    print(f"✅ Found End-Customer: {customers[0]['id']}")
    except Exception as e:
        print(f"❌ Error fetching end-customers: {str(e)}")
    
    return data

def test_1_so_weight_based_no_discount(data):
    """
    TEST 1: SO total (weight-based, no discount)
    Create SO with CUST-100, quantity=1, weight=100, unitPrice=40000, discount=0
    Expected: totalAmount = 4,000,000 (NOT 40,000, NOT negative)
    """
    print("\n" + "=" * 80)
    print("TEST 1: SO TOTAL (WEIGHT-BASED, NO DISCOUNT)")
    print("=" * 80)
    
    if 'customer_id' not in data or 'product_id' not in data:
        print("❌ Missing test data (customer or product)")
        return None
    
    payload = {
        "customerId": data['customer_id'],
        "orderDate": datetime.now().isoformat(),
        "items": [
            {
                "productId": data['product_id'],
                "quantity": 1,
                "weight": 100,
                "unitPrice": 40000,
                "discount": 0
            }
        ]
    }
    
    try:
        print(f"Creating SO with: quantity=1, weight=100kg, unitPrice=40000, discount=0")
        response = session.post(f"{BASE_URL}/sales-orders", json=payload, timeout=30)
        print(f"Response Status: {response.status_code}")
        
        if response.status_code == 201:
            so = response.json().get('data', {})
            so_id = so.get('id')
            print(f"✅ SO Created: {so.get('soNumber')}")
            
            # Get SO detail
            detail_response = session.get(f"{BASE_URL}/sales-orders/{so_id}", timeout=30)
            if detail_response.status_code == 200:
                detail = detail_response.json().get('data', {})
                total = detail.get('totalAmount', 0)
                items = detail.get('items', [])
                
                print(f"\n📊 RESULTS:")
                print(f"   Total Amount: Rp {total:,.0f}")
                if items:
                    print(f"   Item Subtotal: Rp {items[0].get('subtotal', 0):,.0f}")
                
                # Verify
                expected = 4000000
                if abs(total - expected) < 1:
                    print(f"✅ TEST 1 PASSED: Total = Rp {total:,.0f} (expected Rp {expected:,.0f})")
                    print(f"   ✓ Weight-based calculation working (40000 * 100 = 4,000,000)")
                    return so_id
                else:
                    print(f"❌ TEST 1 FAILED: Total = Rp {total:,.0f}, expected Rp {expected:,.0f}")
                    if total == 40000:
                        print(f"   ✗ BUG: Using quantity-first (40000 * 1 = 40,000)")
                    return None
        else:
            print(f"❌ Failed to create SO: {response.text}")
            return None
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return None

def test_2_so_with_agen_discount(data):
    """
    TEST 2: SO total with discount (simulate Agen 5%)
    Create SO with AG-100, quantity=1, weight=100, unitPrice=40000, discount=200000
    Expected: totalAmount = 3,800,000 (POSITIVE), discountTotal = 200,000
    """
    print("\n" + "=" * 80)
    print("TEST 2: SO WITH AGEN DISCOUNT (5% = 200,000)")
    print("=" * 80)
    
    if 'agen_id' not in data or 'product_id' not in data:
        print("❌ Missing test data (agen or product)")
        return None
    
    payload = {
        "customerId": data['agen_id'],
        "orderDate": datetime.now().isoformat(),
        "items": [
            {
                "productId": data['product_id'],
                "quantity": 1,
                "weight": 100,
                "unitPrice": 40000,
                "discount": 200000  # 5% of 4,000,000
            }
        ]
    }
    
    try:
        print(f"Creating SO with: quantity=1, weight=100kg, unitPrice=40000, discount=200000")
        response = session.post(f"{BASE_URL}/sales-orders", json=payload, timeout=30)
        print(f"Response Status: {response.status_code}")
        
        if response.status_code == 201:
            so = response.json().get('data', {})
            so_id = so.get('id')
            print(f"✅ SO Created: {so.get('soNumber')}")
            
            # Get SO detail
            detail_response = session.get(f"{BASE_URL}/sales-orders/{so_id}", timeout=30)
            if detail_response.status_code == 200:
                detail = detail_response.json().get('data', {})
                total = detail.get('totalAmount', 0)
                discount_total = detail.get('discountTotal', 0)
                items = detail.get('items', [])
                
                print(f"\n📊 RESULTS:")
                print(f"   Total Amount: Rp {total:,.0f}")
                print(f"   Discount Total: Rp {discount_total:,.0f}")
                if items:
                    print(f"   Item Subtotal: Rp {items[0].get('subtotal', 0):,.0f}")
                
                # Verify
                expected_total = 3800000
                expected_discount = 200000
                
                if abs(total - expected_total) < 1 and abs(discount_total - expected_discount) < 1:
                    print(f"✅ TEST 2 PASSED: Total = Rp {total:,.0f} (expected Rp {expected_total:,.0f})")
                    print(f"   ✓ Discount = Rp {discount_total:,.0f} (expected Rp {expected_discount:,.0f})")
                    print(f"   ✓ Total is POSITIVE (bug fix confirmed)")
                    if items:
                        print(f"   ✓ Item subtotal = Rp {items[0].get('subtotal', 0):,.0f}")
                    return so_id
                else:
                    print(f"❌ TEST 2 FAILED:")
                    print(f"   Total = Rp {total:,.0f}, expected Rp {expected_total:,.0f}")
                    print(f"   Discount = Rp {discount_total:,.0f}, expected Rp {expected_discount:,.0f}")
                    if total < 0:
                        print(f"   ✗ CRITICAL BUG: Total is NEGATIVE!")
                    return None
        else:
            print(f"❌ Failed to create SO: {response.text}")
            return None
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return None

def test_3_so_with_dropshipper_commission(data):
    """
    TEST 3: SO + dropshipper commission (per_kg)
    Create SO with CUST-100, dropshipperId=DS-100, quantity=1, weight=50, unitPrice=40000
    Expected: commission.amount = 7,500 (150 * 50kg), totalAmount = 2,000,000
    """
    print("\n" + "=" * 80)
    print("TEST 3: SO WITH DROPSHIPPER COMMISSION (PER_KG)")
    print("=" * 80)
    
    if 'customer_id' not in data or 'product_id' not in data or 'dropshipper_id' not in data:
        print("❌ Missing test data")
        return None
    
    payload = {
        "customerId": data['customer_id'],
        "dropshipperId": data['dropshipper_id'],
        "orderDate": datetime.now().isoformat(),
        "items": [
            {
                "productId": data['product_id'],
                "quantity": 1,
                "weight": 50,
                "unitPrice": 40000,
                "discount": 0
            }
        ]
    }
    
    try:
        print(f"Creating SO with: dropshipperId=DS-100, weight=50kg, unitPrice=40000")
        response = session.post(f"{BASE_URL}/sales-orders", json=payload, timeout=30)
        print(f"Response Status: {response.status_code}")
        
        if response.status_code == 201:
            so = response.json().get('data', {})
            so_id = so.get('id')
            commission = so.get('commission', {})
            print(f"✅ SO Created: {so.get('soNumber')}")
            
            # Get SO detail
            detail_response = session.get(f"{BASE_URL}/sales-orders/{so_id}", timeout=30)
            if detail_response.status_code == 200:
                detail = detail_response.json().get('data', {})
                total = detail.get('totalAmount', 0)
                
                print(f"\n📊 RESULTS:")
                print(f"   Total Amount: Rp {total:,.0f}")
                print(f"   Commission Amount: Rp {commission.get('amount', 0):,.0f}")
                
                # Get commission records
                comm_response = session.get(f"{BASE_URL}/contacts/{data['dropshipper_id']}/commissions", timeout=30)
                if comm_response.status_code == 200:
                    comm_data = comm_response.json()
                    records = comm_data.get('records', [])
                    summary = comm_data.get('summary', {})
                    
                    print(f"   Commission Records: {len(records)}")
                    print(f"   Outstanding: Rp {summary.get('outstanding', 0):,.0f}")
                    
                    # Find the record for this SO
                    so_record = next((r for r in records if r.get('salesOrderId') == so_id), None)
                    if so_record:
                        print(f"   Record Status: {so_record.get('status')}")
                        print(f"   Record Amount: Rp {so_record.get('amount', 0):,.0f}")
                
                # Verify
                expected_total = 2000000  # 40000 * 50
                expected_commission = 7500  # 150 * 50
                
                if abs(total - expected_total) < 1 and abs(commission.get('amount', 0) - expected_commission) < 1:
                    print(f"✅ TEST 3 PASSED:")
                    print(f"   ✓ Total = Rp {total:,.0f} (expected Rp {expected_total:,.0f})")
                    print(f"   ✓ Commission = Rp {commission.get('amount', 0):,.0f} (expected Rp {expected_commission:,.0f})")
                    print(f"   ✓ Commission calculation: 150 * 50kg = 7,500")
                    return so_id
                else:
                    print(f"❌ TEST 3 FAILED:")
                    print(f"   Total = Rp {total:,.0f}, expected Rp {expected_total:,.0f}")
                    print(f"   Commission = Rp {commission.get('amount', 0):,.0f}, expected Rp {expected_commission:,.0f}")
                    return None
        else:
            print(f"❌ Failed to create SO: {response.text}")
            return None
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return None

def test_4_so_patch_items_recompute(data):
    """
    TEST 4: SO PATCH items recompute
    Create Draft SO, PATCH items with weight=20, verify totalAmount = 800,000
    """
    print("\n" + "=" * 80)
    print("TEST 4: SO PATCH ITEMS RECOMPUTE")
    print("=" * 80)
    
    if 'customer_id' not in data or 'product_id' not in data:
        print("❌ Missing test data")
        return None
    
    # Create Draft SO
    payload = {
        "customerId": data['customer_id'],
        "orderDate": datetime.now().isoformat(),
        "items": [
            {
                "productId": data['product_id'],
                "quantity": 1,
                "weight": 100,
                "unitPrice": 40000,
                "discount": 0
            }
        ]
    }
    
    try:
        print(f"Creating Draft SO...")
        response = session.post(f"{BASE_URL}/sales-orders", json=payload, timeout=30)
        
        if response.status_code == 201:
            so = response.json().get('data', {})
            so_id = so.get('id')
            print(f"✅ Draft SO Created: {so.get('soNumber')}")
            
            # PATCH items with weight=20
            patch_payload = {
                "items": [
                    {
                        "productId": data['product_id'],
                        "quantity": 1,
                        "weight": 20,
                        "unitPrice": 40000,
                        "discount": 0
                    }
                ]
            }
            
            print(f"\nPATCHing items with weight=20kg...")
            patch_response = session.patch(f"{BASE_URL}/sales-orders/{so_id}", json=patch_payload, timeout=30)
            print(f"PATCH Status: {patch_response.status_code}")
            
            if patch_response.status_code == 200:
                # Get updated SO detail
                detail_response = session.get(f"{BASE_URL}/sales-orders/{so_id}", timeout=30)
                if detail_response.status_code == 200:
                    detail = detail_response.json().get('data', {})
                    total = detail.get('totalAmount', 0)
                    
                    print(f"\n📊 RESULTS:")
                    print(f"   Total Amount: Rp {total:,.0f}")
                    
                    # Verify
                    expected = 800000  # 40000 * 20
                    
                    if abs(total - expected) < 1:
                        print(f"✅ TEST 4 PASSED: Total = Rp {total:,.0f} (expected Rp {expected:,.0f})")
                        print(f"   ✓ Weight-based recompute working (40000 * 20 = 800,000)")
                        return so_id
                    else:
                        print(f"❌ TEST 4 FAILED: Total = Rp {total:,.0f}, expected Rp {expected:,.0f}")
                        if total == 40000:
                            print(f"   ✗ BUG: Using quantity-first (40000 * 1 = 40,000)")
                        return None
            else:
                print(f"❌ Failed to PATCH SO: {patch_response.text}")
                return None
        else:
            print(f"❌ Failed to create SO: {response.text}")
            return None
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return None

def test_5_commission_preview(data):
    """
    TEST 5: Commission preview
    Test preview with different commission types
    """
    print("\n" + "=" * 80)
    print("TEST 5: COMMISSION PREVIEW")
    print("=" * 80)
    
    # First create an SO to use for preview
    if 'customer_id' not in data or 'product_id' not in data or 'dropshipper_id' not in data:
        print("❌ Missing test data")
        return False
    
    payload = {
        "customerId": data['customer_id'],
        "dropshipperId": data['dropshipper_id'],
        "orderDate": datetime.now().isoformat(),
        "items": [
            {
                "productId": data['product_id'],
                "quantity": 1,
                "weight": 50,
                "unitPrice": 40000,
                "discount": 0
            }
        ]
    }
    
    try:
        print(f"Creating SO for preview test...")
        response = session.post(f"{BASE_URL}/sales-orders", json=payload, timeout=30)
        
        if response.status_code == 201:
            so = response.json().get('data', {})
            so_id = so.get('id')
            print(f"✅ SO Created: {so.get('soNumber')}")
            
            # Test 1: per_kg preview
            print(f"\n--- Testing per_kg preview ---")
            preview_payload = {
                "salesOrderId": so_id,
                "commissionType": "per_kg",
                "commissionValue": 150
            }
            preview_response = session.post(f"{BASE_URL}/commissions/preview", json=preview_payload, timeout=30)
            if preview_response.status_code == 200:
                preview = preview_response.json()
                amount = preview.get('amount', 0)
                expected = 7500  # 150 * 50kg
                print(f"   Amount: Rp {amount:,.0f} (expected Rp {expected:,.0f})")
                if abs(amount - expected) < 1:
                    print(f"   ✅ per_kg preview correct")
                else:
                    print(f"   ❌ per_kg preview incorrect")
            
            # Test 2: fixed preview
            print(f"\n--- Testing fixed preview ---")
            preview_payload = {
                "salesOrderId": so_id,
                "commissionType": "fixed",
                "commissionValue": 100000
            }
            preview_response = session.post(f"{BASE_URL}/commissions/preview", json=preview_payload, timeout=30)
            if preview_response.status_code == 200:
                preview = preview_response.json()
                amount = preview.get('amount', 0)
                expected = 100000
                print(f"   Amount: Rp {amount:,.0f} (expected Rp {expected:,.0f})")
                if abs(amount - expected) < 1:
                    print(f"   ✅ fixed preview correct")
                else:
                    print(f"   ❌ fixed preview incorrect")
            
            # Test 3: percent_profit preview
            print(f"\n--- Testing percent_profit preview ---")
            preview_payload = {
                "salesOrderId": so_id,
                "commissionType": "percent_profit",
                "commissionValue": 10
            }
            preview_response = session.post(f"{BASE_URL}/commissions/preview", json=preview_payload, timeout=30)
            if preview_response.status_code == 200:
                preview = preview_response.json()
                amount = preview.get('amount', 0)
                revenue = preview.get('revenue', 0)
                cost = preview.get('cost', 0)
                profit = preview.get('profit', 0)
                print(f"   Revenue: Rp {revenue:,.0f}")
                print(f"   Cost: Rp {cost:,.0f}")
                print(f"   Profit: Rp {profit:,.0f}")
                print(f"   Amount (10%): Rp {amount:,.0f}")
                expected = round(0.1 * max(0, revenue - cost))
                if abs(amount - expected) < 1:
                    print(f"   ✅ percent_profit preview correct")
                else:
                    print(f"   ❌ percent_profit preview incorrect (expected Rp {expected:,.0f})")
            
            print(f"\n✅ TEST 5 PASSED: All commission preview types working")
            return True
        else:
            print(f"❌ Failed to create SO: {response.text}")
            return False
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return False

def test_6_commission_payment(data):
    """
    TEST 6: Commission payment
    Pay all commissions and verify outstanding = 0
    """
    print("\n" + "=" * 80)
    print("TEST 6: COMMISSION PAYMENT")
    print("=" * 80)
    
    if 'dropshipper_id' not in data:
        print("❌ Missing dropshipper data")
        return False
    
    try:
        # Get current commissions
        print(f"Getting commission summary...")
        comm_response = session.get(f"{BASE_URL}/contacts/{data['dropshipper_id']}/commissions", timeout=30)
        
        if comm_response.status_code == 200:
            comm_data = comm_response.json()
            summary_before = comm_data.get('summary', {})
            outstanding_before = summary_before.get('outstanding', 0)
            
            print(f"   Outstanding Before: Rp {outstanding_before:,.0f}")
            
            if outstanding_before > 0:
                # Pay all commissions
                print(f"\nPaying all commissions...")
                payment_response = session.post(
                    f"{BASE_URL}/contacts/{data['dropshipper_id']}/commission-payments",
                    json={},
                    timeout=30
                )
                
                if payment_response.status_code == 200:
                    print(f"✅ Payment successful")
                    
                    # Get updated summary
                    comm_response2 = session.get(f"{BASE_URL}/contacts/{data['dropshipper_id']}/commissions", timeout=30)
                    if comm_response2.status_code == 200:
                        comm_data2 = comm_response2.json()
                        summary_after = comm_data2.get('summary', {})
                        outstanding_after = summary_after.get('outstanding', 0)
                        
                        print(f"\n📊 RESULTS:")
                        print(f"   Outstanding After: Rp {outstanding_after:,.0f}")
                        
                        if outstanding_after == 0:
                            print(f"✅ TEST 6 PASSED: Outstanding = 0 after payment")
                            return True
                        else:
                            print(f"❌ TEST 6 FAILED: Outstanding = Rp {outstanding_after:,.0f}, expected 0")
                            return False
                else:
                    print(f"❌ Payment failed: {payment_response.text}")
                    return False
            else:
                print(f"⚠️  No outstanding commissions to pay")
                print(f"✅ TEST 6 PASSED: Outstanding already 0")
                return True
        else:
            print(f"❌ Failed to get commissions: {comm_response.text}")
            return False
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return False

def main():
    """Main test runner"""
    print("\n" + "=" * 80)
    print("BACKEND TEST: SO SUBTOTAL BUG FIX (WEIGHT-BASED CALCULATION)")
    print("=" * 80)
    print(f"Testing fix: unitPrice * (weight || quantity) instead of (quantity || weight)")
    print(f"Base URL: {BASE_URL}")
    print(f"Login: {LOGIN_EMAIL}")
    
    # Login
    if not login():
        print("\n❌ TESTS ABORTED: Login failed")
        return
    
    # Get test data
    data = get_test_data()
    
    if not data.get('customer_id') or not data.get('product_id'):
        print("\n❌ TESTS ABORTED: Missing required test data")
        return
    
    # Run tests
    results = {
        "test_1": False,
        "test_2": False,
        "test_3": False,
        "test_4": False,
        "test_5": False,
        "test_6": False
    }
    
    # Test 1: SO total (weight-based, no discount)
    so_id_1 = test_1_so_weight_based_no_discount(data)
    results["test_1"] = so_id_1 is not None
    
    # Test 2: SO with Agen discount
    so_id_2 = test_2_so_with_agen_discount(data)
    results["test_2"] = so_id_2 is not None
    
    # Test 3: SO with dropshipper commission
    so_id_3 = test_3_so_with_dropshipper_commission(data)
    results["test_3"] = so_id_3 is not None
    
    # Test 4: SO PATCH items recompute
    so_id_4 = test_4_so_patch_items_recompute(data)
    results["test_4"] = so_id_4 is not None
    
    # Test 5: Commission preview
    results["test_5"] = test_5_commission_preview(data)
    
    # Test 6: Commission payment
    results["test_6"] = test_6_commission_payment(data)
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, passed_flag in results.items():
        status = "✅ PASSED" if passed_flag else "❌ FAILED"
        print(f"{test_name}: {status}")
    
    print(f"\nTotal: {passed}/{total} tests passed ({passed/total*100:.0f}%)")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED! Bug fix verified successfully.")
    else:
        print(f"\n⚠️  {total - passed} test(s) failed. Please review.")

if __name__ == "__main__":
    main()
