import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JUDGE_SYSTEM, describeAsk, parseVerdict, type SpokenAsk } from '@ai-tutor/tutor-judge';

/**
 * DOES THE JUDGE NEED TO THINK?
 *
 * Measured over one real class, the judge spent 2,460 prompt tokens, 296
 * output tokens and 2,353 THINKING tokens on four spoken answers. Thinking
 * bills at the output rate, so three quarters of that bill bought reasoning
 * nobody reads, on a question with four printed options.
 *
 * Turning it off is the single cheapest saving available. It is also the one
 * most likely to be quietly paid for in accuracy, and the cost of a wrong
 * verdict is not money: a child who answered correctly in Hinglish and was
 * told they were wrong is the worst thing this product can do to somebody.
 *
 * So this does not argue about it. It takes real probes out of the committed
 * bank, puts realistic spoken answers to them — English, Hindi, Hinglish,
 * letter-only, hedged, and the near-misses that actually decide this — and
 * runs the SAME judge twice against the deployed relay, once with thinking as
 * it ships today and once with it off. Then it prints what each cost and what
 * each got wrong.
 *
 * Run:  MEASURE_JUDGE=1 npx vitest run tools/measure/tests/judge-thinking.test.ts
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

const MODEL = 'google/gemini-3.7-flash';
const RATE = 95.6;
const IN = 0.75 / 1e6;
const OUT = 3.75 / 1e6;

/** The committed bank's own shape: options are plain strings. */
interface Probe {
  id: string;
  nodeId: string;
  question: string;
  options: string[];
  correctIndex: number;
  misconceptions?: string[];
}

/**
 * The answers a real Class 10 student gives out loud.
 *
 * Deliberately not four clean restatements of the right option. The cases that
 * decide whether thinking earns its keep are the ones where the words and the
 * idea come apart: a right idea in Hindi, a right idea phrased as the wrong
 * noun, a letter with nothing else, a hedge, and a distractor said confidently.
 */
type Shape = 'plain' | 'hinglish' | 'letter' | 'hedged' | 'wrong' | 'idk';

const say = (probe: Probe, shape: Shape): { said: string; expect: 'right' | 'wrong' } => {
  const right = probe.options[probe.correctIndex];
  const wrong = probe.options[(probe.correctIndex + 1) % probe.options.length];
  const letter = String.fromCharCode(65 + probe.correctIndex);
  const lower = (s: string) => s.replace(/[.]$/, '').toLowerCase();
  switch (shape) {
    case 'plain':
      return { said: right, expect: 'right' };
    case 'hinglish':
      return { said: `mujhe lagta hai ${lower(right)} wala hoga`, expect: 'right' };
    case 'letter':
      return { said: `option ${letter}`, expect: 'right' };
    case 'hedged':
      return { said: `umm shayad ${lower(right)}, sahi hai na?`, expect: 'right' };
    case 'wrong':
      return { said: wrong, expect: 'wrong' };
    case 'idk':
      // The pedagogy is explicit that this is WRONG and not unclear: a student
      // who does not know has told us something real.
      return { said: 'pata nahi', expect: 'wrong' };
  }
};

const SHAPES: Shape[] = ['plain', 'hinglish', 'letter', 'hedged', 'wrong', 'idk'];

