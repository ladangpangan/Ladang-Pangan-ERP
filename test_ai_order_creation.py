#!/usr/bin/env python3
"""
Backend test for AI Order Creation (PO/SO) via chat
Tests /api/ai/chat and /api/ai/execute for create_purchase_order and create_sales_order
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
DIREKTUR_EMAIL = "direktur@lpi.co.id"
DIREKTUR_PASSWORD = "direktur123"

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
            session = requests.Session()
            for cookie in response.cookies:
                session.cookies.set(cookie.name, cookie.value)
            return session
        else:
            print(f"Login failed for {email}: {response.status_code} {response.text[:200]}")
            return None
    except Exception as e:
        print(f"Login exception for {email}: {e}")
        return None

def test_0_setup_get_real_data(session):
    """Test 0: Get real product, supplier, and customer data"""
    print("\n" + "="*80)
    print("TEST 0: Setup - Get real product, supplier, and customer data")
    print("="*80)
    
    try:
        # Get products
        print("\nFetching products...")
        response = session.get(f"{API_BASE}/products", timeout=10)
        if response.status_code != 200:
            log_test("0. Setup - Get real data", False, f"Failed to get products: {response.status_code}")
            return None, None, None, None, None, None
        
        products_data = response.json()
        products = products_data.get('data', []) if isinstance(products_data, dict) else products_data
        if not products or len(products) == 0:
            log_test("0. Setup - Get real data", False, "No products found")
            return None, None, None, None, None, None
        
        # Pick first active product
        product = None
        for p in products:
            if p.get('status') == 'Active':
                product = p
                break
        
        if not product:
            product = products[0]  # Fallback to first product
        
        product_name = product.get('name', '')
        product_sku = product.get('sku', '')
        print(f"  Selected product: {product_name} (SKU: {product_sku})")
        
        # Get contacts - try with type filter first
        print("\nFetching suppliers...")
        response = session.get(f"{API_BASE}/contacts?type=Supplier", timeout=10)
        if response.status_code != 200:
            log_test("0. Setup - Get real data", False, f"Failed to get suppliers: {response.status_code}")
            return None, None, None, None, None, None
        
        suppliers_data = response.json()
        suppliers = suppliers_data.get('data', []) if isinstance(suppliers_data, dict) else suppliers_data
        if not suppliers or len(suppliers) == 0:
            # Try without filter
            response = session.get(f"{API_BASE}/contacts", timeout=10)
            if response.status_code == 200:
                all_contacts_data = response.json()
                all_contacts = all_contacts_data.get('data', []) if isinstance(all_contacts_data, dict) else all_contacts_data
                suppliers = [c for c in all_contacts if 'Supplier' in c.get('categories', [])]
        
        if not suppliers or len(suppliers) == 0:
            log_test("0. Setup - Get real data", False, "No suppliers found")
            return None, None, None, None, None, None
        
        supplier = suppliers[0]
        supplier_name = supplier.get('displayName', '')
        print(f"  Selected supplier: {supplier_name}")
        
        # Get customers
        print("\nFetching customers...")
        response = session.get(f"{API_BASE}/contacts?type=Customer", timeout=10)
        if response.status_code != 200:
            log_test("0. Setup - Get real data", False, f"Failed to get customers: {response.status_code}")
            return None, None, None, None, None, None
        
        customers_data = response.json()
        customers = customers_data.get('data', []) if isinstance(customers_data, dict) else customers_data
        if not customers or len(customers) == 0:
            # Try without filter
            response = session.get(f"{API_BASE}/contacts", timeout=10)
            if response.status_code == 200:
                all_contacts_data = response.json()
                all_contacts = all_contacts_data.get('data', []) if isinstance(all_contacts_data, dict) else all_contacts_data
                customers = [c for c in all_contacts if 'Customer' in c.get('categories', [])]
        
        if not customers or len(customers) == 0:
            log_test("0. Setup - Get real data", False, "No customers found")
            return None, None, None, None, None, None
        
        customer = customers[0]
        customer_name = customer.get('displayName', '')
        print(f"  Selected customer: {customer_name}")
        
        log_test("0. Setup - Get real data", True, 
                f"Product: {product_name}, Supplier: {supplier_name}, Customer: {customer_name}")
        
        return product_name, product_sku, supplier_name, customer_name, supplier, customer
        
    except Exception as e:
        log_test("0. Setup - Get real data", False, f"Exception: {e}")
        return None, None, None, None, None, None

def test_1_create_po_via_chat(session, supplier_name, product_name):
    """Test 1: Create Purchase Order via chat"""
    print("\n" + "="*80)
    print("TEST 1: Create Purchase Order via chat")
    print("="*80)
    
    try:
        # Step 1: Chat to create PO
        message = f"Buatkan draft purchase order ke supplier {supplier_name}, isi 100 kg {product_name} harga 25000 per kg"
        print(f"\nSending chat message: {message}")
        
        response = session.post(
            f"{API_BASE}/ai/chat",
            json={
                "message": message,
                "sessionId": "po1",
                "history": []
            },
            timeout=90  # 90s timeout for LLM
        )
        
        if response.status_code != 200:
            log_test("1. Create PO via chat", False, 
                    f"Chat failed: {response.status_code} {response.text[:500]}")
            return None
        
        data = response.json()
        print(f"\nChat response received")
        print(f"  ok: {data.get('ok')}")
        print(f"  answer length: {len(data.get('answer', ''))}")
        print(f"  pendingActions count: {len(data.get('pendingActions', []))}")
        
        # Verify structure
        if not data.get('ok'):
            log_test("1. Create PO via chat", False, "Response ok=false")
            return None
        
        pending_actions = data.get('pendingActions', [])
        if len(pending_actions) == 0:
            log_test("1. Create PO via chat", False, 
                    f"No pendingActions returned. Answer: {data.get('answer', '')[:500]}")
            return None
        
        action_obj = pending_actions[0]
        action = action_obj.get('action', {})
        action_type = action.get('type', '')
        
        print(f"  action.type: {action_type}")
        print(f"  action.args keys: {list(action.get('args', {}).keys())}")
        
        if action_type != 'create_purchase_order':
            log_test("1. Create PO via chat", False, 
                    f"Expected action.type='create_purchase_order', got '{action_type}'")
            return None
        
        args = action.get('args', {})
        supplier_id = args.get('supplierId', '')
        items = args.get('items', [])
        
        if not supplier_id:
            log_test("1. Create PO via chat", False, "args.supplierId is empty")
            return None
        
        if len(items) == 0:
            log_test("1. Create PO via chat", False, "args.items is empty")
            return None
        
        if not items[0].get('productId'):
            log_test("1. Create PO via chat", False, "items[0].productId is empty")
            return None
        
        print(f"  supplierId: {supplier_id}")
        print(f"  items count: {len(items)}")
        print(f"  items[0].productId: {items[0].get('productId')}")
        
        log_test("1. Create PO via chat - structure", True, 
                f"Got pendingAction with type=create_purchase_order, supplierId={supplier_id}, items={len(items)}")
        
        return action
        
    except Exception as e:
        log_test("1. Create PO via chat", False, f"Exception: {e}")
        return None

def test_2_execute_po_creation(session, action):
    """Test 2: Execute PO creation"""
    print("\n" + "="*80)
    print("TEST 2: Execute PO creation")
    print("="*80)
    
    try:
        print("\nExecuting PO creation...")
        response = session.post(
            f"{API_BASE}/ai/execute",
            json={"action": action},
            timeout=30
        )
        
        if response.status_code != 200:
            log_test("2. Execute PO creation", False, 
                    f"Execute failed: {response.status_code} {response.text[:500]}")
            return None
        
        data = response.json()
        print(f"\nExecute response:")
        print(f"  ok: {data.get('ok')}")
        print(f"  message: {data.get('message', '')}")
        
        if not data.get('ok'):
            log_test("2. Execute PO creation", False, f"Execute ok=false: {data.get('message', '')}")
            return None
        
        message = data.get('message', '')
        
        # Check if message contains PO number (PO/...)
        if 'PO/' not in message:
            log_test("2. Execute PO creation", False, 
                    f"Message doesn't contain PO number: {message}")
            return None
        
        # Extract PO number
        po_number = None
        for word in message.split():
            if word.startswith('PO/'):
                po_number = word.strip('.,;:')
                break
        
        print(f"  PO number: {po_number}")
        
        log_test("2. Execute PO creation", True, f"PO created: {po_number}")
        
        return po_number
        
    except Exception as e:
        log_test("2. Execute PO creation", False, f"Exception: {e}")
        return None

def test_3_verify_po_created(session, po_number):
    """Test 3: Verify PO was created"""
    print("\n" + "="*80)
    print("TEST 3: Verify PO was created")
    print("="*80)
    
    try:
        print(f"\nFetching purchase orders to verify {po_number}...")
        response = session.get(f"{API_BASE}/purchase-orders", timeout=10)
        
        if response.status_code != 200:
            log_test("3. Verify PO created", False, 
                    f"Failed to get POs: {response.status_code}")
            return False
        
        pos_data = response.json()
        pos = pos_data.get('data', []) if isinstance(pos_data, dict) else pos_data
        print(f"  Total POs: {len(pos)}")
        
        # Find the specific PO by number
        draft_po = None
        for po in pos:
            if po.get('poNumber') == po_number:
                draft_po = po
                break
        
        if not draft_po:
            log_test("3. Verify PO created", False, 
                    f"PO {po_number} not found in list")
            return False
        
        print(f"  Found PO: {draft_po.get('poNumber')}")
        print(f"  Status: {draft_po.get('pipelineStatus')}")
        print(f"  Total: {draft_po.get('totalAmount', 0)}")
        
        if draft_po.get('pipelineStatus') != 'Draft':
            log_test("3. Verify PO created", False, 
                    f"PO status is not Draft: {draft_po.get('pipelineStatus')}")
            return False
        
        if draft_po.get('totalAmount', 0) <= 0:
            log_test("3. Verify PO created", False, 
                    f"PO total is 0 or negative: {draft_po.get('totalAmount')}")
            return False
        
        log_test("3. Verify PO created", True, 
                f"Draft PO {draft_po.get('poNumber')} exists with total {draft_po.get('totalAmount')}")
        
        return True
        
    except Exception as e:
        log_test("3. Verify PO created", False, f"Exception: {e}")
        return False

def test_4_create_so_via_chat(session, customer_name, product_name):
    """Test 4: Create Sales Order via chat"""
    print("\n" + "="*80)
    print("TEST 4: Create Sales Order via chat")
    print("="*80)
    
    try:
        # Step 1: Chat to create SO
        message = f"Buatkan draft sales order untuk customer {customer_name}, 50 kg {product_name} harga 30000"
        print(f"\nSending chat message: {message}")
        
        response = session.post(
            f"{API_BASE}/ai/chat",
            json={
                "message": message,
                "sessionId": "so1",
                "history": []
            },
            timeout=90  # 90s timeout for LLM
        )
        
        if response.status_code != 200:
            log_test("4. Create SO via chat", False, 
                    f"Chat failed: {response.status_code} {response.text[:500]}")
            return None
        
        data = response.json()
        print(f"\nChat response received")
        print(f"  ok: {data.get('ok')}")
        print(f"  answer length: {len(data.get('answer', ''))}")
        print(f"  pendingActions count: {len(data.get('pendingActions', []))}")
        
        # Verify structure
        if not data.get('ok'):
            log_test("4. Create SO via chat", False, "Response ok=false")
            return None
        
        pending_actions = data.get('pendingActions', [])
        if len(pending_actions) == 0:
            log_test("4. Create SO via chat", False, 
                    f"No pendingActions returned. Answer: {data.get('answer', '')[:500]}")
            return None
        
        action_obj = pending_actions[0]
        action = action_obj.get('action', {})
        action_type = action.get('type', '')
        
        print(f"  action.type: {action_type}")
        print(f"  action.args keys: {list(action.get('args', {}).keys())}")
        
        if action_type != 'create_sales_order':
            log_test("4. Create SO via chat", False, 
                    f"Expected action.type='create_sales_order', got '{action_type}'")
            return None
        
        args = action.get('args', {})
        customer_id = args.get('customerId', '')
        items = args.get('items', [])
        
        if not customer_id:
            log_test("4. Create SO via chat", False, "args.customerId is empty")
            return None
        
        if len(items) == 0:
            log_test("4. Create SO via chat", False, "args.items is empty")
            return None
        
        if not items[0].get('productId'):
            log_test("4. Create SO via chat", False, "items[0].productId is empty")
            return None
        
        print(f"  customerId: {customer_id}")
        print(f"  items count: {len(items)}")
        print(f"  items[0].productId: {items[0].get('productId')}")
        
        log_test("4. Create SO via chat - structure", True, 
                f"Got pendingAction with type=create_sales_order, customerId={customer_id}, items={len(items)}")
        
        return action
        
    except Exception as e:
        log_test("4. Create SO via chat", False, f"Exception: {e}")
        return None

def test_5_execute_so_creation(session, action):
    """Test 5: Execute SO creation"""
    print("\n" + "="*80)
    print("TEST 5: Execute SO creation")
    print("="*80)
    
    try:
        print("\nExecuting SO creation...")
        response = session.post(
            f"{API_BASE}/ai/execute",
            json={"action": action},
            timeout=30
        )
        
        if response.status_code != 200:
            log_test("5. Execute SO creation", False, 
                    f"Execute failed: {response.status_code} {response.text[:500]}")
            return None
        
        data = response.json()
        print(f"\nExecute response:")
        print(f"  ok: {data.get('ok')}")
        print(f"  message: {data.get('message', '')}")
        
        if not data.get('ok'):
            log_test("5. Execute SO creation", False, f"Execute ok=false: {data.get('message', '')}")
            return None
        
        message = data.get('message', '')
        
        # Check if message contains SO number (SO/...)
        if 'SO/' not in message:
            log_test("5. Execute SO creation", False, 
                    f"Message doesn't contain SO number: {message}")
            return None
        
        # Extract SO number
        so_number = None
        for word in message.split():
            if word.startswith('SO/'):
                so_number = word.strip('.,;:')
                break
        
        print(f"  SO number: {so_number}")
        
        log_test("5. Execute SO creation", True, f"SO created: {so_number}")
        
        return so_number
        
    except Exception as e:
        log_test("5. Execute SO creation", False, f"Exception: {e}")
        return None

def test_6_verify_so_created(session, so_number):
    """Test 6: Verify SO was created"""
    print("\n" + "="*80)
    print("TEST 6: Verify SO was created")
    print("="*80)
    
    try:
        print(f"\nFetching sales orders to verify {so_number}...")
        response = session.get(f"{API_BASE}/sales-orders", timeout=10)
        
        if response.status_code != 200:
            log_test("6. Verify SO created", False, 
                    f"Failed to get SOs: {response.status_code}")
            return False
        
        sos_data = response.json()
        sos = sos_data.get('data', []) if isinstance(sos_data, dict) else sos_data
        print(f"  Total SOs: {len(sos)}")
        
        # Find the specific SO by number
        draft_so = None
        for so in sos:
            if so.get('soNumber') == so_number:
                draft_so = so
                break
        
        if not draft_so:
            log_test("6. Verify SO created", False, 
                    f"SO {so_number} not found in list")
            return False
        
        print(f"  Found SO: {draft_so.get('soNumber')}")
        print(f"  Status: {draft_so.get('pipelineStatus')}")
        print(f"  Total: {draft_so.get('totalAmount', 0)}")
        
        if draft_so.get('pipelineStatus') != 'Draft':
            log_test("6. Verify SO created", False, 
                    f"SO status is not Draft: {draft_so.get('pipelineStatus')}")
            return False
        
        if draft_so.get('totalAmount', 0) <= 0:
            log_test("6. Verify SO created", False, 
                    f"SO total is 0 or negative: {draft_so.get('totalAmount')}")
            return False
        
        log_test("6. Verify SO created", True, 
                f"Draft SO {draft_so.get('soNumber')} exists with total {draft_so.get('totalAmount')}")
        
        return True
        
    except Exception as e:
        log_test("6. Verify SO created", False, f"Exception: {e}")
        return False

def test_7_not_found_handling(session):
    """Test 7: NOT_FOUND handling for fake supplier/product"""
    print("\n" + "="*80)
    print("TEST 7: NOT_FOUND handling for fake supplier/product")
    print("="*80)
    
    try:
        message = "Buatkan purchase order ke supplier NAMA_TIDAK_ADA_XYZ123, 10 kg ProdukNgawur999"
        print(f"\nSending chat message with fake names: {message}")
        
        response = session.post(
            f"{API_BASE}/ai/chat",
            json={
                "message": message,
                "sessionId": "po2",
                "history": []
            },
            timeout=90  # 90s timeout for LLM
        )
        
        if response.status_code != 200:
            log_test("7. NOT_FOUND handling", False, 
                    f"Chat failed: {response.status_code} {response.text[:500]}")
            return False
        
        data = response.json()
        print(f"\nChat response received")
        print(f"  ok: {data.get('ok')}")
        print(f"  answer: {data.get('answer', '')[:300]}")
        print(f"  pendingActions count: {len(data.get('pendingActions', []))}")
        
        # Verify structure
        if not data.get('ok'):
            log_test("7. NOT_FOUND handling", False, "Response ok=false")
            return False
        
        pending_actions = data.get('pendingActions', [])
        
        # Should have NO pendingActions (tool returned NOT_FOUND)
        if len(pending_actions) > 0:
            log_test("7. NOT_FOUND handling", False, 
                    f"Expected empty pendingActions, got {len(pending_actions)} actions")
            return False
        
        # Answer should explain the issue
        answer = data.get('answer', '').lower()
        if 'tidak' not in answer and 'not found' not in answer and 'tidak ditemukan' not in answer:
            print(f"  WARNING: Answer doesn't clearly indicate NOT_FOUND, but pendingActions is empty (acceptable)")
        
        log_test("7. NOT_FOUND handling", True, 
                "No pendingActions created for fake supplier/product (AI explained the issue)")
        
        return True
        
    except Exception as e:
        log_test("7. NOT_FOUND handling", False, f"Exception: {e}")
        return False

def test_8_rbac_direktur_blocked(direktur_session):
    """Test 8: RBAC - direktur blocked from execute"""
    print("\n" + "="*80)
    print("TEST 8: RBAC - direktur blocked from execute")
    print("="*80)
    
    try:
        # Try to execute a create_purchase_order action as direktur
        fake_action = {
            "type": "create_purchase_order",
            "args": {
                "supplierId": "fake-id",
                "poType": "Bahan Baku",
                "notes": None,
                "items": []
            }
        }
        
        print("\nAttempting to execute as direktur...")
        response = direktur_session.post(
            f"{API_BASE}/ai/execute",
            json={"action": fake_action},
            timeout=30
        )
        
        print(f"  Response status: {response.status_code}")
        
        if response.status_code == 403:
            log_test("8. RBAC - direktur blocked", True, "Got 403 Forbidden as expected")
            return True
        else:
            log_test("8. RBAC - direktur blocked", False, 
                    f"Expected 403, got {response.status_code}: {response.text[:500]}")
            return False
        
    except Exception as e:
        log_test("8. RBAC - direktur blocked", False, f"Exception: {e}")
        return False

def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("AI ORDER CREATION (PO/SO) BACKEND TESTS")
    print("="*80)
    
    # Login as admin
    print("\n" + "="*80)
    print("Logging in as ADMIN")
    print("="*80)
    admin_session = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_session:
        print("❌ CRITICAL: Failed to login as admin. Cannot continue.")
        sys.exit(1)
    print("✅ Admin login successful")
    
    # Test 0: Get real data
    product_name, product_sku, supplier_name, customer_name, supplier, customer = test_0_setup_get_real_data(admin_session)
    if not product_name or not supplier_name or not customer_name:
        print("❌ CRITICAL: Failed to get real data. Cannot continue.")
        sys.exit(1)
    
    # Test 1-3: Create PO via chat
    po_action = test_1_create_po_via_chat(admin_session, supplier_name, product_name)
    if po_action:
        po_number = test_2_execute_po_creation(admin_session, po_action)
        if po_number:
            test_3_verify_po_created(admin_session, po_number)
    
    # Test 4-6: Create SO via chat
    so_action = test_4_create_so_via_chat(admin_session, customer_name, product_name)
    if so_action:
        so_number = test_5_execute_so_creation(admin_session, so_action)
        if so_number:
            test_6_verify_so_created(admin_session, so_number)
    
    # Test 7: NOT_FOUND handling
    test_7_not_found_handling(admin_session)
    
    # Login as direktur
    print("\n" + "="*80)
    print("Logging in as DIREKTUR")
    print("="*80)
    direktur_session = login(DIREKTUR_EMAIL, DIREKTUR_PASSWORD)
    if not direktur_session:
        print("❌ WARNING: Failed to login as direktur. Skipping RBAC test.")
    else:
        print("✅ Direktur login successful")
        # Test 8: RBAC
        test_8_rbac_direktur_blocked(direktur_session)
    
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
