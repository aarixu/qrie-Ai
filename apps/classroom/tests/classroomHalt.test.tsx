import { readFileSync } from 'node:fs';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import type { TtsAdapter } from '@ai-tutor/player';
import { SUPPORT_REPLY, spokenSupportReply } from '@ai-tutor/safety';

/** The support line as her voice says it, numbers as words (persona v3); shown, it is SUPPORT_REPLY. */
const SPOKEN_SUPPORT = spokenSupportReply('en');
import { LINES } from '@ai-tutor/tutor-control';

/**
 * NO PROJECT, NO SIGN-IN, NO ANALYTICS. The room drives the real `relayFetch`
 * and the real `track`, and `.env.local` names a live Supabase project and a
 * live PostHog key; neither is what this file is about.
 */
vi.mock('../src/lib/supabase', () => ({ supabase: () => null }));
vi.mock('../src/lib/telemetry', () => ({ track: () => undefined }));

/**
 * THE MICROPHONE, AND ONLY THE MICROPHONE.
 *
 * jsdom has no getUserMedia, so the class's mic (lib/ear.ts `openEar`) is a
 * fake: it is OFF until the student taps the mic button (Aarav, 2026-10-03),
 * and a tap turns it on when `ear.mic` says the browser gives it ('denied' is
 * a mic that will not turn on; 'unknown' is a browser that will ask, and here
 * the student says yes). `ear.on` is whether it is on now, `ear.speech` the
 * room's "they are talking over her" listener while it has one, and
 * `listenOnce` hands back whatever a test queued. Everything past that is
 * real: `resolveSpokenAnswer`'s screen, the halt, the room. The `isCancelled`
 * the room passes in is KEPT, because polling it is how ClassRoom closes a mic
 * in flight — so a test can ask it afterwards whether the mic would now close.
 *
 * A queued `null` is a quiet listen that ends a long silence: the clock is
 * moved past the room's wait before a nudge. A queued `SHORT_QUIET` is the
 * endpointer giving up after a few seconds, with the clock left alone. A
 * queued `ERROR` is a mic that stopped (a call took it). With nothing queued,
 * the listen stays open, and takes what a test queues next or ends when the
 * room ends it.
 */
const { ERROR, SHORT_QUIET } = vi.hoisted(() => ({
  ERROR: Symbol('a mic that stopped'),
  SHORT_QUIET: Symbol('a short quiet'),
}));
const ear = vi.hoisted(() => ({
  queued: [] as (string | null | symbol)[],
  polls: [] as (() => boolean)[],
  listens: 0,
  /** Holds a heard answer back, like the transcription round trip does. */
  hold: null as Promise<void> | null,
  mic: 'granted' as 'granted' | 'denied' | 'unknown',
  /** The mic card has been seen before. */
  explained: true,
  /** The class's mic is on. */
  on: false,
  /** Taps that tried to turn it on, and times it was turned off. */
  opens: 0,
  closes: 0,
  /** The room's listener for the student talking over her, while it has one. */
  speech: null as (() => void) | null,
  /** How far the room's clock has been moved on by quiet listens. */
  skew: 0,
}));
vi.mock('../src/lib/mic', async (real) => ({
  ...(await real<typeof import('../src/lib/mic')>()),
  micStatus: () => ear.mic,
  micExplained: () => ear.explained,
  rememberMicExplained: () => {
    ear.explained = true;
  },
  requestMic: async () => ear.mic,
}));
vi.mock('../src/lib/ear', async (real) => ({
  ...(await real<typeof import('../src/lib/ear')>()),
  openEar: async () => {
    ear.opens += 1;
    ear.on = ear.mic !== 'denied';
    return ear.on;
  },
  closeEar: () => {
    if (ear.on) ear.closes += 1;
    ear.on = false;
  },
  isEarOpen: () => ear.on,
  onStudentSpeech: (listen: () => void) => {
    ear.speech = listen;
    return () => {
      if (ear.speech === listen) ear.speech = null;
    };
  },
  listenOnce: async (opts: { isCancelled?: () => boolean } = {}) => {
    ear.listens += 1;
    if (opts.isCancelled) ear.polls.push(opts.isCancelled);
    // Nothing to say yet: the listen stays open until they say something (a
    // test queues it later) or the room ends it, the way the real one ends on
    // its next chunk.
    while (ear.queued.length === 0) {
      await new Promise((r) => setTimeout(r, 10));
      if (opts.isCancelled?.()) return { text: null, reason: 'cancelled' as const };
    }
    const next = ear.queued.shift();
    if (next === null) {
      ear.skew += 25_000;
      return { text: null, reason: 'silence' as const };
    }
    if (typeof next === 'symbol') {
      return next === ERROR ? { text: null, reason: 'error' as const } : { text: null, reason: 'silence' as const };
    }
    if (ear.hold) await ear.hold;
    return { text: next, reason: 'heard' as const };
  },
}));

/**
 * THE WARM-UP'S QUESTIONS, and nothing else about it. Empty unless a test
 * says otherwise, so every other class in this file starts as it always has.
 */
const warm = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock('../src/lib/warmUp', async (real) => ({
  ...(await real<typeof import('../src/lib/warmUp')>()),
  warmUpFor: async () => warm.items,
}));

import { ClassRoom } from '../src/screens/ClassRoom';
import { settingsStore } from '../src/stores/settings';
import { flagStore, recentFlags } from '../src/stores/flags';
import { progressStore } from '../src/stores/progress';
import { ledgerOutbox, resetLedgerOutbox } from '../src/stores/ledger';
import { setLastSession } from '../src/lib/studentMemory';
import { setPreference } from '../src/stores/preferences';

/**
 * THE EXIT GATE FOR THIS FIX, IN THE REAL ROOM.
 *
 * "One typed distress line in a production doubt produces 0 further
 * /api/llm calls." lib/sessionHalt is tested path by path next door; this
 * mounts the whole classroom — real player, real handoff, real typed tutor —
 * with only the network, the voice and the microphone faked, raises a hand,
 * types, and looks at what the student would see and what left the device.
 * The answer paths, below, go through the same mounted room.
 */

const lesson: Lesson = (() => {
  const raw = JSON.parse(readFileSync('content/class10-blood/lesson.json', 'utf8'));
  const result = validateLesson(raw);
  if (!result.ok) throw new Error(`fixture lesson is invalid: ${result.errors.join('; ')}`);
  return result.lesson;
})();

