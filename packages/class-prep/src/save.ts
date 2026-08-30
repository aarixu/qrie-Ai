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

export function saveable(
  prep: { lesson: Lesson; assets: Record<string, string>; report: PrepReport },
  meta: SaveMeta,
): SavedClass | null {
  const { topicRef } = meta;
  if (!topicRef) return null;
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
