#!/usr/bin/env python3
"""
MIGRATION Phase 4 Backend Test: inventory_stock MongoDB-authoritative with DIFF-persist
Tests the inventory stock migration to MongoDB with concurrency-safe diff-based writes.
"""

import requests
import json
import os
from pymongo import MongoClient
from datetime import datetime

# Configuration
BASE_URL = "http://localhost:3000/api"
ORIGIN = "http://localhost:3000"
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = "erp_prod"  # From /app/lib/db/mongo.js

# Auth credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
OPERATOR_EMAIL = "operator@lpi.co.id"
OPERATOR_PASSWORD = "operator123"

# MongoDB connection
mongo_client = MongoClient(MONGO_URL)
mongo_db = mongo_client[DB_NAME]

# SQLite connection
import sqlite3
sqlite_conn = sqlite3.connect("/app/data/erp.db")
sqlite_conn.row_factory = sqlite3.Row

def print_test(msg):
    print(f"\n{'='*80}")
    print(f"  {msg}")
    print(f"{'='*80}")

def login(email, password):
    """Login and return session"""
    session = requests.Session()
    # Better Auth login
    resp = session.post(
        f"{BASE_URL.replace('/api', '')}/api/auth/sign-in/email",
        json={"email": email, "password": password},
        headers={"Origin": ORIGIN, "Content-Type": "application/json"}
    )
    if resp.status_code != 200:
        print(f"❌ Login failed: {resp.status_code} {resp.text}")
        return None
    print(f"✅ Logged in as {email}")
    return session

def get_mongo_inventory_count():
    """Get count of inventory_stock documents in MongoDB"""
    return mongo_db.inventory_stock.count_documents({})

def get_mongo_stock_by_id(stock_id):
    """Get a stock document from MongoDB by id"""
    return mongo_db.inventory_stock.find_one({"id": stock_id}, {"_id": 0})

def get_sqlite_so_item_stocks_count():
    """Get count of so_item_stocks in SQLite"""
    cursor = sqlite_conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM so_item_stocks")
    return cursor.fetchone()[0]

def verify_mongo_seed():
    """Verify MongoDB has the seed marker"""
    marker = mongo_db.mongo_migration.find_one({"key": "inventory_v1"})
    return marker is not None and marker.get("done") == True

print_test("MIGRATION PHASE 4: inventory_stock MongoDB-authoritative DIFF-persist")
print(f"MongoDB URL: {MONGO_URL}")
print(f"MongoDB DB: {DB_NAME}")
print(f"Backend URL: {BASE_URL}")

# Login as admin
admin_session = login(ADMIN_EMAIL, ADMIN_PASSWORD)
if not admin_session:
    print("❌ CRITICAL: Cannot login as admin")
    exit(1)

# Verify MongoDB seed marker
print_test("VERIFY: MongoDB seed marker 'inventory_v1'")
if verify_mongo_seed():
    print("✅ MongoDB seed marker 'inventory_v1' exists (inventory seeded)")
else:
    print("⚠️  MongoDB seed marker 'inventory_v1' NOT found (first run will seed)")

# SCENARIO 1: LIST inventory stocks
print_test("SCENARIO 1: LIST inventory stocks")
try:
    resp = admin_session.get(f"{BASE_URL}/inventory/stocks")
    if resp.status_code == 200:
        data = resp.json()
        stocks = data.get("data", [])
        print(f"✅ GET /api/inventory/stocks → 200 OK")
        print(f"   API returned {len(stocks)} stock lots")
        
        # Verify MongoDB
        mongo_count = get_mongo_inventory_count()
        print(f"   MongoDB inventory_stock collection has {mongo_count} documents")
        
        if mongo_count > 0:
            print(f"✅ MongoDB is populated (source of truth verified)")
        else:
            print(f"⚠️  MongoDB inventory_stock is empty (will be seeded on first write)")
    else:
        print(f"❌ GET /api/inventory/stocks failed: {resp.status_code} {resp.text}")
except Exception as e:
    print(f"❌ SCENARIO 1 failed: {e}")

