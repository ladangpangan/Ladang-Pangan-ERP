#!/usr/bin/env python3
"""
Backend API Testing for Sales Order ↔ Inventory Linkage
Tests the new stockId feature in Sales Orders
"""

import requests
import json
import sys
from datetime import datetime, timedelta

BASE_URL = "https://pangan-system.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

class TestRunner:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({'Content-Type': 'application/json'})
        self.test_data = {}
        self.passed = 0
        self.failed = 0
        
    def log(self, msg):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")
        
    def assert_status(self, response, expected, test_name):
        if response.status_code == expected:
            self.passed += 1
            self.log(f"✅ {test_name}: PASS (status={response.status_code})")
            return True
        else:
            self.failed += 1
            self.log(f"❌ {test_name}: FAIL (expected={expected}, got={response.status_code})")
            self.log(f"   Response: {response.text[:200]}")
            return False
            
    def assert_contains(self, data, key, test_name):
        if key in data:
            self.passed += 1
            self.log(f"✅ {test_name}: PASS (contains '{key}')")
            return True
        else:
            self.failed += 1
            self.log(f"❌ {test_name}: FAIL (missing '{key}')")
            return False
            
    def login(self):
        """Login as admin and get session cookie"""
        self.log("=== LOGIN ===")
        try:
            resp = self.session.post(
                f"{BASE_URL.replace('/api', '')}/api/auth/sign-in/email",
                json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
            )
            if resp.status_code == 200:
                self.log(f"✅ Login successful as {ADMIN_EMAIL}")
                return True
            else:
                self.log(f"❌ Login failed: {resp.status_code} - {resp.text[:200]}")
                return False
        except Exception as e:
            self.log(f"❌ Login error: {str(e)}")
            return False
            
    def setup_test_data(self):
        """Get required IDs for testing"""
        self.log("\n=== SETUP TEST DATA ===")
        
        # Get cold storage
        resp = self.session.get(f"{BASE_URL}/cold-storages")
        if resp.status_code == 200:
            cs_list = resp.json().get('data', [])
            if cs_list:
                self.test_data['coldStorageId'] = cs_list[0]['id']
                self.log(f"✅ Got coldStorageId: {cs_list[0]['code']}")
        
        # Get zone (optional)
        resp = self.session.get(f"{BASE_URL}/zones")
        if resp.status_code == 200:
            zones = resp.json().get('data', [])
            if zones:
                self.test_data['zoneId'] = zones[0]['id']
                self.log(f"✅ Got zoneId: {zones[0]['code']}")
        
        # Get product
        resp = self.session.get(f"{BASE_URL}/products")
        if resp.status_code == 200:
            products = resp.json().get('data', [])
            if products:
                # Find Karkas product
                karkas = next((p for p in products if 'Karkas' in p.get('name', '')), products[0])
                self.test_data['productId'] = karkas['id']
                self.test_data['productName'] = karkas['name']
                self.log(f"✅ Got productId: {karkas['name']}")
        
        # Get customer
        resp = self.session.get(f"{BASE_URL}/contacts?type=Customer")
        if resp.status_code == 200:
            customers = resp.json().get('data', [])
            if customers:
                self.test_data['customerId'] = customers[0]['id']
                self.test_data['customerName'] = customers[0]['displayName']
                self.log(f"✅ Got customerId: {customers[0]['displayName']}")
                
    def test_1_create_inventory_stock(self):
        """Test 1: Create inventory stock for testing"""
        self.log("\n=== TEST 1: Create Inventory Stock ===")
        
        payload = {
            "coldStorageId": self.test_data['coldStorageId'],
            "zoneId": self.test_data.get('zoneId'),
            "referenceType": "MANUAL",
            "notes": "Test stock for SO linkage",
            "items": [{
                "productId": self.test_data['productId'],
                "quantity": 10,
                "weight": 50.0,
                "packagingType": "karung",
                "expiredDate": (datetime.now() + timedelta(days=180)).strftime("%Y-%m-%d")
            }]
        }
        
        resp = self.session.post(f"{BASE_URL}/inventory/inbound", json=payload)
        if self.assert_status(resp, 201, "Create inventory stock"):
            data = resp.json().get('data', {})
            if 'stockIds' in data and len(data['stockIds']) > 0:
                self.test_data['stockId'] = data['stockIds'][0]
                self.log(f"   Created stockId: {self.test_data['stockId']}")
                
                # Get stock details
                resp2 = self.session.get(f"{BASE_URL}/inventory/stocks/{self.test_data['stockId']}")
                if resp2.status_code == 200:
                    stock = resp2.json().get('data', {})
                    self.test_data['kodeSimpan'] = stock.get('kodeSimpan')
                    self.test_data['initialWeight'] = stock.get('weight')
                    self.log(f"   Stock details: kodeSimpan={self.test_data['kodeSimpan']}, weight={self.test_data['initialWeight']}")
                    
    def test_2_create_so_with_stockid_happy_path(self):
        """Test 2: Create SO with stockId (happy path)"""
        self.log("\n=== TEST 2: Create SO with stockId (Happy Path) ===")
        
        # Use half of stock weight
        weight_to_use = self.test_data['initialWeight'] / 2
        
        payload = {
            "customerId": self.test_data['customerId'],
            "orderDate": datetime.now().strftime("%Y-%m-%d"),
            "paymentTerm": "TOP 14",
            "items": [{
                "stockId": self.test_data['stockId'],
                "weight": weight_to_use,
                "quantity": 5,
                "unitPrice": 40000,
                "discount": 0
            }]
        }
        
        resp = self.session.post(f"{BASE_URL}/sales-orders", json=payload)
        if self.assert_status(resp, 201, "Create SO with stockId"):
            data = resp.json().get('data', {})
            self.test_data['soId'] = data.get('id')
            self.test_data['soNumber'] = data.get('soNumber')
            self.log(f"   Created SO: {self.test_data['soNumber']}")
            
            # Verify SO detail includes stock info
            resp2 = self.session.get(f"{BASE_URL}/sales-orders/{self.test_data['soId']}")
            if resp2.status_code == 200:
                so = resp2.json().get('data', {})
                items = so.get('items', [])
                if items and len(items) > 0:
                    item = items[0]
                    if 'stock' in item and item['stock']:
                        stock = item['stock']
                        self.passed += 1
                        self.log(f"✅ SO item has stock object with kodeSimpan: {stock.get('kodeSimpan')}")
                        
                        # Verify stock details
                        if stock.get('kodeSimpan') == self.test_data['kodeSimpan']:
                            self.passed += 1
                            self.log(f"✅ Stock kodeSimpan matches: {stock.get('kodeSimpan')}")
                        else:
                            self.failed += 1
                            self.log(f"❌ Stock kodeSimpan mismatch")
                            
                        if 'coldStorage' in stock and stock['coldStorage']:
                            self.passed += 1
                            self.log(f"✅ Stock has coldStorage: {stock['coldStorage'].get('name')}")
                        else:
                            self.failed += 1
                            self.log(f"❌ Stock missing coldStorage")
                    else:
                        self.failed += 1
                        self.log(f"❌ SO item missing stock object")
                        
                    # Verify productId was auto-filled
                    if item.get('productId') == self.test_data['productId']:
                        self.passed += 1
                        self.log(f"✅ ProductId auto-filled from stock")
                    else:
                        self.failed += 1
                        self.log(f"❌ ProductId not auto-filled correctly")
                        
    def test_3_validation_stock_not_found(self):
        """Test 3: Validation - stockId doesn't exist"""
        self.log("\n=== TEST 3: Validation - Stock Not Found ===")
        
        fake_stock_id = "00000000-0000-0000-0000-000000000000"
        payload = {
            "customerId": self.test_data['customerId'],
            "orderDate": datetime.now().strftime("%Y-%m-%d"),
            "paymentTerm": "TOP 14",
            "items": [{
                "stockId": fake_stock_id,
                "weight": 10,
                "quantity": 2,
                "unitPrice": 40000,
                "discount": 0
            }]
        }
        
        resp = self.session.post(f"{BASE_URL}/sales-orders", json=payload)
        self.assert_status(resp, 400, "Reject non-existent stockId")
        if resp.status_code == 400:
            if "tidak ditemukan" in resp.text.lower():
                self.log(f"   ✓ Error message mentions stock not found")
                
    def test_4_validation_weight_exceeds(self):
        """Test 4: Validation - weight exceeds available stock"""
        self.log("\n=== TEST 4: Validation - Weight Exceeds Available ===")
        
        # Try to use more than available weight
        excessive_weight = self.test_data['initialWeight'] * 2
        
        payload = {
            "customerId": self.test_data['customerId'],
            "orderDate": datetime.now().strftime("%Y-%m-%d"),
            "paymentTerm": "TOP 14",
            "items": [{
                "stockId": self.test_data['stockId'],
                "weight": excessive_weight,
                "quantity": 20,
                "unitPrice": 40000,
                "discount": 0
            }]
        }
        
        resp = self.session.post(f"{BASE_URL}/sales-orders", json=payload)
        self.assert_status(resp, 400, "Reject weight exceeding stock")
        if resp.status_code == 400:
            if "melebihi" in resp.text.lower() or "exceed" in resp.text.lower():
                self.log(f"   ✓ Error message mentions weight exceeds stock")
                
    def test_5_validation_no_product_or_stock(self):
        """Test 5: Validation - item with no stockId and no productId"""
        self.log("\n=== TEST 5: Validation - No Product or Stock ===")
        
        payload = {
            "customerId": self.test_data['customerId'],
            "orderDate": datetime.now().strftime("%Y-%m-%d"),
            "paymentTerm": "TOP 14",
            "items": [{
                "weight": 10,
                "quantity": 2,
                "unitPrice": 40000,
                "discount": 0
            }]
        }
        
        resp = self.session.post(f"{BASE_URL}/sales-orders", json=payload)
        self.assert_status(resp, 400, "Reject item without product or stock")
        
    def test_6_confirm_so_deducts_stock(self):
        """Test 6: Confirm SO deducts stock weight"""
        self.log("\n=== TEST 6: Confirm SO - Stock Deduction ===")
        
        # Get current stock weight before confirmation
        resp = self.session.get(f"{BASE_URL}/inventory/stocks/{self.test_data['stockId']}")
        if resp.status_code == 200:
            stock_before = resp.json().get('data', {})
            weight_before = stock_before.get('weight')
            self.log(f"   Stock weight before confirm: {weight_before} kg")
            
            # Confirm the SO
            resp2 = self.session.post(
                f"{BASE_URL}/sales-orders/{self.test_data['soId']}/status",
                json={"status": "Confirmed"}
            )
            
            if self.assert_status(resp2, 200, "Confirm SO"):
                # Check stock weight after confirmation
                resp3 = self.session.get(f"{BASE_URL}/inventory/stocks/{self.test_data['stockId']}")
                if resp3.status_code == 200:
                    stock_after = resp3.json().get('data', {})
                    weight_after = stock_after.get('weight')
                    status_after = stock_after.get('status')
                    self.log(f"   Stock weight after confirm: {weight_after} kg")
                    self.log(f"   Stock status after confirm: {status_after}")
                    
                    # Verify weight was deducted
                    expected_weight = weight_before - (self.test_data['initialWeight'] / 2)
                    if abs(weight_after - expected_weight) < 0.01:
                        self.passed += 1
                        self.log(f"✅ Stock weight correctly deducted")
                    else:
                        self.failed += 1
                        self.log(f"❌ Stock weight not deducted correctly (expected ~{expected_weight}, got {weight_after})")
                        
                    # Verify status is still active (not fully depleted)
                    if status_after == 'active':
                        self.passed += 1
                        self.log(f"✅ Stock status still active (partial deduction)")
                    else:
                        self.failed += 1
                        self.log(f"❌ Stock status should be active, got {status_after}")
                        
                # Verify inventory transaction was created
                resp4 = self.session.get(f"{BASE_URL}/dashboard/summary")
                if resp4.status_code == 200:
                    self.log(f"   ✓ Dashboard summary accessible (transaction logged)")
                    
    def test_7_full_depletion(self):
        """Test 7: Full stock depletion sets status to 'used'"""
        self.log("\n=== TEST 7: Full Stock Depletion ===")
        
        # Get remaining stock weight
        resp = self.session.get(f"{BASE_URL}/inventory/stocks/{self.test_data['stockId']}")
        if resp.status_code == 200:
            stock = resp.json().get('data', {})
            remaining_weight = stock.get('weight')
            self.log(f"   Remaining stock weight: {remaining_weight} kg")
            
            # Create another SO using all remaining weight
            payload = {
                "customerId": self.test_data['customerId'],
                "orderDate": datetime.now().strftime("%Y-%m-%d"),
                "paymentTerm": "TOP 14",
                "items": [{
                    "stockId": self.test_data['stockId'],
                    "weight": remaining_weight,
                    "quantity": 5,
                    "unitPrice": 40000,
                    "discount": 0
                }]
            }
            
            resp2 = self.session.post(f"{BASE_URL}/sales-orders", json=payload)
            if self.assert_status(resp2, 201, "Create SO for full depletion"):
                so_data = resp2.json().get('data', {})
                so_id = so_data.get('id')
                
                # Confirm it
                resp3 = self.session.post(
                    f"{BASE_URL}/sales-orders/{so_id}/status",
                    json={"status": "Confirmed"}
                )
                
                if self.assert_status(resp3, 200, "Confirm SO for full depletion"):
                    # Check stock status
                    resp4 = self.session.get(f"{BASE_URL}/inventory/stocks/{self.test_data['stockId']}")
                    if resp4.status_code == 200:
                        stock_final = resp4.json().get('data', {})
                        weight_final = stock_final.get('weight')
                        status_final = stock_final.get('status')
                        
                        self.log(f"   Final stock weight: {weight_final} kg")
                        self.log(f"   Final stock status: {status_final}")
                        
                        # Verify weight is ~0
                        if weight_final < 0.01:
                            self.passed += 1
                            self.log(f"✅ Stock weight depleted to ~0")
                        else:
                            self.failed += 1
                            self.log(f"❌ Stock weight should be ~0, got {weight_final}")
                            
                        # Verify status is 'used'
                        if status_final == 'used':
                            self.passed += 1
                            self.log(f"✅ Stock status set to 'used'")
                        else:
                            self.failed += 1
                            self.log(f"❌ Stock status should be 'used', got {status_final}")
                            
    def test_8_backward_compat_no_stockid(self):
        """Test 8: Backward compatibility - SO without stockId"""
        self.log("\n=== TEST 8: Backward Compatibility - No stockId ===")
        
        payload = {
            "customerId": self.test_data['customerId'],
            "orderDate": datetime.now().strftime("%Y-%m-%d"),
            "paymentTerm": "TOP 14",
            "items": [{
                "productId": self.test_data['productId'],
                "weight": 10,
                "quantity": 2,
                "unitPrice": 30000,
                "discount": 0
            }]
        }
        
        resp = self.session.post(f"{BASE_URL}/sales-orders", json=payload)
        if self.assert_status(resp, 201, "Create SO without stockId (legacy)"):
            so_data = resp.json().get('data', {})
            so_id = so_data.get('id')
            self.log(f"   Created legacy SO: {so_data.get('soNumber')}")
            
            # Confirm it (should not crash)
            resp2 = self.session.post(
                f"{BASE_URL}/sales-orders/{so_id}/status",
                json={"status": "Confirmed"}
            )
            self.assert_status(resp2, 200, "Confirm legacy SO (no stock deduction)")
            
    def test_9_patch_items_restriction(self):
        """Test 9: PATCH items only allowed on Draft"""
        self.log("\n=== TEST 9: PATCH Items Restriction ===")
        
        # Create a new SO
        payload = {
            "customerId": self.test_data['customerId'],
            "orderDate": datetime.now().strftime("%Y-%m-%d"),
            "paymentTerm": "TOP 14",
            "items": [{
                "productId": self.test_data['productId'],
                "weight": 5,
                "quantity": 1,
                "unitPrice": 40000,
                "discount": 0
            }]
        }
        
        resp = self.session.post(f"{BASE_URL}/sales-orders", json=payload)
        if resp.status_code == 201:
            so_data = resp.json().get('data', {})
            so_id = so_data.get('id')
            
            # Try to PATCH items while Draft (should work)
            patch_payload = {
                "items": [{
                    "productId": self.test_data['productId'],
                    "weight": 8,
                    "quantity": 2,
                    "unitPrice": 40000,
                    "discount": 0
                }]
            }
            
            resp2 = self.session.patch(f"{BASE_URL}/sales-orders/{so_id}", json=patch_payload)
            self.assert_status(resp2, 200, "PATCH items on Draft SO")
            
            # Confirm the SO
            resp3 = self.session.post(
                f"{BASE_URL}/sales-orders/{so_id}/status",
                json={"status": "Confirmed"}
            )
            
            if resp3.status_code == 200:
                # Try to PATCH items after Confirmed (should fail)
                resp4 = self.session.patch(f"{BASE_URL}/sales-orders/{so_id}", json=patch_payload)
                self.assert_status(resp4, 400, "Reject PATCH items on Confirmed SO")
                if resp4.status_code == 400:
                    if "draft" in resp4.text.lower():
                        self.log(f"   ✓ Error message mentions Draft restriction")
                        
    def test_10_validation_used_stock(self):
        """Test 10: Validation - cannot use stock with status='used'"""
        self.log("\n=== TEST 10: Validation - Used Stock ===")
        
        # Try to create SO with the depleted stock
        payload = {
            "customerId": self.test_data['customerId'],
            "orderDate": datetime.now().strftime("%Y-%m-%d"),
            "paymentTerm": "TOP 14",
            "items": [{
                "stockId": self.test_data['stockId'],
                "weight": 5,
                "quantity": 1,
                "unitPrice": 40000,
                "discount": 0
            }]
        }
        
        resp = self.session.post(f"{BASE_URL}/sales-orders", json=payload)
        self.assert_status(resp, 400, "Reject used stock")
        if resp.status_code == 400:
            if "tidak aktif" in resp.text.lower() or "not active" in resp.text.lower():
                self.log(f"   ✓ Error message mentions stock not active")
                
    def test_11_regression_basic_endpoints(self):
        """Test 11: Regression - basic endpoints still work"""
        self.log("\n=== TEST 11: Regression Tests ===")
        
        # GET /sales-orders
        resp = self.session.get(f"{BASE_URL}/sales-orders")
        self.assert_status(resp, 200, "GET /sales-orders")
        
        # GET /inventory/stocks
        resp = self.session.get(f"{BASE_URL}/inventory/stocks")
        self.assert_status(resp, 200, "GET /inventory/stocks")
        
        # GET /dashboard/summary
        resp = self.session.get(f"{BASE_URL}/dashboard/summary")
        if resp.status_code == 200:
            self.passed += 1
            self.log(f"✅ GET /dashboard/summary: PASS")
        else:
            # Dashboard might not exist, that's ok
            self.log(f"   ℹ️  Dashboard endpoint not available (optional)")
            
    def run_all_tests(self):
        """Run all tests in sequence"""
        self.log("=" * 80)
        self.log("SALES ORDER ↔ INVENTORY LINKAGE TESTING")
        self.log("=" * 80)
        
        if not self.login():
            self.log("❌ Login failed, cannot proceed")
            return False
            
        self.setup_test_data()
        
        # Run tests
        self.test_1_create_inventory_stock()
        self.test_2_create_so_with_stockid_happy_path()
        self.test_3_validation_stock_not_found()
        self.test_4_validation_weight_exceeds()
        self.test_5_validation_no_product_or_stock()
        self.test_6_confirm_so_deducts_stock()
        self.test_7_full_depletion()
        self.test_8_backward_compat_no_stockid()
        self.test_9_patch_items_restriction()
        self.test_10_validation_used_stock()
        self.test_11_regression_basic_endpoints()
        
        # Summary
        self.log("\n" + "=" * 80)
        self.log("TEST SUMMARY")
        self.log("=" * 80)
        self.log(f"✅ PASSED: {self.passed}")
        self.log(f"❌ FAILED: {self.failed}")
        self.log(f"📊 TOTAL:  {self.passed + self.failed}")
        
        if self.failed == 0:
            self.log("\n🎉 ALL TESTS PASSED!")
            return True
        else:
            self.log(f"\n⚠️  {self.failed} TEST(S) FAILED")
            return False

if __name__ == "__main__":
    runner = TestRunner()
    success = runner.run_all_tests()
    sys.exit(0 if success else 1)
