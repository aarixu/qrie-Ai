import { describeFactors, type StudentContext } from './factors';
import { REGISTER, isTutorLanguage, type TutorLanguage } from './language';
import { CORE, MOVES, SPEAKING, likesBlock, safetyBlock, type Move } from './meera';
import { momentGuidance, type Moment } from './moments';

/**
 * THE ASSEMBLER.
 *
 * The whole point of this package is that behaviour is COMPOSED rather than
 * copy-pasted per call site. Before this existed the tutor's character lived in
 * three hand-written prompt strings that had already drifted apart, so the
 * tutor a student met in a typed doubt was not quite the tutor they met in a
 * spoken one.
 *
 * Since v3 (2026-10-11) the blocks are meera.ts's: the core every call opens
 * on, her likes where she chats, the safety backstop, one language module, the
 * speaking rules, the app's learner lines, the lesson, the conductor's
 * prepared item, and ONE turn card, last.
 *
 * Pure and deterministic: no clock, no randomness, no I/O. The same input
 * always produces byte-identical output, which is what makes a prompt
 * diffable, cacheable and testable.
 */

/**
 * Where her words come out. The list drives the type, so a new surface cannot
 * be added without a block of speaking rules to go with it.
 */
export const SURFACES = ['voice', 'text', 'narration'] as const;

export type Surface = (typeof SURFACES)[number];

/** What the class is doing right now. Every field is optional. */
export interface LessonContext {
  /** e.g. "Science". */
  subject?: string;
  /** The lesson's own title. */
  title?: string;
  /** The topic label of the beat the class is on. */
  beatTopic?: string;
  /**
   * The outcome this beat is FOR, from the Learning Outcome Map — what the
   * student should be able to do afterwards, in the map's own words.
   *
   * A topic label says what the beat is about; this says what it is for, and
   * they are not the same thing. "Dilution" is a subject. "Calculate the
   * dilution factor after successive dilutions" is a thing a person can either
   * do or not do, which is what she is actually trying to make true.
   */
  outcome?: string;
  /**
   * What that outcome rests on, and how sure we are the student holds each —
   * the prerequisite chain, in plain words.
   *
   * This is the difference between re-explaining and diagnosing. A student
   * stuck on the dilution factor usually has not lost the dilution factor;
   * they have lost the step underneath it, and until someone says so out loud
   * the same explanation gets repeated slower.
   */
  restsOn?: readonly { statement: string; secure?: boolean }[];
  /** Narration of every beat up to and including the current one. */
  transcriptSoFar?: string;
  /** Element ids on the canvas right now — what she may refer to as visible. */
  onScreen?: readonly string[];
  /** Earlier moments she may pull back onto the board. The ONLY legal targets. */
  recallableBeats?: readonly { id: string; topic: string }[];
}

/**
 * THE VERIFIED PREPARED ITEM the conductor hands over (code, not model). She
 * uses exactly this and invents no number, formula, example or fact beyond it.
 * No conductor is wired yet; the shape is ready for it.
 */
export interface PreparedItem {
  question?: string;
  expected?: string;
  wrongIdeas?: readonly string[];
  alternate?: string;
  workedExample?: string;
  freshItem?: string;
  prerequisite?: string;
  reveal?: string;
  owed?: string;
}

export interface PromptInput {
  student: StudentContext;
  lesson?: LessonContext;
  surface: Surface;
  /**
   * The app-flow moment this turn is, rendered as its card ("THIS MOMENT").
   * Today the doubt flow's three moments are the turns that reach a model.
   */
  moment?: Moment;
  /** The conductor's move for this turn (v3), rendered as its card ("THIS TURN"). Wins over `moment`. */
  move?: Move;
  /** The help-ladder rung the move must give (1 to 8). */
  rung?: number;
  /** The rung of help they have already had on this item, if any. */
  helped?: number;
  /** The conductor's one-line reason for this move. */
  because?: string;
  payload?: PreparedItem;
}

const bullets = (lines: readonly string[]): string => lines.map((l) => `- ${l}`).join('\n');

/**
 * NARRATION keeps its own speaking rules: the authored voice of a recorded
 * class, where she cannot hear them. v3's two blocks (meera.ts SPEAKING) are
 * for the surfaces where she chats.
 */
const NARRATION = [
  'HOW TO SPEAK — NARRATION',
  "This is the authored voice of the recorded class, read aloud by the app's text-to-speech.",
  bullets([
    '30 to 60 words for this beat: one idea, then the handover into the next beat.',
    'Conversational and spoken. No markdown, no stage directions, no emoji.',
    'Address the student directly as "you".',
    'You cannot hear them here, so ask any check question rhetorically and answer it a beat later.',
  ]),
].join('\n');

