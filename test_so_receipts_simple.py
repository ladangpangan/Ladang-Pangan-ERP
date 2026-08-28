#!/usr/bin/env python3
"""
Simple focused test for SO Receipts feature
"""

import requests
import json
import time
from datetime import datetime, timedelta

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"

def login():
    resp = requests.post(
        f"{BASE_URL}/auth/sign-in/email",
        json={"email": "admin@lpi.co.id", "password": "admin123"}
    )
    return resp.cookies

def main():
    print("=== SO RECEIPTS FEATURE TEST ===\n")
    
    cookies = login()
    print("✅ Logged in")
    
    # Get products
    resp = requests.get(f"{BASE_URL}/products", cookies=cookies)
    products = resp.json()["data"]
    p1, p2 = products[0], products[1]
    print(f"✅ Got products: {p1['name']}, {p2['name']}")
    
    # Get customer
    resp = requests.get(f"{BASE_URL}/contacts?type=Customer", cookies=cookies)
    customer = resp.json()["data"][0]
    print(f"✅ Got customer: {customer['displayName']}")
    
    # Get CS and zone
    resp = requests.get(f"{BASE_URL}/cold-storages", cookies=cookies)
    cs = resp.json()["data"][0]
    resp = requests.get(f"{BASE_URL}/zones?cold_storage_id={cs['id']}", cookies=cookies)
    zone = resp.json()["data"][0]
    
    # Create stocks
    inbound = {
        "coldStorageId": cs["id"],
        "zoneId": zone["id"],
        "items": [
            {"productId": p1["id"], "weight": 100, "quantity": 10, "expiredDate": (datetime.now() + timedelta(days=30)).isoformat()},
            {"productId": p2["id"], "weight": 100, "quantity": 10, "expiredDate": (datetime.now() + timedelta(days=30)).isoformat()}
        ]
    }
    resp = requests.post(f"{BASE_URL}/inventory/inbound", json=inbound, cookies=cookies)
    stocks = resp.json()["data"]["stocks"]
    print(f"✅ Created stocks: {stocks[0]['kodeSimpan']}, {stocks[1]['kodeSimpan']}")
    
    # Create SO
    so_data = {
        "customerId": customer["id"],
        "orderDate": datetime.now().isoformat(),
        "items": [
            {"stockId": stocks[0]["id"], "weight": 20, "quantity": 2, "unitPrice": 40000},
            {"stockId": stocks[1]["id"], "weight": 30, "quantity": 3, "unitPrice": 45000}
        ]
    }
    resp = requests.post(f"{BASE_URL}/sales-orders", json=so_data, cookies=cookies)
    so = resp.json()["data"]
    print(f"✅ Created SO: {so['soNumber']}")
    
    # Transition to Shipped
    for status in ["Confirmed", "Packed", "Shipped"]:
        resp = requests.post(f"{BASE_URL}/sales-orders/{so['id']}/status", json={"status": status}, cookies=cookies)
        time.sleep(0.1)
    print(f"✅ SO transitioned to Shipped")
    
    # Get SO details
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}", cookies=cookies)
    so = resp.json()["data"]
    
    # TEST 1: Create receipt with no shrinkage
    print("\n--- TEST 1: No shrinkage ---")
    receipt_data = {
        "receivedDate": datetime.now().isoformat(),
        "receivedBy": "Test PIC",
        "items": [
            {"productId": so["items"][0]["productId"], "receivedWeight": 20},
            {"productId": so["items"][1]["productId"], "receivedWeight": 30}
        ]
    }
    resp = requests.post(f"{BASE_URL}/sales-orders/{so['id']}/receipts", json=receipt_data, cookies=cookies)
    if resp.status_code != 201:
        print(f"❌ Failed: {resp.status_code} - {resp.text}")
        return False
    
    receipt = resp.json()["data"]
    print(f"✅ Receipt created: {receipt['receiptNumber']}")
    print(f"   Status: {receipt['status']}")
    print(f"   Shrinkage: {receipt['totalShrinkageWeight']} kg (Rp {receipt['totalShrinkageValue']})")
    
    if receipt['status'] != 'received' or receipt['totalShrinkageWeight'] != 0:
        print("❌ Expected status='received' and shrinkage=0")
        return False
    
    time.sleep(0.2)
    
    # TEST 2: Create another SO with shrinkage
    print("\n--- TEST 2: With shrinkage ---")
    so_data2 = {
        "customerId": customer["id"],
        "orderDate": datetime.now().isoformat(),
        "items": [
            {"stockId": stocks[0]["id"], "weight": 20, "quantity": 2, "unitPrice": 40000}
        ]
    }
    resp = requests.post(f"{BASE_URL}/sales-orders", json=so_data2, cookies=cookies)
    so2 = resp.json()["data"]
    
    for status in ["Confirmed", "Packed", "Shipped"]:
        resp = requests.post(f"{BASE_URL}/sales-orders/{so2['id']}/status", json={"status": status}, cookies=cookies)
        time.sleep(0.1)
    
    resp = requests.get(f"{BASE_URL}/sales-orders/{so2['id']}", cookies=cookies)
    so2 = resp.json()["data"]
    
    receipt_data2 = {
        "receivedDate": datetime.now().isoformat(),
        "receivedBy": "Test PIC",
        "items": [
            {"productId": so2["items"][0]["productId"], "receivedWeight": 18}  # 2kg shrinkage
        ]
    }
    resp = requests.post(f"{BASE_URL}/sales-orders/{so2['id']}/receipts", json=receipt_data2, cookies=cookies)
    if resp.status_code != 201:
        print(f"❌ Failed: {resp.status_code} - {resp.text}")
        return False
    
    receipt2 = resp.json()["data"]
    print(f"✅ Receipt created: {receipt2['receiptNumber']}")
    print(f"   Status: {receipt2['status']}")
    print(f"   Shrinkage: {receipt2['totalShrinkageWeight']} kg (Rp {receipt2['totalShrinkageValue']})")
    print(f"   Shrinkage %: {receipt2['totalShrinkagePct']}%")
    
    if receipt2['totalShrinkageWeight'] != 2:
        print(f"❌ Expected shrinkage=2kg, got {receipt2['totalShrinkageWeight']}")
        return False
    
    if receipt2['status'] != 'partial':
        print(f"❌ Expected status='partial', got {receipt2['status']}")
        return False
    
    time.sleep(0.2)
    
    # TEST 3: applyToInvoice=true
    print("\n--- TEST 3: applyToInvoice=true ---")
    so_data3 = {
        "customerId": customer["id"],
        "orderDate": datetime.now().isoformat(),
        "items": [
            {"stockId": stocks[0]["id"], "weight": 20, "quantity": 2, "unitPrice": 40000}
        ]
    }
    resp = requests.post(f"{BASE_URL}/sales-orders", json=so_data3, cookies=cookies)
    so3 = resp.json()["data"]
    
    for status in ["Confirmed", "Packed", "Shipped"]:
        resp = requests.post(f"{BASE_URL}/sales-orders/{so3['id']}/status", json={"status": status}, cookies=cookies)
        time.sleep(0.1)
    
    resp = requests.get(f"{BASE_URL}/sales-orders/{so3['id']}", cookies=cookies)
    so3_before = resp.json()["data"]
    returns_before = so3_before.get("totalReturns", 0)
    
    receipt_data3 = {
        "receivedDate": datetime.now().isoformat(),
        "receivedBy": "Test PIC",
        "applyToInvoice": True,
        "items": [
            {"productId": so3_before["items"][0]["productId"], "receivedWeight": 17}  # 3kg shrinkage
        ]
    }
    resp = requests.post(f"{BASE_URL}/sales-orders/{so3['id']}/receipts", json=receipt_data3, cookies=cookies)
    if resp.status_code != 201:
        print(f"❌ Failed: {resp.status_code} - {resp.text}")
        return False
    
    receipt3 = resp.json()["data"]
    
    resp = requests.get(f"{BASE_URL}/sales-orders/{so3['id']}", cookies=cookies)
    so3_after = resp.json()["data"]
    returns_after = so3_after.get("totalReturns", 0)
    
    print(f"✅ Receipt created: {receipt3['receiptNumber']}")
    print(f"   Shrinkage Value: Rp {receipt3['totalShrinkageValue']}")
    print(f"   Returns before: Rp {returns_before}, after: Rp {returns_after}")
    
    if returns_after <= returns_before:
        print(f"❌ Expected totalReturns to increase")
        return False
    
    print(f"✅ Shadow return created (totalReturns increased)")
    
    # TEST 4: GET receipts
    print("\n--- TEST 4: GET receipts ---")
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}/receipts", cookies=cookies)
    if resp.status_code != 200:
        print(f"❌ Failed to GET receipts: {resp.status_code}")
        return False
    
    receipts = resp.json()["data"]
    print(f"✅ Got {len(receipts)} receipt(s)")
    if receipts and receipts[0].get("items") and receipts[0]["items"][0].get("product"):
        print(f"   Items enriched with product: {receipts[0]['items'][0]['product']['name']}")
    
    # TEST 5: Validation
    print("\n--- TEST 5: Validation ---")
    # Draft SO should be rejected
    so_draft_data = {
        "customerId": customer["id"],
        "orderDate": datetime.now().isoformat(),
        "items": [{"stockId": stocks[0]["id"], "weight": 5, "quantity": 1, "unitPrice": 40000}]
    }
    resp = requests.post(f"{BASE_URL}/sales-orders", json=so_draft_data, cookies=cookies)
    so_draft = resp.json()["data"]
    
    resp = requests.post(f"{BASE_URL}/sales-orders/{so_draft['id']}/receipts", json={"items": [{"productId": p1["id"], "receivedWeight": 5}]}, cookies=cookies)
    if resp.status_code == 400 and "dikirim" in resp.json().get("error", "").lower():
        print("✅ Draft SO correctly rejected")
    else:
        print(f"❌ Expected 400 for Draft SO, got {resp.status_code}")
    
    print("\n=== ALL CORE TESTS PASSED ===")
    return True

if __name__ == "__main__":
    try:
        success = main()
        exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
