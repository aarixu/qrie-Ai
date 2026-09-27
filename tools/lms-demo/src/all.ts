import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * npm run demo:all — the demo school and both apps, from one command.
 *
 * Starts the demo server (tools/lms-demo), the teacher app (apps/lms, port
 * 5180) and the student app (apps/student, port 5181), then prints the two
 * links to open. Anything already answering on its port is left alone, so
 * running this twice does no harm. Ctrl+C stops what this started.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

interface Piece {
  name: string;
  check: string;
  method: 'GET' | 'POST';
  cwd: string;
  command: string;
  args: string[];
}

const PIECES: Piece[] = [
  {
    name: 'demo school server',
    check: 'http://127.0.0.1:54400/rows/me',
    method: 'POST',
    cwd: ROOT,
    command: process.execPath,
    args: ['tools/lms-demo/src/cli.ts'],
  },
  {
    name: 'teacher app',
    check: 'http://localhost:5180/',
    method: 'GET',
    cwd: path.join(ROOT, 'apps/lms'),
    command: process.execPath,
    args: [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', '5180', '--strictPort'],
  },
  {
    name: 'student app',
    check: 'http://localhost:5181/',
    method: 'GET',
    cwd: path.join(ROOT, 'apps/student'),
    command: process.execPath,
    args: [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', '5181', '--strictPort'],
  },
];

async function answering(p: Piece): Promise<boolean> {
  try {
    await fetch(p.check, { method: p.method });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(p: Piece, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds; i++) {
    if (await answering(p)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

const started: ChildProcess[] = [];

async function main(): Promise<void> {
  for (const p of PIECES) {
    if (await answering(p)) {
      console.log(`✓ ${p.name} is already running`);
      continue;
    }
    console.log(`… starting the ${p.name}`);
    const child = spawn(p.command, p.args, { cwd: p.cwd, stdio: ['ignore', 'inherit', 'inherit'] });
    started.push(child);
    // The first build of the demo school takes about a minute.
    if (!(await waitFor(p, p.name === 'demo school server' ? 240 : 60))) {
      console.error(`✗ the ${p.name} did not start; see the lines above.`);
      stop(1);
      return;
    }
    console.log(`✓ ${p.name} is up`);
  }
  console.log('\nOpen these:');
  console.log('  Teachers: http://localhost:5180');
  console.log('  Students: http://localhost:5181  (best at phone size)');
  console.log(`  IDs and PINs: ${path.join(ROOT, 'tools/lms-demo/.demo-data/logins.md')}`);
  if (started.length) console.log('\nLeave this window open. Ctrl+C stops everything this started.');
}

function stop(code = 0): void {
  for (const c of started) c.kill();
  process.exit(code);
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
main().catch((e: unknown) => {
  console.error((e as Error).message);
  stop(1);
});
