import { validateLesson, type ImagePart, type Lesson } from '@ai-tutor/lesson-format';
import { assemble, gateLesson, type Blueprint, type GateProblem, type PageReport } from '@ai-tutor/class-prep';

/**
 * THE COMPOSED BOARD, IN THE LAB, FOR NOTHING (board composer).
 *
 * Three pages of "Small intestine → villi", written as the page contract asks.
 * They go through the real assemble and keep gate, with simple drawings
 * carried here so no picture is bought. What the lab shows is what a prepared
 * class gets.
 */

const SMALL_INTESTINE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 320">
<path d="M40 40 C 110 10, 150 70, 110 110 S 60 160, 130 170" fill="none" stroke="#f4a3a8" stroke-width="26" stroke-linecap="round"/>
<path d="M130 170 C 180 120, 240 125, 260 165 S 220 225, 175 215 S 150 265, 210 272 S 310 250, 350 290" fill="none" stroke="#ee8a92" stroke-width="26" stroke-linecap="round"/>
</svg>`;

const VILLUS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">
<path d="M60 395 L60 120 Q60 28 150 28 Q240 28 240 120 L240 395" fill="#f7c6c9" stroke="#b5179e" stroke-width="10" stroke-dasharray="3 5"/>
<path d="M95 395 L95 140 Q150 60 205 140 L205 395" fill="none" stroke="#d9363e" stroke-width="8"/>
<path d="M118 395 L118 150 Q150 98 182 150 L182 395" fill="none" stroke="#3b6fd8" stroke-width="7"/>
<path d="M150 395 L150 112" fill="none" stroke="#5cb85c" stroke-width="12" stroke-linecap="round"/>
</svg>`;

