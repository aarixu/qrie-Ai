/**
 * @ai-tutor/tutor-judge — one spoken answer, weighed.
 *
 * Pure apart from the one completion it is handed. The model, the transport and
 * the safety screen are all injected, so the pedagogy can be tested without a
 * browser, a network or a key.
 */
export type { SpokenAsk, SpokenVerdict, CrossQuestionClose, JudgeDeps } from './types.ts';
export { JUDGE_SYSTEM, CLOSE_SYSTEM, describeAsk } from './prompts.ts';
export { judgeSpokenAnswer, resolveCrossQuestion, parseVerdict, parseFollowUp } from './judge.ts';

/**
 * The reading that happens BEFORE a model is asked anything.
 *
 * Measured over 6,251 answers to the real probe bank: it settles about seven
 * in ten with no call at all, and refuses the rest rather than guessing.
 */
export { MATCH_FLOOR, matchSpokenAnswer, type LocalMatch } from './match.ts';
