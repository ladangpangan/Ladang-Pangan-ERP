#!/usr/bin/env python3
"""
Backend API Test Suite for LPI ERP - SO Receipts (Penerimaan Customer + Penyusutan per SO per Produk)
Tests the new Sales Order Receipts feature with comprehensive validation.
"""

import requests
import json
import sys
import time
from datetime import datetime, timedelta

# Configuration
BASE_URL = "https://pangan-system.preview.emergentagent.com/api"
CREDENTIALS = {
    "admin": {"email": "admin@lpi.co.id", "password": "admin123"},
    "supervisor": {"email": "supervisor@lpi.co.id", "password": "super123"},
    "direktur": {"email": "direktur@lpi.co.id", "password": "direktur123"},
    "operator": {"email": "operator@lpi.co.id", "password": "operator123"},
}

# Test state
sessions = {}
test_data = {
    "customers": [],
    "products": [],
    "stocks": [],
    "sales_orders": [],
    "receipts": [],
}

def login(role):
    """Login and return session cookies"""
    if role in sessions:
        return sessions[role]
    
    creds = CREDENTIALS[role]
    resp = requests.post(
        f"{BASE_URL}/auth/sign-in/email",
        json={"email": creds["email"], "password": creds["password"]},
        headers={"Content-Type": "application/json"}
    )
    if resp.status_code == 200:
        sessions[role] = resp.cookies
        print(f"✅ Logged in as {role}")
        return resp.cookies
    else:
        print(f"❌ Login failed for {role}: {resp.status_code}")
        return None

def test_setup():
    """Setup test data: create SO in Shipped status with 2+ products"""
    print("\n=== TEST SETUP: Creating SO in Shipped status ===")
    
    cookies = login("admin")
    
    # Get products
    resp = requests.get(f"{BASE_URL}/products", cookies=cookies)
    if resp.status_code != 200:
        print(f"❌ Failed to get products: {resp.status_code}")
        return False
    
    products = resp.json().get("data", [])
    if len(products) < 2:
        print(f"❌ Need at least 2 products, found {len(products)}")
        return False
    
    # Pick 2 different products
    product1 = products[0]
    product2 = products[1]
    
    print(f"✅ Selected products: {product1['name']} ({product1['sku']}), {product2['name']} ({product2['sku']})")
    
    # Get cold storage and zone
    resp = requests.get(f"{BASE_URL}/cold-storages", cookies=cookies)
    if resp.status_code != 200:
        print(f"❌ Failed to get cold storages: {resp.status_code}")
        return False
    
    cold_storages = resp.json().get("data", [])
    if not cold_storages:
        print("❌ No cold storages found")
        return False
    
    cs = cold_storages[0]
    
    resp = requests.get(f"{BASE_URL}/zones?cold_storage_id={cs['id']}", cookies=cookies)
    if resp.status_code != 200:
        print(f"❌ Failed to get zones: {resp.status_code}")
        return False
    
    zones = resp.json().get("data", [])
    if not zones:
        print("❌ No zones found")
        return False
    
    zone = zones[0]
    
    # Create inventory stocks with different products (enough for all tests)
    from datetime import datetime, timedelta
    
    inbound_data = {
        "coldStorageId": cs["id"],
        "zoneId": zone["id"],
        "referenceType": "MANUAL",
        "notes": "Test stocks for SO receipts testing",
        "items": [
            {
                "productId": product1["id"],
                "weight": 200,  # Increased for multiple tests
                "quantity": 20,
                "expiredDate": (datetime.now() + timedelta(days=30)).isoformat(),
                "packagingType": "karung"
            },
            {
                "productId": product2["id"],
                "weight": 200,  # Increased for multiple tests
                "quantity": 20,
                "expiredDate": (datetime.now() + timedelta(days=30)).isoformat(),
                "packagingType": "karung"
            }
        ]
    }
    
    resp = requests.post(f"{BASE_URL}/inventory/inbound", json=inbound_data, cookies=cookies)
    if resp.status_code != 201:
        print(f"❌ Failed to create stocks: {resp.status_code} - {resp.text}")
        return False
    
    created_data = resp.json()["data"]
    created_stocks = created_data.get("stocks", [])
    if len(created_stocks) < 2:
        print(f"❌ Expected 2 stocks, got {len(created_stocks)}")
        return False
    
    stock1 = created_stocks[0]
    stock2 = created_stocks[1]
    print(f"✅ Created stock 1: {stock1['kodeSimpan']} ({product1['name']}, 200kg)")
    print(f"✅ Created stock 2: {stock2['kodeSimpan']} ({product2['name']}, 200kg)")
    
    test_data["stocks"] = [stock1, stock2]
    test_data["products"] = [product1["id"], product2["id"]]
    
    # Get a customer
    resp = requests.get(f"{BASE_URL}/contacts?type=Customer", cookies=cookies)
    if resp.status_code != 200:
        print(f"❌ Failed to get customers: {resp.status_code}")
        return False
    
    customers = resp.json().get("data", [])
    if not customers:
        print("❌ No customers found")
        return False
    
    customer = customers[0]
    test_data["customers"].append(customer)
    print(f"✅ Selected customer: {customer['displayName']} ({customer['code']})")
    
    # Create SO with 2 items (different products)
    so_data = {
        "customerId": customer["id"],
        "orderDate": datetime.now().isoformat(),
        "paymentTerm": "TOP 14",
        "items": [
            {
                "stockId": stock1["id"],
                "weight": min(10, stock1["weight"] * 0.5),  # Use half or 10kg
                "quantity": 1,
                "unitPrice": 40000,
                "discount": 0
            },
            {
                "stockId": stock2["id"],
                "weight": min(15, stock2["weight"] * 0.5),  # Use half or 15kg
                "quantity": 1,
                "unitPrice": 45000,
                "discount": 0
            }
        ]
    }
    
    resp = requests.post(f"{BASE_URL}/sales-orders", json=so_data, cookies=cookies)
    if resp.status_code != 201:
        print(f"❌ Failed to create SO: {resp.status_code} - {resp.text}")
        return False
    
    so = resp.json()["data"]
    test_data["sales_orders"].append(so)
    print(f"✅ Created SO: {so['soNumber']} with 2 items")
    
    # Transition to Shipped: Draft -> Confirmed -> Packed -> Shipped
    statuses = ["Confirmed", "Packed", "Shipped"]
    for status in statuses:
        resp = requests.post(
            f"{BASE_URL}/sales-orders/{so['id']}/status",
            json={"status": status},
            cookies=cookies
        )
        if resp.status_code != 200:
            print(f"❌ Failed to transition to {status}: {resp.status_code}")
            return False
        print(f"✅ Transitioned SO to {status}")
    
    # Get updated SO details
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}", cookies=cookies)
    if resp.status_code == 200:
        so_detail = resp.json()["data"]
        test_data["sales_orders"][0] = so_detail
        print(f"✅ SO now in {so_detail['pipelineStatus']} status")
        print(f"   Item 1: {so_detail['items'][0]['weight']} kg @ {so_detail['items'][0]['unitPrice']}")
        print(f"   Item 2: {so_detail['items'][1]['weight']} kg @ {so_detail['items'][1]['unitPrice']}")
    
    return True

