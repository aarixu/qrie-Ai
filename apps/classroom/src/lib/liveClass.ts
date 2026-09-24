import type { Lesson } from "@ai-tutor/lesson-format";
import { relayFetch } from './relay';
import { createCommonsSearch, type TopicOutcome, type WebImageAdapter } from '@ai-tutor/class-prep';
import {
  drawMissingIcons,
  pickIcons,
  prepareClass,
  type LlmAdapter,
  type PrepProgress,
  type PrepReport,
} from "@ai-tutor/class-prep";
import { createBrowserLlm } from "./browserLlm";
import { createBrowserImageArtist, createBrowserVision } from "./browserImage";
import { tutorLanguage, type TutorLanguage } from './workspace';
import { pencilGlyph } from '@ai-tutor/graphics';

/**
 * PREPARING ONE CLASS, LIVE.
 *
 * The recipe for turning a cold topic into a class that can be taught: plan
 * it, draw what it needs, find pictures for the nouns it places. It lives here
 * rather than in the screen that first used it because there are two callers
 * now — the canvas lab, which is how the board is verified, and the classroom
 * itself. Two copies of a four-model recipe would drift, and the lab would
 * stop being evidence about the room.
 */

/**
 * Both jobs run on gemini-3.7-flash — measured as fastest AND best on this
 * exact prompt pair (plan 13.7s Rs 0.74, draw 25.9s Rs 1.51; the pro model was
 * four times slower, eight times dearer, and drew a worse diagram).
 */
const PLANNER_MODEL = 'google/gemini-3.7-flash';
const ARTIST_MODEL = 'google/gemini-3.7-flash';
/** Picks which meaning of a word to draw. One small call, so the fastest model. */
const PICKER_MODEL = 'google/gemini-3.1-flash-lite';
/**
 * Draws a picture of a real thing on white — a kidney, a cross-section.
 *
 * Measured on a half-cut kidney: 11s and about Rs 5.75.
 *
 * THE COMPARISON THIS PARAGRAPH USED TO DRAW IS DEAD, and it inverted. It said
 * Rs 5.75 against "Rs 2.25 for the whole class without one" — a picture costing
 * two and a half times the entire class, which is a strong reason to make the
 * planner earn it. But Rs 2.25 is an OpenRouter-era price, and the billing path
 * moved underneath it: Vertex charges a generated picture as output tokens.
 * The same text-only class measured Rs 9.08 on 2026-09-13
 * (docs/architecture/README.md:183), so a picture is about 63% of the class it
 * goes into, not 250% of it.
 *
 * The instruction to the planner does NOT change, and the reason is no longer
 * the price. Three or four pictures are what take a Rs 9.08 class to the Rs 30
 * this repo plans on, so they are still most of the bill; and a picture that is
 * not worth looking at is worth nothing at any price. Earning it is a
 * pedagogical rule that happens to also be the cheaper one.
 */
const IMAGE_MODEL = 'google/gemini-3.1-flash-image';
/** Looks at a generated picture to find where its named parts are. */
const VISION_MODEL = 'google/gemini-3.7-flash';

/**
 * The pictures for the nouns a lesson places.
 *
 * Fetched from our own origin because the icon sets are a 443 MB package that
 * must never reach a browser: the dev server holds them and answers for the
 * handful one class needs. A noun no set has comes back as a pencilled circle
 * with the word in it, so the board is never blank and never wrong.
 */
/**
 * The pictures for the nouns a lesson places.
 *
 * Two steps, because the first one cannot be trusted on its own. The dev server
 * searches the bundled icon sets by name and returns every plausible candidate;
 * a model then picks which one the LESSON means. String matching put an
 * armoured vehicle on a board about water tanks, and no better matching fixes
 * that — "tank" is two things and only the topic says which.
 *
 * The choice never blocks the class: if the model fails, each noun keeps the
 * best name match, which is exactly what it had before.
 */
/** One glyph as standalone markup. Both the icon path and the pencil use it. */
const svgOf = (glyph: { body: string; width: number; height: number }): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${glyph.width} ${glyph.height}">` +
  `${glyph.body}</svg>`;

