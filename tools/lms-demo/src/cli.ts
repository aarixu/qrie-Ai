import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreatedAccount } from '../../lms-import/src/apply.ts';
import { isSeeded, openDemoDatabase } from './database.ts';
import { seedDemoSchool, type Planted } from './seed.ts';
import { vertexAiFromKey } from './ai.ts';
import { diskWork, startDemoServer, type DemoAi } from './server.ts';

/**
 * npm run demo [-- --reset] [-- --port 54400] [-- --lan]
 *
 * Starts the demo school for the teacher app and the student app to share.
 * --lan also listens on the local network, for the apps' Android builds on a
 * phone on the same Wi-Fi; it prints the address to give them.
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
  const staff = logins.filter((l) => l.kind === 'admin' || l.kind === 'teacher');
  const students = logins.filter((l) => l.kind === 'student');
  const parents = logins.filter((l) => l.kind === 'parent');
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
    '## Parents (student app)',
    '',
    '| Name | ID | PIN |',
    '|---|---|---|',
    ...parents.map((l) => `| ${l.displayName} | ${l.loginId} | ${l.pin} |`),
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

  // "Draft with AI" runs only with Qrie's Google Cloud key, as the relay's does.
  let ai: DemoAi | undefined;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (key) {
    try {
      ai = vertexAiFromKey(key);
    } catch (e) {
      console.error(`GOOGLE_SERVICE_ACCOUNT_JSON is set but unusable (${(e as Error).message}); Draft with AI stays off.`);
    }
  }

  const lan = process.argv.includes('--lan');
  const server = await startDemoServer({ db, port, work: diskWork(path.join(DATA, 'work')), ai, lan });
  console.log(`\nDemo school running at ${server.url}`);
  if (lan) {
    console.log(
      server.lanUrls.length
        ? `On this Wi-Fi, the phone apps reach it at: ${server.lanUrls.join('  or  ')}`
        : 'Asked for the local network, but this computer has no network address right now.',
    );
    console.log('If Windows asks whether Node.js may use private networks, allow it, or phones cannot connect.');
  }
  console.log(
    ai
      ? 'Draft with AI: on, billed to the Google Cloud project in GOOGLE_SERVICE_ACCOUNT_JSON.'
      : 'Draft with AI: off. Set GOOGLE_SERVICE_ACCOUNT_JSON to a service-account key to switch it on.',
  );
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
