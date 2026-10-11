import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import type { TtsAdapter } from '@ai-tutor/player';

/**
 * A STUDENT STOPPING HER, IN THE REAL ROOM (Aarav, 2026-10-02: "STT kaam nahi
 * kar raha, tutor interrupt nahi ho rahi"; 2026-10-03: "agar mic hamesha on
 * rahta hai to bg noise se ye baar baar interrupt hota hai — mic ka button
 * bana do raise hand ke saath, jise click karne par hi mic on ho").
 *
 * The class's mic is OFF until the student taps "Turn the mic on" beside the
 * raised hand. The tap opens it (lib/ear.ts `openEar`, faked here: it opens
 * when `ear.mic` is 'granted'); while it is on, the ear says when the student
 * starts talking (`onStudentSpeech`, captured here). Everything past the
 * microphone is real: the player, the handoff, the typed tutor, the judge's
 * local read. What the ear "hears" is queued by each test.
 */
const ear = vi.hoisted(() => ({
  /** What turning the mic on gets: 'granted' opens it, 'denied' does not. */
  mic: 'granted' as 'granted' | 'denied',
  /** The mic is on right now. */
  open: false,
  /** Times the class turned the mic on, and off. */
  opens: 0,
  closes: 0,
  queued: [] as (string | null)[],
  listens: 0,
  /** Listens begun while the mic was off: a class that heard the room without a tap. */
  deaf: 0,
  speech: null as (() => void) | null,
}));
vi.mock('../src/lib/mic', async (real) => ({
  ...(await real<typeof import('../src/lib/mic')>()),
  micStatus: () => 'granted',
  micExplained: () => true,
  requestMic: async () => 'granted',
}));
vi.mock('../src/lib/ear', async (real) => ({
  ...(await real<typeof import('../src/lib/ear')>()),
  openEar: async () => {
    ear.opens += 1;
    ear.open = ear.mic === 'granted';
    return ear.open;
  },
  closeEar: () => {
    ear.closes += 1;
    ear.open = false;
  },
  isEarOpen: () => ear.open,
  onStudentSpeech: (listen: () => void) => {
    ear.speech = listen;
    return () => {
      if (ear.speech === listen) ear.speech = null;
    };
  },
  listenOnce: async (opts: { isCancelled?: () => boolean } = {}) => {
    ear.listens += 1;
    if (!ear.open) ear.deaf += 1;
    if (ear.queued.length === 0)
      return new Promise((resolve) => {
        const poll = setInterval(() => {
          if (opts.isCancelled?.()) {
            clearInterval(poll);
            resolve({ text: null, reason: 'cancelled' as const });
          }
        }, 10);
      });
    const next = ear.queued.shift()!;
    return next === null ? { text: null, reason: 'silence' as const } : { text: next, reason: 'heard' as const };
  },
}));
vi.mock('../src/lib/warmUp', async (real) => ({
  ...(await real<typeof import('../src/lib/warmUp')>()),
  warmUpFor: async () => [],
}));

import { ClassRoom } from '../src/screens/ClassRoom';
import { settingsStore } from '../src/stores/settings';
import { progressStore } from '../src/stores/progress';
import { ledgerOutbox, resetLedgerOutbox } from '../src/stores/ledger';

const read = (): Record<string, unknown> => JSON.parse(readFileSync('content/class10-blood/lesson.json', 'utf8'));
const valid = (raw: Record<string, unknown>): Lesson => {
  const result = validateLesson(raw);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.lesson;
};
const teaching = valid(read());
/** The first beat asks, openly, with its answer judged on the device. */
const asking = ((): Lesson => {
  const raw = read() as { beats: Record<string, unknown>[] };
  raw.beats[0].ask = {
    question: 'How many components does blood have?',
    options: [{ text: 'Four', correct: true, why: 'Plasma, red cells, white cells and platelets.' }, { text: 'Just plasma' }],
  };
  const lesson = valid(raw as never);
  lesson.beats[0].ask = {
    ...lesson.beats[0].ask!,
    whyProbe: {
      askedAs: 'open',
      options: [
        { text: 'Four', correct: true, why: 'Plasma, red cells, white cells and platelets.' },
        { text: 'Just plasma', correct: false, why: 'Only one was counted.' },
      ],
    },
  } as never;
  return lesson;
})();

const ANSWER = '{"say":"Blood carries oxygen in red blood cells.","recallBeatId":null,"done":false}';
const roots: Root[] = [];
let llmBodies: string[] = [];
let spoken: string[] = [];