def test_1_happy_path_no_shrinkage():
    """Test 1: Happy path — no shrinkage (received = ordered)"""
    print("\n=== TEST 1: Happy path — no shrinkage ===")
    
    cookies = login("operator")
    so = test_data["sales_orders"][0]
    
    # Create receipt with full received weight (no shrinkage)
    items = so["items"]
    receipt_data = {
        "receivedDate": datetime.now().isoformat(),
        "receivedBy": "Test PIC",
        "items": [
            {"productId": items[0]["productId"], "receivedWeight": items[0]["weight"]},
            {"productId": items[1]["productId"], "receivedWeight": items[1]["weight"]}
        ]
    }
    
    resp = requests.post(
        f"{BASE_URL}/sales-orders/{so['id']}/receipts",
        json=receipt_data,
        cookies=cookies
    )
    
    if resp.status_code != 201:
        print(f"❌ Failed to create receipt: {resp.status_code} - {resp.text}")
        return False
    
    receipt = resp.json()["data"]
    test_data["receipts"].append(receipt)
    
    # Small delay to avoid receipt number collision (race condition in nextReceiptNumber)
    time.sleep(0.1)
    
    # Validate response
    if not receipt.get("receiptNumber"):
        print("❌ Missing receiptNumber")
        return False
    
    if receipt["totalShrinkageWeight"] != 0:
        print(f"❌ Expected totalShrinkageWeight=0, got {receipt['totalShrinkageWeight']}")
        return False
    
    if receipt["status"] != "received":
        print(f"❌ Expected status='received', got {receipt['status']}")
        return False
    
    if not receipt.get("items") or len(receipt["items"]) != 2:
        print(f"❌ Expected 2 items, got {len(receipt.get('items', []))}")
        return False
    
    for item in receipt["items"]:
        if item["shrinkageWeight"] != 0:
            print(f"❌ Expected shrinkageWeight=0 per item, got {item['shrinkageWeight']}")
            return False
    
    print(f"✅ Receipt created: {receipt['receiptNumber']}")
    print(f"   Status: {receipt['status']}")
    print(f"   Total Shrinkage: {receipt['totalShrinkageWeight']} kg (${receipt['totalShrinkageValue']})")
    print(f"   Items: {len(receipt['items'])} with shrinkageWeight=0 each")
    
    return True

