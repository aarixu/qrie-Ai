import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { sendTelegram, type Env } from './run.ts';

/**
 * THE AUDIT LOG'S COPY KEPT OFF THE PLATFORM. Once an hour, from outside the
 * project (.github/workflows/admin-audit-copy.yml), it reads the audit chain's
 * head through public.audit_head with the alarm's token, compares the hashes
 * of entries it saw before with what the database says now, and keeps the new
 * head. A changed, missing or broken entry is told to both chats; once a day
 * the head is told to the ops chat, so the chat history is a second copy.
 *
 * A run that cannot read the head (no answer, or the token refused) keeps the
 * heads as they were and counts itself in the file; the second blind run in a
 * row tells the ops chat, and so does every 24th after it while it lasts
 * (about once a day at one run an hour), and the first run that reads again
 * says so. Run from the command line, a blind run also exits non-zero, so the
 * scheduled job turns red. Nothing else watches this checker: the five-minute
 * alarm does not read the audit head.
 *
 * What the hashes catch: a kept entry whose row, or whose hash, changed since
 * it was seen, except a change that only moves text across a '|' between two
 * neighbouring fields (see 0055's header). They do not catch someone who can
 * replace public.audit_head itself (a database superuser) and makes it answer
 * with the kept hashes.
 *
 * Only sequence numbers, hashes and counts are kept or sent. It holds the
 * public anon key and the alarm's token, no service-role key.
 */

export interface HeadAnswer {
  at: string;
  entries: number;
  headSeq: number | null;
  headHash: string | null;
  intact: boolean;
  firstBreakSeq: number | null;
  unchained: number;
  known: { seq: number; hash: string | null }[];
}

export interface KnownHead {
  seq: number;
  hash: string;
  /** The India date it was first seen, YYYY-MM-DD. */
  seenOn: string;
}

/** What the file carries from run to run. An older file that is only the list of heads is read as such. */
export interface Kept {
  heads: KnownHead[];
  /** Blind runs in a row, up to this one; 0 after a run that read the head. */
  blindRuns: number;
}

/** The ops chat is told on this many blind runs in a row, */
export const BLIND_TELL_AFTER = 2;
/** and again every this many runs while it lasts (about a day at one run an hour). */
export const BLIND_TELL_EVERY = 24;

export function blindLine(runs: number): string | null {
  if (runs < BLIND_TELL_AFTER || (runs - BLIND_TELL_AFTER) % BLIND_TELL_EVERY !== 0) return null;
  return `The audit log's outside copy could not read the database on its last ${runs} runs, so nothing has been compared since. Check the alarm's token and the audit head function.`;
}

export const istDate = (now: Date): string => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export function problemsWith(known: KnownHead[], a: HeadAnswer): string[] {
  const out: string[] = [];
  if (!a.intact) {
    out.push(
      a.firstBreakSeq !== null
        ? `The audit log's chain is broken at entry ${a.firstBreakSeq}.`
        : `The audit log has ${a.unchained} entries outside its chain.`,
    );
  }
  const now = new Map(a.known.map((k) => [k.seq, k.hash]));
  const changed = known.filter((k) => now.get(k.seq) !== k.hash).length;
  if (changed > 0) {
    out.push(`${changed} audit log ${changed === 1 ? 'entry no longer matches' : 'entries no longer match'} the copy kept outside. Look before anything else.`);
  }
  return out;
}

export function keepHeads(known: KnownHead[], a: HeadAnswer, now: Date): KnownHead[] {
  const all = [...known];
  if (a.headSeq !== null && a.headHash !== null && !all.some((k) => k.seq === a.headSeq)) {
    all.push({ seq: a.headSeq, hash: a.headHash, seenOn: istDate(now) });
  }
  all.sort((x, y) => x.seq - y.seq);
  const newest = all.slice(-24);
  const firstOfDay = new Map<string, KnownHead>();
  for (const k of all) if (!firstOfDay.has(k.seenOn)) firstOfDay.set(k.seenOn, k);
  const days = [...firstOfDay.values()].slice(-120);
  const keep = new Map<number, KnownHead>();
  for (const k of [...days, ...newest]) keep.set(k.seq, k);
  return [...keep.values()].sort((x, y) => x.seq - y.seq);
}

