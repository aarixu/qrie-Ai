/**
 * Whether a key is one that must never be in a browser: a Supabase service-role
 * JWT (its payload says role = service_role) or a new-style secret key
 * (sb_secret_…). The anon key is a JWT too and belongs in the bundle, so only the
 * payload can tell them apart. The console refuses to start with such a key, so a
 * key pasted into the wrong box on the host is caught on the first page load.
 */
export function isServiceRoleKey(key: string | null | undefined): boolean {
  if (!key) return false;
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as { role?: unknown } | null;
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}
