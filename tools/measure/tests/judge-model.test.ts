import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JUDGE_SYSTEM, describeAsk, parseVerdict, type SpokenAsk } from '@ai-tutor/tutor-judge';

/**
 * WHICH MODEL SHOULD JUDGE A SPOKEN HINGLISH ANSWER, AND AT WHAT EFFORT?
 *
 * The judge is the whole recurring model bill — the class preparation is paid
 * once per topic and then cached, so every rupee that scales with students
 * goes through here. It is also the one call that can hurt somebody: a child
 * who answers correctly in Hinglish and is told they are wrong learns to stop
 * speaking, and the class swallows a failed judge on purpose, so a broken one
 * is silent rather than loud.
 *
 * WHY THIS HARNESS AND NOT THE OTHER ONE. `judge-thinking.test.ts` puts six
 * shapes of answer to twelve probes from the PLACEMENT bank, and those carry
 * four printed options. A class ask carries none — counted across all fifteen
 * committed lessons: 214 beats, 22 asks, zero with options, because
 * class-prep's prompt says a student picking from a list is recognising rather
 * than thinking. So the other harness tests a shape the classroom never sends.
 * This one reads the REAL asks out of the committed lessons and judges free
 * speech against the `expect` sentence, which is what production does.
 *
 * It scores ONE thing: how often a model called a RIGHT answer wrong. Not
 * accuracy, not WER, not agreement between models. That asymmetry is the
 * point — mis-reading a wrong answer as right costs one wasted cross-question,
 * and mis-reading a right one costs a child's willingness to answer aloud.
 *
 * Run:  MEASURE_JUDGE_MODEL=1 npx vitest run tools/measure/tests/judge-model.test.ts
 */

const env = Object.fromEntries(
  // Absent on a fresh checkout or worktree; the live suite below is skipped there anyway.
  (fs.existsSync(path.resolve(process.cwd(), '.env.local'))
    ? fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8')
    : '')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = env.VITE_SUPABASE_URL as string;
const ANON = env.VITE_SUPABASE_ANON_KEY as string;
const RELAY = env.VITE_RELAY_URL as string;

const RATE = 95.6;
const IN = 0.75 / 1e6;
const OUT = 3.75 / 1e6;

/** The contenders. `undefined` effort is what ships today. */
const ARMS: { model: string; effort?: 'none' | 'low' | 'medium' }[] = [
  { model: 'google/gemini-3.7-flash' },
  { model: 'google/gemini-3.7-flash', effort: 'low' },
  { model: 'google/gemini-3.8-flash', effort: 'low' },
  { model: 'google/gemini-3.1-flash-lite', effort: 'low' },
];

interface Beat {
  ask?: { question: string; expect?: string; hint?: string; options?: unknown[] };
}

/** Every ask a committed lesson actually holds. */
const realAsks = (): SpokenAsk[] => {
  const out: SpokenAsk[] = [];
  const root = path.resolve(process.cwd(), 'content');
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = path.join(root, dir.name, 'lesson.json');
    if (!fs.existsSync(file)) continue;
    const lesson = JSON.parse(fs.readFileSync(file, 'utf8')) as { beats?: Beat[] };
    for (const beat of lesson.beats ?? []) {
      if (!beat.ask?.question) continue;
      out.push({
        question: beat.ask.question,
        ...(beat.ask.expect ? { expect: beat.ask.expect } : {}),
        ...(beat.ask.hint ? { hint: beat.ask.hint } : {}),
      });
    }
  }
  return out;
};

/**
 * What a Class 10 student says out loud, built from the ask's OWN `expect`.
 *
 * `expect` is the planner's one-sentence statement of what a right answer
 * contains, so a student who says it in their own words is right by
 * construction — which is what makes "the model called this wrong" a
 * meaningful count rather than a matter of opinion.
 */
const ANSWERS = [
  { shape: 'plain', want: 'right', say: (e: string) => e },
  {
    shape: 'hinglish',
    want: 'right',
    say: (e: string) => `matlab mujhe lagta hai ${e.replace(/[.]$/, '').toLowerCase()}`,
  },
  {
    shape: 'halting',
    want: 'right',
    say: (e: string) => `umm... wo... ${e.replace(/[.]$/, '').toLowerCase()}, sahi hai na`,
  },
  { shape: 'dont-know', want: 'wrong', say: () => 'pata nahi sir' },
] as const;

