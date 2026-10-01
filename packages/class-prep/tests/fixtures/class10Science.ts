import type { Blueprint } from '../../src/types';

/**
 * THREE CLASS 10 SCIENCE PLANS, SHAPED LIKE THE ONES THE KEEP GATE REFUSED.
 *
 * Re-prepared through the live relay on 2026-10-01 (tools/prewarm, state file
 * tools/prewarm/state/class10-science.json): every one produced a full class
 * for Rs 10-12 and none was kept. Only the issues were recorded, not the
 * plans, so these are rebuilt from what the issues name — the beat ids, the
 * element ids that overlapped, the moment that asked — around the prompt's own
 * four-step opening, which every plan of that run followed:
 *
 *   respiration     a scene in b3 whose connector label (`b3_7_label`) landed
 *                   on `b3__dough_bowl`, and a repair call that hit Vertex's 429;
 *   transportation  an opening scene in b1 whose connector label (`b1_6_label`)
 *                   landed on `b1__food_air`;
 *   excretion       an opening whose context question is held on `b1_3` and
 *                   claims no outcome, plus a kidney picture with five names.
 *
 * The outcome ids are this file's own: the map's real Class 10 ids are not
 * needed to reproduce any of the three.
 */

export const RESPIRATION_OUTCOMES = [
  'sci10-lp-respiration-aerobic',
  'sci10-lp-respiration-anaerobic',
  'sci10-lp-respiration-energy',
] as const;

export const TRANSPORTATION_OUTCOMES = [
  'sci10-lp-blood-carries',
  'sci10-lp-heart-chambers',
  'sci10-lp-double-circulation',
] as const;

export const EXCRETION_OUTCOMES = [
  'sci10-lp-excretion-meaning',
  'sci10-lp-kidney-filters',
  'sci10-lp-nephron-reabsorbs',
] as const;

export const asOutcomes = (ids: readonly string[]) => ids.map((id) => ({ id, statement: `the outcome ${id}` }));

/** The prompt's opening: hello, a real question from the student's own life, then what today builds. */
const opening = (title: string, question: string, expect: string, hint: string, today: string) =>
  ({
    id: 'b1',
    topic: 'Opening',
    narration: '',
    board: [
      { do: 'title', text: title },
      { do: 'say', text: 'Hello! What is up — ready?' },
      { do: 'say', text: 'Before anything else, think about your own day.' },
      { do: 'say', text: 'Here is my question.' },
      { do: 'ask', question, expect, hint },
      { do: 'say', text: today },
    ],
  }) as Blueprint['beats'][number];

export const respiration = (): Blueprint => ({
  id: 'respiration-class10',
  title: 'Respiration',
  visuals: [],
  beats: [
    opening(
      'Respiration',
      'Why do you think you breathe so hard after running up the stairs?',
      'The body needs more oxygen to release more energy.',
      'What were your legs using up as they climbed?',
      'Exactly that — today we find out what your cells do with the air.',
    ),
    {
      id: 'b2',
      topic: 'Aerobic respiration',
      narration: '',
      board: [
        { do: 'say', text: 'With plenty of oxygen, a cell breaks glucose down completely.' },
        { do: 'card', as: 'banner', heading: 'Aerobic respiration', body: 'Glucose broken down using oxygen' },
        { do: 'say', text: 'That releases a lot of energy.' },
        { do: 'write', text: 'Glucose and oxygen give carbon dioxide, water and energy' },
      ],
      teaches: ['sci10-lp-respiration-aerobic'],
    },
    {
      id: 'b3',
      topic: 'Anaerobic respiration in yeast',
      narration: '',
      // On the layout engine of 2026-10-01 this board puts `b3_7_label` on
      // `b3__dough_bowl` — the very pair the keep gate named that day.
      board: [
        { do: 'title', text: 'Anaerobic respiration in yeast' },
        { do: 'say', text: 'Yeast lives in the dough.' },
        { do: 'place', id: 'yeast', noun: 'yeast', label: 'yeast cells' },
        { do: 'place', id: 'dough_bowl', noun: 'bowl', label: 'dough bowl' },
        { do: 'place', id: 'sugar', noun: 'sugar', label: 'sugar (glucose)' },
        { do: 'say', text: 'Without oxygen yeast breaks sugar.' },
        { do: 'say', text: 'Watch what comes out.' },
        { do: 'connect', from: 'yeast', to: 'sugar', label: 'releases carbon dioxide gas' },
        { do: 'say', text: 'This is fermentation.' },
        { do: 'write', text: 'Glucose -> ethanol + carbon dioxide + energy' },
        { do: 'write', text: 'No oxygen is used: anaerobic respiration' },
      ],
      teaches: ['sci10-lp-respiration-anaerobic'],
    },
    {
      id: 'b4',
      topic: 'Which is which',
      narration: '',
      board: [
        { do: 'say', text: 'Think about the bread dough rising.' },
        {
          do: 'ask',
          question: 'Why does bread dough rise when yeast is mixed into it?',
          expect: 'The yeast releases carbon dioxide gas, which puffs the dough up.',
          hint: 'What gas did the yeast give off?',
        },
        { do: 'say', text: 'Yes — the gas makes the bubbles.' },
        { do: 'write', text: 'Carbon dioxide bubbles make the dough rise' },
      ],
      checks: ['sci10-lp-respiration-anaerobic'],
    },
  ],
});

