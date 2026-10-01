# Class 6 syllabus manifest (NCERT books for the 2026-27 session)

Built 2026-10-01. Chapter titles were copied from each book's Contents page in its prelims PDF. Topics came from each chapter PDF's section headings, as described under "How topics were taken" below. Every PDF named here was downloaded and read. On 2026-10-01 the live NCERT files had the same Content-Length as the local copies for these: fegp1ps, fecu1ps, fees1ps, fepr1ps and fepr105.

The live catalogue (https://ncert.nic.in/textbook.php, fetched 2026-10-01) lists one English-medium book per subject for Class 6: `fepr1=0-5`, `fegp1=0-10`, `fecu1=0-12` and `fees1=0-14`. A web search found no newer Class 6 book for 2026-27. Poorvi has replaced Honeysuckle and A Pact with the Sun, and Class 6 English has no separate supplementary reader.

| Subject | File | Book (code) | Edition, from the prelims imprint page | Chapters (= Contents) | Topics | Replaces | Old file followed the same book? |
|---|---|---|---|---|---|---|---|
| English | class6-english.json | Poorvi: Textbook of English for Grade 6 (`fepr1`) | Reprint 2026-27 (First Edition June 2024; reprinted March 2025, January 2026) | 16 (in 5 units) | 81 | none (no class6-english in packages/syllabus/data) | n/a |
| Mathematics | class6-mathematics.json | Ganita Prakash: Textbook of Mathematics for Grade 6 (`fegp1`) | Reprint 2026-27 (First Edition August 2024; reprinted December 2024, January 2026) | 10 | 65 | packages/syllabus/data/class6-mathematics.json | NO, partly (see below) |
| Science | class6-science.json | Curiosity: Textbook of Science for Grade 6 (`fecu1`) | Reprint 2026-27 (First Edition July 2024; reprinted December 2024, January 2026) | 12 | 67 | packages/syllabus/data/class6-science.json | NO |
| Social Science | class6-social-science.json | Exploring Society: India and Beyond (`fees1`) | First Edition June 2024; reprinted February 2025 and February 2026. Unlike the other three books, this PDF has no "Reprint 2026-27" watermark. It is the only English-medium Class 6 SST book in the live catalogue, and the server shows the file as last modified on 2026-07-06. | 14 | 61 | none (no class6-social-science in packages/syllabus/data) | n/a |

Contents URLs:
- https://ncert.nic.in/textbook/pdf/fepr1ps.pdf
- https://ncert.nic.in/textbook/pdf/fegp1ps.pdf
- https://ncert.nic.in/textbook/pdf/fecu1ps.pdf
- https://ncert.nic.in/textbook/pdf/fees1ps.pdf

Chapter PDFs:
- English: `fepr101`–`fepr105`. Each PDF is one unit holding 3 or 4 chapters, so several chapters share a `pdf` URL.
- Mathematics: `fegp101`–`fegp110`.
- Science: `fecu101`–`fecu112`.
- Social Science: `fees101`–`fees114`.

## Old vs new: first 3 chapter titles

- **Mathematics**
  - Old: Patterns in Mathematics / Lines and Angles / Number Play
  - New: Patterns in Mathematics / Lines and Angles / Number Play
  - Verdict: NO. Only the first 4 old chapters match Ganita Prakash. Old chapters 5-10 are "Prime Numbers and Fractions", "Operations on Fractions", "Decimals", "Symmetry", "Perimeter and Area" and "Algebraic Thinking". The book's chapters 5-10 are "Prime Time", "Perimeter and Area", "Fractions", "Playing with Constructions", "Symmetry" and "The Other Side of Zero". The book has no Decimals or Algebraic Thinking chapter.
- **Science**
  - Old: Components of Food / Sorting Materials into Groups / Separation of Substances
  - New: The Wonderful World of Science / Diversity in the Living World / Mindful Eating: A Path to a Healthy Body
  - Verdict: NO. The old file follows the pre-2024 Class 6 Science book.
- **English** and **Social Science**: there is no old file to compare.

## How topics were taken

- **Mathematics:** every numbered section maps 1:1 to a topic, including 7.9 and 10.5 "A Pinch of History".
- **Science:** numbered sections (N.M) are used where they exist.
  - Subsections are split out where a section is too large: 2.2.1/2.2.2, 7.3.1-7.3.3 and 10.5.1/10.5.2.
  - In Chapter 6, subsections 6.3.1-6.3.6 are grouped in pairs into three topics.
  - Chapters 1 and 9 have no section headings at all; checked by font size in the PDF. Their topics are the chapter's natural units. Chapter 1's three topics are the chapter's three margin question call-outs ("What is Science?", "What will we explore with the help of this book?", "How can we try to find answers to our questions on our own?"); a fourth call-out on the last page is a closing quote, not a question. Chapter 9's topics group the separation methods the chapter teaches, in the chapter's order.
- **Social Science:** the chapters have no numbered sections. Topics are the chapter's headings in the two larger heading fonts (17 pt and 15 pt bold), read from the PDF by font size. Where these differ from the book's own wording:
  - Chapter 1's "Mapping the Earth" heading is represented by its three sub-headings (Understanding coordinates, Latitudes, Longitudes).
  - Chapter 3's, 10's and 12's "Introduction" headings were given descriptive labels ("Introduction to Landforms", "Introduction: Why We Need Governance", "Introduction: Governing Towns and Cities"). These labels are ours.
  - Chapter 13's first topic, "Economic and Non-Economic Activities", covers the chapter's opening pages, which have no heading. The label is ours.
  - Chapter 14's "The Classification of Economic Activities into Economic Sectors" is represented by its sub-headings A/B/C (Primary, Secondary, Tertiary activities); its short "Introduction" is not a separate topic.
  - Chapter 12's "Urban Local Bodies" is split into two topics for size.
  - Chapter 7's "The Vedas and Vedic Culture" keeps its parts a+b as one topic and part c ("Vedic schools of thought") as another.
  - The book's "Introduction: Why Social Science?" (pp. 1-6, inside fees101.pdf) is not a numbered chapter in the Contents, so it is not a chapter here.
- **English:** each chapter's topics follow the book's own sections:
  - "Let us read", split as Part I/II where the book breaks the text with discussion questions. The "Part I/II" labels are ours.
  - "Let us discuss" and "Let us think and reflect", which become "Thinking about the ...".
  - "Let us learn", which becomes "Words and Grammar: ...".
  - "Let us listen" and "Let us speak", which become "Listening and Speaking".
  - "Let us write", which becomes "Writing: ...".
  - "Let us explore" (enrichment) is left out.
  - National War Memorial is a short poem with only a read/recite activity, so it is one topic.

## Fixes made while verifying the files from the stopped run

- **class6-social-science.json:** the topic "The Vedas and Vedic Society" is renamed "The Vedas and Vedic Culture" to match the book's heading. Its id is now `the-vedas-and-vedic-culture`.
- **class6-mathematics.json:** "Bakhshali" is corrected to "Bakshali", the book's spelling, in Chapter 7 "A Pinch of History" (one objective and one visual idea).
- **class6-english.json** was newly built. Before writing it, these drafted objectives were corrected against the chapter PDFs:
  - Rama to the Rescue: "present continuous" became "present progressive" (the book's term). An objective was added for the exclamatory and interrogative sentences the book teaches.
  - The Unlikely Best Friends: "either...or" was added.
  - Spices that Heal Us: the writing topic now includes the Tulsi paragraph the book asks for.
  - The Kites: the cinquain poem was added. The listening task is now "spot and correct the wrong words", as in the book; the draft said true/false.
  - Change of Heart, Yoga and Ila Sachani: the listening tasks were reworded to match the book.
  - Five writing topics were given a second objective taken from the book's own task.

## Independent verification (2026-10-01)

A second pass re-downloaded the four prelims PDFs and 12 chapter PDFs from ncert.nic.in into a fresh scratch folder (English `fepr102`, `fepr104`, `fepr105`; Maths `fegp102`, `fegp106`, `fegp109`; Science `fecu103`, `fecu107`, `fecu111`; SST `fees103`, `fees108`, `fees112`) and checked:
- The live catalogue again lists only `fepr1=0-5`, `fegp1=0-10`, `fecu1=0-12` and `fees1=0-14` as the English-medium Class 6 books for these subjects (Honeysuckle and A Pact with the Sun are commented out). Web searches found no newer Class 6 book for 2026-27.
- Editions on the imprint pages: Poorvi, Ganita Prakash and Curiosity say "Reprint 2026-27". Exploring Society says reprinted February 2026, with no "Reprint 2026-27" text. The live server reports `fees1ps.pdf` as last modified 2026-07-06.
- Every chapter title and its order in all four files match the Contents pages exactly, and every `pdf` URL points to the right chapter or unit PDF.
- The section headings of the 12 sampled chapters match the topics. Using the first run's local PDFs (same sizes as the live files), the numbered headings of all 10 Maths and 12 Science chapters and the large-font headings of all 14 SST chapters were also compared with the topics.
- Objectives in the sampled chapters were read against the chapter text. English units 1 and 3 were spot-checked as well.

Fixes made in this pass:
- **class6-social-science.json:** chapters 10-12 used "--" where the Contents has an em dash. They now read "Grassroots Democracy — Part 1: Governance" and so on. The ids are unchanged.
- **class6-mathematics.json:** topic 3.10 now reads "An Unsolved Mystery — the Collatz Conjecture!" (it had "--"). The id is unchanged.
- **class6-science.json:** in Nature's Treasures, the objective "distinguish natural resources from human-made resources" was under 11.8, but the book defines human-made resources in 11.7. It moved to 11.7. Topic 11.8 now has objectives from its own text: listing natural resources used in daily activities (Activity 11.6), vehicle smoke polluting city air and alternatives such as electric vehicles, and judicious use.
- **class6-english.json:**
  - A Friend's Prayer: "read the poem aloud with expression" became "read the poem silently, underline the lines they agree with and explain why". That is the book's own task.
  - The Kites, writing: the planning hints now match the book. They are shape, colours, owner, activities, friends and a message for humans; the draft said "shape, colour and flight".
- **All four files:** `source.books[].edition` now lists every reprint date on the imprint page; some dates had been left out.

## Checks

- The chapter count of every file equals its Contents count: English 16, Maths 10, Science 12, SST 14.
- A scratch node check passed: all fields are present, ids are kebab-case and unique, there are 2-4 objectives starting "Student can", 1-3 visual ideas, and estMinutes is between 5 and 40.
- The repo's own `loadSyllabus` (packages/syllabus/src/syllabus.ts) accepts all four files.
- Both checks were re-run after the verification fixes and still pass (81/65/67/61 topic paths). A separate check confirmed every chapter title, its order and its `pdf` URL against the Contents pages.

UNVERIFIED:
- Objectives were checked by spot-checking their specific facts (names, numbers, terms) against the chapter text. In the verification pass, English units 2, 4 and 5 were read in full against their objectives. The Maths, Science and SST samples were checked by their key facts. No other chapter's objectives were compared sentence by sentence.
- Several topic labels are ours rather than the book's wording: the English section labels, the SST labels listed above, and Science chapters 1 and 9.
- The visual ideas are teaching suggestions, not taken from the books.
- All PDFs downloaded, so no chapter falls back to a title-only topic.