/**
 * Holds the class's first line (she is mid-sentence) until it is cancelled,
 * and any line `holds` names; says the rest at once.
 */
function voice(holds: (text: string) => boolean = () => false): TtsAdapter {
  const waiting: Array<() => void> = [];
  let first = true;
  return {
    speak(text) {
      spoken.push(text);
      if (holds(text)) return new Promise<void>((resolve) => waiting.push(resolve));
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

/**
 * Says every line at once except any `holds` names: the class reaches its
 * held question, which is where a student taps to answer out loud.
 */
function sayAll(holds: (text: string) => boolean = () => false): TtsAdapter {
  const waiting: Array<() => void> = [];
  return {
    speak(text) {
      spoken.push(text);
      if (holds(text)) return new Promise<void>((resolve) => waiting.push(resolve));
      return Promise.resolve();
    },
    cancel() {
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
}

/**
 * Each hop waits a few real milliseconds, not a bare 0: the fake ear polls on a
 * 10 ms interval and the room's doubt loop pauses 150 ms on her turn, so a
 * count of 0 ms hops ran out before them on a slower machine.
 */
async function tick(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

async function openClass(lesson: Lesson, tts: TtsAdapter = voice()): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/lesson/class10-blood']}>
        <ClassRoom lesson={lesson} tts={tts} diagrams={{}} onExit={() => undefined} warm />
      </MemoryRouter>,
    );
  });
  await tick();
  return host;
}

/** The mic button's label right now: what a tap on it would do. */
const micLabel = (host: HTMLElement): string | null =>
  host.querySelector('button[aria-label^="Turn the mic"]')?.getAttribute('aria-label') ?? null;

/**
 * The student taps the mic button beside the raised hand — on, or (with
 * 'Turn the mic off') off again. The only way the class ever hears them.
 */
async function tapMic(host: HTMLElement, label: 'Turn the mic on' | 'Turn the mic off' = 'Turn the mic on'): Promise<void> {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button, `the toolbar offers "${label}"`).not.toBeNull();
  expect(button!.disabled, `"${label}" can be tapped`).toBe(false);
  await act(async () => {
    button!.click();
  });
  await tick(12);
}

/** With the mic on, the student starts talking: the ear's speech detector fires. */
async function speakOver(): Promise<void> {
  expect(ear.speech, 'with the mic on, the room listens for the student talking').not.toBeNull();
  await act(async () => {
    ear.speech!();
  });
  await tick(12);
}

/** The question is held: she has put it, and with the mic off the box waits. */
const questionHeld = (host: HTMLElement): boolean =>
  host.querySelector('button[aria-label="Type an answer"]') !== null;

const inDoubt = (host: HTMLElement): boolean => host.querySelector('[aria-label="Got it — back to the class"]') !== null;
/** The answers filed so far: the verdict, and how it came (said, or typed). */
const answers = (): { verdict?: string; surface: string }[] =>
  ledgerOutbox
    .get()
    .pending.filter((e) => e.kind === 'answered')
    .map((e) => ({ verdict: (e.payload as { verdict?: string }).verdict, surface: e.surface }));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView ??= () => undefined;
  localStorage.clear();
  sessionStorage.clear();
  progressStore.set({ lessons: {}, lastLessonId: null });
  settingsStore.update((s) => ({ ...s, klass: 10 }));
  vi.stubEnv('VITE_GEMINI_API_KEY', '');
  ear.mic = 'granted';
  ear.open = false;
  ear.opens = 0;
  ear.closes = 0;
  ear.queued = [];
  ear.listens = 0;
  ear.deaf = 0;
  ear.speech = null;
  llmBodies = [];
  spoken = [];
  resetLedgerOutbox();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/llm')) llmBodies.push(String(init?.body ?? ''));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: ANSWER } }] }) };
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

describe('noise while she teaches (Aarav, 2026-10-03)', () => {
  it('never stops her: the mic is off, nothing listens, and the ear has no listener', async () => {
    const host = await openClass(teaching);
    await tick(12);
    // The class began without turning the mic on: nothing the room says reaches it.
    expect(ear.opens).toBe(0);
    expect(ear.listens).toBe(0);
    expect(ear.speech, 'no speech detector while the mic is off').toBeNull();
    expect(micLabel(host)).toBe('Turn the mic on');
    // She is still on her first line, uninterrupted.
    expect(spoken).toContain(teaching.beats[0].narration);
    expect(spoken.filter((s) => s === teaching.beats[0].narration)).toHaveLength(1);
    expect(host.querySelector('[data-bloub]')?.getAttribute('data-bloub')).toBe('teaching');
    expect(inDoubt(host)).toBe(false);
  });
});

describe('stopping her while she teaches: a tap on the mic', () => {
  it('stops her, and their words open a doubt — no entry line said over them — that she answers', async () => {
    const host = await openClass(teaching);
    const before = spoken.length;
    ear.queued = ['wait, why is blood red?'];
    await tapMic(host);
    await tick(12);

    expect(ear.opens).toBe(1);
    expect(inDoubt(host)).toBe(true);
    // Their words went to the tutor as the doubt's first message...
    expect(llmBodies.some((b) => b.includes('why is blood red?'))).toBe(true);
    // ...and the only thing she said since is her answer to it.
    expect(spoken.slice(before)).toEqual(['Blood carries oxygen in red blood cells.']);
  });

  it('carries on teaching when nothing was heard, and the mic goes off with it', async () => {
    const host = await openClass(teaching);
    const first = teaching.beats[0].narration;
    ear.queued = [null]; // the tap's listen hears nobody
    await tapMic(host);
    expect(inDoubt(host)).toBe(false);
    expect(llmBodies).toHaveLength(0);
    // The beat is said again from its start: the class carries on.
    expect(spoken.filter((s) => s === first).length).toBe(2);
    // And the mic is off again, so the room cannot stop her a second time.
    expect(micLabel(host)).toBe('Turn the mic on');
    expect(ear.open).toBe(false);
    expect(ear.speech).toBeNull();
  });

  it('ends the spoken doubt when they say they have got it', async () => {
    const host = await openClass(teaching);
    ear.queued = ['wait, why is blood red?', 'haan samajh aa gaya'];
    await tapMic(host);
    await tick(20);
    expect(inDoubt(host)).toBe(false);
    expect(llmBodies).toHaveLength(1);
  });

  it('a second tap while it waits to hear them turns the mic off, and the class carries on', async () => {
    const host = await openClass(teaching);
    const first = teaching.beats[0].narration;
    await tapMic(host); // nothing queued: the tap's listen is still open
    expect(micLabel(host)).toBe('Turn the mic off');
    expect(ear.open).toBe(true);
    // The class waits on them: the beat has not been picked up again yet.
    expect(spoken.filter((s) => s === first)).toHaveLength(1);

    const closes = ear.closes;
    await tapMic(host, 'Turn the mic off');
    await tick(12);
    expect(ear.closes).toBeGreaterThan(closes);
    expect(ear.open).toBe(false);
    expect(micLabel(host)).toBe('Turn the mic on');
    expect(inDoubt(host)).toBe(false);
    expect(llmBodies).toHaveLength(0);
    // She picks the beat up from its start.
    expect(spoken.filter((s) => s === first)).toHaveLength(2);
  });

  it('a mic that will not turn on says so, and the class carries on', async () => {
    ear.mic = 'denied';
    const host = await openClass(teaching);
    const first = teaching.beats[0].narration;
    await tapMic(host);
    expect(ear.opens).toBe(1);
    expect(host.textContent).toContain("The mic didn't turn on. You can type instead.");
    expect(micLabel(host)).toBe('Turn the mic on');
    // Nothing listened on a mic that is not there, and she goes on teaching.
    expect(ear.listens).toBe(0);
    expect(inDoubt(host)).toBe(false);
    expect(spoken.filter((s) => s === first)).toHaveLength(2);
  });
});

describe('a trial, with no class on file (Aarav, 2026-10-03: "meri voice use samajh hi nahi aa rahi")', () => {
  it('answers a spoken doubt with the real tutor, pitched at the lesson’s own class, not the scripted floor', async () => {
    settingsStore.update((s) => ({ ...s, klass: null }));
    const host = await openClass(teaching);
    ear.queued = ['wait, why is blood red?'];
    await tapMic(host);
    await tick(12);
    expect(inDoubt(host)).toBe(true);
    // The model was asked, with their words, about a Class 10 student.
    const body = llmBodies.find((b) => b.includes('why is blood red?'));
    expect(body, 'the doubt reached the real tutor').toBeDefined();
    expect(body).toMatch(/class 10/i);
    expect(spoken).toContain('Blood carries oxygen in red blood cells.');
  });

  it('shows what was heard beside her, so a mishearing can be seen', async () => {
    const host = await openClass(teaching);
    ear.queued = ['wait, why is blood red?'];
    await tapMic(host);
    expect(host.textContent).toContain('Heard: "wait, why is blood red?"');
  });
});

describe('her shape marks the moments (Aarav, 2026-10-03: "bloub ko animation do alag alag")', () => {
  const cue = (host: HTMLElement): string | null => host.querySelector('[data-bloub]')?.getAttribute('data-bloub-cue') ?? null;

  it('plays as the class begins, and bursts at a right answer', async () => {
    const host = await openClass(asking, sayAll());
    expect(cue(host)).toBe('play');
    ear.queued = ['Four'];
    await tapMic(host);
    await tick(12);
    expect(answers().map((a) => a.verdict)).toEqual(['right']);
    expect(cue(host)).toBe('burst');
  });

  it('tilts at a wrong answer', async () => {
    const host = await openClass(asking, sayAll((t) => t !== asking.beats[0].narration && !/^(Hi|Welcome back)\b/.test(t)));
    ear.queued = ['Just plasma'];
    await tapMic(host);
    await tick(12);
    expect(answers().map((a) => a.verdict)).toEqual(['wrong']);
    expect(cue(host)).toBe('egg');
  });

  it('gives the "!" when a hand goes up, and swirls back when the doubt is over', async () => {
    const host = await openClass(teaching);
    await act(async () => {
      host.querySelector<HTMLElement>('[aria-label="Raise hand and ask a doubt"]')!.click();
    });
    await tick(12);
    expect(inDoubt(host)).toBe(true);
    expect(cue(host)).toBe('alert');
    await act(async () => {
      host.querySelector<HTMLElement>('[aria-label="Got it — back to the class"]')!.click();
    });
    await tick(16);
    expect(inDoubt(host)).toBe(false);
    expect(cue(host)).toBe('swirl');
  });
});

describe('her question, and the mic', () => {
  it('a tap at her held question: what they say is taken as the answer', async () => {
    const host = await openClass(asking, sayAll());
    expect(questionHeld(host), 'she has put the question').toBe(true);
    ear.queued = ['Four'];
    await tapMic(host);
    await tick(12);
    expect(answers().map((a) => a.verdict)).toEqual(['right']);
    expect(answers()[0].surface).toBe('voice');
    expect(ear.deaf).toBe(0);
  });

  it('a tap while she is still teaching the beat that asks is a stop, not an answer: their words open a doubt', async () => {
    // Her narration, the question at its end, is held: she is mid-way through it.
    const host = await openClass(asking);
    expect(questionHeld(host)).toBe(false);
    ear.queued = ['wait, why is blood red?'];
    await tapMic(host);
    await tick(12);
    expect(inDoubt(host)).toBe(true);
    expect(llmBodies.some((b) => b.includes('why is blood red?'))).toBe(true);
    // Nothing was judged as an answer to a question she had not finished putting.
    expect(answers()).toEqual([]);
  });

  it('does not judge her own question, back through the speaker, as their answer', async () => {
    const host = await openClass(asking, sayAll());
    expect(questionHeld(host)).toBe(true);
    // The ear first hears her question leaking through; then the student.
    ear.queued = [asking.beats[0].narration, 'Four'];
    await tapMic(host);
    await tick(16);
    expect(answers().map((a) => a.verdict)).toEqual(['right']);
  });

  it('with the mic on, talking over her line after a wrong answer stops it, and what they say next is the answer', async () => {
    let holdNext = false;
    // Her first line after the tap — her reply to their wrong answer — is held: she is mid-way through it.
    const host = await openClass(
      asking,
      sayAll(() => {
        if (!holdNext) return false;
        holdNext = false;
        return true;
      }),
    );
    expect(questionHeld(host)).toBe(true);
    ear.queued = ['Just plasma'];
    holdNext = true;
    await tapMic(host);
    await tick(12);
    // Her reply to it is being said, and until it ends the question's ear waits on it.
    expect(answers().map((a) => a.verdict)).toEqual(['wrong']);
    expect(spoken.at(-1)).not.toBe(asking.beats[0].narration);
    ear.queued = ['Four'];
    await speakOver(); // over her reply
    await tick(16);
    // Stopped: the ear took its next answer, which it could not have under her held line.
    expect(answers().map((a) => a.verdict)).toEqual(['wrong', 'right']);
  });

  it('a second tap turns the mic off: the listen ends, and the typed box takes the answer', async () => {
    const host = await openClass(asking, sayAll());
    expect(questionHeld(host)).toBe(true);
    const box = (): Element | null => host.querySelector('input[aria-label="Type your answer"]');
    const keyboard = (): Element | null => host.querySelector('button[aria-label="Type an answer"]');
    await tapMic(host); // nothing queued: the question's ear is listening
    expect(micLabel(host)).toBe('Turn the mic off');
    expect(box(), 'no typing box while they answer out loud').toBeNull();
    expect(keyboard(), 'nor a keyboard button').toBeNull();

    await tapMic(host, 'Turn the mic off');
    await tick(20);
    expect(ear.open).toBe(false);
    expect(micLabel(host)).toBe('Turn the mic on');
    expect(ear.speech).toBeNull();
    // The question still stands; the keyboard is offered, and the box opens on its tap.
    expect(answers()).toEqual([]);
    expect(box(), 'the box does not open by itself').toBeNull();
    await act(async () => {
      (keyboard() as HTMLElement).click();
    });
    expect(box()).not.toBeNull();

    const listens = ear.listens;
    const input = box() as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, 'Four');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      host.querySelector<HTMLElement>('[aria-label="Send answer"]')!.click();
    });
    await tick(12);
    expect(answers().map((a) => [a.verdict, a.surface])).toEqual([['right', 'text']]);
    // Typed, not heard: no listen ran on a mic they had turned off.
    expect(ear.listens).toBe(listens);
    expect(ear.deaf).toBe(0);
  });
});

