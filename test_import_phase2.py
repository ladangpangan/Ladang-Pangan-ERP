#!/usr/bin/env python3
"""
Backend test for Master Data Import (Phase 2)
Tests GET /api/import/templates and POST /api/import/:module endpoints
"""

import requests
import json
import sqlite3
import sys
from pymongo import MongoClient

# Configuration
BASE_URL = "http://localhost:3000/api"
ORIGIN = "http://localhost:3000"
DB_PATH = "/app/data/erp.db"
MONGO_URL = "mongodb://localhost:27017"

# Test data prefixes for easy cleanup
TEST_SKU_PREFIX = "IMP-TEST-"
TEST_CONTACT_PREFIX = "IMP TEST "
TEST_ACCOUNT_CODE = "9-9001"
TEST_ACCOUNT_CODE_2 = "9-9002"

# Global session for cookie persistence
session = requests.Session()

def print_test(msg):
    print(f"\n{'='*80}")
    print(f"  {msg}")
    print('='*80)

def print_result(success, msg):
    status = "✅ PASSED" if success else "❌ FAILED"
    print(f"{status}: {msg}")

def login(email, password):
    """Login and store session cookie"""
    print(f"\n🔐 Logging in as {email}...")
    
    # Better Auth login endpoint
    resp = session.post(
        f"{BASE_URL.replace('/api', '')}/api/auth/sign-in/email",
        json={"email": email, "password": password},
        headers={"Origin": ORIGIN, "Content-Type": "application/json"}
    )
    
    if resp.status_code == 200:
        print(f"✅ Login successful")
        return True
    else:
        print(f"❌ Login failed: {resp.status_code} - {resp.text}")
        return False

def test_templates_auth():
    """T1 - Test GET /api/import/templates with different auth levels"""
    print_test("TEST T1: GET /api/import/templates - Auth & RBAC")
    
    # T1a: No auth -> 401
    print("\n[T1a] Testing without authentication...")
    no_auth_session = requests.Session()
    resp = no_auth_session.get(f"{BASE_URL}/import/templates", headers={"Origin": ORIGIN})
    print_result(resp.status_code == 401, f"No auth -> {resp.status_code} (expected 401)")
    
    # T1b: Operator -> 403
    print("\n[T1b] Testing as operator...")
    operator_session = requests.Session()
    login_resp = operator_session.post(
        f"{BASE_URL.replace('/api', '')}/api/auth/sign-in/email",
        json={"email": "operator@lpi.co.id", "password": "operator123"},
        headers={"Origin": ORIGIN, "Content-Type": "application/json"}
    )
    
    if login_resp.status_code == 200:
        resp = operator_session.get(f"{BASE_URL}/import/templates", headers={"Origin": ORIGIN})
        print_result(resp.status_code == 403, f"Operator -> {resp.status_code} (expected 403)")
    else:
        print_result(False, f"Operator login failed: {login_resp.status_code}")
    
    # T1c: Admin -> 200 with templates
    print("\n[T1c] Testing as admin...")
    resp = session.get(f"{BASE_URL}/import/templates", headers={"Origin": ORIGIN})
    
    if resp.status_code == 200:
        data = resp.json().get('data', {})
        has_products = 'products' in data and 'columns' in data['products'] and len(data['products']['columns']) > 0
        has_contacts = 'contacts' in data and 'columns' in data['contacts'] and len(data['contacts']['columns']) > 0
        has_coa = 'chart-of-accounts' in data and 'columns' in data['chart-of-accounts'] and len(data['chart-of-accounts']['columns']) > 0
        has_example = 'example' in data['products'] and 'example' in data['contacts'] and 'example' in data['chart-of-accounts']
        
        print(f"  Response keys: {list(data.keys())}")
        print(f"  Products columns: {len(data.get('products', {}).get('columns', []))}")
        print(f"  Contacts columns: {len(data.get('contacts', {}).get('columns', []))}")
        print(f"  COA columns: {len(data.get('chart-of-accounts', {}).get('columns', []))}")
        
        success = has_products and has_contacts and has_coa and has_example
        print_result(success, f"Admin -> 200 with all templates (products, contacts, chart-of-accounts)")
        return success
    else:
        print_result(False, f"Admin -> {resp.status_code} (expected 200): {resp.text}")
        return False

