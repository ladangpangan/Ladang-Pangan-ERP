#!/usr/bin/env python3
"""
Check current state of SOs and POs to understand data conditions
"""

import requests
import json

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"

# Login as admin
session = requests.Session()
login_response = session.post(
    f"{BASE_URL}/auth/sign-in/email",
    json={"email": "admin@lpi.co.id", "password": "admin123"},
    headers={"Content-Type": "application/json"},
    timeout=30
)

if login_response.status_code != 200:
    print(f"Login failed: {login_response.status_code}")
    exit(1)

print("✅ Logged in as admin\n")

# Check SOs
print("="*80)
print("SALES ORDERS")
print("="*80)
so_response = session.get(f"{BASE_URL}/sales-orders", timeout=30)
if so_response.status_code == 200:
    sos = so_response.json().get('data', [])
    print(f"Total SOs: {len(sos)}\n")
    for so in sos:
        print(f"SO: {so.get('soNumber')}")
        print(f"  ID: {so.get('id')}")
        print(f"  Status: {so.get('pipelineStatus')}")
        print(f"  Customer: {so.get('customerName', 'N/A')}")
        print(f"  Total: Rp {so.get('totalAmount', 0):,.0f}")
        print()
else:
    print(f"Failed to fetch SOs: {so_response.status_code}")

# Check POs
print("="*80)
print("PURCHASE ORDERS")
print("="*80)
po_response = session.get(f"{BASE_URL}/purchase-orders", timeout=30)
if po_response.status_code == 200:
    pos = po_response.json().get('data', [])
    print(f"Total POs: {len(pos)}\n")
    for po in pos:
        print(f"PO: {po.get('poNumber')}")
        print(f"  ID: {po.get('id')}")
        print(f"  Status: {po.get('pipelineStatus')}")
        print(f"  Supplier: {po.get('supplierName', 'N/A')}")
        print(f"  Total: Rp {po.get('totalAmount', 0):,.0f}")
        print()
else:
    print(f"Failed to fetch POs: {po_response.status_code}")

# Check existing approvals
print("="*80)
print("APPROVALS")
print("="*80)
approvals_response = session.get(f"{BASE_URL}/approvals", timeout=30)
if approvals_response.status_code == 200:
    approvals = approvals_response.json().get('data', [])
    print(f"Total Approvals: {len(approvals)}\n")
    
    # Group by concernType
    by_type = {}
    for ap in approvals:
        concern_type = ap.get('concernType', 'unknown')
        if concern_type not in by_type:
            by_type[concern_type] = []
        by_type[concern_type].append(ap)
    
    for concern_type, aps in by_type.items():
        print(f"\n{concern_type}: {len(aps)} approvals")
        for ap in aps[:3]:  # Show first 3
            print(f"  - {ap.get('title', 'N/A')}")
            print(f"    ID: {ap.get('id')}")
            print(f"    Status: {ap.get('status')}")
            print(f"    Entity: {ap.get('entityType')} {ap.get('entityNumber', '')}")
else:
    print(f"Failed to fetch approvals: {approvals_response.status_code}")
