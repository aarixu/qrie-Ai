import type { DoubtContext } from './context';

/**
 * The bridging lines — the two sentences that stitch the recording and the
 * live agent into what feels like one continuous class. Entry acknowledges
 * the pause and names the topic the student just raised a hand on; exit hands
 * back to the recording as if the same teacher simply carried on.
 *
 * A few variants each so the seam doesn't sound canned over a whole lesson.
 * The choice is a pure hash of beatId: the same moment always gets the same
 * line, which is what lets tests assert the seam exactly.
 */

/** Small stable string hash. Not crypto — just deterministic variant spread. */
function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

const pick = <T>(variants: readonly T[], seed: string): T =>
  variants[hashOf(seed) % variants.length];

const ENTRY: readonly ((topic: string) => string)[] = [
  (t) =>
    `Haan ruko, achha sawaal ho sakta hai yahan — '${t}' pe hi the hum. Bolo, kya doubt hai?`,
  (t) =>
    `Ek second, recording rok di maine. Abhi hum '${t}' dekh rahe the na — batao, kahan atke?`,
  (t) =>
    `Ruk jao aaram se, koi jaldi nahi hai. '${t}' thoda tricky lag sakta hai — poochho, kya samajh nahi aaya?`,
  (t) =>
    `Haan bolo bolo, isi liye toh main hoon. '${t}' chal raha tha abhi — kya poochhna hai?`,
];

const EXIT: readonly string[] = [
  `Clear hua? Chalo, wahin se aage chalte hain jahan ruke the.`,
  `Samajh aa gaya na? Badhiya. Ab class wahin se continue karte hain jahan chhodi thi.`,
  `Theek hai, ye doubt toh gaya. Chalo wapas lesson pe — jahan ruke the, wahin se.`,
  `Aur kuch ho toh phir se haath utha dena, main yahin hoon. Abhi aage badhte hain.`,
];

export function entryLine(ctx: DoubtContext): string {
  return pick(ENTRY, ctx.beatId)(ctx.beatTopic);
}

export function exitLine(ctx: DoubtContext): string {
  return pick(EXIT, ctx.beatId);
}
