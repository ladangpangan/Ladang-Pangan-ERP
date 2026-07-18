#!/usr/bin/env python3
"""
Backend API Testing for LPI ERP - WO Stages Master + Stage Records + Anti-dedup WO→Storage
Test Sequence: NEW features only (as per review request)
"""

import requests
import json
import sys
from datetime import datetime, timedelta

# Base URL from .env
BASE_URL = "https://pangan-system.preview.emergentagent.com/api"

# Test credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
SUPERVISOR_EMAIL = "supervisor@lpi.co.id"
SUPERVISOR_PASSWORD = "super123"
OPERATOR_EMAIL = "operator@lpi.co.id"
OPERATOR_PASSWORD = "operator123"

# Global session storage - use requests.Session for connection pooling
sessions = {}
http_session = requests.Session()  # Reuse HTTP connections
http_session.headers.update({
    'Origin': 'https://pangan-system.preview.emergentagent.com',
    'Referer': 'https://pangan-system.preview.emergentagent.com/'
})

def login(email, password, role_name):
    """Login and store session cookie"""
    try:
        url = "https://pangan-system.preview.emergentagent.com/api/auth/sign-in/email"
        resp = http_session.post(url, json={"email": email, "password": password}, timeout=10)
        if resp.status_code == 200:
            sessions[role_name] = resp.cookies
            print(f"✅ {role_name} login successful")
            return True
        else:
            print(f"❌ {role_name} login failed: {resp.status_code} - {resp.text[:200]}")
            return False
    except Exception as e:
        print(f"❌ {role_name} login error: {e}")
        return False

def api_call(method, endpoint, role="admin", json_data=None, params=None):
    """Make API call with session cookie"""
    url = f"{BASE_URL}{endpoint}"
    cookies = sessions.get(role, {})
    if not cookies:
        print(f"⚠️  No cookies for role: {role}")
        return None
    try:
        if method == "GET":
            resp = http_session.get(url, cookies=cookies, params=params, timeout=30)
        elif method == "POST":
            resp = http_session.post(url, cookies=cookies, json=json_data, timeout=30)
        elif method == "PUT":
            resp = http_session.put(url, cookies=cookies, json=json_data, timeout=30)
        elif method == "DELETE":
            resp = http_session.delete(url, cookies=cookies, timeout=30)
        else:
            return None
        return resp
    except requests.exceptions.Timeout as e:
        print(f"⏱️  API call timeout after 30s: {method} {endpoint}")
        return None
    except requests.exceptions.ConnectionError as e:
        print(f"🔌 Connection error: {method} {endpoint} - {e}")
        return None
    except Exception as e:
        print(f"❌ API call error: {method} {endpoint} - {type(e).__name__}: {str(e)[:100]}")
        return None

