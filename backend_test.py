#!/usr/bin/env python3
"""
Backend test for Phase 2 MongoDB master-data migration (DUAL-WRITE)
Tests products, cold-storages, zones CRUD with MongoDB as authoritative source
"""

import requests
import json
import sys

BASE_URL = "http://localhost:3000/api"
ORIGIN = "http://localhost:3000"

# Test state
session = requests.Session()
test_data = {
    "products": [],
    "cold_storages": [],
    "zones": []
}

def login(email, password):
    """Login and get session cookie"""
    try:
        resp = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": email, "password": password},
            headers={"Origin": ORIGIN}
        )
        if resp.status_code == 200:
            print(f"✓ Login successful as {email}")
            return True
        else:
            print(f"✗ Login failed: {resp.status_code} - {resp.text}")
            return False
    except Exception as e:
        print(f"✗ Login error: {e}")
        return False

def test_get_initial_data():
    """TEST 1: GET initial seeded data"""
    print("\n=== TEST 1: GET Initial Seeded Data ===")
    
    try:
        # GET products
        resp = session.get(f"{BASE_URL}/products")
        if resp.status_code != 200:
            print(f"✗ GET /products failed: {resp.status_code}")
            return False
        
        products = resp.json().get("data", [])
        print(f"✓ GET /products: {len(products)} products")
        
        # Verify avgHppPerKg field exists
        if products and "avgHppPerKg" in products[0]:
            print(f"✓ Products have avgHppPerKg field (value: {products[0]['avgHppPerKg']})")
        else:
            print("✗ Products missing avgHppPerKg field")
            return False
        
        # GET cold-storages
        resp = session.get(f"{BASE_URL}/cold-storages")
        if resp.status_code != 200:
            print(f"✗ GET /cold-storages failed: {resp.status_code}")
            return False
        
        cold_storages = resp.json().get("data", [])
        print(f"✓ GET /cold-storages: {len(cold_storages)} cold-storages")
        
        # Verify zoneCount field exists
        if cold_storages and "zoneCount" in cold_storages[0]:
            print(f"✓ Cold-storages have zoneCount field (value: {cold_storages[0]['zoneCount']})")
        else:
            print("✗ Cold-storages missing zoneCount field")
            return False
        
        # GET zones
        resp = session.get(f"{BASE_URL}/zones")
        if resp.status_code != 200:
            print(f"✗ GET /zones failed: {resp.status_code}")
            return False
        
        zones = resp.json().get("data", [])
        print(f"✓ GET /zones: {len(zones)} zones")
        
        print(f"\n✓ TEST 1 PASSED: Found {len(products)} products, {len(cold_storages)} cold-storages, {len(zones)} zones")
        return True
        
    except Exception as e:
        print(f"✗ TEST 1 FAILED: {e}")
        return False

