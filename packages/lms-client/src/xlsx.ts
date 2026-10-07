/**
 * AN EXCEL WORKBOOK AS A SHEET.
 *
 * A school keeps its lists in Excel, so the portal reads an .xlsx itself:
 * the workbook's first worksheet, as the CSV text the import already reads
 * (tools/lms-import sheet.ts), each cell in the row and column Excel put it
 * in, so the import's row numbers are Excel's. No library: an .xlsx is a zip
 * of XML parts, and the browser's own DecompressionStream unpacks it.
 *
 * Read: shared strings (rich text runs joined), inline strings, a formula's
 * last value, numbers (as Excel shows them when whole, e.g. 8 not 8.000…2)
 * and TRUE/FALSE. Dates stay Excel's day numbers: the templates have none.
 * The older .xls, .ods and .numbers are not read.
 */

const NOT_EXCEL = 'That file is not an Excel workbook (.xlsx). Save it from Excel as .xlsx or as CSV, and upload that.';

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** The zip's parts by name, each unpacked when asked for. */
function readZip(b: Uint8Array): Map<string, () => Promise<Uint8Array>> {
  // The end-of-central-directory record, within the last 64 KB + 22 bytes.
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (u32(b, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error(NOT_EXCEL);
  const count = u16(b, end + 10);
  let at = u32(b, end + 16);
  const parts = new Map<string, () => Promise<Uint8Array>>();
  const names = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (u32(b, at) !== 0x02014b50) throw new Error(NOT_EXCEL);
    const method = u16(b, at + 10);
    const size = u32(b, at + 20);
    const nameLength = u16(b, at + 28);
    const skip = nameLength + u16(b, at + 30) + u16(b, at + 32);
    const name = names.decode(b.subarray(at + 46, at + 46 + nameLength));
    const local = u32(b, at + 42);
    // Sizes come from the central directory: Excel may leave the local header's at 0.
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    const data = b.subarray(start, start + size);
    parts.set(name, async () => {
      if (method === 0) return data;
      if (method !== 8) throw new Error(NOT_EXCEL);
      const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    });
    at += 46 + skip;
  }
  return parts;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()],
  );

/** The text of every <t> inside `xml`, joined: a cell's whole string, rich runs and all. */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1])).join('');

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** 'C12' → column 2 (A is 0). */
const columnOf = (ref: string) => [...(/^[A-Z]+/.exec(ref)?.[0] ?? 'A')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

const quote = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export async function xlsxToCsv(bytes: Uint8Array): Promise<string> {
  const parts = readZip(bytes);
  const text = async (name: string) => {
    const part = parts.get(name);
    return part ? new TextDecoder().decode(await part()) : null;
  };

  const workbook = await text('xl/workbook.xml');
  if (!workbook) throw new Error(NOT_EXCEL);
  // The first worksheet, through the workbook's relationships to its part.
  const firstSheet = /<sheet\s[^>]*>/.exec(workbook)?.[0] ?? '';
  const relId = attr(firstSheet, 'r:id');
  const rels = (await text('xl/_rels/workbook.xml.rels')) ?? '';
  const rel = [...rels.matchAll(/<Relationship\s[^>]*>/g)].map((m) => m[0]).find((r) => attr(r, 'Id') === relId);
  const target = rel ? attr(rel, 'Target') : undefined;
  const sheetPath = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : 'xl/worksheets/sheet1.xml';
  const sheet = await text(sheetPath);
  if (!sheet) throw new Error(NOT_EXCEL);

  const shared = [...((await text('xl/sharedStrings.xml')) ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  const lines: string[] = [];
  for (const row of sheet.matchAll(/<row\s([^>]*)>([\s\S]*?)<\/row>|<row\s([^>]*)\/>/g)) {
    const r = Number(attr(` ${row[1] ?? row[3]}`, 'r') ?? lines.length + 1);
    while (lines.length < r - 1) lines.push('');
    const cells: string[] = [];
    for (const c of (row[2] ?? '').matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = ` ${c[1]}`;
      const body = c[2] ?? '';
      const type = attr(head, 't');
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'str' || type === 'e') value = unescape(v ?? '');
      else if (v !== undefined) {
        const n = Number(v);
        value = Number.isFinite(n) ? String(Number(n.toPrecision(15))) : unescape(v);
      }
      const at = columnOf(attr(head, 'r') ?? '');
      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    lines[r - 1] = cells.map(quote).join(',');
  }
  return lines.map((l) => `${l}\n`).join('');
}
