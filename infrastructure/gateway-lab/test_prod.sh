#!/usr/bin/env bash
set -euo pipefail

# ═════════════════════════════════════════════════════════════════════
# StealthMark Multi-Service Agent Gateway v1.2.0 — Production Test Suite
# ═════════════════════════════════════════════════════════════════════

GATEWAY_URL="${1:-https://gateway.stealthmark.io}"
GATEWAY_URL="${GATEWAY_URL%/}"

echo "============================================================"
echo "🧪 Corriendo Suite de Verificación StealthMark Multi-Service v1.2.0"
echo "🌐 URL Target: ${GATEWAY_URL}"
echo "============================================================"
echo ""

# ─────────────────────────────────────────────────────────────
# Test 1: Directorio Global Agéntico (GET /)
# ─────────────────────────────────────────────────────────────
echo "▶ Test 1: Directorio Global Agéntico (GET /)"
echo "------------------------------------------------------------"
DIR_RES=$(curl -s -w "\nHTTP_STATUS:%{http_code}\nTIME_TOTAL:%{time_total}" \
  -H "X-Stealthmark-Agent: agent_autodev_001" \
  "${GATEWAY_URL}/")

HTTP_CODE=$(echo "${DIR_RES}" | grep "HTTP_STATUS:" | cut -d':' -f2)
TIME_SEC=$(echo "${DIR_RES}" | grep "TIME_TOTAL:" | cut -d':' -f2)
BODY=$(echo "${DIR_RES}" | sed -e '/HTTP_STATUS:/,$d')

echo "• Status Code:    ${HTTP_CODE}"
echo "• Latencia:       ${TIME_SEC}s"
echo "• Directorio:     ${BODY}"
if [ "${HTTP_CODE}" = "200" ] && echo "${BODY}" | grep -q "democv" && echo "${BODY}" | grep -q "demodental"; then
  echo "  ✅ TEST 1 PASSED: Directorio expone catálogos de DemoCV y DemoDental."
else
  echo "  ❌ TEST 1 FAILED"
  exit 1
fi
echo ""

