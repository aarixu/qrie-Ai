import { describe, expect, it } from 'vitest';
import { toolkitDemoLesson } from '../src/lib/toolkitDemo';

describe('the toolkit demo', () => {
  it('assembles into a valid lesson with every tool and every improved element', () => {
    const { lesson } = toolkitDemoLesson();
    const kinds = new Set(lesson.elements.map((el) => (el.kind === 'tool' ? `tool:${el.tool}` : el.kind)));
    for (const k of ['tool:pieChart', 'tool:lineChart', 'tool:equationMove', 'flow', 'chart', 'list']) expect(kinds).toContain(k);
  });

  it('breaks none of the toolkit rules', () => {
    const { problems } = toolkitDemoLesson();
    expect(problems.filter((p) => p.rule.startsWith('tool-'))).toEqual([]);
  });
});