def test_products_upsert():
    """T2 - Test products import with insert, update, and error handling"""
    print_test("TEST T2: POST /api/import/products - Insert, Update, Error Handling")
    
    # T2a: Insert new product
    print("\n[T2a] Inserting new product...")
    rows = [{
        "SKU": "IMP-TEST-1",
        "Nama": "Produk Uji",
        "Satuan": "kg",
        "Harga Jual": 25000,
        "Kategori": "FG"
    }]
    
    resp = session.post(
        f"{BASE_URL}/import/products",
        json={"rows": rows},
        headers={"Origin": ORIGIN, "Content-Type": "application/json"}
    )
    
    if resp.status_code == 200:
        data = resp.json().get('data', {})
        print(f"  Created: {data.get('created')}, Updated: {data.get('updated')}, Errors: {len(data.get('errors', []))}")
        success = data.get('created') == 1 and data.get('updated') == 0
        print_result(success, f"Product created (created={data.get('created')}, updated={data.get('updated')})")
        
        if not success:
            return False
    else:
        print_result(False, f"Insert failed: {resp.status_code} - {resp.text}")
        return False
    
    # Verify via GET /api/products
    print("\n  Verifying product via GET /api/products...")
    resp = session.get(f"{BASE_URL}/products", headers={"Origin": ORIGIN})
    if resp.status_code == 200:
        products = resp.json().get('data', [])
        test_product = next((p for p in products if p.get('sku') == 'IMP-TEST-1'), None)
        
        if test_product:
            price_match = test_product.get('basePrice') == 25000
            print(f"  Found product: SKU={test_product.get('sku')}, basePrice={test_product.get('basePrice')}")
            print_result(price_match, f"Product basePrice = 25000 (actual: {test_product.get('basePrice')})")
            
            if not price_match:
                return False
        else:
            print_result(False, "Product not found in GET /api/products")
            return False
    else:
        print_result(False, f"GET /api/products failed: {resp.status_code}")
        return False
    
    # T2b: Update existing product (upsert)
    print("\n[T2b] Updating existing product (same SKU, different price)...")
    rows = [{
        "SKU": "IMP-TEST-1",
        "Nama": "Produk Uji Updated",
        "Satuan": "kg",
        "Harga Jual": 30000,
        "Kategori": "FG"
    }]
    
    resp = session.post(
        f"{BASE_URL}/import/products",
        json={"rows": rows},
        headers={"Origin": ORIGIN, "Content-Type": "application/json"}
    )
    
    if resp.status_code == 200:
        data = resp.json().get('data', {})
        print(f"  Created: {data.get('created')}, Updated: {data.get('updated')}, Errors: {len(data.get('errors', []))}")
        success = data.get('created') == 0 and data.get('updated') == 1
        print_result(success, f"Product updated (created={data.get('created')}, updated={data.get('updated')})")
        
        if not success:
            return False
    else:
        print_result(False, f"Update failed: {resp.status_code} - {resp.text}")
        return False
    
    # Verify updated price
    print("\n  Verifying updated price via GET /api/products...")
    resp = session.get(f"{BASE_URL}/products", headers={"Origin": ORIGIN})
    if resp.status_code == 200:
        products = resp.json().get('data', [])
        test_products = [p for p in products if p.get('sku') == 'IMP-TEST-1']
        
        if len(test_products) == 1:
            product = test_products[0]
            price_match = product.get('basePrice') == 30000
            print(f"  Found product: SKU={product.get('sku')}, basePrice={product.get('basePrice')}")
            print_result(price_match, f"Product basePrice updated to 30000 (actual: {product.get('basePrice')})")
            print_result(True, f"Only ONE product with SKU IMP-TEST-1 (upsert, not duplicated)")
            
            if not price_match:
                return False
        else:
            print_result(False, f"Expected 1 product with SKU IMP-TEST-1, found {len(test_products)}")
            return False
    else:
        print_result(False, f"GET /api/products failed: {resp.status_code}")
        return False
    
    # T2c: Error handling - missing SKU
    print("\n[T2c] Testing error handling (missing SKU)...")
    rows = [{
        "Nama": "Tanpa SKU",
        "Satuan": "kg",
        "Harga Jual": 10000
    }]
    
    resp = session.post(
        f"{BASE_URL}/import/products",
        json={"rows": rows},
        headers={"Origin": ORIGIN, "Content-Type": "application/json"}
    )
    
    if resp.status_code == 200:
        data = resp.json().get('data', {})
        errors = data.get('errors', [])
        print(f"  Created: {data.get('created')}, Errors: {len(errors)}")
        
        if errors:
            print(f"  Error: row {errors[0].get('row')}, message: {errors[0].get('message')}")
        
        success = data.get('created') == 0 and len(errors) > 0 and 'SKU' in errors[0].get('message', '')
        print_result(success, f"Missing SKU error captured (errors={len(errors)})")
        return success
    else:
        print_result(False, f"Error test failed: {resp.status_code} - {resp.text}")
        return False

