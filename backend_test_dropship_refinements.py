#!/usr/bin/env python3
"""
Backend test for TWO Dropship Refinements:
1. SO detail COGS for DROPSHIP = HPP PO Dropship (linked PO totalAmount), NOT 0
2. PO detail per-item billedWeight based on invoice basis (grn/so_receipt)
"""

import subprocess
import json
import sqlite3
from datetime import datetime

BASE_URL = "http://localhost:3000/api"
DB_PATH = "/app/data/erp.db"
COOKIE_FILE = "/tmp/test_dropship_refinements_cookies.txt"

# Test data tracking for cleanup
test_data = {
    "sales_order_id": None,
    "purchase_order_id": None,
    "surat_jalan_id": None,
    "grn_id": None,
    "receipt_id": None,
    "supplier_id": None,
    "customer_id": None,
    "product_id": None
}

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def curl_request(method, url, data=None, expect_json=True):
    """Make a curl request with cookie handling"""
    cmd = ["curl", "-s", "-b", COOKIE_FILE, "-c", COOKIE_FILE]
    
    if method == "POST":
        cmd.extend(["-X", "POST"])
    elif method == "PATCH":
        cmd.extend(["-X", "PATCH"])
    elif method == "DELETE":
        cmd.extend(["-X", "DELETE"])
    
    if data:
        cmd.extend(["-H", "Content-Type: application/json", "-d", json.dumps(data)])
    
    cmd.append(url)
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if expect_json:
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError:
            log(f"ERROR: Failed to parse JSON response: {result.stdout[:500]}")
            raise Exception(f"Failed to parse JSON response: {result.stdout[:200]}")
    else:
        return result.stdout

def login():
    """Login as admin"""
    log("Logging in as admin@lpi.co.id...")
    response = curl_request("POST", f"{BASE_URL}/auth/sign-in/email", {
        "email": "admin@lpi.co.id",
        "password": "admin123"
    })
    if response.get("user"):
        log(f"✓ Logged in as {response['user']['email']}")
        return True
    else:
        log(f"✗ Login failed: {response}")
        return False

def find_or_create_supplier():
    """Find existing supplier or use first available"""
    log("Finding supplier...")
    response = curl_request("GET", f"{BASE_URL}/contacts?type=Supplier")
    if response.get("data") and len(response["data"]) > 0:
        supplier = response["data"][0]
        log(f"✓ Using supplier: {supplier['displayName']} ({supplier['code']})")
        return supplier["id"]
    else:
        log("✗ No supplier found")
        return None

def find_or_create_customer():
    """Find existing customer or use first available"""
    log("Finding customer...")
    response = curl_request("GET", f"{BASE_URL}/contacts?type=Customer")
    if response.get("data") and len(response["data"]) > 0:
        customer = response["data"][0]
        log(f"✓ Using customer: {customer['displayName']} ({customer['code']})")
        return customer["id"]
    else:
        log("✗ No customer found")
        return None

def find_or_create_product():
    """Find existing product with sell and buy prices"""
    log("Finding product...")
    response = curl_request("GET", f"{BASE_URL}/products")
    if response.get("data") and len(response["data"]) > 0:
        product = response["data"][0]
        log(f"✓ Using product: {product['name']} ({product['sku']})")
        log(f"  Base price: Rp {product.get('basePrice', 0)}")
        return product["id"]
    else:
        log("✗ No product found")
        return None

def create_dropship_so(supplier_id, customer_id, product_id):
    """Create a dropship SO with ordered 10kg, sell 27000, buy 21600"""
    log("\n=== STEP 2: Create DROPSHIP SO ===")
    log("Creating dropship SO: 10kg ordered, sell Rp27,000, buy Rp21,600...")
    
    payload = {
        "customerId": customer_id,
        "fulfillmentType": "dropship",
        "supplierId": supplier_id,
        "orderDate": datetime.now().isoformat(),
        "items": [
            {
                "productId": product_id,
                "quantity": 10,
                "weight": 10,
                "unitPrice": 27000,
                "buyPrice": 21600
            }
        ]
    }
    
    response = curl_request("POST", f"{BASE_URL}/sales-orders", payload)
    
    if response.get("data"):
        so = response["data"]
        test_data["sales_order_id"] = so["id"]
        test_data["purchase_order_id"] = so.get("autoPoId")
        log(f"✓ SO created: {so['soNumber']} (ID: {so['id']})")
        log(f"  SO totalAmount: Rp {so['totalAmount']:,} (expected: Rp 270,000)")
        log(f"  autoPoId: {so.get('autoPoId')}")
        
        if so["totalAmount"] != 270000:
            log(f"  ⚠ WARNING: SO total should be 270,000 but got {so['totalAmount']}")
        
        return so["id"], so.get("autoPoId")
    else:
        log(f"✗ Failed to create SO: {response}")
        return None, None

