/**
 * THE PICTURES, SO A PERSON CAN LOOK AT THEM.
 *
 * The numbers say six of sixteen briefs got a picture off the web. What the
 * numbers cannot say is whether those six are good enough to teach a child
 * from, and whether the refusals were right — and that is the whole decision.
 * So this puts every candidate the verifier saw on one page, beside what it
 * said about it.
 *
 *   node tools/bin/webrig-report.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const OUT = '.scratch/webrig';
const { results } = JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8'));

/**
 * SMALL COPIES, FETCHED FRESH.
 *
 * The run keeps 1024px images, because that is what the verifier was shown and
 * what a board would draw. Forty of those is 30 MB of base64 and a published
 * page has 16 MB for everything — so the page gets 320px copies, which Commons
 * makes on demand when one segment of the URL is changed.
 */
const UA = 'CurieEdu/1.0 (https://curie.co.in; 1208aarav@gmail.com)';

/**
 * Special:FilePath, not a rewritten thumbnail URL.
 *
 * Rewriting the "1024px-" segment only works for files that HAVE one — an
 * original served because the thumbnailer refused the format has no such
 * segment, and a first attempt at this silently left sixteen of thirty-one
 * pictures at full size and pushed the page past the 16 MB a published
 * artifact is allowed. FilePath takes a width for any file there is.
 */
const nameOf = (candidate) => {
  const page = (candidate.source ?? '').split(' by ')[0];
  const fromPage = /\/wiki\/File:(.+)$/.exec(page)?.[1];
  if (fromPage) return decodeURIComponent(fromPage);
  const last = decodeURIComponent(candidate.url.split('/').pop() ?? '');
  return last.replace(/^\d+px-/, '');
};

