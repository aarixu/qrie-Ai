import type { Element, Lesson } from '@ai-tutor/lesson-format';
import type { PrepReport } from './types';

/**
 * THE FIRST LIVE CLASS ON A TOPIC, KEPT.
 *
 * A cold topic costs thirty to sixty seconds and a rupee or six to prepare.
 * The second student on that topic should pay neither, and the way they do not
 * is that the first class is written down and shown to them — the recording is
 * a cache of the live class, not a different product.
 *
 * Which makes what is written matter more than usual: a class saved with a
 * hole in it is a hole shown to everyone who comes afterwards. So this decides
 * what is worth keeping, and refuses far more readily than it writes.
 *
 * Pure, and it does not touch a filesystem. The only interesting part is
 * choosing the files and rewriting the lesson to match them, and that has to
 * be testable without a disk. Whatever writes is handed the answer.
 */

export interface SavedFile {
  /** Path inside the lesson's own folder. */
  path: string;
  body: string;
  encoding: 'utf8' | 'base64';
}

/** A row for the catalogue, the same shape the authored lessons have. */
export interface SavedEntry {
  id: string;
  title: string;
  subtitle?: string;
  class: number;
  subject: string;
  path: string;
  topicRef: string;
}

export interface SavedClass {
  id: string;
  entry: SavedEntry;
  files: SavedFile[];
}

export interface SaveMeta {
  /** What the class teaches. No topicRef, nothing saved. */
  topicRef?: string;
  klass: number;
  subject: string;
  subtitle?: string;
  /**
   * Names the planner was told about, so a class that used one is not kept.
   *
   * The caller knows these because it is the caller who wrote the student
   * notes. Empty means an anonymous class, which is the shape most classes
   * have and is always safe to keep.
   */
  studentNames?: readonly string[];
}

/** Every element that cannot be drawn without artwork handed in. */
const NEEDS_ART: ReadonlySet<Element['kind']> = new Set(['image', 'diagram', 'graphic']);

/**
 * The folder one topic's class lives in.
 *
 * Derived from the topicRef rather than generated, because the same topic
 * taught twice must be the same recording, not two — and because a folder
 * named after what it teaches is one a person can find and delete.
 */
