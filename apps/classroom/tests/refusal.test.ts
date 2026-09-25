import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readRefusal } from '../src/lib/refusal';
import { RefusalNotice } from '../src/ui/RefusalNotice';

/**
 * WHAT A CHILD IS TOLD WHEN THE RELAY SAYS NO.
 *
 * gate.ts wrote five sentences and the care is in the distinction: a 429 is
 * the student's own rate or budget and says so, a 503 is our capacity or our
 * outage and deliberately does not hand a child a fault they do not have.
 * `relayError` keeps the sentence and throws away everything else — the status
 * code, the `reason` field and the Retry-After header — so by the time a
 * screen catches it, the SENTENCE IS THE ONLY EVIDENCE LEFT of which kind it
 * was. That is why this reader matches on the text, and why the first test
 * below reads gate.ts itself rather than trusting a copy to stay a copy.
 *
 * The other half of the job is the refusals it must NOT recognise. A dropped
 * connection dressed up as a budget tells a child they have used up something
 * they have not, and an outage dressed up as an allowance is a lie about
 * somebody's money. Anything that is not one of the five comes back null.
 */

/** The five sentences, read out of the relay's own source at test time. */
const relaySentences = (): string[] => {
  // process.cwd() is the repo root under vitest — the same anchor
  // library-screens.test.tsx uses to read a committed lesson.
  const at = path.join(process.cwd(), 'packages/relay/src/gate.ts');
  // Named rather than left as an ENOENT: this is the one guard standing
  // between a child and a drifted refusal sentence, and a guard whose failure
  // reads as a missing file is a guard somebody deletes.
  expect(existsSync(at), 'run vitest from the repo root').toBe(true);
  const source = readFileSync(at, 'utf8');
  const from = source.indexOf('const REFUSALS');
  expect(from).toBeGreaterThan(-1);
  const block = source.slice(from, source.indexOf('\n};', from));
  return [...block.matchAll(/message:\s*'([^']*)'/g)].map((m) => m[1]);
};

describe('the sentences this reader knows', () => {
  it('knows every refusal gate.ts can send, and invents none of its own', () => {
    const sentences = relaySentences();
    expect(sentences).toHaveLength(5);
    for (const sentence of sentences) {
      expect(readRefusal(new Error(sentence)), sentence).not.toBeNull();
    }
  });

  it('passes the relay sentence through word for word', () => {
    for (const sentence of relaySentences()) {
      expect(readRefusal(new Error(sentence))?.message).toBe(sentence);
    }
  });
});

describe('whose fault it is, and whether waiting helps', () => {
  const read = (message: string) => readRefusal(new Error(message));

  it('a rate limit is the student own asking, and a moment fixes it', () => {
    const it_ = read('That is a lot of asking at once — give it a moment and try again.');
    expect(it_).toEqual({
      reason: 'rate',
      message: 'That is a lot of asking at once — give it a moment and try again.',
      ours: false,
      wait: 'moment',
    });
  });

  it('a spent budget is theirs and resets tomorrow', () => {
    const it_ = read('You have used up today’s classes. This resets tomorrow.');
    expect(it_?.reason).toBe('budget');
    expect(it_?.ours).toBe(false);
    expect(it_?.wait).toBe('tomorrow');
  });

  it('a halt is OURS and measured in minutes, never in days', () => {
    const it_ = read('Qrie is having a rest. Classes are paused for a few minutes.');
    expect(it_?.reason).toBe('halted');
    expect(it_?.ours).toBe(true);
    expect(it_?.wait).toBe('minutes');
  });

  it('our own spent day is OURS, and tomorrow', () => {
    const it_ = read('Qrie has taught a lot of classes today. Please come back tomorrow.');
    expect(it_?.reason).toBe('capped');
    expect(it_?.ours).toBe(true);
    expect(it_?.wait).toBe('tomorrow');
  });

  it('a meter that is down is OURS, and a moment', () => {
    const it_ = read('We cannot start a class this second. Try again in a moment.');
    expect(it_?.reason).toBe('unavailable');
    expect(it_?.ours).toBe(true);
    expect(it_?.wait).toBe('moment');
  });

  it('never blames the student for anything that is ours', () => {
    for (const ours of ['halted', 'capped', 'unavailable']) {
      const found = relaySentences()
        .map((s) => readRefusal(new Error(s)))
        .find((r) => r?.reason === ours);
      expect(found?.ours, ours).toBe(true);
    }
  });
});

