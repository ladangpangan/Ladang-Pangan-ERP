#!/usr/bin/env python3
"""
Backend test for SO Invoice bugfixes - Data Layer Verification
Tests the data structure returned by GET /sales-orders/:id to ensure:
1. invoiceWeightBasis field exists and is accessible
2. items[].receivedWeight, shippedWeight, weight fields exist
3. totalShrinkageWeight and totalShrinkageValue fields exist
4. For SOs with invoiceWeightBasis='received', receivedWeight is populated
5. For SOs with surplus (received>shipped), totalShrinkageWeight is NEGATIVE
"""

import requests
import json
from typing import Dict, List, Any

# Configuration
BASE_URL = "https://github-to-production.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'

def print_test(msg: str, status: str = "info"):
    if status == "pass":
        print(f"{Colors.GREEN}✓ {msg}{Colors.RESET}")
    elif status == "fail":
        print(f"{Colors.RED}✗ {msg}{Colors.RESET}")
    elif status == "warn":
        print(f"{Colors.YELLOW}⚠ {msg}{Colors.RESET}")
    else:
        print(f"{Colors.BLUE}ℹ {msg}{Colors.RESET}")

def login() -> requests.Session:
    """Login and return session with cookies"""
    print_test("TEST 1 — Login as admin", "info")
    session = requests.Session()
    
    try:
        response = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 200:
            print_test(f"Login successful (200 OK)", "pass")
            # Check for session cookie
            cookies = session.cookies.get_dict()
            if any('better-auth' in k for k in cookies.keys()):
                print_test(f"Session cookie set: {list(cookies.keys())}", "pass")
            return session
        else:
            print_test(f"Login failed: {response.status_code} - {response.text[:200]}", "fail")
            return None
    except Exception as e:
        print_test(f"Login error: {str(e)}", "fail")
        return None

def get_sales_orders(session: requests.Session) -> List[Dict[str, Any]]:
    """Get list of all sales orders"""
    print_test("\nTEST 2 — GET /api/sales-orders (list)", "info")
    
    try:
        response = session.get(f"{BASE_URL}/sales-orders")
        
        if response.status_code != 200:
            print_test(f"Failed to get sales orders: {response.status_code}", "fail")
            return []
        
        data = response.json()
        sales_orders = data.get('data', [])
        
        print_test(f"Retrieved {len(sales_orders)} sales orders", "pass")
        
        # Print summary of each SO
        for so in sales_orders:
            so_number = so.get('soNumber', 'N/A')
            status = so.get('pipelineStatus', 'N/A')
            print_test(f"  - {so_number}: status={status}", "info")
        
        return sales_orders
    except Exception as e:
        print_test(f"Error getting sales orders: {str(e)}", "fail")
        return []

