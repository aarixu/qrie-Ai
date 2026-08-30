/**
 * Finding a picture for a noun.
 *
 * The board wants "boy", "school", "clock". It does not want an icon name, and
 * it must never fail: a lesson that says the word "school" has to put something
 * on the board even when no set in the world has a school in it.
 *
 * Pure. It is handed a catalogue and asked a question; loading the catalogue is
 * somebody else's job, because the sets live in a 443 MB package that must
 * never reach a browser.
 */

/** One drawable icon, as the sets store them: a body plus its own viewBox size. */
export interface Glyph {
  body: string;
  width: number;
  height: number;
}

/** The subset of an Iconify set this package needs. */
export interface IconSet {
  /** Set prefix, e.g. `noto`. Used for provenance, not lookup. */
  prefix: string;
  width: number;
  height: number;
  icons: Record<string, { body: string; width?: number; height?: number }>;
  /**
   * The set's own grouping, category name to icon names, where the set ships
   * one. It is the only clue to what an icon DEPICTS that is not its name:
   * a bare name like `tank` says nothing about which meaning it draws, but
   * "Vehicles" does.
   */
  categories?: Record<string, readonly string[]>;
}

export interface Resolved {
  glyph: Glyph;
  /** Which set and icon it came from, so a lesson can carry its attributions. */
  source: { set: string; icon: string };
  /** How the name was found — for the prep report, and for spotting bad matches. */
  how: 'exact' | 'synonym' | 'prefix' | 'contains';
  /** The set's own grouping for this icon, when it ships one. */
  category?: string;
}

/**
 * Words a lesson uses that the icon sets file differently.
 *
 * Small on purpose. This is not a thesaurus — it is the short list of misses
 * that turn up when real narration meets real sets, and every entry earns its
 * place by having actually failed once.
 */
const SYNONYMS: Record<string, string[]> = {
  boy: ['boy', 'child'],
  girl: ['girl', 'child'],
  student: ['boy', 'girl', 'child', 'graduation-cap'],
  friend: ['boy', 'girl', 'child'],
  teacher: ['woman-teacher', 'man-teacher', 'teacher'],
  school: ['school', 'classical-building'],
  home: ['house', 'house-with-garden'],
  house: ['house', 'house-with-garden'],
  car: ['automobile', 'oncoming-automobile', 'racing-car'],
  bus: ['bus', 'oncoming-bus', 'school-bus'],
  cycle: ['bicycle'],
  bike: ['bicycle', 'motor-scooter'],
  walking: ['person-walking', 'man-walking', 'walking'],
  running: ['person-running', 'man-running', 'running'],
  clock: ['alarm-clock', 'timer-clock', 'watch', 'three-oclock'],
  time: ['alarm-clock', 'timer-clock', 'hourglass-done'],
  stopwatch: ['stopwatch', 'timer-clock'],
  distance: ['straight-ruler', 'triangular-ruler'],
  ruler: ['straight-ruler', 'triangular-ruler'],
  road: ['motorway', 'railway-track'],
  tree: ['deciduous-tree', 'evergreen-tree'],
  sun: ['sun', 'sun-with-face'],
  water: ['droplet', 'water-wave'],
  fire: ['fire'],
  book: ['closed-book', 'open-book', 'books'],
  heart: ['anatomical-heart', 'red-heart'],
  brain: ['brain'],
  plant: ['seedling', 'potted-plant'],
  leaf: ['fallen-leaf', 'leaf-fluttering-in-wind', 'herb'],
  cell: ['microbe'],
  earth: ['globe-showing-asia-australia', 'globe-showing-europe-africa'],
  moon: ['full-moon', 'crescent-moon'],
  star: ['star', 'glowing-star'],
  money: ['money-bag', 'dollar-banknote'],
  food: ['pot-of-food', 'green-salad'],
  apple: ['red-apple', 'green-apple'],
  ball: ['soccer-ball', 'basketball'],
  train: ['train', 'locomotive', 'high-speed-train'],
  aeroplane: ['airplane'],
  airplane: ['airplane'],
  rocket: ['rocket'],
  magnet: ['magnet'],
  battery: ['battery'],
  bulb: ['light-bulb'],
  light: ['light-bulb', 'flashlight'],
  sound: ['loudspeaker', 'bell'],
  eye: ['eye', 'eyes'],
  hand: ['raised-hand', 'waving-hand'],
  question: ['red-question-mark', 'thinking-face'],
  correct: ['check-mark-button', 'check-mark'],
  wrong: ['cross-mark'],
  warning: ['warning'],
};