const ANSWER = '{"say":"Blood carries oxygen in red blood cells.","recallBeatId":null,"done":false}';

const roots: Root[] = [];
let llmCalls = 0;
/** What /api/llm answers with. */
let llmReply = ANSWER;
let spoken: string[] = [];
let exited = 0;

/**
 * A voice that holds the recording's first line until something cancels it —
 * so the class sits on its first beat instead of racing to the end — and says
 * everything else at once.
 */
function voice(): TtsAdapter {
  const waiting: Array<() => void> = [];
  let first = true;
  return {
    speak(text) {
      spoken.push(text);
      // Her greeting (2026-09-29) is said before the first beat; the line held
      // is the first line of the CLASS, as before.
      if (/^(Hi|Welcome back)\b/.test(text)) return Promise.resolve();
      if (!first) return Promise.resolve();
      first = false;
      return new Promise<void>((resolve) => waiting.push(resolve));
    },
    cancel() {
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
}

async function tick(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** A voice that says every line at once, so the class reaches its question. */
function quickVoice(): TtsAdapter {
  return {
    speak(text) {
      spoken.push(text);
      return Promise.resolve();
    },
    cancel() {},
  };
}

async function openClass(
  opts: { lesson?: Lesson; tts?: TtsAdapter } = {},
): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/lesson/class10-blood']}>
        <ClassRoom
          lesson={opts.lesson ?? lesson}
          tts={opts.tts ?? voice()}
          diagrams={{}}
          onExit={() => (exited += 1)}
          warm
        />
      </MemoryRouter>,
    );
  });
  await tick(); // warm: the class starts itself on the next tick
  return host;
}

const byLabel = (host: HTMLElement, label: string): HTMLElement => {
  const found = host.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`nothing is labelled "${label}"`);
  return found;
};

async function raiseHand(host: HTMLElement): Promise<void> {
  await act(async () => {
    byLabel(host, 'Raise hand and ask a doubt').click();
  });
  await tick();
}

/** Types into a labelled box and presses its send button. */
async function typeInto(host: HTMLElement, label: string, send: string, text: string): Promise<void> {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`no box is labelled "${label}"`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    byLabel(host, send).click();
  });
  await tick();
}

/**
 * jsdom has no matchMedia, so the room is laid out for a phone held upright:
 * there the doubt box is a row the keyboard button brings up, as a student
 * would tap it.
 */
async function typeDoubt(host: HTMLElement, text: string): Promise<void> {
  if (!host.querySelector('input[aria-label="Type your doubt"]')) {
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Type your doubt"]')!.click();
    });
  }
  await typeInto(host, 'Type your doubt', 'Send doubt', text);
}
/**
 * The box opens only on the keyboard button (Aarav, 2026-10-03: a box that
 * opened by itself at every question kept getting in the way), as a student
 * would tap it.
 */
async function typeAnswer(host: HTMLElement, text: string): Promise<void> {
  if (!host.querySelector('input[aria-label="Type your answer"]')) {
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Type an answer"]')!.click();
    });
  }
  await typeInto(host, 'Type your answer', 'Send answer', text);
}

/**
 * THE MIC BUTTON, BESIDE THE RAISED HAND (Aarav, 2026-10-03). The mic is off
 * until the student taps it, so a student who answers OUT LOUD taps it first —
 * once per question or exchange, where a real one would: after she has put the
 * question. A typed wait looks at the mic every 100 ms, so the tap is given
 * that long to land before the room is looked at. `tapMic` presses whichever
 * the button says now.
 */
async function tapMic(host: HTMLElement, label: 'Turn the mic on' | 'Turn the mic off'): Promise<void> {
  await act(async () => {
    byLabel(host, label).click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 150));
  });
  await tick();
}
const turnMicOn = (host: HTMLElement) => tapMic(host, 'Turn the mic on');
const micIsOn = (host: HTMLElement): boolean => host.querySelector('[aria-label="Turn the mic off"]') !== null;
/** A way to type the answer is offered: the keyboard button, or the box it opened. */
const answerBox = (host: HTMLElement) =>
  host.querySelector('button[aria-label="Type an answer"], input[aria-label="Type your answer"]');

const buttonWith = (host: HTMLElement, text: string): boolean =>
  [...host.querySelectorAll('button')].some((b) => b.textContent?.includes(text));

const pending = (kind: string) =>
  ledgerOutbox.get().pending.filter((e) => e.kind === kind).map((e) => e.payload as Record<string, unknown>);

/** How each answer on record came: 'voice' with the mic on, 'text' from the box. */
const answeredBy = () =>
  ledgerOutbox
    .get()
    .pending.filter((e) => e.kind === 'answered')
    .map((e) => (e as { surface?: string }).surface);

const realNow = Date.now;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no layout, so no scrollIntoView; the doubt panel scrolls to its
  // newest line with it.
  Element.prototype.scrollIntoView ??= () => undefined;
  localStorage.clear();
  sessionStorage.clear();
  flagStore.set({ flags: [] });
  // The room resumes an unfinished lesson from its saved beat, and the store
  // keeps that in memory past localStorage.clear(): a test that answered the
  // first question would start the next one past it.
  progressStore.set({ lessons: {}, lastLessonId: null });
  // A class on file, so the room builds the real typed tutor rather than the
  // scripted one it falls back to for a student it knows nothing about.
  settingsStore.update((s) => ({ ...s, klass: 10 }));
  // The live VOICE doubt is dev-only and needs this key; without it the hand
  // goes straight to the typed tutor, which is the one that ships.
  vi.stubEnv('VITE_GEMINI_API_KEY', '');
  llmCalls = 0;
  llmReply = ANSWER;
  spoken = [];
  exited = 0;
  ear.queued = [];
  ear.polls = [];
  ear.listens = 0;
  ear.hold = null;
  ear.mic = 'granted';
  ear.explained = true;
  ear.on = false;
  ear.opens = 0;
  ear.closes = 0;
  ear.speech = null;
  ear.skew = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + ear.skew);
  warm.items = [];
  resetLedgerOutbox();
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes('/api/llm')) llmCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: llmReply } }] }),
    };
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  settingsStore.update((s) => ({ ...s, klass: null }));
});