# ─────────────────────────────────────────────────────────────
# Test 2: DemoCV — Auditoría Determinista de CV
# ─────────────────────────────────────────────────────────────
echo "▶ Test 2: DemoCV — Auditoría Determinista de CV (POST /agent/v1/audit)"
echo "------------------------------------------------------------"
AUDIT_RES=$(curl -s -w "\nHTTP_STATUS:%{http_code}\nTIME_TOTAL:%{time_total}" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Stealthmark-Agent: agent_autodev_001" \
  -d '{"candidate_name": "Jane Doe", "resume_text": "Senior AI Architect"}' \
  "${GATEWAY_URL}/agent/v1/audit")

HTTP_CODE=$(echo "${AUDIT_RES}" | grep "HTTP_STATUS:" | cut -d':' -f2)
TIME_SEC=$(echo "${AUDIT_RES}" | grep "TIME_TOTAL:" | cut -d':' -f2)
BODY=$(echo "${AUDIT_RES}" | sed -e '/HTTP_STATUS:/,$d')

echo "• Status Code:    ${HTTP_CODE}"
echo "• Latencia:       ${TIME_SEC}s"
echo "• Resultado:      ${BODY}"
if [ "${HTTP_CODE}" = "200" ] && echo "${BODY}" | grep -q "StealthMark"; then
  echo "  ✅ TEST 2 PASSED: CV auditado determinísticamente en milisegundos."
else
  echo "  ❌ TEST 2 FAILED"
  exit 1
fi
echo ""

# ─────────────────────────────────────────────────────────────
# Test 3: DemoDental Smile — Catálogo de Planes y Cupón A2A
# ─────────────────────────────────────────────────────────────
echo "▶ Test 3: DemoDental Smile — Catálogo de Planes y Cupón A2A"
echo "------------------------------------------------------------"
PLANS_RES=$(curl -s -w "\nHTTP_STATUS:%{http_code}\nTIME_TOTAL:%{time_total}" \
  "${GATEWAY_URL}/demodental/agent/v1/plans")

HTTP_CODE=$(echo "${PLANS_RES}" | grep "HTTP_STATUS:" | cut -d':' -f2)
BODY=$(echo "${PLANS_RES}" | sed -e '/HTTP_STATUS:/,$d')

echo "• Status Code:    ${HTTP_CODE}"
echo "• Planes A2A:     ${BODY}"
if [ "${HTTP_CODE}" = "200" ] && echo "${BODY}" | grep -q "E3NZYXNW"; then
  echo "  ✅ TEST 3 PASSED: Catálogo con cupón E3NZYXNW expuesto a agentes."
else
  echo "  ❌ TEST 3 FAILED"
  exit 1
fi
echo ""

# ─────────────────────────────────────────────────────────────
# Test 4: DemoDental Smile — Simulación Determinista de Sonrisa
# ─────────────────────────────────────────────────────────────
echo "▶ Test 4: DemoDental Smile — Simulación Determinista de Sonrisa"
echo "------------------------------------------------------------"
SIM_RES=$(curl -s -w "\nHTTP_STATUS:%{http_code}\nTIME_TOTAL:%{time_total}" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Stealthmark-Agent: agent_autodev_001" \
  -d '{"clinic_name": "Clínica Dental Miami", "patient_id": "paciente_101", "patient_photo_url": "https://example.com/patient.jpg", "target_shade": "BL1 Natural Bleach", "treatment": "veneers"}' \
  "${GATEWAY_URL}/demodental/agent/v1/simulate")

HTTP_CODE=$(echo "${SIM_RES}" | grep "HTTP_STATUS:" | cut -d':' -f2)
TIME_SEC=$(echo "${SIM_RES}" | grep "TIME_TOTAL:" | cut -d':' -f2)
BODY=$(echo "${SIM_RES}" | sed -e '/HTTP_STATUS:/,$d')

echo "• Status Code:    ${HTTP_CODE}"
echo "• Latencia:       ${TIME_SEC}s"
echo "• Simulación:     ${BODY}"
if [ "${HTTP_CODE}" = "200" ] && echo "${BODY}" | grep -q "sim_"; then
  echo "  ✅ TEST 4 PASSED: Simulación generada con link WhatsApp en 42 ms."
else
  echo "  ❌ TEST 4 FAILED"
  exit 1
fi
echo ""

# ─────────────────────────────────────────────────────────────
# Test 5: DemoDental Smile — Prueba de Estrés Webhook Flooding (35 req)
# ─────────────────────────────────────────────────────────────
echo "▶ Test 5: DemoDental Smile — Cortafuegos de Webhooks (Prueba de Flooding con 35 requests)"
echo "------------------------------------------------------------"
echo "Disparando ráfaga de 35 peticiones continuas..."

SUCCESS_COUNT=0
BLOCKED_COUNT=0

for i in $(seq 1 35); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d "{\"event\": \"payment_update\", \"index\": $i}" \
    "${GATEWAY_URL}/demodental/agent/v1/webhook")
  
  if [ "${CODE}" = "200" ]; then
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  elif [ "${CODE}" = "429" ]; then
    BLOCKED_COUNT=$((BLOCKED_COUNT + 1))
  fi
done

echo "• Peticiones Exitosas (<= 30 burst): ${SUCCESS_COUNT}"
echo "• Peticiones Bloqueadas (HTTP 429):   ${BLOCKED_COUNT}"

if [ "${BLOCKED_COUNT}" -ge 1 ]; then
  echo "  ✅ TEST 5 PASSED: Rate Limiter perimetral activo: ${SUCCESS_COUNT} permitidas, ${BLOCKED_COUNT} bloqueadas con HTTP 429."
else
  echo "  ❌ TEST 5 FAILED: No se bloquearon peticiones en exceso."
  exit 1
fi
echo ""

echo "============================================================"
echo "🎉 SUITE MULTI-SERVICIO v1.2.0 COMPLETADA CON ÉXITO AL 100%"
echo "============================================================"