describe('the mic goes off by itself', () => {
  it('once the question it was turned on for is answered and she teaches again', async () => {
    const host = await openClass(asking, sayAll((t) => t === asking.beats[1].narration));
    expect(questionHeld(host)).toBe(true);
    ear.queued = ['Four'];
    await tapMic(host);
    await tick(16);
    expect(answers().map((a) => a.verdict)).toEqual(['right']);
    // The gate opened and the class is on its next beat, with the mic off.
    expect(spoken).toContain(asking.beats[1].narration);
    expect(ear.open).toBe(false);
    expect(micLabel(host)).toBe('Turn the mic on');
    expect(ear.speech, 'no speech detector while she teaches').toBeNull();
    // And nothing listens while she does.
    const listens = ear.listens;
    await tick(12);
    expect(ear.listens).toBe(listens);
  });

  /**
   * A DOUBT RAISED AT THE QUESTION THE MIC WAS TURNED ON FOR (integration
   * audit, 2026-10-11). After "Got it" she re-speaks that beat, and the mic
   * stayed lit through her teaching because it still named that beat. The
   * re-spoken narration is held here, or the question is held again in the
   * same microtask and the test proves nothing.
   */
  it('once a doubt raised at the question it was turned on for is over, while she re-teaches that beat', async () => {
    let n = 0;
    const host = await openClass(asking, sayAll((t) => t.endsWith(asking.beats[0].narration) && ++n === 2));
    expect(questionHeld(host)).toBe(true);
    await tapMic(host); // nothing queued
    expect(micLabel(host)).toBe('Turn the mic off');
    await act(async () => {
      host.querySelector<HTMLElement>('[aria-label="Raise hand and ask a doubt"]')!.click();
    });
    await tick(12);
    expect(inDoubt(host)).toBe(true);
    expect(ear.open).toBe(true); // the doubt keeps the mic
    await act(async () => {
      host.querySelector<HTMLElement>('[aria-label="Got it — back to the class"]')!.click();
    });
    await tick(16);
    expect(inDoubt(host)).toBe(false);
    expect(spoken.filter((s) => s.endsWith(asking.beats[0].narration))).toHaveLength(2); // mid re-teach
    expect(questionHeld(host)).toBe(false);
    expect(ear.open).toBe(false);
    expect(micLabel(host)).toBe('Turn the mic on');
    expect(ear.speech).toBeNull();
  });

  it('once the doubt it was turned on for is over and the class is back', async () => {
    const host = await openClass(teaching);
    ear.queued = ['wait, why is blood red?', 'haan samajh aa gaya'];
    await tapMic(host);
    await tick(20);
    expect(inDoubt(host)).toBe(false);
    expect(ear.open).toBe(false);
    expect(micLabel(host)).toBe('Turn the mic on');
    expect(ear.speech).toBeNull();
    const listens = ear.listens;
    await tick(12);
    expect(ear.listens).toBe(listens);
  });
});