/**
 * A hand-drawn circle for every noun on the board, when no icon relay answered.
 *
 * Keyed by ELEMENT id and not by noun, for the reason the icon path gives: the
 * same noun placed twice is two pictures, and the renderer looks each one up by
 * its own id.
 *
 * Deliberately draws NOTHING with a model. The generated-icon path costs money
 * per noun, and a class falling back because a route is unhosted is the wrong
 * moment to start spending — a pencil is free, honest, and enough to make the
 * class keepable.
 */
export function pencilsFor(lesson: Lesson): Record<string, string> {
  const assets: Record<string, string> = {};
  for (const el of lesson.elements) {
    if (el.kind !== 'graphic') continue;
    assets[el.id] = svgOf(pencilGlyph(el.noun));
  }
  return assets;
}

async function fetchGraphics(
  lesson: Lesson,
  topic: string,
  llm: LlmAdapter,
  /** Draws the nouns nothing depicts. A stronger model than the picker. */
  drawIcon: LlmAdapter,
): Promise<Record<string, string>> {
  const nouns = [
    ...new Set(lesson.elements.filter((el) => el.kind === 'graphic').map((el) => el.noun)),
  ];
  if (nouns.length === 0) return {};

  // One parameter per noun. Joined with commas, a noun containing one was
  // torn in half and quietly lost both its lookup and its fallback.
  const query = new URLSearchParams();
  for (const noun of nouns) query.append('noun', noun);
  const res = await relayFetch(`/api/icons?${query}`);
  /**
   * NO ICON RELAY MEANS PENCILS, NOT NOTHING — and in production it always
   * means pencils, because the relay answers 501 there on purpose: the icon
   * index is a 443 MB package that must never reach a browser
   * (packages/relay/src/handler.ts says so beside the refusal).
   *
   * Returning `{}` here, which is what this did, was quietly worse than a
   * missing picture. `saveable()` refuses to keep a class whose `graphic`
   * elements have no artwork (packages/class-prep/src/save.ts), so every cold
   * topic opened in production was TAUGHT AND THEN THROWN AWAY — the next
   * student paid the full preparation again, forever, on every topic with a
   * noun in it. The catalogue could never warm itself.
   *
   * `pencilGlyph` is the answer the relay itself falls back to, and it is pure
   * arithmetic — a wobbled circle with the word inside, the way a teacher draws
   * a thing she cannot draw. `packages/graphics/src/resolve.ts` carries no
   * catalogue and is safe in a bundle; its own header is explicit that loading
   * the sets is somebody else's job.
   */
  if (!res.ok) return pencilsFor(lesson);

  type Glyph = { body: string; width: number; height: number };
  type Found = {
    candidates: { glyph: Glyph; source: { set: string; icon: string }; category?: string }[];
    pencil: Glyph;
  };
  const found = (await res.json()) as Record<string, Found>;

  const options = Object.fromEntries(
    Object.entries(found).map(([noun, f]) => [
      noun,
      f.candidates.map((c) => ({
        icon: c.source.icon,
        set: c.source.set,
        ...(c.category ? { category: c.category } : {}),
      })),
    ]),
  );
  const chosen = await pickIcons(topic, options, llm);

  /**
   * The picked glyph, or null when this noun has no picture worth using —
   * the model refused every option, or nothing was found at all.
   *
   * The order matters: a deliberate null falling through to candidates[0]
   * once put the very icon the model refused — a military tank — back on a
   * board about water.
   */
  const glyphFor = (noun: string): Glyph | null => {
    const f = found[noun];
    if (!f) return null;
    const pick = chosen[noun];
    if (pick?.deliberate) {
      const named =
        pick.icon && pick.set
          ? f.candidates.find((c) => c.source.icon === pick.icon && c.source.set === pick.set)
          : undefined;
      return named?.glyph ?? null;
    }
    return f.candidates[0]?.glyph ?? null;
  };

  // The nouns nothing depicts get DRAWN — a small flat SVG made to order, the
  // way a code-drawing model makes a chart with code instead of pixels. Only
  // the misses cost anything; the library answered the rest for free. What
  // fails to draw falls back to the pencilled circle, never delays the class.
  const missing = nouns.filter((n) => glyphFor(n) === null);
  const drawn =
    missing.length > 0 ? await drawMissingIcons(topic, missing, drawIcon) : {};

  const assets: Record<string, string> = {};
  for (const el of lesson.elements) {
    if (el.kind !== 'graphic') continue;
    const custom = drawn[el.noun];
    if (custom) {
      // Keyed by ELEMENT id, not by noun: the same noun placed twice is two
      // pictures, and the renderer looks each one up by its own id.
      assets[el.id] = custom;
      continue;
    }
    const glyph = glyphFor(el.noun) ?? found[el.noun]?.pencil;
    if (!glyph) continue;
    assets[el.id] = svgOf(glyph);
  }
  return assets;
}

