import type { Blueprint } from '../../src/types';

/**
 * THE FIRST REAL COMPOSED CLASS, AS IT CAME BACK (2026-10-06): "Small
 * intestine: digestion and absorption by villi", Class 10, 3 minutes.
 *
 * Beats 3 to 5, rebuilt from the class's board and captions as the canvas lab
 * showed them; the planner's own plan was not kept. Beat 1 stands in for the
 * opening, so beat 3 is held to a full page as it was. Every beat is the way the
 * planner wrote it — one narration and no `say` — and the villus page has no
 * notes beside its picture: the list of its parts came on the next page, a
 * page of writing alone. Its gate: page-full 56%, 53% and 44%; phone-readable
 * on b4 and b5.
 */
export const SMALL_INTESTINE: Blueprint = {
  id: 'small-intestine',
  title: 'Small intestine: digestion and absorption by villi',
  layout: 'composed',
  visuals: [
    {
      id: 'villus_structure',
      medium: 'picture',
      parts: ['microvilli', 'blood capillaries', 'single-cell epithelium', 'central lacteal'],
      brief: 'A single intestinal villus cut lengthwise, showing its capillary network and central lacteal.',
      alt: 'A single intestinal villus with its capillaries and central lacteal',
    },
  ],
  beats: [
    {
      id: 'b1',
      topic: 'The journey of food',
      narration:
        "Hello! What's up — ready? You had lunch a while ago, and your stomach has churned it into a paste. " +
        'Where do you think that paste goes next?',
      board: [
        { do: 'title', text: 'The Journey of Food', path: ['Life Processes', 'Nutrition in Human Beings', 'Small Intestine'] },
        { do: 'place', id: 'stomach', noun: 'stomach', label: 'Stomach' },
        { do: 'place', id: 'intestine', noun: 'intestine', label: 'Small intestine' },
        { do: 'connect', from: 'stomach', to: 'intestine', label: 'chyme enters' },
        {
          do: 'ask',
          question: 'Where do you think that paste goes next?',
          expect: 'Into the small intestine.',
          hint: 'It leaves the stomach through a long coiled tube.',
        },
      ],
    },
    {
      id: 'b3',
      topic: 'Structure of an intestinal villus',
      narration:
        'Once food is dissolved into simple units, it must pass through the intestinal wall into our blood. ' +
        'The inner wall is not a smooth pipe. It is lined with millions of tiny, finger-like projections called villi. ' +
        'Along the outer border, microscopic folds called microvilli enlarge the surface area even further. ' +
        'The outer layer is an epithelium just one cell thick, keeping diffusion distances minimal. ' +
        'Inside each villus runs a rich network of blood capillaries surrounding a central lacteal lymph vessel.',
      board: [
        { do: 'title', text: 'Structure of a Villus', path: ['Life Processes', 'Nutrition', 'Villus Structure'] },
        { do: 'picture', ref: 'villus_structure' },
        { do: 'label', target: 'villus_structure#microvilli', text: 'Microvilli' },
        { do: 'label', target: 'villus_structure#blood capillaries', text: 'Blood capillaries' },
        { do: 'label', target: 'villus_structure#single-cell epithelium', text: 'Single-cell epithelium' },
        { do: 'label', target: 'villus_structure#central lacteal', text: 'Central lacteal' },
        { do: 'write', text: 'Millions of finger-like projections line the inner wall.' },
        { do: 'write', text: 'Each villus contains blood capillaries and a central lymph vessel.' },
        { do: 'summary', text: 'Villi line the small intestine to absorb food' },
      ],
    },
    {
      id: 'b4',
      topic: 'How villi absorb nutrients',
      narration:
        'Every detail of the villus is built specifically for rapid absorption. The finger-like folds and ' +
        'microvilli expand the total surface area by hundreds of times, giving nutrients massive space to diffuse. ' +
        'Because the epithelium is only one cell thick, nutrients pass through almost instantly. Water-soluble ' +
        'nutrients like glucose and amino acids go straight into the blood capillaries, while fatty acids enter ' +
        'the lacteal. Because blood constantly circulates, absorbed nutrients are carried away immediately to ' +
        'nourish all body cells.',
      board: [
        { do: 'title', text: 'Adaptations for Absorption', path: ['Life Processes', 'Nutrition', 'Absorption'] },
        {
          do: 'list',
          heading: 'How each part aids absorption',
          items: [
            { term: 'Finger-like folds', meaning: 'massively increase inner surface area for rapid diffusion' },
            { term: 'Thin epithelium', meaning: 'one cell thick so nutrients cross a minimal distance' },
            { term: 'Blood capillaries', meaning: 'absorb glucose and amino acids directly into bloodstream' },
            { term: 'Lacteal', meaning: 'central lymph vessel that absorbs digested fats' },
          ],
        },
        { do: 'write', text: 'Constant blood flow maintains a steep diffusion gradient.' },
        { do: 'write', text: 'Absorbed nutrients travel to every cell for energy, growth, and repair.' },
        { do: 'summary', text: 'Villi maximise surface area for rapid absorption' },
      ],
    },
    {
      id: 'b5',
      topic: 'Checking understanding of villi adaptations',
      narration:
        "Let's put the whole picture together. Comparing a smooth tube to a folded lining makes it crystal clear " +
        'why our body needs villi. Now, think about what we just explored. What structural adaptations allow ' +
        'villi to absorb digested nutrients so rapidly?',
      board: [
        { do: 'title', text: 'Why Villi Work So Efficiently', path: ['Life Processes', 'Nutrition', 'Review'] },
        {
          do: 'compare',
          left: { heading: 'Smooth Intestinal Wall', points: ['Small surface area', 'Slow diffusion rate', 'Food passes unabsorbed'] },
          right: {
            heading: 'Wall with Villi',
            points: ['Huge surface area (folded)', 'Rapid diffusion across 1-cell wall', 'Immediate uptake into blood & lymph'],
          },
        },
        { do: 'write', text: 'Three key villus features: huge surface area, thin walls, dense vessels.' },
        { do: 'summary', text: 'Structure matches function: maximum absorption' },
        {
          do: 'ask',
          question: 'What structural adaptations allow villi to absorb digested nutrients so rapidly?',
          expect: 'Folds and microvilli give a huge surface, the wall is one cell thick, and dense capillaries and a lacteal carry food away.',
          hint: 'Think about the surface, the thickness of the wall, and what runs inside each villus.',
        },
      ],
    },
  ],
};
