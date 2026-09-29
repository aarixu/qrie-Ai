import { readFileSync } from 'node:fs';
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import type { TtsAdapter } from '@ai-tutor/player';
import { SUPPORT_REPLY } from '@ai-tutor/safety';

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
 * jsdom has no getUserMedia, so the mic is reported granted and `listenOnce`
 * hands back whatever transcript a test queued. Everything past the
 * transcript is real: `resolveSpokenAnswer`'s screen, the halt, the room. The
 * `isCancelled` the room passes in is KEPT, because polling it is how
 * ClassRoom closes a mic in flight — so a test can ask it afterwards whether
 * the mic would now close. With nothing queued, the mic stays open and hears
 * nothing, which is a student who taps instead.
 */
const ear = vi.hoisted(() => ({
  queued: [] as string[],
  polls: [] as (() => boolean)[],
  listens: 0,
  /** Holds a heard answer back, like the transcription round trip does. */
  hold: null as Promise<void> | null,
}));
vi.mock('../src/lib/mic', async (real) => ({
  ...(await real<typeof import('../src/lib/mic')>()),
  micStatus: () => 'granted',
}));
vi.mock('../src/lib/ear', async (real) => ({
  ...(await real<typeof import('../src/lib/ear')>()),
  listenOnce: async (opts: { isCancelled?: () => boolean } = {}) => {
    ear.listens += 1;
    if (opts.isCancelled) ear.polls.push(opts.isCancelled);
    const text = ear.queued.shift();
    // Nothing to say yet: the mic stays open until the room closes it, the
    // way the real one closes on its next chunk.
    if (text === undefined)
      return new Promise((resolve) => {
        const poll = setInterval(() => {
          if (opts.isCancelled?.()) {
            clearInterval(poll);
            resolve({ text: null, reason: 'cancelled' as const });
          }
        }, 10);
      });
    if (ear.hold) await ear.hold;
    return { text, reason: 'heard' as const };
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

/**
 * THE EXIT GATE FOR THIS FIX, IN THE REAL ROOM.
 *
 * "One typed distress line in a production doubt produces 0 further
 * /api/llm calls." lib/sessionHalt is tested path by path next door; this
 * mounts the whole classroom — real player, real handoff, real typed tutor —
 * with only the network, the voice and the microphone faked, raises a hand,
 * types, and looks at what the student would see and what left the device.
 * The spoken-answer and tapped-option paths, below, go through the same
 * mounted room.
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

async function typeDoubt(host: HTMLElement, text: string): Promise<void> {
  const input = byLabel(host, 'Type your doubt') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    byLabel(host, 'Send doubt').click();
  });
  await tick();
}

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
  spoken = [];
  exited = 0;
  ear.queued = [];
  ear.polls = [];
  ear.listens = 0;
  ear.hold = null;
  warm.items = [];
  resetLedgerOutbox();
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes('/api/llm')) llmCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: ANSWER } }] }),
    };
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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
    expect(spoken[spoken.length - 1]).toBe(SUPPORT_REPLY);
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
    expect(spoken.filter((l) => l === SUPPORT_REPLY)).toHaveLength(1);
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
  });
});

/**
 * The fixture lesson with a question on its first beat: two options, the
 * right one carrying `why`. `why` is the line she says about a tapped right
 * answer.
 */
function askingLesson(why: string): Lesson {
  const raw = JSON.parse(readFileSync('content/class10-blood/lesson.json', 'utf8'));
  raw.beats[0].ask = {
    question: 'How many components does blood have?',
    options: [
      { text: 'Four', correct: true, why },
      { text: 'Two', hint: 'Count the workers on the board.' },
    ],
  };
  const result = validateLesson(raw);
  if (!result.ok) throw new Error(`asking lesson is invalid: ${result.errors.join('; ')}`);
  return result.lesson;
}

const RIGHT_WHY = 'Plasma, red cells, white cells and platelets — four workers.';

/**
 * THE EAR, THROUGH THE REAL ROOM.
 *
 * lib/sessionHalt's own tests call `heard` directly and close a fake mic. This
 * is the wiring they cannot see: the room holds a question, opens the ear,
 * the student SAYS distress, and the answer runs through the room's own ear
 * loop — `resolveSpokenAnswer`'s screen, then the halt.
 */
describe('a spoken answer that is distress, in the real room', () => {
  it('halts the class: the support screen, the mic told to close, and no model reached', async () => {
    ear.queued = ['i want to kill myself'];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);

    // The ear really was opened, by the room, for this question.
    expect(ear.listens).toBe(1);
    const dialog = host.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(host.querySelector('#support-line')?.textContent).toBe(SUPPORT_REPLY);
    // The same poll ClassRoom's listen checks on every chunk now says stop:
    // the mic closes on its next one.
    expect(ear.polls[0]()).toBe(true);
    // Neither the judge nor anything else went to a model.
    expect(llmCalls).toBe(0);
    expect(spoken[spoken.length - 1]).toBe(SUPPORT_REPLY);
    expect(spoken.join(' ')).not.toContain('kill myself');
    // The room is gone: no chips to tap, no hand to raise.
    expect(host.querySelector('[aria-label="Raise hand and ask a doubt"]')).toBeNull();
    expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('Four'))).toBe(false);
  });
});

/**
 * A TAP IS NOT A WAY INTO THE HALT (lib/sessionHalt.ts, `sayAuthored`).
 *
 * The line she says about a tapped option is the lesson's own, screened where
 * the lesson was made with a reader that lets a curriculum line through. Here
 * it has no reader, so a line that trips the screen is withheld — and the
 * class carries on, because the student said nothing at all.
 */
describe('a tapped option whose why trips the distress screen', () => {
  const tapFour = async (host: HTMLElement): Promise<void> => {
    const four = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Four'));
    if (!four) throw new Error('the question never surfaced');
    await act(async () => {
      four.click();
    });
    await tick();
  };

  it('is not said, does not halt, and the class moves on', async () => {
    const why = "In Premchand's story the farmer says i want to kill myself — that is the story's point.";
    const host = await openClass({ lesson: askingLesson(why), tts: quickVoice() });
    await tick();

    await tapFour(host);

    expect(spoken.join(' ')).not.toContain('kill myself');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(host.querySelector('[aria-label="Raise hand and ask a doubt"]')).not.toBeNull();
    // The right answer opened the gate: the next beat is being taught.
    expect(spoken).toContain(lesson.beats[1].narration);
    // Nothing the child said, so nothing filed as the child's distress.
    expect(recentFlags(flagStore.get()).filter((f) => f.kind === 'distress')).toHaveLength(0);
    expect(llmCalls).toBe(0);
  });

  it('an ordinary why is said, then the class moves on', async () => {
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick();

    await tapFour(host);

    // Since 2026-09-29 the praise is decide()'s (a short persona line) with
    // the authored why inside it — so the why itself is what must be heard.
    expect(spoken.some((line) => line.includes(RIGHT_WHY))).toBe(true);
    expect(spoken).toContain(lesson.beats[1].narration);
  });
});

/**
 * THE HELD QUESTION'S LADDER, IN THE REAL ROOM (overnight review, 2026-09-29).
 *
 * decide() is tested as a table next door (packages/tutor-control). These are
 * the wiring faults the review found in the room around it: a "let's keep
 * going" that did not, a hint chip that wrote the leaking hint decide() had
 * refused, a tap the open mic kept listening through, "hint do" judged as an
 * answer, and a greeting that started the class after they had left.
 */
describe('the held question, in the real room', () => {
  const tap = async (host: HTMLElement, label: string): Promise<void> => {
    const chip = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
    if (!chip) throw new Error(`no "${label}" on screen`);
    await act(async () => {
      chip.click();
    });
    await tick();
  };

  it('moves the class on when she says "let\'s keep going" after the reveal', async () => {
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick();
    // Look again, the hint, the answer — then a fourth miss.
    for (let i = 0; i < 4; i += 1) await tap(host, 'Two');
    expect(spoken.some((l) => /keep going|carry on/i.test(l))).toBe(true);
    expect(spoken).toContain(lesson.beats[1].narration);
  });

  it('never writes a hint decide() refused for giving the answer away', async () => {
    const leaky = askingLesson(RIGHT_WHY);
    leaky.beats[0].ask!.hint = 'It is Four, so tap Four.';
    const host = await openClass({ lesson: leaky, tts: quickVoice() });
    await tick();
    await tap(host, 'Give me a hint');
    expect(host.textContent).not.toContain('It is Four');
    expect(spoken.join(' ')).not.toContain('It is Four');
  });

  it('writes the hint decide() approved', async () => {
    const fine = askingLesson(RIGHT_WHY);
    fine.beats[0].ask!.hint = 'Count the workers on the board.';
    const host = await openClass({ lesson: fine, tts: quickVoice() });
    await tick();
    await tap(host, 'Give me a hint');
    expect(spoken.some((l) => l.includes('Count the workers on the board.'))).toBe(true);
  });

  it('closes the open mic the moment they tap', async () => {
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick();
    expect(ear.polls.length).toBeGreaterThan(0);
    const listening = ear.polls[ear.polls.length - 1];
    expect(listening()).toBe(false);
    const opened = ear.listens;
    await tap(host, 'Two');
    // That listen was closed by the tap, and a fresh one opened after her reply.
    expect(ear.listens).toBeGreaterThan(opened);
  });

  it('hears "hint do" as a request for the hint, not as an answer to judge', async () => {
    const fine = askingLesson(RIGHT_WHY);
    fine.beats[0].ask!.hint = 'Count the workers on the board.';
    ear.queued = ['hint do'];
    await openClass({ lesson: fine, tts: quickVoice() });
    await tick(10);
    expect(llmCalls).toBe(0);
    expect(spoken.some((l) => l.includes('Count the workers on the board.'))).toBe(true);
    // Not a wrong answer on record: no "not quite" for asking.
    expect(spoken.some((l) => /not quite|not yet|miss hua/i.test(l))).toBe(false);
  });

  it('drops a spoken answer that lands after they tapped (second review)', async () => {
    let release: () => void = () => undefined;
    ear.hold = new Promise<void>((r) => (release = r));
    ear.queued = ['Four'];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick();
    await tap(host, 'Two');
    release();
    await tick(10);
    // Their tap was the answer: no judge call for the words, no praise, no move on.
    expect(llmCalls).toBe(0);
    expect(spoken.some((l) => l.includes(RIGHT_WHY))).toBe(false);
    expect(spoken).not.toContain(lesson.beats[1].narration);
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

  it('says "I am not sure" for them, so Meera starts guiding instead of waiting on typing (#28)', async () => {
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick();
    await tap(host, "I'm not sure");
    await tick(10);
    expect(host.textContent).toContain("I'm not sure how to answer this question.");
    expect(llmCalls).toBe(1);
  });

  it('still halts on distress in words that landed after a tap (third review)', async () => {
    let release: () => void = () => undefined;
    ear.hold = new Promise<void>((r) => (release = r));
    ear.queued = ['i want to kill myself'];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick();
    await tap(host, 'Two');
    release();
    await tick(10);
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(spoken[spoken.length - 1]).toBe(SUPPORT_REPLY);
  });

  it('hears the reply to a follow-up question as reasoning, not as a second answer (C7)', async () => {
    const probed = askingLesson(RIGHT_WHY);
    probed.beats[0].ask = {
      ...probed.beats[0].ask!,
      whyProbe: {
        askedAs: 'options',
        options: [
          { text: 'Four', correct: true, why: RIGHT_WHY },
          { text: 'Two', correct: false, why: 'Only two were counted.', followUp: 'Which two did you count?' },
        ],
      },
    } as never;
    const host = await openClass({ lesson: probed, tts: quickVoice() });
    await tick();
    // Said after the tap: the open listen closes on the tap, the next one hears it.
    ear.queued = ['I counted the red cells and the plasma'];
    await tap(host, 'Two');
    await tick(20);
    expect(spoken).toContain('Which two did you count?');
    expect(llmCalls).toBe(0);
    expect(spoken.some((l) => /another go|once more/i.test(l))).toBe(true);
    // Not judged: no hint for answering what she asked.
    expect(spoken.some((l) => l.includes('Count the workers on the board.'))).toBe(false);
  });

  it('judges a reply to a follow-up that says the answer, and moves on (fifth review)', async () => {
    const probed = askingLesson(RIGHT_WHY);
    probed.beats[0].ask = {
      ...probed.beats[0].ask!,
      whyProbe: {
        askedAs: 'options',
        options: [
          { text: 'Four', correct: true, why: RIGHT_WHY },
          { text: 'Two', correct: false, why: 'Only two were counted.', followUp: 'Which two did you count?' },
        ],
      },
    } as never;
    const host = await openClass({ lesson: probed, tts: quickVoice() });
    await tick();
    // Said after the tap and her follow-up.
    ear.queued = ['oh wait, it is Four'];
    await tap(host, 'Two');
    await tick(20);
    expect(spoken).toContain('Which two did you count?');
    expect(spoken.some((l) => /another go|once more/i.test(l))).toBe(false);
    expect(spoken).toContain(lesson.beats[1].narration);
  });

  it('checks typed working step by step, and takes a solving step as the answer (T8.1)', async () => {
    const worked = askingLesson(RIGHT_WHY);
    worked.beats[0].ask = { question: 'Solve three times x plus four equals twenty one.', written: 'Solve $3(x + 4) = 21$', expect: 'x = 3' } as never;
    const host = await openClass({ lesson: worked, tts: quickVoice() });
    await tick();
    await tap(host, 'Work it out');
    const type = async (text: string) => {
      const input = byLabel(host, 'Your next step') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      await act(async () => {
        setter.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await tap(host, 'Check step');
    };
    await type('3x + 4 = 21');
    expect(spoken.some((l) => /changes the equation/.test(l))).toBe(true);
    await type('3x + 12 = 21');
    expect(spoken.some((l) => /that step holds/.test(l))).toBe(true);
    await type('3x = 21 - 12 = 8');
    expect(spoken.some((l) => /calculation is off/.test(l))).toBe(true);
    await type('x = 3');
    await tick(10);
    expect(spoken).toContain(lesson.beats[1].narration);
  });

  it('takes a step that is the equation the question asks for as the answer', async () => {
    const worked = askingLesson(RIGHT_WHY);
    worked.beats[0].ask = {
      question: 'If you remove one x from both sides, what remains?',
      written: 'If you remove one $x$ from both sides of $2x + 3 = x + 7$, what remains?',
      expect: 'What remains is x + 3 = 7.',
    } as never;
    const host = await openClass({ lesson: worked, tts: quickVoice() });
    await tick();
    await tap(host, 'Work it out');
    const input = byLabel(host, 'Your next step') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, 'x + 3 = 7');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await tap(host, 'Check step');
    await tick(10);
    expect(spoken).toContain(lesson.beats[1].narration);
  });

  it('explains it another way when asked, by tap or out loud (H4)', async () => {
    const alt = askingLesson(RIGHT_WHY);
    alt.beats[0].ask = {
      ...alt.beats[0].ask!,
      alternates: [
        { mode: 'analogy', say: 'Think of blood as a delivery team with different workers.' },
        { mode: 'everyday', say: 'Like a school with teachers, guards and cooks, each doing one job.' },
      ],
    } as never;
    const host = await openClass({ lesson: alt, tts: quickVoice() });
    await tick();
    ear.queued = ['phir se samjhao'];
    await tap(host, 'Explain another way');
    await tick(10);
    const explained = spoken.filter((l) => /delivery team|school with teachers/.test(l));
    expect(explained.length).toBe(2);
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
 * THE CLASS OPENS WITH A WARM-UP WHEN A REVIEW IS DUE (E6-E8).
 *
 * One authored probe per due outcome, asked after her greeting and before the
 * first beat; the tap is filed cold under the probe's own outcome, she says
 * whether it was right, and the class begins.
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
  const tapText = async (host: HTMLElement, text: string): Promise<void> => {
    const chip = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().endsWith(text));
    if (!chip) throw new Error(`no button reads "${text}"`);
    await act(async () => {
      chip.click();
    });
    await tick(10);
  };
  const answered = () => ledgerOutbox.get().pending.filter((e) => e.kind === 'answered');

  it('asks the due review before the class, files the tap cold, and then teaches', async () => {
    warm.items = [question];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);

    expect(host.textContent).toContain('If 2x = 8, what is x?');
    // The class has not begun under it: the first beat's chips are not up.
    expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('Four'))).toBe(false);

    await tapText(host, '4');
    expect(answered()).toHaveLength(1);
    expect(answered()[0]).toMatchObject({ outcomeIds: ['maths8-lin-solve'], topicRef: 'class8-maths/linear/solve' });
    expect(answered()[0].payload).toMatchObject({ probeId: 'probe-7', chosenIndex: 1, correct: true, assistanceRung: 0 });
    expect(spoken.some((l) => /remembered/i.test(l))).toBe(true);

    await tick(10);
    expect(host.textContent).not.toContain('If 2x = 8, what is x?');
    expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('Four'))).toBe(true);
  });

  it('says the right answer after a wrong one', async () => {
    warm.items = [question];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    await tapText(host, '16');
    expect(answered()[0].payload).toMatchObject({ chosenIndex: 3, correct: false, assistanceRung: 0 });
    expect(spoken.some((l) => l.includes('The answer is 4'))).toBe(true);
  });

  it('files nothing when it is skipped, and the class begins', async () => {
    warm.items = [question];
    const host = await openClass({ lesson: askingLesson(RIGHT_WHY), tts: quickVoice() });
    await tick(10);
    await tapText(host, 'Skip warm-up');
    expect(answered()).toHaveLength(0);
    expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('Four'))).toBe(true);
  });
});
