import type { Level, SchoolRow } from '@ai-tutor/admin-client';

/** The schools list's filters. An empty level list keeps every level. */
export interface SchoolFilter {
  text: string;
  health: Level[];
  payment: Level[];
  offboarded: 'show' | 'hide' | 'only';
}

/** Text matches the start of a code or anywhere in a name, in any case. */
export function filterSchools(rows: SchoolRow[], f: SchoolFilter): SchoolRow[] {
  const q = f.text.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!q || r.code.toLowerCase().startsWith(q) || r.name.toLowerCase().includes(q)) &&
      (f.health.length === 0 || f.health.includes(r.healthLevel)) &&
      (f.payment.length === 0 || f.payment.includes(r.paymentLevel)) &&
      (f.offboarded === 'show' || (f.offboarded === 'hide' ? !r.offboarded : r.offboarded)),
  );
}

/** Schools whose code starts with the query, then those whose name contains it; at most 8, none for an empty query. */
export function matchSchool<T extends { code: string; name: string }>(query: string, index: T[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const byCode = index.filter((s) => s.code.toLowerCase().startsWith(q));
  const byName = index.filter((s) => !s.code.toLowerCase().startsWith(q) && s.name.toLowerCase().includes(q));
  return [...byCode, ...byName].slice(0, 8);
}
