#!/usr/bin/env node
// Support endpoints mirror client ones, and when a client endpoint gains
// something its twin usually doesn't. Five bugs this week came from that: a
// missing 404, a missing sync call, absent validation, absent tier enrichment,
// a raw body written straight to the database.
//
// This doesn't try to judge whether a difference is wrong — several are correct,
// since support is internal and skips entitlement checks a client needs. It
// reports what the client one does that its twin doesn't, and leaves the judging
// to a person.
//
//   node scripts/check-support-parity.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SUPPORT = 'server/api/admin/support';
const CLIENT_ROOTS = ['server/api', 'server/api/voice'];

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

// Things whose absence has actually caused a bug, rather than every difference.
const SIGNALS = [
  { key: 'zod validation',      re: /safeParse|z\.object/ },
  { key: 'not-found handling',  re: /not_found|statusCode: 404|, 404\)/ },
  { key: 'conflict handling',   re: /409|duplicate|already exists|in_use/ },
  { key: 'syncCallsToContacts', re: /syncCallsToContacts/ },
  { key: 'tier enrichment',     re: /resolveAgentTier/ },
  { key: 'route sync',          re: /numberSubscriptions/ },
];

const support = walk(SUPPORT);
let flagged = 0;

for (const s of support) {
  const rel = relative(SUPPORT, s);
  const twin = CLIENT_ROOTS.map((r) => join(r, rel)).find((p) => {
    try { return statSync(p).isFile(); } catch { return false; }
  });
  if (!twin) continue;

  const sTxt = readFileSync(s, 'utf8');
  const cTxt = readFileSync(twin, 'utf8');
  const missing = SIGNALS.filter((sig) => sig.re.test(cTxt) && !sig.re.test(sTxt)).map((sig) => sig.key);
  if (!missing.length) continue;

  flagged++;
  console.log(`\n${rel}`);
  console.log(`  client: ${twin}`);
  console.log(`  support lacks: ${missing.join(', ')}`);
}

console.log(`\n${flagged} support endpoint(s) differ from their client twin in ways worth a look.`);
console.log('Some differences are correct — support is internal and skips entitlement checks.');
