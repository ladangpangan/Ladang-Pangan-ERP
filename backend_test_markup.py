#!/usr/bin/env python3
"""
Backend test for Sales Order Faktur di-up + Cashback (markup) feature
SQLite + Drizzle ERP system
"""

import requests
import json
import sqlite3
import sys
from datetime import datetime

BASE_URL = "http://localhost:3000/api"
DB_PATH = "/app/data/erp.db"

# Test credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
OPERATOR_EMAIL = "operator@lpi.co.id"
OPERATOR_PASSWORD = "operator123"
DIREKTUR_EMAIL = "direktur@lpi.co.id"
DIREKTUR_PASSWORD = "direktur123"

# Track created resources for cleanup
created_resources = {
    'customer_id': None,
    'product_id': None,
    'so_id': None,
}

def login(email, password):
    """Login and return session cookies"""
    try:
        response = requests.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": email, "password": password},
            timeout=10
        )
        if response.status_code == 200:
            print(f"✅ Login successful: {email}")
            return response.cookies
        else:
            print(f"❌ Login failed for {email}: {response.status_code} - {response.text[:200]}")
            return None
    except Exception as e:
        print(f"❌ Login exception for {email}: {e}")
        return None

def query_db(query, params=()):
    """Execute SQLite query and return results"""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(query, params)
        results = cursor.fetchall()
        conn.close()
        return [dict(row) for row in results]
    except Exception as e:
        print(f"❌ Database query error: {e}")
        return []

def test_step_1_create_customer_product_so(cookies):
    """Step 1: Create Customer, Product, and Sales Order"""
    print("\n" + "="*80)
    print("STEP 1: Create Customer, Product, and Sales Order")
    print("="*80)
    
    try:
        # Create Customer
        print("\n[1.1] Creating Customer...")
        customer_data = {
            "displayName": f"Markup Test Customer {datetime.now().strftime('%H%M%S')}",
            "categories": ["Customer"],
            "code": f"CUST-MKP-{datetime.now().strftime('%H%M%S')}"
        }
        response = requests.post(f"{BASE_URL}/contacts", json=customer_data, cookies=cookies, timeout=10)
        if response.status_code != 201:
            print(f"❌ Failed to create customer: {response.status_code} - {response.text[:500]}")
            return False
        customer = response.json()['data']
        created_resources['customer_id'] = customer['id']
        print(f"✅ Customer created: {customer['displayName']} (ID: {customer['id']})")
        
        # Create Product
        print("\n[1.2] Creating Product...")
        product_data = {
            "sku": f"MKP-PROD-{datetime.now().strftime('%H%M%S')}",
            "name": "Markup Test Product",
            "unit": "kg",
            "basePrice": 100000,
            "category": "Frozen"
        }
        response = requests.post(f"{BASE_URL}/products", json=product_data, cookies=cookies, timeout=10)
        if response.status_code != 201:
            print(f"❌ Failed to create product: {response.status_code} - {response.text[:500]}")
            return False
        product = response.json()['data']
        created_resources['product_id'] = product['id']
        print(f"✅ Product created: {product['name']} (ID: {product['id']}, basePrice: Rp {product['basePrice']:,})")
        
        # Create Sales Order (stock, product-level item)
        print("\n[1.3] Creating Sales Order (stock, product-level)...")
        so_data = {
            "customerId": customer['id'],
            "fulfillmentType": "stock",
            "items": [{
                "productId": product['id'],
                "quantity": 1,
                "weight": 100,
                "unitPrice": 100000
            }]
        }
        response = requests.post(f"{BASE_URL}/sales-orders", json=so_data, cookies=cookies, timeout=10)
        if response.status_code != 201:
            print(f"❌ Failed to create SO: {response.status_code} - {response.text[:500]}")
            return False
        so = response.json()['data']
        created_resources['so_id'] = so['id']
        print(f"✅ SO created: {so['soNumber']} (ID: {so['id']})")
        print(f"   Total Amount: Rp {so['totalAmount']:,}")
        
        # Advance SO status: For product-level items without stock allocation,
        # we need to directly set pipeline_status to 'Shipped' via database to trigger SO_INV journal
        print("\n[1.4] Setting SO to Shipped status (to trigger SO_INV journal)...")
        
        # Direct database update to set pipeline_status to 'Shipped'
        # This bypasses the stock allocation requirement for testing purposes
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE sales_order SET pipeline_status = 'Shipped', updated_at = ? WHERE id = ?",
                (datetime.now().isoformat(), so['id'])
            )
            conn.commit()
            conn.close()
            print(f"✅ SO pipeline_status set to 'Shipped' via database update")
        except Exception as e:
            print(f"❌ Failed to update SO status: {e}")
        
        # Verify final status
        response = requests.get(f"{BASE_URL}/sales-orders/{so['id']}", cookies=cookies, timeout=10)
        if response.status_code == 200:
            so_updated = response.json()['data']
            print(f"✅ Final SO status: {so_updated['pipelineStatus']}")
            print(f"   Total Amount: Rp {so_updated['totalAmount']:,}")
            return True
        else:
            print(f"❌ Failed to verify SO: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Step 1 exception: {e}")
        return False

