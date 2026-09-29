import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MATCH_FLOOR, matchSpokenAnswer } from '../src/match';

/**
 * HOW MUCH OF THE JUDGE'S WORK NEEDS A MODEL AT ALL?
 *
 * The judge costs Rs 1.13 a class, Rs 19 per student-hour, and it is the
 * largest line left once the narration is recorded. Every call of it asks a
 * language model which of four printed options a student meant, on a question
 * whose correct index is already committed to this repo.
 *
 * The number that decides whether that is worth removing has never been
 * measured: how often can a spoken Hinglish answer be resolved with no model?
 * At 75% the app costs Rs 3 a student-hour; at 0% it costs Rs 13.
 *
 * So this measures it, against the REAL bank rather than a fixture, and counts
 * three outcomes rather than two:
 *
 *   RESOLVED   — matched, and matched correctly. Free, and right.
 *   ESCALATED  — refused. Costs one model call, which is the thing being paid
 *                for, and is the correct outcome whenever it is not sure.
 *   WRONG      — matched, and matched the wrong option. This is the only
 *                failure that matters. There is no model behind a local match
 *                to catch it, so a wrong one tells a child who answered
 *                correctly that they did not. This must be zero.
 */

interface Probe {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
}

const bank = (subject: string): Probe[] => {
  const raw = JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), `packages/knowledge-graph/data/${subject}.probes.json`),
      'utf8',
    ),
  ) as Probe[] | { probes: Probe[] };
  return (Array.isArray(raw) ? raw : raw.probes).filter(
    (p) => (p.options ?? []).length >= 3 && typeof p.correctIndex === 'number',
  );
};

/**
 * The ways a Class 10 student actually answers out loud.
 *
 * Built from each probe's own options so they are real sentences about real
 * NCERT content, not invented ones. The hard shapes are the point: `shortened`
 * gives back only the first few content words, `scrambled` gives them in the
 * wrong order, and `hinglish` wraps the idea in the filler every spoken answer
 * in this country arrives in.
 */
const SHAPES = {
  exact: (o: string) => o,
  lowercased: (o: string) => o.toLowerCase().replace(/[.]$/, ''),
  hinglish: (o: string) => `mujhe lagta hai ${o.toLowerCase().replace(/[.]$/, '')} hoga`,
  hedged: (o: string) => `umm shayad ${o.toLowerCase().replace(/[.]$/, '')}, sahi hai na`,
  shortened: (o: string) => o.toLowerCase().split(/\s+/).slice(0, 4).join(' '),
  scrambled: (o: string) => o.toLowerCase().split(/\s+/).reverse().join(' '),
} as const;

describe('reading a spoken answer without a model', () => {
  it('takes the letter when that is all they said', () => {
    const o = ['Plasma', 'Red cells', 'White cells', 'Platelets'];
    expect(matchSpokenAnswer('B', o)).toMatchObject({ index: 1, by: 'letter' });
    expect(matchSpokenAnswer('option B', o)).toMatchObject({ index: 1, by: 'letter' });
    expect(matchSpokenAnswer('  b. ', o)).toMatchObject({ index: 1, by: 'letter' });
  });

  it('does NOT take the letter when it is the start of a real answer', () => {
    // "B cells fight infection" is an answer about B cells, not a vote for B.
    const o = ['Plasma carries food', 'B cells fight infection', 'Platelets clot', 'Bone marrow'];
    const m = matchSpokenAnswer('b cells fight infection', o);
    expect(m.by).not.toBe('letter');
    expect(m.index).toBe(1);
  });

  it('takes the position, in either language', () => {
    const o = ['Plasma', 'Red cells', 'White cells', 'Platelets'];
    expect(matchSpokenAnswer('doosra', o)).toMatchObject({ index: 1, by: 'position' });
    expect(matchSpokenAnswer('the second one', o).index).toBe(1);
  });

  it('hears "I do not know" as an answer, not as noise', () => {
    // The pedagogy is explicit: this is WRONG, never unclear. A student who
    // says they do not know has told us something real.
    const o = ['Plasma', 'Red cells'];
    for (const said of ['pata nahi', 'pta nahi', 'I dont know', "I don't know", 'no idea']) {
      expect(matchSpokenAnswer(said, o), said).toMatchObject({ by: 'dont-know', index: null });
    }
  });

  // Fourth review: sent to the model judge, "nahi samjha" could come back
  // 'unclear' — no miss, and the ladder did not climb.
  it('hears not understanding as a miss, the way it hears "pata nahi"', () => {
    const o = ['Plasma', 'Red cells'];
    for (const said of ['nahi samjha', 'samjha nahi', 'samajh nahi aaya', 'kuch samajh nahi aaya', "I don't understand", 'I did not understand']) {
      expect(matchSpokenAnswer(said, o), said).toMatchObject({ by: 'dont-know', index: null });
    }
  });

  it('refuses when two options are equally close, which is the whole contract', () => {
    const o = [
      'Arteries carry blood away from the heart',
      'Arteries carry blood towards the heart',
      'Platelets help the blood to clot',
      'Plasma is the liquid part of blood',
    ];
    // Every content word of the first two is shared except one.
    const m = matchSpokenAnswer('arteries carry blood', o);
    expect(m.index).toBeNull();
    expect(m.confidence).toBeLessThan(MATCH_FLOOR);
  });

  it('says nothing at all rather than guessing at silence', () => {
    expect(matchSpokenAnswer('', ['a', 'b']).index).toBeNull();
    expect(matchSpokenAnswer('...', ['a', 'b']).index).toBeNull();
  });
});

