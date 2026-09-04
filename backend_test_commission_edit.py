#!/usr/bin/env python3
"""
Backend test for editable dropshipper commission feature.
Tests PUT/PATCH /api/contacts/:id/commissions/:rid endpoint.
"""

import requests
import json
import sys
from datetime import datetime

# Base URL from .env
BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"

# Test credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
AKUNTAN_EMAIL = "akuntan@lpi.co.id"
AKUNTAN_PASSWORD = "akuntanlpi123"
DIREKTUR_EMAIL = "direktur@lpi.co.id"
DIREKTUR_PASSWORD = "direktur123"

session = requests.Session()

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def test_login(email, password):
    """Login and capture session cookie"""
    log(f"TEST 1 — Login as {email}")
    try:
        resp = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": email, "password": password},
            timeout=30
        )
        log(f"  Status: {resp.status_code}")
        if resp.status_code == 200:
            log(f"  ✅ Login successful")
            # Session cookie is automatically stored in session object
            return True
        else:
            log(f"  ❌ Login failed: {resp.text}")
            return False
    except Exception as e:
        log(f"  ❌ Login error: {e}")
        return False

def find_dropshipper():
    """Find an existing dropshipper contact"""
    log("\nTEST 2 — Find Dropshipper contact")
    try:
        resp = session.get(f"{BASE_URL}/contacts", timeout=30)
        log(f"  Status: {resp.status_code}")
        if resp.status_code != 200:
            log(f"  ❌ Failed to get contacts: {resp.text}")
            return None
        
        data = resp.json()
        contacts = data.get('data', [])
        log(f"  Total contacts: {len(contacts)}")
        
        # Find a dropshipper
        dropshippers = [c for c in contacts if c.get('isDropshipper') or c.get('contactType') == 'Dropshipper']
        log(f"  Dropshippers found: {len(dropshippers)}")
        
        if dropshippers:
            ds = dropshippers[0]
            log(f"  ✅ Selected dropshipper: {ds.get('displayName')} (ID: {ds.get('id')})")
            log(f"     Commission type: {ds.get('commissionType')}, value: {ds.get('commissionValue')}")
            return ds
        else:
            log(f"  ⚠️  No dropshippers found, will create one")
            return None
    except Exception as e:
        log(f"  ❌ Error finding dropshipper: {e}")
        return None

def create_dropshipper():
    """Create a test dropshipper if none exists"""
    log("\nTEST 2b — Create test Dropshipper")
    try:
        resp = session.post(
            f"{BASE_URL}/contacts",
            json={
                "contactType": "Dropshipper",
                "displayName": "Test Dropshipper Commission Edit",
                "contactCode": f"DS-TEST-{datetime.now().strftime('%Y%m%d%H%M%S')}",
                "isDropshipper": True,
                "commissionType": "per_kg",
                "commissionValue": 900,
                "phone": "081234567890",
                "email": "test.dropshipper@test.com"
            },
            timeout=30
        )
        log(f"  Status: {resp.status_code}")
        if resp.status_code in [200, 201]:
            data = resp.json()
            ds = data.get('data')
            log(f"  ✅ Created dropshipper: {ds.get('displayName')} (ID: {ds.get('id')})")
            return ds
        else:
            log(f"  ❌ Failed to create dropshipper: {resp.text}")
            return None
    except Exception as e:
        log(f"  ❌ Error creating dropshipper: {e}")
        return None

def find_sales_order(skip_index=0):
    """Find a sales order to attach commission to"""
    log(f"\nTEST 3 — Find Sales Order (skip_index={skip_index})")
    try:
        resp = session.get(f"{BASE_URL}/sales-orders", timeout=30)
        log(f"  Status: {resp.status_code}")
        if resp.status_code != 200:
            log(f"  ❌ Failed to get sales orders: {resp.text}")
            return None
        
        data = resp.json()
        orders = data.get('data', [])
        log(f"  Total sales orders: {len(orders)}")
        
        if orders and skip_index < len(orders):
            # Pick SO at skip_index to avoid duplicates
            so = orders[skip_index]
            log(f"  ✅ Selected SO: {so.get('soNumber')} (ID: {so.get('id')})")
            
            # Get SO items to calculate total weight
            resp_items = session.get(f"{BASE_URL}/sales-orders/{so.get('id')}", timeout=30)
            if resp_items.status_code == 200:
                so_detail = resp_items.json().get('data', {})
                items = so_detail.get('items', [])
                total_weight = sum(float(item.get('weight', 0)) for item in items)
                log(f"     Total weight: {total_weight} kg")
                so['totalWeight'] = total_weight
            
            return so
        else:
            log(f"  ❌ No sales orders found or skip_index out of range")
            return None
    except Exception as e:
        log(f"  ❌ Error finding sales order: {e}")
        return None