describe('a typed distress line in a real doubt', () => {
  it('reaches no model, says the support line last, and leaves only the way home', async () => {
    const host = await openClass();
    await raiseHand(host);

    // An ordinary question first: the tutor is really there, and really called.
    await typeDoubt(host, 'why is blood red?');
    expect(llmCalls).toBe(1);
    expect(spoken).toContain('Blood carries oxygen in red blood cells.');

    await typeDoubt(host, 'i want to kill myself');
    await tick(10);

    expect(llmCalls).toBe(1);
    expect(spoken[spoken.length - 1]).toBe(SPOKEN_SUPPORT);
    const dialog = host.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain('Tele-MANAS');
    // The room is gone, not covered: no hand to raise, no box to type into.
    expect(host.querySelector('[aria-label="Raise hand and ask a doubt"]')).toBeNull();
    expect(host.querySelector('[aria-label="Type your doubt"]')).toBeNull();

    const home = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('home'));
    await act(async () => {
      home?.click();
    });
    expect(exited).toBe(1);
  });

  it('never gets as far as a model when distress is the first thing typed', async () => {
    const host = await openClass();
    await raiseHand(host);

    await typeDoubt(host, 'i want to kill myself');
    await tick(10);

    expect(llmCalls).toBe(0);
    expect(spoken.filter((l) => l === SPOKEN_SUPPORT)).toHaveLength(1);
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
  });
});

/**
 * The fixture lesson with a question on its first beat. Its options are the
 * judge's ears, never shown (2026-10-01): the probe mirrors them with a why
 * for each, so a spoken answer is read on the device with no model. `why` is
 * the line she says about a right answer.
 */
function askingLesson(why: string): Lesson {
  const raw = JSON.parse(readFileSync('content/class10-blood/lesson.json', 'utf8'));
  raw.beats[0].ask = {
    question: 'How many components does blood have?',
    options: [
      { text: 'Four', correct: true, why },
      { text: 'Just plasma', hint: 'Count the workers on the board.' },
    ],
  };
  const result = validateLesson(raw);
  if (!result.ok) throw new Error(`asking lesson is invalid: ${result.errors.join('; ')}`);
  result.lesson.beats[0].ask = {
    ...result.lesson.beats[0].ask!,
    whyProbe: {
      askedAs: 'open',
      options: [
        { text: 'Four', correct: true, why },
        { text: 'Just plasma', correct: false, why: 'Only two were counted.', hint: 'Count the workers on the board.' },
      ],
    },
  } as never;
  return result.lesson;
}

const RIGHT_WHY = 'Plasma, red cells, white cells and platelets — four workers.';
const nextBeat = () => spoken.includes(lesson.beats[1].narration);

/**
 * THE EAR, THROUGH THE REAL ROOM.
 *
 * lib/sessionHalt's own tests call `heard` directly and close a fake mic. This
 * is the wiring they cannot see: the room holds a question, the student turns
 * the mic on and SAYS distress, and the answer runs through the room's own ear
 * loop — `resolveSpokenAnswer`'s screen, then the halt.
 */
describe('a spoken answer that is distress, in the real room', () => {
  it('halts the class: the support screen, the mic told to close, and no model reached', async () => {
    ear.queued = ['i want to kill myself'];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    // The question is held and the mic is off: nothing has listened yet.
    expect(ear.listens).toBe(0);
    await turnMicOn(host);
    await tick(10);

    // The ear really was opened for this question, by the student's tap.
    expect(ear.opens).toBe(1);
    expect(ear.listens).toBe(1);
    const dialog = host.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(host.querySelector('#support-line')?.textContent).toBe(SUPPORT_REPLY);
    // The same poll ClassRoom's listen checks on every chunk now says stop,
    // and the class's mic has been turned off.
    expect(ear.polls[0]()).toBe(true);
    expect(ear.on).toBe(false);
    // Neither the judge nor anything else went to a model.
    expect(llmCalls).toBe(0);
    expect(spoken[spoken.length - 1]).toBe(SPOKEN_SUPPORT);
    expect(spoken.join(' ')).not.toContain('kill myself');
    // The room is gone: no hand to raise.
    expect(host.querySelector('[aria-label="Raise hand and ask a doubt"]')).toBeNull();
  });
});

/**
 * THE LESSON'S OWN WHY IS NOT A WAY INTO THE HALT (lib/sessionHalt.ts,
 * `sayAuthored`). The line she says about a right answer read on the device
 * is the lesson's own, screened where the lesson was made with a reader that
 * lets a curriculum line through. Here it has no reader, so a line that trips
 * the screen is withheld — and the class carries on.
 */
describe('a right answer whose why trips the distress screen', () => {
  it('is not said, does not halt, and the class moves on', async () => {
    const why = "In Premchand's story the farmer says i want to kill myself — that is the story's point.";
    ear.queued = ['Four'];
    const host = await openClass({ lesson: askingLesson(why), tts: quickVoice() });
    await tick(10);
    await turnMicOn(host);
    await tick(10);

    expect(spoken.join(' ')).not.toContain('kill myself');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(host.querySelector('[aria-label="Raise hand and ask a doubt"]')).not.toBeNull();
    // The right answer opened the gate: the next beat is being taught.
    expect(nextBeat()).toBe(true);
    // The child said nothing distressing, so nothing is filed as their distress.
    expect(recentFlags(flagStore.get()).filter((f) => f.kind === 'distress')).toHaveLength(0);
    expect(llmCalls).toBe(0);
  });

  it('an ordinary why is said, then the class moves on', async () => {
    ear.queued = ['Four'];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    await turnMicOn(host);
    await tick(10);
    expect(spoken.some((line) => line.includes(RIGHT_WHY))).toBe(true);
    expect(nextBeat()).toBe(true);
  });
});

/**
 * THE HELD QUESTION, IN THE REAL ROOM (2026-10-01).
 *
 * Nothing on screen asks or answers: no question, no options, no chips. She
 * asks out loud; a student here answers out loud, having turned the mic on
 * once, after she asked (the typed box is the next describe's) — and every
 * way of not answering has to end, because nothing on screen can end it now.
 */
