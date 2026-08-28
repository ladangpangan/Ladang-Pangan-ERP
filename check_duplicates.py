#!/usr/bin/env python3
"""Check for duplicate SKUs in products"""

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

# Get all products
products_resp = session.get(f"{BASE_URL}/products", timeout=30)

if products_resp.status_code != 200:
    print(f"Failed to get products: {products_resp.status_code}")
    exit(1)

products_data = products_resp.json()
products = products_data.get('data', [])

print(f"Total products: {len(products)}")
print()

# Check for duplicate SKUs
sku_map = {}
for product in products:
    sku = product.get('sku')
    if sku not in sku_map:
        sku_map[sku] = []
    sku_map[sku].append(product)

# Find duplicates
duplicates = {sku: prods for sku, prods in sku_map.items() if len(prods) > 1}

if duplicates:
    print(f"Found {len(duplicates)} duplicate SKUs:")
    print()
    for sku, prods in duplicates.items():
        print(f"  SKU: {sku} ({len(prods)} products)")
        for p in prods:
            print(f"    - ID: {p.get('id')}, Name: '{p.get('name')}'")
        print()
else:
    print("✅ No duplicate SKUs found")
    print()

# Specifically check CUT11-100
cut11_products = [p for p in products if p.get('sku') == 'CUT11-100']
print(f"Products with SKU 'CUT11-100': {len(cut11_products)}")
for p in cut11_products:
    print(f"  - ID: {p.get('id')}, Name: '{p.get('name')}'")
