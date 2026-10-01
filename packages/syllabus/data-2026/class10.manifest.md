# Class 10 syllabus (staging) - manifest

Built 2026-10-01 from NCERT's own PDFs (prelims/contents PDF of every book plus every chapter PDF, downloaded from
`https://ncert.nic.in/textbook/pdf/`). Nothing here is read by the app yet; `packages/syllabus/data` is untouched.

## Is there a new 2026-27 book for Class 10?

No. Evidence:

- The live NCERT catalogue (`https://ncert.nic.in/textbook.php`, fetched 2026-10-01) still lists the same Class 10
  books: Mathematics `jemh1`, Science `jesc1`, First Flight `jeff1`, Footprints without Feet `jefp1`, and the four
  Social Science books `jess1`-`jess4`.
- Each book's prelims PDF says "Reprint 2026-27", with reprints dated October 2025 to January 2026.
- Web search: several secondary sites say NCERT put off the new Class 10 (and 11) textbooks to the 2027-28 session.
  UNVERIFIED: the sites mention an NCERT advisory of 17 March 2026, but I did not read it on ncert.nic.in.
- CBSE's own Secondary Curriculum 2026-27 (Class X PDFs on cbseacademic.nic.in, `web_material/CurriculumMain27/SecPart1/`,
  read by the verifier on 2026-10-01) prescribes these same NCERT books: First Flight, Footprints without Feet and Words
  and Expressions - II for English; the NCERT Science and Mathematics textbooks; India and the Contemporary World - II,
  Contemporary India - II, Democratic Politics - II and Understanding Economic Development for Social Science.

## Files

| File | Books (code) | Edition | Chapters | Topics |
|---|---|---|---|---|
| `class10-english.json` | First Flight (`jeff1`), Footprints without Feet (`jefp1`) | Reprint 2026-27 (FF: first ed. Feb 2007, revised Oct 2022, reprinted Oct 2025; FwF: first ed. Apr 2007, revised Dec 2022, reprinted Oct 2025) | 28 (19 + 9) | 103 |
| `class10-social-science.json` | India and the Contemporary World - II (`jess3`), Contemporary India - II (`jess1`), Democratic Politics - II (`jess4`), Understanding Economic Development (`jess2`) | Reprint 2026-27 (reprinted Dec 2025 - Jan 2026) | 22 (5 + 7 + 5 + 5) | 220 |
| `class10-science.json` | Science (`jesc1`) | Reprint 2026-27 (first ed. Dec 2006, revised Oct 2022, reprinted Jan 2026) | 13 | 139 |
| `class10-mathematics.json` | Mathematics (`jemh1`) | Reprint 2026-27 (first ed. Dec 2006, revised Oct 2022, reprinted Dec 2025) | 14 | 34 |

The chapter count of every file matches the book's Contents page. The checks are in "Validation" below.

## Per subject

### English: no existing file to replace

- `packages/syllabus/data` has no `class10-english.json`.
- **First Flight:** the Contents page has 9 numbered prose units. The 10 poems are listed under them (Dust of Snow, Fire
  and Ice, A Tiger in the Zoo, How to Tell Wild Animals, The Ball Poem, Amanda!, The Trees, Fog, The Tale of Custard the
  Dragon, For Anne Gregory). Each poem is its own chapter, in Contents order, and its `pdf` is its unit's PDF (for
  example, Dust of Snow points to `jeff101.pdf`).
- **Footprints without Feet** (supplementary reader): 9 chapters.
- **Skipped:** "Words and Expressions 2" (`jewe2`). It is a workbook, and the build rule skips workbooks. Note: CBSE's
  2026-27 English Language and Literature curriculum does list it as a prescribed book (Units 1 to 4 and 7 to 11), so
  its grammar and writing practice is not covered by this file.