def test_2_happy_path_with_shrinkage():
    """Test 2: Happy path — with shrinkage (received = 90% of ordered)"""
    print("\n=== TEST 2: Happy path — with shrinkage ===")
    
    # Create another SO for this test
    cookies = login("admin")
    customer = test_data["customers"][0]
    stocks = test_data["stocks"]
    
    so_data = {
        "customerId": customer["id"],
        "orderDate": datetime.now().isoformat(),
        "paymentTerm": "TOP 14",
        "items": [
            {
                "stockId": stocks[0]["id"],
                "weight": 20,
                "quantity": 1,
                "unitPrice": 40000,
                "discount": 0
            },
            {
                "stockId": stocks[1]["id"],
                "weight": 30,
                "quantity": 1,
                "unitPrice": 45000,
                "discount": 0
            }
        ]
    }
    
    resp = requests.post(f"{BASE_URL}/sales-orders", json=so_data, cookies=cookies)
    if resp.status_code != 201:
        print(f"❌ Failed to create SO: {resp.status_code}")
        return False
    
    so = resp.json()["data"]
    
    # Transition to Shipped
    for status in ["Confirmed", "Packed", "Shipped"]:
        requests.post(f"{BASE_URL}/sales-orders/{so['id']}/status", json={"status": status}, cookies=cookies)
    
    # Get SO details
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}", cookies=cookies)
    so = resp.json()["data"]
    items = so["items"]
    
    # Create receipt with 90% received (10% shrinkage)
    receipt_data = {
        "receivedDate": datetime.now().isoformat(),
        "receivedBy": "Test PIC",
        "items": [
            {"productId": items[0]["productId"], "receivedWeight": items[0]["weight"] * 0.9},
            {"productId": items[1]["productId"], "receivedWeight": items[1]["weight"] * 0.9}
        ]
    }
    
    resp = requests.post(
        f"{BASE_URL}/sales-orders/{so['id']}/receipts",
        json=receipt_data,
        cookies=cookies
    )
    
    if resp.status_code != 201:
        print(f"❌ Failed to create receipt: {resp.status_code} - {resp.text}")
        return False
    
    receipt = resp.json()["data"]
    test_data["receipts"].append(receipt)
    test_data["sales_orders"].append(so)
    
    # Validate shrinkage
    if receipt["totalShrinkageWeight"] <= 0:
        print(f"❌ Expected totalShrinkageWeight > 0, got {receipt['totalShrinkageWeight']}")
        return False
    
    expected_shrinkage_pct = 10.0
    if abs(receipt["totalShrinkagePct"] - expected_shrinkage_pct) > 0.5:
        print(f"❌ Expected ~{expected_shrinkage_pct}% shrinkage, got {receipt['totalShrinkagePct']}%")
        return False
    
    if receipt["totalShrinkageValue"] <= 0:
        print(f"❌ Expected totalShrinkageValue > 0, got {receipt['totalShrinkageValue']}")
        return False
    
    if receipt["status"] != "partial":
        print(f"❌ Expected status='partial', got {receipt['status']}")
        return False
    
    # Verify GET receipts includes product info
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}/receipts", cookies=cookies)
    if resp.status_code != 200:
        print(f"❌ Failed to get receipts: {resp.status_code}")
        return False
    
    receipts = resp.json()["data"]
    if not receipts or len(receipts) == 0:
        print("❌ No receipts returned")
        return False
    
    found_receipt = receipts[0]
    if not found_receipt.get("items") or not found_receipt["items"][0].get("product"):
        print("❌ Receipt items not enriched with product info")
        return False
    
    print(f"✅ Receipt created: {receipt['receiptNumber']}")
    print(f"   Status: {receipt['status']}")
    print(f"   Total Shrinkage: {receipt['totalShrinkageWeight']} kg ({receipt['totalShrinkagePct']}%)")
    print(f"   Shrinkage Value: Rp {receipt['totalShrinkageValue']:,}")
    print(f"   Items enriched with product name/sku: {found_receipt['items'][0]['product']['name']}")
    
    return True

