import { TUTOR } from './traits';
import { describeFactors, type StudentContext } from './factors';
import { momentGuidance, type Moment } from './moments';

/**
 * THE ASSEMBLER.
 *
 * The whole point of this package is that behaviour is COMPOSED rather than
 * copy-pasted per call site: traits + factors + moment + surface. Before this
 * existed the tutor's character lived in three hand-written prompt strings that
 * had already drifted apart, so the tutor a student met in a typed doubt was
 * not quite the tutor they met in a spoken one.
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

export interface PromptInput {
  moment: Moment;
  student: StudentContext;
  lesson?: LessonContext;
  surface: Surface;
}

const bullets = (lines: readonly string[]): string => lines.map((l) => `- ${l}`).join('\n');

const SPEAKING: Record<Surface, string> = {
  voice: [
    'HOW TO SPEAK — VOICE',
    'Your words are spoken out loud and heard, never read.',
    bullets([
      'Short spoken sentences, the way a person actually talks.',
      '20 to 60 words per turn. Say one thing, then stop and let them answer.',
      'No markdown, no bullet points, no numbered lists, no headings, no emoji.',
      'No stage directions, and never describe your own tone.',
      'Speak notation out in words: "H two O", "two thirds", "x squared".',
    ]),
  ].join('\n'),

  text: [
    'HOW TO SPEAK — TEXT',
    'Your words are read on a phone screen.',
    bullets([
      'Short paragraphs of two or three sentences, with a blank line between them.',
      'One idea per paragraph, and finish with the question that moves them forward.',
      'Put a formula on its own line so it stays readable on a narrow screen.',
    ]),
  ].join('\n'),

  narration: [
    'HOW TO SPEAK — NARRATION',
    "This is the authored voice of the recorded class, read aloud by the app's text-to-speech.",
    bullets([
      '30 to 60 words for this beat: one idea, then the handover into the next beat.',
      'Conversational and spoken. No markdown, no stage directions, no emoji.',
      'Address the student directly as "you".',
      'You cannot hear them here, so ask any check question rhetorically and answer it a beat later.',
    ]),
  ].join('\n'),
};

/** The lesson block, or null when the caller supplied nothing usable. */
function lessonSection(lesson: LessonContext | undefined): string | null {
  if (lesson === undefined) return null;

  const facts: string[] = [];
  if (lesson.subject !== undefined) facts.push(`Subject: ${lesson.subject}`);
  if (lesson.title !== undefined) facts.push(`Lesson: ${lesson.title}`);
  if (lesson.beatTopic !== undefined) {
    facts.push(`Right now the class is on "${lesson.beatTopic}".`);
  }
  if (lesson.outcome !== undefined && lesson.outcome.length > 0) {
    facts.push(
      `What this beat is FOR: by the end of it the student should be able to — ${lesson.outcome}. That is the thing to make true; the topic label is only its name.`,
    );
  }
  if (lesson.onScreen !== undefined && lesson.onScreen.length > 0) {
    facts.push(
      `On the canvas at this moment: ${lesson.onScreen.join(', ')}. Refer only to these as visible.`,
    );
  }

  const blocks: string[] = [];
  if (facts.length > 0) blocks.push(['THIS LESSON', ...facts].join('\n'));

  if (lesson.transcriptSoFar !== undefined && lesson.transcriptSoFar.length > 0) {
    blocks.push(['WHAT THE CLASS HAS COVERED SO FAR', lesson.transcriptSoFar].join('\n'));
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

  return blocks.length > 0 ? blocks.join('\n\n') : null;
}

/**
 * Build the system prompt for one moment, one student, one surface.
 *
 * Section order is fixed and runs from the most permanent thing to the most
 * situational: who she is, what she will not do, WHO SHE IS TALKING TO, who is
 * in front of her, what this moment needs, what the class is showing, and
 * finally how the words physically come out. A model reading top to bottom
 * meets her character before it meets today's details, which is what stops the
 * details from overwriting her.
 *
 * The safety block sits above the student's own notes deliberately. Everything
 * below it is about this lesson and this minute; nothing about this minute
 * should be able to argue with the fact that the person listening is a child.
 */
export function buildSystemPrompt({ moment, student, lesson, surface }: PromptInput): string {
  const sections: string[] = [
    ['WHO YOU ARE', `You are ${TUTOR.name}, ${TUTOR.role}.`, `You are ${TUTOR.voice}.`].join('\n'),
    ['YOU ALWAYS', bullets(TUTOR.values)].join('\n'),
    ['YOU NEVER', bullets(TUTOR.neverDoes)].join('\n'),
    // Above the student's own details on purpose: nothing about today should
    // be able to argue with this.
    ['WHO YOU ARE TALKING TO — this outranks everything below it', bullets(TUTOR.safety)].join('\n'),
    [
      'THIS STUDENT — private notes. Never read them out, never mention scores, never say you are adapting.',
      bullets(describeFactors(student)),
    ].join('\n'),
    [`THIS MOMENT — ${moment}`, momentGuidance(moment)].join('\n'),
  ];

  const lessonBlock = lessonSection(lesson);
  if (lessonBlock !== null) sections.push(lessonBlock);

  sections.push(SPEAKING[surface]);

  return sections.join('\n\n');
}
