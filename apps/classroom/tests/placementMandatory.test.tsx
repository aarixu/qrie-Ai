import { Suspense, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes, matchRoutes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answerProbe, selectNextProbe, startSession } from '@ai-tutor/diagnostic';
import type { DiagnosticResult } from '@ai-tutor/knowledge-graph';
import { AppRoutes, Gate, PlacementRequired, gateTo } from '../src/App';
import { loadDiagnosticDataFor, hasPlacementFor } from '../src/lib/diagnosticData';
import { buildPlacementResult, mergeSittings } from '../src/lib/placementPlan';
import { MIN_SPLASH_MS } from '../src/screens/Splash';
import {
  adoptLegacyPlacement,
  isPlacementGated,
  placementKey,
  placementStatus,
  placementSubjects,
  recordFinished,
  restoreSitting,
  safeNext,
  salvageSitting,
  saveSitting,
} from '../src/lib/placement';
import { TRIAL_HOME, TRIAL_KEY } from '../src/lib/workspace';
import { Diagnostic } from '../src/screens/Diagnostic';
import { Home } from '../src/screens/Home';
import { Onboarding } from '../src/screens/Onboarding';
import { PLACEMENT_BLOCKED_BODY, PLACEMENT_BLOCKED_TITLE, PlacementRoute } from '../src/screens/Placement';
import { connectSync, mergePlan } from '../src/lib/sync';
import { touchedAt } from '../src/stores/localStore';
import { EMPTY_PLACEMENT, PLACEMENT_KEY, placementStore, type PlacementState } from '../src/stores/placement';
import { profileStore, type StudentProfile } from '../src/stores/profile';
import { progressStore } from '../src/stores/progress';
import { settingsStore } from '../src/stores/settings';

/**
 * THE PLACEMENT TEST IS NOT OPTIONAL (Aarav, 2026-09-30).
 *
 * Read in the order a student meets it: onboarding has no way past it; a test
 * can be paused and picks up on the same question; nothing that opens a class
 * or a lesson does so until every chosen subject is placed; and the doors that
 * were confined before — the trial, the guest, the contest — are confined
 * exactly as they were.
 */

const EMPTY_PROFILE: StudentProfile = {
  name: null,
  klass: null,
  subjects: [],
  diagnostic: null,
  diagnosedAt: null,
};

/** A settled Class 10 student who picked both subjects, as onboarding leaves them. */
function settle(subjects: string[] = ['Science', 'Mathematics'], klass = 10): void {
  profileStore.set({ ...EMPTY_PROFILE, name: 'Asha', klass, subjects });
  settingsStore.set({ klass });
}

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  // The stores cache in memory; clearing storage alone leaves the last test's value.
  profileStore.set({ ...EMPTY_PROFILE });
  settingsStore.set({ klass: null });
  placementStore.set({ ...EMPTY_PLACEMENT, records: {}, retaking: [] });
  progressStore.set({ lessons: {}, lastLessonId: null });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
});

/** Shows where the router ended up, so a test can read a navigation. */
function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

async function mount(at: string, routes: React.ReactNode): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[at]}>
        <Routes>{routes}</Routes>
        <Where />
      </MemoryRouter>,
    );
  });
  return host;
}

const where = (host: HTMLElement): string =>
  host.querySelector('[data-testid="where"]')?.textContent ?? '';

const button = (host: HTMLElement, text: RegExp | string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll('button')].find((b) =>
    typeof text === 'string' ? b.textContent?.includes(text) : text.test(b.textContent ?? ''),
  );

async function click(el: HTMLElement | undefined, what: string): Promise<void> {
  if (!el) throw new Error(`nothing to press: ${what}`);
  await act(async () => {
    el.click();
  });
}

const RUNNER_ROUTES = (
  <>
    <Route path="/diagnostic" element={<PlacementRoute />} />
    <Route path="/" element={<div>home</div>} />
    <Route path="/plan" element={<div>plan</div>} />
    <Route path="/lesson/:id" element={<div>lesson</div>} />
  </>
);

// --------------------------------------------------------------- onboarding --

