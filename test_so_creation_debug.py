#!/usr/bin/env python3
"""
Debug SO creation FOREIGN KEY error
"""
import requests
import json

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"

# Login as admin
session = requests.Session()
response = session.post(
    f"{BASE_URL}/auth/sign-in/email",
    json={"email": "admin@lpi.co.id", "password": "admin123"}
)
print(f"Login: {response.status_code}\n")

# Get contacts
contacts_response = session.get(f"{BASE_URL}/contacts")
print(f"GET /contacts: {contacts_response.status_code}")
contacts = contacts_response.json().get("data", [])
print(f"Total contacts: {len(contacts)}")

# Find a customer
customer = next((c for c in contacts if "Customer" in c.get("categories", [])), None)
if customer:
    customer_id = customer.get("id")
    print(f"Found customer: {customer.get('displayName')} (ID: {customer_id})")
    
    # Try to get this specific customer
    customer_detail = session.get(f"{BASE_URL}/contacts/{customer_id}")
    print(f"GET /contacts/{customer_id}: {customer_detail.status_code}")
else:
    print("No customer found")
    exit(1)

# Get products
products_response = session.get(f"{BASE_URL}/products")
print(f"\nGET /products: {products_response.status_code}")
products = products_response.json().get("data", [])
print(f"Total products: {len(products)}")

if products:
    product = products[0]
    product_id = product.get("id")
    print(f"Found product: {product.get('name')} (ID: {product_id})")
    
    # Try to get this specific product
    product_detail = session.get(f"{BASE_URL}/products/{product_id}")
    print(f"GET /products/{product_id}: {product_detail.status_code}")
else:
    print("No products found")
    exit(1)

# Try to create SO with minimal payload
print(f"\n=== Attempting SO creation ===")
so_payload = {
    "customerId": customer_id,
    "expectedDate": "2026-08-31",
    "items": [
        {
            "productId": product_id,
            "quantity": 1,
            "weight": 10.0,
            "unitPrice": 50000
        }
    ]
}

print(f"Payload: {json.dumps(so_payload, indent=2)}")

create_response = session.post(
    f"{BASE_URL}/sales-orders",
    json=so_payload,
    headers={"Content-Type": "application/json"}
)
print(f"\nPOST /sales-orders: {create_response.status_code}")
print(f"Response: {create_response.text[:500]}")

# If it failed, try with even simpler payload (no items)
if create_response.status_code != 200 and create_response.status_code != 201:
    print(f"\n=== Trying without items ===")
    simple_payload = {
        "customerId": customer_id,
        "expectedDate": "2026-08-31"
    }
    
    simple_response = session.post(
        f"{BASE_URL}/sales-orders",
        json=simple_payload,
        headers={"Content-Type": "application/json"}
    )
    print(f"POST /sales-orders (no items): {simple_response.status_code}")
    print(f"Response: {simple_response.text[:500]}")
