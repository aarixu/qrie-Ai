import type { Blueprint } from '../../src/types';

/**
 * THE FIRST MATHS CLASS EVER PREPARED, as the plan that made it.
 *
 * `class10-mathematics/pair-of-linear-equations-in-two-variables/substitution-method`,
 * prepared 2026-09-28 against the production relay (state-of-play, "Proven on
 * 2026-09-28"). Only the LESSON was saved, not the blueprint, so this is the
 * blueprint rebuilt from it: every element id in that lesson is
 * `<beat>_<index of the instruction that drew it>`, so the ids pin each
 * instruction's kind and position, and the texts are copied verbatim.
 *
 * It is the REPAIRED plan — the one that was taught — so it still carries the
 * repair's extra `write` of each question (b1_9, b2_8, b3_10, b4_4), which is
 * one of the defects under test. No beat carried `teaches` or `checks`.
 *
 * `clean()` below is the same class the way a fixed planner would write it:
 * no extra question, notation said in words, and the answer ink after a line
 * that follows the ask. It exists so a test can tell "the gate catches the
 * defect" apart from "the gate refuses everything".
 */
export const substitutionAsTaught = (): Blueprint => ({
  id: 'substitution-method-class10',
  title: 'Substitution Method',
  subtitle: 'Pair of Linear Equations in Two Variables',
  visuals: [],
  beats: [
    {
      id: 'b1',
      topic: 'The shop puzzle',
      narration: '',
      board: [
        { do: 'title', text: 'Substitution Method' },
        { do: 'say', text: 'Imagine you walk into a stationery shop to buy a pen and a notebook.' },
        { do: 'place', id: 'pen', noun: 'pen', label: '1 Pen (x)' },
        { do: 'place', id: 'book', noun: 'book', label: '1 Notebook (y)' },
        { do: 'say', text: 'Together, they cost 50 rupees.' },
        { do: 'equation', text: 'x + y = 50' },
        {
          do: 'say',
          text: 'Now, the shopkeeper tells you one extra detail: the notebook costs exactly 30 rupees more than the pen.',
        },
        { do: 'equation', text: 'y = x + 30' },
        { do: 'say', text: 'How could you use that fact to find the cost of just the pen without guessing?' },
        { do: 'write', text: 'How can we use y = x + 30 to solve for x?' },
        {
          do: 'ask',
          question: "If y is equal to x + 30, what can you do with the 'y' in the first equation?",
          expect: 'Replace y in the first equation with x + 30 so there is only one variable left.',
          hint: 'Look at the first equation x + y = 50. What if you wrote (x + 30) wherever you see y?',
        },
        { do: 'write', text: 'Substitution means replacing a variable with its equivalent expression.' },
      ],
    },
    {
      id: 'b2',
      topic: 'Step 1: express one variable',
      narration: '',
      board: [
        { do: 'title', text: 'Step 1: Express One Variable' },
        { do: 'say', text: 'Let us take a standard textbook pair of linear equations.' },
        { do: 'equation', text: '7x - 15y = 2  ... (Equation 1)' },
        { do: 'equation', text: 'x + 2y = 3      ... (Equation 2)' },
        { do: 'say', text: 'Look closely at both equations. We want to isolate one variable completely on one side.' },
        {
          do: 'say',
          text: 'In equation 2, x has a coefficient of 1, which makes it much easier to isolate without dealing with fractions right away.',
        },
        { do: 'write', text: 'From (2): x = 3 - 2y  ... (Equation 3)' },
        { do: 'say', text: 'Now, where must we substitute this expression for x?' },
        { do: 'write', text: 'Which equation should we substitute x into?' },
        {
          do: 'ask',
          question: 'Should we substitute x = 3 - 2y back into Equation 2 or into Equation 1?',
          expect: 'Equation 1, because putting it back into Equation 2 will just give 3 = 3.',
          hint: 'If you got the expression from Equation 2, what happens if you plug it right back into the same equation?',
        },
        {
          do: 'card',
          heading: 'Golden Rule of Substitution',
          body: 'Always substitute the expression into the OTHER equation, never the one you created it from.',
        },
      ],
    },
    {
      id: 'b3',
      topic: 'Steps 2 and 3: substitute and solve',
      narration: '',
      board: [
        { do: 'title', text: 'Step 2 & 3: Substitute and Solve' },
        { do: 'say', text: 'Let us substitute x = (3 - 2y) into Equation 1: 7x - 15y = 2.' },
        { do: 'equation', text: '7(3 - 2y) - 15y = 2' },
        { do: 'say', text: 'Now expand the bracket carefully by multiplying 7 with both terms inside.' },
        { do: 'equation', text: '21 - 14y - 15y = 2' },
        { do: 'say', text: 'Combine the like terms: minus 14y and minus 15y give minus 29y.' },
        { do: 'equation', text: '21 - 29y = 2' },
        { do: 'equation', text: '-29y = 2 - 21 = -19' },
        { do: 'write', text: 'y = 19 / 29' },
        { do: 'say', text: 'We have found our first value! What is our final step to find x?' },
        { do: 'write', text: 'How do we find x once y is known?' },
        {
          do: 'ask',
          question: 'How do we find the value of x now that we know y = 19/29?',
          expect: 'Substitute y = 19/29 back into the expression x = 3 - 2y.',
          hint: 'Remember Equation 3, where x was already written in terms of y?',
        },
        { do: 'equation', text: 'x = 3 - 2(19/29) = (87 - 38)/29 = 49 / 29' },
        { do: 'write', text: 'Solution: x = 49/29, y = 19/29' },
      ],
    },
    {
      id: 'b4',
      topic: 'The whole method',
      narration: '',
      board: [
        { do: 'title', text: 'The Complete Substitution Algorithm' },
        { do: 'say', text: 'Every substitution problem follows the exact same four systematic steps.' },
        {
          do: 'list',
          heading: '4 Steps of Substitution Method',
          items: [
            {
              term: '1. Express',
              meaning: 'Pick the simpler equation and write one variable in terms of the other (e.g. x in terms of y).',
            },
            { term: '2. Substitute', meaning: 'Substitute this value into the OTHER equation to get a single linear equation.' },
            { term: '3. Solve', meaning: 'Solve for the single variable.' },
            {
              term: '4. Back-Substitute',
              meaning: 'Put the obtained value into the rearranged equation to find the second variable.',
            },
          ],
        },
        {
          do: 'say',
          text: 'Before you finish your exam answer, how can you be completely certain your values for x and y are correct?',
        },
        { do: 'write', text: 'How can we verify our solution is 100% correct?' },
        {
          do: 'ask',
          question: 'How do you verify whether a solution (x, y) is correct?',
          expect: 'Plug both values back into the original equations to check if LHS equals RHS in both.',
          hint: 'If you put your numbers back into the very first two equations, what should happen?',
        },
        {
          do: 'card',
          heading: 'Always Check Both Equations',
          body: 'LHS = RHS in Equation 1 AND Equation 2 confirms the solution 100%.',
        },
      ],
    },
  ],
});

