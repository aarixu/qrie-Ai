import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOLS } from '@ai-tutor/lesson-format';
import { PLANNER_SYSTEM } from '../src/prompts';
import { recipeLines, toolkitPrompt } from '../src/toolPrompt';

describe('the toolkit in the planner prompt', () => {
  it('shows every tool as a whole instruction, from its own example', () => {
    for (const name of TOOL_NAMES) {
      expect(PLANNER_SYSTEM).toContain(JSON.stringify({ do: name, ...TOOLS[name].example }));
    }
  });

  it('maps each kind of idea to its tool', () => {
    expect(recipeLines()).toContain('- Solving or rearranging an equation: an equationMove.');
    expect(recipeLines()).toContain('- What one whole is made of, or shares of it: a pieChart.');
    expect(PLANNER_SYSTEM).toContain(recipeLines());
  });

  it('stays within the cost the spec allows (about 800 tokens)', () => {
    const added = toolkitPrompt().length + recipeLines().length;
    expect(added).toBeLessThan(3200);
  });
});
