#!/usr/bin/env python3
"""
Debug: Check SO_SHIP journals in detail
"""

import requests
import json

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"

session = requests.Session()

# Login as akuntan
login = session.post(
    f"{BASE_URL}/auth/sign-in/email",
    json={"email": "akuntan@lpi.co.id", "password": "akuntanlpi123"}
)

print(f"Login: {login.status_code}")

# Trigger sync
print("\nTriggering accounting sync...")
session.get(f"{BASE_URL}/accounting/trial-balance")

# Get all journals with SO_SHIP source
print("\nFetching SO_SHIP journals...")
journals_response = session.get(f"{BASE_URL}/accounting/journals?source=SO_SHIP&limit=500")
print(f"Status: {journals_response.status_code}")

if journals_response.status_code == 200:
    journals = journals_response.json().get('data', [])
    print(f"Found {len(journals)} SO_SHIP journals\n")
    
    for j in journals:
        print(f"Journal ID: {j.get('id')}")
        print(f"  sourceType: {j.get('sourceType')}")
        print(f"  sourceId: {j.get('sourceId')}")
        print(f"  sourceKey: {j.get('sourceKey')}")
        print(f"  sourceNumber: {j.get('sourceNumber')}")
        print(f"  description: {j.get('description')}")
        print(f"  date: {j.get('date')}")
        print(f"  Lines:")
        for line in j.get('lines', []):
            code = line.get('accountCode') or line.get('code')
            debit = line.get('debit', 0)
            credit = line.get('credit', 0)
            desc = line.get('description', '')
            print(f"    - {code}: Debit {debit}, Credit {credit} ({desc})")
        print()

# Get SO/202608/0006 details
print("\nFetching SO/202608/0006 details...")
so_list = session.get(f"{BASE_URL}/sales-orders").json().get('data', [])
so_0006 = next((s for s in so_list if s.get('soNumber') == 'SO/202608/0006'), None)

if so_0006:
    so_id = so_0006.get('id')
    print(f"SO ID: {so_id}")
    
    so_detail = session.get(f"{BASE_URL}/sales-orders/{so_id}").json().get('data', {})
    print(f"  soNumber: {so_detail.get('soNumber')}")
    print(f"  pipelineStatus: {so_detail.get('pipelineStatus')}")
    print(f"  invoiceNumber: {so_detail.get('invoiceNumber')}")
    print(f"  shippingCost: {so_detail.get('shippingCost')}")
    print(f"  shippingBearer: {so_detail.get('shippingBearer')}")
    print(f"  shippingPayMethod: {so_detail.get('shippingPayMethod')}")
    print(f"  shippingAccountCode: {so_detail.get('shippingAccountCode')}")
    
    # Check if journal exists for this SO
    print(f"\nLooking for journal with sourceKey 'SO_SHIP:{so_id}'...")
    all_journals = session.get(f"{BASE_URL}/accounting/journals?limit=1000").json().get('data', [])
    matching = [j for j in all_journals if j.get('sourceId') == so_id or f"SO_SHIP:{so_id}" in str(j.get('sourceKey', ''))]
    print(f"Found {len(matching)} matching journals")
    for j in matching:
        print(f"  - {j.get('sourceKey')}: {j.get('description')}")
