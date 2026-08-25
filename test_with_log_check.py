import requests
import json
from datetime import datetime
import time
import subprocess

BASE_URL = "https://data-source-verify.preview.emergentagent.com/api"
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
response = session.post(f"{BASE_URL}/sales-orders", json=payload)
print(f"Response Status: {response.status_code}")

if response.status_code == 201:
    data = response.json()
    commission = data.get('commission')
    print(f"Commission in response: {commission}")
    
    # Wait a bit and check logs
    time.sleep(1)
    result = subprocess.run(['tail', '-50', '/var/log/supervisor/nextjs.out.log'], capture_output=True, text=True)
    print(f"\n=== Recent Logs ===")
    for line in result.stdout.split('\n'):
        if 'commission' in line.lower() or 'error' in line.lower():
            print(line)
