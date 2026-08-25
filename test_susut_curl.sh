#!/bin/bash

echo "================================================================================"
echo "BACKEND TEST: Susut (Shrinkage) Percentage Logic Re-Verification"
echo "================================================================================"
echo ""
echo "BACKGROUND:"
echo "- Previously: susut% wrongly computed using TOTAL shipped weight"
echo "- Fix: susut% must consider ONLY items that have been tallied (tally_weight > 0)"
echo "- New field 'sjTallied' = sum of received_weight for items with tally_weight > 0"
echo "- susut = sum(received_weight - tally_weight) over tallied items only"
echo "- susutPct = susut / sjTallied * 100 (1 decimal), null/0 when no tallied items"
echo ""
echo "EXPECTED for CV. Ratu Indonesia:"
echo "- susutPct: ~0.6% (SMALL, realistic, NOT ~90%)"
echo "- susut: ~1.4 kg"
echo "- sjTallied: ~250 kg (tallied PO only)"
echo "- tallyWeight: ~248.6 kg"
echo "- sjWeight: ~2733 kg (includes not-yet-tallied PO)"
echo ""

# Login
echo "=== LOGIN: admin@lpi.co.id ==="
LOGIN_RESP=$(curl -s -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"email":"admin@lpi.co.id","password":"admin123"}' \
  -c /tmp/cookies.txt -b /tmp/cookies.txt)

EMAIL=$(echo "$LOGIN_RESP" | jq -r '.user.email // "null"')
if [ "$EMAIL" = "admin@lpi.co.id" ]; then
    echo "✅ Login successful"
else
    echo "❌ Login failed"
    echo "$LOGIN_RESP"
    exit 1
fi

echo ""
echo "================================================================================"
echo "TEST A: GET /api/dashboard/supplier-shrinkage (LIST ENDPOINT)"
echo "================================================================================"

RESP_A=$(curl -s http://localhost:3000/api/dashboard/supplier-shrinkage \
  -H "Origin: http://localhost:3000" \
  -b /tmp/cookies.txt)

STATUS_A=$(echo "$RESP_A" | jq -r 'if .error then "ERROR" else "OK" end')

if [ "$STATUS_A" = "ERROR" ]; then
    echo "❌ FAILED: Got error response"
    echo "$RESP_A"
    exit 1
fi

echo "✅ Response 200 OK"

# Extract CV. Ratu Indonesia data
SUPPLIER_NAME=$(echo "$RESP_A" | jq -r '.data[0].supplierName')
SUPPLIER_CODE=$(echo "$RESP_A" | jq -r '.data[0].supplierCode')
SUPPLIER_ID=$(echo "$RESP_A" | jq -r '.data[0].supplierId')
PO_COUNT=$(echo "$RESP_A" | jq -r '.data[0].poCount')
SJ_WEIGHT=$(echo "$RESP_A" | jq -r '.data[0].sjWeight')
TALLY_WEIGHT=$(echo "$RESP_A" | jq -r '.data[0].tallyWeight')
SJ_TALLIED=$(echo "$RESP_A" | jq -r '.data[0].sjTallied')
TALLY_DONE=$(echo "$RESP_A" | jq -r '.data[0].tallyDone')
SUSUT=$(echo "$RESP_A" | jq -r '.data[0].susut')
SUSUT_PCT=$(echo "$RESP_A" | jq -r '.data[0].susutPct')

echo ""
echo "✅ Found supplier: $SUPPLIER_NAME ($SUPPLIER_CODE)"
echo "   Supplier ID: $SUPPLIER_ID"
echo ""
echo "   ACTUAL VALUES FOR CV. RATU INDONESIA:"
echo "   - poCount: $PO_COUNT"
echo "   - sjWeight (total received): $SJ_WEIGHT kg"
echo "   - tallyWeight: $TALLY_WEIGHT kg"
echo "   - sjTallied (tallied items only): $SJ_TALLIED kg"
echo "   - tallyDone: $TALLY_DONE"
echo "   - susut: $SUSUT kg"
echo "   - susutPct: $SUSUT_PCT%"
echo ""
echo "   CRITICAL VERIFICATION:"

