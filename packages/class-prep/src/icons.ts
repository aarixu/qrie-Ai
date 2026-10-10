import type { LlmAdapter } from './prepare.ts';

/**
 * CHOOSING THE RIGHT PICTURE, NOT THE FIRST ONE.
 *
 * A lesson about water flowing between tanks put an armoured vehicle on the
 * board. No amount of string matching fixes that: "tank" is two things, and
 * only the lesson says which. So the search offers what it found and something
 * that understands the lesson picks.
 *
 * One call for the whole class, run beside the drawing, on a fast model. The
 * choice is cheap; the alternative is a board that is confidently wrong.
 */

export interface IconOption {
  /** How the icon is named in its set, e.g. `military-helmet`. */
  icon: string;
  set: string;
  /** The set's own grouping, when it ships one — the only non-name clue. */
  category?: string;
}

export interface IconChoice {
  /** The chosen icon, or null. */
  icon: string | null;
  set: string | null;
  /**
   * Whether the null was the MODEL'S answer rather than a failure of the call.
   *
   * The two nulls mean opposite things. "I looked, and none of these depicts
   * it" must end in the pencilled circle; "the call failed" must end in the
   * name-matched first guess. Collapsing them is how a model that correctly
   * refused the military tank still put it on the board — its refusal fell
   * through to the very candidate it refused.
   */
  deliberate: boolean;
}

export const ICON_PICKER_SYSTEM = `You choose which small picture best depicts a
word, for a school lesson board.

You are given the lesson's topic, and for each word a short list of icons that
were found by name. Pick the one that DEPICTS what the lesson means, not the one
whose name matches best.

Words have more than one meaning and the topic decides which:

- "tank" in a lesson about water flow is a water tank, never a military tank.
- "bank" beside a river is a riverbank, not a place that keeps money.
- "cell" in biology is a living cell, not a phone or a prison.
- "mouse" in a lesson about computers is the device; in one about animals it is
  the animal.

The NAME is all you can see, and a bare name is not evidence. When a word has
more than one meaning and an option is named exactly that bare word — no
qualifier, no category that settles it — you cannot know which meaning it
draws, and general icon sets usually draw the famous one, not the everyday
one. Choose null. A qualified name ("water-…", "scuba-…") or a category tells
you what it depicts; trust those.

A word may come with the label written beside it on the board. The picture
must show the LABELLED thing: "tube" labelled "Intestinal lumen" is a part of
the gut, and test-tube for "tube" is a different thing, as delivery-truck is for
"liver". A name that merely contains the word is not evidence; choose null.

If none of the options depicts the right thing, choose null. A pencilled circle
with the word written in it is better than a confidently wrong picture — a
student who sees a war machine in a lesson about water tanks learns the wrong
thing and does not know it.

Reply with ONE JSON object mapping each word to your choice:
{"tank": {"icon": "potable-water", "set": "noto"}, "bank": {"icon": null, "set": null}}`;

export function iconPickerUser(
  topic: string,
  options: Readonly<Record<string, readonly IconOption[]>>,
  /** The label each word is written with on the board, when it has one. */
  labels: Readonly<Record<string, readonly string[]>> = {},
): string {
  const labelOf = (noun: string): string => {
    const said = [...new Set(labels[noun] ?? [])].filter((l) => l.trim() !== '');
    return said.length > 0 ? ` (labelled ${said.map((l) => `"${l}"`).join(', ')})` : '';
  };
  const lines = Object.entries(options).map(
    ([noun, opts]) =>
      `- "${noun}"${labelOf(noun)}: ${
        opts
          .map((o) => `${o.set}:${o.icon}${o.category ? ` [${o.category}]` : ''}`)
          .join(', ') || '(nothing found)'
      }`,
  );
  return `Lesson topic: ${topic}

Words to illustrate, with the icons found for each:
${lines.join('\n')}`;
}

/**
 * Ask the model which of the found icons each word should use.
 *
 * Never throws and never blocks the class: a model that fails, times out or
 * answers nonsense leaves every word with its `null` choice, and the caller
 * falls back to the name-matched first guess it already had. A better picture
 * is worth one call; it is not worth a class that will not start.
 */
export async function pickIcons(
  topic: string,
  options: Readonly<Record<string, readonly IconOption[]>>,
  llm: LlmAdapter,
  /** The label each word is written with on the board (see iconPickerUser). */
  labels: Readonly<Record<string, readonly string[]>> = {},
): Promise<Record<string, IconChoice>> {
  const nouns = Object.keys(options);
  const fallback = Object.fromEntries(
    nouns.map((n) => [n, { icon: null, set: null, deliberate: false } as IconChoice]),
  );
  if (nouns.length === 0) return fallback;

  let reply: string;
  try {
    reply = await llm.complete(ICON_PICKER_SYSTEM, iconPickerUser(topic, options, labels));
  } catch {
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
  } catch {
    return fallback;
  }
  if (typeof parsed !== 'object' || parsed === null) return fallback;

  const out: Record<string, IconChoice> = { ...fallback };
  for (const noun of nouns) {
    const raw = (parsed as Record<string, unknown>)[noun];
    if (typeof raw !== 'object' || raw === null) continue;
    const { icon, set } = raw as { icon?: unknown; set?: unknown };

    // An explicit null IS the answer: none of these depicts it.
    if (icon === null) {
      out[noun] = { icon: null, set: null, deliberate: true };
      continue;
    }
    if (typeof icon !== 'string' || typeof set !== 'string') continue;

    // Models write the icon as "set:name" as often as "name"; accept both,
    // but only for a choice that was actually on the list it was given — an
    // invented name would resolve to nothing and silently lose the picture.
    const bare = icon.startsWith(`${set}:`) ? icon.slice(set.length + 1) : icon;
    if (!options[noun]?.some((o) => o.icon === bare && o.set === set)) continue;
    out[noun] = { icon: bare, set, deliberate: true };
  }
  return out;
}
