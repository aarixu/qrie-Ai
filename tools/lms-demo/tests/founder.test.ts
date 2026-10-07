// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool } from '../../../supabase/tests/fixtures.ts';
import { openDemoDatabase } from '../src/database.ts';
import {
  formatSchools,
  listSchools,
  parseFounderArgs,
  runFounder,
  setLicence,
  type FounderSchool,
} from '../src/founder.ts';

/**
 * THE FOUNDER CONSOLE (npm run founder), over the demo database: every
 * school with its licence and when it was last active, and setting a
 * school's licence. Written first.
 */

describe('reading the command line', () => {
  it('knows list, set and help', () => {
    expect(parseFounderArgs(['list'])).toEqual({ kind: 'list', port: 54400 });
    expect(parseFounderArgs(['list', '--port', '54401'])).toEqual({ kind: 'list', port: 54401 });
    expect(parseFounderArgs(['set', 'demo', '--plan', 'Pilot', '--seats', '500', '--until', '2027-03-31'])).toEqual({
      kind: 'set',
      port: 54400,
      code: 'DEMO',
      plan: 'pilot',
      seats: 500,
      until: '2027-03-31',
    });
    expect(parseFounderArgs(['set', '--until', '2028-02-29', '--seats', '90', 'ABC1', '--plan', 'standard'])).toMatchObject({
      code: 'ABC1',
      plan: 'standard',
      seats: 90,
      until: '2028-02-29',
    });
    expect(parseFounderArgs([])).toEqual({ kind: 'help' });
    expect(parseFounderArgs(['help'])).toEqual({ kind: 'help' });
    expect(parseFounderArgs(['--help'])).toEqual({ kind: 'help' });
  });

  it('turns away a mistake in plain words', () => {
    const refused = (argv: string[]) => () => parseFounderArgs(argv);
    expect(refused(['delete'])).toThrow('Unknown command "delete". Use list or set.');
    expect(refused(['list', 'DEMO'])).toThrow('list takes no school code.');
    expect(refused(['set', '--plan', 'pilot', '--seats', '5', '--until', '2027-03-31'])).toThrow(
      'Give the school code, like DEMO.',
    );
    expect(refused(['set', 'DE', '--plan', 'pilot', '--seats', '5', '--until', '2027-03-31'])).toThrow(
      'A school code is 3 to 12 letters or digits, like DEMO.',
    );
    expect(refused(['set', 'DEMO', 'MORE', '--plan', 'pilot', '--seats', '5', '--until', '2027-03-31'])).toThrow(
      'Give one school code.',
    );
    expect(refused(['set', 'DEMO', '--plan', 'pilot', '--seats', '5'])).toThrow('Give --plan, --seats and --until.');
    expect(refused(['set', 'DEMO', '--plan', 'gold plan', '--seats', '5', '--until', '2027-03-31'])).toThrow(
      '--plan is one word of up to 30 letters, digits or hyphens, like pilot.',
    );
    for (const seats of ['0', '100001', 'many', '5.5']) {
      expect(refused(['set', 'DEMO', '--plan', 'pilot', '--seats', seats, '--until', '2027-03-31'])).toThrow(
        '--seats is a whole number from 1 to 100000.',
      );
    }
    for (const until of ['2027-02-30', '31-03-2027', 'soon']) {
      expect(refused(['set', 'DEMO', '--plan', 'pilot', '--seats', '5', '--until', until])).toThrow(
        '--until is a date like 2027-03-31.',
      );
    }
    expect(refused(['list', '--colour', 'red'])).toThrow('Unknown option --colour.');
    expect(refused(['set', 'DEMO', '--plan'])).toThrow('--plan needs a value.');
    expect(refused(['list', '--port', '0'])).toThrow('--port is a port number, like 54400.');
  });
});

