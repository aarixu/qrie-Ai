import { describe, expect, it } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { saveable, whyNotSaveable } from '../src/save';
import type { PrepReport } from '../src/types';

/**
 * The first live class on a topic becomes the recording every later student is
 * shown. So what gets written has to be complete: a class saved with a hole in
 * it is a hole shown to everyone who comes after.
 */

const png = 'data:image/png;base64,iVBORw0KGgo=';

const lesson = (): Lesson =>
  JSON.parse(
    JSON.stringify({
      formatVersion: 1,
      id: 'prep-abc',
      title: 'Respiration',
      language: 'en',
      canvas: { w: 1000, h: 620 },
      elements: [
        { kind: 'image', id: 'lungs', x: 0, y: 0, w: 100, h: 100, src: 'generated/lungs.png', alt: 'lungs' },
        { kind: 'diagram', id: 'cycle', x: 0, y: 0, w: 100, h: 100, src: 'cycle.svg', alt: 'a cycle', parts: ['in'] },
        { kind: 'graphic', id: 'g1', x: 0, y: 0, w: 40, h: 40, noun: 'leaf' },
      ],
      beats: [{ id: 'b1', topic: 'open', narration: 'Breathe in.', show: ['lungs'] }],
    }),
  ) as Lesson;

const assets = (): Record<string, string> => ({
  lungs: png,
  cycle: '<svg xmlns="http://www.w3.org/2000/svg"><g id="in"/></svg>',
  g1: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
});

const clean: PrepReport = {
  topic: 'Respiration',
  totalMs: 30_000,
  planMs: 10_000,
  visualsMs: 20_000,
  issues: [],
  visuals: [{ id: 'lungs', ok: true, attempts: 1, ms: 12_000, problems: [] }],
};

const meta = {
  topicRef: 'class10-science/life-processes/respiration',
  klass: 10,
  subject: 'Science',
  subtitle: 'Class 10 · Life Processes',
};

describe('what is worth keeping', () => {
  it('keeps a clean class, under an id derived from the topic it teaches', () => {
    // Derived, not random: the same topic taught twice must not become two
    // recordings, and the id has to be guessable from the topicRef alone.
    const saved = saveable({ lesson: lesson(), assets: assets(), report: clean }, meta);
    expect(saved?.id).toBe('class10-science-life-processes-respiration');
    expect(saved?.entry).toMatchObject({
      id: 'class10-science-life-processes-respiration',
      title: 'Respiration',
      class: 10,
      subject: 'Science',
      topicRef: meta.topicRef,
      path: 'class10-science-life-processes-respiration/lesson.json',
    });
  });

  it('keeps nothing for a class nobody can find again', () => {
    // A free-text class has no topicRef, so no later student could ever be
    // shown it. Writing it would be filling the folder with orphans.
    expect(saveable({ lesson: lesson(), assets: assets(), report: clean }, { ...meta, topicRef: undefined })).toBeNull();
  });

  /**
   * THE LANGUAGE THREAD MADE THIS REACHABLE, AND WITHOUT IT THE THREAD IS A
   * BROKEN PROMISE POINTING THE OTHER WAY.
   *
   * The tutor's register is a per-student choice now, so a cold topic opened by
   * a Hinglish student produces Hinglish narration. The store is keyed on
   * `topic_ref` alone and the relay serves that one row to everybody — so
   * keeping it would let the first Hinglish student install Hinglish
   * permanently, and the next English student would be taught in a language
   * they did not choose, with nothing on screen looking like an error.
   *
   * It is the same refusal as the one for a name in the spine: a class made for
   * one student is not a class to keep.
   */
  it('keeps nothing taught in one student’s chosen register', () => {
    const hinglish = { ...lesson(), language: 'hi-en' as const };
    expect(saveable({ lesson: hinglish, assets: assets(), report: clean }, meta)).toBeNull();
  });

  it('keeps nothing when a picture did not draw', () => {
    const holed: PrepReport = {
      ...clean,
      visuals: [{ id: 'lungs', ok: false, attempts: 2, ms: 9_000, problems: ['the picture could not be generated'] }],
    };
    expect(saveable({ lesson: lesson(), assets: assets(), report: holed }, meta)).toBeNull();
  });

  it('keeps nothing when the board is missing artwork it points at', () => {
    // The report can be clean and the assets still short — a diagram dropped
    // after the report was written is a beat about an empty rectangle.
    const short = assets();
    delete short.cycle;
    expect(saveable({ lesson: lesson(), assets: short, report: clean }, meta)).toBeNull();
  });
});