describe.skipIf(!process.env.MEASURE_JUDGE)('does the judge need to think?', () => {
  it(
    'same answers, same judge, thinking on and off',
    async () => {
      const signup = await fetch(`${URL_}/auth/v1/signup`, {
        method: 'POST',
        headers: { apikey: ANON, 'content-type': 'application/json' },
        body: '{}',
      });
      const { access_token: token } = (await signup.json()) as { access_token: string };
      expect(token).toBeTruthy();
      const auth = {
        apikey: ANON,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-session-id': crypto.randomUUID(),
      };

      // Real probes from the committed bank, evenly spread through it rather
      // than the first N, which would all come from one chapter.
      const bank = JSON.parse(
        fs.readFileSync(
          path.resolve(process.cwd(), 'packages/knowledge-graph/data/class10-science.probes.json'),
          'utf8',
        ),
      ) as { probes: Probe[] } | Probe[];
      const all = (Array.isArray(bank) ? bank : bank.probes).filter(
        (p) => (p.options ?? []).length >= 3 && typeof p.correctIndex === 'number',
      );
      const COUNT = Number(process.env.JUDGE_PROBES ?? 12);
      const step = Math.max(1, Math.floor(all.length / COUNT));
      const probes = Array.from({ length: COUNT }, (_, i) => all[i * step]).filter(Boolean);
      expect(probes.length).toBeGreaterThan(0);

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const askJudge = async (
        ask: SpokenAsk,
        said: string,
        effort: 'none' | undefined,
      ): Promise<{ verdict: string; inr: number; think: number }> => {
        for (let attempt = 0; ; attempt += 1) {
          const res = await fetch(`${RELAY}/api/llm`, {
            method: 'POST',
            headers: auth,
            body: JSON.stringify({
              model: MODEL,
              response_format: { type: 'json_object' },
              temperature: 0.7,
              ...(effort ? { reasoning_effort: effort } : {}),
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
          if (!res.ok) throw new Error(`relay ${res.status}: ${data.error?.message ?? ''}`);
          // The relay hands Vertex's own usageMetadata straight through, so
          // these are Google's names, not OpenAI's. Getting them wrong here
          // would have reported a free judge and a saving that was not real.
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

      const runs: Record<string, { right: number; total: number; inr: number; think: number; misses: string[] }> = {
        thinking: { right: 0, total: 0, inr: 0, think: 0, misses: [] },
        off: { right: 0, total: 0, inr: 0, think: 0, misses: [] },
      };

      for (const probe of probes) {
        const ask: SpokenAsk = {
          question: probe.question,
          options: probe.options.map((text, i) => ({
            text,
            ...(i === probe.correctIndex ? { correct: true } : {}),
          })),
        };
        for (const shape of SHAPES) {
          const { said, expect: want } = say(probe, shape);
          for (const [name, effort] of [
            ['thinking', undefined],
            ['off', 'none'],
          ] as const) {
            const r = await askJudge(ask, said, effort);
            const run = runs[name];
            run.total += 1;
            run.inr += r.inr;
            run.think += r.think;
            if (r.verdict === want) run.right += 1;
            else run.misses.push(`${shape}: said "${said.slice(0, 42)}" -> ${r.verdict}, wanted ${want}`);
          }
        }
      }

      const lines = ['', `THE JUDGE, WITH AND WITHOUT THINKING — ${probes.length} real probes x ${SHAPES.length} ways of answering`, ''];
      for (const [name, r] of Object.entries(runs)) {
        lines.push(
          `  ${name.padEnd(9)} ${String(r.right).padStart(3)}/${r.total} correct ` +
            `(${((100 * r.right) / r.total).toFixed(0)}%)   ` +
            `${String(r.think).padStart(6)} thinking tokens   ₹${r.inr.toFixed(3)} for ${r.total} calls   ` +
            `₹${((r.inr / r.total) * 8).toFixed(3)} a class`,
        );
      }
      const saved = runs.thinking.inr - runs.off.inr;
      lines.push(
        '',
        `  Turning thinking off saves ${((100 * saved) / runs.thinking.inr).toFixed(0)}% of the judge's bill` +
          ` — ₹${((saved / runs.thinking.total) * 8 * (60 / 3.6)).toFixed(2)} per student-hour.`,
        `  It costs ${(runs.thinking.right - runs.off.right >= 0 ? '' : '+')}` +
          `${runs.thinking.right - runs.off.right} correct verdicts out of ${runs.thinking.total}.`,
        '',
      );
      for (const [name, r] of Object.entries(runs)) {
        if (r.misses.length === 0) continue;
        lines.push(`  what ${name} got wrong:`);
        for (const m of r.misses.slice(0, 10)) lines.push(`    ${m}`);
        if (r.misses.length > 10) lines.push(`    …and ${r.misses.length - 10} more`);
        lines.push('');
      }
      const report = lines.join('\n');
      console.log(report);

      fs.mkdirSync(path.resolve('tools/measure'), { recursive: true });
      fs.writeFileSync(
        path.resolve('tools/measure/last-judge-thinking.json'),
        JSON.stringify({ probes: probes.length, shapes: SHAPES, runs }, null, 2),
      );

      // The measurement is the point; it asserts only that it actually ran.
      expect(runs.thinking.total).toBe(probes.length * SHAPES.length);
      expect(runs.off.total).toBe(runs.thinking.total);
    },
    20 * 60_000,
  );
});
