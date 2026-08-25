import requests
import json
from datetime import datetime

BASE_URL = "https://github-to-production.preview.emergentagent.com/api"
session = requests.Session()

# Login
response = session.post(f"{BASE_URL}/auth/sign-in/email", json={"email": "admin@lpi.co.id", "password": "admin123"})
print(f"Login: {response.status_code}")

# Get IDs
response = session.get(f"{BASE_URL}/contacts")
contacts = response.json().get('data', [])
customer_id = next((c['id'] for c in contacts if c.get('code') == 'CUST-100'), None)
dropshipper_id = next((c['id'] for c in contacts if c.get('code') == 'DS-100'), None)

response = session.get(f"{BASE_URL}/products")
products = response.json().get('data', [])
product_id = next((p['id'] for p in products if p.get('sku') == 'KRK-100'), None)

print(f"\nTest Data:")
print(f"  Customer ID: {customer_id}")
print(f"  Dropshipper ID: {dropshipper_id}")
print(f"  Product ID: {product_id}")

# Create SO with dropshipperId
payload = {
    "customerId": customer_id,
    "dropshipperId": dropshipper_id,
    "orderDate": datetime.now().isoformat(),
    "items": [
        {
            "productId": product_id,
            "quantity": 1,
            "weight": 50,
            "unitPrice": 40000,
            "discount": 0
        }
    ]
}

print(f"\nCreating SO with dropshipperId...")
print(f"Payload: {json.dumps(payload, indent=2)}")

response = session.post(f"{BASE_URL}/sales-orders", json=payload)
print(f"\nResponse Status: {response.status_code}")
print(f"Response Body: {json.dumps(response.json(), indent=2)}")

if response.status_code == 201:
    data = response.json()
    commission = data.get('commission')
    print(f"\n✅ Commission in response: {commission}")
    
    if commission:
        print(f"   Amount: {commission.get('amount')}")
        print(f"   Total Weight: {commission.get('totalWeight')}")
        print(f"   Revenue: {commission.get('revenue')}")
    else:
        print(f"   ❌ No commission object in response")
