import { describe, expect, it } from 'vitest';
import { ICON_PICKER_SYSTEM, iconPickerUser, pickIcons, type IconOption } from '../src/icons';
import type { LlmAdapter } from '../src/prepare';

const options: Record<string, IconOption[]> = {
  tank: [
    { icon: 'military-helmet', set: 'noto' },
    { icon: 'potable-water', set: 'noto' },
  ],
  bank: [
    { icon: 'bank', set: 'noto' },
    { icon: 'national-park', set: 'noto' },
  ],
};

const says = (reply: string): LlmAdapter => ({ complete: async () => reply });

describe('the lesson decides which meaning of a word to draw', () => {
  it('takes the model’s choice when it names one of the options', async () => {
    // A lesson about water flow put an armoured vehicle on the board, because
    // no amount of string matching can tell two meanings of "tank" apart.
    const chosen = await pickIcons(
      'Water flowing between tanks',
      options,
      says('{"tank":{"icon":"potable-water","set":"noto"},"bank":{"icon":null,"set":null}}'),
    );
    expect(chosen.tank).toEqual({ icon: 'potable-water', set: 'noto', deliberate: true });
    // The model SAID null — that is an answer, and it must be marked as one.
    expect(chosen.bank).toEqual({ icon: null, set: null, deliberate: true });
  });

  it('refuses an icon the model invented', async () => {
    // A name that is not in the set resolves to nothing, and the picture would
    // vanish with no error anywhere.
    const chosen = await pickIcons('x', options, says('{"tank":{"icon":"water-tower","set":"noto"}}'));
    // An invented name is not an answer: fall back, and say so.
    expect(chosen.tank).toEqual({ icon: null, set: null, deliberate: false });
  });

  it('falls back to no choice when the model fails', async () => {
    const broken: LlmAdapter = {
      complete: async () => {
        throw new Error('timeout');
      },
    };
    const chosen = await pickIcons('x', options, broken);
    // Every word still has an entry, so the caller keeps its own first guess
    // rather than losing the picture.
    expect(Object.keys(chosen).sort()).toEqual(['bank', 'tank']);
    // A failed call is NOT a refusal; the caller keeps its first guess.
    expect(chosen.tank).toEqual({ icon: null, set: null, deliberate: false });
  });

  it('falls back when the reply is not JSON', async () => {
    const chosen = await pickIcons('x', options, says('Sure! I would pick the water one.'));
    expect(chosen.tank).toEqual({ icon: null, set: null, deliberate: false });
  });

  it('reads a reply wrapped in a markdown fence', async () => {
    const fence = String.fromCharCode(96).repeat(3);
    const chosen = await pickIcons(
      'x',
      options,
      says(`${fence}json\n{"tank":{"icon":"potable-water","set":"noto"}}\n${fence}`),
    );
    expect(chosen.tank).toEqual({ icon: 'potable-water', set: 'noto', deliberate: true });
  });

  it('asks nothing when there are no words', async () => {
    let called = false;
    const watcher: LlmAdapter = {
      complete: async () => {
        called = true;
        return '{}';
      },
    };
    expect(await pickIcons('x', {}, watcher)).toEqual({});
    expect(called).toBe(false);
  });
});

describe('the question it asks', () => {
  it('names the topic and lists every option', () => {
    const user = iconPickerUser('Water flowing between tanks', options);
    expect(user).toContain('Water flowing between tanks');
    expect(user).toContain('noto:potable-water');
    expect(user).toContain('noto:military-helmet');
  });

  it('says plainly when nothing was found for a word', () => {
    expect(iconPickerUser('x', { photosynthesis: [] })).toContain('(nothing found)');
  });
});

describe('the two nulls mean opposite things', () => {
  // A model that correctly refused the military tank once still put it on the
  // board, because its refusal fell through to the very candidate it refused.
  it('marks a refusal deliberate, so the caller reaches for the pencil', async () => {
    const chosen = await pickIcons(
      'Water flow',
      options,
      says('{"tank":{"icon":null,"set":null}}'),
    );
    expect(chosen.tank.deliberate).toBe(true);
  });

  it('accepts an icon the model wrote with its set prefix attached', async () => {
    // Models write "noto:potable-water" as often as "potable-water".
    const chosen = await pickIcons(
      'Water flow',
      options,
      says('{"tank":{"icon":"noto:potable-water","set":"noto"}}'),
    );
    expect(chosen.tank).toEqual({ icon: 'potable-water', set: 'noto', deliberate: true });
  });
});

/**
 * THE LABEL SAYS WHAT THE PICTURE MUST SHOW (small intestine, 2026-10-07): the
 * noun "tube", labelled "Intestinal lumen", was given a test tube — the picker
 * saw only the bare word.
 */
describe('a word with its label on the board', () => {
  it('shows the picker the label beside the word', () => {
    const user = iconPickerUser('Small intestine', { tube: [{ icon: 'test-tube', set: 'noto' }] }, { tube: ['Intestinal lumen'] });
    expect(user).toContain('- "tube" (labelled "Intestinal lumen"): noto:test-tube');
  });

  it('passes the labels on to the model', async () => {
    let asked = '';
    const llm: LlmAdapter = {
      complete: async (_s: string, u: string) => {
        asked = u;
        return '{"tube":{"icon":null,"set":null}}';
      },
    };
    await pickIcons('Small intestine', { tube: [{ icon: 'test-tube', set: 'noto' }] }, llm, { tube: ['Intestinal lumen'] });
    expect(asked).toContain('labelled "Intestinal lumen"');
  });

  it('tells the model a name that only contains the word is a different thing', () => {
    expect(ICON_PICKER_SYSTEM).toContain('test-tube for "tube"');
  });
});
