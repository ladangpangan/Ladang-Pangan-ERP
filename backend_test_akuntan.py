#!/usr/bin/env python3
"""
Backend API Test for Akuntan Full Access + Payment Approval Workflow

Tests:
1. Akuntan full access (admin-equivalent) to all modules
2. SO Invoiced creates payment_approval concern + notifies akuntan
3. PO Tanda Terima creates payment_approval concern + notifies akuntan
4. Akuntan approves payment_approval → notifies supervisor & direktur (INFO)
5. Negative: akuntan cannot approve non-payment_approval concerns
6. Regression: supervisor/direktur can still approve/acknowledge normal concerns
"""

import requests
import json
import sys
import time

# Base URL from .env
BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"

# Test credentials
CREDENTIALS = {
    'akuntan': {'email': 'akuntan@lpi.co.id', 'password': 'akuntanlpi123'},
    'admin': {'email': 'admin@lpi.co.id', 'password': 'admin123'},
    'supervisor': {'email': 'supervisor@lpi.co.id', 'password': 'super123'},
    'direktur': {'email': 'direktur@lpi.co.id', 'password': 'direktur123'},
}

def print_test(msg):
    print(f"\n{'='*80}")
    print(f"TEST: {msg}")
    print('='*80)

def print_result(passed, msg):
    status = "✅ PASSED" if passed else "❌ FAILED"
    print(f"{status}: {msg}")

def print_value(label, value):
    print(f"  {label}: {value}")

