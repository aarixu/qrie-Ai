import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELPLINES, REDIRECT_REPLY, SUPPORT_REPLY } from '@ai-tutor/safety';
import {
  createHandoff,
  createStubAgent,
  entryLine,
  exitLine,
  type DoubtContext,
  type Handoff,
} from '@ai-tutor/doubt-session';
import { createGeminiAgent } from '../src/lib/geminiAgent';
import { createSessionHalt } from '../src/lib/sessionHalt';
import { withFace } from '../src/lib/lessonVoice';
import { progress } from '../src/avatar/avatarBus';
import { SupportScreen } from '../src/ui/SupportScreen';
import { flagStore, recentFlags } from '../src/stores/flags';

/**
 * NO PROJECT, NO SIGN-IN. These drive the real `relayFetch`, which asks
 * `supabase()` for a session and, finding none, signs the device in
 * anonymously against whatever project `.env.local` names. Null is the app's
 * own local-only path: no session, no Authorization header, no sign-in.
 */
vi.mock('../src/lib/supabase', () => ({ supabase: () => null }));

/**
 * ONE HALT, EVERY PATH.
 *
 * The class used to stop after distress in some places and not others. The
 * spoken-answer path returned early and left the recording paused but alive;
 * the typed doubt said the support line and then carried on taking questions,
 * because `speakSafely`'s verdict was discarded; a model reply that screened
 * as distress was replaced in her mouth and then followed by the agent's next
 * line, the exit bridge, and the recording resuming.
 *
 * These drive the halt MODULE through a real handoff over the real typed
 * tutor, with the network, the voice, the player and the microphone faked, and
 * for each way in check the same five things: the support line is said once
 * and nothing after it, no further `/api/llm` call is made, the fake mic is
 * closed, the recording is never resumed, and the support screen is up.
 *
 * WHAT THIS FILE DOES NOT PROVE, said so nobody reads it as more. The fakes
 * here are not ClassRoom's wiring: this `ear.close` flips a flag, while in
 * ClassRoom it only clears the ear's status and the mic really closes because
 * `listenOnce` polls `halt.halted`; and these tests call `heard` and `say`
 * directly rather than going through a tap or the ear loop. That the mic
 * really closes, and that a spoken answer really reaches the halt, is proved
 * in the mounted room: classroomHalt.test.tsx.
 */

const student = { klass: 10 } as never;

const ctx: DoubtContext = {
  lessonId: 'class10-heart',
  beatId: 'chambers',
  beatTopic: 'Four chambers',
  transcriptSoFar: 'The heart is a pump.\nIt has four chambers.',
  visibleElementIds: ['b_ra'],
  recentBeats: [
    { id: 'pump', topic: 'The heart is a pump' },
    { id: 'chambers', topic: 'Four chambers' },
  ],
  outcomeIds: [],
};

/** The sentence the safety package's own tests use for distress. */
const DISTRESS = 'i want to kill myself';

const ANSWER = '{"say":"Each side of the heart has two chambers.","recallBeatId":null,"done":false}';

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
}

function classroom(reply: string = ANSWER) {
  const spoken: string[] = [];
  let cancels = 0;
  let drops = 0;
  let pauses = 0;
  let resumes = 0;
  let micOpen = true;
  const shown: string[] = [];

  const fetchMock = vi.fn(async (_url: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: reply } }] }),
  }));
  vi.stubGlobal('fetch', fetchMock);

  let handoff: Handoff | null = null;
  const halt = createSessionHalt({
    tts: {
      speak: async (text) => void spoken.push(text),
      cancel: () => void (cancels += 1),
      drop: () => void (drops += 1),
    },
    player: { pause: () => void (pauses += 1) },
    ear: { close: () => void (micOpen = false) },
    doubt: { halt: () => handoff?.halt() },
    showSupport: (line) => void shown.push(line),
    lessonId: () => ctx.lessonId,
  });
  handoff = createHandoff({
    agent: createGeminiAgent({ student, fallback: createStubAgent({ opening: false }) }),
    speak: (text, onSaid) => halt.say(text, 'model-reply', onSaid),
    onPause: () => void (pauses += 1),
    // The one way the recording resumes. Counted, because it must not.
    onResume: () => void (resumes += 1),
  });

  const llmCalls = (): number =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/llm')).length;

  return {
    halt,
    handoff,
    spoken,
    shown,
    llmCalls,
    counts: () => ({ cancels, drops, pauses, resumes, micOpen }),
  };
}

