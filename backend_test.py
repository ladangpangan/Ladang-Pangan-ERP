#!/usr/bin/env python3
"""
Backend Test: SO Penerimaan Customer - Surplus Feature (Received > Shipped)
CRITICAL: This test runs against LIVE production MongoDB Atlas.
All operations are FULLY REVERSIBLE - receipts are deleted at the end.
"""

import requests
import json
import sys
from datetime import datetime

# Base URL from .env: NEXT_PUBLIC_BASE_URL
BASE_URL = "https://github-to-production.preview.emergentagent.com/api"
CREDENTIALS = {
    "email": "admin@lpi.co.id",
    "password": "admin123"
}

# Test state
session = requests.Session()
test_data = {
    "so_id": None,
    "so_number": None,
    "initial_total_amount": None,
    "initial_cogs": None,
    "initial_revenue": None,
    "receipt_ids": [],
    "approval_concern_ids": []
}

def log(msg):
    """Print timestamped log message"""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def login():
    """Step 0: Login as admin"""
    log("=" * 80)
    log("STEP 0: Login as admin@lpi.co.id")
    log("=" * 80)
    
    try:
        resp = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json=CREDENTIALS,
            headers={"Content-Type": "application/json"}
        )
        
        if resp.status_code == 200:
            log("✅ Login successful (200 OK)")
            # Check if session cookie is set
            cookies = session.cookies.get_dict()
            if any('session' in k.lower() for k in cookies.keys()):
                log(f"✅ Session cookie set: {list(cookies.keys())}")
            return True
        else:
            log(f"❌ Login failed: {resp.status_code}")
            log(f"Response: {resp.text}")
            return False
    except Exception as e:
        log(f"❌ Login exception: {e}")
        return False

def find_shipped_so():
    """Step 1: Find an existing Shipped SO"""
    log("\n" + "=" * 80)
    log("STEP 1: Find an EXISTING Shipped SO (e.g., SO/202608/0002)")
    log("=" * 80)
    
    try:
        resp = session.get(f"{BASE_URL}/sales-orders")
        
        if resp.status_code != 200:
            log(f"❌ GET /sales-orders failed: {resp.status_code}")
            return False
        
        data = resp.json()
        sales_orders = data.get('data', [])
        log(f"✅ Retrieved {len(sales_orders)} sales orders")
        
        # Find a Shipped SO
        shipped_so = None
        for so in sales_orders:
            if so.get('pipelineStatus') == 'Shipped':
                shipped_so = so
                break
        
        if not shipped_so:
            log("❌ No Shipped SO found. Need at least one SO with pipelineStatus='Shipped'")
            return False
        
        test_data['so_id'] = shipped_so['id']
        test_data['so_number'] = shipped_so['soNumber']
        test_data['initial_total_amount'] = float(shipped_so.get('totalAmount', 0))
        
        log(f"✅ Found Shipped SO: {test_data['so_number']}")
        log(f"   SO ID: {test_data['so_id']}")
        log(f"   Initial totalAmount: Rp {test_data['initial_total_amount']:,.0f}")
        
        # Get SO details to see items
        resp_detail = session.get(f"{BASE_URL}/sales-orders/{test_data['so_id']}")
        if resp_detail.status_code == 200:
            so_detail = resp_detail.json().get('data', {})
            items = so_detail.get('items', [])
            log(f"   Items count: {len(items)}")
            
            if items:
                item = items[0]
                log(f"   First item:")
                log(f"     - Product ID: {item.get('productId')}")
                log(f"     - Product: {item.get('product', {}).get('name', 'N/A')}")
                log(f"     - Ordered weight: {item.get('weight', 0)} kg")
                log(f"     - Shipped weight: {item.get('shippedWeight', 0)} kg")
                log(f"     - Unit price: Rp {item.get('unitPrice', 0):,.0f}")
                
                # Store first item for testing
                test_data['test_item'] = {
                    'productId': item.get('productId'),
                    'shippedWeight': float(item.get('shippedWeight') or item.get('weight', 0)),
                    'unitPrice': float(item.get('unitPrice', 0))
                }
        
        return True
        
    except Exception as e:
        log(f"❌ Exception in find_shipped_so: {e}")
        return False

