import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadSyllabus, getTopic, listTopics } from '../src/index';
import type { SubjectSyllabus } from '../src/index';

const seedPath = path.resolve(process.cwd(), 'packages/syllabus/data/class10-science.json');
const seed = () => JSON.parse(fs.readFileSync(seedPath, 'utf8')) as Record<string, unknown>;

// A minimal valid syllabus, cloned per test so mutations don't leak.
const valid = (): Record<string, unknown> => ({
  id: 'class9-maths',
  klass: 9,
  subject: 'Mathematics',
  chapters: [
    {
      id: 'polynomials',
      title: 'Polynomials',
      topics: [
        { id: 'zeroes', title: 'Zeroes of a Polynomial', objectives: ['Student can find the zeroes of a linear polynomial.'] },
      ],
    },
  ],
});

describe('loadSyllabus', () => {
  it('accepts a minimal valid syllabus and returns it typed', () => {
    const s = loadSyllabus(valid());
    expect(s.id).toBe('class9-maths');
    expect(s.chapters[0].topics[0].id).toBe('zeroes');
  });

  it('rejects a non-object', () => {
    expect(() => loadSyllabus('nope')).toThrow(/must be a JSON object/);
    expect(() => loadSyllabus(null)).toThrow(/must be a JSON object/);
    expect(() => loadSyllabus([1])).toThrow(/must be a JSON object/);
  });

  it('rejects a missing id', () => {
    const doc = valid();
    delete doc.id;
    expect(() => loadSyllabus(doc)).toThrow(/non-empty id/);
  });

  it.each([5, 13, 9.5, '9'])('rejects klass %j', (klass) => {
    const doc = valid();
    doc.klass = klass;
    expect(() => loadSyllabus(doc)).toThrow(/klass must be an integer from 6 to 12/);
  });

  it('rejects a missing subject', () => {
    const doc = valid();
    doc.subject = '';
    expect(() => loadSyllabus(doc)).toThrow(/subject/);
  });

  it('rejects missing or empty chapters', () => {
    const doc = valid();
    doc.chapters = [];
    expect(() => loadSyllabus(doc)).toThrow(/non-empty chapters array/);
  });

  it('rejects a chapter without a title, naming its path', () => {
    const doc = valid();
    (doc.chapters as Array<Record<string, unknown>>)[0].title = '';
    expect(() => loadSyllabus(doc)).toThrow(/chapters\[0\].*title/);
  });

  it('rejects a chapter with no topics', () => {
    const doc = valid();
    (doc.chapters as Array<Record<string, unknown>>)[0].topics = [];
    expect(() => loadSyllabus(doc)).toThrow(/non-empty topics array/);
  });

  it('rejects a topic without objectives, naming its path', () => {
    const doc = valid();
    const topic = ((doc.chapters as Array<Record<string, unknown>>)[0].topics as Array<Record<string, unknown>>)[0];
    topic.objectives = [];
    expect(() => loadSyllabus(doc)).toThrow(/chapters\[0\]\.topics\[0\].*objectives/);
  });

  it('rejects an empty string inside objectives', () => {
    const doc = valid();
    const topic = ((doc.chapters as Array<Record<string, unknown>>)[0].topics as Array<Record<string, unknown>>)[0];
    topic.objectives = ['ok', ''];
    expect(() => loadSyllabus(doc)).toThrow(/objectives/);
  });

  it('rejects duplicate topic ids within a chapter', () => {
    const doc = valid();
    const topics = (doc.chapters as Array<Record<string, unknown>>)[0].topics as Array<Record<string, unknown>>;
    topics.push({ ...topics[0] });
    expect(() => loadSyllabus(doc)).toThrow(/duplicate topic id "zeroes"/);
  });

  it('rejects a non-positive estMinutes', () => {
    const doc = valid();
    const topic = ((doc.chapters as Array<Record<string, unknown>>)[0].topics as Array<Record<string, unknown>>)[0];
    topic.estMinutes = 0;
    expect(() => loadSyllabus(doc)).toThrow(/estMinutes/);
  });
});

describe('getTopic', () => {
  const s = (): SubjectSyllabus => loadSyllabus(valid());

  it('resolves a full path', () => {
    const topic = getTopic(s(), 'class9-maths/polynomials/zeroes');
    expect(topic?.title).toBe('Zeroes of a Polynomial');
  });

  it('returns null when any segment misses', () => {
    expect(getTopic(s(), 'other-syllabus/polynomials/zeroes')).toBeNull();
    expect(getTopic(s(), 'class9-maths/ghost-chapter/zeroes')).toBeNull();
    expect(getTopic(s(), 'class9-maths/polynomials/ghost-topic')).toBeNull();
  });

  it('returns null for malformed paths', () => {
    expect(getTopic(s(), '')).toBeNull();
    expect(getTopic(s(), 'class9-maths/polynomials')).toBeNull();
    expect(getTopic(s(), 'class9-maths/polynomials/zeroes/extra')).toBeNull();
  });
});

describe('listTopics', () => {
  it('lists every topic with its full path in declaration order', () => {
    const s = loadSyllabus(valid());
    const all = listTopics(s);
    expect(all).toHaveLength(1);
    expect(all[0].path).toBe('class9-maths/polynomials/zeroes');
    expect(all[0].topic.id).toBe('zeroes');
  });
});

describe('seed data: class10-science.json', () => {
  it('loads and validates', () => {
    const s = loadSyllabus(seed());
    expect(s.id).toBe('class10-science');
    expect(s.klass).toBe(10);
  });

  it('has the five life-processes topics with paths', () => {
    const s = loadSyllabus(seed());
    const paths = listTopics(s).map((t) => t.path);
    for (const id of ['nutrition', 'respiration', 'heart-circulation', 'blood-components', 'excretion']) {
      expect(paths).toContain(`class10-science/life-processes/${id}`);
    }
  });

  it('resolves heart-circulation with designer-ready objectives', () => {
    const s = loadSyllabus(seed());
    const topic = getTopic(s, 'class10-science/life-processes/heart-circulation');
    expect(topic).not.toBeNull();
    expect(topic!.objectives.length).toBeGreaterThanOrEqual(3);
    expect(topic!.objectives.join(' ')).toMatch(/thicker/);
  });

  it('keeps every topic within the authoring rules (3-5 objectives, 8-12 min, visual ideas)', () => {
    const s = loadSyllabus(seed());
    for (const { path: p, topic } of listTopics(s)) {
      expect(topic.objectives.length, p).toBeGreaterThanOrEqual(3);
      expect(topic.objectives.length, p).toBeLessThanOrEqual(5);
      for (const objective of topic.objectives) expect(objective, p).toMatch(/^Student can /);
      expect(topic.estMinutes, p).toBeGreaterThanOrEqual(8);
      expect(topic.estMinutes, p).toBeLessThanOrEqual(12);
      expect(topic.visualIdeas?.length ?? 0, p).toBeGreaterThan(0);
    }
  });
});
