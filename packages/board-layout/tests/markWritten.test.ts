import { describe, expect, it } from 'vitest';
import { boxOf, handWidth, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

const beat = (board: Instruction[]): ScriptBeat => ({ id: 'b1', topic: 't', narration: '', board });
const marks = (elements: Element[]) => elements.filter((el): el is Extract<Element, { kind: 'mark' }> => el.kind === 'mark');

/** C3: she marks what she wrote — a box round it, a highlight over a word of it. */
describe('a mark on a written line', () => {
  it('boxes a key point she wrote, by its id', () => {
    const { elements, laid, bonds } = layoutBeat(
      beat([
        { do: 'say', text: 'Write this down.' },
        { do: 'write', id: 'def', text: 'Respiration releases energy' },
        { do: 'say', text: 'This is the whole idea.' },
        { do: 'annotate', target: 'def', mark: 'box' },
      ]),
    );
    const line = elements.find((el) => el.kind === 'handwrite')!;
    const [mark] = marks(elements);
    expect(mark.shape).toBe('box');
    const b = boxOf(line);
    expect(mark.x).toBeLessThan(b.x);
    expect(mark.x + mark.w).toBeGreaterThan(b.x + b.w);
    expect(mark.y).toBeLessThan(b.y);
    expect(mark.y + mark.h).toBeGreaterThan(b.y + b.h);
    expect(bonds).toContainEqual({ a: mark.id, b: line.id });
    expect(laid.show).toContain(mark.id);
  });

  it('highlights only the words named by `span`', () => {
    const text = 'Respiration releases energy';
    const { elements } = layoutBeat(
      beat([
        { do: 'say', text: 'Write this down.' },
        { do: 'write', id: 'def', text },
        { do: 'say', text: 'Energy is the point.' },
        { do: 'annotate', target: 'def', mark: 'highlight', span: 'energy' },
      ]),
    );
    const line = elements.find((el): el is Extract<Element, { kind: 'handwrite' }> => el.kind === 'handwrite')!;
    const [mark] = marks(elements);
    const size = line.size ?? 26;
    const b = boxOf(line);
    // Its left edge where "energy" starts, and about as wide as "energy".
    expect(Math.abs(mark.x - (b.x + handWidth('Respiration releases ', size)))).toBeLessThan(12);
    expect(mark.w).toBeLessThan(handWidth('energy', size) + 24);
    expect(mark.w).toBeGreaterThan(handWidth('energy', size) - 4);
  });

  it('marks the whole line when the span is not in it', () => {
    const { elements } = layoutBeat(
      beat([
        { do: 'say', text: 'Write this down.' },
        { do: 'write', id: 'def', text: 'Respiration releases energy' },
        { do: 'annotate', target: 'def', mark: 'underline', span: 'glucose' },
      ]),
    );
    const line = elements.find((el) => el.kind === 'handwrite')!;
    const [mark] = marks(elements);
    expect(mark.w).toBeGreaterThanOrEqual(boxOf(line).w);
  });
});
