# Class 8 syllabus manifest (NCERT books for the 2026-27 session)

Built 2026-10-01. Chapter titles were copied from each book's Contents page in its prelims PDF. Topics came from each chapter PDF, as described under "How topics were taken" below. All 6 prelims PDFs and all 47 chapter PDFs named here were downloaded from ncert.nic.in on 2026-10-01 and read. No chapter fell back to UNVERIFIED.

The live catalogue (https://ncert.nic.in/textbook.php, fetched 2026-10-01) lists these English-medium Class 8 books:

- `hepr1=0-5`: Poorvi
- `hegp1=0-7` and `hegp2=0-7`: Ganita Prakash Part-I and Part-II
- `hecu1=0-13`: Curiosity
- `hees1=0-7` and `hees2=0-8`: Exploring Society India and Beyond Part-I and Part-II

The older Class 8 books are still in the page source, but inside a `/* ... */` comment block, so the live page does not offer them. Those are Honeydew, It So Happened, Mathematics (`hemh1`), Science (`hesc1`), Our Pasts-III, Social and Political Life and Resource and Development.

A web search on 2026-10-01 found no newer Class 8 book for 2026-27. Two results:

- Poorvi is the only prescribed English book. There is no separate supplementary reader.
- Exploring Society Part 2 was first released in February 2026 and then revised. Its own prelims (hees2ps.pdf) say:
  - the book "has been published pursuant to the review process undertaken in compliance with the directions of the Hon'ble Supreme Court of India in Suo Motu Writ Petition (Civil) No. 1/2026";
  - Chapter 4, "The Role of the Judiciary in Society", "was rewritten by the Committee constituted by the Ministry of Education".

  The file served today is that revised edition, dated First Edition June 2026.

| Subject | File | Book (code) | Edition, from the prelims imprint page | Chapters (= Contents) | Topics | Replaces | Old file followed the same book? |
|---|---|---|---|---|---|---|---|
| English | class8-english.json | Poorvi: Textbook of English for Grade 8 (`hepr1`) | Reprint 2026-27 (First Edition May 2025; reprinted January 2026) | 15 (in 5 units) | 80 | none (no class8-english in packages/syllabus/data) | n/a |
| Mathematics | class8-mathematics.json | Ganita Prakash, Textbook of Mathematics for Grade 8, Part-I (`hegp1`) | Reprint 2026-27 (First Edition July 2025; reprinted January 2026) | 7 | 65 | packages/syllabus/data/class8-mathematics.json | NO |
| | | Ganita Prakash, Part-II (`hegp2`) | First Edition December 2025. No "Reprint 2026-27" mark in this PDF; it is the only Part-II in the live catalogue. | 7 | 56 | (same file) | |
| Science | class8-science.json | Curiosity: Textbook of Science for Grade 8 (`hecu1`) | Reprint 2026-27 (First Edition June 2025; reprinted January 2026) | 13 | 102 | packages/syllabus/data/class8-science.json | NO |
| Social Science | class8-social-science.json | Exploring Society: India and Beyond, Grade 8 Part 1 (`hees1`) | Reprint 2026-27 (First Edition July 2025; reprinted March 2026) | 7 | 56 | none (no class8-social-science in packages/syllabus/data) | n/a |
| | | Exploring Society: India and Beyond, Grade 8 Part 2 (`hees2`) | First Edition June 2026, the revised edition described above. No "Reprint 2026-27" mark. | 8 | 77 | (same file) | |

Totals: 57 chapters and 436 topics.

Contents URLs:
- https://ncert.nic.in/textbook/pdf/hepr1ps.pdf
- https://ncert.nic.in/textbook/pdf/hegp1ps.pdf
- https://ncert.nic.in/textbook/pdf/hegp2ps.pdf
- https://ncert.nic.in/textbook/pdf/hecu1ps.pdf
- https://ncert.nic.in/textbook/pdf/hees1ps.pdf
- https://ncert.nic.in/textbook/pdf/hees2ps.pdf

Chapter PDFs:
- **English:** `hepr101`–`hepr105`. Each PDF is one unit holding 3 chapters, so three chapters share each `pdf` URL.
- **Mathematics:** `hegp101`–`hegp107` and `hegp201`–`hegp207`.
  - Part-II's own Contents numbers its chapters 1–7. Some websites number them 8–14.
  - The file keeps the Contents order, Part-I first.
- **Science:** `hecu101`–`hecu113`.
- **Social Science:** `hees101`–`hees107` and `hees201`–`hees208`, Part 1 first.

Items in the Contents that are not chapters, and so are not in the files:
- "A Note on History's Darker Periods" (Part 1, page 20, inside hees101.pdf).
- "Looking back and forward ..." (Part 2, page 33, inside hees201.pdf).
- The glossaries.
- Ganita Prakash Part-II's "Learning Material Sheets".

Part 1 of Exploring Society has no Theme C chapter. Its Contents goes from Theme B to Theme D.

## Old vs new: first 3 chapter titles

- **Mathematics**
  - Old (13 chapters, 45 topics): Rational Numbers / Linear Equations in One Variable / Understanding Quadrilaterals
  - New: A Square and A Cube / Power Play / A Story of Numbers
  - Verdict: NO. The old file follows the pre-2025 NCERT Mathematics book (`hemh1`). That book is now inside the commented-out block of the catalogue.
- **Science**
  - Old (13 chapters, 96 topics): Crop Production and Management / Microorganisms: Friend and Foe / Coal and Petroleum
  - New: Exploring the Investigative World of Science / The Invisible Living World: Beyond Our Naked Eye / Health: The Ultimate Treasure
  - Verdict: NO. The old file follows the pre-2025 Science book (`hesc1`).
- **English** and **Social Science**: there is no old file to compare.

## How topics were taken

Section headings were found in two ways:
- by font size, using pdfjs-dist text items: Science numbered sections are 17 pt and subsections 12–13 pt; Ganita Prakash sections are 16 pt and subsections 14 pt; Exploring Society sections are 17 pt and subsections 15 pt;
- in the reading-order text from pdftotext.

The objectives were written after reading:
- each section's opening text, often the whole section;
- the chapter's end summary ("Snapshots", "SUMMARY" or "Before we move on").

Every sentence of every section was not read. Specific facts named in objectives (names, dates, numbers, examples) were checked by searching the chapter text. 21 objectives and one visual idea that failed that check were rewritten.

- **Science**
  - Numbered sections (N.M) map to topics. Subsections (N.M.K) are their own topics where the section is large: 2.1.1, 2.4.1–2.4.3, 3.2.1/3.2.2, 3.4.1/3.4.2, 3.5.1, 7.2.1–7.2.3, 9.2.1, 12.9.2, 8.1.1/8.1.2, 8.3.1/8.3.2, 11.1.1–11.1.3, 11.2.1–11.2.4, 13.3.1–13.3.3, 13.4.1–13.4.4, 13.5.1/13.5.2.
  - Merged:
    - 4.1.1 + 4.1.2 form "Electromagnets".
    - 4.3 + 4.3.1 form "How Does a Battery Generate Electricity?"
    - 4.3.2 + 4.3.3 form "Dry Cells and Rechargeable Batteries".
    - 5.4 is split into "Contact Forces" (5.4.1) and "Non-contact Forces" (5.4.2).
    - 9.5.2 + 9.5.3 form "Effect of Temperature and Pressure on Density".
    - 12.9 includes 12.9.1. 12.9.2 is its own topic.
  - Split for size:
    - 6.1 Pressure became "Pressure: Force per Unit Area" and "Pressure Exerted by Liquids".
    - 9.5.1 became "Determination of Density: Measuring Mass and Volume". It is one topic, renamed to show its two parts.
  - Chapter 1 has no section headings; this was checked by font size. Its three topics are the chapter's natural units, and their titles are ours, not the book's:
    - "From Wonder to Investigation"
    - "Our Investigative Journey This Year"
    - "Investigating Why a Puri Puffs Up"
- **Mathematics**
  - Numbered sections (N.M) map to topics. Large sections are split along the book's 14 pt subheadings, for example 1.1 into Square Numbers / Patterns and Properties / Odd Numbers / Triangular Numbers / Square Roots.
  - Topic titles that merge or rename book headings:
    - "The Stones that Shine and the Magical Pond" (two subheads of 2.2)
    - "Some Early Number Systems: Body Parts, Tally Marks and Counting in Twos" (3.2 I–III)
    - "The Mayan and Chinese Number Systems" (3.4 II–III)
    - "Shortcuts for Divisibility by 3 and 11"
    - "Fractals: The Sierpinski Carpet" (4.1 intro + Sierpinski Carpet)
    - "Sierpinski Gasket and Koch Snowflake"
    - "Isometric Projections and Drawing on Isometric Grids"
    - "Unchanging Mean and Relatively Unchanged"
    - "Infographics and What can a Strip Say?"
    - "Fun with Grids: Calendar Magic and Algebra Grids"
    - "Kite" and "Trapezium" are 4.6's two subheads.
  - Spellings:
    - "Decimal Representation of Root 2" stands for the book's "√2".
    - Diacritics are dropped: Baudhayana, Bhaskaracharya, Lilavati, Sulba-Sutra.
  - The book has two sections numbered "2.5" in Power Play: "Did You Ever Wonder?" and "A Pinch of History". Both are kept.
  - Ganita Prakash 6.1 "Algebra Play" is a 3-line introduction, so it is not a separate topic.
- **Social Science**
  - Topics are the chapters' 17 pt section headings, with 15 pt subheadings split out where a section is large: Akbar and Aurangzeb, the Ahoms and the Sikhs, the Supreme Court's jurisdictions, the continents, and so on.
  - Small adjacent sections are merged. Their titles join the book's headings, for example:
    - "The All-India Muslim League and the 1907 Surat Split"
    - "Traditional Houses, Churches and Colonial Architecture"
    - "Ocean Trenches, the Great Barrier Reef and Smaller Water Bodies"
  - Titles that are ours, not the book's:
    - "The Medieval Period and New Invasions" (ch. 2's untitled opening pages)
    - "Introduction to the Parliamentary System"
    - "Introduction to Factors of Production"
    - "Introduction to India's Urban Landscape" (the book heads these sections just "Introduction")
    - "The Mughals: Babur and Akbar"
  - The Parliament chapter's long "Legislative Functions of the Parliament" section (four numbered subheads) is split in two topics, each titled "Legislative Functions of the Parliament: ...":
    - "Constitutional Functions and Lawmaking" (subheads 1 and 2)
    - "Executive and Financial Accountability" (subheads 3 and 4)
  - "India's Long Road to Independence" has 23 headed sections. They are kept as 19 topics, in the book's order.
- **English** (Poorvi has no numbered sections). Each chapter's topics follow the book's own activity sections, the same convention as class6-english:
  - "Let us read" becomes "Reading: <title>". It is split as Part I/II or Scene I/II where the book breaks the text with a "Let us discuss" block. This applies to Wisdom Paves the Way (Scenes I/II, the book's own labels), The Case of the Fifth Word, The Cherry Tree, Waiting for the Rain and Feathered Friend.
  - "Let us discuss" and "Let us think and reflect" become "Thinking about the Text/Poem/Play".
  - "Let us learn" becomes "Words and Grammar: ...", with the grammar points named from the activities.
  - "Let us listen" and "Let us speak" become "Listening and Speaking: ...".
  - "Let us write" becomes "Writing: <text type>".
  - "Let us do these activities before we read" and "Let us explore" (enrichment) are left out.

## Checks

A node check in the scratch area loaded each file through the repo's own `loadSyllabus` (packages/syllabus/src/syllabus.ts). It also asserted:
- the top-level `source` fields and each book's title, code, edition and contentsUrl;
- each chapter's `book` and `pdf`;
- kebab-case ids, unique within their parent;
- chapter count equal to the Contents count (15 / 14 / 13 / 15);
- 2–4 objectives starting "Student can";
- 1–3 visualIdeas;
- estMinutes from 5 to 40.

Result: ALL CHECKS PASSED.

## Independent verification (2026-10-01)

A second agent re-checked the files against NCERT's own PDFs and changed a few things.

What was checked:
- **Catalogue.** https://ncert.nic.in/textbook.php was fetched again. The six books above are the only English-medium Class 8 entries for these subjects. The old books sit inside a `/* ... */` block. A web search found no newer Class 8 book for 2026-27.
- **Contents and editions.** All 6 prelims PDFs were read again. Every chapter title and its order match the Contents page (15 / 14 / 13 / 15), and the imprint dates match the edition strings.
- **Chapter PDFs.** All 47 chapter URLs exist on ncert.nic.in, and each file's size on the server matches the PDF that was read.
- **Topic titles.** Titles were compared with the large-font headings of all 57 chapters. Section text was read in these chapters:
  - English units 1, 3 and 5 (chapters 1–3, 7–9 and 13–15);
  - Mathematics Part-I chapters 2 and 5 and Part-II chapters 2 and 5;
  - Science chapters 1, 6, 9 and 13;
  - Social Science Part 1 chapters 2 and 6 and Part 2 chapters 2, 4 and 8.
- **Named facts.** Every capitalised name and every number in every objective and visual idea was searched for in its own chapter's text. The only misses were spelling variants, for example the poem prints "Bramha".
- **Old files.** packages/syllabus/data/class8-mathematics.json and class8-science.json were opened. NCERT's own chapter PDFs of the old books confirm they follow `hemh1` (chapter 1 is Rational Numbers) and `hesc1` (chapters 1–3 are Crop Production and Management, Microorganisms: Friend and Foe, and Coal and Petroleum).

What was changed:
- **Social Science, Parliament chapter:**
  - Two topics were renamed to the book's heading "Legislative Functions of the Parliament". Their ids changed with them.
  - "Composition of the Parliament of India" gained an objective on the presiding officers (the Speaker and the Rajya Sabha's chairperson). The book has a large-font section on them (page 143) that no topic covered.
- **Social Science, Marathas chapter:** two visual ideas named places the chapter does not name, the Sahyadris and the Konkan coast. They now say Raigad and India's west coast, which the chapter does name.
- **English:** three wordings now follow the book's activity text.
  - The Magic Brush of Dreams: the visual idea now uses "Phew!" and "Oops!", which the book lists, in place of "Oh!" and "Wow!".
  - Feathered Friend: "word web" became the book's "social media web".
  - Bibha Chowdhuri: the report-format objective now gives the book's own format, a headline, the reporter's name and three paragraphs in the past tense, passive voice and third person.

Still UNVERIFIED:
- Objectives in the chapters not listed above. For those, only named facts and numbers were checked; the objectives were not read against the full section text.
- That Part 2 was "first released in February 2026". This comes from press reports, not from the PDF. The PDF itself says only that it is a revised edition, First Edition June 2026.