def test_contacts_upsert():
    """T3 - Test contacts import with insert, update, and type alias"""
    print_test("TEST T3: POST /api/import/contacts - Insert, Update, Type Alias")
    
    # T3a: Insert new contact
    print("\n[T3a] Inserting new contact...")
    rows = [{
        "Nama": "IMP TEST Pelanggan",
        "Tipe": "Customer",
        "Telepon": "0812",
        "Kota": "Jakarta"
    }]
    
    resp = session.post(
        f"{BASE_URL}/import/contacts",
        json={"rows": rows},
        headers={"Origin": ORIGIN, "Content-Type": "application/json"}
    )
    
    if resp.status_code == 200:
        data = resp.json().get('data', {})
        print(f"  Created: {data.get('created')}, Updated: {data.get('updated')}, Errors: {len(data.get('errors', []))}")
        success = data.get('created') == 1 and data.get('updated') == 0
        print_result(success, f"Contact created (created={data.get('created')}, updated={data.get('updated')})")
        
        if not success:
            return False
    else:
        print_result(False, f"Insert failed: {resp.status_code} - {resp.text}")
        return False
    
    # Verify via GET /api/contacts
    print("\n  Verifying contact via GET /api/contacts...")
    resp = session.get(f"{BASE_URL}/contacts", headers={"Origin": ORIGIN})
    if resp.status_code == 200:
        contacts = resp.json().get('data', [])
        test_contact = next((c for c in contacts if c.get('displayName') == 'IMP TEST Pelanggan'), None)
        
        if test_contact:
            type_match = test_contact.get('contactType') == 'Customer'
            has_code = test_contact.get('code') is not None and test_contact.get('code') != ''
            print(f"  Found contact: displayName={test_contact.get('displayName')}, contactType={test_contact.get('contactType')}, code={test_contact.get('code')}")
            print_result(type_match, f"Contact contactType = Customer (actual: {test_contact.get('contactType')})")
            print_result(has_code, f"Auto-generated code: {test_contact.get('code')}")
            
            if not (type_match and has_code):
                return False
        else:
            print_result(False, "Contact not found in GET /api/contacts")
            return False
    else:
        print_result(False, f"GET /api/contacts failed: {resp.status_code}")
        return False
    
    # T3b: Update existing contact (same Nama+Tipe)
    print("\n[T3b] Updating existing contact (same Nama+Tipe)...")
    rows = [{
        "Nama": "IMP TEST Pelanggan",
        "Tipe": "Customer",
        "Telepon": "0813",  # Changed phone
        "Kota": "Bandung"   # Changed city
    }]
    
    resp = session.post(
        f"{BASE_URL}/import/contacts",
        json={"rows": rows},
        headers={"Origin": ORIGIN, "Content-Type": "application/json"}
    )
    
    if resp.status_code == 200:
        data = resp.json().get('data', {})
        print(f"  Created: {data.get('created')}, Updated: {data.get('updated')}, Errors: {len(data.get('errors', []))}")
        success = data.get('created') == 0 and data.get('updated') == 1
        print_result(success, f"Contact updated (created={data.get('created')}, updated={data.get('updated')})")
        
        if not success:
            return False
    else:
        print_result(False, f"Update failed: {resp.status_code} - {resp.text}")
        return False
    
    # Verify only one contact exists (not duplicated)
    print("\n  Verifying no duplicate contacts...")
    resp = session.get(f"{BASE_URL}/contacts", headers={"Origin": ORIGIN})
    if resp.status_code == 200:
        contacts = resp.json().get('data', [])
        test_contacts = [c for c in contacts if c.get('displayName') == 'IMP TEST Pelanggan' and c.get('contactType') == 'Customer']
        
        if len(test_contacts) == 1:
            print_result(True, f"Only ONE contact with name 'IMP TEST Pelanggan' (upsert, not duplicated)")
        else:
            print_result(False, f"Expected 1 contact, found {len(test_contacts)}")
            return False
    else:
        print_result(False, f"GET /api/contacts failed: {resp.status_code}")
        return False
    
    # T3c: Test type alias (Pemasok -> Supplier)
    print("\n[T3c] Testing type alias (Pemasok -> Supplier)...")
    rows = [{
        "Nama": "IMP TEST Pemasok",
        "Tipe": "Pemasok"  # Alias for Supplier
    }]
    
    resp = session.post(
        f"{BASE_URL}/import/contacts",
        json={"rows": rows},
        headers={"Origin": ORIGIN, "Content-Type": "application/json"}
    )
    
    if resp.status_code == 200:
        data = resp.json().get('data', {})
        print(f"  Created: {data.get('created')}, Updated: {data.get('updated')}, Errors: {len(data.get('errors', []))}")
        success = data.get('created') == 1
        print_result(success, f"Contact created with alias (created={data.get('created')})")
        
        if not success:
            return False
    else:
        print_result(False, f"Alias test failed: {resp.status_code} - {resp.text}")
        return False
    
    # Verify contactType is 'Supplier' (not 'Pemasok')
    print("\n  Verifying type alias mapping...")
    resp = session.get(f"{BASE_URL}/contacts", headers={"Origin": ORIGIN})
    if resp.status_code == 200:
        contacts = resp.json().get('data', [])
        test_contact = next((c for c in contacts if c.get('displayName') == 'IMP TEST Pemasok'), None)
        
        if test_contact:
            type_match = test_contact.get('contactType') == 'Supplier'
            print(f"  Found contact: displayName={test_contact.get('displayName')}, contactType={test_contact.get('contactType')}")
            print_result(type_match, f"Type alias 'Pemasok' mapped to 'Supplier' (actual: {test_contact.get('contactType')})")
            return type_match
        else:
            print_result(False, "Contact not found in GET /api/contacts")
            return False
    else:
        print_result(False, f"GET /api/contacts failed: {resp.status_code}")
        return False

