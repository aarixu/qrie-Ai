// @ts-nocheck — Deno, not the app's TypeScript project.
//
// THE BRAIN, ON A SCHEDULE (lam-one-brain Task 9).
//
// Every answer puts its learner on public.brain_queue (migration 0108). Each
// call to this function is one run of the brain: the settle pass, then one
// drain of the queue within its limits (200 learners, starting no new one
// after a second), each learner folded and written in their own transaction.
// Everything with a decision in it lives in packages/lms-brain (run.ts
// handleBrain, drain.ts, think.ts) and is covered by the repo's tests over the
// real migrations; packages/lms-brain/tests/brain-function.test.ts checks that
// everything this file reaches can be bundled. This file is the Deno adapter:
// it reads the environment, connects to the database and hands each request
// to handleBrain. It has NOT been deployed or run against a project.
//
// Deploy, after `supabase db push` has applied migrations up to 0108:
//   supabase secrets set BRAIN_SECRET=<a long random string>
//   supabase functions deploy brain --no-verify-jwt
// --no-verify-jwt because a schedule has no user to sign in; handleBrain
// refuses any call without the right x-brain-secret header, and every call
// while BRAIN_SECRET is unset. Then schedule it: docs/ops/runbook.md, "The
// brain". The schedule must keep running ahead of the nightly purge
// (purge_old_ledger, 0102), or an answer can be deleted before the model's
// snapshot holds it.
//
// Supabase supplies SUPABASE_DB_URL by itself. Postgres.js runs with
// prepare: false so the connection may also go through Supabase's
// transaction pooler. It logs one line of counts per run, never a learner.

import postgres from 'postgres';
import { handleBrain } from '../../../packages/lms-brain/src/run.ts';

const env = (name: string): string => Deno.env.get(name) ?? '';
const DB_URL = env('SUPABASE_DB_URL');
const SECRET = env('BRAIN_SECRET');

// One connection per isolate, kept between calls. A run uses it one query at
// a time, so one is enough.
const sql = DB_URL ? postgres(DB_URL, { prepare: false, max: 1, onnotice: () => {} }) : null;

// packages/lms-brain's Sql: query(text, params) -> {rows}, and a transaction.
const adapt = (q) => ({
  query: async (text: string, params?: unknown[]) => ({ rows: [...(await q.unsafe(text, params ?? []))] }),
});
const db = sql ? { ...adapt(sql), transaction: (fn) => sql.begin((tx) => fn(adapt(tx))) } : null;

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (request: Request) => {
  if (!db) return reply(503, { error: 'The brain is not set up: SUPABASE_DB_URL is missing.' });
  const out = await handleBrain(
    { method: request.method, secret: request.headers.get('x-brain-secret') },
    { db, secret: SECRET, log: (line: string) => console.log(line) },
  );
  return reply(out.status, out.body);
});
