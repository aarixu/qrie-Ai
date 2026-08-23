import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSyllabus, type SubjectSyllabus } from '../../../packages/syllabus/src/syllabus.ts';
import {
  filterBooks,
  parseNcertCatalogue,
  pickPrimaryBook,
  slugify,
  type NcertBook,
} from './parse.ts';
import { createAdapterFromEnv } from './llm.ts';
import { buildChapterPrompt } from './prompt.ts';
import { generateChapters, mergeIntoSyllabus, syllabusIdFor } from './generate.ts';

/**
 * Pull the real NCERT curriculum into packages/syllabus/data.
 *
 *   node tools/pull-syllabus/src/cli.ts --list
 *   node tools/pull-syllabus/src/cli.ts --class 10 --subject Science --out packages/syllabus/data
 *   node tools/pull-syllabus/src/cli.ts --all --subjects Science,Mathematics --out packages/syllabus/data
 *
 * Chapter COUNTS are NCERT's; chapter titles and topics are the model's,
 * anchored to that count. Writing MERGES by chapter id, so a re-run fills gaps
 * instead of destroying work.
 */

const CACHE = fileURLToPath(new URL('../cache/ncert-textbook-index.html', import.meta.url));
const INDEX_URL = 'https://ncert.nic.in/textbook.php';

/**
 * ncert.nic.in refuses a bare request. A browser User-Agent and an on-site
 * Referer are what it wants before it will serve the index at all.
 */
const BROWSER_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  referer: INDEX_URL,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

function usage(message: string): never {
  console.error(`${message}

Usage:
  node tools/pull-syllabus/src/cli.ts --list
  node tools/pull-syllabus/src/cli.ts --class <6..12> --subject <name> --out <dir>
  node tools/pull-syllabus/src/cli.ts --all --subjects <a,b,c> --out <dir>

  --list       print the parsed catalogue (class, subject, book, chapters) and stop
  --class      one class, 6 to 12
  --subject    one subject, NCERT's spelling (see --list)
  --all        every class 6 to 12
  --subjects   comma-separated subject filter, used with --all
  --out        output directory, e.g. packages/syllabus/data
  --refresh    re-fetch the NCERT index instead of using the cached copy
  --dry-run    print the prompts and write nothing (needs no API key)

Env:
  LLM_PROVIDER            "gemini" (default) | "anthropic"
  GOOGLE_API_KEY | GEMINI_API_KEY | ANTHROPIC_API_KEY`);
  process.exit(2);
}

const flag = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function loadCatalogueHtml(refresh: boolean): Promise<string> {
  if (!refresh && fs.existsSync(CACHE)) return fs.readFileSync(CACHE, 'utf8');

  const res = await fetch(INDEX_URL, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`NCERT index ${res.status} ${res.statusText}`);
  const html = await res.text();
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, html);
  console.log(`Refreshed ${path.relative(process.cwd(), CACHE)} (${html.length} bytes).`);
  return html;
}

function printCatalogue(books: NcertBook[]): void {
  let klass = 0;
  let subject = '';
  for (const book of books) {
    if (book.klass !== klass) {
      console.log(`\n─── Class ${book.klass} ───`);
      klass = book.klass;
      subject = '';
    }
    if (book.subject !== subject) {
      console.log(`  ${book.subject}`);
      subject = book.subject;
    }
    console.log(`    ${String(book.chapters).padStart(2)} ch  ${book.code.padEnd(12)} ${book.title}`);
  }
  console.log(`\n${books.length} book(s).`);
}