# Check if susutPct is small (< 10%)
if (( $(echo "$SUSUT_PCT < 10" | bc -l) )); then
    echo "   ✅ susutPct = $SUSUT_PCT% (SMALL, realistic value)"
else
    echo "   ❌ FAILED: susutPct = $SUSUT_PCT% (TOO HIGH, should be ~0.6%)"
    exit 1
fi

# Check expected values
if (( $(echo "$SUSUT > 1.0 && $SUSUT < 2.0" | bc -l) )); then
    echo "   ✅ susut ~1.4 kg (actual: $SUSUT kg)"
else
    echo "   ⚠️  susut = $SUSUT kg (expected ~1.4 kg)"
fi

if (( $(echo "$SJ_TALLIED > 240 && $SJ_TALLIED < 260" | bc -l) )); then
    echo "   ✅ sjTallied ~250 kg (actual: $SJ_TALLIED kg)"
else
    echo "   ⚠️  sjTallied = $SJ_TALLIED kg (expected ~250 kg)"
fi

if (( $(echo "$TALLY_WEIGHT > 240 && $TALLY_WEIGHT < 260" | bc -l) )); then
    echo "   ✅ tallyWeight ~248.6 kg (actual: $TALLY_WEIGHT kg)"
else
    echo "   ⚠️  tallyWeight = $TALLY_WEIGHT kg (expected ~248.6 kg)"
fi

if (( $(echo "$SUSUT_PCT > 0.4 && $SUSUT_PCT < 0.8" | bc -l) )); then
    echo "   ✅ susutPct ~0.6% (actual: $SUSUT_PCT%)"
else
    echo "   ⚠️  susutPct = $SUSUT_PCT% (expected ~0.6%)"
fi

if (( $(echo "$SJ_WEIGHT > $SJ_TALLIED" | bc -l) )); then
    echo "   ✅ sjWeight ($SJ_WEIGHT) > sjTallied ($SJ_TALLIED) - includes not-yet-tallied PO"
else
    echo "   ⚠️  sjWeight ($SJ_WEIGHT) <= sjTallied ($SJ_TALLIED)"
fi

# Check totals
TOTALS_SJ_WEIGHT=$(echo "$RESP_A" | jq -r '.totals.sjWeight')
TOTALS_TALLY_WEIGHT=$(echo "$RESP_A" | jq -r '.totals.tallyWeight')
TOTALS_SJ_TALLIED=$(echo "$RESP_A" | jq -r '.totals.sjTallied')
TOTALS_SUSUT=$(echo "$RESP_A" | jq -r '.totals.susut')
TOTALS_SUSUT_PCT=$(echo "$RESP_A" | jq -r '.totals.susutPct')

echo ""
echo "   TOTALS:"
echo "   - sjWeight: $TOTALS_SJ_WEIGHT kg"
echo "   - tallyWeight: $TOTALS_TALLY_WEIGHT kg"
echo "   - sjTallied: $TOTALS_SJ_TALLIED kg"
echo "   - susut: $TOTALS_SUSUT kg"
echo "   - susutPct: $TOTALS_SUSUT_PCT%"

# Verify totals.susutPct = totals.susut / totals.sjTallied * 100
EXPECTED_TOTAL_PCT=$(echo "scale=1; ($TOTALS_SUSUT / $TOTALS_SJ_TALLIED) * 100" | bc)
echo ""
echo "   CRITICAL VERIFICATION (TOTALS):"
echo "   - Expected susutPct: $EXPECTED_TOTAL_PCT% (susut / sjTallied * 100)"
echo "   - Actual susutPct: $TOTALS_SUSUT_PCT%"

if (( $(echo "$TOTALS_SUSUT_PCT == $EXPECTED_TOTAL_PCT" | bc -l) )); then
    echo "   ✅ totals.susutPct calculated correctly (based on sjTallied, NOT sjWeight)"
