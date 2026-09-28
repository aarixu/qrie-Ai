import fs from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { MAX_ANSWER_CHARS, normaliseAnswer } from '@ai-tutor/ledger';
import { MicRationale } from '../src/ui/MicRationale';
import { Enrol } from '../src/screens/contest/Enrol';
import { TrialConsent } from '../src/screens/contest/TrialConsent';
import { buildStudentContext, studentLinesForPlanner } from '../src/lib/student';
import { plannerTopicFromSource } from '../src/lib/sourceText';

/**
 * WHAT A CHILD AND A PARENT ARE TOLD ABOUT THEIR DATA MUST BE WHAT THE CODE DOES.
 *
 * Four places make that promise in words a person actually reads: the mic
 * screen, shown to a student before the phone asks for the microphone; the
 * public /privacy page, read by a parent; the parent's consent step in the
 * contest enrolment; and the trial screen a child reads before watching a
 * class with no parent at all. All four were wrong. The mic screen said
 * "Nothing is recorded or kept" while a speech service turned every spoken
 * answer into text and a short copy of that text sat in `ledger_event`. The
 * privacy page named no model vendor at all, and said usage records were
 * deleted after 90 days when the nightly purge never touches `usage_event`.
 * The consent step said a child's words were handed to nobody else, and the
 * trial screen said a report was the one thing that left the page — while
 * every spoken answer and every doubt went to Google to be heard and answered.
 *
 * So every number and every "kept for" below is read out of the SQL or the
 * code it describes, not typed in twice. If a migration changes the window, or
 * stops the purge deleting by age alone, these fail — and the fix is the
 * sentence a child reads, not this test.
 */

const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations');

/** Every migration, in the order Postgres applies them. */
const migrations = (): string[] =>
  fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'));

/**
 * The window the nightly job actually passes — from the LAST migration that
 * schedules it, because a later `cron.schedule` of the same name replaces the
 * earlier one.
 */
function scheduledPurgeDays(): number {
  let days: number | null = null;
  for (const sql of migrations()) {
    for (const m of sql.matchAll(/cron\.schedule\(\s*'purge-old-ledger'[\s\S]*?purge_old_ledger\((\d+)\)/g)) {
      days = Number(m[1]);
    }
  }
  if (days === null) throw new Error('no migration schedules purge-old-ledger');
  return days;
}

/** The body of the LAST definition of purge_old_ledger — the one that runs. */
function purgeBody(): string {
  let body: string | null = null;
  for (const sql of migrations()) {
    for (const m of sql.matchAll(/create or replace function public\.purge_old_ledger[\s\S]*?\$\$([\s\S]*?)\$\$;/gi)) {
      body = m[1];
    }
  }
  if (body === null) throw new Error('no migration defines purge_old_ledger');
  return body;
}

/** The tables the purge deletes from. */
const purgedTables = (): string[] =>
  [...purgeBody().matchAll(/delete from public\.(\w+)/gi)].map((m) => m[1]).sort();

/** What the mic screen shows, as text, the way a screen reader would read it. */
function micScreenText(): string {
  const host = document.createElement('div');
  host.innerHTML = renderToString(<MicRationale onAllow={() => {}} onSkip={() => {}} />);
  return (host.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The words a visitor to /privacy reads, pulled out of the page's source.
 *
 * READ, NOT RENDERED, and that is a choice forced by where the page lives: it
 * is a Next.js page in landing/, which this vitest config does not include and
 * whose `next/link` and `@/` imports resolve only inside landing's own
 * toolchain. The page is static prose — no state, no data, no branches — so
 * its visible text is its string attributes plus what is left between its
 * tags. Only what sits inside <LegalPage> is read: the docblock above it is
 * written for Aarav, not for a parent, and is not on the page.
 */
function privacyPageText(): string {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'landing/app/privacy/page.tsx'), 'utf8');
  const component = source.slice(source.indexOf('<LegalPage'), source.lastIndexOf('</LegalPage>'));
  const attributes = [...component.matchAll(/\b(?:eyebrow|title|accent|updated|lede)="([^"]*)"/g)].map((m) => m[1]);
  const body = component
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{' '\}/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  return [...attributes, body].join(' ').replace(/\s+/g, ' ').trim();
}

const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?])\s+/);

