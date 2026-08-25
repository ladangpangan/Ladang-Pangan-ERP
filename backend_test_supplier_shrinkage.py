#!/usr/bin/env python3
"""
Backend test for GET /api/dashboard/supplier-shrinkage endpoint
Tests the new supplier shrinkage dashboard endpoint that aggregates
Surat Jalan weight vs Tally weight per supplier.
"""

import subprocess
import json
import sys
import tempfile
import os

BASE_URL = "http://localhost:3000/api"

def print_section(title):
    print(f"\n{'='*70}")
    print(f"  {title}")
    print('='*70)

def login(email, password):
    """Login via curl and return cookie file path"""
    try:
        cookie_file = tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.txt')
        cookie_path = cookie_file.name
        cookie_file.close()
        
        cmd = [
            'curl', '-c', cookie_path, '-X', 'POST',
            f'{BASE_URL}/auth/sign-in/email',
            '-H', 'Content-Type: application/json',
            '-d', json.dumps({"email": email, "password": password}),
            '-s'
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        
        if result.returncode == 0:
            try:
                response = json.loads(result.stdout)
                if 'user' in response:
                    print(f"✅ Login successful: {email}")
                    return cookie_path
                else:
                    print(f"❌ Login failed: {result.stdout[:200]}")
                    os.unlink(cookie_path)
                    return None
            except json.JSONDecodeError:
                print(f"❌ Login failed: Invalid JSON response")
                os.unlink(cookie_path)
                return None
        else:
            print(f"❌ Login failed: curl error {result.returncode}")
            os.unlink(cookie_path)
            return None
    except Exception as e:
        print(f"❌ Login error: {e}")
        return None

def test_supplier_shrinkage_authenticated():
    """Test GET /api/dashboard/supplier-shrinkage with admin credentials"""
    print_section("TEST 1: Authenticated Request (Admin)")
    
    # Login as admin
    cookie_path = login("admin@lpi.co.id", "admin123")
    if not cookie_path:
        print("❌ TEST 1 FAILED: Could not login as admin")
        return False
    
    # Make request
    url = f"{BASE_URL}/dashboard/supplier-shrinkage"
    try:
        cmd = ['curl', '-b', cookie_path, url, '-s', '-w', '\n%{http_code}']
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        
        if result.returncode != 0:
            print(f"❌ TEST 1 FAILED: curl error {result.returncode}")
            print(f"Response: {result.stderr[:500]}")
            os.unlink(cookie_path)
            return False
        
        # Split response and status code
        output_lines = result.stdout.strip().split('\n')
        status_code = output_lines[-1]
        response_body = '\n'.join(output_lines[:-1])
        
        print(f"\nStatus Code: {status_code}")
        
        if status_code != '200':
            print(f"❌ TEST 1 FAILED: Expected 200, got {status_code}")
            print(f"Response: {response_body[:500]}")
            os.unlink(cookie_path)
            return False
        
        # Parse JSON
        try:
            data = json.loads(response_body)
        except Exception as e:
            print(f"❌ TEST 1 FAILED: Invalid JSON response: {e}")
            print(f"Response: {response_body[:500]}")
            os.unlink(cookie_path)
            return False
        
        # Verify structure
        if 'data' not in data or 'totals' not in data:
            print(f"❌ TEST 1 FAILED: Missing 'data' or 'totals' in response")
            print(f"Response keys: {data.keys()}")
            os.unlink(cookie_path)
            return False
        
        print(f"✅ Response has correct structure: data, totals")
        
        # Verify data is an array
        if not isinstance(data['data'], list):
            print(f"❌ TEST 1 FAILED: 'data' is not an array")
            os.unlink(cookie_path)
            return False
        
        print(f"✅ 'data' is an array with {len(data['data'])} suppliers")
        
        # Verify totals structure
        totals = data['totals']
        required_totals_fields = ['sjWeight', 'tallyWeight', 'susut', 'susutPct']
        for field in required_totals_fields:
            if field not in totals:
                print(f"❌ TEST 1 FAILED: Missing '{field}' in totals")
                os.unlink(cookie_path)
                return False
        
        print(f"✅ Totals has all required fields: {required_totals_fields}")
        print(f"   sjWeight: {totals['sjWeight']}")
        print(f"   tallyWeight: {totals['tallyWeight']}")
        print(f"   susut: {totals['susut']}")
        print(f"   susutPct: {totals['susutPct']}")
        
        # Find CV. Ratu Indonesia in the data
        cv_ratu = None
        for row in data['data']:
            if 'CV. Ratu Indonesia' in row.get('supplierName', ''):
                cv_ratu = row
                break
        
        if not cv_ratu:
            print(f"\n⚠️  WARNING: CV. Ratu Indonesia not found in data")
            print(f"Available suppliers: {[r.get('supplierName') for r in data['data']]}")
        else:
            print(f"\n✅ Found CV. Ratu Indonesia in data")
            
            # Verify row structure
            required_fields = ['supplierId', 'supplierName', 'supplierCode', 'poCount', 
                             'sjWeight', 'tallyWeight', 'tallyDone', 'susut', 'susutPct']
            
            for field in required_fields:
                if field not in cv_ratu:
                    print(f"❌ TEST 1 FAILED: Missing '{field}' in data row")
                    os.unlink(cookie_path)
                    return False
            
            print(f"✅ Data row has all required fields: {required_fields}")
            
            # Verify CV. Ratu Indonesia values
            print(f"\n=== CV. Ratu Indonesia Values ===")
            print(f"   supplierId: {cv_ratu['supplierId']}")
            print(f"   supplierName: {cv_ratu['supplierName']}")
            print(f"   supplierCode: {cv_ratu['supplierCode']}")
            print(f"   poCount: {cv_ratu['poCount']} (number: {isinstance(cv_ratu['poCount'], (int, float))})")
            print(f"   sjWeight: {cv_ratu['sjWeight']} (number: {isinstance(cv_ratu['sjWeight'], (int, float))})")
            print(f"   tallyWeight: {cv_ratu['tallyWeight']} (number: {isinstance(cv_ratu['tallyWeight'], (int, float))})")
            print(f"   tallyDone: {cv_ratu['tallyDone']} (bool: {isinstance(cv_ratu['tallyDone'], bool)})")
            print(f"   susut: {cv_ratu['susut']} (number: {isinstance(cv_ratu['susut'], (int, float))})")
            print(f"   susutPct: {cv_ratu['susutPct']} (null or number: {cv_ratu['susutPct'] is None or isinstance(cv_ratu['susutPct'], (int, float))})")
            
            # Verify expected values for PO/202608/0013
            # received_weight=2483, tally_weight=0, so:
            # - sjWeight should be >= 2483
            # - tallyDone should be False (tallyWeight = 0)
            # - susut should be 0 (only calculated when tallyDone)
            # - susutPct should be null (only calculated when tallyDone)
            
            if cv_ratu['sjWeight'] < 2483:
                print(f"❌ TEST 1 FAILED: sjWeight ({cv_ratu['sjWeight']}) should be >= 2483")
                os.unlink(cookie_path)
                return False
            
            print(f"✅ sjWeight >= 2483 (includes PO/202608/0013)")
            
            # Check if tally is done
            if cv_ratu['tallyWeight'] == 0:
                # No tally done
                if cv_ratu['tallyDone'] != False:
                    print(f"❌ TEST 1 FAILED: tallyDone should be False when tallyWeight=0")
                    os.unlink(cookie_path)
                    return False
                
                if cv_ratu['susut'] != 0:
                    print(f"❌ TEST 1 FAILED: susut should be 0 when tallyDone=False")
                    os.unlink(cookie_path)
                    return False
                
                if cv_ratu['susutPct'] is not None:
                    print(f"❌ TEST 1 FAILED: susutPct should be null when tallyDone=False")
                    os.unlink(cookie_path)
                    return False
                
                print(f"✅ tallyDone=False, susut=0, susutPct=null (no tally done yet)")
            else:
                # Tally done
                if cv_ratu['tallyDone'] != True:
                    print(f"❌ TEST 1 FAILED: tallyDone should be True when tallyWeight>0")
                    os.unlink(cookie_path)
                    return False
                
                expected_susut = cv_ratu['sjWeight'] - cv_ratu['tallyWeight']
                if abs(cv_ratu['susut'] - expected_susut) > 0.01:
                    print(f"❌ TEST 1 FAILED: susut ({cv_ratu['susut']}) != sjWeight - tallyWeight ({expected_susut})")
                    os.unlink(cookie_path)
                    return False
                
                if cv_ratu['susutPct'] is None:
                    print(f"❌ TEST 1 FAILED: susutPct should not be null when tallyDone=True")
                    os.unlink(cookie_path)
                    return False
                
                expected_pct = round((cv_ratu['susut'] / cv_ratu['sjWeight']) * 1000) / 10
                if abs(cv_ratu['susutPct'] - expected_pct) > 0.1:
                    print(f"❌ TEST 1 FAILED: susutPct ({cv_ratu['susutPct']}) != expected ({expected_pct})")
                    os.unlink(cookie_path)
                    return False
                
                print(f"✅ tallyDone=True, susut={cv_ratu['susut']}, susutPct={cv_ratu['susutPct']}% (tally completed)")
        
        # Verify at least one row if data is not empty
        if len(data['data']) > 0:
            sample_row = data['data'][0]
            print(f"\n=== Sample Row (First Supplier) ===")
            print(json.dumps(sample_row, indent=2))
        
        print(f"\n✅ TEST 1 PASSED: Authenticated request successful")
        os.unlink(cookie_path)
        return True
        
    except Exception as e:
        print(f"❌ TEST 1 FAILED: Request error: {e}")
        import traceback
        traceback.print_exc()
        if cookie_path and os.path.exists(cookie_path):
            os.unlink(cookie_path)
        return False

def test_supplier_shrinkage_no_auth():
    """Test GET /api/dashboard/supplier-shrinkage without authentication"""
    print_section("TEST 2: Unauthenticated Request (No Auth)")
    
    url = f"{BASE_URL}/dashboard/supplier-shrinkage"
    try:
        cmd = ['curl', url, '-s', '-w', '\n%{http_code}']
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        
        if result.returncode != 0:
            print(f"❌ TEST 2 FAILED: curl error {result.returncode}")
            return False
        
        # Split response and status code
        output_lines = result.stdout.strip().split('\n')
        status_code = output_lines[-1]
        
        print(f"Status Code: {status_code}")
        
        if status_code != '401':
            print(f"❌ TEST 2 FAILED: Expected 401, got {status_code}")
            response_body = '\n'.join(output_lines[:-1])
            print(f"Response: {response_body[:500]}")
            return False
        
        print(f"✅ TEST 2 PASSED: Unauthenticated request returns 401")
        return True
        
    except Exception as e:
        print(f"❌ TEST 2 FAILED: Request error: {e}")
        return False

def test_supplier_shrinkage_operator():
    """Test GET /api/dashboard/supplier-shrinkage with operator credentials (should be 403)"""
    print_section("TEST 3: Operator Request (Should be 403)")
    
    # Login as operator
    cookie_path = login("operator@lpi.co.id", "operator123")
    if not cookie_path:
        print("❌ TEST 3 FAILED: Could not login as operator")
        return False
    
    # Make request
    url = f"{BASE_URL}/dashboard/supplier-shrinkage"
    try:
        cmd = ['curl', '-b', cookie_path, url, '-s', '-w', '\n%{http_code}']
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        
        if result.returncode != 0:
            print(f"❌ TEST 3 FAILED: curl error {result.returncode}")
            os.unlink(cookie_path)
            return False
        
        # Split response and status code
        output_lines = result.stdout.strip().split('\n')
        status_code = output_lines[-1]
        
        print(f"Status Code: {status_code}")
        
        if status_code != '403':
            print(f"❌ TEST 3 FAILED: Expected 403, got {status_code}")
            response_body = '\n'.join(output_lines[:-1])
            print(f"Response: {response_body[:500]}")
            os.unlink(cookie_path)
            return False
        
        print(f"✅ TEST 3 PASSED: Operator request returns 403 (Forbidden)")
        os.unlink(cookie_path)
        return True
        
    except Exception as e:
        print(f"❌ TEST 3 FAILED: Request error: {e}")
        if cookie_path and os.path.exists(cookie_path):
            os.unlink(cookie_path)
        return False

def main():
    print("\n" + "="*70)
    print("  BACKEND TEST: GET /api/dashboard/supplier-shrinkage")
    print("="*70)
    print("\nThis test verifies the new supplier shrinkage dashboard endpoint")
    print("that aggregates Surat Jalan weight vs Tally weight per supplier.")
    print("\nExpected behavior:")
    print("- Returns 200 with JSON shape { data: [...], totals: {...} }")
    print("- Each data row has: supplierId, supplierName, supplierCode, poCount,")
    print("  sjWeight, tallyWeight, tallyDone, susut, susutPct")
    print("- Totals has: sjWeight, tallyWeight, susut, susutPct")
    print("- Access control: 401 without auth, 403 for operator role")
    
    results = []
    
    # Run tests
    results.append(("Authenticated Request (Admin)", test_supplier_shrinkage_authenticated()))
    results.append(("Unauthenticated Request", test_supplier_shrinkage_no_auth()))
    results.append(("Operator Request (403)", test_supplier_shrinkage_operator()))
    
    # Summary
    print_section("TEST SUMMARY")
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{status}: {test_name}")
    
    print(f"\n{'='*70}")
    print(f"  TOTAL: {passed}/{total} tests passed ({passed*100//total}%)")
    print('='*70)
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())
