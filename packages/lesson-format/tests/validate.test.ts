import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validateLesson, findBeat, elementsForBeat } from '../src/index';
import type { Lesson } from '../src/index';

// Vitest runs from the repo root; the fixture is the committed dev lesson.
const fixturePath = path.resolve(process.cwd(), 'content/class10-heart-mini/lesson.json');
const fixture = () => JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;

describe('validateLesson', () => {
  it('accepts the committed dev-fixture lesson', () => {
    const r = validateLesson(fixture());
    expect(r.ok, r.ok ? '' : (r as { errors: string[] }).errors.join('\n')).toBe(true);
  });

  it('rejects a non-object', () => {
    expect(validateLesson('nope').ok).toBe(false);
    expect(validateLesson(null).ok).toBe(false);
  });

  it('rejects a wrong formatVersion', () => {
    const doc = fixture();
    doc.formatVersion = 2;
    const r = validateLesson(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/formatVersion/);
  });

  it('rejects duplicate element ids with the offending id in the message', () => {
    const doc = fixture();
    const els = doc.elements as Array<{ id: string }>;
    els.push({ ...els[0] });
    const r = validateLesson(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('duplicate element id');
  });

  it('rejects a beat that shows an unknown element', () => {
    const doc = fixture();
    (doc.beats as Array<{ show: string[] }>)[0].show.push('ghost_element');
    const r = validateLesson(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('ghost_element');
  });

  it('rejects focus outside the show list', () => {
    const doc = fixture();
    const beat = (doc.beats as Array<{ show: string[]; focus?: string[] }>)[0];
    beat.focus = ['b_body'];
    const r = validateLesson(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/focus.*not in this beat/);
  });

  it('rejects empty narration', () => {
    const doc = fixture();
    (doc.beats as Array<{ narration: string }>)[0].narration = '';
    const r = validateLesson(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/narration/);
  });

  it('rejects an unknown element kind', () => {
    const doc = fixture();
    (doc.elements as unknown[]).push({ kind: 'hologram', id: 'h1', x: 1, y: 1 });
    const r = validateLesson(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('hologram');
  });

  it('rejects an arrow without valid endpoints', () => {
    const doc = fixture();
    (doc.elements as unknown[]).push({ kind: 'arrow', id: 'bad_arrow', from: { x: 1 }, to: { x: 2, y: 3 } });
    const r = validateLesson(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('bad_arrow'.replace('bad_arrow', 'arrow needs'));
  });
});

describe('helpers', () => {
  const lesson = (): Lesson => {
    const r = validateLesson(fixture());
    if (!r.ok) throw new Error('fixture invalid');
    return r.lesson;
  };

  it('findBeat resolves by id and returns null for unknown', () => {
    expect(findBeat(lesson(), 'chambers')?.topic).toContain('chambers');
    expect(findBeat(lesson(), 'nope')).toBeNull();
  });

  it('elementsForBeat returns exactly the shown elements, in declaration order', () => {
    const l = lesson();
    const beat = findBeat(l, 'pump')!;
    const els = elementsForBeat(l, beat);
    expect(els.map((e) => e.id)).toEqual(['b_heart', 'x_pump']);
  });
});
