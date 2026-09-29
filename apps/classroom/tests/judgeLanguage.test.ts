import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REGISTER } from '@ai-tutor/persona';
import { profileStore } from '../src/stores/profile';
import { setTutorLanguage } from '../src/lib/workspace';
import {
  judgeSpokenAnswer,
  resolveCrossQuestion,
  resolveSpokenAnswer,
  type PlayableAsk,
} from '../src/lib/judge';

/**
 * THE CHILD'S LANGUAGE, FROM THE WORKSPACE TO THE WIRE.
 *
 * The package tests prove `JUDGE_SYSTEM` and `CLOSE_SYSTEM` render the right
 * register line when they are handed a language. These prove the classroom
 * actually hands one over — on every path that pays for a model — and that it
 * is the language the student chose at onboarding, read when the call is made
 * rather than once when the module loaded.
 *
 * The model is replaced at `createBrowserLlm`, the one seam every judge call
 * goes through, so what is asserted is the system prompt the relay would have
 * been sent.
 */
const llm = vi.hoisted(() => ({
  calls: [] as { system: string; user: string }[],
  reply: '{"verdict":"right","say":"Aur kyun?"}',
}));

vi.mock('../src/lib/browserLlm', () => ({
  createBrowserLlm: () => ({
    complete: async (system: string, user: string) => {
      llm.calls.push({ system, user });
      return llm.reply;
    },
  }),
}));

/** An open ask with no probe, so every spoken answer escalates to the model. */
const ask: PlayableAsk = {
  question: 'Why does a resting animal still need oxygen everywhere?',
  expect: 'every cell respires on its own',
};

const HINGLISH = REGISTER['hi-en'];

beforeEach(() => {
  llm.calls.length = 0;
  llm.reply = '{"verdict":"right","say":"Aur kyun?"}';
  localStorage.clear();
  profileStore.set({ name: null, klass: null, subjects: [], diagnostic: null, diagnosedAt: null });
});

describe('a Hinglish child', () => {
  beforeEach(() => void setTutorLanguage('hi-en'));

  it('is judged by a prompt that speaks Hinglish', async () => {
    const resolved = await resolveSpokenAnswer(ask, 'har cell ko oxygen chahiye');
    expect(resolved.path).toBe('model');
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].system).toContain(HINGLISH);
  });

  it('is judged in Hinglish on the direct judge call as well', async () => {
    await judgeSpokenAnswer(ask, 'every cell');
    expect(llm.calls[0].system).toContain(HINGLISH);
  });

  it('hears the close in Hinglish', async () => {
    llm.reply = '{"say":"Haan, har cell khud respire karta hai.","held":true}';
    await resolveCrossQuestion(ask, 'every cell', 'kyun?', 'kyunki har cell zinda hai');
    expect(llm.calls[0].system).toContain(HINGLISH);
  });
});

describe('an English child', () => {
  beforeEach(() => void setTutorLanguage('en'));

  it('is judged and closed in plain English, with no Hinglish line anywhere', async () => {
    await resolveSpokenAnswer(ask, 'every cell is alive');
    llm.reply = '{"say":"Each cell respires on its own.","held":true}';
    await resolveCrossQuestion(ask, 'every cell', 'why?', 'because each one is alive');
    expect(llm.calls).toHaveLength(2);
    for (const { system } of llm.calls) {
      expect(system).toContain(REGISTER.en);
      expect(system).not.toMatch(/hinglish/i);
    }
  });

  it('gets English even when their answer was in Hindi', async () => {
    // The child chose the tutor's language once. One answer in Hindi does not
    // change it, and the prompt does not tell her to follow the answer.
    await resolveSpokenAnswer(ask, 'har cell ko oxygen chahiye');
    expect(llm.calls[0].system).toContain(REGISTER.en);
    expect(llm.calls[0].system).not.toContain(HINGLISH);
  });
});

describe('a change of language', () => {
  it('reaches the very next call, because it is read per call', async () => {
    setTutorLanguage('en');
    await judgeSpokenAnswer(ask, 'every cell');
    setTutorLanguage('hi-en');
    await judgeSpokenAnswer(ask, 'every cell');
    expect(llm.calls[0].system).toContain(REGISTER.en);
    expect(llm.calls[1].system).toContain(HINGLISH);
  });
});
