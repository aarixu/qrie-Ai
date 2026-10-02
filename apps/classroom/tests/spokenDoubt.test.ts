import { describe, expect, it } from 'vitest';
import { isDoneSaying, isEchoOf, watchVoice } from '../src/lib/spokenDoubt';

/**
 * TALKING TO HER INSTEAD OF TYPING (Aarav, 2026-10-02: "tutor interrupt nahi
 * ho rahi"). Three small judgements the room makes about a spoken line.
 */
describe('is the student done with the doubt?', () => {
  it('hears the short ways a student says it, in English and Hinglish', () => {
    for (const said of ['Got it', 'ok got it, thanks', 'samajh aa gaya', 'haan samajh gaya', 'Theek hai, aage chalo', 'understood', "let's continue"]) {
      expect(isDoneSaying(said), said).toBe(true);
    }
  });

  it('does not end a doubt that carries a new question', () => {
    for (const said of ['samajh aa gaya but why does it hurt?', 'got it, lekin lactic acid kahan jata hai', 'theek hai, aur yeast mein kya hota hai', 'I did not get it']) {
      expect(isDoneSaying(said), said).toBe(false);
    }
  });
});

describe('is it her own voice, back through the mic?', () => {
  const herLine = 'Instead of turning into carbon dioxide, pyruvate turns into lactic acid.';

  it('knows most of her own sentence when it hears it', () => {
    expect(isEchoOf('pyruvate turns into lactic acid', herLine)).toBe(true);
  });

  it('takes the student’s own words as theirs, even about the same thing', () => {
    expect(isEchoOf('wait, why does lactic acid hurt?', herLine)).toBe(false);
    expect(isEchoOf('ruko ek doubt hai', herLine)).toBe(false);
  });
});

describe('is she speaking right now?', () => {
  it('counts a line from the moment it is asked for until it is over, and remembers it', async () => {
    let finish: () => void = () => undefined;
    const voice = watchVoice({
      speak: () => new Promise<void>((r) => (finish = r)),
      cancel: () => finish(),
    });
    expect(voice.speaking()).toBe(false);
    expect(voice.said()).toBe(0);
    const line = voice.speak('Glucose breaks down in the cytoplasm.');
    expect(voice.speaking()).toBe(true);
    expect(voice.said()).toBe(1);
    expect(voice.lastLine()).toBe('Glucose breaks down in the cytoplasm.');
    voice.cancel();
    await line;
    expect(voice.speaking()).toBe(false);
  });

  it('is not left speaking by a line that failed', async () => {
    const voice = watchVoice({ speak: () => Promise.reject(new Error('no voice')), cancel: () => undefined });
    await voice.speak('Hello').catch(() => undefined);
    expect(voice.speaking()).toBe(false);
  });
});
