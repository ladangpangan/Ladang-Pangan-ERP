#!/usr/bin/env python3
"""
Backend test for Purchase Order additional_cost (Ongkir) bearer + pay method feature.
Tests the NEW business rules where freight is expensed as Beban Angkut Pembelian (5-1300)
and NOT capitalized into HPP.
"""

import requests
import json
import sqlite3
from uuid import uuid4
from datetime import datetime

BASE_URL = "http://localhost:3000/api"
ORIGIN = "http://localhost:3000"
DB_PATH = "/app/data/erp.db"

# Admin credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

session = requests.Session()

def login():
    """Login as admin and get session cookie"""
    print("=== LOGGING IN AS ADMIN ===")
    resp = session.post(
        f"{BASE_URL}/auth/sign-in/email",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"Origin": ORIGIN}
    )
    if resp.status_code != 200:
        print(f"❌ Login failed: {resp.status_code} {resp.text}")
        return False
    print(f"✅ Login successful")
    return True

def db_query(query, params=None):
    """Execute SQLite query and return results"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    if params:
        cursor.execute(query, params)
    else:
        cursor.execute(query)
    results = cursor.fetchall()
    conn.close()
    return [dict(row) for row in results]

def db_execute(query, params=None):
    """Execute SQLite write query"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    if params:
        cursor.execute(query, params)
    else:
        cursor.execute(query)
    conn.commit()
    conn.close()