describe('what is NOT a refusal', () => {
  const notRefusals: [string, unknown][] = [
    ['a dropped connection', new TypeError('Failed to fetch')],
    ['a 500 the student never sees', new Error('relay 500')],
    ['a 500 with an upstream sentence', new Error('relay 500: upstream exploded')],
    ['an empty model reply', new Error('The model replied with nothing.')],
    ['a missing lesson', new Error('This lesson does not exist.')],
    ['nothing at all', null],
    ['nothing at all, the other way', undefined],
    ['an object that is not an error', { message: 'You have used up today’s classes.' }],
  ];

  for (const [what, thrown] of notRefusals) {
    it(`reads ${what} as not a refusal`, () => {
      expect(readRefusal(thrown)).toBeNull();
    });
  }

  it('does not match a sentence that merely contains one', () => {
    expect(
      readRefusal(new Error('relay 500: You have used up today’s classes. This resets tomorrow.')),
    ).toBeNull();
  });
});

describe('the shape a screen actually holds', () => {
  /**
   * LiveClass keeps `error` as a string, not as the Error it caught. A reader
   * that only accepts an Error would be unusable at the one catch site that
   * already puts a refusal in front of a child.
   */
  it('reads the bare sentence a screen kept in state', () => {
    expect(readRefusal('Qrie is having a rest. Classes are paused for a few minutes.')?.reason).toBe(
      'halted',
    );
  });
});

/**
 * THE NOTICE ITSELF.
 *
 * Rendered through `createElement` rather than JSX so that this file can stay
 * `.ts` and sit next to the reader it is about. What is asserted is what a
 * child would be able to read off the screen, and what must never appear on it.
 */
describe('what a child reads', () => {
  const show = (message: string, opts: { onRetry?: boolean } = {}): string => {
    const refusal = readRefusal(new Error(message));
    expect(refusal, message).not.toBeNull();
    return renderToString(
      createElement(RefusalNotice, {
        refusal: refusal!,
        // Always supplied, because the component's type insists on it: a
        // refusal a child cannot retry must still leave them somewhere to go.
        children: createElement('button', null, 'Back home'),
        ...(opts.onRetry ? { onRetry: () => {} } : {}),
      }),
    )
      .replace(/<!--\s*-->/g, '')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&#x2019;/g, '’');
  };

  it('shows the relay sentence and nothing invented in its place', () => {
    for (const sentence of relaySentences()) {
      expect(show(sentence)).toContain(sentence);
    }
  });

  it('never shows a status code, and never names our plumbing', () => {
    for (const sentence of relaySentences()) {
      const html = show(sentence, { onRetry: true });
      expect(html.toLowerCase()).not.toContain('relay');
      expect(html).not.toContain('429');
      expect(html).not.toContain('503');
      expect(html.toLowerCase()).not.toContain('error');
    }
  });

  /**
   * The one judgement this component makes. A Try again under "come back
   * tomorrow" invites a tap that will be refused in the same words.
   */
  it('offers Try again only where a few seconds could change the answer', () => {
    // '>Try again<' and not 'Try again': two of the five relay sentences
    // contain those words themselves, so the loose assertion passed whether or
    // not the button was ever rendered.
    expect(show('That is a lot of asking at once — give it a moment and try again.', { onRetry: true })).toContain('>Try again<');
    expect(show('We cannot start a class this second. Try again in a moment.', { onRetry: true })).toContain('>Try again<');

    for (const later of [
      'You have used up today’s classes. This resets tomorrow.',
      'Qrie is having a rest. Classes are paused for a few minutes.',
      'Qrie has taught a lot of classes today. Please come back tomorrow.',
    ]) {
      expect(show(later, { onRetry: true }), later).not.toContain('>Try again<');
    }
  });

  /**
   * The face has to be a face. `Icon` falls back to a literal dot for a name
   * its map does not carry (ui/Icon.tsx:185), and a markup assertion that only
   * checks what is ABSENT cannot see that — the first cut of this notice drew
   * a bullet inside the circle for the two refusals a child meets most, a
   * spent budget and our own spent day. An <svg> means a glyph was found.
   */
  it('draws a real glyph in the circle for every refusal, not the dot', () => {
    for (const sentence of relaySentences()) {
      const html = show(sentence);
      const drawn = /<(svg|span)[^>]*data-icon="([^"]+)"/.exec(html);
      expect(drawn, sentence).not.toBeNull();
      expect(drawn![1], `${sentence} -> ${drawn![2]}`).toBe('svg');
    }
  });

  /**
   * The always-honest move. For three of the five there is no retry to offer,
   * so whatever the caller passes as children is the only thing left to press.
   */
  it('renders the caller move even where there is no retry to offer', () => {
    for (const later of [
      'You have used up today’s classes. This resets tomorrow.',
      'Qrie has taught a lot of classes today. Please come back tomorrow.',
    ]) {
      expect(show(later, { onRetry: true }), later).toContain('Back home');
    }
  });

  it('says it is not their fault only when it is ours', () => {
    expect(show('Qrie has taught a lot of classes today. Please come back tomorrow.')).toContain(
      'Nothing you did caused this.',
    );
    expect(show('You have used up today’s classes. This resets tomorrow.')).not.toContain(
      'Nothing you did caused this.',
    );
  });
});
