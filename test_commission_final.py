#!/usr/bin/env python3
"""
Final Comprehensive Test for Agen & Dropshipper + Commission + End-Customers
"""

import requests
import json
from datetime import datetime

BASE_URL = "https://erp-mapper-1.preview.emergentagent.com/api"

# Correct passwords from seed
ADMIN_CREDS = ("admin@lpi.co.id", "admin123")
OPERATOR_CREDS = ("operator@lpi.co.id", "operator123")
DIREKTUR_CREDS = ("direktur@lpi.co.id", "direktur123")

def login(email, password):
    s = requests.Session()
    resp = s.post(f"{BASE_URL}/auth/sign-in/email", json={"email": email, "password": password})
    if resp.status_code != 200:
        print(f"❌ Login failed for {email}: {resp.status_code}")
        return None
    print(f"✅ Logged in as {email}")
    return s

def get_data(resp):
    """Extract data from response"""
    try:
        j = resp.json()
        return j.get('data', j)
    except Exception:
        return {}

print("\n" + "="*80)
print("COMMISSION & END-CUSTOMERS - COMPREHENSIVE TEST")
print("="*80)

admin = login(*ADMIN_CREDS)
if not admin:
    exit(1)

# Test counters
tests_passed = 0
tests_failed = 0

def test_result(name, passed, details=""):
    global tests_passed, tests_failed
    if passed:
        tests_passed += 1
        print(f"✅ {name}")
        if details:
            print(f"   {details}")
    else:
        tests_failed += 1
        print(f"❌ {name}")
        if details:
            print(f"   {details}")

# ============================================================================
# TEST A: Contact Types
# ============================================================================
print("\n[TEST A] Contact Types - Agen & Dropshipper")
print("-" * 80)

# A1: Dropshipper
ds_data = {
    "code": f"DS-{datetime.now().strftime('%H%M%S')}",
    "displayName": "Test Dropshipper",
    "contactType": "Dropshipper",
    "commissionType": "per_kg",
    "commissionValue": 150
}
resp = admin.post(f"{BASE_URL}/contacts", json=ds_data)
if resp.status_code == 201:
    ds = get_data(resp)
    ds_id = ds.get('id')
    test_result("A.1 POST Dropshipper", 
                ds.get('commissionType') == 'per_kg' and ds.get('commissionValue') == 150,
                f"ID={ds_id}, commissionType={ds.get('commissionType')}, value={ds.get('commissionValue')}")
else:
    test_result("A.1 POST Dropshipper", False, f"Status {resp.status_code}")
    ds_id = None

# A2: Agen
ag_data = {
    "code": f"AG-{datetime.now().strftime('%H%M%S')}",
    "displayName": "Test Agen",
    "contactType": "Agen",
    "agentDiscountPct": 5
}
resp = admin.post(f"{BASE_URL}/contacts", json=ag_data)
if resp.status_code == 201:
    ag = get_data(resp)
    test_result("A.2 POST Agen",
                ag.get('agentDiscountPct') == 5,
                f"ID={ag.get('id')}, agentDiscountPct={ag.get('agentDiscountPct')}")
else:
    test_result("A.2 POST Agen", False, f"Status {resp.status_code}")

# A3: Filter
resp = admin.get(f"{BASE_URL}/contacts?type=Dropshipper")
if resp.status_code == 200:
    data = get_data(resp)
    contacts = data.get('data', data) if isinstance(data, dict) else data
    ds_list = [c for c in contacts if c.get('contactType') == 'Dropshipper']
    test_result("A.3 GET ?type=Dropshipper", len(ds_list) > 0, f"Found {len(ds_list)} Dropshipper(s)")
else:
    test_result("A.3 GET ?type=Dropshipper", False)

resp = admin.get(f"{BASE_URL}/contacts?type=Agen")
if resp.status_code == 200:
    data = get_data(resp)
    contacts = data.get('data', data) if isinstance(data, dict) else data
    ag_list = [c for c in contacts if c.get('contactType') == 'Agen']
    test_result("A.3 GET ?type=Agen", len(ag_list) > 0, f"Found {len(ag_list)} Agen(s)")
else:
    test_result("A.3 GET ?type=Agen", False)

# ============================================================================
# TEST B: End-Customers
# ============================================================================
print("\n[TEST B] End-Customers")
print("-" * 80)

