#!/usr/bin/env python3
"""
Comprehensive Backend Testing for Work Orders (Produksi/Maklon) Module
Tests all WO endpoints, cost calculations, HPP, finalization, and RBAC
"""

import requests
import json
import time
from datetime import datetime

# Base URL from .env
BASE_URL = "https://cashbook-quick-entry.preview.emergentagent.com/api"

# Test credentials
CREDENTIALS = {
    "admin": {"email": "admin@lpi.co.id", "password": "admin123"},
    "supervisor": {"email": "supervisor@lpi.co.id", "password": "super123"},
    "direktur": {"email": "direktur@lpi.co.id", "password": "direktur123"},
    "operator": {"email": "operator@lpi.co.id", "password": "operator123"}
}

# Global storage
sessions = {}
test_data = {}
test_results = {"passed": 0, "failed": 0, "tests": []}

def login(role):
    """Login and return session with cookies"""
    print(f"\n{'='*60}")
    print(f"🔐 Logging in as {role}...")
    session = requests.Session()
    creds = CREDENTIALS[role]
    
    try:
        resp = session.post(
            f"https://cashbook-quick-entry.preview.emergentagent.com/api/auth/sign-in/email",
            json=creds,
            timeout=30
        )
        
        if resp.status_code == 200:
            print(f"✅ Login successful for {role}")
            sessions[role] = session
            time.sleep(0.5)  # Rate limiting
            return session
        else:
            print(f"❌ Login failed for {role}: {resp.status_code}")
            return None
    except Exception as e:
        print(f"❌ Login exception for {role}: {str(e)}")
        return None

def get_prep_data():
    """Get required IDs for testing"""
    print(f"\n{'='*60}")
    print("📋 Fetching prep data (contacts, products, cold storage)...")
    
    session = sessions.get('admin')
    if not session:
        print("❌ No admin session")
        return False
    
    try:
        # Get contacts
        time.sleep(1)
        resp = session.get(f"{BASE_URL}/contacts?type=RPH", timeout=30)
        if resp.status_code == 200:
            contacts = resp.json().get('data', [])
            for c in contacts:
                if c.get('code') == 'RPH-001':
                    test_data['rph_id'] = c['id']
                    print(f"✅ Found RPH-001: {c['displayName']} (ID: {c['id']})")
        
        time.sleep(1)
        resp = session.get(f"{BASE_URL}/contacts?type=Supplier", timeout=30)
        if resp.status_code == 200:
            contacts = resp.json().get('data', [])
            for c in contacts:
                if c.get('code') == 'SUP-001':
                    test_data['supplier_id'] = c['id']
                    print(f"✅ Found SUP-001: {c['displayName']} (ID: {c['id']})")
        
        # Get products
        time.sleep(0.5)
        resp = session.get(f"{BASE_URL}/products", timeout=30)
        if resp.status_code == 200:
            products = resp.json().get('data', [])
            for p in products:
                sku = p.get('sku')
                if sku == 'LB-001':
                    test_data['lb_id'] = p['id']
                    print(f"✅ Found LB-001: {p['name']} (ID: {p['id']})")
                elif sku == 'KRK-001':
                    test_data['krk_id'] = p['id']
                    print(f"✅ Found KRK-001: {p['name']} (ID: {p['id']})")
                elif sku == 'BN-001':
                    test_data['bn_id'] = p['id']
                    print(f"✅ Found BN-001: {p['name']} (ID: {p['id']})")
        else:
            print(f"❌ Failed to get products: {resp.status_code}")
        
        # Get cold storage
        time.sleep(0.5)
        resp = session.get(f"{BASE_URL}/cold-storages", timeout=30)
        if resp.status_code == 200:
            storages = resp.json().get('data', [])
            for cs in storages:
                if cs.get('code') == 'CS-01':
                    test_data['cs_id'] = cs['id']
                    print(f"✅ Found CS-01: {cs['name']} (ID: {cs['id']})")
        else:
            print(f"❌ Failed to get cold storages: {resp.status_code}")
        
        # Verify all required data
        required = ['rph_id', 'supplier_id', 'lb_id', 'krk_id', 'bn_id', 'cs_id']
        missing = [k for k in required if k not in test_data]
        
        if missing:
            print(f"❌ Missing required data: {missing}")
            return False
        
        print("✅ All prep data retrieved successfully")
        return True
        
    except Exception as e:
        print(f"❌ Exception getting prep data: {str(e)}")
        return False

