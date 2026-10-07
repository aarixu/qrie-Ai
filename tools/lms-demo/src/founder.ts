import fs from 'node:fs';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { openDemoDatabase } from './database.ts';

/**
 * The founder console, over the demo school's database for now (migration
 * 0041): every school with its licence, seats in use, people and the day it
 * was last active, and setting a school's licence. It runs as the
 * database's owner, standing in for the hosted project's service role, so it
 * may call lms.founder_schools and lms.set_licence, which no signed-in person
 * can.
 *
 * It opens the demo's database itself, which only one program may hold at a
 * time, so it will not run while something answers on the demo's port.
 */

export const FOUNDER_USAGE = [
  'The founder console, over the demo school (stop the demo first).',
  '',
  '  npm run founder -- list',
  '      every school: plan, seats in use of the total, last day, students, teachers, last activity',
  '  npm run founder -- set <SCHOOL-CODE> --plan pilot --seats 500 --until 2027-03-31',
  "      sets a school's licence; setting it again replaces it",
  '',
  'Both take --port <n> if the demo runs on a port other than 54400.',
].join('\n');

export interface FounderSchool {
  code: string;
  schoolName: string;
  plan: string | null;
  seats: number | null;
  /** Students in a class of this year who have not left. */
  seatsUsed: number;
  /** YYYY-MM-DD. */
  validUntil: string | null;
  /** 0 on the last day, below 0 once it has ended. */
  daysLeft: number | null;
  students: number;
  teachers: number;
  /** India's date of the latest attendance mark, hand-in, work published or ledger event. */
  lastActive: string | null;
  daysSinceActive: number | null;
}

export interface LicenceChange {
  code: string;
  plan: string;
  seats: number;
  /** YYYY-MM-DD. */
  until: string;
}

export type FounderCommand =
  | { kind: 'help' }
  | { kind: 'list'; port: number }
  | ({ kind: 'set'; port: number } & LicenceChange);

export class FounderUsageError extends Error {}

const DEMO_PORT = 54400;
const CODE = /^[A-Z0-9]{3,12}$/;
const PLAN = /^[a-z][a-z0-9-]{0,29}$/;

function realDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** The command line after `npm run founder --`. Throws FounderUsageError, in words for the founder. */
export function parseFounderArgs(argv: string[]): FounderCommand {
  const [command, ...rest] = argv;
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') return { kind: 'help' };
  if (command !== 'list' && command !== 'set') throw new FounderUsageError(`Unknown command "${command}". Use list or set.`);

  const known = command === 'set' ? ['--plan', '--seats', '--until', '--port'] : ['--port'];
  const flags = new Map<string, string>();
  const words: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) {
      words.push(a);
      continue;
    }
    if (!known.includes(a)) throw new FounderUsageError(`Unknown option ${a}.`);
    const v = rest[i + 1];
    if (v === undefined || v.startsWith('--')) throw new FounderUsageError(`${a} needs a value.`);
    flags.set(a, v);
    i++;
  }

  const portText = flags.get('--port') ?? String(DEMO_PORT);
  const port = Number(portText);
  if (!/^\d{1,5}$/.test(portText) || port < 1 || port > 65535) {
    throw new FounderUsageError('--port is a port number, like 54400.');
  }

  if (command === 'list') {
    if (words.length) throw new FounderUsageError('list takes no school code.');
    return { kind: 'list', port };
  }

  if (words.length === 0) throw new FounderUsageError('Give the school code, like DEMO.');
  if (words.length > 1) throw new FounderUsageError('Give one school code.');
  const code = words[0].trim().toUpperCase();
  if (!CODE.test(code)) throw new FounderUsageError('A school code is 3 to 12 letters or digits, like DEMO.');
  const plan = flags.get('--plan');
  const seatsText = flags.get('--seats');
  const until = flags.get('--until');
  if (plan === undefined || seatsText === undefined || until === undefined) {
    throw new FounderUsageError('Give --plan, --seats and --until.');
  }
  const word = plan.trim().toLowerCase();
  if (!PLAN.test(word)) throw new FounderUsageError('--plan is one word of up to 30 letters, digits or hyphens, like pilot.');
  const seats = Number(seatsText);
  if (!/^\d{1,6}$/.test(seatsText) || seats < 1 || seats > 100000) {
    throw new FounderUsageError('--seats is a whole number from 1 to 100000.');
  }
  if (!realDate(until)) throw new FounderUsageError('--until is a date like 2027-03-31.');
  return { kind: 'set', port, code, plan: word, seats, until };
}

