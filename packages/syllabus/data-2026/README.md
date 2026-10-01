# CBSE syllabus 2026-27, staged (not yet promoted)

Built and then independently verified on 2026-10-01 from NCERT's own PDFs (the live
`ncert.nic.in/textbook.php` catalogue and each book's Contents and chapter PDFs). One
`classN.manifest.md` per class records the books, editions, method and what is still
UNVERIFIED for that class.

| Classes | Subjects |
|---|---|
| 6–10 | English, Mathematics, Science, Social Science |
| 11–12 | Physics, Chemistry, Mathematics, Biology (science stream) |

**Not used by the app yet.** Nothing imports this folder; the app still reads
`packages/syllabus/data/`. Promoting it means regenerating the knowledge graph and the
probe bank from these files first, because their topic paths and outcome ids are built from
the syllabus. Until then this is staging, kept in git so it is not lost.

Every file passes `loadSyllabus` from `packages/syllabus/src/syllabus.ts`, and each
manifest's Verification section lists the problems the verifier found and fixed.
