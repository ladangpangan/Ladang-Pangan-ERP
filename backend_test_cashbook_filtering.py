#!/usr/bin/env python3
"""
Backend Test: Cashbook (Pencatatan Cepat) Per-User Filtering
Tests the bugfix where Admin/Supervisor were getting empty lists because created_by field was missing.

Bug Fix: /app/lib/accounting/engine.js listCashbook() now includes createdBy and created_by fields.
Business Rule:
- Admin & Supervisor: GET /api/accounting/cashbook returns ONLY entries THEY created
- Akuntan & Direktur: GET /api/accounting/cashbook returns ALL entries (from everyone)
"""

import requests
import json
from datetime import datetime

BASE_URL = "https://so-po-loader.preview.emergentagent.com/api"

# Test credentials
CREDENTIALS = {
    "admin": {"email": "admin@lpi.co.id", "password": "admin123"},
    "supervisor": {"email": "supervisor@lpi.co.id", "password": "super123"},
    "akuntan": {"email": "akuntan@lpi.co.id", "password": "akuntanlpi123"},
    "direktur": {"email": "direktur@lpi.co.id", "password": "direktur123"},
}

def login(role):
    """Login and return session"""
    creds = CREDENTIALS[role]
    session = requests.Session()
    resp = session.post(
        f"{BASE_URL}/auth/sign-in/email",
        json={"email": creds["email"], "password": creds["password"]},
        timeout=30
    )
    if resp.status_code != 200:
        raise Exception(f"Login failed for {role}: {resp.status_code} {resp.text}")
    print(f"✓ Logged in as {role} ({creds['email']})")
    return session

def create_cashbook_entry(session, role, amount, note):
    """Create a cashbook EXPENSE entry"""
    today = datetime.now().strftime("%Y-%m-%d")
    payload = {
        "type": "EXPENSE",
        "date": today,
        "amount": amount,
        "categoryCode": "6-1200",  # Beban Operasional Umum
        "cashCode": "1-1110",      # Kas
        "note": note
    }
    resp = session.post(f"{BASE_URL}/accounting/cashbook", json=payload, timeout=30)
    if resp.status_code != 200:
        raise Exception(f"Failed to create cashbook entry for {role}: {resp.status_code} {resp.text}")
    data = resp.json()
    entry_id = data.get("id")
    journal_number = data.get("journalNumber")
    print(f"✓ Created cashbook entry for {role}: {journal_number} (ID: {entry_id}, amount: Rp {amount:,})")
    return entry_id

def get_cashbook_entries(session, role):
    """Get cashbook entries for the current user"""
    resp = session.get(f"{BASE_URL}/accounting/cashbook", timeout=30)
    if resp.status_code != 200:
        raise Exception(f"Failed to get cashbook entries for {role}: {resp.status_code} {resp.text}")
    data = resp.json()
    entries = data.get("data", [])
    print(f"✓ Retrieved {len(entries)} cashbook entries for {role}")
    return entries

def delete_cashbook_entry(session, role, entry_id):
    """Delete a cashbook entry (only akuntan/direktur can delete)"""
    resp = session.delete(f"{BASE_URL}/accounting/cashbook/{entry_id}", timeout=30)
    if resp.status_code != 200:
        raise Exception(f"Failed to delete cashbook entry {entry_id} as {role}: {resp.status_code} {resp.text}")
    print(f"✓ Deleted cashbook entry {entry_id} as {role}")