def advance_so_status(so_id, status):
    """Advance SO status"""
    log(f"Advancing SO to {status}...")
    response = curl_request("POST", f"{BASE_URL}/sales-orders/{so_id}/status", {"status": status})
    
    if response.get("data"):
        log(f"✓ SO status: {response['data']['pipelineStatus']}")
        return True
    else:
        log(f"✗ Failed to advance SO: {response}")
        return False

def create_surat_jalan(so_id, item_id, shipped_weight):
    """Create Surat Jalan with shipped weight"""
    log(f"\n=== STEP 4: Create Surat Jalan (shipped {shipped_weight}kg) ===")
    
    payload = {
        "salesOrderId": so_id,
        "deliveryDate": datetime.now().isoformat(),
        "driverName": "Test Driver",
        "vehiclePlate": "B1234XYZ",
        "items": [
            {
                "itemId": item_id,
                "shippedWeight": shipped_weight
            }
        ]
    }
    
    response = curl_request("POST", f"{BASE_URL}/sales-orders/{so_id}/surat-jalan", payload)
    
    if response.get("data"):
        sj = response["data"]
        test_data["surat_jalan_id"] = sj["id"]
        log(f"✓ Surat Jalan created: {sj['sjNumber']} (ID: {sj['id']})")
        log(f"  Shipped weight: {shipped_weight}kg")
        return sj["id"]
    else:
        log(f"✗ Failed to create Surat Jalan: {response}")
        return None

def verify_po_refinement2(po_id, expected_billed_weight, expected_total):
    """VERIFY Refinement 2: PO billedWeight and totalAmount"""
    log(f"\n=== STEP 5: VERIFY Refinement 2 (PO billedWeight) ===")
    
    response = curl_request("GET", f"{BASE_URL}/purchase-orders/{po_id}")
    
    if response.get("data"):
        po = response["data"]
        log(f"✓ PO retrieved: {po['poNumber']}")
        log(f"  Invoice basis: {po.get('invoiceWeightBasis', 'N/A')}")
        log(f"  PO totalAmount: Rp {po['totalAmount']:,}")
        
        if po.get("items") and len(po["items"]) > 0:
            item = po["items"][0]
            billed_weight = item.get("billedWeight", 0)
            log(f"  Item billedWeight: {billed_weight}kg (expected: {expected_billed_weight}kg)")
            
            # Check billedWeight
            if abs(billed_weight - expected_billed_weight) < 0.01:
                log(f"  ✓ PASS: billedWeight == {expected_billed_weight}kg")
            else:
                log(f"  ✗ FAIL: billedWeight should be {expected_billed_weight}kg but got {billed_weight}kg")
                return False
            
            # Check totalAmount
            if abs(po["totalAmount"] - expected_total) < 1:
                log(f"  ✓ PASS: PO totalAmount == Rp {expected_total:,}")
            else:
                log(f"  ✗ FAIL: PO totalAmount should be Rp {expected_total:,} but got Rp {po['totalAmount']:,}")
                return False
            
            # Check GRN data
            if po.get("grn") and len(po["grn"]) > 0:
                grn = po["grn"][0]
                log(f"  GRN: {grn.get('grnNumber', 'N/A')} (notes: {grn.get('notes', 'N/A')})")
                if grn.get("items") and len(grn["items"]) > 0:
                    grn_item = grn["items"][0]
                    log(f"  GRN received weight: {grn_item.get('receivedWeight', 0)}kg")
                    test_data["grn_id"] = grn["id"]
            
            return True
        else:
            log("  ✗ No items in PO")
            return False
    else:
        log(f"✗ Failed to get PO: {response}")
        return False

