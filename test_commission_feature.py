#!/usr/bin/env python3
"""
Backend API Testing for Agen & Dropshipper Contacts + Commission + End-Customers
Focused test for NEW feature only.
"""

import requests
import json
from datetime import datetime

BASE_URL = "https://cashbook-quick-entry.preview.emergentagent.com/api"

def login(email, password):
    """Login and return session"""
    s = requests.Session()
    resp = s.post(f"{BASE_URL}/auth/sign-in/email", json={"email": email, "password": password})
    if resp.status_code != 200:
        print(f"❌ Login failed: {resp.status_code}")
        return None
    print(f"✅ Logged in as {email}")
    return s

def extract_data(resp):
    """Extract data from response, handling both wrapped and unwrapped"""
    try:
        j = resp.json()
        return j.get('data', j)
    except Exception:
        return {}

print("\n" + "="*80)
print("COMMISSION & END-CUSTOMERS FEATURE TEST")
print("="*80)

# Login as admin
admin = login("admin@lpi.co.id", "admin123")
if not admin:
    exit(1)

# ============================================================================
# TEST A: Contact Types (Agen & Dropshipper)
# ============================================================================
print("\n[TEST A] Contact Types - Agen & Dropshipper")
print("-" * 80)

# A1: Create Dropshipper
print("\n[A.1] POST /api/contacts (Dropshipper with commission)")
ds_data = {
    "code": f"DS-{datetime.now().strftime('%H%M%S')}",
    "displayName": "Test Dropshipper",
    "contactType": "Dropshipper",
    "commissionType": "per_kg",
    "commissionValue": 150
}
resp = admin.post(f"{BASE_URL}/contacts", json=ds_data)
print(f"Status: {resp.status_code}")
if resp.status_code == 201:
    ds = extract_data(resp)
    ds_id = ds.get('id')
    print(f"✅ Dropshipper created: {ds_id}")
    print(f"   commissionType={ds.get('commissionType')}, commissionValue={ds.get('commissionValue')}")
    assert ds.get('commissionType') == 'per_kg', "Commission type mismatch"
    assert ds.get('commissionValue') == 150, "Commission value mismatch"
else:
    print(f"❌ FAIL: {resp.text}")
    exit(1)

# A2: Create Agen
print("\n[A.2] POST /api/contacts (Agen with discount)")
ag_data = {
    "code": f"AG-{datetime.now().strftime('%H%M%S')}",
    "displayName": "Test Agen",
    "contactType": "Agen",
    "agentDiscountPct": 5
}
resp = admin.post(f"{BASE_URL}/contacts", json=ag_data)
print(f"Status: {resp.status_code}")
if resp.status_code == 201:
    ag = extract_data(resp)
    ag_id = ag.get('id')
    print(f"✅ Agen created: {ag_id}")
    print(f"   agentDiscountPct={ag.get('agentDiscountPct')}")
    assert ag.get('agentDiscountPct') == 5, "Agent discount mismatch"
else:
    print(f"❌ FAIL: {resp.text}")
    exit(1)

# A3: Filter by type
print("\n[A.3] GET /api/contacts?type=Dropshipper")
resp = admin.get(f"{BASE_URL}/contacts?type=Dropshipper")
if resp.status_code == 200:
    data = extract_data(resp)
    contacts = data.get('data', data) if isinstance(data, dict) else data
    ds_list = [c for c in contacts if c.get('contactType') == 'Dropshipper']
    print(f"✅ Found {len(ds_list)} Dropshipper(s)")
else:
    print(f"❌ FAIL: {resp.status_code}")

print("\n[A.3] GET /api/contacts?type=Agen")
resp = admin.get(f"{BASE_URL}/contacts?type=Agen")
if resp.status_code == 200:
    data = extract_data(resp)
    contacts = data.get('data', data) if isinstance(data, dict) else data
    ag_list = [c for c in contacts if c.get('contactType') == 'Agen']
    print(f"✅ Found {len(ag_list)} Agen(s)")
else:
    print(f"❌ FAIL: {resp.status_code}")

