# Design reference

Screens generated with **Google Stitch** (project *K-12 Student Learning Dashboard*,
design system *Vibrant Scholar*) and implemented in `apps/classroom`.

- `screens/*.png` — the rendered design for each screen
- `html/*.html` — the Tailwind markup Stitch produced

The app's `tailwind.config.js` carries Stitch's tokens verbatim, so a new export
drops in with little translation. Regenerate or add screens through the Stitch
MCP server (`https://stitch.googleapis.com/mcp`, project `8042170736052036778`,
design system `assets/307b8cb966e540a4aa38cb4a29c90ff5`).

| Screen | Implemented in |
|---|---|
| Student dashboard | `src/screens/Home.tsx` |
| Lesson player | `src/screens/ClassRoom.tsx` |
| Live voice doubt | `src/ui/DoubtPanel.tsx` (the side rail inside `ClassRoom.tsx`) |
| Chapter topics | `src/screens/Chapter.tsx` |
| Search | `src/screens/Search.tsx` |
| Progress | `src/screens/Progress.tsx` |
| Profile | `src/screens/Profile.tsx` |
| Lesson complete | `src/screens/LessonComplete.tsx` |
| Practice quiz | `src/screens/PracticeQuiz.tsx` |
| Quiz result | `src/screens/QuizResult.tsx` |
| Onboarding (class) | `src/screens/Onboarding.tsx` |
| Diagnostic question | `src/screens/Diagnostic.tsx` |
| Study plan | `src/screens/StudyPlan.tsx` |

Three of those rows were wrong until 2026-09-14, and not because the design
moved — the code did. *Live voice doubt* pointed at `src/ui/VoiceDoubtSheet.tsx`,
which b4e1a23 (*the classroom is a call now, not a document*) deleted when the
doubt stopped being a sheet over the lesson and became a rail beside it.
*Diagnostic question* and *Study plan* both read *not built yet*; this file was
written in 76fa33b on 2026-08-23, and both screens landed later that day in
5d0d4eb, as did the Learning Outcome Map one of them was waiting on (cfdaed9).
Both are routed — `/diagnostic` and `/plan` in `src/App.tsx`.

Two further rows were missing outright until 2026-09-14 too, and the reason is
again the clock: 76fa33b wrote this file at 01:00 on 2026-08-23, c6b5c99
exported the *Practice quiz* and *Quiz result* designs at 15:49 that day, and
08af394 implemented both at 16:18. The two screens share one route,
`/quiz/:lessonRef`, because a score belongs to a single attempt — a reloadable
result URL would show one for a quiz nobody is still taking.

With those in, `screens/` and `html/` hold 12 designs each against the table's
13 rows. Every design is indexed; the row without one is *Student dashboard*,
whose `src/screens/Home.tsx` has never had a Stitch export in `screens/`.