/**
 * The four outcome ids the Class 10 maths map files under this topic, copied
 * from packages/knowledge-graph/data/class10-mathematics.json.
 */
const LINEQ = 'class10-mathematics-pair-of-linear-equations-in-two-variables';
export const SUBSTITUTION_OUTCOMES = [
  `${LINEQ}-express-one-variable-in-terms-of-other`,
  `${LINEQ}-solve-by-substitution`,
  `${LINEQ}-verify-solution-algebraically`,
  `${LINEQ}-substitution-degenerate-cases`,
];

/**
 * The same class as a fixed planner writes it: each ask asked once, in words,
 * with the answer after a line that follows it, and `checks` on every beat
 * that asks.
 */
export const substitutionClean = (checks: readonly string[] = []): Blueprint => {
  const plan = substitutionAsTaught();
  const says: Record<string, string> = {
    'Let us substitute x = (3 - 2y) into Equation 1: 7x - 15y = 2.':
      'Let us put three minus two y in place of x, in the first equation.',
  };
  plan.beats = plan.beats.map((beat, n) => {
    const board = beat.board
      // The repair's extra copy of each question goes: the ask writes its own.
      .filter((step) => !(step.do === 'write' && step.text.includes('?')))
      .map((step) => (step.do === 'say' && says[step.text] ? { ...step, text: says[step.text] } : step))
      .map((step) =>
        step.do === 'ask'
          ? { ...step, question: step.question.replace(/ = 3 - 2y| = 19\/29|x \+ 30/g, (m) => (m === 'x + 30' ? 'x plus 30' : '')) }
          : step,
      );
    // A line after the ask, so the answer ink is revealed after the answer.
    const at = board.findIndex((step) => step.do === 'ask');
    board.splice(at + 1, 0, { do: 'say', text: 'Here is how it goes.' });
    return { ...beat, board, ...(checks.length > 0 ? { checks: [checks[n % checks.length]] } : {}) };
  });
  return plan;
};
