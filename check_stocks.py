#!/usr/bin/env python3
"""Check what stocks exist for product 8a7ad75c-5867-4b25-9c82-c6d7b31b3f9d"""

import requests

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

session = requests.Session()

# Login
login_resp = session.post(
    f"{BASE_URL}/auth/sign-in/email",
    json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    timeout=30
)

if login_resp.status_code != 200:
    print(f"Login failed: {login_resp.status_code}")
    exit(1)

# Get stocks for product
product_id = '8a7ad75c-5867-4b25-9c82-c6d7b31b3f9d'
stocks_resp = session.get(
    f"{BASE_URL}/inventory/stocks?product_id={product_id}&status=active",
    timeout=30
)

if stocks_resp.status_code != 200:
    print(f"Failed to get stocks: {stocks_resp.status_code}")
    exit(1)

stocks_data = stocks_resp.json()
stocks = stocks_data.get('data', [])

print(f"Found {len(stocks)} active stocks for product {product_id}:")
print()

for stock in stocks:
    kode = stock.get('kode_simpan')
    weight = stock.get('weight')
    product = stock.get('product', {})
    product_name = product.get('name', '')
    
    print(f"  Kode: {kode}")
    print(f"  Weight: {weight} kg")
    print(f"  Product name: '{product_name}'")
    print()
