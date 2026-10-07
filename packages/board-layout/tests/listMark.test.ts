import { describe, expect, it } from 'vitest';
import { boxOf, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction } from '../src/types';

/**
 * AN ITEM OF A LIST CAN BE MARKED (human heart, 2026-10-07).
 *
 * The lines about "why double circulation matters" talked about one item of
 * its list after another, and nothing on the board moved: a list could not be
 * marked. `annotate` with a target `<list id>#<n>` now highlights item n's row.
 */

describe('a mark on an item of a list', () => {
  it('highlights the row of the item named, on the line that marks it', () => {
    const board: Instruction[] = [
      { do: 'say', text: 'Three reasons.' },
      {
        do: 'list',
        id: 'why',
        heading: 'Why it matters',
        items: [
          { term: 'Pure oxygen supply', meaning: 'no mixing of blood' },
          { term: 'High energy output', meaning: 'for warm-blooded animals' },
          { term: 'Constant temperature', meaning: 'whatever the weather' },
        ],
      },
      { do: 'say', text: 'Warm-blooded animals need a lot of energy.' },
      { do: 'annotate', target: 'why#1', mark: 'highlight' },
    ];
    const made = layoutBeat({ id: 'b4', topic: 't', narration: '', board }, new Map(), new Map(), { composed: true });
    const list = made.elements.find((e) => e.kind === 'list')!;
    const mark = made.elements.find((e) => e.kind === 'mark') as Extract<Element, { kind: 'mark' }>;
    expect(mark).toBeDefined();
    expect(mark.shape).toBe('highlight');
    const l = boxOf(list);
    const m = boxOf(mark);
    // Inside the list, below its heading and first item, above its last item's end.
    expect(m.y).toBeGreaterThan(l.y + 40);
    expect(m.y + m.h).toBeLessThan(l.y + l.h);
    expect(m.h).toBeLessThan(l.h / 2);
    // It arrives with the line that marks it, not with the list.
    expect(made.steps[0].show).not.toContain(mark.id);
    expect(made.steps[1].show).toContain(mark.id);
  });
});