def test_products_crud():
    """TEST 2: Products CRUD operations"""
    print("\n=== TEST 2: Products CRUD ===")
    
    try:
        # POST - Create product
        product_data = {
            "sku": "QA-P1",
            "name": "QA Product",
            "category": "Karkas",
            "unit": "kg"
        }
        resp = session.post(
            f"{BASE_URL}/products",
            json=product_data,
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 201:
            print(f"✗ POST /products failed: {resp.status_code} - {resp.text}")
            return False
        
        product = resp.json().get("data", {})
        product_id = product.get("id")
        test_data["products"].append(product_id)
        print(f"✓ POST /products: Created product with id={product_id}")
        
        # GET by ID
        resp = session.get(f"{BASE_URL}/products/{product_id}")
        if resp.status_code != 200:
            print(f"✗ GET /products/{product_id} failed: {resp.status_code}")
            return False
        
        fetched = resp.json().get("data", {})
        if fetched.get("name") != "QA Product":
            print(f"✗ GET /products/{product_id}: name mismatch")
            return False
        print(f"✓ GET /products/{product_id}: Matches created product")
        
        # PATCH - Update product
        resp = session.patch(
            f"{BASE_URL}/products/{product_id}",
            json={"name": "QA Product Updated"},
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 200:
            print(f"✗ PATCH /products/{product_id} failed: {resp.status_code}")
            return False
        
        updated = resp.json().get("data", {})
        if updated.get("name") != "QA Product Updated":
            print(f"✗ PATCH /products/{product_id}: name not updated")
            return False
        print(f"✓ PATCH /products/{product_id}: Name updated successfully")
        
        # Duplicate SKU - should return 409
        resp = session.post(
            f"{BASE_URL}/products",
            json=product_data,
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 409:
            print(f"✗ Duplicate SKU should return 409, got {resp.status_code}")
            return False
        print(f"✓ Duplicate SKU correctly rejected with 409")
        
        # DELETE
        resp = session.delete(
            f"{BASE_URL}/products/{product_id}",
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 200:
            print(f"✗ DELETE /products/{product_id} failed: {resp.status_code}")
            return False
        print(f"✓ DELETE /products/{product_id}: Deleted successfully")
        
        # Verify deleted - should return 404
        resp = session.get(f"{BASE_URL}/products/{product_id}")
        if resp.status_code != 404:
            print(f"✗ Deleted product should return 404, got {resp.status_code}")
            return False
        print(f"✓ GET deleted product correctly returns 404")
        
        # Remove from cleanup list since already deleted
        test_data["products"].remove(product_id)
        
        print("\n✓ TEST 2 PASSED: Products CRUD working correctly")
        return True
        
    except Exception as e:
        print(f"✗ TEST 2 FAILED: {e}")
        return False

def test_cold_storages_crud():
    """TEST 3: Cold-storages CRUD with cascade delete"""
    print("\n=== TEST 3: Cold-storages CRUD ===")
    
    try:
        # POST - Create cold-storage
        cs_data = {
            "code": "QA-CS1",
            "name": "QA CS"
        }
        resp = session.post(
            f"{BASE_URL}/cold-storages",
            json=cs_data,
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 201:
            print(f"✗ POST /cold-storages failed: {resp.status_code} - {resp.text}")
            return False
        
        cs = resp.json().get("data", {})
        cs_id = cs.get("id")
        test_data["cold_storages"].append(cs_id)
        print(f"✓ POST /cold-storages: Created cold-storage with id={cs_id}")
        
        # GET by ID - should include zones array
        resp = session.get(f"{BASE_URL}/cold-storages/{cs_id}")
        if resp.status_code != 200:
            print(f"✗ GET /cold-storages/{cs_id} failed: {resp.status_code}")
            return False
        
        fetched = resp.json().get("data", {})
        if "zones" not in fetched:
            print(f"✗ GET /cold-storages/{cs_id}: missing zones array")
            return False
        print(f"✓ GET /cold-storages/{cs_id}: Includes zones array (count: {len(fetched['zones'])})")
        
        # Duplicate code - should return 409
        resp = session.post(
            f"{BASE_URL}/cold-storages",
            json=cs_data,
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 409:
            print(f"✗ Duplicate code should return 409, got {resp.status_code}")
            return False
        print(f"✓ Duplicate code correctly rejected with 409")
        
        # Create a zone under this cold-storage
        zone_data = {
            "coldStorageId": cs_id,
            "code": "QA-Z1",
            "name": "QA Zone"
        }
        resp = session.post(
            f"{BASE_URL}/zones",
            json=zone_data,
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 201:
            print(f"✗ POST /zones failed: {resp.status_code} - {resp.text}")
            return False
        
        zone = resp.json().get("data", {})
        zone_id = zone.get("id")
        test_data["zones"].append(zone_id)
        print(f"✓ POST /zones: Created zone with id={zone_id}")
        
        # DELETE cold-storage - should cascade delete zones
        resp = session.delete(
            f"{BASE_URL}/cold-storages/{cs_id}",
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 200:
            print(f"✗ DELETE /cold-storages/{cs_id} failed: {resp.status_code}")
            return False
        print(f"✓ DELETE /cold-storages/{cs_id}: Deleted successfully")
        
        # Verify zones are cascade-deleted
        resp = session.get(f"{BASE_URL}/zones?cold_storage_id={cs_id}")
        if resp.status_code != 200:
            print(f"✗ GET /zones?cold_storage_id={cs_id} failed: {resp.status_code}")
            return False
        
        zones = resp.json().get("data", [])
        if len(zones) != 0:
            print(f"✗ Zones not cascade-deleted, found {len(zones)} zones")
            return False
        print(f"✓ Zones cascade-deleted successfully")
        
        # Remove from cleanup list since already deleted
        test_data["cold_storages"].remove(cs_id)
        test_data["zones"].remove(zone_id)
        
        print("\n✓ TEST 3 PASSED: Cold-storages CRUD and cascade delete working correctly")
        return True
        
    except Exception as e:
        print(f"✗ TEST 3 FAILED: {e}")
        return False

def test_zones_crud():
    """TEST 4: Zones CRUD operations"""
    print("\n=== TEST 4: Zones CRUD ===")
    
    try:
        # First create a cold-storage for the zone
        cs_data = {
            "code": "QA-CS2",
            "name": "QA CS 2"
        }
        resp = session.post(
            f"{BASE_URL}/cold-storages",
            json=cs_data,
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 201:
            print(f"✗ POST /cold-storages failed: {resp.status_code}")
            return False
        
        cs_id = resp.json().get("data", {}).get("id")
        test_data["cold_storages"].append(cs_id)
        print(f"✓ Created cold-storage for zone testing: {cs_id}")
        
        # POST - Create zone
        zone_data = {
            "coldStorageId": cs_id,
            "code": "QA-Z2",
            "name": "QA Zone 2"
        }
        resp = session.post(
            f"{BASE_URL}/zones",
            json=zone_data,
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 201:
            print(f"✗ POST /zones failed: {resp.status_code} - {resp.text}")
            return False
        
        zone = resp.json().get("data", {})
        zone_id = zone.get("id")
        test_data["zones"].append(zone_id)
        print(f"✓ POST /zones: Created zone with id={zone_id}")
        
        # GET with filter
        resp = session.get(f"{BASE_URL}/zones?cold_storage_id={cs_id}")
        if resp.status_code != 200:
            print(f"✗ GET /zones?cold_storage_id={cs_id} failed: {resp.status_code}")
            return False
        
        zones = resp.json().get("data", [])
        if len(zones) == 0:
            print(f"✗ GET /zones with filter returned no zones")
            return False
        
        found = any(z.get("id") == zone_id for z in zones)
        if not found:
            print(f"✗ Created zone not found in filtered list")
            return False
        print(f"✓ GET /zones?cold_storage_id={cs_id}: Found created zone")
        
        # PATCH - Update zone
        resp = session.patch(
            f"{BASE_URL}/zones/{zone_id}",
            json={"name": "QA Zone 2 Updated"},
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 200:
            print(f"✗ PATCH /zones/{zone_id} failed: {resp.status_code}")
            return False
        
        updated = resp.json().get("data", {})
        if updated.get("name") != "QA Zone 2 Updated":
            print(f"✗ PATCH /zones/{zone_id}: name not updated")
            return False
        print(f"✓ PATCH /zones/{zone_id}: Name updated successfully")
        
        # DELETE zone
        resp = session.delete(
            f"{BASE_URL}/zones/{zone_id}",
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 200:
            print(f"✗ DELETE /zones/{zone_id} failed: {resp.status_code}")
            return False
        print(f"✓ DELETE /zones/{zone_id}: Deleted successfully")
        
        test_data["zones"].remove(zone_id)
        
        print("\n✓ TEST 4 PASSED: Zones CRUD working correctly")
        return True
        
    except Exception as e:
        print(f"✗ TEST 4 FAILED: {e}")
        return False

def test_archive_restore():
    """TEST 5: Archive and restore functionality"""
    print("\n=== TEST 5: Archive and Restore ===")
    
    try:
        # Create a product for archive testing
        product_data = {
            "sku": "QA-ARCH1",
            "name": "QA Archive Test",
            "category": "Karkas",
            "unit": "kg"
        }
        resp = session.post(
            f"{BASE_URL}/products",
            json=product_data,
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 201:
            print(f"✗ POST /products failed: {resp.status_code}")
            return False
        
        product_id = resp.json().get("data", {}).get("id")
        test_data["products"].append(product_id)
        print(f"✓ Created product for archive testing: {product_id}")
        
        # Archive the product
        resp = session.post(
            f"{BASE_URL}/products/{product_id}/archive",
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 200:
            print(f"✗ POST /products/{product_id}/archive failed: {resp.status_code}")
            return False
        print(f"✓ Archived product successfully")
        
        # GET default (should NOT include archived)
        resp = session.get(f"{BASE_URL}/products")
        if resp.status_code != 200:
            print(f"✗ GET /products failed: {resp.status_code}")
            return False
        
        products = resp.json().get("data", [])
        found = any(p.get("id") == product_id for p in products)
        if found:
            print(f"✗ Archived product should not appear in default GET")
            return False
        print(f"✓ Archived product NOT in default GET")
        
        # GET with archived=1 (should include archived only)
        resp = session.get(f"{BASE_URL}/products?archived=1")
        if resp.status_code != 200:
            print(f"✗ GET /products?archived=1 failed: {resp.status_code}")
            return False
        
        archived_products = resp.json().get("data", [])
        found = any(p.get("id") == product_id for p in archived_products)
        if not found:
            print(f"✗ Archived product should appear in ?archived=1")
            return False
        print(f"✓ Archived product appears in ?archived=1")
        
        # Restore the product
        resp = session.post(
            f"{BASE_URL}/products/{product_id}/restore",
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 200:
            print(f"✗ POST /products/{product_id}/restore failed: {resp.status_code}")
            return False
        print(f"✓ Restored product successfully")
        
        # GET default (should include restored product)
        resp = session.get(f"{BASE_URL}/products")
        if resp.status_code != 200:
            print(f"✗ GET /products failed: {resp.status_code}")
            return False
        
        products = resp.json().get("data", [])
        found = any(p.get("id") == product_id for p in products)
        if not found:
            print(f"✗ Restored product should appear in default GET")
            return False
        print(f"✓ Restored product appears in default GET")
        
        print("\n✓ TEST 5 PASSED: Archive and restore working correctly")
        return True
        
    except Exception as e:
        print(f"✗ TEST 5 FAILED: {e}")
        return False

def test_role_checks():
    """TEST 6: Role-based access control"""
    print("\n=== TEST 6: Role-based Access Control ===")
    
    try:
        # Login as operator
        if not login("operator@lpi.co.id", "operator123"):
            print("✗ Failed to login as operator")
            return False
        
        # Try POST /products (should be 403)
        product_data = {
            "sku": "QA-FORBIDDEN",
            "name": "Should Fail",
            "category": "Karkas",
            "unit": "kg"
        }
        resp = session.post(
            f"{BASE_URL}/products",
            json=product_data,
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 403:
            print(f"✗ Operator POST /products should return 403, got {resp.status_code}")
            return False
        print(f"✓ Operator POST /products correctly rejected with 403")
        
        # Try POST /cold-storages (should be 403)
        cs_data = {
            "code": "QA-FORBIDDEN",
            "name": "Should Fail"
        }
        resp = session.post(
            f"{BASE_URL}/cold-storages",
            json=cs_data,
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 403:
            print(f"✗ Operator POST /cold-storages should return 403, got {resp.status_code}")
            return False
        print(f"✓ Operator POST /cold-storages correctly rejected with 403")
        
        # Try POST /zones (should be 403)
        zone_data = {
            "coldStorageId": "dummy-id",
            "code": "QA-FORBIDDEN",
            "name": "Should Fail"
        }
        resp = session.post(
            f"{BASE_URL}/zones",
            json=zone_data,
            headers={"Origin": ORIGIN}
        )
        if resp.status_code != 403:
            print(f"✗ Operator POST /zones should return 403, got {resp.status_code}")
            return False
        print(f"✓ Operator POST /zones correctly rejected with 403")
        
        # GET should work (may be 200)
        resp = session.get(f"{BASE_URL}/products")
        if resp.status_code == 200:
            print(f"✓ Operator GET /products allowed (200)")
        else:
            print(f"✓ Operator GET /products: {resp.status_code}")
        
        # Login back as admin for cleanup
        if not login("admin@lpi.co.id", "admin123"):
            print("✗ Failed to login back as admin")
            return False
        
        print("\n✓ TEST 6 PASSED: Role-based access control working correctly")
        return True
        
    except Exception as e:
        print(f"✗ TEST 6 FAILED: {e}")
        return False

def test_stats_regression():
    """TEST 7: Stats endpoint regression"""
    print("\n=== TEST 7: Stats Endpoint Regression ===")
    
    try:
        resp = session.get(f"{BASE_URL}/stats")
        if resp.status_code != 200:
            print(f"✗ GET /stats failed: {resp.status_code}")
            return False
        
        stats = resp.json()
        required_fields = ["products", "coldStorages", "zones", "contacts", "users"]
        
        for field in required_fields:
            if field not in stats:
                print(f"✗ Stats missing field: {field}")
                return False
            print(f"✓ Stats.{field}: {stats[field]}")
        
        print("\n✓ TEST 7 PASSED: Stats endpoint working correctly")
        return True
        
    except Exception as e:
        print(f"✗ TEST 7 FAILED: {e}")
        return False

def cleanup():
    """Clean up all test data"""
    print("\n=== CLEANUP ===")
    
    # Delete zones
    for zone_id in test_data["zones"]:
        try:
            resp = session.delete(
                f"{BASE_URL}/zones/{zone_id}",
                headers={"Origin": ORIGIN}
            )
            if resp.status_code == 200:
                print(f"✓ Deleted zone: {zone_id}")
            else:
                print(f"✗ Failed to delete zone {zone_id}: {resp.status_code}")
        except Exception as e:
            print(f"✗ Error deleting zone {zone_id}: {e}")
    
    # Delete cold-storages
    for cs_id in test_data["cold_storages"]:
        try:
            resp = session.delete(
                f"{BASE_URL}/cold-storages/{cs_id}",
                headers={"Origin": ORIGIN}
            )
            if resp.status_code == 200:
                print(f"✓ Deleted cold-storage: {cs_id}")
            else:
                print(f"✗ Failed to delete cold-storage {cs_id}: {resp.status_code}")
        except Exception as e:
            print(f"✗ Error deleting cold-storage {cs_id}: {e}")
    
    # Delete products
    for product_id in test_data["products"]:
        try:
            resp = session.delete(
                f"{BASE_URL}/products/{product_id}",
                headers={"Origin": ORIGIN}
            )
            if resp.status_code == 200:
                print(f"✓ Deleted product: {product_id}")
            else:
                print(f"✗ Failed to delete product {product_id}: {resp.status_code}")
        except Exception as e:
            print(f"✗ Error deleting product {product_id}: {e}")
    
    print("✓ Cleanup complete")

def main():
    print("=" * 80)
    print("PHASE 2 MONGODB MASTER-DATA MIGRATION (DUAL-WRITE) - BACKEND TEST")
    print("=" * 80)
    
    # Login as admin
    if not login("admin@lpi.co.id", "admin123"):
        print("\n✗ FATAL: Cannot login as admin")
        sys.exit(1)
    
    results = []
    
    # Run all tests
    results.append(("Initial Data", test_get_initial_data()))
    results.append(("Products CRUD", test_products_crud()))
    results.append(("Cold-storages CRUD", test_cold_storages_crud()))
    results.append(("Zones CRUD", test_zones_crud()))
    results.append(("Archive/Restore", test_archive_restore()))
    results.append(("Role Checks", test_role_checks()))
    results.append(("Stats Regression", test_stats_regression()))
    
    # Cleanup
    cleanup()
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✓ PASSED" if result else "✗ FAILED"
        print(f"{status}: {name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n✓✓✓ ALL TESTS PASSED ✓✓✓")
        sys.exit(0)
    else:
        print(f"\n✗✗✗ {total - passed} TEST(S) FAILED ✗✗✗")
        sys.exit(1)

if __name__ == "__main__":
    main()
