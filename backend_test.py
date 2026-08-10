#!/usr/bin/env python3
"""
Backend test for Dropship SO<->PO full linkage feature using curl
Tests GRN sync from SJ, invoice basis (grn/so_receipt), and navigation links
"""

import subprocess
import json
import sqlite3
from datetime import datetime
import tempfile
import os

BASE_URL = "http://localhost:3000/api"
DB_PATH = "/app/data/erp.db"
COOKIE_FILE = "/tmp/test_cookies.txt"

# Test data tracking for cleanup
test_data = {
    "sales_orders": [],
    "purchase_orders": []
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
            raise Exception(f"Failed to parse JSON response: {result.stdout[:200]}")
    else:
        return result.stdout

def login():
    """Login as admin"""
    log("Logging in as admin@lpi.co.id...")
    
    # Remove old cookie file
    if os.path.exists(COOKIE_FILE):
        os.remove(COOKIE_FILE)
    
    resp = curl_request("POST", f"{BASE_URL}/auth/sign-in/email", {
        "email": "admin@lpi.co.id",
        "password": "admin123"
    })
    
    if "user" not in resp:
        raise Exception(f"Login failed: {resp}")
    
    log("✓ Login successful")

def find_supplier():
    """Find an existing supplier contact"""
    log("Finding supplier contact...")
    resp = curl_request("GET", f"{BASE_URL}/contacts?type=Supplier")
    
    if "data" not in resp or not resp["data"]:
        raise Exception("No suppliers found")
    
    supplier = resp["data"][0]
    log(f"✓ Found supplier: {supplier['displayName']} (ID: {supplier['id']})")
    return supplier

def find_customer():
    """Find an existing customer contact"""
    log("Finding customer contact...")
    resp = curl_request("GET", f"{BASE_URL}/contacts?type=Customer")
    
    if "data" not in resp or not resp["data"]:
        raise Exception("No customers found")
    
    customer = resp["data"][0]
    log(f"✓ Found customer: {customer['displayName']} (ID: {customer['id']})")
    return customer

def find_products(count=1):
    """Find existing products with prices"""
    log(f"Finding {count} products...")
    resp = curl_request("GET", f"{BASE_URL}/products")
    
    if "data" not in resp:
        raise Exception("Failed to get products")
    
    products = [p for p in resp["data"] if p.get("basePrice") and float(p["basePrice"]) > 0][:count]
    
    if len(products) < count:
        raise Exception(f"Not enough products with prices found (need {count}, found {len(products)})")
    
    for p in products:
        log(f"✓ Found product: {p['name']} (ID: {p['id']}, price: {p['basePrice']})")
    
    return products

def create_dropship_so(supplier_id, customer_id, products):
    """Create a dropship SO with buyPrice and unitPrice"""
    log("\n=== TEST STEP 1: Create Dropship SO ===")
    
    product = products[0]
    sell_price = float(product["basePrice"])
    buy_price = sell_price * 0.8
    
    payload = {
        "customerId": customer_id,
        "supplierId": supplier_id,
        "fulfillmentType": "dropship",
        "orderDate": datetime.now().isoformat(),
        "items": [{
            "productId": product["id"],
            "quantity": 1,
            "weight": 10.0,
            "unitPrice": sell_price,
            "buyPrice": buy_price
        }]
    }
    
    log(f"Creating dropship SO with:")
    log(f"  - Product: {product['name']}")
    log(f"  - Ordered weight: 10.0 kg")
    log(f"  - Sell price: Rp {sell_price:,.0f}")
    log(f"  - Buy price: Rp {buy_price:,.0f}")
    
    resp = curl_request("POST", f"{BASE_URL}/sales-orders", payload)
    
    if "data" not in resp:
        raise Exception(f"Failed to create SO: {resp}")
    
    so_data = resp["data"]
    so_id = so_data["id"]
    so_number = so_data["soNumber"]
    auto_po_id = so_data.get("autoPoId")
    
    test_data["sales_orders"].append(so_id)
    
    log(f"✓ SO created: {so_number} (ID: {so_id})")
    log(f"  - SO totalAmount: Rp {so_data['totalAmount']:,.0f}")
    
    if not auto_po_id:
        raise Exception("autoPoId not returned")
    
    log(f"✓ Auto-PO created: {auto_po_id}")
    test_data["purchase_orders"].append(auto_po_id)
    
    return {
        "so_id": so_id,
        "so_number": so_number,
        "auto_po_id": auto_po_id,
        "product_id": product["id"],
        "product_name": product["name"],
        "sell_price": sell_price,
        "buy_price": buy_price,
        "ordered_weight": 10.0
    }

def verify_so_po_linkage(so_id, auto_po_id, so_number):
    """Verify bidirectional linkage"""
    log("\n=== TEST STEP 2: Verify SO<->PO Linkage ===")
    
    # Check SO -> PO link
    log(f"GET /api/sales-orders/{so_id}")
    resp = curl_request("GET", f"{BASE_URL}/sales-orders/{so_id}")
    
    if "data" not in resp:
        raise Exception(f"Failed to get SO: {resp}")
    
    so_data = resp["data"]
    linked_po = so_data.get("linkedPurchaseOrder")
    
    if not linked_po:
        raise Exception("linkedPurchaseOrder not present")
    
    log(f"✓ SO has linkedPurchaseOrder:")
    log(f"  - PO ID: {linked_po['id']}")
    log(f"  - PO Number: {linked_po['poNumber']}")
    log(f"  - PO Status: {linked_po['pipelineStatus']}")
    
    if linked_po["id"] != auto_po_id:
        raise Exception(f"linkedPurchaseOrder.id mismatch")
    
    po_number = linked_po["poNumber"]
    
    # Check PO -> SO link
    log(f"\nGET /api/purchase-orders/{auto_po_id}")
    resp = curl_request("GET", f"{BASE_URL}/purchase-orders/{auto_po_id}")
    
    if "data" not in resp:
        raise Exception(f"Failed to get PO: {resp}")
    
    po_data = resp["data"]
    
    if po_data.get("salesOrderId") != so_id:
        raise Exception("PO salesOrderId mismatch")
    
    if not po_data.get("isDropship"):
        raise Exception("PO isDropship is not true")
    
    linked_so = po_data.get("linkedSalesOrder")
    if not linked_so:
        raise Exception("linkedSalesOrder not present")
    
    log(f"✓ PO has linkedSalesOrder:")
    log(f"  - SO ID: {linked_so['id']}")
    log(f"  - SO Number: {linked_so['soNumber']}")
    
    if linked_so["soNumber"] != so_number:
        raise Exception("linkedSalesOrder.soNumber mismatch")
    
    log(f"✓ Bidirectional linkage verified")
    
    return po_number, po_data

def advance_so_status(so_id, target_status):
    """Advance SO status"""
    log(f"\nAdvancing SO to {target_status}...")
    resp = curl_request("POST", f"{BASE_URL}/sales-orders/{so_id}/status", {"status": target_status})
    
    if "data" not in resp:
        raise Exception(f"Failed to advance SO: {resp}")
    
    log(f"✓ SO advanced to {target_status}")

def create_surat_jalan(so_id, product_id, shipped_weight):
    """Create Surat Jalan"""
    log(f"\n=== TEST STEP 3: Create Surat Jalan (shipped: {shipped_weight} kg) ===")
    
    # Get SO items
    resp = curl_request("GET", f"{BASE_URL}/sales-orders/{so_id}")
    so_data = resp["data"]
    item = next((it for it in so_data["items"] if it["productId"] == product_id), None)
    
    if not item:
        raise Exception("Product not found in SO items")
    
    item_id = item["id"]
    
    payload = {
        "deliveryDate": datetime.now().isoformat(),
        "items": [{
            "itemId": item_id,
            "shippedWeight": shipped_weight
        }]
    }
    
    log(f"Creating Surat Jalan:")
    log(f"  - Ordered: {item['weight']} kg")
    log(f"  - Shipped: {shipped_weight} kg")
    
    resp = curl_request("POST", f"{BASE_URL}/sales-orders/{so_id}/surat-jalan", payload)
    
    if "data" not in resp:
        raise Exception(f"Failed to create SJ: {resp}")
    
    sj_number = resp["data"].get("sjNumber")
    log(f"✓ Surat Jalan created: {sj_number}")
    
    return sj_number

def verify_grn_sync(auto_po_id, so_id, product_id, shipped_weight, buy_price):
    """Verify GRN auto-sync"""
    log(f"\n=== TEST STEP 4: Verify GRN Auto-Sync ===")
    
    resp = curl_request("GET", f"{BASE_URL}/purchase-orders/{auto_po_id}")
    po_data = resp["data"]
    
    # Check GRN
    grns = po_data.get("grn", [])
    auto_grn_tag = f"AUTO-SJ:{so_id}"
    auto_grn = next((g for g in grns if g.get("notes") == auto_grn_tag), None)
    
    if not auto_grn:
        raise Exception(f"Auto GRN not found. GRNs: {grns}")
    
    log(f"✓ Auto GRN found:")
    log(f"  - GRN Number: {auto_grn['grnNumber']}")
    log(f"  - Notes: {auto_grn['notes']}")
    
    # Check GRN items via DB
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT received_weight FROM grn_items WHERE grn_id = ? AND product_id = ?", 
                   (auto_grn["id"], product_id))
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        raise Exception("GRN item not found in DB")
    
    grn_received = result[0]
    log(f"✓ GRN received weight: {grn_received} kg (expected: {shipped_weight} kg)")
    
    if abs(grn_received - shipped_weight) > 0.001:
        raise Exception(f"GRN weight mismatch: {grn_received} != {shipped_weight}")
    
    # Check PO item received_weight
    po_item = next((it for it in po_data["items"] if it["productId"] == product_id), None)
    if not po_item:
        raise Exception("Product not found in PO items")
    
    po_received = po_item.get("receivedWeight", 0)
    log(f"✓ PO item received weight: {po_received} kg")
    
    if abs(po_received - shipped_weight) > 0.001:
        raise Exception(f"PO received weight mismatch")
    
    # Check PO status
    if po_data["pipelineStatus"] != "Tanda Terima":
        raise Exception(f"PO status should be 'Tanda Terima', got '{po_data['pipelineStatus']}'")
    
    log(f"✓ PO status: {po_data['pipelineStatus']}")
    
    # Check PO total
    po_total = po_data["totalAmount"]
    expected_total = buy_price * shipped_weight
    
    log(f"✓ PO totalAmount: Rp {po_total:,.0f} (expected: Rp {expected_total:,.0f})")
    
    if abs(po_total - expected_total) > 1:
        raise Exception(f"PO total mismatch")
    
    log(f"✓ All GRN sync verifications passed")
    
    return auto_grn

