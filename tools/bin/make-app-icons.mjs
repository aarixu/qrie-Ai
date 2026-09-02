import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * THE APP ICONS, DRAWN FROM THE ONE MARK.
 *
 * The Curie mark lives in exactly one place — apps/classroom/src/ui/Logo.tsx —
 * and content/icon.svg is that component's geometry placed by a single
 * transform so the two cannot drift. This turns those SVGs into the PNGs the
 * stores and the launchers insist on, and it is a SCRIPT rather than a folder
 * of files somebody exported once: an exported PNG is a copy of the mark that
 * quietly stops matching it.
 *
 * Sizes, and who asks for each:
 *
 *   1024  App Store listing. No transparency allowed, no rounded corners —
 *         Apple applies its own mask and a pre-rounded icon gets rounded twice.
 *    512  Play Store listing, and the PWA manifest's large icon.
 *    432  Android adaptive foreground. The launcher crops to its own shape, so
 *         this comes from the MASKABLE svg, whose mark sits inside the safe
 *         circle.
 *    192  PWA installability minimum.
 *
 * Run: node tools/bin/make-app-icons.mjs
 */

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error(
    'This needs sharp: npm i -D -w @ai-tutor/classroom sharp\n' +
      '(a build-time dependency only — it never reaches a browser or a phone)',
  );
  process.exit(1);
}

const ROOT = process.cwd();
const PLAIN = path.join(ROOT, 'content/icon.svg');
const MASKABLE = path.join(ROOT, 'content/icon-maskable.svg');
const OUT = path.join(ROOT, 'apps/classroom/assets');
const PUBLIC = path.join(ROOT, 'content');

/** Every icon this repo emits, and the one sentence saying why it exists. */
const JOBS = [
  { from: PLAIN, to: path.join(OUT, 'icon-only.png'), size: 1024, why: 'App Store listing' },
  { from: MASKABLE, to: path.join(OUT, 'icon-foreground.png'), size: 1024, why: 'Android adaptive foreground' },
  { from: PLAIN, to: path.join(PUBLIC, 'icon-512.png'), size: 512, why: 'Play listing and PWA' },
  { from: MASKABLE, to: path.join(PUBLIC, 'icon-maskable-512.png'), size: 512, why: 'PWA maskable' },
  { from: PLAIN, to: path.join(PUBLIC, 'icon-192.png'), size: 192, why: 'PWA installability minimum' },
];

/**
 * The background of the adaptive icon, as a flat colour.
 *
 * Read out of the SVG rather than typed here: the mark's blue is decided in
 * one place and a second copy of a hex is a second thing to keep in step.
 */
function backgroundColour() {
  const svg = fs.readFileSync(MASKABLE, 'utf8');
  const found = /fill="(#[0-9a-f]{3,8})"/i.exec(svg);
  return found ? found[1] : '#4648d4';
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  for (const job of JOBS) {
    // Flattened onto the mark's own blue: Apple rejects an icon with an alpha
    // channel outright, and a launcher showing the page behind a transparent
    // icon looks like a rendering fault.
    await sharp(job.from)
      .resize(job.size, job.size)
      .flatten({ background: backgroundColour() })
      .png()
      .toFile(job.to);
    console.log(`${path.relative(ROOT, job.to)}  ${job.size}px  — ${job.why}`);
  }

  // The adaptive icon's back layer. One colour, so it is drawn rather than
  // scaled from anything.
  const background = path.join(OUT, 'icon-background.png');
  await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: backgroundColour() },
  })
    .png()
    .toFile(background);
  console.log(`${path.relative(ROOT, background)}  1024px  — Android adaptive background`);

  /**
   * The splash.
   *
   * The mark, small, on the same ground the app opens on — not a poster. A
   * splash screen is the half-second before the first paint, and anything that
   * asks to be read in that time is asking for attention it will not get.
   */
  const splash = path.join(OUT, 'splash.png');
  const mark = await sharp(PLAIN).resize(480, 480).png().toBuffer();
  await sharp({
    create: { width: 2732, height: 2732, channels: 3, background: '#f7f9fb' },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toFile(splash);
  console.log(`${path.relative(ROOT, splash)}  2732px  — splash, light`);

  const splashDark = path.join(OUT, 'splash-dark.png');
  await sharp({
    create: { width: 2732, height: 2732, channels: 3, background: '#101317' },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toFile(splashDark);
  console.log(`${path.relative(ROOT, splashDark)}  2732px  — splash, dark`);

  console.log('\nNow: npx cap assets generate --android   (from apps/classroom)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