describe('the held question, in the real room', () => {
  it('puts nothing on screen to answer with: no question, no options, no chips', async () => {
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick();
    const nothingToAnswerWith = (): void => {
      expect(host.textContent).not.toContain('How many components');
      for (const text of ['Four', 'Just plasma', 'hint', 'not sure', 'another way', 'Work it out', 'Say your answer']) {
        expect(buttonWith(host, text), text).toBe(false);
      }
    };
    // The mic is off: the one box under the board waits, and nothing listens.
    nothingToAnswerWith();
    expect(answerBox(host)).not.toBeNull();
    expect(ear.listens).toBe(0);
    // With the mic on the ear hears them, so there is no box either.
    await turnMicOn(host);
    nothingToAnswerWith();
    expect(ear.listens).toBeGreaterThan(0);
    expect(answerBox(host)).toBeNull();
  });

  it('gives the answer and its why, and goes on, when the answers keep missing', async () => {
    ear.queued = ['Just plasma', 'Just plasma', 'Just plasma'];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick();
    // One tap: the mic stays on until the question is over.
    await turnMicOn(host);
    await tick(20);
    // Look again, the hint, then the answer and why — and the class goes on.
    expect(spoken.some((l) => l.includes('Count the workers on the board.'))).toBe(true);
    expect(spoken.some((l) => /answer is Four/.test(l))).toBe(true);
    expect(nextBeat()).toBe(true);
    expect(pending('answered').map((a) => a.correct)).toEqual([false, false, false]);
  });

  it('gives the answer and goes on when they stay quiet through the nudge and the hint', async () => {
    const quiet = askingLesson(RIGHT_WHY);
    quiet.beats[0].ask!.hint = 'Count the workers on the board.';
    ear.queued = [null, null, null];
    const host = await openClass({ lesson: quiet, tts: quickVoice() });
    await tick();
    await turnMicOn(host);
    await tick(20);
    expect(spoken.some((l) => LINES.nudge.en.includes(l))).toBe(true);
    expect(spoken.some((l) => l.includes('Count the workers on the board.'))).toBe(true);
    expect(spoken.some((l) => /answer is Four/.test(l))).toBe(true);
    expect(nextBeat()).toBe(true);
    // Help they never asked for, and no answer on record: silence is not one.
    expect(pending('helped').map((h) => [h.rung, h.requested])).toEqual([
      [1, false],
      [3, false],
      [8, false],
    ]);
    expect(pending('answered')).toHaveLength(0);
  });

  it('waits out a short quiet without a word', async () => {
    // The endpointer gives up after a few seconds; that is not a stuck student.
    ear.queued = [SHORT_QUIET, 'Four'];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick();
    await turnMicOn(host);
    await tick(10);
    // Both listens ran: the quiet one re-armed the ear, and the answer came.
    expect(ear.listens).toBeGreaterThanOrEqual(2);
    expect(spoken.some((l) => LINES.nudge.en.includes(l))).toBe(false);
    expect(nextBeat()).toBe(true);
  });

  it('never says a hint decide() refused for giving the answer away', async () => {
    const leaky = askingLesson(RIGHT_WHY);
    leaky.beats[0].ask!.hint = 'It is Four, so say Four.';
    ear.queued = ['hint do'];
    const host = await openClass({ lesson: leaky, tts: quickVoice() });
    await tick();
    await turnMicOn(host);
    await tick(10);
    // They really did ask for the hint.
    expect(ear.queued).toHaveLength(0);
    expect(host.textContent).not.toContain('It is Four');
    expect(spoken.join(' ')).not.toContain('It is Four');
  });

  it('hears "hint do" as a request for the hint, not as an answer to judge', async () => {
    const fine = askingLesson(RIGHT_WHY);
    fine.beats[0].ask!.hint = 'Count the workers on the board.';
    ear.queued = ['hint do'];
    const host = await openClass({ lesson: fine, tts: quickVoice() });
    await tick();
    await turnMicOn(host);
    await tick(10);
    expect(llmCalls).toBe(0);
    expect(spoken.some((l) => l.includes('Count the workers on the board.'))).toBe(true);
    // Not a wrong answer on record: no "not quite" for asking.
    expect(spoken.some((l) => /not quite|not yet|miss hua/i.test(l))).toBe(false);
    expect(pending('helped')[0]).toMatchObject({ rung: 3, requested: true });
  });

  it('writes her hint on the board, and none of their words', async () => {
    const written = askingLesson(RIGHT_WHY);
    written.beats[0].workArea = { id: 'wa', x: 40, y: 380, w: 900, h: 220 };
    ear.queued = ['Just plasma', 'Just plasma'];
    const host = await openClass({ lesson: written, tts: quickVoice() });
    await tick();
    await turnMicOn(host);
    await tick(20);
    expect(pending('answered')).toHaveLength(2);
    const board = host.querySelector('section')?.textContent ?? '';
    expect(board).toContain('Count the workers on the board.');
    expect(board).not.toContain('✗');
    expect(board).not.toContain('Just plasma');
  });

  it('asks again when the judge fails, and goes on after the third such turn', async () => {
    const open = askingLesson(RIGHT_WHY);
    open.beats[0].ask = { question: 'What does plasma carry?', expect: 'dissolved food, salts and wastes' } as never;
    llmReply = 'no json here';
    ear.queued = ['salt water', 'salt water', 'salt water'];
    const host = await openClass({ lesson: open, tts: quickVoice() });
    await tick();
    await turnMicOn(host);
    await tick(20);
    expect(spoken.filter((l) => LINES.sayAgain.en.includes(l))).toHaveLength(2);
    expect(spoken.some((l) => LINES.carryOn.en.includes(l))).toBe(true);
    expect(nextBeat()).toBe(true);
    expect(pending('answered')).toHaveLength(0);
  });

  it('starts the class after the greeting under StrictMode, as development runs it', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <StrictMode>
          <MemoryRouter initialEntries={['/lesson/class10-blood']}>
            <ClassRoom lesson={askingLesson(RIGHT_WHY)} tts={quickVoice()} diagrams={{}} onExit={() => undefined} warm />
          </MemoryRouter>
        </StrictMode>,
      );
    });
    await tick(10);
    expect(spoken).toContain(lesson.beats[0].narration);
  });

  const probed = (): Lesson => {
    const l = askingLesson(RIGHT_WHY);
    l.beats[0].ask = {
      ...l.beats[0].ask!,
      whyProbe: {
        askedAs: 'open',
        options: [
          { text: 'Four', correct: true, why: RIGHT_WHY },
          { text: 'Just plasma', correct: false, why: 'Only two were counted.', followUp: 'Which two did you count?' },
        ],
      },
    } as never;
    return l;
  };

  it('hears the reply to a follow-up question as reasoning, not as a second answer (C7)', async () => {
    ear.queued = ['Just plasma', 'I counted the red cells and the plasma'];
    const host = await openClass({ lesson: probed(), tts: quickVoice() });
    await tick();
    await turnMicOn(host);
    await tick(20);
    expect(spoken).toContain('Which two did you count?');
    expect(llmCalls).toBe(0);
    expect(spoken.some((l) => /another go|once more/i.test(l))).toBe(true);
    // Not judged: one answer on record, not two.
    expect(pending('answered')).toHaveLength(1);
  });

  it('judges a reply to a follow-up that says the answer, and moves on (fifth review)', async () => {
    ear.queued = ['Just plasma', 'oh wait, it is Four'];
    const host = await openClass({ lesson: probed(), tts: quickVoice() });
    await tick();
    await turnMicOn(host);
    await tick(20);
    expect(spoken).toContain('Which two did you count?');
    expect(spoken.some((l) => /another go|once more/i.test(l))).toBe(false);
    expect(nextBeat()).toBe(true);
  });

  it('explains it another way when asked out loud, a different way each time (H4)', async () => {
    const alt = askingLesson(RIGHT_WHY);
    alt.beats[0].ask = {
      ...alt.beats[0].ask!,
      alternates: [
        { mode: 'analogy', say: 'Think of blood as a delivery team with different workers.' },
        { mode: 'everyday', say: 'Like a school with teachers, guards and cooks, each doing one job.' },
      ],
    } as never;
    ear.queued = ['phir se samjhao', 'phir se samjhao'];
    const host = await openClass({ lesson: alt, tts: quickVoice() });
    await tick();
    await turnMicOn(host);
    await tick(20);
    const explained = spoken.filter((l) => /delivery team|school with teachers/.test(l));
    expect(explained.length).toBe(2);
    expect(explained[0]).not.toBe(explained[1]);
    expect(llmCalls).toBe(0);
  });

  it('does not start the class when they leave while she is greeting them', async () => {
    const held: Array<() => void> = [];
    const greetingHeld: TtsAdapter = {
      speak(text) {
        spoken.push(text);
        if (/^(Hi|Welcome back)\b/.test(text)) return new Promise<void>((resolve) => held.push(resolve));
        return Promise.resolve();
      },
      cancel() {
        for (const resolve of held.splice(0)) resolve();
      },
    };
    await openClass({ lesson: askingLesson(RIGHT_WHY), tts: greetingHeld });
    expect(spoken.some((l) => /^(Hi|Welcome back)\b/.test(l))).toBe(true);
    for (const root of roots.splice(0)) act(() => root.unmount());
    // Whatever ends her line — the unmount's cancel, or the line running out.
    for (const resolve of held.splice(0)) resolve();
    await tick(10);
    expect(spoken).not.toContain(lesson.beats[0].narration);
  });
});