export function idFor(topicRef: string): string {
  return topicRef.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

/**
 * A picture, whatever format it arrived in.
 *
 * The image model answers with a JPEG about as often as a PNG — same prompt,
 * same model, two runs apart. Matching only PNG meant the other half fell
 * through to the branch for markup and were written into `assets.json` as
 * seven hundred kilobytes of base64, while the lesson went on pointing at a
 * `.png` file nobody had written.
 */
const DATA_URL = /^data:image\/([a-z]+);base64,(.+)$/;

/** `.jpg`, because that is what the file is called everywhere else. */
const extensionFor = (subtype: string): string => (subtype === 'jpeg' ? 'jpg' : subtype);

/**
 * A NAME IN THE SPINE IS A NAME EVERY LATER STUDENT HEARS.
 *
 * The planner is told, in so many words, to "use the name naturally — a
 * greeting, a question addressed to them". That is right for the student it
 * is planning for and wrong for the class that gets kept: this file used to
 * write the result straight to disk, so a lesson made for Aarav opened with
 * "Good morning Aarav" for everybody who came after.
 *
 * The prompt already carries a rule about this and a rule is not a mechanism.
 * This is the mechanism, and it is deliberately a REFUSAL rather than a
 * rewrite: editing somebody's teaching to take a word out produces a sentence
 * nobody wrote, and the honest answer to "this class is personal" is that it
 * is not the one to keep.
 *
 * Matched on word boundaries and case-insensitively, so "Aarav" catches
 * "aarav," and "Aarav's" and misses "Aaravian" — and a name that is also an
 * ordinary word ("Riya" is not, "Sky" might be) is the reason this only ever
 * looks at names the caller actually knows.
 */
const escapeForRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every part of a name is a name.
 *
 * "Aarav Sharma" is what the profile holds and "Aarav" is what a tutor says.
 * Testing the whole string found neither, which meant the check passed on
 * exactly the class it exists to catch. Each part is checked on its own.
 *
 * TWO letters, not three. Om, Vi and Jo are names people actually have, and a
 * floor of three meant a class greeting one of them by name was saved and
 * replayed to everybody — the precise failure this function exists to prevent.
 * One letter is still dropped, because an initial matches half a board.
 */
const partsOf = (name: string): string[] =>
  name
    .split(/[\s.]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);

export function namesInSpine(lesson: Lesson, names: readonly string[]): string[] {
  /**
   * EVERYTHING A LATER STUDENT WOULD HEAR OR READ.
   *
   * Not just the narration: a held question is asked out loud, its hint is
   * read back on a wrong answer, and an option's "why" is spoken as the
   * reason. A name in any of them is a name every later student gets. The
   * beats are stringified whole rather than picked apart field by field,
   * because the next field added to a Beat would otherwise be a hole nobody
   * notices.
   */
  const spine = [
    lesson.title,
    lesson.subtitle ?? '',
    ...lesson.beats.map((b) => JSON.stringify(b)),
    ...lesson.elements.map((el) => JSON.stringify(el)),
  ].join(' ');

  const found: string[] = [];
  for (const name of names) {
    for (const part of partsOf(name)) {
      const pattern = new RegExp(`\\b${escapeForRegex(part)}\\b`, 'i');
      if (pattern.test(spine) && !found.includes(part)) found.push(part);
    }
  }
  return found;
}

/**
 * A SPINE THAT REMEMBERS A SESSION IS NOT A SPINE.
 *
 * The name check catches "Aarav". It cannot catch "last time we did the
 * nucleus", which is just as personal and now just as likely: the planner is
 * told what the student did last class so she can open where they left off,
 * and that belongs in `fill`.
 *
 * Matched on the PHRASE rather than the topic, because the topic is ordinary
 * curriculum vocabulary — "the nucleus" belongs in a class about cells. What
 * does not belong is a narration claiming a shared past, and there are only a
 * few ways to write one.
 */
const REMEMBERS_A_SESSION: RegExp[] = [
  /**
   * "we" and "you" are not the same word here.
   *
   * "Last time WE did the nucleus" claims a session the two of them had.
   * "The last time YOU saw a rainbow, you were looking at refraction" is a
   * teacher reaching for something the student has lived, which is the best
   * opening there is and belongs in every copy of the class. So "last time"
   * needs a "we"; only "last class" and "last lesson" — which name the thing
   * itself — may be triggered by a "you".
   *
   * And the earlier version, with no clause at all, rejected "Last week the
   * moon was full": a lunar cycle lesson, and exactly the kind of teaching a
   * spine is for.
   */
  /last time[^.!?]{0,40}\bwe\b/i,
  /last (?:class|lesson)[^.!?]{0,40}\b(?:we|you|your)\b/i,
  /(?:when|what|remember what) we (?:did|looked at|covered|talked about)/i,
  /yesterday we /i,
  /**
   * "Welcome back to the world of numbers" is a flourish, not a memory.
   *
   * The greeting only claims a shared past when it greets the PERSON — back
   * to a room, a class, a lesson, or nothing at all.
   */
  /welcome back(?:\s*[,.!]|\s+to (?:class|the class|our|the lesson|the board)|\s*$)/i,
  /picking up (?:from )?where (?:we|you) (?:left|stopped)/i,
];

/** The phrases in a spine that claim a shared past, if any. */
export function remembersASession(lesson: Lesson): string[] {
  /**
   * The elements too, for the reason namesInSpine already gives: a Beat's
   * board is a list of element IDS, and every word actually written on the
   * board lives in `elements`. A note reading "Welcome back — last time we
   * did the nucleus" is not in any beat, and without this line it was kept
   * and shown to every later student.
   */
  const spine = [
    lesson.title,
    lesson.subtitle ?? '',
    ...lesson.beats.map((b) => JSON.stringify(b)),
    ...lesson.elements.map((el) => JSON.stringify(el)),
  ].join(' ');

  return REMEMBERS_A_SESSION.filter((pattern) => pattern.test(spine)).map((p) => p.source);
}

export function saveable(
  prep: { lesson: Lesson; assets: Record<string, string>; report: PrepReport },
  meta: SaveMeta,
): SavedClass | null {
  const { topicRef } = meta;
  if (!topicRef) return null;

  /**
   * A class planned FOR somebody is not a class to keep.
   *
   * The caller passes the names it put in front of the planner. If any of
   * them survived into the teaching, this class belongs to that student and
   * to nobody else — and the next one deserves their own opening rather than
   * an inherited greeting.
   */
  const personal = namesInSpine(prep.lesson, meta.studentNames ?? []);
  if (personal.length > 0) return null;
  if (remembersASession(prep.lesson).length > 0) return null;
  // A picture that never drew was already reported. Its beat may have been
  // dropped, but the class is one demonstration short of the one that was
  // planned, and that is not the one to keep forever.
  if (prep.report.visuals.some((v) => !v.ok)) return null;

  const needing = prep.lesson.elements.filter((el) => NEEDS_ART.has(el.kind));
  // The report is written before the assets are gathered, so it can be clean
  // while the board is still short a drawing.
  if (needing.some((el) => !prep.assets[el.id])) return null;

  const id = idFor(topicRef);
  const files: SavedFile[] = [];
  const inline: Record<string, string> = {};

  // A copy: the lesson on screen belongs to the class being taught right now,
  // and rewriting its paths underneath it would break the picture the student
  // is looking at.
  const doc = JSON.parse(JSON.stringify(prep.lesson)) as Lesson & { topicRef?: string };

  // The lesson answers to the name the catalogue gives it. A planner invents
  // an id for its own plan — "nucleus-class-9" — and everything that joins a
  // class to a student by id (progress, the outcome map, a doubt remembering
  // where it was asked) would then be talking about a class the catalogue has
  // never heard of. The content lint checks this on every saved class.
  doc.id = id;
  doc.topicRef = topicRef;
  // THE FILL IS NEVER KEPT. It is one student's lines — a greeting by name, a
  // callback to what they got wrong on Tuesday — and the next student gets
  // their own or none at all, never these.
  delete (doc as { fill?: unknown }).fill;

  for (const el of doc.elements) {
    const asset = prep.assets[el.id];
    if (!asset) continue;
    const drawn = DATA_URL.exec(asset);
    if (drawn) {
      const path = `generated/${el.id}.${extensionFor(drawn[1])}`;
      files.push({ path, body: drawn[2], encoding: 'base64' });
      // Absolute from the static root. The class opens at /class/<topicRef>,
      // so a path relative to the page would look for the picture beside the
      // route rather than beside the lesson.
      if ('src' in el) el.src = `/${id}/${path}`;
      continue;
    }
    // Everything else is markup, and markup is INLINED into the page rather
    // than loaded as an image — that is what lets a diagram's parts light up
    // from inside. One file for all of it, keyed by element id, because a
    // graphic has no `src` of its own to name a file after.
    inline[el.id] = asset;
  }

  files.push({ path: 'lesson.json', body: JSON.stringify(doc, null, 2), encoding: 'utf8' });
  files.push({ path: 'assets.json', body: JSON.stringify(inline, null, 2), encoding: 'utf8' });

  return {
    id,
    entry: {
      id,
      title: doc.title,
      ...(meta.subtitle ? { subtitle: meta.subtitle } : {}),
      class: meta.klass,
      subject: meta.subject,
      path: `${id}/lesson.json`,
      topicRef,
    },
    files,
  };
}
