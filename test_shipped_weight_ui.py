#!/usr/bin/env python3
import requests
import json
import time

BASE_URL = "http://localhost:3000/api"

# Login
print("=== Step 1: Login ===")
session = requests.Session()
login_res = session.post(f"{BASE_URL}/auth/sign-in/email", json={
    "email": "admin@lpi.co.id",
    "password": "admin123"
})
print(f"Login: {login_res.status_code}")

# Get contacts
print("\n=== Step 2: Get Supplier and Customer ===")
contacts_res = session.get(f"{BASE_URL}/contacts")
contacts_data = contacts_res.json()
contacts = contacts_data.get("data", contacts_data) if isinstance(contacts_data, dict) else contacts_data

supplier = next((c for c in contacts if "Supplier" in (c.get("categories") or [])), None)
customer = next((c for c in contacts if "Customer" in (c.get("categories") or [])), None)

if not supplier or not customer:
    print("ERROR: Need at least one Supplier and one Customer")
    print(f"Contacts response: {contacts_res.text[:500]}")
    exit(1)

print(f"Supplier: {supplier['code']} - {supplier['displayName']}")
print(f"Customer: {customer['code']} - {customer['displayName']}")

# Get products
print("\n=== Step 3: Get Product ===")
products_res = session.get(f"{BASE_URL}/products")
products_data = products_res.json()
products = products_data.get("data", products_data) if isinstance(products_data, dict) else products_data
product = products[0] if products else None

if not product:
    print("ERROR: Need at least one product")
    exit(1)

print(f"Product: {product['sku']} - {product['name']}")

# Create dropship SO
print("\n=== Step 4: Create Dropship SO ===")
so_payload = {
    "customerId": customer["id"],
    "fulfillmentType": "dropship",
    "supplierId": supplier["id"],
    "orderDate": "2026-08-08",
    "paymentTerm": "TOP 14",
    "dpAmount": 0,
    "items": [{
        "productId": product["id"],
        "quantity": 10,
        "weight": 100,
        "unitPrice": 50000,
        "buyPrice": 40000,
        "discount": 0
    }],
    "notes": "Test dropship SO for shipped weight bugfix"
}

so_res = session.post(f"{BASE_URL}/sales-orders", json=so_payload)
if so_res.status_code != 201:
    print(f"ERROR creating SO: {so_res.status_code} - {so_res.text}")
    exit(1)

so = so_res.json()["data"]
print(f"✓ SO created: {so['soNumber']} (ID: {so['id']})")
print(f"✓ Initial SO total: Rp {so['totalAmount']:,}")
print(f"✓ Auto-PO ID: {so.get('autoPoId')}")

# Advance to Confirmed
print("\n=== Step 5: Advance to Confirmed ===")
conf_res = session.post(f"{BASE_URL}/sales-orders/{so['id']}/status", json={"status": "Confirmed"})
print(f"Confirmed: {conf_res.status_code}")

# Advance to Packed
print("\n=== Step 6: Advance to Packed ===")
packed_res = session.post(f"{BASE_URL}/sales-orders/{so['id']}/status", json={"status": "Packed"})
print(f"Packed: {packed_res.status_code}")

# Get SO items
so_detail_res = session.get(f"{BASE_URL}/sales-orders/{so['id']}")
so_detail = so_detail_res.json()["data"]
item_id = so_detail["items"][0]["id"]
print(f"✓ SO item ID: {item_id}")

# Create Surat Jalan with shipped weight 80kg
print("\n=== Step 7: Create Surat Jalan with shipped weight 80kg ===")
sj_payload = {
    "deliveryDate": "2026-08-08",
    "driverName": "Test Driver",
    "vehicleNumber": "B 1234 XYZ",
    "items": [{
        "itemId": item_id,
        "shippedWeight": 80
    }],
    "notes": "Test SJ with shipped weight 80kg"
}

sj_res = session.post(f"{BASE_URL}/sales-orders/{so['id']}/surat-jalan", json=sj_payload)
if sj_res.status_code != 201:
    print(f"ERROR creating SJ: {sj_res.status_code} - {sj_res.text}")
    exit(1)

sj = sj_res.json()["data"]
print(f"✓ Surat Jalan created: {sj['sjNumber']}")

# Verify SO updated
print("\n=== Step 8: Verify SO updated ===")
so_updated_res = session.get(f"{BASE_URL}/sales-orders/{so['id']}")
so_updated = so_updated_res.json()["data"]

print(f"SO Number: {so_updated['soNumber']}")
print(f"SO Total BEFORE SJ: Rp {so['totalAmount']:,}")
print(f"SO Total AFTER SJ: Rp {so_updated['totalAmount']:,}")
print(f"Expected: Rp 4,000,000 (50000 × 80kg)")

if so_updated['totalAmount'] == 4000000:
    print("✅ SO total correctly updated to Rp 4,000,000")
else:
    print(f"❌ SO total NOT updated correctly. Got: Rp {so_updated['totalAmount']:,}")

# Check item shipped weight
item_updated = so_updated["items"][0]
print(f"\nItem weight (ordered): {item_updated['weight']} kg")
print(f"Item shippedWeight: {item_updated.get('shippedWeight', 'NOT SET')} kg")

if item_updated.get('shippedWeight') == 80:
    print("✅ Item shippedWeight correctly set to 80 kg")
else:
    print(f"❌ Item shippedWeight NOT set correctly")

# Verify PO updated
print("\n=== Step 9: Verify PO updated ===")
if so.get('autoPoId'):
    po_res = session.get(f"{BASE_URL}/purchase-orders/{so['autoPoId']}")
    po = po_res.json()["data"]
    
    print(f"PO Number: {po['poNumber']}")
    print(f"PO Total: Rp {po['totalAmount']:,}")
    print(f"Expected: Rp 3,200,000 (40000 × 80kg)")
    
    if po['totalAmount'] == 3200000:
        print("✅ PO total correctly updated to Rp 3,200,000")
    else:
        print(f"❌ PO total NOT updated correctly. Got: Rp {po['totalAmount']:,}")
    
    # Check PO item weight
    po_item = po["items"][0]
    print(f"\nPO item weight: {po_item['weight']} kg")
    print(f"Expected: 80 kg")
    
    if po_item['weight'] == 80:
        print("✅ PO item weight correctly updated to 80 kg")
    else:
        print(f"❌ PO item weight NOT updated correctly. Got: {po_item['weight']} kg")
    
    po_number = po.get('poNumber')
else:
    print("❌ No auto-PO created")
    po_number = None

print(f"\n=== Test Data Created ===")
print(f"SO ID: {so['id']}")
print(f"SO Number: {so_updated['soNumber']}")
print(f"SJ Number: {sj['sjNumber']}")
print(f"PO ID: {so.get('autoPoId')}")
print(f"\nNavigate to: http://localhost:3000/dashboard/sales-orders/{so['id']}")

# Save IDs for UI test
with open("/app/test_ids.json", "w") as f:
    json.dump({
        "so_id": so['id'],
        "so_number": so_updated['soNumber'],
        "sj_number": sj['sjNumber'],
        "po_id": so.get('autoPoId'),
        "po_number": po_number
    }, f)

print("\nTest IDs saved to /app/test_ids.json")