describe('onboarding has no way past the placement test', () => {
  async function walkToReady(): Promise<HTMLElement> {
    const host = await mount(
      '/onboarding',
      <>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/diagnostic" element={<div>placement</div>} />
        <Route path="/" element={<div>home</div>} />
      </>,
    );
    await click(button(host, "I'm here on my own"), 'the own-door card');
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Your first name"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, 'Asha');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button(host, 'Continue'), 'name -> class');
    // Class 10 has a map for both of its subjects.
    await click(
      [...host.querySelectorAll('button')].find((b) => b.textContent?.replace(/\s/g, '') === 'Class10'),
      'class 10',
    );
    await click(button(host, 'Continue'), 'subjects -> language');
    await click(button(host, 'Continue'), 'language -> interests');
    await click(button(host, /Skip for now|Continue/), 'interests -> when');
    await click(button(host, /Remind me then|No reminders for now/), 'when -> ready');
    return host;
  }

  it('offers only the start of the test on the last step — no skip', async () => {
    const host = await walkToReady();
    expect(host.textContent).toMatch(/Let's find your level/);
    expect(button(host, 'Start the placement test')).toBeDefined();
    // The old second button. Nothing on this step may lead anywhere but the test.
    expect(button(host, /skip/i)).toBeUndefined();
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Skip for now');
  });

  it('says the classes open once it is done, and that it can be finished later', async () => {
    const host = await walkToReady();
    expect(host.textContent).toMatch(/finish later/i);
    expect(host.textContent).toMatch(/classes open once it is done/i);
  });

  it('goes straight to the test', async () => {
    const host = await walkToReady();
    await click(button(host, 'Start the placement test'), 'start');
    expect(where(host)).toBe('/diagnostic');
    expect(profileStore.get().subjects.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------- which subjects --

describe('the test is per chosen subject, and only where a map exists', () => {
  it('agrees with the loader about which (class, subject) pairs can be placed', () => {
    for (const klass of [6, 7, 8, 9, 10, 11, 12]) {
      for (const subject of ['Science', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'English']) {
        expect(hasPlacementFor(klass, subject), `${klass} ${subject}`).toBe(
          loadDiagnosticDataFor(klass, [subject]) !== null,
        );
      }
    }
  });

  it('owes one test per chosen subject, in the order they were chosen', () => {
    settle(['Science', 'Mathematics']);
    expect(placementSubjects(10, ['Science', 'Mathematics'])).toEqual(['Science', 'Mathematics']);
    expect(placementStatus(placementStore.get(), profileStore.get(), 10).owed).toEqual([
      'Science',
      'Mathematics',
    ]);
  });

  it('owes nothing for a class with no map, so nobody is locked out of a class that cannot be placed', () => {
    settle([], 12);
    expect(placementSubjects(12, [])).toEqual([]);
    expect(placementStatus(placementStore.get(), profileStore.get(), 12).owed).toEqual([]);
  });

  it('stops owing a subject once its test is finished, and owes nothing when all are', () => {
    settle(['Science', 'Mathematics']);
    const sitting = finishedSitting('Science');
    recordFinished(10, 'Science', sitting);
    expect(placementStatus(placementStore.get(), profileStore.get(), 10).owed).toEqual(['Mathematics']);
    recordFinished(10, 'Mathematics', finishedSitting('Mathematics'));
    expect(placementStatus(placementStore.get(), profileStore.get(), 10).owed).toEqual([]);
  });
});

// -------------------------------------------------------------------- gating --

describe('the Gate: no class, topic or lesson until the placement is done', () => {
  const due = (at: string, search = '') =>
    gateTo(at, { settled: true, trial: false, bench: false, placementDue: true, search });

  it('sends a lesson, a class, a topic, a practice quiz and a lesson end to the test, carrying where they were going', () => {
    expect(due('/lesson/class10-blood')).toBe('/diagnostic?next=%2Flesson%2Fclass10-blood');
    expect(due('/class/class10-science/life-processes/respiration')).toBe(
      `/diagnostic?next=${encodeURIComponent('/class/class10-science/life-processes/respiration')}`,
    );
    // A typed topic rides in the query, and the deep link keeps it.
    expect(due('/class', '?topic=volcanoes')).toBe(
      `/diagnostic?next=${encodeURIComponent('/class?topic=volcanoes')}`,
    );
    expect(due('/quiz/class10-blood')).not.toBeNull();
    expect(due('/complete/class10-blood')).not.toBeNull();
  });

  it('leaves everything else open — home, the test itself, the catalogue, the plan, settings', () => {
    for (const at of [
      '/',
      '/diagnostic',
      '/syllabus',
      '/chapter/class10-science/life-processes',
      '/plan',
      '/profile',
      '/settings',
      '/progress',
      '/help',
      '/onboarding',
      '/try',
      '/enrol',
    ]) {
      expect(due(at), at).toBeNull();
    }
  });

  it('opens them once the placement is done', () => {
    const done = (at: string) =>
      gateTo(at, { settled: true, trial: false, bench: false, placementDue: false });
    expect(done('/lesson/class10-blood')).toBeNull();
    expect(done('/class/class10-science/life-processes/respiration')).toBeNull();
  });

  it('leaves a trial confined exactly as before, placement or not', () => {
    const trial = (at: string, settled: boolean) =>
      gateTo(at, { settled, trial: true, bench: false, placementDue: true });
    expect(trial(TRIAL_HOME, false)).toBeNull();
    expect(trial(TRIAL_HOME, true)).toBeNull();
    expect(trial('/class/life-processes', true)).toBe('/try?blocked=%2Fclass%2Flife-processes');
    expect(trial('/diagnostic', false)).toBe('/try?blocked=%2Fdiagnostic');
    expect(trial('/syllabus', true)).toBeNull();
  });

  it('still sends a visitor who has not onboarded to onboarding, and leaves the benches alone', () => {
    expect(gateTo('/lesson/x', { settled: false, trial: false, bench: false, placementDue: true })).toBe(
      '/onboarding',
    );
    expect(gateTo('/lesson/x', { settled: true, trial: false, bench: true, placementDue: true })).toBeNull();
  });

  it('names the gated routes in one place', () => {
    expect(isPlacementGated('/lesson/x')).toBe(true);
    expect(isPlacementGated('/class')).toBe(true);
    expect(isPlacementGated('/classes')).toBe(false);
    expect(isPlacementGated('/chapter/a/b')).toBe(false);
  });

  /**
   * react-router 7 decodes the path and matches without regard to case, so
   * every one of these opens a gated route (checked against matchRoutes
   * below, not assumed). Read raw, each walked past the Gate into a class.
   */
  const SPELLINGS = [
    '/Lesson/class10-blood',
    '/LESSON/class10-blood',
    '/%6Cesson/class10-blood',
    '/le%73son/class10-blood',
    '/CLASS',
    '/Class/class10-science/life-processes',
    '/%63lass',
    '/QUIZ/class10-blood',
    '/Complete/class10-blood',
    '/%63omplete/class10-blood',
  ];

  it('reads a path the way the router matches it: any case, percent-encoded or not', () => {
    const table = [
      { path: '/lesson/:lessonId' },
      { path: '/class/*' },
      { path: '/quiz/:lessonRef' },
      { path: '/complete/:lessonId' },
      { path: '*' },
    ];
    for (const at of SPELLINGS) {
      const matched = matchRoutes(table, at)?.at(-1)?.route.path;
      expect(matched, at).not.toBe('*');
      expect(isPlacementGated(at), at).toBe(true);
      expect(due(at), at).toBe(`/diagnostic?next=${encodeURIComponent(at)}`);
    }
    // A typed topic in any case still carries its query to the test.
    expect(due('/CLASS', '?topic=volcanoes')).toBe(
      `/diagnostic?next=${encodeURIComponent('/CLASS?topic=volcanoes')}`,
    );
    // What the router does NOT match stays ungated, exactly as before.
    for (const at of ['/classes', '/lesson%2Fx', '/Chapter/a/b', '/%E0%A4%A']) {
      expect(isPlacementGated(at), at).toBe(false);
    }
  });

  it('only ever sends a student on to a path inside this app', () => {
    expect(safeNext('/lesson/x')).toBe('/lesson/x');
    expect(safeNext('/class?topic=volcanoes')).toBe('/class?topic=volcanoes');
    expect(safeNext('//evil.example/x')).toBeNull();
    expect(safeNext('https://evil.example/')).toBeNull();
    expect(safeNext('/\\evil.example')).toBeNull();
    expect(safeNext('/diagnostic')).toBeNull();
    expect(safeNext(null)).toBeNull();
  });
});

// ------------------------------------------------------------ finish later --

/** A Science sitting with `count` real answers, built the way the screen builds it. */
function sittingWith(
  subject: string,
  count: number,
  choose: (i: number) => number | null = (i) => i % 4,
) {
  const data = loadDiagnosticDataFor(10, [subject])!;
  let session = startSession(data.index, data.bank, {
    klass: 10,
    subjects: data.subjects,
    lookBack: data.lookBack,
  });
  const before = session.mastery;
  for (let i = 0; i < count; i++) {
    const probe = selectNextProbe(session, data.index, data.bank)!;
    session = answerProbe(session, data.index, probe, choose(i), 1_000);
  }
  return { data, session, before, sitting: saveSitting(session, before, data.index, 10, [subject]) };
}

function finishedSitting(subject: string) {
  return sittingWith(subject, 20, () => null).sitting;
}

describe('a paused test is kept exactly', () => {
  it('saves and restores a sitting without losing a belief, an answer or the next question', () => {
    const { data, session, before, sitting } = sittingWith('Science', 6);
    // Through JSON, because that is what localStorage and the cloud row do to it.
    const restored = restoreSitting(JSON.parse(JSON.stringify(sitting)), data, 10, ['Science'])!;
    expect(restored).not.toBeNull();
    expect(restored.session.mastery).toEqual(session.mastery);
    expect(restored.session.answers).toEqual(session.answers);
    expect([...restored.session.askedNodeIds].sort()).toEqual([...session.askedNodeIds].sort());
    expect(restored.session.config).toEqual(session.config);
    expect(restored.before).toEqual(before);
    expect(selectNextProbe(restored.session, data.index, data.bank)?.id).toBe(
      selectNextProbe(session, data.index, data.bank)?.id,
    );
  });

  it('keeps only the beliefs that moved, so the saved row stays small', () => {
    const { sitting, data } = sittingWith('Science', 6);
    expect(Object.keys(sitting.mastery).length).toBeLessThan(data.index.size);
  });

  it('refuses a sitting that belongs to another class or subject, rather than resuming the wrong test', () => {
    const { sitting } = sittingWith('Science', 3);
    const maths = loadDiagnosticDataFor(10, ['Mathematics'])!;
    expect(restoreSitting(sitting, maths, 10, ['Mathematics'])).toBeNull();
    const science9 = loadDiagnosticDataFor(9, ['Science'])!;
    expect(restoreSitting(sitting, science9, 9, ['Science'])).toBeNull();
  });

  it('refuses a saved row that is not the shape this build writes, rather than throwing on every visit', async () => {
    const { data, sitting } = sittingWith('Science', 3);
    const broken = [
      { ...sitting, config: { ...sitting.config, subjects: undefined } },
      { ...sitting, config: undefined },
      { ...sitting, asked: 'x' },
      { ...sitting, seeded: undefined },
      { ...sitting, mastery: null },
      { ...sitting, answers: [null] },
    ] as unknown as never[];
    for (const row of broken) {
      expect(() => restoreSitting(row, data, 10, ['Science'])).not.toThrow();
      expect(restoreSitting(row, data, 10, ['Science'])).toBeNull();
    }

    // And the test itself opens on a fresh first question over such a row.
    settle(['Science']);
    placementStore.set({
      ...EMPTY_PLACEMENT,
      records: {
        [placementKey(10, 'Science')]: {
          completedAt: null,
          finished: null,
          open: { ...sitting, config: { ...sitting.config, subjects: undefined } } as never,
        },
      },
      retaking: [],
    });
    const host = await mount('/diagnostic', RUNNER_ROUTES);
    expect(host.textContent).toContain('1 / 20');
    expect(button(host, 'Finish later')).toBeDefined();
  });

  it('the screen opens a saved sitting on the next question, counting the ones already answered', () => {
    const { data, session, sitting } = sittingWith('Science', 5);
    const next = selectNextProbe(session, data.index, data.bank)!;
    const html = renderToString(
      <Diagnostic
        klass={10}
        subjects={['Science']}
        resume={sitting}
        onComplete={() => {}}
        onFinishLater={() => {}}
      />,
    )
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    expect(html).toContain(next.question);
    expect(html).toContain('6 / 20');
    expect(html).toContain('Finish later');
  });

  it('finish later leaves the test, and coming back resumes the same sitting with its answers', async () => {
    settle(['Science', 'Mathematics']);
    let host = await mount('/diagnostic', RUNNER_ROUTES);
    // Three real answers to Science, the first chosen subject.
    for (let i = 0; i < 3; i++) {
      const options = [...host.querySelectorAll('button')].filter((b) =>
        b.className.startsWith('group '),
      );
      await click(options[0], `option A of question ${i + 1}`);
    }
    const saved = placementStore.get().records[placementKey(10, 'Science')]?.open;
    expect(saved?.answers).toHaveLength(3);

    await click(button(host, 'Finish later'), 'finish later');
    expect(where(host)).toBe('/');
    // Still owed: pausing is not finishing.
    expect(placementStatus(placementStore.get(), profileStore.get(), 10).owed).toEqual([
      'Science',
      'Mathematics',
    ]);

    for (const root of roots.splice(0)) act(() => root.unmount());
    document.body.innerHTML = '';

    host = await mount('/diagnostic', RUNNER_ROUTES);
    const data = loadDiagnosticDataFor(10, ['Science'])!;
    const restored = restoreSitting(saved!, data, 10, ['Science'])!;
    const expected = selectNextProbe(restored.session, data.index, data.bank)!;
    expect(host.textContent).toContain(expected.question);
    expect(host.textContent).toContain('4 / 20');
    // The three answers are still the three answers.
    expect(placementStore.get().records[placementKey(10, 'Science')]?.open?.answers).toEqual(
      saved!.answers,
    );
  });
});

// --------------------------------------------------- sent here by the Gate --

describe('a student sent here from a class is told why, kindly', () => {
  it('explains before asking, names each subject, and can be put off', async () => {
    settle(['Science', 'Mathematics']);
    const host = await mount(`/diagnostic?next=${encodeURIComponent('/lesson/class10-blood')}`, RUNNER_ROUTES);
    expect(host.textContent).toContain(PLACEMENT_BLOCKED_TITLE);
    expect(host.textContent).toContain(PLACEMENT_BLOCKED_BODY);
    expect(PLACEMENT_BLOCKED_BODY).toMatch(/no marks/i);
    expect(PLACEMENT_BLOCKED_BODY).toMatch(/carry on|pick up/i);
    expect(host.textContent).toContain('Science');
    expect(host.textContent).toContain('Mathematics');
    // No question until they say go.
    expect(host.textContent).not.toMatch(/\d+ \/ 20/);
    await click(button(host, 'Not now'), 'not now');
    expect(where(host)).toBe('/');
  });

  it('runs every subject, then opens the class they were going to — and the Gate lets them in', async () => {
    settle(['Science', 'Mathematics']);
    const host = await mount(`/diagnostic?next=${encodeURIComponent('/lesson/class10-blood')}`, RUNNER_ROUTES);
    await click(button(host, 'Start the placement test'), 'start');

    const notSure = async (limit: number) => {
      for (let i = 0; i < limit; i++) {
        const unsure = button(host, "I'm not sure");
        if (!unsure) return;
        await click(unsure, 'not sure');
      }
    };

    await notSure(25);
    // Between subjects: a pause point, not a wall.
    expect(host.textContent).toMatch(/Science is done/);
    expect(button(host, 'Finish later')).toBeDefined();
    expect(placementStatus(placementStore.get(), profileStore.get(), 10).owed).toEqual(['Mathematics']);
    await click(button(host, 'Carry on with Mathematics'), 'carry on');

    await notSure(25);
    expect(where(host)).toBe('/lesson/class10-blood');
    expect(placementStatus(placementStore.get(), profileStore.get(), 10).owed).toEqual([]);
    // One plan, from both sittings: twenty answers each, every one kept.
    expect(profileStore.get().diagnostic?.answers).toHaveLength(40);
    expect(gateTo('/lesson/class10-blood', { settled: true, trial: false, bench: false, placementDue: false })).toBeNull();
  }, 60_000);
});

// ------------------------------------------------- the Gate, as a component --

describe('the Gate component reads the stores and applies it', () => {
  const GATED_ROUTES = (
    <Route
      path="*"
      element={
        <Gate>
          <Routes>
            <Route path="/lesson/:id" element={<div>lesson</div>} />
            <Route path="/diagnostic" element={<div>placement</div>} />
            <Route path="/try" element={<div>trial door</div>} />
            <Route path="/" element={<div>home</div>} />
          </Routes>
        </Gate>
      }
    />
  );

  /** Past the splash, which the Gate holds for MIN_SPLASH_MS on every open. */
  const pastSplash = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, MIN_SPLASH_MS + 50));
    });

  it('sends an unplaced student from a deep link to the test, carrying the link', async () => {
    settle(['Science']);
    const host = await mount('/lesson/class10-blood', GATED_ROUTES);
    await pastSplash();
    expect(where(host)).toBe(`/diagnostic?next=${encodeURIComponent('/lesson/class10-blood')}`);
  });

  it('lets a placed student through to the same link', async () => {
    settle(['Science']);
    recordFinished(10, 'Science', finishedSitting('Science'));
    const host = await mount('/lesson/class10-blood', GATED_ROUTES);
    await pastSplash();
    expect(where(host)).toBe('/lesson/class10-blood');
    expect(host.textContent).toContain('lesson');
  });

  it('confines a guest trial on that same unplaced, settled device to the trial, not the test', async () => {
    settle(['Science']);
    sessionStorage.setItem(TRIAL_KEY, new Date().toISOString());
    const host = await mount('/class/x', GATED_ROUTES);
    await pastSplash();
    expect(where(host)).toBe('/try?blocked=%2Fclass%2Fx');
  });

  it('sends the same deep link to the test in any case the router accepts', async () => {
    settle(['Science']);
    const host = await mount('/Lesson/class10-blood', GATED_ROUTES);
    await pastSplash();
    expect(where(host)).toBe(`/diagnostic?next=${encodeURIComponent('/Lesson/class10-blood')}`);
    expect(host.textContent).not.toContain('lesson');
  });
});

// --------------------------------------- the routes themselves, past the Gate --

describe('the routes that open a class check the placement themselves', () => {
  /** The app's real route table, with no Gate in front of it. */
  async function mountTable(at: string): Promise<HTMLElement> {
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[at]}>
          <Suspense fallback={<div>loading</div>}>
            <AppRoutes />
          </Suspense>
          <Where />
        </MemoryRouter>,
      );
    });
    return host;
  }

  it('sends an unplaced student to the test from every spelling the router matches', async () => {
    settle(['Science']);
    for (const at of [
      '/lesson/class10-blood',
      '/LESSON/class10-blood',
      '/%6Cesson/class10-blood',
      '/CLASS?topic=volcanoes',
      '/class/class10-science/life-processes',
      '/Quiz/class10-blood',
      '/COMPLETE/class10-blood',
    ]) {
      const host = await mountTable(at);
      expect(where(host), at).toBe(`/diagnostic?next=${encodeURIComponent(at)}`);
      for (const root of roots.splice(0)) act(() => root.unmount());
      document.body.innerHTML = '';
    }
  });

  it('lets a placed student through, and never sends a guest trial to the test', async () => {
    const lesson = (
      <Route
        path="/lesson/:id"
        element={
          <PlacementRequired>
            <div>the lesson</div>
          </PlacementRequired>
        }
      />
    );
    settle(['Science']);
    // A guest on a settled phone whose owner has not been placed: the trial's
    // own lesson must still open (TRIAL_HOME is a /lesson/ route).
    sessionStorage.setItem(TRIAL_KEY, new Date().toISOString());
    let host = await mount(TRIAL_HOME, lesson);
    expect(where(host)).toBe(TRIAL_HOME);
    expect(host.textContent).toContain('the lesson');
    for (const root of roots.splice(0)) act(() => root.unmount());
    document.body.innerHTML = '';

    sessionStorage.clear();
    recordFinished(10, 'Science', finishedSitting('Science'));
    host = await mount('/LESSON/class10-blood', lesson);
    expect(where(host)).toBe('/LESSON/class10-blood');
    expect(host.textContent).toContain('the lesson');
  });
});

