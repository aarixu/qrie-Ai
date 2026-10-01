# Class 7 syllabus manifest (NCERT books for the 2026-27 session)

Built 2026-10-01. Chapter titles were copied from each book's Contents page in its prelims PDF. Topics came from each chapter PDF's section headings, as described under "How topics were taken" below. All 6 prelims PDFs and all 52 chapter PDFs named here were downloaded and read (pdftotext, plus font sizes read with pdfjs-dist to find unnumbered headings).

The live catalogue (https://ncert.nic.in/textbook.php, fetched 2026-10-01) lists these English-medium books for Class 7: `gepr1=0-5` (Poorvi), `gegp1=0-8` and `gegp2=0-7` (Ganita Prakash and Ganita Prakash-II), `gecu1=0-12` (Curiosity), `gees1=0-12` and `gees2=0-8` (Exploring Society: India and Beyond Part-I and Part-II). A web search found no newer Class 7 book for 2026-27. The catalogue lists only Poorvi for Class 7 English, and third-party sites say Poorvi replaced Honeycomb and the supplementary reader An Alien Hand, so there is no separate supplementary reader. CBSE Circular No. Acad-12/2025 (26 March 2025) tells CBSE schools to use NCERT's new Grade 7 textbooks from 2025-26; it gives one release date per subject and names no supplementary reader. UNVERIFIED: no CBSE document read here names Poorvi as the only Class 7 English book.

| Subject | File | Book (code) | Edition, from the prelims imprint page | Chapters (= Contents) | Topics | Replaces | Old file followed the same book? |
|---|---|---|---|---|---|---|---|
| English | class7-english.json | Poorvi: Textbook of English for Grade 7 (`gepr1`) | Reprint 2026-27 (First Edition March 2025; reprinted January 2026) | 15 (in 5 units) | 80 | none (no class7-english in packages/syllabus/data) | n/a |
| Mathematics | class7-mathematics.json | Ganita Prakash, Grade 7 Part I (`gegp1`) and Part II (`gegp2`) | Part I: Reprint 2026-27 (First Edition April 2025; reprinted January 2026). Part II: First Edition October 2025. Part II's prelims and chapter PDFs carry no "Reprint 2026-27" mark; it is the only Part II in the live catalogue. | 15 (Part I: 8, Part II: 7) | 110 | packages/syllabus/data/class7-mathematics.json | NO |
| Science | class7-science.json | Curiosity: Textbook of Science for Grade 7 (`gecu1`) | Reprint 2026-27 (First Edition April 2025; reprinted January 2026) | 12 | 76 | packages/syllabus/data/class7-science.json | NO |
| Social Science | class7-social-science.json | Exploring Society: India and Beyond, Grade 7 Part 1 (`gees1`) and Part 2 (`gees2`) | Part 1: Reprint 2026-27 (First Edition April 2025; reprinted February 2026). Part 2: Reprint 2026-27 mark on the cover (First Edition November 2025; no reprint date on the imprint page). | 20 (Part 1: 12, Part 2: 8) | 129 | none (no class7-social-science in packages/syllabus/data) | n/a |

Contents URLs:
- https://ncert.nic.in/textbook/pdf/gepr1ps.pdf
- https://ncert.nic.in/textbook/pdf/gegp1ps.pdf
- https://ncert.nic.in/textbook/pdf/gegp2ps.pdf
- https://ncert.nic.in/textbook/pdf/gecu1ps.pdf
- https://ncert.nic.in/textbook/pdf/gees1ps.pdf
- https://ncert.nic.in/textbook/pdf/gees2ps.pdf

Chapter PDFs:
- English: `gepr101`–`gepr105`. Each PDF is one unit holding 3 chapters, so three chapters share each `pdf` URL. Units: 1 Learning Together, 2 Wit and Humour, 3 Dreams and Discoveries, 4 Travel and Adventure, 5 Bravehearts.
- Mathematics: `gegp101`–`gegp108` (Part I), `gegp201`–`gegp207` (Part II). Each part numbers its chapters from 1; the `book` field says which part.
- Science: `gecu101`–`gecu112`.
- Social Science: `gees101`–`gees112` (Part 1), `gees201`–`gees208` (Part 2). Each part numbers its chapters from 1; the `book` field says which part.

## Old vs new: first 3 chapter titles

- **Mathematics**
  - Old: Integers / Fractions and Decimals / Data Handling
  - New: Large Numbers Around Us / Arithmetic Expressions / A Peek Beyond the Point
  - Verdict: NO. The old file follows the pre-2025 Class 7 Mathematics book, and only 8 of its chapters (Integers, Fractions and Decimals, Data Handling, Simple Equations, Lines and Angles, The Triangle and its Properties, Comparing Quantities, Rational Numbers). The current books are Ganita Prakash Part I and Part II, 15 chapters.
- **Science**
  - Old: The Wonderful World of Science / Diversity in the Living World / Mindful Eating: A Path to a Healthy Body
  - New: The Ever-Evolving World of Science / Exploring Substances: Acidic, Basic, and Neutral / Electricity: Circuits and their Components
  - Verdict: NO. All 12 old chapters are the Class 6 Curiosity chapters (one title slightly off: old "Measurement of Distance and Motion" vs the Class 6 book's "Measurement of Length and Motion"). None is a Class 7 Curiosity chapter.
- **English** and **Social Science**: there is no old file to compare.

## How topics were taken

Topic titles are the book's headings. Where one topic covers two headings, or one heading is split into parts, the title joins or extends the book's headings, and those labels are ours. `objectives` were written from the section text; `visualIdeas` and `estMinutes` are our estimates, not the book's.

- **Science:** numbered sections (N.M and N.M.K) are used.
  - Chapter 1 has one numbered section (1.1 Happy Exploring!). The unnumbered introduction before it is the chapter's first topic.
  - Headings that only lead into their subsections, with at most a short introductory paragraph (2.1, 3.2, 4.1, 5.3, 5.7, 6.4, 10.2, 10.3, 12.3), are covered by their subsections' topics.
  - Merged pairs of short subsections: 3.2.1+3.2.2, 3.2.4+3.2.5, 4.1.2+4.1.3, 4.1.4+4.1.5, 5.3.1+5.3.2, 5.7.1+5.7.2, 6.4.1+6.4.2, 6.4.3+6.4.4, 8.3+8.3.1, 11.8.1+11.8.2.
  - Split for size: 9.1.1 (Mouth to Stomach / Intestines and Absorption), 9.2.1 (How Do We Breathe? / Gas Exchange, Respiration and Circulation), 12.1 (Day and Night / Apparent Motion of the Sun and Stars).
  - Chapter 12's seasons topic is the book's numbered section 12.2.2 "Seasons on the Earth" (page 177).
- **Mathematics:** the numbered sections (16 pt) and their unnumbered sub-headings (14 pt), read by font size.
  - Short sub-headings are merged into their section, for example "Nearest Neighbours" and "Populations of Cities" into 1.4, and "Notations" into 5.4.
  - Long sections are split at their sub-headings, for example 2.2, 4.5, 6.3, 8.1, Part II 1.2, 2.2, 3.1, 4.3, 5.2 and 5.3. Part II 2.2's "Division of Integers" is a bold 12 pt heading and is its own topic.
  - Labels that join two headings: "Measuring the Angles and Two Sides with the Included Angle", "Primes and Prime Factorisation", "Division with a Decimal Dividend and a Decimal Divisor", "Regular Hexagons and Related Constructions". "Multiplication of Fractions: A Fraction and a Whole Number" is the opening part of 8.1, before its first sub-heading.
  - Each chapter's end matter (SUMMARY, puzzles and the answer pages bound into the same PDF) is not a topic.
- **English:** each chapter's topics follow the book's own sections:
  - "Let us read", split as Part I/II where the book marks the text I and II. "Scene I/II" (Say the Right Thing) is the book's; "Part I/II" is ours.
  - "Let us discuss" and "Let us think and reflect", which become "Thinking about the ...".
  - "Let us learn", which becomes "Words and Grammar: ..." naming the grammar the section teaches.
  - "Let us listen" and "Let us speak", which become "Listening and Speaking".
  - "Let us write", which becomes "Writing: ..." naming the task.
  - "Let us explore" (enrichment) and the transcripts at the end of each unit are left out.
  - Rani Abbakka's reading text is a picture story, so pdftotext and pdfjs return no story text. Its six story pages (gepr105.pdf pages 29-34) were rendered to images and read, and the reading objectives follow them.
- **Social Science:** the chapters have no numbered sections. Topics are the chapters' 17 pt headings, with 15 pt sub-headings merged into them, read by font size.
  - Each chapter's opening quotation and story (for example Rakesh Sharma's "Sāre jahān se achchha" in Part 1 Chapter 1) is not a topic. Part 1 Chapter 4's introduction on the Second Urbanisation is folded into its first topic.
  - Every 17 pt heading has its own topic or is named in a joined label below. The one exception is Part 2 Chapter 7's lettered item "b) Indian railway network", which the PDF sets at 17 pt while its sibling items a and c-e are at 15 pt; it is covered by "Transportation Infrastructure: Roads and Railways". Part 1 Chapter 2's first topic is its 17 pt heading "Weather and its Elements", covering the 15 pt "What is weather?" and "Observing Nature's clues".
  - Split or grouped at sub-headings for size: Part 1 Chapter 2's weather instruments (a-e) become three topics; Part 2 Chapter 2's land-based neighbours become two topics; Part 2 Chapter 7's transport (a-e) becomes two topics.
  - Part 1 Chapter 9's "Functions of Government" and "A Peek into History", and Part 2 Chapter 6's "India, a Republic that Protects the Rights of All" and "The Government and You", are topics of their own.
  - Labels that join two headings: "India's Agricultural Landscape and Echoes from the Past", "The Role of the Government and Challenges", "An Ancient Neighbour and the Land of Copper", "Introduction: Why is Physical Infrastructure Important?", "What is a State? What is a Government?", "The Journey of Money: Coinage", and the four paired community topics in Part 2 Chapter 5.
  - "Questions and activities" at each chapter's end is not a topic; "Before we move on" was used only to check objectives.

## Schema check

A node check (scratch area, not in the repo) loads each file with `loadSyllabus` from packages/syllabus/src/syllabus.ts and asserts: every required field and the `source`/`book`/`pdf` extras are present; chapter and topic ids are kebab-case and unique within their parent; the chapter count equals the Contents count (12, 15, 15, 20); every topic has 2-4 objectives starting "Student can", 1-3 visual ideas, and estMinutes from 5 to 40. Result on 2026-10-01: all checks passed.

## Verification (2026-10-01)

A second pass re-downloaded the live catalogue, all 6 prelims PDFs and 13 chapter PDFs spread across the four subjects; each was byte-identical to the copy the build used. It then checked:
- every chapter title, its order and its `pdf` against the Contents pages, scripted;
- the numbered sections of all 12 Science chapters and the 16 pt and 14 pt headings of all 15 Mathematics chapters against their topics;
- the 17 pt headings of all 20 Social Science chapters and the "Let us ..." sections of all 15 English chapters against their topics;
- sampled objectives against the section text, in 5 Science, 5 Mathematics, 8 Social Science and all 15 English chapters.

Fixes made:
- Science Chapter 12: the seasons topic is now 12.2.2 "Seasons on the Earth". It was a made-up label, and the manifest wrongly said the passage had no number.
- Social Science Part 1 Chapter 2: the first topic now carries the chapter's 17 pt heading, "Weather and its Elements".
- Social Science Part 1 Chapter 9: "Functions of Government" and "A Peek into History" are now their own topics.
- Social Science Part 2 Chapter 6: "India, a Republic that Protects the Rights of All" and "The Government and You" are now their own topics. Before, the second had no topic, apart from one objective filed under Executive.
- English Rani Abbakka: the reading objectives were rewritten from the rendered story pages.