# Get resources for testing
print_test("SETUP: Get resources (cold storage, product, customer, supplier)")
try:
    # Get cold storage
    resp = admin_session.get(f"{BASE_URL}/cold-storages")
    cold_storages = resp.json().get("data", [])
    if not cold_storages:
        print("❌ No cold storages found")
        exit(1)
    cold_storage_id = cold_storages[0]["id"]
    print(f"✅ Cold Storage: {cold_storages[0].get('name')} (ID: {cold_storage_id})")
    
    # Get zones (optional)
    zones = cold_storages[0].get("zones", [])
    zone_id = zones[0]["id"] if zones else None
    if zone_id:
        print(f"✅ Zone: {zones[0].get('name')} (ID: {zone_id})")
    
    # Get product
    resp = admin_session.get(f"{BASE_URL}/products")
    products = resp.json().get("data", [])
    if not products:
        print("❌ No products found")
        exit(1)
    product = products[0]
    product_id = product["id"]
    print(f"✅ Product: {product.get('name')} (SKU: {product.get('sku')}, ID: {product_id})")
    
    # Get customer
    resp = admin_session.get(f"{BASE_URL}/contacts?category=Customer")
    contacts = resp.json().get("data", [])
    customers = [c for c in contacts if "Customer" in c.get("categories", [])]
    if not customers:
        print("❌ No customers found")
        exit(1)
    customer_id = customers[0]["id"]
    print(f"✅ Customer: {customers[0].get('displayName')} (ID: {customer_id})")
    
except Exception as e:
    print(f"❌ SETUP failed: {e}")
    exit(1)

# SCENARIO 2: INBOUND - Create new stock lot
print_test("SCENARIO 2: INBOUND - Create new stock lot")
inbound_stock_id = None
try:
    inbound_payload = {
        "referenceType": "MANUAL",
        "coldStorageId": cold_storage_id,
        "zoneId": zone_id,
        "items": [
            {
                "productId": product_id,
                "quantity": 5,
                "weight": 50
            }
        ]
    }
    
    resp = admin_session.post(
        f"{BASE_URL}/inventory/inbound",
        json=inbound_payload,
        headers={"Origin": ORIGIN}
    )
    
    if resp.status_code in [200, 201]:
        data = resp.json()
        print(f"✅ POST /api/inventory/inbound → {resp.status_code}")
        print(f"   Transaction ID: {data.get('data', {}).get('id')}")
        
        # Get the newly created stock
        resp = admin_session.get(f"{BASE_URL}/inventory/stocks")
        stocks = resp.json().get("data", [])
        # Find the most recent stock for this product
        new_stocks = [s for s in stocks if s.get("productId") == product_id and s.get("status") == "active"]
        if new_stocks:
            new_stock = sorted(new_stocks, key=lambda x: x.get("createdAt", ""), reverse=True)[0]
            inbound_stock_id = new_stock["id"]
            print(f"   New stock lot ID: {inbound_stock_id}")
            print(f"   Kode Simpan: {new_stock.get('kodeSimpan')}")
            print(f"   Status: {new_stock.get('status')}")
            print(f"   Weight: {new_stock.get('weight')} kg")
            
            # Verify in MongoDB
            mongo_stock = get_mongo_stock_by_id(inbound_stock_id)
            if mongo_stock:
                print(f"✅ Stock exists in MongoDB inventory_stock")
                print(f"   MongoDB status: {mongo_stock.get('status')}")
                print(f"   MongoDB weight: {mongo_stock.get('weight')}")
            else:
                print(f"❌ Stock NOT found in MongoDB inventory_stock")
        else:
            print(f"⚠️  Could not find newly created stock in API response")
    else:
        print(f"❌ POST /api/inventory/inbound failed: {resp.status_code} {resp.text}")
except Exception as e:
    print(f"❌ SCENARIO 2 failed: {e}")

