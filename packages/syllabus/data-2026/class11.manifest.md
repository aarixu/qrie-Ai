# Class 11 syllabus (staging) - manifest

Built 2026-10-01 from NCERT's own PDFs. Science stream only: Physics, Chemistry, Mathematics, Biology.
I downloaded the prelims (Contents) PDF of all six books and every chapter PDF (56 of 56) from
`https://ncert.nic.in/textbook/pdf/`. Nothing here is read by the app yet. `packages/syllabus/data` is untouched.

## Is there a new 2026-27 book for Class 11?

No. The current books are the rationalised editions (revised 2022-23), reprinted for 2026-27. The evidence:

- **NCERT catalogue.** The live catalogue (`https://ncert.nic.in/textbook.php`, fetched 2026-10-01) lists only these
  English-medium Class 11 science books:
  - Physics Part-I `keph1` (7 chapters) and Physics Part-II `keph2` (7)
  - Chemistry Part-I `kech1` (6) and Chemistry Part II `kech2` (3)
  - Mathematics `kemh1` (14)
  - Biology `kebo1` (19)
- **Prelims PDFs.** Every one of the six says "Reprint 2026-27" on its pages. The imprint pages give these dates:

| Book | First edition | Revised edition | Reprinted |
|---|---|---|---|
| Physics Part I | Feb 2006 | Nov 2022 | Mar 2024, Jun 2024, Dec 2024, Apr 2026 |
| Physics Part II | Apr 2006 | Jan 2023 | Mar 2024, Jun 2024, Jan 2025, Apr 2026 |
| Chemistry Part I | Mar 2006 | Oct 2022 | Mar 2024, Jun 2024, Jan 2025, Feb 2026 |
| Chemistry Part II | Mar 2006 | Oct 2022 | Mar 2024, Jun 2024, Jan 2025, Feb 2026 |
| Mathematics | Feb 2006 | Nov 2022 | Mar 2024, Jun 2024, Jan 2025, Feb 2026 |
| Biology | Feb 2006 | Nov 2022 | Mar 2024, Jun 2024, Aug 2024, Dec 2024, Feb 2026 |

  The Physics Part I and Biology imprint pages are images. I read them from a rendering of the page.
- **Web search.** Secondary sites (mycbseguide, educart and others) say NCERT put off the new NCF-aligned Class 10
  and 11 books to the 2027-28 session. UNVERIFIED: I did not read the NCERT advisory itself on ncert.nic.in.
- **CBSE curriculum 2026-27** (added by the verifier). CBSE's own senior-school curriculum PDFs for 2026-27
  (`https://cbseacademic.nic.in/web_material/CurriculumMain27/SecPart2/`: `Physics_SecP2_2026-27.pdf`,
  `Chemistry_SecP2_2026-27.pdf`, `Maths_SecP2_2026-27.pdf`, `Biology_SecP2_2026-27.pdf`) prescribe exactly these
  books: Physics Part-I and Part-II, Chemistry Part I and Part II (with links to `kech1=0-6` and `kech2=0-3`),
  Mathematics Textbook for Class XI and Biology Class XI, all NCERT.

## Files

| File | Books (code) | Chapters (Contents count) | Topics | Topic time |
|---|---|---|---|---|
| `class11-physics.json` | Physics Part I (`keph1`), Physics Part II (`keph2`) | 14 (7 + 7) | 149 | ~37 h |
| `class11-chemistry.json` | Chemistry Part I (`kech1`), Chemistry Part II (`kech2`) | 9 (6 + 3) | 195 | ~45 h |
| `class11-mathematics.json` | Mathematics (`kemh1`) | 14 | 104 | ~26 h |
| `class11-biology.json` | Biology (`kebo1`) | 19 | 201 | ~39 h |

Every file follows the schema of `packages/syllabus/src/syllabus.ts`, plus these fields:

- top level: `source` (books, codes, editions, contents URLs, `builtAt`, `method`)
- each chapter: `book` and `pdf`

The chapter count of every file equals its books' Contents count. The repo's own `loadSyllabus` accepts all four
files. The checks are in "Validation" below.

## How topics were chosen (all subjects)

- **Chapter titles and order** come from the Contents page. Where the Contents page and the chapter PDF spell a
  title differently, I used the Contents page:
  - Contents "Units and Measurements"; chapter PDF "Units and Measurement"
  - Contents "System of Particles and Rotational Motion"; chapter PDF "Systems of Particles..."
- **Topics** are the chapter's own numbered sections. These sections are not topics:
  - "Introduction" and "General Introduction" sections. The exception is an Introduction that holds a numbered
    subsection: Physics 5.1.1 The Scalar Product and 6.1.1 What kind of motion can a rigid body have?
  - Summary, Points to Ponder and Exercises
