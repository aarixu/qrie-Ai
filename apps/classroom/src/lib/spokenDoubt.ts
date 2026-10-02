import type { TtsAdapter } from '@ai-tutor/player';

/**
 * TALKING TO HER INSTEAD OF TYPING (Aarav, 2026-10-02: "tutor interrupt nahi
 * ho rahi"). With the class's mic open (lib/ear.ts `openEar`), a student can
 * talk over her: she stops, hears them, and answers. Three judgements that
 * makes about a spoken line, kept here so they are tested on their own.
 */

/** The ways a student says "that's clear, carry on", in English and Hinglish. */
const DONE = [
  /\bgot it\b/,
  /\bunderstood\b/,
  /\bthat'?s clear\b/,
  /\bclear (hai|ho gaya|now)\b/,
  /\b(let'?s )?(continue|move on|go on)\b/,
  /\bsamajh (aa )?(gaya|gayi|gaye|gya)\b/,
  /\b(theek|thik|thek) hai\b/,
  /\b(aage|age) (chalo|badho|badhte hain)\b/,
  /\bchalo aage\b/,
  /\bho gaya\b/,
  /\bno (more )?doubts?\b/,
  /\bkoi doubt nahi\b/,
];
/** A new question riding on the "got it": then it is not over. */
const STILL_ASKING = /\?|\b(but|lekin|par|aur|why|how|what|where|when|kyun|kyon|kaise|kya|kahan|kab|kaun|didn'?t|not get|nahi samjh|nahi samajh)\b/;

/** "Got it", "samajh aa gaya", "theek hai aage chalo" — the doubt is over. */
export function isDoneSaying(said: string): boolean {
  const s = said.toLowerCase().trim();
  if (s.split(/\s+/).length > 8) return false;
  if (STILL_ASKING.test(s)) return false;
  return DONE.some((re) => re.test(s));
}

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

/**
 * Her own sentence, back through the mic: most of what was heard is words of
 * the line she was saying. Echo cancellation removes nearly all of it; this
 * catches what leaks through a laptop's speakers, so the room does not answer
 * her as if she were the student.
 */
export function isEchoOf(heard: string, herLine: string): boolean {
  const said = words(heard);
  if (said.length < 3) return false;
  const hers = new Set(words(herLine));
  const shared = said.filter((w) => hers.has(w)).length;
  return shared / said.length >= 0.8;
}

/** Her voice, counted: whether a line is being said right now, which one was last, and how many so far. */
export interface WatchedVoice extends TtsAdapter {
  speaking(): boolean;
  lastLine(): string;
  /** Lines asked for so far — a short line can begin and end between two looks at `speaking()`. */
  said(): number;
}

/**
 * The class's voice, watched. Every line she says goes through it — the
 * narration, her own lines, a doubt's replies — so "is she talking?" has one
 * answer the ear can ask (a line counts from the moment it is asked for until
 * it is over, cancelled or failed).
 */
export function watchVoice(inner: TtsAdapter): WatchedVoice {
  let busy = 0;
  let last = '';
  let count = 0;
  return {
    speak: (text: string) => {
      busy += 1;
      count += 1;
      last = text;
      let p: Promise<void>;
      try {
        p = inner.speak(text);
      } catch (e) {
        busy -= 1;
        return Promise.reject(e);
      }
      return p.finally(() => {
        busy -= 1;
      });
    },
    cancel: () => inner.cancel(),
    ...(inner.prime ? { prime: inner.prime.bind(inner) } : {}),
    ...(inner.drop ? { drop: inner.drop.bind(inner) } : {}),
    speaking: () => busy > 0,
    lastLine: () => last,
    said: () => count,
  };
}