def test_invoice_basis(auto_po_id, buy_price, shipped_weight):
    """Test invoice basis"""
    log(f"\n=== TEST STEP 5: Test Invoice Basis ===")
    
    resp = curl_request("GET", f"{BASE_URL}/purchase-orders/{auto_po_id}")
    po_data = resp["data"]
    
    invoice_grn = po_data.get("invoiceGrnTotal")
    invoice_so_receipt = po_data.get("invoiceSoReceiptTotal")
    
    if invoice_grn is None or invoice_so_receipt is None:
        raise Exception("Invoice totals not present")
    
    log(f"✓ Invoice preview totals:")
    log(f"  - invoiceGrnTotal: Rp {invoice_grn:,.0f}")
    log(f"  - invoiceSoReceiptTotal: Rp {invoice_so_receipt:,.0f}")
    
    # Test basis 'so_receipt'
    log(f"\nTesting basis='so_receipt'")
    resp = curl_request("POST", f"{BASE_URL}/purchase-orders/{auto_po_id}/invoice", {"basis": "so_receipt"})
    
    if "data" not in resp:
        raise Exception(f"Failed to set basis: {resp}")
    
    result = resp["data"]
    log(f"✓ Basis set to: {result['invoiceWeightBasis']}")
    
    if result["invoiceWeightBasis"] != "so_receipt":
        raise Exception("Basis should be 'so_receipt'")
    
    # Test basis 'grn'
    log(f"\nTesting basis='grn'")
    resp = curl_request("POST", f"{BASE_URL}/purchase-orders/{auto_po_id}/invoice", {"basis": "grn"})
    result = resp["data"]
    log(f"✓ Basis set to: {result['invoiceWeightBasis']}")
    
    if result["invoiceWeightBasis"] != "grn":
        raise Exception("Basis should be 'grn'")
    
    # Test basis 'tally' (should coerce to 'grn')
    log(f"\nTesting basis='tally' (should coerce to 'grn')")
    resp = curl_request("POST", f"{BASE_URL}/purchase-orders/{auto_po_id}/invoice", {"basis": "tally"})
    result = resp["data"]
    log(f"✓ Basis coerced to: {result['invoiceWeightBasis']}")
    
    if result["invoiceWeightBasis"] != "grn":
        raise Exception("Basis should be coerced to 'grn'")
    
    log(f"✓ All invoice basis tests passed")