/** Everything a class needs to be taught, made just now rather than fetched. */
export interface LivePrep {
  lesson: Lesson;
  /** Artwork by element id: SVG markup, or a picture as a data URL. */
  assets: Record<string, string>;
  report: PrepReport;
}

/**
 * Plan the class, draw it, and dress its nouns.
 *
 * The pictures are a second, much cheaper fetch than the plan, and they never
 * take the class down with them: the icon relay went down once mid-session and
 * a fully prepared lesson was thrown away with it, which is the opposite of
 * what this path promises. A noun with no picture is a gap; a thrown error
 * here would be a class nobody gets to attend.
 */
/**
 * WHERE A PICTURE IS LOOKED FOR BEFORE ONE IS PAID FOR.
 *
 * Built once: it holds no state, and it needs no API key.
 *
 * Measured over sixteen real briefs before it was switched on. Six got a
 * picture off Wikimedia Commons, which is a ₹5.75 generation saved better than
 * a third of the time; the other ten cost two or three vision calls and a
 * couple of seconds, then generated anyway.
 *
 * The refusals are what made it worth turning on. Nineteen of twenty-five were
 * the verifier catching a picture of the WRONG THING — a urinary-system chart
 * asked for a kidney, a dowsing pendulum asked for a physics one, an ovarian
 * teratoma asked for a neuron. Six more were textbook plates with the labels
 * already printed on them, which is exactly what the tutor writes herself. Not
 * one wrong picture reached a board.
 *
 * Photographs pass and diagrams do not: minerals, apparatus, places and
 * specimens are found; anatomy and microscopy on Commons are labelled plates
 * and get refused. That is the right shape — a diagram was never this rung's
 * job, it is the one the artist draws.
 */
const PICTURE_SEARCH = createCommonsSearch();

/**
 * THE LOCK IS THE CALLER'S JOB, NOT THIS FUNCTION'S — said here because the
 * money is spent inside it.
 *
 * `ask` has no `topicRef`, and a topicRef is the only key two students can
 * arrive at independently, so there is nothing here to lock ON. The gate
 * therefore sits in screens/LiveClass.tsx, which knows the topicRef and owns
 * the wait and busy screens the 'held'/'busy' answers need.
 *
 * WHICH LEAVES THREE CALLERS PREPARING UNLOCKED, named rather than left to be
 * found: screens/CanvasLab.tsx:26 (the dev lab, free-text, no topicRef — it
 * could not lock), prep5.ts:95 and prep-clone.ts:33 (offline operator
 * scripts). All three are foreign to this phase; the scripts can race a live
 * student's preparation on the same topic and pay Rs 30 twice. Recorded as a
 * handoff.
 */