/**
 * THE MIC OFF, ONE BOX (2026-10-01; the mic off by default since 2026-10-03).
 * While the mic is off — every student until they tap it, and one whose mic
 * will not turn on or has stopped — the answer is typed into one box under
 * the board, and it goes down the spoken answer's road: the same screen, the
 * same judge, the same ladder.
 */
describe('a held question with the mic off', () => {
  it('gets one box under the board, and what they type is judged like speech', async () => {
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    expect(answerBox(host)).not.toBeNull();
    expect(host.querySelector('section [aria-label="Type your answer"]')).toBeNull();
    await typeAnswer(host, 'Four');
    await tick(10);
    expect(spoken.some((l) => l.includes(RIGHT_WHY))).toBe(true);
    expect(nextBeat()).toBe(true);
    expect(pending('answered')[0]).toMatchObject({ correct: true });
    expect(answeredBy()).toEqual(['text']);
    expect(answerBox(host)).toBeNull();
    // Nothing was ever listened to: the mic was never turned on.
    expect(ear.opens).toBe(0);
    expect(ear.listens).toBe(0);
  });

  it('screens what they type: distress halts the class', async () => {
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    await typeAnswer(host, 'i want to kill myself');
    await tick(10);
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(spoken[spoken.length - 1]).toBe(SPOKEN_SUPPORT);
    expect(llmCalls).toBe(0);
  });

  it('keeps the box, and says so beside her, when the mic will not turn on', async () => {
    ear.mic = 'denied';
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    await turnMicOn(host);
    expect(ear.opens).toBe(1);
    expect(micIsOn(host)).toBe(false);
    expect(host.textContent).toContain("The mic didn't turn on. You can type instead.");
    expect(answerBox(host)).not.toBeNull();
    expect(ear.listens).toBe(0);
    // The box still takes the answer.
    await typeAnswer(host, 'Four');
    await tick(10);
    expect(nextBeat()).toBe(true);
  });

  it('hands the question back to the box when the mic stops', async () => {
    ear.queued = [ERROR];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    await turnMicOn(host);
    await tick(10);
    expect(ear.listens).toBe(1);
    // The mic that stopped is turned off, and the box is back.
    expect(micIsOn(host)).toBe(false);
    expect(answerBox(host)).not.toBeNull();
    // A mic that failed is not a quiet student: no nudge for it.
    expect(spoken.some((l) => LINES.nudge.en.includes(l))).toBe(false);
  });
});

/**
 * THE MIC BUTTON (Aarav, 2026-10-03: "agar mic hamesha on rahta hai to bg
 * noise se ye baar baar interrupt hota hai, to mic ka button bana do raise
 * hand ke saath jise click karne par hi mic on ho"). Off until it is tapped;
 * a second tap turns it off; and it goes off by itself once the exchange it
 * was turned on for is over and she is teaching again.
 */
