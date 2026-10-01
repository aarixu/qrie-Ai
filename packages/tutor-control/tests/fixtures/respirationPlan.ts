import type { TeachingPlan } from '../../src/index';

/**
 * A SMALL TEACHING PLAN FOR THE CONDUCTOR'S TESTS — two ideas of Class 10
 * Respiration, written for the tests, not the plan the lab will teach from.
 *
 * Shaped so every branch has something to run on: `idea-what` has a
 * prediction and `idea-oxygen` has none; `q-where` has a misconception, a
 * worked example and two alternates (the whole ladder); `q-gas` has no worked
 * example (L5 skipped); `idea-what` has three checks (two retests available:
 * `c-hungry` on `resp.site` and `resp.definition`, `c-name` on
 * `resp.definition`, so a missed `q-where` or `c-release` has a retest on its
 * own node and a missed `q-gas`, on `resp.products`, has none), `idea-oxygen`
 * two. No hint, follow-up, reason, alternate or worked step gives away its
 * question's answer, and no point states its own quick question's answer.
 */
export const PLAN: TeachingPlan = {
  formatVersion: 1,
  id: 'class10-science-life-processes-respiration',
  topicRef: 'class10.science.life-processes.respiration',
  title: 'Respiration',
  klass: 10,
  subject: 'science',
  boardLessonId: 'class10-respiration',
  minutes: 20,
  opener: {
    id: 'opener',
    question: 'After a fast run, why do you think you breathe so hard?',
    expect: 'the body needs more oxygen',
    answer: 'Your muscles need more oxygen to release energy',
    why: 'Running muscles use energy fast, and cells need oxygen to release it.',
    hint: 'What are your leg muscles doing while you run?',
    misconceptions: [],
    alternates: [{ mode: 'everyday', say: 'Think of how a fire burns brighter when you blow air on it.' }],
    nodeIds: ['resp.aerobic'],
  },
  ideas: [
    {
      id: 'idea-what',
      title: 'What respiration is',
      nodeIds: ['resp.definition', 'resp.site'],
      board: { beatId: 'b1', focus: ['e1'] },
      predict: {
        id: 'predict-plants',
        question: 'Do you think a plant respires at night?',
        expect: 'yes',
        answer: 'Yes, plants respire all the time',
        why: 'Every living cell needs energy, day and night.',
        hint: 'Does a plant stop living when the sun sets?',
        misconceptions: [
          {
            id: 'plants-only-photosynthesise',
            soundsLike: 'no, plants only make food',
            why: 'Plants make food in light, but they still need energy from it at every hour.',
            followUp: 'Where does a plant get energy from at night?',
          },
        ],
        alternates: [{ mode: 'everyday', say: 'A plant is alive at midnight just as you are.' }],
        nodeIds: ['resp.definition'],
      },
      points: [
        {
          id: 'p-what',
          say: 'Respiration is how cells break down food to release energy.',
          ask: {
            id: 'q-where',
            question: 'Where in your body does respiration happen?',
            expect: 'in every cell',
            answer: 'In every living cell',
            why: 'Every cell needs its own energy, so each one respires.',
            hint: 'Which parts of your body need energy?',
            misconceptions: [
              {
                id: 'breathing-is-respiration',
                soundsLike: 'in the lungs',
                why: 'The lungs only move air in and out; that is breathing.',
                followUp: 'What do you think the lungs actually do with the air?',
              },
            ],
            alternates: [
              { mode: 'analogy', say: 'Think of each cell as a tiny kitchen that cooks its own meal.' },
              { mode: 'everyday', say: 'Your fingers and toes need energy too, not just your chest.' },
            ],
            workedExample: {
              steps: [{ say: 'Take a leaf: it respires even though it has no lungs.', line: 'leaf: no lungs, still respires' }],
            },
            nodeIds: ['resp.site'],
          },
        },
        {
          id: 'p-waste',
          say: 'When cells break glucose down using oxygen, a waste gas and water are left over.',
          ask: {
            id: 'q-gas',
            question: 'Which waste gas do you breathe out because of respiration?',
            expect: 'carbon dioxide',
            answer: 'Carbon dioxide',
            why: 'Breaking glucose down with oxygen leaves carbon dioxide behind.',
            hint: 'What gas turns limewater milky?',
            misconceptions: [
              {
                id: 'oxygen-out',
                soundsLike: 'oxygen',
                why: 'We breathe oxygen in, and the cells use it up.',
                followUp: 'Where does the oxygen you breathe in go?',
              },
            ],
            alternates: [{ mode: 'visual', say: 'Picture the air you breathe out bubbling through limewater until it turns cloudy.' }],
            nodeIds: ['resp.products'],
          },
        },
      ],
      check: [
        {
          id: 'c-release',
          question: 'What does respiration release from food?',
          expect: 'energy',
          answer: 'Energy',
          why: 'Cells break food down to get energy for everything they do.',
          hint: 'Why do you feel weak when you have not eaten?',
          misconceptions: [
            {
              id: 'breathing-is-respiration',
              soundsLike: 'air',
              why: 'Air is what we breathe; respiration happens to food inside cells.',
              followUp: 'What do you think your cells do with the food you eat?',
            },
          ],
          alternates: [{ mode: 'everyday', say: 'Think about why a phone must be charged before it works.' }],
          workedExample: { steps: [{ say: 'A car burns petrol, and that is what makes it move.', line: 'petrol burnt, car moves' }] },
          nodeIds: ['resp.definition'],
        },
        {
          id: 'c-hungry',
          question: 'After an hour of football you feel hungry. Where in your body was the food used up?',
          expect: 'in the muscle cells',
          answer: 'In the cells of your muscles',
          why: 'Respiring muscle cells burn through food, so the body asks for more.',
          hint: 'Which parts of you were working hardest the whole match?',
          misconceptions: [],
          alternates: [{ mode: 'analogy', say: 'A car that drives all day needs a full tank again.' }],
          nodeIds: ['resp.site', 'resp.definition'],
        },
        {
          id: 'c-name',
          question: 'Name one thing respiration gives your body.',
          expect: 'energy',
          answer: 'Energy',
          why: 'Respiration releases the energy stored in food.',
          hint: 'What do you run out of when you are tired?',
          misconceptions: [],
          alternates: [{ mode: 'everyday', say: 'Think of the battery bar on a phone.' }],
          nodeIds: ['resp.definition'],
        },
      ],
      teachBack: {
        prompt: 'Explain to me in your own words what respiration is.',
        expect: 'cells break down food using oxygen to release energy',
      },
    },
    {
      id: 'idea-oxygen',
      title: 'With and without oxygen',
      nodeIds: ['resp.anaerobic'],
      board: { beatId: 'b2' },
      points: [
        {
          id: 'p-short',
          say: 'When there is not enough oxygen, cells can still break glucose down, but only part of the way, and they get much less energy.',
          ask: {
            id: 'q-sprint',
            question: 'What builds up in your leg muscles during a hard sprint?',
            expect: 'lactic acid',
            answer: 'Lactic acid',
            why: 'Without enough oxygen, muscles make lactic acid, and it makes them ache.',
            hint: 'What makes your legs feel sore and heavy after sprinting?',
            misconceptions: [],
            alternates: [
              { mode: 'steps', say: 'First the oxygen runs short, then the muscle takes a shortcut, then something sour is left behind.' },
            ],
            nodeIds: ['resp.anaerobic'],
          },
        },
      ],
      check: [
        {
          id: 'c-aerobic',
          question: 'What do we call respiration that uses oxygen?',
          expect: 'aerobic respiration',
          answer: 'Aerobic respiration',
          why: 'Aerobic means with air, and it is the kind that uses oxygen.',
          hint: 'What word for "with air" do scientists use?',
          misconceptions: [
            {
              id: 'anaerobic-mixup',
              soundsLike: 'anaerobic',
              why: 'An- means without, so that one runs without oxygen.',
              followUp: 'What do you think the "an" at the start of a word means?',
            },
          ],
          alternates: [{ mode: 'everyday', say: 'Think of the name of the exercise class where you keep breathing steadily.' }],
          nodeIds: ['resp.anaerobic'],
        },
        {
          id: 'c-yeast',
          question: 'Which kind of respiration happens in yeast when there is no air?',
          expect: 'anaerobic respiration',
          answer: 'Anaerobic respiration',
          why: 'With no air, yeast breaks sugar down without oxygen.',
          hint: 'What do we call the kind that works without oxygen?',
          misconceptions: [],
          alternates: [{ mode: 'everyday', say: 'Think of bread dough rising in a closed tin.' }],
          nodeIds: ['resp.anaerobic'],
        },
      ],
      teachBack: {
        prompt: 'Tell me in your own words what changes when oxygen runs short.',
        expect: 'glucose is only partly broken down, so less energy is released and lactic acid forms',
      },
    },
  ],
  recap: {
    prompts: [
      'Tell me one thing you remember about where respiration happens.',
      'What happens in your muscles when oxygen runs short?',
    ],
  },
  facts: [
    'Respiration happens in every living cell.',
    'Aerobic respiration uses oxygen and releases carbon dioxide and water.',
    'Without enough oxygen, muscle cells make lactic acid.',
  ],
  sources: ['NCERT Class 10 Science, Chapter 5 Life Processes, section 5.3 Respiration'],
};

/** A deep copy of `PLAN`, for tests that break one thing in it. */
export function planCopy(): TeachingPlan {
  return JSON.parse(JSON.stringify(PLAN)) as TeachingPlan;
}