interface FounderRow {
  code: string;
  school_name: string;
  plan: string | null;
  seats: number | null;
  seats_used: number;
  valid_until: string | null;
  days_left: number | null;
  students: number;
  teachers: number;
  last_active: string | null;
  days_since_active: number | null;
}

/** Every school, by code (lms.founder_schools). */
export async function listSchools(db: PGlite): Promise<FounderSchool[]> {
  const { rows } = await db.query<FounderRow>(`select * from lms.founder_schools()`);
  return rows.map((r) => ({
    code: r.code,
    schoolName: r.school_name,
    plan: r.plan,
    seats: r.seats,
    seatsUsed: r.seats_used,
    validUntil: r.valid_until,
    daysLeft: r.days_left,
    students: r.students,
    teachers: r.teachers,
    lastActive: r.last_active,
    daysSinceActive: r.days_since_active,
  }));
}

/** Sets (or replaces) a school's licence (lms.set_licence); throws the database's sentence. */
export async function setLicence(db: PGlite, c: LicenceChange): Promise<void> {
  await db.query(`select lms.set_licence($1, $2, $3, $4::date)`, [c.code, c.plan, c.seats, c.until]);
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

function lastDay(s: FounderSchool): string {
  if (s.validUntil === null || s.daysLeft === null) return 'no licence set';
  if (s.daysLeft < 0) return `${s.validUntil} (ended ${days(-s.daysLeft)} ago)`;
  if (s.daysLeft === 0) return `${s.validUntil} (last day today)`;
  return `${s.validUntil} (${days(s.daysLeft)} left)`;
}

function lastSeen(s: FounderSchool): string {
  if (s.lastActive === null || s.daysSinceActive === null) return 'none yet';
  return `${s.lastActive} (${s.daysSinceActive === 0 ? 'today' : `${days(s.daysSinceActive)} ago`})`;
}

/** The list as a table for the terminal, one line per school. */
export function formatSchools(schools: FounderSchool[]): string {
  if (schools.length === 0) return 'There are no schools yet.';
  const table = [
    ['CODE', 'SCHOOL', 'PLAN', 'SEATS', 'VALID UNTIL', 'STUDENTS', 'TEACHERS', 'LAST ACTIVE'],
    ...schools.map((s) => [
      s.code,
      s.schoolName,
      s.plan ?? '-',
      `${s.seatsUsed}/${s.seats ?? '-'}${s.seats !== null && s.seatsUsed >= s.seats ? ' full' : ''}`,
      lastDay(s),
      String(s.students),
      String(s.teachers),
      lastSeen(s),
    ]),
  ];
  const widths = table[0].map((_, i) => Math.max(...table.map((r) => r[i].length)));
  return table.map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]))).join('  ')).join('\n');
}

/** Whether anything answers on the demo's port on this machine. */
export async function demoAnswers(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/rows/me`, { method: 'POST', signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

export interface FounderOptions {
  /** The demo database's directory (tools/lms-demo/.demo-data/db). */
  dbDir: string;
  isRunning: (port: number) => Promise<boolean>;
  print: (text: string) => void;
}

/** Runs one command; returns the exit code. */
export async function runFounder(argv: string[], opts: FounderOptions): Promise<number> {
  let command: FounderCommand;
  try {
    command = parseFounderArgs(argv);
  } catch (e) {
    if (!(e instanceof FounderUsageError)) throw e;
    opts.print(e.message);
    opts.print(FOUNDER_USAGE);
    return 1;
  }
  if (command.kind === 'help') {
    opts.print(FOUNDER_USAGE);
    return 0;
  }
  if (!fs.existsSync(path.join(opts.dbDir, 'PG_VERSION'))) {
    opts.print('There is no demo school yet. Build it first with: npm run demo');
    return 1;
  }
  if (await opts.isRunning(command.port)) {
    opts.print(
      `The demo school is running (something answers on port ${command.port}). Stop it first with Ctrl+C in its window: ` +
        'the founder console opens its database itself, and only one program may hold it at a time.',
    );
    return 1;
  }

  let db: PGlite;
  try {
    db = await openDemoDatabase(opts.dbDir);
  } catch (e) {
    opts.print((e as Error).message);
    return 1;
  }
  try {
    if (command.kind === 'set') {
      try {
        await setLicence(db, command);
      } catch (e) {
        opts.print(`Could not set the licence: ${(e as Error).message}.`);
        return 1;
      }
      opts.print(`Set the licence of ${command.code}: ${command.plan}, ${command.seats} seats, until ${command.until}.`);
    }
    opts.print(formatSchools(await listSchools(db)));
    return 0;
  } finally {
    await db.close();
  }
}