def seed_test_data():
    """Seed test data: supplier, product, PO with items"""
    print("\n=== SEEDING TEST DATA ===")
    
    # Create test supplier
    supplier_id = str(uuid4())
    supplier_code = f"SUP-TEST-{int(datetime.now().timestamp())}"
    db_execute("""
        INSERT INTO contacts (id, code, display_name, categories, contact_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    """, (supplier_id, supplier_code, "Test Supplier for PO Ongkir", '["Supplier"]', "Supplier"))
    print(f"✅ Created supplier: {supplier_code} (ID: {supplier_id})")
    
    # Create test product
    product_id = str(uuid4())
    product_sku = f"PROD-TEST-{int(datetime.now().timestamp())}"
    db_execute("""
        INSERT INTO products (id, sku, name, category, unit, base_price, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    """, (product_id, product_sku, "Test Product for PO Ongkir", "Karkas", "kg", 50000))
    print(f"✅ Created product: {product_sku} (ID: {product_id})")
    
    # Create test PO
    po_id = str(uuid4())
    po_number = f"PO/TEST/{int(datetime.now().timestamp())}"
    db_execute("""
        INSERT INTO purchase_order (
            id, po_number, supplier_id, po_type, method, pipeline_status,
            order_date, additional_cost, additional_cost_bearer, additional_cost_pay_method,
            total_amount, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, datetime('now'), datetime('now'))
    """, (po_id, po_number, supplier_id, "Beli Jadi", "Timbang Ulang", "Draft", 0, "company", "utang", 0))
    print(f"✅ Created PO: {po_number} (ID: {po_id})")
    
    # Create PO item: 20kg @ 50,000 = 1,000,000
    item_id = str(uuid4())
    db_execute("""
        INSERT INTO purchase_order_items (
            id, purchase_order_id, product_id, quantity, weight, unit_price,
            hpp_per_kg, additional_cost_share
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (item_id, po_id, product_id, 2, 20, 50000, 0, 0))
    print(f"✅ Created PO item: 20kg @ Rp 50,000 = Rp 1,000,000")
    
    # Trigger recalcPoHpp by PATCHing the PO
    resp = session.patch(
        f"{BASE_URL}/purchase-orders/{po_id}",
        json={"notes": "Initial setup"},
        headers={"Origin": ORIGIN}
    )
    if resp.status_code != 200:
        print(f"❌ Failed to trigger recalcPoHpp: {resp.status_code} {resp.text}")
    else:
        print(f"✅ Triggered recalcPoHpp via PATCH")
    
    return {
        "po_id": po_id,
        "po_number": po_number,
        "supplier_id": supplier_id,
        "product_id": product_id,
        "item_id": item_id
    }

def test_t1_company_utang(test_data):
    """T1: company + utang => freight added to total, PO_INV has Beban Angkut line"""
    print("\n=== TEST T1: COMPANY + UTANG ===")
    po_id = test_data["po_id"]
    
    # PATCH PO with additional_cost=60000, bearer=company, pay_method=utang
    print("Step 1: PATCH PO with additionalCost=60000, bearer=company, payMethod=utang")
    resp = session.patch(
        f"{BASE_URL}/purchase-orders/{po_id}",
        json={
            "additionalCost": 60000,
            "additionalCostBearer": "company",
            "additionalCostPayMethod": "utang"
        },
        headers={"Origin": ORIGIN}
    )
    if resp.status_code != 200:
        print(f"❌ PATCH failed: {resp.status_code} {resp.text}")
        return False
    print(f"✅ PATCH successful")
    
    # GET /purchase-orders/:id/hpp
    print("Step 2: GET /purchase-orders/:id/hpp")
    resp = session.get(f"{BASE_URL}/purchase-orders/{po_id}/hpp")
    if resp.status_code != 200:
        print(f"❌ GET hpp failed: {resp.status_code} {resp.text}")
        return False
    
    data = resp.json()["data"]
    totals = data["totals"]
    items = data["items"]
    
    print(f"  totals.grandTotal: Rp {totals['grandTotal']:,.0f}")
    print(f"  totals.additionalCost: Rp {totals['additionalCost']:,.0f}")
    print(f"  totals.additionalCostBearer: {totals['additionalCostBearer']}")
    print(f"  totals.additionalCostPayMethod: {totals['additionalCostPayMethod']}")
    
    # VERIFY: grandTotal should be 1,060,000 (goods 1,000,000 + freight 60,000)
    if totals["grandTotal"] != 1060000:
        print(f"❌ FAILED: Expected grandTotal=1,060,000, got {totals['grandTotal']}")
        return False
    print(f"✅ VERIFIED: grandTotal = 1,060,000 (goods + freight)")
    
    # VERIFY: hpp_per_kg should be 50,000 (unit price, NO freight baked in)
    for item in items:
        print(f"  item hpp_per_kg: Rp {item['hppPerKg']:,.0f}")
        print(f"  item additionalCostShare: {item['additionalCostShare']}")
        if abs(item["hppPerKg"] - 50000) > 0.01:
            print(f"❌ FAILED: Expected hpp_per_kg=50,000, got {item['hppPerKg']}")
            return False
        if item["additionalCostShare"] != 0:
            print(f"❌ FAILED: Expected additionalCostShare=0, got {item['additionalCostShare']}")
            return False
    print(f"✅ VERIFIED: hpp_per_kg = 50,000 (NO freight capitalized)")
    print(f"✅ VERIFIED: additionalCostShare = 0")
    
    # Make PO invoice-eligible by setting invoice_number
    print("Step 3: Make PO invoice-eligible (set invoice_number)")
    db_execute("""
        UPDATE purchase_order 
        SET invoice_number = ?, pipeline_status = 'Invoiced'
        WHERE id = ?
    """, (f"INV-TEST-{int(datetime.now().timestamp())}", po_id))
    print(f"✅ PO set to Invoiced with invoice_number")
    
    # Trigger accounting sync
    print("Step 4: Trigger accounting sync")
    resp = session.post(
        f"{BASE_URL}/accounting/sync",
        headers={"Origin": ORIGIN}
    )
    if resp.status_code != 200:
        print(f"❌ Accounting sync failed: {resp.status_code} {resp.text}")
        return False
    print(f"✅ Accounting sync successful")
    
    # VERIFY: PO_INV journal exists with Beban Angkut line
    print("Step 5: Verify PO_INV journal")
    journals = db_query("""
        SELECT * FROM journal_entries 
        WHERE source_type = 'PO_INV' AND source_id = ?
    """, (po_id,))
    
    if len(journals) == 0:
        print(f"❌ FAILED: No PO_INV journal found")
        return False
    
    journal_id = journals[0]["id"]
    print(f"✅ Found PO_INV journal (ID: {journal_id})")
    
    # Get journal lines
    lines = db_query("""
        SELECT account_code, debit, credit 
        FROM journal_lines 
        WHERE journal_id = ?
        ORDER BY account_code
    """, (journal_id,))
    
    print(f"  Journal lines:")
    for line in lines:
        dr = f"Dr {line['debit']:,.0f}" if line['debit'] > 0 else ""
        cr = f"Cr {line['credit']:,.0f}" if line['credit'] > 0 else ""
        print(f"    {line['account_code']}: {dr} {cr}")
    
    # VERIFY: Should have Dr 1-1300 (Persediaan), Dr 5-1300 (Beban Angkut), Cr 2-1100 (Utang)
    beban_angkut_line = [l for l in lines if l["account_code"] == "5-1300"]
    if len(beban_angkut_line) == 0:
        print(f"❌ FAILED: No Beban Angkut (5-1300) line found")
        return False
    
    if beban_angkut_line[0]["debit"] != 60000:
        print(f"❌ FAILED: Expected Dr 5-1300 = 60,000, got {beban_angkut_line[0]['debit']}")
        return False
    print(f"✅ VERIFIED: Dr 5-1300 (Beban Angkut) = 60,000")
    
    # VERIFY: Cr Utang should be 1,060,000 (full total)
    utang_line = [l for l in lines if l["account_code"] == "2-1100"]
    if len(utang_line) == 0:
        print(f"❌ FAILED: No Utang Usaha (2-1100) line found")
        return False
    
    if utang_line[0]["credit"] != 1060000:
        print(f"❌ FAILED: Expected Cr 2-1100 = 1,060,000, got {utang_line[0]['credit']}")
        return False
    print(f"✅ VERIFIED: Cr 2-1100 (Utang Usaha) = 1,060,000")
    
    # VERIFY: No PO_SHIP journal should exist
    po_ship_journals = db_query("""
        SELECT * FROM journal_entries 
        WHERE source_type = 'PO_SHIP' AND source_id = ?
    """, (po_id,))
    
    if len(po_ship_journals) > 0:
        print(f"❌ FAILED: PO_SHIP journal should NOT exist for utang payment")
        return False
    print(f"✅ VERIFIED: No PO_SHIP journal (correct for utang payment)")
    
    print(f"✅ TEST T1 PASSED")
    return True

def test_t2_company_transfer_tunai(test_data):
    """T2: company + transfer/tunai => freight NOT in total, separate PO_SHIP journal"""
    print("\n=== TEST T2: COMPANY + TRANSFER/TUNAI ===")
    po_id = test_data["po_id"]
    
    # PATCH to transfer
    print("Step 1: PATCH to additionalCostPayMethod=transfer")
    resp = session.patch(
        f"{BASE_URL}/purchase-orders/{po_id}",
        json={"additionalCostPayMethod": "transfer"},
        headers={"Origin": ORIGIN}
    )
    if resp.status_code != 200:
        print(f"❌ PATCH failed: {resp.status_code} {resp.text}")
        return False
    print(f"✅ PATCH successful")
    
    # GET hpp
    print("Step 2: GET /purchase-orders/:id/hpp")
    resp = session.get(f"{BASE_URL}/purchase-orders/{po_id}/hpp")
    if resp.status_code != 200:
        print(f"❌ GET hpp failed: {resp.status_code} {resp.text}")
        return False
    
    data = resp.json()["data"]
    totals = data["totals"]
    
    print(f"  totals.grandTotal: Rp {totals['grandTotal']:,.0f}")
    
    # VERIFY: grandTotal should be 1,000,000 (goods only, NO freight)
    if totals["grandTotal"] != 1000000:
        print(f"❌ FAILED: Expected grandTotal=1,000,000, got {totals['grandTotal']}")
        return False
    print(f"✅ VERIFIED: grandTotal = 1,000,000 (freight NOT in total)")
    
    # Re-sync accounting
    print("Step 3: Re-sync accounting")
    resp = session.post(
        f"{BASE_URL}/accounting/sync",
        headers={"Origin": ORIGIN}
    )
    if resp.status_code != 200:
        print(f"❌ Accounting sync failed: {resp.status_code} {resp.text}")
        return False
    print(f"✅ Accounting sync successful")
    
    # VERIFY: PO_INV journal should have NO Beban Angkut line
    print("Step 4: Verify PO_INV journal (no freight line)")
    journals = db_query("""
        SELECT * FROM journal_entries 
        WHERE source_type = 'PO_INV' AND source_id = ?
    """, (po_id,))
    
    if len(journals) == 0:
        print(f"❌ FAILED: No PO_INV journal found")
        return False
    
    journal_id = journals[0]["id"]
    lines = db_query("""
        SELECT account_code, debit, credit 
        FROM journal_lines 
        WHERE journal_id = ?
    """, (journal_id,))
    
    beban_angkut_in_inv = [l for l in lines if l["account_code"] == "5-1300"]
    if len(beban_angkut_in_inv) > 0:
        print(f"❌ FAILED: PO_INV should NOT have Beban Angkut line for transfer payment")
        return False
    print(f"✅ VERIFIED: PO_INV has NO Beban Angkut line")
    
    # VERIFY: Utang should be 1,000,000 (goods only)
    utang_line = [l for l in lines if l["account_code"] == "2-1100"]
    if len(utang_line) == 0 or utang_line[0]["credit"] != 1000000:
        print(f"❌ FAILED: Expected Cr 2-1100 = 1,000,000")
        return False
    print(f"✅ VERIFIED: Cr 2-1100 (Utang) = 1,000,000")
    
    # VERIFY: PO_SHIP journal exists with Dr 5-1300 / Cr Bank
    print("Step 5: Verify PO_SHIP journal (Dr Beban / Cr Bank)")
    po_ship_journals = db_query("""
        SELECT * FROM journal_entries 
        WHERE source_type = 'PO_SHIP' AND source_id = ?
    """, (po_id,))
    
    if len(po_ship_journals) == 0:
        print(f"❌ FAILED: No PO_SHIP journal found")
        return False
    
    ship_journal_id = po_ship_journals[0]["id"]
    print(f"✅ Found PO_SHIP journal (ID: {ship_journal_id})")
    
    ship_lines = db_query("""
        SELECT account_code, debit, credit 
        FROM journal_lines 
        WHERE journal_id = ?
    """, (ship_journal_id,))
    
    print(f"  PO_SHIP journal lines:")
    for line in ship_lines:
        dr = f"Dr {line['debit']:,.0f}" if line['debit'] > 0 else ""
        cr = f"Cr {line['credit']:,.0f}" if line['credit'] > 0 else ""
        print(f"    {line['account_code']}: {dr} {cr}")
    
    # VERIFY: Dr 5-1300 = 60,000
    beban_line = [l for l in ship_lines if l["account_code"] == "5-1300"]
    if len(beban_line) == 0 or beban_line[0]["debit"] != 60000:
        print(f"❌ FAILED: Expected Dr 5-1300 = 60,000 in PO_SHIP")
        return False
    print(f"✅ VERIFIED: Dr 5-1300 (Beban Angkut) = 60,000")
    
    # VERIFY: Cr Bank (1-1120) = 60,000
    bank_line = [l for l in ship_lines if l["account_code"] == "1-1120"]
    if len(bank_line) == 0 or bank_line[0]["credit"] != 60000:
        print(f"❌ FAILED: Expected Cr 1-1120 (Bank) = 60,000 in PO_SHIP")
        return False
    print(f"✅ VERIFIED: Cr 1-1120 (Bank) = 60,000")
    
    # Now test tunai
    print("\nStep 6: PATCH to additionalCostPayMethod=tunai")
    resp = session.patch(
        f"{BASE_URL}/purchase-orders/{po_id}",
        json={"additionalCostPayMethod": "tunai"},
        headers={"Origin": ORIGIN}
    )
    if resp.status_code != 200:
        print(f"❌ PATCH failed: {resp.status_code} {resp.text}")
        return False
    print(f"✅ PATCH successful")
    
    # Re-sync
    print("Step 7: Re-sync accounting")
    resp = session.post(
        f"{BASE_URL}/accounting/sync",
        headers={"Origin": ORIGIN}
    )
    if resp.status_code != 200:
        print(f"❌ Accounting sync failed: {resp.status_code} {resp.text}")
        return False
    print(f"✅ Accounting sync successful")
    
    # VERIFY: PO_SHIP credit line is now Kas (1-1110)
    print("Step 8: Verify PO_SHIP journal (Cr Kas)")
    po_ship_journals = db_query("""
        SELECT * FROM journal_entries 
        WHERE source_type = 'PO_SHIP' AND source_id = ?
    """, (po_id,))
    
    if len(po_ship_journals) == 0:
        print(f"❌ FAILED: No PO_SHIP journal found")
        return False
    
    ship_journal_id = po_ship_journals[0]["id"]
    ship_lines = db_query("""
        SELECT account_code, debit, credit 
        FROM journal_lines 
        WHERE journal_id = ?
    """, (ship_journal_id,))
    
    # VERIFY: Cr Kas (1-1110) = 60,000
    kas_line = [l for l in ship_lines if l["account_code"] == "1-1110"]
    if len(kas_line) == 0 or kas_line[0]["credit"] != 60000:
        print(f"❌ FAILED: Expected Cr 1-1110 (Kas) = 60,000 in PO_SHIP")
        return False
    print(f"✅ VERIFIED: Cr 1-1110 (Kas) = 60,000")
    
    print(f"✅ TEST T2 PASSED")
    return True

def test_t3_supplier_borne(test_data):
    """T3: supplier-borne => freight NOT in total, NO Beban Angkut anywhere"""
    print("\n=== TEST T3: SUPPLIER-BORNE ===")
    po_id = test_data["po_id"]
    
    # PATCH to supplier bearer
    print("Step 1: PATCH to additionalCostBearer=supplier")
    resp = session.patch(
        f"{BASE_URL}/purchase-orders/{po_id}",
        json={"additionalCostBearer": "supplier"},
        headers={"Origin": ORIGIN}
    )
    if resp.status_code != 200:
        print(f"❌ PATCH failed: {resp.status_code} {resp.text}")
        return False
    print(f"✅ PATCH successful")
    
    # GET hpp
    print("Step 2: GET /purchase-orders/:id/hpp")
    resp = session.get(f"{BASE_URL}/purchase-orders/{po_id}/hpp")
    if resp.status_code != 200:
        print(f"❌ GET hpp failed: {resp.status_code} {resp.text}")
        return False
    
    data = resp.json()["data"]
    totals = data["totals"]
    items = data["items"]
    
    print(f"  totals.grandTotal: Rp {totals['grandTotal']:,.0f}")
    
    # VERIFY: grandTotal should be 1,000,000 (goods only)
    if totals["grandTotal"] != 1000000:
        print(f"❌ FAILED: Expected grandTotal=1,000,000, got {totals['grandTotal']}")
        return False
    print(f"✅ VERIFIED: grandTotal = 1,000,000 (freight NOT in total)")
    
    # VERIFY: hpp_per_kg unchanged (goods only)
    for item in items:
        if abs(item["hppPerKg"] - 50000) > 0.01:
            print(f"❌ FAILED: Expected hpp_per_kg=50,000, got {item['hppPerKg']}")
            return False
    print(f"✅ VERIFIED: hpp_per_kg = 50,000 (unchanged)")
    
    # Re-sync
    print("Step 3: Re-sync accounting")
    resp = session.post(
        f"{BASE_URL}/accounting/sync",
        headers={"Origin": ORIGIN}
    )
    if resp.status_code != 200:
        print(f"❌ Accounting sync failed: {resp.status_code} {resp.text}")
        return False
    print(f"✅ Accounting sync successful")
    
    # VERIFY: NO Beban Angkut (5-1300) line anywhere
    print("Step 4: Verify NO Beban Angkut line in any journal")
    all_lines = db_query("""
        SELECT jl.account_code, jl.debit, jl.credit, je.source_type
        FROM journal_lines jl
        JOIN journal_entries je ON jl.journal_id = je.id
        WHERE je.source_id = ? AND jl.account_code = '5-1300'
    """, (po_id,))
    
    if len(all_lines) > 0:
        print(f"❌ FAILED: Found Beban Angkut line(s) for supplier-borne freight:")
        for line in all_lines:
            print(f"  {line['source_type']}: {line['account_code']} Dr {line['debit']} Cr {line['credit']}")
        return False
    print(f"✅ VERIFIED: NO Beban Angkut (5-1300) line in any journal")
    
    # VERIFY: NO PO_SHIP journal
    po_ship_journals = db_query("""
        SELECT * FROM journal_entries 
        WHERE source_type = 'PO_SHIP' AND source_id = ?
    """, (po_id,))
    
    if len(po_ship_journals) > 0:
        print(f"❌ FAILED: PO_SHIP journal should NOT exist for supplier-borne freight")
        return False
    print(f"✅ VERIFIED: No PO_SHIP journal")
    
    print(f"✅ TEST T3 PASSED")
    return True

def test_t4_hpp_not_capitalized(test_data):
    """T4: Verify HPP not capitalized in all cases"""
    print("\n=== TEST T4: HPP NOT CAPITALIZED ===")
    po_id = test_data["po_id"]
    
    # Get hpp
    resp = session.get(f"{BASE_URL}/purchase-orders/{po_id}/hpp")
    if resp.status_code != 200:
        print(f"❌ GET hpp failed: {resp.status_code} {resp.text}")
        return False
    
    data = resp.json()["data"]
    items = data["items"]
    
    # VERIFY: sum(hpp_per_kg * weight) == goods cost only (1,000,000)
    total_hpp = sum(item["hppPerKg"] * item["weightActual"] for item in items)
    print(f"  sum(hpp_per_kg * weight): Rp {total_hpp:,.0f}")
    
    if abs(total_hpp - 1000000) > 0.01:
        print(f"❌ FAILED: Expected total HPP = 1,000,000 (goods only), got {total_hpp}")
        return False
    print(f"✅ VERIFIED: sum(hpp_per_kg * weight) = 1,000,000 (goods only, freight excluded)")
    
    # VERIFY: all items have additionalCostShare = 0
    for item in items:
        if item["additionalCostShare"] != 0:
            print(f"❌ FAILED: Expected additionalCostShare=0, got {item['additionalCostShare']}")
            return False
    print(f"✅ VERIFIED: All items have additionalCostShare = 0")
    
    print(f"✅ TEST T4 PASSED")
    return True

def test_t5_regression(test_data):
    """T5: Regression - PO with additional_cost=0"""
    print("\n=== TEST T5: REGRESSION (additional_cost=0) ===")
    
    # Create a second PO with no freight
    print("Step 1: Create second PO with additional_cost=0")
    po2_id = str(uuid4())
    po2_number = f"PO/TEST2/{int(datetime.now().timestamp())}"
    db_execute("""
        INSERT INTO purchase_order (
            id, po_number, supplier_id, po_type, method, pipeline_status,
            order_date, additional_cost, additional_cost_bearer, additional_cost_pay_method,
            total_amount, invoice_number, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    """, (po2_id, po2_number, test_data["supplier_id"], "Beli Jadi", "Timbang Ulang", "Invoiced", 
          0, "company", "utang", 0, f"INV-TEST2-{int(datetime.now().timestamp())}"))
    
    # Create item
    item2_id = str(uuid4())
    db_execute("""
        INSERT INTO purchase_order_items (
            id, purchase_order_id, product_id, quantity, weight, unit_price,
            hpp_per_kg, additional_cost_share
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (item2_id, po2_id, test_data["product_id"], 2, 20, 50000, 0, 0))
    
    # Trigger recalc
    resp = session.patch(
        f"{BASE_URL}/purchase-orders/{po2_id}",
        json={"notes": "Regression test"},
        headers={"Origin": ORIGIN}
    )
    if resp.status_code != 200:
        print(f"❌ PATCH failed: {resp.status_code} {resp.text}")
        return False
    print(f"✅ Created PO2: {po2_number}")
    
    # GET hpp
    print("Step 2: GET /purchase-orders/:id/hpp")
    resp = session.get(f"{BASE_URL}/purchase-orders/{po2_id}/hpp")
    if resp.status_code != 200:
        print(f"❌ GET hpp failed: {resp.status_code} {resp.text}")
        return False
    
    data = resp.json()["data"]
    totals = data["totals"]
    
    print(f"  totals.grandTotal: Rp {totals['grandTotal']:,.0f}")
    print(f"  totals.additionalCost: Rp {totals['additionalCost']:,.0f}")
    
    # VERIFY: grandTotal = 1,000,000 (goods only)
    if totals["grandTotal"] != 1000000:
        print(f"❌ FAILED: Expected grandTotal=1,000,000, got {totals['grandTotal']}")
        return False
    print(f"✅ VERIFIED: grandTotal = 1,000,000 (goods only)")
    
    # Sync accounting
    print("Step 3: Sync accounting")
    resp = session.post(
        f"{BASE_URL}/accounting/sync",
        headers={"Origin": ORIGIN}
    )
    if resp.status_code != 200:
        print(f"❌ Accounting sync failed: {resp.status_code} {resp.text}")
        return False
    
    # VERIFY: NO freight journals for this PO
    print("Step 4: Verify NO freight journals")
    freight_journals = db_query("""
        SELECT * FROM journal_entries 
        WHERE source_type IN ('PO_SHIP') AND source_id = ?
    """, (po2_id,))
    
    if len(freight_journals) > 0:
        print(f"❌ FAILED: Found freight journal for PO with additional_cost=0")
        return False
    print(f"✅ VERIFIED: No freight journals")
    
    # Clean up PO2
    print("Step 5: Clean up PO2")
    db_execute("DELETE FROM purchase_order_items WHERE purchase_order_id = ?", (po2_id,))
    db_execute("DELETE FROM purchase_order WHERE id = ?", (po2_id,))
    db_execute("DELETE FROM journal_entries WHERE source_id = ?", (po2_id,))
    print(f"✅ PO2 cleaned up")
    
    print(f"✅ TEST T5 PASSED")
    return True

def cleanup_test_data(test_data):
    """Clean up all seeded test data"""
    print("\n=== CLEANING UP TEST DATA ===")
    
    po_id = test_data["po_id"]
    supplier_id = test_data["supplier_id"]
    product_id = test_data["product_id"]
    
    # Delete journal entries
    db_execute("DELETE FROM journal_lines WHERE journal_id IN (SELECT id FROM journal_entries WHERE source_id = ?)", (po_id,))
    db_execute("DELETE FROM journal_entries WHERE source_id = ?", (po_id,))
    print(f"✅ Deleted journal entries for PO")
    
    # Delete PO items
    db_execute("DELETE FROM purchase_order_items WHERE purchase_order_id = ?", (po_id,))
    print(f"✅ Deleted PO items")
    
    # Delete PO
    db_execute("DELETE FROM purchase_order WHERE id = ?", (po_id,))
    print(f"✅ Deleted PO")
    
    # Delete product
    db_execute("DELETE FROM products WHERE id = ?", (product_id,))
    print(f"✅ Deleted product")
    
    # Delete supplier
    db_execute("DELETE FROM contacts WHERE id = ?", (supplier_id,))
    print(f"✅ Deleted supplier")
    
    # Re-sync to remove orphaned journals
    print("Re-syncing accounting to clean up...")
    resp = session.post(
        f"{BASE_URL}/accounting/sync",
        headers={"Origin": ORIGIN}
    )
    if resp.status_code == 200:
        print(f"✅ Accounting re-synced")
    
    # Verify clean slate
    po_count = db_query("SELECT COUNT(*) as count FROM purchase_order")[0]["count"]
    journal_count = db_query("""
        SELECT COUNT(*) as count FROM journal_entries 
        WHERE source_type IN ('PO_INV', 'PO_SHIP')
    """)[0]["count"]
    
    print(f"\n=== FINAL STATE ===")
    print(f"  purchase_order count: {po_count}")
    print(f"  journal_entries (PO_INV/PO_SHIP) count: {journal_count}")
    
    return True

def main():
    """Main test runner"""
    print("=" * 80)
    print("BACKEND TEST: Purchase Order additional_cost (Ongkir) bearer + pay method")
    print("=" * 80)
    
    # Login
    if not login():
        print("\n❌ LOGIN FAILED - ABORTING TESTS")
        return False
    
    # Seed test data
    test_data = seed_test_data()
    
    try:
        # Run tests
        results = {
            "T1 (company+utang)": test_t1_company_utang(test_data),
            "T2 (company+transfer/tunai)": test_t2_company_transfer_tunai(test_data),
            "T3 (supplier-borne)": test_t3_supplier_borne(test_data),
            "T4 (HPP not capitalized)": test_t4_hpp_not_capitalized(test_data),
            "T5 (regression)": test_t5_regression(test_data),
        }
        
        # Clean up
        cleanup_test_data(test_data)
        
        # Summary
        print("\n" + "=" * 80)
        print("TEST SUMMARY")
        print("=" * 80)
        passed = sum(1 for v in results.values() if v)
        total = len(results)
        
        for test_name, result in results.items():
            status = "✅ PASSED" if result else "❌ FAILED"
            print(f"{test_name}: {status}")
        
        print(f"\nTotal: {passed}/{total} tests passed ({passed*100//total}%)")
        
        if passed == total:
            print("\n🎉 ALL TESTS PASSED!")
            return True
        else:
            print(f"\n❌ {total - passed} TEST(S) FAILED")
            return False
            
    except Exception as e:
        print(f"\n❌ EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
        # Try to clean up
        try:
            cleanup_test_data(test_data)
        except Exception:
            pass
        return False

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