export function dayLine(known: KnownHead[], a: HeadAnswer, now: Date): string | null {
  const today = istDate(now);
  if (known.some((k) => k.seenOn === today) || a.headSeq === null || a.headHash === null) return null;
  return `Audit log on ${today}: ${a.entries} entries, chain ${a.intact ? 'intact' : 'broken'}, head ${a.headSeq} ${a.headHash.slice(0, 16)}.`;
}

export async function fetchAuditHead(env: Env, seqs: number[], fetchImpl: typeof fetch = fetch): Promise<HeadAnswer | null> {
  try {
    const res = await fetchImpl(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/audit_head`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_token: env.ALERT_TOKEN, p_seqs: seqs.slice(-200) }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as HeadAnswer | { error: string };
    return 'error' in body ? null : body;
  } catch {
    return null;
  }
}

const headsOf = (v: unknown): KnownHead[] =>
  Array.isArray(v)
    ? v.filter((k): k is KnownHead => typeof k?.seq === 'number' && typeof k?.hash === 'string' && typeof k?.seenOn === 'string')
    : [];

const parse = (text: string | null): Kept => {
  try {
    const v = JSON.parse(text ?? '[]') as unknown;
    if (Array.isArray(v)) return { heads: headsOf(v), blindRuns: 0 };
    const o = (v ?? {}) as { heads?: unknown; blindRuns?: unknown };
    const runs = typeof o.blindRuns === 'number' && Number.isInteger(o.blindRuns) && o.blindRuns > 0 ? o.blindRuns : 0;
    return { heads: headsOf(o.heads), blindRuns: runs };
  } catch {
    return { heads: [], blindRuns: 0 };
  }
};

const keep = (k: Kept): string => JSON.stringify(k);

export async function runAuditCopy(
  env: Env,
  now: Date,
  store: { read(): Promise<string | null>; write(text: string): Promise<void> },
  fetchImpl: typeof fetch = fetch,
): Promise<{ sent: string[]; blind: boolean }> {
  const kept = parse(await store.read());
  const known = kept.heads;
  const answer = await fetchAuditHead(env, known.map((k) => k.seq), fetchImpl);
  if (!answer) {
    const runs = kept.blindRuns + 1;
    // The count is written before anything is sent, so a failed send cannot lose it.
    await store.write(keep({ heads: known, blindRuns: runs }));
    const line = blindLine(runs);
    if (line) await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_OPS, line, fetchImpl);
    return { sent: line ? [line] : [], blind: true };
  }
  const sent: string[] = [];
  if (kept.blindRuns >= BLIND_TELL_AFTER) {
    const back = `The audit log's outside copy reads the database again, after ${kept.blindRuns} blind runs.`;
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_OPS, back, fetchImpl);
    sent.push(back);
  }
  for (const p of problemsWith(known, answer)) {
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_OPS, p, fetchImpl);
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_SAFETY, p, fetchImpl);
    sent.push(p);
  }
  const line = dayLine(known, answer, now);
  if (line) {
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_OPS, line, fetchImpl);
    sent.push(line);
  }
  await store.write(keep({ heads: keepHeads(known, answer, now), blindRuns: 0 }));
  return { sent, blind: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const get = (k: keyof Env): string => {
    const v = process.env[k];
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  const env: Env = {
    SUPABASE_URL: get('SUPABASE_URL'), SUPABASE_ANON_KEY: get('SUPABASE_ANON_KEY'), ALERT_TOKEN: get('ALERT_TOKEN'),
    TELEGRAM_BOT_TOKEN: get('TELEGRAM_BOT_TOKEN'), TELEGRAM_CHAT_OPS: get('TELEGRAM_CHAT_OPS'), TELEGRAM_CHAT_SAFETY: get('TELEGRAM_CHAT_SAFETY'),
  };
  const file = process.env.AUDIT_HEADS_FILE || 'audit-heads.json';
  const store = {
    read: () => fs.readFile(file, 'utf8').catch(() => null),
    write: (text: string) => fs.writeFile(file, text, 'utf8'),
  };
  const r = await runAuditCopy(env, new Date(), store);
  console.log(r.blind ? 'could not read the audit head; heads kept as they were' : r.sent.length ? `sent ${r.sent.length}` : 'nothing to send');
  // A blind run fails the scheduled job, so it shows red as well as in the chat.
  if (r.blind) process.exitCode = 1;
}