describe('the mic button, beside the raised hand', () => {
  it('starts off: while she teaches nothing listens, not even for the room talking over her', async () => {
    // voice() holds her first line: she is teaching it.
    const host = await openClass();
    await tick(10);
    expect(spoken).toContain(lesson.beats[0].narration);
    expect(micIsOn(host)).toBe(false);
    expect(ear.opens).toBe(0);
    expect(ear.listens).toBe(0);
    // No speech detector is listened to, so a noisy room has nothing to set
    // off: she is still on her first line.
    expect(ear.speech).toBeNull();
    expect(nextBeat()).toBe(false);
  });

  it('turns off on a second tap: the listen ends, the box is back, and the wait is not counted as quiet', async () => {
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick();
    await turnMicOn(host);
    expect(micIsOn(host)).toBe(true);
    expect(ear.on).toBe(true);
    expect(ear.listens).toBe(1);
    expect(answerBox(host)).toBeNull();

    await tapMic(host, 'Turn the mic off');
    expect(micIsOn(host)).toBe(false);
    expect(ear.on).toBe(false);
    expect(ear.closes).toBe(1);
    // The listen in flight is told to stop on its next chunk.
    expect(ear.polls[0]()).toBe(true);
    // The question still stands, in the box now, and nobody was nudged for it.
    expect(answerBox(host)).not.toBeNull();
    expect(spoken.some((l) => LINES.nudge.en.includes(l))).toBe(false);
    await typeAnswer(host, 'Four');
    await tick(10);
    expect(nextBeat()).toBe(true);
    expect(pending('answered')[0]).toMatchObject({ correct: true });
    expect(answeredBy()).toEqual(['text']);
    expect(ear.listens).toBe(1);
  });

  it('goes off by itself when the question it was turned on for is over', async () => {
    ear.queued = ['Four'];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick();
    await turnMicOn(host);
    await tick(10);
    // Answered out loud, and she is teaching the next beat…
    expect(pending('answered')[0]).toMatchObject({ correct: true });
    expect(answeredBy()).toEqual(['voice']);
    expect(nextBeat()).toBe(true);
    // …with the mic off, and nothing listening for the room.
    expect(micIsOn(host)).toBe(false);
    expect(ear.on).toBe(false);
    expect(ear.closes).toBe(1);
    expect(ear.speech).toBeNull();
    const listens = ear.listens;
    await tick(10);
    expect(ear.listens).toBe(listens);
  });

  it('hears a doubt out loud, and goes off by itself when the doubt is over', async () => {
    ear.queued = ['why is blood red?'];
    const host = await openClass();
    await raiseHand(host);
    // In the doubt the mic is off, and nothing listens until it is tapped.
    expect(ear.listens).toBe(0);
    await turnMicOn(host);
    await tick(10);
    // Their words went to the tutor, and she answered.
    expect(llmCalls).toBe(1);
    expect(spoken).toContain('Blood carries oxygen in red blood cells.');
    // The mic is still on, and the next thing they say is heard too.
    expect(micIsOn(host)).toBe(true);
    ear.queued.push('got it');
    await tick(10);
    // "got it" ended the doubt; the class is back, and the mic went off with it.
    expect(host.querySelector('[aria-label="Raise hand and ask a doubt"]')).not.toBeNull();
    expect(micIsOn(host)).toBe(false);
    expect(ear.on).toBe(false);
    expect(ear.speech).toBeNull();
  });

  it('explains itself on the first tap ever, and turns on from the card', async () => {
    ear.mic = 'unknown';
    ear.explained = false;
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick();
    await act(async () => {
      byLabel(host, 'Turn the mic on').click();
    });
    await tick();
    expect(host.querySelector('[aria-label="Let Meera hear you"]')).not.toBeNull();
    expect(ear.opens).toBe(0);
    await act(async () => {
      [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Turn on the mic'))!.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    await tick();
    expect(host.querySelector('[aria-label="Let Meera hear you"]')).toBeNull();
    expect(ear.explained).toBe(true);
    expect(ear.opens).toBe(1);
    expect(micIsOn(host)).toBe(true);
    expect(answerBox(host)).toBeNull();
  });

  it('stays off after "Not now" on the card, and the next tap does not ask again', async () => {
    ear.mic = 'unknown';
    ear.explained = false;
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick();
    await act(async () => {
      byLabel(host, 'Turn the mic on').click();
    });
    await tick();
    await act(async () => {
      [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Not now'))!.click();
    });
    await tick();
    expect(host.querySelector('[aria-label="Let Meera hear you"]')).toBeNull();
    expect(ear.opens).toBe(0);
    expect(micIsOn(host)).toBe(false);
    expect(answerBox(host)).not.toBeNull();
    // Explained once is explained: the next tap goes straight to the mic.
    await turnMicOn(host);
    expect(host.querySelector('[aria-label="Let Meera hear you"]')).toBeNull();
    expect(ear.opens).toBe(1);
    expect(micIsOn(host)).toBe(true);
  });
});

/** Aarav, 2026-10-01: nothing that says "recording", and no subtitles on the board. */
describe('the room around the board', () => {
  it('keeps only the mic, raise hand and end class on the toolbar', async () => {
    const host = await openClass({ tts: quickVoice() });
    const toolbar = [...host.querySelectorAll('nav [aria-label]')].map((b) => b.getAttribute('aria-label'));
    // The mic sits before the raised hand, and starts off (2026-10-03).
    expect(toolbar).toEqual(['Turn the mic on', 'Raise hand and ask a doubt', 'End the class']);
    expect(host.textContent).not.toContain('REC');
    expect(host.querySelector('header')?.textContent ?? '').not.toMatch(/\d+\/\d+/);
    await act(async () => {
      byLabel(host, 'End the class').click();
    });
    expect(exited).toBe(1);
  });

  it('still lets them report something, from the top bar', async () => {
    const host = await openClass({ tts: quickVoice() });
    expect(host.querySelector('header [aria-label="Report something in this class"]')).not.toBeNull();
  });

  it('shows no captions by default', async () => {
    const host = await openClass({ tts: quickVoice() });
    await tick();
    expect(host.querySelector('[data-caption]')).toBeNull();
  });

  it('puts captions under the board, never on it, once they are turned on', async () => {
    setPreference('captions', true);
    const host = await openClass({ tts: voice() });
    await tick();
    const caption = host.querySelector('[data-caption]');
    expect(caption?.textContent).toContain(lesson.beats[0].narration.slice(0, 20));
    expect(host.querySelector('section [data-caption]')).toBeNull();
  });
});

/**
 * THE CLASS OPENS WITH A WARM-UP WHEN A REVIEW IS DUE (E6-E8), ASKED OUT LOUD.
 *
 * One authored probe per due outcome, asked after her greeting and before the
 * first beat. Nothing is shown: she reads the question and its choices, the
 * answer — spoken once the student has turned the mic on, or typed while it is
 * off — is filed cold under the probe's own outcome, she says whether it was
 * right, and the class begins. Nothing turns the mic on for the warm-up.
 */
describe('the class-start warm-up', () => {
  const question = {
    id: 'probe-7',
    nodeId: 'maths8-lin-solve',
    title: 'Solving linear equations',
    topicRef: 'class8-maths/linear/solve',
    question: 'If 2x = 8, what is x?',
    options: ['2', '4', '6', '16'],
    correctIndex: 1,
    misconceptions: ['', '', '', ''],
  };
  const answered = () => ledgerOutbox.get().pending.filter((e) => e.kind === 'answered');

  it('asks the due review aloud before the class, files the spoken answer cold, and then teaches', async () => {
    warm.items = [question];
    ear.queued = ['4'];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    // Asked, and waiting: the mic is still off until they tap it.
    expect(ear.opens).toBe(0);
    expect(answered()).toHaveLength(0);
    await turnMicOn(host);
    await tick(10);

    const asked = spoken.find((l) => l.includes('If 2x = 8, what is x?')) ?? '';
    expect(asked).toContain('Is it 2, 4, 6 or 16?');
    expect(host.textContent).not.toContain('If 2x = 8');
    expect(answered()).toHaveLength(1);
    expect(answered()[0]).toMatchObject({ outcomeIds: ['maths8-lin-solve'], topicRef: 'class8-maths/linear/solve' });
    expect(answered()[0].payload).toMatchObject({ probeId: 'probe-7', chosenIndex: 1, correct: true, assistanceRung: 0 });
    expect(spoken.some((l) => /remembered/i.test(l))).toBe(true);
    // Asked before the first beat, which follows it.
    expect(spoken.indexOf(asked)).toBeLessThan(spoken.indexOf(lesson.beats[0].narration));
  });

  it('says the right answer after a wrong one', async () => {
    warm.items = [question];
    ear.queued = ['16'];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    await turnMicOn(host);
    await tick(10);
    expect(answered()[0].payload).toMatchObject({ chosenIndex: 3, correct: false, assistanceRung: 0 });
    expect(spoken.some((l) => l.includes('The answer is 4'))).toBe(true);
  });

  // Second review: 63 bank titles hold their probe's answer word for word.
  it('keeps the outcome title out of her mouth and off the screen', async () => {
    warm.items = [question];
    ear.queued = ['4'];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    await turnMicOn(host);
    await tick(10);
    // Answered and replied to: every line of the warm-up has been said.
    expect(answered()).toHaveLength(1);
    expect(spoken.join(' ')).not.toContain(question.title);
    expect(host.textContent).not.toContain(question.title);
  });

  // Plan T3.5: a recap before the warm-up names what is due.
  it('asks before any recap of the last class', async () => {
    setLastSession({ lessonId: 'an-older-class', title: 'Solving linear equations', beatsDone: 20, total: 20 });
    warm.items = [question];
    ear.queued = ['4'];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    await turnMicOn(host);
    await tick(10);
    const ask = spoken.findIndex((l) => l.includes('If 2x = 8'));
    const recap = spoken.findIndex((l) => /Last time we did Solving linear equations/.test(l));
    expect(ask).toBeGreaterThanOrEqual(0);
    expect(recap).toBeGreaterThan(ask);
  });

  it('does not ask a question it cannot read aloud', async () => {
    warm.items = [{ ...question, question: 'The area is', options: [String.raw`$154\text{ cm}^2$`, '44 cm', '22 cm', '7 cm'], correctIndex: 0 }];
    await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    expect(spoken.some((l) => /warm-up/i.test(l))).toBe(false);
    expect(spoken.join(' ')).not.toContain('$');
    expect(spoken).toContain(lesson.beats[0].narration);
  });

  it('asks each due question in turn', async () => {
    warm.items = [question, { ...question, id: 'probe-8', question: 'If x + 1 = 3, what is x?', options: ['1', '2', '3', '4'] }];
    ear.queued = ['4', '2'];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    // One tap: she is not teaching between the two questions, so the mic stays on.
    await turnMicOn(host);
    await tick(20);
    expect(ear.opens).toBe(1);
    expect(spoken.some((l) => l.includes('If 2x = 8, what is x?'))).toBe(true);
    expect(spoken.some((l) => l.includes('If x + 1 = 3, what is x?'))).toBe(true);
    expect(answered()).toHaveLength(2);
  });

  it('is not asked on a class picked up where it was left', async () => {
    progressStore.set({ lessons: { [lesson.id]: { beatIndex: 2 } }, lastLessonId: lesson.id } as never);
    warm.items = [question];
    await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    expect(spoken.join(' ')).not.toContain('If 2x = 8, what is x?');
  });

  it('counts the warm-up as time on task', async () => {
    warm.items = [question];
    await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    expect(spoken.some((l) => l.includes('If 2x = 8, what is x?'))).toBe(true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    // Left on the warm-up: the class never played, and the time still counts.
    for (const root of roots.splice(0)) act(() => root.unmount());
    const ended = ledgerOutbox.get().pending.filter((e) => e.kind === 'session-ended');
    expect((ended.at(-1)?.payload as { activeMs: number }).activeMs).toBeGreaterThanOrEqual(100);
  });

  // Third review: placement answers fall due the next day, and a brand-new
  // student heard "Welcome back … from an earlier class" and never "I'm Meera".
  it('introduces her on a first class, and does not call the placement an earlier class', async () => {
    warm.items = [question];
    await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    const lead = spoken.find((l) => /warm-up/i.test(l)) ?? '';
    expect(lead).toMatch(/^Hi\b.*I'm Meera/);
    expect(lead).not.toContain('earlier class');
  });

  it('files nothing when they stay quiet, says the answer, and the class begins', async () => {
    warm.items = [question];
    ear.queued = [null];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    await turnMicOn(host);
    await tick(10);
    expect(answered()).toHaveLength(0);
    expect(spoken.some((l) => l.includes('the answer is 4'))).toBe(true);
    expect(spoken).toContain(lesson.beats[0].narration);
  });

  it('asks once more when the words name no choice, then says the answer', async () => {
    warm.items = [question];
    ear.queued = ['banana', 'banana'];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    await turnMicOn(host);
    await tick(10);
    expect(spoken.filter((l) => LINES.sayAgain.en.includes(l))).toHaveLength(1);
    expect(answered()).toHaveLength(0);
    expect(spoken.some((l) => l.includes('the answer is 4'))).toBe(true);
  });

  it('takes a typed answer while the mic is off', async () => {
    warm.items = [question];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    await typeAnswer(host, '4');
    await tick(10);
    expect(answered()[0].payload).toMatchObject({ chosenIndex: 1, correct: true });
    expect(ear.listens).toBe(0);
  });
});

/**
 * THE SAME CLASS, PREPARED AGAIN, IS NOT "LAST TIME" (production, 2026-09-29):
 * a topic prepared afresh gets a new lesson id, and she said "Last time we did
 * Equations with Variables on Both Sides. Today it's Equations with Variables
 * on Both Sides."
 */
describe('her greeting when the last class was this one', () => {
  it('welcomes them back to it, and does not call it last time', async () => {
    setLastSession({ lessonId: 'an-earlier-preparation', title: lesson.title, beatsDone: 20, total: 20 });
    await openClass({ tts: quickVoice() });
    const greeting = spoken.find((l) => /^(Hi|Welcome back)\b/.test(l)) ?? '';
    expect(greeting).toMatch(/^Welcome back/);
    expect(greeting).not.toContain('Last time we did');
    expect(greeting).toContain(lesson.title);
  });

  // Production again: a re-preparation retitled the topic ("Solving
  // Equations with…"), and she said "last time" of the same class.
  // Fourth review: two lessons share this topic (the heart, and blood), and
  // after the heart class she said "let's go through Blood again".
  it('does not take another lesson on the same topic for this one', async () => {
    setLastSession({ lessonId: 'class10-heart', title: 'The Heart', topicRef: lesson.topicRef, beatsDone: 20, total: 20 });
    await openClass({ tts: quickVoice() });
    const greeting = spoken.find((l) => /^(Hi|Welcome back)\b/.test(l)) ?? '';
    expect(greeting).toContain('Last time we did The Heart');
  });

  it('knows the same topic under a new title', async () => {
    setLastSession({ lessonId: 'an-earlier-preparation', title: 'Blood, its parts', topicRef: lesson.topicRef, beatsDone: 20, total: 20 });
    await openClass({ tts: quickVoice() });
    const greeting = spoken.find((l) => /^(Hi|Welcome back)\b/.test(l)) ?? '';
    expect(greeting).not.toContain('Last time we did');
  });
});

/** H4/H5 in the room (second review: neither reached a room test). */
describe('how she helped, on the record', () => {
  it('files the strategy with the help a wrong answer gets (H5)', async () => {
    ear.queued = ['Just plasma'];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick();
    await turnMicOn(host);
    await tick(10);
    expect(pending('helped')[0]).toMatchObject({ rung: 1, requested: false });
    expect(typeof pending('helped')[0].strategy).toBe('string');
  });

  it('files an asked-for explanation as L7, asked for, by its mode (H4)', async () => {
    const alt = askingLesson(RIGHT_WHY);
    alt.beats[0].ask = {
      ...alt.beats[0].ask!,
      alternates: [{ mode: 'analogy', say: 'Think of blood as a delivery team with different workers.' }],
    } as never;
    ear.queued = ['phir se samjhao'];
    const host = await openClass({ lesson: alt, tts: quickVoice() });
    await tick();
    await turnMicOn(host);
    await tick(10);
    expect(pending('helped')[0]).toMatchObject({ rung: 7, requested: true, strategy: 'analogy' });
    expect(spoken.some((l) => l.includes('Think of blood as a delivery team'))).toBe(true);
  });
});

/**
 * THE MIC DOES NOT CARRY INTO HER NEXT TEACHING (found by the test rewrite,
 * 2026-10-03). It was turned on for one exchange; a next beat that also asks
 * is her teaching first, and noise there must not stop her.
 */
describe('the mic, from one exchange into the next beat', () => {
  /** A voice that holds `line` until cancelled, and counts the cancels. */
  const holding = (line: () => string) => {
    const waiting: Array<() => void> = [];
    const state = { cancels: 0, waiting };
    const tts: TtsAdapter = {
      speak(text) {
        spoken.push(text);
        if (text === line()) return new Promise<void>((res) => waiting.push(res));
        return Promise.resolve();
      },
      cancel() {
        state.cancels += 1;
        for (const res of waiting.splice(0)) res();
      },
    };
    return { tts, state };
  };

  it('goes off after a question when the next beat asks too, so noise does not stop her teaching it', async () => {
    const two = askingLesson(RIGHT_WHY);
    two.beats[1].ask = { ...two.beats[0].ask! } as never;
    const { tts, state } = holding(() => two.beats[1].narration);
    ear.queued = ['Four'];
    const host = await openClass({ lesson: two, tts });
    await tick();
    await turnMicOn(host);
    await tick(10);
    // She is teaching beat 1, its line held: the mic went off with the exchange.
    expect(spoken).toContain(two.beats[1].narration);
    expect(state.waiting).toHaveLength(1);
    expect(micIsOn(host)).toBe(false);
    expect(ear.on).toBe(false);
    expect(ear.speech).toBeNull();
    const before = state.cancels;
    act(() => ear.speech?.());
    await tick(5);
    expect(state.cancels - before).toBe(0);
    expect(state.waiting).toHaveLength(1);
  });

  it('goes off after the warm-up when the first beat asks, so noise does not stop her teaching it', async () => {
    warm.items = [
      {
        id: 'carry-7',
        nodeId: 'x',
        title: 'T',
        topicRef: 'class8-maths/linear/solve',
        question: 'If 2x = 8, what is x?',
        options: ['2', '4', '6', '16'],
        correctIndex: 1,
        misconceptions: ['', '', '', ''],
      },
    ];
    const asking = askingLesson(RIGHT_WHY);
    const { tts, state } = holding(() => asking.beats[0].narration);
    ear.queued = ['4'];
    const host = await openClass({ lesson: asking, tts });
    await tick(10);
    await turnMicOn(host);
    await tick(10);
    expect(spoken).toContain(asking.beats[0].narration);
    expect(state.waiting).toHaveLength(1);
    expect(micIsOn(host)).toBe(false);
    expect(ear.speech).toBeNull();
    const before = state.cancels;
    act(() => ear.speech?.());
    await tick(5);
    expect(state.cancels - before).toBe(0);
  });
});