def test_chart_of_accounts_upsert():
    """T4 - Test chart-of-accounts import with insert, update, and error handling"""
    print_test("TEST T4: POST /api/import/chart-of-accounts - Insert, Update, Error Handling")
    
    # T4a: Insert new account
    print("\n[T4a] Inserting new account...")
    rows = [{
        "Kode Akun": "9-9001",
        "Nama Akun": "Akun Uji Impor",
        "Tipe": "expense",
        "Saldo Normal": "debit",
        "Saldo Awal": 0
    }]
    
    resp = session.post(
        f"{BASE_URL}/import/chart-of-accounts",
        json={"rows": rows},
        headers={"Origin": ORIGIN, "Content-Type": "application/json"}
    )
    
    if resp.status_code == 200:
        data = resp.json().get('data', {})
        print(f"  Created: {data.get('created')}, Updated: {data.get('updated')}, Errors: {len(data.get('errors', []))}")
        success = data.get('created') == 1 and data.get('updated') == 0
        print_result(success, f"Account created (created={data.get('created')}, updated={data.get('updated')})")
        
        if not success:
            return False
    else:
        print_result(False, f"Insert failed: {resp.status_code} - {resp.text}")
        return False
    
    # Verify via direct SQLite query
    print("\n  Verifying account via SQLite query...")
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT code, name, type, normal_balance FROM gl_accounts WHERE code = ?", ("9-9001",))
        row = cursor.fetchone()
        conn.close()
        
        if row:
            code, name, type_, nb = row
            print(f"  Found account: code={code}, name={name}, type={type_}, normal_balance={nb}")
            type_match = type_ == 'expense'
            nb_match = nb == 'debit'
            print_result(type_match, f"Account type = expense (actual: {type_})")
            print_result(nb_match, f"Account normal_balance = debit (actual: {nb})")
            
            if not (type_match and nb_match):
                return False
        else:
            print_result(False, "Account not found in gl_accounts")
            return False
    except Exception as e:
        print_result(False, f"SQLite query failed: {e}")
        return False
    
    # T4b: Update existing account
    print("\n[T4b] Updating existing account (same code, different name)...")
    rows = [{
        "Kode Akun": "9-9001",
        "Nama Akun": "Akun Uji 2",
        "Tipe": "expense",
        "Saldo Normal": "debit",
        "Saldo Awal": 0
    }]
    
    resp = session.post(
        f"{BASE_URL}/import/chart-of-accounts",
        json={"rows": rows},
        headers={"Origin": ORIGIN, "Content-Type": "application/json"}
    )
    
    if resp.status_code == 200:
        data = resp.json().get('data', {})
        print(f"  Created: {data.get('created')}, Updated: {data.get('updated')}, Errors: {len(data.get('errors', []))}")
        success = data.get('created') == 0 and data.get('updated') == 1
        print_result(success, f"Account updated (created={data.get('created')}, updated={data.get('updated')})")
        
        if not success:
            return False
    else:
        print_result(False, f"Update failed: {resp.status_code} - {resp.text}")
        return False
    
    # Verify updated name
    print("\n  Verifying updated name via SQLite query...")
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM gl_accounts WHERE code = ?", ("9-9001",))
        row = cursor.fetchone()
        conn.close()
        
        if row:
            name = row[0]
            name_match = name == 'Akun Uji 2'
            print(f"  Account name: {name}")
            print_result(name_match, f"Account name updated to 'Akun Uji 2' (actual: {name})")
            
            if not name_match:
                return False
        else:
            print_result(False, "Account not found in gl_accounts")
            return False
    except Exception as e:
        print_result(False, f"SQLite query failed: {e}")
        return False
    
    # T4c: Error handling - invalid type
    print("\n[T4c] Testing error handling (invalid type)...")
    rows = [{
        "Kode Akun": "9-9002",
        "Nama Akun": "X",
        "Tipe": "xyz",  # Invalid type
        "Saldo Normal": "debit"
    }]
    
    resp = session.post(
        f"{BASE_URL}/import/chart-of-accounts",
        json={"rows": rows},
        headers={"Origin": ORIGIN, "Content-Type": "application/json"}
    )
    
    if resp.status_code == 200:
        data = resp.json().get('data', {})
        errors = data.get('errors', [])
        print(f"  Created: {data.get('created')}, Errors: {len(errors)}")
        
        if errors:
            print(f"  Error: row {errors[0].get('row')}, message: {errors[0].get('message')}")
        
        success = data.get('created') == 0 and len(errors) > 0 and 'tidak valid' in errors[0].get('message', '').lower()
        print_result(success, f"Invalid type error captured (errors={len(errors)})")
        return success
    else:
        print_result(False, f"Error test failed: {resp.status_code} - {resp.text}")
        return False

