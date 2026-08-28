#!/usr/bin/env python3
"""
Backend test for Cashbook per-user filtering feature.

TEST: Admin & Supervisor ONLY see entries they created themselves (created_by = their email/id).
      Akuntan & Direktur see ALL entries.

Steps:
1. Login as AKUNTAN, create 1 cashbook entry (TEST-AKUNTAN)
2. Login as ADMIN, create 1 cashbook entry (TEST-ADMIN)
3. GET /api/accounting/cashbook as ADMIN → should only contain TEST-ADMIN entry, NOT TEST-AKUNTAN
4. GET /api/accounting/cashbook as AKUNTAN → should contain BOTH entries
5. Verify created_by/createdBy field is present in output
6. Cleanup: DELETE both test entries
"""

import requests
import json
from datetime import datetime

# Base URL
BASE_URL = "https://github-to-production.preview.emergentagent.com/api"

# Test credentials
AKUNTAN_EMAIL = "akuntan@lpi.co.id"
AKUNTAN_PASSWORD = "akuntanlpi123"
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"

def login(email, password):
    """Login and return session"""
    session = requests.Session()
    response = session.post(
        f"{BASE_URL}/auth/sign-in/email",
        json={"email": email, "password": password},
        headers={"Content-Type": "application/json"}
    )
    print(f"Login as {email}: {response.status_code}")
    if response.status_code != 200:
        print(f"  Error: {response.text}")
        return None
    return session

def create_cashbook_entry(session, description, amount=50000):
    """Create a cashbook entry"""
    today = datetime.now().strftime("%Y-%m-%d")
    payload = {
        "type": "EXPENSE",
        "date": today,
        "amount": amount,
        "categoryCode": "6-0000",  # BEBAN OPERASIONAL
        "cashCode": "1-1110",      # Kas
        "note": description
    }
    response = session.post(
        f"{BASE_URL}/accounting/cashbook",
        json=payload,
        headers={"Content-Type": "application/json"}
    )
    print(f"Create cashbook entry '{description}': {response.status_code}")
    if response.status_code == 201 or response.status_code == 200:
        data = response.json()
        print(f"  Created: {data}")
        return data.get("id")
    else:
        print(f"  Error: {response.text}")
        return None

