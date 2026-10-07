/**
 * Days and times as India reads them (IST, UTC+05:30, no daylight saving).
 * The database's own "a day" is India's too (lms.india_today).
 */

/** Today's date in India, YYYY-MM-DD. */
export const istToday = (now: Date = new Date()): string => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** A moment as India reads it, such as "7 Oct 2026, 14:05". */
export function istTime(at: string): string {
  return new Date(at).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** A moment as India reads it, to the second and sortable: "2026-10-07 14:05:09". */
export const istStamp = (at: string): string =>
  new Date(Date.parse(at) + 330 * 60_000).toISOString().slice(0, 19).replace('T', ' ');

/** A YYYY-MM-DD date moved by whole days. */
export const addDays = (isoDate: string, days: number): string =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The school year a day falls in: 1 April to 31 March, named like 2026-27. */
export function academicYear(isoDate: string): { label: string; startsOn: string; endsOn: string } {
  const [y, m] = isoDate.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return { label: `${start}-${String((start + 1) % 100).padStart(2, '0')}`, startsOn: `${start}-04-01`, endsOn: `${start + 1}-03-31` };
}