/**
 * THE BOARD WRITES AS SHE SPEAKS, FROM THE FIRST LINE (integration audit,
 * 2026-10-11). The board used to draw beat 0 the moment the room mounted, so
 * she greeted the student over a board already written and the first line's
 * ink never appeared while she said it.
 */
describe('the first line is written as she says it', () => {
  it('shows a blank board while she greets, and beat 0 draws in as she starts it', async () => {
    let release: () => void = () => undefined;
    const tts: TtsAdapter = {
      speak(text) {
        spoken.push(text);
        if (/^(Hi|Welcome back)\b/.test(text)) return new Promise<void>((resolve) => (release = resolve));
        return new Promise<void>(() => undefined);
      },
      cancel() {
        release();
      },
    };
    const host = await openClass(teaching, tts);
    const board = (): HTMLElement => host.querySelector('section') as HTMLElement;
    expect(spoken.some((s) => /^(Hi|Welcome back)\b/.test(s)), 'she is greeting').toBe(true);
    expect(board().querySelectorAll('[data-element-id]')).toHaveLength(0);
    await act(async () => {
      release();
    });
    await tick(12);
    expect(spoken[spoken.length - 1]).toContain(teaching.beats[0].narration);
    for (const id of teaching.beats[0].show) expect(board().querySelector(`[data-element-id="${id}"]`), id).not.toBeNull();
  });
});

