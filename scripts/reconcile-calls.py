#!/usr/bin/env python3
"""Reconcile what Asterisk carried against what we logged and charged.

Every fault found this week was the same shape: a call carried, and one of the
steps after it missing. A hangup that skipped the log; a log that skipped the
charge; a status word that meant the charge never fired. Each was found by
somebody noticing, which is not a system.

This compares three things and reports the gaps:

  · a call in Asterisk's CDR with no row in call_events
  · a completed call in call_events with a duration and no charge in the ledger

It reports rather than corrects. A job that silently bills people for calls they
had weeks ago is worse than one that says something is wrong — and the second
time a gap appears here, the number will say how long it has been happening.

  ./reconcile-calls.py            the last 24 hours
  ./reconcile-calls.py --days 30  a longer window
"""
import csv, os, subprocess, sys
from datetime import datetime, timedelta

CDR = '/var/log/asterisk/cdr-csv/Master.csv'
ENV = os.environ.get('TELROI_ENV', '/opt/telroi-ai-app/control-app/.env')

# Asterisk's CSV has no header. The order is fixed.
START, BILLSEC, DISPOSITION, UNIQUEID = 9, 13, 14, 16


def db_url():
    with open(ENV) as f:
        for line in f:
            if line.startswith('DATABASE_URL='):
                return line.split('=', 1)[1].strip()
    sys.exit(f'No DATABASE_URL in {ENV}')


def query(url, sql):
    out = subprocess.run(['psql', url, '-tAc', sql], capture_output=True, text=True)
    if out.returncode:
        sys.exit(f'query failed: {out.stderr.strip()}')
    return [l for l in out.stdout.strip().split('\n') if l]


def main():
    days = 1
    if '--days' in sys.argv:
        days = int(sys.argv[sys.argv.index('--days') + 1])
    since = datetime.now() - timedelta(days=days)

    url = db_url()

    # Calls Asterisk actually carried and billed us for.
    carried = {}
    with open(CDR, newline='') as f:
        for row in csv.reader(f):
            if len(row) <= UNIQUEID:
                continue
            try:
                started = datetime.strptime(row[START], '%Y-%m-%d %H:%M:%S')
            except ValueError:
                continue
            if started < since:
                continue
            if row[DISPOSITION] != 'ANSWERED':
                continue
            billsec = int(row[BILLSEC] or 0)
            if billsec <= 0:
                continue
            carried[row[UNIQUEID]] = billsec

    logged = set(query(url, f"""
        select callid from call_events
        where started_at > now() - interval '{days} days'
    """))

    # A call carried and never logged: no row, so no charge, and nothing on the
    # client's call list either.
    unlogged = {k: v for k, v in carried.items() if k not in logged}

    # And a call logged, finished, with a duration — and no charge against it.
    uncharged = query(url, f"""
        select ce.callid || ' | ' || coalesce(ce.carrier, '?') || ' | ' ||
               coalesce(ce.duration, 0) || 's | ' || t.name
        from call_events ce
        join tenants t on t.id = ce.tenant_id
        left join ledger l on l.reference = 'call_' || ce.callid and l.reason = 'voice_minute'
        where ce.started_at > now() - interval '{days} days'
          and ce.status in ('completed', 'ended')
          and coalesce(ce.duration, 0) > 0
          and l.id is null
          and t.is_internal = false
        order by ce.started_at desc
    """)

    print(f'Reconciling the last {days} day(s)\n')
    print(f'Answered calls in the CDR : {len(carried)}')
    print(f'  not in call_events      : {len(unlogged)}')
    print(f'Completed calls unbilled  : {len(uncharged)}')

    if unlogged:
        print('\nCarried but never logged:')
        for uid, secs in list(unlogged.items())[:20]:
            print(f'  {uid}  {secs}s')
        if len(unlogged) > 20:
            print(f'  … and {len(unlogged) - 20} more')

    if uncharged:
        print('\nLogged but never charged:')
        for row in uncharged[:20]:
            print(f'  {row}')
        if len(uncharged) > 20:
            print(f'  … and {len(uncharged) - 20} more')

    if not unlogged and not uncharged:
        print('\nNothing missing.')

    # Non-zero when something is wrong, so cron can mail on failure.
    sys.exit(1 if (unlogged or uncharged) else 0)


if __name__ == '__main__':
    main()
