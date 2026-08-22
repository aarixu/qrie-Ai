import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validateLesson } from '@ai-tutor/lesson-format';
import { loadSyllabus, getTopic } from '@ai-tutor/syllabus';

/**
 * Content lint — the build-time guarantee that every lesson the app can offer
 * is actually playable. This is the suite's most important guard: broken
 * content fails CI here instead of failing a student mid-class.
 */

const ROOT = process.cwd();
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/index.json'), 'utf8')) as {
  lessons: { id: string; path: string; topicRef?: string; title: string }[];
};

const syllabi = fs
  .readdirSync(path.join(ROOT, 'packages/syllabus/data'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => loadSyllabus(JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/syllabus/data', f), 'utf8'))));

describe('content catalog', () => {
  it('has at least one lesson', () => {
    expect(index.lessons.length).toBeGreaterThan(0);
  });

  it('has unique lesson ids', () => {
    const ids = index.lessons.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(index.lessons)('"$id" lesson file exists and validates', (entry) => {
    const file = path.join(ROOT, 'content', entry.path);
    expect(fs.existsSync(file), `${entry.path} missing`).toBe(true);
    const result = validateLesson(JSON.parse(fs.readFileSync(file, 'utf8')));
    expect(result.ok, result.ok ? '' : (result as { errors: string[] }).errors.join('\n')).toBe(true);
  });

  it.each(index.lessons)('"$id" lesson id matches its catalog entry', (entry) => {
    const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', entry.path), 'utf8')) as {
      id: string;
      topicRef?: string;
    };
    expect(doc.id).toBe(entry.id);
    expect(doc.topicRef).toBe(entry.topicRef);
  });

  it.each(index.lessons.filter((l) => l.topicRef))('"$id" topicRef resolves in a syllabus', (entry) => {
    const found = syllabi.some((s) => getTopic(s, entry.topicRef!) !== null);
    expect(found, `topicRef "${entry.topicRef}" resolves to no syllabus topic`).toBe(true);
  });
});
