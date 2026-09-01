import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildPrompt } from '../src/prompt.ts';
import { loadSyllabus, getTopic } from '../../../packages/syllabus/src/index.ts';

const root = process.cwd();
const syllabus = loadSyllabus(
  JSON.parse(fs.readFileSync(path.resolve(root, 'packages/syllabus/data/class10-science.json'), 'utf8')),
);
const topic = getTopic(syllabus, 'class10-science/life-processes/transportation-in-human-beings')!;

describe('buildPrompt', () => {
  const { system, user } = buildPrompt(topic, {
    klass: 10,
    topicPath: 'class10-science/life-processes/transportation-in-human-beings',
  });

  it('embeds the full closed element vocabulary and coordinate space', () => {
    for (const kind of ['title', 'text', 'note', 'box', 'doc', 'arrow', 'pen', 'formula', 'image', 'model3d']) {
      expect(system).toContain(`"kind": "${kind}"`);
    }
    expect(system).toContain('1000x620');
    expect(system).toMatch(/"neutral", "good", "bad", "accent"/);
  });

  it('embeds the beat semantics and pedagogy rules', () => {
    expect(system).toMatch(/COMPLETE set of element ids/);
    expect(system).toMatch(/subset of "show"/);
    expect(system).toMatch(/6 to 12 beats/);
    expect(system).toMatch(/30 to 60 words/);
    expect(system).toMatch(/"en"/);
    expect(system).toMatch(/HOOK/);
    expect(system).toMatch(/real-life example/);
    expect(system).toMatch(/rhetorical check question/);
    expect(system).toMatch(/RECAP/);
  });

  it('embeds the committed example lesson as a few-shot', () => {
    const example = fs.readFileSync(path.resolve(root, 'packages/lesson-format/tests/fixtures/heart.lesson.json'), 'utf8');
    expect(system).toContain(example.trim());
  });

  it('adapts language guidance to klass', () => {
    expect(system).toContain('Class 10');
    expect(system).toMatch(/board-exam depth/);
    const junior = buildPrompt(topic, { klass: 7 }).system;
    expect(junior).toContain('Class 7');
    expect(junior).toMatch(/short/);
    expect(junior).not.toMatch(/board-exam depth/);
  });

  it('carries the topic into the user prompt', () => {
    expect(user).toContain(topic.title);
    for (const objective of topic.objectives) expect(user).toContain(objective);
    for (const idea of topic.visualIdeas ?? []) expect(user).toContain(idea);
    expect(user).toContain(`about ${topic.estMinutes} minutes`);
    expect(user).toContain('"topicRef": "class10-science/life-processes/transportation-in-human-beings"');
  });

  it('demands pure JSON output', () => {
    expect(user).toMatch(/PURE JSON only/);
    expect(user).toMatch(/No markdown fences/);
  });
});
