#!/usr/bin/env python3
"""
Backend API Testing for User Management Module
Tests all User Management endpoints with comprehensive RBAC verification
"""

import requests
import json
import time
from datetime import datetime

# Configuration
BASE_URL = "https://pangan-system.preview.emergentagent.com/api"
AUTH_URL = "https://pangan-system.preview.emergentagent.com/api/auth/sign-in/email"

# Test credentials
CREDENTIALS = {
    'admin': {'email': 'admin@lpi.co.id', 'password': 'admin123'},
    'supervisor': {'email': 'supervisor@lpi.co.id', 'password': 'super123'},
    'direktur': {'email': 'direktur@lpi.co.id', 'password': 'direktur123'},
    'operator': {'email': 'operator@lpi.co.id', 'password': 'operator123'}
}

# Global session storage
sessions = {}
test_user_ids = []  # Track created test users for cleanup

def login(role):
    """Login and store session cookies"""
    if role in sessions:
        return sessions[role]
    
    creds = CREDENTIALS[role]
    print(f"\n🔐 Logging in as {role}...")
    
    try:
        resp = requests.post(AUTH_URL, json=creds, timeout=10)
        if resp.status_code == 200:
            sessions[role] = resp.cookies
            print(f"✅ Login successful for {role}")
            return resp.cookies
        else:
            print(f"❌ Login failed for {role}: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"❌ Login error for {role}: {str(e)}")
        return None

def test_get_users():
    """Test GET /api/users with different roles"""
    print("\n" + "="*80)
    print("TEST 1: GET /api/users - List Users")
    print("="*80)
    
    # Test 1.1: Admin can list users (200)
    print("\n[1.1] Admin listing users...")
    try:
        cookies = login('admin')
        resp = requests.get(f"{BASE_URL}/users", cookies=cookies, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if 'data' in data and isinstance(data['data'], list):
                print(f"✅ Admin: 200 - Found {len(data['data'])} users")
                # Store admin ID for later tests
                admin_user = [u for u in data['data'] if u['email'] == 'admin@lpi.co.id']
                if admin_user:
                    global admin_id
                    admin_id = admin_user[0]['id']
                    print(f"   Admin ID: {admin_id}")
            else:
                print(f"❌ Admin: Invalid response structure - {data}")
        else:
            print(f"❌ Admin: {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Admin test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 1.2: Direktur can list users (200)
    print("\n[1.2] Direktur listing users...")
    try:
        cookies = login('direktur')
        resp = requests.get(f"{BASE_URL}/users", cookies=cookies, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if 'data' in data and isinstance(data['data'], list):
                print(f"✅ Direktur: 200 - Found {len(data['data'])} users")
            else:
                print(f"❌ Direktur: Invalid response structure")
        else:
            print(f"❌ Direktur: {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Direktur test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 1.3: Supervisor cannot list users (403)
    print("\n[1.3] Supervisor listing users (should be 403)...")
    try:
        cookies = login('supervisor')
        resp = requests.get(f"{BASE_URL}/users", cookies=cookies, timeout=10)
        if resp.status_code == 403:
            print(f"✅ Supervisor: 403 - Correctly denied")
        else:
            print(f"❌ Supervisor: Expected 403, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Supervisor test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 1.4: Operator cannot list users (403)
    print("\n[1.4] Operator listing users (should be 403)...")
    try:
        cookies = login('operator')
        resp = requests.get(f"{BASE_URL}/users", cookies=cookies, timeout=10)
        if resp.status_code == 403:
            print(f"✅ Operator: 403 - Correctly denied")
        else:
            print(f"❌ Operator: Expected 403, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Operator test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 1.5: Unauthenticated request (401)
    print("\n[1.5] Unauthenticated request (should be 401)...")
    try:
        resp = requests.get(f"{BASE_URL}/users", timeout=10)
        if resp.status_code == 401:
            print(f"✅ Unauthenticated: 401 - Correctly denied")
        else:
            print(f"❌ Unauthenticated: Expected 401, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Unauthenticated test error: {str(e)}")

def test_create_user():
    """Test POST /api/users - Create new user"""
    print("\n" + "="*80)
    print("TEST 2: POST /api/users - Create User")
    print("="*80)
    
    # Test 2.1: Happy path - Admin creates operator user
    print("\n[2.1] Admin creating test user (happy path)...")
    try:
        cookies = login('admin')
        payload = {
            'name': 'Test User',
            'email': 'test1@lpi.co.id',
            'password': 'test123',
            'role': 'operator'
        }
        resp = requests.post(f"{BASE_URL}/users", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 201:
            data = resp.json()
            if 'data' in data and 'id' in data['data']:
                test_user_ids.append(data['data']['id'])
                print(f"✅ Admin: 201 - User created successfully")
                print(f"   User ID: {data['data']['id']}")
                print(f"   Email: {data['data']['email']}")
                print(f"   Role: {data['data']['role']}")
            else:
                print(f"❌ Admin: Invalid response structure - {data}")
        else:
            print(f"❌ Admin: Expected 201, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Admin create test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 2.2: Missing name field (400)
    print("\n[2.2] Missing name field (should be 400)...")
    try:
        cookies = login('admin')
        payload = {
            'email': 'test2@lpi.co.id',
            'password': 'test123',
            'role': 'operator'
        }
        resp = requests.post(f"{BASE_URL}/users", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 400:
            print(f"✅ Missing name: 400 - {resp.json().get('error', '')}")
        else:
            print(f"❌ Missing name: Expected 400, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Missing name test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 2.3: Missing email field (400)
    print("\n[2.3] Missing email field (should be 400)...")
    try:
        cookies = login('admin')
        payload = {
            'name': 'Test User',
            'password': 'test123',
            'role': 'operator'
        }
        resp = requests.post(f"{BASE_URL}/users", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 400:
            print(f"✅ Missing email: 400 - {resp.json().get('error', '')}")
        else:
            print(f"❌ Missing email: Expected 400, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Missing email test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 2.4: Missing password field (400)
    print("\n[2.4] Missing password field (should be 400)...")
    try:
        cookies = login('admin')
        payload = {
            'name': 'Test User',
            'email': 'test3@lpi.co.id',
            'role': 'operator'
        }
        resp = requests.post(f"{BASE_URL}/users", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 400:
            print(f"✅ Missing password: 400 - {resp.json().get('error', '')}")
        else:
            print(f"❌ Missing password: Expected 400, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Missing password test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 2.5: Missing role field (400)
    print("\n[2.5] Missing role field (should be 400)...")
    try:
        cookies = login('admin')
        payload = {
            'name': 'Test User',
            'email': 'test4@lpi.co.id',
            'password': 'test123'
        }
        resp = requests.post(f"{BASE_URL}/users", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 400:
            print(f"✅ Missing role: 400 - {resp.json().get('error', '')}")
        else:
            print(f"❌ Missing role: Expected 400, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Missing role test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 2.6: Password < 6 chars (400)
    print("\n[2.6] Password < 6 chars (should be 400)...")
    try:
        cookies = login('admin')
        payload = {
            'name': 'Test User',
            'email': 'test5@lpi.co.id',
            'password': 'abc',
            'role': 'operator'
        }
        resp = requests.post(f"{BASE_URL}/users", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 400:
            error_msg = resp.json().get('error', '')
            if '6' in error_msg or 'minimal' in error_msg.lower():
                print(f"✅ Short password: 400 - {error_msg}")
            else:
                print(f"⚠️ Short password: 400 but unexpected message - {error_msg}")
        else:
            print(f"❌ Short password: Expected 400, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Short password test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 2.7: Invalid role (400)
    print("\n[2.7] Invalid role 'hacker' (should be 400)...")
    try:
        cookies = login('admin')
        payload = {
            'name': 'Test User',
            'email': 'test6@lpi.co.id',
            'password': 'test123',
            'role': 'hacker'
        }
        resp = requests.post(f"{BASE_URL}/users", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 400:
            error_msg = resp.json().get('error', '')
            if 'role' in error_msg.lower():
                print(f"✅ Invalid role: 400 - {error_msg}")
            else:
                print(f"⚠️ Invalid role: 400 but unexpected message - {error_msg}")
        else:
            print(f"❌ Invalid role: Expected 400, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Invalid role test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 2.8: Duplicate email (400)
    print("\n[2.8] Duplicate email (should be 400)...")
    try:
        cookies = login('admin')
        payload = {
            'name': 'Test User Duplicate',
            'email': 'test1@lpi.co.id',  # Same as 2.1
            'password': 'test123',
            'role': 'operator'
        }
        resp = requests.post(f"{BASE_URL}/users", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 400:
            error_msg = resp.json().get('error', '')
            if 'email' in error_msg.lower() or 'terdaftar' in error_msg.lower():
                print(f"✅ Duplicate email: 400 - {error_msg}")
            else:
                print(f"⚠️ Duplicate email: 400 but unexpected message - {error_msg}")
        else:
            print(f"❌ Duplicate email: Expected 400, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Duplicate email test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 2.9: Supervisor cannot create user (403)
    print("\n[2.9] Supervisor creating user (should be 403)...")
    try:
        cookies = login('supervisor')
        payload = {
            'name': 'Test User',
            'email': 'test7@lpi.co.id',
            'password': 'test123',
            'role': 'operator'
        }
        resp = requests.post(f"{BASE_URL}/users", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 403:
            print(f"✅ Supervisor: 403 - Correctly denied")
        else:
            print(f"❌ Supervisor: Expected 403, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Supervisor test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 2.10: Direktur cannot create user (403)
    print("\n[2.10] Direktur creating user (should be 403)...")
    try:
        cookies = login('direktur')
        payload = {
            'name': 'Test User',
            'email': 'test8@lpi.co.id',
            'password': 'test123',
            'role': 'operator'
        }
        resp = requests.post(f"{BASE_URL}/users", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 403:
            print(f"✅ Direktur: 403 - Correctly denied")
        else:
            print(f"❌ Direktur: Expected 403, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Direktur test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 2.11: Operator cannot create user (403)
    print("\n[2.11] Operator creating user (should be 403)...")
    try:
        cookies = login('operator')
        payload = {
            'name': 'Test User',
            'email': 'test9@lpi.co.id',
            'password': 'test123',
            'role': 'operator'
        }
        resp = requests.post(f"{BASE_URL}/users", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 403:
            print(f"✅ Operator: 403 - Correctly denied")
        else:
            print(f"❌ Operator: Expected 403, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Operator test error: {str(e)}")

def test_update_user():
    """Test PATCH /api/users/:id - Update user"""
    print("\n" + "="*80)
    print("TEST 3: PATCH /api/users/:id - Update User")
    print("="*80)
    
    if not test_user_ids:
        print("❌ No test user available for update tests")
        return
    
    test_user_id = test_user_ids[0]
    
    # Test 3.1: Update name only (200)
    print("\n[3.1] Admin updating user name...")
    try:
        cookies = login('admin')
        payload = {'name': 'Test User Updated'}
        resp = requests.patch(f"{BASE_URL}/users/{test_user_id}", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data.get('data', {}).get('name') == 'Test User Updated':
                print(f"✅ Update name: 200 - Name updated successfully")
            else:
                print(f"⚠️ Update name: 200 but name not updated - {data}")
        else:
            print(f"❌ Update name: Expected 200, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Update name test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 3.2: Update role from operator -> supervisor (200)
    print("\n[3.2] Admin updating user role (operator -> supervisor)...")
    try:
        cookies = login('admin')
        payload = {'role': 'supervisor'}
        resp = requests.patch(f"{BASE_URL}/users/{test_user_id}", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data.get('data', {}).get('role') == 'supervisor':
                print(f"✅ Update role: 200 - Role updated to supervisor")
            else:
                print(f"⚠️ Update role: 200 but role not updated - {data}")
        else:
            print(f"❌ Update role: Expected 200, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Update role test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 3.3: Update status to inactive (200)
    print("\n[3.3] Admin updating user status to inactive...")
    try:
        cookies = login('admin')
        payload = {'status': 'inactive'}
        resp = requests.patch(f"{BASE_URL}/users/{test_user_id}", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data.get('data', {}).get('status') == 'inactive':
                print(f"✅ Update status: 200 - Status updated to inactive")
            else:
                print(f"⚠️ Update status: 200 but status not updated - {data}")
        else:
            print(f"❌ Update status: Expected 200, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Update status test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 3.4: Invalid role value (400)
    print("\n[3.4] Invalid role value 'superadmin' (should be 400)...")
    try:
        cookies = login('admin')
        payload = {'role': 'superadmin'}
        resp = requests.patch(f"{BASE_URL}/users/{test_user_id}", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 400:
            error_msg = resp.json().get('error', '')
            if 'role' in error_msg.lower():
                print(f"✅ Invalid role: 400 - {error_msg}")
            else:
                print(f"⚠️ Invalid role: 400 but unexpected message - {error_msg}")
        else:
            print(f"❌ Invalid role: Expected 400, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Invalid role test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 3.5: Invalid status value (400)
    print("\n[3.5] Invalid status value 'suspended' (should be 400)...")
    try:
        cookies = login('admin')
        payload = {'status': 'suspended'}
        resp = requests.patch(f"{BASE_URL}/users/{test_user_id}", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 400:
            error_msg = resp.json().get('error', '')
            if 'status' in error_msg.lower():
                print(f"✅ Invalid status: 400 - {error_msg}")
            else:
                print(f"⚠️ Invalid status: 400 but unexpected message - {error_msg}")
        else:
            print(f"❌ Invalid status: Expected 400, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Invalid status test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 3.6: Cannot modify own role (400)
    print("\n[3.6] Admin trying to modify own role (should be 400)...")
    try:
        cookies = login('admin')
        # Get admin ID from global variable set in test_get_users
        if 'admin_id' in globals():
            payload = {'role': 'operator'}
            resp = requests.patch(f"{BASE_URL}/users/{admin_id}", json=payload, cookies=cookies, timeout=10)
            if resp.status_code == 400:
                error_msg = resp.json().get('error', '')
                if 'sendiri' in error_msg.lower() or 'own' in error_msg.lower():
                    print(f"✅ Modify own role: 400 - {error_msg}")
                else:
                    print(f"⚠️ Modify own role: 400 but unexpected message - {error_msg}")
            else:
                print(f"❌ Modify own role: Expected 400, got {resp.status_code} - {resp.text}")
        else:
            print("⚠️ Admin ID not available, skipping test")
    except Exception as e:
        print(f"❌ Modify own role test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 3.7: Cannot set own status to inactive (400)
    print("\n[3.7] Admin trying to set own status to inactive (should be 400)...")
    try:
        cookies = login('admin')
        if 'admin_id' in globals():
            payload = {'status': 'inactive'}
            resp = requests.patch(f"{BASE_URL}/users/{admin_id}", json=payload, cookies=cookies, timeout=10)
            if resp.status_code == 400:
                error_msg = resp.json().get('error', '')
                if 'sendiri' in error_msg.lower() or 'own' in error_msg.lower():
                    print(f"✅ Modify own status: 400 - {error_msg}")
                else:
                    print(f"⚠️ Modify own status: 400 but unexpected message - {error_msg}")
            else:
                print(f"❌ Modify own status: Expected 400, got {resp.status_code} - {resp.text}")
        else:
            print("⚠️ Admin ID not available, skipping test")
    except Exception as e:
        print(f"❌ Modify own status test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 3.8: Non-existent user ID (404)
    print("\n[3.8] Updating non-existent user (should be 404)...")
    try:
        cookies = login('admin')
        fake_id = 'non-existent-user-id-12345'
        payload = {'name': 'Test'}
        resp = requests.patch(f"{BASE_URL}/users/{fake_id}", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 404:
            print(f"✅ Non-existent user: 404 - {resp.json().get('error', '')}")
        else:
            print(f"❌ Non-existent user: Expected 404, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Non-existent user test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 3.9: Non-admin cannot update (403)
    print("\n[3.9] Supervisor updating user (should be 403)...")
    try:
        cookies = login('supervisor')
        payload = {'name': 'Test'}
        resp = requests.patch(f"{BASE_URL}/users/{test_user_id}", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 403:
            print(f"✅ Supervisor: 403 - Correctly denied")
        else:
            print(f"❌ Supervisor: Expected 403, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Supervisor test error: {str(e)}")

def test_reset_password():
    """Test POST /api/users/:id/reset-password - Reset password"""
    print("\n" + "="*80)
    print("TEST 4: POST /api/users/:id/reset-password - Reset Password")
    print("="*80)
    
    if not test_user_ids:
        print("❌ No test user available for password reset tests")
        return
    
    test_user_id = test_user_ids[0]
    
    # Test 4.1: Reset password to "newpass123" (200)
    print("\n[4.1] Admin resetting user password to 'newpass123'...")
    try:
        cookies = login('admin')
        payload = {'newPassword': 'newpass123'}
        resp = requests.post(f"{BASE_URL}/users/{test_user_id}/reset-password", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data.get('ok') == True:
                print(f"✅ Reset password: 200 - Password reset successful")
            else:
                print(f"⚠️ Reset password: 200 but unexpected response - {data}")
        else:
            print(f"❌ Reset password: Expected 200, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Reset password test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 4.2: Verify user can login with new password
    print("\n[4.2] Verifying user can login with new password...")
    try:
        login_payload = {'email': 'test1@lpi.co.id', 'password': 'newpass123'}
        resp = requests.post(AUTH_URL, json=login_payload, timeout=10)
        if resp.status_code == 200:
            print(f"✅ Login with new password: 200 - Login successful")
        else:
            print(f"❌ Login with new password: Expected 200, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Login verification test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 4.3: Password < 6 chars (400)
    print("\n[4.3] Reset password with < 6 chars (should be 400)...")
    try:
        cookies = login('admin')
        payload = {'newPassword': 'abc'}
        resp = requests.post(f"{BASE_URL}/users/{test_user_id}/reset-password", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 400:
            error_msg = resp.json().get('error', '')
            if '6' in error_msg or 'minimal' in error_msg.lower():
                print(f"✅ Short password: 400 - {error_msg}")
            else:
                print(f"⚠️ Short password: 400 but unexpected message - {error_msg}")
        else:
            print(f"❌ Short password: Expected 400, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Short password test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 4.4: Non-existent user (404)
    print("\n[4.4] Reset password for non-existent user (should be 404)...")
    try:
        cookies = login('admin')
        fake_id = 'non-existent-user-id-12345'
        payload = {'newPassword': 'newpass123'}
        resp = requests.post(f"{BASE_URL}/users/{fake_id}/reset-password", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 404:
            print(f"✅ Non-existent user: 404 - {resp.json().get('error', '')}")
        else:
            print(f"❌ Non-existent user: Expected 404, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Non-existent user test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 4.5: Non-admin cannot reset password (403)
    print("\n[4.5] Supervisor resetting password (should be 403)...")
    try:
        cookies = login('supervisor')
        payload = {'newPassword': 'newpass123'}
        resp = requests.post(f"{BASE_URL}/users/{test_user_id}/reset-password", json=payload, cookies=cookies, timeout=10)
        if resp.status_code == 403:
            print(f"✅ Supervisor: 403 - Correctly denied")
        else:
            print(f"❌ Supervisor: Expected 403, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Supervisor test error: {str(e)}")

def test_delete_user():
    """Test DELETE /api/users/:id - Delete user"""
    print("\n" + "="*80)
    print("TEST 5: DELETE /api/users/:id - Delete User")
    print("="*80)
    
    if not test_user_ids:
        print("❌ No test user available for delete tests")
        return
    
    test_user_id = test_user_ids[0]
    
    # Test 5.1: Cannot delete self (400)
    print("\n[5.1] Admin trying to delete own account (should be 400)...")
    try:
        cookies = login('admin')
        if 'admin_id' in globals():
            resp = requests.delete(f"{BASE_URL}/users/{admin_id}", cookies=cookies, timeout=10)
            if resp.status_code == 400:
                error_msg = resp.json().get('error', '')
                if 'sendiri' in error_msg.lower() or 'self' in error_msg.lower():
                    print(f"✅ Delete self: 400 - {error_msg}")
                else:
                    print(f"⚠️ Delete self: 400 but unexpected message - {error_msg}")
            else:
                print(f"❌ Delete self: Expected 400, got {resp.status_code} - {resp.text}")
        else:
            print("⚠️ Admin ID not available, skipping test")
    except Exception as e:
        print(f"❌ Delete self test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 5.2: Non-existent user (404)
    print("\n[5.2] Deleting non-existent user (should be 404)...")
    try:
        cookies = login('admin')
        fake_id = 'non-existent-user-id-12345'
        resp = requests.delete(f"{BASE_URL}/users/{fake_id}", cookies=cookies, timeout=10)
        if resp.status_code == 404:
            print(f"✅ Non-existent user: 404 - {resp.json().get('error', '')}")
        else:
            print(f"❌ Non-existent user: Expected 404, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Non-existent user test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 5.3: Non-admin cannot delete (403)
    print("\n[5.3] Supervisor deleting user (should be 403)...")
    try:
        cookies = login('supervisor')
        resp = requests.delete(f"{BASE_URL}/users/{test_user_id}", cookies=cookies, timeout=10)
        if resp.status_code == 403:
            print(f"✅ Supervisor: 403 - Correctly denied")
        else:
            print(f"❌ Supervisor: Expected 403, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Supervisor test error: {str(e)}")
    
    time.sleep(0.5)
    
    # Test 5.4: Admin can delete test user (200)
    print("\n[5.4] Admin deleting test user...")
    try:
        cookies = login('admin')
        resp = requests.delete(f"{BASE_URL}/users/{test_user_id}", cookies=cookies, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data.get('ok') == True:
                print(f"✅ Delete user: 200 - User deleted successfully")
                test_user_ids.remove(test_user_id)
            else:
                print(f"⚠️ Delete user: 200 but unexpected response - {data}")
        else:
            print(f"❌ Delete user: Expected 200, got {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"❌ Delete user test error: {str(e)}")

def test_regression():
    """Test existing endpoints to ensure they still work"""
    print("\n" + "="*80)
    print("TEST 6: REGRESSION CHECK - Existing Endpoints")
    print("="*80)
    
    cookies = login('admin')
    
    endpoints = [
        '/contacts',
        '/products',
        '/dashboard/summary',
        '/sales-orders',
        '/purchase-orders'
    ]
    
    for endpoint in endpoints:
        print(f"\n[6.{endpoints.index(endpoint)+1}] Testing GET {endpoint}...")
        try:
            resp = requests.get(f"{BASE_URL}{endpoint}", cookies=cookies, timeout=10)
            if resp.status_code == 200:
                print(f"✅ {endpoint}: 200 - Still working")
            else:
                print(f"❌ {endpoint}: Expected 200, got {resp.status_code} - {resp.text}")
        except Exception as e:
            print(f"❌ {endpoint} test error: {str(e)}")
        time.sleep(0.5)

def cleanup():
    """Delete any remaining test users"""
    print("\n" + "="*80)
    print("CLEANUP: Deleting remaining test users")
    print("="*80)
    
    if not test_user_ids:
        print("✅ No test users to clean up")
        return
    
    cookies = login('admin')
    for user_id in test_user_ids[:]:
        print(f"\nDeleting test user {user_id}...")
        try:
            resp = requests.delete(f"{BASE_URL}/users/{user_id}", cookies=cookies, timeout=10)
            if resp.status_code == 200:
                print(f"✅ Deleted user {user_id}")
                test_user_ids.remove(user_id)
            else:
                print(f"⚠️ Failed to delete user {user_id}: {resp.status_code}")
        except Exception as e:
            print(f"❌ Error deleting user {user_id}: {str(e)}")
        time.sleep(0.5)

def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("USER MANAGEMENT API - COMPREHENSIVE BACKEND TESTING")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    try:
        # Run all tests
        test_get_users()
        test_create_user()
        test_update_user()
        test_reset_password()
        test_delete_user()
        test_regression()
        
        # Cleanup
        cleanup()
        
        print("\n" + "="*80)
        print("ALL TESTS COMPLETED")
        print("="*80)
        print(f"Finished at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
    except KeyboardInterrupt:
        print("\n\n⚠️ Tests interrupted by user")
        cleanup()
    except Exception as e:
        print(f"\n\n❌ Unexpected error: {str(e)}")
        cleanup()

if __name__ == '__main__':
    main()
