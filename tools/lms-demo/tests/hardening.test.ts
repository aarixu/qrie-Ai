// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoBackend, memorySession, workPath } from '../../../packages/lms-client/src/index.ts';
import { openDemoDatabase } from '../src/database.ts';
import { seedDemoSchool, type Seeded } from '../src/seed.ts';
import { startDemoServer, type DemoServer } from '../src/server.ts';

/**
 * THE DEMO SERVER'S HARDENING (the 2026-10-08 security review). Written first.
 *
 * Every answer tells the browser not to guess its type and not to be framed;
 * a handed-in photo is checked by its first bytes, not only by the type the
 * phone declared, and is served so that nothing in it can run.
 */

let db: PGlite;
let seeded: Seeded;
let server: DemoServer;

beforeAll(async () => {
  db = await openDemoDatabase();
  seeded = await seedDemoSchool(db, { libraryPerClass: 40 });
  server = await startDemoServer({ db, port: 0 });
}, 180_000);
afterAll(async () => {
  await server?.close();
  await db?.close();
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>');

describe('the demo server', () => {
  it('tells the browser not to guess types and not to be framed, on every answer', async () => {
    for (const res of [
      await fetch(`${server.url}/public/school-brand/DEMO`),
      await fetch(`${server.url}/rows/me`, { method: 'POST' }),
      await fetch(`${server.url}/nowhere`),
    ]) {
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });

  it("takes a photo only when its first bytes are a JPEG's, PNG's or WebP's, whatever type it says", async () => {
    const kid = seeded.logins.find((l) => l.loginId === 'DEMO-8A-3')!;
    const b = demoBackend(server.url, memorySession());
    await b.signIn(kid.loginId, kid.pin);
    const me = (await b.api.me())!;
    const [hw] = (await b.api.myAssignments()).filter((a) => a.answerTypes.includes('photo'));
    const path = (n: string) => workPath(me.orgId, hw.id, me.userId, n);
    await expect(b.uploadWork(path('fake.jpg'), new Blob([HTML], { type: 'image/jpeg' }))).rejects.toThrow(/not a photo/);
    await expect(b.uploadWork(path('fake.png'), new Blob([JPEG], { type: 'image/png' }))).rejects.toThrow(/not a photo/);
    await b.uploadWork(path('real.jpg'), new Blob([JPEG], { type: 'image/jpeg' }));
    await b.uploadWork(path('real.png'), new Blob([PNG], { type: 'image/png' }));
  });

  it('serves a photo so that nothing in it can run', async () => {
    const kid = seeded.logins.find((l) => l.loginId === 'DEMO-8A-3')!;
    const b = demoBackend(server.url, memorySession());
    await b.signIn(kid.loginId, kid.pin);
    const me = (await b.api.me())!;
    const [hw] = (await b.api.myAssignments()).filter((a) => a.answerTypes.includes('photo'));
    const name = workPath(me.orgId, hw.id, me.userId, 'served.jpg');
    await b.uploadWork(name, new Blob([JPEG], { type: 'image/jpeg' }));
    const res = await fetch(await b.workUrl(name));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