describe.skipIf(!process.env.MEASURE_JUDGE_MODEL)('which model should judge a spoken answer', () => {
  it(
    'the same real asks, the same answers, four arms',
    async () => {
      const signup = await fetch(`${URL_}/auth/v1/signup`, {
        method: 'POST',
        headers: { apikey: ANON, 'content-type': 'application/json' },
        body: '{}',
      });
      const { access_token: token } = (await signup.json()) as { access_token: string };
      const auth = {
        apikey: ANON,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-session-id': crypto.randomUUID(),
      };

      const asks = realAsks().filter((a) => a.expect);
      expect(asks.length, 'committed asks carrying an expect sentence').toBeGreaterThan(5);

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const judge = async (
        arm: (typeof ARMS)[number],
        ask: SpokenAsk,
        said: string,
      ): Promise<{ verdict: string; inr: number; think: number }> => {
        for (let attempt = 0; ; attempt += 1) {
          const res = await fetch(`${RELAY}/api/llm`, {
            method: 'POST',
            headers: auth,
            body: JSON.stringify({
              model: arm.model,
              response_format: { type: 'json_object' },
              temperature: 0.7,
              ...(arm.effort ? { reasoning_effort: arm.effort } : {}),
              messages: [
                { role: 'system', content: JUDGE_SYSTEM() },
                { role: 'user', content: `${describeAsk(ask)}\n\nThe student said: "${said}"` },
              ],
            }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            choices?: { message?: { content?: string } }[];
            usage?: Record<string, number>;
            error?: { message?: string };
          };
          if ((res.status === 429 || res.status === 503) && attempt < 5) {
            await sleep(4000 * 2 ** attempt);
            continue;
          }
          if (!res.ok) throw new Error(`${arm.model}: ${res.status} ${data.error?.message ?? ''}`);
          const u = data.usage ?? {};
          const pin = u.promptTokenCount ?? 0;
          const pout = u.candidatesTokenCount ?? 0;
          const think = u.thoughtsTokenCount ?? 0;
          let verdict = 'unparsed';
          try {
            verdict = parseVerdict(data.choices?.[0]?.message?.content ?? '').verdict;
          } catch {
            /* a reply the parser refuses is itself a result */
          }
          return { verdict, inr: (pin * IN + (pout + think) * OUT) * RATE, think };
        }
      };

      interface Tally {
        right: number;
        total: number;
        inr: number;
        think: number;
        /** The one that matters: a right answer called anything else. */
        toldThemWrong: number;
        misses: string[];
      }
      const runs = new Map<string, Tally>();

      for (const arm of ARMS) {
        const name = `${arm.model.replace('google/', '')} ${arm.effort ?? '(default)'}`;
        const tally: Tally = { right: 0, total: 0, inr: 0, think: 0, toldThemWrong: 0, misses: [] };
        runs.set(name, tally);
        for (const ask of asks) {
          for (const a of ANSWERS) {
            const said = a.say(ask.expect ?? '');
            const got = await judge(arm, ask, said);
            tally.total += 1;
            tally.inr += got.inr;
            tally.think += got.think;
            if (got.verdict === a.want) tally.right += 1;
            else {
              if (a.want === 'right') tally.toldThemWrong += 1;
              if (tally.misses.length < 4) {
                tally.misses.push(`${a.shape}: "${said.slice(0, 46)}" -> ${got.verdict}`);
              }
            }
          }
        }
      }

      const lines = [
        '',
        `THE JUDGE, ON ${asks.length} REAL CLASS ASKS x ${ANSWERS.length} ANSWERS = ${asks.length * ANSWERS.length} per arm`,
        '',
        '  model                        correct   TOLD A RIGHT ANSWER WRONG   think      Rs/call   Rs/class(8)',
      ];
      for (const [name, t] of runs) {
        lines.push(
          `  ${name.padEnd(28)} ${String(t.right).padStart(3)}/${t.total}` +
            `   ${String(t.toldThemWrong).padStart(20)}` +
            `   ${String(t.think).padStart(6)}` +
            `   ₹${(t.inr / t.total).toFixed(4)}` +
            `   ₹${((t.inr / t.total) * 8).toFixed(3)}`,
        );
      }
      lines.push('');
      for (const [name, t] of runs) {
        if (t.misses.length === 0) continue;
        lines.push(`  ${name} got wrong:`);
        for (const m of t.misses) lines.push(`    ${m}`);
        lines.push('');
      }
      const report = lines.join('\n');
      console.log(report);

      fs.writeFileSync(
        path.resolve('tools/measure/last-judge-model.json'),
        JSON.stringify({ asks: asks.length, answers: ANSWERS.map((a) => a.shape), runs: [...runs] }, null, 2),
      );

      for (const [name, t] of runs) expect(t.total, name).toBe(asks.length * ANSWERS.length);
    },
    25 * 60_000,
  );
});