def verify_so_refinement1(so_id, expected_cogs_total, expected_gross_profit_min):
    """VERIFY Refinement 1: SO cogsTotal and grossProfit"""
    log(f"\n=== STEP 6: VERIFY Refinement 1 (SO cogsTotal) ===")
    
    response = curl_request("GET", f"{BASE_URL}/sales-orders/{so_id}")
    
    if response.get("data"):
        so = response["data"]
        log(f"✓ SO retrieved: {so['soNumber']}")
        log(f"  SO totalAmount (revenue): Rp {so['totalAmount']:,}")
        log(f"  cogsTotal: Rp {so.get('cogsTotal', 0):,} (expected: Rp {expected_cogs_total:,})")
        log(f"  grossProfit: Rp {so.get('grossProfit', 0):,}")
        log(f"  sellerShipping: Rp {so.get('sellerShipping', 0):,}")
        
        cogs_total = so.get("cogsTotal", 0)
        gross_profit = so.get("grossProfit", 0)
        
        # Check cogsTotal is NOT 0
        if cogs_total == 0:
            log(f"  ✗ FAIL: cogsTotal is 0 (should be {expected_cogs_total:,})")
            return False
        else:
            log(f"  ✓ PASS: cogsTotal is NOT 0")
        
        # Check cogsTotal matches expected
        if abs(cogs_total - expected_cogs_total) < 1:
            log(f"  ✓ PASS: cogsTotal == Rp {expected_cogs_total:,}")
        else:
            log(f"  ✗ FAIL: cogsTotal should be Rp {expected_cogs_total:,} but got Rp {cogs_total:,}")
            return False
        
        # Check grossProfit
        if gross_profit >= expected_gross_profit_min:
            log(f"  ✓ PASS: grossProfit >= Rp {expected_gross_profit_min:,}")
        else:
            log(f"  ✗ FAIL: grossProfit should be >= Rp {expected_gross_profit_min:,} but got Rp {gross_profit:,}")
            return False
        
        # Check per-item cogs
        if so.get("items") and len(so["items"]) > 0:
            item = so["items"][0]
            item_cogs = item.get("cogs", 0)
            log(f"  Item cogs: Rp {item_cogs:,}")
            if item_cogs > 0:
                log(f"  ✓ PASS: Item cogs > 0")
            else:
                log(f"  ✗ FAIL: Item cogs should be > 0")
                return False
        
        return True
    else:
        log(f"✗ Failed to get SO: {response}")
        return False

def record_customer_receipt(so_id, product_id, received_weight):
    """Record customer receipt"""
    log(f"\n=== STEP 7: Record Customer Receipt ({received_weight}kg) ===")
    
    payload = {
        "receivedDate": datetime.now().isoformat(),
        "items": [
            {
                "productId": product_id,
                "receivedWeight": received_weight
            }
        ]
    }
    
    response = curl_request("POST", f"{BASE_URL}/sales-orders/{so_id}/receipts", payload)
    
    if response.get("data"):
        receipt = response["data"]
        test_data["receipt_id"] = receipt["id"]
        log(f"✓ Receipt created: {receipt['receiptNumber']} (ID: {receipt['id']})")
        log(f"  Received weight: {received_weight}kg")
        return receipt["id"]
    else:
        log(f"✗ Failed to create receipt: {response}")
        return None

def change_po_invoice_basis(po_id, basis):
    """Change PO invoice basis"""
    log(f"\nChanging PO invoice basis to '{basis}'...")
    
    response = curl_request("POST", f"{BASE_URL}/purchase-orders/{po_id}/invoice", {"basis": basis})
    
    if response.get("data"):
        po = response["data"]
        log(f"✓ Invoice basis changed to: {po.get('invoiceWeightBasis', 'N/A')}")
        log(f"  PO totalAmount: Rp {po['totalAmount']:,}")
        return True
    else:
        log(f"✗ Failed to change invoice basis: {response}")
        return False