export async function prepareLiveClass(
  ask: {
    topic: string;
    klass: number;
    minutes: number;
    studentLines?: readonly string[];
    /**
     * What the map says this topic is FOR.
     *
     * Without it the planner invents outcome ids and the class is measured as
     * having taught nothing — see lib/topicOutcomes.
     */
    outcomes?: readonly TopicOutcome[];
    /**
     * How a REAL teacher being cloned teaches (styleBrief). Absent for every
     * ordinary class - Curie own tutor has a persona of her own.
     */
    teacherStyle?: string;
    /**
     * WHERE TO LOOK FOR A PICTURE BEFORE PAYING TO GENERATE ONE.
     *
     * Undefined until there is a search behind it, and then every picture is
     * generated exactly as it is today. The rung is skipped rather than faked:
     * a half-search would be a web image nobody verified, which is the one
     * outcome worse than a generated one.
     *
     * Threaded through HERE rather than left for the day the search exists,
     * because a capability that reaches no call site is a capability the
     * shipped app does not have, however many tests the package has.
     */
    web?: WebImageAdapter | null;
    /**
     * WHICH LANGUAGE THE TUTOR SPEAKS THIS CLASS IN.
     *
     * Absent — which is every caller today — means the answer the child gave at
     * onboarding, read from the workspace below.
     *
     * NO CALLER PASSES IT YET, and saying otherwise would be this comment
     * claiming a safety it does not have. It exists so that a preparation
     * which is not one student's can say so outright: the difference between
     * "no opinion" and "English, please" is one a defaulted argument cannot
     * express. The three callers it is for, none of which passes it:
     * prep5.ts:95 and prep-clone.ts:33, which get 'en' from the absent
     * workspace row because Node has no localStorage — a different mechanism
     * from this one, and one that would stop protecting them the day they ran
     * in a browser; and screens/CanvasLab.tsx:26, which DOES run in a browser
     * (App.tsx:585, /canvas-lab), so a Hinglish student's canvas-lab
     * preparation comes out Hinglish today. All three are handoffs.
     */
    language?: TutorLanguage;
  },
  onProgress: (progress: PrepProgress) => void,
  /**
   * THE CLASS, AS SOON AS THE TEACHING HOLDS.
   *
   * Called once, about fourteen seconds in, with the lesson and the assets
   * record it will fill. Whoever takes it can open the room there and let the
   * pictures arrive behind the student. `onArt` fires each time one lands, so
   * a caller holding that same record knows to draw again.
   */
  warm?: {
    onDraft: (draft: { lesson: Lesson; assets: Record<string, string> }) => void;
    onArt: () => void;
  },
): Promise<LivePrep> {
  /**
   * THE ANSWER A CHILD GAVE, FINALLY READ.
   *
   * Onboarding.tsx and contest/Enrol.tsx both ask which language the tutor
   * should speak and both write it to the workspace; until this line nothing
   * anywhere read it back, and the screen said so in a comment. This is the
   * whole of the wire: `prepareClass` puts the register in the planner's
   * prompt (HINGLISH_REGISTER in packages/class-prep/src/prompts.ts) and
   * writes it onto the finished lesson.
   *
   * READ HERE, PER PREPARATION, rather than captured at module load: a
   * student can be re-onboarded on a shared device between one class and the
   * next, and a value read once would teach the previous child's language to
   * this one.
   *
   * IN A NODE SCRIPT there is no profile row, so `tutorLanguage()` returns its
   * 'en' default — which is the right answer for prep5.ts and prep-clone.ts,
   * because every class they write is committed content and all fifteen
   * committed lessons are English.
   *
   * WHAT HAPPENS TO A HINGLISH CLASS AFTERWARDS, because it is not obvious and
   * it costs money: IT IS NOT KEPT. screens/LiveClass.tsx keeps every class it
   * prepares under a unique topic_ref and serves it to every later student on
   * that topic, so keeping one would make a Hinglish preparation the permanent
   * class for students who asked for English. packages/class-prep/src/save.ts
   * refuses it, beside the refusal it already makes about a student's name.
   *
   * THAT REFUSAL IS NOT FREE, and the price falls on Hinglish students:
   * `topic_ref` is unique, so the store has no room for two languages under one
   * topic, and a Hinglish student therefore pays the full preparation on every
   * cold topic they reach and never benefits from the cache. Warm topics are
   * unaffected — they serve the English class that is there, which is what the
   * onboarding copy tells a student to expect. The wider key that would fix it
   * properly, `(topic_ref, language)`, is a migration and a relay change.
   *
   * AND WHAT IT DOES NOT REACH AT ALL: the live conversation. Everything the
   * tutor says back to an answer is written by the judge, and nothing carries
   * this value there — JUDGE_SYSTEM (packages/tutor-judge/src/prompts.ts:21-31)
   * says "say" is spoken aloud and gives no instruction about which language
   * to speak it in, and CLOSE_SYSTEM's "meet them in kind" mirrors the
   * STUDENT, not the class. So a Hinglish class narrates in Hinglish and may
   * well reply in English. That is the larger half of "the tutor speaks the
   * language the student chose", and it is a handoff to the judge, not
   * something this line can reach.
   */
  const language: TutorLanguage = ask.language ?? tutorLanguage();

  const result = await prepareClass({
    topic: ask.topic,
    language,
    ...(ask.teacherStyle ? { teacherStyle: ask.teacherStyle } : {}),
    klass: ask.klass,
    minutes: ask.minutes,
    studentLines: ask.studentLines,
    outcomes: ask.outcomes,
    planner: createBrowserLlm(PLANNER_MODEL, { json: true }),
    artist: createBrowserLlm(ARTIST_MODEL),
    imageArtist: createBrowserImageArtist(IMAGE_MODEL),
    eyes: createBrowserVision(VISION_MODEL),
    // ON by default. The whole rung reaches no student unless something
    // passes an adapter, and a default the caller must remember to supply is a
    // feature that quietly stops existing the first time a call site is
    // rewritten — which is exactly what a review found here. `web: null`
    // turns it off deliberately, which is a different thing from forgetting.
    ...(ask.web === null ? {} : { web: ask.web ?? PICTURE_SEARCH }),
    onProgress,
    ...(warm ? { onDraft: warm.onDraft, onAsset: () => warm.onArt() } : {}),
  });

  /**
   * The nouns, dressed.
   *
   * This used to run with the progress bar sitting at "Ready." — prepareClass
   * says done before this starts, so a lesson with several unlibraried nouns
   * spent a silent multi-second tail there. It now reports for itself, and
   * with warm entry the student is already in the room while it happens.
   */
  onProgress({ phase: 'drawing', message: 'Finding the pictures for each word…', done: 0.97 });

  let graphics: Record<string, string> = {};
  try {
    graphics = await fetchGraphics(
      result.lesson,
      ask.topic,
      createBrowserLlm(PICKER_MODEL, { json: true }),
      createBrowserLlm(ARTIST_MODEL),
    );
  } catch {
    // The board shows what it has.
  }

  // Into the same record the draft was handed, not a copy: the room is holding
  // that object, and a copy would leave every noun undressed for the student
  // who is already watching.
  Object.assign(result.assets, graphics);
  warm?.onArt();
  onProgress({ phase: 'done', message: 'Ready.', done: 1 });

  return { lesson: result.lesson, assets: result.assets, report: result.report };
}