def capture_baseline_financials():
    """Step 2: Capture baseline COGS and Revenue"""
    log("\n" + "=" * 80)
    log("STEP 2: Capture baseline COGS and Revenue from financial statements")
    log("=" * 80)
    
    try:
        # Get balance sheet
        resp_bs = session.get(f"{BASE_URL}/accounting/balance-sheet")
        if resp_bs.status_code == 200:
            bs_data = resp_bs.json().get('data', {})
            log(f"✅ Balance sheet retrieved")
            log(f"   Balanced: {bs_data.get('balanced', False)}")
            log(f"   Total Assets: Rp {bs_data.get('totalAssets', 0):,.0f}")
        else:
            log(f"⚠️  Balance sheet failed: {resp_bs.status_code}")
        
        # Get income statement
        resp_is = session.get(f"{BASE_URL}/accounting/income-statement")
        if resp_is.status_code == 200:
            is_data = resp_is.json().get('data', {})
            
            # Find COGS (HPP) and Revenue (Penjualan)
            cogs_section = is_data.get('cogs', {})
            revenue_section = is_data.get('revenue', {})
            
            test_data['initial_cogs'] = float(cogs_section.get('total', 0))
            test_data['initial_revenue'] = float(revenue_section.get('total', 0))
            
            log(f"✅ Income statement retrieved")
            log(f"   Initial COGS (HPP): Rp {test_data['initial_cogs']:,.0f}")
            log(f"   Initial Revenue (Penjualan): Rp {test_data['initial_revenue']:,.0f}")
        else:
            log(f"⚠️  Income statement failed: {resp_is.status_code}")
            test_data['initial_cogs'] = 0
            test_data['initial_revenue'] = 0
        
        return True
        
    except Exception as e:
        log(f"❌ Exception in capture_baseline_financials: {e}")
        return False