/** The lesson blocks, or none when the caller supplied nothing usable. */
function lessonSections(lesson: LessonContext | undefined): string[] {
  if (lesson === undefined) return [];

  const facts: string[] = [];
  if (lesson.subject !== undefined) facts.push(`Subject: ${lesson.subject}`);
  if (lesson.title !== undefined) facts.push(`Lesson: ${lesson.title}`);
  if (lesson.beatTopic !== undefined) facts.push(`Right now the class is on "${lesson.beatTopic}".`);
  if (lesson.outcome !== undefined && lesson.outcome.length > 0) {
    facts.push(`By the end they should be able to: ${lesson.outcome}.`);
  }
  if (lesson.onScreen !== undefined && lesson.onScreen.length > 0) {
    facts.push(`On the board now: ${lesson.onScreen.join(', ')}. Refer only to these as visible.`);
  }

  const blocks: string[] = [];
  if (facts.length > 0) blocks.push(['THIS LESSON', ...facts].join('\n'));

  if (lesson.transcriptSoFar !== undefined && lesson.transcriptSoFar.length > 0) {
    blocks.push(['COVERED SO FAR', lesson.transcriptSoFar].join('\n'));
  }

  // The foundations, marked with what we believe about each. She is told the
  // shaky ones plainly because that is where an explanation usually has to
  // start — never as a score, only as a place to begin.
  if (lesson.restsOn !== undefined && lesson.restsOn.length > 0) {
    blocks.push(
      [
        'WHAT THIS RESTS ON — if they are stuck, start from the first one that looks shaky rather than repeating the step itself:',
        lesson.restsOn
          .map(
            (r) =>
              `- ${r.statement}${r.secure === false ? '  (they may not have this yet)' : r.secure === true ? '  (they have this)' : ''}`,
          )
          .join('\n'),
      ].join('\n'),
    );
  }

  // Enumerated by id because a model can only be trusted to choose from a list
  // it was shown — and the id it returns is still checked against the same set
  // by the caller before the canvas moves.
  if (lesson.recallableBeats !== undefined && lesson.recallableBeats.length > 0) {
    blocks.push(
      [
        'MOMENTS YOU CAN BRING BACK ONTO THE BOARD — only these ids are valid, never invent one:',
        lesson.recallableBeats.map((b) => `- id "${b.id}": ${b.topic}`).join('\n'),
      ].join('\n'),
    );
  }

  return blocks;
}

function preparedSection(p: PreparedItem | undefined): string | null {
  if (p === undefined) return null;
  const lines = [
    p.question && `Question: ${p.question}`,
    p.expected && `A good answer is: ${p.expected}`,
    p.wrongIdeas && p.wrongIdeas.length > 0 && `Known wrong ideas: ${p.wrongIdeas.join('; ')}`,
    p.alternate && `Another way to explain it: ${p.alternate}`,
    p.workedExample && `Worked example: ${p.workedExample}`,
    p.freshItem && `Fresh question for them to try alone: ${p.freshItem}`,
    p.prerequisite && `The earlier idea to go back to: ${p.prerequisite}`,
    p.reveal && `What actually happens: ${p.reveal}`,
    p.owed && `Owed from last class: ${p.owed}`,
  ].filter((l): l is string => typeof l === 'string' && l.length > 0);
  if (lines.length === 0) return null;
  return ['PREPARED. Use exactly this; invent no number, formula, example or fact beyond it.', ...lines].join('\n');
}

function turnSection(input: PromptInput): string | null {
  if (input.move !== undefined) {
    const turn = [
      'THIS TURN. The conductor chose this move from marks and pace and cannot hear feelings: if their last words are about how they feel, about you, or about safety, answer that first; the card then shapes what comes next. Where the move needs content and none is given, use only what is on the board or was said in class.',
      `MOVE: ${input.move}`,
      MOVES[input.move],
    ];
    if (input.rung !== undefined) turn.push(`RUNG: ${input.rung}`);
    if (input.helped !== undefined) {
      turn.push(
        `HELPED: they have had help (rung ${input.helped}). Confirm only the step they did, never say they have learnt it, and next they try a fresh one alone.`,
      );
    }
    if (input.because !== undefined && input.because.length > 0) turn.push(`WHY THIS MOVE: ${input.because}`);
    return turn.join('\n');
  }
  if (input.moment !== undefined) return [`THIS MOMENT — ${input.moment}`, momentGuidance(input.moment)].join('\n');
  return null;
}

/**
 * Build the system prompt for one turn, one learner, one surface.
 *
 * Section order runs from the most permanent thing to the most situational:
 * who she is, her likes (where she chats), the safety backstop, the language
 * the learner chose, how the words come out, the app's private notes about the
 * learner, what the class is showing, the prepared item, and finally this
 * turn's card. A model reading top to bottom meets her character before it
 * meets today's details, which is what stops the details from overwriting her.
 *
 * The safety block sits above the learner's own notes deliberately: nothing
 * about this minute should be able to argue with the fact that the person
 * listening may be a child. Its helplines are words when heard and digits when
 * read.
 *
 * THE LANGUAGE is the learner's choice, checked at runtime as well as by type:
 * a profile row can come back from the cloud written by an older build, and a
 * value that is not one of the two languages must not become an instruction to
 * speak it. Anything else is English, the base (v3).
 */
export function buildSystemPrompt(input: PromptInput): string {
  const { student, lesson, surface } = input;
  const language: TutorLanguage = isTutorLanguage(student.language) ? student.language : 'en';
  const chats = surface === 'voice' || surface === 'text';

  const sections: string[] = [CORE];
  if (chats) sections.push(likesBlock());
  sections.push(safetyBlock(language, 'IN', surface === 'text' ? 'text' : 'voice'));
  sections.push(`LANGUAGE\n${REGISTER[language]}`);
  sections.push(surface === 'narration' ? NARRATION : SPEAKING[surface]);
  sections.push(['THE LEARNER (private notes: never read them out)', bullets(describeFactors(student))].join('\n'));
  sections.push(...lessonSections(lesson));

  const prepared = preparedSection(input.payload);
  if (prepared !== null) sections.push(prepared);

  const turn = turnSection(input);
  if (turn !== null) sections.push(turn);

  return sections.join('\n\n');
}
