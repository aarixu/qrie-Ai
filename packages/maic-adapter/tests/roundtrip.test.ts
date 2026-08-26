import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { ElementKind, Lesson } from '@ai-tutor/lesson-format';
import { initialBoard, reduce } from '@ai-tutor/action-player';
import { planToScene } from '../src/planToScene';
import { beatOfAction } from '../src/beatOfAction';

// Vitest runs from the repo root, which is the convention the rest of the
// suite already uses to reach content/ (see apps/classroom/tests/content.test.ts).
const lessonPath = path.join(process.cwd(), 'content/class9-particle-size/lesson.json');
const lesson = JSON.parse(fs.readFileSync(lessonPath, 'utf8')) as Lesson;

describe('a real lesson survives the round trip', () => {
  const { actions, beatRanges } = planToScene(lesson);

  it('produces one range per beat', () => {
    expect(beatRanges).toHaveLength(lesson.beats.length);
  });

  it('speaks every beat that has narration, in order', () => {
    const spoken = actions
      .filter((a) => a.type === 'speech')
      .map((a) => (a as { text: string }).text);
    const expected = lesson.beats.map((b) => b.narration).filter((n) => n.trim() !== '');
    expect(spoken).toEqual(expected);
  });

  it('ends with every element of the final beat on the board', () => {
    const state = actions.reduce(reduce, initialBoard);
    const onBoard = new Set(state.visible);
    const missed = lesson.beats.at(-1)!.show.filter((id) => !onBoard.has(id));
    expect(missed).toEqual([]);
  });

  it('names the element kinds that still draw nothing, so the gap cannot hide', () => {
    // `image` and `pen` have no action verb yet. They are silently skipped, and
    // this test is what stops that silence from looking like success. When a
    // verb is added for either, this expectation must shrink — not be deleted.
    const byId = new Map(lesson.elements.map((e) => [e.id, e]));
    const shown = new Set(lesson.beats.flatMap((b) => b.show));
    const state = actions.reduce(reduce, initialBoard);
    const onBoard = new Set(state.visible);

    const undrawn = [...shown]
      .filter((id) => !onBoard.has(id))
      .map((id) => byId.get(id)?.kind)
      .filter((k): k is ElementKind => k !== undefined);

    expect(new Set(undrawn)).toEqual(new Set(['image', 'pen']));
  });

  it('resolves every action index to a beat', () => {
    for (let i = 0; i < actions.length; i += 1) {
      expect(beatOfAction(beatRanges, i)).not.toBeNull();
    }
  });

  it('resolves an index back to the beat that carries the outcomes it teaches', () => {
    const teaching = lesson.beats.findIndex((b) => (b.teaches ?? []).length > 0);
    // class9-particle-size was generated after the outcome map existed, so it
    // carries `teaches`. If this ever fails, the lesson lost its LOM join.
    expect(teaching).toBeGreaterThanOrEqual(0);

    const range = beatRanges[teaching];
    const beatId = beatOfAction(beatRanges, range.from);
    expect(beatId).toBe(lesson.beats[teaching].id);

    const beat = lesson.beats.find((b) => b.id === beatId)!;
    expect(beat.teaches!.length).toBeGreaterThan(0);
  });
});
