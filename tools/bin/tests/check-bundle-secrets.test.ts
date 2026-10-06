// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * THE BUNDLE GUARD, PLANTED-LEAK TESTS. Written first.
 *
 * The script is run the way CI runs it, against a built folder given on the
 * command line. A service-role key is a JWT whose payload says role=service_role;
 * the anon key is a JWT too and is allowed, so only the payload tells them apart.
 */
const SCRIPT = path.resolve(import.meta.dirname, '../check-bundle-secrets.mjs');
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role: string) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role })}.${'s'.repeat(43)}`;

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-guard-'));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function build(name: string, js: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'index.js'), js);
  return dir;
}
const run = (...dirs: string[]) => spawnSync(process.execPath, [SCRIPT, ...dirs], { encoding: 'utf8', cwd: root });

describe('the bundle guard', () => {
  it('passes a clean build, and a build that holds only the anon key', () => {
    const clean = run(build('clean', 'console.log("hello")'));
    expect(clean.status).toBe(0);
    const anon = run(build('anon', `const KEY="${jwt('anon')}";`));
    expect(anon.status).toBe(0);
  });

  it('refuses a build that holds a service-role key, and says which kind without printing it', () => {
    const token = jwt('service_role');
    const r = run(build('leak', `const KEY="${token}";`));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/a service-role key appears in/);
    expect(r.stderr).not.toContain(token);
  });

  it('checks every folder it is given, not just the first', () => {
    const r = run(build('fine', 'x'), build('leak2', `var k="${jwt('service_role')}"`));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/leak2/);
  });

  it('ignores something JWT-shaped that is not a JWT', () => {
    const r = run(build('shaped', 'const s="eyJhbGciOiJIUzI1NiJ9.eyJub3RqcyBhdCBhbGw.aaaaaaaaaaaaaaaa";'));
    expect(r.status).toBe(0);
  });
});
