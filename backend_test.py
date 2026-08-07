#!/usr/bin/env python3
"""
Backend API Testing Script for LPI ERP
Tests TWO NEW features:
- FEATURE A: Auto-generate contact code (editable)
- FEATURE B: Contact document uploads
"""

import requests
import json
import io
from datetime import datetime
from http.cookiejar import Cookie

# Configuration
BASE_URL = "http://localhost:3000/api"

# Test credentials
ADMIN_EMAIL = "admin@lpi.co.id"
ADMIN_PASSWORD = "admin123"
OPERATOR_EMAIL = "operator@lpi.co.id"
OPERATOR_PASSWORD = "operator123"
DIREKTUR_EMAIL = "direktur@lpi.co.id"
DIREKTUR_PASSWORD = "direktur123"

class TestSession:
    def __init__(self, email, password):
        self.session = requests.Session()
        self.email = email
        self.password = password
        self.login()
    
    def login(self):
        """Login and establish session"""
        # Better Auth uses session cookies - the route is /api/auth/sign-in/email
        auth_url = f"{BASE_URL}/auth/sign-in/email"
        payload = {"email": self.email, "password": self.password}
        resp = self.session.post(auth_url, json=payload)
        if resp.status_code not in [200, 302]:
            raise Exception(f"Login failed for {self.email}: {resp.status_code} {resp.text}")
        # Extract the session token and create a new cookie without Secure flag
        for cookie in resp.cookies:
            if cookie.name == 'better-auth.session_token':
                # Create a new cookie without Secure flag for HTTP localhost
                new_cookie = Cookie(
                    version=0,
                    name='better-auth.session_token',
                    value=cookie.value,
                    port=None,
                    port_specified=False,
                    domain='localhost',
                    domain_specified=True,
                    domain_initial_dot=False,
                    path='/',
                    path_specified=True,
                    secure=False,  # Disable Secure flag for HTTP
                    expires=None,
                    discard=True,
                    comment=None,
                    comment_url=None,
                    rest={},
                    rfc2109=False
                )
                self.session.cookies.set_cookie(new_cookie)
                break
        print(f"✓ Logged in as {self.email}")
    
    def get(self, path):
        return self.session.get(f"{BASE_URL}{path}")
    
    def post(self, path, json_data=None, data=None, files=None):
        return self.session.post(f"{BASE_URL}{path}", json=json_data, data=data, files=files)
    
    def delete(self, path):
        return self.session.delete(f"{BASE_URL}{path}")