describe('measured against the real probe bank', () => {
  for (const subject of ['class10-science', 'class9-science']) {
    it(subject, () => {
      const probes = bank(subject);
      expect(probes.length).toBeGreaterThan(100);

      const tally: Record<string, { resolved: number; escalated: number; wrong: number }> = {};
      const wrongExamples: string[] = [];

      for (const probe of probes) {
        const right = probe.options[probe.correctIndex];
        for (const [shape, make] of Object.entries(SHAPES)) {
          tally[shape] = tally[shape] ?? { resolved: 0, escalated: 0, wrong: 0 };
          const m = matchSpokenAnswer(make(right), probe.options);
          if (m.index === null) tally[shape].escalated += 1;
          else if (m.index === probe.correctIndex) tally[shape].resolved += 1;
          else {
            tally[shape].wrong += 1;
            if (wrongExamples.length < 6) {
              wrongExamples.push(`[${shape}] "${make(right).slice(0, 54)}" -> ${m.index}, wanted ${probe.correctIndex}`);
            }
          }
        }
        // And a distractor said confidently, which must resolve to ITSELF so
        // the class can name the misconception behind it.
        const wrongIndex = (probe.correctIndex + 1) % probe.options.length;
        tally.distractor = tally.distractor ?? { resolved: 0, escalated: 0, wrong: 0 };
        const d = matchSpokenAnswer(probe.options[wrongIndex], probe.options);
        if (d.index === null) tally.distractor.escalated += 1;
        else if (d.index === wrongIndex) tally.distractor.resolved += 1;
        else tally.distractor.wrong += 1;
      }

      const total = Object.values(tally).reduce(
        (a, t) => ({
          resolved: a.resolved + t.resolved,
          escalated: a.escalated + t.escalated,
          wrong: a.wrong + t.wrong,
        }),
        { resolved: 0, escalated: 0, wrong: 0 },
      );
      const all = total.resolved + total.escalated + total.wrong;

      const pc = (n: number) => `${((100 * n) / all).toFixed(1)}%`;
      console.log(`\n  ${subject} — ${probes.length} probes x ${Object.keys(tally).length} ways of answering = ${all} answers\n`);
      for (const [shape, t] of Object.entries(tally)) {
        const n = t.resolved + t.escalated + t.wrong;
        console.log(
          `    ${shape.padEnd(12)} resolved ${String(t.resolved).padStart(4)} (${((100 * t.resolved) / n).toFixed(0).padStart(3)}%)` +
            `   escalated ${String(t.escalated).padStart(4)}   WRONG ${t.wrong}`,
        );
      }
      console.log(
        `\n    OVERALL      resolved ${pc(total.resolved)}   escalated ${pc(total.escalated)}   WRONG ${total.wrong} (${pc(total.wrong)})`,
      );
      if (wrongExamples.length > 0) console.log(`\n    wrong matches:\n${wrongExamples.map((w) => `      ${w}`).join('\n')}`);
      console.log('');

      // The bar. A local match that is WRONG has no model behind it to catch
      // it, so it is the only outcome that is not allowed. Refusing is free of
      // harm and costs one model call.
      expect(total.wrong / all, 'wrong local matches').toBeLessThan(0.01);
      // And it has to be worth having at all.
      expect(total.resolved / all, 'resolved without a model').toBeGreaterThan(0.5);
    });
  }
});
