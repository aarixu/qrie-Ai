import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Lesson } from '../../../packages/lesson-format/src/types.ts';
import type { ImageModel } from '../src/imageModel.ts';
import { extractImage } from '../src/imageModel.ts';
import { aspectRatio, buildImagePrompt } from '../src/prompt.ts';
import { generateForLesson, planFilename } from '../src/generate.ts';

const lesson = (): Lesson => ({
  formatVersion: 1,
  id: 'test-lesson',
  title: 'The Heart',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: [
    { kind: 'title', id: 't', x: 500, y: 80, text: 'The Heart' },
    { kind: 'image', id: 'heart_pic', x: 100, y: 100, w: 400, h: 300, src: 'assets/heart_pic.png', alt: 'a human heart with its four chambers' },
    { kind: 'image', id: 'lungs_pic', x: 550, y: 100, w: 300, h: 300, src: 'assets/lungs_pic.png', alt: 'a pair of human lungs' },
  ],
  beats: [
    { id: 'b1', topic: 'Intro', narration: 'The heart is a pump that never rests.', show: ['t', 'heart_pic'] },
    { id: 'b2', topic: 'Lungs', narration: 'Blood collects oxygen in the lungs.', show: ['t', 'lungs_pic'] },
  ],
});

const fakeModel = (impl?: (prompt: string) => Promise<{ base64: string; mimeType: string }>): ImageModel & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    async generate(prompt: string) {
      calls.push(prompt);
      return impl ? impl(prompt) : { base64: Buffer.from('fake-png-bytes').toString('base64'), mimeType: 'image/png' };
    },
  };
};

const dirs: string[] = [];
const tmpDir = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'genimg-'));
  dirs.push(d);
  return d;
};

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('aspectRatio', () => {
  it('reduces to the simplest ratio', () => {
    expect(aspectRatio(400, 300)).toBe('4:3');
    expect(aspectRatio(1000, 620)).toBe('50:31');
    expect(aspectRatio(300, 300)).toBe('1:1');
  });

  it('never divides by zero', () => {
    expect(aspectRatio(0, 0)).toBe('1:1');
  });
});

describe('buildImagePrompt', () => {
  const p = () => buildImagePrompt(lesson().elements[1] as never, lesson());

  it('leads with the alt text as the subject', () => {
    expect(p()).toContain('a human heart with its four chambers');
  });

  it('carries the lesson title and the narration of the beat that shows it', () => {
    expect(p()).toContain('The Heart');
    expect(p()).toContain('The heart is a pump that never rests.');
  });

  it('forbids text inside the image — the canvas draws its own labels', () => {
    expect(p()).toMatch(/NO text, letters, numbers, labels or captions/i);
  });

  it('constrains the palette and the background', () => {
    expect(p()).toContain('white background');
    expect(p()).toMatch(/green.*blue.*red/i);
  });

  it('encodes the element aspect ratio', () => {
    expect(p()).toContain('4:3');
  });
});

describe('planFilename', () => {
  it('maps mime types to extensions', () => {
    expect(planFilename('heart_pic', 'image/png')).toBe('assets/heart_pic.png');
    expect(planFilename('heart_pic', 'image/jpeg')).toBe('assets/heart_pic.jpg');
    expect(planFilename('heart_pic', 'image/webp')).toBe('assets/heart_pic.webp');
  });

  it('is case-insensitive and falls back to .png', () => {
    expect(planFilename('x', 'IMAGE/PNG')).toBe('assets/x.png');
    expect(planFilename('x', 'application/octet-stream')).toBe('assets/x.png');
  });
});

describe('generateForLesson', () => {
  it('generates every image element and writes it to the element src', async () => {
    const dir = tmpDir();
    const report = await generateForLesson(lesson(), fakeModel(), dir);
    expect(report.generated.map((g) => g.elementId)).toEqual(['heart_pic', 'lungs_pic']);
    expect(fs.existsSync(path.join(dir, 'assets/heart_pic.png'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'assets/lungs_pic.png'))).toBe(true);
    expect(report.failed).toEqual([]);
  });

  it('skips assets that already exist', async () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'assets/heart_pic.png'), 'already here');

    const model = fakeModel();
    const report = await generateForLesson(lesson(), model, dir);
    expect(report.skipped).toEqual([{ elementId: 'heart_pic', reason: 'already exists' }]);
    expect(report.generated.map((g) => g.elementId)).toEqual(['lungs_pic']);
    expect(model.calls).toHaveLength(1);
    // The existing file must be untouched.
    expect(fs.readFileSync(path.join(dir, 'assets/heart_pic.png'), 'utf8')).toBe('already here');
  });

  it('regenerates existing assets with force', async () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'assets/heart_pic.png'), 'old');

    const report = await generateForLesson(lesson(), fakeModel(), dir, { force: true });
    expect(report.generated).toHaveLength(2);
    expect(fs.readFileSync(path.join(dir, 'assets/heart_pic.png'), 'utf8')).toBe('fake-png-bytes');
  });

  it('dry run collects prompts and writes nothing', async () => {
    const dir = tmpDir();
    const model = fakeModel();
    const report = await generateForLesson(lesson(), model, dir, { dryRun: true });
    expect(report.prompts).toHaveLength(2);
    expect(report.generated).toEqual([]);
    expect(model.calls).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'assets'))).toBe(false);
  });

  it('keeps going after a failure and reports it precisely', async () => {
    const dir = tmpDir();
    const model = fakeModel(async (prompt) => {
      if (prompt.includes('human heart')) throw new Error('Image API 429: quota');
      return { base64: Buffer.from('ok').toString('base64'), mimeType: 'image/png' };
    });
    const report = await generateForLesson(lesson(), model, dir);
    expect(report.failed).toEqual([{ elementId: 'heart_pic', error: 'Image API 429: quota' }]);
    expect(report.generated.map((g) => g.elementId)).toEqual(['lungs_pic']);
  });

  it('ignores lessons with no image elements', async () => {
    const l = lesson();
    l.elements = l.elements.filter((e) => e.kind !== 'image');
    l.beats = l.beats.map((b) => ({ ...b, show: ['t'] }));
    const report = await generateForLesson(l, fakeModel(), tmpDir());
    expect(report).toMatchObject({ generated: [], failed: [], prompts: [] });
  });
});

describe('extractImage', () => {
  it('finds inlineData even when a text part comes first', () => {
    const img = extractImage({
      candidates: [{ content: { parts: [{ text: "Here's your image:" }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }],
    });
    expect(img).toEqual({ base64: 'AAAA', mimeType: 'image/png' });
  });

  it('surfaces an API error message', () => {
    expect(() => extractImage({ error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } })).toThrow(/RESOURCE_EXHAUSTED/);
  });

  it('explains a text-only refusal, including what the model said', () => {
    expect(() =>
      extractImage({ candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'I cannot draw that.' }] } }] }),
    ).toThrow(/SAFETY.*I cannot draw that/s);
  });

  it('throws clearly on an empty response', () => {
    expect(() => extractImage({})).toThrow(/no image/i);
  });
});
