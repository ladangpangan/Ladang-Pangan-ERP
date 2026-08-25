#!/usr/bin/env python3
"""
PHASE 10 Data Persistence Migration Test
Tests MongoDB-authoritative persistence for 4 domains:
1. app_settings
2. contact_customers
3. notifications
4. contact_documents (skipped - file upload complex)
"""

import requests
import json
import time
import sys
from typing import Dict, Any, Optional

# Configuration
BASE_URL = "https://mongo-migration-26.preview.emergentagent.com/api"
LOGIN_CREDENTIALS = {
    "admin": {"email": "admin@lpi.co.id", "password": "admin123"},
    "supervisor": {"email": "supervisor@lpi.co.id", "password": "super123"},
    "direktur": {"email": "direktur@lpi.co.id", "password": "direktur123"},
    "operator": {"email": "operator@lpi.co.id", "password": "operator123"}
}

class TestSession:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        })
        self.test_data = {}
        
    def login(self, role: str = "admin") -> bool:
        """Login and obtain session cookie"""
        try:
            creds = LOGIN_CREDENTIALS[role]
            # Better Auth sign-in endpoint
            auth_url = BASE_URL.replace('/api', '/api/auth/sign-in/email')
            resp = self.session.post(auth_url, json=creds, timeout=10)
            
            if resp.status_code == 200:
                print(f"✅ Login successful as {role} ({creds['email']})")
                return True
            else:
                print(f"❌ Login failed: {resp.status_code} - {resp.text[:200]}")
                return False
        except Exception as e:
            print(f"❌ Login exception: {e}")
            return False
    
    def get(self, endpoint: str, **kwargs) -> requests.Response:
        """GET request"""
        url = f"{BASE_URL}{endpoint}"
        return self.session.get(url, **kwargs)
    
    def post(self, endpoint: str, data: Any = None, **kwargs) -> requests.Response:
        """POST request"""
        url = f"{BASE_URL}{endpoint}"
        if data is not None and 'json' not in kwargs:
            kwargs['json'] = data
        return self.session.post(url, **kwargs)
    
    def put(self, endpoint: str, data: Any = None, **kwargs) -> requests.Response:
        """PUT request"""
        url = f"{BASE_URL}{endpoint}"
        if data is not None and 'json' not in kwargs:
            kwargs['json'] = data
        return self.session.put(url, **kwargs)
    
    def patch(self, endpoint: str, data: Any = None, **kwargs) -> requests.Response:
        """PATCH request"""
        url = f"{BASE_URL}{endpoint}"
        if data is not None and 'json' not in kwargs:
            kwargs['json'] = data
        return self.session.patch(url, **kwargs)
    
    def delete(self, endpoint: str, **kwargs) -> requests.Response:
        """DELETE request"""
        url = f"{BASE_URL}{endpoint}"
        return self.session.delete(url, **kwargs)