def main():
    print("=" * 80)
    print("CASHBOOK PER-USER FILTERING TEST")
    print("=" * 80)
    print()
    
    test_entries = {}
    
    try:
        # TEST 1: Login as AKUNTAN and create an entry
        print("TEST 1: Login as AKUNTAN and create a cashbook entry")
        print("-" * 80)
        session_akuntan = login("akuntan")
        akuntan_entry_id = create_cashbook_entry(session_akuntan, "akuntan", 150000, "Test akuntan entry - cashbook filtering")
        test_entries["akuntan"] = akuntan_entry_id
        print()
        
        # TEST 2: Login as ADMIN and create an entry
        print("TEST 2: Login as ADMIN and create a cashbook entry")
        print("-" * 80)
        session_admin = login("admin")
        admin_entry_id = create_cashbook_entry(session_admin, "admin", 125000, "Test admin entry - cashbook filtering")
        test_entries["admin"] = admin_entry_id
        print()
        
        # TEST 3: GET cashbook as ADMIN - MUST return admin's own entry, NOT akuntan's
        print("TEST 3: GET /api/accounting/cashbook as ADMIN")
        print("-" * 80)
        admin_entries = get_cashbook_entries(session_admin, "admin")
        
        # Verify admin sees their own entry
        admin_entry_found = any(e.get("id") == admin_entry_id for e in admin_entries)
        if not admin_entry_found:
            print(f"❌ FAIL: Admin's own entry {admin_entry_id} NOT found in list")
            raise Exception("Admin cannot see their own entry - CRITICAL BUG")
        print(f"✓ Admin's own entry {admin_entry_id} found in list")
        
        # Verify admin does NOT see akuntan's entry
        akuntan_entry_found = any(e.get("id") == akuntan_entry_id for e in admin_entries)
        if akuntan_entry_found:
            print(f"❌ FAIL: Akuntan's entry {akuntan_entry_id} SHOULD NOT be visible to admin")
            raise Exception("Admin can see akuntan's entry - FILTERING NOT WORKING")
        print(f"✓ Akuntan's entry {akuntan_entry_id} correctly NOT visible to admin")
        
        # Verify created_by field is populated
        if admin_entries:
            sample = admin_entries[0]
            has_created_by = "createdBy" in sample or "created_by" in sample
            if not has_created_by:
                print(f"❌ FAIL: created_by field is MISSING in response")
                print(f"Sample entry keys: {list(sample.keys())}")
                raise Exception("created_by field missing - BUG NOT FIXED")
            print(f"✓ created_by field is populated in response")
            print(f"  Sample entry: createdBy={sample.get('createdBy')}, created_by={sample.get('created_by')}")
        
        # Verify list is NOT empty (the original bug)
        if len(admin_entries) == 0:
            print(f"❌ FAIL: Admin got EMPTY list - ORIGINAL BUG STILL EXISTS")
            raise Exception("Admin got empty list - created_by field likely missing")
        print(f"✓ Admin got {len(admin_entries)} entries (NOT empty - bug fixed)")
        print()
        
        # TEST 4: GET cashbook as AKUNTAN - MUST return ALL entries (both admin and akuntan)
        print("TEST 4: GET /api/accounting/cashbook as AKUNTAN")
        print("-" * 80)
        akuntan_entries = get_cashbook_entries(session_akuntan, "akuntan")
        
        # Verify akuntan sees their own entry
        akuntan_own_found = any(e.get("id") == akuntan_entry_id for e in akuntan_entries)
        if not akuntan_own_found:
            print(f"❌ FAIL: Akuntan's own entry {akuntan_entry_id} NOT found in list")
            raise Exception("Akuntan cannot see their own entry")
        print(f"✓ Akuntan's own entry {akuntan_entry_id} found in list")
        
        # Verify akuntan sees admin's entry (FULL ACCESS)
        admin_entry_in_akuntan = any(e.get("id") == admin_entry_id for e in akuntan_entries)
        if not admin_entry_in_akuntan:
            print(f"❌ FAIL: Admin's entry {admin_entry_id} NOT visible to akuntan")
            raise Exception("Akuntan cannot see admin's entry - FULL ACCESS NOT WORKING")
        print(f"✓ Admin's entry {admin_entry_id} correctly visible to akuntan (FULL ACCESS)")
        
        print(f"✓ Akuntan got {len(akuntan_entries)} entries (includes ALL entries from everyone)")
        print()
        
        # TEST 5: Regression - SUPERVISOR (same as admin, should only see own entries)
        print("TEST 5: Regression - SUPERVISOR filtering")
        print("-" * 80)
        session_supervisor = login("supervisor")
        supervisor_entries = get_cashbook_entries(session_supervisor, "supervisor")
        
        # Supervisor should NOT see admin or akuntan entries
        admin_in_supervisor = any(e.get("id") == admin_entry_id for e in supervisor_entries)
        akuntan_in_supervisor = any(e.get("id") == akuntan_entry_id for e in supervisor_entries)
        
        if admin_in_supervisor or akuntan_in_supervisor:
            print(f"❌ FAIL: Supervisor can see other users' entries")
            raise Exception("Supervisor filtering not working")
        print(f"✓ Supervisor correctly sees only their own entries (0 test entries visible)")
        print()
        
        # TEST 6: Regression - DIREKTUR (same as akuntan, should see ALL entries)
        print("TEST 6: Regression - DIREKTUR filtering")
        print("-" * 80)
        session_direktur = login("direktur")
        direktur_entries = get_cashbook_entries(session_direktur, "direktur")
        
        # Direktur should see both admin and akuntan entries
        admin_in_direktur = any(e.get("id") == admin_entry_id for e in direktur_entries)
        akuntan_in_direktur = any(e.get("id") == akuntan_entry_id for e in direktur_entries)
        
        if not admin_in_direktur or not akuntan_in_direktur:
            print(f"❌ FAIL: Direktur cannot see all entries")
            raise Exception("Direktur FULL ACCESS not working")
        print(f"✓ Direktur correctly sees ALL entries (both admin and akuntan entries visible)")
        print()
        
        # CLEANUP: Delete test entries (only akuntan/direktur can delete)
        print("CLEANUP: Deleting test entries")
        print("-" * 80)
        delete_cashbook_entry(session_akuntan, "akuntan", akuntan_entry_id)
        delete_cashbook_entry(session_akuntan, "akuntan", admin_entry_id)
        print()
        
        # FINAL VERIFICATION: Verify entries are deleted
        print("FINAL VERIFICATION: Verify entries are deleted")
        print("-" * 80)
        final_akuntan_entries = get_cashbook_entries(session_akuntan, "akuntan")
        akuntan_still_exists = any(e.get("id") == akuntan_entry_id for e in final_akuntan_entries)
        admin_still_exists = any(e.get("id") == admin_entry_id for e in final_akuntan_entries)
        
        if akuntan_still_exists or admin_still_exists:
            print(f"⚠️  WARNING: Test entries still exist after deletion")
        else:
            print(f"✓ All test entries successfully deleted")
        print()
        
        # SUCCESS
        print("=" * 80)
        print("✅ ALL TESTS PASSED")
        print("=" * 80)
        print()
        print("SUMMARY:")
        print("  ✓ Admin sees ONLY their own entries (NOT empty)")
        print("  ✓ Akuntan sees ALL entries (from everyone)")
        print("  ✓ Supervisor sees ONLY their own entries")
        print("  ✓ Direktur sees ALL entries (from everyone)")
        print("  ✓ created_by field is populated in API response")
        print("  ✓ Empty list bug is FIXED")
        print()
        
    except Exception as e:
        print()
        print("=" * 80)
        print("❌ TEST FAILED")
        print("=" * 80)
        print(f"Error: {e}")
        print()
        
        # Attempt cleanup on failure
        print("Attempting cleanup...")
        try:
            session_cleanup = login("akuntan")
            for role, entry_id in test_entries.items():
                try:
                    delete_cashbook_entry(session_cleanup, "akuntan", entry_id)
                except:
                    pass
        except:
            print("⚠️  Cleanup failed - manual cleanup may be required")
        
        raise

if __name__ == "__main__":
    main()