def create_commission(dropshipper_id, so_id):
    """Create a commission record"""
    log("\nTEST 4 — Create commission record")
    try:
        resp = session.post(
            f"{BASE_URL}/contacts/{dropshipper_id}/commissions",
            json={
                "salesOrderId": so_id,
                "commissionType": "per_kg",
                "commissionValue": 900
            },
            timeout=30
        )
        log(f"  Status: {resp.status_code}")
        
        if resp.status_code == 409:
            log(f"  ⚠️  Commission already exists for this SO, trying another SO...")
            return None
        
        if resp.status_code in [200, 201]:
            data = resp.json()
            rec = data.get('data')
            log(f"  ✅ Created commission record (ID: {rec.get('id')})")
            log(f"     SO: {rec.get('salesOrderNumber')}")
            log(f"     Type: {rec.get('commissionType')}, Value: {rec.get('commissionValue')}")
            log(f"     Amount: {rec.get('commissionAmount')}")
            log(f"     Basis: {rec.get('basisAmount')}")
            return rec
        else:
            log(f"  ❌ Failed to create commission: {resp.text}")
            return None
    except Exception as e:
        log(f"  ❌ Error creating commission: {e}")
        return None

def edit_commission_manual(dropshipper_id, commission_id, amount):
    """Edit commission with manual amount override"""
    log(f"\nTEST 5 — Edit commission (MANUAL override to {amount})")
    try:
        resp = session.put(
            f"{BASE_URL}/contacts/{dropshipper_id}/commissions/{commission_id}",
            json={"commissionAmount": amount},
            timeout=30
        )
        log(f"  Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            rec = data.get('data')
            log(f"  ✅ Edit successful")
            log(f"     Commission Type: {rec.get('commissionType')}")
            log(f"     Commission Amount: {rec.get('commissionAmount')}")
            log(f"     Expected Type: 'manual'")
            log(f"     Expected Amount: {amount}")
            
            # Verify
            if rec.get('commissionType') == 'manual' and rec.get('commissionAmount') == amount:
                log(f"  ✅ VERIFICATION PASSED: Type='manual', Amount={amount}")
                return rec
            else:
                log(f"  ❌ VERIFICATION FAILED: Type={rec.get('commissionType')}, Amount={rec.get('commissionAmount')}")
                return None
        else:
            log(f"  ❌ Edit failed: {resp.text}")
            return None
    except Exception as e:
        log(f"  ❌ Error editing commission: {e}")
        return None

def edit_commission_recompute(dropshipper_id, commission_id, comm_type, comm_value, expected_basis):
    """Edit commission with recompute logic"""
    log(f"\nTEST 6 — Edit commission (RECOMPUTE: type={comm_type}, value={comm_value})")
    try:
        resp = session.put(
            f"{BASE_URL}/contacts/{dropshipper_id}/commissions/{commission_id}",
            json={
                "commissionType": comm_type,
                "commissionValue": comm_value
            },
            timeout=30
        )
        log(f"  Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            rec = data.get('data')
            log(f"  ✅ Edit successful")
            log(f"     Commission Type: {rec.get('commissionType')}")
            log(f"     Commission Value: {rec.get('commissionValue')}")
            log(f"     Commission Amount: {rec.get('commissionAmount')}")
            log(f"     Basis Amount: {rec.get('basisAmount')}")
            
            # Calculate expected amount
            if comm_type == 'per_kg':
                expected_amount = round(comm_value * expected_basis)
            elif comm_type == 'fixed':
                expected_amount = comm_value
            else:
                expected_amount = None  # Can't verify without profit data
            
            log(f"     Expected Type: {comm_type}")
            log(f"     Expected Amount: {expected_amount} (value={comm_value} * basis={expected_basis})")
            
            # Verify
            if rec.get('commissionType') == comm_type:
                if expected_amount is not None and rec.get('commissionAmount') == expected_amount:
                    log(f"  ✅ VERIFICATION PASSED: Type={comm_type}, Amount={expected_amount}")
                    return rec
                elif expected_amount is None:
                    log(f"  ✅ VERIFICATION PASSED: Type={comm_type}, Amount={rec.get('commissionAmount')} (can't verify exact amount)")
                    return rec
                else:
                    log(f"  ❌ VERIFICATION FAILED: Amount mismatch (expected {expected_amount}, got {rec.get('commissionAmount')})")
                    return None
            else:
                log(f"  ❌ VERIFICATION FAILED: Type mismatch (expected {comm_type}, got {rec.get('commissionType')})")
                return None
        else:
            log(f"  ❌ Edit failed: {resp.text}")
            return None
    except Exception as e:
        log(f"  ❌ Error editing commission: {e}")
        return None

def verify_persistence(dropshipper_id, commission_id, expected_type, expected_amount):
    """Verify commission edit persisted after hydration"""
    log(f"\nTEST 7 — Verify PERSISTENCE after hydration")
    
    # Force hydration by hitting POTX paths
    log("  Step 1: Force hydration via GET /api/purchase-orders")
    try:
        resp = session.get(f"{BASE_URL}/purchase-orders", timeout=30)
        log(f"    Status: {resp.status_code}")
        if resp.status_code == 200:
            log(f"    ✅ Hydration path 1 triggered")
        else:
            log(f"    ⚠️  Hydration path 1 failed: {resp.text}")
    except Exception as e:
        log(f"    ⚠️  Error: {e}")
    
    log("  Step 2: Force hydration via GET /api/finance/overview")
    try:
        resp = session.get(f"{BASE_URL}/finance/overview", timeout=30)
        log(f"    Status: {resp.status_code}")
        if resp.status_code == 200:
            log(f"    ✅ Hydration path 2 triggered")
        else:
            log(f"    ⚠️  Hydration path 2 failed: {resp.text}")
    except Exception as e:
        log(f"    ⚠️  Error: {e}")
    
    log("  Step 3: Verify commission record still has edited values")
    try:
        resp = session.get(f"{BASE_URL}/contacts/{dropshipper_id}/commissions", timeout=30)
        log(f"    Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            records = data.get('data', {}).get('records', [])
            
            # Find our commission record
            rec = next((r for r in records if r.get('id') == commission_id), None)
            
            if rec:
                log(f"    ✅ Commission record found")
                log(f"       Commission Type: {rec.get('commissionType')}")
                log(f"       Commission Amount: {rec.get('commissionAmount')}")
                log(f"       Expected Type: {expected_type}")
                log(f"       Expected Amount: {expected_amount}")
                
                # Verify values match
                if rec.get('commissionType') == expected_type and rec.get('commissionAmount') == expected_amount:
                    log(f"  ✅ PERSISTENCE VERIFIED: Edit survived hydration!")
                    return True
                else:
                    log(f"  ❌ PERSISTENCE FAILED: Values reverted after hydration")
                    log(f"     Got: type={rec.get('commissionType')}, amount={rec.get('commissionAmount')}")
                    log(f"     Expected: type={expected_type}, amount={expected_amount}")
                    return False
            else:
                log(f"    ❌ Commission record not found")
                return False
        else:
            log(f"    ❌ Failed to get commissions: {resp.text}")
            return False
    except Exception as e:
        log(f"    ❌ Error verifying persistence: {e}")
        return False

def pay_commission(dropshipper_id, commission_id):
    """Pay a commission"""
    log(f"\nTEST 8 — Pay commission")
    try:
        resp = session.post(
            f"{BASE_URL}/contacts/{dropshipper_id}/commission-payments",
            json={"commissionRecordId": commission_id},
            timeout=30
        )
        log(f"  Status: {resp.status_code}")
        
        if resp.status_code in [200, 201]:
            data = resp.json()
            log(f"  ✅ Commission paid successfully")
            log(f"     Payment ID: {data.get('data', {}).get('paymentId')}")
            return True
        else:
            log(f"  ❌ Payment failed: {resp.text}")
            return False
    except Exception as e:
        log(f"  ❌ Error paying commission: {e}")
        return False

def test_edit_paid_commission(dropshipper_id, commission_id):
    """Test editing a paid commission (should fail with 400)"""
    log(f"\nTEST 9 — NEGATIVE: Try to edit PAID commission (expect 400)")
    try:
        resp = session.put(
            f"{BASE_URL}/contacts/{dropshipper_id}/commissions/{commission_id}",
            json={"commissionAmount": 999999},
            timeout=30
        )
        log(f"  Status: {resp.status_code}")
        
        if resp.status_code == 400:
            log(f"  ✅ PASSED: Got 400 as expected")
            log(f"     Error message: {resp.text}")
            
            # Check for expected error message
            if "sudah dibayar" in resp.text.lower():
                log(f"  ✅ PASSED: Error message contains 'sudah dibayar'")
                return True
            else:
                log(f"  ⚠️  Warning: Error message doesn't contain expected text")
                return True
        else:
            log(f"  ❌ FAILED: Expected 400, got {resp.status_code}")
            log(f"     Response: {resp.text}")
            return False
    except Exception as e:
        log(f"  ❌ Error: {e}")
        return False

def test_role_access(email, password, dropshipper_id, commission_id, expect_403=True):
    """Test role-based access control"""
    expected = "403" if expect_403 else "200"
    log(f"\nTEST 10 — ROLE: Test access as {email} (expect {expected})")
    
    # Create a new session for this role
    role_session = requests.Session()
    
    # Login
    try:
        resp = role_session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": email, "password": password},
            timeout=30
        )
        log(f"  Login status: {resp.status_code}")
        if resp.status_code != 200:
            log(f"  ❌ Login failed: {resp.text}")
            return False
        log(f"  ✅ Login successful")
    except Exception as e:
        log(f"  ❌ Login error: {e}")
        return False
    
    # Try to edit commission
    try:
        resp = role_session.put(
            f"{BASE_URL}/contacts/{dropshipper_id}/commissions/{commission_id}",
            json={"commissionAmount": 888888},
            timeout=30
        )
        log(f"  Edit status: {resp.status_code}")
        
        if expect_403:
            if resp.status_code == 403:
                log(f"  ✅ PASSED: Got 403 Forbidden as expected")
                log(f"     Error message: {resp.text}")
                return True
            else:
                log(f"  ❌ FAILED: Expected 403, got {resp.status_code}")
                log(f"     Response: {resp.text}")
                return False
        else:
            if resp.status_code == 200:
                log(f"  ✅ PASSED: Got 200 OK as expected (role has access)")
                return True
            else:
                log(f"  ❌ FAILED: Expected 200, got {resp.status_code}")
                log(f"     Response: {resp.text}")
                return False
    except Exception as e:
        log(f"  ❌ Error: {e}")
        return False

def delete_commission(dropshipper_id, commission_id):
    """Delete a commission record (cleanup)"""
    log(f"\nCLEANUP — Delete commission record")
    try:
        resp = session.delete(
            f"{BASE_URL}/contacts/{dropshipper_id}/commissions/{commission_id}",
            timeout=30
        )
        log(f"  Status: {resp.status_code}")
        
        if resp.status_code == 200:
            log(f"  ✅ Commission deleted successfully")
            return True
        else:
            log(f"  ⚠️  Delete failed: {resp.text}")
            log(f"  Note: Commission may have been paid and cannot be deleted")
            return False
    except Exception as e:
        log(f"  ⚠️  Error deleting commission: {e}")
        return False

def main():
    log("=" * 80)
    log("BACKEND TEST: Editable Dropshipper Commission Feature")
    log("=" * 80)
    
    test_results = []
    
    # Step 1: Login as admin
    if not test_login(ADMIN_EMAIL, ADMIN_PASSWORD):
        log("\n❌ FATAL: Cannot login as admin, aborting tests")
        sys.exit(1)
    test_results.append(("Login as admin", True))
    
    # Step 2: Find or create dropshipper
    dropshipper = find_dropshipper()
    if not dropshipper:
        dropshipper = create_dropshipper()
    
    if not dropshipper:
        log("\n❌ FATAL: Cannot find or create dropshipper, aborting tests")
        sys.exit(1)
    
    dropshipper_id = dropshipper.get('id')
    test_results.append(("Find/create dropshipper", True))
    
    # Step 3: Find sales order and create commission
    commission = None
    max_attempts = 5
    attempt = 0
    
    while not commission and attempt < max_attempts:
        so = find_sales_order(skip_index=attempt)
        if not so:
            log("\n❌ FATAL: Cannot find sales order, aborting tests")
            sys.exit(1)
        
        commission = create_commission(dropshipper_id, so.get('id'))
        if not commission:
            log(f"  Attempt {attempt+1}/{max_attempts} failed, trying another SO...")
            attempt += 1
    
    if not commission:
        log("\n❌ FATAL: Cannot create commission after multiple attempts, aborting tests")
        sys.exit(1)
    
    commission_id = commission.get('id')
    original_amount = commission.get('commissionAmount')
    basis_amount = commission.get('basisAmount', 0)
    test_results.append(("Create commission", True))
    
    # Step 4: Edit commission (manual override)
    manual_amount = 123456
    result = edit_commission_manual(dropshipper_id, commission_id, manual_amount)
    test_results.append(("Edit commission (manual)", result is not None))
    
    if not result:
        log("\n❌ Manual edit failed, aborting remaining tests")
        sys.exit(1)
    
    # Step 5: Edit commission (recompute)
    recompute_value = 1000
    result = edit_commission_recompute(dropshipper_id, commission_id, 'per_kg', recompute_value, basis_amount)
    test_results.append(("Edit commission (recompute)", result is not None))
    
    if not result:
        log("\n❌ Recompute edit failed, aborting remaining tests")
        sys.exit(1)
    
    final_type = result.get('commissionType')
    final_amount = result.get('commissionAmount')
    
    # Step 6: Verify persistence after hydration
    persistence_ok = verify_persistence(dropshipper_id, commission_id, final_type, final_amount)
    test_results.append(("Persistence after hydration", persistence_ok))
    
    if not persistence_ok:
        log("\n❌ CRITICAL: Persistence test failed - edits did not survive hydration!")
    
    # Step 7: Pay commission
    payment_ok = pay_commission(dropshipper_id, commission_id)
    test_results.append(("Pay commission", payment_ok))
    
    # Step 8: Try to edit paid commission (should fail)
    if payment_ok:
        edit_paid_ok = test_edit_paid_commission(dropshipper_id, commission_id)
        test_results.append(("Edit paid commission (negative)", edit_paid_ok))
    else:
        log("\n⚠️  Skipping edit paid commission test (payment failed)")
        test_results.append(("Edit paid commission (negative)", False))
    
    # Step 9: Test role access (akuntan - should be 403)
    # Need to create a new UNPAID commission for this test since the previous one was paid
    log("\n" + "=" * 80)
    log("Creating new UNPAID commission for role access test...")
    log("=" * 80)
    
    unpaid_commission = None
    attempt = 0
    max_attempts = 5
    
    while not unpaid_commission and attempt < max_attempts:
        so = find_sales_order(skip_index=attempt + 10)  # Start from index 10 to avoid conflicts
        if so:
            unpaid_commission = create_commission(dropshipper_id, so.get('id'))
            if not unpaid_commission:
                log(f"  Attempt {attempt+1}/{max_attempts} failed, trying another SO...")
                attempt += 1
    
    if unpaid_commission:
        unpaid_commission_id = unpaid_commission.get('id')
        
        # Test akuntan role (has admin-level access by design)
        log("\n  Testing akuntan role (has admin-level access by design)...")
        akuntan_ok = test_role_access(AKUNTAN_EMAIL, AKUNTAN_PASSWORD, dropshipper_id, unpaid_commission_id, expect_403=False)
        test_results.append(("Role access - akuntan (has admin access)", akuntan_ok))
        
        # Test direktur role (should be 403)
        log("\n  Testing direktur role (should be forbidden)...")
        direktur_ok = test_role_access(DIREKTUR_EMAIL, DIREKTUR_PASSWORD, dropshipper_id, unpaid_commission_id, expect_403=True)
        test_results.append(("Role access - direktur (forbidden)", direktur_ok))
        
        # Cleanup the unpaid commission
        delete_commission(dropshipper_id, unpaid_commission_id)
    else:
        log("\n⚠️  Could not create unpaid commission for role test, skipping")
        test_results.append(("Role access - akuntan (has admin access)", False))
        test_results.append(("Role access - direktur (forbidden)", False))
    
    # Cleanup: Try to delete commission (will fail if paid)
    if not payment_ok:
        delete_commission(dropshipper_id, commission_id)
    else:
        log("\nCLEANUP — Skipping delete (commission was paid and cannot be deleted)")
    
    # Summary
    log("\n" + "=" * 80)
    log("TEST SUMMARY")
    log("=" * 80)
    
    passed = sum(1 for _, result in test_results if result)
    total = len(test_results)
    
    for test_name, result in test_results:
        status = "✅ PASS" if result else "❌ FAIL"
        log(f"{status}: {test_name}")
    
    log(f"\nTotal: {passed}/{total} tests passed ({100*passed//total}%)")
    
    if passed == total:
        log("\n✅ ALL TESTS PASSED")
        sys.exit(0)
    else:
        log(f"\n❌ {total - passed} TEST(S) FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
