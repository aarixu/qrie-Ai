/**
 * HOW MUCH OF WHAT A CLASS NEEDS DOES COMMONS ACTUALLY HAVE?
 *
 * The supply side of rung three, measured before anything is turned on. No
 * model is called: this asks Commons for real briefs and counts what comes
 * back that is openly licensed and drawable. It costs nothing and needs no key.
 *
 * What it CANNOT tell you is the verifier's pass rate — whether the picture is
 * the right thing and has no labels printed on it. That needs eyes. But supply
 * is the cheaper question and usually the binding one: if Commons has nothing
 * for a kidney cross section, no verifier is going to help.
 *
 *   node tools/bin/commons-supply.mjs
 */

const REUSABLE = /public ?domain|cc0|cc[- ]by|no restrictions/i;
const RESTRICTED = /\bnc\b|noncommercial|non-commercial|\bnd\b|noderiv|editorial|rights reserved/i;
const DRAWABLE = /^image\/(jpeg|png|webp|gif)$/;

/** Briefs in the shape the planner really writes them, across subjects. */
const BRIEFS = [
  'a kidney cut lengthwise, showing the cortex, medulla and renal pelvis',
  'a human heart seen from the front, whole and unlabelled',
  'a leaf in cross section showing the epidermis and the mesophyll',
  'a plant cell under a microscope',
  'the Moon photographed at full phase',
  'a sample of quartz crystal',
  'a laboratory Bunsen burner',
  'a simple pendulum hanging from a stand',
  'the Great Wall of China seen along its length',
  'a bar magnet with iron filings around it',
  'an ammeter used in a school laboratory',
  'a mature neuron showing the cell body and its axon',
];

/**
 * The same head-clause reduction fromWeb.searchQuery does, kept here in full
 * so this script measures what the app will actually send.
 */
const STOPS = /,|;|\b(?:showing|displaying|with|seen|used|hanging|standing|held|placed|viewed|drawn|labelled|labeled|so that|such that|next to|beside)\b/i;
const keywords = (brief) =>
  (brief.replace(/\s+/g, ' ').trim().split(STOPS)[0] ?? '')
    .replace(/^(?:an?|the)\s+/i, '')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 5)
    .join(' ');

/** Commons asks for a real user agent and a civilised rate. Both, then. */
const UA = 'CurieEdu/1.0 (https://curie.co.in; 1208aarav@gmail.com)';
const breathe = () => new Promise((r) => setTimeout(r, 1200));

const query = async (brief) => {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  const params = {
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    generator: 'search',
    gsrsearch: keywords(brief),
    gsrnamespace: '6',
    gsrlimit: '12',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime',
    iiurlwidth: '1024',
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const response = await fetch(url, { headers: { 'user-agent': UA } });
  if (!response.ok) return { total: 0, usable: 0, sample: `HTTP ${response.status}` };

  const pages = (await response.json())?.query?.pages ?? [];
  let usable = 0;
  let sample = null;
  for (const page of pages) {
    const info = page?.imageinfo?.[0];
    if (!info) continue;
    if (info.mime && !DRAWABLE.test(info.mime)) continue;
    const licence = info.extmetadata?.LicenseShortName?.value ?? info.extmetadata?.UsageTerms?.value;
    if (!licence || RESTRICTED.test(licence) || !REUSABLE.test(licence)) continue;
    usable += 1;
    sample ??= `${page.title} — ${licence}`;
  }
  return { total: pages.length, usable, sample };
};

const rows = [];
for (const brief of BRIEFS) {
  await breathe();
  const r = await query(brief);
  rows.push({ brief, ...r });
  const q = keywords(brief).padEnd(32).slice(0, 32);
  console.log(
    `${q}  ${String(r.usable).padStart(2)}/${String(r.total).padStart(2)}  ${r.sample ?? '—'}`,
  );
}

const withAny = rows.filter((r) => r.usable > 0).length;
const usable = rows.reduce((n, r) => n + r.usable, 0);
console.log('');
console.log(`briefs with at least one openly licensed candidate: ${withAny}/${rows.length}`);
console.log(`openly licensed candidates in total: ${usable}`);
console.log(
  `median usable per brief: ${
    [...rows.map((r) => r.usable)].sort((a, b) => a - b)[Math.floor(rows.length / 2)]
  }`,
);
