// control-app/src/endpoint-status.ts
// Reports live PJSIP registration status for endpoints (parses `pjsip show contacts`).
import { execFileSync } from 'node:child_process';

export interface EndpointStatus {
  username: string; registered: boolean; contacts: number; rttMs: number | null; via: string | null;
}

function parseContacts(raw: string): Map<string, EndpointStatus> {
  const out = new Map<string, EndpointStatus>();
  for (const line of raw.split('\n')) {
    const m = /Contact:\s+([^/]+)\/(sip:[^\s]+)\s+\S+\s+(\S+)\s+(\S+)/i.exec(line);
    if (!m) continue;
    const [, aor, uri, statusWord, rttStr] = m;
    const name = aor.trim();
    const avail = /avail/i.test(statusWord);
    const rtt = rttStr && !isNaN(Number(rttStr)) ? Math.round(Number(rttStr)) : null;
    const hostMatch = /sip:[^@]+@([^;>\s]+)/.exec(uri);
    const prev = out.get(name);
    out.set(name, {
      username: name,
      registered: avail || (prev?.registered ?? false),
      contacts: (prev?.contacts ?? 0) + 1,
      rttMs: rtt ?? prev?.rttMs ?? null,
      via: hostMatch ? hostMatch[1] : (prev?.via ?? null)
    });
  }
  return out;
}

export function endpointStatus(usernames?: string[]): EndpointStatus[] {
  let raw = '';
  try { raw = execFileSync('asterisk', ['-rx', 'pjsip show contacts'], { stdio: 'pipe' }).toString(); }
  catch { raw = ''; }
  const map = parseContacts(raw);
  if (usernames && usernames.length) {
    return usernames.map((u) => map.get(u) || { username: u, registered: false, contacts: 0, rttMs: null, via: null });
  }
  return [...map.values()];
}