describe('the list', () => {
  const row = (r: Partial<FounderSchool>): FounderSchool => ({
    code: 'DEMO',
    schoolName: 'Qrie Demo School',
    plan: 'pilot',
    seats: 90,
    seatsUsed: 82,
    validUntil: '2027-03-03',
    daysLeft: 151,
    students: 82,
    teachers: 4,
    lastActive: '2026-10-03',
    daysSinceActive: 0,
    ...r,
  });

  it('prints one line per school: plan, seats in use of the total, last day, students, teachers and last activity', () => {
    const text = formatSchools([
      row({}),
      row({
        code: 'GREEN',
        schoolName: 'Green Valley School',
        plan: 'standard',
        seats: 40,
        seatsUsed: 40,
        validUntil: '2026-10-02',
        daysLeft: -1,
        students: 41,
        teachers: 3,
        lastActive: '2026-09-19',
        daysSinceActive: 14,
      }),
      row({
        code: 'NEW',
        schoolName: 'New School',
        plan: null,
        seats: null,
        seatsUsed: 0,
        validUntil: null,
        daysLeft: null,
        students: 0,
        teachers: 1,
        lastActive: null,
        daysSinceActive: null,
      }),
      row({ code: 'ONE', schoolName: 'One Day School', validUntil: '2026-10-03', daysLeft: 0, lastActive: '2026-10-02', daysSinceActive: 1 }),
    ]);
    expect(text.split('\n')).toEqual([
      'CODE   SCHOOL               PLAN      SEATS       VALID UNTIL                   STUDENTS  TEACHERS  LAST ACTIVE',
      'DEMO   Qrie Demo School     pilot     82/90       2027-03-03 (151 days left)    82        4         2026-10-03 (today)',
      'GREEN  Green Valley School  standard  40/40 full  2026-10-02 (ended 1 day ago)  41        3         2026-09-19 (14 days ago)',
      'NEW    New School           -         0/-         no licence set                0         1         none yet',
      'ONE    One Day School       pilot     82/90       2026-10-03 (last day today)   82        4         2026-10-02 (1 day ago)',
    ]);
  });

  it('says so when there are no schools', () => {
    expect(formatSchools([])).toBe('There are no schools yet.');
  });
});

describe('over a database', () => {
  let db: PGlite;
  let today: string;
  const addDays = (ymd: string, n: number) =>
    new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    db = await openDemoDatabase();
    await buildSchool(db, 'BETA');
    await buildSchool(db, 'ALPHA');
    today = (await db.query<{ d: string }>(`select lms.india_today()::text as d`)).rows[0].d;
  }, 60_000);
  afterAll(async () => {
    await db?.close();
  });

  it('lists every school, by code, and sets a licence', async () => {
    await setLicence(db, { code: 'ALPHA', plan: 'pilot', seats: 5, until: addDays(today, 10) });
    const rows = await listSchools(db);
    expect(rows).toEqual([
      {
        code: 'ALPHA',
        schoolName: 'ALPHA Public School',
        plan: 'pilot',
        seats: 5,
        seatsUsed: 2,
        validUntil: addDays(today, 10),
        daysLeft: 10,
        students: 2,
        teachers: 2,
        lastActive: null,
        daysSinceActive: null,
      },
      expect.objectContaining({ code: 'BETA', plan: null, seats: null, seatsUsed: 2, validUntil: null }),
    ]);
    await expect(setLicence(db, { code: 'NOPE', plan: 'pilot', seats: 5, until: today })).rejects.toThrow(
      /no school with the code NOPE/,
    );
  });
});

describe('running it', () => {
  let dir: string;
  const out: string[] = [];
  const run = (argv: string[], running = false) =>
    runFounder(argv, { dbDir: path.join(dir, 'db'), isRunning: async () => running, print: (s) => out.push(s) });

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qrie-founder-'));
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('asks for the demo school to be built first, and to be stopped first', async () => {
    out.length = 0;
    expect(await run(['list'])).toBe(1);
    expect(out.join('\n')).toMatch(/There is no demo school yet\. Build it first with: npm run demo/);

    const db = await openDemoDatabase(path.join(dir, 'db'));
    await buildSchool(db, 'GAMMA');
    await db.close();

    out.length = 0;
    expect(await run(['list'], true)).toBe(1);
    expect(out.join('\n')).toMatch(/The demo school is running \(something answers on port 54400\)\. Stop it first/);
  }, 60_000);

  it('sets a licence and lists the schools, then says what it did', async () => {
    out.length = 0;
    expect(await run(['set', 'gamma', '--plan', 'pilot', '--seats', '50', '--until', '2027-03-31'])).toBe(0);
    expect(out[0]).toBe('Set the licence of GAMMA: pilot, 50 seats, until 2027-03-31.');
    expect(out[1]).toMatch(/^CODE +SCHOOL/);
    expect(out[1]).toMatch(/\nGAMMA +GAMMA Public School +pilot +2\/50 +2027-03-31 /);

    out.length = 0;
    expect(await run(['set', 'NOPE', '--plan', 'pilot', '--seats', '50', '--until', '2027-03-31'])).toBe(1);
    expect(out).toEqual(['Could not set the licence: there is no school with the code NOPE.']);

    out.length = 0;
    expect(await run(['set', 'GAMMA', '--plan', 'pilot'])).toBe(1);
    expect(out[0]).toBe('Give --plan, --seats and --until.');
    expect(out[1]).toMatch(/npm run founder -- list/);

    out.length = 0;
    expect(await run([])).toBe(0);
    expect(out[0]).toMatch(/npm run founder -- set <SCHOOL-CODE> --plan pilot --seats 500 --until 2027-03-31/);
  }, 60_000);
});
