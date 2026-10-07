// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDemoDatabase } from '../src/database.ts';
import { startDemoServer, type DemoServer } from '../src/server.ts';

/**
 * THE DEMO SCHOOL ON THE PHONE APPS. Written first.
 *
 * The Android builds of both apps reach the demo server over the laptop's
 * Wi-Fi. By default the server listens on this machine only; with `lan` it
 * listens on the local network too and says at which addresses. Either way it
 * answers only pages whose origin is this machine's or the apps' own
 * (http://localhost, the Android WebView's), never another site's.
 */

let db: PGlite;
let local: DemoServer;
let lan: DemoServer;

beforeAll(async () => {
  db = await openDemoDatabase();
  local = await startDemoServer({ db, port: 0 });
  lan = await startDemoServer({ db, port: 0, lan: true });
}, 120_000);
afterAll(async () => {
  await local?.close();
  await lan?.close();
  await db?.close();
});

const brand = (base: string, origin?: string) =>
  fetch(`${base}/public/school-brand/NOPE`, { headers: origin ? { origin } : {} });

describe('the demo server', () => {
  it('listens on this machine only, unless asked for the local network', async () => {
    expect(local.lanUrls).toEqual([]);
    expect((await brand(local.url)).status).toBe(200);
  });

  it('on the local network, says its addresses there and answers on them', async () => {
    for (const u of lan.lanUrls) expect(u).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/);
    expect((await brand(lan.url)).status).toBe(200);
    if (lan.lanUrls[0]) expect((await brand(lan.lanUrls[0])).status).toBe(200);
  });

  it("answers the apps' own pages, and no other site's", async () => {
    const app = await brand(lan.url, 'http://localhost');
    expect(app.status).toBe(200);
    expect(app.headers.get('access-control-allow-origin')).toBe('http://localhost');
    // The Android builds run on https://localhost, a secure context.
    expect((await brand(lan.url, 'https://localhost')).headers.get('access-control-allow-origin')).toBe('https://localhost');
    expect((await brand(lan.url, 'https://evil.example')).status).toBe(403);
    expect((await brand(lan.url, 'http://192.168.1.20:8080')).status).toBe(403);
  });
});
