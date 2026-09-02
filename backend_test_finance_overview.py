#!/usr/bin/env python3
"""
Backend test for GET /api/finance/overview endpoint (Finance/Komisi & Cashback dashboard, Fase 1 read-only)
Tests:
1. Login as admin -> GET /api/finance/overview -> 200, verify response structure (4 arrays)
2. Verify invoiceSO rows have correct fields and calculations (outstanding, status)
3. Verify invoicePO rows have correct fields and calculations
4. Verify komisi rows have correct fields and status values
5. Verify cashback rows have correct fields, status values, and amount>0
6. Login as akuntan -> GET /api/finance/overview -> 200 (allowed)
7. Login as operator -> GET /api/finance/overview -> 403 Forbidden
"""

import requests
import sys
from typing import Dict, Any

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"

def login(email: str, password: str) -> Dict[str, Any]:
    """Login and return session cookie"""
    url = f"{BASE_URL}/auth/sign-in/email"
    response = requests.post(url, json={"email": email, "password": password})
    if response.status_code != 200:
        raise Exception(f"Login failed: {response.status_code} {response.text}")
    
    # Extract session cookie
    cookies = response.cookies
    session_cookie = None
    for cookie in cookies:
        if 'better-auth.session_token' in cookie.name:
            session_cookie = {cookie.name: cookie.value}
            break
    
    if not session_cookie:
        raise Exception("No session cookie found in login response")
    
    return session_cookie

