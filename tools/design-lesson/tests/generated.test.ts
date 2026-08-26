import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { validateLesson } from '../../../packages/lesson-format/src/validate.ts';
import { loadGraph } from '../../../packages/knowledge-graph/src/graph.ts';
import { pedagogyIssues } from '../../../packages/pedagogy/src/rosenshine.ts';

/**
 * The first lesson planned from the Learning Outcome Map, held to the same
 * rules that produced it. This is the contract test for the whole factory:
 * schema, outcome ids that resolve, and a shape the pedagogy rules accept.
 */
interface GeneratedBeat {
  id: string;
  teaches?: string[];
  checks?: string[];
}
const lesson = JSON.parse(
  fs.readFileSync('content/class9-particle-size/lesson.json', 'utf8'),
) as { beats: GeneratedBeat[] };
const graph = loadGraph(
  JSON.parse(fs.readFileSync('packages/knowledge-graph/data/class9-science.json', 'utf8')),
);

/** Roles are not stored on a beat; they are recovered from what it does. */
const roleOf = (beat: { teaches?: string[]; checks?: string[] }, i: number, last: number) => {
  if (i === 0) return 'hook' as const;
  if (i === last) return 'recap' as const;
  if ((beat.teaches ?? []).length === 0) return 'check' as const;
  return 'teach' as const;
};

describe('the first map-planned lesson', () => {
  it('is a valid lesson document', () => {
    const result = validateLesson(lesson);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it('every outcome it claims to teach exists in the map', () => {
    const known = new Set(graph.nodes.map((n) => n.id));
    for (const beat of lesson.beats) {
      for (const id of [...(beat.teaches ?? []), ...(beat.checks ?? [])]) {
        expect(known.has(id), `${beat.id} names "${id}"`).toBe(true);
      }
    }
  });

  it('opens on a hook and closes on a recap, neither teaching', () => {
    const first = lesson.beats[0];
    const last = lesson.beats[lesson.beats.length - 1];
    expect(first.teaches ?? []).toEqual([]);
    expect(last.teaches ?? []).toEqual([]);
  });

  it('holds up against the rules that planned it', () => {
    const last = lesson.beats.length - 1;
    const shapes = lesson.beats.map((beat, i) => ({
      id: beat.id,
      role: roleOf(beat, i, last),
      teaches: beat.teaches ?? [],
      checks: beat.checks ?? [],
    }));
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const taught = new Set<string>(shapes.flatMap((s) => s.teaches));
    const prerequisites = new Map(
      [...taught].map((id) => [id, (byId.get(id)?.prerequisites ?? []).filter((p) => taught.has(p))]),
    );
    expect(pedagogyIssues(shapes, { prerequisites })).toEqual([]);
  });

  it('teaches each outcome exactly once, and never before what it rests on', () => {
    const at = new Map<string, number>();
    lesson.beats.forEach((b, i) => {
      for (const id of b.teaches ?? []) {
        expect(at.has(id), `"${id}" taught twice`).toBe(false);
        at.set(id, i);
      }
    });
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const [id, i] of at) {
      for (const p of byId.get(id)?.prerequisites ?? []) {
        const before = at.get(p);
        if (before !== undefined) expect(before, `${p} before ${id}`).toBeLessThan(i);
      }
    }
  });
});
