#!/usr/bin/env python3
"""
Backend test for Agentic AI Assistant (LPI ERP)
Tests /api/ai/chat and /api/ai/execute endpoints
"""

import requests
import json
import time
import sys

# Configuration
BASE_URL = "http://localhost:3000"
API_BASE = f"{BASE_URL}/api"

# Test credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
SUPERVISOR_EMAIL = "supervisor@lpi.co.id"
SUPERVISOR_PASSWORD = "super123"
DIREKTUR_EMAIL = "direktur@lpi.co.id"
DIREKTUR_PASSWORD = "direktur123"
OPERATOR_EMAIL = "operator@lpi.co.id"
OPERATOR_PASSWORD = "operator123"

# Test results
test_results = []

def log_test(test_name, passed, details=""):
    """Log test result"""
    status = "✅ PASSED" if passed else "❌ FAILED"
    print(f"\n{status}: {test_name}")
    if details:
        print(f"  Details: {details}")
    test_results.append({
        "test": test_name,
        "passed": passed,
        "details": details
    })

def login(email, password):
    """Login via Better Auth and return session"""
    try:
        response = requests.post(
            f"{API_BASE}/auth/sign-in/email",
            json={"email": email, "password": password},
            timeout=10
        )
        if response.status_code == 200:
            # Better Auth returns session cookie
            return requests.Session(), response.cookies
        else:
            print(f"Login failed for {email}: {response.status_code} {response.text[:200]}")
            return None, None
    except Exception as e:
        print(f"Login exception for {email}: {e}")
        return None, None

def test_a_auth_guard():
    """Test A: POST /api/ai/chat without session -> 401"""
    print("\n" + "="*80)
    print("TEST A: Auth guard - POST /api/ai/chat without session")
    print("="*80)
    
    try:
        response = requests.post(
            f"{API_BASE}/ai/chat",
            json={"message": "Test", "sessionId": "test", "history": []},
            timeout=10
        )
        
        if response.status_code == 401:
            log_test("A. Auth guard (401 without session)", True, f"Got 401 as expected")
            return True
        else:
            log_test("A. Auth guard (401 without session)", False, 
                    f"Expected 401, got {response.status_code}: {response.text[:200]}")
            return False
    except Exception as e:
        log_test("A. Auth guard (401 without session)", False, f"Exception: {e}")
        return False

