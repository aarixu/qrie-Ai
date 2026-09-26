import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreatedAccount } from '../../lms-import/src/apply.ts';
import { isSeeded, openDemoDatabase } from './database.ts';
import { seedDemoSchool, type Planted } from './seed.ts';
import { diskWork, startDemoServer } from './server.ts';

/**
 * npm run demo [-- --reset] [-- --port 54400]
 *
 * Starts the demo school for the teacher app and the student app to share.
 * The first run builds it (about a minute: every migration, the whole
 * library, a month of homework) into tools/lms-demo/.demo-data/, and writes
 * the sign-in IDs and PINs to logins.md there. Later runs reuse it, so what
 * a tester did survives a restart; --reset throws it away and builds anew.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '../.demo-data');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function loginsMarkdown(logins: CreatedAccount[], planted: Planted[]): string {
  const staff = logins.filter((l) => l.kind !== 'student');
  const students = logins.filter((l) => l.kind === 'student');
  const lines = [
    '# Qrie Demo School — sign-in sheet',
    '',
    'Fictional people, made up for testing. School code: **DEMO**.',
    '',
    '## Staff (teacher app)',
    '',
    '| Role | Name | ID | PIN |',
    '|---|---|---|---|',
    ...staff.map((l) => `| ${l.kind} | ${l.displayName} | ${l.loginId} | ${l.pin} |`),
    '',
    '## Students (student app)',
    '',
    '| Class | Roll | Name | ID | PIN |',
    '|---|---|---|---|---|',
    ...students.map(
      (l) => `| ${l.grade}${l.section} | ${l.loginId.split('-').pop()} | ${l.displayName} | ${l.loginId} | ${l.pin} |`,
    ),
    '',
    '## Planted misconceptions (the answer key for checking the brain)',
    '',
    '| Student | ID | Class | Subject | What was planted |',
    '|---|---|---|---|---|',
    ...planted.map((p) => `| ${p.name} | ${p.loginId} | ${p.className} | ${p.subject} | ${p.why} |`),
    '',
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  if (process.argv.includes('--reset')) fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });
  const port = Number(arg('--port') ?? 54400);

  console.log('Opening the demo school…');
  const db = await openDemoDatabase(path.join(DATA, 'db'));
  if (!(await isSeeded(db))) {
    console.log('Building it for the first time: migrations, the library, a month of homework. About a minute.');
    const seeded = await seedDemoSchool(db);
    fs.writeFileSync(path.join(DATA, 'logins.md'), loginsMarkdown(seeded.logins, seeded.planted));
    fs.writeFileSync(path.join(DATA, 'planted.json'), `${JSON.stringify(seeded.planted, null, 2)}\n`);
  }

  const server = await startDemoServer({ db, port, work: diskWork(path.join(DATA, 'work')) });
  console.log(`\nDemo school running at ${server.url}`);
  console.log(`Sign-in IDs and PINs: ${path.join(DATA, 'logins.md')}`);
  console.log('Stop with Ctrl+C.\n');

  const stop = async () => {
    await server.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
