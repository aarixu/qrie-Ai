/**
 * RISO POP — the palette, derived and PROVEN, then written out.
 *
 *   node docs/brand/build-theme.mjs            # audit + drift check vs the committed CSS
 *   node docs/brand/build-theme.mjs --write    # also writes theme.css + tints.css
 *
 * WHY THIS IS A SCRIPT AND NOT A FILE OF HEXES. The contract is 47 Material-3
 * tokens in two rooms plus twelve subject-tint classes with a dark value each:
 * 118 hand-typed colours, every one of which is a contrast failure waiting for
 * a student on a cheap screen. So the inks are typed once, every derived tint
 * is MIXED from them, and nothing is emitted until every foreground/ground pair
 * the app actually renders has been checked against WCAG AA.
 *
 * THE THREE LAWS OF THIS PALETTE, which the arithmetic imposed rather than
 * taste (see docs/brand/contrast.mjs):
 *
 *   1. FLUORO PINK IS A GROUND, NEVER A TEXT COLOUR. #FF48A0 is 2.94:1 on
 *      paper and 2.94:1 under white. It carries INK at 5.68:1 and that is the
 *      only way it is ever used. This is the same decision theme.css already
 *      made about amber, for the same reason.
 *   2. PINK THAT MUST BE READ IS #D6117A. The fluoro stays for fills.
 *   3. YELLOW IS INVISIBLE UNBOUNDED. #FFD21E is 1.35:1 on newsprint, so it
 *      never appears without a keyline around it. That is not a workaround —
 *      keylines and registration marks are what riso printing looks like, so
 *      the accessibility constraint and the aesthetic want the same thing.
 */

import fs from 'node:fs';

// ── the inks. Everything below is derived from these. ────────────────────────
const INK = {
  paper:      '#FAF7F0',  // newsprint
  paperWarm:  '#FFFBF2',
  ink:        '#17171D',
  inkSoft:    '#4A4A55',
  blue:       '#0B5FD9',  // the thing you press
  blueDeep:   '#0A4BAA',
  blueDeeper: '#07357A',
  fluoro:     '#FF48A0',  // the signature — GROUND ONLY (law 1)
  pink:       '#D6117A',  // pink you can read (law 2)
  pinkDeeper: '#B00463',
  yellow:     '#FFD21E',  // always keylined (law 3)
  green:      '#196B46',
  red:        '#C5321E',
  redDeep:    '#8E2310',
};

// the dark room — riso inks re-pitched for a lit screen, not inverted
const DARK = {
  surface:    '#141318',
  surface2:   '#1E1D24',
  onSurface:  '#F2EFE7',
  onSurfaceV: '#B6B2A8',
  outline:    '#7C7788',
  blue:       '#8FB4FF',
  onBlue:     '#0A1730',
  fluoro:     '#FF7FC0',
  onFluoro:   '#2B0016',
  pink:       '#FF9FCC',
  pinkCont:   '#5C0033',
  yellow:     '#FFD21E',
  green:      '#6FD9A4',
  greenCont:  '#0C3A24',
  red:        '#FF9E8C',
  redCont:    '#5E1608',
};

// ── colour maths ─────────────────────────────────────────────────────────────
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) =>
  rgb(h)
    .map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((s, c, i) => s + [0.2126, 0.7152, 0.0722][i] * c, 0);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** t=0 → a, t=1 → b. Plain sRGB mix: these are tints of paper, not blends. */