const MICROVILLI_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 160">
<rect x="10" y="100" width="280" height="55" rx="8" fill="#f7c6c9" stroke="#e58f97" stroke-width="3"/>
<g id="folds">
${Array.from({ length: 12 }, (_, k) => `<rect x="${18 + k * 23}" y="30" width="13" height="74" rx="6.5" fill="#f4a3a8" stroke="#e58f97" stroke-width="2"/>`).join('\n')}
</g>
</svg>`;

const asImage = (svg: string): string => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const PARTS = new Map<string, ImagePart[]>([
  [
    'small_intestine',
    [
      { name: 'duodenum', x: 0.06, y: 0.05, w: 0.3, h: 0.3 },
      { name: 'jejunum', x: 0.32, y: 0.38, w: 0.36, h: 0.3 },
      { name: 'ileum', x: 0.55, y: 0.75, w: 0.35, h: 0.2 },
    ],
  ],
  [
    'villus',
    [
      { name: 'capillaries', x: 0.28, y: 0.2, w: 0.1, h: 0.75 },
      { name: 'lacteal', x: 0.47, y: 0.28, w: 0.07, h: 0.68 },
      { name: 'epithelium', x: 0.76, y: 0.3, w: 0.07, h: 0.6 },
      { name: 'microvilli', x: 0.35, y: 0.04, w: 0.3, h: 0.06 },
    ],
  ],
]);
const SHAPES = new Map([
  ['small_intestine', 400 / 320],
  ['villus', 300 / 400],
]);

export const COMPOSER_DEMO: Blueprint = {
  id: 'composer-demo',
  title: 'Small intestine',
  layout: 'composed',
  visuals: [
    { id: 'small_intestine', medium: 'picture', parts: ['duodenum', 'jejunum', 'ileum'], brief: 'The small intestine, coiled.', alt: 'The small intestine' },
    { id: 'villus', medium: 'picture', parts: ['capillaries', 'lacteal', 'epithelium', 'microvilli'], brief: 'One villus, cut open.', alt: 'A villus' },
    { id: 'microvilli', medium: 'diagram', parts: ['folds'], brief: 'Microvilli on one cell.', alt: 'Microvilli' },
  ],
  beats: [
    {
      id: 'b1',
      topic: 'The small intestine',
      narration: '',
      board: [
        { do: 'title', text: 'Small intestine', path: ['Digestive system', 'Small intestine'] },
        { do: 'say', text: 'This long, coiled tube is your small intestine.' },
        { do: 'picture', ref: 'small_intestine' },
        { do: 'say', text: 'It starts right after the stomach, as the duodenum.' },
        { do: 'label', target: 'small_intestine#duodenum', text: 'Duodenum' },
        { do: 'say', text: 'Then comes the jejunum, the middle stretch.' },
        { do: 'label', target: 'small_intestine#jejunum', text: 'Jejunum' },
        { do: 'say', text: 'And it ends as the ileum, which joins the large intestine.' },
        { do: 'label', target: 'small_intestine#ileum', text: 'Ileum' },
        { do: 'say', text: 'Each of the three parts has its own job.' },
        {
          do: 'list',
          heading: 'Its three parts',
          items: [
            { term: 'Duodenum', meaning: 'bile and pancreatic juice join the food' },
            { term: 'Jejunum', meaning: 'most digestion is finished here' },
            { term: 'Ileum', meaning: 'the last nutrients are taken in' },
          ],
        },
        { do: 'say', text: 'It is about six metres long, folded to fit inside you.' },
        { do: 'write', text: 'About 6 metres long, coiled to fit the abdomen' },
        { do: 'say', text: 'Digestion is completed in here.' },
        { do: 'write', text: 'Digestion of all food is completed here' },
        { do: 'say', text: 'And this is where food finally enters your blood.' },
        { do: 'write', text: 'The main site of absorption into blood' },
        { do: 'say', text: 'Its inner wall is not smooth at all.' },
        { do: 'write', text: 'Inner wall lined with millions of villi' },
        { do: 'say', text: 'What is left passes on to the large intestine.' },
        { do: 'write', text: 'Whatever is not absorbed moves to the large intestine' },
        { do: 'say', text: 'So the small intestine digests, and then absorbs.' },
        { do: 'summary', text: 'It finishes digestion and absorbs food' },
      ],
    },
    {
      id: 'b2',
      topic: 'Villi',
      narration: '',
      board: [
        { do: 'title', text: 'Villi', path: ['Digestive system', 'Small intestine', 'Villi'] },
        { do: 'say', text: 'Its inner wall is covered in tiny fingers, called villi.' },
        { do: 'picture', ref: 'villus' },
        { do: 'say', text: 'Inside each villus is a net of blood capillaries.' },
        { do: 'label', target: 'villus#capillaries', text: 'Capillaries' },
        { do: 'annotate', target: 'villus#capillaries', mark: 'circle' },
        { do: 'say', text: 'Down the middle runs a lacteal, a lymph vessel.' },
        { do: 'label', target: 'villus#lacteal', text: 'Lacteal' },
        { do: 'say', text: 'Its outer skin, the epithelium, is one cell thick.' },
        { do: 'label', target: 'villus#epithelium', text: 'Epithelium' },
        { do: 'say', text: 'And every cell has even tinier folds, the microvilli.' },
        { do: 'sketch', ref: 'microvilli', from: 'villus#microvilli' },
        { do: 'say', text: 'Here is what each part carries away.' },
        {
          do: 'list',
          heading: 'What each part does',
          items: [
            { term: 'Capillaries', meaning: 'sugars and amino acids to the blood' },
            { term: 'Lacteal', meaning: 'fatty acids and glycerol to the lymph' },
            { term: 'Epithelium', meaning: 'one cell thick, so food crosses fast' },
          ],
        },
        { do: 'say', text: 'Villi and microvilli make the surface enormous.' },
        { do: 'write', text: 'Villi + microvilli: a huge surface area' },
        { do: 'say', text: 'A thin wall lets food cross in quickly.' },
        { do: 'write', text: 'A wall one cell thick lets food cross fast' },
        { do: 'say', text: 'And a rich blood supply carries it straight away.' },
        { do: 'write', text: 'A rich blood supply carries food away at once' },
        { do: 'say', text: 'So villi are how digested food gets into you.' },
        { do: 'summary', text: 'Villi absorb food into blood and lymph' },
      ],
    },
    {
      id: 'b3',
      topic: 'Why villi matter',
      narration: '',
      board: [
        { do: 'title', text: 'Why villi matter', path: ['Digestive system', 'Small intestine', 'Villi'] },
        { do: 'say', text: 'Compare a smooth tube with one full of villi.' },
        {
          do: 'compare',
          left: { heading: 'Without villi', points: ['a smooth inner wall', 'a small surface', 'slow absorption'] },
          right: { heading: 'With villi', points: ['millions of tiny fingers', 'a huge surface', 'fast absorption'] },
        },
        { do: 'say', text: 'More surface means more food taken in at once.' },
        { do: 'write', text: 'More surface area means more absorption' },
        { do: 'say', text: 'That is why the wall is folded so many times over.' },
        { do: 'write', text: 'Folds on folds: villi, then microvilli' },
        { do: 'say', text: 'Without villi, most food would pass out unused.' },
        { do: 'write', text: 'Without villi, most food passes out unused' },
        { do: 'say', text: 'And each villus is only one cell thick.' },
        { do: 'write', text: 'A thin wall makes the crossing quick' },
        { do: 'say', text: 'Fats go into the lacteals, sugars into the blood.' },
        {
          do: 'list',
          heading: 'Where nutrients go',
          items: [
            { term: 'Sugars, amino acids', meaning: 'into the blood capillaries' },
            { term: 'Fatty acids, glycerol', meaning: 'into the lacteals' },
            { term: 'Water, vitamins, minerals', meaning: 'into the capillaries' },
            { term: 'From the capillaries', meaning: 'to the liver, by the hepatic portal vein' },
            { term: 'From the lacteals', meaning: 'into the lymph, and then the blood' },
          ],
        },
        { do: 'say', text: 'So more villi means faster absorption.' },
        { do: 'summary', text: 'More surface, faster absorption' },
      ],
    },
  ],
};

/** The demo, assembled and gated exactly as a prepared class is, with its artwork. */
export function composerDemoLesson(): {
  lesson: Lesson;
  problems: GateProblem[];
  assets: Record<string, string>;
  pages: PageReport[];
} {
  const made = assemble(COMPOSER_DEMO, new Set(['small_intestine', 'villus', 'microvilli']), PARTS, SHAPES);
  const checked = validateLesson(made.lesson);
  if (!checked.ok) throw new Error(`composer demo does not validate: ${checked.errors.join('; ')}`);
  const lesson = checked.lesson as Lesson;
  // A later page's copy of a picture shares the original's artwork (assemble's aliases).
  const art: Record<string, string> = {
    small_intestine: asImage(SMALL_INTESTINE_SVG),
    villus: asImage(VILLUS_SVG),
    microvilli: MICROVILLI_SVG,
  };
  const assets: Record<string, string> = {};
  for (const el of lesson.elements) {
    const original = made.aliases[el.id] ?? el.id;
    if (art[original]) assets[el.id] = art[original];
  }
  return {
    lesson,
    problems: gateLesson(lesson, {
      bonds: made.bonds,
      unspoken: made.unspoken,
      undrawn: made.undrawn,
      composer: made.composer,
      mathsCheck: () => ({ ok: true, failures: [] }),
    }),
    assets,
    pages: made.composer?.pages ?? [],
  };
}