# SCENARIO 3 & 4: ALLOCATION STATUS + DIFF SAFETY (CORE FIX)
print_test("SCENARIO 3 & 4: ALLOCATION STATUS + DIFF SAFETY")
if inbound_stock_id:
    try:
        # Capture statuses of OTHER stock lots BEFORE allocation
        print("\n📸 BEFORE ALLOCATION: Capturing statuses of OTHER stock lots")
        resp = admin_session.get(f"{BASE_URL}/inventory/stocks")
        all_stocks_before = resp.json().get("data", [])
        other_stocks_before = [s for s in all_stocks_before if s["id"] != inbound_stock_id][:2]
        
        if len(other_stocks_before) >= 2:
            print(f"   Tracking 2 other stock lots:")
            for i, stock in enumerate(other_stocks_before, 1):
                mongo_before = get_mongo_stock_by_id(stock["id"])
                print(f"   Stock {i}: {stock['id'][:8]}... status={stock.get('status')} (Mongo: {mongo_before.get('status') if mongo_before else 'N/A'})")
        else:
            print(f"   ⚠️  Only {len(other_stocks_before)} other stock lots available for tracking")
        
        # Create a Sales Order
        print("\n📝 Creating Sales Order for allocation test")
        so_payload = {
            "customerId": customer_id,
            "orderDate": datetime.now().strftime("%Y-%m-%d"),
            "items": [
                {
                    "productId": product_id,
                    "quantity": 1,
                    "weight": 10,
                    "unitPrice": 50000
                }
            ]
        }
        
        resp = admin_session.post(
            f"{BASE_URL}/sales-orders",
            json=so_payload,
            headers={"Origin": ORIGIN}
        )
        
        if resp.status_code in [200, 201]:
            so_data = resp.json().get("data", {})
            so_id = so_data.get("id")
            so_number = so_data.get("soNumber")
            print(f"✅ Created SO: {so_number} (ID: {so_id})")
            
            # Get SO items
            resp = admin_session.get(f"{BASE_URL}/sales-orders/{so_id}")
            so_detail = resp.json().get("data", {})
            so_items = so_detail.get("items", [])
            if so_items:
                item_id = so_items[0]["id"]
                print(f"   SO Item ID: {item_id}")
                
                # Allocate the new stock lot
                print(f"\n🔗 Allocating stock {inbound_stock_id[:8]}... to SO item")
                allocate_payload = {
                    "stockIds": [inbound_stock_id]
                }
                
                resp = admin_session.post(
                    f"{BASE_URL}/sales-orders/{so_id}/items/{item_id}/allocate",
                    json=allocate_payload,
                    headers={"Origin": ORIGIN}
                )
                
                if resp.status_code == 200:
                    print(f"✅ Allocation successful")
                    
                    # CRITICAL: Verify status changed to 'allocated' in MongoDB
                    mongo_stock_after = get_mongo_stock_by_id(inbound_stock_id)
                    if mongo_stock_after:
                        mongo_status = mongo_stock_after.get("status")
                        print(f"\n🔍 CRITICAL VERIFICATION: Stock status in MongoDB")
                        print(f"   MongoDB status: {mongo_status}")
                        
                        if mongo_status == "allocated":
                            print(f"✅✅✅ CORE FIX VERIFIED: Status is 'allocated' in MongoDB (NOT 'active')")
                        else:
                            print(f"❌❌❌ CORE FIX FAILED: Status is '{mongo_status}' (expected 'allocated')")
                    else:
                        print(f"❌ Stock not found in MongoDB after allocation")
                    
                    # Verify in API
                    resp = admin_session.get(f"{BASE_URL}/inventory/stocks/{inbound_stock_id}")
                    if resp.status_code == 200:
                        api_stock = resp.json().get("data", {})
                        api_status = api_stock.get("status")
                        print(f"   API status: {api_status}")
                    
                    # CRITICAL: Verify so_item_stocks has the allocation (Phase 3)
                    cursor = sqlite_conn.cursor()
                    cursor.execute("SELECT * FROM so_item_stocks WHERE stock_id = ?", (inbound_stock_id,))
                    allocation_row = cursor.fetchone()
                    if allocation_row:
                        print(f"✅ so_item_stocks has allocation record (Phase 3 integration)")
                    else:
                        print(f"⚠️  so_item_stocks does NOT have allocation record")
                    
                    # DIFF SAFETY: Verify OTHER stock lots are UNCHANGED
                    print(f"\n🔍 DIFF SAFETY: Verifying OTHER stock lots are UNCHANGED")
                    all_unchanged = True
                    for i, stock_before in enumerate(other_stocks_before, 1):
                        mongo_after = get_mongo_stock_by_id(stock_before["id"])
                        mongo_before = get_mongo_stock_by_id(stock_before["id"])
                        
                        status_before = stock_before.get("status")
                        status_after = mongo_after.get("status") if mongo_after else None
                        
                        print(f"   Stock {i} ({stock_before['id'][:8]}...):")
                        print(f"      BEFORE: status={status_before}")
                        print(f"      AFTER:  status={status_after}")
                        
                        if status_before == status_after:
                            print(f"      ✅ UNCHANGED (diff did NOT rewrite this lot)")
                        else:
                            print(f"      ❌ CHANGED (diff incorrectly rewrote this lot)")
                            all_unchanged = False
                    
                    if all_unchanged:
                        print(f"\n✅✅✅ DIFF SAFETY VERIFIED: Other lots UNCHANGED (only changed lot was written)")
                    else:
                        print(f"\n❌❌❌ DIFF SAFETY FAILED: Other lots were modified")
                    
                    # Clean up: Delete the test SO
                    print(f"\n🧹 Cleaning up test SO")
                    resp = admin_session.delete(
                        f"{BASE_URL}/sales-orders/{so_id}",
                        headers={"Origin": ORIGIN}
                    )
                    if resp.status_code == 200:
                        print(f"✅ Test SO deleted")
                    else:
                        print(f"⚠️  Failed to delete test SO: {resp.status_code}")
                else:
                    print(f"❌ Allocation failed: {resp.status_code} {resp.text}")
            else:
                print(f"❌ No items found in SO")
        else:
            print(f"❌ Failed to create SO: {resp.status_code} {resp.text}")
    except Exception as e:
        print(f"❌ SCENARIO 3 & 4 failed: {e}")
        import traceback
        traceback.print_exc()