- **Long sections** are split at their numbered subsections. A parent heading that is only a short lead-in is not a
  separate topic.
- **Very short adjacent subsections** are joined under one title that names them, for example "Isochoric, Isobaric
  and Cyclic Processes" or "Testis and Ovary". 64 of 649 topic titles are joined or disambiguated like this. All
  other titles occur word for word in the chapter PDF.
- **Sections listed in a chapter's opening box but absent from its body are left out.** Physics chapter 2's box
  lists "2.5 Relative velocity", but the chapter body has no such section, and the Contents page lists only 2.1 to 2.4.
- **Objectives** come from the section text. I ran 763 keyword checks against the chapter text. Most test a
  specific claim in an objective (a named example, method, law or value); the rest test subsection headings. I
  reworded every claim that did not check out. A keyword hit shows the term is in the chapter, not that the
  objective's wording matches it exactly.
- **`visualIdeas` and `estMinutes`** are my own suggestions and estimates, not from the book.

## Physics: no existing file to replace

- Books: Physics Part I (`keph1`, chapters 1-7) and Physics Part II (`keph2`, chapters 8-14). Both are Reprint 2026-27.
- `packages/syllabus/data` has no `class11-physics.json`.
- **Pages that are images.** Several pages of `keph1` have no extractable text:
  - the Contents page for chapters 1 to 4.6 and for 7.7 onward (prelims pages 13 and 15)
  - the opening page of Gravitation, and parts of Gravitation's later pages

  I read these from renderings of the PDF pages (pdf.js in a local browser page). The chapter titles and the 7.x
  section list are confirmed that way. The Contents of Physics Part I is also printed as text in the `keph2`
  prelims ("CONTENTS OF PHYSICS PART I"), which gives the same seven chapter titles.
  - 7.3 Universal Law of Gravitation: the verifier rendered book pages 129-130 (`keph107` PDF pages 3-4). They show
    the law, its vector form F = -G m1 m2 / r^2 r-hat, the vector sum of forces from several point masses (Fig. 7.4)
    and the two spherical-shell results, so the 7.3 objectives are now checked.

## Chemistry: replaces `class11-chemistry.json`

- Books: Chemistry Part I (`kech1`, units 1-6) and Chemistry Part II (`kech2`, units 7-9). Both are Reprint 2026-27.
- **Old file verdict: same book YES, chapter order NO.** The old file has the same 9 units, but it puts Part II
  first. It also renames Unit 5 "Chemical Thermodynamics"; the book calls it "Thermodynamics".

| # | Old file | New file (book order) |
|---|---|---|
| 1 | Redox Reactions | Some Basic Concepts of Chemistry |
| 2 | Organic Chemistry – Some Basic Principles and Techniques | Structure of Atom |
| 3 | Hydrocarbons | Classification of Elements and Periodicity in Properties |

- **Lettered sub-headings.** Units 3 and 5 use lettered sub-headings inside a section, for example 3.7.1 (a) Atomic
  Radius and 5.4 (e) Hess's Law. These are used as topics where the section is long.
- **Garbled text in Units 4 and 8.** Their PDFs use fonts that pdftotext reads with letters missing. I confirmed the
  headings by their numbers. I rendered and read pages 12, 16, 17 and 26 of Unit 4 and pages 5, 15, 16, 29, 30 and
  33-35 of Unit 8. Two objectives were corrected from those pages:
  - the dipole-moment examples are H2O, BeF2, BF3, NH3 and NF3
  - the VSEPR lone-pair examples are SO2, NH3, H2O, SF4, ClF3, BrF5 and XeF4

  The verifier then rendered more pages: Unit 4 book pages 114-116 and 130 (VSEPR Tables 4.6-4.8 and the MO
  configurations of He2, Li2, C2 and O2), and Unit 8 book pages 260-262, 271-278, 281, 283-285 and 287-289 (3-D representation and
  molecular models, classification, functional groups, IUPAC system, fission, nucleophiles and electrophiles,
  inductive, resonance, electromeric and hyperconjugation effects, reaction types, purification, chromatography,
  qualitative analysis, and the Dumas, Kjeldahl and Carius methods). Four Unit 8 objectives and one Unit 4 objective
  were corrected from them (see "Verifier's re-check" below).

  UNVERIFIED: the Unit 4 and Unit 8 objectives on pages nobody rendered rest on the garbled text plus the numbered
  headings. For Unit 4 the verifier also matched the key examples in the garbled text (octet exceptions LiCl, BeH2,
  BCl3, NO, NO2, PF5, SF6, H2SO4; Lewis problems CO and nitrite; Fajans' rules; longer axial bonds in PCl5;
  o-nitrophenol).