describe('the review’s cases (2026-10-02)', () => {
  it('talking over her reply in a doubt: she stops, and what they say goes to her next', async () => {
    const reply = 'Blood carries oxygen in red blood cells.';
    const host = await openClass(teaching, voice((t) => t === reply));
    ear.queued = ['wait, why is blood red?'];
    await tapMic(host); // opens the doubt; her reply is now being said (held)
    expect(inDoubt(host)).toBe(true);
    expect(spoken).toContain(reply);
    // The mic stays on through the doubt it opened.
    expect(micLabel(host)).toBe('Turn the mic off');
    ear.queued = ['but why not blue?'];
    await speakOver(); // over her reply
    await tick(16);
    expect(llmBodies.some((b) => b.includes('but why not blue?'))).toBe(true);
  });

  it('a hand raised while she is hearing an interruption opens one doubt, and the class is not restarted under it', async () => {
    const host = await openClass(teaching);
    await tapMic(host); // nothing queued: the tap's listen is still open
    const said = spoken.length;
    await act(async () => {
      host.querySelector<HTMLElement>('[aria-label="Raise hand and ask a doubt"]')!.click();
    });
    await tick(16);
    expect(inDoubt(host)).toBe(true);
    expect(ledgerOutbox.get().pending.filter((e) => e.kind === 'confused')).toHaveLength(1);
    // The beat was not said again under the doubt.
    expect(spoken.slice(said)).not.toContain(teaching.beats[0].narration);
  });
});

