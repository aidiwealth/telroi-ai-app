// server/utils/cursor.ts
// Keyset (cursor) pagination helpers. OFFSET pagination degrades badly on large
// tables (the DB scans+discards all skipped rows); keyset stays fast at any depth
// by seeking on an indexed (sortKey, id) tuple. Cursor is an opaque base64 of
// the last row's {t: ISO timestamp, id}.
export interface Cursor { t: string; id: string; }

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf-8').toString('base64url');
}
export function decodeCursor(raw?: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8'));
    if (o && o.t && o.id) return { t: o.t, id: o.id };
  } catch { /* bad cursor -> start from top */ }
  return null;
}
export const PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export function clampLimit(n: any): number {
  const v = parseInt(String(n ?? PAGE_SIZE), 10);
  if (Number.isNaN(v) || v <= 0) return PAGE_SIZE;
  return Math.min(v, MAX_PAGE_SIZE);
}
