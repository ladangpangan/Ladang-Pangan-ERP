#!/usr/bin/env python3
"""
Debug: Check COA for required accounts and verify SO_SHIP journal logic
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

print(f"Login: {login.status_code}\n")

# Get trial balance to see all accounts
print("Fetching trial balance (all accounts)...")
tb_response = session.get(f"{BASE_URL}/accounting/trial-balance")

if tb_response.status_code == 200:
    tb_data = tb_response.json().get('data', {})
    accounts = tb_data.get('accounts', [])
    
    print(f"Found {len(accounts)} accounts\n")
    
    # Look for specific accounts
    beban_ongkir = next((a for a in accounts if a.get('code') == '6-1300'), None)
    kas = next((a for a in accounts if a.get('code') == '1-1110'), None)
    bank_bca = next((a for a in accounts if a.get('code') == '1-1120'), None)
    bank_mandiri = next((a for a in accounts if a.get('code') == '1-1121'), None)
    
    print("Required accounts for SO_SHIP journal:")
    print(f"  6-1300 (Beban Pengiriman/Ongkir): {'✅ FOUND' if beban_ongkir else '❌ NOT FOUND'}")
    if beban_ongkir:
        print(f"    Name: {beban_ongkir.get('name')}")
        print(f"    Balance: {beban_ongkir.get('balance')}")
    
    print(f"  1-1110 (Kas): {'✅ FOUND' if kas else '❌ NOT FOUND'}")
    if kas:
        print(f"    Name: {kas.get('name')}")
        print(f"    Balance: {kas.get('balance')}")
    
    print(f"  1-1120 (Bank BCA): {'✅ FOUND' if bank_bca else '❌ NOT FOUND'}")
    if bank_bca:
        print(f"    Name: {bank_bca.get('name')}")
        print(f"    Balance: {bank_bca.get('balance')}")
    
    print(f"  1-1121 (Bank Mandiri): {'✅ FOUND' if bank_mandiri else '❌ NOT FOUND'}")
    if bank_mandiri:
        print(f"    Name: {bank_mandiri.get('name')}")
        print(f"    Balance: {bank_mandiri.get('balance')}")

# Get all journals and look for shipping-related ones
print("\n" + "="*80)
print("Fetching ALL journals (limit 1000)...")
all_journals_response = session.get(f"{BASE_URL}/accounting/journals?limit=1000")

if all_journals_response.status_code == 200:
    all_journals = all_journals_response.json().get('data', [])
    print(f"Found {len(all_journals)} journals total\n")
    
    # Look for shipping-related journals
    shipping_journals = [j for j in all_journals if 'kirim' in str(j.get('description', '')).lower() or 'ongkir' in str(j.get('description', '')).lower()]
    
    print(f"Found {len(shipping_journals)} shipping-related journals:")
    for j in shipping_journals:
        print(f"\n  Journal: {j.get('description')}")
        print(f"    ID: {j.get('id')}")
        print(f"    Date: {j.get('date')}")
        print(f"    Source Type: {j.get('sourceType')}")
        print(f"    Source Key: {j.get('sourceKey')}")
        
        # Try to get full journal details
        if j.get('id'):
            detail_response = session.get(f"{BASE_URL}/accounting/journals/{j.get('id')}")
            if detail_response.status_code == 200:
                detail = detail_response.json().get('data', {})
                lines = detail.get('lines', [])
                if lines:
                    print(f"    Lines ({len(lines)}):")
                    for line in lines:
                        code = line.get('accountCode') or line.get('code')
                        debit = line.get('debit', 0)
                        credit = line.get('credit', 0)
                        print(f"      - {code}: Debit {debit}, Credit {credit}")
                else:
                    print(f"    Lines: EMPTY or not returned")
            else:
                print(f"    Could not fetch details: {detail_response.status_code}")

print("\n" + "="*80)
print("SUMMARY:")
print("="*80)

if beban_ongkir and (kas or bank_bca or bank_mandiri):
    print("✅ All required accounts exist in COA")
    print("✅ SO_SHIP journals SHOULD be generated for qualifying SOs")
else:
    print("❌ Some required accounts are missing from COA")
    print("   This would prevent SO_SHIP journal generation")