// -------------------------------------------------------- the merged plan --

describe('one plan from a test per subject', () => {
  it('keeps every subject in it, and a subject placed by the old test keeps its part', () => {
    settle(['Science', 'Mathematics']);
    // Science was placed by the old one-sitting test: its answers are in the
    // stored result, and there is no sitting for it here.
    const science = sittingWith('Science', 4);
    const legacy: DiagnosticResult = {
      mastery: science.session.mastery,
      gaps: [],
      plan: [],
      answers: science.session.answers,
    };
    profileStore.update((p) => ({ ...p, diagnostic: legacy, diagnosedAt: '2026-09-20T10:00:00.000Z' }));
    adoptLegacyPlacement();
    // ...and Mathematics, added later, is owed and then sat.
    const maths = sittingWith('Mathematics', 5);
    // Adoption covered both subjects that were chosen at the time; take
    // Mathematics back out of it to stand for the subject added afterwards.
    placementStore.update((s) => {
      const records = { ...s.records };
      delete records[placementKey(10, 'Mathematics')];
      return { ...s, records };
    });
    const after = recordFinished(10, 'Mathematics', maths.sitting);

    const { result, stale } = buildPlacementResult(10, profileStore.get(), after);
    expect(stale).toEqual([]);
    if (!result) throw new Error('no plan');
    const ids = result.answers.map((a) => a.probeId);
    for (const a of science.session.answers) expect(ids).toContain(a.probeId);
    for (const a of maths.session.answers) expect(ids).toContain(a.probeId);
  });

  /**
   * A finished sitting as an app update that regenerated its map leaves it:
   * the first `gone` answers name a question the map no longer has.
   */
  function movedUnder(subject: string, gone: number) {
    const { sitting } = sittingWith(subject, 20, () => null);
    return {
      ...sitting,
      answers: sitting.answers.map((a, i) => (i < gone ? { ...a, probeId: `regenerated-away-${i}` } : a)),
    };
  }

  it('keeps what a finished sitting still says when the map moved under part of it', () => {
    settle(['Science', 'Mathematics']);
    const science = movedUnder('Science', 12);
    const data = loadDiagnosticDataFor(10, ['Science'])!;
    // Resuming refuses it — the next question would come from another map...
    expect(restoreSitting(science, data, 10, ['Science'])).toBeNull();
    // ...but the plan keeps the eight answers that still mean something.
    expect(salvageSitting(science, data, 10, ['Science'])?.session.answers).toHaveLength(8);

    recordFinished(10, 'Science', science);
    const after = recordFinished(10, 'Mathematics', finishedSitting('Mathematics'));
    const { result, stale } = buildPlacementResult(10, profileStore.get(), after);
    expect(stale).toEqual([]);
    const probes = result!.answers.map((a) => a.probeId);
    for (const a of science.answers.slice(12)) expect(probes).toContain(a.probeId);
    expect(probes.filter((p) => p.startsWith('regenerated-away-'))).toEqual([]);
  });

  it('never builds a plan without a placed subject whose sitting the map no longer reads', () => {
    settle(['Science', 'Mathematics']);
    recordFinished(10, 'Science', movedUnder('Science', 20));
    const after = recordFinished(10, 'Mathematics', finishedSitting('Mathematics'));
    const { result, stale } = buildPlacementResult(10, profileStore.get(), after);
    expect(stale).toEqual(['Science']);
    expect(result).toBeNull();
  });

  it('owes that subject again, says why, and keeps the plan the student had until it is done', async () => {
    // Science finished against a map that has since been regenerated, and a
    // plan already stored from an earlier placement (set after the record, so
    // this is not the old one-sitting test being adopted).
    settle(['Science', 'Mathematics']);
    recordFinished(10, 'Science', movedUnder('Science', 20));
    const earlier: DiagnosticResult = { mastery: {}, gaps: [], plan: [], answers: [] };
    profileStore.update((p) => ({ ...p, diagnostic: earlier, diagnosedAt: '2026-09-20T10:00:00.000Z' }));
    expect(placementStatus(placementStore.get(), profileStore.get(), 10).owed).toEqual(['Mathematics']);

    const host = await mount('/diagnostic', RUNNER_ROUTES);
    const notSure = async (limit: number) => {
      for (let i = 0; i < limit; i++) {
        const unsure = button(host, "I'm not sure");
        if (!unsure) return;
        await click(unsure, 'not sure');
      }
    };
    await notSure(25);

    expect(host.textContent).toMatch(/Mathematics is done/);
    expect(host.textContent).toMatch(/Next is Science\. Its questions have been updated since you took it/);
    expect(placementStatus(placementStore.get(), profileStore.get(), 10).owed).toEqual(['Science']);
    // Not overwritten with a plan that leaves Science out.
    expect(profileStore.get().diagnostic).toBe(earlier);

    await click(button(host, 'Carry on with Science'), 'carry on');
    await notSure(25);
    expect(placementStatus(placementStore.get(), profileStore.get(), 10).owed).toEqual([]);
    expect(profileStore.get().diagnostic).not.toBe(earlier);
    expect(profileStore.get().diagnostic?.answers).toHaveLength(40);
  }, 60_000);

  it('prefers the sitting that asked about an outcome over one that only inferred it', () => {
    const data = loadDiagnosticDataFor(10, ['Science'])!;
    const base = startSession(data.index, data.bank, { klass: 10, subjects: data.subjects, lookBack: 0 });
    const id = data.index.ids()[0];
    const merged = mergeSittings(base, [
      { mastery: { [id]: 0.9 }, before: { [id]: 0.5 }, answers: [], askedNodeIds: new Set(), seeded: new Set() },
      { mastery: { [id]: 0.1 }, before: { [id]: 0.5 }, answers: [], askedNodeIds: new Set([id]), seeded: new Set() },
    ]);
    expect(merged.mastery[id]).toBe(0.1);
    const silent = mergeSittings(base, [
      { mastery: { [id]: 0.5 }, before: { [id]: 0.5 }, answers: [], askedNodeIds: new Set(), seeded: new Set() },
      { mastery: { [id]: 0.2 }, before: { [id]: 0.5 }, answers: [], askedNodeIds: new Set(), seeded: new Set() },
    ]);
    expect(silent.mastery[id]).toBe(0.2);
  });
});

