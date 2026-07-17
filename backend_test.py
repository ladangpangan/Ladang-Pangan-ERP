#!/usr/bin/env python3
"""
Backend API Testing Script for Dashboard Summary + Purchase/Production/Inventory Reports
Tests all endpoints with RBAC verification for admin, direktur, and operator roles.
"""

import requests
import time
import json
from datetime import datetime

# Base URL from .env
BASE_URL = "https://pangan-system.preview.emergentagent.com/api"

# Test credentials
CREDENTIALS = {
    "admin": {"email": "admin@lpi.co.id", "password": "admin123"},
    "direktur": {"email": "direktur@lpi.co.id", "password": "direktur123"},
    "operator": {"email": "operator@lpi.co.id", "password": "operator123"},
}

# Store sessions for each role
sessions = {}

def login(role):
    """Login and store session cookies"""
    print(f"\n{'='*60}")
    print(f"Logging in as {role}...")
    print(f"{'='*60}")
    
    session = requests.Session()
    creds = CREDENTIALS[role]
    
    try:
        # Login via Better Auth
        resp = session.post(
            f"{BASE_URL.replace('/api', '')}/api/auth/sign-in/email",
            json={"email": creds["email"], "password": creds["password"]},
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        
        if resp.status_code == 200:
            print(f"✅ Login successful for {role}")
            sessions[role] = session
            return session
        else:
            print(f"❌ Login failed for {role}: {resp.status_code} - {resp.text[:200]}")
            return None
    except Exception as e:
        print(f"❌ Login error for {role}: {str(e)}")
        return None

def test_endpoint(session, role, method, endpoint, expected_status, description):
    """Test a single endpoint"""
    url = f"{BASE_URL}{endpoint}"
    
    try:
        if method == "GET":
            resp = session.get(url, timeout=10)
        elif method == "POST":
            resp = session.post(url, json={}, timeout=10)
        else:
            resp = session.request(method, url, timeout=10)
        
        status = resp.status_code
        success = status == expected_status
        
        if success:
            print(f"  ✅ {description}: {status}")
            return True, resp
        else:
            print(f"  ❌ {description}: Expected {expected_status}, got {status}")
            if status >= 400:
                print(f"     Error: {resp.text[:200]}")
            return False, resp
    except Exception as e:
        print(f"  ❌ {description}: Exception - {str(e)}")
        return False, None

def validate_dashboard_summary(data):
    """Validate dashboard summary structure and data"""
    print("\n  Validating dashboard summary structure...")
    
    required_fields = ['todaySales', 'activeWo', 'todayProduction', 'alerts', 'finance', 'inventoryValue']
    for field in required_fields:
        if field not in data:
            print(f"    ❌ Missing field: {field}")
            return False
    
    # Validate todaySales
    ts = data['todaySales']
    if not all(k in ts for k in ['count', 'total', 'paidToday']):
        print(f"    ❌ todaySales missing required fields")
        return False
    if any(ts[k] < 0 for k in ['count', 'total', 'paidToday']):
        print(f"    ❌ todaySales has negative values")
        return False
    
    # Validate todayProduction
    tp = data['todayProduction']
    if not all(k in tp for k in ['count', 'rendemenWeight', 'baseWeight', 'efficiency']):
        print(f"    ❌ todayProduction missing required fields")
        return False
    if any(tp[k] < 0 for k in ['count', 'rendemenWeight', 'baseWeight', 'efficiency']):
        print(f"    ❌ todayProduction has negative values")
        return False
    
    # Validate alerts
    alerts = data['alerts']
    if not all(k in alerts for k in ['nearExpired', 'expired', 'damaged']):
        print(f"    ❌ alerts missing required fields")
        return False
    if 'count' not in alerts['damaged'] or 'weight' not in alerts['damaged']:
        print(f"    ❌ alerts.damaged missing count or weight")
        return False
    
    # Validate finance
    finance = data['finance']
    if not all(k in finance for k in ['totalAR', 'totalAP', 'netPosition']):
        print(f"    ❌ finance missing required fields")
        return False
    
    # Validate inventoryValue
    if data['inventoryValue'] < 0:
        print(f"    ❌ inventoryValue is negative")
        return False
    
    print(f"    ✅ All structure validations passed")
    print(f"    📊 Today Sales: {ts['count']} orders, Rp {ts['total']:,.0f}")
    print(f"    📊 Today Production: {tp['count']} batches, {tp['rendemenWeight']:.1f}kg, {tp['efficiency']:.1f}% efficiency")
    print(f"    📊 Finance: AR={finance['totalAR']:,.0f}, AP={finance['totalAP']:,.0f}, Net={finance['netPosition']:,.0f}")
    print(f"    📊 Inventory Value: Rp {data['inventoryValue']:,.0f}")
    
    return True

def validate_purchase_by_supplier(data):
    """Validate purchase reports by supplier"""
    print(f"\n  Validating purchase-reports/by-supplier...")
    
    if not isinstance(data, list):
        print(f"    ❌ Expected array, got {type(data)}")
        return False
    
    if len(data) > 0:
        item = data[0]
        required = ['supplierId', 'supplier', 'count', 'total', 'paid', 'outstanding']
        for field in required:
            if field not in item:
                print(f"    ❌ Missing field: {field}")
                return False
        
        if 'code' not in item['supplier'] or 'name' not in item['supplier']:
            print(f"    ❌ supplier missing code or name")
            return False
        
        # Check sorted by total desc
        if len(data) > 1:
            for i in range(len(data) - 1):
                if data[i]['total'] < data[i+1]['total']:
                    print(f"    ❌ Not sorted by total desc")
                    return False
        
        print(f"    ✅ Structure valid, {len(data)} suppliers")
        print(f"    📊 Top supplier: {item['supplier']['name']} - {item['count']} POs, Rp {item['total']:,.0f}")
    else:
        print(f"    ✅ Empty result (no purchase orders yet)")
    
    return True

def validate_ap_aging(data):
    """Validate AP aging report"""
    print(f"\n  Validating purchase-reports/ap-aging...")
    
    required = ['buckets', 'details', 'totalOutstanding']
    for field in required:
        if field not in data:
            print(f"    ❌ Missing field: {field}")
            return False
    
    buckets = data['buckets']
    required_buckets = ['0-30', '31-60', '61-90', '90+']
    for bucket in required_buckets:
        if bucket not in buckets:
            print(f"    ❌ Missing bucket: {bucket}")
            return False
    
    if not isinstance(data['details'], list):
        print(f"    ❌ details should be array")
        return False
    
    if len(data['details']) > 0:
        detail = data['details'][0]
        required_detail = ['poId', 'poNumber', 'orderDate', 'daysOld', 'bucket', 'outstanding', 'supplier']
        for field in required_detail:
            if field not in detail:
                print(f"    ❌ detail missing field: {field}")
                return False
    
    print(f"    ✅ Structure valid")
    print(f"    📊 Buckets: 0-30={buckets['0-30']:,.0f}, 31-60={buckets['31-60']:,.0f}, 61-90={buckets['61-90']:,.0f}, 90+={buckets['90+']:,.0f}")
    print(f"    📊 Total Outstanding: Rp {data['totalOutstanding']:,.0f}")
    
    return True

def validate_susut_recap(data):
    """Validate susut recap report"""
    print(f"\n  Validating purchase-reports/susut-recap...")
    
    required = ['details', 'summary']
    for field in required:
        if field not in data:
            print(f"    ❌ Missing field: {field}")
            return False
    
    if not isinstance(data['details'], list):
        print(f"    ❌ details should be array")
        return False
    
    summary = data['summary']
    if not all(k in summary for k in ['totalSusut', 'totalValue', 'count']):
        print(f"    ❌ summary missing required fields")
        return False
    
    # Validate details structure
    if len(data['details']) > 0:
        detail = data['details'][0]
        required_detail = ['poNumber', 'method', 'supplier', 'product', 'weightSupplier', 'weightRph', 'susut', 'value']
        for field in required_detail:
            if field not in detail:
                print(f"    ❌ detail missing field: {field}")
                return False
        
        # Verify susut calculation
        if detail['weightSupplier'] <= detail['weightRph']:
            print(f"    ❌ weightSupplier should be > weightRph for susut items")
            return False
    
    print(f"    ✅ Structure valid")
    print(f"    📊 Total Susut: {summary['totalSusut']:.2f}kg, Value: Rp {summary['totalValue']:,.0f}, Count: {summary['count']}")
    
    return True

def validate_production_batches(data):
    """Validate production batches report"""
    print(f"\n  Validating production-reports/batches...")
    
    required = ['batches', 'summary']
    for field in required:
        if field not in data:
            print(f"    ❌ Missing field: {field}")
            return False
    
    if not isinstance(data['batches'], list):
        print(f"    ❌ batches should be array")
        return False
    
    summary = data['summary']
    required_summary = ['totalBatches', 'totalBaseWeight', 'totalOutputWeight', 'totalCost', 'avgRendemenPct']
    for field in required_summary:
        if field not in summary:
            print(f"    ❌ summary missing field: {field}")
            return False
    
    if len(data['batches']) > 0:
        batch = data['batches'][0]
        required_batch = ['id', 'woNumber', 'mode', 'totalLiveBirdWeight', 'totalRendemenWeight', 'rendemenPct', 'avgHppPerKg', 'totalCost']
        for field in required_batch:
            if field not in batch:
                print(f"    ❌ batch missing field: {field}")
                return False
    
    print(f"    ✅ Structure valid")
    print(f"    📊 Total Batches: {summary['totalBatches']}, Base Weight: {summary['totalBaseWeight']:.1f}kg")
    print(f"    📊 Output Weight: {summary['totalOutputWeight']:.1f}kg, Avg Rendemen: {summary['avgRendemenPct']:.1f}%")
    
    return True

def validate_production_efficiency(data):
    """Validate production efficiency report"""
    print(f"\n  Validating production-reports/efficiency...")
    
    if not isinstance(data, list):
        print(f"    ❌ Expected array, got {type(data)}")
        return False
    
    if len(data) > 0:
        item = data[0]
        required = ['productId', 'stage', 'totalWeight', 'avgHpp', 'avgCoef', 'count', 'product']
        for field in required:
            if field not in item:
                print(f"    ❌ Missing field: {field}")
                return False
        
        product = item['product']
        if not all(k in product for k in ['sku', 'name', 'rendemenCoefficient']):
            print(f"    ❌ product missing required fields")
            return False
        
        # Check sorted by totalWeight desc
        if len(data) > 1:
            for i in range(len(data) - 1):
                if data[i]['totalWeight'] < data[i+1]['totalWeight']:
                    print(f"    ❌ Not sorted by totalWeight desc")
                    return False
        
        print(f"    ✅ Structure valid, {len(data)} product-stage combinations")
        print(f"    📊 Top: {product['name']} ({item['stage']}) - {item['totalWeight']:.1f}kg, {item['count']} batches")
    else:
        print(f"    ✅ Empty result (no production outputs yet)")
    
    return True

def validate_inventory_by_cs(data):
    """Validate inventory by cold storage report"""
    print(f"\n  Validating inventory-reports/by-cs...")
    
    if not isinstance(data, list):
        print(f"    ❌ Expected array, got {type(data)}")
        return False
    
    if len(data) > 0:
        item = data[0]
        required = ['coldStorageId', 'coldStorage', 'rowCount', 'totalWeight', 'totalQty', 'utilization']
        for field in required:
            if field not in item:
                print(f"    ❌ Missing field: {field}")
                return False
        
        cs = item['coldStorage']
        if 'code' not in cs or 'name' not in cs:
            print(f"    ❌ coldStorage missing code or name")
            return False
        
        print(f"    ✅ Structure valid, {len(data)} cold storages")
        print(f"    📊 {cs['name']}: {item['totalWeight']:.1f}kg, {item['utilization']:.1f}% utilization")
    else:
        print(f"    ✅ Empty result (no inventory yet)")
    
    return True

def validate_inventory_by_product(data):
    """Validate inventory by product report"""
    print(f"\n  Validating inventory-reports/by-product...")
    
    if not isinstance(data, list):
        print(f"    ❌ Expected array, got {type(data)}")
        return False
    
    if len(data) > 0:
        item = data[0]
        required = ['productId', 'product', 'rowCount', 'totalWeight', 'minStock', 'lowStock', 'estimatedValue']
        for field in required:
            if field not in item:
                print(f"    ❌ Missing field: {field}")
                return False
        
        # Check sorted by totalWeight desc
        if len(data) > 1:
            for i in range(len(data) - 1):
                if data[i]['totalWeight'] < data[i+1]['totalWeight']:
                    print(f"    ❌ Not sorted by totalWeight desc")
                    return False
        
        print(f"    ✅ Structure valid, {len(data)} products")
        print(f"    📊 Top: {item['product']['name']} - {item['totalWeight']:.1f}kg, Value: Rp {item['estimatedValue']:,.0f}")
    else:
        print(f"    ✅ Empty result (no inventory yet)")
    
    return True

def validate_near_expired(data):
    """Validate near expired report"""
    print(f"\n  Validating inventory-reports/near-expired...")
    
    if not isinstance(data, list):
        print(f"    ❌ Expected array, got {type(data)}")
        return False
    
    if len(data) > 0:
        item = data[0]
        required = ['productId', 'product', 'coldStorage', 'daysToExpire', 'expiredDate', 'weight']
        for field in required:
            if field not in item:
                print(f"    ❌ Missing field: {field}")
                return False
        
        print(f"    ✅ Structure valid, {len(data)} items near expiry")
        print(f"    📊 {item['product']['name']}: {item['weight']:.1f}kg, expires in {item['daysToExpire']} days")
    else:
        print(f"    ✅ Empty result (no near-expired items)")
    
    return True

def validate_damage_recap(data):
    """Validate damage recap report"""
    print(f"\n  Validating inventory-reports/damage-recap...")
    
    required = ['items', 'summary']
    for field in required:
        if field not in data:
            print(f"    ❌ Missing field: {field}")
            return False
    
    if not isinstance(data['items'], list):
        print(f"    ❌ items should be array")
        return False
    
    summary = data['summary']
    if not all(k in summary for k in ['totalRows', 'totalWeight']):
        print(f"    ❌ summary missing required fields")
        return False
    
    # Verify only DAMAGE transactions
    for item in data['items']:
        if item.get('transactionType') != 'DAMAGE':
            print(f"    ❌ Found non-DAMAGE transaction")
            return False
    
    print(f"    ✅ Structure valid")
    print(f"    📊 Total Rows: {summary['totalRows']}, Total Weight (confirmed): {summary['totalWeight']:.1f}kg")
    
    return True

def main():
    print("\n" + "="*60)
    print("BACKEND API TESTING - DASHBOARD + REPORTS + RBAC")
    print("="*60)
    
    # Login all roles
    for role in ["admin", "direktur", "operator"]:
        session = login(role)
        if not session:
            print(f"\n❌ CRITICAL: Failed to login as {role}. Aborting tests.")
            return
        time.sleep(0.5)  # Delay between logins
    
    results = {
        "total": 0,
        "passed": 0,
        "failed": 0
    }
    
    # Test 1: Dashboard Summary - All roles should have access
    print("\n" + "="*60)
    print("TEST 1: GET /dashboard/summary - All roles")
    print("="*60)
    
    for role in ["admin", "direktur", "operator"]:
        print(f"\n--- Testing as {role} ---")
        success, resp = test_endpoint(sessions[role], role, "GET", "/dashboard/summary", 200, f"Dashboard summary as {role}")
        results["total"] += 1
        
        if success and resp:
            try:
                data = resp.json().get('data', {})
                if validate_dashboard_summary(data):
                    results["passed"] += 1
                else:
                    results["failed"] += 1
            except Exception as e:
                print(f"  ❌ Validation error: {str(e)}")
                results["failed"] += 1
        else:
            results["failed"] += 1
        
        time.sleep(0.5)
    
    # Test 2: Purchase Reports - by-supplier (admin, direktur: 200, operator: 403)
    print("\n" + "="*60)
    print("TEST 2: GET /purchase-reports/by-supplier - RBAC")
    print("="*60)
    
    for role, expected in [("admin", 200), ("direktur", 200), ("operator", 403)]:
        print(f"\n--- Testing as {role} ---")
        success, resp = test_endpoint(sessions[role], role, "GET", "/purchase-reports/by-supplier", expected, f"Purchase by supplier as {role}")
        results["total"] += 1
        
        if success and expected == 200 and resp:
            try:
                data = resp.json().get('data', [])
                if validate_purchase_by_supplier(data):
                    results["passed"] += 1
                else:
                    results["failed"] += 1
            except Exception as e:
                print(f"  ❌ Validation error: {str(e)}")
                results["failed"] += 1
        elif success:
            results["passed"] += 1
        else:
            results["failed"] += 1
        
        time.sleep(0.5)
    
    # Test 3: Purchase Reports - ap-aging (admin, direktur: 200, operator: 403)
    print("\n" + "="*60)
    print("TEST 3: GET /purchase-reports/ap-aging - RBAC")
    print("="*60)
    
    for role, expected in [("admin", 200), ("direktur", 200), ("operator", 403)]:
        print(f"\n--- Testing as {role} ---")
        success, resp = test_endpoint(sessions[role], role, "GET", "/purchase-reports/ap-aging", expected, f"AP aging as {role}")
        results["total"] += 1
        
        if success and expected == 200 and resp:
            try:
                data = resp.json().get('data', {})
                if validate_ap_aging(data):
                    results["passed"] += 1
                else:
                    results["failed"] += 1
            except Exception as e:
                print(f"  ❌ Validation error: {str(e)}")
                results["failed"] += 1
        elif success:
            results["passed"] += 1
        else:
            results["failed"] += 1
        
        time.sleep(0.5)
    
    # Test 4: Purchase Reports - susut-recap (admin, direktur: 200, operator: 403)
    print("\n" + "="*60)
    print("TEST 4: GET /purchase-reports/susut-recap - RBAC")
    print("="*60)
    
    for role, expected in [("admin", 200), ("direktur", 200), ("operator", 403)]:
        print(f"\n--- Testing as {role} ---")
        success, resp = test_endpoint(sessions[role], role, "GET", "/purchase-reports/susut-recap", expected, f"Susut recap as {role}")
        results["total"] += 1
        
        if success and expected == 200 and resp:
            try:
                data = resp.json().get('data', {})
                if validate_susut_recap(data):
                    results["passed"] += 1
                else:
                    results["failed"] += 1
            except Exception as e:
                print(f"  ❌ Validation error: {str(e)}")
                results["failed"] += 1
        elif success:
            results["passed"] += 1
        else:
            results["failed"] += 1
        
        time.sleep(0.5)
    
    # Test 5: Production Reports - batches (admin, direktur: 200, operator: 403)
    print("\n" + "="*60)
    print("TEST 5: GET /production-reports/batches - RBAC")
    print("="*60)
    
    for role, expected in [("admin", 200), ("direktur", 200), ("operator", 403)]:
        print(f"\n--- Testing as {role} ---")
        success, resp = test_endpoint(sessions[role], role, "GET", "/production-reports/batches", expected, f"Production batches as {role}")
        results["total"] += 1
        
        if success and expected == 200 and resp:
            try:
                data = resp.json().get('data', {})
                if validate_production_batches(data):
                    results["passed"] += 1
                else:
                    results["failed"] += 1
            except Exception as e:
                print(f"  ❌ Validation error: {str(e)}")
                results["failed"] += 1
        elif success:
            results["passed"] += 1
        else:
            results["failed"] += 1
        
        time.sleep(0.5)
    
    # Test 6: Production Reports - efficiency (admin, direktur: 200, operator: 403)
    print("\n" + "="*60)
    print("TEST 6: GET /production-reports/efficiency - RBAC")
    print("="*60)
    
    for role, expected in [("admin", 200), ("direktur", 200), ("operator", 403)]:
        print(f"\n--- Testing as {role} ---")
        success, resp = test_endpoint(sessions[role], role, "GET", "/production-reports/efficiency", expected, f"Production efficiency as {role}")
        results["total"] += 1
        
        if success and expected == 200 and resp:
            try:
                data = resp.json().get('data', [])
                if validate_production_efficiency(data):
                    results["passed"] += 1
                else:
                    results["failed"] += 1
            except Exception as e:
                print(f"  ❌ Validation error: {str(e)}")
                results["failed"] += 1
        elif success:
            results["passed"] += 1
        else:
            results["failed"] += 1
        
        time.sleep(0.5)
    
    # Test 7: Inventory Reports - by-cs (admin, direktur: 200, operator: 403)
    print("\n" + "="*60)
    print("TEST 7: GET /inventory-reports/by-cs - RBAC")
    print("="*60)
    
    for role, expected in [("admin", 200), ("direktur", 200), ("operator", 403)]:
        print(f"\n--- Testing as {role} ---")
        success, resp = test_endpoint(sessions[role], role, "GET", "/inventory-reports/by-cs", expected, f"Inventory by CS as {role}")
        results["total"] += 1
        
        if success and expected == 200 and resp:
            try:
                data = resp.json().get('data', [])
                if validate_inventory_by_cs(data):
                    results["passed"] += 1
                else:
                    results["failed"] += 1
            except Exception as e:
                print(f"  ❌ Validation error: {str(e)}")
                results["failed"] += 1
        elif success:
            results["passed"] += 1
        else:
            results["failed"] += 1
        
        time.sleep(0.5)
    
    # Test 8: Inventory Reports - by-product (admin, direktur: 200, operator: 403)
    print("\n" + "="*60)
    print("TEST 8: GET /inventory-reports/by-product - RBAC")
    print("="*60)
    
    for role, expected in [("admin", 200), ("direktur", 200), ("operator", 403)]:
        print(f"\n--- Testing as {role} ---")
        success, resp = test_endpoint(sessions[role], role, "GET", "/inventory-reports/by-product", expected, f"Inventory by product as {role}")
        results["total"] += 1
        
        if success and expected == 200 and resp:
            try:
                data = resp.json().get('data', [])
                if validate_inventory_by_product(data):
                    results["passed"] += 1
                else:
                    results["failed"] += 1
            except Exception as e:
                print(f"  ❌ Validation error: {str(e)}")
                results["failed"] += 1
        elif success:
            results["passed"] += 1
        else:
            results["failed"] += 1
        
        time.sleep(0.5)
    
    # Test 9: Inventory Reports - near-expired (all roles: 200)
    print("\n" + "="*60)
    print("TEST 9: GET /inventory-reports/near-expired?days=14 - All roles")
    print("="*60)
    
    for role in ["admin", "direktur", "operator"]:
        print(f"\n--- Testing as {role} ---")
        success, resp = test_endpoint(sessions[role], role, "GET", "/inventory-reports/near-expired?days=14", 200, f"Near expired as {role}")
        results["total"] += 1
        
        if success and resp:
            try:
                data = resp.json().get('data', [])
                if validate_near_expired(data):
                    results["passed"] += 1
                else:
                    results["failed"] += 1
            except Exception as e:
                print(f"  ❌ Validation error: {str(e)}")
                results["failed"] += 1
        else:
            results["failed"] += 1
        
        time.sleep(0.5)
    
    # Test 10: Inventory Reports - damage-recap (admin, direktur: 200, operator: 403)
    print("\n" + "="*60)
    print("TEST 10: GET /inventory-reports/damage-recap - RBAC")
    print("="*60)
    
    for role, expected in [("admin", 200), ("direktur", 200), ("operator", 403)]:
        print(f"\n--- Testing as {role} ---")
        success, resp = test_endpoint(sessions[role], role, "GET", "/inventory-reports/damage-recap", expected, f"Damage recap as {role}")
        results["total"] += 1
        
        if success and expected == 200 and resp:
            try:
                data = resp.json().get('data', {})
                if validate_damage_recap(data):
                    results["passed"] += 1
                else:
                    results["failed"] += 1
            except Exception as e:
                print(f"  ❌ Validation error: {str(e)}")
                results["failed"] += 1
        elif success:
            results["passed"] += 1
        else:
            results["failed"] += 1
        
        time.sleep(0.5)
    
    # Final Summary
    print("\n" + "="*60)
    print("FINAL TEST SUMMARY")
    print("="*60)
    print(f"Total Tests: {results['total']}")
    print(f"✅ Passed: {results['passed']}")
    print(f"❌ Failed: {results['failed']}")
    print(f"Success Rate: {(results['passed']/results['total']*100):.1f}%")
    print("="*60)
    
    if results['failed'] == 0:
        print("\n🎉 ALL TESTS PASSED!")
    else:
        print(f"\n⚠️  {results['failed']} test(s) failed. Review output above for details.")

if __name__ == "__main__":
    main()
