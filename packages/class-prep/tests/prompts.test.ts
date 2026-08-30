import { describe, expect, it } from 'vitest';
import { PLANNER_SYSTEM } from '../src/prompts';

/**
 * The planner was being told two opposite things about writing.
 *
 * "Write generously… the two or three sentences that matter written up beside
 * it" in one section, and "Slow — at most one per beat, two per lesson" in the
 * instruction list. The cap is the sentence next to the instruction itself, so
 * the cap won, and boards came back with the parts named and not one word of
 * what she had actually said about them.
 */

describe('what the planner is told about writing key points', () => {
  it('does not cap her at one written line a beat', () => {
    expect(PLANNER_SYSTEM).not.toContain('at most one per beat');
    expect(PLANNER_SYSTEM).not.toContain('two per lesson');
  });

  it('asks for every key point she says out loud to be written on the board', () => {
    expect(PLANNER_SYSTEM).toMatch(/every key point you say out loud gets written/i);
  });

  it('says how many is normal, so "generously" is not left to be guessed at', () => {
    expect(PLANNER_SYSTEM).toMatch(/two to four .*(a|per) beat/i);
  });

  it('still keeps writing apart from naming a part', () => {
    // A label names a PART and has a line to it; a write is a key point that
    // belongs to no single part. Collapsing the two would put "the right side
    // handles used blood" in a margin with a line pointing at one chamber.
    expect(PLANNER_SYSTEM).toContain('names a PART');
    expect(PLANNER_SYSTEM).toContain('belongs to no single part');
  });
});

describe('what a name in the margin is allowed to be', () => {
  // Live boards came back with "Right Atrium: collects used blood" written in
  // a margin two hundred units wide. It wraps to three lines, the side shrinks
  // to fit them all, and the names end up smaller than the key points that are
  // supposed to be secondary to them. The explanation is a key point; the
  // margin holds the NAME.
  it('asks for a name in the margin, not a sentence', () => {
    expect(PLANNER_SYSTEM).toMatch(/the text is the part's NAME/i);
    expect(PLANNER_SYSTEM).toMatch(/three or four words/i);
  });
});
