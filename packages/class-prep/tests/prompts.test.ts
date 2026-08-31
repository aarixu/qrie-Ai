import { describe, expect, it } from 'vitest';
import { ARTIST_SYSTEM, PLANNER_SYSTEM, plannerUser } from '../src/prompts';

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
    expect(PLANNER_SYSTEM).toMatch(/the part's NAME AND NOTHING ELSE/i);
    expect(PLANNER_SYSTEM).toMatch(/two or three words/i);
    // And it must show where the meaning goes instead, or the model has been
    // told what not to do and nothing about what to do.
    expect(PLANNER_SYSTEM).toMatch(/WHAT EACH PART DOES GOES IN A LIST/i);
  });
});

describe('the board is meant to read like a page of notes', () => {
  /**
   * Aarav sent a photograph of a handwritten Class 10 notes page and set it as
   * the bar: everything defined, key points written, the diagram properly
   * labelled. The prompt was pulling the other way — it told the planner that
   * a board with four ideas on it is a board nobody reads.
   */
  it('offers a list, with a term and its meaning', () => {
    expect(PLANNER_SYSTEM).toContain('"do":"list"');
    expect(PLANNER_SYSTEM).toMatch(/term/);
    expect(PLANNER_SYSTEM).toMatch(/meaning/);
  });

  it('no longer tells the planner to keep a board to one idea', () => {
    expect(PLANNER_SYSTEM).not.toContain('ONE main thing');
    expect(PLANNER_SYSTEM).not.toContain('a board nobody reads');
  });

  it('asks for anything named out loud to be defined in writing', () => {
    expect(PLANNER_SYSTEM).toMatch(/name .*gets .*written|define .*in writing/i);
  });

  it('does not cap a lesson at four beats any more', () => {
    // Everything defined needs room. The board is endless; pages are cheap.
    expect(PLANNER_SYSTEM).not.toContain('TWO TO FOUR beats');
  });
});

describe('a board with a picture and two names on it is not a taught board', () => {
  /**
   * A real class on the human eye produced exactly that: the eye drawn,
   * "Cornea" and "Iris" written beside it, and two thirds of the board empty.
   * Everything the tutor said about them was said and never written.
   */
  it('requires the parts to be written out wherever they are named', () => {
    expect(PLANNER_SYSTEM).toMatch(/every beat that shows a picture/i);
  });

  it('refuses a board that is mostly empty', () => {
    expect(PLANNER_SYSTEM).toMatch(/empty board|mostly empty|two thirds of it empty/i);
  });

  it('asks for depth, not just naming', () => {
    expect(PLANNER_SYSTEM).toMatch(/WHY|what it is FOR|not just what/i);
  });
});

describe('how many pictures a lesson may have', () => {
  /**
   * "At most TWO visuals in a lesson" was written when a lesson was two to four
   * beats and every picture cost thirty seconds. A real class on animal tissues
   * then covered epithelial, connective, muscular and nervous tissue with ONE
   * illustration between them.
   */
  it('no longer caps a whole lesson at two pictures', () => {
    expect(PLANNER_SYSTEM).not.toContain('At most TWO visuals');
  });

  it('ties a picture to the thing it shows, not to a budget', () => {
    expect(PLANNER_SYSTEM).toMatch(/its own picture|a picture of its own|each .*gets a picture/i);
  });
});

describe('what the artist knows about motion', () => {
  it('offers the four motions instead of banning classes outright', () => {
    expect(ARTIST_SYSTEM).not.toContain('no CSS classes');
    for (const m of ['curie-drift', 'curie-flow', 'curie-pulse', 'curie-sway']) {
      expect(ARTIST_SYSTEM).toContain(m);
    }
  });

  it('still refuses a stylesheet', () => {
    expect(ARTIST_SYSTEM).toContain('<style>');
  });

  it('says motion is for process, not decoration', () => {
    expect(ARTIST_SYSTEM).toMatch(/only where .*moves|everything wiggles/i);
  });
});

