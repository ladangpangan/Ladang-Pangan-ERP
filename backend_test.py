#!/usr/bin/env python3
"""
Backend API Test for PDF Settings Endpoint
Tests the newly added 'pdf' key in ALLOWED_SETTINGS whitelist
"""

import requests
import json
import sys

BASE_URL = "http://localhost:3000/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

def print_test(name, passed, details=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"   {details}")
    print()

def login_admin():
    """Login as admin and return session"""
    print("=== AUTHENTICATING AS ADMIN ===")
    session = requests.Session()
    
    # Better Auth sign-in endpoint
    auth_url = "http://localhost:3000/api/auth/sign-in/email"
    payload = {
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    }
    
    try:
        resp = session.post(auth_url, json=payload)
        print(f"Login response status: {resp.status_code}")
        
        if resp.status_code == 200:
            print("✅ Admin login successful")
            print(f"Session cookies: {session.cookies.get_dict()}")
            return session
        else:
            print(f"❌ Login failed: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"❌ Login error: {e}")
        return None

def test_pdf_settings():
    """Test PDF settings endpoint"""
    print("\n" + "="*80)
    print("TESTING: PDF SETTINGS ENDPOINT")
    print("="*80 + "\n")
    
    # Login as admin
    admin_session = login_admin()
    if not admin_session:
        print("❌ CRITICAL: Cannot proceed without admin session")
        return False
    
    print("\n" + "="*80)
    print("TEST 1: PUT /api/settings/pdf as admin (round-trip)")
    print("="*80)
    
    pdf_config = {
        "accent": "#1D4ED8",
        "template": "modern",
        "showLogo": True,
        "logoSize": 22,
        "showWatermark": True,
        "showSignature": True,
        "showPayment": True,
        "showPrintedAt": True,
        "paymentInfo": "Transfer BCA 123",
        "signerLabel": "Hormat kami,",
        "signerName": "PT LPI",
        "footerNote": "Footer test"
    }
    
    try:
        resp = admin_session.put(
            f"{BASE_URL}/settings/pdf",
            json={"value": pdf_config}
        )
        
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            print(f"Response: {json.dumps(data, indent=2)}")
            
            # Verify round-trip
            if data.get("data", {}).get("value") == pdf_config:
                print_test("PUT /api/settings/pdf", True, "Round-trip successful, value matches")
            else:
                print_test("PUT /api/settings/pdf", False, f"Value mismatch: {data.get('data', {}).get('value')}")
                return False
        else:
            print_test("PUT /api/settings/pdf", False, f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
    except Exception as e:
        print_test("PUT /api/settings/pdf", False, f"Exception: {e}")
        return False
    
    print("\n" + "="*80)
    print("TEST 2: GET /api/settings/pdf as admin")
    print("="*80)
    
    try:
        resp = admin_session.get(f"{BASE_URL}/settings/pdf")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            print(f"Response: {json.dumps(data, indent=2)}")
            
            # Verify value matches what we saved
            if data.get("data", {}).get("value") == pdf_config:
                print_test("GET /api/settings/pdf", True, "Value matches saved config")
            else:
                print_test("GET /api/settings/pdf", False, f"Value mismatch: {data.get('data', {}).get('value')}")
                return False
        else:
            print_test("GET /api/settings/pdf", False, f"Expected 200, got {resp.status_code}: {resp.text}")
            return False
    except Exception as e:
        print_test("GET /api/settings/pdf", False, f"Exception: {e}")
        return False
    
    print("\n" + "="*80)
    print("TEST 3: Unauthenticated GET /api/settings/pdf (expect 401)")
    print("="*80)
    
    try:
        # Create new session without auth
        unauth_session = requests.Session()
        resp = unauth_session.get(f"{BASE_URL}/settings/pdf")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 401:
            print_test("Unauthenticated GET", True, "Correctly rejected with 401")
        else:
            print_test("Unauthenticated GET", False, f"Expected 401, got {resp.status_code}")
            return False
    except Exception as e:
        print_test("Unauthenticated GET", False, f"Exception: {e}")
        return False
    
    print("\n" + "="*80)
    print("TEST 4: Unauthenticated PUT /api/settings/pdf (expect 401)")
    print("="*80)
    
    try:
        unauth_session = requests.Session()
        resp = unauth_session.put(
            f"{BASE_URL}/settings/pdf",
            json={"value": {"test": "data"}}
        )
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 401:
            print_test("Unauthenticated PUT", True, "Correctly rejected with 401")
        else:
            print_test("Unauthenticated PUT", False, f"Expected 401, got {resp.status_code}")
            return False
    except Exception as e:
        print_test("Unauthenticated PUT", False, f"Exception: {e}")
        return False
    
    print("\n" + "="*80)
    print("TEST 5: REGRESSION - Existing settings keys still work")
    print("="*80)
    
    existing_keys = ["company", "approval", "notifications"]
    all_passed = True
    
    for key in existing_keys:
        try:
            resp = admin_session.get(f"{BASE_URL}/settings/{key}")
            print(f"\nGET /api/settings/{key}: {resp.status_code}")
            
            if resp.status_code == 200:
                data = resp.json()
                if "data" in data and "key" in data["data"] and "value" in data["data"]:
                    print_test(f"GET /api/settings/{key}", True, f"Returns data.key and data.value")
                else:
                    print_test(f"GET /api/settings/{key}", False, f"Missing expected fields: {data}")
                    all_passed = False
            else:
                print_test(f"GET /api/settings/{key}", False, f"Expected 200, got {resp.status_code}")
                all_passed = False
        except Exception as e:
            print_test(f"GET /api/settings/{key}", False, f"Exception: {e}")
            all_passed = False
    
    if not all_passed:
        return False
    
    print("\n" + "="*80)
    print("TEST 6: GET /api/settings/unknownkey (expect 404)")
    print("="*80)
    
    try:
        resp = admin_session.get(f"{BASE_URL}/settings/unknownkey")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 404:
            print_test("GET unknown key", True, "Correctly returns 404")
        else:
            print_test("GET unknown key", False, f"Expected 404, got {resp.status_code}")
            return False
    except Exception as e:
        print_test("GET unknown key", False, f"Exception: {e}")
        return False
    
    return True

def main():
    print("\n" + "="*80)
    print("BACKEND TEST: PDF SETTINGS ENDPOINT")
    print("="*80)
    
    try:
        success = test_pdf_settings()
        
        print("\n" + "="*80)
        if success:
            print("✅ ALL TESTS PASSED")
            print("="*80)
            return 0
        else:
            print("❌ SOME TESTS FAILED")
            print("="*80)
            return 1
    except Exception as e:
        print(f"\n❌ CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())