def test_create_internal_wo():
    """Test 1: Create Internal WO"""
    print(f"\n{'='*60}")
    print("[TEST 1] Create Internal WO")
    print(f"{'='*60}")
    
    session = sessions.get('admin')
    try:
        wo_data = {
            "mode": "Internal",
            "startDate": "2025-06-16",
            "baseCost": 3500000,
            "notes": "Test WO Internal"
        }
        
        resp = session.post(f"{BASE_URL}/work-orders", json=wo_data, timeout=30)
        
        if resp.status_code == 201:
            wo = resp.json().get('data', {})
            wo_number = wo.get('woNumber', '')
            
            import re
            if re.match(r'^WO/\d{6}/\d{4}$', wo_number):
                print(f"✅ WO created: {wo_number}")
                print(f"   - Pipeline Status: {wo.get('pipelineStatus')}")
                print(f"   - Mode: {wo.get('mode')}")
                print(f"   - Base Cost: {wo.get('baseCost')}")
                print(f"   - Total Cost: {wo.get('totalCost')}")
                
                test_data['wo_internal_id'] = wo['id']
                
                # Verify totalCost == baseCost (no maklon)
                if wo.get('totalCost') == 3500000:
                    print(f"✅ Total cost correct (baseCost only, no maklon)")
                    test_results["passed"] += 1
                    test_results["tests"].append("Create Internal WO: PASS")
                else:
                    print(f"❌ Total cost mismatch: expected 3500000, got {wo.get('totalCost')}")
                    test_results["failed"] += 1
                    test_results["tests"].append("Create Internal WO: FAIL (cost)")
            else:
                print(f"❌ Invalid WO number format: {wo_number}")
                test_results["failed"] += 1
                test_results["tests"].append("Create Internal WO: FAIL (format)")
        else:
            print(f"❌ Failed to create WO: {resp.status_code} - {resp.text[:200]}")
            test_results["failed"] += 1
            test_results["tests"].append("Create Internal WO: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        test_results["failed"] += 1
        test_results["tests"].append("Create Internal WO: FAIL (exception)")

def test_create_maklon_wo():
    """Test 2: Create Maklon WO"""
    print(f"\n{'='*60}")
    print("[TEST 2] Create Maklon WO")
    print(f"{'='*60}")
    
    session = sessions.get('admin')
    try:
        wo_data = {
            "mode": "Maklon",
            "maklonSupplierId": test_data['rph_id'],
            "maklonRatePerKg": 2500,
            "startDate": "2025-06-16",
            "baseCost": 3300000,
            "notes": "Test WO Maklon"
        }
        
        resp = session.post(f"{BASE_URL}/work-orders", json=wo_data, timeout=30)
        
        if resp.status_code == 201:
            wo = resp.json().get('data', {})
            print(f"✅ Maklon WO created: {wo.get('woNumber')}")
            print(f"   - Mode: {wo.get('mode')}")
            print(f"   - Maklon Rate: {wo.get('maklonRatePerKg')}/kg")
            print(f"   - Base Cost: {wo.get('baseCost')}")
            print(f"   - Maklon Cost: {wo.get('maklonCost')} (should be 0 until arrival)")
            print(f"   - Total Cost: {wo.get('totalCost')}")
            
            test_data['wo_maklon_id'] = wo['id']
            
            # Initially totalCost = baseCost + 0 (maklonCost=0 until arrival weight)
            if wo.get('totalCost') == 3300000 and wo.get('maklonCost') == 0:
                print(f"✅ Total cost correct (baseCost only, maklonCost=0 until arrival)")
                test_results["passed"] += 1
                test_results["tests"].append("Create Maklon WO: PASS")
            else:
                print(f"❌ Cost mismatch: totalCost={wo.get('totalCost')}, maklonCost={wo.get('maklonCost')}")
                test_results["failed"] += 1
                test_results["tests"].append("Create Maklon WO: FAIL (cost)")
        else:
            print(f"❌ Failed to create Maklon WO: {resp.status_code}")
            test_results["failed"] += 1
            test_results["tests"].append("Create Maklon WO: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        test_results["failed"] += 1
        test_results["tests"].append("Create Maklon WO: FAIL (exception)")

def test_status_pipeline():
    """Test 3: Status pipeline transitions"""
    print(f"\n{'='*60}")
    print("[TEST 3] Status pipeline transitions")
    print(f"{'='*60}")
    
    session = sessions.get('admin')
    wo_id = test_data.get('wo_internal_id')
    
    try:
        # Valid: Draft -> Disetujui
        resp = session.post(f"{BASE_URL}/work-orders/{wo_id}/status",
                           json={"status": "Disetujui"}, timeout=30)
        
        if resp.status_code == 200:
            wo = resp.json().get('data', {})
            if wo.get('approvedBy') and wo.get('approvedAt'):
                print(f"✅ Transition Draft -> Disetujui: SUCCESS")
                print(f"   - Approved By: {wo.get('approvedBy')}")
                print(f"   - Approved At: {wo.get('approvedAt')}")
                
                # Valid: Disetujui -> Dalam Proses
                resp2 = session.post(f"{BASE_URL}/work-orders/{wo_id}/status",
                                    json={"status": "Dalam Proses"}, timeout=30)
                
                if resp2.status_code == 200:
                    print(f"✅ Transition Disetujui -> Dalam Proses: SUCCESS")
                    
                    # Invalid: try to go back to Draft
                    resp3 = session.post(f"{BASE_URL}/work-orders/{wo_id}/status",
                                        json={"status": "Draft"}, timeout=30)
                    
                    if resp3.status_code == 400:
                        print(f"✅ Invalid transition Dalam Proses -> Draft correctly rejected")
                        
                        # Create fresh Draft WO for invalid test
                        wo_data = {"mode": "Internal", "startDate": "2025-06-16", "baseCost": 1000000}
                        resp4 = session.post(f"{BASE_URL}/work-orders", json=wo_data, timeout=30)
                        
                        if resp4.status_code == 201:
                            draft_wo_id = resp4.json().get('data', {}).get('id')
                            
                            # Invalid: Draft -> Selesai directly
                            resp5 = session.post(f"{BASE_URL}/work-orders/{draft_wo_id}/status",
                                                json={"status": "Selesai"}, timeout=30)
                            
                            if resp5.status_code == 400:
                                print(f"✅ Invalid transition Draft -> Selesai correctly rejected")
                                test_results["passed"] += 1
                                test_results["tests"].append("Status pipeline: PASS")
                            else:
                                print(f"❌ Invalid transition should return 400, got {resp5.status_code}")
                                test_results["failed"] += 1
                                test_results["tests"].append("Status pipeline: FAIL (invalid)")
                        else:
                            test_results["failed"] += 1
                            test_results["tests"].append("Status pipeline: FAIL (create test WO)")
                    else:
                        print(f"❌ Invalid transition should return 400, got {resp3.status_code}")
                        test_results["failed"] += 1
                        test_results["tests"].append("Status pipeline: FAIL (back)")
                else:
                    print(f"❌ Transition to Dalam Proses failed: {resp2.status_code}")
                    test_results["failed"] += 1
                    test_results["tests"].append("Status pipeline: FAIL (Dalam Proses)")
            else:
                print(f"❌ approvedBy or approvedAt not set")
                test_results["failed"] += 1
                test_results["tests"].append("Status pipeline: FAIL (approval)")
        else:
            print(f"❌ Transition to Disetujui failed: {resp.status_code}")
            test_results["failed"] += 1
            test_results["tests"].append("Status pipeline: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        test_results["failed"] += 1
        test_results["tests"].append("Status pipeline: FAIL (exception)")

def test_arrival_internal():
    """Test 4: Arrival on Internal WO"""
    print(f"\n{'='*60}")
    print("[TEST 4] Arrival on Internal WO")
    print(f"{'='*60}")
    
    session = sessions.get('admin')
    wo_id = test_data.get('wo_internal_id')
    
    try:
        arrival_data = {
            "totalWeight": 150,
            "totalHeadCount": 100,
            "ekorMati": 2,
            "notes": "OK arrival"
        }
        
        resp = session.post(f"{BASE_URL}/work-orders/{wo_id}/arrival",
                           json=arrival_data, timeout=30)
        
        if resp.status_code == 200:
            print(f"✅ Arrival recorded")
            
            # Verify WO updated
            resp2 = session.get(f"{BASE_URL}/work-orders/{wo_id}", timeout=30)
            
            if resp2.status_code == 200:
                wo = resp2.json().get('data', {})
                bw_avg = wo.get('bwAvg')
                ekor_mati = wo.get('ekorMati')
                arrival_at = wo.get('arrivalRecordedAt')
                stages = wo.get('stages', [])
                
                print(f"   - BW Avg: {bw_avg} (expected 1.5)")
                print(f"   - Ekor Mati: {ekor_mati}")
                print(f"   - Arrival Recorded At: {arrival_at}")
                print(f"   - Stages count: {len(stages)}")
                
                # Verify bwAvg = 150/100 = 1.5
                if abs(bw_avg - 1.5) < 0.01 and ekor_mati == 2 and arrival_at:
                    # Verify stages array contains kedatangan
                    kedatangan_stage = next((s for s in stages if s.get('type') == 'kedatangan'), None)
                    
                    if kedatangan_stage:
                        rendemen_data = kedatangan_stage.get('rendemenData', {})
                        if rendemen_data.get('ekorMati') == 2:
                            print(f"✅ Arrival data correct, stage recorded with ekorMati=2")
                            test_results["passed"] += 1
                            test_results["tests"].append("Arrival Internal: PASS")
                        else:
                            print(f"❌ Stage rendemenData.ekorMati incorrect")
                            test_results["failed"] += 1
                            test_results["tests"].append("Arrival Internal: FAIL (stage data)")
                    else:
                        print(f"❌ No kedatangan stage found")
                        test_results["failed"] += 1
                        test_results["tests"].append("Arrival Internal: FAIL (no stage)")
                else:
                    print(f"❌ Arrival data incorrect")
                    test_results["failed"] += 1
                    test_results["tests"].append("Arrival Internal: FAIL (data)")
            else:
                test_results["failed"] += 1
                test_results["tests"].append("Arrival Internal: FAIL (verify)")
        else:
            print(f"❌ Failed to record arrival: {resp.status_code}")
            test_results["failed"] += 1
            test_results["tests"].append("Arrival Internal: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        test_results["failed"] += 1
        test_results["tests"].append("Arrival Internal: FAIL (exception)")

def test_arrival_maklon():
    """Test 5: Arrival on Maklon WO (triggers maklon cost calculation)"""
    print(f"\n{'='*60}")
    print("[TEST 5] Arrival on Maklon WO")
    print(f"{'='*60}")
    
    session = sessions.get('admin')
    wo_id = test_data.get('wo_maklon_id')
    
    try:
        # First approve and move to Dalam Proses
        resp = session.post(f"{BASE_URL}/work-orders/{wo_id}/status",
                           json={"status": "Disetujui"}, timeout=30)
        if resp.status_code == 200:
            resp = session.post(f"{BASE_URL}/work-orders/{wo_id}/status",
                               json={"status": "Dalam Proses"}, timeout=30)
        
        # Record arrival
        arrival_data = {
            "totalWeight": 150,
            "totalHeadCount": 100,
            "ekorMati": 0
        }
        
        resp = session.post(f"{BASE_URL}/work-orders/{wo_id}/arrival",
                           json=arrival_data, timeout=30)
        
        if resp.status_code == 200:
            print(f"✅ Arrival recorded on Maklon WO")
            
            # Verify maklon cost calculated: 2500 * 150 = 375000
            resp2 = session.get(f"{BASE_URL}/work-orders/{wo_id}", timeout=30)
            
            if resp2.status_code == 200:
                wo = resp2.json().get('data', {})
                maklon_cost = wo.get('maklonCost')
                total_cost = wo.get('totalCost')
                
                print(f"   - Maklon Cost: {maklon_cost} (expected 375000)")
                print(f"   - Total Cost: {total_cost} (expected 3675000)")
                
                # maklonCost = 2500 * 150 = 375000
                # totalCost = 3300000 + 375000 = 3675000
                if maklon_cost == 375000 and total_cost == 3675000:
                    print(f"✅ Maklon cost calculated correctly")
                    test_results["passed"] += 1
                    test_results["tests"].append("Arrival Maklon: PASS")
                else:
                    print(f"❌ Cost mismatch")
                    test_results["failed"] += 1
                    test_results["tests"].append("Arrival Maklon: FAIL (cost)")
            else:
                test_results["failed"] += 1
                test_results["tests"].append("Arrival Maklon: FAIL (verify)")
        else:
            print(f"❌ Failed to record arrival: {resp.status_code}")
            test_results["failed"] += 1
            test_results["tests"].append("Arrival Maklon: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        test_results["failed"] += 1
        test_results["tests"].append("Arrival Maklon: FAIL (exception)")

def test_stages():
    """Test 6: Production stages"""
    print(f"\n{'='*60}")
    print("[TEST 6] Production stages")
    print(f"{'='*60}")
    
    session = sessions.get('admin')
    wo_id = test_data.get('wo_internal_id')
    
    try:
        stages_passed = 0
        
        # Stage 1: Pemotongan
        stage1 = {
            "type": "pemotongan",
            "outputWeight": 0,
            "headCount": 98,
            "rendemenData": {
                "inputHeadCount": 100,
                "outputHeadCount": 98
            }
        }
        
        resp = session.post(f"{BASE_URL}/work-orders/{wo_id}/stage",
                           json=stage1, timeout=30)
        
        if resp.status_code == 201:
            print(f"✅ Stage pemotongan recorded")
            stages_passed += 1
        else:
            print(f"❌ Stage pemotongan failed: {resp.status_code}")
        
        # Stage 2: Eviscerasi
        stage2 = {
            "type": "eviscerasi",
            "outputWeight": 110,
            "headCount": 98,
            "rendemenData": {
                "beratBrangkas": 110,
                "ekorBrangkas": 98,
                "beratHJA": 8,
                "beratUsus": 5,
                "beratTembolok": 1
            }
        }
        
        resp = session.post(f"{BASE_URL}/work-orders/{wo_id}/stage",
                           json=stage2, timeout=30)
        
        if resp.status_code == 201:
            print(f"✅ Stage eviscerasi recorded")
            stages_passed += 1
        else:
            print(f"❌ Stage eviscerasi failed: {resp.status_code}")
        
        # Stage 3: Karkas
        stage3 = {
            "type": "karkas",
            "outputWeight": 100,
            "headCount": 98,
            "rendemenData": {
                "beratKarkas": 100,
                "ekorKarkas": 98,
                "beratKepalaLeher": 5,
                "beratCeker": 3
            }
        }
        
        resp = session.post(f"{BASE_URL}/work-orders/{wo_id}/stage",
                           json=stage3, timeout=30)
        
        if resp.status_code == 201:
            print(f"✅ Stage karkas recorded")
            stages_passed += 1
        else:
            print(f"❌ Stage karkas failed: {resp.status_code}")
        
        # Invalid stage type
        stage_invalid = {
            "type": "invalid_type",
            "outputWeight": 10
        }
        
        resp = session.post(f"{BASE_URL}/work-orders/{wo_id}/stage",
                           json=stage_invalid, timeout=30)
        
        if resp.status_code == 400:
            print(f"✅ Invalid stage type correctly rejected")
            stages_passed += 1
        else:
            print(f"❌ Invalid stage should return 400, got {resp.status_code}")
        
        if stages_passed == 4:
            test_results["passed"] += 1
            test_results["tests"].append("Stages: PASS")
        else:
            print(f"❌ Stages: {stages_passed}/4 passed")
            test_results["failed"] += 1
            test_results["tests"].append("Stages: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        test_results["failed"] += 1
        test_results["tests"].append("Stages: FAIL (exception)")

def test_custom_costs():
    """Test 7: Custom costs (add and delete)"""
    print(f"\n{'='*60}")
    print("[TEST 7] Custom costs")
    print(f"{'='*60}")
    
    session = sessions.get('admin')
    wo_id = test_data.get('wo_internal_id')
    
    try:
        # Add cost 1
        cost1 = {
            "name": "Listrik",
            "amount": 150000,
            "category": "operasional"
        }
        
        resp = session.post(f"{BASE_URL}/work-orders/{wo_id}/costs",
                           json=cost1, timeout=30)
        
        if resp.status_code == 201:
            print(f"✅ Cost 1 added: Listrik 150,000")
            
            # Add cost 2
            cost2 = {
                "name": "Transport",
                "amount": 100000,
                "category": "operasional"
            }
            
            resp2 = session.post(f"{BASE_URL}/work-orders/{wo_id}/costs",
                                json=cost2, timeout=30)
            
            if resp2.status_code == 201:
                transport_cost_id = resp2.json().get('data', {}).get('id')
                print(f"✅ Cost 2 added: Transport 100,000")
                
                # Verify total cost updated
                resp3 = session.get(f"{BASE_URL}/work-orders/{wo_id}", timeout=30)
                
                if resp3.status_code == 200:
                    wo = resp3.json().get('data', {})
                    custom_cost_total = wo.get('customCostTotal')
                    total_cost = wo.get('totalCost')
                    
                    print(f"   - Custom Cost Total: {custom_cost_total} (expected 250000)")
                    print(f"   - Total Cost: {total_cost} (expected 3750000)")
                    
                    # For Internal WO: totalCost = 3500000 + 0 + 250000 = 3750000
                    if custom_cost_total == 250000 and total_cost == 3750000:
                        print(f"✅ Custom costs added correctly")
                        
                        # Delete transport cost
                        resp4 = session.delete(f"{BASE_URL}/work-orders/{wo_id}/costs/{transport_cost_id}",
                                              timeout=30)
                        
                        if resp4.status_code == 200:
                            print(f"✅ Transport cost deleted")
                            
                            # Verify total cost updated
                            resp5 = session.get(f"{BASE_URL}/work-orders/{wo_id}", timeout=30)
                            
                            if resp5.status_code == 200:
                                wo_final = resp5.json().get('data', {})
                                custom_cost_final = wo_final.get('customCostTotal')
                                total_cost_final = wo_final.get('totalCost')
                                
                                print(f"   - Custom Cost Total: {custom_cost_final} (expected 150000)")
                                print(f"   - Total Cost: {total_cost_final} (expected 3650000)")
                                
                                if custom_cost_final == 150000 and total_cost_final == 3650000:
                                    print(f"✅ Cost deletion updated totals correctly")
                                    test_results["passed"] += 1
                                    test_results["tests"].append("Custom costs: PASS")
                                else:
                                    print(f"❌ Cost totals after deletion incorrect")
                                    test_results["failed"] += 1
                                    test_results["tests"].append("Custom costs: FAIL (delete totals)")
                            else:
                                test_results["failed"] += 1
                                test_results["tests"].append("Custom costs: FAIL (verify delete)")
                        else:
                            print(f"❌ Failed to delete cost: {resp4.status_code}")
                            test_results["failed"] += 1
                            test_results["tests"].append("Custom costs: FAIL (delete)")
                    else:
                        print(f"❌ Cost totals incorrect")
                        test_results["failed"] += 1
                        test_results["tests"].append("Custom costs: FAIL (totals)")
                else:
                    test_results["failed"] += 1
                    test_results["tests"].append("Custom costs: FAIL (verify)")
            else:
                print(f"❌ Failed to add cost 2: {resp2.status_code}")
                test_results["failed"] += 1
                test_results["tests"].append("Custom costs: FAIL (cost2)")
        else:
            print(f"❌ Failed to add cost 1: {resp.status_code}")
            test_results["failed"] += 1
            test_results["tests"].append("Custom costs: FAIL (cost1)")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        test_results["failed"] += 1
        test_results["tests"].append("Custom costs: FAIL (exception)")

def test_outputs_balanced():
    """Test 8: Outputs with balanced coefficients"""
    print(f"\n{'='*60}")
    print("[TEST 8] Outputs with balanced coefficients")
    print(f"{'='*60}")
    
    session = sessions.get('admin')
    wo_id = test_data.get('wo_internal_id')
    
    try:
        outputs_data = {
            "outputs": [
                {
                    "productId": test_data['krk_id'],
                    "stage": "karkas",
                    "weight": 80,
                    "headCount": 80,
                    "coefficient": 1.0,
                    "isPremium": False
                },
                {
                    "productId": test_data['bn_id'],
                    "stage": "boneless",
                    "weight": 20,
                    "headCount": 0,
                    "coefficient": 1.0,
                    "isPremium": True,
                    "sizeGradingCode": "L"
                }
            ]
        }
        
        resp = session.post(f"{BASE_URL}/work-orders/{wo_id}/outputs",
                           json=outputs_data, timeout=30)
        
        if resp.status_code == 200:
            result = resp.json().get('data', {})
            validation = result.get('validation', {})
            
            print(f"✅ Outputs recorded")
            print(f"   - Total Weight: {validation.get('totalWeight')}")
            print(f"   - Base HPP: {validation.get('baseHpp')}")
            print(f"   - Allocated: {validation.get('allocated')}")
            print(f"   - Delta: {validation.get('delta')}")
            
            # With coef=1.0 for all, delta should be near 0
            total_weight = validation.get('totalWeight')
            delta = validation.get('delta')
            
            if total_weight == 100 and abs(delta) < 1:
                print(f"✅ Balanced coefficients: delta near 0")
                test_results["passed"] += 1
                test_results["tests"].append("Outputs balanced: PASS")
            else:
                print(f"❌ Validation incorrect")
                test_results["failed"] += 1
                test_results["tests"].append("Outputs balanced: FAIL (validation)")
        else:
            print(f"❌ Failed to record outputs: {resp.status_code}")
            test_results["failed"] += 1
            test_results["tests"].append("Outputs balanced: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        test_results["failed"] += 1
        test_results["tests"].append("Outputs balanced: FAIL (exception)")

def test_outputs_unbalanced():
    """Test 9: Outputs with unbalanced coefficients"""
    print(f"\n{'='*60}")
    print("[TEST 9] Outputs with unbalanced coefficients")
    print(f"{'='*60}")
    
    session = sessions.get('admin')
    wo_id = test_data.get('wo_internal_id')
    
    try:
        outputs_data = {
            "outputs": [
                {
                    "productId": test_data['krk_id'],
                    "stage": "karkas",
                    "weight": 50,
                    "coefficient": 1.5
                },
                {
                    "productId": test_data['bn_id'],
                    "stage": "boneless",
                    "weight": 50,
                    "coefficient": 0.5
                }
            ]
        }
        
        resp = session.post(f"{BASE_URL}/work-orders/{wo_id}/outputs",
                           json=outputs_data, timeout=30)
        
        if resp.status_code == 200:
            result = resp.json().get('data', {})
            validation = result.get('validation', {})
            
            print(f"✅ Outputs with unbalanced coefficients recorded")
            print(f"   - Total Weight: {validation.get('totalWeight')}")
            print(f"   - Delta: {validation.get('delta')}")
            
            # Weighted coefficient = (1.5*50 + 0.5*50)/100 = 1.0 -> delta near 0
            delta = validation.get('delta')
            
            if abs(delta) < 1:
                print(f"✅ Weighted coefficient balanced: delta near 0")
                test_results["passed"] += 1
                test_results["tests"].append("Outputs unbalanced: PASS")
            else:
                print(f"❌ Delta not near 0: {delta}")
                test_results["failed"] += 1
                test_results["tests"].append("Outputs unbalanced: FAIL")
        else:
            print(f"❌ Failed to record outputs: {resp.status_code}")
            test_results["failed"] += 1
            test_results["tests"].append("Outputs unbalanced: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        test_results["failed"] += 1
        test_results["tests"].append("Outputs unbalanced: FAIL (exception)")

def test_get_hpp():
    """Test 10: GET HPP endpoint"""
    print(f"\n{'='*60}")
    print("[TEST 10] GET /work-orders/:id/hpp")
    print(f"{'='*60}")
    
    session = sessions.get('admin')
    wo_id = test_data.get('wo_internal_id')
    
    try:
        resp = session.get(f"{BASE_URL}/work-orders/{wo_id}/hpp", timeout=30)
        
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            wo = data.get('wo', {})
            outputs = data.get('outputs', [])
            validation = data.get('validation', {})
            
            print(f"✅ HPP data retrieved")
            print(f"   - WO Number: {wo.get('woNumber')}")
            print(f"   - Total Cost: {wo.get('totalCost')}")
            print(f"   - Outputs count: {len(outputs)}")
            
            if outputs:
                for out in outputs:
                    product = out.get('product', {})
                    print(f"   - {product.get('name')}: weight={out.get('weight')}, hppPerKg={out.get('hppPerKg')}, hppTotal={out.get('hppTotal')}")
                
                # Verify outputs enriched with product info
                has_product_info = all('product' in o for o in outputs)
                
                if has_product_info and 'validation' in data:
                    print(f"✅ HPP structure correct with product enrichment")
                    test_results["passed"] += 1
                    test_results["tests"].append("GET HPP: PASS")
                else:
                    print(f"❌ HPP structure incomplete")
                    test_results["failed"] += 1
                    test_results["tests"].append("GET HPP: FAIL (structure)")
            else:
                print(f"❌ No outputs in HPP response")
                test_results["failed"] += 1
                test_results["tests"].append("GET HPP: FAIL (no outputs)")
        else:
            print(f"❌ Failed to get HPP: {resp.status_code}")
            test_results["failed"] += 1
            test_results["tests"].append("GET HPP: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        test_results["failed"] += 1
        test_results["tests"].append("GET HPP: FAIL (exception)")

def test_finalize():
    """Test 11: Finalize to inventory"""
    print(f"\n{'='*60}")
    print("[TEST 11] Finalize to inventory")
    print(f"{'='*60}")
    
    session = sessions.get('admin')
    wo_id = test_data.get('wo_internal_id')
    
    try:
        finalize_data = {
            "coldStorageId": test_data['cs_id']
        }
        
        resp = session.post(f"{BASE_URL}/work-orders/{wo_id}/finalize",
                           json=finalize_data, timeout=30)
        
        if resp.status_code == 200:
            result = resp.json().get('data', {})
            output_count = result.get('outputCount')
            transaction_id = result.get('transactionId')
            
            print(f"✅ WO finalized")
            print(f"   - Output Count: {output_count}")
            print(f"   - Transaction ID: {transaction_id}")
            
            # Verify WO status changed to Selesai
            resp2 = session.get(f"{BASE_URL}/work-orders/{wo_id}", timeout=30)
            
            if resp2.status_code == 200:
                wo = resp2.json().get('data', {})
                
                if wo.get('pipelineStatus') == 'Selesai' and wo.get('finalizedAt'):
                    print(f"✅ WO status: Selesai, finalizedAt set")
                    
                    # Try to finalize again (should fail)
                    resp3 = session.post(f"{BASE_URL}/work-orders/{wo_id}/finalize",
                                        json=finalize_data, timeout=30)
                    
                    if resp3.status_code == 400:
                        print(f"✅ Cannot finalize again (400)")
                        
                        # Test finalize on WO with no outputs
                        wo_data = {"mode": "Internal", "startDate": "2025-06-16", "baseCost": 1000000}
                        resp4 = session.post(f"{BASE_URL}/work-orders", json=wo_data, timeout=30)
                        
                        if resp4.status_code == 201:
                            empty_wo_id = resp4.json().get('data', {}).get('id')
                            
                            resp5 = session.post(f"{BASE_URL}/work-orders/{empty_wo_id}/finalize",
                                                json=finalize_data, timeout=30)
                            
                            if resp5.status_code == 400:
                                print(f"✅ Cannot finalize WO with no outputs (400)")
                                
                                # Test missing coldStorageId
                                resp6 = session.post(f"{BASE_URL}/work-orders/{empty_wo_id}/finalize",
                                                    json={}, timeout=30)
                                
                                if resp6.status_code == 400:
                                    print(f"✅ Missing coldStorageId rejected (400)")
                                    test_results["passed"] += 1
                                    test_results["tests"].append("Finalize: PASS")
                                else:
                                    print(f"❌ Missing coldStorageId should return 400")
                                    test_results["failed"] += 1
                                    test_results["tests"].append("Finalize: FAIL (missing cs)")
                            else:
                                print(f"❌ Empty WO finalize should return 400")
                                test_results["failed"] += 1
                                test_results["tests"].append("Finalize: FAIL (empty wo)")
                        else:
                            test_results["failed"] += 1
                            test_results["tests"].append("Finalize: FAIL (create test wo)")
                    else:
                        print(f"❌ Finalize again should return 400, got {resp3.status_code}")
                        test_results["failed"] += 1
                        test_results["tests"].append("Finalize: FAIL (again)")
                else:
                    print(f"❌ WO status not updated correctly")
                    test_results["failed"] += 1
                    test_results["tests"].append("Finalize: FAIL (status)")
            else:
                test_results["failed"] += 1
                test_results["tests"].append("Finalize: FAIL (verify)")
        else:
            print(f"❌ Failed to finalize: {resp.status_code} - {resp.text[:200]}")
            test_results["failed"] += 1
            test_results["tests"].append("Finalize: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        test_results["failed"] += 1
        test_results["tests"].append("Finalize: FAIL (exception)")

def test_rendemen_report():
    """Test 12: Rendemen report"""
    print(f"\n{'='*60}")
    print("[TEST 12] GET /work-orders/:id/rendemen-report")
    print(f"{'='*60}")
    
    session = sessions.get('admin')
    wo_id = test_data.get('wo_internal_id')
    
    try:
        resp = session.get(f"{BASE_URL}/work-orders/{wo_id}/rendemen-report", timeout=30)
        
        if resp.status_code == 200:
            data = resp.json().get('data', {})
            stages = data.get('stages', [])
            outputs = data.get('outputs', [])
            summary = data.get('summary', {})
            
            print(f"✅ Rendemen report retrieved")
            print(f"   - Stages count: {len(stages)}")
            print(f"   - Outputs count: {len(outputs)}")
            print(f"   - Base Weight: {summary.get('baseWeight')}")
            print(f"   - Total Output Weight: {summary.get('totalOutputWeight')}")
            print(f"   - Overall Rendemen %: {summary.get('overallRendemenPct')}")
            
            # Verify structure
            has_stages = len(stages) > 0
            has_outputs = len(outputs) > 0
            has_summary = 'overallRendemenPct' in summary
            
            # Verify overallRendemenPct calculation
            base_weight = summary.get('baseWeight', 0)
            total_output = summary.get('totalOutputWeight', 0)
            overall_pct = summary.get('overallRendemenPct', 0)
            
            expected_pct = (total_output / base_weight * 100) if base_weight > 0 else 0
            
            if has_stages and has_outputs and has_summary and abs(overall_pct - expected_pct) < 0.1:
                print(f"✅ Rendemen report structure and calculation correct")
                
                # Verify stages have yieldPct
                if stages and 'yieldPct' in stages[0]:
                    print(f"✅ Stages have yieldPct")
                    test_results["passed"] += 1
                    test_results["tests"].append("Rendemen report: PASS")
                else:
                    print(f"❌ Stages missing yieldPct")
                    test_results["failed"] += 1
                    test_results["tests"].append("Rendemen report: FAIL (yieldPct)")
            else:
                print(f"❌ Rendemen report structure or calculation incorrect")
                test_results["failed"] += 1
                test_results["tests"].append("Rendemen report: FAIL (structure)")
        else:
            print(f"❌ Failed to get rendemen report: {resp.status_code}")
            test_results["failed"] += 1
            test_results["tests"].append("Rendemen report: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        test_results["failed"] += 1
        test_results["tests"].append("Rendemen report: FAIL (exception)")

def test_rbac():
    """Test 13: RBAC on Work Orders"""
    print(f"\n{'='*60}")
    print("[TEST 13] RBAC on Work Orders")
    print(f"{'='*60}")
    
    try:
        rbac_passed = 0
        rbac_total = 0
        
        # Operator: cannot create WO
        operator_session = sessions.get('operator')
        if operator_session:
            rbac_total += 1
            resp = operator_session.post(f"{BASE_URL}/work-orders",
                                        json={"mode": "Internal", "baseCost": 1000000},
                                        timeout=30)
            if resp.status_code == 403:
                print(f"✅ Operator cannot create WO (403)")
                rbac_passed += 1
            else:
                print(f"❌ Operator create should return 403, got {resp.status_code}")
        
        # Operator: can record arrival
        if operator_session and test_data.get('wo_maklon_id'):
            rbac_total += 1
            resp = operator_session.post(f"{BASE_URL}/work-orders/{test_data['wo_maklon_id']}/arrival",
                                        json={"totalWeight": 100, "totalHeadCount": 100},
                                        timeout=30)
            if resp.status_code in [200, 400]:  # 200 or 400 (already recorded) both mean allowed
                print(f"✅ Operator can record arrival")
                rbac_passed += 1
            else:
                print(f"❌ Operator arrival should be allowed, got {resp.status_code}")
        
        # Operator: can record stage
        if operator_session and test_data.get('wo_maklon_id'):
            rbac_total += 1
            resp = operator_session.post(f"{BASE_URL}/work-orders/{test_data['wo_maklon_id']}/stage",
                                        json={"type": "pemotongan", "outputWeight": 0, "headCount": 100},
                                        timeout=30)
            if resp.status_code in [200, 201]:
                print(f"✅ Operator can record stage")
                rbac_passed += 1
            else:
                print(f"❌ Operator stage should be allowed, got {resp.status_code}")
        
        # Operator: can record outputs
        if operator_session and test_data.get('wo_maklon_id'):
            rbac_total += 1
            resp = operator_session.post(f"{BASE_URL}/work-orders/{test_data['wo_maklon_id']}/outputs",
                                        json={"outputs": [{"productId": test_data['krk_id'], "weight": 50, "coefficient": 1.0}]},
                                        timeout=30)
            if resp.status_code in [200, 201]:
                print(f"✅ Operator can record outputs")
                rbac_passed += 1
            else:
                print(f"❌ Operator outputs should be allowed, got {resp.status_code}")
        
        # Operator: cannot add costs
        if operator_session and test_data.get('wo_maklon_id'):
            rbac_total += 1
            resp = operator_session.post(f"{BASE_URL}/work-orders/{test_data['wo_maklon_id']}/costs",
                                        json={"name": "Test", "amount": 1000},
                                        timeout=30)
            if resp.status_code == 403:
                print(f"✅ Operator cannot add costs (403)")
                rbac_passed += 1
            else:
                print(f"❌ Operator costs should return 403, got {resp.status_code}")
        
        # Operator: cannot finalize
        if operator_session and test_data.get('wo_maklon_id'):
            rbac_total += 1
            resp = operator_session.post(f"{BASE_URL}/work-orders/{test_data['wo_maklon_id']}/finalize",
                                        json={"coldStorageId": test_data['cs_id']},
                                        timeout=30)
            if resp.status_code == 403:
                print(f"✅ Operator cannot finalize (403)")
                rbac_passed += 1
            else:
                print(f"❌ Operator finalize should return 403, got {resp.status_code}")
        
        # Direktur: can view
        direktur_session = sessions.get('direktur')
        if direktur_session:
            rbac_total += 1
            resp = direktur_session.get(f"{BASE_URL}/work-orders", timeout=30)
            if resp.status_code == 200:
                print(f"✅ Direktur can view WOs")
                rbac_passed += 1
            else:
                print(f"❌ Direktur view should return 200, got {resp.status_code}")
        
        # Direktur: cannot create
        if direktur_session:
            rbac_total += 1
            resp = direktur_session.post(f"{BASE_URL}/work-orders",
                                        json={"mode": "Internal", "baseCost": 1000000},
                                        timeout=30)
            if resp.status_code == 403:
                print(f"✅ Direktur cannot create WO (403)")
                rbac_passed += 1
            else:
                print(f"❌ Direktur create should return 403, got {resp.status_code}")
        
        if rbac_passed == rbac_total:
            test_results["passed"] += 1
            test_results["tests"].append("WO RBAC: PASS")
        else:
            print(f"❌ RBAC: {rbac_passed}/{rbac_total} passed")
            test_results["failed"] += 1
            test_results["tests"].append("WO RBAC: FAIL")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        test_results["failed"] += 1
        test_results["tests"].append("WO RBAC: FAIL (exception)")

def test_delete():
    """Test 14: DELETE Work Order"""
    print(f"\n{'='*60}")
    print("[TEST 14] DELETE /work-orders/:id")
    print(f"{'='*60}")
    
    session = sessions.get('admin')
    
    try:
        # Create fresh Draft WO
        wo_data = {"mode": "Internal", "startDate": "2025-06-16", "baseCost": 1000000}
        resp = session.post(f"{BASE_URL}/work-orders", json=wo_data, timeout=30)
        
        if resp.status_code == 201:
            draft_wo_id = resp.json().get('data', {}).get('id')
            
            # Try to delete non-Draft WO (should fail)
            resp2 = session.delete(f"{BASE_URL}/work-orders/{test_data['wo_internal_id']}",
                                  timeout=30)
            
            if resp2.status_code == 400:
                print(f"✅ Cannot delete non-Draft WO (400)")
                
                # Delete Draft WO as admin (should succeed)
                resp3 = session.delete(f"{BASE_URL}/work-orders/{draft_wo_id}", timeout=30)
                
                if resp3.status_code == 200:
                    print(f"✅ Draft WO deleted successfully")
                    
                    # Try as supervisor (should fail)
                    supervisor_session = sessions.get('supervisor')
                    if supervisor_session:
                        # Create another draft
                        resp4 = session.post(f"{BASE_URL}/work-orders", json=wo_data, timeout=30)
                        if resp4.status_code == 201:
                            draft_wo_id2 = resp4.json().get('data', {}).get('id')
                            
                            resp5 = supervisor_session.delete(f"{BASE_URL}/work-orders/{draft_wo_id2}",
                                                             timeout=30)
                            
                            if resp5.status_code == 403:
                                print(f"✅ Supervisor cannot delete WO (403)")
                                test_results["passed"] += 1
                                test_results["tests"].append("DELETE WO: PASS")
                            else:
                                print(f"❌ Supervisor delete should return 403, got {resp5.status_code}")
                                test_results["failed"] += 1
                                test_results["tests"].append("DELETE WO: FAIL (supervisor)")
                        else:
                            test_results["failed"] += 1
                            test_results["tests"].append("DELETE WO: FAIL (create test)")
                    else:
                        test_results["failed"] += 1
                        test_results["tests"].append("DELETE WO: FAIL (no supervisor)")
                else:
                    print(f"❌ Failed to delete draft WO: {resp3.status_code}")
                    test_results["failed"] += 1
                    test_results["tests"].append("DELETE WO: FAIL (delete)")
            else:
                print(f"❌ Delete non-draft should return 400, got {resp2.status_code}")
                test_results["failed"] += 1
                test_results["tests"].append("DELETE WO: FAIL (non-draft)")
        else:
            print(f"❌ Failed to create test WO: {resp.status_code}")
            test_results["failed"] += 1
            test_results["tests"].append("DELETE WO: FAIL (create)")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        test_results["failed"] += 1
        test_results["tests"].append("DELETE WO: FAIL (exception)")

def main():
    """Main test runner"""
    print(f"\n{'='*80}")
    print("🧪 WORK ORDERS (PRODUKSI/MAKLON) MODULE - COMPREHENSIVE BACKEND TESTING")
    print(f"{'='*80}")
    
    # Login all roles
    for role in ['admin', 'supervisor', 'direktur', 'operator']:
        login(role)
        time.sleep(0.5)
    
    # Get prep data
    if not get_prep_data():
        print("\n❌ Failed to get prep data. Exiting.")
        return
    
    # Run all tests
    test_create_internal_wo()
    test_create_maklon_wo()
    test_status_pipeline()
    test_arrival_internal()
    test_arrival_maklon()
    test_stages()
    test_custom_costs()
    test_outputs_balanced()
    test_outputs_unbalanced()
    test_get_hpp()
    test_finalize()
    test_rendemen_report()
    test_rbac()
    test_delete()
    
    # Print summary
    print(f"\n{'='*80}")
    print("📊 WORK ORDERS TEST SUMMARY")
    print(f"{'='*80}")
    print(f"✅ Passed: {test_results['passed']}")
    print(f"❌ Failed: {test_results['failed']}")
    print(f"Total: {test_results['passed'] + test_results['failed']}")
    print(f"\nTest Details:")
    for test in test_results['tests']:
        status = "✅" if "PASS" in test else "❌"
        print(f"  {status} {test}")
    
    print(f"\n{'='*80}")

if __name__ == "__main__":
    main()
