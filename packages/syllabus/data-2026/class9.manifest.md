# Class 9 syllabus (staged) — manifest

Built 2026-10-01 from NCERT's own PDFs. Book list taken from the live catalogue
https://ncert.nic.in/textbook.php (class 9 block), cross-checked by web search for new
2026-27 editions. Every chapter title comes from the book's Contents page (the prelims
PDF `<code>ps.pdf`); every topic comes from that chapter PDF's section headings
(read with pdftotext and with font sizes via pdfjs-dist). Every chapter PDF downloaded.

**All four Class 9 subjects have brand-new NCERT books for 2026-27.** None of them is a
reprint, and none matches the old `packages/syllabus/data` files.

## Science — `class9-science.json`

| Book | Code | Edition | Contents |
|---|---|---|---|
| Exploration: Textbook of Science for Grade 9 | iesc1 | First Edition, April 2026 (Chaitra 1948) | https://ncert.nic.in/textbook/pdf/iesc1ps.pdf |

- Chapters: 13. This matches the Contents page and the catalogue entry `iesc1=0-13`. Topics: 123.
- Replaces `packages/syllabus/data/class9-science.json`. **Same book? NO.** The old file follows the retired NCERT *Science* book.
  - Old first three: Matter in Our Surroundings / Is Matter Around Us Pure / Atoms and Molecules
  - New first three: Exploration: Entering the World of Secondary Science / Cell: The Building Block of Life / Tissues in Action
- Chapter 1 has no numbered sections. Its 4 topics are the chapter's own units (models; language, symbols and units; laws, theories and predictions; estimation and connected branches).
- Some large sections were split at the book's own sub-headings:
  - organelles: 2.3.1 → two topics, at its unnumbered organelle sub-headings (Nucleus … Lysosomes; Mitochondria, Plastids, Vacuoles)
  - permanent tissues: 3.2.4 → simple and complex
  - Kingdom Animalia: 12.6.5 → invertebrates and chordates, at its unnumbered sub-headings
- Some numbered sub-sections are topics of their own rather than merged into their parent section. Examples: cell division 2.4.1; suspensions 5.4.3 and colloids 5.4.4; Kingdom Plantae 12.6.4.
- Some short sub-sections were merged. Two examples: 6.1 with 6.1.1, and 11.5.1–11.5.10 into 4 topics.

## Mathematics — `class9-mathematics.json`

| Book | Code | Edition | Contents |
|---|---|---|---|
| Ganita Manjari: Textbook of Mathematics for Grade 9 (Part I) | iemh1 | First Edition, April 2026 (Chaitra 1948) | https://ncert.nic.in/textbook/pdf/iemh1ps.pdf |
| Ganita Manjari: Textbook of Mathematics for Grade 9 (Part II) | iemh2 | First Edition, August 2026 (Shravana 1948) | https://ncert.nic.in/textbook/pdf/iemh2ps.pdf |

- Chapters: 14 (Part I has chapters 1–8, Part II has chapters 9–14). This matches both Contents pages and the catalogue entries `iemh1=0-8` and `iemh2=0-6`. Topics: 90.
- Each chapter's `book` field says which part it is from. The Part II chapter PDFs are iemh201–iemh206 (chapters 9–14).
- Replaces `packages/syllabus/data/class9-mathematics.json`. **Same book? NO.** The old file follows the retired NCERT *Mathematics* book, and it had only 8 of that book's chapters.
  - Old first three: Number Systems / Polynomials / Coordinate Geometry
  - New first three: Orienting Yourself: The Use of Coordinates / Introduction to Linear Polynomials / The World of Numbers
- Chapter 9 (Propositions and their Converses) has no numbered sections. Its 3 topics follow the chapter's own flow: converses, counterexamples, and cases where both directions are true.
- Topic ids that would otherwise lose symbols were set by hand:
  - `more-identities-square-of-a-plus-b-plus-c`
  - `irrational-numbers-and-the-proof-that-root-2-is-irrational`
  - `construction-of-lengths-like-root-2-and-root-3`
  - `pi-is-irrational`

## Social Science — `class9-social-science.json`

| Book | Code | Edition | Contents |
|---|---|---|---|
| Understanding Society: India and Beyond — Social Science Textbook for Grade 9, Part 1 | iest1 | First Edition, June 2026 (Jyeshtha 1948) | https://ncert.nic.in/textbook/pdf/iest1ps.pdf |

- Chapters: 9. The Contents page groups them as:
  - Ch 1 Understanding Social Science
  - Geography: Ch 2–3
  - History: Ch 4–5
  - Political Science: Ch 6–7
  - Economics: Ch 8–9

  This matches the catalogue entry `iest1=0-9`. Topics: 66.
- Replaces: nothing. There is no old class 9 Social Science file. It also replaces none of the retired books (Contemporary India-I, Democratic Politics-I, Economics, India and the Contemporary World-I).
- The SST chapters have no numbered sections. Topics come from the chapters' 17pt and 15pt headings.
- **UNVERIFIED / MISSING — Part 2.** News reports, and the Ch 2 text itself ("You will learn more about waves and currents in Part 2 of this textbook"), say a *Part 2* exists. News reports say it went on sale on 29 Sep 2026. On 2026-10-01 it was not on NCERT's site:
  - the live catalogue lists only "PART-I"
  - `iest2ps.pdf` and `iest201.pdf` return 404

  Part 2 is **not included**. Its chapters must be added from NCERT's PDF once it is published. No Part 2 chapters were invented.

