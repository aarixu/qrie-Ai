/**
 * Rupees for people, paise for the database. Integer arithmetic only, so a
 * shown amount is exactly the stored one.
 */

/** 12345678 -> '₹1,23,456.78' (Indian grouping: the last three digits, then pairs). */
export function formatPaise(p: number): string {
  const negative = p < 0;
  const abs = Math.abs(Math.round(p));
  const rupees = String(Math.floor(abs / 100));
  const paise = String(abs % 100).padStart(2, '0');
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${negative ? '-' : ''}₹${grouped}.${paise}`;
}

const AMOUNT = /^(\d+)(?:\.(\d{1,2}))?$/;

/** A typed amount in rupees (commas, spaces and a ₹ sign allowed) as whole paise above zero. */
export function parseRupees(text: string): { ok: true; paise: number } | { ok: false; error: string } {
  const refused = { ok: false as const, error: 'Enter an amount above zero, in rupees, with at most two decimals.' };
  const m = AMOUNT.exec(text.replace(/[₹,\s]/g, ''));
  if (!m) return refused;
  const paise = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(paise) || paise <= 0) return refused;
  return { ok: true, paise };
}
