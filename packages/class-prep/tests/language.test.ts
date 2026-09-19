import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assemble } from '../src/prepare';
import { HINGLISH_REGISTER, plannerUser, repairPlanUser } from '../src/prompts';

/**
 * THE STUDENT'S LANGUAGE REACHES THE PLANNER, AND NOTHING ELSE MOVES WITH IT.
 *
 * The app asked a child which language the tutor should speak, stored the
 * answer and never read it — Onboarding's own comment said so. This is the
 * prompt half of reading it, and it is two assertions pulling against each
 * other: the SPOKEN register changes, and every id, title and piece of board
 * ink the app matches on stays exactly where it was. A test that only checked
 * the first would pass a build where "teaches" came back in Hinglish and the
 * outcome map measured the class as having taught nothing.
 */

const base = () => plannerUser('The heart', 10, 3);

describe('English is the untouched path', () => {
  it('is byte-for-byte what it was before a language could be asked for', () => {
    // The explicit default and the absent argument are the same prompt, so a
    // caller that has not been threaded yet cannot be getting a different
    // class from one that passes 'en'.
    expect(plannerUser('The heart', 10, 3, undefined, undefined, undefined, 'en')).toBe(base());
  });

  it('says nothing about Hinglish at all', () => {
    expect(base()).not.toContain('Hinglish');
    expect(base()).not.toContain('Roman script');
  });

  it('leaves the repair prompt alone', () => {
    expect(repairPlanUser('{}', ['x'], 'en')).toBe(repairPlanUser('{}', ['x']));
  });
});

describe('Hinglish is asked for as a register, not a translation', () => {
  const hinglish = () => plannerUser('The heart', 10, 3, undefined, undefined, undefined, 'hi-en');

  it('carries the register block', () => {
    expect(hinglish()).toContain(HINGLISH_REGISTER);
  });

  it('names the script, and forbids the other one', () => {
    expect(HINGLISH_REGISTER).toMatch(/Roman script/i);
    expect(HINGLISH_REGISTER).toMatch(/Devanagari/i);
    expect(HINGLISH_REGISTER).toMatch(/never\s+Devanagari/i);
  });

  it('shows the target register with lines from the hand-written corpus', () => {
    // tools/lipsync/corpus/hinglish.json is the only Hinglish in this repo a
    // person wrote. Quoting it means the prompt and the corpus cannot describe
    // two different languages — but the example is a SPLICE of two beats, and
    // the docblock above it says which two. This asserts the provenance the
    // comment claims, because a comment that names a source it did not use is
    // the failure this repo keeps paying for.
    const corpus = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../../tools/lipsync/corpus/hinglish.json'),
        'utf8',
      ),
    ) as { beats: Record<string, string> };

    const fromHook = 'Apni kalai dekho';
    const fromPlasmaRbc = 'Red cells oxygen ke courier hain';

    expect(corpus.beats.hook).toContain(fromHook);
    expect(corpus.beats.plasma_rbc).toContain(fromPlasmaRbc);
    expect(HINGLISH_REGISTER).toContain(fromHook);
    expect(HINGLISH_REGISTER).toContain(fromPlasmaRbc);
  });

  it('keeps the technical nouns in English, which is how the exam is written', () => {
    expect(HINGLISH_REGISTER).toMatch(/haemoglobin/);
    expect(HINGLISH_REGISTER).toMatch(/exam is written/i);
  });

  it('protects every structural field by name', () => {
    for (const field of ['"id"', '"beatId"', '"ref"', '"teaches"', '"checks"', '"askedAs"']) {
      expect(HINGLISH_REGISTER).toContain(field);
    }
    expect(HINGLISH_REGISTER).toMatch(/STAYS IN ENGLISH/);
  });

  it('keeps the title and subtitle English, because they are app chrome', () => {
    expect(HINGLISH_REGISTER).toMatch(/"title" and "subtitle"/);
  });

  it('does not let the facts move with the language', () => {
    expect(HINGLISH_REGISTER).toMatch(/facts do not move|wrong in English is wrong in Hinglish/i);
  });

  it('reminds the repair round, which would otherwise drift back to English', () => {
    // The repair call does not re-send the planner's user prompt, so without
    // this the model is handed a Hinglish plan, a list of problems in English,
    // and no instruction about which one to answer in.
    const repaired = repairPlanUser('{}', ['a wrong claim'], 'hi-en');
    expect(repaired).toMatch(/HINGLISH/i);
    expect(repaired).not.toBe(repairPlanUser('{}', ['a wrong claim']));
  });
});

/**
 * WHICH SIDE OF THE LINE EACH FIELD FALLS ON — the half of the register that
 * decides whether this phase kept its promise or broke something quieter.
 *
 * The register declares its SPOKEN list closed and sends everything else to
 * English, so a field it forgets is a field that comes back English inside a
 * Hinglish class. Two of them matter enough to be asserted by name rather than
 * trusted: `ask.question`, which is the line the class STOPS on, and an
 * option's `text`, which is not speech at all — it is what the local matcher
 * compares a spoken answer against (packages/tutor-judge/src/match.ts) and
 * what `judge.ts`'s sawAList guard requires to be identical between
 * `ask.options` and `whyProbe.options` before it will trust an ordinal
 * reading (apps/classroom/src/lib/judge.ts:253-258 — the guard runs to :258,
 * where the shown list and the probe are compared text by text).
 */