def test_customer_receipt(so_id, product_id, received_weight, auto_po_id, buy_price):
    """Test customer receipt"""
    log(f"\n=== TEST STEP 6: Test Customer Receipt ===")
    
    payload = {
        "receivedDate": datetime.now().isoformat(),
        "items": [{
            "productId": product_id,
            "receivedWeight": received_weight
        }]
    }
    
    log(f"Creating receipt with receivedWeight={received_weight} kg")
    resp = curl_request("POST", f"{BASE_URL}/sales-orders/{so_id}/receipts", payload)
    
    if "data" not in resp:
        raise Exception(f"Failed to create receipt: {resp}")
    
    receipt_number = resp["data"].get("receiptNumber")
    log(f"✓ Receipt created: {receipt_number}")
    
    # Apply so_receipt basis
    log(f"\nApplying basis='so_receipt' after receipt")
    resp = curl_request("POST", f"{BASE_URL}/purchase-orders/{auto_po_id}/invoice", {"basis": "so_receipt"})
    result = resp["data"]
    
    expected_total = buy_price * received_weight
    log(f"✓ PO total: Rp {result['totalAmount']:,.0f} (expected: Rp {expected_total:,.0f})")
    
    if abs(result["totalAmount"] - expected_total) > 1:
        raise Exception("PO total with so_receipt mismatch")
    
    log(f"✓ Customer receipt test passed")