## Mathematics: replaces `class11-mathematics.json`

- Book: Mathematics (`kemh1`), Reprint 2026-27.
- **Old file verdict: YES.** Same book, same 14 chapters in the same order.
  - First 3 old: Sets | Relations and Functions | Trigonometric Functions
  - First 3 new: the same
- **Old topics that are not in the current book:**
  - "Power Set". There is no power set in the current Sets chapter.
  - "Random Experiments". The current Probability chapter starts at 14.1 Event.
  - Several "Introduction" topics
- **Section 3.4 is split.** Section 3.4 (Trigonometric Functions of Sum and Difference of Two Angles) has no
  sub-headings and runs about 10 pages, so it is split into two topics:
  - "Trigonometric Functions of Sum and Difference of Two Angles": identities 1-13
  - "Multiple Angle, Sum and Product Formulae": identities 14-22. I named this one from its identities.
- Section 5.3 (Algebraic Solutions of Linear Inequalities...) has no sub-headings and is one 30-minute topic.

## Biology: replaces `class11-biology.json`

- Book: Biology (`kebo1`), Reprint 2026-27.
- **Old file verdict: YES.** Same book, same 19 chapters in the same order.
  - First 3 old: The Living World | Biological Classification | Plant Kingdom
  - First 3 new: the same
- **Old topics that are not in the current book**, which drops these sections:
  - "The Tissues", "Meristematic Tissues" and "Permanent Tissues" in Anatomy of Flowering Plants
  - "Epithelial/Connective/Muscle/Neural Tissue" in Structural Organisation in Animals. That chapter is now Organ
    and Organ System plus Frogs.
  - "Modifications of Leaves"
- **Unnumbered opening text.** Three chapters have substantial opening text before their first numbered section.
  Each is one topic, and I named these titles from the content:

| Chapter | Topic title | Covers |
|---|---|---|
| Biological Classification | "Five Kingdom Classification" | Aristotle, the two-kingdom system and Whittaker's five kingdoms |
| Plant Kingdom | "Systems of Classification" | artificial, natural and phylogenetic systems |
| Excretory Products and their Elimination | "Nitrogenous Wastes and Excretory Structures" | ammonotelism, ureotelism and uricotelism, and protonephridia to kidneys |

- **5.9 Solanaceae.** The chapter's opening box calls 5.9 "Description of Some Important Families", but the body
  describes only Solanaceae under the heading "5.9 Solanaceae". The topic is titled "Description of Some Important
  Families: Solanaceae".

## Validation

I ran a node check from my scratch folder, not the repo, with `node --experimental-strip-types validate.mjs`. It
checks:

- the file passes the repo's `loadSyllabus` from `packages/syllabus/src/syllabus.ts`
- `id`, `klass` and `subject` are right
- every `source.books` entry has a title, code, edition and contents URL, and `source.builtAt` and `source.method`
  are present
- every chapter has an id, title, `book` (one of the source books) and `pdf` (an ncert.nic.in chapter PDF URL)
- every id is the kebab-case slug of its title, and ids are unique within their parent
- each topic has 2-4 objectives, each starting "Student can"
- each topic has 1-3 visualIdeas
- each estMinutes is between 5 and 40
- each chapter count equals the Contents count

Output:

```
class11-physics.json: 14 chapters (Contents: 14), 149 topics, 37 h of topics, books: keph1, keph2
class11-chemistry.json: 9 chapters (Contents: 9), 195 topics, 45 h of topics, books: kech1, kech2
class11-mathematics.json: 14 chapters (Contents: 14), 104 topics, 26 h of topics, books: kemh1
class11-biology.json: 19 chapters (Contents: 19), 201 topics, 39 h of topics, books: kebo1
ALL CHECKS PASSED (including the repo loadSyllabus)
```

A second check matched chapter titles, in order, against each book's Contents text.

- 49 of 56 titles were found in order.
- The other 7 are on Contents pages that are images or have small-capital letters missing in the text:
  - Physics Part I chapters 1-4
  - Physics Part II chapters 8-10

  I confirmed those 7 from the rendered Contents page or from the chapter PDF's title page.

## Verifier's re-check (2026-10-01)

A second agent re-checked these files against freshly downloaded NCERT PDFs: all six prelims PDFs and all 56
chapter PDFs.

- **Books and edition.** The live catalogue lists `keph1=0-7`, `keph2=0-7`, `kech1=0-6`, `kech2=0-3`, `kemh1=0-14` and
  `kebo1=0-19` for Class 11. Every prelims PDF says "Reprint 2026-27", and the imprint dates match the table above.
  CBSE's 2026-27 curriculum prescribes the same books (see the first section).