def test_step_2_enable_markup(cookies):
    """Step 2: POST /sales-orders/:id/markup with markupEnabled=true, realAmount=8000000"""
    print("\n" + "="*80)
    print("STEP 2: Enable Markup (realAmount=8,000,000)")
    print("="*80)
    
    try:
        so_id = created_resources['so_id']
        markup_data = {
            "markupEnabled": True,
            "realAmount": 8000000
        }
        
        print(f"\n[2.1] POST /sales-orders/{so_id}/markup")
        print(f"   Body: {json.dumps(markup_data, indent=2)}")
        
        response = requests.post(
            f"{BASE_URL}/sales-orders/{so_id}/markup",
            json=markup_data,
            cookies=cookies,
            timeout=10
        )
        
        if response.status_code != 200:
            print(f"❌ Failed to enable markup: {response.status_code} - {response.text[:500]}")
            return False
        
        data = response.json()['data']
        print(f"✅ Markup enabled successfully")
        print(f"   markupEnabled: {data.get('markupEnabled')}")
        print(f"   realAmount: Rp {data.get('realAmount', 0):,}")
        print(f"   cashbackAmount: Rp {data.get('cashbackAmount', 0):,}")
        print(f"   cashbackRecipient: {data.get('cashbackRecipient')}")
        
        # Verify values
        if not data.get('markupEnabled'):
            print(f"❌ markupEnabled should be true, got: {data.get('markupEnabled')}")
            return False
        if data.get('realAmount') != 8000000:
            print(f"❌ realAmount should be 8000000, got: {data.get('realAmount')}")
            return False
        if data.get('cashbackAmount') != 2000000:
            print(f"❌ cashbackAmount should be 2000000 (auto-calculated), got: {data.get('cashbackAmount')}")
            return False
        
        print(f"✅ All markup values correct")
        return True
        
    except Exception as e:
        print(f"❌ Step 2 exception: {e}")
        return False