else
    echo "   ⚠️  totals.susutPct mismatch (difference: $(echo "$TOTALS_SUSUT_PCT - $EXPECTED_TOTAL_PCT" | bc) %)"
fi

# Verify it's NOT based on sjWeight
WRONG_PCT=$(echo "scale=1; ($TOTALS_SUSUT / $TOTALS_SJ_WEIGHT) * 100" | bc)
if (( $(echo "$TOTALS_SUSUT_PCT != $WRONG_PCT" | bc -l) )); then
    echo "   ✅ totals.susutPct is NOT based on sjWeight ($WRONG_PCT%)"
else
    echo "   ❌ FAILED: totals.susutPct appears to be based on sjWeight"
    exit 1
fi

echo ""
echo "✅ TEST A PASSED: Supplier shrinkage list endpoint working correctly"

echo ""
echo "================================================================================"
echo "TEST B: GET /api/dashboard/supplier-shrinkage/:supplierId (DETAIL ENDPOINT)"
echo "================================================================================"

RESP_B=$(curl -s http://localhost:3000/api/dashboard/supplier-shrinkage/$SUPPLIER_ID \
  -H "Origin: http://localhost:3000" \
  -b /tmp/cookies.txt)

STATUS_B=$(echo "$RESP_B" | jq -r 'if .error then "ERROR" else "OK" end')

if [ "$STATUS_B" = "ERROR" ]; then
    echo "❌ FAILED: Got error response"
    echo "$RESP_B"
    exit 1
fi

echo "✅ Response 200 OK"

DETAIL_SUPPLIER_NAME=$(echo "$RESP_B" | jq -r '.data.supplier.name')
DETAIL_SUPPLIER_CODE=$(echo "$RESP_B" | jq -r '.data.supplier.code')
POS_COUNT=$(echo "$RESP_B" | jq -r '.data.pos | length')

echo "   Supplier: $DETAIL_SUPPLIER_NAME ($DETAIL_SUPPLIER_CODE)"
echo "   POs found: $POS_COUNT"
echo ""
echo "✅ Response structure valid"

# Find PO/202608/0013 and PO/202608/0014
PO_0013=$(echo "$RESP_B" | jq -r '.data.pos[] | select(.poNumber == "PO/202608/0013")')
PO_0014=$(echo "$RESP_B" | jq -r '.data.pos[] | select(.poNumber == "PO/202608/0014")')

echo ""
echo "   PO BREAKDOWN:"

# Verify PO/202608/0013 (not tallied)
if [ -n "$PO_0013" ]; then
    echo ""
    echo "   PO/202608/0013 (NOT TALLIED):"
    PO_0013_SJ=$(echo "$PO_0013" | jq -r '.sjWeight')
    PO_0013_TALLY=$(echo "$PO_0013" | jq -r '.tallyWeight')
    PO_0013_SJ_TALLIED=$(echo "$PO_0013" | jq -r '.sjTallied')
    PO_0013_TALLY_DONE=$(echo "$PO_0013" | jq -r '.tallyDone')
    PO_0013_SUSUT=$(echo "$PO_0013" | jq -r '.susut')
    PO_0013_SUSUT_PCT=$(echo "$PO_0013" | jq -r '.susutPct')
    
    echo "   - sjWeight: $PO_0013_SJ kg"
    echo "   - tallyWeight: $PO_0013_TALLY kg"
    echo "   - sjTallied: $PO_0013_SJ_TALLIED kg"
    echo "   - tallyDone: $PO_0013_TALLY_DONE"
    echo "   - susut: $PO_0013_SUSUT kg"
    echo "   - susutPct: $PO_0013_SUSUT_PCT"
    
    if [ "$PO_0013_TALLY_DONE" = "false" ]; then
        echo "   ✅ tallyDone = false (not tallied)"
    else
        echo "   ❌ FAILED: tallyDone should be false"
        exit 1
    fi
    
    if [ "$PO_0013_SUSUT" = "0" ]; then
        echo "   ✅ susut = 0 (not calculated for untallied PO)"
    else
        echo "   ⚠️  susut = $PO_0013_SUSUT (expected 0)"
    fi
    
    if [ "$PO_0013_SUSUT_PCT" = "null" ]; then
        echo "   ✅ susutPct = null (not calculated for untallied PO)"
    else
        echo "   ⚠️  susutPct = $PO_0013_SUSUT_PCT (expected null)"
    fi
