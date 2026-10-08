// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { keepHeads, runAuditCopy, type HeadAnswer, type KnownHead } from '../src/audit-copy.ts';
import type { Env } from '../src/run.ts';

const SCRIPT = fileURLToPath(new URL('../src/audit-copy.ts', import.meta.url));

/**
 * THE AUDIT LOG'S COPY KEPT OFF THE PLATFORM. Written first.
 *
 * A fake database answers public.audit_head from a chain held here; a fake
 * Telegram records each message. Pins: what is kept from run to run, what is
 * told to which chat, that a blind read keeps the heads and counts itself and
 * is told after two in a row (and fails the job from the command line), and
 * that no message carries anything but counts, entry numbers and a short hash
 * prefix.
 */

const env: Env = {
  SUPABASE_URL: 'https://p.supabase.co/',
  SUPABASE_ANON_KEY: 'anon-key',
  ALERT_TOKEN: 'the-alert-token-that-must-not-be-sent-to-telegram',
  TELEGRAM_BOT_TOKEN: '123:bot-secret',
  TELEGRAM_CHAT_OPS: 'ops-chat',
  TELEGRAM_CHAT_SAFETY: 'safety-chat',
};

/** A 64-character hex hash, different for each (n, salt). */
const hx = (n: number, salt = 'a') => salt.repeat(64 - String(n).length) + String(n);

/** 2026-10-07 09:30 in India. */
const T0 = new Date('2026-10-07T04:00:00Z');
const hoursLater = (h: number) => new Date(T0.getTime() + h * 3_600_000);

interface World {
  chain: Map<number, string>;
  intact: boolean;
  firstBreakSeq: number | null;
  unchained: number;
  /** What the next read does instead of answering: fail to connect, or refuse the token. */
  next: 'answer' | 'reject' | 'refuse';
  asked: number[][];
  sent: { chat: string; text: string }[];
  file: string | null;
  writes: number;
}

function world(entries: number): World {
  const chain = new Map<number, string>();
  for (let i = 1; i <= entries; i++) chain.set(i, hx(i));
  return { chain, intact: true, firstBreakSeq: null, unchained: 0, next: 'answer', asked: [], sent: [], file: null, writes: 0 };
}

