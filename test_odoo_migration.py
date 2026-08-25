#!/usr/bin/env python3
"""
Backend API Test for Odoo Historical SO/PO Import
Tests migrated flag + June-Aug 2026 visibility + accounting safety
"""

import requests
import json
import sys
import sqlite3

BASE_URL = "http://localhost:3000/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
DB_PATH = "/app/data/erp.db"

def print_test(name, passed, details=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"   {details}")
    print()

def login_admin():
    """Login as admin and return session"""
    print("=== AUTHENTICATING AS ADMIN ===")
    session = requests.Session()
    
    auth_url = "http://localhost:3000/api/auth/sign-in/email"
    payload = {
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    }
    
    try:
        resp = session.post(auth_url, json=payload)
        print(f"Login response status: {resp.status_code}")
        
        if resp.status_code == 200:
            print("✅ Admin login successful")
            return session
        else:
            print(f"❌ Login failed: {resp.status_code} - {resp.text}")
            return None
    except Exception as e:
        print(f"❌ Login error: {e}")
        return None

def query_db(query):
    """Execute a SQL query and return results"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(query)
        results = cursor.fetchall()
        conn.close()
        return results
    except Exception as e:
        print(f"❌ DB query error: {e}")
        return None

def test_so_listing_gating(session):
    """Test 1: SO listing gating"""
    print("\n" + "="*80)
    print("TEST 1: SO LISTING GATING")
    print("="*80)
    
    all_passed = True
    
    # Test 1.1: Default (archived hidden) - expect 120
    print("\n--- Test 1.1: GET /api/sales-orders (default, archived hidden) ---")
    try:
        resp = session.get(f"{BASE_URL}/sales-orders")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            so_list = data.get("data", [])
            count = len(so_list)
            print(f"Count: {count}")
            
            if count == 120:
                # Verify each row has customer enrichment
                has_customer = all(so.get("customer") and so["customer"].get("code") and so["customer"].get("name") for so in so_list)
                if has_customer:
                    print_test("SO default listing (120 visible)", True, f"Count={count}, all have customer enrichment")
                else:
                    print_test("SO default listing", False, "Some rows missing customer enrichment")
                    all_passed = False
            else:
                print_test("SO default listing", False, f"Expected 120, got {count}")
                all_passed = False
        else:
            print_test("SO default listing", False, f"Expected 200, got {resp.status_code}")
            all_passed = False
    except Exception as e:
        print_test("SO default listing", False, f"Exception: {e}")
        all_passed = False
    
    # Test 1.2: archived=1 - expect 89
    print("\n--- Test 1.2: GET /api/sales-orders?archived=1 ---")
    try:
        resp = session.get(f"{BASE_URL}/sales-orders?archived=1")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            count = len(data.get("data", []))
            print(f"Count: {count}")
            
            if count == 89:
                print_test("SO archived listing (89)", True, f"Count={count}")
            else:
                print_test("SO archived listing", False, f"Expected 89, got {count}")
                all_passed = False
        else:
            print_test("SO archived listing", False, f"Expected 200, got {resp.status_code}")
            all_passed = False
    except Exception as e:
        print_test("SO archived listing", False, f"Exception: {e}")
        all_passed = False
    
    # Test 1.3: archived=all - expect 209
    print("\n--- Test 1.3: GET /api/sales-orders?archived=all ---")
    try:
        resp = session.get(f"{BASE_URL}/sales-orders?archived=all")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            count = len(data.get("data", []))
            print(f"Count: {count}")
            
            if count == 209:
                print_test("SO all listing (209)", True, f"Count={count}")
            else:
                print_test("SO all listing", False, f"Expected 209, got {count}")
                all_passed = False
        else:
            print_test("SO all listing", False, f"Expected 200, got {resp.status_code}")
            all_passed = False
    except Exception as e:
        print_test("SO all listing", False, f"Exception: {e}")
        all_passed = False
    
    return all_passed

def test_po_listing_gating(session):
    """Test 2: PO listing gating"""
    print("\n" + "="*80)
    print("TEST 2: PO LISTING GATING")
    print("="*80)
    
    all_passed = True
    
    # Test 2.1: Default (archived hidden) - expect 25
    print("\n--- Test 2.1: GET /api/purchase-orders (default, archived hidden) ---")
    try:
        resp = session.get(f"{BASE_URL}/purchase-orders")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            po_list = data.get("data", [])
            count = len(po_list)
            print(f"Count: {count}")
            
            if count == 25:
                # Verify each row has supplier enrichment
                has_supplier = all(po.get("supplier") for po in po_list)
                if has_supplier:
                    print_test("PO default listing (25 visible)", True, f"Count={count}, all have supplier enrichment")
                else:
                    print_test("PO default listing", False, "Some rows missing supplier enrichment")
                    all_passed = False
            else:
                print_test("PO default listing", False, f"Expected 25, got {count}")
                all_passed = False
        else:
            print_test("PO default listing", False, f"Expected 200, got {resp.status_code}")
            all_passed = False
    except Exception as e:
        print_test("PO default listing", False, f"Exception: {e}")
        all_passed = False
    
    # Test 2.2: archived=1 - expect 26
    print("\n--- Test 2.2: GET /api/purchase-orders?archived=1 ---")
    try:
        resp = session.get(f"{BASE_URL}/purchase-orders?archived=1")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            count = len(data.get("data", []))
            print(f"Count: {count}")
            
            if count == 26:
                print_test("PO archived listing (26)", True, f"Count={count}")
            else:
                print_test("PO archived listing", False, f"Expected 26, got {count}")
                all_passed = False
        else:
            print_test("PO archived listing", False, f"Expected 200, got {resp.status_code}")
            all_passed = False
    except Exception as e:
        print_test("PO archived listing", False, f"Exception: {e}")
        all_passed = False
    
    # Test 2.3: archived=all - expect 51
    print("\n--- Test 2.3: GET /api/purchase-orders?archived=all ---")
    try:
        resp = session.get(f"{BASE_URL}/purchase-orders?archived=all")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            count = len(data.get("data", []))
            print(f"Count: {count}")
            
            if count == 51:
                print_test("PO all listing (51)", True, f"Count={count}")
            else:
                print_test("PO all listing", False, f"Expected 51, got {count}")
                all_passed = False
        else:
            print_test("PO all listing", False, f"Expected 200, got {resp.status_code}")
            all_passed = False
    except Exception as e:
        print_test("PO all listing", False, f"Exception: {e}")
        all_passed = False
    
    return all_passed

def test_so_detail_endpoints(session):
    """Test 3: SO detail endpoints"""
    print("\n" + "="*80)
    print("TEST 3: SO DETAIL ENDPOINTS")
    print("="*80)
    
    all_passed = True
    
    # Get a visible migrated SO (so_number like 'S00%')
    print("\n--- Finding visible migrated SO (so_number like 'S00%') ---")
    visible_so_query = """
        SELECT id, so_number, pipeline_status 
        FROM sales_order 
        WHERE migrated = 1 
        AND archived_at IS NULL 
        AND so_number LIKE 'S00%'
        LIMIT 1
    """
    visible_so = query_db(visible_so_query)
    
    if visible_so and len(visible_so) > 0:
        so_id, so_number, pipeline_status = visible_so[0]
        print(f"Found visible SO: {so_number} (ID: {so_id}, status: {pipeline_status})")
        
        print(f"\n--- Test 3.1: GET /api/sales-orders/{so_id} (visible migrated SO) ---")
        try:
            resp = session.get(f"{BASE_URL}/sales-orders/{so_id}")
            print(f"Status: {resp.status_code}")
            
            if resp.status_code == 200:
                data = resp.json()
                so_data = data.get("data", {})
                
                # Verify header fields
                has_header = so_data.get("id") and so_data.get("soNumber")
                has_customer = so_data.get("customer") and so_data["customer"].get("code") and (so_data["customer"].get("name") or so_data["customer"].get("displayName"))
                has_items = isinstance(so_data.get("items"), list)
                
                # Verify items resolve to real products (no nulls)
                items_valid = True
                if has_items and len(so_data["items"]) > 0:
                    for item in so_data["items"]:
                        if not item.get("productId"):
                            items_valid = False
                            print(f"   ⚠ Item missing productId: {item}")
                
                if has_header and has_customer and has_items and items_valid:
                    print_test(f"SO detail {so_number} (visible)", True, f"Header + customer + {len(so_data['items'])} items OK")
                else:
                    print_test(f"SO detail {so_number}", False, f"Missing fields: header={has_header}, customer={has_customer}, items={has_items}, items_valid={items_valid}")
                    all_passed = False
            else:
                print_test(f"SO detail {so_number}", False, f"Expected 200, got {resp.status_code}: {resp.text}")
                all_passed = False
        except Exception as e:
            print_test(f"SO detail {so_number}", False, f"Exception: {e}")
            all_passed = False
    else:
        print("⚠ No visible migrated SO found")
        all_passed = False
    
    # Get an archived migrated SO
    print("\n--- Finding archived migrated SO ---")
    archived_so_query = """
        SELECT id, so_number, pipeline_status 
        FROM sales_order 
        WHERE migrated = 1 
        AND archived_at IS NOT NULL 
        AND so_number LIKE 'S00%'
        LIMIT 1
    """
    archived_so = query_db(archived_so_query)
    
    if archived_so and len(archived_so) > 0:
        so_id, so_number, pipeline_status = archived_so[0]
        print(f"Found archived SO: {so_number} (ID: {so_id}, status: {pipeline_status})")
        
        print(f"\n--- Test 3.2: GET /api/sales-orders/{so_id} (archived migrated SO) ---")
        try:
            resp = session.get(f"{BASE_URL}/sales-orders/{so_id}")
            print(f"Status: {resp.status_code}")
            
            if resp.status_code == 200:
                data = resp.json()
                so_data = data.get("data", {})
                
                has_header = so_data.get("id") and so_data.get("soNumber")
                has_customer = so_data.get("customer")
                has_items = isinstance(so_data.get("items"), list)
                
                if has_header and has_customer and has_items:
                    print_test(f"SO detail {so_number} (archived)", True, f"Header + customer + {len(so_data['items'])} items OK")
                else:
                    print_test(f"SO detail {so_number}", False, f"Missing fields")
                    all_passed = False
            else:
                print_test(f"SO detail {so_number}", False, f"Expected 200, got {resp.status_code}")
                all_passed = False
        except Exception as e:
            print_test(f"SO detail {so_number}", False, f"Exception: {e}")
            all_passed = False
    else:
        print("⚠ No archived migrated SO found")
    
    # Test Cancelled SO (pipeline='Cancelled')
    print("\n--- Finding Cancelled migrated SO ---")
    cancelled_so_query = """
        SELECT id, so_number 
        FROM sales_order 
        WHERE migrated = 1 
        AND pipeline_status = 'Cancelled'
        LIMIT 1
    """
    cancelled_so = query_db(cancelled_so_query)
    
    if cancelled_so and len(cancelled_so) > 0:
        so_id, so_number = cancelled_so[0]
        print(f"Found Cancelled SO: {so_number} (ID: {so_id})")
        
        print(f"\n--- Test 3.3: GET /api/sales-orders/{so_id} (Cancelled SO, no crash) ---")
        try:
            resp = session.get(f"{BASE_URL}/sales-orders/{so_id}")
            print(f"Status: {resp.status_code}")
            
            if resp.status_code == 200:
                print_test(f"SO detail {so_number} (Cancelled)", True, "No crash, returns 200")
            elif resp.status_code == 404:
                print_test(f"SO detail {so_number} (Cancelled)", True, "Returns 404 (acceptable)")
            else:
                print_test(f"SO detail {so_number}", False, f"Unexpected status: {resp.status_code}")
                all_passed = False
        except Exception as e:
            print_test(f"SO detail {so_number}", False, f"Exception: {e}")
            all_passed = False
    else:
        print("⚠ No Cancelled migrated SO found")
    
    return all_passed

def test_po_detail_endpoints(session):
    """Test 4: PO detail endpoints"""
    print("\n" + "="*80)
    print("TEST 4: PO DETAIL ENDPOINTS")
    print("="*80)
    
    all_passed = True
    
    # Get a visible migrated PO (po_number like 'P00%')
    print("\n--- Finding visible migrated PO (po_number like 'P00%') ---")
    visible_po_query = """
        SELECT id, po_number, pipeline_status 
        FROM purchase_order 
        WHERE migrated = 1 
        AND archived_at IS NULL 
        AND po_number LIKE 'P00%'
        LIMIT 1
    """
    visible_po = query_db(visible_po_query)
    
    if visible_po and len(visible_po) > 0:
        po_id, po_number, pipeline_status = visible_po[0]
        print(f"Found visible PO: {po_number} (ID: {po_id}, status: {pipeline_status})")
        
        print(f"\n--- Test 4.1: GET /api/purchase-orders/{po_id} (visible migrated PO) ---")
        try:
            resp = session.get(f"{BASE_URL}/purchase-orders/{po_id}")
            print(f"Status: {resp.status_code}")
            
            if resp.status_code == 200:
                data = resp.json()
                po_data = data.get("data", {})
                
                has_header = po_data.get("id") and po_data.get("poNumber")
                has_supplier = po_data.get("supplier")
                has_items = isinstance(po_data.get("items"), list)
                
                # Verify items resolve to real products
                items_valid = True
                if has_items and len(po_data["items"]) > 0:
                    for item in po_data["items"]:
                        if not item.get("productId"):
                            items_valid = False
                            print(f"   ⚠ Item missing productId: {item}")
                
                if has_header and has_supplier and has_items and items_valid:
                    print_test(f"PO detail {po_number} (visible)", True, f"Header + supplier + {len(po_data['items'])} items OK")
                else:
                    print_test(f"PO detail {po_number}", False, f"Missing fields")
                    all_passed = False
            else:
                print_test(f"PO detail {po_number}", False, f"Expected 200, got {resp.status_code}")
                all_passed = False
        except Exception as e:
            print_test(f"PO detail {po_number}", False, f"Exception: {e}")
            all_passed = False
    else:
        print("⚠ No visible migrated PO found")
        all_passed = False
    
    # Get an archived migrated PO
    print("\n--- Finding archived migrated PO ---")
    archived_po_query = """
        SELECT id, po_number, pipeline_status 
        FROM purchase_order 
        WHERE migrated = 1 
        AND archived_at IS NOT NULL 
        AND po_number LIKE 'P00%'
        LIMIT 1
    """
    archived_po = query_db(archived_po_query)
    
    if archived_po and len(archived_po) > 0:
        po_id, po_number, pipeline_status = archived_po[0]
        print(f"Found archived PO: {po_number} (ID: {po_id}, status: {pipeline_status})")
        
        print(f"\n--- Test 4.2: GET /api/purchase-orders/{po_id} (archived migrated PO) ---")
        try:
            resp = session.get(f"{BASE_URL}/purchase-orders/{po_id}")
            print(f"Status: {resp.status_code}")
            
            if resp.status_code == 200:
                data = resp.json()
                po_data = data.get("data", {})
                
                has_header = po_data.get("id") and po_data.get("poNumber")
                has_supplier = po_data.get("supplier")
                has_items = isinstance(po_data.get("items"), list)
                
                if has_header and has_supplier and has_items:
                    print_test(f"PO detail {po_number} (archived)", True, f"Header + supplier + {len(po_data['items'])} items OK")
                else:
                    print_test(f"PO detail {po_number}", False, f"Missing fields")
                    all_passed = False
            else:
                print_test(f"PO detail {po_number}", False, f"Expected 200, got {resp.status_code}")
                all_passed = False
        except Exception as e:
            print_test(f"PO detail {po_number}", False, f"Exception: {e}")
            all_passed = False
    else:
        print("⚠ No archived migrated PO found")
    
    # Test 'Dibatalkan' PO
    print("\n--- Finding 'Dibatalkan' migrated PO ---")
    dibatalkan_po_query = """
        SELECT id, po_number 
        FROM purchase_order 
        WHERE migrated = 1 
        AND pipeline_status = 'Dibatalkan'
        LIMIT 1
    """
    dibatalkan_po = query_db(dibatalkan_po_query)
    
    if dibatalkan_po and len(dibatalkan_po) > 0:
        po_id, po_number = dibatalkan_po[0]
        print(f"Found Dibatalkan PO: {po_number} (ID: {po_id})")
        
        print(f"\n--- Test 4.3: GET /api/purchase-orders/{po_id} (Dibatalkan PO, no crash) ---")
        try:
            resp = session.get(f"{BASE_URL}/purchase-orders/{po_id}")
            print(f"Status: {resp.status_code}")
            
            if resp.status_code == 200:
                print_test(f"PO detail {po_number} (Dibatalkan)", True, "No crash, returns 200")
            elif resp.status_code == 404:
                print_test(f"PO detail {po_number} (Dibatalkan)", True, "Returns 404 (acceptable)")
            else:
                print_test(f"PO detail {po_number}", False, f"Unexpected status: {resp.status_code}")
                all_passed = False
        except Exception as e:
            print_test(f"PO detail {po_number}", False, f"Exception: {e}")
            all_passed = False
    else:
        print("⚠ No Dibatalkan migrated PO found")
    
    return all_passed

def test_accounting_safety(session):
    """Test 5: CRITICAL - Accounting safety"""
    print("\n" + "="*80)
    print("TEST 5: CRITICAL - ACCOUNTING SAFETY")
    print("="*80)
    
    all_passed = True
    
    # Step 1: Record journal_entries count BEFORE
    print("\n--- Step 1: Count journal_entries BEFORE sync ---")
    count_query = "SELECT COUNT(*) FROM journal_entries"
    before_count_result = query_db(count_query)
    
    if before_count_result:
        before_count = before_count_result[0][0]
        print(f"journal_entries count BEFORE: {before_count}")
        
        if before_count == 1:
            print_test("journal_entries count BEFORE", True, f"Count = {before_count} (only OPENING)")
        else:
            print_test("journal_entries count BEFORE", False, f"Expected 1, got {before_count}")
            all_passed = False
    else:
        print_test("journal_entries count BEFORE", False, "Query failed")
        all_passed = False
    
    # Step 2: POST /api/accounting/sync
    print("\n--- Step 2: POST /api/accounting/sync (idempotent rebuild) ---")
    try:
        resp = session.post(f"{BASE_URL}/accounting/sync")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            print_test("POST /api/accounting/sync", True, "Sync completed successfully")
        else:
            print_test("POST /api/accounting/sync", False, f"Expected 200, got {resp.status_code}: {resp.text}")
            all_passed = False
    except Exception as e:
        print_test("POST /api/accounting/sync", False, f"Exception: {e}")
        all_passed = False
    
    # Step 3: Record journal_entries count AFTER
    print("\n--- Step 3: Count journal_entries AFTER sync ---")
    after_count_result = query_db(count_query)
    
    if after_count_result:
        after_count = after_count_result[0][0]
        print(f"journal_entries count AFTER: {after_count}")
        
        if after_count == 1:
            print_test("journal_entries count AFTER", True, f"Count = {after_count} (still only OPENING)")
        else:
            print_test("journal_entries count AFTER", False, f"Expected 1, got {after_count} (CRITICAL: migrated orders leaked into journals!)")
            all_passed = False
    else:
        print_test("journal_entries count AFTER", False, "Query failed")
        all_passed = False
    
    # Step 4: Verify NO journal_entries with migrated source_type
    print("\n--- Step 4: Verify NO journal_entries with migrated source_type ---")
    migrated_source_types = ['SO_INV', 'PO_INV', 'CASHBACK', 'SPAY', 'PPAY', 'SRET', 'PRET']
    source_type_query = f"""
        SELECT COUNT(*) 
        FROM journal_entries 
        WHERE source_type IN ({','.join([f"'{st}'" for st in migrated_source_types])})
    """
    source_type_result = query_db(source_type_query)
    
    if source_type_result:
        source_type_count = source_type_result[0][0]
        print(f"journal_entries with migrated source_type: {source_type_count}")
        
        if source_type_count == 0:
            print_test("NO migrated source_type journals", True, "Count = 0")
        else:
            print_test("NO migrated source_type journals", False, f"Found {source_type_count} journals with migrated source_type (CRITICAL!)")
            all_passed = False
    else:
        print_test("NO migrated source_type journals", False, "Query failed")
        all_passed = False
    
    # Step 5: Verify NO journal references migrated order numbers (S00% / P00%)
    print("\n--- Step 5: Verify NO journal references migrated order numbers ---")
    migrated_order_query = """
        SELECT COUNT(*) 
        FROM journal_entries 
        WHERE source_number LIKE 'S00%' OR source_number LIKE 'P00%'
    """
    migrated_order_result = query_db(migrated_order_query)
    
    if migrated_order_result:
        migrated_order_count = migrated_order_result[0][0]
        print(f"journal_entries referencing S00%/P00%: {migrated_order_count}")
        
        if migrated_order_count == 0:
            print_test("NO migrated order number journals", True, "Count = 0")
        else:
            print_test("NO migrated order number journals", False, f"Found {migrated_order_count} journals referencing migrated orders (CRITICAL!)")
            all_passed = False
    else:
        print_test("NO migrated order number journals", False, "Query failed")
        all_passed = False
    
    # Step 6: Verify trial balance is balanced
    print("\n--- Step 6: Verify trial balance is balanced ---")
    try:
        resp = session.get(f"{BASE_URL}/accounting/trial-balance")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            trial_balance = data.get("data", {})
            
            total_debit = trial_balance.get("totalDebit", 0)
            total_credit = trial_balance.get("totalCredit", 0)
            
            print(f"totalDebit: {total_debit}")
            print(f"totalCredit: {total_credit}")
            
            if total_debit == total_credit:
                print_test("Trial balance balanced", True, f"Dr={total_debit}, Cr={total_credit}")
            else:
                print_test("Trial balance balanced", False, f"UNBALANCED: Dr={total_debit}, Cr={total_credit}")
                all_passed = False
        else:
            print_test("Trial balance", False, f"Expected 200, got {resp.status_code}")
            all_passed = False
    except Exception as e:
        print_test("Trial balance", False, f"Exception: {e}")
        all_passed = False
    
    return all_passed

def test_regression_no_crashes(session):
    """Test 6: Regression - no crashes"""
    print("\n" + "="*80)
    print("TEST 6: REGRESSION - NO CRASHES")
    print("="*80)
    
    all_passed = True
    
    # Test SO list endpoint
    print("\n--- Test 6.1: GET /api/sales-orders (no crash) ---")
    try:
        resp = session.get(f"{BASE_URL}/sales-orders")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            print_test("SO list endpoint", True, "Returns 200, no crash")
        else:
            print_test("SO list endpoint", False, f"Expected 200, got {resp.status_code}")
            all_passed = False
    except Exception as e:
        print_test("SO list endpoint", False, f"Exception: {e}")
        all_passed = False
    
    # Test PO list endpoint
    print("\n--- Test 6.2: GET /api/purchase-orders (no crash) ---")
    try:
        resp = session.get(f"{BASE_URL}/purchase-orders")
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            print_test("PO list endpoint", True, "Returns 200, no crash")
        else:
            print_test("PO list endpoint", False, f"Expected 200, got {resp.status_code}")
            all_passed = False
    except Exception as e:
        print_test("PO list endpoint", False, f"Exception: {e}")
        all_passed = False
    
    return all_passed

def main():
    print("\n" + "="*80)
    print("BACKEND TEST: ODOO HISTORICAL SO/PO IMPORT")
    print("="*80)
    
    # Login as admin
    session = login_admin()
    if not session:
        print("\n❌ CRITICAL: Cannot proceed without admin session")
        return 1
    
    # Run all tests
    results = []
    
    try:
        results.append(("SO Listing Gating", test_so_listing_gating(session)))
        results.append(("PO Listing Gating", test_po_listing_gating(session)))
        results.append(("SO Detail Endpoints", test_so_detail_endpoints(session)))
        results.append(("PO Detail Endpoints", test_po_detail_endpoints(session)))
        results.append(("Accounting Safety (CRITICAL)", test_accounting_safety(session)))
        results.append(("Regression - No Crashes", test_regression_no_crashes(session)))
        
        # Summary
        print("\n" + "="*80)
        print("TEST SUMMARY")
        print("="*80)
        
        all_passed = True
        for test_name, passed in results:
            status = "✅ PASS" if passed else "❌ FAIL"
            print(f"{status}: {test_name}")
            if not passed:
                all_passed = False
        
        print("\n" + "="*80)
        if all_passed:
            print("✅ ALL TESTS PASSED")
            print("="*80)
            return 0
        else:
            print("❌ SOME TESTS FAILED")
            print("="*80)
            return 1
    except Exception as e:
        print(f"\n❌ CRITICAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())
