import type { TutorLanguage } from './types.ts';

/**
 * HER FIXED LINES, IN BOTH OF THE CHILD'S LANGUAGES.
 *
 * Everything `decide()` says is either one of these or authored lesson content
 * (a hint, a why, the expected answer, a worked example's steps) — never text
 * a model made up at the moment of speaking. That is what makes every action
 * replayable, and what lets a line be primed into audio before it is needed.
 *
 * THE RULES THEY ARE WRITTEN TO (persona `moments.ts`):
 *   - a wrong answer is never called "wrong", and no line hints at the answer;
 *   - praise is brief and specific — a long celebration reads as surprise that
 *     they managed it — and after help it names the sticking-with-it;
 *   - silence is thinking: the nudge offers a smaller step or a hint, never
 *     the answer, and never a re-explanation;
 *   - no number words in any fixed line, so a line can never collide with a
 *     numeric answer in the leak check.
 *
 * 'hi-en' is Hinglish in ROMAN script, as a Class 6-10 student in India would
 * text it — the tutor's language is the child's onboarding choice
 * (`apps/classroom/src/lib/workspace.ts` `tutorLanguage()`), and app UI text
 * stays English. Meera is a woman, so her Hindi verbs are feminine
 * ("dikhati hoon"). How natural these read to a child is UNVERIFIED: nobody
 * outside this file has listened to them yet.
 *
 * Several variants per moment, so `decide()` can refuse to say the same line
 * twice in a row.
 */

type Fixed = Record<TutorLanguage, readonly string[]>;
type Framed = Record<TutorLanguage, readonly ((content: string) => string)[]>;

/** L1: look again, with nothing about the answer in it. */
const rethink: Fixed = {
  en: [
    'Hmm, not quite — take another look at the board. What do you notice?',
    'Not yet. Think about the question once more — what is it really asking?',
    "Let's pause on that. Look back at the board — which step does this come from?",
  ],
  'hi-en': [
    'Hmm, abhi thoda sa miss hua — board ko dhyaan se dekho, kya dikh raha hai?',
    'Abhi nahi hua. Sawaal pe ek baar phir socho — asal mein kya pooch raha hai?',
    'Ek second ruko. Board pe wapas dekho — yeh kis step se aata hai?',
  ],
};

/**
 * A fast wrong answer: think it over again, slowly. Used only with the TD14
 * rules on. The question is heard, never written (2026-10-01), so nothing
 * here asks them to READ it.
 */
const reread: Fixed = {
  en: [
    "That was quick! Think about the question again, slowly, and then tell me.",
    'Slow down a little — think it through once more. What is it asking?',
  ],
  'hi-en': [
    'Arre, bahut jaldi! Sawaal pe aaram se dobara socho, phir batao.',
    'Thoda dheere — sawaal pe phir se socho. Kya pooch raha hai?',
  ],
};

/** Silence: content-free, offers a way in. */
const nudge: Fixed = {
  en: [
    "Take your time — there's no rush. Tell me what you're thinking, or ask me for a hint.",
    "It's okay to think it through. Want to try it out loud, or shall I give you a small hint?",
    'No hurry. Even a first step is a good start — what would you try?',
  ],
  'hi-en': [
    'Koi jaldi nahi hai — aaram se socho. Jo dimaag mein hai woh batao, ya hint maang lo.',
    'Socho, koi baat nahi. Bolke try karo, ya main ek chhota sa hint doon?',
    'Aaram se. Pehla step bhi bata do toh achha start hai — kya try karna hai?',
  ],
};

/** A hint was asked for and none is authored: ask for their first step. */
const haveAGo: Fixed = {
  en: [
    "Have a go with what you've got — tell me your first step, even if you're not sure.",
    "Start anywhere — what's the first thing you would do?",
  ],
  'hi-en': [
    'Jo aata hai usse try karo — pehla step batao, chahe pakka na ho.',
    'Kahin se bhi shuru karo — sabse pehle kya karna hai?',
  ],
};

/** The judge could not tell what they said. Not help, not a verdict. */
const sayAgain: Fixed = {
  en: [
    "Sorry, I didn't quite catch that — could you say it again?",
    'I missed that. Could you tell me again?',
  ],
  'hi-en': [
    'Sorry, theek se sunai nahi diya — phir se bolo?',
    'Yeh miss ho gaya. Ek baar aur batao?',
  ],
};

/**
 * After their reply to a follow-up question (C7): heard, not judged, and back
 * to the question itself. Their reply was reasoning, not a second answer.
 */
const afterFollowUp: Fixed = {
  en: [
    "Thanks — that helps me see how you're thinking. Now have another go at the question.",
    'Okay, I see what you mean. Now try the question once more.',
  ],
  'hi-en': [
    'Achha, tumhari soch samajh gayi. Ab sawaal phir se try karo.',
    'Theek hai, samajh aaya. Ab ek baar phir sawaal try karo.',
  ],
};