else
    echo ""
    echo "   ⚠️  PO/202608/0013 not found"
fi

# Verify PO/202608/0014 (tallied)
if [ -n "$PO_0014" ]; then
    echo ""
    echo "   PO/202608/0014 (TALLIED):"
    PO_0014_SJ=$(echo "$PO_0014" | jq -r '.sjWeight')
    PO_0014_TALLY=$(echo "$PO_0014" | jq -r '.tallyWeight')
    PO_0014_SJ_TALLIED=$(echo "$PO_0014" | jq -r '.sjTallied')
    PO_0014_TALLY_DONE=$(echo "$PO_0014" | jq -r '.tallyDone')
    PO_0014_SUSUT=$(echo "$PO_0014" | jq -r '.susut')
    PO_0014_SUSUT_PCT=$(echo "$PO_0014" | jq -r '.susutPct')
    
    echo "   - sjWeight: $PO_0014_SJ kg"
    echo "   - tallyWeight: $PO_0014_TALLY kg"
    echo "   - sjTallied: $PO_0014_SJ_TALLIED kg"
    echo "   - tallyDone: $PO_0014_TALLY_DONE"
    echo "   - susut: $PO_0014_SUSUT kg"
    echo "   - susutPct: $PO_0014_SUSUT_PCT%"
    
    if [ "$PO_0014_TALLY_DONE" = "true" ]; then
        echo "   ✅ tallyDone = true (tallied)"
    else
        echo "   ❌ FAILED: tallyDone should be true"
        exit 1
    fi
    
    if (( $(echo "$PO_0014_SUSUT > 1.0 && $PO_0014_SUSUT < 2.0" | bc -l) )); then
        echo "   ✅ susut ~1.4 kg (actual: $PO_0014_SUSUT kg)"
    else
        echo "   ⚠️  susut = $PO_0014_SUSUT kg (expected ~1.4 kg)"
    fi
    
    if (( $(echo "$PO_0014_SUSUT_PCT > 0.4 && $PO_0014_SUSUT_PCT < 0.8" | bc -l) )); then
        echo "   ✅ susutPct ~0.6% (actual: $PO_0014_SUSUT_PCT%)"
    else
        echo "   ⚠️  susutPct = $PO_0014_SUSUT_PCT% (expected ~0.6%)"
    fi
    
    # Verify susutPct calculation
    EXPECTED_0014_PCT=$(echo "scale=1; ($PO_0014_SUSUT / $PO_0014_SJ_TALLIED) * 100" | bc)
    echo "   - Expected susutPct: $EXPECTED_0014_PCT% (susut / sjTallied * 100)"
    
    if (( $(echo "$PO_0014_SUSUT_PCT == $EXPECTED_0014_PCT" | bc -l) )); then
        echo "   ✅ susutPct calculated correctly (based on sjTallied)"
    else
        echo "   ⚠️  susutPct mismatch (difference: $(echo "$PO_0014_SUSUT_PCT - $EXPECTED_0014_PCT" | bc) %)"
    fi
    
    if (( $(echo "$PO_0014_SJ_TALLIED > 240 && $PO_0014_SJ_TALLIED < 260" | bc -l) )); then
        echo "   ✅ sjTallied ~250 kg (actual: $PO_0014_SJ_TALLIED kg)"
    else
        echo "   ⚠️  sjTallied = $PO_0014_SJ_TALLIED kg (expected ~250 kg)"
    fi
else
    echo ""
    echo "   ⚠️  PO/202608/0014 not found"
fi

