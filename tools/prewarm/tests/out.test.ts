import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeClassTo } from '../lib/out.mjs';

/** `--out`: a kept class written into a content folder, the way the site ships one. */
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prewarm-out-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const saved = {
  id: 'class10-science-life-processes-respiration',
  entry: {
    id: 'class10-science-life-processes-respiration',
    title: 'Respiration',
    subtitle: 'Class 10 · Life Processes',
    class: 10,
    subject: 'Science',
    path: 'class10-science-life-processes-respiration/lesson.json',
    topicRef: 'class10-science/life-processes/respiration',
  },
  files: [
    {
      path: 'lesson.json',
      body: JSON.stringify({
        id: 'class10-science-life-processes-respiration',
        elements: [{ kind: 'image', id: 'p', src: '/class10-science-life-processes-respiration/generated/p.png' }],
      }),
      encoding: 'utf8' as const,
    },
    { path: 'assets.json', body: '{}', encoding: 'utf8' as const },
    { path: 'generated/p.png', body: Buffer.from('png!').toString('base64'), encoding: 'base64' as const },
  ],
};

const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8'));

describe('writing a kept class into a content folder', () => {
  it('writes its files under its own id and lists it in the index', () => {
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ lessons: [] }));
    const id = writeClassTo(dir, saved);
    expect(id).toBe(saved.id);
    expect(fs.readFileSync(path.join(dir, saved.id, 'generated/p.png'), 'utf8')).toBe('png!');
    expect(readJson('index.json').lessons).toEqual([saved.entry]);
  });

  it('takes the place of an existing lesson under `as`: its id, its picture paths, its index row', () => {
    fs.writeFileSync(
      path.join(dir, 'index.json'),
      JSON.stringify({
        lessons: [
          { id: 'class10-respiration', title: 'Old', class: 10, subject: 'Science', path: 'class10-respiration/lesson.json', topicRef: 'class10-science/life-processes/respiration' },
          { id: 'class10-blood', title: 'Blood', class: 10, subject: 'Science', path: 'class10-blood/lesson.json' },
        ],
      }),
    );
    const id = writeClassTo(dir, saved, 'class10-respiration');
    expect(id).toBe('class10-respiration');
    const lesson = readJson('class10-respiration/lesson.json');
    expect(lesson.id).toBe('class10-respiration');
    expect(lesson.elements[0].src).toBe('/class10-respiration/generated/p.png');
    expect(fs.existsSync(path.join(dir, 'class10-respiration/generated/p.png'))).toBe(true);
    const lessons = readJson('index.json').lessons;
    expect(lessons.map((l: { id: string }) => l.id)).toEqual(['class10-respiration', 'class10-blood']);
    expect(lessons[0]).toMatchObject({ title: 'Respiration', path: 'class10-respiration/lesson.json' });
  });

  it('refuses a file path that would leave the class folder', () => {
    const bad = { ...saved, files: [{ path: '../escape.txt', body: 'x', encoding: 'utf8' as const }] };
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ lessons: [] }));
    expect(() => writeClassTo(dir, bad)).toThrow(/outside/);
  });
});