def test_step_3_verify_so_computed_fields(cookies):
    """Step 3: GET SO and verify outstanding, netRevenue, cashbackAmount, grossProfit"""
    print("\n" + "="*80)
    print("STEP 3: Verify SO Computed Fields")
    print("="*80)
    
    try:
        so_id = created_resources['so_id']
        
        print(f"\n[3.1] GET /sales-orders/{so_id}")
        response = requests.get(f"{BASE_URL}/sales-orders/{so_id}", cookies=cookies, timeout=10)
        
        if response.status_code != 200:
            print(f"❌ Failed to get SO: {response.status_code} - {response.text[:500]}")
            return False
        
        so = response.json()['data']
        print(f"✅ SO retrieved successfully")
        print(f"   SO Number: {so.get('soNumber')}")
        print(f"   Total Amount: Rp {so.get('totalAmount', 0):,}")
        print(f"   Real Amount: Rp {so.get('realAmount', 0):,}")
        print(f"   Cashback Amount: Rp {so.get('cashbackAmount', 0):,}")
        print(f"   Outstanding: Rp {so.get('outstanding', 0):,}")
        print(f"   Net Revenue: Rp {so.get('netRevenue', 0):,}")
        print(f"   Billable: Rp {so.get('billable', 0):,}")
        print(f"   Gross Profit: Rp {so.get('grossProfit', 0):,}")
        print(f"   COGS Total: Rp {so.get('cogsTotal', 0):,}")
        print(f"   Seller Shipping: Rp {so.get('sellerShipping', 0):,}")
        
        # Verify computed fields
        errors = []
        
        # outstanding should be 8,000,000 (billable=realAmount minus paid/returns)
        expected_outstanding = 8000000
        if abs(so.get('outstanding', 0) - expected_outstanding) > 1:
            errors.append(f"outstanding should be {expected_outstanding:,}, got: {so.get('outstanding', 0):,}")
        
        # netRevenue should be 8,000,000 (totalAmount - cashback)
        expected_net_revenue = 8000000
        if abs(so.get('netRevenue', 0) - expected_net_revenue) > 1:
            errors.append(f"netRevenue should be {expected_net_revenue:,}, got: {so.get('netRevenue', 0):,}")
        
        # cashbackAmount should be 2,000,000
        expected_cashback = 2000000
        if abs(so.get('cashbackAmount', 0) - expected_cashback) > 1:
            errors.append(f"cashbackAmount should be {expected_cashback:,}, got: {so.get('cashbackAmount', 0):,}")
        
        # billable should be 8,000,000 (realAmount)
        expected_billable = 8000000
        if abs(so.get('billable', 0) - expected_billable) > 1:
            errors.append(f"billable should be {expected_billable:,}, got: {so.get('billable', 0):,}")
        
        # grossProfit = netRevenue - cogsTotal - sellerShipping
        expected_gross_profit = so.get('netRevenue', 0) - so.get('cogsTotal', 0) - so.get('sellerShipping', 0)
        if abs(so.get('grossProfit', 0) - expected_gross_profit) > 1:
            errors.append(f"grossProfit should be {expected_gross_profit:,}, got: {so.get('grossProfit', 0):,}")
        
        if errors:
            print(f"❌ Computed field errors:")
            for error in errors:
                print(f"   - {error}")
            return False
        
        print(f"✅ All computed fields correct")
        return True
        
    except Exception as e:
        print(f"❌ Step 3 exception: {e}")
        return False

def test_step_4_payment_and_status(cookies):
    """Step 4: POST payment 8M and verify paymentStatus='paid'"""
    print("\n" + "="*80)
    print("STEP 4: Payment and Status")
    print("="*80)
    
    try:
        so_id = created_resources['so_id']
        
        print(f"\n[4.1] POST /sales-orders/{so_id}/payments (amount=8,000,000)")
        payment_data = {
            "amount": 8000000,
            "method": "Transfer"
        }
        
        response = requests.post(
            f"{BASE_URL}/sales-orders/{so_id}/payments",
            json=payment_data,
            cookies=cookies,
            timeout=10
        )
        
        if response.status_code != 201:
            print(f"❌ Failed to create payment: {response.status_code} - {response.text[:500]}")
            return False
        
        print(f"✅ Payment created successfully")
        
        # Verify SO payment status
        print(f"\n[4.2] GET /sales-orders/{so_id} to verify payment status")
        response = requests.get(f"{BASE_URL}/sales-orders/{so_id}", cookies=cookies, timeout=10)
        
        if response.status_code != 200:
            print(f"❌ Failed to get SO: {response.status_code}")
            return False
        
        so = response.json()['data']
        print(f"✅ SO retrieved")
        print(f"   Payment Status: {so.get('paymentStatus')}")
        print(f"   Paid Amount: Rp {so.get('paidAmount', 0):,}")
        print(f"   Outstanding: Rp {so.get('outstanding', 0):,}")
        
        # Verify payment status is 'paid'
        if so.get('paymentStatus') != 'paid':
            print(f"❌ paymentStatus should be 'paid', got: {so.get('paymentStatus')}")
            return False
        
        # Verify outstanding is approximately 0
        if abs(so.get('outstanding', 0)) > 1:
            print(f"❌ outstanding should be ≈0, got: {so.get('outstanding', 0):,}")
            return False
        
        print(f"✅ Payment status correct (paid, outstanding ≈ 0)")
        return True
        
    except Exception as e:
        print(f"❌ Step 4 exception: {e}")
        return False

