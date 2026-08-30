#!/usr/bin/env python3
import requests
import json

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"

# Login as akuntan
session = requests.Session()
response = session.post(
    f"{BASE_URL}/auth/sign-in/email",
    json={"email": "akuntan@lpi.co.id", "password": "akuntanlpi123"}
)
print(f"Login: {response.status_code}")

# Get balance sheet multiple times to see if it's a timing issue
for i in range(3):
    bs_response = session.get(f"{BASE_URL}/accounting/balance-sheet")
    print(f"\nBalance Sheet attempt {i+1}: {bs_response.status_code}")
    bs_data = bs_response.json()
    print(f"  Balanced: {bs_data.get('balanced', 'N/A')}")
    print(f"  Total Assets: {bs_data.get('totalAssets', 'N/A')}")
    print(f"  Total Liabilities: {bs_data.get('totalLiabilities', 'N/A')}")
    print(f"  Total Equity: {bs_data.get('totalEquity', 'N/A')}")
    
    # Check if data is nested
    if 'data' in bs_data:
        data = bs_data['data']
        print(f"  Data.balanced: {data.get('balanced', 'N/A')}")
        print(f"  Data.assets.total: {data.get('assets', {}).get('total', 'N/A')}")
        print(f"  Data.liabilities.total: {data.get('liabilities', {}).get('total', 'N/A')}")
        print(f"  Data.equity.total: {data.get('equity', {}).get('total', 'N/A')}")
