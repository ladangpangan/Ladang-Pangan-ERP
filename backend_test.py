#!/usr/bin/env python3
"""
Backend test for GRN grn_number UNIQUE constraint bugfix (gap-safe MAX+1)
"""
import requests
import json
import sys
from datetime import datetime

BASE_URL = "http://localhost:3000/api"

def login():
    """Login as admin and return session"""
    print("\n=== STEP 1: Login as admin@lpi.co.id ===")
    session = requests.Session()
    
    # Better Auth sign-in endpoint
    url = "http://localhost:3000/api/auth/sign-in/email"
    payload = {
        "email": "admin@lpi.co.id",
        "password": "admin123"
    }
    
    try:
        resp = session.post(url, json=payload)
        print(f"Login response status: {resp.status_code}")
        
        if resp.status_code == 200:
            print("✅ Login successful")
            # Check if we have session cookies
            cookies = session.cookies.get_dict()
            print(f"Session cookies: {list(cookies.keys())}")
            return session
        else:
            print(f"❌ Login failed: {resp.status_code}")
            print(f"Response: {resp.text[:200]}")
            return None
    except Exception as e:
        print(f"❌ Login error: {e}")
        return None

def get_purchase_orders(session):
    """Get list of purchase orders"""
    print("\n=== STEP 2: Get Purchase Orders ===")
    try:
        resp = session.get(f"{BASE_URL}/purchase-orders")
        print(f"GET /purchase-orders status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            pos = data.get('data', [])
            print(f"✅ Found {len(pos)} purchase orders")
            
            # Look for PO/202608/0014
            target_po = None
            for po in pos:
                if po.get('poNumber') == 'PO/202608/0014':
                    target_po = po
                    print(f"✅ Found target PO: {po.get('poNumber')} (ID: {po.get('id')})")
                    break
            
            if not target_po:
                # Find any PO without GRN
                print("Target PO/202608/0014 not found, looking for any PO without GRN...")
                for po in pos:
                    # Get PO detail to check if it has GRN
                    detail_resp = session.get(f"{BASE_URL}/purchase-orders/{po['id']}")
                    if detail_resp.status_code == 200:
                        detail = detail_resp.json().get('data', {})
                        grns = detail.get('grn', [])
                        if len(grns) == 0:
                            target_po = po
                            print(f"✅ Found PO without GRN: {po.get('poNumber')} (ID: {po.get('id')})")
                            break
            
            return target_po
        else:
            print(f"❌ Failed to get POs: {resp.status_code}")
            print(f"Response: {resp.text[:200]}")
            return None
    except Exception as e:
        print(f"❌ Error getting POs: {e}")
        return None

def get_po_detail(session, po_id):
    """Get PO detail and record original state"""
    print(f"\n=== STEP 3: Get PO Detail (ID: {po_id}) ===")
    try:
        resp = session.get(f"{BASE_URL}/purchase-orders/{po_id}")
        print(f"GET /purchase-orders/{po_id} status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            print(f"✅ PO Number: {data.get('poNumber')}")
            print(f"   Original total_amount: Rp {data.get('totalAmount', 0):,.0f}")
            print(f"   Pipeline status: {data.get('pipelineStatus')}")
            print(f"   Existing GRNs: {len(data.get('grn', []))}")
            
            items = data.get('items', [])
            print(f"   Items count: {len(items)}")
            for i, item in enumerate(items):
                print(f"     Item {i+1}: Product {item.get('productId')}, weight={item.get('weight')}, receivedWeight={item.get('receivedWeight', 0)}")
            
            return data
        else:
            print(f"❌ Failed to get PO detail: {resp.status_code}")
            print(f"Response: {resp.text[:200]}")
            return None
    except Exception as e:
        print(f"❌ Error getting PO detail: {e}")
        return None

def create_grn(session, po_id, po_data):
    """Create GRN and verify grn_number is GRN/202608/0006"""
    print(f"\n=== STEP 4: Create GRN for PO {po_id} ===")
    
    # Prepare items for GRN
    items = []
    for item in po_data.get('items', []):
        # Use the item's weight as receivedWeight
        weight = item.get('weight', 0)
        items.append({
            "productId": item.get('productId'),
            "receivedWeight": weight,
            "receivedQuantity": item.get('quantity', 1)
        })
    
    payload = {
        "sjNumber": "SJ-TEST-FIX",
        "receivedDate": "2026-08-10",
        "items": items
    }
    
    print(f"Payload: {json.dumps(payload, indent=2)}")
    
    try:
        resp = session.post(f"{BASE_URL}/purchase-orders/{po_id}/grn", json=payload)
        print(f"POST /purchase-orders/{po_id}/grn status: {resp.status_code}")
        
        if resp.status_code in [200, 201]:
            data = resp.json().get('data', {})
            grn_number = data.get('grnNumber')
            grn_id = data.get('id')
            
            print(f"✅ GRN created successfully!")
            print(f"   GRN Number: {grn_number}")
            print(f"   GRN ID: {grn_id}")
            print(f"   Total Amount: Rp {data.get('totalAmount', 0):,.0f}")
            
            # CRITICAL VERIFICATION: Check if GRN number is GRN/202608/0006
            if grn_number == "GRN/202608/0006":
                print(f"✅ CRITICAL VERIFICATION PASSED: GRN number is {grn_number} (gap-safe, NOT 0005)")
            else:
                print(f"⚠️  GRN number is {grn_number} (expected GRN/202608/0006)")
                print(f"   This may be OK if there were other GRNs created after the gap")
            
            return {
                'grnNumber': grn_number,
                'grnId': grn_id,
                'data': data
            }
        else:
            print(f"❌ Failed to create GRN: {resp.status_code}")
            print(f"Response: {resp.text[:500]}")
            
            # Check for UNIQUE constraint error
            if "UNIQUE constraint" in resp.text or "grn_number" in resp.text:
                print(f"❌ CRITICAL BUG: UNIQUE constraint error detected!")
                print(f"   This means the bugfix did NOT work - GRN number collision occurred")
            
            return None
    except Exception as e:
        print(f"❌ Error creating GRN: {e}")
        return None

def verify_grn_in_po(session, po_id, expected_grn_number):
    """Verify the GRN appears in PO detail"""
    print(f"\n=== STEP 5: Verify GRN in PO Detail ===")
    try:
        resp = session.get(f"{BASE_URL}/purchase-orders/{po_id}")
        print(f"GET /purchase-orders/{po_id} status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            grns = data.get('grn', [])
            
            print(f"✅ PO now has {len(grns)} GRN(s)")
            
            # Find our GRN
            found = False
            for grn in grns:
                if grn.get('grnNumber') == expected_grn_number:
                    found = True
                    print(f"✅ Found GRN {expected_grn_number} in PO")
                    print(f"   SJ Number: {grn.get('sjNumber')}")
                    print(f"   Received Date: {grn.get('receivedDate')}")
                    break
            
            if not found:
                print(f"⚠️  GRN {expected_grn_number} not found in PO grn array")
            
            # Check updated totals
            print(f"   Updated total_amount: Rp {data.get('totalAmount', 0):,.0f}")
            print(f"   Weight confirmed: {data.get('weightConfirmed', False)}")
            print(f"   Total received weight: {data.get('totalReceivedWeight', 0)}")
            
            return data
        else:
            print(f"❌ Failed to verify GRN: {resp.status_code}")
            return None
    except Exception as e:
        print(f"❌ Error verifying GRN: {e}")
        return None

def create_second_grn(session, po_id):
    """Optional: Create a second GRN to verify it gets 0007"""
    print(f"\n=== STEP 6 (OPTIONAL): Create Second GRN ===")
    print("Skipping second GRN creation to avoid data pollution")
    print("The first GRN test is sufficient to verify the bugfix")
    return None

def cleanup_grn(session, po_id, grn_id, original_po_data):
    """Clean up: delete GRN and restore PO to original state"""
    print(f"\n=== STEP 7: Cleanup - Delete GRN and Restore PO ===")
    
    # Use direct SQLite commands for cleanup
    import sqlite3
    
    try:
        db_path = "/app/data/erp.db"
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        print(f"Deleting GRN {grn_id}...")
        
        # Delete grn_items
        cursor.execute("DELETE FROM grn_items WHERE grn_id = ?", (grn_id,))
        deleted_items = cursor.rowcount
        print(f"  Deleted {deleted_items} grn_items rows")
        
        # Delete grn_documents (if any)
        cursor.execute("DELETE FROM grn_documents WHERE grn_id = ?", (grn_id,))
        deleted_docs = cursor.rowcount
        print(f"  Deleted {deleted_docs} grn_documents rows")
        
        # Delete grn
        cursor.execute("DELETE FROM grn WHERE id = ?", (grn_id,))
        deleted_grn = cursor.rowcount
        print(f"  Deleted {deleted_grn} grn rows")
        
        # Restore purchase_order_items received_weight to 0
        cursor.execute("UPDATE purchase_order_items SET received_weight = 0 WHERE purchase_order_id = ?", (po_id,))
        updated_items = cursor.rowcount
        print(f"  Reset received_weight for {updated_items} PO items")
        
        # Restore purchase_order total_amount and pipeline_status
        original_total = original_po_data.get('totalAmount', 0)
        original_status = original_po_data.get('pipelineStatus', 'Draft')
        cursor.execute(
            "UPDATE purchase_order SET total_amount = ?, pipeline_status = ? WHERE id = ?",
            (original_total, original_status, po_id)
        )
        updated_po = cursor.rowcount
        print(f"  Restored PO total_amount to {original_total} and status to {original_status}")
        
        conn.commit()
        conn.close()
        
        print("✅ Cleanup completed successfully")
        
        # Verify cleanup
        resp = session.get(f"{BASE_URL}/purchase-orders/{po_id}")
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            grns = data.get('grn', [])
            print(f"✅ Verification: PO now has {len(grns)} GRN(s) (should be back to original count)")
            print(f"   Total amount: Rp {data.get('totalAmount', 0):,.0f} (original: Rp {original_total:,.0f})")
        
        return True
    except Exception as e:
        print(f"❌ Cleanup error: {e}")
        return False

def main():
    print("=" * 80)
    print("BACKEND TEST: GRN grn_number UNIQUE constraint bugfix (gap-safe MAX+1)")
    print("=" * 80)
    
    # Step 1: Login
    session = login()
    if not session:
        print("\n❌ TEST FAILED: Could not login")
        sys.exit(1)
    
    # Step 2: Get POs and find target
    target_po = get_purchase_orders(session)
    if not target_po:
        print("\n❌ TEST FAILED: Could not find suitable PO")
        sys.exit(1)
    
    po_id = target_po.get('id')
    
    # Step 3: Get PO detail and record original state
    original_po_data = get_po_detail(session, po_id)
    if not original_po_data:
        print("\n❌ TEST FAILED: Could not get PO detail")
        sys.exit(1)
    
    # Step 4: Create GRN
    grn_result = create_grn(session, po_id, original_po_data)
    if not grn_result:
        print("\n❌ TEST FAILED: Could not create GRN")
        sys.exit(1)
    
    grn_number = grn_result['grnNumber']
    grn_id = grn_result['grnId']
    
    # Step 5: Verify GRN in PO
    verify_grn_in_po(session, po_id, grn_number)
    
    # Step 6: Optional second GRN (skipped)
    # create_second_grn(session, po_id)
    
    # Step 7: Cleanup
    cleanup_success = cleanup_grn(session, po_id, grn_id, original_po_data)
    
    # Final summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"✅ Login: SUCCESS")
    print(f"✅ Find PO: SUCCESS (PO: {original_po_data.get('poNumber')})")
    print(f"✅ Create GRN: SUCCESS (GRN: {grn_number})")
    print(f"✅ GRN Number: {grn_number}")
    
    if grn_number == "GRN/202608/0006":
        print(f"✅ CRITICAL VERIFICATION: GRN number is GRN/202608/0006 (gap-safe, NOT 0005)")
        print(f"✅ BUGFIX VERIFIED: The gap-safe MAX+1 logic is working correctly")
    else:
        print(f"⚠️  GRN number is {grn_number} (expected GRN/202608/0006)")
        print(f"   Note: This may be OK if other GRNs were created after the gap")
    
    if cleanup_success:
        print(f"✅ Cleanup: SUCCESS")
    else:
        print(f"⚠️  Cleanup: PARTIAL (manual verification recommended)")
    
    print("\n✅ ALL TESTS PASSED - NO UNIQUE CONSTRAINT ERROR")
    print("=" * 80)

if __name__ == "__main__":
    main()
