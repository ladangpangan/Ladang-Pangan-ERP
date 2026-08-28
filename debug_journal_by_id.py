#!/usr/bin/env python3
"""
Debug: Get journal by ID directly
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

# Get journal by ID
journal_id = "e2425eb7-4053-4872-b2b3-ac83b47da0b1"
print(f"\nFetching journal {journal_id} directly...")

journal_response = session.get(f"{BASE_URL}/accounting/journals/{journal_id}")
print(f"Status: {journal_response.status_code}")

if journal_response.status_code == 200:
    journal = journal_response.json().get('data', {})
    print(f"\nJournal details:")
    print(json.dumps(journal, indent=2, default=str))
else:
    print(f"Error: {journal_response.text}")
