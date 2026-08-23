import { createLocalStore } from './localStore';

/**
 * What the student wrote down, and the exact moment of the class they wrote it
 * at.
 *
 * A note belongs to a BEAT, not to a lesson — that is the whole reason this is
 * worth building. A line scribbled at the beat about arteries can carry the
 * student back to that moment of the class; a paper notebook can only carry
 * them back to the sentence they managed to copy.
 */
export interface Note {
  lessonId: string;
  beatId: string;
  text: string;
  at: string; // ISO — also the note's identity, see stampAfter
}

const CAP = 500;

export const notesStore = createLocalStore<Note[]>('ai-tutor:notes', []);

/**
 * The stamp doubles as the note's identity, so it is kept strictly increasing:
 * two notes written inside the same millisecond would otherwise be the same row
 * to editNote and removeNote, and editing one would rewrite both. An `id` field
 * would be a second key for a fact `at` already carries.
 */
const stampAfter = (notes: readonly Note[]): string => {
  const now = Date.now();
  const newest = notes.length > 0 ? Date.parse(notes[notes.length - 1].at) : Number.NaN;
  return new Date(Number.isNaN(newest) ? now : Math.max(now, newest + 1)).toISOString();
};

/** Adds a note. Blank text is refused rather than stored as an empty row. */
export function addNote(lessonId: string, beatId: string, text: string): void {
  const body = text.trim();
  if (body === '') return;
  notesStore.update((notes) =>
    [...notes, { lessonId, beatId, text: body, at: stampAfter(notes) }].slice(-CAP),
  );
}

/**
 * Rewrites one note in place, keeping its moment and its position in the list.
 *
 * Blanking the text is a no-op, not a delete: losing a note to a stray keypress
 * is worse than an edit that appears not to have happened, and removeNote is
 * one tap away for a student who actually meant it.
 */
export function editNote(at: string, text: string): void {
  const body = text.trim();
  if (body === '') return;
  notesStore.update((notes) =>
    notes.map((note) => (note.at === at ? { ...note, text: body } : note)),
  );
}

export function removeNote(at: string): void {
  notesStore.update((notes) => notes.filter((note) => note.at !== at));
}

/** One lesson's notes, newest first — what the classroom shows beside the class. */
export function notesFor(lessonId: string): Note[] {
  return notesStore
    .get()
    .filter((note) => note.lessonId === lessonId)
    .sort((a, b) => b.at.localeCompare(a.at));
}