def cleanup_test_data():
    """Cleanup all test data from database"""
    log("\n=== CLEANUP ===")
    log("Cleaning up test data from database...")
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        # Delete in reverse order of dependencies
        deleted_counts = {}
        
        # Sales order receipt items
        if test_data["receipt_id"]:
            cursor.execute("DELETE FROM sales_order_receipt_items WHERE receipt_id = ?", (test_data["receipt_id"],))
            deleted_counts["sales_order_receipt_items"] = cursor.rowcount
        
        # Sales order receipts
        if test_data["receipt_id"]:
            cursor.execute("DELETE FROM sales_order_receipts WHERE id = ?", (test_data["receipt_id"],))
            deleted_counts["sales_order_receipts"] = cursor.rowcount
        
        # Surat jalan items
        if test_data["surat_jalan_id"]:
            cursor.execute("DELETE FROM surat_jalan_items WHERE surat_jalan_id = ?", (test_data["surat_jalan_id"],))
            deleted_counts["surat_jalan_items"] = cursor.rowcount
        
        # Surat jalan
        if test_data["surat_jalan_id"]:
            cursor.execute("DELETE FROM surat_jalan WHERE id = ?", (test_data["surat_jalan_id"],))
            deleted_counts["surat_jalan"] = cursor.rowcount
        
        # GRN items
        if test_data["grn_id"]:
            cursor.execute("DELETE FROM grn_items WHERE grn_id = ?", (test_data["grn_id"],))
            deleted_counts["grn_items"] = cursor.rowcount
        
        # GRN
        if test_data["grn_id"]:
            cursor.execute("DELETE FROM grn WHERE id = ?", (test_data["grn_id"],))
            deleted_counts["grn"] = cursor.rowcount
        
        # Purchase order items
        if test_data["purchase_order_id"]:
            cursor.execute("DELETE FROM purchase_order_items WHERE purchase_order_id = ?", (test_data["purchase_order_id"],))
            deleted_counts["purchase_order_items"] = cursor.rowcount
        
        # Purchase order
        if test_data["purchase_order_id"]:
            cursor.execute("DELETE FROM purchase_order WHERE id = ?", (test_data["purchase_order_id"],))
            deleted_counts["purchase_order"] = cursor.rowcount
        
        # Sales order items
        if test_data["sales_order_id"]:
            cursor.execute("DELETE FROM sales_order_items WHERE sales_order_id = ?", (test_data["sales_order_id"],))
            deleted_counts["sales_order_items"] = cursor.rowcount
        
        # Sales order
        if test_data["sales_order_id"]:
            cursor.execute("DELETE FROM sales_order WHERE id = ?", (test_data["sales_order_id"],))
            deleted_counts["sales_order"] = cursor.rowcount
        
        # Commission records
        if test_data["sales_order_id"]:
            cursor.execute("DELETE FROM commission_records WHERE sales_order_id = ?", (test_data["sales_order_id"],))
            deleted_counts["commission_records"] = cursor.rowcount
        
        # Sales payments
        if test_data["sales_order_id"]:
            cursor.execute("DELETE FROM sales_payments WHERE sales_order_id = ?", (test_data["sales_order_id"],))
            deleted_counts["sales_payments"] = cursor.rowcount
        
        # Purchase payments
        if test_data["purchase_order_id"]:
            cursor.execute("DELETE FROM purchase_payments WHERE purchase_order_id = ?", (test_data["purchase_order_id"],))
            deleted_counts["purchase_payments"] = cursor.rowcount
        
        conn.commit()
        
        log("✓ Cleanup completed:")
        for table, count in deleted_counts.items():
            if count > 0:
                log(f"  - {table}: {count} row(s) deleted")
        
        # Verify cleanup
        if test_data["sales_order_id"]:
            cursor.execute("SELECT COUNT(*) FROM sales_order WHERE id = ?", (test_data["sales_order_id"],))
            if cursor.fetchone()[0] == 0:
                log("✓ Sales order deleted successfully")
            else:
                log("✗ Sales order still exists")
        
        if test_data["purchase_order_id"]:
            cursor.execute("SELECT COUNT(*) FROM purchase_order WHERE id = ?", (test_data["purchase_order_id"],))
            if cursor.fetchone()[0] == 0:
                log("✓ Purchase order deleted successfully")
            else:
                log("✗ Purchase order still exists")
        
    except Exception as e:
        log(f"✗ Cleanup error: {e}")
        conn.rollback()
    finally:
        conn.close()

