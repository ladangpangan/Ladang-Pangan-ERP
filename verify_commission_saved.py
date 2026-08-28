import requests

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"
session = requests.Session()

# Login
response = session.post(f"{BASE_URL}/auth/sign-in/email", json={"email": "admin@lpi.co.id", "password": "admin123"})

# Get DS-100 ID
response = session.get(f"{BASE_URL}/contacts")
contacts = response.json().get('data', [])
dropshipper_id = next((c['id'] for c in contacts if c.get('code') == 'DS-100'), None)

# Get commissions
response = session.get(f"{BASE_URL}/contacts/{dropshipper_id}/commissions")
if response.status_code == 200:
    data = response.json()
    records = data.get('records', [])
    summary = data.get('summary', {})
    
    print(f"Commission Records for DS-100:")
    print(f"  Total Records: {len(records)}")
    print(f"  Total Commission: Rp {summary.get('totalCommission', 0):,.0f}")
    print(f"  Outstanding: Rp {summary.get('outstanding', 0):,.0f}")
    
    for rec in records:
        print(f"\n  Record:")
        print(f"    SO Number: {rec.get('soNumber')}")
        print(f"    Amount: Rp {rec.get('commissionAmount', 0):,.0f}")
        print(f"    Status: {rec.get('status')}")
        print(f"    Type: {rec.get('commissionType')}")
        print(f"    Value: {rec.get('commissionValue')}")
