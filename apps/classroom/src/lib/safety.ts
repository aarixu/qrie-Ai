import { quoteForPrompt, screen, type Verdict } from '@ai-tutor/safety';
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