if not ds_id:
    print("⚠️  Skipping B tests - no dropshipper_id")
else:
    # B1: Create
    cust_data = {"name": "End Customer Test", "phone": "081234567890", "address": "Jl. Test 123", "city": "Jakarta"}
    resp = admin.post(f"{BASE_URL}/contacts/{ds_id}/customers", json=cust_data)
    if resp.status_code == 201:
        cust = get_data(resp)
        cust_id = cust.get('id')
        test_result("B.1 POST end-customer", True, f"ID={cust_id}, name={cust.get('name')}")
    else:
        test_result("B.1 POST end-customer", False, f"Status {resp.status_code}")
        cust_id = None
    
    # B2: List
    resp = admin.get(f"{BASE_URL}/contacts/{ds_id}/customers")
    test_result("B.2 GET end-customers", resp.status_code == 200, f"Found {len(resp.json()) if resp.status_code == 200 else 0} customer(s)")
    
    # B3: Update
    if cust_id:
        resp = admin.patch(f"{BASE_URL}/contacts/{ds_id}/customers/{cust_id}", json={"name": "Updated Name"})
        if resp.status_code == 200:
            updated = get_data(resp)
            test_result("B.3 PATCH end-customer", updated.get('name') == "Updated Name", f"name={updated.get('name')}")
        else:
            test_result("B.3 PATCH end-customer", False)
    
    # B4: DELETE (will test after ship-to)
    
    # B5: RBAC
    operator = login(*OPERATOR_CREDS)
    if operator:
        resp = operator.post(f"{BASE_URL}/contacts/{ds_id}/customers", json=cust_data)
        test_result("B.5 RBAC operator POST → 403", resp.status_code == 403)
    
    direktur = login(*DIREKTUR_CREDS)
    if direktur:
        resp = direktur.get(f"{BASE_URL}/contacts/{ds_id}/customers")
        test_result("B.5 RBAC direktur GET → 200", resp.status_code == 200)
        
        resp = direktur.post(f"{BASE_URL}/contacts/{ds_id}/customers", json=cust_data)
        test_result("B.5 RBAC direktur POST → 403", resp.status_code == 403)

# ============================================================================
# TEST C: Commission Flow
# ============================================================================
print("\n[TEST C] Commission Flow")
print("-" * 80)

if not ds_id:
    print("⚠️  Skipping C tests - no dropshipper_id")
