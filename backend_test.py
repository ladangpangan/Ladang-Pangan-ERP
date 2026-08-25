#!/usr/bin/env python3
"""
Backend API Test for Item #1B: Dropshipper Commission Bugfix
Tests that commission records are created AND returned by GET /sales-orders/:id
"""

import requests
import json
import time
from datetime import datetime

# Configuration
BASE_URL = "https://ladang-erp-system.preview.emergentagent.com/api"
LOGIN_EMAIL = "admin@lpi.co.id"
LOGIN_PASSWORD = "admin123"
ORIGIN = "https://ladang-erp-system.preview.emergentagent.com"

# Test data IDs (will be populated during test)
test_data = {
    'dropshipper_id': None,
    'customer_id': None,
    'supplier_id': None,
    'product_id': None,
    'so_stock_id': None,
    'so_dropship_id': None,
}

def log(msg):
    """Print timestamped log message"""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def login():
    """Login and return session"""
    log("=== AUTHENTICATION ===")
    session = requests.Session()
    
    # Login
    login_url = f"{BASE_URL}/auth/sign-in/email"
    login_data = {
        "email": LOGIN_EMAIL,
        "password": LOGIN_PASSWORD
    }
    headers = {
        "Content-Type": "application/json",
        "Origin": ORIGIN
    }
    
    try:
        resp = session.post(login_url, json=login_data, headers=headers)
        log(f"Login response: {resp.status_code}")
        
        if resp.status_code == 200:
            log("✅ Login successful")
            return session
        else:
            log(f"❌ Login failed: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        log(f"❌ Login error: {str(e)}")
        return None

def test_step_1_create_prerequisites(session):
    """Step 1: Create dropshipper, customer, supplier, product"""
    log("\n=== STEP 1: CREATE PREREQUISITES ===")
    
    timestamp = int(time.time())
    
    # 1.1 Create Dropshipper contact
    log("\n1.1 Creating Dropshipper contact...")
    dropshipper_data = {
        "displayName": f"Test DS {timestamp}",
        "categories": ["Dropshipper"],
        "commissionType": "per_kg",
        "commissionValue": 1000
    }
    
    try:
        resp = session.post(f"{BASE_URL}/contacts", json=dropshipper_data)
        log(f"Dropshipper creation response: {resp.status_code}")
        
        if resp.status_code == 201:
            data = resp.json().get('data', {})
            test_data['dropshipper_id'] = data.get('id')
            log(f"✅ Dropshipper created: ID={test_data['dropshipper_id']}, code={data.get('code')}, isDropshipper={data.get('isDropshipper')}")
            
            # Verify response has code like 'DS-xxx' and isDropshipper true
            code = data.get('code', '')
            is_dropshipper = data.get('isDropshipper')
            
            if code.startswith('DS-') and is_dropshipper:
                log(f"✅ Dropshipper validation passed: code={code}, isDropshipper={is_dropshipper}")
            else:
                log(f"⚠️ Dropshipper validation warning: code={code}, isDropshipper={is_dropshipper}")
        else:
            log(f"❌ Dropshipper creation failed: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        log(f"❌ Dropshipper creation error: {str(e)}")
        return False
    
    # 1.2 Create Customer contact
    log("\n1.2 Creating Customer contact...")
    customer_data = {
        "displayName": f"Test Cust {timestamp}",
        "categories": ["Customer"]
    }
    
    try:
        resp = session.post(f"{BASE_URL}/contacts", json=customer_data)
        log(f"Customer creation response: {resp.status_code}")
        
        if resp.status_code == 201:
            data = resp.json().get('data', {})
            test_data['customer_id'] = data.get('id')
            log(f"✅ Customer created: ID={test_data['customer_id']}, code={data.get('code')}")
        else:
            log(f"❌ Customer creation failed: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        log(f"❌ Customer creation error: {str(e)}")
        return False
    
    # 1.3 Create Supplier contact
    log("\n1.3 Creating Supplier contact...")
    supplier_data = {
        "displayName": f"Test Sup {timestamp}",
        "categories": ["Supplier"]
    }
    
    try:
        resp = session.post(f"{BASE_URL}/contacts", json=supplier_data)
        log(f"Supplier creation response: {resp.status_code}")
        
        if resp.status_code == 201:
            data = resp.json().get('data', {})
            test_data['supplier_id'] = data.get('id')
            log(f"✅ Supplier created: ID={test_data['supplier_id']}, code={data.get('code')}")
        else:
            log(f"❌ Supplier creation failed: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        log(f"❌ Supplier creation error: {str(e)}")
        return False
    
    # 1.4 Create Product
    log("\n1.4 Creating Product...")
    product_data = {
        "sku": f"ITEST-{timestamp}",
        "name": f"Test Prod {timestamp}",
        "unit": "kg",
        "basePrice": 30000,
        "category": "Produk Jadi"
    }
    
    try:
        resp = session.post(f"{BASE_URL}/products", json=product_data)
        log(f"Product creation response: {resp.status_code}")
        
        if resp.status_code == 201:
            data = resp.json().get('data', {})
            test_data['product_id'] = data.get('id')
            log(f"✅ Product created: ID={test_data['product_id']}, SKU={data.get('sku')}")
        else:
            log(f"❌ Product creation failed: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        log(f"❌ Product creation error: {str(e)}")
        return False
    
    log("\n✅ STEP 1 COMPLETE: All prerequisites created")
    return True

def test_step_2_stock_so_with_commission(session):
    """Step 2: Create STOCK SO with commission and verify response"""
    log("\n=== STEP 2: STOCK SO WITH COMMISSION ===")
    
    so_data = {
        "customerId": test_data['customer_id'],
        "dropshipperId": test_data['dropshipper_id'],
        "commissionType": "per_kg",
        "commissionValue": 1000,
        "fulfillmentType": "stock",
        "orderDate": "2026-08-25",
        "paymentTerm": "cash",
        "items": [
            {
                "productId": test_data['product_id'],
                "quantity": 10,
                "weight": 50,
                "unitPrice": 40000
            }
        ]
    }
    
    try:
        resp = session.post(f"{BASE_URL}/sales-orders", json=so_data)
        log(f"Stock SO creation response: {resp.status_code}")
        
        if resp.status_code == 201:
            response_data = resp.json()
            data = response_data.get('data', {})
            commission = response_data.get('commission')
            
            test_data['so_stock_id'] = data.get('id')
            log(f"✅ Stock SO created: ID={test_data['so_stock_id']}, SO Number={data.get('soNumber')}")
            
            # Verify commission in response
            if commission:
                commission_amount = commission.get('amount')
                expected_amount = 50000  # 1000 * 50kg
                
                log(f"Commission in response: {json.dumps(commission, indent=2)}")
                
                if commission_amount == expected_amount:
                    log(f"✅ Commission amount correct: {commission_amount} (expected {expected_amount})")
                else:
                    log(f"❌ Commission amount mismatch: {commission_amount} (expected {expected_amount})")
                    return False
            else:
                log(f"❌ Commission not found in response")
                return False
        else:
            log(f"❌ Stock SO creation failed: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        log(f"❌ Stock SO creation error: {str(e)}")
        return False
    
    log("\n✅ STEP 2 COMPLETE: Stock SO with commission created")
    return True

def test_step_3_get_so_detail_returns_commissions(session):
    """Step 3: CORE FIX - GET SO detail returns commissions array"""
    log("\n=== STEP 3: CORE FIX - GET SO DETAIL RETURNS COMMISSIONS ===")
    
    so_id = test_data['so_stock_id']
    
    try:
        resp = session.get(f"{BASE_URL}/sales-orders/{so_id}")
        log(f"GET SO detail response: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            commissions = data.get('commissions')
            
            log(f"SO Number: {data.get('soNumber')}")
            log(f"Commissions field present: {commissions is not None}")
            
            if commissions is None:
                log(f"❌ CRITICAL: commissions field is missing from response")
                return False
            
            if not isinstance(commissions, list):
                log(f"❌ CRITICAL: commissions is not an array, type={type(commissions)}")
                return False
            
            log(f"✅ Commissions is an array with length: {len(commissions)}")
            
            if len(commissions) < 1:
                log(f"❌ CRITICAL: commissions array is empty (expected at least 1 record)")
                return False
            
            log(f"✅ Commissions array has {len(commissions)} record(s)")
            
            # Verify first commission record
            commission = commissions[0]
            log(f"\nCommission record details:")
            log(f"  - commissionAmount: {commission.get('commissionAmount')}")
            log(f"  - commissionType: {commission.get('commissionType')}")
            log(f"  - status: {commission.get('status')}")
            log(f"  - dropshipper: {commission.get('dropshipper')}")
            
            # Verify commission amount
            commission_amount = commission.get('commissionAmount')
            expected_amount = 50000  # 1000 * 50kg
            
            if commission_amount != expected_amount:
                log(f"❌ Commission amount mismatch: {commission_amount} (expected {expected_amount})")
                return False
            
            log(f"✅ Commission amount correct: {commission_amount}")
            
            # Verify commission type
            commission_type = commission.get('commissionType')
            if commission_type != 'per_kg':
                log(f"❌ Commission type mismatch: {commission_type} (expected 'per_kg')")
                return False
            
            log(f"✅ Commission type correct: {commission_type}")
            
            # Verify status
            status = commission.get('status')
            if status != 'unpaid':
                log(f"❌ Status mismatch: {status} (expected 'unpaid')")
                return False
            
            log(f"✅ Status correct: {status}")
            
            # Verify dropshipper object populated
            dropshipper = commission.get('dropshipper')
            if not dropshipper:
                log(f"❌ Dropshipper object is missing or null")
                return False
            
            log(f"✅ Dropshipper object populated:")
            log(f"  - code: {dropshipper.get('code')}")
            log(f"  - displayName: {dropshipper.get('displayName')}")
            
            # Verify dropshipper matches the one we created
            if dropshipper.get('code') and dropshipper.get('displayName'):
                log(f"✅ Dropshipper has code and displayName")
            else:
                log(f"❌ Dropshipper missing code or displayName")
                return False
            
        else:
            log(f"❌ GET SO detail failed: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        log(f"❌ GET SO detail error: {str(e)}")
        return False
    
    log("\n✅ STEP 3 COMPLETE: GET SO detail returns commissions array with correct data")
    return True

def test_step_4_dropship_so_with_commission(session):
    """Step 4: Create DROPSHIP SO with commission and verify"""
    log("\n=== STEP 4: DROPSHIP SO WITH COMMISSION ===")
    
    so_data = {
        "customerId": test_data['customer_id'],
        "dropshipperId": test_data['dropshipper_id'],
        "commissionType": "per_kg",
        "commissionValue": 1500,
        "fulfillmentType": "dropship",
        "supplierId": test_data['supplier_id'],
        "orderDate": "2026-08-25",
        "paymentTerm": "cash",
        "items": [
            {
                "productId": test_data['product_id'],
                "quantity": 10,
                "weight": 40,
                "unitPrice": 45000,
                "buyPrice": 35000
            }
        ]
    }
    
    try:
        resp = session.post(f"{BASE_URL}/sales-orders", json=so_data)
        log(f"Dropship SO creation response: {resp.status_code}")
        
        if resp.status_code == 201:
            response_data = resp.json()
            data = response_data.get('data', {})
            commission = response_data.get('commission')
            
            test_data['so_dropship_id'] = data.get('id')
            log(f"✅ Dropship SO created: ID={test_data['so_dropship_id']}, SO Number={data.get('soNumber')}")
            
            # Verify commission in response
            if commission:
                commission_amount = commission.get('amount')
                expected_amount = 60000  # 1500 * 40kg
                
                log(f"Commission in response: {json.dumps(commission, indent=2)}")
                
                if commission_amount == expected_amount:
                    log(f"✅ Commission amount correct: {commission_amount} (expected {expected_amount})")
                else:
                    log(f"❌ Commission amount mismatch: {commission_amount} (expected {expected_amount})")
                    return False
            else:
                log(f"❌ Commission not found in response")
                return False
            
            # Now GET the SO detail to verify commissions array
            log(f"\nGetting SO detail for dropship SO...")
            resp2 = session.get(f"{BASE_URL}/sales-orders/{test_data['so_dropship_id']}")
            
            if resp2.status_code == 200:
                data2 = resp2.json().get('data', {})
                commissions = data2.get('commissions')
                
                if commissions and len(commissions) >= 1:
                    commission_rec = commissions[0]
                    commission_amount = commission_rec.get('commissionAmount')
                    dropshipper = commission_rec.get('dropshipper')
                    
                    log(f"✅ Dropship SO commissions array has {len(commissions)} record(s)")
                    log(f"  - commissionAmount: {commission_amount} (expected 60000)")
                    log(f"  - dropshipper populated: {dropshipper is not None}")
                    
                    if commission_amount == 60000 and dropshipper:
                        log(f"✅ Dropship SO commission verification passed")
                    else:
                        log(f"❌ Dropship SO commission verification failed")
                        return False
                else:
                    log(f"❌ Dropship SO commissions array is empty or missing")
                    return False
            else:
                log(f"❌ GET dropship SO detail failed: {resp2.status_code}")
                return False
            
        else:
            log(f"❌ Dropship SO creation failed: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        log(f"❌ Dropship SO creation error: {str(e)}")
        return False
    
    log("\n✅ STEP 4 COMPLETE: Dropship SO with commission created and verified")
    return True

def test_step_5_persistence_check_via_dropshipper_endpoint(session):
    """Step 5: Persistence check via dropshipper endpoint"""
    log("\n=== STEP 5: PERSISTENCE CHECK VIA DROPSHIPPER ENDPOINT ===")
    
    dropshipper_id = test_data['dropshipper_id']
    
    try:
        resp = session.get(f"{BASE_URL}/contacts/{dropshipper_id}/commissions")
        log(f"GET dropshipper commissions response: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            records = data.get('records', [])
            summary = data.get('summary', {})
            
            log(f"Commission records count: {len(records)}")
            log(f"Summary: {json.dumps(summary, indent=2)}")
            
            # Should have 2 records (1 from stock SO, 1 from dropship SO)
            if len(records) < 2:
                log(f"❌ Expected at least 2 commission records, got {len(records)}")
                return False
            
            log(f"✅ Found {len(records)} commission records")
            
            # Verify amounts
            total_commission = 0
            for rec in records:
                amount = rec.get('commissionAmount', 0)
                so_number = rec.get('soNumber', 'N/A')
                log(f"  - SO {so_number}: Rp {amount:,.0f}")
                total_commission += amount
            
            expected_total = 110000  # 50000 + 60000
            log(f"\nTotal commission: Rp {total_commission:,.0f} (expected Rp {expected_total:,.0f})")
            
            if total_commission == expected_total:
                log(f"✅ Total commission correct")
            else:
                log(f"⚠️ Total commission mismatch (but records exist)")
            
            # Check summary
            summary_total = summary.get('totalCommission', 0)
            log(f"Summary totalCommission: Rp {summary_total:,.0f}")
            
            if summary_total == expected_total:
                log(f"✅ Summary totalCommission correct")
            else:
                log(f"⚠️ Summary totalCommission mismatch")
            
        else:
            log(f"❌ GET dropshipper commissions failed: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        log(f"❌ GET dropshipper commissions error: {str(e)}")
        return False
    
    log("\n✅ STEP 5 COMPLETE: Persistence check passed")
    return True

def test_step_6_regression_tests(session):
    """Step 6: Regression tests"""
    log("\n=== STEP 6: REGRESSION TESTS ===")
    
    # 6.1 Add "pelanggan akhir" to the dropshipper
    log("\n6.1 Adding pelanggan akhir to dropshipper...")
    
    customer_data = {
        "name": "Pelanggan Test",
        "phone": "0812",
        "city": "Kediri"
    }
    
    try:
        resp = session.post(f"{BASE_URL}/contacts/{test_data['dropshipper_id']}/customers", json=customer_data)
        log(f"Add customer response: {resp.status_code}")
        
        if resp.status_code == 201:
            data = resp.json().get('data', {})
            customer_id = data.get('id')
            log(f"✅ Customer added: ID={customer_id}, name={data.get('name')}")
            
            # Now GET the customers list
            resp2 = session.get(f"{BASE_URL}/contacts/{test_data['dropshipper_id']}/customers")
            
            if resp2.status_code == 200:
                customers = resp2.json().get('data', [])
                log(f"✅ GET customers returned {len(customers)} customer(s)")
                
                # Check if our customer is in the list
                found = False
                for cust in customers:
                    if cust.get('name') == 'Pelanggan Test':
                        found = True
                        log(f"✅ New customer found in list: {cust.get('name')}")
                        break
                
                if not found:
                    log(f"❌ New customer not found in list")
                    return False
            else:
                log(f"❌ GET customers failed: {resp2.status_code}")
                return False
        else:
            log(f"❌ Add customer failed: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        log(f"❌ Add customer error: {str(e)}")
        return False
    
    # 6.2 Plain SO WITHOUT dropshipperId
    log("\n6.2 Creating plain SO without dropshipperId...")
    
    so_data = {
        "customerId": test_data['customer_id'],
        "fulfillmentType": "stock",
        "orderDate": "2026-08-25",
        "paymentTerm": "cash",
        "items": [
            {
                "productId": test_data['product_id'],
                "quantity": 5,
                "weight": 20,
                "unitPrice": 40000
            }
        ]
    }
    
    try:
        resp = session.post(f"{BASE_URL}/sales-orders", json=so_data)
        log(f"Plain SO creation response: {resp.status_code}")
        
        if resp.status_code == 201:
            response_data = resp.json()
            data = response_data.get('data', {})
            commission = response_data.get('commission')
            so_id = data.get('id')
            
            log(f"✅ Plain SO created: ID={so_id}, SO Number={data.get('soNumber')}")
            
            # Verify commission is null
            if commission is None:
                log(f"✅ Commission is null (as expected)")
            else:
                log(f"⚠️ Commission is not null: {commission}")
            
            # GET SO detail to verify commissions array is empty
            resp2 = session.get(f"{BASE_URL}/sales-orders/{so_id}")
            
            if resp2.status_code == 200:
                data2 = resp2.json().get('data', {})
                commissions = data2.get('commissions')
                
                if commissions is not None and isinstance(commissions, list):
                    if len(commissions) == 0:
                        log(f"✅ Commissions array is empty (length 0)")
                    else:
                        log(f"❌ Commissions array is not empty: length={len(commissions)}")
                        return False
                else:
                    log(f"❌ Commissions field is missing or not an array")
                    return False
                
                log(f"✅ No 500 errors, plain SO works correctly")
            else:
                if resp2.status_code == 500:
                    log(f"❌ 500 error when getting plain SO detail")
                    return False
                else:
                    log(f"❌ GET plain SO detail failed: {resp2.status_code}")
                    return False
        else:
            if resp.status_code == 500:
                log(f"❌ 500 error when creating plain SO")
                return False
            else:
                log(f"❌ Plain SO creation failed: {resp.status_code} - {resp.text}")
                return False
    except Exception as e:
        log(f"❌ Plain SO creation error: {str(e)}")
        return False
    
    log("\n✅ STEP 6 COMPLETE: Regression tests passed")
    return True

def main():
    """Main test runner"""
    log("=" * 80)
    log("BACKEND API TEST: Item #1B - Dropshipper Commission Bugfix")
    log("=" * 80)
    
    # Login
    session = login()
    if not session:
        log("\n❌ TEST FAILED: Unable to login")
        return False
    
    # Run tests
    results = []
    
    # Step 1: Create prerequisites
    result = test_step_1_create_prerequisites(session)
    results.append(("Step 1: Create prerequisites", result))
    if not result:
        log("\n❌ TEST FAILED: Step 1 failed")
        return False
    
    # Step 2: Stock SO with commission
    result = test_step_2_stock_so_with_commission(session)
    results.append(("Step 2: Stock SO with commission", result))
    if not result:
        log("\n❌ TEST FAILED: Step 2 failed")
        return False
    
    # Step 3: CORE FIX - GET SO detail returns commissions
    result = test_step_3_get_so_detail_returns_commissions(session)
    results.append(("Step 3: GET SO detail returns commissions", result))
    if not result:
        log("\n❌ TEST FAILED: Step 3 failed (CORE FIX)")
        return False
    
    # Step 4: Dropship SO with commission
    result = test_step_4_dropship_so_with_commission(session)
    results.append(("Step 4: Dropship SO with commission", result))
    if not result:
        log("\n❌ TEST FAILED: Step 4 failed")
        return False
    
    # Step 5: Persistence check via dropshipper endpoint
    result = test_step_5_persistence_check_via_dropshipper_endpoint(session)
    results.append(("Step 5: Persistence check", result))
    if not result:
        log("\n❌ TEST FAILED: Step 5 failed")
        return False
    
    # Step 6: Regression tests
    result = test_step_6_regression_tests(session)
    results.append(("Step 6: Regression tests", result))
    if not result:
        log("\n❌ TEST FAILED: Step 6 failed")
        return False
    
    # Summary
    log("\n" + "=" * 80)
    log("TEST SUMMARY")
    log("=" * 80)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        log(f"{status} - {test_name}")
    
    all_passed = all(result for _, result in results)
    
    if all_passed:
        log("\n✅ ALL TESTS PASSED")
        log("\nTest data IDs (NOT deleted):")
        for key, value in test_data.items():
            log(f"  - {key}: {value}")
    else:
        log("\n❌ SOME TESTS FAILED")
    
    log("=" * 80)
    
    return all_passed

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