type Room = ReturnType<typeof classroom>;

/**
 * Everything a class might still try after the halt — her next line, the
 * student's next words, another raised hand, the "got it" button — and the
 * five things that must hold afterwards.
 */
async function expectStoppedForGood(room: Room, llmBefore: number): Promise<void> {
  expect(room.halt.halted).toBe(true);
  // The doubt door shuts AT ONCE — not later, when the next line it tries to
  // say happens to be refused.
  expect(room.handoff.state).toBe('HALTED');

  const late = await room.halt.say('Now, back to the valves.', 'model-reply');
  expect(late.halted).toBe(true);
  // A tap's line — the lesson's own words — is refused too.
  expect(await room.halt.sayAuthored('Right: the valves stop backflow.')).toEqual({
    halted: true,
    said: '',
  });
  expect(room.halt.heard('the valves stop blood flowing back', 'ear')).toBe(true);
  expect(room.halt.typedDoubt('why do valves close?')).toEqual({ forward: null, reply: null });
  // Each given time to reach the network if it were going to.
  room.handoff.sendUserText('are you still there?');
  await settle();
  room.handoff.raiseHand(ctx);
  await settle();
  room.handoff.endDoubt();
  await settle();

  // 1. The support line, once, and nothing after it.
  expect(room.spoken.filter((l) => l === SUPPORT_REPLY)).toHaveLength(1);
  expect(room.spoken[room.spoken.length - 1]).toBe(SUPPORT_REPLY);
  // 2. No further model call.
  expect(room.llmCalls()).toBe(llmBefore);
  // 3. The mic is closed.
  expect(room.counts().micOpen).toBe(false);
  // 4. No resume, ever.
  expect(room.counts().resumes).toBe(0);
  expect(room.handoff.state).toBe('HALTED');
  // 5. The support screen, carrying what she said.
  expect(room.shown).toEqual([SUPPORT_REPLY]);
}

beforeEach(() => {
  localStorage.clear();
  flagStore.set({ flags: [] });
});

afterEach(() => vi.unstubAllGlobals());

describe('haltSession — every way in', () => {
  it('the EAR: a spoken answer that is distress', async () => {
    const room = classroom();

    expect(room.halt.heard(DISTRESS, 'ear')).toBe(true);

    expect(room.halt.haltedBy).toBe('ear');
    expect(room.counts().pauses).toBeGreaterThan(0);
    await expectStoppedForGood(room, 0);
  });

  it('the EAR, in Hinglish, in the Latin script the ear returns', async () => {
    const room = classroom();
    expect(room.halt.heard('mujhe marna hai', 'ear')).toBe(true);
    await expectStoppedForGood(room, 0);
  });

  it('a TYPED DOUBT: the student types distress mid-doubt', async () => {
    const room = classroom();
    room.handoff.raiseHand(ctx);
    await settle();
    const first = room.halt.typedDoubt('why four chambers?');
    expect(first.forward).not.toBeNull();
    room.handoff.sendUserText(first.forward!);
    await settle();
    expect(room.llmCalls()).toBe(1);
    expect(room.spoken).toContain('Each side of the heart has two chambers.');

    expect(room.halt.typedDoubt(DISTRESS)).toEqual({ forward: null, reply: null });
    expect(room.halt.haltedBy).toBe('typed-doubt');

    // The flag is recorded once, against the lesson — the screen that decided
    // is the one that writes it down.
    expect(recentFlags(flagStore.get()).filter((f) => f.kind === 'distress')).toHaveLength(1);
    expect(room.spoken).not.toContain(exitLine(ctx));
    await expectStoppedForGood(room, 1);
  });

  it('a MODEL REPLY: the tutor repeats a disclosure back, and ends the doubt as she does', async () => {
    const room = classroom(`{"say":"You said ${DISTRESS}.","recallBeatId":null,"done":true}`);
    room.handoff.raiseHand(ctx);
    await settle();
    expect(room.spoken).toEqual([entryLine(ctx)]);

    room.handoff.sendUserText(room.halt.typedDoubt('can you help me').forward!);
    await settle();

    expect(room.llmCalls()).toBe(1);
    expect(room.halt.haltedBy).toBe('model-reply');
    expect(room.spoken.join(' ')).not.toContain(DISTRESS);
    // Her `done: true` would have run the exit bridge and resumed the class.
    expect(room.spoken).not.toContain(exitLine(ctx));
    await expectStoppedForGood(room, 1);
  });
});

