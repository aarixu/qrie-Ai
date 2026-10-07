// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readStudents } from '../../../tools/lms-import/src/sheet.ts';
import { xlsxToCsv } from '../src/index.ts';

/**
 * AN EXCEL WORKBOOK AS A SHEET. Written first.
 *
 * A school keeps its lists in Excel. The portal reads an .xlsx itself — its
 * first worksheet, as the CSV the import already reads — so nobody has to
 * "Save as CSV" first. An .xlsx is a zip of XML parts; this test builds one
 * the way Excel lays it out (shared strings with rich text, an inline string,
 * numbers, an empty cell skipped, a second sheet) and reads it back.
 */

// ---- A small zip writer, as Excel's files are made: deflated parts, a CRC each.
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const deflate = async (b: Uint8Array) =>
  new Uint8Array(await new Response(new Blob([b as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());

async function zip(files: Record<string, string>, stored: string[] = []): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const method = stored.includes(name) ? 0 : 8;
    const data = method ? await deflate(raw) : raw;
    const n = enc.encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, method, true);
    local.setUint32(14, crc32(raw), true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, n.length, true);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(10, method, true);
    dir.setUint32(16, crc32(raw), true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, raw.length, true);
    dir.setUint16(28, n.length, true);
    dir.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), n, data);
    central.push(new Uint8Array(dir.buffer), n);
    offset += 30 + n.length + data.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0));
  let at = 0;
  for (const b of all) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Students" sheetId="1" r:id="rId3"/><sheet name="Notes" sheetId="2" r:id="rId1"/></sheets></workbook>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/>
</Relationships>`;
const STRINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="7" uniqueCount="7">
<si><t>grade</t></si><si><t>section</t></si><si><t>roll</t></si><si><t>name</t></si>
<si><t>A</t></si>
<si><r><rPr><b/></rPr><t>Riya</t></r><r><t xml:space="preserve"> Sharma</t></r></si>
<si><t>D'Souza, Anna &amp; "Annie"</t></si>
</sst>`;
const SHEET1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
<row r="2"><c r="A2"><v>8</v></c><c r="B2" t="s"><v>4</v></c><c r="C2"><v>1</v></c><c r="D2" t="s"><v>5</v></c></row>
<row r="3"><c r="A3"><v>8.0000000000000002</v></c><c r="B3" t="inlineStr"><is><t>B</t></is></c><c r="C3"><v>12</v></c><c r="D3" t="s"><v>6</v></c></row>
<row r="5"><c r="A5"><v>9</v></c><c r="B5" t="str"><f>"A"</f><v>A</v></c><c r="D5" t="inlineStr"><is><t>No Roll</t></is></c></row>
</sheetData></worksheet>`;
const SHEET2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>not this one</t></is></c></row></sheetData></worksheet>`;

const workbook = (stored: string[] = []) =>
  zip(
    {
      '[Content_Types].xml': '<Types/>',
      'xl/workbook.xml': WORKBOOK,
      'xl/_rels/workbook.xml.rels': RELS,
      'xl/sharedStrings.xml': STRINGS,
      'xl/worksheets/sheet1.xml': SHEET1,
      'xl/worksheets/sheet2.xml': SHEET2,
    },
    stored,
  );

describe('an Excel workbook', () => {
  it('is read as its first worksheet, as CSV, cell by cell where Excel put it', async () => {
    expect(await xlsxToCsv(await workbook())).toBe(
      [
        'grade,section,roll,name',
        '8,A,1,Riya Sharma',
        '8,B,12,"D\'Souza, Anna & ""Annie"""',
        '',
        '9,A,,No Roll',
        '',
      ].join('\n'),
    );
  });

  it('reads parts stored without compression too', async () => {
    expect(await xlsxToCsv(await workbook(['xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']))).toContain('8,A,1,Riya Sharma');
  });

  it('gives the import the same rows a CSV would, row numbers and all', async () => {
    const { students, errors } = readStudents(await xlsxToCsv(await workbook()));
    expect(students.map((s) => [s.grade, s.section, s.roll, s.name])).toEqual([
      [8, 'A', '1', 'Riya Sharma'],
      [8, 'B', '12', 'D\'Souza, Anna & "Annie"'],
    ]);
    expect(errors.join('\n')).toMatch(/row 5/);
  });

  it('says so plainly when the file is not an Excel workbook', async () => {
    await expect(xlsxToCsv(new TextEncoder().encode('grade,section\n8,A\n'))).rejects.toThrow(/not an Excel workbook/);
    await expect(xlsxToCsv(await zip({ 'hello.txt': 'hi' }))).rejects.toThrow(/not an Excel workbook/);
  });
});
