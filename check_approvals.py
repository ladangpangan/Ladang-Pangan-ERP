#!/usr/bin/env python3
"""
Check approvals as akuntan to see if there are any payment_approval concerns
"""

import requests
import json

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"

# Login as akuntan
session = requests.Session()
login_response = session.post(
    f"{BASE_URL}/auth/sign-in/email",
    json={"email": "akuntan@lpi.co.id", "password": "akuntanlpi123"},
    headers={"Content-Type": "application/json"},
    timeout=30
)

if login_response.status_code != 200:
    print(f"Login failed: {login_response.status_code}")
    exit(1)

print("✅ Logged in as akuntan\n")

# Check all approvals
print("="*80)
print("ALL APPROVALS")
print("="*80)
approvals_response = session.get(f"{BASE_URL}/approvals", timeout=30)
if approvals_response.status_code == 200:
    approvals = approvals_response.json().get('data', [])
    summary = approvals_response.json().get('summary', {})
    print(f"Total Approvals: {len(approvals)}")
    print(f"Summary: {summary}\n")
    
    # Group by concernType
    by_type = {}
    for ap in approvals:
        concern_type = ap.get('concernType', 'unknown')
        if concern_type not in by_type:
            by_type[concern_type] = []
        by_type[concern_type].append(ap)
    
    for concern_type, aps in by_type.items():
        print(f"\n{concern_type}: {len(aps)} approvals")
        for ap in aps:
            print(f"  - {ap.get('title', 'N/A')}")
            print(f"    ID: {ap.get('id')}")
            print(f"    Status: {ap.get('status')}")
            print(f"    Entity: {ap.get('entityType')} {ap.get('entityNumber', '')}")
            print(f"    Amount: Rp {ap.get('amount', 0):,.0f}")
else:
    print(f"Failed to fetch approvals: {approvals_response.status_code}")
    print(f"Response: {approvals_response.text}")

# Check payment_approval specifically
print("\n" + "="*80)
print("PAYMENT_APPROVAL CONCERNS")
print("="*80)
payment_approvals_response = session.get(f"{BASE_URL}/approvals?type=payment_approval", timeout=30)
if payment_approvals_response.status_code == 200:
    payment_approvals = payment_approvals_response.json().get('data', [])
    print(f"Total payment_approval concerns: {len(payment_approvals)}\n")
    
    if len(payment_approvals) == 0:
        print("No payment_approval concerns found.")
    else:
        for ap in payment_approvals:
            print(f"Payment Approval: {ap.get('title', 'N/A')}")
            print(f"  ID: {ap.get('id')}")
            print(f"  Status: {ap.get('status')}")
            print(f"  Entity: {ap.get('entityType')} {ap.get('entityNumber', '')}")
            print(f"  Amount: Rp {ap.get('amount', 0):,.0f}")
            print(f"  Created: {ap.get('createdAt', 'N/A')}")
            print()
else:
    print(f"Failed to fetch payment_approval concerns: {payment_approvals_response.status_code}")

# Check notifications
print("="*80)
print("AKUNTAN NOTIFICATIONS")
print("="*80)
notifs_response = session.get(f"{BASE_URL}/notifications", timeout=30)
if notifs_response.status_code == 200:
    notifs = notifs_response.json().get('data', [])
    print(f"Total notifications: {len(notifs)}\n")
    
    # Show first 5 notifications
    for notif in notifs[:5]:
        print(f"Notification: {notif.get('title', 'N/A')}")
        print(f"  Category: {notif.get('category', 'N/A')}")
        print(f"  Type: {notif.get('type', 'N/A')}")
        print(f"  Message: {notif.get('message', 'N/A')[:100]}...")
        print(f"  Read: {notif.get('isRead', False)}")
        print()
else:
    print(f"Failed to fetch notifications: {notifs_response.status_code}")