/**
 * A one-moment beat that teaches and checks the same outcome — what the
 * validator turns down as "is both taught and checked in the same beat", the
 * commonest reason a first plan of this run went to repair (seven of the
 * topics in class10-science.json).
 */
const taughtAndChecked = (id: string, question: string, outcome: string) =>
  ({
    id,
    topic: 'Quick check',
    narration: 'One quick check before we go on.',
    board: [{ do: 'ask', question, expect: 'A short answer.', hint: 'Look back at the board.' }],
    teaches: [outcome],
    checks: [outcome],
  }) as Blueprint['beats'][number];

/** Respiration as a first plan the validator turns down. */
export const respirationFirstPlan = (): Blueprint => {
  const plan = respiration();
  plan.beats.push(
    taughtAndChecked('b5', 'What does a cell need to break glucose down completely?', 'sci10-lp-respiration-aerobic'),
  );
  return plan;
};

export const transportation = (): Blueprint => ({
  id: 'transportation-class10',
  title: 'Transportation in Human Beings',
  visuals: [],
  beats: [
    {
      id: 'b1',
      topic: 'Opening',
      narration: '',
      // On the layout engine of 2026-10-01 this board puts `b1_6_label` on
      // `b1__food_air` — the very pair the keep gate named that day.
      board: [
        { do: 'title', text: 'Transportation in Human Beings' },
        { do: 'say', text: 'Hello! What is up, ready?' },
        { do: 'place', id: 'food', noun: 'food', label: 'breakfast' },
        { do: 'place', id: 'food_air', noun: 'air', label: 'food and air' },
        { do: 'place', id: 'toe', noun: 'foot', label: 'your toe' },
        { do: 'say', text: 'You ate breakfast and you are breathing right now.' },
        { do: 'connect', from: 'food', to: 'toe', label: 'carried by blood to the toe' },
        { do: 'say', text: 'This is what today is about.' },
        { do: 'write', text: 'Food -> stomach -> blood -> every body cells' },
        { do: 'write', text: 'Oxygen goes the same way: through blood.' },
        { do: 'say', text: 'Here is my question.' },
        {
          do: 'ask',
          question: 'How do you think the food you ate reaches the tip of your toe?',
          expect: 'Something inside the body carries it, like the blood.',
          hint: 'What flows through every part of your body?',
        },
        { do: 'say', text: 'Good thinking — today we follow the blood that carries it.' },
      ],
    },
    {
      id: 'b2',
      topic: 'Blood carries',
      narration: '',
      board: [
        { do: 'say', text: 'Blood is the body’s delivery system.' },
        { do: 'write', text: 'Blood carries food, oxygen and wastes' },
        { do: 'say', text: 'Plasma carries food and wastes; red blood cells carry oxygen.' },
        { do: 'write', text: 'Red blood cells carry oxygen' },
      ],
      teaches: ['sci10-lp-blood-carries'],
    },
    {
      id: 'b3',
      topic: 'Check',
      narration: '',
      board: [
        { do: 'say', text: 'Let us check that.' },
        {
          do: 'ask',
          question: 'Which part of the blood carries oxygen?',
          expect: 'The red blood cells.',
          hint: 'Think of the cells that give blood its colour.',
        },
        { do: 'say', text: 'Yes, the red blood cells.' },
        { do: 'write', text: 'Haemoglobin in red blood cells holds oxygen' },
      ],
      checks: ['sci10-lp-blood-carries'],
    },
  ],
});