def test_b_admin_read_business_overview(session, cookies):
    """Test B: Admin READ query - business overview"""
    print("\n" + "="*80)
    print("TEST B: Admin READ query - Ringkasan bisnis keseluruhan")
    print("="*80)
    
    try:
        # Set cookies on session
        for cookie in cookies:
            session.cookies.set(cookie.name, cookie.value)
        
        response = session.post(
            f"{API_BASE}/ai/chat",
            json={
                "message": "Ringkasan bisnis keseluruhan",
                "sessionId": "test-b",
                "history": []
            },
            timeout=90  # Generous timeout for LLM
        )
        
        print(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            log_test("B. Admin READ query (business overview)", False, 
                    f"Expected 200, got {response.status_code}: {response.text[:500]}")
            return False
        
        data = response.json()
        print(f"Response keys: {data.keys()}")
        
        # Check response structure
        if not data.get("ok"):
            log_test("B. Admin READ query (business overview)", False, 
                    f"ok=false in response: {json.dumps(data, indent=2)[:500]}")
            return False
        
        answer = data.get("answer", "")
        if not answer or not isinstance(answer, str) or len(answer.strip()) == 0:
            log_test("B. Admin READ query (business overview)", False, 
                    f"answer is empty or not a string: {answer}")
            return False
        
        if not isinstance(data.get("pendingActions"), list):
            log_test("B. Admin READ query (business overview)", False, 
                    f"pendingActions is not a list: {data.get('pendingActions')}")
            return False
        
        if data.get("canWrite") != True:
            log_test("B. Admin READ query (business overview)", False, 
                    f"canWrite should be true for admin: {data.get('canWrite')}")
            return False
        
        # For read query, pendingActions should be empty
        if len(data.get("pendingActions", [])) > 0:
            print(f"  Note: pendingActions not empty for read query (may be OK if LLM suggested actions): {data.get('pendingActions')}")
        
        log_test("B. Admin READ query (business overview)", True, 
                f"ok=true, answer length={len(answer)}, canWrite=true, pendingActions={len(data.get('pendingActions', []))}")
        print(f"  Answer preview: {answer[:200]}...")
        return True
        
    except Exception as e:
        log_test("B. Admin READ query (business overview)", False, f"Exception: {e}")
        return False

def test_c_admin_read_sales_orders(session, cookies):
    """Test C: Admin READ query 2 - 5 sales orders"""
    print("\n" + "="*80)
    print("TEST C: Admin READ query 2 - Tampilkan 5 sales order terbaru")
    print("="*80)
    
    try:
        # Set cookies on session
        for cookie in cookies:
            session.cookies.set(cookie.name, cookie.value)
        
        response = session.post(
            f"{API_BASE}/ai/chat",
            json={
                "message": "Tampilkan 5 sales order terbaru",
                "sessionId": "test-c",
                "history": []
            },
            timeout=90
        )
        
        print(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            log_test("C. Admin READ query 2 (sales orders)", False, 
                    f"Expected 200, got {response.status_code}: {response.text[:500]}")
            return False
        
        data = response.json()
        
        if not data.get("ok"):
            log_test("C. Admin READ query 2 (sales orders)", False, 
                    f"ok=false in response: {json.dumps(data, indent=2)[:500]}")
            return False
        
        answer = data.get("answer", "")
        if not answer or not isinstance(answer, str) or len(answer.strip()) == 0:
            log_test("C. Admin READ query 2 (sales orders)", False, 
                    f"answer is empty or not a string: {answer}")
            return False
        
        log_test("C. Admin READ query 2 (sales orders)", True, 
                f"ok=true, answer length={len(answer)}")
        print(f"  Answer preview: {answer[:200]}...")
        return True
        
    except Exception as e:
        log_test("C. Admin READ query 2 (sales orders)", False, f"Exception: {e}")
        return False

def test_d_admin_write_create_contact(session, cookies):
    """Test D: Admin WRITE - create contact + execute + verify"""
    print("\n" + "="*80)
    print("TEST D: Admin WRITE - Create contact 'Toko Uji AI'")
    print("="*80)
    
    try:
        # Set cookies on session
        for cookie in cookies:
            session.cookies.set(cookie.name, cookie.value)
        
        # Step 1: Request contact creation via chat
        print("\nStep 1: Request contact creation via /api/ai/chat")
        response = session.post(
            f"{API_BASE}/ai/chat",
            json={
                "message": "Buatkan kontak baru bernama Toko Uji AI kategori Customer, telepon 08123456789",
                "sessionId": "test-d",
                "history": []
            },
            timeout=90
        )
        
        print(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            log_test("D. Admin WRITE (create contact)", False, 
                    f"Chat request failed: {response.status_code}: {response.text[:500]}")
            return False
        
        data = response.json()
        
        if not data.get("ok"):
            log_test("D. Admin WRITE (create contact)", False, 
                    f"ok=false in chat response: {json.dumps(data, indent=2)[:500]}")
            return False
        
        pending_actions = data.get("pendingActions", [])
        if len(pending_actions) == 0:
            log_test("D. Admin WRITE (create contact)", False, 
                    f"No pendingActions returned. Response: {json.dumps(data, indent=2)[:500]}")
            return False
        
        # Find create_contact action
        create_action = None
        for action in pending_actions:
            if action.get("action", {}).get("type") == "create_contact":
                create_action = action
                break
        
        if not create_action:
            log_test("D. Admin WRITE (create contact)", False, 
                    f"No create_contact action in pendingActions: {json.dumps(pending_actions, indent=2)[:500]}")
            return False
        
        print(f"  Found create_contact action: {json.dumps(create_action, indent=2)}")
        
        # Step 2: Execute the action
        print("\nStep 2: Execute action via /api/ai/execute")
        exec_response = session.post(
            f"{API_BASE}/ai/execute",
            json={"action": create_action["action"]},
            timeout=10
        )
        
        print(f"Execute response status: {exec_response.status_code}")
        
        if exec_response.status_code != 200:
            log_test("D. Admin WRITE (create contact)", False, 
                    f"Execute failed: {exec_response.status_code}: {exec_response.text[:500]}")
            return False
        
        exec_data = exec_response.json()
        print(f"Execute response: {json.dumps(exec_data, indent=2)}")
        
        if not exec_data.get("ok"):
            log_test("D. Admin WRITE (create contact)", False, 
                    f"Execute ok=false: {json.dumps(exec_data, indent=2)}")
            return False
        
        if "berhasil" not in exec_data.get("message", "").lower():
            print(f"  Warning: Success message may not contain 'berhasil': {exec_data.get('message')}")
        
        # Step 3: Verify contact exists
        print("\nStep 3: Verify contact exists via GET /api/contacts")
        time.sleep(0.5)  # Brief delay for DB consistency
        
        verify_response = session.get(
            f"{API_BASE}/contacts?search=Toko Uji AI",
            timeout=10
        )
        
        print(f"Verify response status: {verify_response.status_code}")
        
        if verify_response.status_code != 200:
            log_test("D. Admin WRITE (create contact)", False, 
                    f"Verify failed: {verify_response.status_code}: {verify_response.text[:500]}")
            return False
        
        verify_data = verify_response.json()
        
        # Check if contact exists in response
        contacts = verify_data.get("data", [])
        found = False
        for contact in contacts:
            if "Toko Uji AI" in contact.get("displayName", ""):
                found = True
                print(f"  Found contact: {contact.get('displayName')} (code: {contact.get('code')})")
                break
        
        if not found:
            log_test("D. Admin WRITE (create contact)", False, 
                    f"Contact 'Toko Uji AI' not found in database. Contacts: {json.dumps(contacts, indent=2)[:500]}")
            return False
        
        log_test("D. Admin WRITE (create contact)", True, 
                f"Contact created and verified in DB")
        return True
        
    except Exception as e:
        log_test("D. Admin WRITE (create contact)", False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_e_admin_write_archive_product(session, cookies):
    """Test E: Admin WRITE - archive product"""
    print("\n" + "="*80)
    print("TEST E: Admin WRITE - Archive product")
    print("="*80)
    
    try:
        # Set cookies on session
        for cookie in cookies:
            session.cookies.set(cookie.name, cookie.value)
        
        # Step 1: Get an existing active product
        print("\nStep 1: Get existing active product via GET /api/products")
        products_response = session.get(
            f"{API_BASE}/products?limit=5",
            timeout=10
        )
        
        if products_response.status_code != 200:
            log_test("E. Admin WRITE (archive product)", False, 
                    f"Failed to get products: {products_response.status_code}")
            return False
        
        products_data = products_response.json()
        products = products_data.get("data", [])
        
        if len(products) == 0:
            log_test("E. Admin WRITE (archive product)", False, 
                    f"No products found to archive")
            return False
        
        # Use first product
        product = products[0]
        product_name = product.get("name", "")
        product_sku = product.get("sku", "")
        
        print(f"  Using product: {product_name} (SKU: {product_sku})")
        
        # Step 2: Request archive via chat
        print("\nStep 2: Request archive via /api/ai/chat")
        response = session.post(
            f"{API_BASE}/ai/chat",
            json={
                "message": f"Arsipkan produk {product_sku}",
                "sessionId": "test-e",
                "history": []
            },
            timeout=90
        )
        
        print(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            log_test("E. Admin WRITE (archive product)", False, 
                    f"Chat request failed: {response.status_code}: {response.text[:500]}")
            return False
        
        data = response.json()
        
        if not data.get("ok"):
            log_test("E. Admin WRITE (archive product)", False, 
                    f"ok=false in chat response: {json.dumps(data, indent=2)[:500]}")
            return False
        
        pending_actions = data.get("pendingActions", [])
        if len(pending_actions) == 0:
            log_test("E. Admin WRITE (archive product)", False, 
                    f"No pendingActions returned. Response: {json.dumps(data, indent=2)[:500]}")
            return False
        
        # Find archive_record action
        archive_action = None
        for action in pending_actions:
            if action.get("action", {}).get("type") == "archive_record":
                archive_action = action
                break
        
        if not archive_action:
            log_test("E. Admin WRITE (archive product)", False, 
                    f"No archive_record action in pendingActions: {json.dumps(pending_actions, indent=2)[:500]}")
            return False
        
        print(f"  Found archive_record action: {json.dumps(archive_action, indent=2)}")
        
        # Step 3: Execute the action
        print("\nStep 3: Execute action via /api/ai/execute")
        exec_response = session.post(
            f"{API_BASE}/ai/execute",
            json={"action": archive_action["action"]},
            timeout=10
        )
        
        print(f"Execute response status: {exec_response.status_code}")
        
        if exec_response.status_code != 200:
            log_test("E. Admin WRITE (archive product)", False, 
                    f"Execute failed: {exec_response.status_code}: {exec_response.text[:500]}")
            return False
        
        exec_data = exec_response.json()
        print(f"Execute response: {json.dumps(exec_data, indent=2)}")
        
        if not exec_data.get("ok"):
            log_test("E. Admin WRITE (archive product)", False, 
                    f"Execute ok=false: {json.dumps(exec_data, indent=2)}")
            return False
        
        log_test("E. Admin WRITE (archive product)", True, 
                f"Product archived successfully")
        
        # Optional: Restore the product to leave data clean
        print("\nOptional: Restore product to leave data clean")
        restore_response = session.post(
            f"{API_BASE}/ai/chat",
            json={
                "message": f"Pulihkan produk {product_sku}",
                "sessionId": "test-e-restore",
                "history": []
            },
            timeout=90
        )
        
        if restore_response.status_code == 200:
            restore_data = restore_response.json()
            restore_actions = restore_data.get("pendingActions", [])
            for action in restore_actions:
                if action.get("action", {}).get("type") == "restore_record":
                    session.post(
                        f"{API_BASE}/ai/execute",
                        json={"action": action["action"]},
                        timeout=10
                    )
                    print(f"  Product restored")
                    break
        
        return True
        
    except Exception as e:
        log_test("E. Admin WRITE (archive product)", False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_f_rbac_direktur_write_block(direktur_session, direktur_cookies):
    """Test F: RBAC - direktur cannot execute write actions"""
    print("\n" + "="*80)
    print("TEST F: RBAC - Direktur write block")
    print("="*80)
    
    try:
        # Set cookies on session
        for cookie in direktur_cookies:
            direktur_session.cookies.set(cookie.name, cookie.value)
        
        # Test F1: Direct execute should return 403
        print("\nTest F1: Direct execute with create_contact action -> 403")
        exec_response = direktur_session.post(
            f"{API_BASE}/ai/execute",
            json={
                "action": {
                    "type": "create_contact",
                    "args": {
                        "displayName": "X Direktur",
                        "category": "Customer"
                    }
                }
            },
            timeout=10
        )
        
        print(f"Execute response status: {exec_response.status_code}")
        
        if exec_response.status_code != 403:
            log_test("F. RBAC direktur write block (direct execute)", False, 
                    f"Expected 403, got {exec_response.status_code}: {exec_response.text[:500]}")
            return False
        
        print(f"  ✓ Got 403 as expected for direktur execute")
        
        # Test F2: Chat should not produce write actions
        print("\nTest F2: Chat with write request -> no pendingActions (direktur has no write tools)")
        chat_response = direktur_session.post(
            f"{API_BASE}/ai/chat",
            json={
                "message": "Buatkan kontak baru bernama Z",
                "sessionId": "test-f",
                "history": []
            },
            timeout=90
        )
        
        print(f"Chat response status: {chat_response.status_code}")
        
        if chat_response.status_code != 200:
            log_test("F. RBAC direktur write block (chat)", False, 
                    f"Chat failed: {chat_response.status_code}: {chat_response.text[:500]}")
            return False
        
        chat_data = chat_response.json()
        
        if not chat_data.get("ok"):
            log_test("F. RBAC direktur write block (chat)", False, 
                    f"ok=false in chat response: {json.dumps(chat_data, indent=2)[:500]}")
            return False
        
        pending_actions = chat_data.get("pendingActions", [])
        
        # Direktur should not have write tools, so no create_contact action should be produced
        has_write_action = False
        for action in pending_actions:
            action_type = action.get("action", {}).get("type", "")
            if action_type in ["create_contact", "create_product", "update_order_status", "archive_record", "restore_record"]:
                has_write_action = True
                break
        
        if has_write_action:
            log_test("F. RBAC direktur write block (chat)", False, 
                    f"Direktur should not have write tools, but got write action: {json.dumps(pending_actions, indent=2)[:500]}")
            return False
        
        print(f"  ✓ No write actions produced for direktur (as expected)")
        print(f"  Answer: {chat_data.get('answer', '')[:200]}...")
        
        log_test("F. RBAC direktur write block", True, 
                f"Direktur correctly blocked from write actions (403 on execute, no write tools in chat)")
        return True
        
    except Exception as e:
        log_test("F. RBAC direktur write block", False, f"Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_g_direktur_read_works(direktur_session, direktur_cookies):
    """Test G: Direktur READ still works"""
    print("\n" + "="*80)
    print("TEST G: Direktur READ query - Ada berapa produk aktif?")
    print("="*80)
    
    try:
        # Set cookies on session
        for cookie in direktur_cookies:
            direktur_session.cookies.set(cookie.name, cookie.value)
        
        response = direktur_session.post(
            f"{API_BASE}/ai/chat",
            json={
                "message": "Ada berapa produk aktif?",
                "sessionId": "test-g",
                "history": []
            },
            timeout=90
        )
        
        print(f"Response status: {response.status_code}")
        
        if response.status_code != 200:
            log_test("G. Direktur READ query", False, 
                    f"Expected 200, got {response.status_code}: {response.text[:500]}")
            return False
        
        data = response.json()
        
        if not data.get("ok"):
            log_test("G. Direktur READ query", False, 
                    f"ok=false in response: {json.dumps(data, indent=2)[:500]}")
            return False
        
        answer = data.get("answer", "")
        if not answer or not isinstance(answer, str) or len(answer.strip()) == 0:
            log_test("G. Direktur READ query", False, 
                    f"answer is empty or not a string: {answer}")
            return False
        
        log_test("G. Direktur READ query", True, 
                f"ok=true, answer length={len(answer)}")
        print(f"  Answer preview: {answer[:200]}...")
        return True
        
    except Exception as e:
        log_test("G. Direktur READ query", False, f"Exception: {e}")
        return False

def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("AGENTIC AI ASSISTANT BACKEND TESTS")
    print("="*80)
    
    # Test A: Auth guard (no login needed)
    test_a_auth_guard()
    
    # Login as admin
    print("\n" + "="*80)
    print("Logging in as ADMIN")
    print("="*80)
    admin_session, admin_cookies = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_session:
        print("❌ CRITICAL: Failed to login as admin. Cannot continue.")
        sys.exit(1)
    print("✅ Admin login successful")
    
    # Test B: Admin READ query (business overview)
    test_b_admin_read_business_overview(admin_session, admin_cookies)
    
    # Test C: Admin READ query 2 (sales orders)
    test_c_admin_read_sales_orders(admin_session, admin_cookies)
    
    # Test D: Admin WRITE (create contact)
    test_d_admin_write_create_contact(admin_session, admin_cookies)
    
    # Test E: Admin WRITE (archive product)
    test_e_admin_write_archive_product(admin_session, admin_cookies)
    
    # Login as direktur
    print("\n" + "="*80)
    print("Logging in as DIREKTUR")
    print("="*80)
    direktur_session, direktur_cookies = login(DIREKTUR_EMAIL, DIREKTUR_PASSWORD)
    if not direktur_session:
        print("❌ WARNING: Failed to login as direktur. Skipping RBAC tests.")
    else:
        print("✅ Direktur login successful")
        
        # Test F: RBAC - direktur write block
        test_f_rbac_direktur_write_block(direktur_session, direktur_cookies)
        
        # Test G: Direktur READ still works
        test_g_direktur_read_works(direktur_session, direktur_cookies)
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for r in test_results if r["passed"])
    total = len(test_results)
    
    print(f"\nTotal: {passed}/{total} tests passed ({100*passed//total if total > 0 else 0}%)\n")
    
    for result in test_results:
        status = "✅" if result["passed"] else "❌"
        print(f"{status} {result['test']}")
        if result["details"]:
            print(f"   {result['details']}")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