def test_3_apply_to_invoice_true():
    """Test 3: applyToInvoice=true creates shadow return"""
    print("\n=== TEST 3: applyToInvoice=true creates shadow return ===")
    
    cookies = login("admin")
    customer = test_data["customers"][0]
    stocks = test_data["stocks"]
    
    # Create SO
    so_data = {
        "customerId": customer["id"],
        "orderDate": datetime.now().isoformat(),
        "paymentTerm": "TOP 14",
        "items": [
            {"stockId": stocks[0]["id"], "weight": 25, "quantity": 1, "unitPrice": 40000, "discount": 0}
        ]
    }
    
    resp = requests.post(f"{BASE_URL}/sales-orders", json=so_data, cookies=cookies)
    so = resp.json()["data"]
    
    # Transition to Shipped
    for status in ["Confirmed", "Packed", "Shipped"]:
        requests.post(f"{BASE_URL}/sales-orders/{so['id']}/status", json={"status": status}, cookies=cookies)
    
    # Get SO details before receipt
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}", cookies=cookies)
    so_before = resp.json()["data"]
    total_returns_before = so_before.get("totalReturns", 0)
    outstanding_before = so_before.get("outstanding", 0)
    
    # Create receipt with shrinkage and applyToInvoice=true
    items = so_before["items"]
    receipt_data = {
        "receivedDate": datetime.now().isoformat(),
        "receivedBy": "Test PIC",
        "applyToInvoice": True,
        "items": [
            {"productId": items[0]["productId"], "receivedWeight": items[0]["weight"] * 0.85}  # 15% shrinkage
        ]
    }
    
    resp = requests.post(
        f"{BASE_URL}/sales-orders/{so['id']}/receipts",
        json=receipt_data,
        cookies=cookies
    )
    
    if resp.status_code != 201:
        print(f"❌ Failed to create receipt: {resp.status_code} - {resp.text}")
        return False
    
    receipt = resp.json()["data"]
    test_data["receipts"].append(receipt)
    test_data["sales_orders"].append(so)
    
    # Get SO details after receipt
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}", cookies=cookies)
    so_after = resp.json()["data"]
    total_returns_after = so_after.get("totalReturns", 0)
    outstanding_after = so_after.get("outstanding", 0)
    
    # Verify shadow return was created
    if total_returns_after <= total_returns_before:
        print(f"❌ Expected totalReturns to increase, before={total_returns_before}, after={total_returns_after}")
        return False
    
    shrinkage_value = receipt["totalShrinkageValue"]
    if abs(total_returns_after - total_returns_before - shrinkage_value) > 1:
        print(f"❌ Expected totalReturns increase by {shrinkage_value}, got {total_returns_after - total_returns_before}")
        return False
    
    # Verify outstanding decreased
    if outstanding_after >= outstanding_before:
        print(f"❌ Expected outstanding to decrease, before={outstanding_before}, after={outstanding_after}")
        return False
    
    # Check if shadow return exists with correct reason
    returns = so_after.get("returns", [])
    shadow_return = None
    for r in returns:
        if "Penyusutan otomatis dari Penerimaan" in r.get("reason", ""):
            shadow_return = r
            break
    
    if not shadow_return:
        print("❌ Shadow return not found in SO returns")
        return False
    
    print(f"✅ Receipt created with applyToInvoice=true: {receipt['receiptNumber']}")
    print(f"   Shrinkage Value: Rp {shrinkage_value:,}")
    print(f"   Total Returns increased: {total_returns_before:,} → {total_returns_after:,}")
    print(f"   Outstanding decreased: {outstanding_before:,} → {outstanding_after:,}")
    print(f"   Shadow return created: {shadow_return['returnNumber']}")
    
    return True

def test_4_apply_to_invoice_false():
    """Test 4: applyToInvoice=false does NOT create shadow return"""
    print("\n=== TEST 4: applyToInvoice=false does NOT create shadow return ===")
    
    cookies = login("admin")
    customer = test_data["customers"][0]
    stocks = test_data["stocks"]
    
    # Create SO
    so_data = {
        "customerId": customer["id"],
        "orderDate": datetime.now().isoformat(),
        "paymentTerm": "TOP 14",
        "items": [
            {"stockId": stocks[0]["id"], "weight": 20, "quantity": 1, "unitPrice": 40000, "discount": 0}
        ]
    }
    
    resp = requests.post(f"{BASE_URL}/sales-orders", json=so_data, cookies=cookies)
    so = resp.json()["data"]
    
    # Transition to Shipped
    for status in ["Confirmed", "Packed", "Shipped"]:
        requests.post(f"{BASE_URL}/sales-orders/{so['id']}/status", json={"status": status}, cookies=cookies)
    
    # Get SO details before receipt
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}", cookies=cookies)
    so_before = resp.json()["data"]
    total_returns_before = so_before.get("totalReturns", 0)
    
    # Create receipt with shrinkage and applyToInvoice=false
    items = so_before["items"]
    receipt_data = {
        "receivedDate": datetime.now().isoformat(),
        "receivedBy": "Test PIC",
        "applyToInvoice": False,
        "items": [
            {"productId": items[0]["productId"], "receivedWeight": items[0]["weight"] * 0.85}  # 15% shrinkage
        ]
    }
    
    resp = requests.post(
        f"{BASE_URL}/sales-orders/{so['id']}/receipts",
        json=receipt_data,
        cookies=cookies
    )
    
    if resp.status_code != 201:
        print(f"❌ Failed to create receipt: {resp.status_code} - {resp.text}")
        return False
    
    receipt = resp.json()["data"]
    test_data["receipts"].append(receipt)
    test_data["sales_orders"].append(so)
    
    # Get SO details after receipt
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}", cookies=cookies)
    so_after = resp.json()["data"]
    total_returns_after = so_after.get("totalReturns", 0)
    
    # Verify totalReturns unchanged
    if total_returns_after != total_returns_before:
        print(f"❌ Expected totalReturns unchanged, before={total_returns_before}, after={total_returns_after}")
        return False
    
    print(f"✅ Receipt created with applyToInvoice=false: {receipt['receiptNumber']}")
    print(f"   Shrinkage Value: Rp {receipt['totalShrinkageValue']:,}")
    print(f"   Total Returns unchanged: {total_returns_before:,}")
    print(f"   Shrinkage recorded but not applied to outstanding")
    
    return True

