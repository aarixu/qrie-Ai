import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * MEASURING f — the number the Rs 5 ceiling rests on.
 *
 * `f` is the share of spoken CLASS answers `resolveSpokenAnswer` settles with
 * no model. At f = 1.0 the rollup is Rs 3.49 and clears; at f = 0.70 it is
 * Rs 9.08 and does not. It has never been measured on class asks — the ~70%
 * that gets quoted is the placement and quiz bank, where the options are ON
 * SCREEN, and match.ts's own header says so.
 *
 * NOT IN THE SUITE, ON PURPOSE. vitest.config.ts includes
 * `tools/*\/tests/**`; this lives in `f-bench/`, so it runs only when named:
 *
 *   npx vitest run tools/measure/f-bench/f.bench.test.ts
 *
 * It reads a CACHED answer set (generate.mjs, paid, run once) and stubs the
 * judge model, so the measurement itself is free and repeatable. Re-run it
 * after any change to match.ts or the sawAList guard — that is the point of
 * splitting it from generation.
 *
 * WHAT IT MEASURES THAT MATTERS MORE THAN f: how often the local path resolves
 * a RIGHT answer as WRONG. On that path there is no model behind it to catch
 * the mistake, and telling a child who answered correctly in Hinglish that they
 * are wrong is the worst thing this product can do to somebody — match.ts's own
 * header says that too. f is an economics number; this one is not.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const answers = JSON.parse(readFileSync(path.join(HERE, 'answers.json'), 'utf8')) as Answered[];

interface Said {
  shape: string;
  said: string;
}
interface Answered {
  topicRef: string;
  beatId: string;
  question: string;
  hint: string | null;
  probe: {
    askedAs: string;
    options: { text: string; correct?: boolean; why: string; hint?: string }[];
  };
  blind: Said[];
  primed: Said[];
}

/**
 * The judge, stubbed. The bench only needs to know WHETHER an answer escalated,
 * never what a model would have said, and paying for 200 judge calls to learn
 * nothing would be the wrong kind of thorough.
 */
const escalations: string[] = [];
vi.mock('../../../apps/classroom/src/lib/browserLlm', () => ({
  createBrowserLlm: () => ({
    complete: (_system: string, user: string) => {
      escalations.push(user);
      return Promise.resolve('{"verdict":"right","say":"Good."}');
    },
  }),
  createBrowserImageArtist: () => ({}),
  createBrowserVision: () => ({}),
}));

type Row = {
  topicRef: string;
  beatId: string;
  group: 'blind' | 'primed';
  shape: string;
  said: string;
  path: string;
  verdict: string;
  reading?: string;
  confidence?: number;
  /** What the matcher scored before the floor and the guards had their say. */
  rawConfidence: number;
  rawBy: string;
};

const rows: Row[] = [];

beforeEach(() => {
  escalations.length = 0;
  localStorage.clear();
});

