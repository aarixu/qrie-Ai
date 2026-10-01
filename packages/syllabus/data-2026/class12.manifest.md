# Class 12 syllabus (staging) - manifest

Built 2026-10-01 from NCERT's own PDFs: the prelims (Contents) PDF of every book and every chapter PDF, downloaded
from `https://ncert.nic.in/textbook/pdf/`. Scope is the science stream only: Physics, Chemistry, Mathematics and
Biology. Nothing here is read by the app yet; `packages/syllabus/data` is untouched.

## Is there a new 2026-27 book for Class 12?

No new book was found. Evidence:

- The live NCERT catalogue (`https://ncert.nic.in/textbook.php`, fetched 2026-10-01) lists the same Class 12 books:
  Physics Part I `leph1` (8 chapters), Physics Part II `leph2` (6), Chemistry Part I `lech1` (5), Chemistry Part II
  `lech2` (5), Mathematics Part I `lemh1` (6), Mathematics Part II `lemh2` (7) and Biology `lebo1` (13).
- Six of the seven prelims PDFs are footed "Reprint 2026-27". Physics Part II is the exception (see below).
- Web search: secondary sites (millenniumpost.in, thecrossbill.in, careers360) say NCERT put off the new Class 10 and
  Class 11 books to 2027-28 and that the existing books continue in 2026-27. None of them mentions a new Class 12 book.
  UNVERIFIED: I did not find or read an NCERT notice on ncert.nic.in that names Class 12.

## Files

| File | Books (code) | Chapters (Contents count) | Topics |
|---|---|---|---|
| `class12-physics.json` | Physics Part I (`leph1`), Physics Part II (`leph2`) | 14 (8 + 6) | 136 |
| `class12-chemistry.json` | Chemistry Part I (`lech1`), Chemistry Part II (`lech2`) | 10 (5 + 5) | 137 |
| `class12-mathematics.json` | Mathematics Part I (`lemh1`), Mathematics Part II (`lemh2`) | 13 (6 + 7) | 86 |
| `class12-biology.json` | Biology (`lebo1`) | 13 | 129 |

The chapter count of every file equals its books' Contents pages. Chapter order is the Contents order, Part I first.

## Editions (from each book's imprint page)

| Book | Code | Edition |
|---|---|---|
| Physics Part I | `leph1` | Reprint 2026-27. First Edition Dec 2006, Revised Edition Nov 2022, reprinted Feb 2026 |
| Physics Part II | `leph2` | Revised Edition Nov 2022, reprinted Dec 2025. First Edition Mar 2007. See the note below |
| Chemistry Part I | `lech1` | Reprint 2026-27. First Edition Jan 2007, Revised Edition Oct 2022, reprinted Feb 2026 |
| Chemistry Part II | `lech2` | Reprint 2026-27. First Edition Apr 2007, Revised Edition Nov 2022, reprinted Feb 2026 |
| Mathematics Part I | `lemh1` | Reprint 2026-27. First Edition Nov 2006, Revised Edition Oct 2022, reprinted Jan 2026 |
| Mathematics Part II | `lemh2` | Reprint 2026-27 footer. First Edition Jan 2007, Revised Edition Jan 2023. The imprint page lists reprints only up to Dec 2024 |
| Biology | `lebo1` | Reprint 2026-27. First Edition Dec 2006, Revised Edition Nov 2022, reprinted Jan 2026 |

**Physics Part II note:** its prelims PDF has no "Reprint 2026-27" footer. Chapter PDFs 9-13 are footed "Reprint
2026-27", but the chapter 14 PDF (`leph206.pdf`) is footed "Reprint 2025-26". The imprint page's latest reprint is
December 2025. This is still the book NCERT lists for 2026-27; I found no other Physics Part II.

## Per subject

No existing file is replaced: `packages/syllabus/data` has no Class 12 file for any subject (checked with a file
search on 2026-10-01). So there is no old-vs-new chapter comparison for Class 12.

### Physics - 14 chapters, 136 topics

- **Part I:** Electric Charges and Fields; Electrostatic Potential and Capacitance; Current Electricity; Moving Charges
  and Magnetism; Magnetism and Matter; Electromagnetic Induction; Alternating Current; Electromagnetic Waves.
- **Part II:** Ray Optics and Optical Instruments; Wave Optics; Dual Nature of Radiation and Matter; Atoms; Nuclei;
  Semiconductor Electronics: Materials, Devices and Simple Circuits.
