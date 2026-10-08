/**
 * The console's CSV files (a school's export, the audit log). A text cell that
 * a spreadsheet would run as a formula (starting with =, +, -, @, a tab or a
 * carriage return) gets a leading apostrophe; a number is written as it is.
 */
export type Cell = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

function cell(v: Cell): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One line per row, CRLF after each, the header first. */
export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** qrie-<what>-<environment>-<date>.csv, so a saved file says what, where and when. */
export const csvName = (what: string, env: string, isoDate: string): string => `qrie-${what}-${env}-${isoDate}.csv`;

/**
 * Saves the text as a file on this computer, through a temporary link. A byte
 * order mark goes first so a spreadsheet reads the names as UTF-8.
 */
export function downloadCsv(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