else:
    # Setup
    cust_contact_data = {"code": f"CUST-{datetime.now().strftime('%H%M%S')}", "displayName": "Customer for SO", "contactType": "Customer"}
    resp = admin.post(f"{BASE_URL}/contacts", json=cust_contact_data)
    cust_contact_id = get_data(resp).get('id') if resp.status_code == 201 else None
    
    prod_data = {"sku": f"PROD-{datetime.now().strftime('%H%M%S')}", "name": "Test Product", "unit": "kg", "basePrice": 40000}
    resp = admin.post(f"{BASE_URL}/products", json=prod_data)
    prod_id = get_data(resp).get('id') if resp.status_code == 201 else None
    
    if not cust_contact_id or not prod_id:
        print("⚠️  Failed to create customer/product")
    else:
        # C1: SO with dropshipperId
        so_data = {
            "customerId": cust_contact_id,
            "dropshipperId": ds_id,
            "orderDate": datetime.now().strftime("%Y-%m-%d"),
            "items": [{"productId": prod_id, "quantity": 100, "weight": 100, "unitPrice": 40000}]
        }
        resp = admin.post(f"{BASE_URL}/sales-orders", json=so_data)
        if resp.status_code == 201:
            resp_json = resp.json()
            so = resp_json.get('data', resp_json)
            so_id = so.get('id')
            comm = resp_json.get('commission')
            test_result("C.1 POST SO with dropshipperId",
                       comm and comm.get('amount') == 15000,
                       f"SO={so.get('soNumber')}, commission amount={comm.get('amount') if comm else 'None'} (expected 15000)")
        else:
            test_result("C.1 POST SO with dropshipperId", False)
            so_id = None
        
        # Verify commission record
        resp = admin.get(f"{BASE_URL}/contacts/{ds_id}/commissions")
        if resp.status_code == 200:
            data = resp.json()
            records = data.get('records', [])
            test_result("C.1 GET commissions",
                       len(records) > 0 and records[0].get('commissionAmount') == 15000,
                       f"Found {len(records)} record(s), amount={records[0].get('commissionAmount') if records else 'None'}")
        else:
            test_result("C.1 GET commissions", False)
        
        # C2: Preview
        if so_id:
            resp = admin.post(f"{BASE_URL}/commissions/preview", json={"salesOrderId": so_id, "commissionType": "fixed", "commissionValue": 50000})
            if resp.status_code == 200:
                preview = get_data(resp)
                test_result("C.2 Preview (fixed)", preview.get('amount') == 50000, f"amount={preview.get('amount')}")
            else:
                test_result("C.2 Preview (fixed)", False)
            
            resp = admin.post(f"{BASE_URL}/commissions/preview", json={"salesOrderId": so_id, "commissionType": "per_kg", "commissionValue": 200})
            if resp.status_code == 200:
                preview = get_data(resp)
                test_result("C.2 Preview (per_kg)", preview.get('amount') == 20000, f"amount={preview.get('amount')} (expected 20000)")
            else:
                test_result("C.2 Preview (per_kg)", False)
            
            resp = admin.post(f"{BASE_URL}/commissions/preview", json={"salesOrderId": so_id, "commissionType": "percent_profit", "commissionValue": 5})
            test_result("C.2 Preview (percent_profit)", resp.status_code == 200)
        
        # C3: Duplicate rejection
        if so_id:
            resp = admin.post(f"{BASE_URL}/contacts/{ds_id}/commissions", json={"salesOrderId": so_id})
            test_result("C.3 Duplicate SO rejection", resp.status_code == 400, "Duplicate correctly rejected")
        
        # C4: percent_profit with costAmount
        so_data2 = {
            "customerId": cust_contact_id,
            "orderDate": datetime.now().strftime("%Y-%m-%d"),
            "items": [{"productId": prod_id, "quantity": 50, "weight": 50, "unitPrice": 40000}]
        }
        resp = admin.post(f"{BASE_URL}/sales-orders", json=so_data2)
        if resp.status_code == 201:
            so2_id = get_data(resp.json()).get('id')
            
            resp = admin.post(f"{BASE_URL}/contacts/{ds_id}/commissions", json={
                "salesOrderId": so2_id,
                "commissionType": "percent_profit",
                "commissionValue": 10,
                "costAmount": 1000000
            })
            if resp.status_code == 201:
                comm = get_data(resp)
                comm_id = comm.get('id')
                # Revenue=2M, Cost=1M, Profit=1M, 10%=100K
                test_result("C.4 percent_profit with costAmount",
                           comm.get('commissionAmount') == 100000,
                           f"amount={comm.get('commissionAmount')} (expected 100000)")
            else:
                test_result("C.4 percent_profit with costAmount", False)
                comm_id = None
        else:
            comm_id = None
        
        # C5: Pay single commission
        if comm_id:
            resp = admin.post(f"{BASE_URL}/contacts/{ds_id}/commission-payments", json={"commissionRecordId": comm_id})
            if resp.status_code == 201:
                # Verify status changed
                resp = admin.get(f"{BASE_URL}/contacts/{ds_id}/commissions")
                if resp.status_code == 200:
                    records = resp.json().get('records', [])
                    paid_rec = [r for r in records if r.get('id') == comm_id]
                    test_result("C.5 Pay single commission",
                               paid_rec and paid_rec[0].get('status') == 'paid',
                               "Status changed to 'paid'")
                else:
                    test_result("C.5 Pay single commission", False)
            else:
                test_result("C.5 Pay single commission", False)
        
        # C6: Pay all
        resp = admin.post(f"{BASE_URL}/contacts/{ds_id}/commission-payments", json={})
        if resp.status_code == 201:
            resp = admin.get(f"{BASE_URL}/contacts/{ds_id}/commissions")
            if resp.status_code == 200:
                summary = resp.json().get('summary', {})
                test_result("C.6 Pay all remaining",
                           summary.get('outstanding') == 0,
                           f"outstanding={summary.get('outstanding')}, unpaidAmount={summary.get('unpaidAmount')}")
            else:
                test_result("C.6 Pay all remaining", False)
        else:
            test_result("C.6 Pay all remaining", False)
        
        # C7: Delete commission
        # Create unpaid commission
        so_data3 = {
            "customerId": cust_contact_id,
            "orderDate": datetime.now().strftime("%Y-%m-%d"),
            "items": [{"productId": prod_id, "quantity": 10, "weight": 10, "unitPrice": 40000}]
        }
        resp = admin.post(f"{BASE_URL}/sales-orders", json=so_data3)
        if resp.status_code == 201:
            so3_id = get_data(resp.json()).get('id')
            resp = admin.post(f"{BASE_URL}/contacts/{ds_id}/commissions", json={"salesOrderId": so3_id})
            if resp.status_code == 201:
                unpaid_id = get_data(resp).get('id')
                
                # Try to delete unpaid
                resp = admin.delete(f"{BASE_URL}/contacts/{ds_id}/commissions/{unpaid_id}")
                test_result("C.7 DELETE unpaid commission", resp.status_code == 200)
            else:
                test_result("C.7 DELETE unpaid commission", False, "Failed to create unpaid commission")
        
        # Get a paid record and try to delete
        resp = admin.get(f"{BASE_URL}/contacts/{ds_id}/commissions")
        if resp.status_code == 200:
            records = resp.json().get('records', [])
            paid_records = [r for r in records if r.get('status') == 'paid']
            if paid_records:
                paid_id = paid_records[0].get('id')
                resp = admin.delete(f"{BASE_URL}/contacts/{ds_id}/commissions/{paid_id}")
                test_result("C.7 DELETE paid commission → 400", resp.status_code == 400, "Cannot delete paid record")
        
        # C8: RBAC
        if operator:
            resp = operator.post(f"{BASE_URL}/contacts/{ds_id}/commissions", json={"salesOrderId": so_id if so_id else "dummy"})
            test_result("C.8 RBAC operator POST commission → 403", resp.status_code == 403)
            
            resp = operator.post(f"{BASE_URL}/contacts/{ds_id}/commission-payments", json={})
            test_result("C.8 RBAC operator POST payment → 403", resp.status_code == 403)
        
        if direktur:
            resp = direktur.get(f"{BASE_URL}/contacts/{ds_id}/commissions")
            test_result("C.8 RBAC direktur GET commissions → 200", resp.status_code == 200)
            
            resp = direktur.post(f"{BASE_URL}/contacts/{ds_id}/commissions", json={"salesOrderId": so_id if so_id else "dummy"})
            test_result("C.8 RBAC direktur POST commission → 403", resp.status_code == 403)