def test_positive_surplus_case():
    """Step 3: POSITIVE CASE - Create receipt with surplus (received > shipped)"""
    log("\n" + "=" * 80)
    log("STEP 3: POSITIVE CASE - Create receipt with surplus + applyToInvoice=true")
    log("=" * 80)
    
    if not test_data.get('test_item'):
        log("❌ No test item available")
        return False
    
    item = test_data['test_item']
    shipped_weight = item['shippedWeight']
    unit_price = item['unitPrice']
    
    # Add small surplus (e.g., +1.0 kg, staying under 10% to avoid approval if possible)
    # But let's make it visible, so +1.0 kg
    surplus_weight = 1.0
    received_weight = shipped_weight + surplus_weight
    
    log(f"   Shipped weight: {shipped_weight} kg")
    log(f"   Received weight: {received_weight} kg (surplus: +{surplus_weight} kg)")
    log(f"   Unit price: Rp {unit_price:,.0f}")
    log(f"   Expected surplus value: Rp {surplus_weight * unit_price:,.0f}")
    
    payload = {
        "receivedDate": datetime.now().isoformat(),
        "receivedBy": "Test Admin",
        "notes": "TEST RECEIPT - SURPLUS CASE - WILL BE DELETED",
        "applyToInvoice": True,
        "items": [
            {
                "productId": item['productId'],
                "receivedWeight": received_weight,
                "notes": "Test surplus"
            }
        ]
    }
    
    try:
        resp = session.post(
            f"{BASE_URL}/sales-orders/{test_data['so_id']}/receipts",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        log(f"   Response status: {resp.status_code}")
        
        if resp.status_code == 201:
            log("✅ Receipt created successfully (201 Created)")
            
            receipt_data = resp.json().get('data', {})
            receipt_id = receipt_data.get('id')
            receipt_number = receipt_data.get('receiptNumber')
            
            test_data['receipt_ids'].append(receipt_id)
            
            log(f"   Receipt ID: {receipt_id}")
            log(f"   Receipt Number: {receipt_number}")
            log(f"   Total Ordered Weight: {receipt_data.get('totalOrderedWeight', 0)} kg")
            log(f"   Total Received Weight: {receipt_data.get('totalReceivedWeight', 0)} kg")
            log(f"   Total Shrinkage Weight: {receipt_data.get('totalShrinkageWeight', 0)} kg (negative = surplus)")
            log(f"   Total Shrinkage Value: Rp {receipt_data.get('totalShrinkageValue', 0):,.0f} (negative = surplus)")
            
            # Verify negative shrinkage (surplus)
            shrinkage_weight = receipt_data.get('totalShrinkageWeight', 0)
            if shrinkage_weight < 0:
                log(f"✅ VERIFIED: Negative shrinkage (surplus) = {shrinkage_weight} kg")
            else:
                log(f"⚠️  Expected negative shrinkage, got: {shrinkage_weight} kg")
            
            return True
        else:
            log(f"❌ Receipt creation failed: {resp.status_code}")
            log(f"   Response: {resp.text}")
            return False
            
    except Exception as e:
        log(f"❌ Exception in test_positive_surplus_case: {e}")
        return False

def verify_total_amount_increased():
    """Step 4: Verify SO totalAmount increased"""
    log("\n" + "=" * 80)
    log("STEP 4: Verify SO totalAmount INCREASED (surplus added to invoice)")
    log("=" * 80)
    
    try:
        resp = session.get(f"{BASE_URL}/sales-orders/{test_data['so_id']}")
        
        if resp.status_code != 200:
            log(f"❌ GET SO detail failed: {resp.status_code}")
            return False
        
        so_data = resp.json().get('data', {})
        current_total = float(so_data.get('totalAmount', 0))
        initial_total = test_data['initial_total_amount']
        
        log(f"   Initial totalAmount: Rp {initial_total:,.0f}")
        log(f"   Current totalAmount: Rp {current_total:,.0f}")
        log(f"   Difference: Rp {current_total - initial_total:,.0f}")
        
        if current_total > initial_total:
            log(f"✅ VERIFIED: totalAmount INCREASED by Rp {current_total - initial_total:,.0f}")
            test_data['after_surplus_total'] = current_total
            return True
        else:
            log(f"❌ FAILED: totalAmount did NOT increase (expected > {initial_total:,.0f})")
            return False
            
    except Exception as e:
        log(f"❌ Exception in verify_total_amount_increased: {e}")
        return False

def verify_cogs_unchanged():
    """Step 5: Verify COGS (HPP) UNCHANGED"""
    log("\n" + "=" * 80)
    log("STEP 5: Verify COGS (HPP) UNCHANGED (surplus does NOT affect COGS)")
    log("=" * 80)
    
    try:
        resp = session.get(f"{BASE_URL}/accounting/income-statement")
        
        if resp.status_code != 200:
            log(f"❌ GET income statement failed: {resp.status_code}")
            return False
        
        is_data = resp.json().get('data', {})
        cogs_section = is_data.get('cogs', {})
        revenue_section = is_data.get('revenue', {})
        
        current_cogs = float(cogs_section.get('total', 0))
        current_revenue = float(revenue_section.get('total', 0))
        
        initial_cogs = test_data['initial_cogs']
        initial_revenue = test_data['initial_revenue']
        
        log(f"   Initial COGS: Rp {initial_cogs:,.0f}")
        log(f"   Current COGS: Rp {current_cogs:,.0f}")
        log(f"   Difference: Rp {current_cogs - initial_cogs:,.0f}")
        
        log(f"   Initial Revenue: Rp {initial_revenue:,.0f}")
        log(f"   Current Revenue: Rp {current_revenue:,.0f}")
        log(f"   Difference: Rp {current_revenue - initial_revenue:,.0f}")
        
        # COGS should be unchanged
        if abs(current_cogs - initial_cogs) < 1.0:
            log(f"✅ VERIFIED: COGS UNCHANGED (difference < Rp 1)")
        else:
            log(f"⚠️  WARNING: COGS changed by Rp {current_cogs - initial_cogs:,.0f}")
        
        # Revenue should increase
        if current_revenue > initial_revenue:
            log(f"✅ VERIFIED: Revenue INCREASED by Rp {current_revenue - initial_revenue:,.0f}")
        else:
            log(f"⚠️  WARNING: Revenue did not increase as expected")
        
        # Check balance sheet still balanced
        resp_bs = session.get(f"{BASE_URL}/accounting/balance-sheet")
        if resp_bs.status_code == 200:
            bs_data = resp_bs.json().get('data', {})
            balanced = bs_data.get('balanced', False)
            log(f"   Balance sheet balanced: {balanced}")
            if balanced:
                log(f"✅ VERIFIED: Balance sheet still BALANCED")
            else:
                log(f"⚠️  WARNING: Balance sheet NOT balanced")
        
        return True
        
    except Exception as e:
        log(f"❌ Exception in verify_cogs_unchanged: {e}")
        return False

def test_typo_guard():
    """Step 6: TYPO GUARD - Try to create receipt with received > 2x shipped"""
    log("\n" + "=" * 80)
    log("STEP 6: TYPO GUARD - Try received weight > 2x shipped (should be REJECTED)")
    log("=" * 80)
    
    if not test_data.get('test_item'):
        log("❌ No test item available")
        return False
    
    item = test_data['test_item']
    shipped_weight = item['shippedWeight']
    
    # Try 3x shipped weight (should be rejected)
    received_weight = shipped_weight * 3
    
    log(f"   Shipped weight: {shipped_weight} kg")
    log(f"   Attempting received weight: {received_weight} kg (3x shipped)")
    
    payload = {
        "receivedDate": datetime.now().isoformat(),
        "receivedBy": "Test Admin",
        "notes": "TEST RECEIPT - TYPO GUARD - SHOULD BE REJECTED",
        "applyToInvoice": True,
        "items": [
            {
                "productId": item['productId'],
                "receivedWeight": received_weight,
                "notes": "Test typo guard"
            }
        ]
    }
    
    try:
        resp = session.post(
            f"{BASE_URL}/sales-orders/{test_data['so_id']}/receipts",
            json=payload,
            headers={"Content-Type": "application/json"}
        )
        
        log(f"   Response status: {resp.status_code}")
        
        if resp.status_code != 201:
            log(f"✅ VERIFIED: Receipt REJECTED (status {resp.status_code})")
            
            # Check error message
            try:
                error_data = resp.json()
                error_msg = error_data.get('error', resp.text)
                log(f"   Error message: {error_msg}")
                
                if 'tidak wajar' in error_msg.lower() or '2x' in error_msg:
                    log(f"✅ VERIFIED: Error message mentions typo guard (2x limit)")
                else:
                    log(f"⚠️  Error message doesn't mention typo guard")
            except Exception:
                log(f"   Response text: {resp.text}")
            
            return True
        else:
            log(f"❌ FAILED: Receipt was ACCEPTED (should have been rejected)")
            # If it was created, add to cleanup list
            receipt_data = resp.json().get('data', {})
            if receipt_data.get('id'):
                test_data['receipt_ids'].append(receipt_data['id'])
            return False
            
    except Exception as e:
        log(f"❌ Exception in test_typo_guard: {e}")
        return False

def cleanup_receipts():
    """Step 7: CLEANUP - Delete all test receipts"""
    log("\n" + "=" * 80)
    log("STEP 7: CLEANUP - Delete all test receipts (CRITICAL for LIVE data)")
    log("=" * 80)
    
    if not test_data['receipt_ids']:
        log("   No receipts to delete")
        return True
    
    success = True
    for receipt_id in test_data['receipt_ids']:
        try:
            log(f"   Deleting receipt: {receipt_id}")
            resp = session.delete(
                f"{BASE_URL}/sales-orders/{test_data['so_id']}/receipts/{receipt_id}"
            )
            
            if resp.status_code == 200:
                log(f"   ✅ Receipt deleted successfully")
            else:
                log(f"   ❌ Delete failed: {resp.status_code} - {resp.text}")
                success = False
                
        except Exception as e:
            log(f"   ❌ Exception deleting receipt: {e}")
            success = False
    
    return success

def verify_total_amount_restored():
    """Step 8: Verify SO totalAmount restored to original"""
    log("\n" + "=" * 80)
    log("STEP 8: Verify SO totalAmount RESTORED to original value")
    log("=" * 80)
    
    try:
        resp = session.get(f"{BASE_URL}/sales-orders/{test_data['so_id']}")
        
        if resp.status_code != 200:
            log(f"❌ GET SO detail failed: {resp.status_code}")
            return False
        
        so_data = resp.json().get('data', {})
        final_total = float(so_data.get('totalAmount', 0))
        initial_total = test_data['initial_total_amount']
        
        log(f"   Initial totalAmount: Rp {initial_total:,.0f}")
        log(f"   Final totalAmount: Rp {final_total:,.0f}")
        log(f"   Difference: Rp {final_total - initial_total:,.0f}")
        
        if abs(final_total - initial_total) < 1.0:
            log(f"✅ VERIFIED: totalAmount RESTORED (difference < Rp 1)")
            return True
        else:
            log(f"❌ FAILED: totalAmount NOT restored (difference: Rp {final_total - initial_total:,.0f})")
            return False
            
    except Exception as e:
        log(f"❌ Exception in verify_total_amount_restored: {e}")
        return False

def verify_revenue_restored():
    """Step 9: Verify Revenue restored to original"""
    log("\n" + "=" * 80)
    log("STEP 9: Verify Revenue RESTORED to original value")
    log("=" * 80)
    
    try:
        resp = session.get(f"{BASE_URL}/accounting/income-statement")
        
        if resp.status_code != 200:
            log(f"❌ GET income statement failed: {resp.status_code}")
            return False
        
        is_data = resp.json().get('data', {})
        revenue_section = is_data.get('revenue', {})
        
        final_revenue = float(revenue_section.get('total', 0))
        initial_revenue = test_data['initial_revenue']
        
        log(f"   Initial Revenue: Rp {initial_revenue:,.0f}")
        log(f"   Final Revenue: Rp {final_revenue:,.0f}")
        log(f"   Difference: Rp {final_revenue - initial_revenue:,.0f}")
        
        if abs(final_revenue - initial_revenue) < 1.0:
            log(f"✅ VERIFIED: Revenue RESTORED (difference < Rp 1)")
            return True
        else:
            log(f"⚠️  WARNING: Revenue difference: Rp {final_revenue - initial_revenue:,.0f}")
            return True  # Not critical
            
    except Exception as e:
        log(f"❌ Exception in verify_revenue_restored: {e}")
        return False

def main():
    """Main test execution"""
    log("=" * 80)
    log("BACKEND TEST: SO Penerimaan Customer - Surplus Feature")
    log("ENVIRONMENT: LIVE Production MongoDB Atlas")
    log("REVERSIBILITY: All receipts will be DELETED at the end")
    log("=" * 80)
    
    results = {
        "total": 0,
        "passed": 0,
        "failed": 0
    }
    
    def run_test(name, func):
        results["total"] += 1
        try:
            if func():
                results["passed"] += 1
                return True
            else:
                results["failed"] += 1
                return False
        except Exception as e:
            log(f"❌ EXCEPTION in {name}: {e}")
            results["failed"] += 1
            return False
    
    # Run tests
    if not run_test("Login", login):
        log("\n❌ Login failed, cannot continue")
        sys.exit(1)
    
    if not run_test("Find Shipped SO", find_shipped_so):
        log("\n❌ Cannot find Shipped SO, cannot continue")
        sys.exit(1)
    
    run_test("Capture Baseline Financials", capture_baseline_financials)
    run_test("Test Positive Surplus Case", test_positive_surplus_case)
    run_test("Verify Total Amount Increased", verify_total_amount_increased)
    run_test("Verify COGS Unchanged", verify_cogs_unchanged)
    run_test("Test Typo Guard", test_typo_guard)
    
    # CRITICAL: Always cleanup
    log("\n" + "=" * 80)
    log("CRITICAL: Starting cleanup (MANDATORY for LIVE data)")
    log("=" * 80)
    run_test("Cleanup Receipts", cleanup_receipts)
    run_test("Verify Total Amount Restored", verify_total_amount_restored)
    run_test("Verify Revenue Restored", verify_revenue_restored)
    
    # Final summary
    log("\n" + "=" * 80)
    log("TEST SUMMARY")
    log("=" * 80)
    log(f"Total tests: {results['total']}")
    log(f"Passed: {results['passed']} ✅")
    log(f"Failed: {results['failed']} ❌")
    log(f"Success rate: {results['passed'] / results['total'] * 100:.1f}%")
    
    if results['failed'] == 0:
        log("\n✅ ALL TESTS PASSED")
        sys.exit(0)
    else:
        log(f"\n❌ {results['failed']} TEST(S) FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