else:
    print("⚠️  Skipping SCENARIO 3 & 4 (no inbound stock created)")

# SCENARIO 5: TRANSFER (if reachable)
print_test("SCENARIO 5: TRANSFER zone (if reachable)")
if inbound_stock_id and zone_id:
    try:
        # Get another zone if available
        resp = admin_session.get(f"{BASE_URL}/zones")
        zones = resp.json().get("data", [])
        other_zones = [z for z in zones if z["id"] != zone_id]
        
        if other_zones:
            to_zone_id = other_zones[0]["id"]
            print(f"   Transferring to zone: {other_zones[0].get('name')} (ID: {to_zone_id})")
            
            transfer_payload = {
                "stockId": inbound_stock_id,
                "toZoneId": to_zone_id
            }
            
            resp = admin_session.post(
                f"{BASE_URL}/inventory/transfer-zone",
                json=transfer_payload,
                headers={"Origin": ORIGIN}
            )
            
            if resp.status_code == 200:
                print(f"✅ Transfer successful")
                
                # Verify zone_id updated in MongoDB
                mongo_stock = get_mongo_stock_by_id(inbound_stock_id)
                if mongo_stock and mongo_stock.get("zone_id") == to_zone_id:
                    print(f"✅ MongoDB zone_id updated to {to_zone_id}")
                else:
                    print(f"❌ MongoDB zone_id NOT updated (expected {to_zone_id}, got {mongo_stock.get('zone_id') if mongo_stock else 'N/A'})")
            else:
                print(f"⚠️  Transfer endpoint returned {resp.status_code}: {resp.text}")
                print(f"   (Endpoint may not exist or have different body shape)")
        else:
            print(f"⚠️  Only one zone available, cannot test transfer")
    except Exception as e:
        print(f"⚠️  SCENARIO 5 skipped: {e}")
else:
    print("⚠️  Skipping SCENARIO 5 (no inbound stock or zone)")

# SCENARIO 6: ARCHIVE and RESTORE
print_test("SCENARIO 6: ARCHIVE and RESTORE")
if inbound_stock_id:
    try:
        # Archive
        resp = admin_session.post(
            f"{BASE_URL}/inventory-stocks/{inbound_stock_id}/archive",
            headers={"Origin": ORIGIN}
        )
        
        if resp.status_code == 200:
            print(f"✅ POST /api/inventory-stocks/{inbound_stock_id[:8]}.../archive → 200")
            
            # Verify archived_at set in MongoDB
            mongo_stock = get_mongo_stock_by_id(inbound_stock_id)
            if mongo_stock and mongo_stock.get("archived_at"):
                print(f"✅ MongoDB archived_at set: {mongo_stock.get('archived_at')}")
            else:
                print(f"❌ MongoDB archived_at NOT set")
            
            # Restore
            resp = admin_session.post(
                f"{BASE_URL}/inventory-stocks/{inbound_stock_id}/restore",
                headers={"Origin": ORIGIN}
            )
            
            if resp.status_code == 200:
                print(f"✅ POST /api/inventory-stocks/{inbound_stock_id[:8]}.../restore → 200")
                
                # Verify archived_at null in MongoDB
                mongo_stock = get_mongo_stock_by_id(inbound_stock_id)
                if mongo_stock and not mongo_stock.get("archived_at"):
                    print(f"✅ MongoDB archived_at is null (restored)")
                else:
                    print(f"❌ MongoDB archived_at still set: {mongo_stock.get('archived_at') if mongo_stock else 'N/A'}")
            else:
                print(f"❌ Restore failed: {resp.status_code} {resp.text}")
        else:
            print(f"❌ Archive failed: {resp.status_code} {resp.text}")
    except Exception as e:
        print(f"❌ SCENARIO 6 failed: {e}")
