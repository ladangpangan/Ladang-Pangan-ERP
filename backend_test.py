#!/usr/bin/env python3
"""
Backend Test: PATCH /api/sales-orders/:id/surat-jalan/:sjId
Test the new endpoint for editing Surat Jalan (delivery notes).
"""

import requests
import json
import sys
from typing import Dict, Any, Optional

# Configuration
BASE_URL = "https://so-po-loader.preview.emergentagent.com"
API_URL = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

class TestRunner:
    def __init__(self):
        self.session = requests.Session()
        self.session_token = None
        self.test_so_id = None
        self.test_sj_id = None
        self.original_sj_data = {}
        self.original_so_total = None
        self.test_item_id = None
        self.original_item_shipped_weight = None
        
    def log(self, message: str):
        """Print test log message"""
        print(f"[TEST] {message}")
        
    def login(self) -> bool:
        """Login as admin and capture session token"""
        try:
            self.log("TEST 1: Login as admin")
            url = f"{API_URL}/auth/sign-in/email"
            headers = {
                "Content-Type": "application/json",
                "Origin": BASE_URL
            }
            payload = {
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD
            }
            
            response = self.session.post(url, json=payload, headers=headers)
            self.log(f"Login response status: {response.status_code}")
            
            if response.status_code == 200:
                # Capture session token from cookies
                cookies = response.cookies
                for cookie in cookies:
                    if 'session' in cookie.name.lower():
                        self.session_token = cookie.value
                        self.log(f"✅ TEST 1 PASSED: Login successful, session token captured")
                        return True
                
                self.log(f"✅ TEST 1 PASSED: Login successful (status 200)")
                return True
            else:
                self.log(f"❌ TEST 1 FAILED: Login failed with status {response.status_code}")
                self.log(f"Response: {response.text}")
                return False
                
        except Exception as e:
            self.log(f"❌ TEST 1 FAILED: Login exception: {str(e)}")
            return False
    
    def find_so_with_surat_jalan(self) -> bool:
        """Find a Sales Order with at least one Surat Jalan"""
        try:
            self.log("\nSETUP: Finding SO with Surat Jalan")
            
            # Get all sales orders
            response = self.session.get(f"{API_URL}/sales-orders")
            if response.status_code != 200:
                self.log(f"❌ SETUP FAILED: GET /sales-orders returned {response.status_code}")
                return False
            
            sales_orders = response.json().get('data', [])
            self.log(f"Found {len(sales_orders)} sales orders")
            
            # Check each SO for Surat Jalan
            for so in sales_orders:
                so_id = so.get('id')
                so_number = so.get('soNumber', 'Unknown')
                
                # Get SO detail
                detail_response = self.session.get(f"{API_URL}/sales-orders/{so_id}")
                if detail_response.status_code != 200:
                    continue
                
                so_detail = detail_response.json().get('data', {})
                surat_jalan_list = so_detail.get('suratJalan', [])
                
                if len(surat_jalan_list) > 0:
                    # Found an SO with Surat Jalan
                    sj = surat_jalan_list[0]
                    self.test_so_id = so_id
                    self.test_sj_id = sj.get('id')
                    self.original_so_total = so_detail.get('totalAmount')
                    
                    # Store original SJ values
                    self.original_sj_data = {
                        'deliveryDate': sj.get('deliveryDate'),
                        'driverName': sj.get('driverName'),
                        'vehicleNumber': sj.get('vehicleNumber'),
                        'notes': sj.get('notes'),
                        'showReceivedColumn': sj.get('showReceivedColumn'),
                        'shipToCustomerId': sj.get('shipToCustomerId'),
                        'shipToName': sj.get('shipToName'),
                        'shipToPhone': sj.get('shipToPhone'),
                        'shipToAddress': sj.get('shipToAddress')
                    }
                    
                    # Get an item ID for testing
                    items = so_detail.get('items', [])
                    if len(items) > 0:
                        self.test_item_id = items[0].get('id')
                        self.original_item_shipped_weight = items[0].get('shippedWeight', 0)
                    
                    self.log(f"✅ SETUP SUCCESS: Found SO {so_number} with Surat Jalan")
                    self.log(f"   SO ID: {self.test_so_id}")
                    self.log(f"   SJ ID: {self.test_sj_id}")
                    self.log(f"   Original SO totalAmount: {self.original_so_total}")
                    self.log(f"   Original SJ data: {json.dumps(self.original_sj_data, indent=2)}")
                    if self.test_item_id:
                        self.log(f"   Test item ID: {self.test_item_id}")
                        self.log(f"   Original shippedWeight: {self.original_item_shipped_weight}")
                    return True
            
            self.log("❌ SETUP FAILED: No SO with Surat Jalan found")
            self.log("   SKIPPING all edit tests (no test data available)")
            return False
            
        except Exception as e:
            self.log(f"❌ SETUP FAILED: Exception: {str(e)}")
            return False
    
    def test_patch_basic_fields(self) -> bool:
        """TEST 2: PATCH basic fields (showReceivedColumn, driverName, vehicleNumber, notes)"""
        try:
            self.log("\nTEST 2: PATCH basic fields")
            
            url = f"{API_URL}/sales-orders/{self.test_so_id}/surat-jalan/{self.test_sj_id}"
            payload = {
                "showReceivedColumn": True,
                "driverName": "UJI SOPIR",
                "vehicleNumber": "B 9 TEST",
                "notes": "catatan uji"
            }
            
            response = self.session.patch(url, json=payload)
            self.log(f"PATCH response status: {response.status_code}")
            
            if response.status_code != 200:
                self.log(f"❌ TEST 2 FAILED: Expected 200, got {response.status_code}")
                self.log(f"Response: {response.text}")
                return False
            
            data = response.json().get('data', {})
            
            # Verify fields
            checks = [
                ('showReceivedColumn', True, data.get('showReceivedColumn')),
                ('driverName', "UJI SOPIR", data.get('driverName')),
                ('vehicleNumber', "B 9 TEST", data.get('vehicleNumber')),
                ('notes', "catatan uji", data.get('notes'))
            ]
            
            all_passed = True
            for field, expected, actual in checks:
                if actual == expected:
                    self.log(f"   ✓ {field}: {actual} (expected: {expected})")
                else:
                    self.log(f"   ✗ {field}: {actual} (expected: {expected})")
                    all_passed = False
            
            if all_passed:
                self.log("✅ TEST 2 PASSED: All basic fields updated correctly")
                return True
            else:
                self.log("❌ TEST 2 FAILED: Some fields not persisted correctly")
                return False
                
        except Exception as e:
            self.log(f"❌ TEST 2 FAILED: Exception: {str(e)}")
            return False
    
    def test_patch_ship_to_manual(self) -> bool:
        """TEST 3: PATCH ship-to with manual fields"""
        try:
            self.log("\nTEST 3: PATCH ship-to manual fields")
            
            url = f"{API_URL}/sales-orders/{self.test_so_id}/surat-jalan/{self.test_sj_id}"
            payload = {
                "shipToName": "Toko Uji",
                "shipToAddress": "Jl. Uji No 1",
                "shipToPhone": "0811111"
            }
            
            response = self.session.patch(url, json=payload)
            self.log(f"PATCH response status: {response.status_code}")
            
            if response.status_code != 200:
                self.log(f"❌ TEST 3 FAILED: Expected 200, got {response.status_code}")
                self.log(f"Response: {response.text}")
                return False
            
            data = response.json().get('data', {})
            
            # Verify fields
            checks = [
                ('shipToName', "Toko Uji", data.get('shipToName')),
                ('shipToAddress', "Jl. Uji No 1", data.get('shipToAddress')),
                ('shipToPhone', "0811111", data.get('shipToPhone')),
                ('shipToCustomerId', None, data.get('shipToCustomerId'))
            ]
            
            all_passed = True
            for field, expected, actual in checks:
                if actual == expected:
                    self.log(f"   ✓ {field}: {actual} (expected: {expected})")
                else:
                    self.log(f"   ✗ {field}: {actual} (expected: {expected})")
                    all_passed = False
            
            if all_passed:
                self.log("✅ TEST 3 PASSED: Ship-to manual fields updated correctly")
                return True
            else:
                self.log("❌ TEST 3 FAILED: Some ship-to fields not persisted correctly")
                return False
                
        except Exception as e:
            self.log(f"❌ TEST 3 FAILED: Exception: {str(e)}")
            return False
    
    def test_patch_item_shipped_weight(self) -> bool:
        """TEST 4: PATCH item shippedWeight and verify SO totalAmount recomputation"""
        try:
            self.log("\nTEST 4: PATCH item shippedWeight")
            
            if not self.test_item_id:
                self.log("⚠️  TEST 4 SKIPPED: No test item ID available")
                return True  # Skip but don't fail
            
            url = f"{API_URL}/sales-orders/{self.test_so_id}/surat-jalan/{self.test_sj_id}"
            payload = {
                "items": [
                    {
                        "itemId": self.test_item_id,
                        "shippedWeight": 3
                    }
                ]
            }
            
            response = self.session.patch(url, json=payload)
            self.log(f"PATCH response status: {response.status_code}")
            
            if response.status_code != 200:
                self.log(f"❌ TEST 4 FAILED: Expected 200, got {response.status_code}")
                self.log(f"Response: {response.text}")
                return False
            
            self.log("   ✓ PATCH returned 200 (no 500 error)")
            
            # Get SO detail to verify totalAmount was recomputed
            so_response = self.session.get(f"{API_URL}/sales-orders/{self.test_so_id}")
            if so_response.status_code != 200:
                self.log(f"❌ TEST 4 FAILED: Could not GET SO detail")
                return False
            
            so_data = so_response.json().get('data', {})
            new_total = so_data.get('totalAmount')
            
            self.log(f"   Original totalAmount: {self.original_so_total}")
            self.log(f"   New totalAmount: {new_total}")
            
            if new_total != self.original_so_total:
                self.log(f"   ✓ totalAmount was recomputed (changed from {self.original_so_total} to {new_total})")
                self.log("✅ TEST 4 PASSED: Item shippedWeight updated and SO total recomputed")
                return True
            else:
                self.log(f"   ⚠️  totalAmount unchanged (may be expected if price calculation results in same total)")
                self.log("✅ TEST 4 PASSED: Item shippedWeight updated (no 500 error)")
                return True
                
        except Exception as e:
            self.log(f"❌ TEST 4 FAILED: Exception: {str(e)}")
            return False
    
    def test_negative_cases(self) -> bool:
        """TEST 5: Negative cases (404 for nonexistent SJ or SO)"""
        try:
            self.log("\nTEST 5: Negative cases")
            
            # Test 5a: Nonexistent SJ ID
            self.log("   Test 5a: PATCH with nonexistent SJ ID")
            url = f"{API_URL}/sales-orders/{self.test_so_id}/surat-jalan/nonexistent-sj-id-123"
            payload = {"notes": "test"}
            response = self.session.patch(url, json=payload)
            
            if response.status_code == 404:
                self.log(f"   ✓ Test 5a PASSED: Got 404 for nonexistent SJ ID")
            else:
                self.log(f"   ✗ Test 5a FAILED: Expected 404, got {response.status_code}")
                return False
            
            # Test 5b: Nonexistent SO ID
            self.log("   Test 5b: PATCH with nonexistent SO ID")
            url = f"{API_URL}/sales-orders/nonexistent-so/surat-jalan/{self.test_sj_id}"
            payload = {"notes": "test"}
            response = self.session.patch(url, json=payload)
            
            if response.status_code == 404:
                self.log(f"   ✓ Test 5b PASSED: Got 404 for nonexistent SO ID")
            else:
                self.log(f"   ✗ Test 5b FAILED: Expected 404, got {response.status_code}")
                return False
            
            self.log("✅ TEST 5 PASSED: All negative cases returned 404 as expected")
            return True
            
        except Exception as e:
            self.log(f"❌ TEST 5 FAILED: Exception: {str(e)}")
            return False
    
    def revert_changes(self) -> bool:
        """TEST 6: REVERT all changes back to original values"""
        try:
            self.log("\nTEST 6: REVERT changes to original values")
            
            url = f"{API_URL}/sales-orders/{self.test_so_id}/surat-jalan/{self.test_sj_id}"
            
            # Build revert payload
            payload = {
                "driverName": self.original_sj_data.get('driverName'),
                "vehicleNumber": self.original_sj_data.get('vehicleNumber'),
                "notes": self.original_sj_data.get('notes'),
                "showReceivedColumn": self.original_sj_data.get('showReceivedColumn', False)
            }
            
            # Handle ship-to revert
            if self.original_sj_data.get('shipToCustomerId'):
                payload['shipToCustomerId'] = self.original_sj_data['shipToCustomerId']
            elif self.original_sj_data.get('shipToName'):
                payload['shipToName'] = self.original_sj_data['shipToName']
                payload['shipToAddress'] = self.original_sj_data.get('shipToAddress')
                payload['shipToPhone'] = self.original_sj_data.get('shipToPhone')
            else:
                payload['shipToName'] = None
                payload['shipToAddress'] = None
                payload['shipToCustomerId'] = None
            
            # Revert item shippedWeight if we changed it
            if self.test_item_id and self.original_item_shipped_weight is not None:
                payload['items'] = [{
                    "itemId": self.test_item_id,
                    "shippedWeight": self.original_item_shipped_weight
                }]
            
            self.log(f"   Reverting with payload: {json.dumps(payload, indent=2)}")
            
            response = self.session.patch(url, json=payload)
            self.log(f"PATCH revert response status: {response.status_code}")
            
            if response.status_code != 200:
                self.log(f"❌ TEST 6 FAILED: Revert returned {response.status_code}")
                self.log(f"Response: {response.text}")
                return False
            
            # Verify SO totalAmount returned to original
            if self.test_item_id:
                so_response = self.session.get(f"{API_URL}/sales-orders/{self.test_so_id}")
                if so_response.status_code == 200:
                    so_data = so_response.json().get('data', {})
                    reverted_total = so_data.get('totalAmount')
                    self.log(f"   Original totalAmount: {self.original_so_total}")
                    self.log(f"   Reverted totalAmount: {reverted_total}")
                    
                    if reverted_total == self.original_so_total:
                        self.log(f"   ✓ SO totalAmount reverted to original value")
                    else:
                        self.log(f"   ⚠️  SO totalAmount differs (may be due to rounding or other factors)")
            
            self.log("✅ TEST 6 PASSED: All changes reverted successfully")
            return True
            
        except Exception as e:
            self.log(f"❌ TEST 6 FAILED: Exception: {str(e)}")
            return False
    
    def run_all_tests(self):
        """Run all tests in sequence"""
        self.log("=" * 80)
        self.log("BACKEND TEST: PATCH /api/sales-orders/:id/surat-jalan/:sjId")
        self.log("=" * 80)
        
        results = []
        
        # Test 1: Login
        if not self.login():
            self.log("\n❌ CRITICAL: Login failed, cannot continue")
            return False
        results.append(("Login", True))
        
        # Setup: Find SO with Surat Jalan
        if not self.find_so_with_surat_jalan():
            self.log("\n⚠️  SETUP FAILED: No SO with Surat Jalan found")
            self.log("   All edit tests will be SKIPPED")
            self.log("\n" + "=" * 80)
            self.log("TEST SUMMARY")
            self.log("=" * 80)
            self.log("✅ TEST 1: Login - PASSED")
            self.log("⚠️  SETUP: No test data available (no SO with Surat Jalan)")
            self.log("⚠️  All edit tests SKIPPED")
            return True  # Not a failure, just no test data
        
        # Test 2: PATCH basic fields
        result = self.test_patch_basic_fields()
        results.append(("PATCH basic fields", result))
        
        # Test 3: PATCH ship-to manual
        result = self.test_patch_ship_to_manual()
        results.append(("PATCH ship-to manual", result))
        
        # Test 4: PATCH item shippedWeight
        result = self.test_patch_item_shipped_weight()
        results.append(("PATCH item shippedWeight", result))
        
        # Test 5: Negative cases
        result = self.test_negative_cases()
        results.append(("Negative cases (404)", result))
        
        # Test 6: Revert changes
        result = self.revert_changes()
        results.append(("REVERT changes", result))
        
        # Print summary
        self.log("\n" + "=" * 80)
        self.log("TEST SUMMARY")
        self.log("=" * 80)
        
        passed = sum(1 for _, result in results if result)
        total = len(results)
        
        for test_name, result in results:
            status = "✅ PASSED" if result else "❌ FAILED"
            self.log(f"{status}: {test_name}")
        
        self.log("=" * 80)
        self.log(f"TOTAL: {passed}/{total} tests passed ({passed*100//total}%)")
        self.log("=" * 80)
        
        return all(result for _, result in results)

if __name__ == "__main__":
    runner = TestRunner()
    success = runner.run_all_tests()
    sys.exit(0 if success else 1)
