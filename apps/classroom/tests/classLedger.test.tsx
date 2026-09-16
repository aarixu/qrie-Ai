import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { useClassLedger, type ClassLedger } from '../src/lib/classLedger';
import { ledgerOutbox, resetLedgerOutbox } from '../src/stores/ledger';

/**
 * THE RUNG IN FORCE WHEN AN ANSWER LANDS.
 *
 * Rung 0 — left alone — is the only rung the learner model will ever accept as
 * proof of mastery, and the assisted/unassisted split is the whole MVP scope
 * of the learner model. So the number on an `answered` row is not a detail: it
 * is the difference between a student who worked something out and a student
 * who was told.
 *
 * `helped` is handed the rung and used to throw it away. Only the COUNT of
 * hints survived, and the next answer's rung was re-derived from that count as
 * 0, 3 or 4 — so a raised hand, recorded as rung 7 on its own event, produced
 * an answer filed at rung 3, and the judge's leading question was
 * indistinguishable from the authored hint once counted. The ladder was
 * described correctly on one event and flattened on the one that matters.
 *
 * AND WHAT THE SITTING ITSELF SAYS. `session-ended.activeMs` is the
 * denominator of unassisted mastery gain per learning minute — the one number
 * this product is optimised for — so a sitting that is never closed, closed
 * twice, or closed carrying the previous lesson's minutes is not a lost log
 * line, it is a corrupted metric.
 */

beforeEach(() => {
  localStorage.clear();
  // Ask memory lives in sessionStorage so it can survive a remount — which is
  // exactly why it must not survive from one test into the next.
  sessionStorage.clear();
  resetLedgerOutbox();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-13T09:00:00Z'));
});

afterEach(() => {
  // Every mounted hook listens on the DOCUMENT, so one left standing would
  // answer the next test's visibilitychange and write to its outbox.
  for (const room of [...standing]) room.unmount();
  visibility = 'visible';
  vi.useRealTimers();
});

const lessonOf = (id: string, topic: string): Lesson =>
  ({
    id,
    topicRef: `class10-science/life-processes/${topic}`,
    title: topic,
    beats: [{ id: 'b1', topic: 'Breathing in', teaches: [`sci10-lp-${topic}`] }],
    elements: [],
  }) as unknown as Lesson;

const lesson = lessonOf('l1', 'respiration');

interface Props {
  lesson: Lesson;
  playing: boolean;
  ended: boolean;
}

interface Mounted {
  /** The recorder, as the classroom holds it. */
  ledger(): ClassLedger;
  /** Re-render: a pause, the end of the class, a second lesson. */
  render(next: Partial<Props>): void;
  unmount(): void;
}

const standing = new Set<Mounted>();

/** Mount the hook and hand back its recorder and the controls around it. */
const mount = (initial: Partial<Props> = {}): Mounted => {
  let api: ClassLedger | null = null;
  let props: Props = { lesson, playing: false, ended: false, ...initial };
  const Probe = (p: Props): null => {
    api = useClassLedger(p.lesson, p.playing, p.ended);
    return null;
  };
  const root = createRoot(document.createElement('div'));
  const draw = (): void => {
    act(() => root.render(<Probe {...props} />));
  };
  const room: Mounted = {
    ledger(): ClassLedger {
      if (!api) throw new Error('the hook did not run');
      return api;
    },
    render(next) {
      props = { ...props, ...next };
      draw();
    },
    unmount() {
      // Leaving the class twice is not a scenario; the cleanup below runs over
      // rooms a test has already closed.
      if (!standing.delete(room)) return;
      act(() => root.unmount());
    },
  };
  standing.add(room);
  draw();
  return room;
};

/** Mount for the rung tests, which only need the recorder. */
const mounted = (): ClassLedger => mount().ledger();

/**
 * The tab goes away, or comes back.
 *
 * jsdom's visibilityState is a getter with no setter, and one event covers
 * both directions — the hook has to ask the document which way it went, so a
 * test that only dispatched the event would be testing nothing.
 */
let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

