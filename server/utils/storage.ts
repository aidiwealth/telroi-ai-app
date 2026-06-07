// server/utils/storage.ts
// File storage abstraction. Primary backend is Cloudflare R2 (S3-compatible API);
// falls back to local disk when R2 isn't configured so dev works out of the box.
// The bucket is PRIVATE — files are never publicly served. Reads go back through
// our own server (see the admin/client download endpoints), never via public URLs.
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

let _client: S3Client | null = null;
let _checked = false;

function r2() {
  if (_checked) return _client;
  _checked = true;
  const cfg = useRuntimeConfig();
  const { r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2Bucket } = cfg as any;
  if (r2AccountId && r2AccessKeyId && r2SecretAccessKey && r2Bucket) {
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: r2AccessKeyId, secretAccessKey: r2SecretAccessKey }
    });
  }
  return _client;
}

export function storageBackend(): 'r2' | 'local' {
  return r2() ? 'r2' : 'local';
}

const LOCAL_ROOT = process.env.LOCAL_STORAGE_DIR || '/tmp/telroi-storage';

// Build a namespaced object key, e.g. kyc/<tenantId>/<uuid>-<safeName>
export function buildKey(prefix: string, tenantId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  return `${prefix}/${tenantId}/${randomUUID()}-${safe}`;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const client = r2();
  if (client) {
    const cfg = useRuntimeConfig() as any;
    await client.send(new PutObjectCommand({ Bucket: cfg.r2Bucket, Key: key, Body: body, ContentType: contentType }));
    return;
  }
  // Local fallback
  const path = join(LOCAL_ROOT, key);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, body);
}

// Returns the object bytes + content type. Used by the server to STREAM the file
// to an authorized admin/client (we never hand out a public link).
export async function getObject(key: string): Promise<{ body: Buffer; contentType: string }> {
  const client = r2();
  if (client) {
    const cfg = useRuntimeConfig() as any;
    const res = await client.send(new GetObjectCommand({ Bucket: cfg.r2Bucket, Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    return { body: Buffer.from(bytes), contentType: res.ContentType || 'application/octet-stream' };
  }
  const path = join(LOCAL_ROOT, key);
  const body = await fs.readFile(path);
  return { body, contentType: guessType(key) };
}

export async function deleteObject(key: string): Promise<void> {
  const client = r2();
  if (client) {
    const cfg = useRuntimeConfig() as any;
    await client.send(new DeleteObjectCommand({ Bucket: cfg.r2Bucket, Key: key }));
    return;
  }
  try { await fs.unlink(join(LOCAL_ROOT, key)); } catch { /* ignore */ }
}

function guessType(key: string): string {
  const ext = key.toLowerCase().split('.').pop() || '';
  return ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[ext] || 'application/octet-stream';
}

// ── Presigned URLs for direct browser↔R2 transfer (large CRM imports) ──
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** A presigned PUT URL so the browser uploads a large file straight to R2,
 *  keeping it off the app server. Returns null when R2 isn't configured (dev
 *  local-disk mode) so the caller can fall back to a server upload. */
export async function presignPut(key: string, contentType: string, expiresIn = 900): Promise<string | null> {
  if (storageBackend() !== 'r2') return null;
  const client = r2();
  const cfg = useRuntimeConfig();
  return getSignedUrl(client, new PutObjectCommand({ Bucket: (cfg as any).r2Bucket, Key: key, ContentType: contentType }), { expiresIn });
}

/** A presigned GET URL so the server (or a worker) can stream the file back
 *  from R2 for parsing. */
export async function presignGet(key: string, expiresIn = 900): Promise<string | null> {
  if (storageBackend() !== 'r2') return null;
  const client = r2();
  const cfg = useRuntimeConfig();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: (cfg as any).r2Bucket, Key: key }), { expiresIn });
}