// ------------------------------------------------------------------ retake --

describe('a retake is asked for, and never shuts a class', () => {
  it('asks first, then runs the test while the classes stay open', async () => {
    settle(['Science']);
    recordFinished(10, 'Science', finishedSitting('Science'));
    const host = await mount('/diagnostic?retake=1', RUNNER_ROUTES);
    // A question, not a test: arriving here is not choosing to sit it again.
    expect(host.textContent).toMatch(/Take the placement test again\?/);
    expect(host.textContent).not.toMatch(/\d+ \/ 20/);

    await click(button(host, 'Start again'), 'start again');
    expect(host.textContent).toContain('1 / 20');
    const status = placementStatus(placementStore.get(), profileStore.get(), 10);
    expect(status.owed).toEqual([]);
    expect(status.retaking).toEqual(['Science']);
  });

  it('a placed student who opens the test without asking for a retake is not put through one', async () => {
    settle(['Science']);
    recordFinished(10, 'Science', finishedSitting('Science'));
    const host = await mount('/diagnostic', RUNNER_ROUTES);
    expect(where(host)).toBe('/');
    expect(placementStore.get().retaking).toEqual([]);
  });

  it('"Not now" on a cold-opened retake goes to Profile rather than out of the app', async () => {
    settle(['Science']);
    recordFinished(10, 'Science', finishedSitting('Science'));
    const host = await mount(
      '/diagnostic?retake=1',
      <>
        {RUNNER_ROUTES}
        <Route path="/profile" element={<div>profile</div>} />
      </>,
    );
    await click(button(host, 'Not now'), 'not now');
    expect(where(host)).toBe('/profile');
    expect(placementStore.get().retaking).toEqual([]);
  });
});