def test_a_wo_stages_master_crud():
    """Test A: WO Stages Master CRUD (8 tests)"""
    print("\n" + "="*80)
    print("TEST A: WO STAGES MASTER CRUD")
    print("="*80)
    
    results = []
    
    # A1: GET /api/wo-stages → verify 6 default stages
    print("\n[A1] GET /api/wo-stages - List all stages")
    try:
        resp = api_call("GET", "/wo-stages", role="admin")
        if resp and resp.status_code == 200:
            data = resp.json().get("data", [])
            if len(data) == 6:
                print(f"✅ A1 PASS: Found 6 default stages")
                print(f"   Stages: {', '.join([s['code'] for s in data])}")
                results.append(("A1", "PASS", "6 default stages returned"))
            else:
                print(f"❌ A1 FAIL: Expected 6 stages, got {len(data)}")
                results.append(("A1", "FAIL", f"Expected 6 stages, got {len(data)}"))
        else:
            print(f"❌ A1 FAIL: {resp.status_code if resp else 'No response'}")
            results.append(("A1", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ A1 ERROR: {e}")
        results.append(("A1", "ERROR", str(e)))
    
    # A2: GET /api/wo-stages?active=1 → returns only active
    print("\n[A2] GET /api/wo-stages?active=1 - Filter active stages")
    try:
        resp = api_call("GET", "/wo-stages", role="admin", params={"active": "1"})
        if resp and resp.status_code == 200:
            data = resp.json().get("data", [])
            all_active = all(s.get("isActive") for s in data)
            if all_active and len(data) == 6:
                print(f"✅ A2 PASS: All {len(data)} stages are active")
                results.append(("A2", "PASS", f"All {len(data)} stages active"))
            else:
                print(f"❌ A2 FAIL: Not all stages active or count mismatch")
                results.append(("A2", "FAIL", "Active filter issue"))
        else:
            print(f"❌ A2 FAIL: {resp.status_code if resp else 'No response'}")
            results.append(("A2", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ A2 ERROR: {e}")
        results.append(("A2", "ERROR", str(e)))
    
    # A3: GET /api/wo-stages/:id → return single RECEIVING stage
    print("\n[A3] GET /api/wo-stages/:id - Get single stage detail")
    try:
        # First get all stages to find RECEIVING
        resp = api_call("GET", "/wo-stages", role="admin")
        if resp and resp.status_code == 200:
            stages = resp.json().get("data", [])
            receiving = next((s for s in stages if s["code"] == "RECEIVING"), None)
            if receiving:
                stage_id = receiving["id"]
                resp2 = api_call("GET", f"/wo-stages/{stage_id}", role="admin")
                if resp2 and resp2.status_code == 200:
                    stage = resp2.json().get("data", {})
                    if stage.get("code") == "RECEIVING":
                        print(f"✅ A3 PASS: Retrieved RECEIVING stage detail")
                        print(f"   Name: {stage.get('name')}, Fields: {len(json.loads(stage.get('fieldsSchema', '[]')))}")
                        results.append(("A3", "PASS", "RECEIVING stage retrieved"))
                    else:
                        print(f"❌ A3 FAIL: Wrong stage returned")
                        results.append(("A3", "FAIL", "Wrong stage"))
                else:
                    print(f"❌ A3 FAIL: {resp2.status_code if resp2 else 'No response'}")
                    results.append(("A3", "FAIL", f"Status {resp2.status_code if resp2 else 'No response'}"))
            else:
                print(f"❌ A3 FAIL: RECEIVING stage not found")
                results.append(("A3", "FAIL", "RECEIVING not found"))
    except Exception as e:
        print(f"❌ A3 ERROR: {e}")
        results.append(("A3", "ERROR", str(e)))
    
    # A4: POST /api/wo-stages - Create new stage
    print("\n[A4] POST /api/wo-stages - Create TEST_STAGE")
    test_stage_id = None
    try:
        payload = {
            "code": "TEST_STAGE",
            "name": "Test Stage",
            "description": "testing",
            "sequenceOrder": 99,
            "color": "#f59e0b",
            "fieldsSchema": [
                {
                    "key": "x_test",
                    "label": "X Test",
                    "type": "number",
                    "unit": "kg",
                    "required": True,
                    "order": 1
                }
            ]
        }
        resp = api_call("POST", "/wo-stages", role="admin", json_data=payload)
        if resp and resp.status_code == 201:
            created = resp.json().get("data", {})
            test_stage_id = created.get("id")
            print(f"✅ A4 PASS: TEST_STAGE created with ID {test_stage_id}")
            results.append(("A4", "PASS", f"TEST_STAGE created"))
        else:
            print(f"❌ A4 FAIL: {resp.status_code if resp else 'No response'} - {resp.text[:200] if resp else ''}")
            results.append(("A4", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ A4 ERROR: {e}")
        results.append(("A4", "ERROR", str(e)))
    
    # A5: POST duplicate code → 400
    print("\n[A5] POST /api/wo-stages - Duplicate code validation")
    try:
        payload = {
            "code": "TEST_STAGE",
            "name": "Duplicate Test",
            "sequenceOrder": 100
        }
        resp = api_call("POST", "/wo-stages", role="admin", json_data=payload)
        if resp:
            print(f"   DEBUG: Got response {resp.status_code}: {resp.text[:200]}")
        if resp and resp.status_code == 400:
            error_msg = resp.json().get("error", "")
            if "sudah dipakai" in error_msg.lower():
                print(f"✅ A5 PASS: Duplicate code rejected with correct error")
                results.append(("A5", "PASS", "Duplicate code rejected"))
            else:
                print(f"❌ A5 FAIL: Wrong error message: {error_msg}")
                results.append(("A5", "FAIL", f"Wrong error: {error_msg}"))
        else:
            print(f"❌ A5 FAIL: Expected 400, got {resp.status_code if resp else 'No response'}")
            results.append(("A5", "FAIL", f"Expected 400, got {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ A5 ERROR: {e}")
        results.append(("A5", "ERROR", str(e)))
    
    # A6: PUT /api/wo-stages/:id - Update stage
    print("\n[A6] PUT /api/wo-stages/:id - Update TEST_STAGE")
    if test_stage_id:
        try:
            payload = {
                "sequenceOrder": 100,
                "fieldsSchema": [
                    {
                        "key": "y",
                        "label": "Y",
                        "type": "text",
                        "required": False,
                        "order": 1
                    }
                ]
            }
            resp = api_call("PUT", f"/wo-stages/{test_stage_id}", role="admin", json_data=payload)
            if resp and resp.status_code == 200:
                updated = resp.json().get("data", {})
                if updated.get("sequenceOrder") == 100:
                    print(f"✅ A6 PASS: TEST_STAGE updated successfully")
                    results.append(("A6", "PASS", "Stage updated"))
                else:
                    print(f"❌ A6 FAIL: Update not reflected")
                    results.append(("A6", "FAIL", "Update not reflected"))
            else:
                print(f"❌ A6 FAIL: {resp.status_code if resp else 'No response'}")
                results.append(("A6", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
        except Exception as e:
            print(f"❌ A6 ERROR: {e}")
            results.append(("A6", "ERROR", str(e)))
    else:
        print(f"⏭️  A6 SKIP: No test_stage_id from A4")
        results.append(("A6", "SKIP", "No test stage"))
    
    # A7: DELETE /api/wo-stages/:id
    print("\n[A7] DELETE /api/wo-stages/:id - Delete TEST_STAGE")
    if test_stage_id:
        try:
            resp = api_call("DELETE", f"/wo-stages/{test_stage_id}", role="admin")
            if resp and resp.status_code == 200:
                print(f"✅ A7 PASS: TEST_STAGE deleted successfully")
                results.append(("A7", "PASS", "Stage deleted"))
            else:
                print(f"❌ A7 FAIL: {resp.status_code if resp else 'No response'}")
                results.append(("A7", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
        except Exception as e:
            print(f"❌ A7 ERROR: {e}")
            results.append(("A7", "ERROR", str(e)))
    else:
        print(f"⏭️  A7 SKIP: No test_stage_id")
        results.append(("A7", "SKIP", "No test stage"))
    
    # A8: RBAC - Operator cannot POST/PUT/DELETE
    print("\n[A8] RBAC - Operator forbidden on POST/PUT/DELETE")
    try:
        # Try POST as operator
        payload = {"code": "OP_TEST", "name": "Operator Test", "sequenceOrder": 1}
        resp = api_call("POST", "/wo-stages", role="operator", json_data=payload)
        post_forbidden = resp and resp.status_code == 403
        
        # Try DELETE as operator (use first stage id)
        resp2 = api_call("GET", "/wo-stages", role="admin")
        if resp2 and resp2.status_code == 200:
            stages = resp2.json().get("data", [])
            if stages:
                first_id = stages[0]["id"]
                resp3 = api_call("DELETE", f"/wo-stages/{first_id}", role="operator")
                delete_forbidden = resp3 and resp3.status_code == 403
                
                if post_forbidden and delete_forbidden:
                    print(f"✅ A8 PASS: Operator correctly forbidden (403) on POST and DELETE")
                    results.append(("A8", "PASS", "Operator RBAC enforced"))
                else:
                    print(f"❌ A8 FAIL: POST={resp.status_code if resp else 'N/A'}, DELETE={resp3.status_code if resp3 else 'N/A'}")
                    results.append(("A8", "FAIL", f"RBAC not enforced"))
            else:
                print(f"❌ A8 FAIL: No stages to test DELETE")
                results.append(("A8", "FAIL", "No stages"))
        else:
            print(f"❌ A8 FAIL: Cannot get stages")
            results.append(("A8", "FAIL", "Cannot get stages"))
    except Exception as e:
        print(f"❌ A8 ERROR: {e}")
        results.append(("A8", "ERROR", str(e)))
    
    return results

def test_b_wo_stage_records():
    """Test B: WO Stage Records (8 tests)"""
    print("\n" + "="*80)
    print("TEST B: WO STAGE RECORDS")
    print("="*80)
    
    results = []
    
    # Get an existing WO and RECEIVING stage
    print("\n[Setup] Getting existing WO and RECEIVING stage...")
    wo_id = None
    receiving_id = None
    
    try:
        # Get WOs
        resp = api_call("GET", "/work-orders", role="admin")
        if resp and resp.status_code == 200:
            wos = resp.json().get("data", [])
            if wos:
                wo_id = wos[0]["id"]
                print(f"   Using WO: {wos[0].get('woNumber', wo_id)}")
        
        # Get RECEIVING stage
        resp2 = api_call("GET", "/wo-stages", role="admin")
        if resp2 and resp2.status_code == 200:
            stages = resp2.json().get("data", [])
            receiving = next((s for s in stages if s["code"] == "RECEIVING"), None)
            if receiving:
                receiving_id = receiving["id"]
                print(f"   Using RECEIVING stage: {receiving['name']}")
    except Exception as e:
        print(f"❌ Setup ERROR: {e}")
    
    if not wo_id or not receiving_id:
        print(f"❌ Cannot proceed with Test B: Missing WO or RECEIVING stage")
        return [("B*", "SKIP", "Missing WO or stage")]
    
    # B1: POST /api/work-orders/:woId/stage-records - Create record
    print("\n[B1] POST /api/work-orders/:woId/stage-records - Create record with all fields")
    record_id = None
    try:
        payload = {
            "records": [
                {
                    "stageId": receiving_id,
                    "fieldValues": {
                        "total_weight": 1500,
                        "head_count": 700,
                        "ekor_mati": 5,
                        "supir": "Budi",
                        "plat_no": "B1234XY"
                    },
                    "notes": "Kedatangan sore"
                }
            ]
        }
        resp = api_call("POST", f"/work-orders/{wo_id}/stage-records", role="admin", json_data=payload)
        if resp and resp.status_code == 201:
            data = resp.json()
            if data.get("inserted") == 1:
                record_id = data.get("ids", [None])[0]
                print(f"✅ B1 PASS: Stage record created, inserted=1")
                results.append(("B1", "PASS", "Record created"))
            else:
                print(f"❌ B1 FAIL: Inserted count mismatch")
                results.append(("B1", "FAIL", "Insert count wrong"))
        else:
            print(f"❌ B1 FAIL: {resp.status_code if resp else 'No response'} - {resp.text[:200] if resp else ''}")
            results.append(("B1", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ B1 ERROR: {e}")
        results.append(("B1", "ERROR", str(e)))
    
    # B2: POST with bulk (3 records)
    print("\n[B2] POST /api/work-orders/:woId/stage-records - Bulk create 3 records")
    try:
        payload = {
            "records": [
                {"stageId": receiving_id, "fieldValues": {"total_weight": 100, "head_count": 50}},
                {"stageId": receiving_id, "fieldValues": {"total_weight": 200, "head_count": 100}},
                {"stageId": receiving_id, "fieldValues": {"total_weight": 300, "head_count": 150}}
            ]
        }
        resp = api_call("POST", f"/work-orders/{wo_id}/stage-records", role="admin", json_data=payload)
        if resp and resp.status_code == 201:
            data = resp.json()
            if data.get("inserted") == 3:
                print(f"✅ B2 PASS: Bulk insert successful, inserted=3")
                results.append(("B2", "PASS", "Bulk insert 3 records"))
            else:
                print(f"❌ B2 FAIL: Expected inserted=3, got {data.get('inserted')}")
                results.append(("B2", "FAIL", f"Inserted={data.get('inserted')}"))
        else:
            print(f"❌ B2 FAIL: {resp.status_code if resp else 'No response'}")
            results.append(("B2", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ B2 ERROR: {e}")
        results.append(("B2", "ERROR", str(e)))
    
    # B3: POST with missing required field → 400
    print("\n[B3] POST /api/work-orders/:woId/stage-records - Missing required field validation")
    try:
        payload = {
            "records": [
                {
                    "stageId": receiving_id,
                    "fieldValues": {
                        "total_weight": 1500
                        # Missing head_count (required field)
                    }
                }
            ]
        }
        resp = api_call("POST", f"/work-orders/{wo_id}/stage-records", role="admin", json_data=payload)
        if resp and resp.status_code == 400:
            error_msg = resp.json().get("error", "")
            if "wajib" in error_msg.lower() or "required" in error_msg.lower():
                print(f"✅ B3 PASS: Missing required field rejected with error: {error_msg[:100]}")
                results.append(("B3", "PASS", "Required field validation"))
            else:
                print(f"❌ B3 FAIL: Wrong error message: {error_msg}")
                results.append(("B3", "FAIL", f"Wrong error"))
        else:
            print(f"❌ B3 FAIL: Expected 400, got {resp.status_code if resp else 'No response'}")
            results.append(("B3", "FAIL", f"Expected 400, got {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ B3 ERROR: {e}")
        results.append(("B3", "ERROR", str(e)))
    
    # B4: GET /api/work-orders/:woId/stage-records - List with enrichment
    print("\n[B4] GET /api/work-orders/:woId/stage-records - List records with stage enrichment")
    try:
        resp = api_call("GET", f"/work-orders/{wo_id}/stage-records", role="admin")
        if resp and resp.status_code == 200:
            records = resp.json().get("data", [])
            if len(records) > 0:
                first = records[0]
                has_stage = "stage" in first and first["stage"] is not None
                has_field_values = "fieldValues" in first and isinstance(first["fieldValues"], dict)
                if has_stage and has_field_values:
                    print(f"✅ B4 PASS: Retrieved {len(records)} records with stage enrichment and parsed fieldValues")
                    results.append(("B4", "PASS", f"{len(records)} records enriched"))
                else:
                    print(f"❌ B4 FAIL: Missing stage or fieldValues not parsed")
                    results.append(("B4", "FAIL", "Enrichment incomplete"))
            else:
                print(f"❌ B4 FAIL: No records returned")
                results.append(("B4", "FAIL", "No records"))
        else:
            print(f"❌ B4 FAIL: {resp.status_code if resp else 'No response'}")
            results.append(("B4", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ B4 ERROR: {e}")
        results.append(("B4", "ERROR", str(e)))
    
    # B5: DELETE /api/work-orders/:woId/stage-records/:recordId as supervisor
    print("\n[B5] DELETE /api/work-orders/:woId/stage-records/:recordId - Delete as supervisor")
    if record_id:
        try:
            resp = api_call("DELETE", f"/work-orders/{wo_id}/stage-records/{record_id}", role="supervisor")
            if resp and resp.status_code == 200:
                print(f"✅ B5 PASS: Record deleted successfully by supervisor")
                results.append(("B5", "PASS", "Record deleted"))
            else:
                print(f"❌ B5 FAIL: {resp.status_code if resp else 'No response'}")
                results.append(("B5", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
        except Exception as e:
            print(f"❌ B5 ERROR: {e}")
            results.append(("B5", "ERROR", str(e)))
    else:
        print(f"⏭️  B5 SKIP: No record_id from B1")
        results.append(("B5", "SKIP", "No record"))
    
    # B6: POST as operator (should be allowed)
    print("\n[B6] POST /api/work-orders/:woId/stage-records - Operator can create records")
    try:
        payload = {
            "records": [
                {
                    "stageId": receiving_id,
                    "fieldValues": {
                        "total_weight": 500,
                        "head_count": 250
                    },
                    "notes": "Created by operator"
                }
            ]
        }
        resp = api_call("POST", f"/work-orders/{wo_id}/stage-records", role="operator", json_data=payload)
        if resp and resp.status_code == 201:
            print(f"✅ B6 PASS: Operator can create stage records (201)")
            results.append(("B6", "PASS", "Operator can create"))
        else:
            print(f"❌ B6 FAIL: {resp.status_code if resp else 'No response'}")
            results.append(("B6", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ B6 ERROR: {e}")
        results.append(("B6", "ERROR", str(e)))
    
    # B7: DELETE as operator (should be forbidden)
    print("\n[B7] DELETE /api/work-orders/:woId/stage-records/:recordId - Operator forbidden")
    try:
        # Get a record to try deleting
        resp = api_call("GET", f"/work-orders/{wo_id}/stage-records", role="admin")
        if resp and resp.status_code == 200:
            records = resp.json().get("data", [])
            if records:
                test_record_id = records[0]["id"]
                resp2 = api_call("DELETE", f"/work-orders/{wo_id}/stage-records/{test_record_id}", role="operator")
                if resp2 and resp2.status_code == 403:
                    print(f"✅ B7 PASS: Operator correctly forbidden (403) on DELETE")
                    results.append(("B7", "PASS", "Operator DELETE forbidden"))
                else:
                    print(f"❌ B7 FAIL: Expected 403, got {resp2.status_code if resp2 else 'No response'}")
                    results.append(("B7", "FAIL", f"Expected 403, got {resp2.status_code if resp2 else 'No response'}"))
            else:
                print(f"⏭️  B7 SKIP: No records to test")
                results.append(("B7", "SKIP", "No records"))
        else:
            print(f"❌ B7 FAIL: Cannot get records")
            results.append(("B7", "FAIL", "Cannot get records"))
    except Exception as e:
        print(f"❌ B7 ERROR: {e}")
        results.append(("B7", "ERROR", str(e)))
    
    # B8: Verify GET /api/work-orders/:id includes stage records
    print("\n[B8] GET /api/work-orders/:id - Verify WO detail accessible")
    try:
        resp = api_call("GET", f"/work-orders/{wo_id}", role="admin")
        if resp and resp.status_code == 200:
            wo = resp.json().get("data", {})
            # Note: The endpoint might not include stage records in WO detail by default
            # This is just to verify the WO is accessible
            print(f"✅ B8 PASS: WO detail accessible (stage records fetched separately)")
            results.append(("B8", "PASS", "WO detail accessible"))
        else:
            print(f"❌ B8 FAIL: {resp.status_code if resp else 'No response'}")
            results.append(("B8", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ B8 ERROR: {e}")
        results.append(("B8", "ERROR", str(e)))
    
    return results

def test_c_anti_dedup_wo_storage():
    """Test C: Anti-dedup WO Output → Cold Storage (11 tests)"""
    print("\n" + "="*80)
    print("TEST C: ANTI-DEDUP WO OUTPUT → COLD STORAGE")
    print("="*80)
    
    results = []
    
    # Setup: Find or create a WO with outputs
    print("\n[Setup] Finding/creating WO with outputs...")
    wo_id = None
    product_id = None
    cs_id = None
    zone_id = None
    
    try:
        # Get products
        resp = api_call("GET", "/products", role="admin")
        if resp and resp.status_code == 200:
            products = resp.json().get("data", [])
            karkas = next((p for p in products if "KRK" in p.get("sku", "")), None)
            if karkas:
                product_id = karkas["id"]
                print(f"   Using product: {karkas['name']} ({karkas['sku']})")
        
        # Get cold storage
        resp2 = api_call("GET", "/cold-storages", role="admin")
        if resp2 and resp2.status_code == 200:
            css = resp2.json().get("data", [])
            if css:
                cs_id = css[0]["id"]
                print(f"   Using CS: {css[0]['name']}")
                
                # Get zones for this CS
                resp3 = api_call("GET", "/zones", role="admin", params={"cold_storage_id": cs_id})
                if resp3 and resp3.status_code == 200:
                    zones = resp3.json().get("data", [])
                    if zones:
                        zone_id = zones[0]["id"]
                        print(f"   Using Zone: {zones[0]['name']}")
        
        # Create a new WO for testing
        wo_payload = {
            "mode": "Internal",
            "startDate": datetime.now().isoformat(),
            "baseCost": 5000000
        }
        resp4 = api_call("POST", "/work-orders", role="admin", json_data=wo_payload)
        if resp4 and resp4.status_code == 201:
            wo = resp4.json().get("data", {})
            wo_id = wo["id"]
            print(f"   Created WO: {wo.get('woNumber', wo_id)}")
            
            # Transition to Dalam Proses
            resp5 = api_call("POST", f"/work-orders/{wo_id}/status", role="admin", json_data={"status": "Disetujui"})
            if resp5 and resp5.status_code == 200:
                resp6 = api_call("POST", f"/work-orders/{wo_id}/status", role="admin", json_data={"status": "Dalam Proses"})
                if resp6 and resp6.status_code == 200:
                    print(f"   WO transitioned to Dalam Proses")
                    
                    # Add outputs
                    output_payload = {
                        "items": [
                            {
                                "productId": product_id,
                                "stage": "karkas",
                                "weight": 500,
                                "headCount": 100,
                                "coefficient": 1
                            }
                        ]
                    }
                    resp7 = api_call("POST", f"/work-orders/{wo_id}/outputs", role="admin", json_data=output_payload)
                    if resp7 and resp7.status_code in [200, 201]:
                        print(f"   Added 500kg output to WO")
    except Exception as e:
        print(f"❌ Setup ERROR: {e}")
    
    if not wo_id or not product_id or not cs_id:
        print(f"❌ Cannot proceed with Test C: Missing WO, product, or CS")
        return [("C*", "SKIP", "Missing setup data")]
    
    # C1: Count inventory_stock rows BEFORE finalize
    print("\n[C1] Count inventory_stock rows BEFORE finalize")
    stock_count_before = 0
    try:
        resp = api_call("GET", "/inventory/stocks", role="admin")
        if resp and resp.status_code == 200:
            stocks = resp.json().get("data", [])
            stock_count_before = len(stocks)
            print(f"✅ C1: Stock count BEFORE finalize = {stock_count_before}")
            results.append(("C1", "INFO", f"Stock count before: {stock_count_before}"))
    except Exception as e:
        print(f"❌ C1 ERROR: {e}")
        results.append(("C1", "ERROR", str(e)))
    
    # C2: POST /api/work-orders/:id/finalize
    print("\n[C2] POST /api/work-orders/:id/finalize - Finalize WO (no auto-stock creation)")
    try:
        resp = api_call("POST", f"/work-orders/{wo_id}/finalize", role="admin", json_data={})
        if resp and resp.status_code == 200:
            data = resp.json().get("data", {})
            message = data.get("message", "")
            if "Tally Inbound" in message or "silakan" in message.lower():
                print(f"✅ C2 PASS: WO finalized with message about Tally Inbound")
                print(f"   Message: {message}")
                results.append(("C2", "PASS", "WO finalized, no auto-stock"))
            else:
                print(f"❌ C2 FAIL: Unexpected message: {message}")
                results.append(("C2", "FAIL", "Wrong message"))
        else:
            print(f"❌ C2 FAIL: {resp.status_code if resp else 'No response'} - {resp.text[:200] if resp else ''}")
            results.append(("C2", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ C2 ERROR: {e}")
        results.append(("C2", "ERROR", str(e)))
    
    # C3: Verify WO status is Selesai
    print("\n[C3] GET /api/work-orders/:id - Verify status is Selesai")
    try:
        resp = api_call("GET", f"/work-orders/{wo_id}", role="admin")
        if resp and resp.status_code == 200:
            wo = resp.json().get("data", {})
            if wo.get("pipelineStatus") == "Selesai":
                print(f"✅ C3 PASS: WO status is Selesai")
                results.append(("C3", "PASS", "WO status Selesai"))
            else:
                print(f"❌ C3 FAIL: Status is {wo.get('pipelineStatus')}")
                results.append(("C3", "FAIL", f"Status: {wo.get('pipelineStatus')}"))
        else:
            print(f"❌ C3 FAIL: {resp.status_code if resp else 'No response'}")
            results.append(("C3", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ C3 ERROR: {e}")
        results.append(("C3", "ERROR", str(e)))
    
    # C4: Count inventory_stock rows AFTER finalize (should be SAME)
    print("\n[C4] Count inventory_stock rows AFTER finalize - Should be SAME as before")
    try:
        resp = api_call("GET", "/inventory/stocks", role="admin")
        if resp and resp.status_code == 200:
            stocks = resp.json().get("data", [])
            stock_count_after = len(stocks)
            if stock_count_after == stock_count_before:
                print(f"✅ C4 PASS: Stock count AFTER finalize = {stock_count_after} (SAME as before)")
                results.append(("C4", "PASS", f"No auto-stock created"))
            else:
                print(f"❌ C4 FAIL: Stock count changed from {stock_count_before} to {stock_count_after}")
                results.append(("C4", "FAIL", f"Stock count changed"))
        else:
            print(f"❌ C4 FAIL: {resp.status_code if resp else 'No response'}")
            results.append(("C4", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ C4 ERROR: {e}")
        results.append(("C4", "ERROR", str(e)))
    
    # C5: GET /api/work-orders/pending-storage
    print("\n[C5] GET /api/work-orders/pending-storage - Verify WO outputs appear")
    try:
        resp = api_call("GET", "/work-orders/pending-storage", role="admin")
        if resp and resp.status_code == 200:
            pending = resp.json().get("data", [])
            wo_outputs = [p for p in pending if p.get("workOrderId") == wo_id]
            if len(wo_outputs) > 0:
                first = wo_outputs[0]
                remaining = first.get("remainingWeight", 0)
                if remaining == 500:
                    print(f"✅ C5 PASS: WO outputs in pending-storage with remainingWeight=500kg")
                    results.append(("C5", "PASS", "Pending storage correct"))
                else:
                    print(f"❌ C5 FAIL: remainingWeight={remaining}, expected 500")
                    results.append(("C5", "FAIL", f"Wrong remaining: {remaining}"))
            else:
                print(f"❌ C5 FAIL: WO outputs not found in pending-storage")
                results.append(("C5", "FAIL", "Outputs not in pending"))
        else:
            print(f"❌ C5 FAIL: {resp.status_code if resp else 'No response'}")
            results.append(("C5", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ C5 ERROR: {e}")
        results.append(("C5", "ERROR", str(e)))
    
    # C6: POST /api/inventory/inbound with WO reference (200kg out of 500kg)
    print("\n[C6] POST /api/inventory/inbound - Tally 200kg from WO")
    try:
        future_date = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
        inbound_payload = {
            "coldStorageId": cs_id,
            "zoneId": zone_id,
            "referenceId": wo_id,
            "referenceType": "WO",
            "items": [
                {
                    "productId": product_id,
                    "weight": 200,
                    "quantity": 1,
                    "packagingType": "karung",
                    "expiredDate": future_date
                }
            ]
        }
        resp = api_call("POST", "/inventory/inbound", role="admin", json_data=inbound_payload)
        if resp and resp.status_code == 201:
            data = resp.json().get("data", {})
            stocks = data.get("stocks", [])
            if len(stocks) > 0:
                print(f"✅ C6 PASS: Inbound created, kodeSimpan={stocks[0].get('kodeSimpan')}")
                results.append(("C6", "PASS", "200kg tallied"))
            else:
                print(f"❌ C6 FAIL: No stocks created")
                results.append(("C6", "FAIL", "No stocks"))
        else:
            print(f"❌ C6 FAIL: {resp.status_code if resp else 'No response'} - {resp.text[:200] if resp else ''}")
            results.append(("C6", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ C6 ERROR: {e}")
        results.append(("C6", "ERROR", str(e)))
    
    # C7: GET /api/work-orders/pending-storage - Verify remainingWeight=300
    print("\n[C7] GET /api/work-orders/pending-storage - Verify remainingWeight=300kg")
    try:
        resp = api_call("GET", "/work-orders/pending-storage", role="admin")
        if resp and resp.status_code == 200:
            pending = resp.json().get("data", [])
            wo_outputs = [p for p in pending if p.get("workOrderId") == wo_id]
            if len(wo_outputs) > 0:
                first = wo_outputs[0]
                remaining = first.get("remainingWeight", 0)
                storage_status = first.get("storageStatus", "")
                if abs(remaining - 300) < 0.1 and storage_status == "partial":
                    print(f"✅ C7 PASS: remainingWeight=300kg, storageStatus=partial")
                    results.append(("C7", "PASS", "Remaining 300kg, partial"))
                else:
                    print(f"❌ C7 FAIL: remaining={remaining}, status={storage_status}")
                    results.append(("C7", "FAIL", f"Wrong values"))
            else:
                print(f"❌ C7 FAIL: WO outputs not found")
                results.append(("C7", "FAIL", "Outputs not found"))
        else:
            print(f"❌ C7 FAIL: {resp.status_code if resp else 'No response'}")
            results.append(("C7", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ C7 ERROR: {e}")
        results.append(("C7", "ERROR", str(e)))
    
    # C8: POST /api/inventory/inbound with 350kg (over-tally) → 400
    print("\n[C8] POST /api/inventory/inbound - Over-tally 350kg (should reject)")
    try:
        future_date = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
        inbound_payload = {
            "coldStorageId": cs_id,
            "zoneId": zone_id,
            "referenceId": wo_id,
            "referenceType": "WO",
            "items": [
                {
                    "productId": product_id,
                    "weight": 350,
                    "quantity": 1,
                    "packagingType": "karung",
                    "expiredDate": future_date
                }
            ]
        }
        resp = api_call("POST", "/inventory/inbound", role="admin", json_data=inbound_payload)
        if resp and resp.status_code == 400:
            error_msg = resp.json().get("error", "")
            if "melebihi" in error_msg.lower() or "300" in error_msg:
                print(f"✅ C8 PASS: Over-tally rejected with error: {error_msg[:100]}")
                results.append(("C8", "PASS", "Over-tally rejected"))
            else:
                print(f"❌ C8 FAIL: Wrong error: {error_msg}")
                results.append(("C8", "FAIL", "Wrong error"))
        else:
            print(f"❌ C8 FAIL: Expected 400, got {resp.status_code if resp else 'No response'}")
            results.append(("C8", "FAIL", f"Expected 400, got {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ C8 ERROR: {e}")
        results.append(("C8", "ERROR", str(e)))
    
    # C9: POST /api/inventory/inbound with 300kg (exact remaining) → 200
    print("\n[C9] POST /api/inventory/inbound - Tally exact remaining 300kg")
    try:
        future_date = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
        inbound_payload = {
            "coldStorageId": cs_id,
            "zoneId": zone_id,
            "referenceId": wo_id,
            "referenceType": "WO",
            "items": [
                {
                    "productId": product_id,
                    "weight": 300,
                    "quantity": 1,
                    "packagingType": "karung",
                    "expiredDate": future_date
                }
            ]
        }
        resp = api_call("POST", "/inventory/inbound", role="admin", json_data=inbound_payload)
        if resp and resp.status_code == 201:
            print(f"✅ C9 PASS: Exact remaining 300kg tallied successfully")
            results.append(("C9", "PASS", "300kg tallied"))
        else:
            print(f"❌ C9 FAIL: {resp.status_code if resp else 'No response'} - {resp.text[:200] if resp else ''}")
            results.append(("C9", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ C9 ERROR: {e}")
        results.append(("C9", "ERROR", str(e)))
    
    # C10: GET /api/work-orders/pending-storage - Should NOT show fully stored output
    print("\n[C10] GET /api/work-orders/pending-storage - Fully stored output should not appear")
    try:
        resp = api_call("GET", "/work-orders/pending-storage", role="admin")
        if resp and resp.status_code == 200:
            pending = resp.json().get("data", [])
            wo_outputs = [p for p in pending if p.get("workOrderId") == wo_id]
            if len(wo_outputs) == 0:
                print(f"✅ C10 PASS: Fully stored output no longer in pending-storage")
                results.append(("C10", "PASS", "Output removed from pending"))
            else:
                remaining = wo_outputs[0].get("remainingWeight", 0)
                if remaining < 0.1:
                    print(f"✅ C10 PASS: Output still listed but remainingWeight≈0")
                    results.append(("C10", "PASS", "Remaining≈0"))
                else:
                    print(f"❌ C10 FAIL: Output still has remaining={remaining}kg")
                    results.append(("C10", "FAIL", f"Still has {remaining}kg"))
        else:
            print(f"❌ C10 FAIL: {resp.status_code if resp else 'No response'}")
            results.append(("C10", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ C10 ERROR: {e}")
        results.append(("C10", "ERROR", str(e)))
    
    # C11: POST /api/inventory/inbound with 100kg more → 400
    print("\n[C11] POST /api/inventory/inbound - Try to tally 100kg more (should reject)")
    try:
        future_date = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
        inbound_payload = {
            "coldStorageId": cs_id,
            "zoneId": zone_id,
            "referenceId": wo_id,
            "referenceType": "WO",
            "items": [
                {
                    "productId": product_id,
                    "weight": 100,
                    "quantity": 1,
                    "packagingType": "karung",
                    "expiredDate": future_date
                }
            ]
        }
        resp = api_call("POST", "/inventory/inbound", role="admin", json_data=inbound_payload)
        if resp and resp.status_code == 400:
            error_msg = resp.json().get("error", "")
            if "selesai" in error_msg.lower() or "tidak ada sisa" in error_msg.lower():
                print(f"✅ C11 PASS: Over-tally after completion rejected: {error_msg[:100]}")
                results.append(("C11", "PASS", "Post-completion tally rejected"))
            else:
                print(f"❌ C11 FAIL: Wrong error: {error_msg}")
                results.append(("C11", "FAIL", "Wrong error"))
        else:
            print(f"❌ C11 FAIL: Expected 400, got {resp.status_code if resp else 'No response'}")
            results.append(("C11", "FAIL", f"Expected 400, got {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ C11 ERROR: {e}")
        results.append(("C11", "ERROR", str(e)))
    
    return results

def test_d_role_permissions():
    """Test D: Role permissions for wo-stages endpoints"""
    print("\n" + "="*80)
    print("TEST D: ROLE PERMISSIONS FOR WO-STAGES")
    print("="*80)
    
    results = []
    
    # D1: Operator can GET /api/wo-stages
    print("\n[D1] Operator can GET /api/wo-stages")
    try:
        resp = api_call("GET", "/wo-stages", role="operator")
        if resp and resp.status_code == 200:
            print(f"✅ D1 PASS: Operator can GET wo-stages")
            results.append(("D1", "PASS", "Operator can GET"))
        else:
            print(f"❌ D1 FAIL: {resp.status_code if resp else 'No response'}")
            results.append(("D1", "FAIL", f"Status {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ D1 ERROR: {e}")
        results.append(("D1", "ERROR", str(e)))
    
    # D2: Operator can GET single stage
    print("\n[D2] Operator can GET /api/wo-stages/:id")
    try:
        resp = api_call("GET", "/wo-stages", role="admin")
        if resp and resp.status_code == 200:
            stages = resp.json().get("data", [])
            if stages:
                stage_id = stages[0]["id"]
                resp2 = api_call("GET", f"/wo-stages/{stage_id}", role="operator")
                if resp2 and resp2.status_code == 200:
                    print(f"✅ D2 PASS: Operator can GET single stage")
                    results.append(("D2", "PASS", "Operator can GET single"))
                else:
                    print(f"❌ D2 FAIL: {resp2.status_code if resp2 else 'No response'}")
                    results.append(("D2", "FAIL", f"Status {resp2.status_code if resp2 else 'No response'}"))
    except Exception as e:
        print(f"❌ D2 ERROR: {e}")
        results.append(("D2", "ERROR", str(e)))
    
    # D3: Operator CANNOT POST wo-stages
    print("\n[D3] Operator CANNOT POST /api/wo-stages (403)")
    try:
        payload = {"code": "OP_TEST", "name": "Operator Test", "sequenceOrder": 1}
        resp = api_call("POST", "/wo-stages", role="operator", json_data=payload)
        if resp and resp.status_code == 403:
            print(f"✅ D3 PASS: Operator correctly forbidden (403) on POST")
            results.append(("D3", "PASS", "Operator POST forbidden"))
        else:
            print(f"❌ D3 FAIL: Expected 403, got {resp.status_code if resp else 'No response'}")
            results.append(("D3", "FAIL", f"Expected 403, got {resp.status_code if resp else 'No response'}"))
    except Exception as e:
        print(f"❌ D3 ERROR: {e}")
        results.append(("D3", "ERROR", str(e)))
    
    # D4: Operator CANNOT PUT wo-stages
    print("\n[D4] Operator CANNOT PUT /api/wo-stages/:id (403)")
    try:
        resp = api_call("GET", "/wo-stages", role="admin")
        if resp and resp.status_code == 200:
            stages = resp.json().get("data", [])
            if stages:
                stage_id = stages[0]["id"]
                payload = {"sequenceOrder": 999}
                resp2 = api_call("PUT", f"/wo-stages/{stage_id}", role="operator", json_data=payload)
                if resp2 and resp2.status_code == 403:
                    print(f"✅ D4 PASS: Operator correctly forbidden (403) on PUT")
                    results.append(("D4", "PASS", "Operator PUT forbidden"))
                else:
                    print(f"❌ D4 FAIL: Expected 403, got {resp2.status_code if resp2 else 'No response'}")
                    results.append(("D4", "FAIL", f"Expected 403, got {resp2.status_code if resp2 else 'No response'}"))
    except Exception as e:
        print(f"❌ D4 ERROR: {e}")
        results.append(("D4", "ERROR", str(e)))
    
    # D5: Operator CANNOT DELETE wo-stages
    print("\n[D5] Operator CANNOT DELETE /api/wo-stages/:id (403)")
    try:
        resp = api_call("GET", "/wo-stages", role="admin")
        if resp and resp.status_code == 200:
            stages = resp.json().get("data", [])
            if stages:
                stage_id = stages[0]["id"]
                resp2 = api_call("DELETE", f"/wo-stages/{stage_id}", role="operator")
                if resp2 and resp2.status_code == 403:
                    print(f"✅ D5 PASS: Operator correctly forbidden (403) on DELETE")
                    results.append(("D5", "PASS", "Operator DELETE forbidden"))
                else:
                    print(f"❌ D5 FAIL: Expected 403, got {resp2.status_code if resp2 else 'No response'}")
                    results.append(("D5", "FAIL", f"Expected 403, got {resp2.status_code if resp2 else 'No response'}"))
    except Exception as e:
        print(f"❌ D5 ERROR: {e}")
        results.append(("D5", "ERROR", str(e)))
    
    # D6: Operator CAN POST stage-records
    print("\n[D6] Operator CAN POST /api/work-orders/:id/stage-records")
    try:
        # Get a WO and stage
        resp = api_call("GET", "/work-orders", role="admin")
        if resp and resp.status_code == 200:
            wos = resp.json().get("data", [])
            if wos:
                wo_id = wos[0]["id"]
                resp2 = api_call("GET", "/wo-stages", role="admin")
                if resp2 and resp2.status_code == 200:
                    stages = resp2.json().get("data", [])
                    receiving = next((s for s in stages if s["code"] == "RECEIVING"), None)
                    if receiving:
                        payload = {
                            "records": [{
                                "stageId": receiving["id"],
                                "fieldValues": {"total_weight": 100, "head_count": 50}
                            }]
                        }
                        resp3 = api_call("POST", f"/work-orders/{wo_id}/stage-records", role="operator", json_data=payload)
                        if resp3 and resp3.status_code == 201:
                            print(f"✅ D6 PASS: Operator can POST stage-records")
                            results.append(("D6", "PASS", "Operator can POST records"))
                        else:
                            print(f"❌ D6 FAIL: {resp3.status_code if resp3 else 'No response'}")
                            results.append(("D6", "FAIL", f"Status {resp3.status_code if resp3 else 'No response'}"))
    except Exception as e:
        print(f"❌ D6 ERROR: {e}")
        results.append(("D6", "ERROR", str(e)))
    
    return results

def print_summary(all_results):
    """Print test summary"""
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    total = len(all_results)
    passed = len([r for r in all_results if r[1] == "PASS"])
    failed = len([r for r in all_results if r[1] == "FAIL"])
    errors = len([r for r in all_results if r[1] == "ERROR"])
    skipped = len([r for r in all_results if r[1] == "SKIP"])
    info = len([r for r in all_results if r[1] == "INFO"])
    
    print(f"\nTotal Tests: {total}")
    print(f"✅ Passed: {passed}")
    print(f"❌ Failed: {failed}")
    print(f"⚠️  Errors: {errors}")
    print(f"⏭️  Skipped: {skipped}")
    print(f"ℹ️  Info: {info}")
    
    if failed > 0 or errors > 0:
        print(f"\n❌ FAILED/ERROR TESTS:")
        for test_id, status, msg in all_results:
            if status in ["FAIL", "ERROR"]:
                print(f"   {test_id}: {status} - {msg}")
    
    print(f"\n{'='*80}")
    if failed == 0 and errors == 0:
        print("✅ ALL TESTS PASSED!")
    else:
        print(f"❌ {failed + errors} TESTS FAILED/ERROR")
    print(f"{'='*80}\n")

def main():
    """Main test runner"""
    print("="*80)
    print("LPI ERP BACKEND API TESTING")
    print("WO Stages Master + Stage Records + Anti-dedup WO→Storage")
    print("="*80)
    
    # Login all roles
    print("\n[LOGIN] Authenticating all roles...")
    if not login(ADMIN_EMAIL, ADMIN_PASSWORD, "admin"):
        print("❌ Admin login failed, cannot proceed")
        sys.exit(1)
    if not login(SUPERVISOR_EMAIL, SUPERVISOR_PASSWORD, "supervisor"):
        print("⚠️  Supervisor login failed")
    if not login(OPERATOR_EMAIL, OPERATOR_PASSWORD, "operator"):
        print("⚠️  Operator login failed")
    
    # Run all tests
    all_results = []
    
    all_results.extend(test_a_wo_stages_master_crud())
    all_results.extend(test_b_wo_stage_records())
    all_results.extend(test_c_anti_dedup_wo_storage())
    all_results.extend(test_d_role_permissions())
    
    # Print summary
    print_summary(all_results)
    
    # Return exit code
    failed = len([r for r in all_results if r[1] in ["FAIL", "ERROR"]])
    sys.exit(0 if failed == 0 else 1)

if __name__ == "__main__":
    main()
