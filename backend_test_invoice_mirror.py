#!/usr/bin/env python3
"""
Backend test for Invoice numbering "mirror SO" feature.

Tests:
1. Login admin and verify all invoiced SOs have invoiceNumber == soNumber with 'SO/' -> 'INV/'
2. Test auto re-mirror on SO-number edit (change SO number, verify invoice number auto-updates)
3. Verify finance/overview invoiceSO rows have matching invoice numbers
"""

import requests
import sys
from typing import Dict, Any

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

session = requests.Session()

def login(email: str, password: str) -> bool:
    """Login and capture session cookie."""
    try:
        print(f"\n{'='*80}")
        print("TEST 1 — Login as admin")
        print(f"{'='*80}")
        
        resp = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": email, "password": password},
            timeout=30
        )
        
        if resp.status_code == 200:
            print(f"✅ Login successful: {email}")
            print(f"   Session cookies: {list(session.cookies.keys())}")
            return True
        else:
            print(f"❌ Login failed: {resp.status_code}")
            print(f"   Response: {resp.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ Login exception: {e}")
        return False

def test_all_invoiced_sos_mirror():
    """Test 1: Verify all invoiced SOs have invoiceNumber mirroring soNumber."""
    try:
        print(f"\n{'='*80}")
        print("TEST 2 — Verify all invoiced SOs have mirrored invoice numbers")
        print(f"{'='*80}")
        
        resp = session.get(f"{BASE_URL}/sales-orders", timeout=30)
        
        if resp.status_code != 200:
            print(f"❌ GET /sales-orders failed: {resp.status_code}")
            return False
        
        data = resp.json()
        sos = data.get('data', [])
        print(f"✅ GET /sales-orders → 200 OK")
        print(f"   Total SOs: {len(sos)}")
        
        # Find all SOs with invoiceNumber
        invoiced_sos = [so for so in sos if so.get('invoiceNumber')]
        print(f"   Invoiced SOs (with invoiceNumber): {len(invoiced_sos)}")
        
        if len(invoiced_sos) == 0:
            print("⚠️  No invoiced SOs found to test")
            return True
        
        # Check each invoiced SO
        mismatches = []
        for so in invoiced_sos:
            so_number = so.get('soNumber', '')
            invoice_number = so.get('invoiceNumber', '')
            expected_invoice = so_number.replace('SO/', 'INV/')
            
            if invoice_number != expected_invoice:
                mismatches.append({
                    'id': so.get('id'),
                    'soNumber': so_number,
                    'invoiceNumber': invoice_number,
                    'expected': expected_invoice
                })
        
        if mismatches:
            print(f"\n❌ MISMATCHES FOUND: {len(mismatches)} SOs have incorrect invoice numbers")
            for m in mismatches[:5]:  # Show first 5
                print(f"   SO: {m['soNumber']} → Invoice: {m['invoiceNumber']} (expected: {m['expected']})")
            return False
        else:
            print(f"\n✅ ALL {len(invoiced_sos)} invoiced SOs have correct mirrored invoice numbers")
            # Show a few examples
            for so in invoiced_sos[:3]:
                print(f"   ✓ SO: {so['soNumber']} → Invoice: {so['invoiceNumber']}")
            return True
            
    except Exception as e:
        print(f"❌ Test exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_auto_remirror_on_so_edit():
    """Test 2: Test auto re-mirror when SO number is edited."""
    try:
        print(f"\n{'='*80}")
        print("TEST 3 — Auto re-mirror on SO-number edit")
        print(f"{'='*80}")
        
        # Step 1: Find an invoiced SO
        resp = session.get(f"{BASE_URL}/sales-orders", timeout=30)
        if resp.status_code != 200:
            print(f"❌ GET /sales-orders failed: {resp.status_code}")
            return False
        
        sos = resp.json().get('data', [])
        invoiced_sos = [so for so in sos if so.get('invoiceNumber') and so.get('pipelineStatus') in ['Invoiced', 'Selesai']]
        
        if not invoiced_sos:
            print("⚠️  No invoiced SOs found to test")
            return True
        
        test_so = invoiced_sos[0]
        so_id = test_so['id']
        original_so_number = test_so['soNumber']
        original_invoice_number = test_so['invoiceNumber']
        
        print(f"\n[Step 1] Selected test SO:")
        print(f"   ID: {so_id}")
        print(f"   Original SO Number: {original_so_number}")
        print(f"   Original Invoice Number: {original_invoice_number}")
        
        # Step 2a: Change SO number to test value
        test_so_number = "SO/209912/9999"
        expected_invoice = "INV/209912/9999"
        
        print(f"\n[Step 2a] Change SO number to: {test_so_number}")
        resp = session.post(
            f"{BASE_URL}/sales-orders/{so_id}/so-number",
            json={"soNumber": test_so_number},
            timeout=30
        )
        
        if resp.status_code != 200:
            print(f"❌ POST /sales-orders/:id/so-number failed: {resp.status_code}")
            print(f"   Response: {resp.text[:500]}")
            return False
        
        print(f"✅ POST /sales-orders/:id/so-number → 200 OK")
        
        # Step 2b: Verify the change
        print(f"\n[Step 2b] Verify SO number and invoice number changed")
        resp = session.get(f"{BASE_URL}/sales-orders/{so_id}", timeout=30)
        
        if resp.status_code != 200:
            print(f"❌ GET /sales-orders/:id failed: {resp.status_code}")
            return False
        
        updated_so = resp.json().get('data', {})
        new_so_number = updated_so.get('soNumber')
        new_invoice_number = updated_so.get('invoiceNumber')
        
        print(f"   New SO Number: {new_so_number}")
        print(f"   New Invoice Number: {new_invoice_number}")
        print(f"   Expected Invoice: {expected_invoice}")
        
        if new_so_number != test_so_number:
            print(f"❌ SO number not updated correctly")
            return False
        
        if new_invoice_number != expected_invoice:
            print(f"❌ Invoice number NOT auto-mirrored (expected: {expected_invoice}, got: {new_invoice_number})")
            # Try to revert before returning
            session.post(f"{BASE_URL}/sales-orders/{so_id}/so-number", json={"soNumber": original_so_number}, timeout=30)
            return False
        
        print(f"✅ Invoice number auto-mirrored correctly: {new_invoice_number}")
        
        # Step 2c: Revert to original
        print(f"\n[Step 2c] Revert to original SO number: {original_so_number}")
        resp = session.post(
            f"{BASE_URL}/sales-orders/{so_id}/so-number",
            json={"soNumber": original_so_number},
            timeout=30
        )
        
        if resp.status_code != 200:
            print(f"❌ Revert failed: {resp.status_code}")
            print(f"   Response: {resp.text[:500]}")
            return False
        
        print(f"✅ Revert POST → 200 OK")
        
        # Step 2d: Verify revert
        print(f"\n[Step 2d] Verify revert")
        resp = session.get(f"{BASE_URL}/sales-orders/{so_id}", timeout=30)
        
        if resp.status_code != 200:
            print(f"❌ GET after revert failed: {resp.status_code}")
            return False
        
        reverted_so = resp.json().get('data', {})
        reverted_so_number = reverted_so.get('soNumber')
        reverted_invoice_number = reverted_so.get('invoiceNumber')
        
        print(f"   Reverted SO Number: {reverted_so_number}")
        print(f"   Reverted Invoice Number: {reverted_invoice_number}")
        
        if reverted_so_number != original_so_number:
            print(f"❌ SO number not reverted correctly")
            return False
        
        if reverted_invoice_number != original_invoice_number:
            print(f"❌ Invoice number not reverted correctly (expected: {original_invoice_number}, got: {reverted_invoice_number})")
            return False
        
        print(f"✅ Both SO and Invoice numbers reverted correctly")
        
        return True
        
    except Exception as e:
        print(f"❌ Test exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_finance_overview_mirror():
    """Test 3: Verify finance/overview invoiceSO rows have mirrored invoice numbers."""
    try:
        print(f"\n{'='*80}")
        print("TEST 4 — Verify finance/overview invoiceSO rows")
        print(f"{'='*80}")
        
        resp = session.get(f"{BASE_URL}/finance/overview", timeout=30)
        
        if resp.status_code != 200:
            print(f"❌ GET /finance/overview failed: {resp.status_code}")
            print(f"   Response: {resp.text[:500]}")
            return False
        
        data = resp.json().get('data', {})
        invoice_sos = data.get('invoiceSO', [])
        
        print(f"✅ GET /finance/overview → 200 OK")
        print(f"   invoiceSO rows: {len(invoice_sos)}")
        
        if len(invoice_sos) == 0:
            print("⚠️  No invoiceSO rows found to test")
            return True
        
        # Check each row
        mismatches = []
        for row in invoice_sos:
            invoice_number = row.get('number', '')
            so_number = row.get('soNumber', '')
            expected_invoice = so_number.replace('SO/', 'INV/')
            
            if invoice_number != expected_invoice:
                mismatches.append({
                    'id': row.get('id'),
                    'soNumber': so_number,
                    'invoiceNumber': invoice_number,
                    'expected': expected_invoice
                })
        
        if mismatches:
            print(f"\n❌ MISMATCHES FOUND: {len(mismatches)} invoiceSO rows have incorrect invoice numbers")
            for m in mismatches[:5]:  # Show first 5
                print(f"   SO: {m['soNumber']} → Invoice: {m['invoiceNumber']} (expected: {m['expected']})")
            return False
        else:
            print(f"\n✅ ALL {len(invoice_sos)} invoiceSO rows have correct mirrored invoice numbers")
            # Show a few examples
            for row in invoice_sos[:3]:
                print(f"   ✓ SO: {row['soNumber']} → Invoice: {row['number']}")
            return True
            
    except Exception as e:
        print(f"❌ Test exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Run all tests."""
    print("\n" + "="*80)
    print("BACKEND TEST: Invoice numbering 'mirror SO' feature")
    print("="*80)
    
    # Login
    if not login(ADMIN_EMAIL, ADMIN_PASSWORD):
        print("\n❌ LOGIN FAILED - Cannot proceed with tests")
        sys.exit(1)
    
    # Run tests
    results = []
    
    # Test 1: All invoiced SOs have mirrored invoice numbers
    results.append(("All invoiced SOs mirror correctly", test_all_invoiced_sos_mirror()))
    
    # Test 2: Auto re-mirror on SO-number edit
    results.append(("Auto re-mirror on SO edit", test_auto_remirror_on_so_edit()))
    
    # Test 3: Finance overview invoiceSO rows
    results.append(("Finance overview invoiceSO mirror", test_finance_overview_mirror()))
    
    # Summary
    print(f"\n{'='*80}")
    print("TEST SUMMARY")
    print(f"{'='*80}")
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{status}: {test_name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n✅ ALL TESTS PASSED")
        sys.exit(0)
    else:
        print(f"\n❌ {total - passed} TEST(S) FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
