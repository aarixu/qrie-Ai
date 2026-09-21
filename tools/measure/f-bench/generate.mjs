/**
 * THE ANSWERS HALF OF THE f BENCH — paid, run once, cached.
 *
 * `f` is the share of spoken CLASS answers the local whyProbe path settles with
 * no model, and it is the number the whole Rs 5 ceiling rests on. It has never
 * been measured on class asks: the ~70% everyone quotes came from the placement
 * and quiz bank, where the options are ON SCREEN, and `match.ts`'s own header
 * says so.
 *
 * THE ONE METHODOLOGICAL RULE, AND THE WHOLE MEASUREMENT DEPENDS ON IT:
 * the generator is shown the QUESTION, what a right answer should contain, and
 * the hint — exactly what a student in the room has heard. It is NEVER shown
 * the whyProbe's option text.
 *
 * Show it the options and it paraphrases them, `matchSpokenAnswer` scores its
 * own source material, and f comes back flattering and meaningless. That is not
 * a hypothetical failure: the option text is written as "the misconception as a
 * student who holds it would SAY it", so it is exactly the thing a model would
 * reach for.
 *
 * TWO GROUPS, REPORTED SEPARATELY, because they answer different questions.
 *
 *   blind  — answers written from the question alone. This is f as a real
 *            student produces it, and it is the honest number.
 *   primed — a student who holds the authored misconception, saying it in
 *            their own words. The probe claims to anticipate this, so it is
 *            fair to ask, but it is the friendliest case and must never be
 *            averaged into the first.
 *
 * WHAT THIS CANNOT TELL YOU, said here rather than discovered later: nobody has
 * used this product. There are no real student answers anywhere, so every
 * answer below is a model's idea of one. The per-TYPE rates this produces are
 * worth something; a single headline f is worth less, because its value depends
 * entirely on the mix of types a real classroom produces, and that mix is
 * unknown.
 *
 * Run:  node tools/measure/f-bench/generate.mjs --token "$ACCESS_TOKEN"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASKS = path.join(HERE, 'asks.json');
const OUT = path.join(HERE, 'answers.json');

const argv = process.argv.slice(2);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const token = valueOf('--token') ?? process.env.PREWARM_TOKEN;
const relay = valueOf('--relay') ?? process.env.PREWARM_RELAY_URL;
if (!token || !relay) {
  console.error('needs --token <supabase access token> and --relay <relay url>');
  process.exit(2);
}

/**
 * The seven shapes a spoken answer actually takes, named so the tally can be
 * read per type rather than as one average. The weights are NOT here on
 * purpose: assigning them would be inventing the classroom.
 */
const SHAPES = [
  ['right-plain', 'correct, said plainly in English, the way a confident student answers out loud'],
  ['right-terse', 'correct but TERSE — three or four words, the way most students actually answer aloud'],
  ['right-hinglish', 'correct, in Hinglish (Roman script, Hindi grammar, English technical nouns)'],
  ['right-hedged', 'correct, but trailing into a hedge like "shayad" or "pata nahi" at the end'],
  ['wrong-plain', 'a WRONG answer a student at this level genuinely gives — a real misunderstanding, not nonsense'],
  ['dont-know', 'a bare admission of not knowing, in English or Hinglish'],
  ['off-target', 'a rambling, half-related answer that does not settle on anything'],
];

const SYSTEM = [
  'You write what a real Indian school student SAYS OUT LOUD when a tutor asks them a question in class.',
  '',
  'Spoken, not written. Short. No full paragraphs, no textbook phrasing, no politeness. Students mumble, trail off, and answer in three words when three words will do. Many mix Hindi and English in the same sentence.',
  '',
  'You will be given a question, what a right answer should contain, and the hint the tutor gave. Write ONE answer of each requested shape.',
  '',
  'Reply with ONE JSON object and nothing else:',
  '{"answers":[{"shape":"<the shape id>","said":"<what the student says>"}]}',
].join('\n');

const blindUser = (a) =>
  [
    `Class ${a.klass}. Topic: ${a.title}`,
    '',
    `The tutor asked: ${a.ask.question}`,
    a.ask.expect ? `A right answer should contain: ${a.ask.expect}` : '',
    a.ask.hint ? `The hint she gave: ${a.ask.hint}` : '',
    '',
    'Write one answer of each of these shapes:',
    ...SHAPES.map(([id, desc]) => `- ${id}: ${desc}`),
  ]
    .filter(Boolean)
    .join('\n');

/**
 * The primed half. It IS shown one misconception — the whole point is to ask
 * whether a student holding the anticipated wrong idea, in their own words,
 * lands on the option that anticipated it. It is never shown the correct
 * option, and never the option text for anything else.
 */
const primedUser = (a, misconception) =>
  [
    `Class ${a.klass}. Topic: ${a.title}`,
    '',
    `The tutor asked: ${a.ask.question}`,
    '',
    `This student believes something wrong: ${misconception}`,
    '',
    'Write THREE ways that student might say that belief out loud when asked the question — one plain English, one terse, one Hinglish. Do not copy the sentence above; say it as a student would.',
    '',
    'Reply with ONE JSON object and nothing else:',
    '{"answers":[{"shape":"primed-plain","said":"..."},{"shape":"primed-terse","said":"..."},{"shape":"primed-hinglish","said":"..."}]}',
  ].join('\n');

const MODEL = 'google/gemini-3.7-flash';

async function ask(system, user) {
  const res = await fetch(`${relay}/api/llm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: MODEL,
      json: true,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`relay ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const text = body?.choices?.[0]?.message?.content ?? body?.text ?? '';
  const clean = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(clean);
}

const asks = JSON.parse(fs.readFileSync(ASKS, 'utf8'));
const out = [];
let calls = 0;

for (const [i, a] of asks.entries()) {
  const label = `${a.topicRef.split('/').pop()}/${a.beatId}`;
  try {
    const blind = await ask(SYSTEM, blindUser(a));
    calls += 1;

    const wrongOption = a.ask.whyProbe.options.find((o) => !o.correct);
    const primed = wrongOption ? await ask(SYSTEM, primedUser(a, wrongOption.text)) : { answers: [] };
    if (wrongOption) calls += 1;

    out.push({
      topicRef: a.topicRef,
      beatId: a.beatId,
      question: a.ask.question,
      probe: a.ask.whyProbe,
      hint: a.ask.hint ?? null,
      blind: blind.answers ?? [],
      primed: primed.answers ?? [],
    });
    console.log(`  ${String(i + 1).padStart(2)}/${asks.length}  ${label}  blind=${(blind.answers ?? []).length} primed=${(primed.answers ?? []).length}`);
  } catch (e) {
    console.log(`  ${String(i + 1).padStart(2)}/${asks.length}  ${label}  FAILED — ${e.message}`);
  }
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`\n${out.length}/${asks.length} asks answered, ${calls} relay calls. Written to ${path.relative(process.cwd(), OUT)}`);