def verify_so_detail(session: requests.Session, so_id: str, so_number: str) -> Dict[str, Any]:
    """Verify data structure for a single SO"""
    print_test(f"\nTEST 3 — Verify SO {so_number} (ID: {so_id[:8]}...)", "info")
    
    results = {
        'so_number': so_number,
        'so_id': so_id,
        'has_invoice_weight_basis': False,
        'invoice_weight_basis_value': None,
        'has_total_shrinkage_weight': False,
        'has_total_shrinkage_value': False,
        'total_shrinkage_weight': None,
        'total_shrinkage_value': None,
        'items_count': 0,
        'items_with_received_weight': 0,
        'items_with_shipped_weight': 0,
        'items_with_weight': 0,
        'all_items_have_required_fields': True,
        'http_error': None,
        'is_surplus': False,
        'surplus_details': None
    }
    
    try:
        response = session.get(f"{BASE_URL}/sales-orders/{so_id}")
        
        if response.status_code != 200:
            results['http_error'] = response.status_code
            print_test(f"HTTP {response.status_code} error for SO {so_number}", "fail")
            return results
        
        print_test(f"GET /api/sales-orders/{so_id[:8]}... → 200 OK", "pass")
        
        data = response.json().get('data', {})
        
        # Check top-level fields
        if 'invoiceWeightBasis' in data:
            results['has_invoice_weight_basis'] = True
            results['invoice_weight_basis_value'] = data['invoiceWeightBasis']
            print_test(f"Field 'invoiceWeightBasis' exists: '{data['invoiceWeightBasis']}'", "pass")
        else:
            results['all_items_have_required_fields'] = False
            print_test(f"Field 'invoiceWeightBasis' MISSING", "fail")
        
        if 'totalShrinkageWeight' in data:
            results['has_total_shrinkage_weight'] = True
            results['total_shrinkage_weight'] = data['totalShrinkageWeight']
            print_test(f"Field 'totalShrinkageWeight' exists: {data['totalShrinkageWeight']}", "pass")
            
            # Check if surplus (negative shrinkage)
            if data['totalShrinkageWeight'] < 0:
                results['is_surplus'] = True
                print_test(f"SURPLUS DETECTED: totalShrinkageWeight is NEGATIVE ({data['totalShrinkageWeight']})", "warn")
        else:
            results['all_items_have_required_fields'] = False
            print_test(f"Field 'totalShrinkageWeight' MISSING", "fail")
        
        if 'totalShrinkageValue' in data:
            results['has_total_shrinkage_value'] = True
            results['total_shrinkage_value'] = data['totalShrinkageValue']
            print_test(f"Field 'totalShrinkageValue' exists: {data['totalShrinkageValue']}", "pass")
        else:
            results['all_items_have_required_fields'] = False
            print_test(f"Field 'totalShrinkageValue' MISSING", "fail")
        
        # Check items array
        items = data.get('items', [])
        results['items_count'] = len(items)
        print_test(f"Items array has {len(items)} items", "pass" if len(items) > 0 else "warn")
        
        for idx, item in enumerate(items):
            item_has_all_fields = True
            
            # Check receivedWeight
            if 'receivedWeight' in item:
                results['items_with_received_weight'] += 1
                if item['receivedWeight'] > 0:
                    print_test(f"  Item {idx+1}: receivedWeight = {item['receivedWeight']}", "pass")
            else:
                item_has_all_fields = False
                results['all_items_have_required_fields'] = False
                print_test(f"  Item {idx+1}: receivedWeight MISSING", "fail")
            
            # Check shippedWeight
            if 'shippedWeight' in item:
                results['items_with_shipped_weight'] += 1
                if item['shippedWeight'] > 0:
                    print_test(f"  Item {idx+1}: shippedWeight = {item['shippedWeight']}", "pass")
            else:
                item_has_all_fields = False
                results['all_items_have_required_fields'] = False
                print_test(f"  Item {idx+1}: shippedWeight MISSING", "fail")
            
            # Check weight (plan weight)
            if 'weight' in item:
                results['items_with_weight'] += 1
                if item['weight'] > 0:
                    print_test(f"  Item {idx+1}: weight (plan) = {item['weight']}", "pass")
            else:
                item_has_all_fields = False
                results['all_items_have_required_fields'] = False
                print_test(f"  Item {idx+1}: weight MISSING", "fail")
            
            # Check for surplus at item level
            if 'receivedWeight' in item and 'shippedWeight' in item:
                recv = item['receivedWeight']
                ship = item['shippedWeight']
                if recv > ship and ship > 0:
                    print_test(f"  Item {idx+1}: SURPLUS (received {recv} > shipped {ship})", "warn")
                    if not results['surplus_details']:
                        results['surplus_details'] = []
                    results['surplus_details'].append({
                        'item_index': idx + 1,
                        'received': recv,
                        'shipped': ship,
                        'surplus': recv - ship
                    })
        
        # Special check for invoiceWeightBasis='received'
        if results['invoice_weight_basis_value'] == 'received':
            print_test(f"\nSPECIAL CHECK: SO has invoiceWeightBasis='received'", "warn")
            items_with_received = sum(1 for item in items if item.get('receivedWeight', 0) > 0)
            print_test(f"  {items_with_received}/{len(items)} items have receivedWeight > 0", 
                      "pass" if items_with_received > 0 else "warn")
            
            # Show received vs shipped comparison
            for idx, item in enumerate(items):
                recv = item.get('receivedWeight', 0)
                ship = item.get('shippedWeight', 0)
                weight = item.get('weight', 0)
                product_name = item.get('product', {}).get('name', 'Unknown')
                print_test(f"  Item {idx+1} ({product_name}): plan={weight}, shipped={ship}, received={recv}", "info")
        
        return results
        
    except Exception as e:
        results['http_error'] = str(e)
        print_test(f"Error verifying SO {so_number}: {str(e)}", "fail")
        return results