/** After the reveal, still not there: no blame, and it will come back. */
const moveOn: Fixed = {
  en: [
    "That's okay — this is a tricky question. We'll come back to it, so let's keep going.",
    "No problem — we'll try a question like this again later. Let's carry on.",
  ],
  'hi-en': [
    'Koi baat nahi — yeh thoda tricky hai. Hum isse baad mein phir dekhenge, chalo aage badhte hain.',
    'Chinta mat karo — aisa sawaal baad mein phir karenge. Chalo aage.',
  ],
};

/**
 * Nothing usable came back on a question — it could not be heard, or could
 * not be judged — and the class goes on. Nothing in it says they were wrong.
 */
const carryOn: Fixed = {
  en: [
    "Let's carry on for now — we'll come back to this question later.",
    "Let's keep going, and try this one again another time.",
  ],
  'hi-en': [
    'Chalo, abhi aage badhte hain — yeh sawaal baad mein phir karenge.',
    'Chalo aage chalte hain, isse kabhi aur phir try karenge.',
  ],
};

/** Right, cold. Brief. */
const praise: Fixed = {
  en: ["Yes — that's right.", 'Exactly.', "That's it — well reasoned.", 'Right.'],
  'hi-en': ['Haan, sahi hai.', 'Ekdum sahi.', 'Sahi jawab — yahi hai.', 'Haan, yahi hai.'],
};

/** Right, after help. Names the effort, not surprise. */
const praiseAfterHelp: Fixed = {
  en: [
    'There you go — you worked it out.',
    'Yes, you got there.',
    "That's right — you kept at it, and it came.",
  ],
  'hi-en': ['Dekha? Tumne khud nikaal liya.', 'Haan, ho gaya!', 'Sahi — mehnat se ho gaya.'],
};

/**
 * Right, after the answer was shown. It is read back, not worked out, so no
 * line here claims otherwise — it confirms, and says it will come round again.
 */
const praiseAfterReveal: Fixed = {
  en: ["Yes, that's it — hold on to that.", "That's the one. Keep it in mind; we'll see it again."],
  'hi-en': ['Haan, yahi hai — isse yaad rakhna.', 'Bilkul, yahi. Yaad rakhna, yeh phir aayega.'],
};

/** L3: the authored hint, framed. */
const hint: Framed = {
  en: [(h) => `Here's a small hint: ${h}`, (h) => `A hint: ${h}`, (h) => `Think about this: ${h}`],
  'hi-en': [(h) => `Ek chhota sa hint: ${h}`, (h) => `Yeh socho: ${h}`, (h) => `Hint: ${h}`],
};

/** The hint again, when asked for again: restated, not climbed past. */
const hintAgain: Framed = {
  en: [(h) => `Here's that hint again: ${h}`, (h) => `Remember the hint: ${h}`],
  'hi-en': [(h) => `Hint phir se: ${h}`, (h) => `Hint yaad karo: ${h}`],
};

/** L7: the idea again, another way (H4). `content` is the authored re-explanation. */
const explainAgain: Framed = {
  en: [(s) => `Let me put it another way. ${s}`, (s) => `Here's another way to see it. ${s}`],
  'hi-en': [(s) => `Chalo, doosre tareeke se samjhaati hoon. ${s}`, (s) => `Isse aise bhi dekh sakte hain. ${s}`],
};

/** L5: a similar problem, worked. `content` is the steps' spoken lines. */
const workedExample: Framed = {
  en: [
    (s) => `Let's do a similar question together first. ${s}`,
    (s) => `Watch me work a similar problem. ${s}`,
  ],
  'hi-en': [
    (s) => `Chalo, pehle ek milta-julta sawaal saath mein karte hain. ${s}`,
    (s) => `Dekho, main aisa hi sawaal karke dikhati hoon. ${s}`,
  ],
};

/** L8: the answer, then the why. `content` is "answer. why". */
const reveal: Framed = {
  en: [(a) => `Let's look at it together. The answer is ${a}`, (a) => `Here's how it goes: the answer is ${a}`],
  'hi-en': [(a) => `Chalo, saath mein dekhte hain. Answer hai: ${a}`, (a) => `Dekho, answer yeh hai: ${a}`],
};

export const LINES = {
  rethink,
  reread,
  nudge,
  haveAGo,
  sayAgain,
  afterFollowUp,
  moveOn,
  carryOn,
  praise,
  praiseAfterHelp,
  praiseAfterReveal,
} as const;

export const FRAMES = { hint, hintAgain, workedExample, explainAgain, reveal } as const;
