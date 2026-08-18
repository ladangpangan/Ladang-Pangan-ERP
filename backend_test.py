#!/usr/bin/env python3
"""
Backend test for Phase 1 - Better Auth MongoDB Migration
Tests all 9 steps as specified in test_result.md
Uses curl to avoid __Secure- cookie prefix issues over HTTP
"""

import subprocess
import json
import sys
import os

BASE_URL = "http://localhost:3000/api"
ORIGIN = "http://localhost:3000"

# Test credentials (MongoDB-backed)
CREDENTIALS = {
    "admin": {"email": "admin@lpi.co.id", "password": "admin123"},
    "supervisor": {"email": "supervisor@lpi.co.id", "password": "super123"},
    "direktur": {"email": "direktur@lpi.co.id", "password": "direktur123"},
    "operator": {"email": "operator@lpi.co.id", "password": "operator123"},
}

def print_test(step, desc):
    print(f"\n{'='*80}")
    print(f"STEP {step}: {desc}")
    print('='*80)

def print_result(success, message):
    status = "✅ PASS" if success else "❌ FAIL"
    print(f"{status}: {message}")

def curl_request(method, endpoint, cookies_file=None, data=None, save_cookies=None):
    """Execute curl request and return (status_code, response_body)"""
    cmd = ["curl", "-s", "-w", "\\n%{http_code}", "-X", method, f"{BASE_URL}{endpoint}"]
    cmd.extend(["-H", "Content-Type: application/json"])
    cmd.extend(["-H", f"Origin: {ORIGIN}"])
    
    if cookies_file and os.path.exists(cookies_file):
        cmd.extend(["-b", cookies_file])
    
    if save_cookies:
        cmd.extend(["-c", save_cookies])
    
    if data:
        cmd.extend(["-d", json.dumps(data)])
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        output = result.stdout
        lines = output.strip().split('\n')
        status_code = int(lines[-1])
        body = '\n'.join(lines[:-1])
        
        try:
            body_json = json.loads(body) if body else {}
            return status_code, body_json
        except json.JSONDecodeError:
            return status_code, body
    except Exception as e:
        print(f"  curl error: {e}")
        return 0, None

def sign_in(role, cookies_file):
    """Sign in and save session cookies"""
    creds = CREDENTIALS[role]
    status, body = curl_request(
        "POST", 
        "/auth/sign-in/email",
        data={"email": creds["email"], "password": creds["password"]},
        save_cookies=cookies_file
    )
    
    print(f"  Sign-in {role}: status={status}")
    
    if status == 200 and isinstance(body, dict):
        user_role = body.get("user", {}).get("role", "unknown")
        print(f"  User role from response: {user_role}")
        return True, user_role
    else:
        print(f"  Sign-in failed: {body}")
        return False, None

def test_step_1():
    """Step 1: Sign-in for all 4 roles -> 200, correct role"""
    print_test(1, "Sign-in for all 4 roles")
    
    all_passed = True
    cookie_files = {}
    
    for role in ["admin", "supervisor", "direktur", "operator"]:
        cookies_file = f"/tmp/cookies_{role}.txt"
        success, user_role = sign_in(role, cookies_file)
        
        if success:
            cookie_files[role] = cookies_file
            
            # Verify role by calling /me
            status, body = curl_request("GET", "/me", cookies_file=cookies_file)
            if status == 200 and isinstance(body, dict):
                actual_role = body.get("user", {}).get("role")
                if actual_role == role:
                    print_result(True, f"{role}: signed in successfully, role={actual_role}")
                else:
                    print_result(False, f"{role}: role mismatch, expected={role}, got={actual_role}")
                    all_passed = False
            else:
                print_result(False, f"{role}: /me returned {status}")
                all_passed = False
        else:
            print_result(False, f"{role}: sign-in failed")
            all_passed = False
    
    return all_passed, cookie_files

def test_step_2(cookie_files):
    """Step 2: SESSION PERSISTENCE - reuse cookie for GET /api/me and /api/stats"""
    print_test(2, "SESSION PERSISTENCE (core fix)")
    
    all_passed = True
    
    if "admin" not in cookie_files:
        print_result(False, "Admin session not available")
        return False
    
    cookies_file = cookie_files["admin"]
    
    # Test /me
    status, body = curl_request("GET", "/me", cookies_file=cookies_file)
    if status == 200:
        print_result(True, f"GET /me with admin session: {status}")
    else:
        print_result(False, f"GET /me with admin session: {status}")
        all_passed = False
    
    # Test /stats
    status, body = curl_request("GET", "/stats", cookies_file=cookies_file)
    if status == 200 and isinstance(body, dict):
        users = body.get("users", 0)
        print_result(True, f"GET /stats with admin session: {status}, users={users}")
    else:
        print_result(False, f"GET /stats with admin session: {status}")
        all_passed = False
    
    return all_passed