# ============================================================================
# TEST B: End-Customers
# ============================================================================
print("\n[TEST B] End-Customers (contact_customers)")
print("-" * 80)

# B1: Create end-customer
print(f"\n[B.1] POST /api/contacts/{ds_id}/customers")
cust_data = {
    "name": "End Customer Test",
    "phone": "081234567890",
    "address": "Jl. Test No. 123",
    "city": "Jakarta"
}
resp = admin.post(f"{BASE_URL}/contacts/{ds_id}/customers", json=cust_data)
print(f"Status: {resp.status_code}")
if resp.status_code == 201:
    cust = extract_data(resp)
    cust_id = cust.get('id')
    print(f"✅ End-customer created: {cust_id} - {cust.get('name')}")
else:
    print(f"❌ FAIL: {resp.text}")
    cust_id = None

# B2: List end-customers
print(f"\n[B.2] GET /api/contacts/{ds_id}/customers")
resp = admin.get(f"{BASE_URL}/contacts/{ds_id}/customers")
print(f"Status: {resp.status_code}")
if resp.status_code == 200:
    customers = resp.json()
    print(f"✅ Found {len(customers)} end-customer(s)")
else:
    print(f"❌ FAIL: {resp.text}")

# B3: Update end-customer
if cust_id:
    print(f"\n[B.3] PATCH /api/contacts/{ds_id}/customers/{cust_id}")
    resp = admin.patch(f"{BASE_URL}/contacts/{ds_id}/customers/{cust_id}", json={"name": "Updated Name"})
    print(f"Status: {resp.status_code}")
    if resp.status_code == 200:
        updated = extract_data(resp)
        print(f"✅ Updated: {updated.get('name')}")
    else:
        print(f"❌ FAIL: {resp.text}")

# B4: DELETE (will do later after ship-to test)