const mix = (a, b, t) => {
  const [A, B] = [rgb(a), rgb(b)];
  return (
    '#' +
    A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
};
const triplet = (h) => rgb(h).join(' ');

// ── derived tints ────────────────────────────────────────────────────────────
const D = {
  pinkCont:   mix(INK.paper, INK.fluoro, 0.16),
  blueCont:   mix(INK.paper, INK.blue, 0.16),
  greenCont:  mix(INK.paper, INK.green, 0.18),
  redCont:    mix(INK.paper, INK.red, 0.16),
  yellowCont: mix(INK.paper, INK.yellow, 0.34),
  outlineV:   mix(INK.paper, INK.ink, 0.22),
  surfLowest: '#FFFFFF',
  surfLow:    mix(INK.paper, INK.yellow, 0.05),
  surf:       mix(INK.paper, INK.yellow, 0.09),
  surfHigh:   mix(INK.paper, INK.ink, 0.07),
  surfHighest:mix(INK.paper, INK.ink, 0.11),
  surfDim:    mix(INK.paper, INK.ink, 0.13),
  surfBright: INK.paperWarm,
};

/** Subject tints. A student finds Maths by its colour before reading the word. */
const SUBJECTS = [
  { name: 'green',  ink: INK.green,  label: 'Biology & Life Sciences' },
  { name: 'blue',   ink: INK.blue,   label: 'Maths' },
  { name: 'purple', ink: INK.pinkDeeper, label: 'Chemistry' },
  { name: 'orange', ink: INK.redDeep,label: 'Physics' },
].map((s) => ({
  ...s,
  tile: mix(INK.paper, s.ink, 0.1),
  ring: mix(INK.paper, s.ink, 0.26),
  dkTile: mix(DARK.surface, s.ink, 0.22),
  dkRing: mix(DARK.surface, s.ink, 0.4),
  dkInk: mix(DARK.onSurface, s.ink, 0.42),
}));

// ── every pair the app actually renders ──────────────────────────────────────
const PAIRS = [
  ['on-primary / primary',              INK.paper,      INK.blue,        4.5],
  ['on-primary-container / container',  INK.ink,        INK.fluoro,      4.5],
  ['on-secondary / secondary',          INK.paper,      INK.pink,        4.5],
  ['on-secondary-container / cont',     INK.pinkDeeper, D.pinkCont,      4.5],
  ['on-tertiary / tertiary',            INK.paper,      INK.green,       4.5],
  ['on-tertiary-container / cont',      INK.green,      D.greenCont,     4.5],
  ['on-error / error',                  INK.paper,      INK.red,         4.5],
  ['on-error-container / cont',         INK.redDeep,    D.redCont,       4.5],
  ['on-primary-fixed / fixed (yellow)', INK.ink,        INK.yellow,      4.5],
  ['on-surface / surface',              INK.ink,        INK.paper,       4.5],
  ['on-surface-variant / surface',      INK.inkSoft,    INK.paper,       4.5],
  ['on-surface / surface-highest',      INK.ink,        D.surfHighest,   4.5],
  ['on-surface-variant / highest',      INK.inkSoft,    D.surfHighest,   4.5],
  ['outline / surface',                 INK.inkSoft,    INK.paper,       3.0],
  ['blue as link text / surface',       INK.blue,       INK.paper,       4.5],
  ['pink as text / surface',            INK.pink,       INK.paper,       4.5],
  ['green as text / surface',           INK.green,      INK.paper,       4.5],
  // dark room
  ['dk on-surface / surface',           DARK.onSurface, DARK.surface,    4.5],
  ['dk on-surface-variant / surface',   DARK.onSurfaceV,DARK.surface,    4.5],
  ['dk on-surface / surface-2',         DARK.onSurface, DARK.surface2,   4.5],
  ['dk on-primary / primary',           DARK.onBlue,    DARK.blue,       4.5],
  ['dk on-primary-container / cont',    DARK.onFluoro,  DARK.fluoro,     4.5],
  ['dk on-secondary-container / cont',  DARK.pink,      DARK.pinkCont,   4.5],
  ['dk on-tertiary-container / cont',   DARK.green,     DARK.greenCont,  4.5],
  ['dk on-error-container / cont',      DARK.red,       DARK.redCont,    4.5],
  ['dk yellow as text / surface',       DARK.yellow,    DARK.surface,    4.5],
  ['dk outline / surface',              DARK.outline,   DARK.surface,    3.0],
];

for (const s of SUBJECTS) {
  PAIRS.push([`subject ${s.name}: ink on tile`, s.ink, s.tile, 4.5]);
  PAIRS.push([`subject ${s.name}: ink on ring`, s.ink, s.ring, 3.0]);
  PAIRS.push([`subject ${s.name}: dk ink on dk tile`, s.dkInk, s.dkTile, 4.5]);
  // Chapter.tsx renders 'ring-tint-green ink-green' as ONE lockup, so the
  // dark room's ink-on-ring pair is rendered too — audit it like the light.
  PAIRS.push([`subject ${s.name}: dk ink on dk ring`, s.dkInk, s.dkRing, 3.0]);
}

// Help.tsx sets BODY text — on-surface and on-surface-variant — on the blue
// ring tint, so those four are rendered pairs at text size: 4.5, not 3.0.
const ringBlue = SUBJECTS.find((s) => s.name === 'blue');
PAIRS.push(['on-surface / ring-tint-blue', INK.ink, ringBlue.ring, 4.5]);
PAIRS.push(['on-surface-variant / ring-blue', INK.inkSoft, ringBlue.ring, 4.5]);
PAIRS.push(['dk on-surface / dk ring-blue', DARK.onSurface, ringBlue.dkRing, 4.5]);
PAIRS.push(['dk on-surface-var / dk ring-blue', DARK.onSurfaceV, ringBlue.dkRing, 4.5]);

console.log('\nRISO POP — every rendered pair, measured\n');
let bad = 0;
for (const [what, fg, bg, need] of PAIRS) {
  const r = ratio(fg, bg);
  const ok = r >= need;
  if (!ok) bad++;
  console.log(
    `  ${ok ? 'PASS ' : 'FAIL '} ${r.toFixed(2).padStart(5)}:1 (needs ${need.toFixed(1)})  ` +
      `${what.padEnd(34)} ${fg} on ${bg}`,
  );
}
console.log(bad ? `\n  ${bad} FAILURES — nothing written.\n` : `\n  ALL ${PAIRS.length} PAIRS PASS.\n`);
if (bad) process.exit(1);

// ── emit ─────────────────────────────────────────────────────────────────────
const room = (c) => Object.entries(c).map(([k, v]) => `  --c-${k}: ${triplet(v)};`).join('\n');

const LIGHT = {
  primary: INK.blue, 'on-primary': INK.paper,
  'primary-container': INK.fluoro, 'on-primary-container': INK.ink,
  'primary-fixed': INK.yellow, 'primary-fixed-dim': mix(INK.yellow, INK.ink, 0.12),
  'on-primary-fixed': INK.ink, 'on-primary-fixed-variant': INK.redDeep,
  'inverse-primary': DARK.blue, 'surface-tint': INK.blue,
  secondary: INK.pink, 'on-secondary': INK.paper,
  'secondary-container': D.pinkCont, 'on-secondary-container': INK.pinkDeeper,
  'secondary-fixed': D.pinkCont, 'secondary-fixed-dim': mix(D.pinkCont, INK.fluoro, 0.3),
  'on-secondary-fixed': INK.pinkDeeper, 'on-secondary-fixed-variant': INK.pink,
  tertiary: INK.green, 'on-tertiary': INK.paper,
  'tertiary-container': D.greenCont, 'on-tertiary-container': INK.green,
  'tertiary-fixed': D.greenCont, 'tertiary-fixed-dim': mix(D.greenCont, INK.green, 0.25),
  'on-tertiary-fixed': INK.green, 'on-tertiary-fixed-variant': mix(INK.green, INK.ink, 0.2),
  error: INK.red, 'on-error': INK.paper,
  'error-container': D.redCont, 'on-error-container': INK.redDeep,
  background: INK.paper, 'on-background': INK.ink,
  surface: INK.paper, 'on-surface': INK.ink,
  'surface-variant': D.surfHigh, 'on-surface-variant': INK.inkSoft,
  'surface-bright': D.surfBright, 'surface-dim': D.surfDim,
  'surface-container-lowest': D.surfLowest, 'surface-container-low': D.surfLow,
  'surface-container': D.surf, 'surface-container-high': D.surfHigh,
  'surface-container-highest': D.surfHighest,
  'inverse-surface': DARK.surface, 'inverse-on-surface': DARK.onSurface,
  outline: INK.inkSoft, 'outline-variant': D.outlineV,
};

const NIGHT = {
  primary: DARK.blue, 'on-primary': DARK.onBlue,
  'primary-container': DARK.fluoro, 'on-primary-container': DARK.onFluoro,
  'primary-fixed': INK.yellow, 'primary-fixed-dim': mix(INK.yellow, INK.ink, 0.12),
  'on-primary-fixed': INK.ink, 'on-primary-fixed-variant': INK.redDeep,
  'inverse-primary': INK.blue, 'surface-tint': DARK.blue,
  secondary: DARK.pink, 'on-secondary': DARK.pinkCont,
  'secondary-container': DARK.pinkCont, 'on-secondary-container': DARK.pink,
  'secondary-fixed': D.pinkCont, 'secondary-fixed-dim': mix(D.pinkCont, INK.fluoro, 0.3),
  'on-secondary-fixed': INK.pinkDeeper, 'on-secondary-fixed-variant': INK.pink,
  tertiary: DARK.green, 'on-tertiary': DARK.greenCont,
  'tertiary-container': DARK.greenCont, 'on-tertiary-container': DARK.green,
  'tertiary-fixed': D.greenCont, 'tertiary-fixed-dim': mix(D.greenCont, INK.green, 0.25),
  'on-tertiary-fixed': INK.green, 'on-tertiary-fixed-variant': mix(INK.green, INK.ink, 0.2),
  error: DARK.red, 'on-error': DARK.redCont,
  'error-container': DARK.redCont, 'on-error-container': DARK.red,
  background: DARK.surface, 'on-background': DARK.onSurface,
  surface: DARK.surface, 'on-surface': DARK.onSurface,
  'surface-variant': DARK.surface2, 'on-surface-variant': DARK.onSurfaceV,
  'surface-bright': mix(DARK.surface, DARK.onSurface, 0.16),
  'surface-dim': '#0D0C10',
  'surface-container-lowest': '#0A090D', 'surface-container-low': DARK.surface,
  'surface-container': DARK.surface2,
  'surface-container-high': mix(DARK.surface, DARK.onSurface, 0.1),
  'surface-container-highest': mix(DARK.surface, DARK.onSurface, 0.14),
  'inverse-surface': INK.paper, 'inverse-on-surface': INK.ink,
  outline: DARK.outline, 'outline-variant': mix(DARK.surface, DARK.onSurface, 0.2),
};

const header = `/* RISO POP — GENERATED by docs/brand/build-theme.mjs. Do not hand-edit.
   Change an ink in that script and re-run it; it refuses to emit anything until
   every foreground/ground pair the app renders clears WCAG AA.

   THE THREE LAWS, imposed by arithmetic and not by taste:
     1. Fluoro pink #FF48A0 is a GROUND, never text. 2.94:1 as text, 2.94:1
        under white, 5.68:1 under ink — so ink is the only thing on it. This is
        the same call the amber palette made, for the same reason.
     2. Pink that has to be READ is #D6117A (4.65:1).
     3. Yellow #FFD21E is 1.35:1 on paper — invisible unbounded. It never
        appears without a keyline. Riso printing has keylines anyway.

   Values are RGB triplets because Tailwind's opacity modifiers (bg-primary/25)
   compose an alpha into them. */\n`;

const css = `${header}
:root {
${room(LIGHT)}
}

.dark {
${room(NIGHT)}
}
`;

const tints = `/* Subject tints — GENERATED by docs/brand/build-theme.mjs.
   Each is the subject's ink mixed into the ground, and every ink-on-tile pair
   above is asserted at 4.5:1 before this file is written. Class names are kept
   from the amber palette so no screen has to change. */
@layer components {
${SUBJECTS.map((s) => `  .tile-${s.name}  { @apply bg-[${s.tile}] dark:bg-[${s.dkTile}]; }  /* ${s.label} */`).join('\n')}
${SUBJECTS.map((s) => `  .ring-tint-${s.name} { @apply bg-[${s.ring}] dark:bg-[${s.dkRing}]; }`).join('\n')}
${SUBJECTS.map((s) => `  .ink-${s.name}  { @apply text-[${s.ink}] dark:text-[${s.dkInk}]; }`).join('\n')}
}
`;

if (process.argv.includes('--write')) {
  fs.writeFileSync('docs/brand/riso-pop.theme.css', css);
  fs.writeFileSync('docs/brand/riso-pop.tints.css', tints);
  console.log('  Written: docs/brand/riso-pop.theme.css');
  console.log('  Written: docs/brand/riso-pop.tints.css\n');
} else {
  // Check mode also proves the COMMITTED files are this script's output. The
  // audit above measures this script's constants; the app's tests compare the
  // shipped CSS to the committed docs/brand files; this comparison is the
  // middle link — without it a hand-edit to riso-pop.theme.css would ship
  // unmeasured colours with every light green. Line endings are normalised
  // because git on Windows may check the files out with CRLF.
  const flat = (s) => s.replace(/\r\n/g, '\n');
  const drift = [
    ['docs/brand/riso-pop.theme.css', css],
    ['docs/brand/riso-pop.tints.css', tints],
  ].filter(([file, want]) => flat(fs.readFileSync(file, 'utf8')) !== flat(want));
  if (drift.length) {
    for (const [file] of drift) console.log(`  DRIFT: ${file} is not what --write would emit.`);
    console.log('  Never hand-edit a measured value — change an ink here and --write.\n');
    process.exit(1);
  }
  console.log('  Committed CSS matches what --write would emit. (--write to re-emit)\n');
}
