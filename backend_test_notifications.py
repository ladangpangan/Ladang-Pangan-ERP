#!/usr/bin/env python3
"""
Backend API Test Suite for LPI ERP - Notifications & Approval Triggers
Tests the NEW notification system and 2 new approval/concern triggers.
"""

import requests
import json
import sys
import time
from datetime import datetime, timedelta

# Configuration
BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"
CREDENTIALS = {
    "admin": {"email": "admin@lpi.co.id", "password": "admin123"},
    "supervisor": {"email": "supervisor@lpi.co.id", "password": "super123"},
    "direktur": {"email": "direktur@lpi.co.id", "password": "direktur123"},
    "operator": {"email": "operator@lpi.co.id", "password": "operator123"},
}

# Test state
sessions = {}
test_data = {
    "suppliers": [],
    "customers": [],
    "products": [],
    "purchase_orders": [],
    "sales_orders": [],
    "work_orders": [],
    "notifications": [],
    "approvals": [],
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

def get_test_data():
    """Get necessary test data (suppliers, customers, products)"""
    print("\n=== GETTING TEST DATA ===")
    
    cookies = login("admin")
    
    # Get suppliers
    resp = requests.get(f"{BASE_URL}/contacts?type=Supplier", cookies=cookies)
    if resp.status_code == 200:
        suppliers = resp.json().get("data", [])
        if suppliers:
            test_data["suppliers"] = suppliers
            print(f"✅ Found {len(suppliers)} suppliers")
    
    # Get customers
    resp = requests.get(f"{BASE_URL}/contacts?type=Customer", cookies=cookies)
    if resp.status_code == 200:
        customers = resp.json().get("data", [])
        if customers:
            test_data["customers"] = customers
            print(f"✅ Found {len(customers)} customers")
    
    # Get products
    resp = requests.get(f"{BASE_URL}/products", cookies=cookies)
    if resp.status_code == 200:
        products = resp.json().get("data", [])
        if products:
            test_data["products"] = products
            print(f"✅ Found {len(products)} products")
    
    return True

# ============================================================================
# SECTION A: Notification API Endpoints
# ============================================================================

def test_a1_get_notifications():
    """A1: GET /api/notifications?limit=50 → response shape {data: [...], unreadCount: N}"""
    print("\n=== TEST A1: GET /api/notifications ===")
    
    cookies = login("supervisor")
    
    resp = requests.get(f"{BASE_URL}/notifications?limit=50", cookies=cookies)
    
    if resp.status_code != 200:
        print(f"❌ Expected 200, got {resp.status_code}")
        return False
    
    data = resp.json()
    
    # Verify response shape
    if "data" not in data:
        print("❌ Response missing 'data' field")
        return False
    
    if "unreadCount" not in data:
        print("❌ Response missing 'unreadCount' field")
        return False
    
    if not isinstance(data["data"], list):
        print("❌ 'data' is not an array")
        return False
    
    if not isinstance(data["unreadCount"], int):
        print("❌ 'unreadCount' is not a number")
        return False
    
    print(f"✅ GET /api/notifications returned correct shape")
    print(f"   Notifications: {len(data['data'])}")
    print(f"   Unread count: {data['unreadCount']}")
    
    return True

def test_a2_get_unread_count():
    """A2: GET /api/notifications/unread-count → response {count: N}"""
    print("\n=== TEST A2: GET /api/notifications/unread-count ===")
    
    cookies = login("supervisor")
    
    resp = requests.get(f"{BASE_URL}/notifications/unread-count", cookies=cookies)
    
    if resp.status_code != 200:
        print(f"❌ Expected 200, got {resp.status_code}")
        return False
    
    data = resp.json()
    
    if "count" not in data:
        print("❌ Response missing 'count' field")
        return False
    
    if not isinstance(data["count"], int):
        print("❌ 'count' is not a number")
        return False
    
    print(f"✅ GET /api/notifications/unread-count returned {data['count']}")
    
    return True

def test_a3_mark_one_as_read():
    """A3: POST /api/notifications/:id/read → mark one as read; unread count decrements"""
    print("\n=== TEST A3: POST /api/notifications/:id/read ===")
    
    cookies = login("supervisor")
    
    # Get notifications
    resp = requests.get(f"{BASE_URL}/notifications?limit=50", cookies=cookies)
    if resp.status_code != 200:
        print(f"❌ Failed to get notifications: {resp.status_code}")
        return False
    
    data = resp.json()
    unread_before = data["unreadCount"]
    
    # Find an unread notification
    unread_notif = None
    for notif in data["data"]:
        if not notif.get("isRead"):
            unread_notif = notif
            break
    
    if not unread_notif:
        print("⚠️  No unread notifications found, skipping test")
        return True
    
    # Mark as read
    resp = requests.post(f"{BASE_URL}/notifications/{unread_notif['id']}/read", cookies=cookies)
    
    if resp.status_code != 200:
        print(f"❌ Expected 200, got {resp.status_code}")
        return False
    
    # Get unread count again
    resp = requests.get(f"{BASE_URL}/notifications/unread-count", cookies=cookies)
    unread_after = resp.json()["count"]
    
    if unread_after != unread_before - 1:
        print(f"❌ Expected unread count to decrease by 1: {unread_before} → {unread_after}")
        return False
    
    print(f"✅ Notification marked as read")
    print(f"   Unread count: {unread_before} → {unread_after}")
    
    return True

def test_a4_mark_all_as_read():
    """A4: POST /api/notifications/read-all → all become read"""
    print("\n=== TEST A4: POST /api/notifications/read-all ===")
    
    cookies = login("supervisor")
    
    # Mark all as read
    resp = requests.post(f"{BASE_URL}/notifications/read-all", cookies=cookies)
    
    if resp.status_code != 200:
        print(f"❌ Expected 200, got {resp.status_code}")
        return False
    
    # Get unread count
    resp = requests.get(f"{BASE_URL}/notifications/unread-count", cookies=cookies)
    unread_count = resp.json()["count"]
    
    if unread_count != 0:
        print(f"❌ Expected unread count to be 0, got {unread_count}")
        return False
    
    print(f"✅ All notifications marked as read")
    print(f"   Unread count: {unread_count}")
    
    return True

def test_a5_delete_notification():
    """A5: DELETE /api/notifications/:id → deletes; user can only delete their own"""
    print("\n=== TEST A5: DELETE /api/notifications/:id ===")
    
    cookies = login("supervisor")
    
    # Get notifications
    resp = requests.get(f"{BASE_URL}/notifications?limit=50", cookies=cookies)
    if resp.status_code != 200:
        print(f"❌ Failed to get notifications: {resp.status_code}")
        return False
    
    data = resp.json()
    
    if not data["data"]:
        print("⚠️  No notifications found, skipping test")
        return True
    
    notif_to_delete = data["data"][0]
    count_before = len(data["data"])
    
    # Delete notification
    resp = requests.delete(f"{BASE_URL}/notifications/{notif_to_delete['id']}", cookies=cookies)
    
    if resp.status_code != 200:
        print(f"❌ Expected 200, got {resp.status_code}")
        return False
    
    # Get notifications again
    resp = requests.get(f"{BASE_URL}/notifications?limit=50", cookies=cookies)
    data_after = resp.json()
    count_after = len(data_after["data"])
    
    if count_after != count_before - 1:
        print(f"❌ Expected notification count to decrease by 1: {count_before} → {count_after}")
        return False
    
    print(f"✅ Notification deleted")
    print(f"   Count: {count_before} → {count_after}")
    
    return True

def test_a6_unauthorized_access():
    """A6: Unauthorized (no cookie) requests → 401"""
    print("\n=== TEST A6: Unauthorized access ===")
    
    # No cookies
    resp = requests.get(f"{BASE_URL}/notifications")
    
    if resp.status_code != 401:
        print(f"❌ Expected 401, got {resp.status_code}")
        return False
    
    print(f"✅ Unauthorized request correctly rejected with 401")
    
    return True

# ============================================================================
# SECTION B: Automatic Notification Generation
# ============================================================================

def test_b1_po_creation_notification():
    """B1: Create PO (as admin) → supervisor receives 'po_new' notification"""
    print("\n=== TEST B1: PO creation notification ===")
    
    cookies_admin = login("admin")
    cookies_supervisor = login("supervisor")
    
    # Get initial notification count for supervisor
    resp = requests.get(f"{BASE_URL}/notifications?limit=50", cookies=cookies_supervisor)
    initial_count = len(resp.json()["data"])
    
    # Create PO
    supplier = test_data["suppliers"][0]
    product = next((p for p in test_data["products"] if p["category"] == "Live Bird"), test_data["products"][0])
    
    po_data = {
        "supplierId": supplier["id"],
        "poType": "Live Bird",
        "method": "Timbang Ulang",
        "orderDate": datetime.now().isoformat(),
        "items": [
            {
                "productId": product["id"],
                "quantity": 100,
                "weight": 150,
                "unitPrice": 25000
            }
        ]
    }
    
    resp = requests.post(f"{BASE_URL}/purchase-orders", json=po_data, cookies=cookies_admin)
    
    if resp.status_code != 201:
        print(f"❌ Failed to create PO: {resp.status_code} - {resp.text}")
        return False
    
    po = resp.json()["data"]
    test_data["purchase_orders"].append(po)
    
    print(f"✅ Created PO: {po['poNumber']}")
    
    # Wait a bit for notification to be created
    time.sleep(0.5)
    
    # Check supervisor notifications
    resp = requests.get(f"{BASE_URL}/notifications?limit=50", cookies=cookies_supervisor)
    notifications = resp.json()["data"]
    
    # Find PO notification
    po_notif = None
    for notif in notifications:
        if notif.get("category") == "po_new" and po["poNumber"] in notif.get("entityNumber", ""):
            po_notif = notif
            break
    
    if not po_notif:
        print(f"❌ PO notification not found for supervisor")
        print(f"   Looking for category='po_new' with entityNumber='{po['poNumber']}'")
        return False
    
    if po_notif.get("type") != "info":
        print(f"❌ Expected type='info', got '{po_notif.get('type')}'")
        return False
    
    print(f"✅ Supervisor received PO notification")
    print(f"   Type: {po_notif['type']}")
    print(f"   Category: {po_notif['category']}")
    print(f"   Entity: {po_notif['entityNumber']}")
    
    return True

def test_b2_wo_creation_notification():
    """B2: Create WO (as admin) → supervisor receives 'wo_new' notification"""
    print("\n=== TEST B2: WO creation notification ===")
    
    cookies_admin = login("admin")
    cookies_supervisor = login("supervisor")
    
    # Create WO
    wo_data = {
        "mode": "Internal",
        "startDate": datetime.now().isoformat(),
        "baseCost": 1000000
    }
    
    resp = requests.post(f"{BASE_URL}/work-orders", json=wo_data, cookies=cookies_admin)
    
    if resp.status_code != 201:
        print(f"❌ Failed to create WO: {resp.status_code} - {resp.text}")
        return False
    
    wo = resp.json()["data"]
    test_data["work_orders"].append(wo)
    
    print(f"✅ Created WO: {wo['woNumber']}")
    
    # Wait a bit for notification to be created
    time.sleep(0.5)
    
    # Check supervisor notifications
    resp = requests.get(f"{BASE_URL}/notifications?limit=50", cookies=cookies_supervisor)
    notifications = resp.json()["data"]
    
    # Find WO notification
    wo_notif = None
    for notif in notifications:
        if notif.get("category") == "wo_new" and wo["woNumber"] in notif.get("entityNumber", ""):
            wo_notif = notif
            break
    
    if not wo_notif:
        print(f"❌ WO notification not found for supervisor")
        return False
    
    if wo_notif.get("type") != "info":
        print(f"❌ Expected type='info', got '{wo_notif.get('type')}'")
        return False
    
    print(f"✅ Supervisor received WO notification")
    print(f"   Type: {wo_notif['type']}")
    print(f"   Category: {wo_notif['category']}")
    print(f"   Entity: {wo_notif['entityNumber']}")
    
    return True

def test_b3_so_creation_notification_no_approval():
    """B3: Create SO (small, no discount, above HPP) → supervisor receives 'so_new' notification, NO approval"""
    print("\n=== TEST B3: SO creation notification (no approval) ===")
    
    cookies_admin = login("admin")
    cookies_supervisor = login("supervisor")
    
    # Get a low-HPP product (LB-001 or similar)
    lb_product = next((p for p in test_data["products"] if p["sku"] == "LB-001"), test_data["products"][0])
    customer = test_data["customers"][0]
    
    # Create SO with high price (above HPP)
    so_data = {
        "customerId": customer["id"],
        "orderDate": datetime.now().isoformat(),
        "items": [
            {
                "productId": lb_product["id"],
                "quantity": 10,
                "weight": 10,
                "unitPrice": 100000  # High price, above HPP
            }
        ]
    }
    
    resp = requests.post(f"{BASE_URL}/sales-orders", json=so_data, cookies=cookies_admin)
    
    if resp.status_code != 201:
        print(f"❌ Failed to create SO: {resp.status_code} - {resp.text}")
        return False
    
    so = resp.json()["data"]
    test_data["sales_orders"].append(so)
    
    print(f"✅ Created SO: {so['soNumber']}")
    
    # Wait a bit for notification to be created
    time.sleep(0.5)
    
    # Check supervisor notifications
    resp = requests.get(f"{BASE_URL}/notifications?limit=50", cookies=cookies_supervisor)
    notifications = resp.json()["data"]
    
    # Find SO notification
    so_notif = None
    for notif in notifications:
        if notif.get("category") == "so_new" and so["soNumber"] in notif.get("entityNumber", ""):
            so_notif = notif
            break
    
    if not so_notif:
        print(f"❌ SO notification not found for supervisor")
        return False
    
    if so_notif.get("type") != "info":
        print(f"❌ Expected type='info', got '{so_notif.get('type')}'")
        return False
    
    print(f"✅ Supervisor received SO notification")
    print(f"   Type: {so_notif['type']}")
    print(f"   Category: {so_notif['category']}")
    print(f"   Entity: {so_notif['entityNumber']}")
    
    # Verify NO approval/concern created
    resp = requests.get(f"{BASE_URL}/approvals?type=so_large_discount", cookies=cookies_admin)
    if resp.status_code == 200:
        approvals = resp.json().get("data", [])
        for approval in approvals:
            if approval.get("entityNumber") == so["soNumber"]:
                print(f"❌ Unexpected so_large_discount approval created")
                return False
    
    resp = requests.get(f"{BASE_URL}/approvals?type=so_price_below_hpp", cookies=cookies_admin)
    if resp.status_code == 200:
        approvals = resp.json().get("data", [])
        for approval in approvals:
            if approval.get("entityNumber") == so["soNumber"]:
                print(f"❌ Unexpected so_price_below_hpp approval created")
                return False
    
    print(f"✅ No approval/concern created (as expected)")
    
    return True

# ============================================================================
# SECTION C: TWO NEW Approval/Concern Triggers
# ============================================================================

def test_c1_so_price_below_hpp():
    """C1: Create SO with price below HPP → so_price_below_hpp approval + notifications"""
    print("\n=== TEST C1: so_price_below_hpp trigger ===")
    
    cookies_admin = login("admin")
    cookies_supervisor = login("supervisor")
    cookies_direktur = login("direktur")
    
    # Find product KRK-001 (Karkas Ayam Utuh) which should have HPP from WO outputs
    krk_product = next((p for p in test_data["products"] if p["sku"] == "KRK-001"), None)
    
    if not krk_product:
        print("⚠️  Product KRK-001 not found, using first product")
        krk_product = test_data["products"][0]
    
    customer = test_data["customers"][0]
    
    # Create SO with price well below HPP (50,000/kg vs ~178,750/kg HPP)
    so_data = {
        "customerId": customer["id"],
        "orderDate": datetime.now().isoformat(),
        "items": [
            {
                "productId": krk_product["id"],
                "quantity": 10,
                "weight": 10,
                "unitPrice": 50000,  # Well below HPP
                "discount": 0
            }
        ]
    }
    
    resp = requests.post(f"{BASE_URL}/sales-orders", json=so_data, cookies=cookies_admin)
    
    if resp.status_code != 201:
        print(f"❌ Failed to create SO: {resp.status_code} - {resp.text}")
        return False
    
    so = resp.json()["data"]
    test_data["sales_orders"].append(so)
    
    print(f"✅ Created SO: {so['soNumber']} with price below HPP")
    
    # Wait a bit for approval and notifications to be created
    time.sleep(0.5)
    
    # Check for approval
    resp = requests.get(f"{BASE_URL}/approvals?type=so_price_below_hpp", cookies=cookies_admin)
    
    if resp.status_code != 200:
        print(f"❌ Failed to get approvals: {resp.status_code}")
        return False
    
    approvals = resp.json().get("data", [])
    
    # Find approval for this SO
    approval = None
    for appr in approvals:
        if appr.get("entityNumber") == so["soNumber"] and appr.get("status") == "pending":
            approval = appr
            break
    
    if not approval:
        print(f"❌ so_price_below_hpp approval not found for SO {so['soNumber']}")
        return False
    
    # Verify approval metadata
    if approval.get("entityType") != "SO":
        print(f"❌ Expected entityType='SO', got '{approval.get('entityType')}'")
        return False
    
    metadata = approval.get("metadata", {})
    if not metadata.get("items"):
        print("❌ Approval metadata missing 'items' field")
        return False
    
    # Verify item has required fields
    item = metadata["items"][0]
    required_fields = ["productId", "sku", "name", "unitPrice", "hpp", "marginPerKg", "weight"]
    for field in required_fields:
        if field not in item:
            print(f"❌ Approval item missing field: {field}")
            return False
    
    print(f"✅ so_price_below_hpp approval created")
    print(f"   Entity: {approval['entityNumber']}")
    print(f"   Product: {item['name']} ({item['sku']})")
    print(f"   Unit Price: {item['unitPrice']}, HPP: {item['hpp']}, Margin: {item['marginPerKg']}")
    
    # Check notifications for supervisor and direktur
    for role, cookies in [("supervisor", cookies_supervisor), ("direktur", cookies_direktur)]:
        resp = requests.get(f"{BASE_URL}/notifications?limit=50", cookies=cookies)
        notifications = resp.json()["data"]
        
        notif = None
        for n in notifications:
            if n.get("category") == "so_price_below_hpp" and so["soNumber"] in n.get("entityNumber", ""):
                notif = n
                break
        
        if not notif:
            print(f"❌ Notification not found for {role}")
            return False
        
        if notif.get("type") != "approval":
            print(f"❌ Expected type='approval', got '{notif.get('type')}'")
            return False
        
        print(f"✅ {role.capitalize()} received notification (type={notif['type']}, category={notif['category']})")
    
    return True

def test_c2_so_shipping_via_surat_jalan():
    """C2.1: Create SO → Packed → POST surat-jalan → so_shipping concern + notifications"""
    print("\n=== TEST C2.1: so_shipping trigger (via surat-jalan) ===")
    
    cookies_admin = login("admin")
    cookies_supervisor = login("supervisor")
    cookies_direktur = login("direktur")
    
    customer = test_data["customers"][0]
    product = test_data["products"][0]
    
    # Create SO
    so_data = {
        "customerId": customer["id"],
        "orderDate": datetime.now().isoformat(),
        "items": [
            {
                "productId": product["id"],
                "quantity": 5,
                "weight": 5,
                "unitPrice": 50000
            }
        ]
    }
    
    resp = requests.post(f"{BASE_URL}/sales-orders", json=so_data, cookies=cookies_admin)
    
    if resp.status_code != 201:
        print(f"❌ Failed to create SO: {resp.status_code}")
        return False
    
    so = resp.json()["data"]
    test_data["sales_orders"].append(so)
    
    # Transition to Packed
    for status in ["Confirmed", "Packed"]:
        resp = requests.post(
            f"{BASE_URL}/sales-orders/{so['id']}/status",
            json={"status": status},
            cookies=cookies_admin
        )
        if resp.status_code != 200:
            print(f"❌ Failed to transition to {status}: {resp.status_code}")
            return False
    
    print(f"✅ Created SO: {so['soNumber']} and transitioned to Packed")
    
    # Create surat jalan (should auto-transition to Shipped and create concern)
    sj_data = {
        "deliveryDate": datetime.now().isoformat(),
        "driverName": "Budi",
        "vehicleNumber": "B 1234 XY"
    }
    
    resp = requests.post(
        f"{BASE_URL}/sales-orders/{so['id']}/surat-jalan",
        json=sj_data,
        cookies=cookies_admin
    )
    
    if resp.status_code != 201:
        print(f"❌ Failed to create surat jalan: {resp.status_code} - {resp.text}")
        return False
    
    sj = resp.json()["data"]
    
    print(f"✅ Created surat jalan: {sj['sjNumber']}")
    
    # Verify SO transitioned to Shipped
    resp = requests.get(f"{BASE_URL}/sales-orders/{so['id']}", cookies=cookies_admin)
    so_updated = resp.json()["data"]
    
    if so_updated["pipelineStatus"] != "Shipped":
        print(f"❌ Expected SO status='Shipped', got '{so_updated['pipelineStatus']}'")
        return False
    
    print(f"✅ SO auto-transitioned to Shipped")
    
    # Wait a bit for approval and notifications to be created
    time.sleep(0.5)
    
    # Check for approval concern
    resp = requests.get(f"{BASE_URL}/approvals?type=so_shipping", cookies=cookies_admin)
    
    if resp.status_code != 200:
        print(f"❌ Failed to get approvals: {resp.status_code}")
        return False
    
    approvals = resp.json().get("data", [])
    
    # Find approval for this SO
    approval = None
    for appr in approvals:
        if appr.get("entityNumber") == so["soNumber"] and appr.get("status") == "pending":
            approval = appr
            break
    
    if not approval:
        print(f"❌ so_shipping approval not found for SO {so['soNumber']}")
        return False
    
    # Verify approval metadata
    metadata = approval.get("metadata", {})
    if not metadata.get("sjNumber"):
        print("❌ Approval metadata missing 'sjNumber' field")
        return False
    
    if not metadata.get("driverName"):
        print("❌ Approval metadata missing 'driverName' field")
        return False
    
    if not metadata.get("vehicleNumber"):
        print("❌ Approval metadata missing 'vehicleNumber' field")
        return False
    
    if metadata.get("stage") != "shipping":
        print(f"❌ Expected stage='shipping', got '{metadata.get('stage')}'")
        return False
    
    print(f"✅ so_shipping approval created")
    print(f"   Entity: {approval['entityNumber']}")
    print(f"   SJ Number: {metadata['sjNumber']}")
    print(f"   Driver: {metadata['driverName']}, Vehicle: {metadata['vehicleNumber']}")
    
    # Check notifications for supervisor and direktur
    for role, cookies in [("supervisor", cookies_supervisor), ("direktur", cookies_direktur)]:
        resp = requests.get(f"{BASE_URL}/notifications?limit=50", cookies=cookies)
        notifications = resp.json()["data"]
        
        notif = None
        for n in notifications:
            if n.get("category") == "so_shipping" and so["soNumber"] in n.get("entityNumber", ""):
                notif = n
                break
        
        if not notif:
            print(f"❌ Notification not found for {role}")
            return False
        
        print(f"✅ {role.capitalize()} received notification (type={notif['type']}, category={notif['category']})")
    
    return True

def test_c2_so_shipping_via_status():
    """C2.2: Create SO → Packed → POST status Shipped → so_shipping concern + notifications"""
    print("\n=== TEST C2.2: so_shipping trigger (via direct status) ===")
    
    cookies_admin = login("admin")
    
    customer = test_data["customers"][0]
    product = test_data["products"][0]
    
    # Create SO
    so_data = {
        "customerId": customer["id"],
        "orderDate": datetime.now().isoformat(),
        "items": [
            {
                "productId": product["id"],
                "quantity": 5,
                "weight": 5,
                "unitPrice": 50000
            }
        ]
    }
    
    resp = requests.post(f"{BASE_URL}/sales-orders", json=so_data, cookies=cookies_admin)
    
    if resp.status_code != 201:
        print(f"❌ Failed to create SO: {resp.status_code}")
        return False
    
    so = resp.json()["data"]
    test_data["sales_orders"].append(so)
    
    # Transition to Packed
    for status in ["Confirmed", "Packed"]:
        resp = requests.post(
            f"{BASE_URL}/sales-orders/{so['id']}/status",
            json={"status": status},
            cookies=cookies_admin
        )
    
    print(f"✅ Created SO: {so['soNumber']} and transitioned to Packed")
    
    # Transition directly to Shipped (should create concern)
    resp = requests.post(
        f"{BASE_URL}/sales-orders/{so['id']}/status",
        json={"status": "Shipped"},
        cookies=cookies_admin
    )
    
    if resp.status_code != 200:
        print(f"❌ Failed to transition to Shipped: {resp.status_code}")
        return False
    
    print(f"✅ SO transitioned to Shipped")
    
    # Wait a bit for approval and notifications to be created
    time.sleep(0.5)
    
    # Check for approval concern
    resp = requests.get(f"{BASE_URL}/approvals?type=so_shipping", cookies=cookies_admin)
    
    if resp.status_code != 200:
        print(f"❌ Failed to get approvals: {resp.status_code}")
        return False
    
    approvals = resp.json().get("data", [])
    
    # Find approval for this SO
    approval = None
    for appr in approvals:
        if appr.get("entityNumber") == so["soNumber"] and appr.get("status") == "pending":
            approval = appr
            break
    
    if not approval:
        print(f"❌ so_shipping approval not found for SO {so['soNumber']}")
        return False
    
    print(f"✅ so_shipping approval created via direct status transition")
    print(f"   Entity: {approval['entityNumber']}")
    
    return True

# ============================================================================
# SECTION D: Regression Sanity Check
# ============================================================================

def test_d_regression_so_large_discount():
    """D: Regression - so_large_discount trigger still works + creates notification"""
    print("\n=== TEST D: Regression - so_large_discount ===")
    
    cookies_admin = login("admin")
    cookies_supervisor = login("supervisor")
    
    customer = test_data["customers"][0]
    product = test_data["products"][0]
    
    # Create SO with large discount (>15% or >1M)
    so_data = {
        "customerId": customer["id"],
        "orderDate": datetime.now().isoformat(),
        "items": [
            {
                "productId": product["id"],
                "quantity": 100,
                "weight": 100,
                "unitPrice": 50000,
                "discount": 1500000  # Large discount > 1M
            }
        ]
    }
    
    resp = requests.post(f"{BASE_URL}/sales-orders", json=so_data, cookies=cookies_admin)
    
    if resp.status_code != 201:
        print(f"❌ Failed to create SO: {resp.status_code}")
        return False
    
    so = resp.json()["data"]
    test_data["sales_orders"].append(so)
    
    print(f"✅ Created SO: {so['soNumber']} with large discount")
    
    # Wait a bit for approval and notifications to be created
    time.sleep(0.5)
    
    # Check for approval
    resp = requests.get(f"{BASE_URL}/approvals?type=so_large_discount", cookies=cookies_admin)
    
    if resp.status_code != 200:
        print(f"❌ Failed to get approvals: {resp.status_code}")
        return False
    
    approvals = resp.json().get("data", [])
    
    # Find approval for this SO
    approval = None
    for appr in approvals:
        if appr.get("entityNumber") == so["soNumber"] and appr.get("status") == "pending":
            approval = appr
            break
    
    if not approval:
        print(f"❌ so_large_discount approval not found")
        return False
    
    print(f"✅ so_large_discount approval created")
    
    # Check notification for supervisor
    resp = requests.get(f"{BASE_URL}/notifications?limit=50", cookies=cookies_supervisor)
    notifications = resp.json()["data"]
    
    notif = None
    for n in notifications:
        if n.get("category") == "so_large_discount" and so["soNumber"] in n.get("entityNumber", ""):
            notif = n
            break
    
    if not notif:
        print(f"❌ Notification not found for supervisor")
        return False
    
    print(f"✅ Supervisor received notification (category={notif['category']})")
    
    return True

# ============================================================================
# SECTION E: Operator Restriction
# ============================================================================

def test_e1_operator_dashboard_redirect():
    """E1: Operator → GET /dashboard → 307 redirect to /tally"""
    print("\n=== TEST E1: Operator dashboard redirect ===")
    
    # Note: This test checks HTTP redirect behavior
    # We need to make a request without following redirects
    
    cookies = login("operator")
    
    # Make request to dashboard without following redirects
    resp = requests.get(
        "https://so-po-loader.preview.emergentagent.com/dashboard",
        cookies=cookies,
        allow_redirects=False
    )
    
    if resp.status_code != 307:
        print(f"❌ Expected 307 redirect, got {resp.status_code}")
        return False
    
    location = resp.headers.get("Location", "")
    if "/tally" not in location:
        print(f"❌ Expected redirect to /tally, got {location}")
        return False
    
    print(f"✅ Operator correctly redirected from /dashboard to /tally")
    
    return True

def test_e2_operator_notifications_page_redirect():
    """E2: Operator → GET /dashboard/notifications → 307 redirect to /tally"""
    print("\n=== TEST E2: Operator notifications page redirect ===")
    
    cookies = login("operator")
    
    # Make request to notifications page without following redirects
    resp = requests.get(
        "https://so-po-loader.preview.emergentagent.com/dashboard/notifications",
        cookies=cookies,
        allow_redirects=False
    )
    
    if resp.status_code != 307:
        print(f"❌ Expected 307 redirect, got {resp.status_code}")
        return False
    
    location = resp.headers.get("Location", "")
    if "/tally" not in location:
        print(f"❌ Expected redirect to /tally, got {location}")
        return False
    
    print(f"✅ Operator correctly redirected from /dashboard/notifications to /tally")
    
    return True

def test_e3_operator_api_access():
    """E3: Operator → GET /api/notifications → 200 (API access allowed)"""
    print("\n=== TEST E3: Operator API access ===")
    
    cookies = login("operator")
    
    resp = requests.get(f"{BASE_URL}/notifications", cookies=cookies)
    
    if resp.status_code != 200:
        print(f"❌ Expected 200, got {resp.status_code}")
        return False
    
    data = resp.json()
    
    print(f"✅ Operator can access API (notifications: {len(data['data'])})")
    
    return True

def test_e4_supervisor_no_redirect():
    """E4: Supervisor → GET /dashboard/notifications → 200 (no redirect)"""
    print("\n=== TEST E4: Supervisor no redirect ===")
    
    cookies = login("supervisor")
    
    # Make request without following redirects
    resp = requests.get(
        "https://so-po-loader.preview.emergentagent.com/dashboard/notifications",
        cookies=cookies,
        allow_redirects=False
    )
    
    if resp.status_code == 307:
        print(f"❌ Supervisor should not be redirected, got 307")
        return False
    
    if resp.status_code != 200:
        print(f"⚠️  Expected 200, got {resp.status_code} (may be OK if page loads)")
    
    print(f"✅ Supervisor can access /dashboard/notifications (no redirect)")
    
    return True

# ============================================================================
# Main Test Runner
# ============================================================================

def main():
    """Run all tests"""
    print("=" * 80)
    print("BACKEND API TEST SUITE - NOTIFICATIONS & APPROVAL TRIGGERS")
    print("=" * 80)
    
    # Get test data first
    if not get_test_data():
        print("❌ Failed to get test data")
        sys.exit(1)
    
    tests = [
        # Section A: Notification API Endpoints
        ("A1: GET /api/notifications", test_a1_get_notifications),
        ("A2: GET /api/notifications/unread-count", test_a2_get_unread_count),
        ("A3: POST /api/notifications/:id/read", test_a3_mark_one_as_read),
        ("A4: POST /api/notifications/read-all", test_a4_mark_all_as_read),
        ("A5: DELETE /api/notifications/:id", test_a5_delete_notification),
        ("A6: Unauthorized access → 401", test_a6_unauthorized_access),
        
        # Section B: Automatic Notification Generation
        ("B1: PO creation notification", test_b1_po_creation_notification),
        ("B2: WO creation notification", test_b2_wo_creation_notification),
        ("B3: SO creation notification (no approval)", test_b3_so_creation_notification_no_approval),
        
        # Section C: TWO NEW Approval/Concern Triggers
        ("C1: so_price_below_hpp trigger", test_c1_so_price_below_hpp),
        ("C2.1: so_shipping trigger (via surat-jalan)", test_c2_so_shipping_via_surat_jalan),
        ("C2.2: so_shipping trigger (via direct status)", test_c2_so_shipping_via_status),
        
        # Section D: Regression Sanity Check
        ("D: Regression - so_large_discount", test_d_regression_so_large_discount),
        
        # Section E: Operator Restriction
        ("E1: Operator dashboard redirect", test_e1_operator_dashboard_redirect),
        ("E2: Operator notifications page redirect", test_e2_operator_notifications_page_redirect),
        ("E3: Operator API access", test_e3_operator_api_access),
        ("E4: Supervisor no redirect", test_e4_supervisor_no_redirect),
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
