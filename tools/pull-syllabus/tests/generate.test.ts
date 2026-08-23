import { describe, expect, it } from 'vitest';
import { loadSyllabus, type Topic } from '../../../packages/syllabus/src/syllabus.ts';
import type { NcertBook } from '../src/parse.ts';
import type { LlmAdapter } from '../src/llm.ts';
import { buildChapterPrompt } from '../src/prompt.ts';
import { generateChapters, mergeIntoSyllabus, syllabusIdFor } from '../src/generate.ts';

/**
 * Inline fixtures only — the LLM sits behind a fake adapter, so nothing here
 * touches the network or spends anything.
 */

const book: NcertBook = {
  klass: 10,
  subject: 'Science',
  title: 'Science',
  code: 'jesc1',
  chapters: 2,
};

const opts = { syllabusId: 'class10-science' };

const topic = (id: string): Topic => ({
  id,
  title: id.replace(/-/g, ' '),
  objectives: [`Student can trace what happens during ${id}`],
  visualIdeas: [`a labelled diagram of ${id}`],
  estMinutes: 10,
});

const chapter = (id: string, topics: Topic[] = [topic(`${id}-one`), topic(`${id}-two`)]) => ({
  id,
  title: id.replace(/-/g, ' '),
  topics,
});

const reply = (chapters: unknown[]) => JSON.stringify({ chapters });

const goodReply = reply([chapter('life-processes'), chapter('control-and-coordination')]);

/** Replies in order; records what it was asked. */
function fakeAdapter(...replies: string[]): LlmAdapter & { prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  return {
    prompts,
    async complete(_system: string, user: string) {
      prompts.push(user);
      return replies[Math.min(i++, replies.length - 1)];
    },
  };
}

describe('buildChapterPrompt', () => {
  const { system, user } = buildChapterPrompt({ ...book, chapters: 13 }, opts);

  it('states NCERT’s authoritative chapter count as a hard number', () => {
    expect(user).toContain('THIS BOOK HAS EXACTLY 13 CHAPTERS.');
    expect(user).toMatch(/must have 13 entries/);
    expect(user).toContain('jesc1');
    expect(user).toContain('class10-science');
  });

  it('teaches that NCERT’s numbered sections ARE the topics', () => {
    expect(system).toMatch(/numbered sections/i);
    expect(system).toMatch(/5\.2\.1/);
  });

  it('carries the worked Life Processes example, sub-topics and all', () => {
    expect(system).toContain('Life Processes');
    expect(system).toContain('5.1  What are Life Processes?');
    expect(system).toContain('5.2  Nutrition');
    expect(system).toContain('5.2.1  Autotrophic Nutrition');
    expect(system).toContain('5.2.2  Heterotrophic Nutrition');
    expect(system).toContain('5.3  Respiration');
    expect(system).toContain('5.4.1  Transportation in Human Beings');
    expect(system).toContain('5.4.2  Transportation in Plants');
    expect(system).toContain('5.5.1  Excretion in Human Beings');
    expect(system).toContain('5.5.2  Excretion in Plants');
  });

  it('demands observable objectives and bans the vague verbs', () => {
    expect(system).toMatch(/OBJECTIVES MUST BE OBSERVABLE/);
    expect(system).toContain('Student can understand photosynthesis');
    expect(system).toMatch(/Student can trace the path of blood/);
  });

  it('demands visualIdeas that could actually be drawn', () => {
    expect(system).toMatch(/could be DRAWN on a canvas/);
    expect(system).toMatch(/stomata labelled/);
  });

  it('forbids inventing and merging chapters', () => {
    expect(system).toMatch(/NEVER invent a chapter that is not in this book/);
    expect(system).toMatch(/NEVER merge two NCERT chapters into one/);
    expect(system).toMatch(/at least 2 topics/);
  });
});