/** The kidney picture's parts, as the eyes might report them: all on the left, listed bottom-first. */
export const KIDNEY_PARTS = {
  ureter: { x: 0.1, y: 0.85, w: 0.1, h: 0.1 },
  'renal artery': { x: 0.1, y: 0.35, w: 0.1, h: 0.08 },
  'renal vein': { x: 0.15, y: 0.45, w: 0.1, h: 0.08 },
  cortex: { x: 0.05, y: 0.15, w: 0.15, h: 0.1 },
  medulla: { x: 0.2, y: 0.6, w: 0.15, h: 0.1 },
};

export const excretion = (): Blueprint => ({
  id: 'excretion-class10',
  title: 'Excretion in Human Beings',
  visuals: [
    {
      id: 'kidney_pic',
      medium: 'picture',
      parts: Object.keys(KIDNEY_PARTS),
      brief: 'a human kidney cut lengthwise',
      alt: 'a human kidney cut open',
    },
  ],
  beats: [
    opening(
      'Excretion in Human Beings',
      'Where do you think all the extra water you drink on a hot day goes?',
      'Some is sweated out and the rest leaves as urine.',
      'What happens a little while after you drink a lot?',
      'Good — today we follow that water into the kidneys.',
    ),
    {
      id: 'b2',
      topic: 'The kidney',
      narration: '',
      board: [
        { do: 'picture', ref: 'kidney_pic' },
        { do: 'say', text: 'This is a kidney, cut open.' },
        { do: 'label', target: 'kidney_pic#ureter', text: 'Ureter' },
        { do: 'label', target: 'kidney_pic#renal artery', text: 'Renal artery' },
        { do: 'label', target: 'kidney_pic#renal vein', text: 'Renal vein' },
        { do: 'label', target: 'kidney_pic#cortex', text: 'Cortex' },
        { do: 'label', target: 'kidney_pic#medulla', text: 'Medulla' },
        { do: 'write', text: 'Each kidney filters about 180 litres of blood a day' },
        { do: 'write', text: 'Urine leaves through the ureter' },
      ],
      teaches: ['sci10-lp-kidney-filters'],
    },
    {
      id: 'b3',
      topic: 'Filtering',
      narration: '',
      board: [
        { do: 'say', text: 'Inside are tiny filtering units called nephrons.' },
        { do: 'write', text: 'The nephron is the filtering unit' },
        { do: 'say', text: 'Think about what the body cannot afford to lose.' },
        {
          do: 'ask',
          question: 'What useful thing do you think the nephron sends back into the blood?',
          expect: 'Glucose, and some of the water.',
          hint: 'What sugar does every cell need?',
        },
        { do: 'say', text: 'Right — glucose and some water go back.' },
        { do: 'write', text: 'Glucose and some water are reabsorbed' },
      ],
      checks: ['sci10-lp-kidney-filters'],
    },
    {
      id: 'b4',
      topic: 'Recap',
      narration: '',
      board: [
        { do: 'say', text: 'So the kidneys clean the blood and keep what is useful.' },
        { do: 'write', text: 'Kidneys remove wastes and keep what is useful' },
      ],
      teaches: ['sci10-lp-nephron-reabsorbs'],
    },
  ],
});

/**
 * Excretion as a first plan the validator turns down — a beat that teaches the
 * very outcome it checks (the run's own first-plan reason:
 * "sci10-lp-kidney-filters is both taught and checked in the same beat") — AND
 * carrying a keep-gate problem besides: a teaching ask in b4 that claims no
 * outcome.
 */
export const excretionFirstPlan = (): Blueprint => {
  const plan = excretion();
  plan.beats.push(taughtAndChecked('b5', 'Which organ filters the blood?', 'sci10-lp-kidney-filters'));
  const b4 = plan.beats.find((b) => b.id === 'b4')!;
  b4.board = [
    ...b4.board,
    { do: 'say', text: 'One more.' },
    {
      do: 'ask',
      question: 'Which tube carries urine from the kidney to the bladder?',
      expect: 'The ureter.',
      hint: 'It was named on the picture.',
    },
    { do: 'say', text: 'The ureter.' },
  ];
  return plan;
};
