import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { designLesson, deriveAssetsSpec } from '../src/design.ts';
import type { LlmAdapter } from '../src/llm.ts';
import { loadSyllabus, getTopic } from '../../../packages/syllabus/src/index.ts';
import type { Lesson } from '../../../packages/lesson-format/src/index.ts';

const root = process.cwd();
const fixtureJson = fs.readFileSync(path.resolve(root, 'packages/lesson-format/tests/fixtures/heart.lesson.json'), 'utf8');
const syllabus = loadSyllabus(
  JSON.parse(fs.readFileSync(path.resolve(root, 'packages/syllabus/data/class10-science.json'), 'utf8')),
);
const topic = getTopic(syllabus, 'class10-science/life-processes/transportation-in-human-beings')!;
const opts = { klass: 10, topicPath: 'class10-science/life-processes/transportation-in-human-beings' };

/** Scripted adapter: returns each reply in turn and records every prompt it saw. */
class FakeAdapter implements LlmAdapter {
  calls: { system: string; user: string }[] = [];
  constructor(private readonly replies: string[]) {}
  async complete(system: string, user: string): Promise<string> {
    this.calls.push({ system, user });
    const reply = this.replies[this.calls.length - 1];
    if (reply === undefined) throw new Error('FakeAdapter: no scripted reply left');
    return reply;
  }
}

describe('designLesson', () => {
  it('succeeds first try on a valid reply and derives an empty assetsSpec', async () => {
    const adapter = new FakeAdapter([fixtureJson]);
    const result = await designLesson(topic, adapter, opts);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.id).toBe('class10-heart-mini');
    // The fixture has no image/model3d elements, so nothing to generate.
    expect(result.assetsSpec).toEqual([]);
    expect(adapter.calls).toHaveLength(1);
  });

  it('repairs once after unparseable JSON, feeding the parse error back', async () => {
    const adapter = new FakeAdapter(['this is { not json', fixtureJson]);
    const result = await designLesson(topic, adapter, opts);

    expect(result.ok).toBe(true);
    expect(adapter.calls).toHaveLength(2);
    // Same system prompt both times; the repair goes into the user prompt.
    expect(adapter.calls[1].system).toBe(adapter.calls[0].system);
    expect(adapter.calls[1].user).toContain(adapter.calls[0].user);
    expect(adapter.calls[1].user).toContain('reply is not valid JSON');
    expect(adapter.calls[1].user).toContain('this is { not json');
  });

  it('repairs once after schema errors, quoting the validator verbatim', async () => {
    const invalid = JSON.stringify({ formatVersion: 1 });
    const adapter = new FakeAdapter([invalid, fixtureJson]);
    const result = await designLesson(topic, adapter, opts);

    expect(result.ok).toBe(true);
    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[1].user).toContain('lesson needs a non-empty id');
    expect(adapter.calls[1].user).toContain('lesson needs a non-empty elements array');
  });

  it('gives up after the second failure, preserving errors and the raw reply', async () => {
    const adapter = new FakeAdapter(['garbage one', 'garbage two']);
    const result = await designLesson(topic, adapter, opts);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/not valid JSON/);
    expect(result.raw).toBe('garbage two');
    // Exactly one repair retry — never a third call.
    expect(adapter.calls).toHaveLength(2);
  });

  it('derives assetsSpec entries for image and model3d elements', async () => {
    const doc = JSON.parse(fixtureJson) as Lesson;
    doc.elements.push(
      { kind: 'image', id: 'img_heart', x: 700, y: 420, w: 200, h: 140, src: 'assets/heart.png', alt: 'Labelled diagram of a human heart' },
      { kind: 'model3d', id: 'm3d_heart', x: 100, y: 400, w: 200, h: 160, label: 'Beating heart model' },
    );
    const adapter = new FakeAdapter([JSON.stringify(doc)]);
    const result = await designLesson(topic, adapter, opts);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assetsSpec).toHaveLength(2);
    const [image, model] = result.assetsSpec;
    expect(image).toMatchObject({ elementId: 'img_heart', kind: 'image', description: 'Labelled diagram of a human heart' });
    expect(image.suggestedPrompt).toContain('Labelled diagram of a human heart');
    expect(model).toMatchObject({ elementId: 'm3d_heart', kind: 'model3d', description: 'Beating heart model' });
    expect(model.suggestedPrompt).toContain('Beating heart model');
  });
});

describe('deriveAssetsSpec', () => {
  it('falls back to the element id when a model3d has no label', () => {
    const lesson = JSON.parse(fixtureJson) as Lesson;
    lesson.elements.push({ kind: 'model3d', id: 'm3d_plain', x: 0, y: 0, w: 100, h: 100 });
    const spec = deriveAssetsSpec(lesson);
    expect(spec).toHaveLength(1);
    expect(spec[0].description).toBe('m3d_plain');
  });
});