- **Topics:** the numbered sections on the Contents page, split into their numbered subsections where those exist and
  are teachable on their own (for example 1.14.1-1.14.3, the three Gauss's law applications).
- **Grouped:** short subsections are kept under their section, for example 1.4 (additivity, conservation and
  quantisation of charge), 5.5 (dia-, para- and ferromagnetism) and 11.3 (Hertz's, Hallwachs' and Lenard's
  observations).
- **Introductions:** "Introduction" sections are not topics. Physics 2.1 is the one introduction that develops a
  concept: the Coulomb force is conservative, so work against it is stored as potential energy. That idea is the
  first objective of the next topic, "Electrostatic Potential".
- **Titles I composed (heading words kept):**
  - "Electromagnetic Spectrum: Radio Waves, Microwaves and Infrared Waves" and "...: Visible, Ultraviolet, X-rays and
    Gamma Rays" split 8.4 at its subsections.
  - "Diffraction: The Single Slit" is 10.6 + 10.6.1.
  - "Nuclear Energy: Fission" is 13.7 + 13.7.1.

### Chemistry - 10 chapters (units), 137 topics

- **Part I:** Solutions; Electrochemistry; Chemical Kinetics; The d- and f-Block Elements; Coordination Compounds.
- **Part II:** Haloalkanes and Haloarenes; Alcohols, Phenols and Ethers; Aldehydes, Ketones and Carboxylic Acids;
  Amines; Biomolecules.
- **Topics:** the numbered sections and subsections of each chapter PDF. Small neighbours are grouped, for example
  4.3.11 + 4.3.12, 4.3.13 + 4.3.14 and 5.4.3-5.4.6.
- **Split by named parts:** long sections with no numbered subsections are split by the parts the section itself
  names, keeping the heading words. Examples:
  - 1.2: "Percentages and Parts per Million" and "Mole Fraction, Molarity and Molality".
  - 6.7.1: nucleophilic substitution; SN2 and SN1; stereochemical aspects; elimination and reaction with metals.
  - 7.4.4, 8.4, 8.9 and 9.6: split by the reaction classes the book lists.
  - 4.4.1: "Potassium Dichromate" and "Potassium Permanganate" are the book's own run-in headings.
- **Not on any Contents page, so not included:** the appendices and the answers.

### Mathematics - 13 chapters, 86 topics

- **Part I:** Relations and Functions; Inverse Trigonometric Functions; Matrices; Determinants; Continuity and
  Differentiability; Application of Derivatives.
- **Part II:** Integrals; Application of Integrals; Differential Equations; Vector Algebra; Three Dimensional
  Geometry; Linear Programming; Probability.
- **Topics:** the numbered sections and subsections. Introduction, Summary and Miscellaneous Examples are not topics.
- **Split by the book's own definitions, theorems or integral types:**
  - 1.2: relation types / equivalence relations.
  - 2.2: sin^-1 and cos^-1 / the other four / principal values.
  - 4.5: adjoint / inverse.
  - 6.4: first and second derivative tests.
  - 7.4: standard forms / quadratic expressions.
  - 8.2: strips / circle, ellipse, parabola and line regions.
- **Not chapters, so not included:** Appendix 1 (Proofs in Mathematics), Appendix 2 (Mathematical Modelling) and the
  Supplementary Material in Part I.
- **Stale cross-reference in the book:** Part I chapter 6 (6.3) says the first derivative test uses the "Mean Value
  Theorem (Theorem 8 in Chapter 5)". The 2026-27 chapter 5 has no Mean Value Theorem: it is neither on the Contents
  page nor in the chapter PDF text. It is not included.

### Biology - 13 chapters, 129 topics

- **Chapters:** Sexual Reproduction in Flowering Plants; Human Reproduction; Reproductive Health; Principles of
  Inheritance and Variation; Molecular Basis of Inheritance; Evolution; Human Health and Disease; Microbes in Human
  Welfare; Biotechnology: Principles and Processes; Biotechnology and its Applications; Organisms and Populations;
  Ecosystem; Biodiversity and Conservation.
- **No section list on the Contents page:** Biology's Contents page lists chapters only, so every topic comes from
  the chapter PDF's headings.
- **The chapter's opening outline and its body headings disagree in two chapters.** I used the body headings:
  - Ch 3: the outline says "3.2 Population Explosion and Birth Control" and "3.4 Sexually Transmitted Diseases". The
    body says "3.2 Population Stabilisation and Birth Control" and "3.4 Sexually Transmitted Infections (STIs)".
  - Ch 4: the outline lists 4.4 Sex Determination, 4.5 Mutation and 4.6 Genetic Disorders. The body has 4.4
    Polygenic Inheritance, 4.5 Pleiotropy, 4.6 Sex Determination, 4.7 Mutation and 4.8 Genetic Disorders.
- **Ch 11:** "Organisms and Populations" has only section 11.1 Populations in this edition. Its topics are 11.1.1-11.1.4
  and the run-in heading "Growth Models".
- **Ch 12:** "Ecosystem" has sections 12.1-12.5 only.
- **Splits at the book's run-in headings:**
  - Ch 1: Structure of microsporangium, Microsporogenesis, Pollen grain, The Megasporangium (Ovule),
    Megasporogenesis, Female gametophyte, Agents of Pollination, Outbreeding Devices, Pollen-pistil Interaction.
  - Ch 9: "Separation and isolation of DNA fragments".
  - Ch 10: "Bt Cotton" and "Pest Resistant Plants".
- **Splits by parts the section names:**
  - 2.3: spermatogenesis / oogenesis.
  - 3.2: natural and barrier methods / IUDs, pills, implants and surgical methods.
  - 6.3: fossils, embryology and anatomy / natural selection in action.
  - 7.1: bacterial and viral / protozoan, helminth and fungal diseases.
  - 11.1.4: predation / competition / parasitism, commensalism and mutualism.
- **Missed by my heading pattern:** 5.6.2 "tRNA - the Adapter Molecule" was missed because the title starts in lower
  case. I found it by hand, and it is included.

## What was and was not checked

- **No PDF failed to download.** All 7 prelims PDFs and all 50 chapter PDFs downloaded on the first try. No chapter
  fell back to a title-only topic.
- **Headings:**
  - Contents pages: read in full for all 7 books.
  - Chapter PDFs: numbered headings were extracted with a pattern match over pdftotext output, in raw and layout
    modes.
  - Run-in headings: found by a second pattern ("Heading :") and by targeted searches.
  - UNVERIFIED: a heading printed only as an image, or split oddly across lines, could still have been missed. A
    verifier should sample the chemistry organic units and the biology chapters.
- **Objectives:**
  - Each one was written from that section's opening text plus keyword searches inside the section.
  - More than 150 specific claims (named reactions, examples, formulae, organisms) were checked by searching the
    chapter text. Claims not found in their section were rewritten or moved: 17 objectives in all, for example
    ITER/chain reaction (Physics 13.7), Curie temperature (5.5.3), Cu+ disproportionation (Chemistry 4.3.7, not 4.3.8),
    mischmetall (4.5.4, not 4.7) and Bohr radius/ionisation energy (Physics 12.4.1, not 12.4).
  - UNVERIFIED: not every objective was read line by line against its section.
- **estMinutes:** my teaching-time estimates (5-30). They are not from NCERT.
- **visualIdeas:** suggestions for the lesson designer. They are not from NCERT.
- **Topic size:** some topics are 25-30 minutes. These are sections the book itself does not subdivide, for example
  Maths 7.10 "Some Properties of Definite Integrals" at 30.

## Validation

Both checks ran on 2026-10-01 against the final files. Neither script is in the repo.

1. **A schema check written for this build.** It checks:
   - all fields are present and ids are kebab-case and unique within their parent
   - the chapter count equals the Contents count (Physics 14, Chemistry 10, Mathematics 13, Biology 13)
   - each topic has 2-4 objectives starting "Student can", 1-3 visualIdeas and estMinutes from 5 to 40
   - each chapter's `book` is in `source.books`, and each `pdf` URL has the expected NCERT shape and book code

   Result: ALL CHECKS PASSED.
2. **The repo's own `loadSyllabus`, `listTopics` and `getTopic`** (`packages/syllabus/src/syllabus.ts`, transpiled in
   memory with the repo's TypeScript). Result: all four files load, and all 488 topic paths can be reached.

## Independent verification (2026-10-01)

A second agent re-downloaded the sources from ncert.nic.in on 2026-10-01 and re-checked the files against them. It did
not reuse the builder's text extracts.

- **Downloaded:** all 7 prelims PDFs, the live catalogue page, and 22 chapter PDFs:
  - Physics 2, 5, 8, 9, 12 and 14
  - Chemistry 2, 4, 6, 8 and 9
  - Mathematics 3, 6, 7, 10 and 13
  - Biology 1, 3, 4, 7, 11 and 12
- **Chapter titles and order:** all 50 match the Contents pages.
- **Catalogue:** the live catalogue lists the same 7 codes and chapter ranges: `leph1=0-8`, `leph2=0-6`, `lech1=0-5`,
  `lech2=0-5`, `lemh1=0-6`, `lemh2=0-7` and `lebo1=0-13`.
- **Editions:** the imprint lines in the table above match the prelims PDFs. The Physics Part II exceptions were
  confirmed: its prelims PDF has no reprint footer, and `leph206.pdf` is footed "Reprint 2025-26". Every other sampled
  chapter PDF is footed "Reprint 2026-27".
- **New books:** web search found secondary sites (ncertbooks.org, mycbseguide.com, thecrossbill.in). They say the new
  Class 10 and 11 books start in 2027-28 and that Classes 10-12 keep the existing books in 2026-27. Still UNVERIFIED:
  no NCERT notice that names Class 12 was read.
- **Topics:** in the 22 sampled chapters, each numbered heading (other than Introduction) is covered by a topic. Each
  topic comes from a numbered or run-in heading, or from part of one in the composed titles listed above. There was one
  exception: Chemistry 6.8.6 (DDT) had no topic. It is now covered under "Polyhalogen Compounds" (fix 4 below).
- **Part I Supplementary Material:** checked in `lemh1an.pdf`. It is a proof of the derivatives of e^x and log x, to
  be read with Theorem 5 in Chapter 5. It is not a chapter, so leaving it out is correct.
- **Objectives fixed:** the verifier ran more than 150 searches of the sampled chapters' text for the named facts in
  their objectives (reactions, examples, organisms, laws). For each fact it checked that the fact appears in the
  topic's own section. Objectives that are only formulas were not all checked, because pdftotext garbles formulas. Eight
  objectives did not match their section and were fixed in place:
  1. Physics "Electron Orbits": section 12.2.2 does not argue that the Rutherford atom is unstable; that argument
     opens 12.4. The objective was moved to "Bohr Model of the Hydrogen Atom".
  2. Physics "Refraction at a Spherical Surface": "a glass sphere" became "a single spherical glass surface", the
     setup of Example 9.5.
  3. Chemistry "Corrosion": the word "galvanising" is not in 2.8. The objective now lists the methods 2.8 names:
     paint, chemicals such as bisphenol, covering with Sn or Zn, and a sacrificial electrode of Mg or Zn.
  4. Chemistry "Polyhalogen Compounds": added an objective for DDT (6.8.6).
  5. Mathematics "Maxima and Minima: Second Derivative Test": added the applied problems of Examples 22-26, which are
     in 6.4.
  6. Mathematics "Maximum and Minimum Values of a Function in a Closed Interval": "maximum area or minimum cost" became
     the nearest-distance problem of Example 29. That is the only applied example in 6.4.1, and 6.4.1 has no cost
     problem.
  7. Mathematics "Integration by Parts": "x^2 e^x", which is an exercise, became "x e^x", which is Example 19.
  8. Biology "Incomplete Dominance": the starch-grain example is at the end of 4.2.2.2, so it moved to
     "Co-dominance". "Incomplete Dominance" now states the enzyme explanation printed in 4.2.2.1.
- **Counts:** unchanged at 50 chapters and 488 topics.
- **Checks after the fixes:**
  - The verifier's own schema and Contents check covers fields, kebab-case ids equal to the title slugs, unique ids,
    chapter titles equal to the Contents, the book-to-code mapping, PDF URLs, 2-4 "Student can" objectives,
    1-3 visualIdeas and estMinutes from 5 to 40. Result: ALL CHECKS PASSED.
  - The repo's `loadSyllabus`, `listTopics` and `getTopic`: all four files load, and all 488 paths can be reached.
- **Still UNVERIFIED:** the verifier did not re-read the objectives of the 28 chapters it did not sample:
  - Physics 1, 3, 4, 6, 7, 10, 11 and 13
  - Chemistry 1, 3, 5, 7 and 10
  - Mathematics 1, 2, 4, 5, 8, 9, 11 and 12
  - Biology 2, 5, 6, 8, 9, 10 and 13