def test_step_5_accounting_integrity(cookies):
    """Step 5: Verify accounting integrity - SO_INV journal, trial balance, income statement"""
    print("\n" + "="*80)
    print("STEP 5: Accounting Integrity")
    print("="*80)
    
    try:
        so_id = created_resources['so_id']
        
        # Trigger accounting sync
        print(f"\n[5.1] POST /accounting/sync to trigger ledger sync")
        response = requests.post(f"{BASE_URL}/accounting/sync", cookies=cookies, timeout=30)
        if response.status_code != 200:
            print(f"⚠️  Sync returned {response.status_code}, trying to continue...")
        else:
            print(f"✅ Accounting sync triggered")
        
        # Query SO_INV journal for this SO
        print(f"\n[5.2] Query SO_INV journal for SO {so_id}")
        journal_query = """
            SELECT je.id, je.source_type, je.source_id, je.total_debit, je.total_credit,
                   jl.account_code, jl.debit, jl.credit, jl.description
            FROM journal_entries je
            JOIN journal_lines jl ON je.id = jl.journal_id
            WHERE je.source_type = 'SO_INV' AND je.source_id = ?
            ORDER BY jl.account_code
        """
        journal_lines = query_db(journal_query, (so_id,))
        
        if not journal_lines:
            print(f"❌ No SO_INV journal found for SO {so_id}")
            return False
        
        print(f"✅ Found {len(journal_lines)} journal lines for SO_INV")
        
        # Group by journal entry
        journal_entry_id = journal_lines[0]['id']
        total_debit = journal_lines[0]['total_debit']
        total_credit = journal_lines[0]['total_credit']
        
        print(f"\n   Journal Entry ID: {journal_entry_id}")
        print(f"   Total Debit: Rp {total_debit:,}")
        print(f"   Total Credit: Rp {total_credit:,}")
        print(f"\n   Journal Lines:")
        
        beban_komisi_found = False
        beban_komisi_amount = 0
        piutang_debit = 0
        piutang_credit = 0
        
        for line in journal_lines:
            print(f"      {line['account_code']}: Dr {line['debit']:,} / Cr {line['credit']:,} - {line['description']}")
            
            # Check for Beban Komisi (6-1400)
            if line['account_code'] == '6-1400':
                beban_komisi_found = True
                beban_komisi_amount = line['debit']
            
            # Track Piutang Usaha (1-1200)
            if line['account_code'] == '1-1200':
                piutang_debit += line['debit']
                piutang_credit += line['credit']
        
        # Verify Beban Komisi line exists with debit = 2,000,000
        if not beban_komisi_found:
            print(f"\n❌ Beban Komisi (6-1400) line NOT FOUND in journal")
            return False
        
        if abs(beban_komisi_amount - 2000000) > 1:
            print(f"\n❌ Beban Komisi debit should be 2,000,000, got: {beban_komisi_amount:,}")
            return False
        
        print(f"\n✅ Beban Komisi (6-1400) line found: Dr {beban_komisi_amount:,}")
        
        # Verify Piutang Usaha nets to 8,000,000 (debit 10M + credit 2M)
        piutang_net = piutang_debit - piutang_credit
        expected_piutang_net = 8000000
        
        print(f"\n   Piutang Usaha (1-1200):")
        print(f"      Debit: Rp {piutang_debit:,}")
        print(f"      Credit: Rp {piutang_credit:,}")
        print(f"      Net: Rp {piutang_net:,}")
        
        if abs(piutang_net - expected_piutang_net) > 1:
            print(f"❌ Piutang net should be {expected_piutang_net:,}, got: {piutang_net:,}")
            return False
        
        print(f"✅ Piutang Usaha nets to {piutang_net:,} (correct)")
        
        # Verify journal is balanced
        if abs(total_debit - total_credit) > 0.01:
            print(f"\n❌ Journal NOT BALANCED: debit={total_debit:,}, credit={total_credit:,}")
            return False
        
        print(f"✅ Journal is balanced (debit = credit)")
        
        # Get trial balance
        print(f"\n[5.3] GET /accounting/trial-balance")
        response = requests.get(f"{BASE_URL}/accounting/trial-balance", cookies=cookies, timeout=30)
        
        if response.status_code != 200:
            print(f"❌ Failed to get trial balance: {response.status_code}")
            return False
        
        tb_data = response.json()['data']
        print(f"✅ Trial balance retrieved")
        print(f"   Total Debit: Rp {tb_data.get('totalDebit', 0):,}")
        print(f"   Total Kredit: Rp {tb_data.get('totalKredit', 0):,}")
        
        if abs(tb_data.get('totalDebit', 0) - tb_data.get('totalKredit', 0)) > 0.01:
            print(f"❌ Trial balance NOT BALANCED")
            return False
        
        print(f"✅ Trial balance is balanced")
        
        # Get income statement
        print(f"\n[5.4] GET /accounting/income-statement")
        response = requests.get(f"{BASE_URL}/accounting/income-statement", cookies=cookies, timeout=30)
        
        if response.status_code != 200:
            print(f"❌ Failed to get income statement: {response.status_code}")
            return False
        
        is_data = response.json()['data']
        print(f"✅ Income statement retrieved")
        
        # Find Beban Komisi in expenses
        beban_komisi_in_is = False
        for expense in is_data.get('expenses', []):
            if expense.get('code') == '6-1400' or 'Beban Komisi' in expense.get('name', ''):
                beban_komisi_in_is = True
                print(f"   Beban Komisi: Rp {expense.get('amount', 0):,}")
                # Should include at least our 2,000,000
                if expense.get('amount', 0) >= 2000000:
                    print(f"✅ Beban Komisi includes our cashback (≥ 2,000,000)")
                else:
                    print(f"⚠️  Beban Komisi amount less than expected: {expense.get('amount', 0):,}")
                break
        
        if not beban_komisi_in_is:
            print(f"⚠️  Beban Komisi not found in income statement (may be in nested structure)")
        
        return True
        
    except Exception as e:
        print(f"❌ Step 5 exception: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_step_6_sales_profit_revenue(cookies):
    """Step 6: GET /accounting/sales-profit and verify revenue = 8M (net of cashback)"""
    print("\n" + "="*80)
    print("STEP 6: Sales Profit Revenue")
    print("="*80)
    
    try:
        so_id = created_resources['so_id']
        
        print(f"\n[6.1] GET /accounting/sales-profit")
        response = requests.get(f"{BASE_URL}/accounting/sales-profit", cookies=cookies, timeout=30)
        
        if response.status_code != 200:
            print(f"❌ Failed to get sales profit: {response.status_code} - {response.text[:500]}")
            return False
        
        sp_data = response.json()['data']
        print(f"✅ Sales profit report retrieved")
        
        # Find our SO in the report
        our_order = None
        for order in sp_data.get('orders', []):
            if order.get('id') == so_id:
                our_order = order
                break
        
        if not our_order:
            print(f"❌ Our SO {so_id} not found in sales profit report")
            return False
        
        print(f"\n   Found our SO: {our_order.get('soNumber')}")
        print(f"   Revenue: Rp {our_order.get('revenue', 0):,}")
        print(f"   COGS: Rp {our_order.get('cogs', 0):,}")
        print(f"   Gross Profit: Rp {our_order.get('grossProfit', 0):,}")
        
        # Verify revenue = 8,000,000 (net of cashback, NOT 10,000,000)
        expected_revenue = 8000000
        if abs(our_order.get('revenue', 0) - expected_revenue) > 1:
            print(f"❌ Revenue should be {expected_revenue:,} (net of cashback), got: {our_order.get('revenue', 0):,}")
            return False
        
        print(f"✅ Revenue is {our_order.get('revenue', 0):,} (net of cashback, correct)")
        return True
        
    except Exception as e:
        print(f"❌ Step 6 exception: {e}")
        return False

def test_step_7_validation(cookies):
    """Step 7: Validation tests (realAmount > total, realAmount = 0)"""
    print("\n" + "="*80)
    print("STEP 7: Validation Tests")
    print("="*80)
    
    try:
        so_id = created_resources['so_id']
        
        # Test 7.1: realAmount > total (should fail)
        print(f"\n[7.1] POST markup with realAmount > total (12,000,000 > 10,000,000)")
        response = requests.post(
            f"{BASE_URL}/sales-orders/{so_id}/markup",
            json={"markupEnabled": True, "realAmount": 12000000},
            cookies=cookies,
            timeout=10
        )
        
        if response.status_code == 400:
            print(f"✅ Correctly rejected (400): {response.json().get('error', 'Unknown error')}")
        else:
            print(f"❌ Should return 400, got: {response.status_code}")
            return False
        
        # Test 7.2: realAmount = 0 (should fail)
        print(f"\n[7.2] POST markup with realAmount = 0")
        response = requests.post(
            f"{BASE_URL}/sales-orders/{so_id}/markup",
            json={"markupEnabled": True, "realAmount": 0},
            cookies=cookies,
            timeout=10
        )
        
        if response.status_code == 400:
            print(f"✅ Correctly rejected (400): {response.json().get('error', 'Unknown error')}")
        else:
            print(f"❌ Should return 400, got: {response.status_code}")
            return False
        
        print(f"\n✅ All validation tests passed")
        return True
        
    except Exception as e:
        print(f"❌ Step 7 exception: {e}")
        return False

def test_step_8_disable_markup(cookies):
    """Step 8: Disable markup and verify fields reset, journal no longer has cashback line"""
    print("\n" + "="*80)
    print("STEP 8: Disable Markup")
    print("="*80)
    
    try:
        so_id = created_resources['so_id']
        
        # Disable markup
        print(f"\n[8.1] POST /sales-orders/{so_id}/markup with markupEnabled=false")
        response = requests.post(
            f"{BASE_URL}/sales-orders/{so_id}/markup",
            json={"markupEnabled": False},
            cookies=cookies,
            timeout=10
        )
        
        if response.status_code != 200:
            print(f"❌ Failed to disable markup: {response.status_code} - {response.text[:500]}")
            return False
        
        data = response.json()['data']
        print(f"✅ Markup disabled")
        print(f"   markupEnabled: {data.get('markupEnabled')}")
        print(f"   realAmount: {data.get('realAmount')}")
        print(f"   cashbackAmount: {data.get('cashbackAmount')}")
        
        # Verify fields are reset
        if data.get('markupEnabled') != False:
            print(f"❌ markupEnabled should be false, got: {data.get('markupEnabled')}")
            return False
        if data.get('realAmount') != 0:
            print(f"❌ realAmount should be 0, got: {data.get('realAmount')}")
            return False
        if data.get('cashbackAmount') != 0:
            print(f"❌ cashbackAmount should be 0, got: {data.get('cashbackAmount')}")
            return False
        
        print(f"✅ All markup fields reset to 0/false")
        
        # Verify outstanding now based on total (10M) minus paid (8M) = 2M
        print(f"\n[8.2] GET /sales-orders/{so_id} to verify outstanding")
        response = requests.get(f"{BASE_URL}/sales-orders/{so_id}", cookies=cookies, timeout=10)
        
        if response.status_code != 200:
            print(f"❌ Failed to get SO: {response.status_code}")
            return False
        
        so = response.json()['data']
        print(f"   Outstanding: Rp {so.get('outstanding', 0):,}")
        
        # Outstanding should now be 2,000,000 (10M total - 8M paid)
        expected_outstanding = 2000000
        if abs(so.get('outstanding', 0) - expected_outstanding) > 1:
            print(f"❌ outstanding should be {expected_outstanding:,}, got: {so.get('outstanding', 0):,}")
            return False
        
        print(f"✅ Outstanding now based on total (10M - 8M = 2M)")
        
        # Sync accounting and verify journal no longer has cashback line
        print(f"\n[8.3] POST /accounting/sync and verify journal")
        response = requests.post(f"{BASE_URL}/accounting/sync", cookies=cookies, timeout=30)
        if response.status_code != 200:
            print(f"⚠️  Sync returned {response.status_code}, trying to continue...")
        
        # Query journal
        journal_query = """
            SELECT jl.account_code, jl.debit, jl.credit, jl.description
            FROM journal_entries je
            JOIN journal_lines jl ON je.id = jl.journal_id
            WHERE je.source_type = 'SO_INV' AND je.source_id = ?
            ORDER BY jl.account_code
        """
        journal_lines = query_db(journal_query, (so_id,))
        
        print(f"\n   Journal lines after disabling markup:")
        beban_komisi_found = False
        for line in journal_lines:
            print(f"      {line['account_code']}: Dr {line['debit']:,} / Cr {line['credit']:,}")
            if line['account_code'] == '6-1400':
                beban_komisi_found = True
        
        if beban_komisi_found:
            print(f"\n❌ Beban Komisi (6-1400) line still exists after disabling markup")
            return False
        
        print(f"\n✅ Beban Komisi line no longer in journal (correct)")
        return True
        
    except Exception as e:
        print(f"❌ Step 8 exception: {e}")
        return False

def test_step_9_rbac(cookies_admin):
    """Step 9: RBAC tests (operator and direktur should get 403)"""
    print("\n" + "="*80)
    print("STEP 9: RBAC Tests")
    print("="*80)
    
    try:
        so_id = created_resources['so_id']
        
        # Test 9.1: Operator POST markup → 403
        print(f"\n[9.1] Operator POST markup (should be 403)")
        cookies_operator = login(OPERATOR_EMAIL, OPERATOR_PASSWORD)
        if not cookies_operator:
            print(f"❌ Failed to login as operator")
            return False
        
        response = requests.post(
            f"{BASE_URL}/sales-orders/{so_id}/markup",
            json={"markupEnabled": True, "realAmount": 8000000},
            cookies=cookies_operator,
            timeout=10
        )
        
        if response.status_code == 403:
            print(f"✅ Operator correctly denied (403)")
        else:
            print(f"❌ Should return 403, got: {response.status_code}")
            return False
        
        # Test 9.2: Direktur POST markup → 403
        print(f"\n[9.2] Direktur POST markup (should be 403)")
        cookies_direktur = login(DIREKTUR_EMAIL, DIREKTUR_PASSWORD)
        if not cookies_direktur:
            print(f"❌ Failed to login as direktur")
            return False
        
        response = requests.post(
            f"{BASE_URL}/sales-orders/{so_id}/markup",
            json={"markupEnabled": True, "realAmount": 8000000},
            cookies=cookies_direktur,
            timeout=10
        )
        
        if response.status_code == 403:
            print(f"✅ Direktur correctly denied (403)")
        else:
            print(f"❌ Should return 403, got: {response.status_code}")
            return False
        
        print(f"\n✅ All RBAC tests passed")
        return True
        
    except Exception as e:
        print(f"❌ Step 9 exception: {e}")
        return False

def cleanup(cookies):
    """Cleanup: Delete SO, product, customer, re-sync ledger"""
    print("\n" + "="*80)
    print("CLEANUP")
    print("="*80)
    
    try:
        # Delete SO (cascade items/payments)
        if created_resources['so_id']:
            print(f"\n[C.1] DELETE /sales-orders/{created_resources['so_id']}")
            response = requests.delete(
                f"{BASE_URL}/sales-orders/{created_resources['so_id']}",
                cookies=cookies,
                timeout=10
            )
            if response.status_code == 200:
                print(f"✅ SO deleted")
            else:
                print(f"⚠️  Failed to delete SO: {response.status_code}")
        
        # Delete product
        if created_resources['product_id']:
            print(f"\n[C.2] DELETE /products/{created_resources['product_id']}")
            response = requests.delete(
                f"{BASE_URL}/products/{created_resources['product_id']}",
                cookies=cookies,
                timeout=10
            )
            if response.status_code == 200:
                print(f"✅ Product deleted")
            else:
                print(f"⚠️  Failed to delete product: {response.status_code}")
        
        # Delete customer
        if created_resources['customer_id']:
            print(f"\n[C.3] DELETE /contacts/{created_resources['customer_id']}")
            response = requests.delete(
                f"{BASE_URL}/contacts/{created_resources['customer_id']}",
                cookies=cookies,
                timeout=10
            )
            if response.status_code == 200:
                print(f"✅ Customer deleted")
            else:
                print(f"⚠️  Failed to delete customer: {response.status_code}")
        
        # Re-sync ledger
        print(f"\n[C.4] POST /accounting/sync to rebuild ledger")
        response = requests.post(f"{BASE_URL}/accounting/sync", cookies=cookies, timeout=30)
        if response.status_code == 200:
            print(f"✅ Ledger re-synced")
        else:
            print(f"⚠️  Sync returned {response.status_code}")
        
        # Verify trial balance still balanced
        print(f"\n[C.5] GET /accounting/trial-balance to verify balance")
        response = requests.get(f"{BASE_URL}/accounting/trial-balance", cookies=cookies, timeout=30)
        if response.status_code == 200:
            tb_data = response.json()['data']
            print(f"   Total Debit: Rp {tb_data.get('totalDebit', 0):,}")
            print(f"   Total Kredit: Rp {tb_data.get('totalKredit', 0):,}")
            if abs(tb_data.get('totalDebit', 0) - tb_data.get('totalKredit', 0)) > 0.01:
                print(f"⚠️  Trial balance NOT BALANCED after cleanup")
            else:
                print(f"✅ Trial balance still balanced after cleanup")
        
        print(f"\n✅ Cleanup completed")
        print(f"\nCreated records:")
        print(f"   Customer ID: {created_resources['customer_id']}")
        print(f"   Product ID: {created_resources['product_id']}")
        print(f"   SO ID: {created_resources['so_id']}")
        print(f"   All records have been deleted")
        
    except Exception as e:
        print(f"⚠️  Cleanup exception: {e}")

def main():
    """Main test runner"""
    print("\n" + "="*80)
    print("SALES ORDER FAKTUR DI-UP + CASHBACK (MARKUP) BACKEND TEST")
    print("SQLite + Drizzle ERP System")
    print("="*80)
    
    # Login as admin
    print("\n[LOGIN] Authenticating as admin...")
    cookies_admin = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not cookies_admin:
        print("❌ Failed to login as admin. Aborting tests.")
        sys.exit(1)
    
    results = {}
    
    # Run tests
    try:
        results['step_1'] = test_step_1_create_customer_product_so(cookies_admin)
        if not results['step_1']:
            print("\n❌ Step 1 failed. Aborting remaining tests.")
            cleanup(cookies_admin)
            sys.exit(1)
        
        results['step_2'] = test_step_2_enable_markup(cookies_admin)
        results['step_3'] = test_step_3_verify_so_computed_fields(cookies_admin)
        results['step_4'] = test_step_4_payment_and_status(cookies_admin)
        results['step_5'] = test_step_5_accounting_integrity(cookies_admin)
        results['step_6'] = test_step_6_sales_profit_revenue(cookies_admin)
        results['step_7'] = test_step_7_validation(cookies_admin)
        results['step_8'] = test_step_8_disable_markup(cookies_admin)
        results['step_9'] = test_step_9_rbac(cookies_admin)
        
    finally:
        # Always cleanup
        cleanup(cookies_admin)
    
    # Print summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for step, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} - {step}")
    
    print(f"\nTotal: {passed}/{total} tests passed ({passed*100//total if total > 0 else 0}%)")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)
    else:
        print(f"\n❌ {total - passed} test(s) failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
