import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import type { TtsAdapter } from '@ai-tutor/player';

/**
 * A STUDENT TALKING OVER HER, IN THE REAL ROOM (Aarav, 2026-10-02: "STT kaam
 * nahi kar raha, tutor interrupt nahi ho rahi").
 *
 * The class's mic is open (lib/ear.ts `openEar`, faked here as granted and
 * open), and the open ear says when the student starts talking. Everything
 * past the microphone is real: the player, the handoff, the typed tutor, the
 * judge's local read. What the ear "hears" is queued by each test.
 */
const ear = vi.hoisted(() => ({
  queued: [] as (string | null)[],
  listens: 0,
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
  openEar: async () => true,
  closeEar: () => undefined,
  onStudentSpeech: (listen: () => void) => {
    ear.speech = listen;
    return () => {
      if (ear.speech === listen) ear.speech = null;
    };
  },
  listenOnce: async (opts: { isCancelled?: () => boolean } = {}) => {
    ear.listens += 1;
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

async function tick(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
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

/** The student starts talking. */
async function talk(): Promise<void> {
  expect(ear.speech, 'the room listens for the student talking').not.toBeNull();
  await act(async () => {
    ear.speech!();
  });
  await tick(12);
}

const inDoubt = (host: HTMLElement): boolean => host.querySelector('[aria-label="Got it — back to the class"]') !== null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView ??= () => undefined;
  localStorage.clear();
  sessionStorage.clear();
  progressStore.set({ lessons: {}, lastLessonId: null });
  settingsStore.update((s) => ({ ...s, klass: 10 }));
  vi.stubEnv('VITE_GEMINI_API_KEY', '');
  ear.queued = [];
  ear.listens = 0;
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

describe('talking over her while she teaches', () => {
  it('stops her, and their words open a doubt — no entry line said over them — that she answers', async () => {
    const host = await openClass(teaching);
    const before = spoken.length;
    ear.queued = ['wait, why is blood red?'];
    await talk();
    await tick(12);

    expect(inDoubt(host)).toBe(true);
    // Their words went to the tutor as the doubt's first message...
    expect(llmBodies.some((b) => b.includes('why is blood red?'))).toBe(true);
    // ...and the only thing she said since is her answer to it.
    expect(spoken.slice(before)).toEqual(['Blood carries oxygen in red blood cells.']);
  });

  it('carries on teaching when nothing was heard, or only her own voice', async () => {
    const host = await openClass(teaching);
    const first = teaching.beats[0].narration;
    ear.queued = [first.split(' ').slice(0, 8).join(' ')]; // her sentence, back through the speaker
    await talk();
    expect(inDoubt(host)).toBe(false);
    expect(llmBodies).toHaveLength(0);
    // The beat is said again from its start: the class carries on.
    expect(spoken.filter((s) => s === first).length).toBe(2);
  });

  it('ends the spoken doubt when they say they have got it', async () => {
    const host = await openClass(teaching);
    ear.queued = ['wait, why is blood red?', 'haan samajh aa gaya'];
    await talk();
    await tick(20);
    expect(inDoubt(host)).toBe(false);
    expect(llmBodies).toHaveLength(1);
  });
});

describe('talking over her question', () => {
  it('stops her line and takes what they are already saying as the answer', async () => {
    await openClass(asking);
    ear.queued = ['Four'];
    await talk();
    await tick(12);
    const answered = ledgerOutbox.get().pending.filter((e) => e.kind === 'answered');
    expect(answered.map((e) => (e.payload as { verdict?: string }).verdict)).toEqual(['right']);
  });

  it('does not judge her own question, back through the speaker, as their answer', async () => {
    await openClass(asking);
    // The ear first hears her question leaking through; then the student.
    ear.queued = [asking.beats[0].narration, 'Four'];
    await talk();
    await tick(16);
    const answered = ledgerOutbox.get().pending.filter((e) => e.kind === 'answered');
    expect(answered.map((e) => (e.payload as { verdict?: string }).verdict)).toEqual(['right']);
  });
});

describe('the review’s cases (2026-10-02)', () => {
  it('talking over her reply in a doubt: she stops, and what they say goes to her next', async () => {
    const reply = 'Blood carries oxygen in red blood cells.';
    const host = await openClass(teaching, voice((t) => t === reply));
    ear.queued = ['wait, why is blood red?'];
    await talk(); // opens the doubt; her reply is now being said (held)
    expect(inDoubt(host)).toBe(true);
    expect(spoken).toContain(reply);
    ear.queued = ['but why not blue?'];
    await talk(); // over her reply
    await tick(16);
    expect(llmBodies.some((b) => b.includes('but why not blue?'))).toBe(true);
  });

  it('a hand raised while she is hearing an interruption opens one doubt, and the class is not restarted under it', async () => {
    const host = await openClass(teaching);
    await talk(); // nothing queued: the interruption's listen is still open
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

  it('a beat whose own line set the ear off is not interrupted again', async () => {
    await openClass(teaching);
    ear.queued = [teaching.beats[0].narration.split(' ').slice(0, 8).join(' ')]; // her echo
    await talk();
    const listens = ear.listens;
    await talk(); // the same leak, the same beat
    expect(ear.listens).toBe(listens);
  });
});

describe('the board has the room (Aarav, 2026-10-03)', () => {
  it('shows no tile and no doubt panel, and her shape says what she is doing', async () => {
    const host = await openClass(teaching);
    const shape = (): string | null => host.querySelector('[data-bloub]')?.getAttribute('data-bloub') ?? null;
    // Nothing stands beside the board: no rail, no picture-in-picture, no panel.
    expect(host.querySelector('aside')).toBeNull();
    expect(host.querySelector('textarea')).toBeNull();
    expect(shape()).toBe('teaching');

    ear.queued = ['wait, why is blood red?'];
    await talk();
    await tick(12);
    expect(inDoubt(host)).toBe(true);
    // Her answer is said; the doubt waits on the student again.
    expect(shape()).toBe('listening');
    expect(host.querySelector('aside')).toBeNull();
    // The typed doubt is still a tap away.
    expect(host.querySelector('[aria-label="Type your doubt"]')).not.toBeNull();
  });
});
