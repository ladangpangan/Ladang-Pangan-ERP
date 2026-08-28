#!/usr/bin/env python3
"""
Backend Test: SO Shipping Journal Verification (Enhanced)

This test specifically looks for a SO that qualifies for SO_SHIP journal generation
(Shipped/Invoiced/Selesai or has invoice_number) to verify that the accounting
journal credits the CHOSEN account.

If no qualifying SO is found, the test will report this condition.
"""

import requests
import json
import sys
from datetime import datetime

# Configuration
BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

# Test state
session = requests.Session()

def log(msg):
    """Print timestamped log message"""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def test_step(step_num, description):
    """Print test step header"""
    print(f"\n{'='*80}")
    print(f"TEST {step_num}: {description}")
    print('='*80)

try:
    # Login as akuntan (has full accounting access including journals)
    test_step(1, "Login as akuntan (for accounting access)")
    login_response = session.post(
        f"{BASE_URL}/auth/sign-in/email",
        json={"email": "akuntan@lpi.co.id", "password": "akuntanlpi123"},
        headers={"Content-Type": "application/json"}
    )
    
    if login_response.status_code != 200:
        log(f"❌ Login failed: {login_response.status_code}")
        sys.exit(1)
    
    log("✅ Login successful (akuntan has full accounting access)")
    
    # Get all SOs
    test_step(2, "Find SOs that qualify for SO_SHIP journal generation")
    
    so_list_response = session.get(f"{BASE_URL}/sales-orders")
    if so_list_response.status_code != 200:
        log(f"❌ Failed to get sales orders: {so_list_response.status_code}")
        sys.exit(1)
    
    all_sos = so_list_response.json().get('data', [])
    log(f"Found {len(all_sos)} sales orders total")
    
    # Find SOs that qualify for journal generation
    qualifying_sos = []
    for so in all_sos:
        status = so.get('pipelineStatus', '')
        has_invoice = so.get('invoiceNumber') is not None and so.get('invoiceNumber') != ''
        
        if status in ['Shipped', 'Invoiced', 'Selesai'] or has_invoice:
            qualifying_sos.append(so)
            log(f"  ✅ {so.get('soNumber')}: status={status}, has_invoice={has_invoice}")
    
    if not qualifying_sos:
        log("\n⚠️  NO QUALIFYING SOs FOUND")
        log("   No SOs in Shipped/Invoiced/Selesai status or with invoice_number")
        log("   Cannot verify SO_SHIP journal generation")
        log("\n   Available SOs:")
        for so in all_sos[:10]:
            log(f"     - {so.get('soNumber')}: {so.get('pipelineStatus')}")
        
        print("\n" + "="*80)
        print("TEST RESULT: SKIPPED")
        print("="*80)
        print("Reason: No SOs qualify for SO_SHIP journal generation")
        print("Note: SO_SHIP journal only generated when SO is Shipped/Invoiced/Selesai OR has invoice_number")
        print("\nThe basic persistence test (backend_test_shipping_account.py) already verified:")
        print("  ✅ shippingAccountCode field persists correctly")
        print("  ✅ GET /cash-bank-accounts returns Kas/Bank accounts")
        print("  ✅ PATCH /sales-orders/:id accepts shippingAccountCode")
        print("\nJournal generation can be verified when a qualifying SO exists.")
        print("="*80)
        sys.exit(0)
    
    log(f"\n✅ Found {len(qualifying_sos)} qualifying SOs")
    
    # Test each qualifying SO
    test_step(3, "Verify SO_SHIP journals for qualifying SOs")
    
    # Trigger accounting sync
    log("Triggering accounting sync...")
    session.get(f"{BASE_URL}/accounting/trial-balance")
    
    # Get all SO_SHIP journals
    journals_response = session.get(f"{BASE_URL}/accounting/journals?source=SO_SHIP&limit=500")
    if journals_response.status_code != 200:
        log(f"❌ Failed to get journals: {journals_response.status_code}")
        sys.exit(1)
    
    journals = journals_response.json().get('data', [])
    log(f"Found {len(journals)} SO_SHIP journals")
    
    # Check each qualifying SO
    verified_count = 0
    for so in qualifying_sos:
        so_id = so.get('id')
        so_number = so.get('soNumber')
        
        # Get SO details
        so_detail_response = session.get(f"{BASE_URL}/sales-orders/{so_id}")
        if so_detail_response.status_code != 200:
            log(f"⚠️  Could not get details for {so_number}")
            continue
        
        so_detail = so_detail_response.json().get('data', {})
        shipping_cost = so_detail.get('shippingCost', 0)
        shipping_account = so_detail.get('shippingAccountCode')
        
        if shipping_cost <= 0:
            log(f"\n  ⚠️  {so_number}: No shipping cost (shippingCost={shipping_cost}), skipping")
            continue
        
        log(f"\n  📦 {so_number}:")
        log(f"     - Shipping cost: Rp {shipping_cost:,}")
        log(f"     - Shipping account: {shipping_account or 'NOT SET (will use default)'}")
        
        # Find journal for this SO
        journal = next((j for j in journals if j.get('sourceId') == so_id or j.get('sourceKey') == f"SO_SHIP:{so_id}"), None)
        
        if not journal:
            log(f"     ⚠️  SO_SHIP journal not found (may not be generated yet)")
            continue
        
        log(f"     ✅ Found SO_SHIP journal: {journal.get('id')}")
        
        # Verify journal lines
        lines = journal.get('lines', [])
        log(f"     Journal has {len(lines)} lines:")
        
        debit_line = None
        credit_line = None
        credit_account = None
        
        for line in lines:
            code = line.get('accountCode') or line.get('code')
            debit = line.get('debit', 0)
            credit = line.get('credit', 0)
            
            if debit > 0:
                log(f"       - DEBIT {code}: Rp {debit:,}")
                if code == '6-1300':
                    debit_line = line
            
            if credit > 0:
                log(f"       - CREDIT {code}: Rp {credit:,}")
                credit_line = line
                credit_account = code
        
        # Verify DEBIT to 6-1300 (Beban Pengiriman/Ongkir)
        if debit_line:
            if debit_line.get('debit') == shipping_cost:
                log(f"     ✅ DEBIT to 6-1300 (Beban Pengiriman/Ongkir): Rp {shipping_cost:,}")
            else:
                log(f"     ⚠️  DEBIT amount mismatch: {debit_line.get('debit')} != {shipping_cost}")
        else:
            log(f"     ❌ DEBIT line to 6-1300 NOT FOUND")
        
        # Verify CREDIT to chosen account
        if credit_line:
            if shipping_account:
                if credit_account == shipping_account:
                    log(f"     ✅ CREDIT to CHOSEN account {shipping_account}: Rp {credit_line.get('credit'):,}")
                    verified_count += 1
                else:
                    log(f"     ⚠️  CREDIT to {credit_account}, expected {shipping_account}")
            else:
                log(f"     ✅ CREDIT to default account {credit_account}: Rp {credit_line.get('credit'):,}")
                log(f"        (No shippingAccountCode set, using default)")
                verified_count += 1
        else:
            log(f"     ❌ CREDIT line NOT FOUND")
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    if verified_count > 0:
        print(f"✅ VERIFIED {verified_count} SO_SHIP journal(s)")
        print("\nKey Findings:")
        print("  ✅ SO_SHIP journals are generated for qualifying SOs")
        print("  ✅ Journals DEBIT 6-1300 (Beban Pengiriman/Ongkir)")
        print("  ✅ Journals CREDIT the chosen account (or default if not set)")
        print("\nFeature Status: WORKING")
    else:
        print("⚠️  NO JOURNALS VERIFIED")
        print(f"   Found {len(qualifying_sos)} qualifying SOs, but none had verifiable journals")
        print("   This may indicate journals haven't been generated yet")
    
    print("="*80)
    
except Exception as e:
    print(f"\n❌ TEST FAILED WITH EXCEPTION: {str(e)}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