/* ==========================================================================
 * THE PREPARATION LOCK, TAKEN.
 * ==========================================================================
 *
 * Preparing a cold topic is the single most expensive thing this product
 * does — the planning constant every PRD budgets on is Rs 30 a topic, against
 * a Rs 5 per-student-hour ceiling — and it is paid ONCE per topic only if the
 * students racing for it take turns. 0017 put `take_prep_lock` in Postgres
 * and packages/relay/src/prep.ts put four routes in front of it; until this,
 * nothing in the app called any of them, so N students arriving at one cold
 * topic each paid the full Rs 30 and N-1 of those payments bought a duplicate
 * of a class somebody else was already making.
 *
 * The key is ALWAYS the topicRef. 0017's header owns that argument: two
 * students reaching one topic by different derivations must take ONE lock, so
 * a derived class id would be no lock at all.
 *
 * WHO HOLDS IT IS THE USER, NOT THE PREP ID. `release_prep_lock` takes the
 * caller's user id and the relay reads that from the bearer token — so the
 * prep id below is attribution and never identity.
 */

/** What the lock answered, in the four shapes a caller must behave differently for. */
/**
 * ONE PREPARATION'S ID, AND IT MUST NEVER BE THE REASON A CLASS DOES NOT HAPPEN.
 *
 * `crypto.randomUUID` exists only in a SECURE CONTEXT. This repo has already
 * paid for forgetting that once — stores/ledger.ts:133 carries a hand-rolled
 * v4 with the reason written beside it: "http-on-a-LAN is exactly how this
 * gets opened on a school tablet or a phone pointed at a dev laptop". The prep
 * id is minted on the cold-topic path, so an unguarded call there turns such a
 * device into one that can prepare NO classes at all — the throw lands in the
 * screen's catch and paints an error over a class that was about to be made.
 *
 * And the id is only ATTRIBUTION: the lock's identity is the bearer token (see
 * WHO HOLDS IT below), and the relay's x-prep-id passthrough validates-or-
 * drops. So the worst a fallback id can cost is a usage row that cannot be
 * attributed. That is not a price worth a lesson.
 *
 * DUPLICATED FROM ledger.ts rather than imported, because stores/ledger.ts is
 * outside this phase's paths and `mint` is module-private there. Recorded as a
 * handoff: one exported mint would be better than two.
 */