function fetchFor(w: World): typeof fetch {
  return (async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (url.includes('api.telegram.org')) {
      w.sent.push({ chat: String(body.chat_id), text: String(body.text) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (!url.endsWith('/rest/v1/rpc/audit_head')) throw new Error(`unexpected ${url}`);
    if (w.next === 'reject') throw new TypeError('fetch failed');
    if (w.next === 'refuse') return { ok: true, status: 200, json: async () => ({ error: 'not-allowed' }) };
    const seqs = body.p_seqs as number[];
    w.asked.push(seqs);
    const headSeq = w.chain.size ? Math.max(...w.chain.keys()) : null;
    const answer: HeadAnswer = {
      at: 'now',
      entries: w.chain.size,
      headSeq,
      headHash: headSeq === null ? null : (w.chain.get(headSeq) ?? null),
      intact: w.intact,
      firstBreakSeq: w.firstBreakSeq,
      unchained: w.unchained,
      known: seqs.map((seq) => ({ seq, hash: w.chain.get(seq) ?? null })),
    };
    return { ok: true, status: 200, json: async () => answer };
  }) as unknown as typeof fetch;
}

const run = (w: World, now: Date) =>
  runAuditCopy(
    env,
    now,
    {
      read: async () => w.file,
      write: async (text) => {
        w.file = text;
        w.writes += 1;
      },
    },
    fetchFor(w),
  );
const kept = (w: World) => (JSON.parse(w.file ?? '{"heads":[]}') as { heads: KnownHead[] }).heads;
const blindRuns = (w: World) => (JSON.parse(w.file ?? '{}') as { blindRuns?: number }).blindRuns;

describe('each hour', () => {
  it("a first run keeps the head and posts the day's line to the ops chat", async () => {
    const w = world(5);
    const r = await run(w, T0);
    expect(r.blind).toBe(false);
    expect(w.sent).toEqual([
      { chat: 'ops-chat', text: `Audit log on 2026-10-07: 5 entries, chain intact, head 5 ${hx(5).slice(0, 16)}.` },
    ]);
    expect(kept(w)).toEqual([{ seq: 5, hash: hx(5), seenOn: '2026-10-07' }]);
  });

  it('a later run the same India day keeps the new head and posts nothing', async () => {
    const w = world(5);
    await run(w, T0);
    w.sent.length = 0;
    for (let i = 6; i <= 8; i++) w.chain.set(i, hx(i));
    const r = await run(w, hoursLater(1));
    expect(r.sent).toEqual([]);
    expect(w.sent).toEqual([]);
    expect(kept(w).map((k) => k.seq)).toEqual([5, 8]);
  });

  it('an entry whose hash changed is reported to both chats, by count, and its first-seen hash is kept', async () => {
    const w = world(5);
    await run(w, T0);
    w.sent.length = 0;
    w.chain.set(5, hx(5, 'b'));
    await run(w, hoursLater(1));
    const text = '1 audit log entry no longer matches the copy kept outside. Look before anything else.';
    expect(w.sent).toEqual([
      { chat: 'ops-chat', text },
      { chat: 'safety-chat', text },
    ]);
    expect(kept(w)).toEqual([{ seq: 5, hash: hx(5), seenOn: '2026-10-07' }]);
  });

  it('a broken chain is reported to both chats with the entry number', async () => {
    const w = world(5);
    await run(w, T0);
    w.sent.length = 0;
    w.intact = false;
    w.firstBreakSeq = 3;
    await run(w, hoursLater(1));
    const text = "The audit log's chain is broken at entry 3.";
    expect(w.sent).toEqual([
      { chat: 'ops-chat', text },
      { chat: 'safety-chat', text },
    ]);
  });

  it('one blind or refused read sends nothing and keeps the heads as they were, counting the blind run', async () => {
    for (const next of ['reject', 'refuse'] as const) {
      const w = world(5);
      w.file = JSON.stringify([{ seq: 2, hash: hx(2), seenOn: '2026-10-06' }]);
      w.next = next;
      const r = await run(w, T0);
      expect(r).toEqual({ sent: [], blind: true });
      expect(w.sent).toEqual([]);
      expect(kept(w)).toEqual([{ seq: 2, hash: hx(2), seenOn: '2026-10-06' }]);
      expect(blindRuns(w)).toBe(1);
    }
  });

  it('two blind runs in a row tell the ops chat, again every 24 runs while it lasts, and the first run that reads again says so', async () => {
    const w = world(5);
    await run(w, T0);
    w.sent.length = 0;
    w.next = 'reject';
    const told: number[] = [];
    for (let n = 1; n <= 30; n++) {
      const before = w.sent.length;
      await run(w, hoursLater(n));
      if (w.sent.length > before) told.push(n);
    }
    expect(told).toEqual([2, 26]);
    expect(w.sent[0]).toEqual({
      chat: 'ops-chat',
      text: "The audit log's outside copy could not read the database on its last 2 runs, so nothing has been compared since. Check the alarm's token and the audit head function.",
    });
    expect(w.sent.every((s) => s.chat === 'ops-chat')).toBe(true);
    expect(blindRuns(w)).toBe(30);
    expect(kept(w).map((k) => k.seq)).toEqual([5]);

    w.sent.length = 0;
    w.next = 'answer';
    w.chain.set(6, hx(6));
    const back = await run(w, hoursLater(31));
    expect(back.blind).toBe(false);
    expect(w.sent).toContainEqual({ chat: 'ops-chat', text: "The audit log's outside copy reads the database again, after 30 blind runs." });
    expect(blindRuns(w)).toBe(0);
    expect(kept(w).map((k) => k.seq)).toEqual([5, 6]);
  });

  it('one blind run between good ones says nothing, then or after', async () => {
    const w = world(5);
    await run(w, T0);
    w.sent.length = 0;
    w.next = 'refuse';
    await run(w, hoursLater(1));
    w.next = 'answer';
    await run(w, hoursLater(2));
    expect(w.sent).toEqual([]);
    expect(blindRuns(w)).toBe(0);
  });

  it('run from the command line, a blind run exits non-zero so the scheduled job turns red, and keeps its count in the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-copy-'));
    try {
      const file = join(dir, 'heads.json');
      writeFileSync(file, JSON.stringify([{ seq: 2, hash: hx(2), seenOn: '2026-10-06' }]));
      const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', SCRIPT], {
        encoding: 'utf8',
        env: {
          ...process.env,
          AUDIT_HEADS_FILE: file,
          // Nothing listens on port 9 here, so the read fails at once.
          SUPABASE_URL: 'http://127.0.0.1:9',
          SUPABASE_ANON_KEY: 'anon-key',
          ALERT_TOKEN: 'token',
          TELEGRAM_BOT_TOKEN: '123:bot',
          TELEGRAM_CHAT_OPS: 'ops',
          TELEGRAM_CHAT_SAFETY: 'safety',
        },
      });
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/could not read the audit head/);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ heads: [{ seq: 2, hash: hx(2), seenOn: '2026-10-06' }], blindRuns: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('what is kept', () => {
  it('keeps the newest 24 heads and the first head of each India day for 120 days', () => {
    // Midnight in India on 2026-01-02, then one new head an hour for 200 days.
    const base = Date.UTC(2026, 0, 1, 18, 30);
    let known: KnownHead[] = [];
    for (let d = 0; d < 200; d++) {
      for (let h = 0; h < 24; h++) {
        const seq = d * 24 + h + 1;
        const answer: HeadAnswer = {
          at: 'now', entries: seq, headSeq: seq, headHash: hx(seq), intact: true, firstBreakSeq: null, unchained: 0, known: [],
        };
        known = keepHeads(known, answer, new Date(base + (d * 24 + h) * 3_600_000));
      }
    }
    const seqs = known.map((k) => k.seq);
    const newest = Array.from({ length: 24 }, (_, i) => 4777 + i);
    const firstOfDays = Array.from({ length: 120 }, (_, i) => (80 + i) * 24 + 1);
    expect(seqs).toEqual([...new Set([...firstOfDays, ...newest])].sort((a, b) => a - b));
    expect(new Set(known.map((k) => k.seenOn)).size).toBe(120);
    expect(known[0].seenOn).toBe('2026-03-23');
    expect(known.at(-1)?.seenOn).toBe('2026-07-20');
  });

  it('asks the database for the hashes of every head it keeps, at most 200', async () => {
    const small = world(10);
    small.file = JSON.stringify([2, 4, 6].map((seq) => ({ seq, hash: hx(seq), seenOn: '2026-10-06' })));
    await run(small, T0);
    expect(small.asked).toEqual([[2, 4, 6]]);

    const big = world(300);
    big.file = JSON.stringify(Array.from({ length: 250 }, (_, i) => ({ seq: i + 1, hash: hx(i + 1), seenOn: `d${i}` })));
    await run(big, T0);
    expect(big.asked[0]).toHaveLength(200);
    expect(big.asked[0][0]).toBe(51);
    expect(big.asked[0].at(-1)).toBe(250);
  });

  it('a damaged heads file starts over instead of failing', async () => {
    for (const damaged of ['not json{', JSON.stringify({ seq: 1 }), JSON.stringify([{ seq: 'x' }, null, 7])]) {
      const w = world(5);
      w.file = damaged;
      const r = await run(w, T0);
      expect(r.blind).toBe(false);
      expect(w.asked).toEqual([[]]);
      expect(kept(w)).toEqual([{ seq: 5, hash: hx(5), seenOn: '2026-10-07' }]);
    }
  });
});

describe('what is said', () => {
  it('no message carries anything but numbers, the words of the template and a 16-character hash prefix', async () => {
    const w = world(5);
    await run(w, T0);
    w.chain.set(5, hx(5, 'c'));
    w.chain.set(6, hx(6));
    w.intact = false;
    w.firstBreakSeq = 5;
    await run(w, hoursLater(1));
    w.firstBreakSeq = null;
    w.unchained = 2;
    await run(w, hoursLater(24));
    expect(w.sent.length).toBeGreaterThanOrEqual(5);
    for (const { text } of w.sent) {
      expect(text).toMatch(/^[A-Za-z0-9 .,:;()'-]+$/);
      expect(text).not.toContain('@');
      expect(text).not.toMatch(/[0-9a-f]{17,}/);
      expect(text).not.toContain(env.ALERT_TOKEN);
    }
    expect(w.sent.map((s) => s.text)).toContain('The audit log has 2 entries outside its chain.');
  });
});