def test_5_aggregation_per_product():
    """Test 5: Aggregation per product (multiple items same productId)"""
    print("\n=== TEST 5: Aggregation per product ===")
    
    cookies = login("admin")
    customer = test_data["customers"][0]
    stocks = test_data["stocks"]
    
    # Get 2 stocks with SAME productId (or use same stock twice)
    # For simplicity, we'll create SO with 2 items referencing same product but different stocks
    # If we don't have 2 stocks with same product, we'll use same stock twice (different line items)
    
    # Create SO with 2 items SAME productId + 1 item different product
    so_data = {
        "customerId": customer["id"],
        "orderDate": datetime.now().isoformat(),
        "paymentTerm": "TOP 14",
        "items": [
            {"productId": test_data["products"][0], "weight": 10, "quantity": 1, "unitPrice": 40000, "discount": 0},
            {"productId": test_data["products"][0], "weight": 15, "quantity": 1, "unitPrice": 40000, "discount": 0},
            {"productId": test_data["products"][1], "weight": 5, "quantity": 1, "unitPrice": 45000, "discount": 0}
        ]
    }
    
    resp = requests.post(f"{BASE_URL}/sales-orders", json=so_data, cookies=cookies)
    if resp.status_code != 201:
        print(f"❌ Failed to create SO: {resp.status_code} - {resp.text}")
        return False
    
    so = resp.json()["data"]
    
    # Transition to Shipped
    for status in ["Confirmed", "Packed", "Shipped"]:
        requests.post(f"{BASE_URL}/sales-orders/{so['id']}/status", json={"status": status}, cookies=cookies)
    
    # Get SO details
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}", cookies=cookies)
    so = resp.json()["data"]
    
    # Create receipt with aggregated weights per product
    # Product 1: 10+15=25kg ordered, receive 20kg (5kg shrinkage)
    # Product 2: 5kg ordered, receive 5kg (0 shrinkage)
    receipt_data = {
        "receivedDate": datetime.now().isoformat(),
        "receivedBy": "Test PIC",
        "items": [
            {"productId": test_data["products"][0], "receivedWeight": 20},
            {"productId": test_data["products"][1], "receivedWeight": 5}
        ]
    }
    
    resp = requests.post(
        f"{BASE_URL}/sales-orders/{so['id']}/receipts",
        json=receipt_data,
        cookies=cookies
    )
    
    if resp.status_code != 201:
        print(f"❌ Failed to create receipt: {resp.status_code} - {resp.text}")
        return False
    
    receipt = resp.json()["data"]
    test_data["receipts"].append(receipt)
    test_data["sales_orders"].append(so)
    
    # Validate aggregation
    items = receipt["items"]
    if len(items) != 2:
        print(f"❌ Expected 2 receipt items (aggregated per product), got {len(items)}")
        return False
    
    # Find item for product 1 (should have aggregated orderedWeight=25)
    item1 = next((i for i in items if i["productId"] == test_data["products"][0]), None)
    if not item1:
        print("❌ Product 1 not found in receipt items")
        return False
    
    if item1["orderedWeight"] != 25:
        print(f"❌ Expected orderedWeight=25 (aggregated), got {item1['orderedWeight']}")
        return False
    
    if item1["receivedWeight"] != 20:
        print(f"❌ Expected receivedWeight=20, got {item1['receivedWeight']}")
        return False
    
    if item1["shrinkageWeight"] != 5:
        print(f"❌ Expected shrinkageWeight=5, got {item1['shrinkageWeight']}")
        return False
    
    print(f"✅ Receipt created with product aggregation: {receipt['receiptNumber']}")
    print(f"   Product 1: orderedWeight=25kg (10+15 aggregated), receivedWeight=20kg, shrinkage=5kg")
    print(f"   Product 2: orderedWeight=5kg, receivedWeight=5kg, shrinkage=0kg")
    
    return True

