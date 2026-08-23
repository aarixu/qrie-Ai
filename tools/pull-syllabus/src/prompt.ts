import type { NcertBook } from './parse.ts';

/**
 * The prompt is doing something narrower than the lesson designer's: it is not
 * inventing a curriculum, it is RECALLING a specific published book.
 *
 * Everything below exists to keep the model inside that book. The chapter count
 * comes from NCERT's own catalogue, so it is the one fact we can check the reply
 * against — and a model that has to hit an exact count stops padding, stops
 * merging two chapters into one, and stops drifting into a different edition.
 * The rest of the prompt gives it the vocabulary NCERT actually uses (numbered
 * sections) so that "topics" means the same thing to it as it does to us.
 */

export interface ChapterPromptOptions {
  /** The syllabus these chapters belong to, e.g. "class10-science". */
  syllabusId: string;
}

const SECTIONS = `WHAT A "TOPIC" IS — read this before anything else.

Every NCERT chapter is divided into NUMBERED SECTIONS printed in the book, and
those numbered sections ARE the topics you are being asked for. Chapter 5 of
Class 10 Science runs 5.1, 5.2, 5.2.1, 5.2.2, 5.3, 5.4, 5.4.1 and so on. You
must list EVERY numbered section of the chapter, at BOTH levels — the sections
(5.2) and their sub-sections (5.2.1) — as a single flat "topics" array, in the
order the book prints them.

Do not invent a topic scheme of your own. Do not group sections. Do not skip the
sub-sections: they are the part a lesson is actually built from.`;

const WORKED_EXAMPLE = `WORKED EXAMPLE — Class 10 Science, chapter "Life Processes".

Its printed sections are:

  5.1  What are Life Processes?
  5.2  Nutrition
  5.2.1  Autotrophic Nutrition
  5.2.2  Heterotrophic Nutrition
  5.2.3  Nutrition in Human Beings
  5.3  Respiration
  5.4  Transportation
  5.4.1  Transportation in Human Beings
  5.4.2  Transportation in Plants
  5.5  Excretion
  5.5.1  Excretion in Human Beings
  5.5.2  Excretion in Plants

So that ONE chapter yields twelve topics — five sections plus their seven
sub-sections — flat, in that order. That is the level of detail expected from
every chapter you return.

The first of them, written out in full:

{
  "id": "what-are-life-processes",
  "title": "What are Life Processes?",
  "objectives": [
    "Student can name nutrition, respiration, transportation and excretion as the four life processes",
    "Student can explain why maintenance work continues even when an organism is not moving"
  ],
  "visualIdeas": [
    "four labelled boxes around an outline of a body, one per life process",
    "a battery draining slowly with no load attached, to stand for upkeep energy"
  ],
  "estMinutes": 10
}`;

const OBJECTIVES = `OBJECTIVES MUST BE OBSERVABLE

Every objective is one sentence beginning "Student can " followed by a verb you
could WATCH a student do: state, name, list, label, identify, order, classify,
calculate, balance, trace, draw, explain, compare, predict, derive, apply.

BANNED — a reply containing any of these is rejected outright:
  "Student can understand photosynthesis"
  "Student can know the parts of the heart"
  "Student can learn about excretion"
  "Student can be aware of ..."   "Student can appreciate ..."   "Student can master ..."

Those are rejected because the Learning Outcome Map built from this syllabus
diagnoses a student by testing each objective, and none of those can be tested.
Rewrite every one of them as something checkable:
  "Student can trace the path of blood from the right ventricle to the lungs"
  "Student can balance a simple chemical equation by adjusting coefficients only"

Give 2 to 4 objectives per topic.`;

const VISUALS = `VISUAL IDEAS

"visualIdeas" are concrete things that could be DRAWN on a canvas while the
tutor speaks — a labelled diagram, a sequence of arrows, a comparison table, a
worked line of algebra appearing term by term. 2 to 3 per topic.

GOOD: "a cross-section of a leaf with stomata labelled, guard cells swelling open"
GOOD: "the equation appearing term by term, coefficients highlighted as they change"
BAD:  "an image of photosynthesis"  (not a drawing, just a restatement)
BAD:  "students working in groups"  (nothing to render)`;

const SHAPE = `REPLY SHAPE — exactly this, nothing else:

{
  "chapters": [
    {
      "id": "life-processes",
      "title": "Life Processes",
      "topics": [
        {
          "id": "nutrition-autotrophic",
          "title": "Autotrophic Nutrition",
          "objectives": ["Student can ...", "Student can ..."],
          "visualIdeas": ["...", "..."],
          "estMinutes": 12
        }
      ]
    }
  ]
}

Ids are lowercase and hyphenated, derived from the title, unique within their
parent. No section numbers inside ids or titles — the array order carries the
numbering.`;

const FORBIDDEN = `HARD RULES — each of these is checked and a breach is sent back to you.

- Return EXACTLY the number of chapters stated. Not one more, not one fewer.
- Use each chapter's REAL printed NCERT title. If you are unsure of the exact
  wording, give the closest title you are confident the book actually prints —
  never a description you have written yourself.
- Keep NCERT's own chapter ORDER.
- NEVER invent a chapter that is not in this book.
- NEVER merge two NCERT chapters into one entry, and never split one across two.
- Every chapter needs at least 2 topics. A chapter returned with a single topic
  has not been decomposed and is rejected.`;

export function buildChapterPrompt(
  book: NcertBook,
  opts: ChapterPromptOptions,
): { system: string; user: string } {
  const system = [
    'You are an NCERT curriculum archivist. You are given one real, published NCERT textbook and you reproduce its table of contents and section structure as data. You are recalling a specific book, not designing a course.',
    SECTIONS,
    WORKED_EXAMPLE,
    OBJECTIVES,
    VISUALS,
    SHAPE,
    FORBIDDEN,
    `AUDIENCE: Class ${book.klass} ${book.subject}. Titles and objectives use the vocabulary this NCERT book uses — correct technical terms, no university-level framing.`,
    'Reply with ONLY the JSON object. No markdown fences, no commentary.',
  ].join('\n\n');

  const user = [
    `BOOK: "${book.title}" — NCERT Class ${book.klass} ${book.subject} (book code ${book.code}).`,
    '',
    `THIS BOOK HAS EXACTLY ${book.chapters} CHAPTERS.`,
    `That number is from NCERT's own catalogue, so it is not a target or an estimate — your "chapters" array must have ${book.chapters} entries, in the book's printed order.`,
    '',
    'For each chapter give its real NCERT title and then every numbered section and sub-section it contains, as topics.',
    '',
    `These become syllabus paths of the form "${opts.syllabusId}/<chapterId>/<topicId>", so keep both ids short, lowercase and hyphenated.`,
  ].join('\n');

  return { system, user };
}
