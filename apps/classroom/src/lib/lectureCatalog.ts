import type { Lesson } from '@ai-tutor/lesson-format';

export interface CatalogLesson {
  id: string;
  title: string;
  subtitle: string;
  class: number;
  subject: 'Mathematics' | 'Science';
  path: string;
  topicRef: string;
  durationMinutes?: number;
  description?: string;
  icon?: string;
}

export const CURATED_LESSONS: CatalogLesson[] = [
  // Mathematics
  {
    id: 'class10-math-quadratic-equations',
    title: 'Quadratic Equations & Universal Formula',
    subtitle: 'Class 10 · Mathematics',
    class: 10,
    subject: 'Mathematics',
    path: 'class10-math-quadratic-equations/lesson.json',
    topicRef: 'class10-mathematics/quadratic-equations/standard-form-and-formula',
    durationMinutes: 4,
    description: 'Learn standard form ax² + bx + c = 0, discriminant D, and the quadratic formula with real parabolas.',
    icon: 'functions',
  },
  {
    id: 'class9-math-pythagoras-theorem',
    title: 'Pythagorean Theorem & Right Triangles',
    subtitle: 'Class 9 · Mathematics',
    class: 9,
    subject: 'Mathematics',
    path: 'class9-math-pythagoras/lesson.json',
    topicRef: 'class9-mathematics/triangles/pythagoras-theorem',
    durationMinutes: 3,
    description: 'Geometric visual proof of a² + b² = c² and practical hypotenuse calculations.',
    icon: 'square',
  },
  {
    id: 'class10-math-arithmetic-progression',
    title: 'Arithmetic Progressions & The nth Term',
    subtitle: 'Class 10 · Mathematics',
    class: 10,
    subject: 'Mathematics',
    path: 'class10-math-ap/lesson.json',
    topicRef: 'class10-mathematics/arithmetic-progressions/nth-term',
    durationMinutes: 4,
    description: 'Understanding common difference "d", first term "a", and formula aₙ = a + (n-1)d.',
    icon: 'stacked_line_chart',
  },

  // Science
  {
    id: 'class10-respiration',
    title: 'Respiration & Cellular Energy (ATP)',
    subtitle: 'Class 10 · Science (Life Processes)',
    class: 10,
    subject: 'Science',
    path: 'class10-respiration/lesson.json',
    topicRef: 'class10-science/life-processes/respiration',
    durationMinutes: 4,
    description: 'Why breathing is not respiration. Aerobic vs. anaerobic pathways, mitochondria, and lactic acid cramps.',
    icon: 'air',
  },
  {
    id: 'class10-blood',
    title: 'Human Circulatory System & Blood Components',
    subtitle: 'Class 10 · Science (Life Processes)',
    class: 10,
    subject: 'Science',
    path: 'class10-blood/lesson.json',
    topicRef: 'class10-science/life-processes/transportation-in-human-beings',
    durationMinutes: 5,
    description: 'RBCs, WBCs, platelets, blood plasma, and how double circulation powers human life.',
    icon: 'favorite',
  },
  {
    id: 'class10-excretion',
    title: 'Human Excretory System & Kidney Nephrons',
    subtitle: 'Class 10 · Science (Life Processes)',
    class: 10,
    subject: 'Science',
    path: 'class10-excretion/lesson.json',
    topicRef: 'class10-science/life-processes/excretion-in-human-beings',
    durationMinutes: 4,
    description: 'Kidneys, ureters, bladder, and microscopic filtration units called nephrons.',
    icon: 'filter_alt',
  },
  {
    id: 'class9-particle-size',
    title: 'Matter in Our Surroundings & Particles',
    subtitle: 'Class 9 · Science',
    class: 9,
    subject: 'Science',
    path: 'class9-particle-size/lesson.json',
    topicRef: 'class9-science/matter-in-our-surroundings/how-small-are-these-particles-of-matter',
    durationMinutes: 3,
    description: 'How small are particles of matter? Dilution experiments and physical behavior.',
    icon: 'grain',
  },
  {
    id: 'class9-mitochondria',
    title: 'Mitochondria: Powerhouse of the Cell',
    subtitle: 'Class 9 · Science (Cell Structure)',
    class: 9,
    subject: 'Science',
    path: 'class9-mitochondria/lesson.json',
    topicRef: 'class9-science/the-fundamental-unit-of-life/cell-organelles',
    durationMinutes: 3,
    description: 'Inner membranes, cristae, ATP synthesis, and why mitochondria have their own DNA.',
    icon: 'biotech',
  },
];

export async function fetchCatalogLesson(lessonId: string): Promise<{ lesson: Lesson; assets: Record<string, string> }> {
  const item = CURATED_LESSONS.find((l) => l.id === lessonId);
  if (!item) {
    throw new Error(`Lesson ${lessonId} not found in catalog.`);
  }

  const response = await fetch(`/${item.path}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${item.path}: ${response.statusText}`);
  }

  const lesson = (await response.json()) as Lesson;

  let assets: Record<string, string> = {};
  const folder = item.path.split('/')[0];
  try {
    const assetsRes = await fetch(`/${folder}/assets.json`);
    if (assetsRes.ok) {
      assets = (await assetsRes.json()) as Record<string, string>;
    }
  } catch {
    // optional assets
  }

  return { lesson, assets };
}