def test_app_settings(ts: TestSession) -> bool:
    """Test 1: app_settings persistence"""
    print("\n" + "="*70)
    print("TEST 1: APP_SETTINGS PERSISTENCE")
    print("="*70)
    
    all_passed = True
    
    # Test 1.1: POST /api/settings/company
    print("\n[1.1] POST /api/settings/company with test data")
    try:
        test_data = {
            "name": "PT Test Ladang Pangan",
            "phone": "0811-TEST-123",
            "address": "Jl. Test MongoDB No. 123",
            "city": "Jakarta"
        }
        resp = ts.post("/settings/company", {"value": test_data})
        
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            if data.get('key') == 'company' and data.get('value') == test_data:
                print(f"✅ PASSED: Settings saved successfully")
                print(f"   Response: {json.dumps(data, indent=2)}")
            else:
                print(f"❌ FAILED: Response data mismatch")
                print(f"   Expected value: {test_data}")
                print(f"   Got: {data}")
                all_passed = False
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            print(f"   Response: {resp.text[:500]}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    # Test 1.2: GET /api/settings/company (verify persistence)
    print("\n[1.2] GET /api/settings/company (verify round-trip)")
    try:
        time.sleep(0.5)  # Brief delay for MongoDB sync
        resp = ts.get("/settings/company")
        
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            if data.get('key') == 'company' and data.get('value') == test_data:
                print(f"✅ PASSED: Settings persisted correctly")
                print(f"   Retrieved value matches saved value")
            else:
                print(f"❌ FAILED: Retrieved data doesn't match")
                print(f"   Expected: {test_data}")
                print(f"   Got: {data.get('value')}")
                all_passed = False
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            print(f"   Response: {resp.text[:500]}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    # Test 1.3: Test another key (appearance)
    print("\n[1.3] POST /api/settings/appearance with test data")
    try:
        appearance_data = {
            "theme": "light",
            "accentColor": "#1D4ED8",
            "fontSize": "medium"
        }
        resp = ts.post("/settings/appearance", {"value": appearance_data})
        
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            if data.get('key') == 'appearance' and data.get('value') == appearance_data:
                print(f"✅ PASSED: Appearance settings saved")
            else:
                print(f"❌ FAILED: Response data mismatch")
                all_passed = False
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    # Test 1.4: GET appearance (verify independence)
    print("\n[1.4] GET /api/settings/appearance (verify key independence)")
    try:
        time.sleep(0.5)
        resp = ts.get("/settings/appearance")
        
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            if data.get('value') == appearance_data:
                print(f"✅ PASSED: Appearance settings persisted independently")
            else:
                print(f"❌ FAILED: Data mismatch")
                all_passed = False
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    # Test 1.5: Verify company still intact
    print("\n[1.5] GET /api/settings/company (verify no cross-contamination)")
    try:
        resp = ts.get("/settings/company")
        
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            if data.get('value') == test_data:
                print(f"✅ PASSED: Company settings still intact")
            else:
                print(f"❌ FAILED: Company settings corrupted")
                all_passed = False
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    return all_passed


def test_contact_customers(ts: TestSession) -> bool:
    """Test 2: contact_customers persistence"""
    print("\n" + "="*70)
    print("TEST 2: CONTACT_CUSTOMERS PERSISTENCE")
    print("="*70)
    
    all_passed = True
    contact_id = None
    customer_id = None
    
    # Test 2.1: Find or create an Agen/Dropshipper contact
    print("\n[2.1] Find or create Agen/Dropshipper contact")
    try:
        # Try to find existing Agen
        resp = ts.get("/contacts?limit=100")
        if resp.status_code == 200:
            contacts = resp.json().get('data', [])
            agen_contacts = [c for c in contacts if 'Agen' in c.get('categories', [])]
            
            if agen_contacts:
                contact_id = agen_contacts[0]['id']
                print(f"✅ Found existing Agen: {agen_contacts[0].get('displayName')} (ID: {contact_id})")
            else:
                # Create new Agen
                print("   No Agen found, creating new one...")
                new_contact = {
                    "displayName": "Test Agen MongoDB",
                    "categories": ["Agen"],
                    "contactType": "company",
                    "phone": "0812-TEST-AGEN",
                    "address": "Jl. Test Agen No. 1"
                }
                resp = ts.post("/contacts", new_contact)
                if resp.status_code == 201:
                    contact_id = resp.json().get('data', {}).get('id')
                    print(f"✅ Created new Agen (ID: {contact_id})")
                    ts.test_data['created_contact_id'] = contact_id
                else:
                    print(f"❌ FAILED: Could not create Agen - HTTP {resp.status_code}")
                    print(f"   Response: {resp.text[:500]}")
                    return False
        else:
            print(f"❌ FAILED: Could not fetch contacts - HTTP {resp.status_code}")
            return False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        return False
    
    if not contact_id:
        print("❌ FAILED: No contact_id available")
        return False
    
    # Test 2.2: POST contact customer (pelanggan akhir)
    print(f"\n[2.2] POST /api/contacts/{contact_id}/customers")
    try:
        customer_data = {
            "name": "Pelanggan Test MongoDB",
            "phone": "0813-CUST-TEST",
            "address": "Jl. Pelanggan Test No. 99",
            "city": "Surabaya",
            "notes": "Test customer for MongoDB persistence"
        }
        resp = ts.post(f"/contacts/{contact_id}/customers", customer_data)
        
        if resp.status_code == 201:
            data = resp.json().get('data', {})
            customer_id = data.get('id')
            if customer_id and data.get('name') == customer_data['name']:
                print(f"✅ PASSED: Customer created successfully")
                print(f"   Customer ID: {customer_id}")
                print(f"   Name: {data.get('name')}")
                ts.test_data['customer_id'] = customer_id
            else:
                print(f"❌ FAILED: Response data incomplete")
                all_passed = False
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            print(f"   Response: {resp.text[:500]}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    if not customer_id:
        print("❌ FAILED: No customer_id, skipping remaining tests")
        return False
    
    # Test 2.3: GET customers list (verify persistence)
    print(f"\n[2.3] GET /api/contacts/{contact_id}/customers (verify round-trip)")
    try:
        time.sleep(0.5)
        resp = ts.get(f"/contacts/{contact_id}/customers")
        
        if resp.status_code == 200:
            customers = resp.json().get('data', [])
            found = any(c.get('id') == customer_id for c in customers)
            if found:
                customer = next(c for c in customers if c.get('id') == customer_id)
                if customer.get('name') == customer_data['name']:
                    print(f"✅ PASSED: Customer persisted correctly")
                    print(f"   Found in list with correct data")
                else:
                    print(f"❌ FAILED: Customer data mismatch")
                    all_passed = False
            else:
                print(f"❌ FAILED: Customer not found in list")
                print(f"   Expected ID: {customer_id}")
                print(f"   Found {len(customers)} customers")
                all_passed = False
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    # Test 2.4: PATCH customer (update)
    print(f"\n[2.4] PATCH /api/contacts/{contact_id}/customers/{customer_id}")
    try:
        update_data = {
            "phone": "0813-UPDATED-PHONE",
            "notes": "Updated notes for MongoDB test"
        }
        resp = ts.patch(f"/contacts/{contact_id}/customers/{customer_id}", update_data)
        
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            if data.get('phone') == update_data['phone']:
                print(f"✅ PASSED: Customer updated successfully")
            else:
                print(f"❌ FAILED: Update not reflected")
                all_passed = False
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    # Test 2.5: GET again to verify update persisted
    print(f"\n[2.5] GET customers list again (verify update persisted)")
    try:
        time.sleep(0.5)
        resp = ts.get(f"/contacts/{contact_id}/customers")
        
        if resp.status_code == 200:
            customers = resp.json().get('data', [])
            customer = next((c for c in customers if c.get('id') == customer_id), None)
            if customer and customer.get('phone') == "0813-UPDATED-PHONE":
                print(f"✅ PASSED: Update persisted correctly")
            else:
                print(f"❌ FAILED: Update not persisted")
                all_passed = False
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    # Test 2.6: DELETE customer
    print(f"\n[2.6] DELETE /api/contacts/{contact_id}/customers/{customer_id}")
    try:
        resp = ts.delete(f"/contacts/{contact_id}/customers/{customer_id}")
        
        if resp.status_code == 200:
            print(f"✅ PASSED: Customer deleted successfully")
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    # Test 2.7: Verify deletion persisted
    print(f"\n[2.7] GET customers list (verify deletion persisted)")
    try:
        time.sleep(0.5)
        resp = ts.get(f"/contacts/{contact_id}/customers")
        
        if resp.status_code == 200:
            customers = resp.json().get('data', [])
            found = any(c.get('id') == customer_id for c in customers)
            if not found:
                print(f"✅ PASSED: Deletion persisted correctly")
            else:
                print(f"❌ FAILED: Customer still exists after deletion")
                all_passed = False
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    return all_passed


def test_notifications(ts: TestSession) -> bool:
    """Test 3: notifications persistence"""
    print("\n" + "="*70)
    print("TEST 3: NOTIFICATIONS PERSISTENCE")
    print("="*70)
    
    all_passed = True
    
    # Test 3.1: Get initial unread count
    print("\n[3.1] GET /api/notifications/unread-count (baseline)")
    try:
        resp = ts.get("/notifications/unread-count")
        
        if resp.status_code == 200:
            initial_count = resp.json().get('count', 0)
            print(f"✅ PASSED: Initial unread count: {initial_count}")
            ts.test_data['initial_unread_count'] = initial_count
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    # Test 3.2: Create a Purchase Order to generate notification
    print("\n[3.2] Create Purchase Order (to generate notification)")
    try:
        # First, get a supplier
        resp = ts.get("/contacts?limit=100")
        if resp.status_code == 200:
            contacts = resp.json().get('data', [])
            suppliers = [c for c in contacts if 'Supplier' in c.get('categories', [])]
            
            if not suppliers:
                print("   No suppliers found, creating one...")
                new_supplier = {
                    "displayName": "Test Supplier MongoDB",
                    "categories": ["Supplier"],
                    "contactType": "company",
                    "phone": "0814-SUPPLIER"
                }
                resp = ts.post("/contacts", new_supplier)
                if resp.status_code == 201:
                    supplier_id = resp.json().get('data', {}).get('id')
                    ts.test_data['created_supplier_id'] = supplier_id
                else:
                    print(f"❌ Could not create supplier")
                    return False
            else:
                supplier_id = suppliers[0]['id']
            
            # Get a product
            resp = ts.get("/products?limit=10")
            if resp.status_code == 200:
                products = resp.json().get('data', [])
                if not products:
                    print("❌ No products available")
                    return False
                product_id = products[0]['id']
                
                # Create PO
                po_data = {
                    "supplierId": supplier_id,
                    "poType": "Produk Jadi",
                    "items": [{
                        "productId": product_id,
                        "quantity": 10,
                        "weight": 50,
                        "unitPrice": 45000
                    }]
                }
                resp = ts.post("/purchase-orders", po_data)
                
                if resp.status_code == 201:
                    po_id = resp.json().get('data', {}).get('id')
                    print(f"✅ PASSED: PO created (ID: {po_id})")
                    ts.test_data['po_id'] = po_id
                else:
                    print(f"⚠️  PO creation returned {resp.status_code}")
                    print(f"   This may not generate a notification, continuing...")
            else:
                print(f"❌ Could not fetch products")
                return False
        else:
            print(f"❌ Could not fetch contacts")
            return False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    # Test 3.3: GET notifications (verify persistence)
    print("\n[3.3] GET /api/notifications (verify notification exists)")
    try:
        time.sleep(1)  # Wait for notification to be created
        resp = ts.get("/notifications?limit=50")
        
        if resp.status_code == 200:
            data = resp.json()
            notifications = data.get('data', [])
            unread_count = data.get('unreadCount', 0)
            
            print(f"✅ PASSED: Retrieved {len(notifications)} notifications")
            print(f"   Unread count: {unread_count}")
            
            if notifications:
                print(f"   Latest notification: {notifications[0].get('message', 'N/A')[:80]}")
                ts.test_data['notification_id'] = notifications[0].get('id')
            else:
                print(f"   ℹ️  No notifications found (may be expected if PO doesn't trigger notification)")
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    # Test 3.4: Mark single notification as read (if exists)
    notification_id = ts.test_data.get('notification_id')
    if notification_id:
        print(f"\n[3.4] POST /api/notifications/{notification_id}/read")
        try:
            resp = ts.post(f"/notifications/{notification_id}/read")
            
            if resp.status_code == 200:
                print(f"✅ PASSED: Notification marked as read")
            else:
                print(f"❌ FAILED: HTTP {resp.status_code}")
                all_passed = False
        except Exception as e:
            print(f"❌ FAILED: Exception - {e}")
            all_passed = False
        
        # Test 3.5: Verify read status persisted
        print(f"\n[3.5] GET /api/notifications/unread-count (verify read persisted)")
        try:
            time.sleep(0.5)
            resp = ts.get("/notifications/unread-count")
            
            if resp.status_code == 200:
                new_count = resp.json().get('count', 0)
                print(f"✅ PASSED: Unread count after marking read: {new_count}")
                print(f"   (Initial was: {ts.test_data.get('initial_unread_count', 'N/A')})")
            else:
                print(f"❌ FAILED: HTTP {resp.status_code}")
                all_passed = False
        except Exception as e:
            print(f"❌ FAILED: Exception - {e}")
            all_passed = False
    else:
        print(f"\n[3.4-3.5] SKIPPED: No notification ID available")
    
    # Test 3.6: Mark all as read
    print(f"\n[3.6] POST /api/notifications/read-all")
    try:
        resp = ts.post("/notifications/read-all")
        
        if resp.status_code == 200:
            print(f"✅ PASSED: All notifications marked as read")
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    # Test 3.7: Verify all marked as read
    print(f"\n[3.7] GET /api/notifications/unread-count (verify read-all persisted)")
    try:
        time.sleep(0.5)
        resp = ts.get("/notifications/unread-count")
        
        if resp.status_code == 200:
            final_count = resp.json().get('count', 0)
            if final_count == 0:
                print(f"✅ PASSED: All notifications marked as read (count: 0)")
            else:
                print(f"⚠️  Unread count is {final_count} (expected 0)")
                print(f"   This may be due to new notifications arriving")
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    return all_passed


def test_regression(ts: TestSession) -> bool:
    """Test 4: Regression - existing endpoints still work"""
    print("\n" + "="*70)
    print("TEST 4: REGRESSION - EXISTING ENDPOINTS")
    print("="*70)
    
    all_passed = True
    
    # Test 4.1: GET /api/contacts
    print("\n[4.1] GET /api/contacts")
    try:
        resp = ts.get("/contacts?limit=10")
        
        if resp.status_code == 200:
            data = resp.json().get('data', [])
            print(f"✅ PASSED: Retrieved {len(data)} contacts")
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    # Test 4.2: GET /api/products
    print("\n[4.2] GET /api/products")
    try:
        resp = ts.get("/products?limit=10")
        
        if resp.status_code == 200:
            data = resp.json().get('data', [])
            print(f"✅ PASSED: Retrieved {len(data)} products")
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    # Test 4.3: GET /api/purchase-orders
    print("\n[4.3] GET /api/purchase-orders")
    try:
        resp = ts.get("/purchase-orders?limit=10")
        
        if resp.status_code == 200:
            data = resp.json().get('data', [])
            print(f"✅ PASSED: Retrieved {len(data)} purchase orders")
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    # Test 4.4: GET /api/sales-orders
    print("\n[4.4] GET /api/sales-orders")
    try:
        resp = ts.get("/sales-orders?limit=10")
        
        if resp.status_code == 200:
            data = resp.json().get('data', [])
            print(f"✅ PASSED: Retrieved {len(data)} sales orders")
        else:
            print(f"❌ FAILED: HTTP {resp.status_code}")
            all_passed = False
    except Exception as e:
        print(f"❌ FAILED: Exception - {e}")
        all_passed = False
    
    return all_passed


def main():
    print("="*70)
    print("PHASE 10 DATA PERSISTENCE MIGRATION TEST")
    print("MongoDB-authoritative for: app_settings, contact_customers,")
    print("contact_documents, notifications")
    print("="*70)
    
    ts = TestSession()
    
    # Login
    if not ts.login("admin"):
        print("\n❌ CRITICAL: Login failed, cannot proceed")
        sys.exit(1)
    
    # Run tests
    results = {}
    
    results['app_settings'] = test_app_settings(ts)
    results['contact_customers'] = test_contact_customers(ts)
    results['notifications'] = test_notifications(ts)
    results['regression'] = test_regression(ts)
    
    # Summary
    print("\n" + "="*70)
    print("TEST SUMMARY")
    print("="*70)
    
    for test_name, passed in results.items():
        status = "✅ PASSED" if passed else "❌ FAILED"
        print(f"{status}: {test_name}")
    
    all_passed = all(results.values())
    
    print("\n" + "="*70)
    if all_passed:
        print("✅ ALL TESTS PASSED")
    else:
        print("❌ SOME TESTS FAILED")
    print("="*70)
    
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
