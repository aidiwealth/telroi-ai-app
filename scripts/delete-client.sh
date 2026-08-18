#!/bin/bash
# Remove a workspace, from the droplet.
#
#   ./delete-client.sh <slug>            report what would go
#   ./delete-client.sh <slug> --confirm  do it
#
# The dashboard is still the fuller route: it deletes recordings from object
# storage, which this cannot — the bucket credentials live in the web app, not
# here. Whatever this leaves behind is listed at the end so it can be cleared.
set -euo pipefail

SLUG="${1:-}"
CONFIRM="${2:-}"
ENV_FILE="${TELROI_ENV:-/opt/telroi-ai-app/control-app/.env}"
[ -z "$SLUG" ] && { echo "usage: $0 <slug> [--confirm]"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "No env at $ENV_FILE — set TELROI_ENV"; exit 1; }

DB=$(grep '^DATABASE_URL' "$ENV_FILE" | cut -d= -f2-)
q() { psql "$DB" -tAc "$1"; }

TID=$(q "select id from tenants where slug='$SLUG'")
[ -z "$TID" ] && { echo "No workspace with slug '$SLUG'"; exit 1; }

# Read it back before touching anything: a slug is easy to mistype and there is
# no undo.
echo "Workspace  : $(q "select name from tenants where slug='$SLUG'") ($SLUG)"
echo "Id         : $TID"
echo "Live       : $(q "select case when sandbox_mode then 'sandbox' else 'LIVE' end from tenants where id='$TID'")"
echo "Balance    : $(q "select coalesce(balance_minor,0)/100.0 || ' ' || currency from wallets where tenant_id='$TID'")"
echo "Members    : $(q "select count(*) from memberships where tenant_id='$TID'")"
echo "Numbers    : $(q "select count(*) from number_subscriptions where tenant_id='$TID'")"
echo "Endpoints  : $(q "select count(*) from sip_endpoints where tenant_id='$TID'")"
echo "Calls      : $(q "select count(*) from call_events where tenant_id='$TID'")"
echo "Recordings : $(q "select count(*) from call_recordings where tenant_id='$TID'")"

if [ "$CONFIRM" != "--confirm" ]; then
  echo
  echo "Nothing done. Re-run with --confirm to delete."
  exit 0
fi

# Numbers are stock we paid for. Losing them with the workspace means paying for
# a number nobody can sell again.
echo "Releasing numbers to inventory..."
q "update number_inventory set status='available', sold_to_tenant_id=null
   where telnum in (select telnum from number_subscriptions where tenant_id='$TID')" >/dev/null

# Endpoints. The provisioning agent is on localhost, so this one is reachable
# from here — an endpoint left registered is one somebody could still call on.
echo "Deprovisioning SIP endpoints..."
SECRET=$(grep '^PROVISION_AGENT_SECRET' "$ENV_FILE" | cut -d= -f2-)
for U in $(q "select sip_username from sip_endpoints where tenant_id='$TID' and sip_username is not null"); do
  curl -s -m 10 -X POST http://127.0.0.1:8090/deprovision \
    -H "Content-Type: application/json" -H "x-telroi-internal: $SECRET" \
    -d "{\"username\":\"$U\"}" >/dev/null && echo "  $U"
done

# Recordings this cannot remove. Listed rather than silently abandoned: they are
# billed for monthly until somebody clears them.
RECS=$(q "select object_key from call_recordings where tenant_id='$TID' and object_key is not null")
if [ -n "$RECS" ]; then
  OUT="/root/leftover-recordings-$SLUG-$(date +%Y%m%d-%H%M).txt"
  echo "$RECS" > "$OUT"
  echo "Storage objects NOT deleted: $(echo "$RECS" | wc -l) — listed in $OUT"
fi

echo "Revoking sessions..."
q "update user_sessions set revoked_at=now(), revoked_reason='workspace deleted'
   where tenant_id='$TID' and revoked_at is null" >/dev/null

echo "Deleting workspace..."
q "delete from tenants where id='$TID'" >/dev/null
echo "Done — $SLUG removed."