export function mintPrepId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      // Present but refusing (a non-secure context on some engines). Fall through.
    }
  }
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export type PrepGate =
  /** It is ours. Prepare, renew while preparing, and release in a finally. */
  | { kind: 'granted'; prepId: string }
  /** Somebody else is preparing this very topic. Wait for THEIR class. */
  | { kind: 'held'; expiresAt?: string }
  /** The project is at its concurrency ceiling. Nobody may prepare right now. */
  | { kind: 'busy'; running: number }
  /**
   * The relay could not answer — a 503, a 501 from a host with no lock store,
   * or no network at all.
   *
   * THE CLIENT FAILS OPEN HERE AND THE RELAY FAILS CLOSED, and that is not an
   * inconsistency: the relay is protecting money and this is protecting a
   * child's lesson. An outage then costs at most what every preparation cost
   * before this file existed; refusing to teach during one costs the product.
   */
  | { kind: 'unavailable' };

/** How often the waiter asks whether the holder has finished. */
const PREP_POLL_MS = 3_000;

/**
 * How long a student waits for somebody else's class before preparing it
 * themselves.
 *
 * The lock's TTL is 180 seconds (PREP_LOCK_TTL_SECONDS in the relay), so a
 * holder that died is swept within that; a little past it is the point at
 * which waiting longer can only be waiting for nothing. Fifteen seconds of
 * slack covers a sweep that lands between two polls.
 */
const PREP_WAIT_MS = 195_000;

