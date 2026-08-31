import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { textWidth, FLOW_GAP, type Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '../src/Scene';

/**
 * A flow of five steps, each with a note — the shape a real class produced for
 * "the path of light through the eye", and the board Aarav called a mess.
 *
 * Five steps across the board leave about a hundred and forty units each. The
 * label and the note were drawn at a fixed size, centred, with no fitting and
 * no wrapping, so anything wider than its box spilled equally out of both
 * sides and landed on the step next door. Two rows of text, unreadable.
 */

const steps = [
  { label: 'Cornea', note: 'primary refraction' },
  { label: 'Pupil & Iris', note: 'light regulation' },
  { label: 'Lens', note: 'focus adjustment' },
  { label: 'Retina', note: 'inverted image' },
  { label: 'Optic Nerve', note: 'images to the brain' },
];

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'");

const boardFor = (w: number) => {
  const lesson: Lesson = {
    formatVersion: 1,
    id: 'f',
    title: 'Path of Light',
    language: 'en',
    canvas: { w: 1000, h: 620 },
    elements: [{ kind: 'flow', id: 'path', x: 70, y: 200, w, steps }],
    beats: [{ id: 'b', topic: 't', narration: 'n', show: ['path'] }],
  };
  const html = renderToString(<Scene lesson={lesson} visible={['path']} focus={[]} />);
  const drawn = [...html.matchAll(/<text[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map(
    (m) => ({ size: Number(m[1]), text: decode(m[2]) }),
  );
  return { html, drawn };
};

/**
 * The width that produced the mess.
 *
 * Not the whole board — this flow was sharing a beat with a list, so it was
 * handed the narrow column and five steps had to live in it. Forty units of
 * gap between each pair then took most of what was left.
 */
const WIDTH = 860;
const HALF = 600;

/**
 * The width that produced the mess was 370 — five steps sharing a beat with a
 * list, so the flow was handed the narrow column and each step got forty-two
 * units. No amount of fitting saves that: "refraction" cannot be drawn inside
 * forty-two units at any size a person can read. The renderer's job is to
 * never overflow the room it is given; keeping a five-step flow out of a room
 * that small is the LAYOUT's job, and it is tested there.
 */

describe.each([
  ['the whole board', WIDTH],
  ['half a board', HALF],
])('a five-step flow across %s', (_name, w) => {
  const { drawn } = boardFor(w);
  const stepW = (w - (steps.length - 1) * FLOW_GAP) / steps.length;

  it('draws every step and every note, wrapped rather than dropped', () => {
    // Wrapped, so a label is no longer one contiguous string in the markup —
    // what has to survive is every word of it.
    const written = drawn.map((d) => d.text).join(' ');
    for (const step of steps) {
      for (const word of step.label.split(/\s+/)) expect(written).toContain(word);
      for (const word of (step.note ?? '').split(/\s+/)) expect(written).toContain(word);
    }
  });

  it('keeps every line of text inside its own step', () => {
    // The fault, stated as a measurement: a centred line wider than its box
    // overhangs into the step on either side, which is how five notes became
    // one unreadable stripe across the board.
    const over = drawn.filter((d) => textWidth(d.text, d.size) > stepW);
    expect(over.map((d) => `"${d.text}" at ${d.size} needs ${Math.round(textWidth(d.text, d.size))} of ${Math.round(stepW)}`)).toEqual([]);
  });

  it('keeps the writing big enough to read', () => {
    expect(Math.min(...drawn.map((d) => d.size))).toBeGreaterThanOrEqual(10);
  });
});