// ------------------------------------------------- the student who skipped --

describe('a student who skipped before this change', () => {
  it('is asked on their next visit, and keeps everything they had', async () => {
    // What "Skip for now" left behind: settled, no result, some lessons done.
    settle(['Science']);
    progressStore.set({
      lessons: { 'class10-blood': { beatIndex: 3, completedAt: '2026-09-29T10:00:00.000Z' } },
      lastLessonId: 'class10-blood',
    } as never);
    const progressBefore = JSON.stringify(progressStore.get());

    expect(placementStatus(placementStore.get(), profileStore.get(), 10).owed).toEqual(['Science']);
    // Home asks.
    const html = renderToString(
      <MemoryRouter initialEntries={['/']}>
        <Home />
      </MemoryRouter>,
    );
    expect(html).toMatch(/placement test/i);
    expect(html).toContain('/diagnostic');

    // Visiting the test changes nothing they already had.
    await mount('/diagnostic', RUNNER_ROUTES);
    expect(JSON.stringify(progressStore.get())).toBe(progressBefore);
    expect(profileStore.get().name).toBe('Asha');
  });

  it('a student who TOOK the old one-sitting test is not asked again, and later changes are', () => {
    settle(['Science', 'Mathematics']);
    const legacy: DiagnosticResult = { mastery: {}, gaps: [], plan: [], answers: [] };
    profileStore.update((p) => ({ ...p, diagnostic: legacy, diagnosedAt: '2026-09-20T10:00:00.000Z' }));

    expect(placementStatus(placementStore.get(), profileStore.get(), 10).owed).toEqual([]);
    adoptLegacyPlacement();
    const adopted: PlacementState = placementStore.get();
    expect(adopted.records[placementKey(10, 'Science')]?.completedAt).toBe('2026-09-20T10:00:00.000Z');
    // The old result is never touched.
    expect(profileStore.get().diagnostic).toBe(legacy);

    // A class change after that is a new placement.
    settingsStore.set({ klass: 9 });
    profileStore.update((p) => ({ ...p, klass: 9 }));
    expect(placementStatus(placementStore.get(), profileStore.get(), 9).owed).toEqual([
      'Science',
      'Mathematics',
    ]);
  });
});