def main():
    log("=" * 80)
    log("DROPSHIP REFINEMENTS TEST")
    log("Testing: 1) SO cogsTotal = PO HPP, 2) PO billedWeight per basis")
    log("=" * 80)
    
    # Login
    if not login():
        log("✗ Test aborted: login failed")
        return False
    
    # Step 1: Find supplier, customer, product
    log("\n=== STEP 1: Find Supplier, Customer, Product ===")
    supplier_id = find_or_create_supplier()
    customer_id = find_or_create_customer()
    product_id = find_or_create_product()
    
    if not supplier_id or not customer_id or not product_id:
        log("✗ Test aborted: missing required data")
        return False
    
    test_data["supplier_id"] = supplier_id
    test_data["customer_id"] = customer_id
    test_data["product_id"] = product_id
    
    # Step 2: Create dropship SO
    so_id, auto_po_id = create_dropship_so(supplier_id, customer_id, product_id)
    if not so_id or not auto_po_id:
        log("✗ Test aborted: failed to create SO")
        return False
    
    # Step 3: Advance SO status
    log("\n=== STEP 3: Advance SO Status ===")
    if not advance_so_status(so_id, "Confirmed"):
        log("✗ Test aborted: failed to confirm SO")
        cleanup_test_data()
        return False
    
    if not advance_so_status(so_id, "Packed"):
        log("✗ Test aborted: failed to pack SO")
        cleanup_test_data()
        return False
    
    # Get SO item ID
    response = curl_request("GET", f"{BASE_URL}/sales-orders/{so_id}")
    if not response.get("data") or not response["data"].get("items"):
        log("✗ Test aborted: failed to get SO items")
        cleanup_test_data()
        return False
    
    item_id = response["data"]["items"][0]["id"]
    
    # Step 4: Create Surat Jalan with shipped weight 9.5kg
    sj_id = create_surat_jalan(so_id, item_id, 9.5)
    if not sj_id:
        log("✗ Test aborted: failed to create Surat Jalan")
        cleanup_test_data()
        return False
    
    # Step 5: VERIFY Refinement 2 (PO billedWeight = 9.5, totalAmount = 205200)
    if not verify_po_refinement2(auto_po_id, 9.5, 205200):
        log("✗ REFINEMENT 2 FAILED")
        cleanup_test_data()
        return False
    
    # Step 6: VERIFY Refinement 1 (SO cogsTotal = 205200, grossProfit correct)
    # Revenue = 27000 * 9.5 = 256500
    # COGS = 205200
    # GrossProfit = 256500 - 205200 - 0 = 51300
    if not verify_so_refinement1(so_id, 205200, 51000):
        log("✗ REFINEMENT 1 FAILED")
        cleanup_test_data()
        return False
    
    # Step 7: Record customer receipt 9.0kg
    receipt_id = record_customer_receipt(so_id, product_id, 9.0)
    if not receipt_id:
        log("✗ Test aborted: failed to create receipt")
        cleanup_test_data()
        return False
    
    # Step 8: Change PO invoice basis to 'so_receipt'
    log("\n=== STEP 8: Change Invoice Basis to 'so_receipt' ===")
    if not change_po_invoice_basis(auto_po_id, "so_receipt"):
        log("✗ Test aborted: failed to change invoice basis")
        cleanup_test_data()
        return False
    
    # Verify PO: billedWeight = 9.0, totalAmount = 194400
    if not verify_po_refinement2(auto_po_id, 9.0, 194400):
        log("✗ REFINEMENT 2 FAILED (so_receipt basis)")
        cleanup_test_data()
        return False
    
    # Verify SO: cogsTotal = 194400, grossProfit updated
    # Revenue = 256500 (unchanged)
    # COGS = 194400
    # GrossProfit = 256500 - 194400 - 0 = 62100
    if not verify_so_refinement1(so_id, 194400, 62000):
        log("✗ REFINEMENT 1 FAILED (so_receipt basis)")
        cleanup_test_data()
        return False
    
    # Step 9: Switch back to 'grn' basis
    log("\n=== STEP 9: Switch Back to 'grn' Basis ===")
    if not change_po_invoice_basis(auto_po_id, "grn"):
        log("✗ Test aborted: failed to switch back to grn basis")
        cleanup_test_data()
        return False
    
    # Verify PO: billedWeight = 9.5, totalAmount = 205200
    if not verify_po_refinement2(auto_po_id, 9.5, 205200):
        log("✗ REFINEMENT 2 FAILED (grn basis restored)")
        cleanup_test_data()
        return False
    
    # Verify SO: cogsTotal = 205200
    if not verify_so_refinement1(so_id, 205200, 51000):
        log("✗ REFINEMENT 1 FAILED (grn basis restored)")
        cleanup_test_data()
        return False
    
    # Cleanup
    cleanup_test_data()
    
    log("\n" + "=" * 80)
    log("✓ ALL TESTS PASSED")
    log("=" * 80)
    log("\nSUMMARY:")
    log("✓ Refinement 1: SO cogsTotal = PO HPP (NOT 0) - WORKING")
    log("✓ Refinement 2: PO billedWeight per basis (grn/so_receipt) - WORKING")
    log("✓ Invoice basis switching - WORKING")
    log("✓ Cleanup completed - Database restored")
    
    return True

if __name__ == "__main__":
    try:
        success = main()
        exit(0 if success else 1)
    except Exception as e:
        log(f"\n✗ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        cleanup_test_data()
        exit(1)