- **Topics:** these are the chapter's own units:
  - the text itself (long texts are split at the book's "Read and Find Out" or oral-comprehension breaks)
  - Thinking about the Text / Poem
  - each titled language exercise, for example "Relative Clauses", "Phrasal Verbs", "Reported Speech"
  - the speaking, listening and writing tasks
- **Topic titles I named myself:** some exercise groups have no heading in the PDF (their side-tab labels are images).
  I gave these short descriptive titles, for example "Thinking about Language: Words for Storms and the Word Hope".
  They are named from the exercise content and the book's own "What we have done" notes.

### Social Science: no existing file to replace

- `packages/syllabus/data` has no `class10-social-science.json`.
- **Book order:** History, Geography, Political Science, Economics. Each chapter's `book` names its book.
- **History:** topics are the numbered section headings from every chapter PDF.
  - Chapter III has two sections the book numbers 2.4 (Rinderpest; Indentured Labour Migration). Both are kept.
  - The "For Extended Learning" QR-code chapters are not on the Contents page as chapters, so they are not included.
    These are The Nationalist Movement in Indo-China; Work, Life and Leisure; and Novels, Society and History.
- **Geography, Political Science and Economics:** topics are the unnumbered headings in each chapter PDF.
  - Some of these are run-in headings at the start of a paragraph. Small run-in units are grouped under one topic,
    for example "Rice, Wheat, Millets and Maize" and "Non-Food Crops: Rubber and Fibre Crops".
  - Geography ch.1 has no heading before its section on classifying resources. That topic is titled "Classification of
    Resources", after the book's Fig. 1.2 caption.
- **Not included:** appendices, glossary and exercises.
- **Topics from titled boxes:** some topics come from titled boxes, not running-text headings. Examples are "Project
  Tiger" (Contemporary India ch.2), "Bamboo Drip Irrigation System" (ch.3), "Bhoodan - Gramdan" (ch.4) and "Popular
  participation in political parties" (Democratic Politics ch.4). The list of box topics is not complete: no full count
  was made.
- **Consumer Rights:** Economics ch.5 is on the book's Contents page, so it is included. CBSE's Secondary Curriculum
  2026-27 lists it as "Consumer Rights (Project Work)", so it is assessed as a project, not in the board exam.
- **Other CBSE 2026-27 assessment notes** (from the same curriculum PDF; every chapter stays in the file because it is
  on the book's Contents page):
  - History ch.III: only subtopics 1 to 1.3 are in the board exam. The rest is an internally assessed project.
  - History ch.IV, The Age of Industrialisation: assessed in periodic assessment only.
  - Geography ch.7, Lifelines of National Economy: only map pointing is in the board exam.
  - Economics ch.4: some sections are in the board exam and the rest are part of an internally assessed project.

### Science: replaces `packages/syllabus/data/class10-science.json`. Same book: YES

| | Ch 1 | Ch 2 | Ch 3 |
|---|---|---|---|
| Old | Chemical Reactions and Equations | Acids, Bases and Salts | Metals and Non-metals |
| New | Chemical Reactions and Equations | Acids, Bases and Salts | Metals and Non-metals |

- **Chapter titles:** all 13 match except two spellings, which now follow the book.
  - "Light – Reflection and Refraction" becomes "Light - Reflection and Refraction". The id is unchanged.
  - "The Human Eye and the Colorful World" becomes "The Human Eye and the Colourful World". The chapter **id changes**
    to `the-human-eye-and-the-colourful-world`.
- **Topics:** these are now every numbered section and subsection of each chapter PDF. Old file: 119 topics. New file:
  139 topics.
  - A parent heading that is only a short lead-in to its subsections is not a separate topic. Examples are 1.2, 3.2,
    5.2, 7.2 and 13.2.
  - Some topic ids are new or changed: 92 of the 119 old topic paths still exist.
- **Content not in the 2026-27 book:** the rationalised book has no Electric Motor, Electromagnetic Induction or
  Electric Generator in ch.12, and no Evolution sections in ch.8. Neither file has them.
  - CBSE's Science curriculum 2026-27 still lists Periodic Classification of Elements, Evolution, and Motor,
    Electromagnetic Induction and Electric Generator. It assesses them only formatively, not in the year-end exam, and
    says the relevant NCERT text is enclosed for reference. They are not in the textbook, so they are not in this file.

### Mathematics: replaces `packages/syllabus/data/class10-mathematics.json`. Same book: YES

| | Ch 1 | Ch 2 | Ch 3 |
|---|---|---|---|
| Old | Real Numbers | Polynomials | Pair of Linear Equations in Two Variables |
| New | Real Numbers | Polynomials | Pair of Linear Equations in Two Variables |

- **Chapters:** all 14 titles and chapter ids are the same.
- **Topics:** these are now the numbered sections on the Contents page, checked against each chapter PDF. Old file: 45
  topics. New file: 34 topics.
  - Introduction and Summary sections are not topics. The old file had "Introduction" topics.
  - Two long sections are split by the parts the section itself names. The topic title keeps the section heading.
    - 6.4 is split by its criteria: "AAA and AA" (Theorem 6.3) and "SSS and SAS" (Theorems 6.4 and 6.5).
    - 13.2 is split by its three named methods: Direct, Assumed Mean and Step-deviation.
  - Appendices A1 (Proofs in Mathematics) and A2 (Mathematical Modelling) are not chapters on the Contents page, so they
    are not included.
  - Only 15 of the 45 old topic paths still exist, because the old topic ids were not the book's headings.

## What was and was not checked

- **No PDF failed to download.** All 8 prelims PDFs and all 67 chapter PDFs downloaded, each within the allowed 3
  tries. No chapter fell back to a title-only topic.
- **Section headings:**
  - Science: extracted from every chapter PDF with a pattern match, and missing ones were found by hand.
  - Maths: the Contents page lists all sections.
  - History: taken from every chapter PDF.
  - English, Geography, Political Science and Economics: found by heading-shape heuristics, targeted searches and
    reading each chapter. A run-in heading could have been missed there. A verifier should sample these.
- **Objectives:** each was written from that section's text, which I read or skimmed. A sample was checked against the
  PDF, and five objectives that went beyond their section were corrected (moved or rewritten). UNVERIFIED: not every
  objective was checked one by one against its section.
- **estMinutes:** my estimates of teaching time (5-40). They are not from NCERT.
- **visualIdeas:** suggestions for the lesson designer. They are not from NCERT.

## Validation

Both checks ran on 2026-10-01. Neither script is in the repo.

1. A schema check written for this build. It checks:
   - all fields are present and ids are kebab-case and unique
   - the chapter count equals the Contents count (English 28, Social Science 22, Science 13, Mathematics 14)
   - each topic has 2-4 objectives starting "Student can", 1-3 visualIdeas and estMinutes from 5 to 40
   - each `book` matches `source.books`, and each `pdf` URL has the expected shape

   Result: ALL CHECKS PASSED.
2. The repo's own `loadSyllabus`, `listTopics` and `getTopic` (`packages/syllabus/src/syllabus.ts`, transpiled in
   memory). Result: all four files load, and all 496 topic paths can be reached.

## Independent verification (2026-10-01)

A second agent re-checked the files against NCERT's PDFs, which it downloaded again itself. Its scripts are not in the
repo.

**What was checked:**

- **Catalogue:** the live NCERT catalogue still lists `jemh1`, `jesc1`, `jeff1`, `jefp1`, `jewe2` and `jess1` to
  `jess4` for Class 10.
- **Contents pages:** all 8 prelims PDFs. Each says "Reprint 2026-27". Every chapter title and its order matches the
  Contents page: 28, 22, 13 and 14 chapters.
- **Chapter PDFs:** 22 were downloaded fresh (4 Maths, 4 Science, 5 English, 9 Social Science). The other 45 are the
  builder's NCERT downloads. Every one of the 30 files that both agents downloaded (8 prelims and 22 chapters) was the
  same size.
- **Section headings:**
  - Compared against the topics for every chapter of Science and History, by section number.
  - Spot-checked for all 7 Geography chapters, all 5 Political Science chapters and all 5 Economics chapters.
  - Compared against the Contents page for Maths.
  - Spot-checked for 5 English chapters.
- **Objectives:** run through two keyword audits, then read by hand where the audits flagged something.
  - The first audit looked for words that appear nowhere in the chapter.
  - The second looked for words that appear in the chapter but not in the topic's own section.
- **Schema:** checked again with a new script, and loaded with the repo's loader. Result: 0 errors, and all 496 topic
  paths can be reached.

**Problems found and fixed:**

- **Science:**
  - 2.2 / 2.2.1: the dry-HCl litmus objective was in 2.2. It moved to 2.2.1, where Activity 2.9 is.
  - 3.4 / 3.4.1: the objective "low-reactivity metals such as gold are found free" moved to 3.4.1, where the book says
    it. 3.4 now has two objectives that match its own text.
  - 5.2.3: "pseudopodia" is not the book's word. The objective now uses the book's own wording, "temporary finger-like
    extensions".
  - 6.1.2: the objective named the cerebrum and pons, which the section text does not mention. It now names what the
    text covers: the central and peripheral nervous systems, the fore-brain, the medulla and the cerebellum.
  - 8.2.1 / 8.2.2: the objective "both parents contribute equally" moved to 8.2.2, where the book says it. The
    two-trait cross objective said "round-yellow x wrinkled-green". It now matches Fig. 8.5, round green x wrinkled
    yellow, and drops "dihybrid", which the book does not use.
- **Social Science:**
  - Democratic Politics ch.5: the topic titled "Economic outcomes of democracy" was named after a box. It is now titled
    after the section heading that holds the box, "Economic growth and development". Its id is now
    `economic-growth-and-development`.
  - India and the Contemporary World ch.III, 4.2: the objective "rapid reconstruction of Japan and Europe" is not in the
    section. It now matches the text: technology and enterprise spread, and developing countries imported industrial
    plant.
  - Democratic Politics ch.1: the Sri Lanka ethnic composition is described in "Belgium and Sri Lanka", so the
    objective moved there from "Majoritarianism in Sri Lanka".
  - Contemporary India ch.4: the book only says the Bhoodan-Gramdan movement "is also known as the Blood-less
    Revolution". The objective that asked why it got the name now describes what the box says.
- **Manifest:**
  - It now records that CBSE's 2026-27 curriculum prescribes Words and Expressions - II.
  - The Consumer Rights question is resolved: it is project work.
  - It now records the other CBSE 2026-27 assessment notes and the Science topics that CBSE assesses only formatively.

**Still UNVERIFIED:**

- **NCERT advisory:** NCERT's own advisory on new Class 10 books in 2027-28 has not been read. CBSE's 2026-27
  curriculum does prescribe the current books.
- **Unflagged objectives:**
  - Objectives the keyword audits did not flag were not all read against their sections by hand.
  - Most English objectives were not, apart from the 5 sampled chapters.
- **Run-in headings:** a run-in heading in Geography, Political Science or Economics could still be missing. None was
  found in the chapters that were checked.
- **Figure labels:** figure labels are images, so the PDF text does not include them. Two objectives name parts that
  are probably only in figure labels: the eye's ciliary muscles in 10.1, and the receptor and effector of the reflex
  arc in 6.1.1. They were left as they are.