def test_6_validation():
    """Test 6: Validation (SO status, receivedWeight > orderedWeight, productId not in SO, empty items, SO not found)"""
    print("\n=== TEST 6: Validation ===")
    
    cookies = login("admin")
    customer = test_data["customers"][0]
    stocks = test_data["stocks"]
    
    # Test 6.1: SO in Draft/Confirmed/Packed status → 400
    print("\n  6.1: SO not in Shipped/Invoiced status")
    so_data = {
        "customerId": customer["id"],
        "orderDate": datetime.now().isoformat(),
        "items": [
            {"stockId": stocks[0]["id"], "weight": 10, "quantity": 1, "unitPrice": 40000}
        ]
    }
    resp = requests.post(f"{BASE_URL}/sales-orders", json=so_data, cookies=cookies)
    so_draft = resp.json()["data"]
    
    receipt_data = {
        "receivedDate": datetime.now().isoformat(),
        "items": [{"productId": test_data["products"][0], "receivedWeight": 10}]
    }
    
    resp = requests.post(f"{BASE_URL}/sales-orders/{so_draft['id']}/receipts", json=receipt_data, cookies=cookies)
    if resp.status_code != 400:
        print(f"  ❌ Expected 400 for Draft SO, got {resp.status_code}")
        return False
    
    error_msg = resp.json().get("error", "")
    if "dikirim" not in error_msg.lower():
        print(f"  ❌ Expected error about 'dikirim', got: {error_msg}")
        return False
    
    print(f"  ✅ Draft SO rejected: {error_msg}")
    
    # Cleanup draft SO
    test_data["sales_orders"].append(so_draft)
    
    # Test 6.2: receivedWeight > orderedWeight → 400
    print("\n  6.2: receivedWeight > orderedWeight")
    so_data = {
        "customerId": customer["id"],
        "orderDate": datetime.now().isoformat(),
        "items": [
            {"stockId": stocks[0]["id"], "weight": 10, "quantity": 1, "unitPrice": 40000}
        ]
    }
    resp = requests.post(f"{BASE_URL}/sales-orders", json=so_data, cookies=cookies)
    so = resp.json()["data"]
    
    for status in ["Confirmed", "Packed", "Shipped"]:
        requests.post(f"{BASE_URL}/sales-orders/{so['id']}/status", json={"status": status}, cookies=cookies)
    
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}", cookies=cookies)
    so = resp.json()["data"]
    
    receipt_data = {
        "receivedDate": datetime.now().isoformat(),
        "items": [{"productId": so["items"][0]["productId"], "receivedWeight": 15}]  # More than ordered
    }
    
    resp = requests.post(f"{BASE_URL}/sales-orders/{so['id']}/receipts", json=receipt_data, cookies=cookies)
    if resp.status_code != 400:
        print(f"  ❌ Expected 400 for receivedWeight > ordered, got {resp.status_code}")
        return False
    
    error_msg = resp.json().get("error", "")
    if "melebihi" not in error_msg.lower():
        print(f"  ❌ Expected error about 'melebihi', got: {error_msg}")
        return False
    
    print(f"  ✅ Excess weight rejected: {error_msg}")
    test_data["sales_orders"].append(so)
    
    # Test 6.3: productId not in SO → 400
    print("\n  6.3: productId not in SO")
    receipt_data = {
        "receivedDate": datetime.now().isoformat(),
        "items": [{"productId": "non-existent-product-id", "receivedWeight": 5}]
    }
    
    resp = requests.post(f"{BASE_URL}/sales-orders/{so['id']}/receipts", json=receipt_data, cookies=cookies)
    if resp.status_code != 400:
        print(f"  ❌ Expected 400 for invalid productId, got {resp.status_code}")
        return False
    
    error_msg = resp.json().get("error", "")
    if "tidak ada di so" not in error_msg.lower():
        print(f"  ❌ Expected error about product not in SO, got: {error_msg}")
        return False
    
    print(f"  ✅ Invalid productId rejected: {error_msg}")
    
    # Test 6.4: Empty items array → 400
    print("\n  6.4: Empty items array")
    receipt_data = {
        "receivedDate": datetime.now().isoformat(),
        "items": []
    }
    
    resp = requests.post(f"{BASE_URL}/sales-orders/{so['id']}/receipts", json=receipt_data, cookies=cookies)
    if resp.status_code != 400:
        print(f"  ❌ Expected 400 for empty items, got {resp.status_code}")
        return False
    
    error_msg = resp.json().get("error", "")
    print(f"  ✅ Empty items rejected: {error_msg}")
    
    # Test 6.5: SO not found → 404
    print("\n  6.5: SO not found")
    receipt_data = {
        "receivedDate": datetime.now().isoformat(),
        "items": [{"productId": test_data["products"][0], "receivedWeight": 5}]
    }
    
    resp = requests.post(f"{BASE_URL}/sales-orders/non-existent-so-id/receipts", json=receipt_data, cookies=cookies)
    if resp.status_code != 404:
        print(f"  ❌ Expected 404 for non-existent SO, got {resp.status_code}")
        return False
    
    print(f"  ✅ Non-existent SO rejected with 404")
    
    print("\n✅ All validation tests passed")
    return True

