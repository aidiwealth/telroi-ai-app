// The ONLY dashboard routes that mean something for a single sub-account.
// Everything else (wallet, invoices, billing, numbers, SIP, AI, optimize,
// people, teams, settings, sub-account management) is parent-level and is
// hidden while a sub-account is the active reporting lens.
export const SUBACCOUNT_ALLOWED_PATHS = ['/', '/calls', '/otp', '/crm'];

export function isSubaccountAllowed(path: string): boolean {
  if (!path) return false;
  const p = (path.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  if (p === '/') return true;
  return SUBACCOUNT_ALLOWED_PATHS.some((a) => a !== '/' && (p === a || p.startsWith(a + '/')));
}