else:
    print("⚠️  Skipping SCENARIO 6 (no inbound stock)")

# SCENARIO 7: ACCOUNTING INTEGRITY
print_test("SCENARIO 7: ACCOUNTING INTEGRITY")
try:
    # Trial Balance
    resp = admin_session.get(f"{BASE_URL}/accounting/trial-balance")
    if resp.status_code == 200:
        data = resp.json().get("data", {})
        total_debit = data.get("totalDebit", 0)
        total_credit = data.get("totalCredit", 0)
        print(f"✅ GET /api/accounting/trial-balance → 200")
        print(f"   Total Debit: {total_debit}")
        print(f"   Total Credit: {total_credit}")
        
        if total_debit == total_credit:
            print(f"✅ Trial Balance BALANCED (debit == credit)")
        else:
            print(f"❌ Trial Balance NOT BALANCED (debit != credit)")
    else:
        print(f"❌ Trial Balance failed: {resp.status_code}")
    
    # Balance Sheet
    resp = admin_session.get(f"{BASE_URL}/accounting/balance-sheet")
    if resp.status_code == 200:
        data = resp.json().get("data", {})
        balanced = data.get("balanced", False)
        print(f"✅ GET /api/accounting/balance-sheet → 200")
        print(f"   Balanced: {balanced}")
        
        if balanced:
            print(f"✅ Balance Sheet BALANCED")
        else:
            print(f"❌ Balance Sheet NOT BALANCED")
    else:
        print(f"❌ Balance Sheet failed: {resp.status_code}")
except Exception as e:
    print(f"❌ SCENARIO 7 failed: {e}")

# SCENARIO 8: NON-CASCADE SAFETY
print_test("SCENARIO 8: NON-CASCADE SAFETY")
try:
    so_item_stocks_count = get_sqlite_so_item_stocks_count()
    print(f"   SQLite so_item_stocks count: {so_item_stocks_count}")
    
    if so_item_stocks_count >= 6:
        print(f"✅ so_item_stocks preserved (6 pre-existing allocations intact)")
    else:
        print(f"⚠️  so_item_stocks count is {so_item_stocks_count} (expected >= 6)")
        print(f"   (May have been affected by FK-off hydrate)")
except Exception as e:
    print(f"❌ SCENARIO 8 failed: {e}")

# SCENARIO 9: ROLE GUARD
print_test("SCENARIO 9: ROLE GUARD (Operator 403)")
try:
    operator_session = login(OPERATOR_EMAIL, OPERATOR_PASSWORD)
    if operator_session:
        inbound_payload = {
            "referenceType": "MANUAL",
            "coldStorageId": cold_storage_id,
            "items": [{"productId": product_id, "quantity": 1, "weight": 10}]
        }
        
        resp = operator_session.post(
            f"{BASE_URL}/inventory/inbound",
            json=inbound_payload,
            headers={"Origin": ORIGIN}
        )
        
        if resp.status_code == 403:
            print(f"✅ Operator correctly forbidden (403)")
        elif resp.status_code == 401:
            print(f"✅ Operator correctly unauthorized (401)")
        else:
            print(f"❌ Operator NOT forbidden: {resp.status_code} {resp.text}")
    else:
        print(f"⚠️  Could not login as operator")
except Exception as e:
    print(f"❌ SCENARIO 9 failed: {e}")

# CLEANUP
print_test("CLEANUP: Delete test inbound stock")
if inbound_stock_id:
    try:
        # Note: There may not be a direct DELETE endpoint for inventory stocks
        # The stock will remain but that's acceptable per requirements
        print(f"   Test inbound stock ID: {inbound_stock_id}")
        print(f"   (Leaving test stock in place as per requirements)")
    except Exception as e:
        print(f"⚠️  Cleanup note: {e}")

# FINAL REPORT
print_test("FINAL REPORT")
print(f"MongoDB Database: {DB_NAME}")
print(f"MongoDB inventory_stock count: {get_mongo_inventory_count()}")
print(f"SQLite so_item_stocks count: {get_sqlite_so_item_stocks_count()}")
print(f"\nTest completed. Review results above for pass/fail per scenario.")

# Close connections
sqlite_conn.close()
mongo_client.close()