describe('the register rules on every field a child hears, and on the ones nobody hears', () => {
  const MARKER = 'EVERYTHING ELSE STAYS IN ENGLISH';
  const cut = () => {
    const at = HINGLISH_REGISTER.indexOf(MARKER);
    expect(at).toBeGreaterThan(0);
    return { spoken: HINGLISH_REGISTER.slice(0, at), english: HINGLISH_REGISTER.slice(at) };
  };

  it('names every field that is spoken aloud, on the spoken side', () => {
    // Each one is read out to a child by the playback code, not by a model's
    // discretion: `say`/`narration`/`fill` are the spine, `ask.hint` is spoken
    // on a dont-know (judge.ts:275-281), and an option's `hint ?? why` is the
    // tutor's reply to an answer (judge.ts:342).
    const { spoken } = cut();
    for (const field of ['"say"', '"narration"', '"fill"', '"question"', '"hint"', '"why"']) {
      expect(spoken).toContain(field);
    }
  });

  it('keeps option "text" out of the spoken half, in both option lists', () => {
    // Not a line anybody hears. Turning it Hinglish collapses the local match
    // that exists to keep playback under the Rs 5 ceiling, and splits the two
    // option lists that judge.ts:253-258 requires to be identical.
    const { spoken, english } = cut();
    expect(spoken).not.toContain('"text"');
    expect(english).toContain('"text"');
    expect(english).toMatch(/whyProbe/);
  });

  it('keeps the fields nobody hears in English, and says which they are', () => {
    // "expect" is the judge's rubric (lesson-format types.ts:385 — "never
    // written on the board"); a visual's "brief" and "alt" are read by the
    // artist and written on the board; "parts" are ids.
    const { english } = cut();
    for (const field of ['"expect"', '"brief"', '"alt"', '"parts"']) {
      expect(english).toContain(field);
    }
  });

  it('rules on the question rather than leaving it to the catch-all', () => {
    // It is the one string that is both spoken and written verbatim by the
    // board (packages/board-layout/src/layout.ts:398), so the register has to
    // say so outright or its two rules contradict each other on one field.
    expect(HINGLISH_REGISTER).toContain('"question"');
  });
});

describe('the register is the last thing the planner reads', () => {
  it('comes after a cloned teacher style brief', () => {
    // The style brief was appended last on purpose — a model weights the end
    // of its instructions most heavily. The register has to outrank it,
    // because a style brief describes an English teacher's habits and would
    // otherwise be the last word on the voice.
    const both = plannerUser('The heart', 10, 3, undefined, 'She speaks slowly.', undefined, 'hi-en');
    expect(both.indexOf(HINGLISH_REGISTER)).toBeGreaterThan(both.indexOf('She speaks slowly.'));
  });

  it('comes after the student notes too', () => {
    const both = plannerUser('The heart', 10, 3, ['Shaky on valves.'], undefined, undefined, 'hi-en');
    expect(both.indexOf(HINGLISH_REGISTER)).toBeGreaterThan(both.indexOf('Shaky on valves.'));
  });
});

describe('the lesson records the register it was actually written in', () => {
  const blueprint = () => ({
    id: 'L1',
    title: 'The heart',
    beats: [
      {
        id: 'b1',
        topic: 'The heart',
        // A say plus one piece of ink: a beat that shows nothing is dropped
        // by assemble, and a dropped beat has no id to check.
        board: [
          { do: 'say', text: 'Chalo, heart ko dekhte hain.' },
          { do: 'write', text: 'The heart pumps blood' },
        ],
      },
    ],
    visuals: [],
  });

  it('is English when nobody says otherwise', () => {
    const { lesson } = assemble(blueprint() as never, new Set());
    expect((lesson as { language: string }).language).toBe('en');
  });

  it('is hi-en when the class was planned in Hinglish', () => {
    // save.ts reads this field and REFUSES to keep a class that is not 'en'
    // (validate.ts:373 also checks it is one of the two spellings). It is the
    // only evidence that survives assembly saying which register the class was
    // written in, so the keep gate has nothing else to go on.
    const { lesson } = assemble(blueprint() as never, new Set(), new Map(), new Map(), 'hi-en');
    expect((lesson as { language: string }).language).toBe('hi-en');
  });

  it('does not translate a single id', () => {
    const { lesson } = assemble(blueprint() as never, new Set(), new Map(), new Map(), 'hi-en');
    const l = lesson as { id: string; title: string; beats: { id: string }[] };
    expect(l.id).toBe('L1');
    expect(l.title).toBe('The heart');
    expect(l.beats[0]?.id).toBe('b1');
  });
});