def test_step_3(cookie_files):
    """Step 3: USER MANAGEMENT as direktur"""
    print_test(3, "USER MANAGEMENT (as direktur)")
    
    all_passed = True
    created_user_id = None
    
    if "direktur" not in cookie_files:
        print_result(False, "Direktur session not available")
        return False, None
    
    cookies_file = cookie_files["direktur"]
    
    # 3.1: GET /users (should return 4 users)
    status, body = curl_request("GET", "/users", cookies_file=cookies_file)
    if status == 200 and isinstance(body, dict):
        users = body.get("data", [])
        print_result(True, f"GET /users: {status}, count={len(users)}")
        initial_count = len(users)
    else:
        print_result(False, f"GET /users: {status}")
        all_passed = False
        return all_passed, None
    
    # 3.2: POST /users (create new user)
    new_user = {
        "name": "QA Test User",
        "email": "qa1@lpi.co.id",
        "password": "qatest123",
        "role": "operator",
        "status": "active"
    }
    status, body = curl_request("POST", "/users", cookies_file=cookies_file, data=new_user)
    if status == 201 and isinstance(body, dict):
        created_user_id = body.get("data", {}).get("id")
        print_result(True, f"POST /users: {status}, created user id={created_user_id}")
    else:
        print_result(False, f"POST /users: {status}, {body}")
        all_passed = False
        return all_passed, None
    
    # 3.3: GET /users again (should show 5 users now)
    status, body = curl_request("GET", "/users", cookies_file=cookies_file)
    if status == 200 and isinstance(body, dict):
        users = body.get("data", [])
        if len(users) == initial_count + 1:
            print_result(True, f"GET /users after create: count={len(users)} (increased by 1)")
        else:
            print_result(False, f"GET /users after create: count={len(users)}, expected={initial_count + 1}")
            all_passed = False
    else:
        print_result(False, f"GET /users after create: {status}")
        all_passed = False
    
    # 3.4: PATCH /users/:id (change role to supervisor)
    patch_data = {"role": "supervisor"}
    status, body = curl_request("PATCH", f"/users/{created_user_id}", cookies_file=cookies_file, data=patch_data)
    if status == 200 and isinstance(body, dict):
        updated_role = body.get("data", {}).get("role")
        if updated_role == "supervisor":
            print_result(True, f"PATCH /users/:id: {status}, role updated to {updated_role}")
        else:
            print_result(False, f"PATCH /users/:id: role not updated correctly, got {updated_role}")
            all_passed = False
    else:
        print_result(False, f"PATCH /users/:id: {status}, {body}")
        all_passed = False
    
    # 3.5: POST /users/:id/reset-password
    reset_data = {"newPassword": "newpass123"}
    status, body = curl_request("POST", f"/users/{created_user_id}/reset-password", cookies_file=cookies_file, data=reset_data)
    if status == 200:
        print_result(True, f"POST /users/:id/reset-password: {status}")
        
        # Try to sign in with new password
        test_cookies = "/tmp/cookies_qa_test.txt"
        status, body = curl_request(
            "POST",
            "/auth/sign-in/email",
            data={"email": "qa1@lpi.co.id", "password": "newpass123"},
            save_cookies=test_cookies
        )
        if status == 200:
            print_result(True, f"Sign-in with new password: {status}")
        else:
            print_result(False, f"Sign-in with new password: {status}")
            all_passed = False
    else:
        print_result(False, f"POST /users/:id/reset-password: {status}, {body}")
        all_passed = False
    
    # 3.6: DELETE /users/:id
    status, body = curl_request("DELETE", f"/users/{created_user_id}", cookies_file=cookies_file)
    if status == 200:
        print_result(True, f"DELETE /users/:id: {status}")
    else:
        print_result(False, f"DELETE /users/:id: {status}, {body}")
        all_passed = False
    
    # 3.7: GET /users again (should be back to original count)
    status, body = curl_request("GET", "/users", cookies_file=cookies_file)
    if status == 200 and isinstance(body, dict):
        users = body.get("data", [])
        if len(users) == initial_count:
            print_result(True, f"GET /users after delete: count={len(users)} (back to original)")
        else:
            print_result(False, f"GET /users after delete: count={len(users)}, expected={initial_count}")
            all_passed = False
    else:
        print_result(False, f"GET /users after delete: {status}")
        all_passed = False
    
    return all_passed, created_user_id