describe('the board shows what is being SAID, not only its summary', () => {
  /**
   * Aarav marked up a real transcript. The pattern across every beat he
   * flagged: the concrete thing she said out loud — the question, the
   * example, the result of the experiment — never reached the board. Only its
   * abstract conclusion did. His rules, in his words, are the spec.
   */
  it('writes the question she asks, and asks the student for the answer', () => {
    expect(PLANNER_SYSTEM).toMatch(/question you ask out loud .*written/i);
  });

  it('draws the example being spoken, not the concept behind it', () => {
    expect(PLANNER_SYSTEM).toMatch(/the EXAMPLE you are speaking about/i);
    expect(PLANNER_SYSTEM).toMatch(/incense|agarbatti/i);
  });

  it('writes what happened — the observation — before the conclusion', () => {
    expect(PLANNER_SYSTEM).toMatch(/what HAPPENED .*written/i);
  });

  it('writes a definition so it stands out, beside a demonstration of it', () => {
    expect(PLANNER_SYSTEM).toMatch(/definition .*banner|banner .*definition/i);
  });

  it('knows the two ways to pull attention: a stroke under, an arrow out', () => {
    expect(PLANNER_SYSTEM).toMatch(/underline .*setup|underline .*attention/i);
    expect(PLANNER_SYSTEM).toMatch(/"do":"sketch"/);
  });
});

describe('the planner knows how to ask and wait', () => {
  it('offers the ask instruction, options carrying their whys and hints', () => {
    expect(PLANNER_SYSTEM).toContain('"do":"ask"');
    expect(PLANNER_SYSTEM).toMatch(/"why"/);
    expect(PLANNER_SYSTEM).toMatch(/"hint"/);
  });

  it('teaches retrieval and prediction, not rhetorical questions', () => {
    expect(PLANNER_SYSTEM).toMatch(/prediction|predict/i);
    expect(PLANNER_SYSTEM).toMatch(/retriev/i);
  });

  it('never congratulates — it asks why', () => {
    // Tanmay's rule, verbatim in spirit: a right answer gets "why is this
    // right", a wrong one gets a hint, never the solution.
    expect(PLANNER_SYSTEM).toMatch(/never .*(correct!|congratulat)/i);
  });
});

describe('the planner is told who is sitting in the class', () => {
  /**
   * The map finally reaches the class. Everything known about the student
   * arrives as plain factual lines — built by the app under the persona's
   * discipline: a signal nobody measured produces NO line, never a default —
   * and the planner is told to teach THIS student, not to recite the dossier.
   */
  it('folds the student lines into the user prompt when they exist', () => {
    const p = plannerUser('The Human Heart', 9, 3, [
      'Her name is Ananya.',
      'She answered wrong on: valves prevent backflow of blood.',
      'She holds securely: the heart has four chambers.',
    ]);
    expect(p).toContain('Ananya');
    expect(p).toContain('valves prevent backflow');
    expect(p).toMatch(/this student/i);
  });

  it('says how to use them: teach to it, never recite it', () => {
    const p = plannerUser('The Human Heart', 9, 3, ['Her name is Ananya.']);
    expect(p).toMatch(/never (recite|read) (this|the) (list|dossier)/i);
    expect(p).toMatch(/name naturally|use the name/i);
  });

  it('adds not a word about students when nothing is known', () => {
    const bare = plannerUser('The Human Heart', 9, 3);
    expect(bare).not.toMatch(/this student/i);
    const empty = plannerUser('The Human Heart', 9, 3, []);
    expect(empty).toBe(bare);
  });
});

describe('the class opens like a person, not a textbook', () => {
  /**
   * Aarav's four steps, in order: talk like a human first, say what today
   * builds, ask what they already know or remember, and anchor the teaching
   * to their answer. And the register throughout is Meera's own — the same
   * tutor the student meets when they raise a hand, not a narrator.
   */
  it('demands the four-step opening, in order', () => {
    const at = (re: RegExp) => {
      const m = re.exec(PLANNER_SYSTEM);
      expect(m, String(re)).not.toBeNull();
      return m!.index;
    };
    const greet = at(/opens? like a person|greeting|namaste/i);
    const today = at(/what today('s| is)? class (builds|is about)/i);
    const recall = at(/what (do you|they) already (know|remember)/i);
    const anchor = at(/anchor/i);
    expect(greet).toBeLessThan(today);
    expect(today).toBeLessThan(recall);
    expect(recall).toBeLessThan(anchor);
  });

  it('makes the recall step a real ask, not a rhetorical one', () => {
    expect(PLANNER_SYSTEM).toMatch(/opening .*"do":"ask"|"do":"ask" .*opening/is);
  });

  it('speaks in her register — warm, spoken, hers', () => {
    expect(PLANNER_SYSTEM).toMatch(/Meera/);
    expect(PLANNER_SYSTEM).toMatch(/short spoken sentences/i);
    // "lecture" appears only ever negated — hers is the voice that refuses it.
    expect(PLANNER_SYSTEM).toMatch(/rather than lectures|never .*lecture/i);
  });
});