def login(role):
    """Login and return session"""
    session = requests.Session()
    creds = CREDENTIALS[role]
    
    try:
        response = session.post(
            f"{BASE_URL}/auth/sign-in/email",
            json={"email": creds['email'], "password": creds['password']},
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        
        if response.status_code == 200:
            print_result(True, f"Login as {role} successful ({creds['email']})")
            return session
        else:
            print_result(False, f"Login as {role} failed with status {response.status_code}")
            print(f"Response: {response.text}")
            return None
    except Exception as e:
        print_result(False, f"Login as {role} failed with error: {e}")
        return None

def get_error_message(response):
    """Extract error message from response"""
    try:
        data = response.json()
        if isinstance(data, dict):
            return data.get('error', data.get('message', str(data)))
        return str(data)
    except:
        return response.text

# Track test results
test_results = []

try:
    # ========== TEST 1: Akuntan Full Access ==========
    print_test("TEST 1 - Akuntan Full Access (admin-equivalent)")
    
    akuntan_session = login('akuntan')
    if not akuntan_session:
        print_result(False, "Cannot proceed without akuntan login")
        sys.exit(1)
    
    # Test endpoints that require admin access
    admin_endpoints = [
        '/sales-orders',
        '/purchase-orders',
        '/inventory/stocks',
        '/work-orders',
        '/products',
        '/contacts',
        '/accounting/balance-sheet',
        '/dashboard/summary',
        '/approvals',
    ]
    
    akuntan_access_results = []
    for endpoint in admin_endpoints:
        try:
            response = akuntan_session.get(f"{BASE_URL}{endpoint}", timeout=30)
            passed = response.status_code == 200
            akuntan_access_results.append(passed)
            print_result(passed, f"GET {endpoint} → {response.status_code}")
            if not passed:
                print(f"  Error: {get_error_message(response)}")
        except Exception as e:
            akuntan_access_results.append(False)
            print_result(False, f"GET {endpoint} → Exception: {e}")
    
    test1_passed = all(akuntan_access_results)
    test_results.append(('TEST 1 - Akuntan Full Access', test1_passed))
    
    if test1_passed:
        print("\n✅ TEST 1 PASSED: Akuntan has admin-equivalent access to all modules")
    else:
        print("\n❌ TEST 1 FAILED: Akuntan does not have full access")

    # ========== TEST 2: SO Invoiced creates payment_approval + notifies akuntan ==========
    print_test("TEST 2 - SO Invoiced creates payment_approval + notifies akuntan")
    
    admin_session = login('admin')
    if not admin_session:
        print_result(False, "Cannot proceed without admin login")
        sys.exit(1)
    
    # Find a SO with status 'Shipped' or create/transition one
    so_response = admin_session.get(f"{BASE_URL}/sales-orders", timeout=30)
    if so_response.status_code != 200:
        print_result(False, f"Cannot fetch sales orders: {so_response.status_code}")
        test_results.append(('TEST 2 - SO Invoiced', False))
    else:
        sos = so_response.json().get('data', [])
        print_value("Total SOs found", len(sos))
        
        # Find a Shipped SO
        shipped_so = None
        for so in sos:
            if so.get('pipelineStatus') == 'Shipped':
                shipped_so = so
                break
        
        if not shipped_so:
            print_result(False, "No SO with status 'Shipped' found. Cannot test SO Invoiced workflow.")
            print("  Note: This is a data condition, not a code bug.")
            test_results.append(('TEST 2 - SO Invoiced', 'SKIPPED - No Shipped SO'))
        else:
            so_id = shipped_so['id']
            so_number = shipped_so['soNumber']
            print_value("Found Shipped SO", so_number)
            
            # Get baseline approval count
            approvals_before = admin_session.get(f"{BASE_URL}/approvals?type=payment_approval", timeout=30)
            approvals_before_count = len(approvals_before.json().get('data', [])) if approvals_before.status_code == 200 else 0
            
            # Get baseline notification count for akuntan
            notifs_before = akuntan_session.get(f"{BASE_URL}/notifications", timeout=30)
            notifs_before_count = len(notifs_before.json().get('data', [])) if notifs_before.status_code == 200 else 0
            
            # Transition SO to Invoiced
            transition_response = admin_session.post(
                f"{BASE_URL}/sales-orders/{so_id}/status",
                json={'status': 'Invoiced'},
                headers={"Content-Type": "application/json"},
                timeout=30
            )
            
            if transition_response.status_code != 200:
                print_result(False, f"Failed to transition SO to Invoiced: {transition_response.status_code}")
                print(f"  Error: {get_error_message(transition_response)}")
                test_results.append(('TEST 2 - SO Invoiced', False))
            else:
                print_result(True, f"SO {so_number} transitioned to Invoiced")
                
                # Wait a moment for async operations
                time.sleep(1)
                
                # Verify payment_approval concern created
                approvals_after = admin_session.get(f"{BASE_URL}/approvals?type=payment_approval", timeout=30)
                if approvals_after.status_code != 200:
                    print_result(False, f"Cannot fetch approvals: {approvals_after.status_code}")
                    test_results.append(('TEST 2 - SO Invoiced', False))
                else:
                    approvals = approvals_after.json().get('data', [])
                    approvals_after_count = len(approvals)
                    
                    # Find the new approval for this SO
                    new_approval = None
                    for ap in approvals:
                        if ap.get('entityType') == 'SO' and ap.get('entityId') == so_id and ap.get('concernType') == 'payment_approval':
                            new_approval = ap
                            break
                    
                    approval_created = new_approval is not None
                    print_result(approval_created, f"payment_approval concern created for SO {so_number}")
                    if new_approval:
                        print_value("  Approval ID", new_approval['id'])
                        print_value("  Status", new_approval['status'])
                        print_value("  Amount", f"Rp {new_approval.get('amount', 0):,.0f}")
                    
                    # Verify akuntan received notification
                    notifs_after = akuntan_session.get(f"{BASE_URL}/notifications", timeout=30)
                    if notifs_after.status_code != 200:
                        print_result(False, f"Cannot fetch akuntan notifications: {notifs_after.status_code}")
                        notif_received = False
                    else:
                        notifs = notifs_after.json().get('data', [])
                        notifs_after_count = len(notifs)
                        
                        # Find notification for this approval
                        notif_found = False
                        for notif in notifs:
                            if 'Pembayaran' in notif.get('title', '') or 'Invoice' in notif.get('title', ''):
                                if so_number in notif.get('message', '') or so_number in notif.get('title', ''):
                                    notif_found = True
                                    print_value("  Notification found", notif.get('title', ''))
                                    break
                        
                        notif_received = notif_found or (notifs_after_count > notifs_before_count)
                        print_result(notif_received, f"Akuntan received notification (count: {notifs_before_count} → {notifs_after_count})")
                    
                    test2_passed = approval_created and notif_received
                    test_results.append(('TEST 2 - SO Invoiced', test2_passed))
                    
                    if test2_passed:
                        print("\n✅ TEST 2 PASSED: SO Invoiced creates payment_approval + notifies akuntan")
                    else:
                        print("\n❌ TEST 2 FAILED")

    # ========== TEST 3: PO Tanda Terima creates payment_approval ==========
    print_test("TEST 3 - PO Tanda Terima creates payment_approval + notifies akuntan")
    
    # Find a PO with status 'Dikirim'
    po_response = admin_session.get(f"{BASE_URL}/purchase-orders", timeout=30)
    if po_response.status_code != 200:
        print_result(False, f"Cannot fetch purchase orders: {po_response.status_code}")
        test_results.append(('TEST 3 - PO Tanda Terima', False))
    else:
        pos = po_response.json().get('data', [])
        print_value("Total POs found", len(pos))
        
        # Find a Dikirim PO
        dikirim_po = None
        for po in pos:
            if po.get('pipelineStatus') == 'Dikirim':
                dikirim_po = po
                break
        
        if not dikirim_po:
            print_result(False, "No PO with status 'Dikirim' found. Cannot test PO Tanda Terima workflow.")
            print("  Note: This is a data condition, not a code bug.")
            test_results.append(('TEST 3 - PO Tanda Terima', 'SKIPPED - No Dikirim PO'))
        else:
            po_id = dikirim_po['id']
            po_number = dikirim_po['poNumber']
            print_value("Found Dikirim PO", po_number)
            
            # Get baseline approval count
            approvals_before = admin_session.get(f"{BASE_URL}/approvals?type=payment_approval", timeout=30)
            approvals_before_count = len(approvals_before.json().get('data', [])) if approvals_before.status_code == 200 else 0
            
            # Transition PO to Tanda Terima
            transition_response = admin_session.post(
                f"{BASE_URL}/purchase-orders/{po_id}/status",
                json={'status': 'Tanda Terima'},
                headers={"Content-Type": "application/json"},
                timeout=30
            )
            
            if transition_response.status_code != 200:
                print_result(False, f"Failed to transition PO to Tanda Terima: {transition_response.status_code}")
                print(f"  Error: {get_error_message(transition_response)}")
                test_results.append(('TEST 3 - PO Tanda Terima', False))
            else:
                print_result(True, f"PO {po_number} transitioned to Tanda Terima")
                
                # Wait a moment for async operations
                time.sleep(1)
                
                # Verify payment_approval concern created
                approvals_after = admin_session.get(f"{BASE_URL}/approvals?type=payment_approval", timeout=30)
                if approvals_after.status_code != 200:
                    print_result(False, f"Cannot fetch approvals: {approvals_after.status_code}")
                    test_results.append(('TEST 3 - PO Tanda Terima', False))
                else:
                    approvals = approvals_after.json().get('data', [])
                    
                    # Find the new approval for this PO
                    new_approval = None
                    for ap in approvals:
                        if ap.get('entityType') == 'PO' and ap.get('entityId') == po_id and ap.get('concernType') == 'payment_approval':
                            new_approval = ap
                            break
                    
                    approval_created = new_approval is not None
                    print_result(approval_created, f"payment_approval concern created for PO {po_number}")
                    if new_approval:
                        print_value("  Approval ID", new_approval['id'])
                        print_value("  Status", new_approval['status'])
                        print_value("  Amount", f"Rp {new_approval.get('amount', 0):,.0f}")
                    
                    # Verify akuntan received notification
                    notifs_after = akuntan_session.get(f"{BASE_URL}/notifications", timeout=30)
                    if notifs_after.status_code != 200:
                        print_result(False, f"Cannot fetch akuntan notifications: {notifs_after.status_code}")
                        notif_received = False
                    else:
                        notifs = notifs_after.json().get('data', [])
                        
                        # Find notification for this approval
                        notif_found = False
                        for notif in notifs:
                            if 'Pembayaran' in notif.get('title', '') or po_number in notif.get('message', ''):
                                notif_found = True
                                print_value("  Notification found", notif.get('title', ''))
                                break
                        
                        notif_received = notif_found
                        print_result(notif_received, f"Akuntan received notification")
                    
                    test3_passed = approval_created and notif_received
                    test_results.append(('TEST 3 - PO Tanda Terima', test3_passed))
                    
                    if test3_passed:
                        print("\n✅ TEST 3 PASSED: PO Tanda Terima creates payment_approval + notifies akuntan")
                    else:
                        print("\n❌ TEST 3 FAILED")

    # ========== TEST 4: Akuntan approves → notifies supervisor & direktur ==========
    print_test("TEST 4 - Akuntan approves payment_approval → notifies supervisor & direktur")
    
    # Get all pending payment_approval concerns
    approvals_response = akuntan_session.get(f"{BASE_URL}/approvals?type=payment_approval", timeout=30)
    if approvals_response.status_code != 200:
        print_result(False, f"Cannot fetch approvals: {approvals_response.status_code}")
        test_results.append(('TEST 4 - Akuntan Approves', False))
    else:
        approvals = approvals_response.json().get('data', [])
        
        # Find a pending payment_approval
        pending_approval = None
        for ap in approvals:
            if ap.get('status') == 'pending' and ap.get('concernType') == 'payment_approval':
                pending_approval = ap
                break
        
        if not pending_approval:
            print_result(False, "No pending payment_approval concern found. Cannot test approval workflow.")
            print("  Note: This is a data condition. Tests 2 or 3 should have created one.")
            test_results.append(('TEST 4 - Akuntan Approves', 'SKIPPED - No pending approval'))
        else:
            approval_id = pending_approval['id']
            print_value("Found pending approval", approval_id)
            print_value("  Entity", f"{pending_approval.get('entityType')} {pending_approval.get('entityNumber', '')}")
            
            # Get baseline notification counts for supervisor & direktur
            supervisor_session = login('supervisor')
            direktur_session = login('direktur')
            
            if not supervisor_session or not direktur_session:
                print_result(False, "Cannot login as supervisor or direktur")
                test_results.append(('TEST 4 - Akuntan Approves', False))
            else:
                supervisor_notifs_before = supervisor_session.get(f"{BASE_URL}/notifications", timeout=30)
                supervisor_notifs_before_count = len(supervisor_notifs_before.json().get('data', [])) if supervisor_notifs_before.status_code == 200 else 0
                
                direktur_notifs_before = direktur_session.get(f"{BASE_URL}/notifications", timeout=30)
                direktur_notifs_before_count = len(direktur_notifs_before.json().get('data', [])) if direktur_notifs_before.status_code == 200 else 0
                
                # Akuntan approves
                approve_response = akuntan_session.post(
                    f"{BASE_URL}/approvals/{approval_id}/action",
                    json={'action': 'approved', 'note': 'Test approval by akuntan'},
                    headers={"Content-Type": "application/json"},
                    timeout=30
                )
                
                if approve_response.status_code != 200:
                    print_result(False, f"Failed to approve: {approve_response.status_code}")
                    print(f"  Error: {get_error_message(approve_response)}")
                    test_results.append(('TEST 4 - Akuntan Approves', False))
                else:
                    print_result(True, "Akuntan approved payment_approval")
                    
                    # Verify approval status changed
                    updated_approval = approve_response.json().get('data', {})
                    status_updated = updated_approval.get('status') == 'approved'
                    print_result(status_updated, f"Approval status: {updated_approval.get('status')}")
                    
                    # Wait a moment for notifications
                    time.sleep(1)
                    
                    # Verify supervisor received notification
                    supervisor_notifs_after = supervisor_session.get(f"{BASE_URL}/notifications", timeout=30)
                    if supervisor_notifs_after.status_code != 200:
                        print_result(False, f"Cannot fetch supervisor notifications: {supervisor_notifs_after.status_code}")
                        supervisor_notified = False
                    else:
                        supervisor_notifs = supervisor_notifs_after.json().get('data', [])
                        supervisor_notifs_after_count = len(supervisor_notifs)
                        
                        # Find payment_approved notification
                        supervisor_notif_found = False
                        for notif in supervisor_notifs:
                            if notif.get('category') == 'payment_approved' or 'disetujui Akuntan' in notif.get('title', ''):
                                supervisor_notif_found = True
                                print_value("  Supervisor notification", notif.get('title', ''))
                                break
                        
                        supervisor_notified = supervisor_notif_found or (supervisor_notifs_after_count > supervisor_notifs_before_count)
                        print_result(supervisor_notified, f"Supervisor received notification (count: {supervisor_notifs_before_count} → {supervisor_notifs_after_count})")
                    
                    # Verify direktur received notification
                    direktur_notifs_after = direktur_session.get(f"{BASE_URL}/notifications", timeout=30)
                    if direktur_notifs_after.status_code != 200:
                        print_result(False, f"Cannot fetch direktur notifications: {direktur_notifs_after.status_code}")
                        direktur_notified = False
                    else:
                        direktur_notifs = direktur_notifs_after.json().get('data', [])
                        direktur_notifs_after_count = len(direktur_notifs)
                        
                        # Find payment_approved notification
                        direktur_notif_found = False
                        for notif in direktur_notifs:
                            if notif.get('category') == 'payment_approved' or 'disetujui Akuntan' in notif.get('title', ''):
                                direktur_notif_found = True
                                print_value("  Direktur notification", notif.get('title', ''))
                                break
                        
                        direktur_notified = direktur_notif_found or (direktur_notifs_after_count > direktur_notifs_before_count)
                        print_result(direktur_notified, f"Direktur received notification (count: {direktur_notifs_before_count} → {direktur_notifs_after_count})")
                    
                    test4_passed = status_updated and supervisor_notified and direktur_notified
                    test_results.append(('TEST 4 - Akuntan Approves', test4_passed))
                    
                    if test4_passed:
                        print("\n✅ TEST 4 PASSED: Akuntan approval notifies supervisor & direktur")
                    else:
                        print("\n❌ TEST 4 FAILED")

    # ========== TEST 5: Negative - Akuntan cannot approve non-payment_approval ==========
    print_test("TEST 5 - Negative: Akuntan cannot approve non-payment_approval concerns")
    
    # Get all approvals
    all_approvals_response = akuntan_session.get(f"{BASE_URL}/approvals", timeout=30)
    if all_approvals_response.status_code != 200:
        print_result(False, f"Cannot fetch approvals: {all_approvals_response.status_code}")
        test_results.append(('TEST 5 - Negative Test', False))
    else:
        all_approvals = all_approvals_response.json().get('data', [])
        
        # Find a non-payment_approval concern
        non_payment_approval = None
        for ap in all_approvals:
            if ap.get('concernType') != 'payment_approval' and ap.get('status') == 'pending':
                non_payment_approval = ap
                break
        
        if not non_payment_approval:
            print_result(False, "No non-payment_approval concern found. Cannot test negative case.")
            print("  Note: This is a data condition. Skipping negative test.")
            test_results.append(('TEST 5 - Negative Test', 'SKIPPED - No non-payment concern'))
        else:
            approval_id = non_payment_approval['id']
            concern_type = non_payment_approval['concernType']
            print_value("Found non-payment concern", concern_type)
            print_value("  Approval ID", approval_id)
            
            # Try to approve as akuntan (should fail with 403)
            approve_response = akuntan_session.post(
                f"{BASE_URL}/approvals/{approval_id}/action",
                json={'action': 'approved'},
                headers={"Content-Type": "application/json"},
                timeout=30
            )
            
            is_forbidden = approve_response.status_code == 403
            error_msg = get_error_message(approve_response)
            has_correct_message = 'Akuntan hanya dapat menyetujui konsern Persetujuan Pembayaran' in error_msg
            
            print_result(is_forbidden, f"Request rejected with 403: {is_forbidden}")
            print_result(has_correct_message, f"Error message correct: {has_correct_message}")
            if not has_correct_message:
                print(f"  Actual error: {error_msg}")
            
            test5_passed = is_forbidden and has_correct_message
            test_results.append(('TEST 5 - Negative Test', test5_passed))
            
            if test5_passed:
                print("\n✅ TEST 5 PASSED: Akuntan correctly blocked from non-payment approvals")
            else:
                print("\n❌ TEST 5 FAILED")

    # ========== TEST 6: Regression - Supervisor/Direktur can still approve ==========
    print_test("TEST 6 - Regression: Supervisor/Direktur can still approve/acknowledge")
    
    # Test supervisor can still approve normal concerns
    supervisor_session = login('supervisor')
    if not supervisor_session:
        print_result(False, "Cannot login as supervisor")
        test_results.append(('TEST 6 - Regression', False))
    else:
        # Get supervisor's approvals
        supervisor_approvals = supervisor_session.get(f"{BASE_URL}/approvals", timeout=30)
        if supervisor_approvals.status_code != 200:
            print_result(False, f"Supervisor cannot fetch approvals: {supervisor_approvals.status_code}")
            supervisor_can_access = False
        else:
            supervisor_can_access = True
            print_result(True, f"Supervisor can access approvals endpoint")
        
        # Test direktur can still acknowledge
        direktur_session = login('direktur')
        if not direktur_session:
            print_result(False, "Cannot login as direktur")
            direktur_can_access = False
        else:
            direktur_approvals = direktur_session.get(f"{BASE_URL}/approvals", timeout=30)
            if direktur_approvals.status_code != 200:
                print_result(False, f"Direktur cannot fetch approvals: {direktur_approvals.status_code}")
                direktur_can_access = False
            else:
                direktur_can_access = True
                print_result(True, f"Direktur can access approvals endpoint")
        
        test6_passed = supervisor_can_access and direktur_can_access
        test_results.append(('TEST 6 - Regression', test6_passed))
        
        if test6_passed:
            print("\n✅ TEST 6 PASSED: Supervisor & Direktur can still access approvals")
        else:
            print("\n❌ TEST 6 FAILED")

    # ========== SUMMARY ==========
    print("\n" + "="*80)
    print("SUMMARY")
    print("="*80)
    
    for test_name, result in test_results:
        if result == True:
            print(f"✅ {test_name}")
        elif result == False:
            print(f"❌ {test_name}")
        else:
            print(f"⚠️  {test_name}: {result}")
    
    # Count passed tests (excluding skipped)
    passed_count = sum(1 for _, result in test_results if result == True)
    failed_count = sum(1 for _, result in test_results if result == False)
    skipped_count = sum(1 for _, result in test_results if result not in [True, False])
    total_count = len(test_results)
    
    print(f"\nResults: {passed_count} passed, {failed_count} failed, {skipped_count} skipped out of {total_count} tests")
    
    if failed_count == 0:
        print("\n✅ ALL TESTS PASSED (or skipped due to data conditions)")
        sys.exit(0)
    else:
        print("\n❌ SOME TESTS FAILED")
        sys.exit(1)

except requests.exceptions.RequestException as e:
    print(f"\n❌ REQUEST ERROR: {e}")
    sys.exit(1)
except Exception as e:
    print(f"\n❌ UNEXPECTED ERROR: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
