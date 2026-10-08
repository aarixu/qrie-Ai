import { describe, expect, it } from 'vitest';
import { csvName, toCsv } from '../src/lib/csv.ts';

/** The console's CSV files: the school export and the audit log. Written first. */

describe('CSV', () => {
  it('quotes a field with a comma, a quote or a line break, and doubles quotes', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], ['two\nlines', 'plain']])).toBe(
      'a,b\r\n"x,y","say ""hi"""\r\n"two\nlines",plain\r\n',
    );
  });

  it('a text cell that a spreadsheet would run as a formula starts with an apostrophe; a negative number does not', () => {
    const csv = toCsv(['v'], [['=SUM(A1)'], ['+91'], ['-1'], ['@cmd'], ['\tx'], ['\rx'], [-5], ['safe']]);
    expect(csv.split('\r\n').slice(1, -1)).toEqual(["'=SUM(A1)", "'+91", "'-1", "'@cmd", "'\tx", "\"'\rx\"", '-5', 'safe']);
  });

  it('empty for null and undefined, CRLF between lines, and the name says what, where and when', () => {
    expect(toCsv(['a', 'b', 'c'], [[null, undefined, true], [0, false, '']])).toBe('a,b,c\r\n,,true\r\n0,false,\r\n');
    expect(csvName('audit', 'TEST', '2026-10-07')).toBe('qrie-audit-TEST-2026-10-07.csv');
    expect(csvName('PAGE-people', 'HOSTED', '2026-10-07')).toBe('qrie-PAGE-people-HOSTED-2026-10-07.csv');
  });
});