# ============================================================================
# TEST D: Surat Jalan ship-to
# ============================================================================
print("\n[TEST D] Surat Jalan ship-to")
print("-" * 80)

if not ds_id or not cust_id or not cust_contact_id or not prod_id:
    print("⚠️  Skipping D tests - missing prerequisites")
else:
    # Create SO and advance to Packed
    so_sj_data = {
        "customerId": cust_contact_id,
        "orderDate": datetime.now().strftime("%Y-%m-%d"),
        "items": [{"productId": prod_id, "quantity": 20, "weight": 20, "unitPrice": 50000}]
    }
    resp = admin.post(f"{BASE_URL}/sales-orders", json=so_sj_data)
    if resp.status_code == 201:
        so_sj_id = get_data(resp.json()).get('id')
        
        # Advance to Packed
        for status in ['Confirmed', 'Packed']:
            admin.post(f"{BASE_URL}/sales-orders/{so_sj_id}/status", json={"status": status})
        
        # D2: Create surat jalan with shipToCustomerId
        sj_data = {
            "shipToCustomerId": cust_id,
            "deliveryDate": datetime.now().strftime("%Y-%m-%d"),
            "driverName": "Test Driver",
            "vehicleNumber": "B 1234 XY"
        }
        resp = admin.post(f"{BASE_URL}/sales-orders/{so_sj_id}/surat-jalan", json=sj_data)
        if resp.status_code == 201:
            sj = get_data(resp)
            has_ship_to = 'shipToName' in sj and sj.get('shipToName')
            test_result("D.2 POST surat-jalan with shipToCustomerId",
                       has_ship_to,
                       f"SJ={sj.get('sjNumber')}, shipToName={sj.get('shipToName')}")
            
            # Verify in SO detail
            resp = admin.get(f"{BASE_URL}/sales-orders/{so_sj_id}")
            if resp.status_code == 200:
                so_detail = get_data(resp)
                sj_list = so_detail.get('suratJalan', [])
                test_result("D.2 Ship-to in SO detail",
                           sj_list and sj_list[0].get('shipToName'),
                           f"shipToName={sj_list[0].get('shipToName') if sj_list else 'None'}")
        else:
            test_result("D.2 POST surat-jalan with shipToCustomerId", False)
    
    # D3: Manual ship-to
    so_sj_data2 = {
        "customerId": cust_contact_id,
        "orderDate": datetime.now().strftime("%Y-%m-%d"),
        "items": [{"productId": prod_id, "quantity": 10, "weight": 10, "unitPrice": 50000}]
    }
    resp = admin.post(f"{BASE_URL}/sales-orders", json=so_sj_data2)
    if resp.status_code == 201:
        so_sj2_id = get_data(resp.json()).get('id')
        
        for status in ['Confirmed', 'Packed']:
            admin.post(f"{BASE_URL}/sales-orders/{so_sj2_id}/status", json={"status": status})
        
        sj_data2 = {
            "shipToName": "Manual Customer X",
            "shipToAddress": "Jl. Manual No. 456",
            "deliveryDate": datetime.now().strftime("%Y-%m-%d"),
            "driverName": "Driver 2",
            "vehicleNumber": "B 5678 ZZ"
        }
        resp = admin.post(f"{BASE_URL}/sales-orders/{so_sj2_id}/surat-jalan", json=sj_data2)
        if resp.status_code == 201:
            sj2 = get_data(resp)
            test_result("D.3 POST surat-jalan with manual ship-to",
                       sj2.get('shipToName') == "Manual Customer X",
                       f"shipToName={sj2.get('shipToName')}")
        else:
            test_result("D.3 POST surat-jalan with manual ship-to", False)