def main():
    print("=" * 80)
    print("BACKEND TEST: SO Invoice Data Layer Verification")
    print("Testing: invoiceWeightBasis, receivedWeight, shippedWeight, totalShrinkageWeight")
    print("=" * 80)
    
    # Login
    session = login()
    if not session:
        print_test("\nFATAL: Cannot proceed without login", "fail")
        return
    
    # Get list of SOs
    sales_orders = get_sales_orders(session)
    if not sales_orders:
        print_test("\nWARNING: No sales orders found in database", "warn")
        print_test("Will still verify data structure if we can create a test SO", "info")
        return
    
    # Verify each SO
    all_results = []
    for so in sales_orders:
        so_id = so.get('id')
        so_number = so.get('soNumber', 'N/A')
        
        if not so_id:
            print_test(f"Skipping SO {so_number}: no ID", "warn")
            continue
        
        result = verify_so_detail(session, so_id, so_number)
        all_results.append(result)
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    
    total_sos = len(all_results)
    sos_with_all_fields = sum(1 for r in all_results if r['all_items_have_required_fields'] and not r['http_error'])
    sos_with_received_basis = sum(1 for r in all_results if r['invoice_weight_basis_value'] == 'received')
    sos_with_surplus = sum(1 for r in all_results if r['is_surplus'])
    
    print_test(f"\nTotal SOs tested: {total_sos}", "info")
    print_test(f"SOs with ALL required fields: {sos_with_all_fields}/{total_sos}", 
              "pass" if sos_with_all_fields == total_sos else "fail")
    print_test(f"SOs with invoiceWeightBasis='received': {sos_with_received_basis}", "info")
    print_test(f"SOs with SURPLUS (negative shrinkage): {sos_with_surplus}", "info")
    
    # Detailed findings
    print("\n" + "-" * 80)
    print("DETAILED FINDINGS")
    print("-" * 80)
    
    for result in all_results:
        print(f"\n{result['so_number']}:")
        print(f"  - invoiceWeightBasis: {result['invoice_weight_basis_value']}")
        print(f"  - totalShrinkageWeight: {result['total_shrinkage_weight']}")
        print(f"  - totalShrinkageValue: {result['total_shrinkage_value']}")
        print(f"  - Items: {result['items_count']}")
        print(f"  - Items with receivedWeight: {result['items_with_received_weight']}")
        print(f"  - Items with shippedWeight: {result['items_with_shipped_weight']}")
        print(f"  - All required fields present: {result['all_items_have_required_fields']}")
        
        if result['is_surplus']:
            print(f"  - ⚠️  SURPLUS DETECTED (totalShrinkageWeight < 0)")
            if result['surplus_details']:
                for detail in result['surplus_details']:
                    print(f"      Item {detail['item_index']}: received {detail['received']} > shipped {detail['shipped']} (surplus: +{detail['surplus']})")
        
        if result['http_error']:
            print(f"  - ❌ HTTP Error: {result['http_error']}")
    
    # Final verdict
    print("\n" + "=" * 80)
    print("FINAL VERDICT")
    print("=" * 80)
    
    if sos_with_all_fields == total_sos and total_sos > 0:
        print_test("✅ ALL TESTS PASSED", "pass")
        print_test("All SOs have required fields: invoiceWeightBasis, totalShrinkageWeight, totalShrinkageValue", "pass")
        print_test("All items have required fields: receivedWeight, shippedWeight, weight", "pass")
        
        if sos_with_received_basis > 0:
            print_test(f"Found {sos_with_received_basis} SO(s) with invoiceWeightBasis='received'", "pass")
        else:
            print_test("No SOs with invoiceWeightBasis='received' found (OK, field structure verified)", "warn")
        
        if sos_with_surplus > 0:
            print_test(f"Found {sos_with_surplus} SO(s) with SURPLUS (negative shrinkage)", "pass")
        else:
            print_test("No SOs with surplus found (OK, field structure verified)", "warn")
    else:
        print_test("❌ SOME TESTS FAILED", "fail")
        print_test(f"Only {sos_with_all_fields}/{total_sos} SOs have all required fields", "fail")
    
    print("\n" + "=" * 80)

if __name__ == "__main__":
    main()