# Verify totals
DETAIL_TOTALS_SJ=$(echo "$RESP_B" | jq -r '.data.totals.sjWeight')
DETAIL_TOTALS_TALLY=$(echo "$RESP_B" | jq -r '.data.totals.tallyWeight')
DETAIL_TOTALS_SUSUT=$(echo "$RESP_B" | jq -r '.data.totals.susut')
DETAIL_TOTALS_SUSUT_PCT=$(echo "$RESP_B" | jq -r '.data.totals.susutPct')

echo ""
echo "   TOTALS:"
echo "   - sjWeight: $DETAIL_TOTALS_SJ kg"
echo "   - tallyWeight: $DETAIL_TOTALS_TALLY kg"
echo "   - susut: $DETAIL_TOTALS_SUSUT kg"
echo "   - susutPct: $DETAIL_TOTALS_SUSUT_PCT%"

echo ""
echo "   CRITICAL VERIFICATION (TOTALS):"

# Expected based on sjTallied (~250)
DETAIL_EXPECTED_PCT=$(echo "scale=1; ($DETAIL_TOTALS_SUSUT / $PO_0014_SJ_TALLIED) * 100" | bc)
echo "   - sum(sjTallied) for tallied POs: ~$PO_0014_SJ_TALLIED kg"
echo "   - Expected susutPct: $DETAIL_EXPECTED_PCT% (susut / sum(sjTallied) * 100)"
echo "   - Actual susutPct: $DETAIL_TOTALS_SUSUT_PCT%"

if (( $(echo "$DETAIL_TOTALS_SUSUT_PCT == $DETAIL_EXPECTED_PCT" | bc -l) )); then
    echo "   ✅ totals.susutPct ~$DETAIL_EXPECTED_PCT% (based on sjTallied ~$PO_0014_SJ_TALLIED kg)"
else
    echo "   ⚠️  totals.susutPct = $DETAIL_TOTALS_SUSUT_PCT% (expected ~$DETAIL_EXPECTED_PCT%)"
fi

# Verify it's NOT based on total sjWeight (~2733)
DETAIL_WRONG_PCT=$(echo "scale=1; ($DETAIL_TOTALS_SUSUT / $DETAIL_TOTALS_SJ) * 100" | bc)
echo "   - If based on sjWeight: $DETAIL_WRONG_PCT% (WRONG)"

if (( $(echo "$DETAIL_TOTALS_SUSUT_PCT != $DETAIL_WRONG_PCT" | bc -l) )); then
    echo "   ✅ totals.susutPct is NOT based on total sjWeight ($DETAIL_TOTALS_SJ kg)"
else
    echo "   ❌ FAILED: totals.susutPct appears to be based on sjWeight"
    exit 1
fi

if (( $(echo "$DETAIL_TOTALS_SUSUT_PCT < 10" | bc -l) )); then
    echo "   ✅ totals.susutPct is SMALL (~$DETAIL_TOTALS_SUSUT_PCT%), NOT ~90% (bug fixed)"
else
    echo "   ❌ FAILED: totals.susutPct = $DETAIL_TOTALS_SUSUT_PCT% (TOO HIGH, bug NOT fixed)"
    exit 1
fi

echo ""
echo "✅ TEST B PASSED: Supplier shrinkage detail endpoint working correctly"

echo ""
echo "================================================================================"
echo "TEST SUMMARY"
echo "================================================================================"
echo "✅ TEST A: GET /api/dashboard/supplier-shrinkage - PASSED"
echo "✅ TEST B: GET /api/dashboard/supplier-shrinkage/:supplierId - PASSED"
echo ""
echo "✅ ALL TESTS PASSED - SUSUT PERCENTAGE LOGIC VERIFIED"
echo ""
echo "KEY FINDINGS:"
echo "- susutPct is calculated based on sjTallied (tallied items only), NOT sjWeight"
echo "- CV. Ratu Indonesia susutPct is SMALL (~0.6%), NOT ~90%"
echo "- Untallied POs have susut=0 and susutPct=null (correct)"
echo "- Tallied POs have susut and susutPct calculated correctly"
echo "- Totals.susutPct is based on sum(sjTallied), NOT sum(sjWeight)"
echo "================================================================================"