const prepPost = async (
  route: 'lock' | 'renew' | 'release',
  topicRef: string,
  prepId: string,
  /**
   * The page is going away. `keepalive` lets the browser finish the request
   * after the document is gone — best effort, because `relayFetch` awaits a
   * token before it calls `fetch` and a teardown can beat that. It costs
   * nothing when it does not work and saves every other student 180 seconds
   * when it does.
   */
  keepalive = false,
): Promise<unknown | null> => {
  try {
    const res = await relayFetch(`/api/prep/${route}`, {
      method: 'POST',
      ...(keepalive ? { keepalive: true } : {}),
      headers: {
        'content-type': 'application/json',
        /**
         * WHICH PREPARATION THIS IS, so `usage_event.prep_id` can attribute
         * the spend. The relay's passthrough validates the uuid or drops it
         * (handler.ts), so a malformed one costs attribution and never a call.
         *
         * HONESTLY: this stamps the LOCK calls, which are metered at zero
         * units and spend nothing. The rupees are on /api/llm, and those go
         * through `createBrowserLlm` -> `relayFetch`, neither of which this
         * phase owns and neither of which has a way to carry a per-preparation
         * header. Until one does, prep_id attributes the control calls and not
         * the planner and artist that actually cost money.
         */
        'x-prep-id': prepId,
      },
      body: JSON.stringify({ topicRef }),
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as unknown;
  } catch {
    return null;
  }
};

/**
 * Take the lock on a topic before paying to prepare it.
 *
 * `prepId` is a uuid the caller mints per preparation and keeps for the renew
 * and the release, so one preparation is one id from end to end.
 */
export async function takePrepLock(topicRef: string, prepId: string): Promise<PrepGate> {
  const answer = (await prepPost('lock', topicRef, prepId)) as {
    granted?: unknown;
    reason?: unknown;
    expiresAt?: unknown;
    running?: unknown;
  } | null;
  if (!answer || typeof answer.granted !== 'boolean') return { kind: 'unavailable' };
  if (answer.granted) return { kind: 'granted', prepId };
  if (answer.reason === 'busy') {
    return { kind: 'busy', running: typeof answer.running === 'number' ? answer.running : 0 };
  }
  /**
   * Anything not granted and not busy is treated as held. The relay sends only
   * those two reasons, and a reason we do not recognise is still somebody else
   * holding something: waiting for a class that never comes costs a bounded
   * wait, while preparing over a live holder costs Rs 30.
   */
  return {
    kind: 'held',
    ...(typeof answer.expiresAt === 'string' ? { expiresAt: answer.expiresAt } : {}),
  };
}

/**
 * Push the deadline out while a long preparation is still running.
 *
 * The TTL is twice a preparation measured on a DEVELOPMENT MACHINE, and the
 * stated device is a cheap Android. A holder that does not heartbeat looks
 * dead to the sweep, a second student wins the lock, and both preparations run
 * and both are paid for — the exact failure the lock exists to prevent,
 * arriving on the slow phone where it costs most.
 *
 * `false` means the lock is gone.
 */
export async function renewPrepLock(topicRef: string, prepId: string): Promise<boolean> {
  const answer = (await prepPost('renew', topicRef, prepId)) as { renewed?: unknown } | null;
  return answer?.renewed === true;
}

/**
 * Let it go — on success AND on failure, which is why every caller puts this
 * in a `finally`. A lock held by a browser that crashed costs every other
 * student on that topic the full 180-second TTL.
 */
export async function releasePrepLock(
  topicRef: string,
  prepId: string,
  opts: { unloading?: boolean } = {},
): Promise<void> {
  await prepPost('release', topicRef, prepId, opts.unloading === true);
}

/** 'ready' | 'preparing' | 'absent', or null when the relay could not say. */
export async function prepStateOf(
  topicRef: string,
): Promise<'ready' | 'preparing' | 'absent' | null> {
  try {
    const res = await relayFetch(`/api/prep/state?topicRefs=${encodeURIComponent(topicRef)}`);
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      states?: Record<string, unknown>;
    } | null;
    const state = body?.states?.[topicRef];
    return state === 'ready' || state === 'preparing' || state === 'absent' ? state : null;
  } catch {
    return null;
  }
}

/** What the wait ended as. */
export type PrepWait =
  /** The holder finished and kept it. Go and fetch their class. */
  | 'ready'
  /** Nobody is preparing it any more and no class appeared. Prepare it. */
  | 'gone'
  /** The student left the screen. Do nothing at all. */
  | 'cancelled';

/**
 * Wait for whoever won the lock, honestly and with a bound.
 *
 * A student who loses the race is not shown an error and is not silently made
 * to pay for a second copy: they are told somebody is preparing this class and
 * they wait for it, which is the only outcome where the Rs 30 is spent once.
 *
 * Three ways out, and the bound is what makes this safe to put in front of a
 * child: 'ready' when the winner's class lands, 'gone' when the holder died or
 * the wait ran past the lock's own TTL — in which case the caller prepares it
 * after all — and 'cancelled' when the screen went away.
 *
 * A relay that cannot answer the state is treated as still preparing rather
 * than as gone: `prepStateOf` answers null for an outage, and reading that as
 * "nobody is holding it" would send every waiting student off to prepare their
 * own copy at exactly the moment the relay is unwell.
 */
export async function waitForHolder(
  topicRef: string,
  opts: {
    isCancelled: () => boolean;
    /** How long they have been waiting, in whole seconds, for the screen. */
    onWait?: (seconds: number) => void;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<PrepWait> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();

  while (!opts.isCancelled()) {
    if (now() - startedAt >= PREP_WAIT_MS) return 'gone';
    opts.onWait?.(Math.round((now() - startedAt) / 1000));
    await sleep(PREP_POLL_MS);
    if (opts.isCancelled()) return 'cancelled';
    const state = await prepStateOf(topicRef);
    if (state === 'ready') return 'ready';
    if (state === 'absent') return 'gone';
    // 'preparing', or null for an outage: keep waiting, within the bound.
  }
  return 'cancelled';
}
