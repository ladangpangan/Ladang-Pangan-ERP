#!/usr/bin/env python3
"""
Backend test for Contact Document Uploads (Feature B only)
Re-testing after variable-shadowing bug fix (path → nodePath)
"""

import requests
import json
import io
from typing import Dict, Any

BASE_URL = "http://localhost:3000/api"

# Test credentials
ADMIN_CREDS = {"email": "admin@lpi.co.id", "password": "admin123"}
OPERATOR_CREDS = {"email": "operator@lpi.co.id", "password": "operator123"}
DIREKTUR_CREDS = {"email": "direktur@lpi.co.id", "password": "direktur123"}

def login(email: str, password: str) -> requests.Session:
    """Login and return authenticated session"""
    print(f"Logging in as {email}...")
    auth_url = "http://localhost:3000/api/auth/sign-in/email"
    
    session = requests.Session()
    try:
        resp = session.post(
            auth_url,
            json={"email": email, "password": password},
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        if resp.status_code == 200:
            # Fix Secure cookie issue for HTTP localhost testing
            # The cookie has Secure=True but we're using HTTP, so we need to override it
            for cookie in session.cookies:
                cookie.secure = False
            print(f"✅ Login successful for {email}")
            return session
        else:
            print(f"❌ Login failed for {email}: {resp.status_code} - {resp.text[:200]}")
            return session
    except Exception as e:
        print(f"❌ Login error for {email}: {e}")
        return session

def test_feature_b_document_uploads():
    """Test Feature B: Contact Document Uploads"""
    
    print("\n" + "="*80)
    print("FEATURE B: CONTACT DOCUMENT UPLOADS - TESTING AFTER BUG FIX")
    print("="*80)
    
    # Login as admin
    admin_session = login(ADMIN_CREDS["email"], ADMIN_CREDS["password"])
    
    # SETUP: Create a contact P
    print("\n--- SETUP: Create test contact ---")
    try:
        import time
        contact_data = {
            "categories": ["Customer"],
            "displayName": "Doc Owner FINAL",
            "code": f"DOC-FINAL-{int(time.time()) % 100000}"
        }
        resp = admin_session.post(f"{BASE_URL}/contacts", json=contact_data, timeout=10)
        print(f"POST /api/contacts: {resp.status_code}")
        
        if resp.status_code == 201:
            contact = resp.json().get("data", {})
            contact_id = contact.get("id")
            print(f"✅ Contact created: ID={contact_id}, Code={contact.get('code')}")
        else:
            print(f"❌ Failed to create contact: {resp.text[:200]}")
            return
    except Exception as e:
        print(f"❌ Setup error: {e}")
        return
    
    # Test counters
    tests_passed = 0
    tests_failed = 0
    
    # B1: Upload with valid docType='NPWP'
    print("\n--- B1: Upload document with docType='NPWP' ---")
    try:
        # Create a small PNG-like file (just some bytes)
        file_bytes = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
        
        files = {'file': ('npwp.png', io.BytesIO(file_bytes), 'image/png')}
        data = {'docType': 'NPWP'}
        
        resp = admin_session.post(
            f"{BASE_URL}/contacts/{contact_id}/documents",
            files=files,
            data=data,
            timeout=10
        )
        
        print(f"POST /api/contacts/{contact_id}/documents: {resp.status_code}")
        
        if resp.status_code == 201:
            doc = resp.json().get("data", {})
            doc_id_b1 = doc.get("id")
            
            # Verify response fields
            checks = [
                ("docType", doc.get("docType") == "NPWP"),
                ("size > 0", doc.get("size", 0) > 0),
                ("fileName present", bool(doc.get("fileName"))),
                ("storedName present", bool(doc.get("storedName"))),
            ]
            
            all_passed = all(check[1] for check in checks)
            
            for check_name, passed in checks:
                status = "✓" if passed else "✗"
                print(f"  {status} {check_name}: {doc.get(check_name.split()[0]) if ' ' not in check_name else 'checked'}")
            
            if all_passed:
                print(f"✅ B1 PASSED: Document uploaded successfully")
                print(f"   - docId: {doc_id_b1}")
                print(f"   - docType: {doc.get('docType')}")
                print(f"   - size: {doc.get('size')} bytes")
                print(f"   - fileName: {doc.get('fileName')}")
                tests_passed += 1
            else:
                print(f"❌ B1 FAILED: Response validation failed")
                tests_failed += 1
        else:
            print(f"❌ B1 FAILED: Expected 201, got {resp.status_code}")
            print(f"   Response: {resp.text[:300]}")
            tests_failed += 1
            doc_id_b1 = None
    except Exception as e:
        print(f"❌ B1 FAILED: Exception - {e}")
        tests_failed += 1
        doc_id_b1 = None
    
    # B2: GET list of documents
    print("\n--- B2: GET list of documents ---")
    try:
        resp = admin_session.get(f"{BASE_URL}/contacts/{contact_id}/documents", timeout=10)
        print(f"GET /api/contacts/{contact_id}/documents: {resp.status_code}")
        
        if resp.status_code == 200:
            docs = resp.json().get("data", [])
            found = any(d.get("id") == doc_id_b1 for d in docs) if doc_id_b1 else False
            
            if found:
                print(f"✅ B2 PASSED: Document list contains uploaded doc")
                print(f"   - Total documents: {len(docs)}")
                tests_passed += 1
            else:
                print(f"❌ B2 FAILED: Uploaded document not found in list")
                print(f"   - Documents returned: {len(docs)}")
                tests_failed += 1
        else:
            print(f"❌ B2 FAILED: Expected 200, got {resp.status_code}")
            print(f"   Response: {resp.text[:300]}")
            tests_failed += 1
    except Exception as e:
        print(f"❌ B2 FAILED: Exception - {e}")
        tests_failed += 1
    
    # B3: GET document file
    print("\n--- B3: GET document file (stream) ---")
    if doc_id_b1:
        try:
            resp = admin_session.get(
                f"{BASE_URL}/contacts/{contact_id}/documents/{doc_id_b1}/file",
                timeout=10
            )
            print(f"GET /api/contacts/{contact_id}/documents/{doc_id_b1}/file: {resp.status_code}")
            
            if resp.status_code == 200:
                content_type = resp.headers.get("Content-Type", "")
                content_length = len(resp.content)
                
                checks = [
                    ("Status 200", True),
                    ("Non-empty body", content_length > 0),
                    ("Has Content-Type", bool(content_type)),
                ]
                
                all_passed = all(check[1] for check in checks)
                
                for check_name, passed in checks:
                    status = "✓" if passed else "✗"
                    print(f"  {status} {check_name}")
                
                print(f"   - Content-Type: {content_type}")
                print(f"   - Content-Length: {content_length} bytes")
                
                if all_passed:
                    print(f"✅ B3 PASSED: Document file retrieved successfully")
                    tests_passed += 1
                else:
                    print(f"❌ B3 FAILED: Validation failed")
                    tests_failed += 1
            else:
                print(f"❌ B3 FAILED: Expected 200, got {resp.status_code}")
                print(f"   Response: {resp.text[:300]}")
                tests_failed += 1
        except Exception as e:
            print(f"❌ B3 FAILED: Exception - {e}")
            tests_failed += 1
    else:
        print("⏭️  B3 SKIPPED: No document ID from B1")
        tests_failed += 1
    
    # B4: Upload with invalid docType (should be coerced to 'Lainnya')
    print("\n--- B4: Upload with invalid docType='RandomType' ---")
    try:
        file_bytes = b'Test file content for invalid docType'
        files = {'file': ('test.txt', io.BytesIO(file_bytes), 'text/plain')}
        data = {'docType': 'RandomType'}
        
        resp = admin_session.post(
            f"{BASE_URL}/contacts/{contact_id}/documents",
            files=files,
            data=data,
            timeout=10
        )
        
        print(f"POST /api/contacts/{contact_id}/documents: {resp.status_code}")
        
        if resp.status_code == 201:
            doc = resp.json().get("data", {})
            doc_id_b4 = doc.get("id")
            doc_type = doc.get("docType")
            
            if doc_type == "Lainnya":
                print(f"✅ B4 PASSED: Invalid docType coerced to 'Lainnya'")
                print(f"   - docId: {doc_id_b4}")
                print(f"   - docType: {doc_type}")
                tests_passed += 1
            else:
                print(f"❌ B4 FAILED: Expected docType='Lainnya', got '{doc_type}'")
                tests_failed += 1
        else:
            print(f"❌ B4 FAILED: Expected 201, got {resp.status_code}")
            print(f"   Response: {resp.text[:300]}")
            tests_failed += 1
            doc_id_b4 = None
    except Exception as e:
        print(f"❌ B4 FAILED: Exception - {e}")
        tests_failed += 1
        doc_id_b4 = None
    
    # B5: Upload with NO file (should fail with 400)
    print("\n--- B5: Upload with NO file (only docType) ---")
    try:
        data = {'docType': 'NPWP'}
        # No files parameter
        
        resp = admin_session.post(
            f"{BASE_URL}/contacts/{contact_id}/documents",
            data=data,
            timeout=10
        )
        
        print(f"POST /api/contacts/{contact_id}/documents: {resp.status_code}")
        
        if resp.status_code == 400:
            error_msg = resp.json().get("error", "")
            print(f"✅ B5 PASSED: Upload without file rejected with 400")
            print(f"   - Error message: {error_msg}")
            tests_passed += 1
        else:
            print(f"❌ B5 FAILED: Expected 400, got {resp.status_code}")
            print(f"   Response: {resp.text[:300]}")
            tests_failed += 1
    except Exception as e:
        print(f"❌ B5 FAILED: Exception - {e}")
        tests_failed += 1
    
    # B6: DELETE document
    print("\n--- B6: DELETE document ---")
    if doc_id_b1:
        try:
            # Delete the document
            resp = admin_session.delete(
                f"{BASE_URL}/contacts/{contact_id}/documents/{doc_id_b1}",
                timeout=10
            )
            print(f"DELETE /api/contacts/{contact_id}/documents/{doc_id_b1}: {resp.status_code}")
            
            if resp.status_code == 200:
                # Verify it's no longer in the list
                resp_list = admin_session.get(f"{BASE_URL}/contacts/{contact_id}/documents", timeout=10)
                docs = resp_list.json().get("data", [])
                still_exists = any(d.get("id") == doc_id_b1 for d in docs)
                
                if not still_exists:
                    print(f"✅ B6 PASSED: Document deleted successfully")
                    print(f"   - Document no longer in list")
                    tests_passed += 1
                else:
                    print(f"❌ B6 FAILED: Document still exists in list after deletion")
                    tests_failed += 1
            else:
                print(f"❌ B6 FAILED: Expected 200, got {resp.status_code}")
                print(f"   Response: {resp.text[:300]}")
                tests_failed += 1
        except Exception as e:
            print(f"❌ B6 FAILED: Exception - {e}")
            tests_failed += 1
    else:
        print("⏭️  B6 SKIPPED: No document ID from B1")
        tests_failed += 1
    
    # B7: RBAC tests
    print("\n--- B7: RBAC tests ---")
    
    # B7.1: Operator POST (should fail with 403)
    print("\n  B7.1: Operator POST (should be 403)")
    try:
        operator_session = login(OPERATOR_CREDS["email"], OPERATOR_CREDS["password"])
        
        file_bytes = b'Operator test file'
        files = {'file': ('operator.txt', io.BytesIO(file_bytes), 'text/plain')}
        data = {'docType': 'NPWP'}
        
        resp = operator_session.post(
            f"{BASE_URL}/contacts/{contact_id}/documents",
            files=files,
            data=data,
            timeout=10
        )
        
        print(f"  POST as operator: {resp.status_code}")
        
        if resp.status_code == 403:
            print(f"  ✅ B7.1 PASSED: Operator POST correctly denied (403)")
            tests_passed += 1
        else:
            print(f"  ❌ B7.1 FAILED: Expected 403, got {resp.status_code}")
            tests_failed += 1
    except Exception as e:
        print(f"  ❌ B7.1 FAILED: Exception - {e}")
        tests_failed += 1
    
    # B7.2: Direktur POST (should fail with 403)
    print("\n  B7.2: Direktur POST (should be 403)")
    try:
        direktur_session = login(DIREKTUR_CREDS["email"], DIREKTUR_CREDS["password"])
        
        file_bytes = b'Direktur test file'
        files = {'file': ('direktur.txt', io.BytesIO(file_bytes), 'text/plain')}
        data = {'docType': 'NPWP'}
        
        resp = direktur_session.post(
            f"{BASE_URL}/contacts/{contact_id}/documents",
            files=files,
            data=data,
            timeout=10
        )
        
        print(f"  POST as direktur: {resp.status_code}")
        
        if resp.status_code == 403:
            print(f"  ✅ B7.2 PASSED: Direktur POST correctly denied (403)")
            tests_passed += 1
        else:
            print(f"  ❌ B7.2 FAILED: Expected 403, got {resp.status_code}")
            tests_failed += 1
    except Exception as e:
        print(f"  ❌ B7.2 FAILED: Exception - {e}")
        tests_failed += 1
    
    # B7.3: Direktur GET (should succeed with 200)
    print("\n  B7.3: Direktur GET list (should be 200)")
    try:
        resp = direktur_session.get(f"{BASE_URL}/contacts/{contact_id}/documents", timeout=10)
        print(f"  GET as direktur: {resp.status_code}")
        
        if resp.status_code == 200:
            docs = resp.json().get("data", [])
            print(f"  ✅ B7.3 PASSED: Direktur GET correctly allowed (200)")
            print(f"     - Documents visible: {len(docs)}")
            tests_passed += 1
        else:
            print(f"  ❌ B7.3 FAILED: Expected 200, got {resp.status_code}")
            tests_failed += 1
    except Exception as e:
        print(f"  ❌ B7.3 FAILED: Exception - {e}")
        tests_failed += 1
    
    # Summary
    print("\n" + "="*80)
    print("FEATURE B TEST SUMMARY")
    print("="*80)
    total_tests = tests_passed + tests_failed
    print(f"Total tests: {total_tests}")
    print(f"✅ Passed: {tests_passed}")
    print(f"❌ Failed: {tests_failed}")
    print(f"Success rate: {(tests_passed/total_tests*100) if total_tests > 0 else 0:.1f}%")
    
    if tests_failed == 0:
        print("\n🎉 ALL TESTS PASSED - Feature B is working correctly!")
    else:
        print(f"\n⚠️  {tests_failed} test(s) failed - see details above")
    
    print("="*80)

if __name__ == "__main__":
    test_feature_b_document_uploads()