def test_non_dropship_regression():
    """Test non-dropship PO"""
    log(f"\n=== TEST STEP 7: Regression Test ===")
    
    resp = curl_request("GET", f"{BASE_URL}/purchase-orders")
    pos = resp["data"]
    non_dropship = next((p for p in pos if not p.get("isDropship")), None)
    
    if not non_dropship:
        log("⚠ No non-dropship PO found, skipping")
        return
    
    po_id = non_dropship["id"]
    po_number = non_dropship["poNumber"]
    original_basis = non_dropship.get("invoiceWeightBasis")
    
    log(f"Testing non-dropship PO: {po_number}")
    
    # Test 'shipped'
    resp = curl_request("POST", f"{BASE_URL}/purchase-orders/{po_id}/invoice", {"basis": "shipped"})
    if resp["data"]["invoiceWeightBasis"] != "shipped":
        raise Exception("Basis 'shipped' failed")
    log(f"✓ Basis 'shipped' works")
    
    # Test 'tally'
    resp = curl_request("POST", f"{BASE_URL}/purchase-orders/{po_id}/invoice", {"basis": "tally"})
    if resp["data"]["invoiceWeightBasis"] != "tally":
        raise Exception("Basis 'tally' failed")
    log(f"✓ Basis 'tally' works")
    
    # Restore
    if original_basis:
        curl_request("POST", f"{BASE_URL}/purchase-orders/{po_id}/invoice", {"basis": original_basis})
        log(f"✓ Original basis restored")
    
    log(f"✓ Regression test passed")

