#!/usr/bin/env bash
# Exercise the public /v1 API with a sandbox key.
#
#   export TLR_KEY=tlr_test_...
#   bash scripts/test-public-api.sh
#
# Checks each endpoint answers, and that a bad key is refused rather than
# redirected to a login page — a client integrating against this needs a 401 it
# can act on, not HTML.
BASE="${BASE:-https://app.telroi.ai}"
[ -z "$TLR_KEY" ] && { echo "TLR_KEY not set"; exit 1; }

pass=0; fail=0
check() {
  if [ "$2" = "$3" ]; then printf '  ok   %-34s %s\n' "$1" "$3"; pass=$((pass+1))
  else printf '  FAIL %-34s got %s, wanted %s\n' "$1" "$3" "$2"; fail=$((fail+1)); fi
}
code() { curl -s -o /tmp/tlr_body -w '%{http_code}' "$@"; }

echo "== authenticated reads =="
for p in /v1/calls /v1/numbers /v1/vans /v1/agents; do
  check "GET $p" 200 "$(code -H "Authorization: Bearer $TLR_KEY" "$BASE$p")"
done

echo ""
echo "== a bad key must be refused, not redirected =="
check "GET /v1/calls (no key)"  401 "$(code "$BASE/v1/calls")"
check "GET /v1/calls (bad key)" 401 "$(code -H "Authorization: Bearer tlr_test_notarealkey" "$BASE/v1/calls")"

echo ""
echo "== writes, sandboxed by the key's own prefix =="
check "POST /v1/otp" 200 "$(code -X POST -H "Authorization: Bearer $TLR_KEY" -H 'Content-Type: application/json' -d '{"to":"+2348000000000"}' "$BASE/v1/otp")"
check "POST /v1/contacts" 200 "$(code -X POST -H "Authorization: Bearer $TLR_KEY" -H 'Content-Type: application/json' -d '{"phone":"+2348000000001","name":"API test"}' "$BASE/v1/contacts")"

echo ""
echo "== bad input should say so plainly =="
check "POST /v1/otp (no number)" 400 "$(code -X POST -H "Authorization: Bearer $TLR_KEY" -H 'Content-Type: application/json' -d '{}' "$BASE/v1/otp")"

echo ""
echo "== the rest of the surface =="
# The key's sandbox prefix is what keeps this from placing a real call.
check "POST /v1/calls" 200 "$(code -X POST -H "Authorization: Bearer $TLR_KEY" -H 'Content-Type: application/json' -d '{"phone":"+2348000000002"}' "$BASE/v1/calls")"
check "POST /v1/calls (no phone)" 400 "$(code -X POST -H "Authorization: Bearer $TLR_KEY" -H 'Content-Type: application/json' -d '{}' "$BASE/v1/calls")"

check "POST /v1/speech/tts" 200 "$(code -X POST -H "Authorization: Bearer $TLR_KEY" -H 'Content-Type: application/json' -d '{"text":"Testing the speech endpoint."}' "$BASE/v1/speech/tts")"
check "POST /v1/speech/tts (no text)" 400 "$(code -X POST -H "Authorization: Bearer $TLR_KEY" -H 'Content-Type: application/json' -d '{}' "$BASE/v1/speech/tts")"

# Nothing to transcribe: check it says so rather than failing obscurely.
check "POST /v1/speech/stt (no audio)" 400 "$(code -X POST -H "Authorization: Bearer $TLR_KEY" -H 'Content-Type: application/json' -d '{}' "$BASE/v1/speech/stt")"

check "POST /v1/otp/verify (no code)" 400 "$(code -X POST -H "Authorization: Bearer $TLR_KEY" -H 'Content-Type: application/json' -d '{}' "$BASE/v1/otp/verify")"

# Knowledge needs a real agent, so take the first one the API offers.
AGENT=$(curl -s -H "Authorization: Bearer $TLR_KEY" "$BASE/v1/agents" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
if [ -n "$AGENT" ]; then
  check "GET /v1/agents/{id}/knowledge" 200 "$(code -H "Authorization: Bearer $TLR_KEY" "$BASE/v1/agents/$AGENT/knowledge")"
else
  echo "  --   GET /v1/agents/{id}/knowledge   skipped, no agent to ask about"
fi

echo ""
echo "$pass passed, $fail failed"