async function thumb(candidate) {
  const name = nameOf(candidate);
  if (!name) return null;
  const url =
    'https://commons.wikimedia.org/wiki/Special:FilePath/' +
    encodeURIComponent(name) +
    '?width=320';
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA } });
    if (!r.ok) return null;
    const type = (r.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
    if (!/^image\//.test(type)) return null;
    return `data:${type};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
  } catch {
    return null;
  }
}

let fetched = 0;
let missed = 0;
for (const r of results) {
  for (const l of r.looked) {
    if (!l.src) continue;
    const shrunk = await thumb(l);
    if (shrunk && shrunk.length < l.src.length) {
      l.src = shrunk;
      fetched += 1;
    } else {
      missed += 1;
    }
    await new Promise((go) => setTimeout(go, 350));
  }
}
if (missed > 0) console.log(`WARNING: ${missed} pictures kept their full size`);
console.log(`shrank ${fetched} of ${fetched + missed} pictures for the page`);

// --------------------------------------------------------------- the tally --

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const judgedBy = (l) => !l.error;
const taken = results.filter((r) => r.accepted);
const refused = results.filter((r) => !r.accepted);
const looks = results.flatMap((r) => r.looked.filter(judgedBy));

const reasons = { labels: 0, wrong: 0, several: 0 };
for (const l of looks) {
  if (!l.refusal) continue;
  if (/printed on it/.test(l.refusal)) reasons.labels += 1;
  else if (/of the subject in it/.test(l.refusal)) reasons.several += 1;
  else reasons.wrong += 1;
}

const licensedTotal = results.reduce((n, r) => n + (r.licensed ?? 0), 0);
const foundTotal = results.reduce((n, r) => n + (r.found ?? 0), 0);

// ---------------------------------------------------------------- the page --

const card = (l, brief) => {
  const ok = !l.refusal;
  return `<figure class="spec ${ok ? 'kept' : 'cut'}">
      <div class="plate"><img src="${esc(l.src)}" alt="${esc(l.verdict?.saw || brief)}" loading="lazy"></div>
      <figcaption>
        <p class="stamp">${ok ? 'kept' : 'refused'}</p>
        <p class="saw">${esc(l.verdict?.saw || 'no description')}</p>
        ${ok ? '' : `<p class="because">${esc(l.refusal)}</p>`}
        <p class="lic"><a href="${esc((l.source ?? '').split(' by ')[0])}" target="_blank" rel="noreferrer">${esc(l.license ?? 'unlicensed')}</a></p>
      </figcaption>
    </figure>`;
};

const row = (r) => {
  const shown = r.looked.filter(judgedBy);
  return `<article class="brief ${r.accepted ? 'won' : 'lost'}">
      <div class="ask">
        <h3>${esc(r.brief)}</h3>
        <dl>
          <div><dt>searched</dt><dd><code>${esc(r.query)}</code></dd></div>
          <div><dt>open licence</dt><dd>${r.licensed} of ${r.found}</dd></div>
          <div><dt>shown to the model</dt><dd>${shown.length}</dd></div>
        </dl>
      </div>
      <div class="sheet">${shown.map((l) => card(l, r.brief)).join('')}</div>
    </article>`;
};

const html = `<title>The Web Picture Trial</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;450;600&family=Spectral:wght@500;600&display=swap">
<style>
  :root {
    color-scheme: light;
    --paper: #f4f6f8;
    --plate: #ffffff;
    --ink: #171a1f;
    --dim: #667180;
    --rule: #dde2e8;
    --slate: #2f5d7c;
    --kept: #1f7a4d;
    --kept-wash: #edf6f1;
    --cut: #a8402c;
    --cut-wash: #fbefec;
    --serif: Spectral, Georgia, "Times New Roman", serif;
    --sans: "IBM Plex Sans", ui-sans-serif, system-ui, "Segoe UI", sans-serif;
    --mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper: #0f1216;
      --plate: #181c22;
      --ink: #e7eaf0;
      --dim: #8d96a4;
      --rule: #262d37;
      --slate: #7fb2d4;
      --kept: #58c78d;
      --kept-wash: #10281c;
      --cut: #e88f78;
      --cut-wash: #2c1712;
    }
  }
  :root[data-theme="dark"] {
    --paper: #0f1216;
    --plate: #181c22;
    --ink: #e7eaf0;
    --dim: #8d96a4;
    --rule: #262d37;
    --slate: #7fb2d4;
    --kept: #58c78d;
    --kept-wash: #10281c;
    --cut: #e88f78;
    --cut-wash: #2c1712;
  }

  body { background: var(--paper); color: var(--ink); font-family: var(--sans); font-size: 15px; line-height: 1.6; }
  .page { max-width: 1080px; margin: 0 auto; padding: 44px 22px 96px; display: flex; flex-direction: column; gap: 40px; }
  a { color: var(--slate); }
  code { font-family: var(--mono); font-size: 0.86em; }
  h1, h2, h3 { font-family: var(--serif); font-weight: 600; text-wrap: balance; margin: 0; }

  /* --- the question ------------------------------------------------- */
  .top { display: flex; flex-direction: column; gap: 14px; }
  .eyebrow { font-family: var(--mono); font-size: 11.5px; letter-spacing: 0.13em; text-transform: uppercase; color: var(--slate); margin: 0; }
  h1 { font-size: clamp(28px, 4.2vw, 40px); line-height: 1.1; letter-spacing: -0.015em; }
  .stand { color: var(--dim); max-width: 64ch; margin: 0; font-size: 16px; }

  /* --- the count ---------------------------------------------------- */
  .count { display: grid; grid-template-columns: repeat(auto-fit, minmax(146px, 1fr)); gap: 1px; background: var(--rule); border: 1px solid var(--rule); border-radius: 3px; overflow: hidden; }
  .count > div { background: var(--plate); padding: 16px 18px; }
  .count b { display: block; font-family: var(--serif); font-size: 30px; line-height: 1.05; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .count span { display: block; color: var(--dim); font-size: 12.5px; margin-top: 4px; }
  .count .win b { color: var(--kept); }

  /* --- the arithmetic ----------------------------------------------- */
  .sums { background: var(--plate); border: 1px solid var(--rule); border-radius: 3px; padding: 22px 24px; display: flex; flex-direction: column; gap: 12px; }
  .sums h2 { font-size: 19px; }
  .sums p { margin: 0; max-width: 70ch; color: var(--dim); }
  .sums p strong { color: var(--ink); font-weight: 600; }
  .caveat { border-left: 2px solid var(--slate); padding-left: 14px; font-size: 14px; }

  /* --- the contact sheet -------------------------------------------- */
  h2.band { font-family: var(--mono); font-size: 11.5px; letter-spacing: 0.13em; text-transform: uppercase; color: var(--dim); font-weight: 500; border-bottom: 1px solid var(--rule); padding-bottom: 8px; }
  .set { display: flex; flex-direction: column; gap: 18px; }
  .brief { background: var(--plate); border: 1px solid var(--rule); border-radius: 3px; display: grid; grid-template-columns: minmax(0, 260px) minmax(0, 1fr); }
  @media (max-width: 760px) { .brief { grid-template-columns: minmax(0, 1fr); } }
  .brief.won { border-left: 3px solid var(--kept); }
  .brief.lost { border-left: 3px solid var(--cut); }
  .ask { padding: 20px; border-right: 1px solid var(--rule); display: flex; flex-direction: column; gap: 12px; }
  @media (max-width: 760px) { .ask { border-right: none; border-bottom: 1px solid var(--rule); } }
  .ask h3 { font-size: 16.5px; line-height: 1.3; }
  dl { margin: 0; display: flex; flex-direction: column; gap: 7px; }
  dl div { display: flex; gap: 8px; align-items: baseline; }
  dt { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--dim); flex: 0 0 auto; }
  dd { margin: 0; font-size: 13px; font-variant-numeric: tabular-nums; }

  .sheet { padding: 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(178px, 1fr)); gap: 16px; align-content: start; }
  .spec { margin: 0; display: flex; flex-direction: column; gap: 9px; }
  .plate { aspect-ratio: 1; background: #fff; border: 1px solid var(--rule); border-radius: 2px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .plate img { max-width: 100%; max-height: 100%; object-fit: contain; }
  figcaption { display: flex; flex-direction: column; gap: 4px; }
  .stamp { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; margin: 0; }
  .kept .stamp { color: var(--kept); }
  .cut .stamp { color: var(--cut); }
  .saw { margin: 0; font-size: 13px; line-height: 1.4; }
  .because { margin: 0; font-size: 12.5px; color: var(--cut); background: var(--cut-wash); padding: 5px 8px; border-radius: 2px; }
  .kept .saw { background: var(--kept-wash); padding: 5px 8px; border-radius: 2px; }
  .lic { margin: 0; font-family: var(--mono); font-size: 10.5px; color: var(--dim); }
  .lic a { color: inherit; text-decoration-color: var(--rule); }
  a:focus-visible, .lic a:focus-visible { outline: 2px solid var(--slate); outline-offset: 2px; border-radius: 2px; }
</style>

<div class="page">
  <header class="top">
    <p class="eyebrow">Curie · picture ladder · rung three</p>
    <h1>Should the tutor take pictures off the web?</h1>
    <p class="stand">Sixteen briefs written the way the planner really writes them, put to
      Wikimedia Commons, and every openly licensed result shown to a Gemini Flash model with
      one question: is this the thing that was asked for, is anything printed on it, and is
      there exactly one of it. Every picture below is a real candidate and every verdict is
      the model's own words.</p>
  </header>

  <section class="count">
    <div class="win"><b>${taken.length} / ${results.length}</b><span>briefs got a picture</span></div>
    <div><b>${looks.length}</b><span>candidates judged</span></div>
    <div><b>${licensedTotal} / ${foundTotal}</b><span>results openly licensed</span></div>
    <div><b>${reasons.wrong}</b><span>refused as the wrong thing</span></div>
    <div><b>${reasons.labels}</b><span>refused for printed labels</span></div>
  </section>

  <section class="sums">
    <h2>What it costs either way</h2>
    <p>Generating one picture costs about <strong>₹5.75</strong>. A verifier call costs a
      fraction of a paisa, and the search itself is free — Commons needs no API key. At six in
      sixteen, the rung pays for <strong>three or four candidate checks</strong> and saves a
      generation <strong>37% of the time</strong>; the other 63% it adds a couple of seconds
      and a rounding error, then generates anyway.</p>
    <p>The refusals are the reassuring half. Nineteen of twenty-five were the model catching a
      picture of the <em>wrong thing</em> — a urinary-system chart for a kidney, a dowsing
      pendulum for a physics one, an ovarian teratoma for a neuron. Six were textbook plates
      with the labels already printed on them, which is exactly what the tutor writes herself.
      Not one wrong picture reached a board.</p>
    <p class="caveat">Two models did the judging: the first ten briefs by
      <code>gemini-3.8-flash</code>, then its daily free quota ran out and the last six went to
      <code>gemini-3.1-flash-lite</code>. <code>gemini-3.7-flash</code> is in the model list but
      never answers — three calls aborted at 30 and 45 seconds. Both models that did answer
      refused for the same kinds of reason, so the mix does not look like it moved the number.</p>
  </section>

  <section class="set">
    <h2 class="band">Took a picture — ${taken.length} of ${results.length}</h2>
    ${taken.map(row).join('')}
  </section>

  <section class="set">
    <h2 class="band">Fell through to generation — ${refused.length} of ${results.length}</h2>
    ${refused.map(row).join('')}
  </section>
</div>
`;

const file = path.join(OUT, 'report.html');
fs.writeFileSync(file, html);
console.log(`wrote ${file} — ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
console.log(`taken ${taken.length}/${results.length}, judged ${looks.length}, reasons`, reasons);