def test_7_rbac():
    """Test 7: Role RBAC (operator, direktur, admin)"""
    print("\n=== TEST 7: Role RBAC ===")
    
    # Use existing SO in Shipped status
    so = test_data["sales_orders"][1]  # From test 2
    
    # Test 7.1: POST as operator → 201 (allowed)
    print("\n  7.1: POST as operator")
    cookies_operator = login("operator")
    
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}", cookies=cookies_operator)
    so_detail = resp.json()["data"]
    
    receipt_data = {
        "receivedDate": datetime.now().isoformat(),
        "receivedBy": "Operator Test",
        "items": [
            {"productId": so_detail["items"][0]["productId"], "receivedWeight": so_detail["items"][0]["weight"] * 0.95}
        ]
    }
    
    resp = requests.post(f"{BASE_URL}/sales-orders/{so['id']}/receipts", json=receipt_data, cookies=cookies_operator)
    if resp.status_code != 201:
        print(f"  ❌ Operator should be allowed to POST, got {resp.status_code}")
        return False
    
    receipt_operator = resp.json()["data"]
    test_data["receipts"].append(receipt_operator)
    print(f"  ✅ Operator can POST receipts: {receipt_operator['receiptNumber']}")
    
    # Test 7.2: POST as direktur → 403 (not allowed)
    print("\n  7.2: POST as direktur")
    cookies_direktur = login("direktur")
    
    resp = requests.post(f"{BASE_URL}/sales-orders/{so['id']}/receipts", json=receipt_data, cookies=cookies_direktur)
    if resp.status_code != 403:
        print(f"  ❌ Direktur should be denied POST, got {resp.status_code}")
        return False
    
    print(f"  ✅ Direktur correctly denied POST (403)")
    
    # Test 7.3: GET as direktur → 200 (view allowed)
    print("\n  7.3: GET as direktur")
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}/receipts", cookies=cookies_direktur)
    if resp.status_code != 200:
        print(f"  ❌ Direktur should be allowed to GET, got {resp.status_code}")
        return False
    
    print(f"  ✅ Direktur can GET receipts (view only)")
    
    # Test 7.4: DELETE as operator/supervisor → 403 (admin only)
    print("\n  7.4: DELETE as operator")
    resp = requests.delete(
        f"{BASE_URL}/sales-orders/{so['id']}/receipts/{receipt_operator['id']}",
        cookies=cookies_operator
    )
    if resp.status_code != 403:
        print(f"  ❌ Operator should be denied DELETE, got {resp.status_code}")
        return False
    
    print(f"  ✅ Operator correctly denied DELETE (403)")
    
    # Test 7.5: DELETE as admin → 200
    print("\n  7.5: DELETE as admin")
    cookies_admin = login("admin")
    resp = requests.delete(
        f"{BASE_URL}/sales-orders/{so['id']}/receipts/{receipt_operator['id']}",
        cookies=cookies_admin
    )
    if resp.status_code != 200:
        print(f"  ❌ Admin should be allowed to DELETE, got {resp.status_code}")
        return False
    
    print(f"  ✅ Admin can DELETE receipts")
    
    print("\n✅ All RBAC tests passed")
    return True

def test_8_get_so_includes_receipts():
    """Test 8: GET SO includes receipts with enriched data"""
    print("\n=== TEST 8: GET SO includes receipts ===")
    
    cookies = login("admin")
    
    # Use SO from test 2 which has receipts
    so = test_data["sales_orders"][1]
    
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}", cookies=cookies)
    if resp.status_code != 200:
        print(f"❌ Failed to get SO: {resp.status_code}")
        return False
    
    so_detail = resp.json()["data"]
    
    # Verify receipts array exists
    if "receipts" not in so_detail:
        print("❌ SO response missing 'receipts' field")
        return False
    
    receipts = so_detail["receipts"]
    if not isinstance(receipts, list):
        print("❌ 'receipts' is not an array")
        return False
    
    if len(receipts) == 0:
        print("⚠️  No receipts found (may have been deleted in previous tests)")
    else:
        # Verify receipt items are enriched with product info
        receipt = receipts[0]
        if not receipt.get("items"):
            print("❌ Receipt missing 'items' field")
            return False
        
        item = receipt["items"][0]
        if not item.get("product"):
            print("❌ Receipt item not enriched with product info")
            return False
        
        if not item["product"].get("name") or not item["product"].get("sku"):
            print("❌ Product info incomplete")
            return False
        
        print(f"  ✅ Receipt items enriched with product: {item['product']['name']} ({item['product']['sku']})")
    
    # Verify totalShrinkageWeight and totalShrinkageValue summary fields
    if "totalShrinkageWeight" not in so_detail:
        print("❌ SO response missing 'totalShrinkageWeight' field")
        return False
    
    if "totalShrinkageValue" not in so_detail:
        print("❌ SO response missing 'totalShrinkageValue' field")
        return False
    
    print(f"✅ GET SO includes receipts array with enriched items")
    print(f"   Total Shrinkage Weight: {so_detail['totalShrinkageWeight']} kg")
    print(f"   Total Shrinkage Value: Rp {so_detail['totalShrinkageValue']:,}")
    
    return True