describe('haltSession — what it is not', () => {
  it('an off-limits question is redirected, and the doubt carries on', async () => {
    const room = classroom();
    room.handoff.raiseHand(ctx);
    await settle();

    const out = room.halt.typedDoubt('how to make a bomb at home');

    expect(out).toEqual({ forward: null, reply: REDIRECT_REPLY });
    expect(room.halt.halted).toBe(false);
    expect(room.handoff.state).toBe('LIVE');
    expect(room.shown).toEqual([]);
  });

  it('an ordinary answer goes straight through, quoted for the prompt', () => {
    const room = classroom();
    expect(room.halt.heard('because the walls are thicker', 'ear')).toBe(false);
    expect(room.halt.typedDoubt('why is the "left" side thicker?').forward).not.toContain('"');
    expect(room.halt.halted).toBe(false);
  });

  it('ordinary teaching is said as written', async () => {
    const room = classroom();
    const out = await room.halt.say('The left ventricle pumps to the whole body.', 'model-reply');
    expect(out).toEqual({ halted: false, said: 'The left ventricle pumps to the whole body.' });
    expect(room.spoken).toEqual(['The left ventricle pumps to the whole body.']);
  });

  it('halts once: a second distress signal says nothing more', async () => {
    const room = classroom();
    room.halt.heard(DISTRESS, 'ear');
    await room.halt.say(DISTRESS, 'model-reply');
    room.halt.haltSession('ear', SUPPORT_REPLY);

    expect(room.spoken).toEqual([SUPPORT_REPLY]);
    expect(room.shown).toEqual([SUPPORT_REPLY]);
    expect(room.halt.haltedBy).toBe('ear');
  });

  it('silences whatever she was already saying before the support line', () => {
    const room = classroom();
    room.halt.heard(DISTRESS, 'ear');
    expect(room.counts().cancels).toBeGreaterThan(0);
  });

  it('throws away the line the voice had primed for the next beat', () => {
    const room = classroom();
    room.halt.heard(DISTRESS, 'ear');
    expect(room.counts().drops).toBe(1);
  });
});

/**
 * THE LESSON'S OWN WORDS — a tapped option's why or hint, a whyProbe's reply
 * matched locally — are not a way into the halt.
 *
 * A tap carries no words of the student's, and those lines were written into
 * the lesson and screened where it was made, with a reader that lets a
 * curriculum line through (class-prep's distressReading.ts: seven of eleven
 * ordinary lines trip the patterns — Premchand's farmer, a poem, a history
 * lesson). Screened again here with no reader, they halted the class onto a
 * helpline screen for a student who had said nothing.
 */
