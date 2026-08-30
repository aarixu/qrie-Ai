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
export function pencilGlyph(noun: string): Glyph {
  let h = 0x811c9dc5;
  for (let i = 0; i < noun.length; i += 1) {
    h ^= noun.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const jitter = (n: number, spread: number) => (((h >>> (n * 2)) % 100) / 100 - 0.5) * spread;

  // Twelve slightly-uneven spokes, joined through their midpoints with gentle
  // quadratic curves. Midpoint-to-midpoint is what keeps the outline a wobbly
  // LOOP: an earlier version curved corner-to-corner with far-flung control
  // points, and the crossings drew a pinwheel where a circle should have been.
  const N = 12;
  const r = 42;
  const pts = Array.from({ length: N }, (_, i) => {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    const rr = r + jitter(i, 8);
    return { x: 50 + Math.cos(a) * rr, y: 50 + Math.sin(a) * rr };
  });
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });

  const m0 = mid(pts[N - 1], pts[0]);
  let ring = `M ${m0.x.toFixed(1)} ${m0.y.toFixed(1)}`;
  for (let i = 0; i < N; i += 1) {
    const corner = pts[i];
    const next = mid(pts[i], pts[(i + 1) % N]);
    ring += ` Q ${corner.x.toFixed(1)} ${corner.y.toFixed(1)} ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
  }
  ring += ' Z';

  const label = noun.length > 12 ? `${noun.slice(0, 11)}…` : noun;
  const size = label.length > 8 ? 13 : label.length > 5 ? 16 : 20;

  return {
    width: 100,
    height: 100,
    body:
      `<path d="${ring}" fill="none" stroke="#4b4b4b" stroke-width="2.4"` +
      ` stroke-linejoin="round" stroke-linecap="round" opacity="0.75"/>` +
      `<text x="50" y="52" text-anchor="middle" dominant-baseline="middle"` +
      ` font-family="Caveat, cursive" font-size="${size}" fill="#4b4b4b">${escapeXml(label)}</text>`,
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