// ------------------------------------------- adoption, and the other device --

describe('adopting the old result never wins over a test sat on another device', () => {
  /** Device A: took the old one-sitting test, Class 10, and has never written a placement. */
  function deviceA(): void {
    settle(['Science', 'Mathematics']);
    profileStore.update((p) => ({
      ...p,
      diagnostic: { mastery: {}, gaps: [], plan: [], answers: [] },
      diagnosedAt: '2026-09-20T10:00:00.000Z',
    }));
    localStorage.removeItem(`${PLACEMENT_KEY}:at`);
  }

  /** Device B's row in the cloud: moved to Class 11, ten Biology answers in. */
  function deviceBRow(): { value: PlacementState; updatedAt: number } {
    const value: PlacementState = {
      version: 1,
      records: {
        [placementKey(11, 'Biology')]: {
          completedAt: null,
          finished: null,
          open: { ...sittingWith('Science', 10).sitting, klass: 11, subjects: ['Biology'] },
        },
      },
      retaking: [],
    };
    return { value, updatedAt: Date.now() - 60_000 };
  }

  it('dates the adoption at 0, so any real record anywhere is newer', () => {
    deviceA();
    adoptLegacyPlacement();
    expect(Object.keys(placementStore.get().records)).toHaveLength(2);
    expect(touchedAt(PLACEMENT_KEY)).toBe(0);
    // Against device B's row the cloud wins; with no row anywhere, it is sent.
    expect(mergePlan({ [PLACEMENT_KEY]: { value: null, updatedAt: 0 } }, { [PLACEMENT_KEY]: deviceBRow() }))
      .toEqual({ take: [PLACEMENT_KEY], send: [] });
    expect(mergePlan({ [PLACEMENT_KEY]: { value: null, updatedAt: 0 } }, {})).toEqual({
      take: [],
      send: [PLACEMENT_KEY],
    });
  });

  it('takes device B\'s open sitting when sync connects after the adoption, answers and all', async () => {
    deviceA();
    adoptLegacyPlacement();
    const b = deviceBRow();
    const stop = connectSync({
      pull: async () => ({ [PLACEMENT_KEY]: b }),
      push: async () => undefined,
      forget: async () => undefined,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    stop();

    expect(placementStore.get()).toEqual(b.value);
    expect(placementStore.get().records[placementKey(11, 'Biology')]?.open?.answers).toHaveLength(10);
    // Dated as the cloud dated it, so the next sync does not push it back as new.
    expect(touchedAt(PLACEMENT_KEY)).toBe(b.updatedAt);
  });
});