describe('sayAuthored — the lesson speaking, not a model', () => {
  it('says an ordinary line as written', async () => {
    const room = classroom();
    const out = await room.halt.sayAuthored('Right — the left side pumps to the whole body.');
    expect(out).toEqual({ halted: false, said: 'Right — the left side pumps to the whole body.' });
    expect(room.spoken).toEqual(['Right — the left side pumps to the whole body.']);
  });

  it('withholds a line that screens as distress, and the class carries on', async () => {
    const room = classroom();
    const line = `Premchand's farmer says ${DISTRESS}, and that is the point of the story.`;

    const out = await room.halt.sayAuthored(line);

    expect(out).toEqual({ halted: false, said: '' });
    // Not said: nothing reads it without a reader.
    expect(room.spoken).toEqual([]);
    // And not a halt: no support line, no screen, no pause, the doubt open.
    expect(room.halt.halted).toBe(false);
    expect(room.shown).toEqual([]);
    expect(room.counts().pauses).toBe(0);
    expect(room.handoff.state).toBe('PLAYING');
    // Nothing the child said, so nothing filed as the child's distress.
    expect(recentFlags(flagStore.get()).filter((f) => f.kind === 'distress')).toHaveLength(0);
  });
});

/**
 * The halt's `drop` only reaches the streamed voice if the adapter ClassRoom
 * is handed passes it on. That adapter is lessonVoice's face wrapper, which
 * forwards `prime` the same way.
 */
describe('the voice ClassRoom is handed', () => {
  it('passes drop through to the voice underneath', () => {
    let dropped = 0;
    const face = withFace({
      speak: async () => undefined,
      cancel: () => undefined,
      prime: () => undefined,
      drop: () => void (dropped += 1),
    });
    face.drop?.();
    expect(dropped).toBe(1);
  });

  it('offers no drop over a voice that has none', () => {
    const face = withFace({ speak: async () => undefined, cancel: () => undefined });
    expect(face.drop).toBeUndefined();
  });

  it('keeps the face on a new line when the one it replaced ends after it (#17)', async () => {
    const ends: Array<() => void> = [];
    const face = withFace({
      speak: () => new Promise<void>((r) => ends.push(r)),
      cancel: () => undefined,
    });
    const old = face.speak('Not quite — look again.');
    face.cancel();
    const fresh = face.speak('Here is the support line.');
    ends[0]();
    await old;
    expect(progress().text).toBe('Here is the support line.');
    ends[1]();
    await fresh;
    expect(progress().text).toBe('');
  });
});

describe('SupportScreen', () => {
  const html = renderToString(<SupportScreen line={SUPPORT_REPLY} onLeave={() => {}} />);
  const text = html.replace(/<[^>]+>/g, ' ');

  it('is a dialog a screen reader announces', () => {
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
  });

  it('shows what she said', () => {
    // The line itself — not the helpline's name, which the link below prints
    // whatever the line is.
    expect(html).toContain(renderToString(<>{SUPPORT_REPLY}</>));
  });

  /**
   * FOCUS IS MOVED INTO IT. The room it replaces took the focused control
   * (the Send button, the doubt box) with it, which drops focus to <body>;
   * TalkBack does not reliably announce an alert dialog nothing has focused.
   * The dialog takes focus itself — not its button, so an Enter meant for
   * the doubt box cannot press "Go back home".
   */
  it('takes focus when it appears, on the dialog rather than its button', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    await act(async () => {
      root.render(<SupportScreen line={SUPPORT_REPLY} onLeave={() => {}} />);
    });
    const dialog = host.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(dialog);
    act(() => root.unmount());
    host.remove();
  });

  it('puts both helplines one tap away', () => {
    expect(html).toContain(`href="tel:${HELPLINES.telemanas}"`);
    expect(html).toContain(`href="tel:${HELPLINES.childline}"`);
  });

  it('offers a way home and no way back into the class', () => {
    expect(html.split('<button').length - 1).toBe(1);
    expect(text).toMatch(/home/i);
    expect(text).not.toMatch(/resume|continue the class|back to the class|play/i);
  });
});