def test_step_4(cookie_files):
    """Step 4: AUTHORIZATION - admin and operator should get 403 for user mgmt"""
    print_test(4, "AUTHORIZATION (403 for admin/operator on user mgmt)")
    
    all_passed = True
    
    # Test admin: GET /users -> 403
    if "admin" in cookie_files:
        status, body = curl_request("GET", "/users", cookies_file=cookie_files["admin"])
        if status == 403:
            print_result(True, f"Admin GET /users: {status} (correctly forbidden)")
        else:
            print_result(False, f"Admin GET /users: {status}, expected 403")
            all_passed = False
        
        # Test admin: POST /users -> 403
        new_user = {"name": "Test", "email": "test@test.com", "password": "test123", "role": "operator"}
        status, body = curl_request("POST", "/users", cookies_file=cookie_files["admin"], data=new_user)
        if status == 403:
            print_result(True, f"Admin POST /users: {status} (correctly forbidden)")
        else:
            print_result(False, f"Admin POST /users: {status}, expected 403")
            all_passed = False
    else:
        print_result(False, "Admin session not available")
        all_passed = False
    
    # Test operator: GET /users -> 403
    if "operator" in cookie_files:
        status, body = curl_request("GET", "/users", cookies_file=cookie_files["operator"])
        if status == 403:
            print_result(True, f"Operator GET /users: {status} (correctly forbidden)")
        else:
            print_result(False, f"Operator GET /users: {status}, expected 403")
            all_passed = False
    else:
        print_result(False, "Operator session not available")
        all_passed = False
    
    return all_passed

def test_step_5(cookie_files):
    """Step 5: VALIDATION - duplicate email and weak password"""
    print_test(5, "VALIDATION (duplicate email, weak password)")
    
    all_passed = True
    
    if "direktur" not in cookie_files:
        print_result(False, "Direktur session not available")
        return False
    
    cookies_file = cookie_files["direktur"]
    
    # Test duplicate email (admin@lpi.co.id already exists)
    duplicate_user = {
        "name": "Duplicate",
        "email": "admin@lpi.co.id",
        "password": "test123",
        "role": "operator"
    }
    status, body = curl_request("POST", "/users", cookies_file=cookies_file, data=duplicate_user)
    if status == 400:
        print_result(True, f"POST /users with duplicate email: {status} (correctly rejected)")
    else:
        print_result(False, f"POST /users with duplicate email: {status}, expected 400")
        all_passed = False
    
    # Test weak password (<6 chars)
    weak_pass_user = {
        "name": "Weak Pass",
        "email": "weakpass@lpi.co.id",
        "password": "12345",
        "role": "operator"
    }
    status, body = curl_request("POST", "/users", cookies_file=cookies_file, data=weak_pass_user)
    if status == 400:
        print_result(True, f"POST /users with weak password: {status} (correctly rejected)")
    else:
        print_result(False, f"POST /users with weak password: {status}, expected 400")
        all_passed = False
    
    return all_passed

def test_step_6(cookie_files):
    """Step 6: SELF-PROTECTION - can't modify/delete own account"""
    print_test(6, "SELF-PROTECTION (can't modify/delete own account)")
    
    all_passed = True
    
    if "direktur" not in cookie_files:
        print_result(False, "Direktur session not available")
        return False
    
    cookies_file = cookie_files["direktur"]
    
    # Get direktur's own user ID
    status, body = curl_request("GET", "/me", cookies_file=cookies_file)
    if status != 200 or not isinstance(body, dict):
        print_result(False, f"GET /me failed: {status}")
        return False
    
    own_id = body.get("user", {}).get("id")
    
    # Try to change own role
    patch_data = {"role": "admin"}
    status, body = curl_request("PATCH", f"/users/{own_id}", cookies_file=cookies_file, data=patch_data)
    if status == 400:
        print_result(True, f"PATCH own account (change role): {status} (correctly rejected)")
    else:
        print_result(False, f"PATCH own account (change role): {status}, expected 400")
        all_passed = False
    
    # Try to delete own account
    status, body = curl_request("DELETE", f"/users/{own_id}", cookies_file=cookies_file)
    if status == 400:
        print_result(True, f"DELETE own account: {status} (correctly rejected)")
    else:
        print_result(False, f"DELETE own account: {status}, expected 400")
        all_passed = False
    
    return all_passed