describe('generateChapters', () => {
  it('accepts a well-formed reply', async () => {
    const adapter = fakeAdapter(goodReply);
    const result = await generateChapters(book, adapter, opts);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((c) => c.id)).toEqual(['life-processes', 'control-and-coordination']);
    expect(result.value[0].topics).toHaveLength(2);
    expect(adapter.prompts).toHaveLength(1);
  });

  it('rejects the wrong chapter count and puts that error in the repair prompt', async () => {
    const adapter = fakeAdapter(reply([chapter('life-processes')]), goodReply);
    const result = await generateChapters(book, adapter, opts);

    expect(result.ok).toBe(true); // the repair retry succeeded
    expect(adapter.prompts).toHaveLength(2);
    expect(adapter.prompts[1]).toMatch(
      /has 2 chapters in NCERT's catalogue but the reply has 1/,
    );
    expect(adapter.prompts[1]).toMatch(/Return exactly 2 chapters/);
    expect(adapter.prompts[1]).toContain('Your previous reply was:');
  });

  it('rejects a vague objective and names the offending text', async () => {
    const vague = { ...topic('nutrition'), objectives: ['Student can understand photosynthesis'] };
    const bad = reply([chapter('life-processes', [vague, topic('respiration')]), chapter('acids')]);
    const adapter = fakeAdapter(bad);
    const result = await generateChapters(book, adapter, opts);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toContain('Student can understand photosynthesis');
    expect(result.errors.join('\n')).toMatch(/not observable/);
  });

  it('rejects a chapter that was never decomposed', async () => {
    const bad = reply([chapter('life-processes', [topic('nutrition')]), chapter('acids')]);
    const result = await generateChapters(book, fakeAdapter(bad), opts);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toMatch(/"life-processes"\): has 1 topic\(s\)/);
  });

  it('rejects duplicate chapter and topic ids', async () => {
    const dupChapters = reply([chapter('life-processes'), chapter('life-processes')]);
    const dupTopics = reply([
      chapter('life-processes', [topic('nutrition'), topic('nutrition')]),
      chapter('acids'),
    ]);

    const a = await generateChapters(book, fakeAdapter(dupChapters), opts);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.errors.join('\n')).toMatch(/duplicate chapter id "life-processes"/);

    const b = await generateChapters(book, fakeAdapter(dupTopics), opts);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors.join('\n')).toMatch(/duplicate topic id "nutrition"/);
  });

  it('rejects empty titles and topics with no objectives', async () => {
    const noTitle = reply([{ ...chapter('life-processes'), title: '  ' }, chapter('acids')]);
    const noObjectives = reply([
      chapter('life-processes', [{ ...topic('nutrition'), objectives: [] }, topic('respiration')]),
      chapter('acids'),
    ]);

    const a = await generateChapters(book, fakeAdapter(noTitle), opts);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.errors.join('\n')).toMatch(/needs a non-empty title/);

    const b = await generateChapters(book, fakeAdapter(noObjectives), opts);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors.join('\n')).toMatch(/needs a non-empty objectives array/);
  });

  it('gives up after two failures and preserves the raw reply', async () => {
    const bad = reply([chapter('life-processes')]);
    const adapter = fakeAdapter(bad, bad);
    const result = await generateChapters(book, adapter, opts);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(adapter.prompts).toHaveLength(2);
    expect(result.raw).toBe(bad);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('reports unparseable JSON the same way as a validation failure', async () => {
    const result = await generateChapters(book, fakeAdapter('not json at all'), opts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/not valid JSON/);
    expect(result.raw).toBe('not json at all');
  });
});

describe('mergeIntoSyllabus', () => {
  it('emits JSON that loadSyllabus accepts, round-tripped through disk shape', async () => {
    const result = await generateChapters(book, fakeAdapter(goodReply), opts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const merged = mergeIntoSyllabus(null, book, result.value);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;

    // Exactly what the CLI writes, then read back the way the app reads it.
    const onDisk = JSON.parse(`${JSON.stringify(merged.value, null, 2)}\n`) as unknown;
    const loaded = loadSyllabus(onDisk);

    expect(loaded.id).toBe('class10-science');
    expect(loaded.klass).toBe(10);
    expect(loaded.subject).toBe('Science');
    expect(loaded.chapters).toHaveLength(2);
  });

  it('merges by chapter id so a second book does not wipe out the first', () => {
    const partOne = mergeIntoSyllabus(null, book, [chapter('sets'), chapter('relations')]);
    expect(partOne.ok).toBe(true);
    if (!partOne.ok) return;

    const partTwo = mergeIntoSyllabus(partOne.value, book, [chapter('integrals'), chapter('vectors')]);
    expect(partTwo.ok).toBe(true);
    if (!partTwo.ok) return;

    expect(partTwo.value.chapters.map((c) => c.id)).toEqual([
      'sets',
      'relations',
      'integrals',
      'vectors',
    ]);
  });

  it('replaces a chapter that is regenerated, keeping its siblings', () => {
    const before = mergeIntoSyllabus(null, book, [chapter('sets'), chapter('relations')]);
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    const rewritten = chapter('sets', [topic('roster-form'), topic('venn-diagrams')]);
    const after = mergeIntoSyllabus(before.value, book, [rewritten]);
    expect(after.ok).toBe(true);
    if (!after.ok) return;

    expect(after.value.chapters.map((c) => c.id)).toEqual(['sets', 'relations']);
    expect(after.value.chapters[0].topics.map((t) => t.id)).toEqual([
      'roster-form',
      'venn-diagrams',
    ]);
  });

  it('refuses a merge the syllabus contract would reject', () => {
    const outOfRange = mergeIntoSyllabus(null, { ...book, klass: 3 }, [chapter('sets')]);
    expect(outOfRange.ok).toBe(false);
    if (outOfRange.ok) return;
    expect(outOfRange.errors[0]).toMatch(/klass must be an integer from 6 to 12/);
  });
});

describe('syllabusIdFor', () => {
  it('names the output file after the class and subject', () => {
    expect(syllabusIdFor(book)).toBe('class10-science');
    expect(syllabusIdFor({ ...book, klass: 12, subject: 'Social Science' })).toBe(
      'class12-social-science',
    );
  });
});
