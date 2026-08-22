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
| Live voice doubt | `src/ui/VoiceDoubtSheet.tsx` |
| Chapter topics | `src/screens/Chapter.tsx` |
| Search | `src/screens/Search.tsx` |
| Progress | `src/screens/Progress.tsx` |
| Profile | `src/screens/Profile.tsx` |
| Lesson complete | `src/screens/LessonComplete.tsx` |
| Onboarding (class) | `src/screens/Onboarding.tsx` |
| Diagnostic question | not built yet — needs the Learning Outcome Map |
| Study plan | not built yet — needs the diagnostic engine |