# B5: RBAC tests
print(f"\n[B.5] RBAC: operator POST → 403")
operator = login("operator@lpi.co.id", "admin123")
if operator:
    resp = operator.post(f"{BASE_URL}/contacts/{ds_id}/customers", json=cust_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 403:
        print(f"✅ Operator correctly denied")
    else:
        print(f"❌ Expected 403, got {resp.status_code}")

print(f"\n[B.5] RBAC: direktur GET → 200, POST → 403")
direktur = login("direktur@lpi.co.id", "admin123")
if direktur:
    resp = direktur.get(f"{BASE_URL}/contacts/{ds_id}/customers")
    print(f"GET Status: {resp.status_code}")
    if resp.status_code == 200:
        print(f"✅ Direktur can view")
    
    resp = direktur.post(f"{BASE_URL}/contacts/{ds_id}/customers", json=cust_data)
    print(f"POST Status: {resp.status_code}")
    if resp.status_code == 403:
        print(f"✅ Direktur POST correctly denied")

# ============================================================================
# TEST C: Commission Flow
# ============================================================================
print("\n[TEST C] Commission Flow")
print("-" * 80)

# Setup: Create Customer + Product
print("\n[Setup] Creating Customer contact")
cust_contact_data = {
    "code": f"CUST-{datetime.now().strftime('%H%M%S')}",
    "displayName": "Customer for SO",
    "contactType": "Customer"
}
resp = admin.post(f"{BASE_URL}/contacts", json=cust_contact_data)
if resp.status_code != 201:
    print(f"❌ Failed to create customer: {resp.text}")
    exit(1)
cust_contact = extract_data(resp)
cust_contact_id = cust_contact.get('id')
print(f"✅ Customer created: {cust_contact_id}")

print("\n[Setup] Creating Product")
prod_data = {
    "sku": f"PROD-{datetime.now().strftime('%H%M%S')}",
    "name": "Test Product",
    "unit": "kg",
    "basePrice": 40000
}
resp = admin.post(f"{BASE_URL}/products", json=prod_data)
if resp.status_code != 201:
    print(f"❌ Failed to create product: {resp.text}")
    exit(1)
prod = extract_data(resp)
prod_id = prod.get('id')
print(f"✅ Product created: {prod_id}")

# C1: Create SO with dropshipperId
print(f"\n[C.1] POST /api/sales-orders with dropshipperId={ds_id}")
so_data = {
    "customerId": cust_contact_id,
    "dropshipperId": ds_id,
    "orderDate": datetime.now().strftime("%Y-%m-%d"),
    "items": [{
        "productId": prod_id,
        "quantity": 100,
        "weight": 100,
        "unitPrice": 40000
    }]
}
resp = admin.post(f"{BASE_URL}/sales-orders", json=so_data)
print(f"Status: {resp.status_code}")
if resp.status_code == 201:
    resp_json = resp.json()
    so = resp_json.get('data', resp_json)
    so_id = so.get('id')
    so_num = so.get('soNumber')
    print(f"✅ SO created: {so_num}")
    # Commission is at root level, not inside data
    if 'commission' in resp_json:
        comm = resp_json['commission']
        print(f"   Commission in response: amount={comm.get('amount')}")
        expected = 150 * 100  # per_kg: 150 * 100kg = 15000
        if comm.get('amount') == expected:
            print(f"   ✅ Commission amount correct: {expected}")
        else:
            print(f"   ⚠️  Expected {expected}, got {comm.get('amount')}")
    else:
        print(f"   ⚠️  No commission object in response")
else:
    print(f"❌ FAIL: {resp.text}")
    exit(1)

# Verify commission record
print(f"\n[C.1] GET /api/contacts/{ds_id}/commissions")
resp = admin.get(f"{BASE_URL}/contacts/{ds_id}/commissions")
print(f"Status: {resp.status_code}")
if resp.status_code == 200:
    data = resp.json()
    records = data.get('records', [])
    summary = data.get('summary', {})
    print(f"✅ Commission records: {len(records)}")
    if records:
        rec = records[0]
        print(f"   SO: {rec.get('salesOrderNumber')}, Amount: {rec.get('commissionAmount')}, Status: {rec.get('status')}")
        if rec.get('commissionAmount') == 15000:
            print(f"   ✅ Amount correct (150*100=15000)")
    print(f"   Summary: unpaidAmount={summary.get('unpaidAmount')}")
else:
    print(f"❌ FAIL: {resp.text}")

# C2: Preview commission
print(f"\n[C.2] POST /api/commissions/preview (percent_profit)")
resp = admin.post(f"{BASE_URL}/commissions/preview", json={
    "salesOrderId": so_id,
    "commissionType": "percent_profit",
    "commissionValue": 5
})
print(f"Status: {resp.status_code}")
if resp.status_code == 200:
    preview = resp.json()
    print(f"✅ Preview: revenue={preview.get('revenue')}, profit={preview.get('profit')}, amount={preview.get('amount')}")
else:
    print(f"❌ FAIL: {resp.text}")

print(f"\n[C.2] POST /api/commissions/preview (fixed)")
resp = admin.post(f"{BASE_URL}/commissions/preview", json={
    "salesOrderId": so_id,
    "commissionType": "fixed",
    "commissionValue": 50000
})
if resp.status_code == 200:
    preview = resp.json()
    print(f"✅ Fixed: amount={preview.get('amount')} (should be 50000)")
    assert preview.get('amount') == 50000, "Fixed amount mismatch"

print(f"\n[C.2] POST /api/commissions/preview (per_kg)")
resp = admin.post(f"{BASE_URL}/commissions/preview", json={
    "salesOrderId": so_id,
    "commissionType": "per_kg",
    "commissionValue": 200
})
if resp.status_code == 200:
    preview = resp.json()
    print(f"✅ Per_kg: amount={preview.get('amount')} (should be 20000)")
    assert preview.get('amount') == 20000, "Per_kg amount mismatch"

# C3: Duplicate SO rejection
print(f"\n[C.3] POST /api/contacts/{ds_id}/commissions (duplicate SO)")
resp = admin.post(f"{BASE_URL}/contacts/{ds_id}/commissions", json={"salesOrderId": so_id})
print(f"Status: {resp.status_code}")
if resp.status_code == 400:
    print(f"✅ Duplicate correctly rejected (400)")
else:
    print(f"❌ Expected 400, got {resp.status_code}")

# C4: Create SO with percent_profit commission
print(f"\n[C.4] Create SO2 for percent_profit commission")
so_data2 = {
    "customerId": cust_contact_id,
    "orderDate": datetime.now().strftime("%Y-%m-%d"),
    "items": [{
        "productId": prod_id,
        "quantity": 50,
        "weight": 50,
        "unitPrice": 40000
    }]
}
resp = admin.post(f"{BASE_URL}/sales-orders", json=so_data2)
if resp.status_code == 201:
    so2 = extract_data(resp)
    so2_id = so2.get('id')
    print(f"✅ SO2 created: {so2.get('soNumber')}")
    
    print(f"\n[C.4] POST commission with percent_profit + costAmount")
    resp = admin.post(f"{BASE_URL}/contacts/{ds_id}/commissions", json={
        "salesOrderId": so2_id,
        "commissionType": "percent_profit",
        "commissionValue": 10,
        "costAmount": 1000000
    })
    print(f"Status: {resp.status_code}")
    if resp.status_code == 201:
        comm = extract_data(resp)
        comm_id = comm.get('id')
        amount = comm.get('commissionAmount')
        print(f"✅ Commission created: {comm_id}, amount={amount}")
        # Revenue = 50*40000 = 2,000,000; Cost = 1,000,000; Profit = 1,000,000; 10% = 100,000
        expected = 100000
        if amount == expected:
            print(f"   ✅ Amount correct: 10% * (2M-1M) = {expected}")
        else:
            print(f"   ⚠️  Expected {expected}, got {amount}")
    else:
        print(f"❌ FAIL: {resp.text}")
        comm_id = None
else:
    print(f"❌ Failed to create SO2")
    comm_id = None

# C5: Pay single commission
if comm_id:
    print(f"\n[C.5] POST /api/contacts/{ds_id}/commission-payments (single)")
    resp = admin.post(f"{BASE_URL}/contacts/{ds_id}/commission-payments", json={"commissionRecordId": comm_id})
    print(f"Status: {resp.status_code}")
    if resp.status_code == 201:
        payment = extract_data(resp)
        print(f"✅ Payment created: {payment.get('id')}, amount={payment.get('amount')}")
        
        # Verify status changed
        resp = admin.get(f"{BASE_URL}/contacts/{ds_id}/commissions")
        if resp.status_code == 200:
            data = resp.json()
            records = data.get('records', [])
            paid_rec = [r for r in records if r.get('id') == comm_id]
            if paid_rec and paid_rec[0].get('status') == 'paid':
                print(f"   ✅ Record status = 'paid'")
    else:
        print(f"❌ FAIL: {resp.text}")

# C6: Pay all remaining
print(f"\n[C.6] POST /api/contacts/{ds_id}/commission-payments (pay all)")
resp = admin.post(f"{BASE_URL}/contacts/{ds_id}/commission-payments", json={})
print(f"Status: {resp.status_code}")
if resp.status_code == 201:
    payment = extract_data(resp)
    print(f"✅ Payment created: amount={payment.get('amount')}")
    
    resp = admin.get(f"{BASE_URL}/contacts/{ds_id}/commissions")
    if resp.status_code == 200:
        data = resp.json()
        summary = data.get('summary', {})
        print(f"   Summary: outstanding={summary.get('outstanding')}, unpaidAmount={summary.get('unpaidAmount')}")
        if summary.get('outstanding') == 0:
            print(f"   ✅ All paid (outstanding=0)")
else:
    print(f"❌ FAIL: {resp.text}")

# C7: Delete commission
print(f"\n[C.7] Testing DELETE commission")
resp = admin.get(f"{BASE_URL}/contacts/{ds_id}/commissions")
if resp.status_code == 200:
    data = resp.json()
    records = data.get('records', [])
    paid_records = [r for r in records if r.get('status') == 'paid']
    
    if paid_records:
        paid_id = paid_records[0].get('id')
        print(f"\n[C.7] DELETE paid record → 400")
        resp = admin.delete(f"{BASE_URL}/contacts/{ds_id}/commissions/{paid_id}")
        print(f"Status: {resp.status_code}")
        if resp.status_code == 400:
            print(f"✅ Cannot delete paid record")
        else:
            print(f"❌ Expected 400, got {resp.status_code}")

# Create unpaid commission for delete test
print(f"\n[C.7] Creating unpaid commission for delete test")
so_data3 = {
    "customerId": cust_contact_id,
    "orderDate": datetime.now().strftime("%Y-%m-%d"),
    "items": [{"productId": prod_id, "quantity": 10, "weight": 10, "unitPrice": 40000}]
}
resp = admin.post(f"{BASE_URL}/sales-orders", json=so_data3)
if resp.status_code == 201:
    so3 = extract_data(resp)
    so3_id = so3.get('id')
    
    resp = admin.post(f"{BASE_URL}/contacts/{ds_id}/commissions", json={"salesOrderId": so3_id})
    if resp.status_code == 201:
        comm3 = extract_data(resp)
        unpaid_id = comm3.get('id')
        
        print(f"\n[C.7] DELETE unpaid record → 200")
        resp = admin.delete(f"{BASE_URL}/contacts/{ds_id}/commissions/{unpaid_id}")
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            print(f"✅ Unpaid record deleted")
        else:
            print(f"❌ Expected 200, got {resp.status_code}")

# C8: RBAC
print(f"\n[C.8] RBAC tests")
if operator:
    resp = operator.post(f"{BASE_URL}/contacts/{ds_id}/commissions", json={"salesOrderId": so_id})
    print(f"Operator POST commission: {resp.status_code}")
    if resp.status_code == 403:
        print(f"✅ Operator denied")
    
    resp = operator.post(f"{BASE_URL}/contacts/{ds_id}/commission-payments", json={})
    print(f"Operator POST payment: {resp.status_code}")
    if resp.status_code == 403:
        print(f"✅ Operator denied")

if direktur:
    resp = direktur.get(f"{BASE_URL}/contacts/{ds_id}/commissions")
    print(f"Direktur GET commissions: {resp.status_code}")
    if resp.status_code == 200:
        print(f"✅ Direktur can view")
    
    resp = direktur.post(f"{BASE_URL}/contacts/{ds_id}/commissions", json={"salesOrderId": so_id})
    print(f"Direktur POST commission: {resp.status_code}")
    if resp.status_code == 403:
        print(f"✅ Direktur POST denied")

# ============================================================================
# TEST D: Surat Jalan ship-to
# ============================================================================
print("\n[TEST D] Surat Jalan ship-to")
print("-" * 80)

# Create SO and advance to Packed
print("\n[D.1] Creating SO for surat jalan test")
so_sj_data = {
    "customerId": cust_contact_id,
    "orderDate": datetime.now().strftime("%Y-%m-%d"),
    "items": [{"productId": prod_id, "quantity": 20, "weight": 20, "unitPrice": 50000}]
}
resp = admin.post(f"{BASE_URL}/sales-orders", json=so_sj_data)
if resp.status_code == 201:
    so_sj = extract_data(resp)
    so_sj_id = so_sj.get('id')
    print(f"✅ SO created: {so_sj.get('soNumber')}")
    
    # Advance to Packed
    for status in ['Confirmed', 'Packed']:
        resp = admin.post(f"{BASE_URL}/sales-orders/{so_sj_id}/status", json={"status": status})
        if resp.status_code == 200:
            print(f"✅ Advanced to {status}")

    # D2: Create surat jalan with shipToCustomerId
    if cust_id:
        print(f"\n[D.2] POST surat-jalan with shipToCustomerId={cust_id}")
        sj_data = {
            "shipToCustomerId": cust_id,
            "deliveryDate": datetime.now().strftime("%Y-%m-%d"),
            "driverName": "Test Driver",
            "vehicleNumber": "B 1234 XY"
        }
        resp = admin.post(f"{BASE_URL}/sales-orders/{so_sj_id}/surat-jalan", json=sj_data)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 201:
            sj = extract_data(resp)
            print(f"✅ Surat Jalan created: {sj.get('sjNumber')}")
            if 'shipToName' in sj:
                print(f"   shipToName: {sj.get('shipToName')}")
                print(f"   shipToPhone: {sj.get('shipToPhone')}")
                print(f"   shipToAddress: {sj.get('shipToAddress')}")
                print(f"   ✅ Ship-to snapshot present")
            
            # Verify in SO detail
            resp = admin.get(f"{BASE_URL}/sales-orders/{so_sj_id}")
            if resp.status_code == 200:
                so_detail = extract_data(resp)
                sj_list = so_detail.get('suratJalan', [])
                if sj_list and sj_list[0].get('shipToName'):
                    print(f"   ✅ Ship-to in SO detail")
        else:
            print(f"❌ FAIL: {resp.text}")

# D3: Manual ship-to
print(f"\n[D.3] Creating SO with manual ship-to")
so_sj_data2 = {
    "customerId": cust_contact_id,
    "orderDate": datetime.now().strftime("%Y-%m-%d"),
    "items": [{"productId": prod_id, "quantity": 10, "weight": 10, "unitPrice": 50000}]
}
resp = admin.post(f"{BASE_URL}/sales-orders", json=so_sj_data2)
if resp.status_code == 201:
    so_sj2 = extract_data(resp)
    so_sj2_id = so_sj2.get('id')
    
    for status in ['Confirmed', 'Packed']:
        admin.post(f"{BASE_URL}/sales-orders/{so_sj2_id}/status", json={"status": status})
    
    print(f"\n[D.3] POST surat-jalan with manual ship-to")
    sj_data2 = {
        "shipToName": "Manual Customer X",
        "shipToAddress": "Jl. Manual No. 456",
        "deliveryDate": datetime.now().strftime("%Y-%m-%d"),
        "driverName": "Driver 2",
        "vehicleNumber": "B 5678 ZZ"
    }
    resp = admin.post(f"{BASE_URL}/sales-orders/{so_sj2_id}/surat-jalan", json=sj_data2)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 201:
        sj2 = extract_data(resp)
        print(f"✅ Surat Jalan created: {sj2.get('sjNumber')}")
        if sj2.get('shipToName') == "Manual Customer X":
            print(f"   ✅ Manual ship-to stored")

# ============================================================================
# TEST E: inventory_stock.hpp_per_kg
# ============================================================================
print("\n[TEST E] inventory_stock.hpp_per_kg")
print("-" * 80)

# Create cold storage
print("\n[Setup] Creating cold storage")
cs_data = {
    "code": f"CS-{datetime.now().strftime('%H%M%S')}",
    "name": "Test Cold Storage",
    "capacityKg": 10000
}
resp = admin.post(f"{BASE_URL}/cold-storages", json=cs_data)
if resp.status_code == 201:
    cs = extract_data(resp)
    cs_id = cs.get('id')
    print(f"✅ Cold storage created: {cs_id}")
    
    # E: POST inbound
    print(f"\n[E] POST /api/inventory/inbound (MANUAL)")
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
    resp = admin.post(f"{BASE_URL}/inventory/inbound", json=inbound_data)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 201:
        result = extract_data(resp)
        print(f"✅ Inbound created: txId={result.get('transactionId')}")
        
        # Verify stock
        resp = admin.get(f"{BASE_URL}/inventory/stocks")
        if resp.status_code == 200:
            stocks_data = extract_data(resp)
            stocks = stocks_data.get('data', [])
            if stocks:
                stock = stocks[0]
                print(f"   Stock: kodeSimpan={stock.get('kodeSimpan')}, weight={stock.get('weight')}")
                if 'hppPerKg' in stock:
                    print(f"   ✅ hpp_per_kg field present: {stock.get('hppPerKg')}")
                else:
                    print(f"   ⚠️  hpp_per_kg field missing")
    else:
        print(f"❌ FAIL: {resp.text}")
else:
    print(f"❌ Failed to create cold storage")

print("\n" + "="*80)
print("TEST COMPLETE")
print("="*80)