def test_step_7(cookie_files):
    """Step 7: PROFILE - PUT /api/account/profile"""
    print_test(7, "PROFILE UPDATE (PUT /api/account/profile)")
    
    all_passed = True
    
    if "admin" not in cookie_files:
        print_result(False, "Admin session not available")
        return False
    
    cookies_file = cookie_files["admin"]
    
    # Update profile name
    profile_data = {"name": "Admin Updated Name"}
    status, body = curl_request("PUT", "/account/profile", cookies_file=cookies_file, data=profile_data)
    if status == 200:
        print_result(True, f"PUT /account/profile: {status}")
        
        # Verify name was updated
        status, body = curl_request("GET", "/me", cookies_file=cookies_file)
        if status == 200 and isinstance(body, dict):
            name = body.get("user", {}).get("name")
            if name == "Admin Updated Name":
                print_result(True, f"Profile name verified: {name}")
            else:
                print_result(False, f"Profile name not updated correctly: {name}")
                all_passed = False
        else:
            print_result(False, f"GET /me after profile update: {status}")
            all_passed = False
    else:
        print_result(False, f"PUT /account/profile: {status}, {body}")
        all_passed = False
    
    return all_passed

def test_step_8(cookie_files):
    """Step 8: REGRESSION - business data endpoints still work"""
    print_test(8, "REGRESSION (business data still in SQLite)")
    
    all_passed = True
    
    if "admin" not in cookie_files:
        print_result(False, "Admin session not available")
        return False
    
    cookies_file = cookie_files["admin"]
    
    # Test GET /contacts
    status, body = curl_request("GET", "/contacts", cookies_file=cookies_file)
    if status == 200:
        print_result(True, f"GET /contacts: {status}")
    else:
        print_result(False, f"GET /contacts: {status}")
        all_passed = False
    
    # Test GET /products
    status, body = curl_request("GET", "/products", cookies_file=cookies_file)
    if status == 200:
        print_result(True, f"GET /products: {status}")
    else:
        print_result(False, f"GET /products: {status}")
        all_passed = False
    
    # Test GET /cold-storages
    status, body = curl_request("GET", "/cold-storages", cookies_file=cookies_file)
    if status == 200:
        print_result(True, f"GET /cold-storages: {status}")
    else:
        print_result(False, f"GET /cold-storages: {status}")
        all_passed = False
    
    # Test GET /stats
    status, body = curl_request("GET", "/stats", cookies_file=cookies_file)
    if status == 200:
        print_result(True, f"GET /stats: {status}")
    else:
        print_result(False, f"GET /stats: {status}")
        all_passed = False
    
    # Test operator can GET /purchase-orders
    if "operator" in cookie_files:
        status, body = curl_request("GET", "/purchase-orders", cookies_file=cookie_files["operator"])
        if status == 200:
            print_result(True, f"Operator GET /purchase-orders: {status}")
        else:
            print_result(False, f"Operator GET /purchase-orders: {status}")
            all_passed = False
    
    return all_passed

def test_step_9(cookie_files):
    """Step 9: NOTIFICATIONS - GET /api/notifications"""
    print_test(9, "NOTIFICATIONS (GET /api/notifications)")
    
    all_passed = True
    
    if "admin" not in cookie_files:
        print_result(False, "Admin session not available")
        return False
    
    cookies_file = cookie_files["admin"]
    
    # Test GET /notifications
    status, body = curl_request("GET", "/notifications", cookies_file=cookies_file)
    if status == 200 and isinstance(body, dict):
        notifications = body.get("data", [])
        print_result(True, f"GET /notifications: {status}, count={len(notifications)}")
    else:
        print_result(False, f"GET /notifications: {status}, {body}")
        all_passed = False
    
    return all_passed

def main():
    print("\n" + "="*80)
    print("PHASE 1 - BETTER AUTH MONGODB MIGRATION - BACKEND TEST")
    print("="*80)
    
    results = {}
    
    # Step 1: Sign-in all roles
    passed, cookie_files = test_step_1()
    results["Step 1"] = passed
    
    if not cookie_files:
        print("\n❌ CRITICAL: No sessions available, cannot continue testing")
        sys.exit(1)
    
    # Step 2: Session persistence
    results["Step 2"] = test_step_2(cookie_files)
    
    # Step 3: User management
    passed, created_user_id = test_step_3(cookie_files)
    results["Step 3"] = passed
    
    # Step 4: Authorization
    results["Step 4"] = test_step_4(cookie_files)
    
    # Step 5: Validation
    results["Step 5"] = test_step_5(cookie_files)
    
    # Step 6: Self-protection
    results["Step 6"] = test_step_6(cookie_files)
    
    # Step 7: Profile update
    results["Step 7"] = test_step_7(cookie_files)
    
    # Step 8: Regression
    results["Step 8"] = test_step_8(cookie_files)
    
    # Step 9: Notifications
    results["Step 9"] = test_step_9(cookie_files)
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    
    for step, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {step}")
    
    print(f"\nTotal: {passed}/{total} tests passed ({passed*100//total}%)")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
