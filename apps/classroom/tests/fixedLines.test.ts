import { describe, expect, it } from 'vitest';
import { BANNED_PHRASES } from '@ai-tutor/persona';
import { FRAMES, LINES } from '@ai-tutor/tutor-control';
import { closingLine, createStubAgent, entryLine, exitLine, type DoubtContext } from '@ai-tutor/doubt-session';
import { REDIRECT_REPLY, spokenSupportReply, supportReply } from '@ai-tutor/safety';
import {
  FILTERED_REPLY_LINE,
  FILTERED_REPLY_LINE_HI,
  MALFORMED_REPLY_LINE,
  MALFORMED_REPLY_LINE_HI,
  thinkingLine,
} from '../src/lib/geminiAgent';
import { REDIRECT_REPLY_HI } from '../src/lib/safety';

/**
 * THE FIXED LINES ARE HELD TO HER OWN BANS (persona v3, handoff 2026-10-11
 * section 5.4 step 4).
 *
 * The persona governs only what a MODEL says. Most of what a child hears in a
 * class is fixed: packages/tutor-control speaks authored lines (`decide()`),
 * the doubt opens and closes on bridge lines, she thinks aloud, the scripted
 * stand-in answers when the model cannot, and the app has canned replies. The
 * persona's ban test scanned only packages/persona, so "Right, nicely done."
 * and "well done for sticking with it" were spoken while the persona forbade
 * them. This scans every one of those lines, in both languages.
 */

const SAMPLE = 'look at the left ventricle';

type Lang = 'en' | 'hi-en';
const LANGS: readonly Lang[] = ['en', 'hi-en'];

const ctxFor = (lang: Lang): DoubtContext => ({
  lessonId: 'class10-heart',
  beatId: 'chambers',
  beatTopic: 'Four chambers',
  transcriptSoFar: 'The heart is a pump.',
  visibleElementIds: [],
  recentBeats: [
    { id: 'pump', topic: 'The heart is a pump' },
    { id: 'chambers', topic: 'Four chambers' },
  ],
  outcomeIds: [],
  lang,
});

/** Every bridge line: the picker hashes the beat id, so each beat id reaches a different variant. */
function bridgeLines(lang: Lang): string[] {
  const out = new Set<string>();
  for (let i = 0; i < 64; i += 1) {
    const ctx = { ...ctxFor(lang), beatId: `beat-${i}` };
    out.add(entryLine(ctx));
    out.add(exitLine(ctx));
    out.add(closingLine(ctx));
  }
  return [...out];
}

/** What the scripted stand-in says through a whole doubt. */
async function stubLines(lang: Lang): Promise<string[]> {
  const said: string[] = [];
  const session = createStubAgent({ opening: true }).start(ctxFor(lang), {
    say: async (text) => void said.push(text),
    recall: () => {},
    done: () => {},
  });
  session.sendUserText('why four?');
  session.sendUserText('ok');
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
  return said;
}

function fixedLines(lang: Lang): string[] {
  const pools = Object.values(LINES).flatMap((pool) => [...pool[lang]]);
  const framed = Object.values(FRAMES).flatMap((pool) => pool[lang].map((frame) => frame(SAMPLE)));
  const app =
    lang === 'en'
      ? [MALFORMED_REPLY_LINE, FILTERED_REPLY_LINE, REDIRECT_REPLY]
      : [MALFORMED_REPLY_LINE_HI, FILTERED_REPLY_LINE_HI, REDIRECT_REPLY_HI];
  const thinking = Array.from({ length: 40 }, (_, i) => thinkingLine(lang, `question ${i}`));
  return [...pools, ...framed, ...app, ...new Set(thinking), supportReply(lang), spokenSupportReply(lang), ...bridgeLines(lang)];
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A word that tells the learner their gender: a second-person future
 * ("karoge", "samjhaogi"), a progressive or habitual with "ho" ("soch rahe ho",
 * "karte ho"). Her own first person ("samjhaungi", "rahi hoon") is not these.
 */
const GENDERED_FOR_THEM = [/\b[a-z]{2,}o(?:ge|gi)\b/i, /\b(?:rahe|rahi)\s+ho\b/i, /\b[a-z]+(?:te|ti)\s+ho\b/i];

describe.each(LANGS)('every fixed line she says, in %s', (lang) => {
  it('uses none of the phrases she never says', async () => {
    const lines = [...fixedLines(lang), ...(await stubLines(lang))];
    expect(lines.length).toBeGreaterThan(40);
    for (const line of lines) {
      for (const phrase of BANNED_PHRASES) {
        expect({ line, phrase, found: new RegExp(`\\b${escape(phrase)}\\b`, 'i').test(line) }).toEqual({ line, phrase, found: false });
      }
    }
  });

  it('never tells the learner their gender', async () => {
    if (lang !== 'hi-en') return;
    for (const line of [...fixedLines(lang), ...(await stubLines(lang))]) {
      for (const pattern of GENDERED_FOR_THEM) expect({ line, gendered: pattern.test(line) }).toEqual({ line, gendered: false });
    }
  });

  it('holds no Devanagari, because the safety screen cannot read it', async () => {
    for (const line of [...fixedLines(lang), ...(await stubLines(lang))]) expect(line).not.toMatch(/[ऀ-ॿ]/);
  });
});