describe('what gets written', () => {
  const saved = saveable({ lesson: lesson(), assets: assets(), report: clean }, meta)!;
  const file = (path: string) => saved.files.find((f) => f.path === path);

  it('writes the lesson and one file of inline artwork', () => {
    expect(file('lesson.json')).toBeDefined();
    expect(file('assets.json')).toBeDefined();
  });

  it('writes a picture as its own decoded file, not as text inside the lesson', () => {
    const drawn = file('generated/lungs.png');
    expect(drawn?.encoding).toBe('base64');
    expect(drawn?.body).toBe('iVBORw0KGgo=');
  });

  it('points the lesson at the picture where it will actually live', () => {
    // Absolute from the static root: the class is opened at /class/<topicRef>,
    // so a path relative to the page would look for the picture beside the
    // route instead of beside the lesson.
    const doc = JSON.parse(file('lesson.json')!.body) as Lesson;
    const image = doc.elements.find((el) => el.kind === 'image')!;
    expect(image.src).toBe('/class10-science-life-processes-respiration/generated/lungs.png');
  });

  it('keeps the inline artwork keyed by element id, drawings and icons alike', () => {
    // A graphic has no src of its own — it exists only as an entry in the
    // asset map — so a per-file convention would lose it.
    const inline = JSON.parse(file('assets.json')!.body) as Record<string, string>;
    expect(Object.keys(inline).sort()).toEqual(['cycle', 'g1']);
    expect(inline.cycle).toContain('<svg');
  });

  it('leaves the original lesson alone', () => {
    const original = lesson();
    saveable({ lesson: original, assets: assets(), report: clean }, meta);
    expect((original.elements[0] as { src: string }).src).toBe('generated/lungs.png');
  });
});

describe('a saved class answers to the name the catalogue gives it', () => {
  // The content lint checks this on every lesson in the folder, and it caught
  // the first class this ever saved: the lesson kept the id the planner made
  // up for it, so the catalogue pointed at "…-nucleus" and the file inside
  // called itself "nucleus-class-9". Anything joining the two by id — the
  // outcome map, progress, a doubt looking up where it happened — would have
  // been talking about two different classes.
  const saved = saveable({ lesson: lesson(), assets: assets(), report: clean }, meta)!;
  const doc = JSON.parse(saved.files.find((f) => f.path === 'lesson.json')!.body) as Lesson & {
    topicRef?: string;
  };

  it('carries the catalogue id inside the lesson too', () => {
    expect(doc.id).toBe(saved.entry.id);
  });

  it('remembers which topic it teaches', () => {
    expect(doc.topicRef).toBe(meta.topicRef);
  });
});

describe('a picture that came back as a JPEG', () => {
  // The image model answers with a JPEG about as often as a PNG. Recognising
  // only PNGs meant the other half were treated as markup: seven hundred
  // kilobytes of base64 stuffed into assets.json, and the lesson still
  // pointing at a .png file nobody had written.
  const jpeg = 'data:image/jpeg;base64,/9j/4AAQ';
  const saved = saveable(
    { lesson: lesson(), assets: { ...assets(), lungs: jpeg }, report: clean },
    meta,
  )!;
  const file = (path: string) => saved.files.find((f) => f.path === path);

  it('writes it as its own file, under the extension it actually is', () => {
    expect(file('generated/lungs.jpg')?.encoding).toBe('base64');
    expect(file('generated/lungs.jpg')?.body).toBe('/9j/4AAQ');
    expect(file('generated/lungs.png')).toBeUndefined();
  });

  it('points the lesson at the file it wrote', () => {
    const doc = JSON.parse(file('lesson.json')!.body) as Lesson;
    const image = doc.elements.find((el) => el.kind === 'image')!;
    expect(image.src).toBe('/class10-science-life-processes-respiration/generated/lungs.jpg');
  });

  it('keeps it out of the inline artwork, which is for markup', () => {
    const inline = JSON.parse(file('assets.json')!.body) as Record<string, string>;
    expect(inline.lungs).toBeUndefined();
  });
});

/**
 * THE KEEP IS WHERE A WRONG CLASS BECOMES PERMANENT.
 *
 * `topic_ref` is unique and the keep ignores duplicates, so the FIRST keeper
 * of a topic wins forever: a class kept before anyone fact-checked it can
 * never be replaced by the reviewed pre-warm that arrives later. The factual
 * gate in prepareClass cannot prevent that on its own, because a caller that
 * passes no reviewer produces a perfectly saveable class. This is the
 * fail-closed half, and it is opt-in so that existing callers keep their
 * behaviour until they are wired: a caller that means "reviewed or nothing"
 * says so, and then "kept unreviewed forever" becomes "not kept".
 */
