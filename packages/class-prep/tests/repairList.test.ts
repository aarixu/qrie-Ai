import { describe, expect, it } from 'vitest';
import { oncePerBeat, prepareClass, type LlmAdapter } from '../src/prepare';
import type { GateProblem } from '../src/gate';
import { SMALL_INTESTINE } from './fixtures/smallIntestine';

/**
 * THE REPAIR HEARS ABOUT EVERY KIND OF PROBLEM, NOT TEN OF ONE.
 *
 * The repair prompt carries ten problems. The small-intestine class's first
 * plan (2026-10-06) had one line on beat 3 that put nine things off camera, and
 * the gate names each thing: nine of the ten places went to one line, and the
 * three half-empty pages and the phone-readable lines were never sent. The
 * repaired plan fixed beat 3's line and was refused for the rest.
 */

const real = (rule: GateProblem['rule'], where: string, message: string): GateProblem => ({ rule, where, message });
const OFF_CAMERA = (name: string) =>
  real(
    'on-camera',
    'x',
    `Beat "b3": "${name}" is never on screen — the camera follows the newest writing, and this is always out of its frame. ` +
      'Write less beside it, or give it a line of its own.',
  );

/** The first plan's gate, as the class reported it, in the gate's order. */
const FIRST_PLAN: GateProblem[] = [
  real('one-page', 'b3', 'Beat "b3": the line "Once food is fully digested, it must pass through the intest" draws on two pages at once, and the camera shows one. Split what that line writes between two lines.'),
  OFF_CAMERA('Structure of an Intestinal Villus'),
  OFF_CAMERA('Life Processes › Nutrition › Villi & Absorption'),
  real('on-camera', 'villus_structure', 'Beat "villus_structure": the image is never on screen — the camera follows the newest writing, and this is always out of its frame. Write less beside it, or give it a line of its own.'),
  OFF_CAMERA('Microvilli'),
  OFF_CAMERA('Single-cell'),
  OFF_CAMERA('epithelium'),
  OFF_CAMERA('Blood'),
  OFF_CAMERA('capillaries'),
  OFF_CAMERA('Lacteal'),
  real('page-full', 'b4', 'Beat "b4": the class leaves this page 53% written on, and a page must be at least 60%.'),
  real('page-full', 'b5', 'Beat "b5": the class leaves this page 44% written on, and a page must be at least 60%.'),
  real('phone-readable', 'b1', 'Beat "b1": on a phone, "chyme enters" is 11.3px.'),
  real('phone-readable', 'b2', 'Beat "b2": on a phone, "Final breakdown products" is 10.9px.'),
];

describe('oncePerBeat', () => {
  it('names each kind of problem once a beat, saying how many more there are', () => {
    const sent = oncePerBeat(FIRST_PLAN);
    expect(sent.filter((m) => m.includes('is never on screen') && m.startsWith('Beat "b3"'))).toEqual([
      `${OFF_CAMERA('Structure of an Intestinal Villus').message} (And 7 more like it in this beat.)`,
    ]);
    expect(sent).toContain(FIRST_PLAN[3].message);
  });

  it('leaves room in the ten for the half-empty pages and the lines too small on a phone', () => {
    const ten = oncePerBeat(FIRST_PLAN).slice(0, 10);
    for (const p of FIRST_PLAN.filter((x) => x.rule === 'page-full' || x.rule === 'phone-readable')) {
      expect(ten).toContain(p.message);
    }
  });
});

describe('the repair of a composed class', () => {
  it('is told about every half-empty page, and what each one needs', async () => {
    const asked: string[] = [];
    const planner: LlmAdapter = {
      complete: async (_system: string, user: string) => {
        asked.push(user);
        return JSON.stringify(SMALL_INTESTINE);
      },
    };
    const artist: LlmAdapter = { complete: async () => '' };
    await prepareClass({ topic: 'Small intestine', klass: 10, planner, artist, composed: true });
    const repair = asked.find((u) => u.includes('written on'));
    expect(repair).toBeDefined();
    for (const beat of ['b3', 'b4', 'b5']) expect(repair).toMatch(new RegExp(`Beat \\\\?"${beat}\\\\?": the class leaves this page`));
    expect(repair).toMatch(/The column beside the comparison has nothing in it/);
  });
});