/** `Two Boys Walking!` -> `two-boys-walking` */
export function slug(noun: string): string {
  return noun
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Drop a leading article and a trailing plural, which narration is full of. */
function bare(name: string): string {
  const s = slug(name).replace(/^(a|an|the)-/, '');
  return s.endsWith('s') && !s.endsWith('ss') ? s.slice(0, -1) : s;
}

function take(set: IconSet, icon: string, how: Resolved['how']): Resolved {
  const entry = set.icons[icon];
  let category: string | undefined;
  for (const [name, members] of Object.entries(set.categories ?? {})) {
    if (members.includes(icon)) {
      category = name;
      break;
    }
  }
  return {
    glyph: {
      body: entry.body,
      width: entry.width ?? set.width,
      height: entry.height ?? set.height,
    },
    source: { set: set.prefix, icon },
    how,
    ...(category ? { category } : {}),
  };
}

/**
 * Find a picture for a noun across the given sets, in order of preference.
 *
 * Order matters: the sets are tried one at a time so a friendly colour icon
 * wins over a line icon of the same thing when both exist. Within a set the
 * search widens — exact name, then known synonyms, then a name that starts
 * with the word, then one that merely contains it — and never widens into the
 * next strategy while a narrower one is still finding matches, because
 * "school" matching `preschool` is fine and `old-school-tie` is not.
 */
export function resolveNoun(noun: string, sets: readonly IconSet[]): Resolved | null {
  const key = bare(noun);
  if (key === '') return null;

  const candidates = [key, ...(SYNONYMS[key] ?? [])];

  for (const set of sets) {
    for (const [i, name] of candidates.entries()) {
      if (set.icons[name]) return take(set, name, i === 0 ? 'exact' : 'synonym');
    }
  }
  for (const set of sets) {
    const names = Object.keys(set.icons);
    const starts = names.find((n) => n === key || n.startsWith(`${key}-`));
    if (starts) return take(set, starts, 'prefix');
  }
  for (const set of sets) {
    const names = Object.keys(set.icons);
    // Shortest containing name: `school` beats `school-bus` for "school".
    const contains = names
      .filter((n) => n.includes(key))
      .sort((a, b) => a.length - b.length)[0];
    if (contains) return take(set, contains, 'contains');
  }
  return null;
}

/**
 * Every icon that could plausibly be this noun, best guess first.
 *
 * String matching cannot tell a water tank from a military one — a lesson on
 * water flowing between tanks put an armoured vehicle on the board. So the
 * search stops trying to be right and instead offers everything it found, and
 * something that understands the lesson picks.
 *
 * Ranked by how the match was made, then by name length, so a caller with no
 * model to consult can still take the first and be no worse off than before.
 */
export function candidatesFor(
  noun: string,
  sets: readonly IconSet[],
  limit = 8,
): Resolved[] {
  const key = bare(noun);
  if (key === '') return [];

  const found: Resolved[] = [];
  const seen = new Set<string>();
  const add = (set: IconSet, icon: string, how: Resolved['how']) => {
    const id = `${set.prefix}:${icon}`;
    if (seen.has(id) || !set.icons[icon]) return;
    seen.add(id);
    found.push(take(set, icon, how));
  };

  const wanted = [key, ...(SYNONYMS[key] ?? [])];
  for (const set of sets) {
    for (const [i, name] of wanted.entries()) add(set, name, i === 0 ? 'exact' : 'synonym');
  }
  for (const set of sets) {
    for (const name of Object.keys(set.icons)) {
      if (name === key || name.startsWith(`${key}-`)) add(set, name, 'prefix');
    }
  }
  for (const set of sets) {
    const containing = Object.keys(set.icons)
      .filter((n) => n.includes(key))
      .sort((a, b) => a.length - b.length);
    for (const name of containing) add(set, name, 'contains');
  }

  return found.slice(0, limit);
}

/**
 * The picture for a noun nothing has a picture for.
 *
 * A pencil circle with the word inside it, the way a teacher draws a thing she
 * cannot draw. Deliberately not blank and not an error: the class carries on,
 * the student still sees a thing in the right place with the right name, and
 * the only thing lost is the likeness.
 *
 * Its wobble is derived from the word, so the same noun looks the same every
 * time it appears — a placeholder that changed shape between beats would read
 * as two different things.
 */
/**
 * A QUICK PENCIL SKETCH, WITH THE THING'S NAME UNDER IT.
 *
 * The last resort, and a real one: a quarter of a million icons still miss
 * plenty of everyday nouns, and generating a picture for each is half a minute
 * and real money. What a teacher does instead is scribble a shape and write
 * what it stands for — nobody mistakes it for a portrait, and the lesson keeps
 * moving.
 *
 * The shape varies with the word, because a board of five identical circles
 * says "the machine gave up" five times, while a board of five different quick
 * sketches reads as someone drawing. It is not trying to DEPICT the noun — it
 * cannot — it is trying to be an honest placeholder that looks drawn by hand.
 */
export function pencilGlyph(noun: string): Glyph {
  let h = 0x811c9dc5;
  for (let i = 0; i < noun.length; i += 1) {
    h ^= noun.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  /** Deterministic wobble, so the same word is always drawn the same way. */
  const jitter = (n: number, spread: number) => (((h >>> (n % 14) * 2) % 100) / 100 - 0.5) * spread;

  type Pt = { x: number; y: number };

  /**
   * A closed line through these points, wobbled and rounded.
   *
   * Curving midpoint to midpoint keeps the outline a LOOP: curving corner to
   * corner with far-flung control points crossed the strokes over each other
   * and drew a pinwheel where a shape should have been.
   */
  const loop = (pts: Pt[], wob: number, seed: number): string => {
    const p2 = pts.map((q, i) => ({
      x: q.x + jitter(seed + i, wob),
      y: q.y + jitter(seed + i + 7, wob),
    }));
    const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const m0 = mid(p2[p2.length - 1], p2[0]);
    let d = `M ${m0.x.toFixed(1)} ${m0.y.toFixed(1)}`;
    for (let i = 0; i < p2.length; i += 1) {
      const next = mid(p2[i], p2[(i + 1) % p2.length]);
      d += ` Q ${p2[i].x.toFixed(1)} ${p2[i].y.toFixed(1)} ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
    }
    return d + ' Z';
  };

  /** An open line, for the marks inside a sketch. */
  const line = (pts: Pt[], wob: number, seed: number): string => {
    const p2 = pts.map((q, i) => ({
      x: q.x + jitter(seed + i, wob),
      y: q.y + jitter(seed + i + 3, wob),
    }));
    return p2
      .map((q, i) => `${i === 0 ? 'M' : 'L'} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`)
      .join(' ');
  };

  const ring = (cx: number, cy: number, rx: number, ry: number, n = 12): Pt[] =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
    });

  // Six shapes a hand reaches for. Which one a word gets is arbitrary and that
  // is the point: it varies, so a board of placeholders looks drawn rather
  // than generated.
  const shape = h % 6;
  const paths: string[] = [];

  if (shape === 0) {
    paths.push(loop(ring(50, 42, 36, 32), 7, 0));
  } else if (shape === 1) {
    // A sheet with a turned corner.
    paths.push(loop([
      { x: 18, y: 12 }, { x: 68, y: 12 }, { x: 82, y: 26 },
      { x: 82, y: 72 }, { x: 18, y: 72 },
    ], 4, 2));
    paths.push(line([{ x: 68, y: 12 }, { x: 68, y: 26 }, { x: 82, y: 26 }], 3, 5));
  } else if (shape === 2) {
    // A drum on its end.
    paths.push(loop(ring(50, 24, 30, 10), 3, 1));
    paths.push(line([{ x: 20, y: 24 }, { x: 20, y: 62 }], 3, 4));
    paths.push(line([{ x: 80, y: 24 }, { x: 80, y: 62 }], 3, 6));
    paths.push(line([
      { x: 20, y: 62 }, { x: 34, y: 71 }, { x: 66, y: 71 }, { x: 80, y: 62 },
    ], 3, 8));
  } else if (shape === 3) {
    // A cloud: three overlapping puffs.
    paths.push(loop(ring(36, 40, 20, 16), 5, 3));
    paths.push(loop(ring(58, 34, 22, 18), 5, 9));
    paths.push(loop(ring(62, 52, 18, 14), 5, 11));
  } else if (shape === 4) {
    // A flask.
    paths.push(line([{ x: 40, y: 12 }, { x: 40, y: 34 }], 2, 1));
    paths.push(line([{ x: 60, y: 12 }, { x: 60, y: 34 }], 2, 3));
    paths.push(line([{ x: 34, y: 12 }, { x: 66, y: 12 }], 2, 5));
    paths.push(loop([
      { x: 40, y: 34 }, { x: 60, y: 34 }, { x: 80, y: 66 },
      { x: 62, y: 78 }, { x: 38, y: 78 }, { x: 20, y: 66 },
    ], 4, 7));
  } else {
    // Two layers, stacked.
    // Set apart, or the two rims touch and the pair reads as a figure of eight
    // rather than one thing resting on another.
    paths.push(loop(ring(50, 26, 32, 12), 4, 2));
    paths.push(loop(ring(50, 62, 32, 12), 4, 10));
  }

  const label = noun.length > 13 ? `${noun.slice(0, 12)}…` : noun;
  const size = label.length > 9 ? 13 : label.length > 6 ? 15 : 18;

  const strokes = paths
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="#4b4b4b" stroke-width="2.2"` +
        ' stroke-linejoin="round" stroke-linecap="round" opacity="0.72"/>',
    )
    .join('');

  return {
    width: 100,
    height: 100,
    body:
      strokes +
      `<text x="50" y="94" text-anchor="middle" font-family="Caveat, cursive"` +
      ` font-size="${size}" fill="#4b4b4b">${escapeXml(label)}</text>`,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // The apostrophe too, so this is safe wherever it is used rather than
    // safe because of where it happens to be used today.
    .replace(/'/g, '&apos;');
}
