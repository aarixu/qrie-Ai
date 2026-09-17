/**
 * WCAG CONTRAST, MEASURED — because a riso palette is decided by arithmetic.
 *
 * The amber decision in apps/classroom/src/theme.css was made this way: amber
 * carries dark text at ~9:1 and white text at ~2:1, so amber became
 * `primary-container` and a near-black became `primary`. A fluorescent palette
 * needs the same discipline or it ships unreadable.
 *
 *   node docs/brand/contrast.mjs
 *
 * AA needs 4.5:1 for body text, 3:1 for large text (>=18.66px bold / 24px) and
 * for the boundary of a UI component. AAA needs 7:1.
 */

const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};

const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** The proposed Riso Pop inks, plus the tuned variants we may need. */
const INK = {
  // as pitched
  'fluoro-pink':   '#FF48A0',
  'riso-blue':     '#0B5FD9',
  'riso-yellow':   '#FFD21E',
  'overprint':     '#196B46',
  'newsprint':     '#FAF7F0',
  'ink':           '#17171D',
  // tuned candidates — deeper inks that can carry text
  'pink-deep':     '#D6117A',
  'pink-deeper':   '#B00463',
  'blue-deep':     '#0A4BAA',
  'blue-deeper':   '#07357A',
  'green-deep':    '#196B46',
  'paper-warm':    '#FFFBF2',
  'paper-tint':    '#F4EFE2',
  'ink-soft':      '#4A4A55',
  // containers — pale grounds that carry their own deep ink
  'pink-cont':     '#FFDDEC',
  'blue-cont':     '#D8E6FF',
  'green-cont':    '#CFEBDD',
  'error-cont':    '#FFDDD6',
  'error':         '#C5321E',
  'error-deep':    '#8E2310',
  // THE DARK ROOM — riso inks re-pitched for a lit screen at night
  'dk-surface':    '#141318',
  'dk-surface-2':  '#1E1D24',
  'dk-on-surf':    '#F2EFE7',
  'dk-on-surf-v':  '#B6B2A8',
  'dk-outline':    '#7C7788',
  'dk-primary':    '#8FB4FF',
  'dk-ink':        '#0A1730',
  'dk-pink':       '#FF7FC0',
  'dk-green':      '#6FD9A4',
};

const GROUNDS = ['newsprint', 'paper-warm', 'paper-tint', 'ink', 'riso-yellow', 'fluoro-pink', 'riso-blue'];
const FOREGROUNDS = Object.keys(INK);

const grade = (r) =>
  r >= 7 ? 'AAA  ' : r >= 4.5 ? 'AA   ' : r >= 3 ? 'AA-lg' : '  --  ';

console.log('\nCONTRAST OF EVERY INK ON EVERY GROUND — Riso Pop\n');
console.log('  AAA = 7:1  ·  AA = 4.5:1 body text  ·  AA-lg = 3:1 large text & UI edges\n');

for (const g of GROUNDS) {
  console.log(`\n  ON ${g.toUpperCase()} ${INK[g]}`);
  const rows = FOREGROUNDS.filter((f) => f !== g)
    .map((f) => ({ f, r: ratio(INK[f], INK[g]) }))
    .sort((a, b) => b.r - a.r);
  for (const { f, r } of rows) {
    if (r < 2) continue;
    console.log(`      ${grade(r)}  ${r.toFixed(2).padStart(5)}:1   ${f.padEnd(13)} ${INK[f]}`);
  }
}

/** The pairs the app actually has to survive. */
const REQUIRED = [
  ['body text on the board',        'ink',         'newsprint', 4.5],
  ['body text on warm paper',       'ink',         'paper-warm', 4.5],
  ['secondary text on the board',   'ink-soft',    'newsprint', 4.5],
  ['label on a yellow header',      'ink',         'riso-yellow', 4.5],
  ['white on the primary button',   'newsprint',   'riso-blue', 4.5],
  ['white on a deep-blue button',   'newsprint',   'blue-deep', 4.5],
  ['ink on a fluoro-pink chip',     'ink',         'fluoro-pink', 4.5],
  // THE THREE RULES. These are MEANT to fail — each failure is a law of the
  // system, not a defect. Fluoro pink is a ground and never a text colour;
  // nothing white ever sits on it; and yellow is invisible on paper unless a
  // keyline bounds it, which is what riso printing looks like anyway.
  ['RULE white never on fluoro',    'newsprint',   'fluoro-pink', 4.5, true],
  ['RULE fluoro is never text',     'fluoro-pink', 'newsprint', 4.5, true],
  ['deep pink as text on board',    'pink-deep',   'newsprint', 4.5],
  ['deeper pink as text on board',  'pink-deeper', 'newsprint', 4.5],
  ['blue as TEXT on the board',     'riso-blue',   'newsprint', 4.5],
  ['green as TEXT on the board',    'green-deep',  'newsprint', 4.5],
  ['RULE yellow needs a keyline',   'riso-yellow', 'newsprint', 3.0, true],
  ['outline on the board',          'ink-soft',    'newsprint', 3.0],
  // the full Material-3 role set we intend to ship
  ['on-secondary: paper on pink-deep',   'newsprint',   'pink-deep',   4.5],
  ['on-tertiary: paper on green-deep',   'newsprint',   'green-deep',  4.5],
  ['on-error: paper on error',           'newsprint',   'error',       4.5],
  ['error as text on the board',         'error',       'newsprint',   4.5],
  ['on-pink-container',                  'pink-deeper', 'pink-cont',   4.5],
  ['on-blue-container',                  'blue-deeper', 'blue-cont',   4.5],
  ['on-green-container',                 'green-deep',  'green-cont',  4.5],
  ['on-error-container',                 'error-deep',  'error-cont',  4.5],
  // DARK ROOM — the same product at night
  ['dk body text',                       'dk-on-surf',  'dk-surface',  4.5],
  ['dk secondary text',                  'dk-on-surf-v','dk-surface',  4.5],
  ['dk primary button label',            'dk-ink',      'dk-primary',  4.5],
  ['dk pink as text',                    'dk-pink',     'dk-surface',  4.5],
  ['dk green as text',                   'dk-green',    'dk-surface',  4.5],
  ['dk yellow as text',                  'riso-yellow', 'dk-surface',  4.5],
  ['dk outline',                         'dk-outline',  'dk-surface',  3.0],
];

console.log('\n\nTHE PAIRS THE PRODUCT ACTUALLY NEEDS\n');
let failures = 0;
for (const [what, fg, bg, need, isRule] of REQUIRED) {
  const r = ratio(INK[fg], INK[bg]);
  const ok = r >= need;
  if (!ok && !isRule) failures++;
  const tag = isRule ? (ok ? 'RULE?' : 'RULE ') : ok ? 'PASS ' : 'FAIL ';
  console.log(
    `  ${tag} ${r.toFixed(2).padStart(5)}:1  (needs ${need.toFixed(1)})  ` +
      `${what.padEnd(34)} ${INK[fg]} on ${INK[bg]}`,
  );
}
console.log(
  failures === 0
    ? `\n  ALL ${REQUIRED.length} PAIRS SETTLED. The three RULE rows fail on purpose.\n`
    : `\n  ${failures} UNEXPECTED FAILURES — the palette is not shippable.\n`,
);