- **Chapter titles and order.** All 56 match the Contents pages: Chemistry, Mathematics and Biology from the text,
  Physics Part II from its Contents text, and Physics Part I from the copy of its Contents printed in the `keph2`
  prelims.
- **Topics.** Every chapter's numbered headings were pulled from its PDF text and compared with the topic list. Every
  numbered section is a topic or is covered inside one, and no topic comes from outside its chapter. For example,
  Physics 6.6.1 Angular acceleration and Mathematics 4.3.7 Identities are objectives of a neighbouring topic.
  Chemistry Units 5 and 8 print some headings in a font the text extraction drops, so for them this rests on the
  headings that do extract, the Contents page and, for Unit 8, the rendered pages. A section left out on purpose is still
  left out: Physics 2.5 Relative velocity is listed in the chapter's opening box but has no section in the body.
- **Objectives.** The verifier read the objectives of 14 chapters in full against the text: Physics 1, 7, 8, 10, 11,
  12 and 14; Chemistry 1, 4, 8 and 9; Mathematics 3 and 10; Biology 2 and 16. A term check then looked up the specific words
  of every objective in all 56 chapters, and each miss was read in context. Problems found and fixed:

| File | Topic | Was | Now | Why |
|---|---|---|---|---|
| physics | The International System of Units | "the supplementary units radian and steradian" | "the two more units, radian and steradian" | the book does not call them supplementary units |
| physics | Acceleration due to Gravity below and above the Surface of Earth | g "is zero at the centre" | "explain why g is greatest at the earth's surface" | the book says g is greatest at the surface; it does not state the zero at the centre |
| physics | Angular Momentum in Case of Rotation about a Fixed Axis | "a person on a rotating stool" | "a girl on a swivel chair ... an acrobat or a diver" | the book's own demonstration (Fig. 6.32) |
| physics | Mean Free Path | "the mean free path of air molecules" | "of a water molecule in water vapour" | the book's worked example is water vapour |
| chemistry | Physical and Chemical Properties | chemical examples "acidity and combustibility" | "composition, combustibility and reactivity with acids and bases" | the book's own list |
| chemistry | Hybridisation | sp2 example "BF3" | "BCl3" | the book's sp2 example is BCl3 (Fig. 4.11) |
| chemistry | Functional Group and Homologous Series | groups "hydroxyl, aldehyde, ketone and carboxyl" | "hydroxyl (-OH), aldehyde (-CHO) and carboxylic acid (-COOH)" | the book names these three; ketone is not among them |
| chemistry | The IUPAC System of Nomenclature | "word root, prefixes and suffixes" | parent hydrocarbon modified by prefixes and suffixes | the section describes the name this way, with a figure |
| chemistry | Resonance Structure | "benzene and the nitrite ion" | "benzene and nitromethane" | the book's examples (page 275) |
| chemistry | Types of Organic Reactions and Mechanisms | "give an example of each type" | these types are studied in Unit 9 and in Class XII | the section lists the four types and gives no examples |
| mathematics | Trigonometric Functions of Sum and Difference of Two Angles | "the allied-angle identities" | "identities such as" | the book does not use the term |
| biology | Dicotyledonous Root | "how secondary growth begins in dicot roots" | the pericycle starts lateral roots and the vascular cambium, then a cambium ring forms | the book says only this; secondary growth is no longer a section |

Two visual ideas tied to the changed objectives were changed with them (Types of Organic Reactions, The IUPAC System
of Nomenclature). After the fixes, the verifier's own schema check passes. It runs the repo's `loadSyllabus` and
`listTopics`, and checks the same rules as "Validation" above. It also checks that every edition says "Reprint
2026-27", that each chapter PDF is a Class 11 NCERT URL, and that topics have no extra keys:

```
class11-physics.json: 14 chapters (Contents 14), 149 topics, 37.3 h, books keph1+keph2
class11-chemistry.json: 9 chapters (Contents 9), 195 topics, 45.1 h, books kech1+kech2
class11-mathematics.json: 14 chapters (Contents 14), 104 topics, 25.8 h, books kemh1
class11-biology.json: 19 chapters (Contents 19), 201 topics, 39.0 h, books kebo1
ALL CHECKS PASSED (repo loadSyllabus + extra checks)
```

## Still UNVERIFIED

- The NCERT advisory that defers new Class 11 books to 2027-28. Only secondary sources say so. The catalogue, the
  "Reprint 2026-27" prelims and CBSE's 2026-27 curriculum all point to these books.
- The objectives for Chemistry Units 4 and 8 on pages nobody rendered. Their PDF text has letters missing.
- The objectives of the chapters the verifier did not read in full. They passed only the term check, which shows
  that an objective's specific words appear in the chapter, not that the objective's wording is exact.
- All `visualIdeas` and `estMinutes`. These are suggestions, not book content.