const seen = (state: DocumentVisibilityState): void => {
  visibility = state;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

/** What a real tab close fires after the page is already hidden. */
const swipedAway = (): void => {
  act(() => {
    window.dispatchEvent(new Event('pagehide'));
  });
};

/**
 * What a back/forward-cache restore fires, and the only thing it is guaranteed
 * to fire. Deliberately dispatched WITHOUT a visibility transition, because
 * the browsers that skip that one are the whole reason this handler exists.
 */
const restored = (): void => {
  act(() => {
    window.dispatchEvent(new Event('pageshow'));
  });
};

const events = () => ledgerOutbox.get().pending;
const ofKind = (kind: string): Record<string, unknown>[] =>
  events()
    .filter((e) => e.kind === kind)
    .map((e) => e.payload as Record<string, unknown>);
const answersIn = (): Record<string, unknown>[] => ofKind('answered');
const reflectionsIn = (): Record<string, unknown>[] => ofKind('reflected');
const sittingsEnded = (): Record<string, unknown>[] => ofKind('session-ended');

describe('the rung an answer is recorded at', () => {
  it('is 0 when nothing has been given, which is the only rung that proves anything', () => {
    const ledger = mounted();
    ledger.asked('b1', 4);
    ledger.answered({ beatId: 'b1', correct: true, surface: 'tap', chosenIndex: 1 });
    expect(answersIn()[0]).toMatchObject({ assistanceRung: 0, hintsShown: 0, attempt: 1 });
  });

  it('is the rung she actually gave, not a count of how many times she gave one', () => {
    const ledger = mounted();
    ledger.asked('b1', 4);
    ledger.answered({ beatId: 'b1', correct: false, surface: 'voice' });
    // The judge asked a leading question rather than giving the hint.
    ledger.helped('b1', 2, false);
    ledger.answered({ beatId: 'b1', correct: true, surface: 'voice' });

    const [first, second] = answersIn();
    expect(first).toMatchObject({ assistanceRung: 0, attempt: 1 });
    // Was 3 — the count's value for "one hint" — whatever she had actually done.
    expect(second).toMatchObject({ assistanceRung: 2, hintsShown: 1, attempt: 2 });
  });

  it('carries a raised hand at its real weight, not at the count of one hint', () => {
    const ledger = mounted();
    ledger.asked('b1', 4);
    // A hand up on a held question: a whole tutor conversation about it.
    ledger.helped('b1', 7, true);
    ledger.answered({ beatId: 'b1', correct: true, surface: 'tap', chosenIndex: 0 });

    expect(answersIn()[0]).toMatchObject({ assistanceRung: 7, hintsShown: 1 });
  });

  it('never walks the ladder back down, because help given cannot be taken back', () => {
    const ledger = mounted();
    ledger.asked('b1', 4);
    ledger.helped('b1', 7, true); // the whole explanation
    ledger.helped('b1', 2, false); // then a small nudge
    ledger.answered({ beatId: 'b1', correct: true, surface: 'tap', chosenIndex: 0 });

    expect(answersIn()[0]).toMatchObject({ assistanceRung: 7, hintsShown: 2 });
  });

  it('holds the rung across a re-ask of the same question', () => {
    const ledger = mounted();
    ledger.asked('b1', 4);
    ledger.helped('b1', 3, false);
    ledger.asked('b1', 4); // the question surfaces again
    ledger.answered({ beatId: 'b1', correct: true, surface: 'tap', chosenIndex: 0 });

    expect(answersIn()[0]).toMatchObject({ assistanceRung: 3 });
  });
});

/**
 * WHICH TRY AT A QUESTION AN ANSWER IS.
 *
 * `asked` bumps it and `answered` bumps it on a miss, and each has exactly one
 * job. A PAUSE is neither: it takes the question off the screen and puts it
 * back, and that is stopped a layer up — ClassRoom's `askFiled` guard files one
 * `asked` per standing question, so this hook never sees the duplicate. The
 * test for that belongs where the guard is, not here; what belongs here is
 * that a question genuinely put again is a new try.
 */
describe('which try at a question an answer is', () => {
  it('counts a question put again as a new try, because being asked twice is two tries', () => {
    const ledger = mounted();
    ledger.asked('b1', 4);
    ledger.answered({ beatId: 'b1', correct: true, surface: 'tap', chosenIndex: 1 });
    ledger.asked('b1', 4); // a seek back to the same beat: genuinely asked afresh
    ledger.answered({ beatId: 'b1', correct: true, surface: 'tap', chosenIndex: 1 });

    // Both were 1 while `asked` refused to bump, so two distinct answers to
    // the same question were indistinguishable in the record.
    expect(answersIn().map((a) => a.attempt)).toEqual([1, 2]);
  });

  it('counts a wrong answer as a try without being asked again, because the chips stay', () => {
    const ledger = mounted();
    ledger.asked('b1', 4);
    ledger.answered({ beatId: 'b1', correct: false, surface: 'tap', chosenIndex: 3 });
    ledger.answered({ beatId: 'b1', correct: true, surface: 'tap', chosenIndex: 1 });

    expect(answersIn().map((a) => a.attempt)).toEqual([1, 2]);
  });
});

describe('how long an answer took', () => {
  it('is timed to when the student stopped speaking, not to when the judge replied', () => {
    const ledger = mounted();
    ledger.asked('b1');
    vi.advanceTimersByTime(4_000); // thinking, and then saying it
    const micClosed = Date.now();
    vi.advanceTimersByTime(3_000); // the judge's round trip, which is not theirs

    ledger.answered({
      beatId: 'b1',
      correct: true,
      surface: 'voice',
      verdict: 'right',
      answeredAt: micClosed,
    });

    // Was 7_000, so every spoken answer read slower than the same answer
    // tapped — on a number the learner model weighs as evidence about them.
    expect(answersIn()[0]).toMatchObject({ ms: 4_000 });
  });

  it('times the retry from the mic reopening, not from the judge coming back', () => {
    const ledger = mounted();
    ledger.asked('b1', 4);
    vi.advanceTimersByTime(5_000); // thinking, and saying it
    const missed = Date.now();
    vi.advanceTimersByTime(3_000); // the judge's round trip
    ledger.answered({ beatId: 'b1', correct: false, surface: 'voice', answeredAt: missed });
    ledger.helped('b1', 3, false);
    vi.advanceTimersByTime(10_000); // her hint, spoken
    ledger.reopened('b1', Date.now()); // the mic reopens here
    vi.advanceTimersByTime(3_000); // and this is theirs
    ledger.answered({ beatId: 'b1', correct: true, surface: 'voice', answeredAt: Date.now() });

    // Was 16_000: the judge's round trip plus ten seconds of the tutor
    // talking, charged to the student on a number the learner model weighs as
    // evidence about them. A hint runs longer than a round trip, so the retry
    // path was the worse half of the defect `answeredAt` was written for.
    expect(answersIn()[1]).toMatchObject({ ms: 3_000, attempt: 2 });
  });

  it('is timed to now for a tap, which has nothing standing in front of it', () => {
    const ledger = mounted();
    ledger.asked('b1', 4);
    vi.advanceTimersByTime(4_000);
    ledger.answered({ beatId: 'b1', correct: true, surface: 'tap', chosenIndex: 1 });

    expect(answersIn()[0]).toMatchObject({ ms: 4_000 });
  });
});

/**
 * A RIGHT ANSWER CROSS-QUESTIONED.
 *
 * Whether a student can JUSTIFY what they already produced is the only
 * evidence this system ever gathers about mastery over recall, and it is the
 * reason a right answer earns a why/how/when instead of praise. It was spoken,
 * screened, sent to a model and then dropped on the floor: `reflected` was a
 * kind with no emitter, no consumer and no test for the whole life of the
 * ledger.
 */
describe('a right answer cross-questioned', () => {
  /** The exchange up to the moment she asks why: question, right answer. */
  const upToTheProbe = (ledger: ClassLedger): void => {
    ledger.asked('b1', 4);
    vi.advanceTimersByTime(6_000);
    ledger.answered({ beatId: 'b1', correct: true, surface: 'voice', verdict: 'right' });
  };

  it('is a second event about the question, never a second answer to it', () => {
    // Filing it as another `answered` would count one right answer twice in
    // every counter the learner model reads.
    const ledger = mounted();
    upToTheProbe(ledger);
    ledger.reflected({
      beatId: 'b1',
      prompt: 'And why does that matter for a resting animal?',
      reasoning: { said: 'words', held: true },
      reasoningText: 'because every cell is still respiring',
      askedAt: Date.now(),
      reasonedAt: Date.now() + 5_000,
    });

    expect(answersIn()).toHaveLength(1);
    expect(reflectionsIn()).toHaveLength(1);
    expect(reflectionsIn()[0]).toMatchObject({
      beatId: 'b1',
      // Composed at runtime about THEIR words, so it exists in no bank — and
      // without it the stored reasoning answers a question nobody kept.
      prompt: 'And why does that matter for a resting animal?',
      reasoningVerdict: 'held',
      reasoningNormalised: 'because every cell is still respiring',
    });
  });

  it('carries the rung of the answer it is about, so reasoning after help is not read as mastery', () => {
    const ledger = mounted();
    ledger.asked('b1', 4);
    ledger.answered({ beatId: 'b1', correct: false, surface: 'voice' });
    ledger.helped('b1', 3, false);
    ledger.answered({ beatId: 'b1', correct: true, surface: 'voice' });
    ledger.reflected({
      beatId: 'b1',
      prompt: 'Why?',
      reasoning: { said: 'words', held: true },
      askedAt: Date.now(),
      reasonedAt: Date.now(),
    });

    // The second answer's rung and try, not a fresh question's.
    expect(reflectionsIn()[0]).toMatchObject({ assistanceRung: 3, attempt: 2 });
  });

  it('is not another try at the question, because they were not asked it again', () => {
    const ledger = mounted();
    upToTheProbe(ledger);
    ledger.reflected({
      beatId: 'b1',
      prompt: 'Why?',
      reasoning: { said: 'words', held: false },
      askedAt: Date.now(),
      reasonedAt: Date.now(),
    });
    // A seek back to the same beat IS a genuine re-ask, so that answer is
    // attempt 2 — and it is 2 because of the re-ask alone. A reflection that
    // also moved the count would make it 3, and file a student's second try as
    // their third.
    ledger.asked('b1', 4);
    ledger.answered({ beatId: 'b1', correct: true, surface: 'tap', chosenIndex: 0 });

    expect(answersIn()[1]).toMatchObject({ attempt: 2 });
  });

  /**
   * Silence is the app's own observation and outranks the model's, because the
   * model is not told the difference: when the mic hears nothing the class
   * sends it the literal "(said nothing)" so she still closes the loop warmly,
   * and she duly reports reasoning that did not hold. True, and not the same
   * fact — a student who tried and could not is not a student who did not try.
   */
  it('records a quiet room as silence, not as reasoning that wobbled', () => {
    const ledger = mounted();
    upToTheProbe(ledger);
    ledger.reflected({
      beatId: 'b1',
      prompt: 'Why?',
      reasoning: { said: 'nothing' },
      askedAt: Date.now(),
      reasonedAt: Date.now() + 9_000,
    });

    expect(reflectionsIn()[0]).toMatchObject({ reasoningVerdict: 'silent' });
    expect(reflectionsIn()[0].reasoningNormalised).toBeUndefined();
  });

  it('weighs nothing when the mic never opened, because that is not a fact about the student', () => {
    // The OS hands the mic to an incoming call, or a backgrounding suspends
    // the AudioContext, and `listenOnce` returns reason 'error'. Filing that
    // as 'silent' wrote a hardware failure down as a child who could not
    // justify their own right answer — and replay would then count it.
    const ledger = mounted();
    upToTheProbe(ledger);
    ledger.reflected({
      beatId: 'b1',
      prompt: 'Why?',
      reasoning: { said: 'unheard' },
      askedAt: Date.now(),
      reasonedAt: Date.now() + 9_000,
    });

    expect(reflectionsIn()).toHaveLength(1);
    expect(reflectionsIn()[0].reasoningVerdict).toBeUndefined();
  });

  it('weighs nothing when the close never weighed it, rather than defaulting to wobbled', () => {
    // A model that failed. The student still reasoned and the class still
    // moved on, so the row belongs — but 'wobbled' would be a judgement
    // nobody made, and replay moves no belief on an absent verdict.
    const ledger = mounted();
    upToTheProbe(ledger);
    ledger.reflected({
      beatId: 'b1',
      prompt: 'Why?',
      reasoning: { said: 'words' },
      askedAt: Date.now(),
      reasonedAt: Date.now() + 3_000,
    });

    expect(reflectionsIn()).toHaveLength(1);
    expect(reflectionsIn()[0].reasoningVerdict).toBeUndefined();
  });

  it('keeps nothing of a turn the safety screen stopped', () => {
    const ledger = mounted();
    upToTheProbe(ledger);
    ledger.reflected({
      beatId: 'b1',
      prompt: 'Why?',
      reasoning: { said: 'words' },
      reasoningText: 'something a child should not carry alone',
      flagged: true,
      askedAt: Date.now(),
      reasonedAt: Date.now() + 2_000,
    });

    expect(reflectionsIn()[0].reasoningNormalised).toBeUndefined();
  });

  it('is timed from her cross-question, not from the question the class is holding on', () => {
    const ledger = mounted();
    ledger.asked('b1', 4);
    vi.advanceTimersByTime(60_000); // a minute on the question itself
    ledger.answered({ beatId: 'b1', correct: true, surface: 'voice', verdict: 'right' });
    vi.advanceTimersByTime(10_000); // her acknowledgement and the cross-question, spoken
    const micOpened = Date.now();
    vi.advanceTimersByTime(8_000); // theirs

    ledger.reflected({
      beatId: 'b1',
      prompt: 'Why?',
      reasoning: { said: 'words', held: true },
      askedAt: micOpened,
      reasonedAt: Date.now(),
    });

    // Reusing the ask state's own clock would report 78_000 — the whole
    // exchange — as how long they took to justify it.
    expect(reflectionsIn()[0]).toMatchObject({ ms: 8_000 });
  });
});

describe('a sitting the browser never gives React a chance to close', () => {
  it('is closed when the tab is hidden, which is the last thing a phone says before it kills it', () => {
    const room = mount({ playing: true });
    vi.advanceTimersByTime(5 * 60_000);
    seen('hidden');

    // Was nothing at all: a swiped-away app runs no React cleanup, so those
    // five minutes of time on task were lost and the session stayed open.
    expect(sittingsEnded()).toEqual([{ activeMs: 5 * 60_000, completed: false }]);
    room.unmount();
  });

  it('is closed on pagehide, for the browsers that fire that and nothing else', () => {
    const room = mount({ playing: true });
    vi.advanceTimersByTime(60_000);
    swipedAway();

    expect(sittingsEnded()).toEqual([{ activeMs: 60_000, completed: false }]);
    room.unmount();
  });

  it('is closed exactly once, however many of those exits the browser announces', () => {
    const room = mount({ playing: true });
    vi.advanceTimersByTime(60_000);
    // What one real tab close looks like from in here.
    seen('hidden');
    swipedAway();
    room.unmount();

    // Two session-ended events for one sitting would count its minutes twice
    // in the denominator of every per-learning-minute figure.
    expect(sittingsEnded()).toEqual([{ activeMs: 60_000, completed: false }]);
  });

  it('is not closed twice when the class had already finished', () => {
    const room = mount({ playing: true });
    vi.advanceTimersByTime(60_000);
    room.render({ playing: false, ended: true });
    seen('hidden');
    swipedAway();
    room.unmount();

    expect(sittingsEnded()).toEqual([{ activeMs: 60_000, completed: true }]);
  });

  it('gives the student who comes back a new sitting, not events filed against a closed one', () => {
    const room = mount({ playing: true });
    vi.advanceTimersByTime(60_000);
    seen('hidden'); // a glance at WhatsApp
    seen('visible');
    vi.advanceTimersByTime(30_000);
    room.ledger().asked('b1', 4);
    room.unmount();

    const opened = events().filter((e) => e.kind === 'session-started');
    expect(opened).toHaveLength(2);
    // The second sitting's minutes are its own, not the first's carried on.
    expect(sittingsEnded()).toEqual([
      { activeMs: 60_000, completed: false },
      { activeMs: 30_000, completed: false },
    ]);
    // And the question asked after the return belongs to the open sitting.
    const asked = events().find((e) => e.kind === 'asked');
    expect(asked?.sessionId).toBe(opened[1].sessionId);
  });

  it('reopens on pageshow, which is the one event a bfcache restore always fires', () => {
    const room = mount({ playing: true });
    vi.advanceTimersByTime(60_000);
    // A tapped link and the back button: pagehide out, pageshow back, and on
    // some browsers no visibility transition at all. The reopen was wired only
    // to visibilitychange, so the sitting stayed closed for the rest of the
    // class — every remaining minute missing from activeMs, every event filed
    // against a sitting already reported as abandoned.
    swipedAway();
    restored();
    vi.advanceTimersByTime(45_000);
    room.ledger().asked('b1', 4);
    room.unmount();

    const opened = events().filter((e) => e.kind === 'session-started');
    expect(opened).toHaveLength(2);
    expect(events().find((e) => e.kind === 'asked')?.sessionId).toBe(opened[1].sessionId);
    expect(sittingsEnded()).toEqual([
      { activeMs: 60_000, completed: false },
      { activeMs: 45_000, completed: false },
    ]);
  });

  it('files what the class taught even when it finished with the tab hidden', () => {
    const room = mount({ playing: true });
    vi.advanceTimersByTime(5 * 60_000);
    // The tutor is speaking, so Android keeps the audio exemption and the
    // player runs on behind WhatsApp. The class ends there.
    seen('hidden');
    room.render({ playing: false, ended: true });
    seen('visible'); // back to a finished screen

    // Was: no `taught` for a single outcome the lesson had just taught, and
    // the class filed as abandoned — because the guard here read
    // `closed.current`, which the backgrounding had just set, and the effect's
    // deps never fire again. 'This sitting is closed' is not 'this class is
    // over'.
    const opened = events().filter((e) => e.kind === 'session-started');
    expect(ofKind('taught').map((p) => p.lessonId)).toEqual(['l1']);
    expect(events().find((e) => e.kind === 'taught')?.sessionId).toBe(opened[1].sessionId);
    expect(sittingsEnded()).toEqual([
      { activeMs: 5 * 60_000, completed: false },
      // The minutes are the first sitting's; what the second one carries is
      // the fact that the class was finished, not abandoned.
      { activeMs: 0, completed: true },
    ]);
    room.unmount();
  });

  it('gives an answer that lands after the backgrounding a sitting that can hold it', () => {
    const room = mount({ playing: true });
    room.ledger().asked('b1', 4);
    vi.advanceTimersByTime(30_000);
    // They speak; while the judge round-trips they glance at a notification.
    seen('hidden');
    room.ledger().answered({ beatId: 'b1', correct: true, surface: 'voice', verdict: 'right' });
    room.unmount();

    // Was appended into the sitting that had already ended, at a seq past its
    // own session-ended row — under an active_ms that can never include the
    // seconds which produced it, and active_ms is the denominator of the one
    // number this product is optimised for.
    const opened = events().filter((e) => e.kind === 'session-started');
    expect(opened).toHaveLength(2);
    expect(events().find((e) => e.kind === 'answered')?.sessionId).toBe(opened[1].sessionId);
    // And nothing was lost on the way: the package refuses a closed sitting,
    // so a hook that failed to reopen would show up here rather than silently.
    expect(ledgerOutbox.get().orphaned).toBe(0);
  });

  it('does not open a fresh sitting when the finished class is looked at again', () => {
    const room = mount({ playing: true });
    vi.advanceTimersByTime(60_000);
    room.render({ playing: false, ended: true });
    seen('hidden');
    seen('visible');
    room.unmount();

    // A class that has ended has nothing left to record; a sitting opened here
    // would never be closed by anything but the unmount, with zero minutes in it.
    expect(events().filter((e) => e.kind === 'session-started')).toHaveLength(1);
  });
});

describe('a second lesson taken in the same mount', () => {
  it('is a sitting of its own, with its own minutes and its own taught event', () => {
    const room = mount({ playing: true });
    vi.advanceTimersByTime(60_000);
    room.render({ ended: true });

    room.render({ lesson: lessonOf('l2', 'excretion'), ended: false });
    vi.advanceTimersByTime(120_000);
    room.render({ ended: true });

    // The refs outlive the effect, so the second lesson used to start already
    // closed: no taught event, no session-ended, the whole class unrecorded —
    // and the minutes of the first one still sitting in the counter.
    expect(sittingsEnded()).toEqual([
      { activeMs: 60_000, completed: true },
      { activeMs: 120_000, completed: true },
    ]);
    expect(ofKind('taught').map((p) => p.lessonId)).toEqual(['l1', 'l2']);
    room.unmount();
  });

  it('a remount mid-question cannot launder help into rung 0', () => {
    // The back button mid-question, then a return to the class: a fresh mount
    // AND a fresh sitting. The ask ref died with the mount, the helped row
    // stayed in the old sitting, and the fold scopes help to one sitting by
    // design — so every carrier of "this answer was helped" died at once, and
    // the answered row filed rung 0: manufactured unassisted mastery, in the
    // one direction deriveRung says nothing downstream can correct.
    const first = mount({ playing: true });
    first.ledger().asked('b1', 4);
    first.ledger().helped('b1', 7, true);
    first.unmount();

    const second = mount({ playing: true });
    second.ledger().asked('b1', 4);
    second.ledger().answered({ beatId: 'b1', correct: true, surface: 'tap', chosenIndex: 1 });

    // The row itself must carry the truth — the new sitting has no helped row
    // for deriveRung to recover it from.
    expect(answersIn().at(-1)).toMatchObject({ assistanceRung: 7, hintsShown: 1, attempt: 2 });
    second.unmount();
  });

  it('a finished class clears the memory, so a rewatch re-earns rung 0', () => {
    const first = mount({ playing: true });
    first.ledger().asked('b1', 4);
    first.ledger().helped('b1', 7, true);
    first.render({ ended: true });
    first.unmount();

    // Watching the class again next week is a new question, not a resumed one:
    // inheriting last time's rung would mean no outcome could ever produce a
    // rung-0 observation again, and the model would pre-empt its own metric.
    const again = mount({ playing: true });
    again.ledger().asked('b1', 4);
    again.ledger().answered({ beatId: 'b1', correct: true, surface: 'tap', chosenIndex: 1 });

    expect(answersIn().at(-1)).toMatchObject({ assistanceRung: 0, hintsShown: 0, attempt: 1 });
    again.unmount();
  });

  it('does not carry the first lesson’s questions into the second', () => {
    const room = mount({ playing: true });
    room.ledger().asked('b1', 4);
    room.ledger().helped('b1', 7, true);

    room.render({ lesson: lessonOf('l2', 'excretion') });
    room.ledger().asked('b1', 4);
    room.ledger().answered({ beatId: 'b1', correct: true, surface: 'tap', chosenIndex: 1 });

    // Beat ids are only unique within a lesson. A second lesson's 'b1' that
    // inherited the first's rung would file an unassisted answer as one that
    // had already been given the whole explanation.
    expect(answersIn()[0]).toMatchObject({ assistanceRung: 0, hintsShown: 0, attempt: 1 });
    room.unmount();
  });
});