## English — `class9-english.json`

| Book | Code | Edition | Contents |
|---|---|---|---|
| Kaveri: Textbook of English for Grade 9 | iebe1 | First Edition, January 2026 (Pausha 1947) | https://ncert.nic.in/textbook/pdf/iebe1ps.pdf |

- Chapters: 16. The Contents page lists 8 numbered prose pieces, and each one is followed by a poem. Both kinds of entry are separate chapters here, in Contents order. Topics: 87.
  - The catalogue entry `iebe1=0-8` means there are 8 unit PDFs. Each unit PDF holds one prose piece and its poem, so a prose chapter and its poem share the same `pdf` URL.
- Kaveri replaces *Beehive* and *Moments*. The supplementary reader *Moments* and *Words and Expressions 1* are commented out in NCERT's live catalogue. Web reports agree that no separate supplementary reader is prescribed for 2026-27. So there is only one English textbook.
  - Some sites list *Words and Expressions 1* beside Kaveri for 2026-27. It is a grammar and writing workbook, not a textbook, so it is left out under the build rule (skip workbooks and grammar books unless they are the prescribed textbook).
- Replaces: nothing. There is no old class 9 English file.
- Topics follow each piece's own section headings:
  - Reading for Meaning / Appreciation, split at its "Check Your Understanding" breaks into Part I, Part II and so on
  - Critical Reflection
  - Vocabulary (and Structures) in Context
  - Listen and Respond, merged with the Speaking Activity
  - Writing Task
- Left out:
  - the pre-reading "Reflect and Respond" (a warm-up)
  - "Learning Beyond the Text" (optional projects)
  - transcripts and appendices
- In the 8 prose chapters, topic titles name the grammar or writing form that the section teaches. Examples: past perfect, noun and relative clauses, modals, reported speech, active and passive voice, first conditional, letter to the editor, notice, email. The 8 poem chapters keep the book's plain section names (Vocabulary in Context, Listening and Speaking, Writing Task); their objectives say what each section asks, for example the speech in "Believe in Yourself".

## Validation

A node check in the scratch area loaded each file and passed with `ALL CHECKS PASSED`. It asserted:
- all fields are present, including `source.books[].{title, code, edition, contentsUrl}`, `builtAt` and `method`
- every chapter has `book` and `pdf`
- ids are kebab-case and unique within their parent
- the chapter count equals the Contents count: 13, 14, 9 and 16
- every topic has 2–4 "Student can …" objectives, 1–3 visualIdeas, and estMinutes between 5 and 40

The repo's own `loadSyllabus()` from `packages/syllabus/src/syllabus.ts`, run under `node --experimental-strip-types`, also accepted all four files.

## Verification (2026-10-01, independent verifier)

Re-checked against NCERT's own files:
- **Catalogue:** the live https://ncert.nic.in/textbook.php Class 9 block lists Kaveri `iebe1=0-8`, Ganita Manjari `iemh1=0-8` and PART-II `iemh2=0-6`, Exploration `iesc1=0-13`, and Understanding Society PART-I `iest1=0-9`. `iest2ps.pdf` and `iest201.pdf` still return 404.
- **Editions:** all five prelims PDFs were re-downloaded. Each says First Edition: iesc1 April 2026, iemh1 April 2026, iemh2 August 2026, iest1 June 2026, iebe1 January 2026. A web search found no newer book. It confirmed that Exploration is a single volume, and that SST Part 2 went on sale from 29 Sep 2026 with no PDF on NCERT's site.
- **Chapters:** every chapter title and its order match the Contents page of its book, in all four files.
- **Topics:** every chapter PDF was read. For Science and Maths, the topics were compared with the numbered section headings. For SST, they were compared with the 17pt and 15pt headings (font sizes read with pdfjs-dist). For English, they were compared with the unit section headings. No section is missing and no topic is invented.
- **Objectives:** every objective was machine-checked for proper nouns, numbers and long terms that do not appear in its chapter's text. Each flag was then read in context. Samples were also read in full: Science Ch 1, 6, 7, 10, 12, 13; Maths Ch 5, 9, 10, 12, 14; SST Ch 1, 2, 4, 6, 7, 9; English Ch 1, 2, 11, 15, 16.
- **Fixes made:**
  - Science Ch 8: "Maharshi Kanad" was changed to "Acharya Kanada", as the book names him, and Leucippus was added.
  - Science Ch 10 (Energy of Sound Waves): a vague "examples" objective and a loudspeaker visual the book does not have were replaced. The new objective and visual use the book's own activity, grains on a stretched sheet.
  - SST Ch 6 (Types of Democracy): the visual's parliamentary example was changed from UK to Canada, matching the book (India and Canada).
  - This manifest: the description of the Science splits was corrected, the English workbook note was added, and the English topic-title claim was narrowed.
- **Schema:** re-run after the fixes. The independent check passed with 13/14/9/16 chapters and 123/90/66/87 topics. The repo's `loadSyllabus()` accepted all four files.
- **Still UNVERIFIED:** SST Part 2 is missing until NCERT publishes its PDF. Objectives outside the samples listed above were checked only by the machine scan, not read line by line against the text.
