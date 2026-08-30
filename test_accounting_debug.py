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

# Get trial balance
tb_response = session.get(f"{BASE_URL}/accounting/trial-balance")
print(f"\nTrial Balance: {tb_response.status_code}")
print(f"Response type: {type(tb_response.json())}")
print(f"Response keys: {tb_response.json().keys() if isinstance(tb_response.json(), dict) else 'Not a dict'}")
print(f"\nFull response:")
print(json.dumps(tb_response.json(), indent=2)[:1000])

# Get balance sheet
bs_response = session.get(f"{BASE_URL}/accounting/balance-sheet")
print(f"\n\nBalance Sheet: {bs_response.status_code}")
print(json.dumps(bs_response.json(), indent=2)[:1000])
