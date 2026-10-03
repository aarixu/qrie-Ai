import { TOOL_NAMES, TOOLS, type RecipeTag } from '@ai-tutor/lesson-format';

/**
 * THE TOOLKIT, AS THE PLANNER READS IT — built from the registry, so adding a
 * tool to lesson-format/src/tools adds it here with no hand edit.
 */

const RECIPE_WORDS: Record<RecipeTag, string> = {
  'equation-solving': 'Solving or rearranging an equation',
  'part-of-whole': 'What one whole is made of, or shares of it',
  'change-over-time': 'A measured quantity changing over time',
};

/** One line per kind of idea a tool explains, for the "kind of idea" list. */
export function recipeLines(): string {
  const article = (name: string) => (/^[aeiou]/i.test(name) ? 'an' : 'a');
  return TOOL_NAMES.flatMap((name) => TOOLS[name].recipes.map((tag) => `- ${RECIPE_WORDS[tag]}: ${article(name)} ${name}.`)).join('\n');
}

/** The toolkit section of the instruction list. */
export function toolkitPrompt(): string {
  const tools = TOOL_NAMES.map((name) => {
    const spec = TOOLS[name];
    return `- ${JSON.stringify({ do: name, ...spec.example })}\n  ${spec.summary} ${spec.whenToUse}`;
  }).join('\n');
  return `### The toolkit — the board draws and animates these from your words and numbers

${tools}

A tool's params are exactly the keys in its example; never "x", "y", "w" or "h". It takes "at" like a write. One tool per spoken line, and say enough while it draws — about a sentence per step or slice.`;
}
