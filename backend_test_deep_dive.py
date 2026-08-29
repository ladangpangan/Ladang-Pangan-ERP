#!/usr/bin/env python3
"""
Backend Test: Deep dive into accounting and archived docs
"""

import requests
import json

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"

def login_akuntan():
    session = requests.Session()
    response = session.post(
        f"{BASE_URL}/auth/sign-in/email",
        json={"email": "akuntan@lpi.co.id", "password": "akuntanlpi123"}
    )
    if response.status_code == 200:
        return session
    return None

def check_accounting_details():
    """Check accounting in detail."""
    print("\n" + "="*80)
    print("ACCOUNTING DEEP DIVE")
    print("="*80)
    
    session = login_akuntan()
    if not session:
        print("❌ Login failed")
        return
    
    print("✅ Akuntan login successful")
    
    # Balance sheet
    print("\n📊 Balance Sheet:")
    bs_response = session.get(f"{BASE_URL}/accounting/balance-sheet")
    print(f"   Status: {bs_response.status_code}")
    
    if bs_response.status_code == 200:
        bs_data = bs_response.json()
        print(f"   Response keys: {list(bs_data.keys())}")
        print(f"   Full response: {json.dumps(bs_data, indent=2)[:500]}")
    
    # Trial balance
    print("\n📊 Trial Balance:")
    tb_response = session.get(f"{BASE_URL}/accounting/trial-balance")
    print(f"   Status: {tb_response.status_code}")
    
    if tb_response.status_code == 200:
        tb_data = tb_response.json()
        if isinstance(tb_data, list):
            print(f"   Accounts: {len(tb_data)}")
            if len(tb_data) > 0:
                print(f"   First account: {json.dumps(tb_data[0], indent=2)}")
        else:
            print(f"   Response keys: {list(tb_data.keys())}")
            accounts = tb_data.get("accounts", [])
            print(f"   Accounts: {len(accounts)}")
            if len(accounts) > 0:
                print(f"   First account: {json.dumps(accounts[0], indent=2)}")
    
    # Journal entries
    print("\n📊 Journal Entries:")
    je_response = session.get(f"{BASE_URL}/accounting/journal-entries")
    print(f"   Status: {je_response.status_code}")
    
    if je_response.status_code == 200:
        je_data = je_response.json()
        if isinstance(je_data, list):
            print(f"   Entries: {len(je_data)}")
        else:
            entries = je_data.get("data", [])
            print(f"   Entries: {len(entries)}")

def check_archived_filter():
    """Check if archived SOs are filtered by default."""
    print("\n" + "="*80)
    print("ARCHIVED DOCUMENT FILTER CHECK")
    print("="*80)
    
    session = requests.Session()
    session.post(
        f"{BASE_URL}/auth/sign-in/email",
        json={"email": "admin@lpi.co.id", "password": "admin123"}
    )
    
    # Try different query parameters
    queries = [
        "",
        "?archived=false",
        "?archived=true",
        "?archived=all",
        "?includeArchived=true"
    ]
    
    print("\n📦 Sales Orders with different filters:")
    for query in queries:
        response = session.get(f"{BASE_URL}/sales-orders{query}")
        if response.status_code == 200:
            data = response.json()
            count = len(data) if isinstance(data, list) else len(data.get("data", []))
            print(f"   {query or '(no filter)'}: {count} SOs")
        else:
            print(f"   {query or '(no filter)'}: HTTP {response.status_code}")
    
    # Check if SO/202608/0002 exists with archived=all
    print("\n🔍 Looking for SO/202608/0002:")
    response = session.get(f"{BASE_URL}/sales-orders?archived=all")
    if response.status_code == 200:
        data = response.json()
        sales_orders = data if isinstance(data, list) else data.get("data", [])
        
        for so in sales_orders:
            so_number = so.get("soNumber") or so.get("so_number")
            if so_number == "SO/202608/0002":
                print(f"   ✅ Found SO/202608/0002:")
                print(f"      Status: {so.get('status')}")
                print(f"      Archived: {so.get('archived', False)}")
                print(f"      ID: {so.get('id')}")
                return
        
        print(f"   ⚠️  SO/202608/0002 not found even with archived=all")
    else:
        print(f"   ❌ Failed to fetch: {response.status_code}")

def main():
    check_accounting_details()
    check_archived_filter()

if __name__ == "__main__":
    main()