def test_finance_overview():
    """Main test function"""
    print("=" * 80)
    print("BACKEND TEST: GET /api/finance/overview (Finance/Komisi & Cashback)")
    print("=" * 80)
    
    all_passed = True
    
    # ========== TEST 1: Login as admin ==========
    print("\n[TEST 1] Login as admin@lpi.co.id")
    try:
        admin_cookies = login("admin@lpi.co.id", "admin123")
        print("✅ TEST 1 PASSED: Admin login successful")
    except Exception as e:
        print(f"❌ TEST 1 FAILED: {e}")
        all_passed = False
        return all_passed
    
    # ========== TEST 2: GET /api/finance/overview as admin ==========
    print("\n[TEST 2] GET /api/finance/overview as admin -> expect 200 with 4 arrays")
    try:
        url = f"{BASE_URL}/finance/overview"
        response = requests.get(url, cookies=admin_cookies)
        
        if response.status_code != 200:
            print(f"❌ TEST 2 FAILED: Expected 200, got {response.status_code}")
            print(f"Response: {response.text}")
            all_passed = False
        else:
            data = response.json()
            
            # Verify response structure
            if 'data' not in data:
                print("❌ TEST 2 FAILED: Response missing 'data' field")
                all_passed = False
            else:
                response_data = data['data']
                
                # Check for 4 required arrays
                required_arrays = ['invoiceSO', 'invoicePO', 'komisi', 'cashback']
                missing = [arr for arr in required_arrays if arr not in response_data]
                
                if missing:
                    print(f"❌ TEST 2 FAILED: Missing arrays: {missing}")
                    all_passed = False
                else:
                    # Verify all are arrays
                    non_arrays = [arr for arr in required_arrays if not isinstance(response_data[arr], list)]
                    if non_arrays:
                        print(f"❌ TEST 2 FAILED: Not arrays: {non_arrays}")
                        all_passed = False
                    else:
                        print(f"✅ TEST 2 PASSED: Response has all 4 arrays")
                        print(f"   - invoiceSO: {len(response_data['invoiceSO'])} rows")
                        print(f"   - invoicePO: {len(response_data['invoicePO'])} rows")
                        print(f"   - komisi: {len(response_data['komisi'])} rows")
                        print(f"   - cashback: {len(response_data['cashback'])} rows")
                        
                        # Store for subsequent tests
                        finance_data = response_data
    except Exception as e:
        print(f"❌ TEST 2 FAILED: Exception: {e}")
        all_passed = False
        return all_passed
    
    # ========== TEST 3: Verify invoiceSO structure and calculations ==========
    print("\n[TEST 3] Verify invoiceSO rows structure and calculations")
    try:
        invoice_so = finance_data['invoiceSO']
        
        if len(invoice_so) == 0:
            print("⚠️  TEST 3 SKIPPED: No invoiceSO rows to verify")
        else:
            required_fields = ['id', 'number', 'soNumber', 'party', 'total', 'paid', 'outstanding', 'status']
            errors = []
            
            for i, row in enumerate(invoice_so[:5]):  # Check first 5 rows
                # Check required fields
                missing_fields = [f for f in required_fields if f not in row]
                if missing_fields:
                    errors.append(f"Row {i}: missing fields {missing_fields}")
                    continue
                
                # Verify outstanding calculation: outstanding == round(total - paid)
                expected_outstanding = round(row['total'] - row['paid'])
                if row['outstanding'] != expected_outstanding:
                    errors.append(f"Row {i} (SO {row['soNumber']}): outstanding={row['outstanding']}, expected={expected_outstanding} (total={row['total']}, paid={row['paid']})")
                
                # Verify status logic: 'Lunas' when outstanding<=0, else 'Belum Lunas'
                expected_status = 'Lunas' if row['outstanding'] <= 0 else 'Belum Lunas'
                if row['status'] != expected_status:
                    errors.append(f"Row {i} (SO {row['soNumber']}): status='{row['status']}', expected='{expected_status}' (outstanding={row['outstanding']})")
            
            if errors:
                print(f"❌ TEST 3 FAILED: {len(errors)} errors found:")
                for err in errors[:10]:  # Show first 10 errors
                    print(f"   - {err}")
                all_passed = False
            else:
                print(f"✅ TEST 3 PASSED: All invoiceSO rows have correct structure and calculations")
                # Show sample
                if len(invoice_so) > 0:
                    sample = invoice_so[0]
                    print(f"   Sample: SO {sample['soNumber']}, party={sample['party']}, total={sample['total']}, paid={sample['paid']}, outstanding={sample['outstanding']}, status={sample['status']}")
    except Exception as e:
        print(f"❌ TEST 3 FAILED: Exception: {e}")
        all_passed = False
    
    # ========== TEST 4: Verify invoicePO structure and calculations ==========
    print("\n[TEST 4] Verify invoicePO rows structure and calculations")
    try:
        invoice_po = finance_data['invoicePO']
        
        if len(invoice_po) == 0:
            print("⚠️  TEST 4 SKIPPED: No invoicePO rows to verify")
        else:
            required_fields = ['id', 'number', 'poNumber', 'party', 'total', 'paid', 'outstanding', 'status']
            errors = []
            
            for i, row in enumerate(invoice_po[:5]):  # Check first 5 rows
                # Check required fields
                missing_fields = [f for f in required_fields if f not in row]
                if missing_fields:
                    errors.append(f"Row {i}: missing fields {missing_fields}")
                    continue
                
                # Verify outstanding calculation: outstanding == round(total - paid)
                expected_outstanding = round(row['total'] - row['paid'])
                if row['outstanding'] != expected_outstanding:
                    errors.append(f"Row {i} (PO {row['poNumber']}): outstanding={row['outstanding']}, expected={expected_outstanding} (total={row['total']}, paid={row['paid']})")
                
                # Verify status logic: 'Lunas' when outstanding<=0, else 'Belum Lunas'
                expected_status = 'Lunas' if row['outstanding'] <= 0 else 'Belum Lunas'
                if row['status'] != expected_status:
                    errors.append(f"Row {i} (PO {row['poNumber']}): status='{row['status']}', expected='{expected_status}' (outstanding={row['outstanding']})")
            
            if errors:
                print(f"❌ TEST 4 FAILED: {len(errors)} errors found:")
                for err in errors[:10]:  # Show first 10 errors
                    print(f"   - {err}")
                all_passed = False
            else:
                print(f"✅ TEST 4 PASSED: All invoicePO rows have correct structure and calculations")
                # Show sample
                if len(invoice_po) > 0:
                    sample = invoice_po[0]
                    print(f"   Sample: PO {sample['poNumber']}, party={sample['party']}, total={sample['total']}, paid={sample['paid']}, outstanding={sample['outstanding']}, status={sample['status']}")
    except Exception as e:
        print(f"❌ TEST 4 FAILED: Exception: {e}")
        all_passed = False
    
    # ========== TEST 5: Verify komisi structure and status values ==========
    print("\n[TEST 5] Verify komisi rows structure and status values")
    try:
        komisi = finance_data['komisi']
        
        if len(komisi) == 0:
            print("⚠️  TEST 5 SKIPPED: No komisi rows to verify")
        else:
            required_fields = ['id', 'soNumber', 'party', 'amount', 'status']
            valid_statuses = {'Lunas', 'Belum Lunas'}
            errors = []
            
            for i, row in enumerate(komisi[:10]):  # Check first 10 rows
                # Check required fields
                missing_fields = [f for f in required_fields if f not in row]
                if missing_fields:
                    errors.append(f"Row {i}: missing fields {missing_fields}")
                    continue
                
                # Verify status is valid
                if row['status'] not in valid_statuses:
                    errors.append(f"Row {i} (SO {row['soNumber']}): invalid status '{row['status']}', expected one of {valid_statuses}")
                
                # Verify amount is a number
                if not isinstance(row['amount'], (int, float)):
                    errors.append(f"Row {i} (SO {row['soNumber']}): amount is not a number: {type(row['amount'])}")
            
            if errors:
                print(f"❌ TEST 5 FAILED: {len(errors)} errors found:")
                for err in errors[:10]:  # Show first 10 errors
                    print(f"   - {err}")
                all_passed = False
            else:
                print(f"✅ TEST 5 PASSED: All komisi rows have correct structure and valid status")
                # Show sample
                if len(komisi) > 0:
                    sample = komisi[0]
                    print(f"   Sample: SO {sample['soNumber']}, party={sample['party']}, amount={sample['amount']}, status={sample['status']}")
    except Exception as e:
        print(f"❌ TEST 5 FAILED: Exception: {e}")
        all_passed = False
    
    # ========== TEST 6: Verify cashback structure, status values, and amount>0 ==========
    print("\n[TEST 6] Verify cashback rows structure, status values, and amount>0")
    try:
        cashback = finance_data['cashback']
        
        if len(cashback) == 0:
            print("⚠️  TEST 6 SKIPPED: No cashback rows to verify")
        else:
            required_fields = ['id', 'soNumber', 'party', 'amount', 'status']
            valid_statuses = {'Dikembalikan', 'Belum Dikembalikan'}
            errors = []
            
            for i, row in enumerate(cashback[:10]):  # Check first 10 rows
                # Check required fields
                missing_fields = [f for f in required_fields if f not in row]
                if missing_fields:
                    errors.append(f"Row {i}: missing fields {missing_fields}")
                    continue
                
                # Verify status is valid
                if row['status'] not in valid_statuses:
                    errors.append(f"Row {i} (SO {row['soNumber']}): invalid status '{row['status']}', expected one of {valid_statuses}")
                
                # Verify amount > 0 (cashback should only include rows with cashbackAmount>0)
                if not isinstance(row['amount'], (int, float)) or row['amount'] <= 0:
                    errors.append(f"Row {i} (SO {row['soNumber']}): amount should be >0, got {row['amount']}")
            
            if errors:
                print(f"❌ TEST 6 FAILED: {len(errors)} errors found:")
                for err in errors[:10]:  # Show first 10 errors
                    print(f"   - {err}")
                all_passed = False
            else:
                print(f"✅ TEST 6 PASSED: All cashback rows have correct structure, valid status, and amount>0")
                # Show sample
                if len(cashback) > 0:
                    sample = cashback[0]
                    print(f"   Sample: SO {sample['soNumber']}, party={sample['party']}, amount={sample['amount']}, status={sample['status']}")
    except Exception as e:
        print(f"❌ TEST 6 FAILED: Exception: {e}")
        all_passed = False
    
    # ========== TEST 7: Login as akuntan -> GET /api/finance/overview -> 200 (allowed) ==========
    print("\n[TEST 7] Login as akuntan -> GET /api/finance/overview -> expect 200 (allowed)")
    try:
        akuntan_cookies = login("akuntan@lpi.co.id", "akuntanlpi123")
        print("   - Akuntan login successful")
        
        url = f"{BASE_URL}/finance/overview"
        response = requests.get(url, cookies=akuntan_cookies)
        
        if response.status_code != 200:
            print(f"❌ TEST 7 FAILED: Expected 200, got {response.status_code}")
            print(f"Response: {response.text}")
            all_passed = False
        else:
            data = response.json()
            if 'data' not in data or not all(k in data['data'] for k in ['invoiceSO', 'invoicePO', 'komisi', 'cashback']):
                print(f"❌ TEST 7 FAILED: Response missing required data structure")
                all_passed = False
            else:
                print(f"✅ TEST 7 PASSED: Akuntan can access /api/finance/overview (200 OK)")
    except Exception as e:
        print(f"❌ TEST 7 FAILED: Exception: {e}")
        all_passed = False
    
    # ========== TEST 8: Login as operator -> GET /api/finance/overview -> 403 Forbidden ==========
    print("\n[TEST 8] Login as operator -> GET /api/finance/overview -> expect 403 Forbidden")
    try:
        operator_cookies = login("operator@lpi.co.id", "operator123")
        print("   - Operator login successful")
        
        url = f"{BASE_URL}/finance/overview"
        response = requests.get(url, cookies=operator_cookies)
        
        if response.status_code != 403:
            print(f"❌ TEST 8 FAILED: Expected 403, got {response.status_code}")
            print(f"Response: {response.text}")
            all_passed = False
        else:
            print(f"✅ TEST 8 PASSED: Operator correctly denied access (403 Forbidden)")
    except Exception as e:
        print(f"❌ TEST 8 FAILED: Exception: {e}")
        all_passed = False
    
    # ========== SUMMARY ==========
    print("\n" + "=" * 80)
    if all_passed:
        print("✅ ALL TESTS PASSED (8/8)")
    else:
        print("❌ SOME TESTS FAILED")
    print("=" * 80)
    
    return all_passed

if __name__ == "__main__":
    try:
        success = test_finance_overview()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
