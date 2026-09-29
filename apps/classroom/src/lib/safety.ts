import { REDIRECT_REPLY, quoteForPrompt, screen, type Verdict } from '@ai-tutor/safety';
import { recordFlag } from '../stores/flags';

/**
 * THE APP'S SIDE OF THE SAFETY SCREEN.
 *
 * @ai-tutor/safety is pure — it decides, and it decides nothing about this
 * app. This is where a decision becomes something that happens: the flag gets
 * recorded, and the caller gets back either words to use or words to say.
 *
 * Every place a child's words leave the device goes through `fromStudent`, and
 * everything she is about to say out loud goes through `toStudent`. Both are
 * synchronous and local, so neither adds a millisecond to a class.
 */

export interface Screened {
  /**
   * The text to carry on with, already cleaned and already safe to quote
   * inside a prompt. Null means do not carry on at all.
   */
  text: string | null;
  /**
   * What she should say instead, when the screen decided the class stops here.
   * Null in the ordinary case.
   */
  say: string | null;
}

const carry = (verdict: Verdict, lessonId?: string): Screened => {
  switch (verdict.kind) {
    case 'allow':
      return { text: quoteForPrompt(verdict.text), say: null };
    case 'clean':
      // Recorded but not narrated: a student who typed their phone number in
      // an answer does not need the class to stop and point at it.
      recordFlag({ kind: 'cleaned', at: new Date().toISOString(), ...(lessonId ? { lessonId } : {}) });
      return { text: quoteForPrompt(verdict.text), say: null };
    case 'redirect':
      recordFlag({ kind: 'redirect', at: new Date().toISOString(), ...(lessonId ? { lessonId } : {}) });
      return { text: null, say: verdict.say };
    case 'support':
      recordFlag({ kind: 'distress', at: new Date().toISOString(), ...(lessonId ? { lessonId } : {}) });
      return { text: null, say: verdict.say };
  }
};

/**
 * A child's words, on their way to a model.
 *
 * The returned text is quoted-for-prompt, so a caller can drop it straight
 * into a template without a second thought — which is the point, because the
 * places this is called from all did exactly that with the raw transcript.
 */
/**
 * Her redirect, in the child's language. The screen's line is English, and a
 * Hinglish doubt heard it in English (fifth review, 2026-09-29). Any other
 * line — the support line included — passes through unchanged.
 */
export const REDIRECT_REPLY_HI =
  'Yeh cheez main nahi padha sakti — main tumhare school subjects ke liye hoon. ' +
  'Syllabus se kuch bhi pucho, hum turant shuru karte hain.';

export function inLanguage(line: string, lang: string): string {
  return lang === 'hi-en' && line === REDIRECT_REPLY ? REDIRECT_REPLY_HI : line;
}

export function fromStudent(text: string, lessonId?: string): Screened {
  return carry(screen(text, 'from-student'), lessonId);
}

/**
 * Her words, on their way to the speaker or the board.
 *
 * The only thing that can stop her here is distress — a model repeating a
 * child's disclosure back must flag rather than sail through as her own words.
 * She is not redirected from her own redirect, and nothing of hers is cleaned:
 * masking a phone number out of a Maths example would be a bug wearing a
 * safety hat.
 */
export function toStudent(text: string, lessonId?: string): Screened {
  const verdict = screen(text, 'to-student');
  if (verdict.kind === 'support') {
    recordFlag({ kind: 'distress', at: new Date().toISOString(), ...(lessonId ? { lessonId } : {}) });
    return { text: null, say: verdict.say };
  }
  return { text, say: null };
}

/**
 * THE SCREEN AS A THING, RATHER THAN AS A HABIT.
 *
 * `toStudent` decides. Something has to CALL it on every path from a model's
 * words to a child's ears, and for a while that something was a closure named
 * `speakSafely` living inside a 1,300-line screen component. The doubt handoff
 * was built fifty lines above it with `speak: (text) => tts.speak(text)`, so
 * the one model that converses freely with a child on any subject was the one
 * whose words were never looked at — while `speakSafely`'s own docblock named
 * the doubt tutor among the things it protected.
 *
 * A screen you have to remember to use is a screen that gets missed. So it
 * wraps the speaker instead: callers are handed something that has already
 * been screened, and reaching the unscreened voice is a thing you would have
 * to go and do on purpose.
 *
 * `halted` says the class stopped here and she has just told a student to talk
 * to somebody. Every caller has a next line — resolve the question, reopen the
 * mic, carry on the doubt — and every one of them would be the app talking
 * over that.
 *
 * A REJECTED LINE COUNTS AS SPOKEN. A stuck beat is a dead class, and a doubt
 * that never resolves is a child holding their hand up at a frozen screen. The
 * voice failing is not a reason to stop.
 */
export function screenedSpeech(
  speak: (text: string) => Promise<void>,
  lessonId?: string,
): (text: string, onSaid?: (said: string) => void) => Promise<{ halted: boolean; said: string }> {
  return async (text, onSaid) => {
    const screened = toStudent(text, lessonId);
    const halted = screened.say !== null;
    /**
     * `said` IS THE LINE THAT CAME OUT, and it is returned because the caller
     * has a second surface: captions, and the text-mode transcript. Handing
     * back only `halted` left them with the model's raw text to display, so a
     * replaced line was spoken safely and shown verbatim. The speaker is the
     * only thing that knows which line won; it says so rather than leaving a
     * caller to re-derive it and get it wrong.
     */
    const said = screened.say ?? screened.text ?? text;
    // Reported BEFORE the audio, because the screen is pure and instant while
    // `speak` resolves only when the line has finished playing. A caption that
    // waited for that would arrive at the end of every sentence.
    onSaid?.(said);
    await speak(said).catch(() => undefined);
    return { halted, said };
  };
}