function readExisting(file: string): SubjectSyllabus | null {
  if (!fs.existsSync(file)) return null;
  return loadSyllabus(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/**
 * Books grouped into one output file each ("<class>|<subject>"), each group
 * narrowed to its English edition(s).
 *
 * The grouping has to happen BEFORE pickPrimaryBook, not after: its fallback
 * for a subject with no English edition is per class+subject, so running it
 * across the whole catalogue at once would silently drop Hindi, Sanskrit and
 * Urdu — subjects that are taught but have no English textbook by definition.
 */
function selectBooks(books: NcertBook[]): Map<string, NcertBook[]> {
  const groups = new Map<string, NcertBook[]>();
  for (const book of books) {
    const key = `${book.klass}|${book.subject}`;
    const group = groups.get(key);
    if (group) group.push(book);
    else groups.set(key, [book]);
  }
  for (const [key, group] of groups) groups.set(key, pickPrimaryBook(group));
  return groups;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const wantList = argv.includes('--list');
  const wantAll = argv.includes('--all');
  const dryRun = argv.includes('--dry-run');
  const refresh = argv.includes('--refresh');
  const classArg = flag(argv, '--class');
  const subjectArg = flag(argv, '--subject');
  const subjectsArg = flag(argv, '--subjects');
  const outArg = flag(argv, '--out');

  const html = await loadCatalogueHtml(refresh);
  const catalogue = parseNcertCatalogue(html);

  const subjects = subjectsArg
    ? subjectsArg.split(',').map((s) => s.trim()).filter(Boolean)
    : subjectArg
      ? [subjectArg]
      : undefined;

  const klass = classArg ? Number(classArg) : undefined;
  if (klass !== undefined && (!Number.isInteger(klass) || klass < 6 || klass > 12)) {
    usage(`--class must be an integer from 6 to 12, got "${classArg}".`);
  }

  const selected = selectBooks(
    filterBooks(catalogue, { subjects, minClass: klass ?? 6, maxClass: klass ?? 12 }),
  );
  const flat = [...selected.values()].flat();

  if (wantList) {
    // --list narrows the same way a real pull would, so what it prints is
    // exactly the set the next command would spend money on.
    printCatalogue(flat);
    return;
  }

  if (!wantAll && !classArg) usage('Give --list, --class <n>, or --all.');
  if (!outArg) usage('Missing --out (e.g. packages/syllabus/data).');
  if (flat.length === 0) {
    usage('Nothing matched. Run --list to see what NCERT actually publishes.');
  }

  const outDir = path.resolve(process.cwd(), outArg);

  // A dry run must not demand an API key — it exists precisely to check the
  // prompt before spending anything.
  const adapter = dryRun ? { complete: async () => '{"chapters":[]}' } : createAdapterFromEnv();

  let written = 0;
  let failed = 0;
  // Set when the provider says we are out of quota: every later call would fail
  // the same way, so both loops unwind rather than printing the same 429 twenty
  // more times.
  let quotaExhausted = false;

  for (const books of selected.values()) {
    if (quotaExhausted) break;
    const first = books[0];
    const file = path.join(outDir, `${syllabusIdFor(first)}.json`);
    let syllabus = readExisting(file);

    for (const book of books) {
      console.log(
        `\n─── Class ${book.klass} ${book.subject}: "${book.title}" (${book.code}), ${book.chapters} chapters ───`,
      );

      if (dryRun) {
        const { system, user } = buildChapterPrompt(book, { syllabusId: syllabusIdFor(book) });
        console.log(`\n=== SYSTEM ===\n${system}\n\n=== USER ===\n${user}`);
        continue;
      }

      /*
       * A long run walks dozens of books, so one book's failure must not take
       * the rest with it. Quota exhaustion is the exception: every later call
       * would fail the same way, so stop and say so rather than printing the
       * same 429 twenty more times.
       */
      let result: Awaited<ReturnType<typeof generateChapters>>;
      try {
        result = await generateChapters(book, adapter, { syllabusId: syllabusIdFor(book) });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        failed += 1;
        console.error(`  ✗ ${message.slice(0, 200)}`);
        if (/\b429\b|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(message)) {
          console.error('\n  Quota exhausted — stopping. Re-run the same command after');
          console.error('  the reset; finished files are kept and gaps are filled in place.');
          break;
        }
        continue;
      }

      if (!result.ok) {
        failed += 1;
        console.error('  ✗ generation failed after a repair attempt:');
        for (const e of result.errors.slice(0, 8)) console.error(`      ${e}`);
        const rejected = path.join(outDir, `${syllabusIdFor(book)}.${slugify(book.code)}.rejected.json`);
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(rejected, result.raw);
        console.error(`    raw reply written to ${path.relative(process.cwd(), rejected)}`);
        continue;
      }

      const merged = mergeIntoSyllabus(syllabus, book, result.value);
      if (!merged.ok) {
        failed += 1;
        console.error(`  ✗ merge rejected: ${merged.errors.join('; ')}`);
        continue;
      }
      syllabus = merged.value;
      console.log(
        `  ✓ ${result.value.length} chapters (file now holds ${syllabus.chapters.length})`,
      );
    }

    if (dryRun || !syllabus) continue;

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(syllabus, null, 2)}\n`);
    written += 1;
    console.log(`  → ${path.relative(process.cwd(), file)}`);
  }

  if (dryRun) {
    console.log(`\n${flat.length} book(s). Nothing generated (--dry-run).`);
    return;
  }

  console.log(`\n${written} file(s) written, ${failed} book(s) failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