def test_9_delete_receipt():
    """Test 9: DELETE receipt removes shadow return if applyToInvoice was true"""
    print("\n=== TEST 9: DELETE receipt ===")
    
    cookies = login("admin")
    
    # Use SO from test 3 which has receipt with applyToInvoice=true
    so = test_data["sales_orders"][2]  # From test 3
    
    # Get SO details before delete
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}", cookies=cookies)
    so_before = resp.json()["data"]
    total_returns_before = so_before.get("totalReturns", 0)
    outstanding_before = so_before.get("outstanding", 0)
    
    # Get receipts
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}/receipts", cookies=cookies)
    receipts = resp.json()["data"]
    
    if not receipts:
        print("❌ No receipts found to delete")
        return False
    
    receipt = receipts[0]
    receipt_id = receipt["id"]
    shrinkage_value = receipt["totalShrinkageValue"]
    
    # Delete receipt
    resp = requests.delete(
        f"{BASE_URL}/sales-orders/{so['id']}/receipts/{receipt_id}",
        cookies=cookies
    )
    
    if resp.status_code != 200:
        print(f"❌ Failed to delete receipt: {resp.status_code}")
        return False
    
    # Get SO details after delete
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}", cookies=cookies)
    so_after = resp.json()["data"]
    total_returns_after = so_after.get("totalReturns", 0)
    outstanding_after = so_after.get("outstanding", 0)
    
    # Verify shadow return was removed (totalReturns decreased)
    if receipt.get("applyToInvoice"):
        if total_returns_after >= total_returns_before:
            print(f"❌ Expected totalReturns to decrease, before={total_returns_before}, after={total_returns_after}")
            return False
        
        # Verify outstanding restored
        if outstanding_after <= outstanding_before:
            print(f"❌ Expected outstanding to increase (restored), before={outstanding_before}, after={outstanding_after}")
            return False
        
        print(f"✅ Receipt deleted: {receipt['receiptNumber']}")
        print(f"   Shadow return removed")
        print(f"   Total Returns decreased: {total_returns_before:,} → {total_returns_after:,}")
        print(f"   Outstanding restored: {outstanding_before:,} → {outstanding_after:,}")
    else:
        print(f"✅ Receipt deleted: {receipt['receiptNumber']}")
    
    return True

def test_regression():
    """Regression: Verify existing endpoints still work"""
    print("\n=== REGRESSION TESTS ===")
    
    cookies = login("admin")
    
    tests = [
        ("GET /sales-orders", f"{BASE_URL}/sales-orders"),
        ("GET /inventory/stocks", f"{BASE_URL}/inventory/stocks"),
        ("GET /contacts", f"{BASE_URL}/contacts"),
    ]
    
    for name, url in tests:
        resp = requests.get(url, cookies=cookies)
        if resp.status_code != 200:
            print(f"❌ {name} failed: {resp.status_code}")
            return False
        print(f"✅ {name}: 200")
    
    return True

def cleanup():
    """Cleanup test data"""
    print("\n=== CLEANUP ===")
    
    cookies = login("admin")
    
    # Delete test SOs (cascade will delete receipts)
    for so in test_data["sales_orders"]:
        try:
            # Try to cancel first if not already
            if so.get("pipelineStatus") not in ["Cancelled", "Invoiced"]:
                requests.post(
                    f"{BASE_URL}/sales-orders/{so['id']}/status",
                    json={"status": "Cancelled"},
                    cookies=cookies
                )
        except:
            pass
    
    print("✅ Cleanup complete (SOs remain for audit)")

def main():
    """Run all tests"""
    print("=" * 80)
    print("BACKEND API TEST SUITE - SO RECEIPTS (Penerimaan Customer + Penyusutan)")
    print("=" * 80)
    
    tests = [
        ("Setup", test_setup),
        ("Test 1: Happy path — no shrinkage", test_1_happy_path_no_shrinkage),
        ("Test 2: Happy path — with shrinkage", test_2_happy_path_with_shrinkage),
        ("Test 3: applyToInvoice=true creates shadow return", test_3_apply_to_invoice_true),
        ("Test 4: applyToInvoice=false does NOT create shadow return", test_4_apply_to_invoice_false),
        ("Test 5: Aggregation per product", test_5_aggregation_per_product),
        ("Test 6: Validation", test_6_validation),
        ("Test 7: Role RBAC", test_7_rbac),
        ("Test 8: GET SO includes receipts", test_8_get_so_includes_receipts),
        ("Test 9: DELETE receipt", test_9_delete_receipt),
        ("Regression", test_regression),
    ]
    
    results = []
    for name, test_func in tests:
        try:
            result = test_func()
            results.append((name, result))
        except Exception as e:
            print(f"\n❌ {name} EXCEPTION: {str(e)}")
            import traceback
            traceback.print_exc()
            results.append((name, False))
    
    # Cleanup
    try:
        cleanup()
    except Exception as e:
        print(f"⚠️  Cleanup warning: {e}")
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for _, r in results if r)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {name}")
    
    print(f"\nTotal: {passed}/{total} tests passed ({passed*100//total}%)")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        sys.exit(0)
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
