/**
 * BRING THE MARKETING ART HOME, AND MAKE IT WEIGH SOMETHING SENSIBLE.
 *
 *   node tools/bin/fetch-landing-art.mjs
 *
 * The landing page loaded nine PNGs from a Vercel blob store plus three local
 * ones: 13.4 MB of images on a single page, each a 1536x1024 AI illustration
 * stored as PNG, served through a plain <img> with `images: { unoptimized }`.
 * No resize, no modern format, no lazy loading. On the ten-thousand-rupee
 * Android this product is for, on Indian mobile data, that is the page.
 *
 * Two problems, one fix. The second is the one nobody would have noticed until
 * it happened: every one of those nine URLs pointed at a blob store nothing in
 * this repo controls. Delete it, rotate its token, let the account lapse — and
 * the logo and every illustration on every page break at once, with no local
 * fallback anywhere.
 *
 * So the art is downloaded once, converted to WebP at a width that matches how
 * big it is actually drawn, and committed. Re-run this only to add or replace a
 * picture; the output is source from then on.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const OUT = fileURLToPath(new URL('../../landing/public/art', import.meta.url));
const PRIZES = fileURLToPath(new URL('../../landing/public/prizes', import.meta.url));
const BLOB = 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com';

/**
 * `width` is the widest this is ever DRAWN, not the widest it exists. A 1536px
 * source behind a 560px slot is 1 MB spent to throw three quarters of it away.
 * Doubled from the CSS size so it still looks right on a 2x screen.
 */
const ART = [
  { name: 'logo', width: 128, src: `${BLOB}/ChatGPT%20Image%20Sep%202%2C%202026%2C%2010_42_12%20AM-5vJi1SeaJztqjZeAI2DCYyOzA3vNDC.png` },
  { name: 'logo-light', width: 128, src: `${BLOB}/image-U7AsVhF29T0XsHb2J6StnNsjoQ81ci.png` },
  { name: 'hero', width: 1000, src: `${BLOB}/ChatGPT%20Image%20Sep%202%2C%202026%2C%2008_54_40%20AM-DVdJ26xemlQr34NrXUR1cLdEnTAalw.png` },
  { name: 'desk', width: 900, src: `${BLOB}/ChatGPT%20Image%20Sep%202%2C%202026%2C%2008_57_00%20AM-3fCXcQsKeSM7pjF9T0ZOCm7ReOLIZq.png` },
  { name: 'teacher', width: 900, src: `${BLOB}/ChatGPT%20Image%20Sep%202%2C%202026%2C%2010_26_21%20AM-lWHa6iZC0Gk36j59X0KhNq9hlQKiVJ.png` },
  { name: 'learner', width: 900, src: `${BLOB}/ChatGPT%20Image%20Sep%202%2C%202026%2C%2010_08_58%20AM-Rr2hlWx99WNdBYTS6BiIhOOFDyozWs.png` },
  { name: 'focus', width: 900, src: `${BLOB}/ChatGPT%20Image%20Sep%202%2C%202026%2C%2010_14_35%20AM-Q8eiT9CTtRV50r6BR1giuc1jGjVS3I.png` },
  { name: 'hand', width: 900, src: `${BLOB}/ChatGPT%20Image%20Sep%202%2C%202026%2C%2010_23_01%20AM-5PaL1bjeKMdhJXo6nZi0aDuZgq5n40.png` },
  { name: 'students', width: 900, src: `${BLOB}/ChatGPT%20Image%20Sep%202%2C%202026%2C%2010_18_53%20AM-RY3U1uIsS84RYePzJHlNln93xUNVFl.png` },
  { name: 'prize-cash', width: 400, file: path.join(PRIZES, 'cash-prize.png') },
  { name: 'prize-console', width: 400, file: path.join(PRIZES, 'playstation.png') },
  { name: 'prize-phone', width: 400, file: path.join(PRIZES, 'moto-edge.png') },
];

mkdirSync(OUT, { recursive: true });

const kb = (n) => `${Math.round(n / 1024).toLocaleString()} KB`;
let before = 0;
let after = 0;
const sizes = {};

for (const item of ART) {
  const input = item.file
    ? readFileSync(item.file)
    : Buffer.from(await (await fetch(item.src)).arrayBuffer());
  before += input.length;

  const image = sharp(input);
  const meta = await image.metadata();
  // Never upscale: a source narrower than the target stays its own size, so a
  // small logo is not blown up into a blurry big one.
  const width = Math.min(item.width, meta.width ?? item.width);

  const out = await image
    .resize({ width, withoutEnlargement: true })
    // 82 is where these illustrations stop changing visibly. `effort: 6` is
    // slower to encode and smaller to download, which is the right way round
    // for a file written once and served forever.
    .webp({ quality: 82, effort: 6 })
    .toBuffer();

  const dest = path.join(OUT, `${item.name}.webp`);
  writeFileSync(dest, out);
  after += out.length;

  const outMeta = await sharp(out).metadata();
  sizes[item.name] = { w: outMeta.width, h: outMeta.height };
  console.log(
    `  ${item.name.padEnd(14)} ${String(meta.width).padStart(5)}x${String(meta.height).padEnd(5)} ` +
      `${kb(input.length).padStart(9)}  ->  ${String(outMeta.width).padStart(5)}x${String(outMeta.height).padEnd(5)} ${kb(out.length).padStart(9)}`,
  );
}

console.log(`\n  TOTAL  ${kb(before)}  ->  ${kb(after)}   (${Math.round((1 - after / before) * 100)}% smaller)`);
console.log(`\n  Intrinsic sizes for landing/lib/art.ts:\n${JSON.stringify(sizes, null, 2)}`);

// The originals are no longer referenced by anything once lib/art.ts lands.
try {
  for (const f of ['cash-prize.png', 'playstation.png', 'moto-edge.png']) {
    statSync(path.join(PRIZES, f));
  }
  console.log('\n  landing/public/prizes/*.png are now unused — delete them.');
} catch {
  /* already gone */
}
