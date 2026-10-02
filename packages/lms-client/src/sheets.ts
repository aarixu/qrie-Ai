import type { ImportedAccount } from './backend.ts';

/**
 * The sheets a school downloads from the portal: the two blank templates the
 * import reads (tools/lms-import/src/sheet.ts), and the list of new IDs and
 * PINs it gives back.
 */

export const STUDENTS_TEMPLATE = 'grade,section,roll,name,admission_no\r\n';
export const TEACHERS_TEMPLATE = 'name,teaches,role,staff_id\r\n';

/**
 * One CSV field. A field a spreadsheet would run as a formula (starting
 * = + - @ or a tab) is written with a leading apostrophe, so it shows as
 * text; commas, quotes and line breaks are quoted.
 */
function field(value: string | undefined): string {
  let v = value ?? '';
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n']/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Any table as a CSV, every field written the formula-safe way above. */
export function toCsv(rows: (string | undefined)[][]): string {
  return `${rows.map((r) => r.map(field).join(',')).join('\r\n')}\r\n`;
}

const rollOrder =(r: string | undefined) => (r && /^\d{1,9}$/.test(r) ? Number(r) : Number.MAX_SAFE_INTEGER);

/** Students by class and roll number, then staff by ID. */
export function credentialsCsv(schoolCode: string, created: ImportedAccount[]): string {
  const sorted = [...created].sort((a, b) => {
    const sa = a.kind === 'student' ? 0 : 1;
    const sb = b.kind === 'student' ? 0 : 1;
    if (sa !== sb) return sa - sb;
    if (sa === 0) {
      return (
        (a.className ?? '').localeCompare(b.className ?? '', 'en', { numeric: true }) ||
        rollOrder(a.roll) - rollOrder(b.roll) ||
        a.loginId.localeCompare(b.loginId)
      );
    }
    return a.loginId.localeCompare(b.loginId, 'en', { numeric: true });
  });
  const lines = [
    'name,role,class,roll,login_id,pin,school_code',
    ...sorted.map((c) =>
      [c.displayName, c.kind, c.className, c.roll, c.loginId, c.pin, schoolCode].map(field).join(','),
    ),
  ];
  return `${lines.join('\r\n')}\r\n`;
}