def test_feature_a_auto_generate_contact_code():
    """
    FEATURE A: Auto-generate contact code (editable)
    A1. GET /api/contacts/next-code?category=Supplier → 200, returns {code} matching regex ^SUP-\d{3}$.
    A2. GET /api/contacts/next-code?category=Customer → 200, code matches ^CUST-\d{3}$.
    A3. POST /api/contacts WITHOUT code: {categories:['Supplier'], displayName:'Auto Code Sup'} → 201. Response.data.code should be auto-generated matching ^SUP-\d{3}$ (non-empty).
    A4. Call GET next-code?category=Supplier again → the returned code should be DIFFERENT/incremented from the one just created (i.e., number went up), proving increment logic.
    A5. POST /api/contacts WITH explicit code: {categories:['Customer'], code:'MY-CUSTOM-001', displayName:'Explicit Code'} → 201, Response.data.code == 'MY-CUSTOM-001' (kept as-is).
    A6. POST again with the SAME explicit code 'MY-CUSTOM-001' {categories:['Customer'], displayName:'Dup Code'} → expect an error (not 201), because code is UNIQUE-constrained.
    """
    print("\n" + "="*80)
    print("FEATURE A: AUTO-GENERATE CONTACT CODE (EDITABLE)")
    print("="*80)
    
    admin = TestSession(ADMIN_EMAIL, ADMIN_PASSWORD)
    
    results = []
    
    # A1: GET next-code for Supplier
    print("\n[A1] GET /api/contacts/next-code?category=Supplier")
    try:
        resp = admin.get("/contacts/next-code?category=Supplier")
        print(f"  Status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            code = data.get('code', '')
            print(f"  Code: {code}")
            import re
            if re.match(r'^SUP-\d{3}$', code):
                print(f"  ✅ A1 PASSED: Code matches ^SUP-\\d{{3}}$ pattern")
                results.append(("A1", True, f"Code: {code}"))
            else:
                print(f"  ❌ A1 FAILED: Code does not match pattern. Got: {code}")
                results.append(("A1", False, f"Pattern mismatch: {code}"))
        else:
            print(f"  ❌ A1 FAILED: Expected 200, got {resp.status_code}")
            results.append(("A1", False, f"Status {resp.status_code}"))
    except Exception as e:
        print(f"  ❌ A1 FAILED: {e}")
        results.append(("A1", False, str(e)))
    
    # A2: GET next-code for Customer
    print("\n[A2] GET /api/contacts/next-code?category=Customer")
    try:
        resp = admin.get("/contacts/next-code?category=Customer")
        print(f"  Status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            code = data.get('code', '')
            print(f"  Code: {code}")
            import re
            if re.match(r'^CUST-\d{3}$', code):
                print(f"  ✅ A2 PASSED: Code matches ^CUST-\\d{{3}}$ pattern")
                results.append(("A2", True, f"Code: {code}"))
            else:
                print(f"  ❌ A2 FAILED: Code does not match pattern. Got: {code}")
                results.append(("A2", False, f"Pattern mismatch: {code}"))
        else:
            print(f"  ❌ A2 FAILED: Expected 200, got {resp.status_code}")
            results.append(("A2", False, f"Status {resp.status_code}"))
    except Exception as e:
        print(f"  ❌ A2 FAILED: {e}")
        results.append(("A2", False, str(e)))
    
    # A3: POST contact WITHOUT code (auto-generate)
    print("\n[A3] POST /api/contacts WITHOUT code (auto-generate)")
    try:
        payload = {
            "categories": ["Supplier"],
            "displayName": "Auto Code Sup"
        }
        resp = admin.post("/contacts", json_data=payload)
        print(f"  Status: {resp.status_code}")
        if resp.status_code == 201:
            data = resp.json().get('data', {})
            code = data.get('code', '')
            print(f"  Generated Code: {code}")
            import re
            if code and re.match(r'^SUP-\d{3}$', code):
                print(f"  ✅ A3 PASSED: Auto-generated code matches ^SUP-\\d{{3}}$ pattern")
                results.append(("A3", True, f"Code: {code}"))
                # Store for A4
                a3_code = code
            else:
                print(f"  ❌ A3 FAILED: Code does not match pattern or is empty. Got: {code}")
                results.append(("A3", False, f"Pattern mismatch: {code}"))
                a3_code = None
        else:
            print(f"  ❌ A3 FAILED: Expected 201, got {resp.status_code}")
            print(f"  Response: {resp.text}")
            results.append(("A3", False, f"Status {resp.status_code}"))
            a3_code = None
    except Exception as e:
        print(f"  ❌ A3 FAILED: {e}")
        results.append(("A3", False, str(e)))
        a3_code = None
    
    # A4: GET next-code again and verify it's incremented
    print("\n[A4] GET /api/contacts/next-code?category=Supplier (verify increment)")
    try:
        resp = admin.get("/contacts/next-code?category=Supplier")
        print(f"  Status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            new_code = data.get('code', '')
            print(f"  New Code: {new_code}")
            print(f"  Previous Code (A3): {a3_code}")
            if a3_code and new_code != a3_code:
                # Extract numbers and compare
                import re
                prev_num = int(re.search(r'\d+', a3_code).group())
                new_num = int(re.search(r'\d+', new_code).group())
                if new_num > prev_num:
                    print(f"  ✅ A4 PASSED: Code incremented from {a3_code} to {new_code}")
                    results.append(("A4", True, f"Incremented: {a3_code} → {new_code}"))
                else:
                    print(f"  ❌ A4 FAILED: Code did not increment. {a3_code} → {new_code}")
                    results.append(("A4", False, f"No increment: {a3_code} → {new_code}"))
            else:
                print(f"  ❌ A4 FAILED: Code did not change or A3 failed")
                results.append(("A4", False, "Code unchanged or A3 failed"))
        else:
            print(f"  ❌ A4 FAILED: Expected 200, got {resp.status_code}")
            results.append(("A4", False, f"Status {resp.status_code}"))
    except Exception as e:
        print(f"  ❌ A4 FAILED: {e}")
        results.append(("A4", False, str(e)))
    
    # A5: POST contact WITH explicit code
    print("\n[A5] POST /api/contacts WITH explicit code")
    try:
        payload = {
            "categories": ["Customer"],
            "code": "MY-CUSTOM-001",
            "displayName": "Explicit Code"
        }
        resp = admin.post("/contacts", json_data=payload)
        print(f"  Status: {resp.status_code}")
        if resp.status_code == 201:
            data = resp.json().get('data', {})
            code = data.get('code', '')
            print(f"  Code: {code}")
            if code == "MY-CUSTOM-001":
                print(f"  ✅ A5 PASSED: Explicit code kept as-is")
                results.append(("A5", True, f"Code: {code}"))
            else:
                print(f"  ❌ A5 FAILED: Code mismatch. Expected MY-CUSTOM-001, got {code}")
                results.append(("A5", False, f"Code mismatch: {code}"))
        else:
            print(f"  ❌ A5 FAILED: Expected 201, got {resp.status_code}")
            print(f"  Response: {resp.text}")
            results.append(("A5", False, f"Status {resp.status_code}"))
    except Exception as e:
        print(f"  ❌ A5 FAILED: {e}")
        results.append(("A5", False, str(e)))
    
    # A6: POST with duplicate explicit code (should fail)
    print("\n[A6] POST /api/contacts with DUPLICATE explicit code (should fail)")
    try:
        payload = {
            "categories": ["Customer"],
            "code": "MY-CUSTOM-001",
            "displayName": "Dup Code"
        }
        resp = admin.post("/contacts", json_data=payload)
        print(f"  Status: {resp.status_code}")
        if resp.status_code != 201:
            print(f"  ✅ A6 PASSED: Duplicate code rejected (status {resp.status_code})")
            print(f"  Error: {resp.text}")
            results.append(("A6", True, f"Rejected with {resp.status_code}"))
        else:
            print(f"  ❌ A6 FAILED: Duplicate code was accepted (201)")
            results.append(("A6", False, "Duplicate accepted"))
    except Exception as e:
        print(f"  ❌ A6 FAILED: {e}")
        results.append(("A6", False, str(e)))
    
    return results

def test_feature_b_contact_document_uploads():
    """
    FEATURE B: Contact document uploads
    Setup: create a contact P: POST /api/contacts {categories:['Customer'], displayName:'Doc Owner'} → note P.id.
    
    B1. Upload (multipart/form-data) POST /api/contacts/{P.id}/documents with fields: file=(a small file, e.g. filename 'npwp.png' with a few bytes of PNG or text content) and docType='NPWP' → expect 201. Response.data should have docType=='NPWP', fileName, storedName, size>0, mimeType.
    B2. GET /api/contacts/{P.id}/documents → 200, list contains the uploaded doc.
    B3. GET /api/contacts/{P.id}/documents/{docId}/file → 200, returns the raw file bytes with a Content-Type header (verify status 200 and non-empty body).
    B4. Upload with invalid docType: POST multipart {file=..., docType='RandomType'} → 201 but Response.data.docType coerced to 'Lainnya'.
    B5. Upload with NO file (multipart with only docType) → expect 400 "File wajib diunggah" (or similar).
    B6. DELETE /api/contacts/{P.id}/documents/{docId} for one uploaded doc → 200. Then GET list no longer contains it.
    B7. RBAC: 
       - operator POST /api/contacts/{P.id}/documents (multipart with file) → 403.
       - direktur POST → 403.
       - direktur GET /api/contacts/{P.id}/documents → 200.
    """
    print("\n" + "="*80)
    print("FEATURE B: CONTACT DOCUMENT UPLOADS")
    print("="*80)
    
    admin = TestSession(ADMIN_EMAIL, ADMIN_PASSWORD)
    operator = TestSession(OPERATOR_EMAIL, OPERATOR_PASSWORD)
    direktur = TestSession(DIREKTUR_EMAIL, DIREKTUR_PASSWORD)
    
    results = []
    
    # Setup: Create a contact
    print("\n[SETUP] Creating contact 'Doc Owner'")
    try:
        payload = {
            "categories": ["Customer"],
            "displayName": "Doc Owner"
        }
        resp = admin.post("/contacts", json_data=payload)
        print(f"  Status: {resp.status_code}")
        if resp.status_code == 201:
            contact_data = resp.json().get('data', {})
            contact_id = contact_data.get('id')
            print(f"  ✓ Contact created: {contact_id}")
        else:
            print(f"  ✗ Failed to create contact: {resp.status_code}")
            print(f"  Response: {resp.text}")
            return [("SETUP", False, "Failed to create contact")]
    except Exception as e:
        print(f"  ✗ Setup failed: {e}")
        return [("SETUP", False, str(e))]
    
    # B1: Upload document with valid docType
    print("\n[B1] Upload document with docType='NPWP'")
    try:
        # Create a small PNG file (minimal valid PNG)
        png_bytes = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
        files = {'file': ('npwp.png', png_bytes, 'image/png')}
        data = {'docType': 'NPWP'}
        resp = admin.post(f"/contacts/{contact_id}/documents", data=data, files=files)
        print(f"  Status: {resp.status_code}")
        if resp.status_code == 201:
            doc_data = resp.json().get('data', {})
            doc_id = doc_data.get('id')
            doc_type = doc_data.get('docType')
            file_name = doc_data.get('fileName')
            stored_name = doc_data.get('storedName')
            size = doc_data.get('size')
            mime_type = doc_data.get('mimeType')
            print(f"  docType: {doc_type}")
            print(f"  fileName: {file_name}")
            print(f"  storedName: {stored_name}")
            print(f"  size: {size}")
            print(f"  mimeType: {mime_type}")
            if doc_type == 'NPWP' and file_name and stored_name and size > 0 and mime_type:
                print(f"  ✅ B1 PASSED: Document uploaded successfully")
                results.append(("B1", True, f"docId: {doc_id}"))
                b1_doc_id = doc_id
            else:
                print(f"  ❌ B1 FAILED: Missing or invalid fields")
                results.append(("B1", False, "Invalid response data"))
                b1_doc_id = None
        else:
            print(f"  ❌ B1 FAILED: Expected 201, got {resp.status_code}")
            print(f"  Response: {resp.text}")
            results.append(("B1", False, f"Status {resp.status_code}"))
            b1_doc_id = None
    except Exception as e:
        print(f"  ❌ B1 FAILED: {e}")
        results.append(("B1", False, str(e)))
        b1_doc_id = None
    
    # B2: GET list of documents
    print("\n[B2] GET /api/contacts/{contact_id}/documents")
    try:
        resp = admin.get(f"/contacts/{contact_id}/documents")
        print(f"  Status: {resp.status_code}")
        if resp.status_code == 200:
            docs = resp.json().get('data', [])
            print(f"  Documents count: {len(docs)}")
            if b1_doc_id and any(d.get('id') == b1_doc_id for d in docs):
                print(f"  ✅ B2 PASSED: Uploaded document found in list")
                results.append(("B2", True, f"Found {len(docs)} docs"))
            else:
                print(f"  ❌ B2 FAILED: Uploaded document not found in list")
                results.append(("B2", False, "Document not in list"))
        else:
            print(f"  ❌ B2 FAILED: Expected 200, got {resp.status_code}")
            results.append(("B2", False, f"Status {resp.status_code}"))
    except Exception as e:
        print(f"  ❌ B2 FAILED: {e}")
        results.append(("B2", False, str(e)))
    
    # B3: GET document file
    print("\n[B3] GET /api/contacts/{contact_id}/documents/{doc_id}/file")
    try:
        if b1_doc_id:
            resp = admin.get(f"/contacts/{contact_id}/documents/{b1_doc_id}/file")
            print(f"  Status: {resp.status_code}")
            if resp.status_code == 200:
                content_type = resp.headers.get('Content-Type', '')
                content_length = len(resp.content)
                print(f"  Content-Type: {content_type}")
                print(f"  Content-Length: {content_length}")
                if content_length > 0:
                    print(f"  ✅ B3 PASSED: File downloaded successfully")
                    results.append(("B3", True, f"Size: {content_length} bytes"))
                else:
                    print(f"  ❌ B3 FAILED: Empty file content")
                    results.append(("B3", False, "Empty content"))
            else:
                print(f"  ❌ B3 FAILED: Expected 200, got {resp.status_code}")
                results.append(("B3", False, f"Status {resp.status_code}"))
        else:
            print(f"  ⏭️  B3 SKIPPED: No document ID from B1")
            results.append(("B3", False, "Skipped - B1 failed"))
    except Exception as e:
        print(f"  ❌ B3 FAILED: {e}")
        results.append(("B3", False, str(e)))
    
    # B4: Upload with invalid docType (should coerce to 'Lainnya')
    print("\n[B4] Upload with invalid docType='RandomType' (should coerce to 'Lainnya')")
    try:
        txt_bytes = b'Test document content'
        files = {'file': ('test.txt', txt_bytes, 'text/plain')}
        data = {'docType': 'RandomType'}
        resp = admin.post(f"/contacts/{contact_id}/documents", data=data, files=files)
        print(f"  Status: {resp.status_code}")
        if resp.status_code == 201:
            doc_data = resp.json().get('data', {})
            doc_type = doc_data.get('docType')
            print(f"  docType: {doc_type}")
            if doc_type == 'Lainnya':
                print(f"  ✅ B4 PASSED: Invalid docType coerced to 'Lainnya'")
                results.append(("B4", True, "Coerced to Lainnya"))
            else:
                print(f"  ❌ B4 FAILED: docType not coerced. Got: {doc_type}")
                results.append(("B4", False, f"Got: {doc_type}"))
        else:
            print(f"  ❌ B4 FAILED: Expected 201, got {resp.status_code}")
            results.append(("B4", False, f"Status {resp.status_code}"))
    except Exception as e:
        print(f"  ❌ B4 FAILED: {e}")
        results.append(("B4", False, str(e)))
    
    # B5: Upload with NO file (should fail with 400)
    print("\n[B5] Upload with NO file (should fail with 400)")
    try:
        data = {'docType': 'NPWP'}
        resp = admin.post(f"/contacts/{contact_id}/documents", data=data)
        print(f"  Status: {resp.status_code}")
        if resp.status_code == 400:
            error_msg = resp.json().get('error', '')
            print(f"  Error: {error_msg}")
            if 'wajib' in error_msg.lower() or 'file' in error_msg.lower():
                print(f"  ✅ B5 PASSED: Upload without file rejected")
                results.append(("B5", True, f"Error: {error_msg}"))
            else:
                print(f"  ⚠️  B5 PASSED: Rejected but unexpected error message")
                results.append(("B5", True, f"Error: {error_msg}"))
        else:
            print(f"  ❌ B5 FAILED: Expected 400, got {resp.status_code}")
            results.append(("B5", False, f"Status {resp.status_code}"))
    except Exception as e:
        print(f"  ❌ B5 FAILED: {e}")
        results.append(("B5", False, str(e)))
    
    # B6: DELETE document
    print("\n[B6] DELETE /api/contacts/{contact_id}/documents/{doc_id}")
    try:
        if b1_doc_id:
            resp = admin.delete(f"/contacts/{contact_id}/documents/{b1_doc_id}")
            print(f"  Status: {resp.status_code}")
            if resp.status_code == 200:
                # Verify it's gone
                resp2 = admin.get(f"/contacts/{contact_id}/documents")
                if resp2.status_code == 200:
                    docs = resp2.json().get('data', [])
                    if not any(d.get('id') == b1_doc_id for d in docs):
                        print(f"  ✅ B6 PASSED: Document deleted successfully")
                        results.append(("B6", True, "Deleted"))
                    else:
                        print(f"  ❌ B6 FAILED: Document still in list after delete")
                        results.append(("B6", False, "Still in list"))
                else:
                    print(f"  ⚠️  B6 PARTIAL: Delete succeeded but couldn't verify")
                    results.append(("B6", True, "Delete OK, verify failed"))
            else:
                print(f"  ❌ B6 FAILED: Expected 200, got {resp.status_code}")
                results.append(("B6", False, f"Status {resp.status_code}"))
        else:
            print(f"  ⏭️  B6 SKIPPED: No document ID from B1")
            results.append(("B6", False, "Skipped - B1 failed"))
    except Exception as e:
        print(f"  ❌ B6 FAILED: {e}")
        results.append(("B6", False, str(e)))
    
    # B7: RBAC tests
    print("\n[B7] RBAC Tests")
    
    # B7.1: Operator POST (should fail with 403)
    print("\n  [B7.1] Operator POST document (should fail with 403)")
    try:
        png_bytes = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
        files = {'file': ('test.png', png_bytes, 'image/png')}
        data = {'docType': 'NPWP'}
        resp = operator.post(f"/contacts/{contact_id}/documents", data=data, files=files)
        print(f"    Status: {resp.status_code}")
        if resp.status_code == 403:
            print(f"    ✅ B7.1 PASSED: Operator POST rejected")
            results.append(("B7.1", True, "Operator denied"))
        else:
            print(f"    ❌ B7.1 FAILED: Expected 403, got {resp.status_code}")
            results.append(("B7.1", False, f"Status {resp.status_code}"))
    except Exception as e:
        print(f"    ❌ B7.1 FAILED: {e}")
        results.append(("B7.1", False, str(e)))
    
    # B7.2: Direktur POST (should fail with 403)
    print("\n  [B7.2] Direktur POST document (should fail with 403)")
    try:
        png_bytes = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
        files = {'file': ('test.png', png_bytes, 'image/png')}
        data = {'docType': 'NPWP'}
        resp = direktur.post(f"/contacts/{contact_id}/documents", data=data, files=files)
        print(f"    Status: {resp.status_code}")
        if resp.status_code == 403:
            print(f"    ✅ B7.2 PASSED: Direktur POST rejected")
            results.append(("B7.2", True, "Direktur denied"))
        else:
            print(f"    ❌ B7.2 FAILED: Expected 403, got {resp.status_code}")
            results.append(("B7.2", False, f"Status {resp.status_code}"))
    except Exception as e:
        print(f"    ❌ B7.2 FAILED: {e}")
        results.append(("B7.2", False, str(e)))
    
    # B7.3: Direktur GET (should succeed with 200)
    print("\n  [B7.3] Direktur GET documents (should succeed with 200)")
    try:
        resp = direktur.get(f"/contacts/{contact_id}/documents")
        print(f"    Status: {resp.status_code}")
        if resp.status_code == 200:
            print(f"    ✅ B7.3 PASSED: Direktur GET allowed")
            results.append(("B7.3", True, "Direktur can view"))
        else:
            print(f"    ❌ B7.3 FAILED: Expected 200, got {resp.status_code}")
            results.append(("B7.3", False, f"Status {resp.status_code}"))
    except Exception as e:
        print(f"    ❌ B7.3 FAILED: {e}")
        results.append(("B7.3", False, str(e)))
    
    return results

def print_summary(feature_a_results, feature_b_results):
    """Print test summary"""
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    all_results = feature_a_results + feature_b_results
    passed = sum(1 for _, status, _ in all_results if status)
    total = len(all_results)
    
    print(f"\nTotal: {passed}/{total} tests passed ({passed*100//total}%)")
    
    print("\n--- FEATURE A: Auto-generate contact code ---")
    for test_id, status, detail in feature_a_results:
        icon = "✅" if status else "❌"
        print(f"{icon} {test_id}: {detail}")
    
    print("\n--- FEATURE B: Contact document uploads ---")
    for test_id, status, detail in feature_b_results:
        icon = "✅" if status else "❌"
        print(f"{icon} {test_id}: {detail}")
    
    # Determine overall status
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
        return True
    else:
        failed = total - passed
        print(f"\n⚠️  {failed} TEST(S) FAILED")
        return False

if __name__ == "__main__":
    print("="*80)
    print("LPI ERP BACKEND API TESTING")
    print("Testing TWO NEW Features:")
    print("  - FEATURE A: Auto-generate contact code (editable)")
    print("  - FEATURE B: Contact document uploads")
    print("="*80)
    
    try:
        # Run tests
        feature_a_results = test_feature_a_auto_generate_contact_code()
        feature_b_results = test_feature_b_contact_document_uploads()
        
        # Print summary
        all_passed = print_summary(feature_a_results, feature_b_results)
        
        # Exit with appropriate code
        exit(0 if all_passed else 1)
        
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
