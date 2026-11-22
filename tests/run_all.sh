#!/usr/bin/env bash
# v92 — รันเทสต์ทั้งหมดในคำสั่งเดียว (เครื่องตัวเอง และ GitHub Actions ใช้ไฟล์นี้ไฟล์เดียวกัน)
#
#   bash tests/run_all.sh            # เทสต์ตัวเลข/โค้ด (ไม่ต้องใช้เบราว์เซอร์)
#   bash tests/run_all.sh --ui       # + เทสต์หน้าจอ (ต้องมี Playwright + Chromium)
#
# REQUIRE_ALL=1 → เทสต์ที่ข้ามเพราะขาด library (cryptography / google-auth / playwright) นับเป็นไม่ผ่าน (ใช้ใน CI)
set -u
cd "$(dirname "$0")/.."

PASS=0; FAILED=(); SKIPPED=()
run() {   # run <ชื่อ> <คำสั่ง...>
  local name="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then
    PASS=$((PASS+1)); printf '  ✓ %s\n' "$name"
  else
    FAILED+=("$name"); printf '  ✗ %s\n' "$name"
    printf '%s\n' "$out" | grep -E '✗|Error|error|FAIL|Traceback|assert' | head -20 | sed 's/^/      /'
  fi
}
skip() { SKIPPED+=("$1 ($2)"); printf '  – %s — ข้าม: %s\n' "$1" "$2"; }

echo "═══ เวอร์ชัน + ไฟล์ที่อ้างถึง ═══"
run check_build node tests/check_build.cjs

echo "═══ JavaScript ═══"
for t in shared budget calc_v68 dividends rebalance regime guard docs debts perf invest_tx at_formula sheet_forms notify entry_checks; do
  run "test_$t" node "tests/test_$t.cjs" js/shared.js
done
run test_i18n     node tests/test_i18n.cjs js/i18n.js
run test_vault    node tests/test_vault.cjs js/vault.js
run test_autobot  node tests/test_autobot.cjs js/autobot.js
run test_liveport node tests/test_liveport.cjs js/liveport.js
run test_autobot_worker node tests/test_autobot_worker.mjs

echo "═══ Python ═══"
for t in signals signals_carry signals_e2e fundamentals bot_paper line_notify monthly_report notify_store; do
  run "test_$t.py" python3 "tests/test_$t.py"
done
if python3 -c 'import cryptography' 2>/dev/null; then run test_state_enc.py python3 tests/test_state_enc.py
else skip test_state_enc.py 'pip install cryptography'; fi
if python3 -c 'import google.auth' 2>/dev/null; then run test_token.py python3 tests/test_token.py
else skip test_token.py 'pip install google-auth'; fi

if [ "${1:-}" = "--ui" ]; then
  echo "═══ หน้าจอ (Playwright) ═══"
  if node -e "require('playwright')" 2>/dev/null; then run ui_smoke node tests/ui/test_ui_smoke.cjs
  else skip ui_smoke 'npm i playwright && npx playwright install chromium'; fi
fi

echo
echo "ผ่าน ${PASS} · ไม่ผ่าน ${#FAILED[@]} · ข้าม ${#SKIPPED[@]}"
[ ${#FAILED[@]} -gt 0 ] && printf '  ✗ %s\n' "${FAILED[@]}"
[ ${#SKIPPED[@]} -gt 0 ] && printf '  – %s\n' "${SKIPPED[@]}"
if [ ${#FAILED[@]} -gt 0 ]; then exit 1; fi
if [ "${REQUIRE_ALL:-0}" = "1" ] && [ ${#SKIPPED[@]} -gt 0 ]; then echo "REQUIRE_ALL=1 — ห้ามข้ามเทสต์"; exit 1; fi
exit 0
