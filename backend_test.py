#!/usr/bin/env python3
"""
Backend test for Excel Export endpoints (GET /api/export/:module)
Tests: Auth, Structure, Accounting COA, Data correctness, Unknown module
"""

import requests
import json
import subprocess
import sys
import time
from datetime import datetime

BASE_URL = "http://localhost:3000/api"
ORIGIN = "http://localhost:3000"

# Test results tracking
test_results = {
    "T1_auth_no_cookie": False,
    "T1_auth_operator_403": False,
    "T1_auth_admin_sales_orders": False,
    "T1_auth_admin_purchase_orders": False,
    "T1_auth_admin_inventory": False,
    "T1_auth_admin_accounting": False,
    "T2_structure_sales_orders": False,
    "T2_structure_purchase_orders": False,
    "T2_structure_inventory": False,
    "T2_structure_accounting": False,
    "T3_accounting_coa_populated": False,
    "T4_data_correctness_sales_orders": False,
    "T4_data_correctness_purchase_orders": False,
    "T4_data_correctness_inventory": False,
    "T5_unknown_module_404": False,
}

def run_node_script(script):
    """Run a Node.js script and return output"""
    try:
        result = subprocess.run(
            ['node', '-e', script],
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode != 0:
            print(f"❌ Node script error: {result.stderr}")
            return None
        return result.stdout.strip()
    except Exception as e:
        print(f"❌ Node script exception: {e}")
        return None

def login_with_curl(email, password):
    """Login using curl and return session cookie"""
    try:
        # Use curl to login (Better Auth endpoint is /api/auth/sign-in/email)
        cmd = [
            'curl', '-s', '-c', '/tmp/cookies.txt', '-b', '/tmp/cookies.txt', '-i',
            '-X', 'POST',
            '-H', 'Content-Type: application/json',
            '-H', f'Origin: {ORIGIN}',
            'http://localhost:3000/api/auth/sign-in/email',
            '-d', json.dumps({'email': email, 'password': password})
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        
        # Extract Set-Cookie from headers
        headers = result.stdout
        cookie_value = None
        for line in headers.split('\n'):
            if 'set-cookie:' in line.lower() and 'session_token' in line:
                # Extract cookie value (handle both __Secure-better-auth.session_token and better_auth.session_token)
                if '__Secure-better-auth.session_token=' in line:
                    parts = line.split('__Secure-better-auth.session_token=')
                elif 'better_auth.session_token=' in line:
                    parts = line.split('better_auth.session_token=')
                else:
                    continue
                
                if len(parts) > 1:
                    cookie_value = parts[1].split(';')[0]
                    break
        
        if cookie_value:
            return cookie_value
        
        print(f"❌ Login failed for {email}")
        print(f"   Response headers: {headers[:500]}")
        return None
    except Exception as e:
        print(f"❌ Login exception: {e}")
        return None

def get_with_curl(endpoint, cookie=None):
    """GET request using curl"""
    try:
        cmd = ['curl', '-s', '-X', 'GET']
        if cookie:
            # Use __Secure-better-auth.session_token for secure cookies
            cmd.extend(['-H', f'Cookie: __Secure-better-auth.session_token={cookie}'])
        cmd.extend(['-H', f'Origin: {ORIGIN}'])
        cmd.append(f'{BASE_URL}{endpoint}')
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        # Try to parse JSON
        try:
            return json.loads(result.stdout), result.returncode
        except (json.JSONDecodeError, ValueError):
            return result.stdout, result.returncode
    except Exception as e:
        print(f"❌ GET exception: {e}")
        return None, -1

def seed_test_data():
    """Seed test data using Node.js + better-sqlite3"""
    print("\n📝 Seeding test data...")
    
    script = """
const Database = require('better-sqlite3');
const db = new Database('/app/data/erp.db');
const { v4: uuidv4 } = require('uuid');

const now = Math.floor(Date.now() / 1000);

// 1. Create test customer
const customerId = uuidv4();
db.prepare(`INSERT INTO contacts (id, code, display_name, contact_type, categories, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)`).run(customerId, 'CUST-EXP-TEST', 'Export Test Customer', 'Customer', '["Customer"]', now, now);

// 2. Create test supplier
const supplierId = uuidv4();
db.prepare(`INSERT INTO contacts (id, code, display_name, contact_type, categories, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)`).run(supplierId, 'SUP-EXP-TEST', 'Export Test Supplier', 'Supplier', '["Supplier"]', now, now);

// 3. Create test product
const productId = uuidv4();
db.prepare(`INSERT INTO products (id, sku, name, unit, base_price, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)`).run(productId, 'EXP-TEST', 'Export Test Product', 'kg', 50000, now, now);

// 4. Create test cold storage (check if exists first)
let coldStorageId = db.prepare(`SELECT id FROM cold_storages LIMIT 1`).get()?.id;
if (!coldStorageId) {
  coldStorageId = uuidv4();
  db.prepare(`INSERT INTO cold_storages (id, code, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)`).run(coldStorageId, 'CS-TEST', 'Test Cold Storage', now, now);
}

// 5. Create sales order
const soId = uuidv4();
db.prepare(`INSERT INTO sales_order (id, so_number, customer_id, order_date, pipeline_status, fulfillment_type, total_amount, paid_amount, payment_status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(soId, 'SO/EXP/1', customerId, now, 'Draft', 'stock', 500000, 0, 'unpaid', now, now);

// 6. Create sales order item
const soItemId = uuidv4();
db.prepare(`INSERT INTO sales_order_items (id, sales_order_id, product_id, quantity, weight, unit_price, subtotal)
  VALUES (?, ?, ?, ?, ?, ?, ?)`).run(soItemId, soId, productId, 1, 10, 50000, 500000);

// 7. Create purchase order
const poId = uuidv4();
db.prepare(`INSERT INTO purchase_order (id, po_number, supplier_id, order_date, po_type, pipeline_status, total_amount, paid_amount, payment_status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(poId, 'PO/EXP/1', supplierId, now, 'Produk Jadi', 'Draft', 400000, 0, 'unpaid', now, now);

// 8. Create purchase order item
const poItemId = uuidv4();
db.prepare(`INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, weight, unit_price, hpp_per_kg)
  VALUES (?, ?, ?, ?, ?, ?, ?)`).run(poItemId, poId, productId, 1, 8, 50000, 50000);

// 9. Create inventory stock lots
const stock1Id = uuidv4();
db.prepare(`INSERT INTO inventory_stock (id, kode_simpan, product_id, cold_storage_id, quantity, weight, hpp_per_kg, status, source_type, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(stock1Id, 'EXP-K1', productId, coldStorageId, 1, 20, 50000, 'active', 'purchase', now, now);

const stock2Id = uuidv4();
db.prepare(`INSERT INTO inventory_stock (id, kode_simpan, product_id, cold_storage_id, quantity, weight, hpp_per_kg, status, source_type, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(stock2Id, 'EXP-K2', productId, coldStorageId, 1, 15, 50000, 'active', 'purchase', now, now);

db.close();

console.log(JSON.stringify({
  customerId, supplierId, productId, coldStorageId, soId, poId, stock1Id, stock2Id
}));
"""
    
    result = run_node_script(script)
    if result:
        try:
            ids = json.loads(result)
            print(f"✅ Test data seeded successfully")
            print(f"   Customer: {ids['customerId']}")
            print(f"   Supplier: {ids['supplierId']}")
            print(f"   Product: {ids['productId']}")
            print(f"   SO: {ids['soId']}")
            print(f"   PO: {ids['poId']}")
            print(f"   Stock 1: {ids['stock1Id']}")
            print(f"   Stock 2: {ids['stock2Id']}")
            return ids
        except (json.JSONDecodeError, ValueError, KeyError):
            print(f"❌ Failed to parse seed result")
            return None
    return None

def cleanup_test_data():
    """Clean up all test data"""
    print("\n🧹 Cleaning up test data...")
    
    script = """
const Database = require('better-sqlite3');
const db = new Database('/app/data/erp.db');

// Delete in reverse order (respect foreign keys)
db.prepare(`DELETE FROM sales_order_items WHERE sales_order_id IN (SELECT id FROM sales_order WHERE so_number = 'SO/EXP/1')`).run();
db.prepare(`DELETE FROM sales_order WHERE so_number = 'SO/EXP/1'`).run();

db.prepare(`DELETE FROM purchase_order_items WHERE purchase_order_id IN (SELECT id FROM purchase_order WHERE po_number = 'PO/EXP/1')`).run();
db.prepare(`DELETE FROM purchase_order WHERE po_number = 'PO/EXP/1'`).run();

db.prepare(`DELETE FROM inventory_stock WHERE kode_simpan IN ('EXP-K1', 'EXP-K2')`).run();

db.prepare(`DELETE FROM products WHERE sku = 'EXP-TEST'`).run();
db.prepare(`DELETE FROM contacts WHERE code IN ('CUST-EXP-TEST', 'SUP-EXP-TEST')`).run();

// Only delete test cold storage if we created it
const testCs = db.prepare(`SELECT id FROM cold_storages WHERE code = 'CS-TEST'`).get();
if (testCs) {
  db.prepare(`DELETE FROM cold_storages WHERE code = 'CS-TEST'`).run();
}

// Get final counts
const soCount = db.prepare(`SELECT COUNT(*) as count FROM sales_order WHERE so_number LIKE 'SO/EXP/%'`).get().count;
const poCount = db.prepare(`SELECT COUNT(*) as count FROM purchase_order WHERE po_number LIKE 'PO/EXP/%'`).get().count;
const stockCount = db.prepare(`SELECT COUNT(*) as count FROM inventory_stock WHERE kode_simpan LIKE 'EXP-K%'`).get().count;

db.close();

console.log(JSON.stringify({ soCount, poCount, stockCount }));
"""
    
    result = run_node_script(script)
    if result:
        try:
            counts = json.loads(result)
            print(f"✅ Cleanup complete")
            print(f"   Remaining SO/EXP/* count: {counts['soCount']}")
            print(f"   Remaining PO/EXP/* count: {counts['poCount']}")
            print(f"   Remaining EXP-K* stock count: {counts['stockCount']}")
            return counts
        except (json.JSONDecodeError, ValueError, KeyError):
            print(f"❌ Failed to parse cleanup result")
            return None
    return None

def main():
    print("=" * 80)
    print("EXCEL EXPORT ENDPOINTS - BACKEND TEST")
    print("=" * 80)
    
    # T1: Auth/role gating
    print("\n" + "=" * 80)
    print("T1 — AUTH/ROLE GATING")
    print("=" * 80)
    
    # T1a: No auth cookie => 401
    print("\n[T1a] GET /api/export/sales-orders with NO auth cookie")
    response, code = get_with_curl('/export/sales-orders')
    if response and (code == 0 or isinstance(response, dict)):
        # Check if it's a 401 error (Better Auth returns JSON error)
        if isinstance(response, dict) and ('error' in response or 'message' in response):
            print(f"✅ PASSED: Unauthenticated request rejected")
            print(f"   Response: {response}")
            test_results["T1_auth_no_cookie"] = True
        else:
            print(f"❌ FAILED: Expected 401, got response: {response}")
    else:
        print(f"❌ FAILED: Request failed")
    
    # T1b: Login as operator => 403
    print("\n[T1b] Login as operator and GET /api/export/sales-orders")
    operator_cookie = login_with_curl('operator@lpi.co.id', 'operator123')
    if operator_cookie:
        print(f"✅ Operator login successful")
        response, code = get_with_curl('/export/sales-orders', operator_cookie)
        if isinstance(response, dict) and ('error' in response or 'message' in response):
            if 'Forbidden' in str(response) or 'forbidden' in str(response).lower():
                print(f"✅ PASSED: Operator request rejected with 403")
                print(f"   Response: {response}")
                test_results["T1_auth_operator_403"] = True
            else:
                print(f"❌ FAILED: Expected Forbidden, got: {response}")
        else:
            print(f"❌ FAILED: Expected 403, got: {response}")
    else:
        print(f"❌ FAILED: Operator login failed")
    
    # T1c: Login as admin => 200 for all 4 modules
    print("\n[T1c] Login as admin and GET all 4 modules")
    admin_cookie = login_with_curl('admin@lpi.co.id', 'admin123')
    if not admin_cookie:
        print(f"❌ FAILED: Admin login failed")
        return
    
    print(f"✅ Admin login successful")
    
    modules = ['sales-orders', 'purchase-orders', 'inventory', 'accounting']
    admin_responses = {}
    
    for module in modules:
        print(f"\n   Testing GET /api/export/{module}")
        response, code = get_with_curl(f'/export/{module}', admin_cookie)
        if isinstance(response, dict) and 'data' in response:
            print(f"   ✅ PASSED: {module} returned 200 with data")
            test_results[f"T1_auth_admin_{module.replace('-', '_')}"] = True
            admin_responses[module] = response
        else:
            print(f"   ❌ FAILED: {module} did not return valid data: {response}")
    
    # T2: Structure verification
    print("\n" + "=" * 80)
    print("T2 — STRUCTURE VERIFICATION")
    print("=" * 80)
    
    expected_sheets = {
        'sales-orders': ['Sales Order', 'Item SO'],
        'purchase-orders': ['Purchase Order', 'Item PO'],
        'inventory': ['Stok', 'Kartu Stok'],
        'accounting': ['Bagan Akun', 'Jurnal (Buku Besar)', 'Neraca Saldo']
    }
    
    for module, expected in expected_sheets.items():
        print(f"\n[T2] Verifying structure for {module}")
        if module not in admin_responses:
            print(f"   ❌ FAILED: No response data for {module}")
            continue
        
        response = admin_responses[module]
        data = response.get('data', {})
        
        # Check filename
        filename = data.get('filename', '')
        if filename and isinstance(filename, str) and len(filename) > 0:
            print(f"   ✅ filename: '{filename}' (non-empty string)")
        else:
            print(f"   ❌ filename: invalid or empty")
            continue
        
        # Check sheets
        sheets = data.get('sheets', [])
        if not isinstance(sheets, list):
            print(f"   ❌ sheets: not an array")
            continue
        
        print(f"   ✅ sheets: array with {len(sheets)} elements")
        
        # Check each sheet
        sheet_names = []
        all_valid = True
        for i, sheet in enumerate(sheets):
            name = sheet.get('name', '')
            rows = sheet.get('rows', [])
            
            if not isinstance(name, str) or len(name) == 0:
                print(f"   ❌ Sheet {i}: name is not a non-empty string")
                all_valid = False
                continue
            
            if not isinstance(rows, list):
                print(f"   ❌ Sheet {i}: rows is not an array")
                all_valid = False
                continue
            
            sheet_names.append(name)
            print(f"   ✅ Sheet {i}: name='{name}', rows={len(rows)} elements")
        
        # Check expected sheet names
        if sheet_names == expected:
            print(f"   ✅ Sheet names match expected: {expected}")
            test_results[f"T2_structure_{module.replace('-', '_')}"] = True
        else:
            print(f"   ❌ Sheet names mismatch")
            print(f"      Expected: {expected}")
            print(f"      Got: {sheet_names}")
    
    # T3: Accounting COA populated
    print("\n" + "=" * 80)
    print("T3 — ACCOUNTING COA POPULATED")
    print("=" * 80)
    
    if 'accounting' in admin_responses:
        print("\n[T3] Verifying 'Bagan Akun' sheet has data")
        data = admin_responses['accounting'].get('data', {})
        sheets = data.get('sheets', [])
        
        coa_sheet = None
        for sheet in sheets:
            if sheet.get('name') == 'Bagan Akun':
                coa_sheet = sheet
                break
        
        if not coa_sheet:
            print(f"   ❌ FAILED: 'Bagan Akun' sheet not found")
        else:
            rows = coa_sheet.get('rows', [])
            print(f"   ✅ 'Bagan Akun' sheet has {len(rows)} rows")
            
            if len(rows) == 0:
                print(f"   ❌ FAILED: 'Bagan Akun' sheet is empty")
            else:
                # Find row with 'Kode Akun' == '5-1300'
                target_row = None
                for row in rows:
                    if row.get('Kode Akun') == '5-1300':
                        target_row = row
                        break
                
                if not target_row:
                    print(f"   ❌ FAILED: Row with 'Kode Akun'=='5-1300' not found")
                else:
                    print(f"   ✅ Found row with 'Kode Akun'=='5-1300'")
                    print(f"      Row data: {target_row}")
                    
                    # Check required keys
                    required_keys = ['Kode Akun', 'Nama Akun', 'Tipe', 'Saldo Awal (Rp)']
                    has_all_keys = all(key in target_row for key in required_keys)
                    
                    if has_all_keys:
                        print(f"   ✅ Row has all required keys: {required_keys}")
                        test_results["T3_accounting_coa_populated"] = True
                    else:
                        missing = [k for k in required_keys if k not in target_row]
                        print(f"   ❌ FAILED: Missing keys: {missing}")
    else:
        print(f"   ❌ FAILED: No accounting response data")
    
    # T4: Data correctness (seed then verify)
    print("\n" + "=" * 80)
    print("T4 — DATA CORRECTNESS (SEED + VERIFY)")
    print("=" * 80)
    
    seed_ids = seed_test_data()
    if not seed_ids:
        print(f"❌ FAILED: Could not seed test data")
    else:
        # Re-fetch exports with seeded data
        print("\n[T4] Re-fetching exports with seeded data")
        
        # T4a: Sales Orders
        print("\n[T4a] Verifying sales-orders export")
        response, code = get_with_curl('/export/sales-orders', admin_cookie)
        if isinstance(response, dict) and 'data' in response:
            data = response.get('data', {})
            sheets = data.get('sheets', [])
            
            # Find 'Sales Order' sheet
            so_sheet = None
            item_sheet = None
            for sheet in sheets:
                if sheet.get('name') == 'Sales Order':
                    so_sheet = sheet
                elif sheet.get('name') == 'Item SO':
                    item_sheet = sheet
            
            if so_sheet and item_sheet:
                so_rows = so_sheet.get('rows', [])
                item_rows = item_sheet.get('rows', [])
                
                # Find SO/EXP/1
                target_so = None
                for row in so_rows:
                    if row.get('No SO') == 'SO/EXP/1':
                        target_so = row
                        break
                
                if target_so:
                    total = target_so.get('Total (Rp)')
                    if total == 500000:
                        print(f"   ✅ 'Sales Order' sheet contains 'SO/EXP/1' with Total=500000")
                    else:
                        print(f"   ❌ 'SO/EXP/1' Total mismatch: expected 500000, got {total}")
                else:
                    print(f"   ❌ 'SO/EXP/1' not found in 'Sales Order' sheet")
                
                # Find item with SKU='EXP-TEST'
                target_item = None
                for row in item_rows:
                    if row.get('SKU') == 'EXP-TEST' and row.get('No SO') == 'SO/EXP/1':
                        target_item = row
                        break
                
                if target_item:
                    weight = target_item.get('Berat (kg)')
                    price = target_item.get('Harga/kg (Rp)')
                    if weight == 10 and price == 50000:
                        print(f"   ✅ 'Item SO' sheet contains SKU='EXP-TEST' with Berat=10, Harga/kg=50000")
                        test_results["T4_data_correctness_sales_orders"] = True
                    else:
                        print(f"   ❌ Item data mismatch: Berat={weight} (expected 10), Harga/kg={price} (expected 50000)")
                else:
                    print(f"   ❌ Item with SKU='EXP-TEST' not found in 'Item SO' sheet")
            else:
                print(f"   ❌ Required sheets not found")
        else:
            print(f"   ❌ Failed to fetch sales-orders export")
        
        # T4b: Purchase Orders
        print("\n[T4b] Verifying purchase-orders export")
        response, code = get_with_curl('/export/purchase-orders', admin_cookie)
        if isinstance(response, dict) and 'data' in response:
            data = response.get('data', {})
            sheets = data.get('sheets', [])
            
            # Find 'Purchase Order' sheet
            po_sheet = None
            item_sheet = None
            for sheet in sheets:
                if sheet.get('name') == 'Purchase Order':
                    po_sheet = sheet
                elif sheet.get('name') == 'Item PO':
                    item_sheet = sheet
            
            if po_sheet and item_sheet:
                po_rows = po_sheet.get('rows', [])
                item_rows = item_sheet.get('rows', [])
                
                # Find PO/EXP/1
                target_po = None
                for row in po_rows:
                    if row.get('No PO') == 'PO/EXP/1':
                        target_po = row
                        break
                
                if target_po:
                    print(f"   ✅ 'Purchase Order' sheet contains 'PO/EXP/1'")
                else:
                    print(f"   ❌ 'PO/EXP/1' not found in 'Purchase Order' sheet")
                
                # Find item with HPP/kg=50000
                target_item = None
                for row in item_rows:
                    if row.get('No PO') == 'PO/EXP/1' and row.get('SKU') == 'EXP-TEST':
                        target_item = row
                        break
                
                if target_item:
                    hpp = target_item.get('HPP/kg (Rp)')
                    if hpp == 50000:
                        print(f"   ✅ 'Item PO' sheet contains item with HPP/kg=50000")
                        test_results["T4_data_correctness_purchase_orders"] = True
                    else:
                        print(f"   ❌ Item HPP/kg mismatch: expected 50000, got {hpp}")
                else:
                    print(f"   ❌ Item not found in 'Item PO' sheet")
            else:
                print(f"   ❌ Required sheets not found")
        else:
            print(f"   ❌ Failed to fetch purchase-orders export")
        
        # T4c: Inventory
        print("\n[T4c] Verifying inventory export")
        response, code = get_with_curl('/export/inventory', admin_cookie)
        if isinstance(response, dict) and 'data' in response:
            data = response.get('data', {})
            sheets = data.get('sheets', [])
            
            # Find 'Stok' sheet
            stok_sheet = None
            for sheet in sheets:
                if sheet.get('name') == 'Stok':
                    stok_sheet = sheet
                    break
            
            if stok_sheet:
                rows = stok_sheet.get('rows', [])
                
                # Find EXP-K1 and EXP-K2
                k1 = None
                k2 = None
                for row in rows:
                    if row.get('Kode Simpan') == 'EXP-K1':
                        k1 = row
                    elif row.get('Kode Simpan') == 'EXP-K2':
                        k2 = row
                
                if k1 and k2:
                    k1_weight = k1.get('Berat (kg)')
                    k1_value = k1.get('Nilai Persediaan (Rp)')
                    k2_weight = k2.get('Berat (kg)')
                    k2_value = k2.get('Nilai Persediaan (Rp)')
                    
                    if k1_weight == 20 and k1_value == 1000000 and k2_weight == 15 and k2_value == 750000:
                        print(f"   ✅ 'Stok' sheet contains EXP-K1 (20kg, 1,000,000) and EXP-K2 (15kg, 750,000)")
                        test_results["T4_data_correctness_inventory"] = True
                    else:
                        print(f"   ❌ Inventory data mismatch:")
                        print(f"      EXP-K1: Berat={k1_weight} (expected 20), Nilai={k1_value} (expected 1000000)")
                        print(f"      EXP-K2: Berat={k2_weight} (expected 15), Nilai={k2_value} (expected 750000)")
                else:
                    print(f"   ❌ EXP-K1 or EXP-K2 not found in 'Stok' sheet")
            else:
                print(f"   ❌ 'Stok' sheet not found")
        else:
            print(f"   ❌ Failed to fetch inventory export")
    
    # T5: Unknown module => 404
    print("\n" + "=" * 80)
    print("T5 — UNKNOWN MODULE")
    print("=" * 80)
    
    print("\n[T5] GET /api/export/foo as admin")
    response, code = get_with_curl('/export/foo', admin_cookie)
    if isinstance(response, dict) and ('error' in response or 'message' in response):
        error_msg = response.get('error') or response.get('message', '')
        if 'tidak dikenal' in error_msg.lower() or 'unknown' in error_msg.lower() or '404' in str(response):
            print(f"✅ PASSED: Unknown module rejected with 404")
            print(f"   Response: {response}")
            test_results["T5_unknown_module_404"] = True
        else:
            print(f"❌ FAILED: Expected 404, got: {response}")
    else:
        print(f"❌ FAILED: Expected error response, got: {response}")
    
    # Cleanup
    print("\n" + "=" * 80)
    print("CLEANUP")
    print("=" * 80)
    
    if seed_ids:
        counts = cleanup_test_data()
        if counts:
            if counts['soCount'] == 0 and counts['poCount'] == 0 and counts['stockCount'] == 0:
                print(f"✅ All test data cleaned up successfully (clean slate confirmed)")
            else:
                print(f"⚠️  Some test data may remain:")
                print(f"   SO/EXP/* count: {counts['soCount']}")
                print(f"   PO/EXP/* count: {counts['poCount']}")
                print(f"   EXP-K* stock count: {counts['stockCount']}")
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for v in test_results.values() if v)
    total = len(test_results)
    
    print(f"\nTotal: {passed}/{total} tests passed ({passed*100//total}%)\n")
    
    for test, result in test_results.items():
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{status}: {test}")
    
    print("\n" + "=" * 80)
    
    if passed == total:
        print("🎉 ALL TESTS PASSED!")
        sys.exit(0)
    else:
        print(f"⚠️  {total - passed} test(s) failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
