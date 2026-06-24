// control-app/src/provision.ts
// ───────────────────────────────────────────────────────────────────────────
// Standalone SIP endpoint provisioning (WS3).
//
// Mints a new SIP device for a tenant and makes it immediately usable:
//   1. Generates a unique SIP username + a strong random password.
//   2. Writes the PJSIP Realtime rows (ps_auths, ps_aors, ps_endpoints) so
//      Asterisk serves the endpoint instantly (no config edit/reload).
//   3. Writes the Telroi sip_endpoints row (the platform's own record), storing
//      the secret ENCRYPTED if an ENCRYPTION_KEY is available, else plaintext
//      with a warning (dev only).
//   4. Prints the credentials so a device can register.
//
// USAGE:
//   node --experimental-strip-types src/provision.ts <tenantId> [label]
//
// This is the standalone validation tool. Once proven, the same logic ports into
// the Telroi web app as a "provision SIP device" action. The control app then
// bridges person-routed calls to PJSIP/<sip_username> (Option B: route_target
// holds the sip_endpoints.id, resolved via the cache).
// ───────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import crypto from 'node:crypto';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL'); process.exit(1);
}

const tenantId = process.argv[2];
const label = process.argv[3] || 'Provisioned device';
if (!tenantId) {
  console.error('Usage: node --experimental-strip-types src/provision.ts <tenantId> [label]');
  process.exit(1);
}

// SIP domain clients register against.
const SIP_DOMAIN = process.env.SIP_DOMAIN || 'sip.telroi.ai';
// PJSIP transport the endpoint uses (matches your pjsip.conf transport name).
const TRANSPORT = process.env.PROVISION_TRANSPORT || 'transport-udp';
// Dialplan context inbound calls from this device enter.
const CONTEXT = process.env.PROVISION_CONTEXT || 'internal';

// Short, readable, unique-ish username: tnt_<8 hex>. Asterisk endpoint id ==
// auth id == aor id == this username, which keeps the realtime rows simple.
function genUsername(): string {
  return 'tnt_' + crypto.randomBytes(4).toString('hex');
}
// Strong alphanumeric password (avoid shell/SIP-unfriendly specials).
function genPassword(): string {
  return crypto.randomBytes(18).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
}

const sql = postgres(DATABASE_URL, { max: 2 });

async function main() {
  const username = genUsername();
  const password = genPassword();

  // 1) PJSIP Realtime rows. id == username for endpoint/auth/aor.
  //    Asterisk serves this endpoint the moment these rows exist.
  await sql.begin(async (tx) => {
    await tx`INSERT INTO ps_aors (id, max_contacts, remove_existing)
             VALUES (${username}, 1, 'yes')`;
    await tx`INSERT INTO ps_auths (id, auth_type, username, password)
             VALUES (${username}, 'userpass', ${username}, ${password})`;
    await tx`INSERT INTO ps_endpoints (id, transport, aors, auth, context, disallow, allow, direct_media)
             VALUES (${username}, ${TRANSPORT}, ${username}, ${username}, ${CONTEXT}, 'all', 'ulaw,alaw,opus', 'no')`;
  });

  // 2) Telroi sip_endpoints record. provider is a provider_kind enum — 'telroi'
  //    is the platform's own. kind describes the device class. secret stored
  //    encrypted if we can; else plaintext (dev) with a warning.
  const secretField = encryptSecret(password);
  const rows = await sql`
    INSERT INTO sip_endpoints (tenant_id, provider, kind, label, sip_username, secret_enc, domain)
    VALUES (${tenantId}, 'telroi', 'webrtc_user', ${label}, ${username}, ${secretField.value}, ${SIP_DOMAIN})
    RETURNING id
  `;
  const endpointId = rows[0].id;

  console.log('\n✅ Provisioned SIP endpoint');
  console.log('─────────────────────────────────────');
  console.log('  sip_endpoints.id :', endpointId, '  <-- put THIS in number_subscriptions.route_target (Option B)');
  console.log('  SIP username     :', username);
  console.log('  SIP password     :', password);
  console.log('  Domain / server  :', SIP_DOMAIN);
  console.log('  Port / transport : 5060 / UDP');
  console.log('  Tenant           :', tenantId);
  if (!secretField.encrypted) {
    console.log('  ⚠️  secret stored UNENCRYPTED (no ENCRYPTION_KEY set) — dev only.');
  }
  console.log('─────────────────────────────────────');
  console.log('Register a softphone with the username/password above, then set a');
  console.log('number_subscriptions.route_target to the sip_endpoints.id and dial it.\n');

  await sql.end();
}

// Encrypt the secret with AES-256-GCM if ENCRYPTION_KEY is set (hex/base64 32
// bytes). This mirrors a typical app crypto; if your web app uses a different
// scheme you'll re-encrypt on the app side later. For standalone validation,
// plaintext fallback is acceptable (dev DB, no live customers).
function encryptSecret(plain: string): { value: string; encrypted: boolean } {
  const keyRaw = process.env.ENCRYPTION_KEY;
  if (!keyRaw) return { value: plain, encrypted: false };
  try {
    const key = keyRaw.length === 64
      ? Buffer.from(keyRaw, 'hex')
      : Buffer.from(keyRaw, 'base64');
    if (key.length !== 32) return { value: plain, encrypted: false };
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // store iv:tag:ciphertext (base64)
    const packed = [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
    return { value: packed, encrypted: true };
  } catch {
    return { value: plain, encrypted: false };
  }
}

main().catch((err) => {
  console.error('Provisioning failed:', err);
  process.exit(1);
});
