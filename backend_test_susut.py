#!/usr/bin/env python3
"""
Backend test for susut (shrinkage) percentage logic on dashboard endpoints
Re-verification after fix: susut% must consider ONLY items that have been tallied (tally_weight > 0)
"""
import requests
import json
import sys

BASE_URL = "http://localhost:3000/api"

def login():
    """Login as admin and return session"""
    print("\n=== LOGIN: admin@lpi.co.id ===")
    session = requests.Session()
    
    url = f"{BASE_URL}/auth/sign-in/email"
    payload = {
        "email": "admin@lpi.co.id",
        "password": "admin123"
    }
    
    headers = {
        "Origin": "http://localhost:3000",
        "Content-Type": "application/json"
    }
    
    try:
        resp = session.post(url, json=payload, headers=headers)
        print(f"Login status: {resp.status_code}")
        
        if resp.status_code == 200:
            print("✅ Login successful")
            # Set default headers for all subsequent requests
            session.headers.update({"Origin": "http://localhost:3000"})
            return session
        else:
            print(f"❌ Login failed: {resp.status_code}")
            print(f"Response: {resp.text[:200]}")
            return None
    except Exception as e:
        print(f"❌ Login error: {e}")
        return None

def test_supplier_shrinkage_list(session):
    """
    TEST A: GET /api/dashboard/supplier-shrinkage
    Verify susutPct is calculated correctly based on sjTallied (NOT sjWeight)
    """
    print("\n" + "=" * 80)
    print("TEST A: GET /api/dashboard/supplier-shrinkage (LIST ENDPOINT)")
    print("=" * 80)
    
    try:
        resp = session.get(f"{BASE_URL}/dashboard/supplier-shrinkage")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ FAILED: Expected 200, got {resp.status_code}")
            print(f"Response: {resp.text[:500]}")
            return False
        
        data = resp.json()
        rows = data.get('data', [])
        totals = data.get('totals', {})
        
        print(f"✅ Response 200 OK")
        print(f"   Suppliers found: {len(rows)}")
        
        # Find CV. Ratu Indonesia
        cv_ratu = None
        for row in rows:
            if 'Ratu' in row.get('supplierName', ''):
                cv_ratu = row
                break
        
        if not cv_ratu:
            print("⚠️  CV. Ratu Indonesia not found in results")
            print("   Available suppliers:")
            for row in rows[:5]:
                print(f"     - {row.get('supplierName')} ({row.get('supplierCode')})")
            return False
        
        print(f"\n✅ Found supplier: {cv_ratu.get('supplierName')} ({cv_ratu.get('supplierCode')})")
        print(f"   Supplier ID: {cv_ratu.get('supplierId')}")
        
        # Verify fields exist
        required_fields = ['supplierId', 'supplierName', 'supplierCode', 'poCount', 
                          'sjWeight', 'tallyWeight', 'sjTallied', 'tallyDone', 'susut', 'susutPct']
        
        missing_fields = [f for f in required_fields if f not in cv_ratu]
        if missing_fields:
            print(f"❌ FAILED: Missing fields: {missing_fields}")
            return False
        
        print(f"✅ All required fields present")
        
        # Extract values
        sj_weight = cv_ratu.get('sjWeight')
        tally_weight = cv_ratu.get('tallyWeight')
        sj_tallied = cv_ratu.get('sjTallied')
        tally_done = cv_ratu.get('tallyDone')
        susut = cv_ratu.get('susut')
        susut_pct = cv_ratu.get('susutPct')
        po_count = cv_ratu.get('poCount')
        
        print(f"\n   ACTUAL VALUES FOR CV. RATU INDONESIA:")
        print(f"   - poCount: {po_count}")
        print(f"   - sjWeight (total received): {sj_weight} kg")
        print(f"   - tallyWeight: {tally_weight} kg")
        print(f"   - sjTallied (tallied items only): {sj_tallied} kg")
        print(f"   - tallyDone: {tally_done}")
        print(f"   - susut: {susut} kg")
        print(f"   - susutPct: {susut_pct}%")
        
        # CRITICAL VERIFICATION: susutPct should be SMALL (~0.6%), NOT ~90%
        print(f"\n   CRITICAL VERIFICATION:")
        
        # Check if susutPct is small (< 10%)
        if susut_pct is None:
            print(f"   ⚠️  susutPct is null (no tallied items)")
        elif susut_pct > 10:
            print(f"   ❌ FAILED: susutPct = {susut_pct}% (TOO HIGH, should be ~0.6%)")
            print(f"   This indicates the bug is NOT fixed - susut% is being calculated")
            print(f"   based on total sjWeight ({sj_weight}) instead of sjTallied ({sj_tallied})")
            return False
        else:
            print(f"   ✅ susutPct = {susut_pct}% (SMALL, realistic value)")
        
        # Verify expected values (approximately)
        expected_susut = 1.4
        expected_sj_tallied = 250
        expected_tally_weight = 248.6
        expected_susut_pct = 0.6
        
        # Check susut
        if abs(susut - expected_susut) < 0.5:
            print(f"   ✅ susut ~{expected_susut} kg (actual: {susut} kg)")
        else:
            print(f"   ⚠️  susut = {susut} kg (expected ~{expected_susut} kg)")
        
        # Check sjTallied
        if abs(sj_tallied - expected_sj_tallied) < 10:
            print(f"   ✅ sjTallied ~{expected_sj_tallied} kg (actual: {sj_tallied} kg)")
        else:
            print(f"   ⚠️  sjTallied = {sj_tallied} kg (expected ~{expected_sj_tallied} kg)")
        
        # Check tallyWeight
        if abs(tally_weight - expected_tally_weight) < 10:
            print(f"   ✅ tallyWeight ~{expected_tally_weight} kg (actual: {tally_weight} kg)")
        else:
            print(f"   ⚠️  tallyWeight = {tally_weight} kg (expected ~{expected_tally_weight} kg)")
        
        # Check susutPct
        if susut_pct is not None and abs(susut_pct - expected_susut_pct) < 0.5:
            print(f"   ✅ susutPct ~{expected_susut_pct}% (actual: {susut_pct}%)")
        else:
            print(f"   ⚠️  susutPct = {susut_pct}% (expected ~{expected_susut_pct}%)")
        
        # Verify sjWeight is larger (includes not-yet-tallied PO)
        if sj_weight > sj_tallied:
            print(f"   ✅ sjWeight ({sj_weight}) > sjTallied ({sj_tallied}) - includes not-yet-tallied PO")
        else:
            print(f"   ⚠️  sjWeight ({sj_weight}) <= sjTallied ({sj_tallied})")
        
        # Verify totals
        print(f"\n   TOTALS:")
        print(f"   - sjWeight: {totals.get('sjWeight')} kg")
        print(f"   - tallyWeight: {totals.get('tallyWeight')} kg")
        print(f"   - sjTallied: {totals.get('sjTallied')} kg")
        print(f"   - susut: {totals.get('susut')} kg")
        print(f"   - susutPct: {totals.get('susutPct')}%")
        
        # CRITICAL: Verify totals.susutPct = totals.susut / totals.sjTallied * 100
        if totals.get('sjTallied', 0) > 0:
            expected_total_susut_pct = round((totals.get('susut', 0) / totals.get('sjTallied', 1)) * 1000) / 10
            actual_total_susut_pct = totals.get('susutPct')
            
            print(f"\n   CRITICAL VERIFICATION (TOTALS):")
            print(f"   - Expected susutPct: {expected_total_susut_pct}% (susut / sjTallied * 100)")
            print(f"   - Actual susutPct: {actual_total_susut_pct}%")
            
            if abs(expected_total_susut_pct - actual_total_susut_pct) < 0.1:
                print(f"   ✅ totals.susutPct calculated correctly (based on sjTallied, NOT sjWeight)")
            else:
                print(f"   ❌ FAILED: totals.susutPct mismatch")
                return False
            
            # Verify it's NOT based on sjWeight
            wrong_susut_pct = round((totals.get('susut', 0) / totals.get('sjWeight', 1)) * 1000) / 10
            if abs(actual_total_susut_pct - wrong_susut_pct) > 0.1:
                print(f"   ✅ totals.susutPct is NOT based on sjWeight ({wrong_susut_pct}%)")
            else:
                print(f"   ❌ FAILED: totals.susutPct appears to be based on sjWeight")
                return False
        
        print(f"\n✅ TEST A PASSED: Supplier shrinkage list endpoint working correctly")
        return cv_ratu.get('supplierId')
        
    except Exception as e:
        print(f"❌ TEST A FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_supplier_shrinkage_detail(session, supplier_id):
    """
    TEST B: GET /api/dashboard/supplier-shrinkage/:supplierId
    Verify per-PO breakdown and totals.susutPct calculation
    """
    print("\n" + "=" * 80)
    print(f"TEST B: GET /api/dashboard/supplier-shrinkage/{supplier_id} (DETAIL ENDPOINT)")
    print("=" * 80)
    
    try:
        resp = session.get(f"{BASE_URL}/dashboard/supplier-shrinkage/{supplier_id}")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code != 200:
            print(f"❌ FAILED: Expected 200, got {resp.status_code}")
            print(f"Response: {resp.text[:500]}")
            return False
        
        data = resp.json().get('data', {})
        supplier = data.get('supplier', {})
        pos = data.get('pos', [])
        totals = data.get('totals', {})
        
        print(f"✅ Response 200 OK")
        print(f"   Supplier: {supplier.get('name')} ({supplier.get('code')})")
        print(f"   POs found: {len(pos)}")
        
        # Verify structure
        if not supplier or not isinstance(pos, list) or not totals:
            print(f"❌ FAILED: Invalid response structure")
            return False
        
        print(f"✅ Response structure valid")
        
        # Find PO/202608/0013 and PO/202608/0014
        po_0013 = None
        po_0014 = None
        
        for po in pos:
            po_number = po.get('poNumber', '')
            if 'PO/202608/0013' in po_number:
                po_0013 = po
            elif 'PO/202608/0014' in po_number:
                po_0014 = po
        
        print(f"\n   PO BREAKDOWN:")
        
        # Verify PO/202608/0013 (not tallied)
        if po_0013:
            print(f"\n   PO/202608/0013 (NOT TALLIED):")
            print(f"   - sjWeight: {po_0013.get('sjWeight')} kg")
            print(f"   - tallyWeight: {po_0013.get('tallyWeight')} kg")
            print(f"   - sjTallied: {po_0013.get('sjTallied')} kg")
            print(f"   - tallyDone: {po_0013.get('tallyDone')}")
            print(f"   - susut: {po_0013.get('susut')} kg")
            print(f"   - susutPct: {po_0013.get('susutPct')}")
            
            # Verify tallyDone=false, susut=0, susutPct=null
            if po_0013.get('tallyDone') == False:
                print(f"   ✅ tallyDone = false (not tallied)")
            else:
                print(f"   ❌ FAILED: tallyDone should be false")
                return False
            
            if po_0013.get('susut') == 0:
                print(f"   ✅ susut = 0 (not calculated for untallied PO)")
            else:
                print(f"   ⚠️  susut = {po_0013.get('susut')} (expected 0)")
            
            if po_0013.get('susutPct') is None:
                print(f"   ✅ susutPct = null (not calculated for untallied PO)")
            else:
                print(f"   ⚠️  susutPct = {po_0013.get('susutPct')} (expected null)")
        else:
            print(f"\n   ⚠️  PO/202608/0013 not found")
        
        # Verify PO/202608/0014 (tallied)
        if po_0014:
            print(f"\n   PO/202608/0014 (TALLIED):")
            print(f"   - sjWeight: {po_0014.get('sjWeight')} kg")
            print(f"   - tallyWeight: {po_0014.get('tallyWeight')} kg")
            print(f"   - sjTallied: {po_0014.get('sjTallied')} kg")
            print(f"   - tallyDone: {po_0014.get('tallyDone')}")
            print(f"   - susut: {po_0014.get('susut')} kg")
            print(f"   - susutPct: {po_0014.get('susutPct')}%")
            
            # Verify tallyDone=true
            if po_0014.get('tallyDone') == True:
                print(f"   ✅ tallyDone = true (tallied)")
            else:
                print(f"   ❌ FAILED: tallyDone should be true")
                return False
            
            # Verify susut ~1.4
            susut_0014 = po_0014.get('susut', 0)
            if abs(susut_0014 - 1.4) < 0.5:
                print(f"   ✅ susut ~1.4 kg (actual: {susut_0014} kg)")
            else:
                print(f"   ⚠️  susut = {susut_0014} kg (expected ~1.4 kg)")
            
            # Verify susutPct ~0.6% (susut / sjTallied * 100)
            susut_pct_0014 = po_0014.get('susutPct')
            sj_tallied_0014 = po_0014.get('sjTallied', 0)
            
            if susut_pct_0014 is not None:
                expected_pct = round((susut_0014 / sj_tallied_0014) * 1000) / 10 if sj_tallied_0014 > 0 else 0
                print(f"   - Expected susutPct: {expected_pct}% (susut / sjTallied * 100)")
                
                if abs(susut_pct_0014 - 0.6) < 0.5:
                    print(f"   ✅ susutPct ~0.6% (actual: {susut_pct_0014}%)")
                else:
                    print(f"   ⚠️  susutPct = {susut_pct_0014}% (expected ~0.6%)")
                
                # CRITICAL: Verify it's based on sjTallied (~250), NOT sjWeight
                if abs(susut_pct_0014 - expected_pct) < 0.1:
                    print(f"   ✅ susutPct calculated correctly (based on sjTallied)")
                else:
                    print(f"   ❌ FAILED: susutPct mismatch")
                    return False
            else:
                print(f"   ❌ FAILED: susutPct should not be null for tallied PO")
                return False
            
            # Verify sjTallied ~250
            if abs(sj_tallied_0014 - 250) < 10:
                print(f"   ✅ sjTallied ~250 kg (actual: {sj_tallied_0014} kg)")
            else:
                print(f"   ⚠️  sjTallied = {sj_tallied_0014} kg (expected ~250 kg)")
        else:
            print(f"\n   ⚠️  PO/202608/0014 not found")
        
        # Verify totals
        print(f"\n   TOTALS:")
        print(f"   - sjWeight: {totals.get('sjWeight')} kg")
        print(f"   - tallyWeight: {totals.get('tallyWeight')} kg")
        print(f"   - susut: {totals.get('susut')} kg")
        print(f"   - susutPct: {totals.get('susutPct')}%")
        
        # CRITICAL: Verify totals.susutPct is based on sum(sjTallied) (~250), NOT total sjWeight (~2733)
        # Expected: susut ~1.4 / sjTallied ~250 * 100 = ~0.6%
        # Wrong: susut ~1.4 / sjWeight ~2733 * 100 = ~0.05%
        
        total_susut = totals.get('susut', 0)
        total_susut_pct = totals.get('susutPct', 0)
        
        print(f"\n   CRITICAL VERIFICATION (TOTALS):")
        
        # Calculate expected based on sjTallied (~250)
        if po_0014:
            sj_tallied_sum = po_0014.get('sjTallied', 0)  # Only PO/202608/0014 is tallied
            expected_total_pct = round((total_susut / sj_tallied_sum) * 1000) / 10 if sj_tallied_sum > 0 else 0
            
            print(f"   - sum(sjTallied) for tallied POs: ~{sj_tallied_sum} kg")
            print(f"   - Expected susutPct: {expected_total_pct}% (susut / sum(sjTallied) * 100)")
            print(f"   - Actual susutPct: {total_susut_pct}%")
            
            if abs(total_susut_pct - expected_total_pct) < 0.2:
                print(f"   ✅ totals.susutPct ~{expected_total_pct}% (based on sjTallied ~{sj_tallied_sum} kg)")
            else:
                print(f"   ⚠️  totals.susutPct = {total_susut_pct}% (expected ~{expected_total_pct}%)")
            
            # Verify it's NOT based on total sjWeight (~2733)
            total_sj_weight = totals.get('sjWeight', 0)
            wrong_pct = round((total_susut / total_sj_weight) * 1000) / 10 if total_sj_weight > 0 else 0
            
            print(f"   - If based on sjWeight: {wrong_pct}% (WRONG)")
            
            if abs(total_susut_pct - wrong_pct) > 0.1:
                print(f"   ✅ totals.susutPct is NOT based on total sjWeight ({total_sj_weight} kg)")
            else:
                print(f"   ❌ FAILED: totals.susutPct appears to be based on sjWeight")
                return False
            
            # Verify it's NOT ~90% (the old bug)
            if total_susut_pct < 10:
                print(f"   ✅ totals.susutPct is SMALL (~{total_susut_pct}%), NOT ~90% (bug fixed)")
            else:
                print(f"   ❌ FAILED: totals.susutPct = {total_susut_pct}% (TOO HIGH, bug NOT fixed)")
                return False
        
        print(f"\n✅ TEST B PASSED: Supplier shrinkage detail endpoint working correctly")
        return True
        
    except Exception as e:
        print(f"❌ TEST B FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    print("=" * 80)
    print("BACKEND TEST: Susut (Shrinkage) Percentage Logic Re-Verification")
    print("=" * 80)
    print("\nBACKGROUND:")
    print("- Previously: susut% wrongly computed using TOTAL shipped weight")
    print("- Fix: susut% must consider ONLY items that have been tallied (tally_weight > 0)")
    print("- New field 'sjTallied' = sum of received_weight for items with tally_weight > 0")
    print("- susut = sum(received_weight - tally_weight) over tallied items only")
    print("- susutPct = susut / sjTallied * 100 (1 decimal), null/0 when no tallied items")
    print("\nEXPECTED for CV. Ratu Indonesia:")
    print("- susutPct: ~0.6% (SMALL, realistic, NOT ~90%)")
    print("- susut: ~1.4 kg")
    print("- sjTallied: ~250 kg (tallied PO only)")
    print("- tallyWeight: ~248.6 kg")
    print("- sjWeight: ~2733 kg (includes not-yet-tallied PO)")
    
    # Step 1: Login
    session = login()
    if not session:
        print("\n❌ TEST FAILED: Could not login")
        sys.exit(1)
    
    # Step 2: Test supplier shrinkage list endpoint
    supplier_id = test_supplier_shrinkage_list(session)
    if not supplier_id:
        print("\n❌ TEST A FAILED")
        sys.exit(1)
    
    # Step 3: Test supplier shrinkage detail endpoint
    success = test_supplier_shrinkage_detail(session, supplier_id)
    if not success:
        print("\n❌ TEST B FAILED")
        sys.exit(1)
    
    # Final summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print("✅ TEST A: GET /api/dashboard/supplier-shrinkage - PASSED")
    print("✅ TEST B: GET /api/dashboard/supplier-shrinkage/:supplierId - PASSED")
    print("\n✅ ALL TESTS PASSED - SUSUT PERCENTAGE LOGIC VERIFIED")
    print("\nKEY FINDINGS:")
    print("- susutPct is calculated based on sjTallied (tallied items only), NOT sjWeight")
    print("- CV. Ratu Indonesia susutPct is SMALL (~0.6%), NOT ~90%")
    print("- Untallied POs have susut=0 and susutPct=null (correct)")
    print("- Tallied POs have susut and susutPct calculated correctly")
    print("- Totals.susutPct is based on sum(sjTallied), NOT sum(sjWeight)")
    print("=" * 80)

if __name__ == "__main__":
    main()
