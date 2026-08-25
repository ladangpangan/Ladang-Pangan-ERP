#!/usr/bin/env python3
"""
Backend API Testing for Agen & Dropshipper Contacts + Commission + End-Customers
Test ONLY the NEW feature as requested in review_request.
"""

import requests
import json
from datetime import datetime, timedelta

# Base URL from .env
BASE_URL = "https://github-to-production.preview.emergentagent.com/api"

# Test credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
OPERATOR_EMAIL = "operator@lpi.co.id"
OPERATOR_PASSWORD = "admin123"
DIREKTUR_EMAIL = "direktur@lpi.co.id"
DIREKTUR_PASSWORD = "admin123"

# Use session to persist cookies
session = requests.Session()

def login(email, password):
    """Login and return session with cookies"""
    s = requests.Session()
    resp = s.post(f"{BASE_URL}/auth/sign-in/email", json={"email": email, "password": password})
    if resp.status_code != 200:
        print(f"❌ Login failed for {email}: {resp.status_code} {resp.text}")
        return None
    print(f"✅ Logged in as {email}")
    return s

def test_a_contact_types():
    """Test A: Contact types Agen & Dropshipper"""
    print("\n" + "="*80)
    print("TEST A: Contact types Agen & Dropshipper")
    print("="*80)
    
    s = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not s:
        return None, None
    
    # A1: Create Dropshipper contact
    print("\n[A1] POST /api/contacts contactType='Dropshipper'")
    dropshipper_data = {
        "code": f"DS-{datetime.now().strftime('%H%M%S')}",
        "displayName": "Dropshipper Test",
        "contactType": "Dropshipper",
        "commissionType": "per_kg",
        "commissionValue": 150
    }
    resp = s.post(f"{BASE_URL}/contacts", json=dropshipper_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 201:
        result = resp.json().get("data", resp.json())
        ds = result.get('data', result)  # Handle both wrapped and unwrapped responses
        print(f"✅ Dropshipper created: {ds.get('id')} - {ds.get('displayName')}")
        print(f"   commissionType: {ds.get('commissionType')}, commissionValue: {ds.get('commissionValue')}")
        dropshipper_id = ds.get('id')
    else:
        print(f"❌ Failed: {resp.text}")
        return None, None
    
    # A2: Create Agen contact
    print("\n[A2] POST /api/contacts contactType='Agen'")
    agen_data = {
        "code": f"AG-{datetime.now().strftime('%H%M%S')}",
        "displayName": "Agen Test",
        "contactType": "Agen",
        "agentDiscountPct": 5
    }
    resp = s.post(f"{BASE_URL}/contacts", json=agen_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 201:
        result = resp.json().get("data", resp.json())
        ag = result.get('data', result)
        print(f"✅ Agen created: {ag.get('id')} - {ag.get('displayName')}")
        print(f"   agentDiscountPct: {ag.get('agentDiscountPct')}")
        agen_id = ag.get('id')
    else:
        print(f"❌ Failed: {resp.text}")
        return dropshipper_id, None
    
    # A3: Filter by type
    print("\n[A3] GET /api/contacts?type=Dropshipper")
    resp = s.get(f"{BASE_URL}/contacts?type=Dropshipper")
    print(f"Status: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json().get("data", resp.json())
        ds_list = [c for c in data.get('data', []) if c.get('contactType') == 'Dropshipper']
        print(f"✅ Found {len(ds_list)} Dropshipper contacts")
    else:
        print(f"❌ Failed: {resp.text}")
    
    print("\n[A3] GET /api/contacts?type=Agen")
    resp = s.get(f"{BASE_URL}/contacts?type=Agen")
    print(f"Status: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json().get("data", resp.json())
        ag_list = [c for c in data.get('data', []) if c.get('contactType') == 'Agen']
        print(f"✅ Found {len(ag_list)} Agen contacts")
    else:
        print(f"❌ Failed: {resp.text}")
    
    return dropshipper_id, agen_id

def test_b_end_customers(dropshipper_id):
    """Test B: End-Customers (contact_customers)"""
    print("\n" + "="*80)
    print("TEST B: End-Customers (contact_customers)")
    print("="*80)
    
    if not dropshipper_id:
        print("⚠️  Skipping: No dropshipper_id")
        return None
    
    s = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not s:
        return None
    
    # B1: Create end-customer
    print(f"\n[B1] POST /api/contacts/{dropshipper_id}/customers")
    customer_data = {
        "name": "End Customer Test",
        "phone": "081234567890",
        "address": "Jl. Test No. 123",
        "city": "Jakarta"
    }
    resp = s.post(f"{BASE_URL}/contacts/{dropshipper_id}/customers", json=customer_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 201:
        cust = resp.json().get("data", resp.json())
        print(f"✅ End-customer created: {cust.get('id')} - {cust.get('name')}")
        customer_id = cust.get('id')
    else:
        print(f"❌ Failed: {resp.text}")
        return None
    
    # B2: List end-customers
    print(f"\n[B2] GET /api/contacts/{dropshipper_id}/customers")
    resp = s.get(f"{BASE_URL}/contacts/{dropshipper_id}/customers")
    print(f"Status: {resp.status_code}")
    if resp.status_code == 200:
        customers = resp.json().get("data", resp.json())
        print(f"✅ Found {len(customers)} end-customers")
        for c in customers:
            print(f"   - {c.get('name')} ({c.get('phone')})")
    else:
        print(f"❌ Failed: {resp.text}")
    
    # B3: Update end-customer
    print(f"\n[B3] PATCH /api/contacts/{dropshipper_id}/customers/{customer_id}")
    update_data = {"name": "End Customer Updated"}
    resp = s.patch(f"{BASE_URL}/contacts/{dropshipper_id}/customers/{customer_id}", json=update_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 200:
        updated = resp.json().get("data", resp.json())
        print(f"✅ End-customer updated: {updated.get('name')}")
    else:
        print(f"❌ Failed: {resp.text}")
    
    # B4: Delete end-customer (will test later, keep for now)
    # We'll delete after testing ship-to
    
    # B5: RBAC - operator POST should fail
    print(f"\n[B5] RBAC: operator POST /api/contacts/{dropshipper_id}/customers → 403")
    s_op = login(OPERATOR_EMAIL, OPERATOR_PASSWORD)
    if s_op:
        resp = s_op.post(f"{BASE_URL}/contacts/{dropshipper_id}/customers", json=customer_data)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 403:
            print(f"✅ Operator correctly denied (403)")
        else:
            print(f"❌ Expected 403, got {resp.status_code}")
    
    # B5: RBAC - direktur GET should work, POST should fail
    print(f"\n[B5] RBAC: direktur GET /api/contacts/{dropshipper_id}/customers → 200")
    s_dir = login(DIREKTUR_EMAIL, DIREKTUR_PASSWORD)
    if s_dir:
        resp = s_dir.get(f"{BASE_URL}/contacts/{dropshipper_id}/customers")
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            print(f"✅ Direktur can view (200)")
        else:
            print(f"❌ Expected 200, got {resp.status_code}")
        
        print(f"\n[B5] RBAC: direktur POST /api/contacts/{dropshipper_id}/customers → 403")
        resp = s_dir.post(f"{BASE_URL}/contacts/{dropshipper_id}/customers", json=customer_data)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 403:
            print(f"✅ Direktur correctly denied (403)")
        else:
            print(f"❌ Expected 403, got {resp.status_code}")
    
    return customer_id

def test_c_commission_flow(dropshipper_id):
    """Test C: Commission flow"""
    print("\n" + "="*80)
    print("TEST C: Commission flow")
    print("="*80)
    
    if not dropshipper_id:
        print("⚠️  Skipping: No dropshipper_id")
        return None, None
    
    s = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not s:
        return None, None
    
    # Setup: Create Customer contact
    print("\n[Setup] Creating Customer contact")
    customer_data = {
        "code": f"CUST-{datetime.now().strftime('%H%M%S')}",
        "displayName": "Customer for Commission Test",
        "contactType": "Customer"
    }
    resp = s.post(f"{BASE_URL}/contacts", json=customer_data)
    if resp.status_code != 201:
        print(f"❌ Failed to create customer: {resp.text}")
        return None, None
    customer = resp.json().get("data", resp.json())
    customer_id = customer.get('id')
    print(f"✅ Customer created: {customer_id}")
    
    # Setup: Create Product
    print("\n[Setup] Creating Product")
    product_data = {
        "sku": f"PROD-{datetime.now().strftime('%H%M%S')}",
        "name": "Product for Commission Test",
        "unit": "kg",
        "basePrice": 40000
    }
    resp = s.post(f"{BASE_URL}/products", json=product_data)
    if resp.status_code != 201:
        print(f"❌ Failed to create product: {resp.text}")
        return None, None
    product = resp.json().get("data", resp.json())
    product_id = product.get('id')
    print(f"✅ Product created: {product_id} - {product.get('name')}")
    
    # C1: Create SO with dropshipperId
    print(f"\n[C1] POST /api/sales-orders with dropshipperId={dropshipper_id}")
    so_data = {
        "customerId": customer_id,
        "dropshipperId": dropshipper_id,
        "orderDate": datetime.now().strftime("%Y-%m-%d"),
        "items": [{
            "productId": product_id,
            "quantity": 100,
            "weight": 100,
            "unitPrice": 40000
        }]
    }
    resp = s.post(f"{BASE_URL}/sales-orders", json=so_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 201:
        so = resp.json().get("data", resp.json())
        so_id = so.get('id')
        print(f"✅ SO created: {so.get('soNumber')}")
        if 'commission' in so:
            print(f"   Commission object: {so.get('commission')}")
            print(f"   Commission amount: {so['commission'].get('amount')}")
        else:
            print(f"⚠️  No commission object in response")
    else:
        print(f"❌ Failed: {resp.text}")
        return None, None
    
    # Verify commission record created
    print(f"\n[C1] GET /api/contacts/{dropshipper_id}/commissions")
    resp = s.get(f"{BASE_URL}/contacts/{dropshipper_id}/commissions")
    print(f"Status: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json().get("data", resp.json())
        records = data.get('records', [])
        summary = data.get('summary', {})
        print(f"✅ Commission records: {len(records)}")
        if records:
            rec = records[0]
            print(f"   - SO: {rec.get('salesOrderNumber')}, Amount: {rec.get('commissionAmount')}, Status: {rec.get('status')}")
            print(f"   - Expected: 150 * 100 = 15000")
            if rec.get('commissionAmount') == 15000:
                print(f"   ✅ Commission amount correct (per_kg: 150 * 100kg = 15000)")
            else:
                print(f"   ⚠️  Commission amount mismatch: expected 15000, got {rec.get('commissionAmount')}")
        print(f"   Summary: unpaidAmount={summary.get('unpaidAmount')}, totalCommission={summary.get('totalCommission')}")
    else:
        print(f"❌ Failed: {resp.text}")
    
    # C2: Preview commission with different types
    print(f"\n[C2] POST /api/commissions/preview (percent_profit)")
    preview_data = {
        "salesOrderId": so_id,
        "commissionType": "percent_profit",
        "commissionValue": 5
    }
    resp = s.post(f"{BASE_URL}/commissions/preview", json=preview_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 200:
        preview = resp.json().get("data", resp.json())
        print(f"✅ Preview: revenue={preview.get('revenue')}, cost={preview.get('cost')}, profit={preview.get('profit')}, amount={preview.get('amount')}")
    else:
        print(f"❌ Failed: {resp.text}")
    
    print(f"\n[C2] POST /api/commissions/preview (fixed)")
    preview_data = {
        "salesOrderId": so_id,
        "commissionType": "fixed",
        "commissionValue": 50000
    }
    resp = s.post(f"{BASE_URL}/commissions/preview", json=preview_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 200:
        preview = resp.json().get("data", resp.json())
        print(f"✅ Preview (fixed): amount={preview.get('amount')} (should be 50000)")
        if preview.get('amount') == 50000:
            print(f"   ✅ Fixed commission correct")
    else:
        print(f"❌ Failed: {resp.text}")
    
    print(f"\n[C2] POST /api/commissions/preview (per_kg)")
    preview_data = {
        "salesOrderId": so_id,
        "commissionType": "per_kg",
        "commissionValue": 200
    }
    resp = s.post(f"{BASE_URL}/commissions/preview", json=preview_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 200:
        preview = resp.json().get("data", resp.json())
        print(f"✅ Preview (per_kg): amount={preview.get('amount')} (should be 200*100=20000)")
        if preview.get('amount') == 20000:
            print(f"   ✅ Per_kg commission correct")
    else:
        print(f"❌ Failed: {resp.text}")
    
    # C3: Manual commission creation (duplicate should fail)
    print(f"\n[C3] POST /api/contacts/{dropshipper_id}/commissions (duplicate SO)")
    manual_comm = {"salesOrderId": so_id}
    resp = s.post(f"{BASE_URL}/contacts/{dropshipper_id}/commissions", json=manual_comm)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 400:
        print(f"✅ Duplicate SO correctly rejected (400)")
        print(f"   Message: {resp.text}")
    else:
        print(f"❌ Expected 400, got {resp.status_code}")
    
    # C4: Create another SO with percent_profit commission
    print(f"\n[C4] Create SO with percent_profit commission")
    so_data2 = {
        "customerId": customer_id,
        "orderDate": datetime.now().strftime("%Y-%m-%d"),
        "items": [{
            "productId": product_id,
            "quantity": 50,
            "weight": 50,
            "unitPrice": 40000
        }]
    }
    resp = s.post(f"{BASE_URL}/sales-orders", json=so_data2)
    if resp.status_code != 201:
        print(f"❌ Failed to create SO2: {resp.text}")
        return so_id, None
    so2 = resp.json().get("data", resp.json())
    so2_id = so2.get('id')
    print(f"✅ SO2 created: {so2.get('soNumber')}")
    
    print(f"\n[C4] POST /api/contacts/{dropshipper_id}/commissions (percent_profit with costAmount)")
    manual_comm2 = {
        "salesOrderId": so2_id,
        "commissionType": "percent_profit",
        "commissionValue": 10,
        "costAmount": 1000000
    }
    resp = s.post(f"{BASE_URL}/contacts/{dropshipper_id}/commissions", json=manual_comm2)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 201:
        comm = resp.json().get("data", resp.json())
        print(f"✅ Commission created: {comm.get('id')}")
        print(f"   Amount: {comm.get('commissionAmount')}")
        # Revenue = 50 * 40000 = 2,000,000
        # Cost = 1,000,000
        # Profit = 1,000,000
        # Commission = 10% * 1,000,000 = 100,000
        expected = 100000
        if comm.get('commissionAmount') == expected:
            print(f"   ✅ Commission amount correct (10% * (2000000-1000000) = {expected})")
        else:
            print(f"   ⚠️  Expected {expected}, got {comm.get('commissionAmount')}")
        commission_record_id = comm.get('id')
    else:
        print(f"❌ Failed: {resp.text}")
        commission_record_id = None
    
    # C5: Pay single commission
    if commission_record_id:
        print(f"\n[C5] POST /api/contacts/{dropshipper_id}/commission-payments (single record)")
        payment_data = {"commissionRecordId": commission_record_id}
        resp = s.post(f"{BASE_URL}/contacts/{dropshipper_id}/commission-payments", json=payment_data)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 201:
            payment = resp.json().get("data", resp.json())
            print(f"✅ Payment created: {payment.get('id')}")
            print(f"   Amount: {payment.get('amount')}")
            
            # Verify record status changed to paid
            resp = s.get(f"{BASE_URL}/contacts/{dropshipper_id}/commissions")
            if resp.status_code == 200:
                data = resp.json().get("data", resp.json())
                records = data.get('records', [])
                paid_rec = [r for r in records if r.get('id') == commission_record_id]
                if paid_rec and paid_rec[0].get('status') == 'paid':
                    print(f"   ✅ Commission record status changed to 'paid'")
                summary = data.get('summary', {})
                print(f"   Summary after payment: outstanding={summary.get('outstanding')}")
        else:
            print(f"❌ Failed: {resp.text}")
    
    # C6: Pay all remaining unpaid
    print(f"\n[C6] POST /api/contacts/{dropshipper_id}/commission-payments (pay all)")
    payment_data = {}  # No commissionRecordId = pay all
    resp = s.post(f"{BASE_URL}/contacts/{dropshipper_id}/commission-payments", json=payment_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 201:
        payment = resp.json().get("data", resp.json())
        print(f"✅ Payment created: {payment.get('id')}")
        print(f"   Amount: {payment.get('amount')}")
        
        # Verify all paid
        resp = s.get(f"{BASE_URL}/contacts/{dropshipper_id}/commissions")
        if resp.status_code == 200:
            data = resp.json().get("data", resp.json())
            summary = data.get('summary', {})
            print(f"   Summary after pay all: outstanding={summary.get('outstanding')}, unpaidAmount={summary.get('unpaidAmount')}")
            if summary.get('outstanding') == 0 and summary.get('unpaidAmount') == 0:
                print(f"   ✅ All commissions paid (outstanding=0, unpaidAmount=0)")
    else:
        print(f"❌ Failed: {resp.text}")
    
    # C7: Delete commission record
    # Get a paid record
    resp = s.get(f"{BASE_URL}/contacts/{dropshipper_id}/commissions")
    if resp.status_code == 200:
        data = resp.json().get("data", resp.json())
        records = data.get('records', [])
        paid_records = [r for r in records if r.get('status') == 'paid']
        unpaid_records = [r for r in records if r.get('status') == 'unpaid']
        
        if paid_records:
            paid_id = paid_records[0].get('id')
            print(f"\n[C7] DELETE /api/contacts/{dropshipper_id}/commissions/{paid_id} (PAID record)")
            resp = s.delete(f"{BASE_URL}/contacts/{dropshipper_id}/commissions/{paid_id}")
            print(f"Status: {resp.status_code}")
            if resp.status_code == 400:
                print(f"✅ Cannot delete paid record (400)")
            else:
                print(f"❌ Expected 400, got {resp.status_code}")
        
        # Create a new unpaid commission to test delete
        print(f"\n[C7] Creating new SO for unpaid commission delete test")
        so_data3 = {
            "customerId": customer_id,
            "orderDate": datetime.now().strftime("%Y-%m-%d"),
            "items": [{
                "productId": product_id,
                "quantity": 10,
                "weight": 10,
                "unitPrice": 40000
            }]
        }
        resp = s.post(f"{BASE_URL}/sales-orders", json=so_data3)
        if resp.status_code == 201:
            so3 = resp.json().get("data", resp.json())
            so3_id = so3.get('id')
            
            # Create manual commission
            manual_comm3 = {"salesOrderId": so3_id}
            resp = s.post(f"{BASE_URL}/contacts/{dropshipper_id}/commissions", json=manual_comm3)
            if resp.status_code == 201:
                comm3 = resp.json().get("data", resp.json())
                unpaid_id = comm3.get('id')
                
                print(f"\n[C7] DELETE /api/contacts/{dropshipper_id}/commissions/{unpaid_id} (UNPAID record)")
                resp = s.delete(f"{BASE_URL}/contacts/{dropshipper_id}/commissions/{unpaid_id}")
                print(f"Status: {resp.status_code}")
                if resp.status_code == 200:
                    print(f"✅ Unpaid record deleted successfully (200)")
                else:
                    print(f"❌ Expected 200, got {resp.status_code}")
    
    # C8: RBAC tests
    print(f"\n[C8] RBAC: operator POST commission → 403")
    s_op = login(OPERATOR_EMAIL, OPERATOR_PASSWORD)
    if s_op:
        resp = s_op.post(f"{BASE_URL}/contacts/{dropshipper_id}/commissions", json={"salesOrderId": so_id})
        print(f"Status: {resp.status_code}")
        if resp.status_code == 403:
            print(f"✅ Operator correctly denied (403)")
        else:
            print(f"❌ Expected 403, got {resp.status_code}")
    
    print(f"\n[C8] RBAC: operator POST payment → 403")
    if s_op:
        resp = s_op.post(f"{BASE_URL}/contacts/{dropshipper_id}/commission-payments", json={})
        print(f"Status: {resp.status_code}")
        if resp.status_code == 403:
            print(f"✅ Operator correctly denied (403)")
        else:
            print(f"❌ Expected 403, got {resp.status_code}")
    
    print(f"\n[C8] RBAC: direktur GET commissions → 200")
    s_dir = login(DIREKTUR_EMAIL, DIREKTUR_PASSWORD)
    if s_dir:
        resp = s_dir.get(f"{BASE_URL}/contacts/{dropshipper_id}/commissions")
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            print(f"✅ Direktur can view (200)")
        else:
            print(f"❌ Expected 200, got {resp.status_code}")
    
    print(f"\n[C8] RBAC: direktur POST commission → 403")
    if s_dir:
        resp = s_dir.post(f"{BASE_URL}/contacts/{dropshipper_id}/commissions", json={"salesOrderId": so_id})
        print(f"Status: {resp.status_code}")
        if resp.status_code == 403:
            print(f"✅ Direktur correctly denied (403)")
        else:
            print(f"❌ Expected 403, got {resp.status_code}")
    
    return so_id, product_id

def test_d_surat_jalan_ship_to(customer_id, dropshipper_id):
    """Test D: Surat Jalan ship-to"""
    print("\n" + "="*80)
    print("TEST D: Surat Jalan ship-to")
    print("="*80)
    
    if not customer_id or not dropshipper_id:
        print("⚠️  Skipping: No customer_id or dropshipper_id")
        return
    
    s = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not s:
        return
    
    # Setup: Create customer contact and product
    print("\n[Setup] Creating customer and product for SO")
    cust_data = {
        "code": f"CUST-SJ-{datetime.now().strftime('%H%M%S')}",
        "displayName": "Customer for SJ Test",
        "contactType": "Customer"
    }
    resp = s.post(f"{BASE_URL}/contacts", json=cust_data)
    if resp.status_code != 201:
        print(f"❌ Failed to create customer: {resp.text}")
        return
    cust = resp.json().get("data", resp.json())
    cust_id = cust.get('id')
    
    prod_data = {
        "sku": f"PROD-SJ-{datetime.now().strftime('%H%M%S')}",
        "name": "Product for SJ Test",
        "unit": "kg",
        "basePrice": 50000
    }
    resp = s.post(f"{BASE_URL}/products", json=prod_data)
    if resp.status_code != 201:
        print(f"❌ Failed to create product: {resp.text}")
        return
    prod = resp.json().get("data", resp.json())
    prod_id = prod.get('id')
    
    # D1: Create SO and advance to Packed
    print("\n[D1] Creating SO and advancing to Packed")
    so_data = {
        "customerId": cust_id,
        "orderDate": datetime.now().strftime("%Y-%m-%d"),
        "items": [{
            "productId": prod_id,
            "quantity": 20,
            "weight": 20,
            "unitPrice": 50000
        }]
    }
    resp = s.post(f"{BASE_URL}/sales-orders", json=so_data)
    if resp.status_code != 201:
        print(f"❌ Failed to create SO: {resp.text}")
        return
    so = resp.json().get("data", resp.json())
    so_id = so.get('id')
    print(f"✅ SO created: {so.get('soNumber')}")
    
    # Advance: Draft → Confirmed → Packed
    for status in ['Confirmed', 'Packed']:
        resp = s.post(f"{BASE_URL}/sales-orders/{so_id}/status", json={"status": status})
        if resp.status_code == 200:
            print(f"✅ SO advanced to {status}")
        else:
            print(f"❌ Failed to advance to {status}: {resp.text}")
            return
    
    # D2: Create surat jalan with shipToCustomerId
    print(f"\n[D2] POST /api/sales-orders/{so_id}/surat-jalan with shipToCustomerId={customer_id}")
    sj_data = {
        "shipToCustomerId": customer_id,
        "deliveryDate": datetime.now().strftime("%Y-%m-%d"),
        "driverName": "Driver Test",
        "vehicleNumber": "B 1234 XY"
    }
    resp = s.post(f"{BASE_URL}/sales-orders/{so_id}/surat-jalan", json=sj_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 201:
        sj = resp.json().get("data", resp.json())
        print(f"✅ Surat Jalan created: {sj.get('sjNumber')}")
        
        # Verify ship-to fields
        if 'shipToName' in sj:
            print(f"   shipToName: {sj.get('shipToName')}")
            print(f"   shipToPhone: {sj.get('shipToPhone')}")
            print(f"   shipToAddress: {sj.get('shipToAddress')}")
            print(f"   ✅ Ship-to snapshot fields present")
        else:
            print(f"   ⚠️  Ship-to fields not in response")
        
        # Get SO detail to verify
        resp = s.get(f"{BASE_URL}/sales-orders/{so_id}")
        if resp.status_code == 200:
            so_detail = resp.json().get("data", resp.json())
            surat_jalan = so_detail.get('suratJalan', [])
            if surat_jalan:
                sj_detail = surat_jalan[0]
                print(f"\n   SO detail suratJalan[0]:")
                print(f"   - shipToName: {sj_detail.get('shipToName')}")
                print(f"   - shipToPhone: {sj_detail.get('shipToPhone')}")
                print(f"   - shipToAddress: {sj_detail.get('shipToAddress')}")
                if sj_detail.get('shipToName'):
                    print(f"   ✅ Ship-to snapshot in SO detail")
    else:
        print(f"❌ Failed: {resp.text}")
    
    # D3: Create another SO with manual ship-to
    print("\n[D3] Creating SO with manual ship-to")
    so_data2 = {
        "customerId": cust_id,
        "orderDate": datetime.now().strftime("%Y-%m-%d"),
        "items": [{
            "productId": prod_id,
            "quantity": 10,
            "weight": 10,
            "unitPrice": 50000
        }]
    }
    resp = s.post(f"{BASE_URL}/sales-orders", json=so_data2)
    if resp.status_code != 201:
        print(f"❌ Failed to create SO2: {resp.text}")
        return
    so2 = resp.json().get("data", resp.json())
    so2_id = so2.get('id')
    print(f"✅ SO2 created: {so2.get('soNumber')}")
    
    # Advance to Packed
    for status in ['Confirmed', 'Packed']:
        resp = s.post(f"{BASE_URL}/sales-orders/{so2_id}/status", json={"status": status})
    
    print(f"\n[D3] POST /api/sales-orders/{so2_id}/surat-jalan with manual ship-to")
    sj_data2 = {
        "shipToName": "Manual Customer X",
        "shipToAddress": "Jl. Manual No. 456",
        "deliveryDate": datetime.now().strftime("%Y-%m-%d"),
        "driverName": "Driver Test 2",
        "vehicleNumber": "B 5678 ZZ"
    }
    resp = s.post(f"{BASE_URL}/sales-orders/{so2_id}/surat-jalan", json=sj_data2)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 201:
        sj2 = resp.json().get("data", resp.json())
        print(f"✅ Surat Jalan created: {sj2.get('sjNumber')}")
        print(f"   shipToName: {sj2.get('shipToName')}")
        print(f"   shipToAddress: {sj2.get('shipToAddress')}")
        if sj2.get('shipToName') == "Manual Customer X":
            print(f"   ✅ Manual ship-to stored correctly")
    else:
        print(f"❌ Failed: {resp.text}")

def test_e_inventory_hpp_per_kg():
    """Test E: inventory_stock.hpp_per_kg"""
    print("\n" + "="*80)
    print("TEST E: inventory_stock.hpp_per_kg")
    print("="*80)
    
    s = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not s:
        return
    
    # Create cold storage first
    print("\n[Setup] Creating cold storage")
    cs_data = {
        "code": f"CS-{datetime.now().strftime('%H%M%S')}",
        "name": "Cold Storage Test",
        "capacityKg": 10000
    }
    resp = s.post(f"{BASE_URL}/cold-storages", json=cs_data)
    if resp.status_code != 201:
        print(f"❌ Failed to create cold storage: {resp.text}")
        return
    cs = resp.json().get("data", resp.json())
    cs_id = cs.get('id')
    print(f"✅ Cold storage created: {cs_id}")
    
    # Create product
    print("\n[Setup] Creating product")
    prod_data = {
        "sku": f"PROD-HPP-{datetime.now().strftime('%H%M%S')}",
        "name": "Product for HPP Test",
        "unit": "kg",
        "basePrice": 30000
    }
    resp = s.post(f"{BASE_URL}/products", json=prod_data)
    if resp.status_code != 201:
        print(f"❌ Failed to create product: {resp.text}")
        return
    prod = resp.json().get("data", resp.json())
    prod_id = prod.get('id')
    print(f"✅ Product created: {prod_id}")
    
    # E: POST inbound with MANUAL reference
    print(f"\n[E] POST /api/inventory/inbound with referenceType='MANUAL'")
    inbound_data = {
        "coldStorageId": cs_id,
        "referenceType": "MANUAL",
        "items": [{
            "productId": prod_id,
            "weight": 50,
            "quantity": 1,
            "packagingType": "karung"
        }]
    }
    resp = s.post(f"{BASE_URL}/inventory/inbound", json=inbound_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 201:
        result = resp.json().get("data", resp.json())
        print(f"✅ Inbound created successfully")
        print(f"   Transaction ID: {result.get('transactionId')}")
        
        # Verify stock created with hpp_per_kg field
        resp = s.get(f"{BASE_URL}/inventory/stocks")
        if resp.status_code == 200:
            stocks_data = resp.json().get("data", resp.json())
            stocks = stocks_data.get('data', [])
            if stocks:
                stock = stocks[0]
                print(f"\n   Stock created:")
                print(f"   - kodeSimpan: {stock.get('kodeSimpan')}")
                print(f"   - weight: {stock.get('weight')}")
                if 'hppPerKg' in stock:
                    print(f"   - hppPerKg: {stock.get('hppPerKg')}")
                    print(f"   ✅ hpp_per_kg field present (value may be 0)")
                else:
                    print(f"   ⚠️  hpp_per_kg field not in response")
    else:
        print(f"❌ Failed: {resp.text}")

def main():
    print("\n" + "="*80)
    print("BACKEND API TESTING: Agen & Dropshipper + Commission + End-Customers")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Test started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Test A: Contact types
    dropshipper_id, agen_id = test_a_contact_types()
    
    # Test B: End-customers
    customer_id = test_b_end_customers(dropshipper_id)
    
    # Test C: Commission flow
    so_id, product_id = test_c_commission_flow(dropshipper_id)
    
    # Test D: Surat Jalan ship-to
    test_d_surat_jalan_ship_to(customer_id, dropshipper_id)
    
    # Test E: inventory hpp_per_kg
    test_e_inventory_hpp_per_kg()
    
    print("\n" + "="*80)
    print("TESTING COMPLETE")
    print("="*80)
    print(f"Test completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == "__main__":
    main()