describe('f, measured on real class asks', () => {
  it('resolves every cached answer and writes the tally', async () => {
    const { resolveSpokenAnswer } = await import('../../../apps/classroom/src/lib/judge');
    const { matchSpokenAnswer } = await import('@ai-tutor/tutor-judge');

    for (const a of answers) {
      const ask = {
        question: a.question,
        ...(a.hint ? { hint: a.hint } : {}),
        whyProbe: a.probe,
      };
      for (const group of ['blind', 'primed'] as const) {
        for (const said of a[group]) {
          const r = await resolveSpokenAnswer(ask as never, said.said);
          /**
           * THE RAW SCORE, SEPARATELY. `ResolvedAnswer.confidence` is only set
           * when the answer resolved LOCALLY, so reading it on an escalation
           * gives undefined — and counting undefined as zero (which an earlier
           * version of this bench did) reports every escalation as "nowhere
           * near the floor" when many are five points under it. That is the
           * difference between "the matcher is the wrong idea" and "the
           * threshold is one decision", so it is measured rather than inferred.
           */
          const raw = matchSpokenAnswer(said.said, a.probe.options.map((o) => o.text));
          rows.push({
            topicRef: a.topicRef,
            beatId: a.beatId,
            group,
            shape: said.shape,
            said: said.said,
            path: r.path,
            verdict: r.verdict.verdict,
            ...(r.reading ? { reading: r.reading } : {}),
            ...(r.confidence !== undefined ? { confidence: r.confidence } : {}),
            rawConfidence: raw.confidence,
            rawBy: String(raw.by),
          });
        }
      }
    }

    expect(rows.length).toBeGreaterThan(0);

    // ---- the tally -------------------------------------------------------
    const byShape = new Map<string, Row[]>();
    for (const r of rows) {
      const key = `${r.group}:${r.shape}`;
      byShape.set(key, [...(byShape.get(key) ?? []), r]);
    }

    const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
    const shapeStats = [...byShape.entries()]
      .map(([key, rs]) => {
        const local = rs.filter((r) => r.path === 'local');
        return {
          shape: key,
          n: rs.length,
          local: local.length,
          localPct: pct(local.length, rs.length),
          // The one that matters: a RIGHT answer settled locally as WRONG.
          rightCalledWrong: key.includes('right-')
            ? local.filter((r) => r.verdict === 'wrong').length
            : 0,
        };
      })
      .sort((a, b) => a.shape.localeCompare(b.shape));

    const blind = rows.filter((r) => r.group === 'blind');
    const blindLocal = blind.filter((r) => r.path === 'local');
    const rightBlind = blind.filter((r) => r.shape.startsWith('right-'));
    const rightLocalWrong = rightBlind.filter((r) => r.path === 'local' && r.verdict === 'wrong');

    const report = {
      measuredAt: 'see git log for this file',
      asks: answers.length,
      answers: rows.length,
      /**
       * f OVER THE BLIND SET, WHICH IS THE HONEST ONE. It is an unweighted mean
       * over seven answer shapes given equal counts, so it is NOT a classroom's
       * f — a real mix is unknown and inventing weights would hide that. Read
       * the per-shape rates; this line is only a summary of them.
       */
      fBlindUnweighted: pct(blindLocal.length, blind.length),
      rightAnswersCalledWrongLocally: rightLocalWrong.length,
      rightAnswersTotal: rightBlind.length,
      byShape: shapeStats,
      /**
       * HOW FAR THE ESCALATED RIGHT ANSWERS WERE FROM THE FLOOR. This is the
       * band that decides what to do next: a pile sitting just under 0.55 is a
       * threshold question, and a pile at zero is a "this approach does not
       * reach these answers" question. They call for opposite work.
       */
      escalatedRightByBand: (() => {
        const bands = { '0.00': 0, '0.01-0.29': 0, '0.30-0.49': 0, '0.50-0.54': 0 };
        for (const r of rightBlind.filter((x) => x.path === 'model')) {
          const c = r.rawConfidence;
          if (c === 0) bands['0.00'] += 1;
          else if (c < 0.3) bands['0.01-0.29'] += 1;
          else if (c < 0.5) bands['0.30-0.49'] += 1;
          else bands['0.50-0.54'] += 1;
        }
        return bands;
      })(),
      dangerous: rightLocalWrong.map((r) => ({
        topicRef: r.topicRef,
        beatId: r.beatId,
        shape: r.shape,
        said: r.said,
        reading: r.reading,
        confidence: r.confidence,
      })),
      rows,
    };

    writeFileSync(path.join(HERE, 'result.json'), JSON.stringify(report, null, 2));

    const line = (s: string) => process.stdout.write(`${s}\n`);
    line('');
    line(`  asks ${report.asks}   answers ${report.answers}`);
    line(`  f (blind, unweighted across shapes): ${report.fBlindUnweighted}%`);
    line('');
    line('  shape                     n   local   %local   right-called-wrong');
    for (const s of shapeStats) {
      line(
        `  ${s.shape.padEnd(24)} ${String(s.n).padStart(2)}   ${String(s.local).padStart(4)}   ${String(s.localPct).padStart(6)}   ${String(s.rightCalledWrong).padStart(6)}`,
      );
    }
    line('');
    line(`  RIGHT ANSWERS SETTLED LOCALLY AS WRONG: ${rightLocalWrong.length} of ${rightBlind.length}`);
    line('');
  });
});