# ============================================================================
# TEST E: inventory_stock.hpp_per_kg
# ============================================================================
print("\n[TEST E] inventory_stock.hpp_per_kg")
print("-" * 80)

# Create cold storage
cs_data = {"code": f"CS-{datetime.now().strftime('%H%M%S')}", "name": "Test CS", "capacityKg": 10000}
resp = admin.post(f"{BASE_URL}/cold-storages", json=cs_data)
if resp.status_code == 201:
    cs_id = get_data(resp).get('id')
    
    # Create product if not exists
    if not prod_id:
        prod_data = {"sku": f"PROD-{datetime.now().strftime('%H%M%S')}", "name": "Test Product", "unit": "kg", "basePrice": 30000}
        resp = admin.post(f"{BASE_URL}/products", json=prod_data)
        prod_id = get_data(resp).get('id') if resp.status_code == 201 else None
    
    if prod_id:
        # E: POST inbound
        inbound_data = {
            "coldStorageId": cs_id,
            "referenceType": "MANUAL",
            "items": [{"productId": prod_id, "weight": 50, "quantity": 1, "packagingType": "karung"}]
        }
        resp = admin.post(f"{BASE_URL}/inventory/inbound", json=inbound_data)
        if resp.status_code == 201:
            # Verify stock has hpp_per_kg field
            resp = admin.get(f"{BASE_URL}/inventory/stocks")
            if resp.status_code == 200:
                stocks_data = get_data(resp)
                stocks = stocks_data.get('data', [])
                if stocks:
                    stock = stocks[0]
                    test_result("E POST inbound + hpp_per_kg field",
                               'hppPerKg' in stock,
                               f"kodeSimpan={stock.get('kodeSimpan')}, hppPerKg={stock.get('hppPerKg')}")
                else:
                    test_result("E POST inbound + hpp_per_kg field", False, "No stocks found")
            else:
                test_result("E POST inbound + hpp_per_kg field", False, "Failed to get stocks")
        else:
            test_result("E POST inbound + hpp_per_kg field", False, f"Inbound failed: {resp.status_code}")
    else:
        test_result("E POST inbound + hpp_per_kg field", False, "No product_id")
else:
    test_result("E POST inbound + hpp_per_kg field", False, "Failed to create cold storage")

# ============================================================================
# SUMMARY
# ============================================================================
print("\n" + "="*80)
print("TEST SUMMARY")
print("="*80)
print(f"✅ PASSED: {tests_passed}")
print(f"❌ FAILED: {tests_failed}")
print(f"TOTAL: {tests_passed + tests_failed}")
print(f"Success Rate: {tests_passed/(tests_passed+tests_failed)*100:.1f}%")
print("="*80)