describe('the board has the room (Aarav, 2026-10-03)', () => {
  it('shows no tile and no doubt panel, and her shape says what she is doing', async () => {
    const host = await openClass(teaching);
    const shape = (): string | null => host.querySelector('[data-bloub]')?.getAttribute('data-bloub') ?? null;
    const toolbar = (): string[] =>
      [...host.querySelectorAll('nav button')].map((b) => b.getAttribute('aria-label') ?? '');
    // Nothing stands beside the board: no rail, no picture-in-picture, no panel.
    expect(host.querySelector('aside')).toBeNull();
    expect(host.querySelector('textarea')).toBeNull();
    expect(shape()).toBe('teaching');
    // The mic sits just before the raised hand.
    expect(toolbar().slice(0, 2)).toEqual(['Turn the mic on', 'Raise hand and ask a doubt']);

    ear.queued = ['wait, why is blood red?'];
    await tapMic(host);
    await tick(12);
    expect(inDoubt(host)).toBe(true);
    // Her answer is said; the doubt waits on the student again.
    expect(shape()).toBe('listening');
    expect(host.querySelector('aside')).toBeNull();
    // The typed doubt is still a tap away, just after the mic.
    const buttons = toolbar();
    const mic = buttons.indexOf('Turn the mic off');
    expect(mic).toBeGreaterThanOrEqual(0);
    expect(buttons.slice(mic, mic + 2)).toEqual(['Turn the mic off', 'Type your doubt']);
  });
});
