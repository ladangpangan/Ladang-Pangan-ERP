import requests
import json

BASE_URL = "https://github-to-production.preview.emergentagent.com/api"
session = requests.Session()

# Login
response = session.post(f"{BASE_URL}/auth/sign-in/email", json={"email": "admin@lpi.co.id", "password": "admin123"})
print(f"Login: {response.status_code}")

# Get the SO we created (SO/202608/0003)
response = session.get(f"{BASE_URL}/sales-orders")
if response.status_code == 200:
    sos = response.json().get('data', [])
    for so in sos:
        if so.get('soNumber') == 'SO/202608/0003':
            print(f"\nSO Details:")
            print(f"  SO Number: {so.get('soNumber')}")
            print(f"  Total Amount: {so.get('totalAmount')}")
            
            # Get full detail
            so_id = so.get('id')
            detail_response = session.get(f"{BASE_URL}/sales-orders/{so_id}")
            if detail_response.status_code == 200:
                detail = detail_response.json().get('data', {})
                print(f"  Items: {len(detail.get('items', []))}")
                for item in detail.get('items', []):
                    print(f"    - Product: {item.get('product', {}).get('name')}")
                    print(f"      Weight: {item.get('weight')}")
                    print(f"      Unit Price: {item.get('unitPrice')}")
                    print(f"      Subtotal: {item.get('subtotal')}")
            break

# Check commission records for DS-100
response = session.get(f"{BASE_URL}/contacts")
if response.status_code == 200:
    contacts = response.json().get('data', [])
    for c in contacts:
        if c.get('code') == 'DS-100':
            ds_id = c['id']
            print(f"\nChecking commissions for DS-100 ({ds_id})...")
            comm_response = session.get(f"{BASE_URL}/contacts/{ds_id}/commissions")
            if comm_response.status_code == 200:
                comm_data = comm_response.json()
                print(f"  Records: {len(comm_data.get('records', []))}")
                print(f"  Summary: {json.dumps(comm_data.get('summary', {}), indent=2)}")
                for rec in comm_data.get('records', []):
                    print(f"\n  Record:")
                    print(f"    SO Number: {rec.get('soNumber')}")
                    print(f"    Commission Type: {rec.get('commissionType')}")
                    print(f"    Commission Value: {rec.get('commissionValue')}")
                    print(f"    Basis Amount: {rec.get('basisAmount')}")
                    print(f"    Commission Amount: {rec.get('commissionAmount')}")
                    print(f"    Status: {rec.get('status')}")
            break