def cleanup_test_data():
    """Clean up test data"""
    log(f"\n=== CLEANUP ===")
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        for so_id in test_data["sales_orders"]:
            log(f"Cleaning SO: {so_id}")
            cursor.execute("DELETE FROM commission_records WHERE sales_order_id = ?", (so_id,))
            cursor.execute("DELETE FROM sales_payments WHERE sales_order_id = ?", (so_id,))
            cursor.execute("DELETE FROM sales_order_receipt_items WHERE receipt_id IN (SELECT id FROM sales_order_receipts WHERE sales_order_id = ?)", (so_id,))
            cursor.execute("DELETE FROM sales_order_receipts WHERE sales_order_id = ?", (so_id,))
            cursor.execute("DELETE FROM surat_jalan WHERE sales_order_id = ?", (so_id,))
            cursor.execute("DELETE FROM sales_order_items WHERE sales_order_id = ?", (so_id,))
            cursor.execute("DELETE FROM sales_order WHERE id = ?", (so_id,))
        
        for po_id in test_data["purchase_orders"]:
            log(f"Cleaning PO: {po_id}")
            cursor.execute("DELETE FROM grn_items WHERE grn_id IN (SELECT id FROM grn WHERE purchase_order_id = ?)", (po_id,))
            cursor.execute("DELETE FROM grn WHERE purchase_order_id = ?", (po_id,))
            cursor.execute("DELETE FROM purchase_payments WHERE purchase_order_id = ?", (po_id,))
            cursor.execute("DELETE FROM purchase_order_items WHERE purchase_order_id = ?", (po_id,))
            cursor.execute("DELETE FROM purchase_order WHERE id = ?", (po_id,))
        
        conn.commit()
        log(f"✓ Cleanup complete")
        
    except Exception as e:
        conn.rollback()
        raise Exception(f"Cleanup failed: {e}")
    finally:
        conn.close()

def main():
    """Main test"""
    print("\n" + "="*80)
    print("DROPSHIP SO<->PO FULL LINKAGE BACKEND TEST")
    print("="*80 + "\n")
    
    try:
        login()
        
        supplier = find_supplier()
        customer = find_customer()
        products = find_products(1)
        
        so_data = create_dropship_so(supplier["id"], customer["id"], products)
        
        po_number, po_data = verify_so_po_linkage(so_data["so_id"], so_data["auto_po_id"], so_data["so_number"])
        
        log("\n=== Advancing SO Status ===")
        advance_so_status(so_data["so_id"], "Confirmed")
        advance_so_status(so_data["so_id"], "Packed")
        
        shipped_weight = 9.5
        sj_number = create_surat_jalan(so_data["so_id"], so_data["product_id"], shipped_weight)
        
        auto_grn = verify_grn_sync(so_data["auto_po_id"], so_data["so_id"], so_data["product_id"], 
                                   shipped_weight, so_data["buy_price"])
        
        test_invoice_basis(so_data["auto_po_id"], so_data["buy_price"], shipped_weight)
        
        received_weight = 9.0
        test_customer_receipt(so_data["so_id"], so_data["product_id"], received_weight, 
                            so_data["auto_po_id"], so_data["buy_price"])
        
        test_non_dropship_regression()
        
        print("\n" + "="*80)
        print("✅ ALL TESTS PASSED")
        print("="*80)
        
        print("\n=== SUMMARY ===")
        print(f"✓ SO: {so_data['so_number']}")
        print(f"✓ PO: {po_number}")
        print(f"✓ SJ: {sj_number}")
        print(f"✓ GRN: {auto_grn['grnNumber']}")
        print(f"✓ Ordered: {so_data['ordered_weight']} kg")
        print(f"✓ Shipped: {shipped_weight} kg")
        print(f"✓ Received: {received_weight} kg")
        print(f"✓ Sell price: Rp {so_data['sell_price']:,.0f}")
        print(f"✓ Buy price: Rp {so_data['buy_price']:,.0f}")
        print(f"✓ PO total (grn): Rp {so_data['buy_price'] * shipped_weight:,.0f}")
        print(f"✓ PO total (so_receipt): Rp {so_data['buy_price'] * received_weight:,.0f}")
        
    except Exception as e:
        print("\n" + "="*80)
        print(f"❌ TEST FAILED: {e}")
        print("="*80)
        import traceback
        traceback.print_exc()
        return 1
    
    finally:
        try:
            cleanup_test_data()
        except Exception as e:
            print(f"\n❌ CLEANUP FAILED: {e}")
            return 1
    
    return 0

if __name__ == "__main__":
    exit(main())