def get_cashbook_entries(session, role_name):
    """Get cashbook entries"""
    response = session.get(f"{BASE_URL}/accounting/cashbook")
    print(f"\nGET /accounting/cashbook as {role_name}: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        entries = data.get("data", [])
        print(f"  Total entries: {len(entries)}")
        
        # Check for created_by/createdBy field
        if entries:
            first_entry = entries[0]
            has_created_by = "created_by" in first_entry or "createdBy" in first_entry
            print(f"  Has created_by/createdBy field: {has_created_by}")
            if not has_created_by:
                print(f"  ❌ CRITICAL BUG: created_by/createdBy field NOT present in response!")
                print(f"  Available fields: {list(first_entry.keys())}")
        
        # Filter test entries
        test_entries = [e for e in entries if e.get("note", "").startswith("TEST-")]
        print(f"  Test entries found: {len(test_entries)}")
        for entry in test_entries:
            note = entry.get("note", "")
            entry_id = entry.get("id", "")
            created_by = entry.get("created_by") or entry.get("createdBy") or "NOT_PRESENT"
            print(f"    - {note} (id: {entry_id[:8]}..., created_by: {created_by})")
        
        return entries, test_entries
    else:
        print(f"  Error: {response.text}")
        return [], []

def delete_cashbook_entry(session, entry_id, role_name):
    """Delete a cashbook entry"""
    response = session.delete(f"{BASE_URL}/accounting/cashbook/{entry_id}")
    print(f"Delete cashbook entry as {role_name}: {response.status_code}")
    if response.status_code != 200:
        print(f"  Error: {response.text}")
    return response.status_code == 200

def main():
    print("=" * 80)
    print("BACKEND TEST: Cashbook Per-User Filtering")
    print("=" * 80)
    
    # Step 1: Login as AKUNTAN and create entry
    print("\n--- STEP 1: Login as AKUNTAN and create entry ---")
    akuntan_session = login(AKUNTAN_EMAIL, AKUNTAN_PASSWORD)
    if not akuntan_session:
        print("❌ Failed to login as AKUNTAN")
        return
    
    akuntan_entry_id = create_cashbook_entry(akuntan_session, "TEST-AKUNTAN", 75000)
    if not akuntan_entry_id:
        print("❌ Failed to create AKUNTAN entry")
        return
    print(f"✅ AKUNTAN entry created: {akuntan_entry_id}")
    
    # Step 2: Login as ADMIN and create entry
    print("\n--- STEP 2: Login as ADMIN and create entry ---")
    admin_session = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if not admin_session:
        print("❌ Failed to login as ADMIN")
        return
    
    admin_entry_id = create_cashbook_entry(admin_session, "TEST-ADMIN", 100000)
    if not admin_entry_id:
        print("❌ Failed to create ADMIN entry")
        return
    print(f"✅ ADMIN entry created: {admin_entry_id}")
    
    # Step 3: GET as ADMIN (should only see TEST-ADMIN)
    print("\n--- STEP 3: GET as ADMIN (should only see TEST-ADMIN) ---")
    admin_all_entries, admin_test_entries = get_cashbook_entries(admin_session, "ADMIN")
    
    admin_has_own = any(e.get("note") == "TEST-ADMIN" for e in admin_test_entries)
    admin_has_akuntan = any(e.get("note") == "TEST-AKUNTAN" for e in admin_test_entries)
    
    print(f"\n  Admin sees TEST-ADMIN: {admin_has_own}")
    print(f"  Admin sees TEST-AKUNTAN: {admin_has_akuntan}")
    
    if admin_has_own and not admin_has_akuntan:
        print("  ✅ PASS: Admin only sees their own entry")
    elif not admin_has_own and not admin_has_akuntan:
        print("  ❌ FAIL: Admin sees EMPTY list (created_by field likely missing)")
    else:
        print("  ❌ FAIL: Admin sees entries they shouldn't see")
    
    # Step 4: GET as AKUNTAN (should see BOTH)
    print("\n--- STEP 4: GET as AKUNTAN (should see BOTH) ---")
    akuntan_all_entries, akuntan_test_entries = get_cashbook_entries(akuntan_session, "AKUNTAN")
    
    akuntan_has_own = any(e.get("note") == "TEST-AKUNTAN" for e in akuntan_test_entries)
    akuntan_has_admin = any(e.get("note") == "TEST-ADMIN" for e in akuntan_test_entries)
    
    print(f"\n  Akuntan sees TEST-AKUNTAN: {akuntan_has_own}")
    print(f"  Akuntan sees TEST-ADMIN: {akuntan_has_admin}")
    
    if akuntan_has_own and akuntan_has_admin:
        print("  ✅ PASS: Akuntan sees ALL entries")
    else:
        print("  ❌ FAIL: Akuntan doesn't see all entries")
    
    # Step 5: Verify created_by field presence
    print("\n--- STEP 5: Verify created_by/createdBy field presence ---")
    if akuntan_test_entries:
        first_entry = akuntan_test_entries[0]
        has_created_by = "created_by" in first_entry or "createdBy" in first_entry
        if has_created_by:
            print("  ✅ PASS: created_by/createdBy field is present")
        else:
            print("  ❌ FAIL: created_by/createdBy field is NOT present")
            print(f"  Available fields: {list(first_entry.keys())}")
    
    # Step 6: Cleanup
    print("\n--- STEP 6: Cleanup (delete test entries) ---")
    # Akuntan can delete (full access)
    if akuntan_entry_id:
        success = delete_cashbook_entry(akuntan_session, akuntan_entry_id, "AKUNTAN")
        if success:
            print(f"✅ Deleted AKUNTAN entry")
        else:
            print(f"⚠️ Failed to delete AKUNTAN entry")
    
    if admin_entry_id:
        success = delete_cashbook_entry(akuntan_session, admin_entry_id, "AKUNTAN")
        if success:
            print(f"✅ Deleted ADMIN entry")
        else:
            print(f"⚠️ Failed to delete ADMIN entry")
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    # Check if created_by field is present
    has_field = False
    if akuntan_test_entries:
        first_entry = akuntan_test_entries[0]
        has_field = "created_by" in first_entry or "createdBy" in first_entry
    
    if not has_field:
        print("❌ CRITICAL BUG: created_by/createdBy field NOT exposed in listCashbook response")
        print("   The filtering logic in route.js expects this field but it's not returned by engine.js")
        print("   Result: Admin sees EMPTY list instead of their own entries")
        print("\n   FIX NEEDED: Add 'createdBy: e.created_by' to the return object in listCashbook()")
        print("   Location: /app/lib/accounting/engine.js, lines 1092-1098")
    else:
        if admin_has_own and not admin_has_akuntan and akuntan_has_own and akuntan_has_admin:
            print("✅ ALL TESTS PASSED: Per-user filtering working correctly")
        else:
            print("⚠️ PARTIAL FAILURE: Some filtering tests failed")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ Test failed with exception: {e}")
        import traceback
        traceback.print_exc()
