import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import { assemble, gateLesson, type Blueprint } from '@ai-tutor/class-prep';

type GateProblem = ReturnType<typeof gateLesson>[number];

/**
 * THE TOOLKIT ON ONE BOARD, AT NO COST: a plan written by hand, run through
 * the same assemble and keep gate a prepared class goes through, with no
 * planner, no reviewer and no picture bought. The canvas lab plays it.
 */
export const TOOLKIT_DEMO: Blueprint = {
  id: 'toolkit-demo',
  title: 'The toolkit',
  visuals: [],
  beats: [
    {
      id: 'b1', topic: 'A process', narration: '',
      board: [
        { do: 'title', text: 'The toolkit' },
        { do: 'say', text: 'Food goes from the mouth to the stomach, then the intestine, and then into the blood.' },
        { do: 'flow', steps: [{ label: 'Mouth' }, { label: 'Stomach' }, { label: 'Intestine' }, { label: 'Blood' }] },
      ],
    },
    {
      id: 'b2', topic: 'Comparing amounts', narration: '',
      board: [
        { do: 'say', text: 'Some animals need far more sleep than others, as these bars show one by one.' },
        { do: 'chart', caption: 'Hours of sleep a day', data: [{ label: 'Cat', value: 13 }, { label: 'Dog', value: 11 }, { label: 'Human', value: 8 }, { label: 'Horse', value: 3 }] },
      ],
    },
    {
      id: 'b3', topic: 'Naming parts', narration: '',
      board: [
        { do: 'newPage' },
        { do: 'say', text: 'A plant has three main parts, and each has its own job to do.' },
        { do: 'list', heading: 'Parts of a plant', items: [{ term: 'Root', meaning: 'takes in water' }, { term: 'Stem', meaning: 'carries it up' }, { term: 'Leaf', meaning: 'makes food' }] },
      ],
    },
    {
      id: 'b4', topic: 'Parts of a whole', narration: '',
      board: [
        { do: 'newPage' },
        { do: 'say', text: 'The air we breathe is mostly nitrogen, about a fifth oxygen, and a tiny bit of other gases.' },
        { do: 'pieChart', slices: [{ label: 'Nitrogen', value: 78 }, { label: 'Oxygen', value: 21 }, { label: 'Other gases', value: 1 }], percent: true, caption: 'Air, by volume' },
      ],
    },
    {
      id: 'b5', topic: 'A measured change', narration: '',
      board: [
        { do: 'newPage' },
        { do: 'say', text: 'On a summer day in Delhi it warms all morning, peaks in the afternoon, then cools.' },
        { do: 'lineChart', labels: ['6 am', '9 am', '12 pm', '3 pm', '6 pm'], series: [{ name: 'Delhi', values: [24, 29, 35, 36, 31] }], yLabel: 'temperature', unit: '°C', caption: 'One summer day' },
      ],
    },
    {
      id: 'b6', topic: 'Solving an equation', narration: '',
      board: [
        { do: 'newPage' },
        {
          do: 'say',
          text: 'To solve two x plus three equals eleven, take the three across, work out eleven minus three, divide by two, and x is four.',
        },
        { do: 'equationMove', steps: ['2x + 3 = 11', '2x = 11 - 3', '2x = 8', 'x = 8/2', 'x = 4'] },
      ],
    },
  ],
};

export function toolkitDemoLesson(): { lesson: Lesson; problems: GateProblem[] } {
  const made = assemble(TOOLKIT_DEMO, new Set());
  const checked = validateLesson(made.lesson);
  if (!checked.ok) throw new Error(`toolkit demo does not validate: ${checked.errors.join('; ')}`);
  const lesson = checked.lesson as Lesson;
  return { lesson, problems: gateLesson(lesson, { bonds: made.bonds, unspoken: made.unspoken, undrawn: made.undrawn }) };
}