def test_unknown_module():
    """T5 - Test unknown module returns 404"""
    print_test("TEST T5: POST /api/import/foo - Unknown Module")
    
    rows = [{"a": 1}]
    
    resp = session.post(
        f"{BASE_URL}/import/foo",
        json={"rows": rows},
        headers={"Origin": ORIGIN, "Content-Type": "application/json"}
    )
    
    success = resp.status_code == 404
    print_result(success, f"Unknown module -> {resp.status_code} (expected 404)")
    return success

def cleanup():
    """Clean up all test data from MongoDB and SQLite"""
    print_test("CLEANUP: Removing all test data")
    
    # Get all test products and contacts to delete
    print("\n[1] Getting test products and contacts...")
    
    # Get products
    resp = session.get(f"{BASE_URL}/products", headers={"Origin": ORIGIN})
    if resp.status_code == 200:
        products = resp.json().get('data', [])
        test_products = [p for p in products if p.get('sku', '').startswith(TEST_SKU_PREFIX)]
        print(f"  Found {len(test_products)} test products to delete")
        
        for product in test_products:
            product_id = product.get('id')
            sku = product.get('sku')
            print(f"  Deleting product: {sku} (ID: {product_id})")
            
            resp = session.delete(
                f"{BASE_URL}/products/{product_id}",
                headers={"Origin": ORIGIN}
            )
            
            if resp.status_code in [200, 204]:
                print(f"    ✅ Deleted from API (dual-delete)")
            else:
                print(f"    ⚠️ API delete failed: {resp.status_code}, trying direct DB delete...")
                
                # Try direct MongoDB delete
                try:
                    client = MongoClient(MONGO_URL)
                    db = client['erp']
                    result = db.products.delete_one({"id": product_id})
                    print(f"    ✅ Deleted from MongoDB: {result.deleted_count} doc(s)")
                    client.close()
                except Exception as e:
                    print(f"    ❌ MongoDB delete failed: {e}")
                
                # Try direct SQLite delete
                try:
                    conn = sqlite3.connect(DB_PATH)
                    cursor = conn.cursor()
                    cursor.execute("DELETE FROM products WHERE id = ?", (product_id,))
                    conn.commit()
                    print(f"    ✅ Deleted from SQLite: {cursor.rowcount} row(s)")
                    conn.close()
                except Exception as e:
                    print(f"    ❌ SQLite delete failed: {e}")
    
    # Get contacts
    resp = session.get(f"{BASE_URL}/contacts", headers={"Origin": ORIGIN})
    if resp.status_code == 200:
        contacts = resp.json().get('data', [])
        test_contacts = [c for c in contacts if c.get('displayName', '').startswith(TEST_CONTACT_PREFIX)]
        print(f"\n  Found {len(test_contacts)} test contacts to delete")
        
        for contact in test_contacts:
            contact_id = contact.get('id')
            name = contact.get('displayName')
            print(f"  Deleting contact: {name} (ID: {contact_id})")
            
            resp = session.delete(
                f"{BASE_URL}/contacts/{contact_id}",
                headers={"Origin": ORIGIN}
            )
            
            if resp.status_code in [200, 204]:
                print(f"    ✅ Deleted from API (dual-delete)")
            else:
                print(f"    ⚠️ API delete failed: {resp.status_code}, trying direct DB delete...")
                
                # Try direct MongoDB delete
                try:
                    client = MongoClient(MONGO_URL)
                    db = client['erp']
                    result = db.contacts.delete_one({"id": contact_id})
                    print(f"    ✅ Deleted from MongoDB: {result.deleted_count} doc(s)")
                    client.close()
                except Exception as e:
                    print(f"    ❌ MongoDB delete failed: {e}")
                
                # Try direct SQLite delete
                try:
                    conn = sqlite3.connect(DB_PATH)
                    cursor = conn.cursor()
                    cursor.execute("DELETE FROM contacts WHERE id = ?", (contact_id,))
                    conn.commit()
                    print(f"    ✅ Deleted from SQLite: {cursor.rowcount} row(s)")
                    conn.close()
                except Exception as e:
                    print(f"    ❌ SQLite delete failed: {e}")
    
    # Delete test accounts from gl_accounts
    print("\n[2] Deleting test accounts from gl_accounts...")
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        for code in [TEST_ACCOUNT_CODE, TEST_ACCOUNT_CODE_2]:
            cursor.execute("DELETE FROM gl_accounts WHERE code = ?", (code,))
            if cursor.rowcount > 0:
                print(f"  ✅ Deleted account {code} from SQLite: {cursor.rowcount} row(s)")
        
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"  ❌ SQLite delete failed: {e}")
    
    # Verify cleanup
    print("\n[3] Verifying cleanup...")
    
    # Verify products
    resp = session.get(f"{BASE_URL}/products", headers={"Origin": ORIGIN})
    if resp.status_code == 200:
        products = resp.json().get('data', [])
        test_products = [p for p in products if p.get('sku', '').startswith(TEST_SKU_PREFIX)]
        print_result(len(test_products) == 0, f"No test products remaining (found: {len(test_products)})")
    
    # Verify contacts
    resp = session.get(f"{BASE_URL}/contacts", headers={"Origin": ORIGIN})
    if resp.status_code == 200:
        contacts = resp.json().get('data', [])
        test_contacts = [c for c in contacts if c.get('displayName', '').startswith(TEST_CONTACT_PREFIX)]
        print_result(len(test_contacts) == 0, f"No test contacts remaining (found: {len(test_contacts)})")
    
    # Verify accounts
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT code FROM gl_accounts WHERE code IN (?, ?)", (TEST_ACCOUNT_CODE, TEST_ACCOUNT_CODE_2))
        rows = cursor.fetchall()
        conn.close()
        print_result(len(rows) == 0, f"No test accounts remaining (found: {len(rows)})")
    except Exception as e:
        print_result(False, f"SQLite verification failed: {e}")
    
    # Verify MongoDB
    try:
        client = MongoClient(MONGO_URL)
        db = client['erp']
        
        product_count = db.products.count_documents({"sku": {"$regex": f"^{TEST_SKU_PREFIX}"}})
        contact_count = db.contacts.count_documents({"displayName": {"$regex": f"^{TEST_CONTACT_PREFIX}"}})
        
        print_result(product_count == 0, f"No test products in MongoDB (found: {product_count})")
        print_result(contact_count == 0, f"No test contacts in MongoDB (found: {contact_count})")
        
        client.close()
    except Exception as e:
        print_result(False, f"MongoDB verification failed: {e}")

def main():
    print("\n" + "="*80)
    print("  MASTER DATA IMPORT (PHASE 2) - BACKEND TESTS")
    print("="*80)
    
    # Login as admin
    if not login("admin@lpi.co.id", "admin123"):
        print("\n❌ Login failed. Exiting.")
        sys.exit(1)
    
    # Run tests
    results = {
        "T1 - Templates & Auth": test_templates_auth(),
        "T2 - Products Upsert": test_products_upsert(),
        "T3 - Contacts Upsert": test_contacts_upsert(),
        "T4 - Chart of Accounts Upsert": test_chart_of_accounts_upsert(),
        "T5 - Unknown Module": test_unknown_module(),
    }
    
    # Cleanup
    cleanup()
    
    # Summary
    print("\n" + "="*80)
    print("  TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{status}: {test_name}")
    
    print(f"\nTotal: {passed}/{total} tests passed ({passed*100//total}%)")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)
    else:
        print(f"\n⚠️ {total - passed} test(s) failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