/** A screen, rendered, as the text a reader meets on it. */
function screenText(screen: ReactElement, at = '/'): string {
  const host = document.createElement('div');
  host.innerHTML = renderToString(<MemoryRouter initialEntries={[at]}>{screen}</MemoryRouter>);
  return (host.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The /privacy paragraph about Google Vertex AI: from its name to the next service's. */
function vertexParagraph(): string {
  const text = privacyPageText();
  const start = text.indexOf('Google Vertex AI —');
  const end = text.indexOf('Wikimedia Commons —', start);
  if (start < 0 || end < 0) throw new Error('/privacy has no Google Vertex AI paragraph');
  return text.slice(start, end);
}

/** The one sentence of the Vertex paragraph that opens with `opening`. */
function vertexSentence(opening: RegExp): string {
  const found = sentencesOf(vertexParagraph()).find((s) => opening.test(s));
  if (found === undefined) throw new Error(`the Google Vertex AI paragraph has no sentence matching ${opening}`);
  return found;
}

describe('the window both screens promise', () => {
  it('is a real, scheduled window', () => {
    expect(scheduledPurgeDays()).toBeGreaterThan(0);
  });

  it('is enforced by age alone, so "deleted after N days" is true of every answer', () => {
    // The LMS lane's 0021 rewrites the purge to delete only what a server fold
    // has already covered — and no fold exists yet, so from that migration on
    // it deletes NOTHING. When that lands here, this fails, and the mic screen
    // and /privacy must stop saying "deleted after 90 days" in the same change.
    //
    // WHAT THIS CANNOT SEE: it reads this checkout's migrations only. 0021
    // lives in the LMS worktree, and pushing it to the live database from
    // there changes production without changing anything here, so this stays
    // green while both screens become false. That gap is closed in the plan,
    // not here: its step for the push says 0021 must first be amended to keep
    // deleting by age (docs/handoff/2026-09-26-state-of-play.md, "Blocked on
    // Aarav", step 14).
    expect(purgeBody()).toMatch(/delete from public\.ledger_event where received_at < cutoff;/i);
    expect(purgeBody()).not.toMatch(/purge_safe_before/i);
  });
});

describe('the mic screen', () => {
  it('no longer says nothing is recorded or kept', () => {
    const text = micScreenText();
    expect(text).not.toMatch(/nothing is recorded/i);
    expect(text).not.toMatch(/nothing is (recorded or )?kept/i);
  });

  it('says a speech service — Google — turns what they say into text', () => {
    const text = micScreenText();
    expect(text).toMatch(/speech service/i);
    expect(text).toMatch(/Google/);
    expect(text).toMatch(/into text/i);
  });

  it('says a short written copy of the answer is kept, for the window the database enforces', () => {
    const text = micScreenText();
    expect(text).toMatch(/short written copy of your answer/i);
    expect(text).toContain(`${scheduledPurgeDays()} days`);
  });

  it('still says the phone asks next, and still offers a way to say no', () => {
    const text = micScreenText();
    expect(text).toMatch(/your phone will ask you next/i);
    expect(text).toMatch(/not now/i);
  });
});

describe('the /privacy page', () => {
  it('names every service that handles a student’s data when the tutor runs in production', () => {
    const text = privacyPageText();
    for (const vendor of ['Supabase', 'Vercel', 'Google Vertex AI', 'Wikimedia Commons']) {
      expect(text, `missing: ${vendor}`).toContain(vendor);
    }
  });

  it('names Sentry and PostHog, and says they are off unless switched on', () => {
    // apps/classroom/src/lib/telemetry.ts sends to both, and only when
    // VITE_SENTRY_DSN or VITE_POSTHOG_KEY is set at build time.
    const text = privacyPageText();
    expect(text).toContain('Sentry');
    expect(text).toContain('PostHog');
    expect(text).toMatch(/switched off unless we turn them on/i);
  });

  it('mentions OpenRouter and Deepgram only as what the tutor used before, never as current', () => {
    // Named at all, because the plan's exit for this page lists both: a parent
    // is owed the vendors that heard their child before September's switch.
    // Without these two lines, deleting the history sentence left the loop
    // below with nothing to check, and it passed.
    const text = privacyPageText();
    expect(text).toContain('OpenRouter');
    expect(text).toContain('Deepgram');
    const past = sentencesOf(text).filter((s) => /OpenRouter|Deepgram/.test(s));
    expect(past.length).toBeGreaterThan(0);
    for (const sentence of past) {
      expect(sentence, sentence).toMatch(/\b(until|no longer)\b/i);
    }
  });

  it('states no retention window the database does not enforce', () => {
    const windows = [...privacyPageText().matchAll(/(\d+)\s*days/g)].map((m) => Number(m[1]));
    expect(windows.length).toBeGreaterThan(0);
    for (const days of windows) expect(days).toBe(scheduledPurgeDays());
  });

  it('does not put usage records inside that window, because the purge never deletes them', () => {
    // If a migration ever adds usage_event to the purge, this first line fails
    // and the page may then say so — not before.
    expect(purgedTables()).toEqual(['learning_session', 'ledger_event']);
    for (const sentence of sentencesOf(privacyPageText())) {
      if (/usage|how much/i.test(sentence)) expect(sentence, sentence).not.toMatch(/\d+\s*days/);
    }
  });

  it('gives the answer cap the ledger actually enforces', () => {
    expect(privacyPageText()).toContain(`${MAX_ANSWER_CHARS} characters`);
    // "Cut off at 200" is only true if nothing kept is longer, ellipsis
    // included — including an answer with no space to cut on.
    for (const long of ['x'.repeat(MAX_ANSWER_CHARS * 2), `${'a'.repeat(50)} ${'b'.repeat(400)}`]) {
      expect(normaliseAnswer(long)!.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
    }
  });

  it('says a flagged answer keeps none of its words — which is what the ledger does', () => {
    expect(privacyPageText()).toMatch(/flags an answer, we keep none of its words/i);
    expect(normaliseAnswer('mujhe marna hai', { flagged: true })).toBeUndefined();
  });
});

/**
 * WHAT GOOGLE IS TOLD ABOUT THE STUDENT, READ OUT OF THE CODE THAT TELLS IT.
 *
 * /privacy said Google received "the topic and the class it is for" to prepare
 * a class. It also receives a summary of the student's record — every line
 * `studentLinesForPlanner` writes goes into the planner's prompt, which the
 * relay sends to Vertex — and, for a page the student brought, the page
 * itself (`plannerTopicFromSource` quotes it whole). The doubt tutor is sent
 * `buildStudentContext` on the same road.
 *
 * So these build the real lines from a student with a record in every
 * column, and require the page to own up to each KIND of line. A new kind
 * that nobody maps here fails, which is the point: the day the planner is
 * told something new about a child, the page has to say so in the same
 * change.
 */
describe('what /privacy says Google Vertex AI receives', () => {
  const today = new Date('2026-09-29T12:00:00Z');
  const progress = {
    lessons: {
      a: { beatIndex: 0, completedAt: '2026-09-29T08:00:00Z' },
      b: { beatIndex: 0, completedAt: '2026-09-28T08:00:00Z' },
    },
    lastLessonId: 'a',
  };
  const profile = { name: null, klass: 9, subjects: ['Science'], diagnostic: null, diagnosedAt: null };

  /** Every kind of line the planner can be given, and the words on /privacy that own up to it. */
  const PLANNER_LINES: [RegExp, RegExp][] = [
    [/^They have studied \d+ days in a row\./, /how many days in a row you have studied/i],
    [/^They answered wrong on:/, /which ideas you got right or wrong/i],
    [/^They answered correctly on:/, /which ideas you got right or wrong/i],
    [/^They raised a hand on:/, /what you raised a hand on/i],
    [/^They hold securely:/, /what you know well/i],
    [/^The ground is shaky under:/, /what is still shaky/i],
    [/^Their last class with you was/, /the last class you took/i],
  ];

  it('owns up to every kind of line the class planner is told about the student', () => {
    const lines = studentLinesForPlanner({
      profile,
      progress,
      outcomes: {
        answeredWrong: { 'o.wrong': 1 },
        confused: { 'o.hand': 1 },
        answeredRight: { 'o.right': 1 },
      },
      mastery: { 'o.strong': 0.9, 'o.shaky': 0.2 },
      statement: (id) => `the idea called ${id}`,
      lastClass: { title: 'Life processes', daysAgo: 3 },
      today,
    });
    // A student with a record in every column: one line of every kind.
    expect(lines).toHaveLength(PLANNER_LINES.length);

    const prepare = vertexSentence(/^To prepare a class/);
    for (const line of lines) {
      const kind = PLANNER_LINES.find(([written]) => written.test(line));
      expect(kind, `a planner line /privacy has no words for: ${line}`).toBeDefined();
      expect(prepare, line).toMatch(kind![1]);
    }
  });

  it('says a page the student brings is sent, because its words go into the prompt', () => {
    const words = 'Mitochondria release energy from food inside every cell.';
    expect(plannerTopicFromSource({ title: 'My notes', text: words, truncated: false })).toContain(words);
    expect(vertexSentence(/^If you bring your own page/)).toMatch(/receives the words on that page/i);
  });

  /** Every field the doubt tutor can be given, and the words on /privacy that own up to it. */
  const DOUBT_FIELDS: Record<string, RegExp> = {
    klass: /your class/i,
    attendance: /how many days in a row you have studied/i,
    doubtCount: /how many times you have raised a hand/i,
    mastery: /how well you seem to know/i,
  };

  it('owns up to every field the doubt tutor is told about the student', () => {
    const context = buildStudentContext({
      profile,
      klass: 9,
      progress,
      doubts: [{ lessonId: 'L', beatId: 'b1', at: '2026-09-29T08:10:00Z' }],
      lessonId: 'L',
      nodeIds: ['o.strong'],
      mastery: { 'o.strong': 0.9 },
      today,
    });
    expect(context).not.toBeNull();
    const fields = Object.keys(context!);
    expect(fields.sort()).toEqual(Object.keys(DOUBT_FIELDS).sort());

    const doubt = vertexSentence(/^When you ask a doubt/);
    for (const field of fields) expect(doubt, field).toMatch(DOUBT_FIELDS[field]);
  });
});

/**
 * THE PARENT'S CONSENT, AND THE CHILD WHO HAS NO PARENT HERE YET.
 *
 * Both screens describe where a child's words go, and both said less than the
 * code does. lib/ear.ts posts every spoken answer to /api/hear, and a typed
 * doubt goes to /api/llm; wherever the relay has a Google service account,
 * packages/relay/src/handler.ts sends both to Vertex (vertexHear.test.ts pins
 * that no OpenRouter call is made). A trial is no exception — it plays the
 * same ClassRoom, with the same ear and the same raised hand.
 */
describe('the parent consent step', () => {
  const text = () => screenText(<Enrol initialStep="consent" />, '/enrol');

  it('no longer tells a parent the child’s words are handed to nobody else', () => {
    expect(text()).not.toMatch(/hand it to anybody else/i);
  });

  it('says the words go to Google, to be turned into text and answered', () => {
    expect(text()).toMatch(/Google/);
    expect(text()).toMatch(/turns speech into text/i);
  });
});

describe('the trial screen', () => {
  const text = () => screenText(<TrialConsent />, '/try');

  it('no longer says a report is the one thing that leaves the page', () => {
    expect(text()).not.toMatch(/one thing that does leave/i);
  });

  it('says what the child says out loud, and any question they type, goes to Google', () => {
    expect(text()).toMatch(/Google/);
    expect(text()).toMatch(/what you say out loud/i);
    expect(text()).toMatch(/question you type/i);
  });

  it('still names the report as kept', () => {
    expect(text()).toMatch(/report/i);
  });
});