describe('requireReviewed — reviewed or not kept', () => {
  const reviewed: PrepReport = {
    ...clean,
    review: { flagged: [], repaired: false, ms: 4_000 },
  };

  it('refuses a class no reviewer ever saw', () => {
    expect(saveable({ lesson: lesson(), assets: assets(), report: clean }, { ...meta, requireReviewed: true })).toBeNull();
  });

  it('keeps one the reviewer passed', () => {
    const saved = saveable(
      { lesson: lesson(), assets: assets(), report: reviewed },
      { ...meta, requireReviewed: true },
    );
    expect(saved).not.toBeNull();
  });

  it('keeps an unreviewed class when the caller has not asked for the gate', () => {
    // The default is unchanged behaviour: a flag nobody sets must not
    // silently stop the app keeping the classes it keeps today.
    expect(saveable({ lesson: lesson(), assets: assets(), report: clean }, meta)).not.toBeNull();
  });
});

/**
 * THE KEEP GATE'S VERDICT (gate.ts), read at the keep.
 *
 * prepareClass teaches a class that fails the keep gate — a worse class, not
 * a wrong one — and records what it found on `report.gate`. This is where
 * "taught, never kept" is enforced.
 */
describe('the keep gate — passed, or not kept', () => {
  const passed: PrepReport = { ...clean, gate: { problems: [] } };
  const failed: PrepReport = {
    ...clean,
    gate: { problems: [{ rule: 'notation', where: 'b3_1', message: 'reads "=" aloud' }] },
  };

  it('keeps a class the gate passed', () => {
    expect(saveable({ lesson: lesson(), assets: assets(), report: passed }, meta)).not.toBeNull();
  });

  it('refuses one it failed, whatever else is true of it', () => {
    expect(saveable({ lesson: lesson(), assets: assets(), report: failed }, meta)).toBeNull();
  });

  it('refuses a report with no gate on it when the caller asks for the gate', () => {
    expect(saveable({ lesson: lesson(), assets: assets(), report: clean }, { ...meta, requireGate: true })).toBeNull();
    expect(
      saveable({ lesson: lesson(), assets: assets(), report: passed }, { ...meta, requireGate: true }),
    ).not.toBeNull();
  });
});

describe('why a class was not kept — said to the operator who paid for it', () => {
  const passed: PrepReport = { ...clean, gate: { problems: [] } };
  const gateFailed: PrepReport = {
    ...clean,
    gate: {
      problems: [
        { rule: 'notation', where: 'b3_1', message: 'reads "=" aloud' },
        { rule: 'unspoken', where: 'b4_3', message: 'no line after the ask' },
      ],
    },
  };
  const pictureFailed: PrepReport = {
    ...passed,
    visuals: [{ id: 'lungs', ok: false, attempts: 2, ms: 12_000, problems: ['blank'] }],
  };
  const noArt = (): Record<string, string> => {
    const a = assets();
    delete a.g1;
    return a;
  };
  const remembering = (): Lesson => {
    const l = lesson();
    l.beats[0].narration = 'Last time we did the nucleus.';
    return l;
  };

  it('names nothing for a class it keeps', () => {
    expect(whyNotSaveable({ lesson: lesson(), assets: assets(), report: passed }, meta)).toEqual([]);
  });

  it('names each gate rule and where it failed — not "a picture failed"', () => {
    const why = whyNotSaveable({ lesson: lesson(), assets: assets(), report: gateFailed }, meta).join(' ');
    expect(why).toContain('notation@b3_1');
    expect(why).toContain('unspoken@b4_3');
    expect(why).not.toMatch(/picture/);
  });

  it('names the picture that failed and the artwork that is missing', () => {
    expect(whyNotSaveable({ lesson: lesson(), assets: assets(), report: pictureFailed }, meta).join(' ')).toContain(
      'lungs',
    );
    expect(whyNotSaveable({ lesson: lesson(), assets: noArt(), report: passed }, meta).join(' ')).toContain('g1');
  });

  it('names a spine that claims a past session', () => {
    expect(whyNotSaveable({ lesson: remembering(), assets: assets(), report: passed }, meta)).toHaveLength(1);
  });

  it('agrees with saveable on every one of them', () => {
    const cases: [Lesson, Record<string, string>, PrepReport, typeof meta & { requireGate?: boolean }][] = [
      [lesson(), assets(), passed, meta],
      [lesson(), assets(), gateFailed, meta],
      [lesson(), assets(), pictureFailed, meta],
      [lesson(), noArt(), passed, meta],
      [remembering(), assets(), passed, meta],
      [lesson(), assets(), clean, { ...meta, requireGate: true }],
    ];
    for (const [l, a, report, m] of cases) {
      const refused = saveable({ lesson: l, assets: a, report }, m) === null;
      expect(whyNotSaveable({ lesson: l, assets: a, report }, m).length > 0).toBe(refused);
    }
  });
});
