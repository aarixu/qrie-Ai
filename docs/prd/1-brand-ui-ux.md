# 1. Brand, UI and UX

This is everything a student sees. The mark on the home screen, the three seconds of splash, the onboarding that decides what a workspace is and which language the tutor speaks, the catalogue they browse, the dark room where a class actually happens, the board they stare at for fourteen minutes, the penguin who narrates it, the consent screen a parent meets before a minor is modelled, the page a grown-up reads to find out what happened, and the empty screens they meet on day one before any of it has data. It also owns the one design system underneath all of that: a token palette, a type stack, an icon set, four content states and the component layer that does not exist yet. Every word of that chrome is English. The tutor's own voice is Hinglish or English, chosen per student, and that fork is decided by one question in onboarding and rendered by PRD 4. The area's job in MVP-1 is not to be pretty. It is to stop the product looking like three products, to stop it telling children things that are not true, to make the board readable by somebody who cannot see it, and to steer every topic ask toward a class that already exists rather than one we pay to prepare.

## Where it stands today

### What ships

A real design system exists, and it is better than the brand sitting on top of it.

- **Token palette.** `apps/classroom/src/theme.css:21-129` carries 47 Material-3 role names as RGB triplets in `:root`; `.dark` opens at `:89` and redefines 35 of them. Triplets, not hex, so Tailwind alpha modifiers compose. The twelve roles `.dark` leaves at their light values are the whole of defect (a) in requirement 3. `apps/classroom/tailwind.config.js:16-67` maps every semantic colour onto them. Dark mode is two blocks and zero markup changes.
- **No white flash.** A pre-paint inline script in `apps/classroom/index.html:23-37` reads `ai-tutor:preferences` and sets `.dark` plus the `theme-color` meta before React loads. Deliberately duplicates `src/lib/theme.ts` because the module graph has not loaded.
- **Self-hosted type with a Devanagari answer.** `apps/classroom/src/fonts.ts:27-38` imports Quicksand/Lexend/Caveat plus Baloo 2 and Mukta Devanagari subsets, both from Ek Type. `tailwind.config.js:111-120` puts the Devanagari face second in each stack, so the browser resolves per glyph and a Hinglish line does not change weight mid-sentence. No Google Fonts CDN.
- **One icon component.** `apps/classroom/src/ui/Icon.tsx:169`, Lucide, tree-shaken, 75 glyphs, Material spellings preserved at call sites, `data-icon` kept in the DOM for tests, a bullet fallback instead of a throw.
- **Four shared content states.** `apps/classroom/src/ui/States.tsx` exports `Skeleton` (`:27`), `SkeletonList` (`:44`, one `aria-busy` region not six), `ErrorState` (`:74`, asks the connection first, always offers retry), `OfflineNotice` (`:125`), `InlineError` (`:149`), `AsyncSection` (`:190`). Imported by nine screens.
- **One page frame.** `apps/classroom/src/ui/Screen.tsx:11` plus `EmptyState` at `:68`; `apps/classroom/src/ui/Nav.tsx:16` holds one `TABS` list rendered as both a mobile bottom bar and a desktop rail, so a tab cannot exist on one and not the other.
- **The classroom as a call, not a document.** `apps/classroom/src/screens/ClassRoom.tsx` (1,287 lines): beat hairline, REC badge, m:ss clock, round Meet-style controls, a toolbar that fades, captions over the board at `:1044-1051`, answer chips, a hot-mic pill, a PiP tutor tile on phones and a rail on wide screens.
- **The avatar and its lipsync.** `apps/classroom/src/avatar/CartoonAvatar.tsx` drives beak shape from text and beak opening from loudness, riding the audio element's own `currentTime` so a stalled network pauses the mouth. One rAF loop poking SVG attributes through refs.
- **The board camera.** `packages/stage/src/frame.ts` computes a frame per beat because fitting a 1000-unit board into a 390px phone renders 14.5px text at 5.7px. `MAX_ZOOM` 3, a minW floor from real pixel width, `toAspect()` so the frame arrives pre-shaped instead of letterboxing.
- **The board layout engine.** `packages/board-layout/src/collide.ts:3-25` is the strongest piece of UX engineering in this area and the architecture docs name the package without ever describing what it does (`ARCHITECTURE.md:105`, "decides where"; a node in the package graph in `docs/architecture/README.md`): nothing on the board sits on anything else, every free-floating label nudged until clear, deterministic, bounded, pure, with a shrink-the-label fallback. 14 test files. It runs in prep, not in the app.
- **Onboarding as five one-question steps.** `apps/classroom/src/screens/Onboarding.tsx:20` (`STEPS = name, class, subjects, when, ready`), subjects offered only where a syllabus exists (`:45`, `subjectsAvailable(klass)`), profile written at `:64`.
- **A real service worker.** `content/sw.js` with a cache-name bump for the stale-index bug (`CACHE = 'ai-tutor-v2'`, `:14`) and `skipWaiting` deliberately kept out of `install` (`:18` says so), reachable only behind an explicit `take-over` message (`:26`), so a deploy cannot swap the app out mid-class. Registered in `apps/classroom/src/main.tsx:39` under `PROD && !isNative()`.

### What is half-built

- **Brand identity stops at the colour file.** Two unrelated marks ship: an atom (`apps/classroom/src/ui/Logo.tsx:19`, named for Marie Curie) and a penguin (`apps/classroom/src/avatar/CartoonAvatar.tsx`, drawn in navy/red/teal, none of it in the palette). No lockup rules, no clear space, no tone of voice, no store assets. *Finish by:* pick one mark, and if it is the penguin, redraw him in Riso inks and regenerate every derived asset from him.
- **The Google Stitch indigo is still shipping underneath the cream.** `shadow-soft-indigo` and `-lg` are defined at `apps/classroom/src/index.css:72` and `:75` as `rgba(99,102,241,…)` and used at 25 call sites across 12 files. `apps/classroom/src/ui/Nav.tsx:28` and `apps/classroom/src/screens/LessonComplete.tsx:83` hardcode the same rgba inline. `apps/classroom/src/screens/Home.tsx:119` does too and `:123` draws the hero dot pattern in a literal `#494bd6`. `tailwind.config.js:1-8` still claims Stitch is the source of truth, and `docs/design/README.md:9-12` tells the next person to re-import it.
- **Notes and Bookmarks can never hold data.** `apps/classroom/src/stores/notes.ts:36` (`addNote`) is called only from `apps/classroom/tests/notes.test.ts`. `apps/classroom/src/stores/bookmarks.ts:20` (`toggleBookmark`) has exactly one product caller, `apps/classroom/src/screens/Bookmarks.tsx:111`, and that call removes. Two of the eight Profile rows (`Profile.tsx:89-103`) lead to screens that can only render an empty state. *Finish by:* a note control in the ClassRoom toolbar, the beat id being already in scope; and deleting Bookmarks entirely (requirement 15).
- **The `?beat=` deep link is write-only.** `apps/classroom/src/screens/Notes.tsx:224` writes `/lesson/${id}?beat=${beatId}`. ClassRoom has no `useSearchParams` and no reference to `beat`.
- **The splash animation describes a screen that does not exist.** `apps/classroom/src/index.css:119-134` declares `.splash-rise` and `.splash-settle` with a documented two-beat choreography about the penguin rising and the wordmark following. Neither class is applied anywhere. `apps/classroom/src/screens/Splash.tsx` renders the atom `Wordmark` with no animation classes.
- **Reduce-motion half-works.** The CSS attribute override at `apps/classroom/src/index.css:59-66` covers every keyframe. Three JS-driven motions read only `matchMedia` and ignore the app's own switch: the board camera, `apps/classroom/src/ui/StreakFlame.tsx`, and the entire avatar rig, which has no reduced-motion check at all and runs its rAF loop continuously in ClassRoom, Onboarding and SignIn. *Finish by:* one `prefersLessMotion()` that ORs `matchMedia` with `document.documentElement.dataset.reducedMotion`.
- **No component layer under the token layer.** `border-b-4 border-on-primary-fixed-variant` is spelled out 24 times across 20 files. `apps/classroom/src/ui/` contains AskBox, DoubtPanel, ErrorBoundary, Icon, Logo, MicRationale, Nav, ReportSheet, Screen, States, StreakFlame, TutorTile and nothing else. Two screens have independently written the missing abstraction down in a comment: `Onboarding.tsx:77-79` ("The one primary-action recipe, verbatim from the rest of the app") and `Settings.tsx:66-68` ("There is no Switch in the design system yet"). Both modals declare `role="dialog" aria-modal="true"` (`MicRationale.tsx:33-34`, `ReportSheet.tsx:61-62`) with no focus trap, no Escape handler and no focus restore.
- **The tutor's name bypasses its own source of truth.** `packages/persona/src/traits.ts:59` defines `name: 'Meera'` and `apps/classroom/src/ui/TutorTile.tsx:1` imports `TUTOR`. Five files then hardcode the literal "Meera" in user-visible copy anyway, at nine sites: `ClassRoom.tsx:957`, `:967`, `:1072`, `:1117`, `LiveClass.tsx:556`, `AskBox.tsx:107`, `DoubtPanel.tsx:50`, `MicRationale.tsx:35` and `:44`. (Twenty-one occurrences across ten files in all; the other twelve are comments plus the definition in `traits.ts` itself, and are not a rename hazard.) `apps/classroom/src/brand.ts:9-10` says of the product name that finding the literal in a component is a bug; the same rule was never applied to the tutor.
- **Raw hexes outside the palette on the two most-seen surfaces.** `apps/classroom/src/ui/TutorTile.tsx:50` (`from-[#3a332a] to-[#1c1915]`) and `:57` (`text-[#5c3a10] bg-[radial-gradient(...,#ffd9a8,#f2a65a)]`) sit on screen for the whole class, and the disc they paint is drawn underneath `CartoonAvatar` and never seen. `apps/classroom/src/ui/StreakFlame.tsx:60` uses a raw `text-[#f97316]`.
- **Tokens that are not tokens.** `tailwind.config.js:95-100` (radius), `:101-110` (spacing), `:111-120` (font family) and `:121-130` (font size) are literal values, and 13 stage colours at `:81-93` are raw hex. The app draws at 10/14/16/20/24px through exactly 50 arbitrary-value radius classes. Motion is worse: eight distinct ad hoc millisecond literals (80, 160, 250, 300, 320, 400, 600, 700) sit in `apps/classroom/src`, alongside three keyframe durations in seconds (1.1s, 1.5s, 1.6s) and Tailwind's own `duration-200`/`-300`/`-500`, with no named scale and no easing tokens.
- **Android brand assets exist and are the wrong brand.** `capacitor-assets` is wired (`apps/classroom/package.json`, `cap:assets`) and `apps/classroom/assets/` holds icon-foreground, icon-background, icon-only, splash and splash-dark. All indigo. Regenerating is one command once the source art changes.

### What is missing

- **The Riso Pop identity is generated and applied nowhere.** `docs/brand/riso-pop.theme.css` (114 lines, `:root` plus `.dark`, all 47 roles) and `docs/brand/riso-pop.tints.css` (12 subject-tint classes, same class names as today so no screen needs rewriting) exist and pass AA by construction. `docs/brand/build-theme.mjs` measures all 39 rendered pairs before it writes — 33 text pairs at 4.5:1 and six non-text ones (the two outlines, the four subject rings) at 3:1 — and refuses to emit on a failure. Nothing imports either file, and there is no `brand:theme` script in any `package.json`. The `--key: 2.5px` keyline token the brand depends on is **not emitted**: `build-theme.mjs` states law 3 in its header (`:23-26`) but no `--key` custom property appears in either generated file; it exists only in `docs/brand/riso-pop-system.html:36`.
- **Brand-correct install identity.** `content/icon.svg:5` is a `#4648d4` rect. `content/manifest.webmanifest` declares `background_color` and `theme_color` as `#f7f9fb` while `apps/classroom/index.html:6` declares `#fdf6ea`. `apps/classroom/android/app/src/main/res/values/styles.xml:7-9` sets `colorPrimary`, `colorPrimaryDark` and `colorAccent` to `@color/…` resources the app module never defines — there is no `colors.xml` anywhere under `app/src/main/res` — so all three resolve to Capacitor's own library defaults (`#3F51B5`, Material Indigo 500). `apps/classroom/capacitor.config.ts:62` sets the notification `iconColor` to `#494BD6`. A student installs an indigo app, opens a cool-white splash, then lands in a warm cream app, and the mark on their home screen is not the character who teaches them.
- **Safe-area insets.** `env(safe-area-inset-*)` appears in exactly one place in the entire codebase, `apps/classroom/src/screens/ClassRoom.tsx:1204`, while `index.html:5` sets `viewport-fit=cover`. `android/variables.gradle` is `targetSdkVersion = 36` with `minSdkVersion = 24`, and `MainActivity.java` is a bare `BridgeActivity`. Every sticky header and the five-tab bottom nav draw under system chrome.
- **A truthful Help screen.** `apps/classroom/src/screens/Help.tsx:99-104` tells children "Every class here was taught live once, to real students, and recorded". There are zero real students and classes are LLM-prepared by `packages/class-prep`. `Help.tsx:24` repeats it ("a live tutor takes over"). `Help.tsx:40` says a report is "saved on your phone... Nothing is sent anywhere without you pressing send", and `ReportSheet.tsx:74` confirms there is no send at all.
- **A board a blind student can read.** `packages/stage/src/Scene.tsx:1278-1279` is one `role="img"` with `aria-label={lesson.title}`. Every element inside it, including the per-image `aria-label` at `:538`, is hidden from assistive technology by that role. The caption at `ClassRoom.tsx:1044-1051` is a plain `<p>` with `truncate` and no `aria-live`. A blind student gets a title and one clipped line for a whole class.
- **Every door except the one already open, and every screen a grown-up reads.** `ls apps/classroom/src/screens/` returns 27 files and none of them is a consent gate, a parent view, a guardian view or a payment screen. The contest form is the site's and is not missing from this repo by accident. What is missing here is the rest: no screen asks a self-serve minor for a parent's consent before modelling them, and there is no `/app/grown-up` and no design for `/card/:token`, which are the only two surfaces a parent ever sees. The diagnostic engine that Test 1 needs is built (`apps/classroom/src/screens/Diagnostic.tsx` over `@ai-tutor/diagnostic`); the handoff that feeds it is not.
- **Any school-shaped onboarding.** `Onboarding.tsx` has one path: type a name, pick a class, pick subjects. There is no roster pick, no org branch, no no-email path for minors.
- **The tutor-language choice, and nothing that reads it.** The English chrome is now the decision rather than the gap: 100% of buttons, headings, empty states and error copy are English and stay English. What is missing is the other half of the decision. Classes are narrated in Hinglish, the product bundles six Devanagari font files for it, and nothing anywhere asks a student which language they want to be taught in. `Onboarding.tsx:20` is `['name', 'class', 'subjects', 'when', 'ready']` with no language step, the profile written at `:64` carries no `tutorLanguage`, and no screen reads one. `<html lang="en">` in `index.html` and the manifest's missing `lang` are both correct for the chrome and say nothing about the ear. The brand book already assumes a split it never names: `docs/brand/riso-pop-system.html:348` sets the *display* specimen in Hinglish ("Heart ke do side hain") and `:353` sets the body specimen in Hinglish too. The first is superseded, because display type carries headings; the second is right, because body type carries captions.
- **Board type.** `packages/stage/src/Scene.tsx:75` asks for `'Quicksand'` and `:78` for `'Caveat'`. The bundle registers those families as `Quicksand Variable` and `Caveat Variable` (`tailwind.config.js:112` lists the Variable name first, which is why the app chrome resolves and the board does not). Every title, label, chart and handwritten line on the board falls through to `Segoe UI` / system-ui, and `FONT_HAND` carries no Devanagari fallback at all.
- **WCAG AA on tokens used systematically.** `theme.css:37` and `:39` give `--c-secondary-container` and `--c-secondary-fixed` the identical triplet `250 224 165`, and the `.dark` block redefines the container at `:99` but not the fixed. So the streak chip is broken in both themes in opposite ways: at `QuizResult.tsx:166-170` and `PracticeQuiz.tsx:257-259` the flame icon is invisible in light (1.00:1) and the text is invisible in dark (1.00:1). Separately, `text-outline` on cream is 3.99:1 and carries every 12px uppercase section heading, and `text-outline-variant` on a white card is 1.55:1 and carries the chevrons that tell a student a Settings row is tappable.
- **A `lock` glyph.** `Achievements.tsx:80` renders `name={item.earned ? 'check_circle' : 'lock'}`; `Icon.tsx` has no `lock` entry, so every unearned achievement draws a bullet. The guard written to prevent this, `apps/classroom/tests/icon.test.tsx:42`, uses a lazy `[^}]*?` and captures only the first quoted string in a ternary, so it finds `check_circle` and never sees `lock`. The guard is believed working and is not.
- **A class filter on Home.** `apps/classroom/src/screens/Home.tsx:83` is `Array.from(new Set(SYLLABI.map((s) => s.subject)))` with no class filter, and `:85` sums chapters across every class. The comment directly above says "Subjects the student picked, else everything the syllabus offers"; the code does neither. `Syllabus.tsx` fixed exactly this bug — `klassOf` at `:65` and the class-and-subject filter at `:69-74` — and documents it in the header comment at `:14-25`; Home was never brought along. There is no Class 11 Physics syllabus to offer: the thirteen files in `packages/syllabus/data` are Science and Mathematics for classes 6-10 plus Class 11 Biology, Chemistry and Mathematics, so what a Class 9 student is actually offered is Class 11 Biology and Chemistry.
- **A Home skeleton.** Home imports `OfflineNotice` from States but nothing else. It renders placeholder copy ("Science", "Start your first class") while the catalogue is in flight, so a returning student briefly sees the wrong lesson name.
- **Store and install assets, a legal surface, and a parent view.** No Play listing screenshots, feature graphic, descriptions or privacy policy URL; no PWA shortcuts, categories, id or screenshots; no `beforeinstallprompt`. No About, Privacy or Terms screen, and no named conformance target to put on any of them. `capacitor.config.ts` already reserves `in.co.curie.parent` and ReportSheet tells a child to show it to a parent, which is the only parent-facing mechanism in the product today and is not one.
- **An empty-state and illustration system.** Every empty state is the same 64px grey circle with a Lucide glyph (`Screen.tsx:68-88`). Ten screens render it today: Achievements, Bookmarks, Chapter, Diagnostic, DoubtHistory, Notes, PracticeQuiz, Search, StreakDetail and Syllabus. Nine after requirement 15 deletes Bookmarks.
- **Any appearance testing.** No Storybook, no snapshot or screenshot tests. `apps/classroom/tests` is 60 files and 11,690 lines, almost all logic. The two invisible-icon bugs and the wrong board font all shipped past it.
- **A legacy-WebView floor.** A module-only bundle with no `nomodule`, no `noscript` and no browserslist against `minSdk 24`. An old WebView renders a silent white screen.

## What we are building

### 1. One mark, one palette, one name

**What.** Pick a single identity mark and delete the other's claim on it. Redraw whichever mark wins in the six Riso inks, and derive every downstream asset from that one file: `apps/classroom/src/ui/Logo.tsx`, `content/icon.svg`, `content/icon-maskable.svg`, `content/icon-192.png`, `content/icon-512.png`, `content/icon-maskable-512.png`, the five PNGs in `apps/classroom/assets/`, and the `Splash.tsx` wordmark. In the same pass, route the tutor's name through `TUTOR.name` from `@ai-tutor/persona` at all nine user-visible literal sites, so renaming her is one line the way renaming the product already is.

**Why.** The first three seconds of the product are currently a different product. This is the cheapest defect on the board and the most damaging one to ship in front of a school principal or a contest parent.

**MVP.** 1.

**Done when.** `grep -ri '4648d4\|494bd6\|f7f9fb\|99, *102, *241' apps content` returns zero hits outside `node_modules`. `grep -rn "'Meera'\|\"Meera\"\|>Meera" apps/classroom/src --include=*.tsx` returns zero hits in JSX text. One mark appears in the icon, the splash, the header and the store listing.

### 2. Riso Pop token swap, with the contrast gate in CI

**What.** Replace the body of `apps/classroom/src/theme.css` with `docs/brand/riso-pop.theme.css` and the tint block in `apps/classroom/src/index.css:20-33` with `docs/brand/riso-pop.tints.css`. Move `docs/brand/build-theme.mjs` into the build as `npm run brand:theme`, contribute it as one step to `ci.yml` so a token edit that breaks AA fails the build, and add the missing `--key: 2.5px` token plus a `.keyline` utility that every yellow fill must carry. `ci.yml` as a whole is PRD 6's file; this is a step in it, and it is a bare `node` script over 39 arithmetic pairs, so its runtime cost is a second on an already-checked-out runner and no install. Delete `.shadow-soft-indigo` and `-lg` and replace their 25 call sites with a Riso-appropriate elevation (a flat offset keyline, not a blur). Rewrite the stale header at `tailwind.config.js:1-8` and delete `docs/design/README.md`'s instruction to re-import Stitch.

**Why.** The palette is generated, verified and unused, and the file that claims to be the source of truth points at the palette we are removing. The contrast gate is what makes law 1 and law 3 enforceable rather than aspirational.

**MVP.** 1.

**Done when.** `npm run brand:theme` runs in CI and fails on a deliberately broken ink. Zero `rgba(99,102,241` in `apps/classroom/src`. A visual pass over all 27 screens in both rooms shows no yellow without a keyline.

### 3. Fix the tokens that are measurably invisible

**What.** Three specific defects, all two-line fixes, all caught by requirement 2's gate once the gate exists. (a) `--c-secondary-fixed` and friends must be redefined in `.dark`, or the streak chip must stop using `-fixed` roles: `QuizResult.tsx:166-170` and `PracticeQuiz.tsx:257-259`. (b) `--c-outline` must clear 4.5:1 on the ground, because it carries every uppercase section heading, and `--c-outline-variant` must clear 3:1 as a non-text affordance, because it carries the Settings chevrons. (c) Add a `lock` glyph to `Icon.tsx` and fix the greedy/lazy bug at `apps/classroom/tests/icon.test.tsx:42` so the ternary's second branch is seen.

**Why.** The streak chip is the two celebration moments the product leans on for retention and it is invisible in both themes. The guard that was supposed to catch (c) is believed working and is not, so the next ternary icon ships broken too.

**MVP.** 1.

**Done when.** `icon.test.tsx` fails when `lock` is removed from the map. The contrast script asserts the streak pair and the two outline pairs explicitly.

### 4. Type system: Archivo, Anek Latin, JetBrains Mono, including the board

**What.** Replace the Quicksand/Lexend/Caveat imports in `apps/classroom/src/fonts.ts:28-38` with self-hosted Archivo (display, wdth 125), Anek Latin (body) and JetBrains Mono (data), keeping the per-glyph Devanagari fallback pattern with Anek Devanagari. Update `tailwind.config.js:111-120` using the exact registered family names, and fix `packages/stage/src/Scene.tsx:75` and `:78`, which ask for names that are never loaded, so the board wears the type system instead of Roboto. Add a Devanagari face to `FONT_HAND`.

**Why.** The board is what a student looks at for the entire class, and it is the one surface not wearing the brand. The Devanagari gap on the board is the exact failure `fonts.ts` was written to prevent, reappearing on the most-seen surface. It is also what makes the language decision cheap: Anek Latin carries the English chrome and Anek Devanagari carries the tutor's captions when the ear is Hinglish, at the same optical weight, so the two layers can differ in language without differing in look.

**MVP.** 1.

**Done when.** A test asserts that every family name in `tailwind.config.js` and in `Scene.tsx` matches a family registered by an imported `@fontsource` package. A Hinglish board line with Devanagari renders in Anek, not the OS default.

### 5. Install identity and the safe-area floor

**What.** Regenerate `content/icon*.svg|png` and `apps/classroom/assets/*.png` from the requirement 1 mark, re-run `npm run cap:assets`, and align `content/manifest.webmanifest` `background_color`/`theme_color` with `index.html:6` and with the paint the pre-paint script sets. Add `lang`, `id`, `categories`, `shortcuts` and screenshots to the manifest. Override `colorPrimary`/`colorPrimaryDark` in `android/app/src/main/res/values/styles.xml` and fix `capacitor.config.ts:62`. Separately, add inset tokens to `tailwind.config.js` (`spacing: { 'safe-t': 'env(safe-area-inset-top)', 'safe-b': 'env(safe-area-inset-bottom)' }`) and apply them in `Screen.tsx` (sticky header), `Nav.tsx:28` (bottom bar), `Home.tsx` header, the QuizResult action bar and the PracticeQuiz Check button.

**Why.** MVP-1 is web only, and an installed PWA on Android Chrome already honours `viewport-fit=cover`, so the inset work pays off before the Android app exists. It becomes mandatory at MVP-3: `targetSdkVersion = 36` means Android 15 enforces edge-to-edge and Android 16 removes the opt-out, and the five primary tabs land under the gesture pill.

**MVP.** 1 (web and PWA), with the native window-inset handling in `MainActivity` and the `@capacitor/status-bar` and `@capacitor/keyboard` plugins in MVP-3.

**Done when.** `env(safe-area-inset` appears in `Screen.tsx`, `Nav.tsx` and `Home.tsx`. The installed PWA's splash colour matches the app's first painted background in both rooms.

### 6. The copy pass: true, and in English

**What.** One pass over every user-visible string in the chrome, doing two things at once because they touch the same lines.

*True.* Rewrite `Help.tsx:99-104` and the FAQ entries at `:24` and `:40` to describe what `packages/class-prep` actually does: classes are prepared by the tutor herself, from the syllabus, and kept so the next student gets them instantly; the tutor who answers a raised hand is the same tutor, not a person. Add a `HowClassesAreMade` section that says so in one sentence a parent can repeat. Audit every other product claim in the chrome against the code in the same pass, including `content/manifest.webmanifest`'s description ("Recorded classes with a live AI tutor one raised hand away") and `BRAND.tagline`.

*English.* Every button, label, heading, error, empty state, onboarding step, settings row and legal line is English, always, in one register: short sentences, no exclamation marks, nothing that talks down to a fourteen-year-old. This is the chrome only. It says nothing about the tutor, whose narration, captions, judge replies and doubt answers are Hinglish or English per student (requirement 12). The two layers are allowed to differ, and the type system in requirement 4 is what lets them differ without looking like two products. The Hinglish display specimen at `docs/brand/riso-pop-system.html:348` is superseded and is redrawn in English; the Hinglish body specimen at `:353` stays, relabelled as what it actually demonstrates, which is a caption.

**Why.** The truth half is consumer-facing copy aimed at minors making a specific, false, factual claim about provenance. It is a Play Store misrepresentation risk, the sentence a journalist would quote, and precisely the kind of thing a school principal who has agreed to a free pilot in writing will read. The English half is the same argument from the other side: English UI is what a parent and a school actually read the product in, and it is what they judge it on. Speaking Hinglish to each other does not mean the product should be written in it.

**MVP.** 1.

**Done when.** A copy test asserts that no user-visible string in `apps/classroom/src` contains "real students", "taught live", "recorded" or "live tutor". The same test asserts the chrome is English, by failing on a Devanagari codepoint or a known Hinglish token in any string outside the tutor's own narration path. Aarav has read the replacement paragraph out loud.

### 7. A report that reaches a person

**What.** The UI half of safety defect 4, and this PRD owns all of it: the sheet, its state vocabulary and its words. Keep `ReportSheet`'s local copy, and add a real send: a `POST /api/report` carrying `ReportSubmission` (see Contracts, which is the agreed shape across all six documents), a pending/sent/failed state on the sheet using the existing `States.tsx` vocabulary, an offline queue that retries, and a visible contact line with a real address on Help and in the sheet's confirmation. Change `Help.tsx:40` to describe what actually happens. In the same pass fix the quieter defect underneath: `REASONS` at `:29-34` carries an `id` per reason and the sheet never uses it, storing `r.label` instead (`:107-110`), so what would reach the relay today is a display string in English prose rather than a machine-readable kind. The wire carries the id; the label stays on screen.

**Why.** Google Play's generative-AI policy requires user reports to reach the developer. Right now the only thing `ReportSheet`'s `send` does (`:47-56`) is `recordFlag()` into `stores/flags`, which is localStorage via `localStore`; there is no network call anywhere in the file. The button is labelled "Send report" (`:138`) and the confirmation that follows it says the opposite, "Nothing was sent anywhere without you" (`:74-75`), so the child is told both things and neither is a report that reaches anyone. A repo-wide grep for `mailto:`, `support@` or `grievance` across `apps/*/src`, `packages/*/src`, `content`, `supabase` and `tools` returns zero hits.

**MVP.** 1.

**Depends on.** PRD 2 registers the `/api/report` route in the origin map and does nothing else to the sheet. PRD 3 builds the endpoint and the store behind it. PRD 3 names the grievance officer and owns the address as the DPDP artefact; PRD 6 publishes it, triages what arrives and owns the on-call path. The contact line this requirement renders is that one address and no other.

**Done when.** A report submitted from the web app appears in the relay's store carrying a `kind` from the union and not a sentence, the sheet shows a sent state, and an aeroplane-mode report sends when the connection returns.

### 8. A board a blind student can read

**What.** Replace the single `role="img"` at `Scene.tsx:1278-1279` with a structured accessible view: keep the SVG decorative (`aria-hidden`), and render a visually hidden, DOM-ordered outline beside it built from the same `lesson.elements` the renderer walks, using each element's existing `alt`/`text`/`label`. Make the caption at `ClassRoom.tsx:1044-1051` an `aria-live="polite"` region, and drop `truncate` in favour of two-line clamping so the narrated line is complete. Add a keyboard-reachable "read what is on the board" control to the toolbar.

**Why.** The board is the product. One `aria-label` carrying the lesson title is the entire accessible experience of a fourteen-minute class. An Indian school selling a digital-learning fee line will be asked about accessibility, and a Play listing aimed at minors is reviewed against it.

**MVP.** 1 for the structured outline and the live caption; the keyboard control in MVP-2 alongside the component layer's focus work.

**Done when.** A screen reader walking a class announces each element as it appears, in board order, and the caption is announced without interrupting.

### 9. Home tells the truth about the student's class

**What.** Replace `Home.tsx:83` and `:85` with the class-scoped selectors `Syllabus.tsx:65` and `:69-74` already use, honouring `profile.subjects` first and falling back to `subjectsAvailable(profile.klass)`. Add a Home skeleton using `SkeletonList` so the hero does not render placeholder copy while the catalogue is in flight.

**Why.** Home is the screen every student sees every session, and it currently offers a Class 9 student Class 11 Biology and Chemistry, with an inflated chapter count on top (Science reads 63 chapters — every class's summed — where Class 9 Science has 13). In MVP-1 the product is Class 9-10 science only, so a home screen offering thirteen syllabi is also a promise about coverage we cannot keep at 1.4%.

**MVP.** 1.

**Done when.** A test seeds `profile.klass = 9` and asserts Home renders only Class 9 subjects with Class 9 chapter counts.

### 10. The catalogue-first ask

**What.** This is the area's one real cost lever. Make "already prepared" a first-class visual state everywhere a topic can be chosen: Home, Syllabus, Chapter, Search and `AskBox`. A prepared topic shows a download-and-play affordance and starts immediately; an unprepared topic shows an honest "not made yet, this takes about fourteen seconds and it will be here for everyone after you" and is visually secondary. Search must return prepared classes above unprepared topics, never below. When a student asks for something unprepared, offer the nearest prepared neighbour first, drawn from the outcome graph. When a prep is already running for the same topic, the UI joins it rather than starting a second one.

**Why.** Prep is the binding constraint on Rs 5 per student-hour and it is CAPEX only if students land on classes that already exist. Every duplicate or avoidable prep is Rs 30 of real money, and at S=1 prep alone is Rs 496.5 per student-hour, ninety-nine times the ceiling. The UI is where that decision is made, several screens before the relay sees it.

**MVP.** 1.

**Depends on.** Three things this PRD does not own, each of which turns one of the affordances above from a guess into a fact. (a) PRD 3 owns `GET /api/prep/state?topicRefs=`, a read-only endpoint answering ready, preparing or absent for a screen's worth of topics in one round trip. Painting a badge must never take a lock. (b) PRD 3 owns the per-topic lock, keyed on `topic_ref` of the form `<syllabus>/<chapter>/<topic>` and not on the derived class id, so two students reaching one topic by different routes take one lock. This PRD renders the wait and writes its words; PRD 4's prep pipeline owns the poll. (c) PRD 4 owns `nearestReady` as a pure function over the loaded outcome map and the prepared-topic set. Without it `PreparedState.nearestReady` has no producer and the affordance degrades to string similarity over topic titles, which is the wrong neighbour dressed as the right one.

**Done when.** `PreparedState` (see Contracts) is rendered on every topic affordance, an unprepared ask shows the nearest prepared alternative, and a telemetry event records `prepared_hit` vs `prep_triggered` so the ratio is measurable from day one. PRD 6 reads that ratio in the daily cost log as the observed denominator behind the S its arithmetic assumes; a pair of events nobody consumes is not a cost lever.

### 11. The contest front door, and the Test 1 handoff

**What.** The contest form lives on the marketing site, at its own `/enter` route, is built by Aarav against `POST /api/enroll`, and this repo builds no part of it. The domain itself is not chosen yet, which is why nothing here names one. What this PRD owes is the design and the words, delivered to the site as a spec rather than as screens: the Riso Pop layout of the form at the nine fields PRD 0 fixes, the landing copy, the consent line's presentation (the checkbox on its own line, never bundled with terms, with PRD 3's DPDP wording dropped in verbatim), and one sentence on screen, in plain language, saying what the parent's number is used for and that a progress card will be sent to it. Two things do land in this repo: the deep-link handling that preserves the campaign code through sign-in (requirement 17), and the handoff screen the server's `next` points at, which hands straight into the existing `Diagnostic` screen as Test 1. Test 1 and Test 2 are presented as equally hard and the copy must not imply otherwise.

**Why.** This is the whole D2C funnel's front door and it needs to exist once, not twice. Building it in the app as well as on the site gives two forms that drift, two consent records and two places a parent's number can be mishandled; the session is shared anyway, because PRD 0's one-origin decision makes the hand-off free. Presenting Test 1 and Test 2 as equally hard is a cost and an integrity constraint as much as a copy one: the prize is deliberately not judged on the Test 1 to Test 2 delta, because a contest that rewards improvement rewards failing Test 1, and that corrupts the diagnostic the progress card rests on.

**MVP.** 1.

**Depends on.** PRD 0 fixes the field list and `EnrollRequest`; PRD 3 builds `/api/enroll` and `/api/enroll/otp`, writes the `consent_record` and drafts the consent wording; PRD 2 owns the origin map and the redirect to `next`. Contest integrity (recomputing the prize metric server-side from `ledger_event`, the anomaly detector, and `active_ms` bounded against the wall clock) is PRD 4's and PRD 3's, and must land with the contest rather than after it, because a prize turns a client-written ledger into a target the day it is announced.

**Done when.** A student can go from a marketing-site contest link to a completed Test 1 with an OTP-verified parent number on the record, on a phone, on a 3G connection, and the form they passed through is visibly the same product as the app they land in.

### 12. Onboarding forks on where the student came from, and asks one language question

**What.** Split `Onboarding.tsx` into two entry paths behind one progress frame. The self-serve path keeps the steps at `:20` and must gather exactly enough to build a workspace: class, subjects (from `subjectsAvailable`, `:45`), and a name. The school path takes `org_id` from the sign-in, shows a class roster, and the student picks themselves off it. No email, no password, no personal detail typed by a minor. The `ready` step is identical in both.

Add a sixth step, present in both paths: **the language the tutor speaks.** Two options at MVP-1, Hinglish and English, both of them real, neither of them a default that hides the other. The question is about the voice in the class and it must be asked that way ("Which language should your class be taught in?"), not as an app-language setting, because the app is not changing language. The answer is written to the profile at `:64` as `tutorLanguage` on `StudentWorkspace`, mirrored into a Settings row so it can be changed later without re-onboarding, and it is a parameter on every narration render from that point on. The step's own copy is English, like every other step.

**Why.** MVP-2 is the school demo, and a teacher cannot hand 500 children an email-based sign-up. Building the fork in MVP-1 means the school path is a branch, not a rewrite, and it makes the workspace shape one thing rather than two. The language step exists because the decision is two layers and only one of them is settled by fiat: the chrome is English always, and the ear is the child's. A Hindi-medium Class 9 student and an English-medium one are the same product with one field different, and asking is cheaper than guessing from `klass` or from a phone locale that says nothing about what a student was taught in.

**MVP.** 1 for the fork, the self-serve path and the language step; MVP-2 for the roster pick, which needs school auth from the backend PRD.

**Depends on.** PRD 4 owns narration language as a render parameter: a class is planned once in a language-neutral form and narration is rendered per language, one preparation and N audio renders, which needs a `lesson-format` change because the planner writes Hinglish narration straight into the lesson today. Until that lands this step stores a preference nothing honours. PRD 6 owns the arithmetic that follows: pre-warm CAPEX and audio storage multiply by the language count, while the per-student-hour figure does not move, because each student hears exactly one language. PRD 3 owns the roster and the school sign-in the second path needs.

**Done when.** `StudentWorkspace` (see Contracts) is written identically by both paths, carries `tutorLanguage`, and a roster-pick student reaches Home having typed nothing. A student who picked English hears no Hinglish in a class, and the chrome around them is identical either way.

### 13. The component layer

**What.** Extract `Button` (three tones, the recipe at `Onboarding.tsx:77-79`), `Card`, `Switch` (the one hand-rolled at `Settings.tsx:71-94`, under the comment at `:66-70`) and `Dialog` into `apps/classroom/src/ui/`. `Dialog` carries a focus trap, Escape-to-close and focus restore, and both existing modals (`MicRationale`, `ReportSheet`) move onto it. In the same pass, add the missing token scales: `borderRadius` named steps for 16/20/24px replacing 50 arbitrary-value classes, and a motion scale (`duration-quick` 160ms, `duration-base` 250ms, `duration-slow` 500ms, plus two easing tokens) replacing eight ad hoc literals.

**Why.** `aria-modal="true"` on a dialog with no focus management is a promise the app does not keep, on a child-facing education product. The token gaps are the parts of the design system with no single source, so they are the parts that drift fastest as the contest, school and progress-card screens are added on top.

**MVP.** 1 for Button, Card, Switch and Dialog; the radius and motion tokens with them, because the Riso re-skin touches the same lines anyway.

**Done when.** `border-b-4 border-on-primary-fixed-variant` appears once. A keyboard user can open, traverse and escape both modals and lands back on the trigger.

### 14. Reduced motion, honoured once

**What.** One `prefersLessMotion()` in `apps/classroom/src/lib/` that ORs `matchMedia('(prefers-reduced-motion: reduce)')` with `document.documentElement.dataset.reducedMotion`, called from the board camera in `packages/stage/src/Scene.tsx`, from `StreakFlame.tsx`, and from `CartoonAvatar.tsx`, which currently has no check at all. The avatar's rAF loop must also idle when the tutor is not speaking and when the tile is off-screen, rather than running continuously for the whole class.

**Why.** Two costs on one device. A student who asked for less motion still gets a breathing penguin, and a Rs 10,000 phone burns a continuous 60fps SVG loop alongside the board, the audio pipeline and, later, on-device speech. The stage already got this right and the avatar did not.

**MVP.** 1.

**Done when.** With the app switch on, the avatar is still, the camera cuts instead of panning, and a profiler shows no rAF callbacks while the tutor is silent.

### 15. Notes stay and are finished; Bookmarks go

**What.** Notes get the control that makes them real: a note button in the ClassRoom toolbar calling `addNote(lesson.id, currentBeatId, text)` (the beat id is already in scope), plus a `useSearchParams` read in `LessonRoute` that seeds `usePlayer`'s starting beat from `?beat=`, so the deep link `Notes.tsx:224` already writes finally resolves. Bookmarks are deleted: `Bookmarks.tsx` (123 lines), `stores/bookmarks.ts`, the Profile row and the bookmark half of the test suite all come out. Do not ship a third state.

A student's notes are their own. They are never visible to a teacher, a parent or a school, and no surface owned by any other PRD reads them.

**Why.** Two of the eight Profile rows (`Profile.tsx:89-103`) lead to screens that can only ever render an empty state, and for the first real student that reads as a broken app. The two halves are not the same call. A note is a student writing something down in their own words during a class, which is the behaviour the product wants and the one thing on the screen that is theirs. A bookmark is a list of lessons to return to, which the catalogue, Home and the progress card all already answer better, and its one product caller (`Bookmarks.tsx:111`) removes rather than adds, so nothing in the app can create one.

**MVP.** 1.

**Done when.** A note created in class appears on the Notes screen and its deep link reopens the class on that beat, and `grep -ri 'bookmark' apps/classroom/src` returns nothing.

### 16. The legacy floor and the first deploy

**What.** Add a `<noscript>` block and a browserslist targeting `minSdk 24`'s WebView, so an old device shows a readable message rather than a silent white screen. Add a `beforeinstallprompt` handler and an install affordance to Profile. Design the About/Privacy/Terms/DPDP surface: one readable layout in the design system, long-form English, a page a parent can finish on a phone, with the grievance contact set as a real address and not a placeholder.

**Why.** MVP-1 contains the first ever deploy of the front end. A white screen on a cheap phone is indistinguishable from the product not existing, and a school will ask for the privacy page before it puts a line item on a fee structure.

**MVP.** 1.

**Depends on.** Three PRDs own one screen between them and that is correct, but only one of them may build it. PRD 2 registers `/app/legal/privacy`, `/app/legal/terms`, `/app/legal/dpdp` and `/app/help/report` as real routes and owns the Play Data Safety mapping. PRD 3 writes the copy and names the grievance officer. PRD 6 publishes the address and owns the incident path. This PRD supplies the design and nothing else; there is no second legal screen in this document.

**Done when.** The built bundle carries a `nomodule` fallback path, and the privacy route renders in the design system with a real contact address.

### 17. Marketing-site integration

**What.** Implement the app's half of PRD 0's contract: shared brand tokens published as a single CSS file the site imports (so a palette change is one place, and the form in requirement 11 is Riso Pop without anyone re-typing a hex), a documented set of deep links (`/enter?c=<campaign>`, `/app/class/<topic-slug>`, `/app/school/<org-slug>`), and a handoff that preserves the campaign code through sign-in into `StudentWorkspace.campaign`. Nothing in this repo re-implements marketing pages, and nothing on the site re-implements the design system.

**Why.** The site is already half-built and the app has to look like the same product on the click after. PRD 0's one-origin decision is what makes that click cheap: `/` is the site, `/app/*` is the app and `/api/*` is the relay, on one domain, so the session is shared and no token crosses a URL. It also makes the brand break sharper if it happens, because there is no domain change to explain it away. The campaign code is what makes contest attribution possible at all, and it is the one field that must survive a redirect the server chooses.

**MVP.** 1.

**Depends on.** PRD 2 owns `base: '/app/'`, the narrowed `vercel.json` rewrite and the origin map. Aarav owns the site's route list, without which the rewrite cannot be narrowed.

**Done when.** A link from the live site lands on the app with the campaign code intact and no visible change of brand.

### 18. Empty states, illustration and the mascot

**What.** Replace the identical 64px grey circle on the ten screens that render `EmptyState` with a small illustration set drawn in the Riso inks, reusing the mascot's poses from `CartoonAvatar`. Each empty state names the one action that fills it. Build the set as SVG components in `apps/classroom/src/ui/empty/`, not as raster assets.

**Why.** A new student's first session is a run of empty screens. This is the surface that decides whether the product reads as new or as broken, and it is also the school demo's opening minute.

**MVP.** 2.

**Done when.** No two empty states look the same and each one has a working primary action.

### 19. A named accessibility target, and a palette checked for colour-vision deficiency

**What.** Two things, both of which are cheap now and expensive later. First, name the target: **WCAG 2.2 Level AA**, stated in the About screen, in the Play listing and in whatever a school's compliance question is answered with, along with an honest list of where the product does not meet it yet. Second, extend `docs/brand/build-theme.mjs` to simulate deuteranopia and protanopia over every pair it already checks, and to fail on a subject pair that becomes indistinguishable under either. Add the rule the simulation exists to enforce: **colour is never the only carrier of subject identity.** Every subject tile, ring and chip carries a glyph or a label beside its ink, everywhere it appears.

**Why.** The script already measures 39 rendered pairs for luminance contrast and refuses to emit on a failure, which is real work, and luminance contrast is exactly the axis that a red-green deficiency does not touch. The four subject inks at `build-theme.mjs:112-115` are green `#196B46` (Biology), blue `#0B5FD9` (Maths), pinkDeeper `#B00463` (Chemistry) and redDeep `#8E2310` (Physics). Green against redDeep is the textbook confusion and both are mixed into the ground at the same ratios (`:118-122`), so their tiles have near-identical lightness by construction, which is the one property that would otherwise rescue them. Roughly one boy in twelve has a red-green deficiency, so in a 500-student pilot that is about twenty children for whom Biology and Physics are the same tile. The comment at `:110` says out loud what is at stake: "A student finds Maths by its colour before reading the word." It is far cheaper to check this while the palette is generated and unused than after the subject colour has become a convention students have learned. The conformance statement is a question the pilot school's own compliance review will ask, and answering it with a target plus a gap list is better than answering it with a list of features.

**MVP.** 1 for the target and the CVD gate, because both land in files requirement 2 is already opening. The gap list is revised at each MVP.

**Done when.** `npm run brand:theme` fails on a deliberately swapped subject ink that collides under deuteranopia, and no subject anywhere in the app is identified by colour alone.

### 20. Appearance testing

**What.** A token-lint test that fails on any raw hex or `rgba(` in `apps/classroom/src` outside the generated theme files and the documented stage palette, plus Playwright screenshot tests over every screen in the inventory in both rooms at 360px and 1280px.

**Why.** Every appearance bug in this document shipped past a 60-file, 11,690-line test suite because that suite tests logic. The invisible streak chip, the bullet-instead-of-lock and the wrong board font are all one screenshot away from being caught.

**MVP.** 2.

**Done when.** The token lint fails on a deliberately added `#ff0000`, and a screenshot diff fails on a deliberately broken token.

### 21. The consent screen on the self-serve door

**What.** The try-before-you-enrol path is the top of the funnel and it has no consent artifact at all. This PRD builds the screen that closes it: a gate a self-serve student meets before anything about them is modelled, stored beyond the session or tracked, asking for a parent's name and phone number and verifying the number by OTP, and asking for nothing else at all. PRD 0's rule that every extra field is a data-protection obligation applies harder here than on the contest form, because this door collects no prize entry and no school channel and therefore needs no board, city, school name or subject list. It reuses the consent presentation from requirement 11 so a parent meets one design whichever door they came through, and it states in plain English what is about to be kept and for how long.

The screen must also say plainly, on the screen, what a student may do before that number is verified. The honest split, which this PRD renders and PRD 3 enforces: an unverified visitor may **watch a prepared class and answer its questions in the page**. Nothing about them is persisted to a belief store, nothing is written to `ledger_event`, no analytics event carrying a stable identifier is emitted, no progress card is built, and no class is prepared on their behalf, because a prep is a Rs 30 spend against a person we cannot contact. Everything held is session-scoped and gone when the tab closes. The moment any of that is to persist, the parent's number is asked for first.

**Why.** The contest form's OTP-verified parent phone is the DPDP artifact and it covers exactly the students who arrive through the contest. Every other student is a minor being modelled and analytics-tracked with no consent record and no parent anywhere, which is the same defect the contest form was built to avoid, one door along. It also has an arithmetic consequence: PRD 3's nightly assertion is that no `ledger_event` row may exist for a user with no `consent_record`, and an anonymous student taking a class writes ledger rows, so without this screen either the assertion is false on day one or the door closes.

**MVP.** 1. It ships with the first deploy or the first deploy has no self-serve door.

**Depends on.** PRD 3 owns `consent_record` with `source: 'self_serve'`, the OTP endpoint, the nightly assertion, and the decision on whether an anonymous tier survives at all and under what TTL. PRD 3 also drafts the consent wording against DPDP; this screen renders it verbatim. PRD 2 owns the analytics disclosure and the opt-out that actually stops `track`.

**Done when.** A student who has not verified a parent's number can watch a prepared class and cannot cause a row to be written under their name anywhere, and the screen says so before they start rather than after.

### 22. The screens a grown-up reads

**What.** Two parent-facing surfaces, both of which are other PRDs' content and this PRD's design, and neither of which currently exists in the screen inventory.

`/app/grown-up`, the guardian view: an in-app page a student hands their phone to, in the design system, in English, saying what has actually happened without claiming more than the data supports. It joins the screen inventory, it is registered as a route by PRD 2, and its content decision is PRD 5's.

The progress card, `/card/:token`: the artefact that goes to a parent's phone. This PRD supplies its design, and the design has one unusual constraint, which is that it must work as a **print-capable server-rendered page** on a Rs 6,000 phone on 3G with no app installed and nobody signed in. That rules out the component layer, the font stack and the service worker, so it is a separate, deliberately small Riso Pop layout: system-safe type fallbacks, inline critical CSS, no JavaScript needed to read it, and a print stylesheet, because the first thing a proud parent does with it is show somebody.

**Why.** MVP-1's only parent-facing surface would otherwise ship outside the design system, and the card is the artefact three different buyers act on. A page that is the product's reputation cannot be the one page nobody designed.

**MVP.** 1 for the guardian view. 2 for the card design, alongside the card's delivery.

**Depends on.** PRD 5 owns the progress card, which is an immutable stored artefact in a `progress_card` table written by a service-role builder, not a live query. This PRD designs what that stored body renders as and defines no interface for it. PRD 3 renders `/card/:token` as HTML from the relay Edge Function, since it already owns `/api/*` on the same origin; PRD 2 adds the path to the origin map. PRD 5 also owns the guardian view's content and PRD 2 its route.

## Contracts

**The enrolment hand-off is one row, not three payloads.** There is exactly one carrier between the marketing site, the relay and the app: the `student_state` row at key `ai-tutor:profile`, whose `value` is a `StudentWorkspace`. `/api/enroll` writes it server-side and supplies `org_id`, because `student_state.org_id` is `NOT NULL` and a client cannot know which organization it belongs to. Both onboarding paths write the identical shape. There is no separate contest type and no second profile shape.

```ts
// apps/classroom/src/lib/workspace.ts : the agreed enrolment hand-off.
// Written by: POST /api/enroll (site door), Onboarding.tsx (self-serve door),
//             the roster claim (school door). All three write this and nothing else.
// Carried as: student_state { user_id, org_id, key: 'ai-tutor:profile', value, updated_at }
// Consumed by: PRD 4 (learner model seeding, narration language), PRD 5 (roster and
//              teacher scoping, the progress card's header), PRD 3 (the row shape).
export type StudentWorkspace = {
  studentId: string;          // supabase auth uid, or the roster row id for a school pick
  orgId: string;              // organization.id; the solo org for a self-serve student.
                              // Supplied by the server, never by the client.
  orgKind: 'solo' | 'school'; // mirrors organization.kind, migration 0005
  name: string;               // first name only; never typed by a minor on the school path
  klass: 6|7|8|9|10|11|12;
  board: 'ncert';             // PRD 0's required field. More later; see PRD 4.
  subjects: string[];         // from subjectsAvailable(klass); never empty
  tutorLanguage: 'hinglish' | 'en'; // the ear, chosen at onboarding. NOT the UI language:
                              // the UI is English in both cases and has no setting.
  source: 'self' | 'contest' | 'roster';
  campaign?: string;          // present only when source === 'contest'
};
```

```ts
// apps/classroom/src/ui/ReportSheet.tsx : the agreed report payload.
// POST /api/report -> 202 { id: string }. Idempotent on (lessonId, beatId, at).
// Sent by: PRD 1 (the sheet). Routed by: PRD 2. Received and stored by: PRD 3.
// Triaged by: PRD 6 (the address, the incident path, the 24-hour clock).
export type ReportSubmission = {
  kind: 'wrong' | 'rude' | 'unsafe' | 'other'; // the four ids at ReportSheet.tsx:29-34.
                              // The wire carries the id; the sheet shows the label.
  note: string;               // the child's own words, PII-scrubbed client side, <= 500 chars
  lessonId: string;
  topicRef: string | null;    // <syllabus>/<chapter>/<topic>, so a report can be traced
                              // to a prepared_class without a lesson-id lookup
  beatId: string | null;
  spokenLine: string | null;  // the exact narration line on screen when reported
  sessionId: string | null;   // null when reported outside an open session
  release: string;            // the git-sha release stamp PRD 6 sets
  platform: 'web' | 'android';
  at: string;                 // ISO 8601
};
```

```ts
// apps/classroom/src/lib/content.ts : the catalogue-first ask.
// Fed by: PRD 3's GET /api/prep/state?topicRefs= (a read, never a lock).
// nearestReady produced by: PRD 4, as a pure function over the outcome map.
// The key is topic_ref, of the form <syllabus>/<chapter>/<topic>, everywhere. Never the
// derived class id: two students reaching one topic by different routes must take one lock.
export type PreparedState =
  | { status: 'ready'; topicRef: string; preparedAt: string }
  | { status: 'preparing'; topicRef: string; startedAt: string } // join, never start a second
  | { status: 'absent'; topicRef: string; nearestReady?: string };
export function preparedState(topicRef: string): PreparedState;
```

```ts
// apps/classroom/src/screens/school/Roster.tsx : MVP-2, filled by the LMS PRD.
export type RosterEntry = { membershipStudentId: string; displayName: string; klass: number; section?: string };
```

```css
/* apps/classroom/src/theme.css : the token contract every other surface renders against.
   47 Material-3 role names as RGB triplets, plus the keyline token the brand's law 3 needs.
   Any screen owned by another PRD (teacher surface, progress card, parent view) uses these
   names and nothing else. Generated by docs/brand/build-theme.mjs; do not hand-edit. */
:root { --c-primary: 11 95 217; /* …47 roles… */ --key: 2.5px; }
.dark { --c-primary: 143 180 255; /* …47 roles… */ }
```

```ts
// Telemetry event names this area emits (PostHog). Consumed by: PRD 6.
// None of these is emitted for a student with no consent record (requirement 21).
'onboarding_completed' { klass: number; subjects: number; tookPlacement: boolean; source: StudentWorkspace['source']; tutorLanguage: StudentWorkspace['tutorLanguage'] }
'prepared_hit'         { topicRef: string; surface: 'home'|'syllabus'|'chapter'|'search'|'ask' }
'prep_triggered'       { topicRef: string; surface: string; nearestReadyOffered: boolean }
'contest_enrolled'     { campaign: string; klass: number }
'report_sent'          { kind: ReportSubmission['kind'] }
```

### What this area depends on, and who owns it

Everything below is named here so it is not designed twice. Where another PRD owns a shape, this document does not define one.

- **`ProgressCard`** is PRD 5's. It is an immutable stored artefact in a `progress_card` table, written by a service-role builder and never recomputed, not a live query over a window. This PRD designs what the stored body renders as (requirement 22) and declares no interface of that name.
- **`GET /api/prep/state?topicRefs=`**, the per-topic prep lock keyed on `topic_ref`, `POST /api/report`, `/api/enroll` and `/api/enroll/otp`, the `consent_record`, and the server-rendered `/card/:token` page are all PRD 3's.
- **Narration language as a render parameter**, the `lesson-format` change it needs, and `nearestReady` over the outcome graph are PRD 4's.
- **The guardian view's content**, the progress card itself, and the rule that a student's notes are never visible to a teacher, a parent or a school are PRD 5's.
- **Refusal rendering** is PRD 2's, MVP-1: `ClaimReason` `'global'` and `'halted'` shown differently from `'budget'`, the new `'capped'` reason the relay now returns as a 503 (`packages/relay/src/gate.ts:157`, `supabase/migrations/0015_project_spend_cap.sql:130`), the prep-lock busy or held wait screen rather than a retry loop, and PRD 6's `Degrade` ladder. These are the sentences a student reads when the product is working correctly and saying no, so they are written in this PRD's register and rendered in its component layer, but the requirement is PRD 2's.
- **The teacher and school-admin sign-in screen** is PRD 2's, using email and password, which students never see: a minor picks themselves off a class roster with no email and no password, and that is also the DPDP answer. PRD 3 owns school-org provisioning, `POST /api/staff/invite` and `POST /api/staff/claim`; PRD 5 states what role each surface requires. This PRD owns only the design.
- **The escalation path for a child who discloses harm** is PRD 3's. `packages/safety/src/screen.ts:250` already returns a `support` verdict, its reply already carries Tele-MANAS 14416 and Childline 1098 (`:71-72`), and `apps/classroom/src/lib/safety.ts:41-43` already drops the model's own words in favour of it, which is the right behaviour and the whole of it. The flag then goes to `recordFlag()`, and `apps/classroom/src/stores/flags.ts:65` writes it to a `neverSync` local store that reaches nobody. The alert goes to Aarav by email and SMS, carrying a flag id, the student id, the org, the time and the verdict, and no transcript; it does not go to the school by default, because a disclosure is sometimes about an adult at that school. PRD 5 owns whatever surface exists for it and this PRD supplies that surface's design and its register, which is calm, short, and readable with the sound off.
- **`ci.yml`** is PRD 6's. This PRD contributes two steps to it, the contrast and colour-vision gate (requirement 2 and 19) and the screenshot suite (requirement 20), and states their runtime cost where they are specified.
- **WhatsApp delivery of the card**, its provider choice, BSP onboarding and template approval are PRD 5's to name and PRD 6's to cost, and they start at least three weeks before the demo. This PRD supplies the card's design and nothing about its carriage.

## What this costs

**Where this area sits in the rollup.** All six documents now divide by one denominator, the pilot's 2,500 student-hours a month (500 students at 5 h), and the fixed lines total **Rs 2.48 per student-hour**: Supabase Pro Rs 0.96, the Piper VPS Rs 0.80, Vercel Pro Rs 0.72, R2 backups Rs 0.0016. On top of that, MVP-1 is **Rs 22.8 to 30.6 per student-hour** and breaks, four and a half to six times over, and it breaks on the judge, which is Rs 18.70 per student-hour on its own. MVP-2 is **Rs 3.49** and clears. MVP-3 is **Rs 4.32** at pilot scale and **Rs 1.34** at 25,000 student-hours. What buys MVP-2 is one change: the whyProbe format, prompt and validator land in MVP-1 and the ClassRoom playback change that takes the judge off the class path lands in MVP-2. Staging it the other way, with the class path deferred, leaves MVP-2 at Rs 22.19, because the placement and quiz paths already make no LLM calls and deferring them buys nothing. That single staging decision is the difference between Rs 3.49 and Rs 22.19, and it is the only thing in six documents that puts the product under Rs 5.

**Cash is not cost, and this document means cost.** About Rs 23.70 of MVP-1's Rs 26.15 is Vertex drawn on Google Cloud credits, so roughly Rs 2.50 of it is cash out of the bank. "Under Rs 5 of cash from day one" is true; "the Rs 5 ceiling is met" is not. Every figure in this section is a cost figure unless it says otherwise.

**One number in none of it.** The doubt tutor appears in no rollup in any PRD, and PRD 4's unverified estimate is Rs 28 per student-hour, larger than everything else put together. If it lands anywhere near that, every figure above is wrong. Measuring it is the cheapest way to find out whether this arithmetic means anything, and it is PRD 4's requirement, not this one's. **NOT VERIFIED.**

**Serving cost: Rs 0 per student-hour.** Nothing in this area calls a model, synthesises speech or holds a socket open. The only recurring spend a re-skin could introduce is bandwidth, and it does not: fonts and icons are already self-hosted and bundled (`fonts.ts:27-38`, Lucide tree-shaken), the illustration system in requirement 18 is SVG components rather than raster assets, and swapping five `@fontsource` packages for three changes the bundle by tens of kilobytes on a first load that is already cached by `content/sw.js`. Vercel Pro is PRD 6's line and it is in the rollup above at Rs 0.72 per student-hour, divided by the pilot's 2,500 student-hours like every other fixed cost; bandwidth on top of it is not a per-student-hour figure at all.

**Cost avoided: the catalogue-first ask (requirement 10) is worth more than everything else in this document combined.** Prep per student-hour is `16.55 x C / S`, where C is the real cost of one prepared class and S is the number of students sharing it. The planning figure is **Rs 30 a topic**, measured, with Rs 26 to 40 as the uncertainty band, and every one of the six documents now uses it. At S=1 that is `16.55 x 30 = Rs 496.5` per student-hour, ninety-nine times the ceiling, and it is the default state of a self-serve student on a cold topic today. At S=100 the same class is Rs 4.97/hour, and at S=500 (school #1's roster, the same Class 9-10 science topics) it is Rs 0.99/hour.

The UI decides which of those numbers the student lands on, several screens before the relay sees the request. Three specific avoidances:

- **Duplicate prep.** With no concurrency control anywhere in the repo, N students asking for the same new topic each pay a full prep and N-1 results are discarded. A `PreparedState.preparing` affordance that joins the running prep instead of starting a second turns `N x Rs 30` into `Rs 30`. On a 500-student school with a teacher setting the same homework topic, that is the difference between Rs 15,000 and Rs 30 in one afternoon.
- **Avoidable prep.** Offering `nearestReady` when a student asks for something unprepared converts a Rs 30 CAPEX event into a Rs 0 download. If the catalogue-first surfaces move the prepared-hit rate from an unmanaged baseline to 80%, the prep term in the ceiling falls by a factor of five for the same catalogue.
- **Wasted prep.** Home currently offers the union of the subjects in all thirteen syllabi (`Home.tsx:83`): Science, Mathematics, Biology, Chemistry. A Class 9 student tapping into Class 11 Biology or Chemistry can trigger a prep for a topic outside the MVP-1 scope, which is Rs 30 spent on a class no student in the pilot will ever see again. Requirement 9 is a cost fix as much as a correctness one.

**Cost added: zero, with two caveats.** Requirement 14's avatar idle reduces device CPU on the exact Rs 10,000 phones the product targets, which shows up as battery and thermal throttling rather than rupees, but a throttled phone is a phone that drops the audio pipeline mid-class. Requirement 20's Playwright screenshots add CI minutes; on GitHub Actions' free tier for a private repo that is a runway question for PRD 6, which owns `ci.yml`, not a per-student-hour one. Requirements 2 and 19's gates add about a second of `node` and no install.

**The language step (requirement 12) costs nothing per student-hour and something once.** Narration is rendered per language, so pre-warm CAPEX and audio storage both multiply by the language count, which is two: roughly Rs 35,600 of one-time audio and about 1.9 GB stored across the 1,099-topic catalogue. The per-student-hour figure does not move, because each student hears exactly one language. PRD 6 owns that arithmetic; this requirement's only contribution to it is that a student picks once, at onboarding, rather than toggling and forcing a second render.

**The 2027-01-01 cliff does not move this area's arithmetic,** because this area spends nothing on models. It moves requirement 10's value instead. When Vertex prices double, prep goes to Rs 60 a topic and the product needs an S of roughly 250 or better **on every topic** to stay under the ceiling: at S=100 post-cliff, prep alone is Rs 9.93 per student-hour and the whole thing breaks. Every avoided prep is worth twice what it is worth today, and the three surfaces that raise S are the catalogue-first ask here, the teacher's assignment button in PRD 5 and the pre-warm runner in PRD 6. None of the three is an optional feature.

## Risks

1. **Requirement 1 is blocked on a decision only Aarav can make, and eight other requirements are blocked on requirement 1.** The icon, the splash, the manifest, the store assets, the empty-state illustrations and the marketing-site alignment all derive from which mark wins. If that decision slips, the Riso re-skin ships with the indigo atom still on the home screen and the visible defect is unchanged.
2. **The Riso Pop palette has never been seen on a real screen.** All 39 pairs clear AA by arithmetic, and `build-theme.mjs` refuses to emit otherwise, but AA is a floor and not a judgement. Two flat fluorescent inks over newsprint is a strong, opinionated look, and it may read as a poster rather than as a study app on a 5-inch phone in an Indian classroom's daylight. Mitigation: build requirement 20's screenshot harness early enough that the whole app can be judged in one page, and be willing to soften the fluoro pink's coverage rather than its value.
3. **The marketing site Aarav is building may not be Riso Pop.** If the site's brand is the old palette or a third one, the click from site to app reproduces exactly the defect requirement 1 exists to fix, one layer up. This needs resolving before either side is finished, not after.
4. **The board accessibility work (requirement 8) touches `packages/stage`, which is shared with prep.** `Scene.tsx` is 1,300 lines and the renderer and the camera are intertwined. A structured accessible outline built from `lesson.elements` is additive, but the `aria-hidden` change to the SVG root and the caption's `aria-live` both risk regressing the classroom's most-seen surface with no screenshot tests in place yet.
5. **The type swap (requirement 4) is a dependency change, not a CSS change.** Five `@fontsource` packages come out and three go in, including a Devanagari sibling that must be the right subset, and the board's font names must match the registered family names exactly. This is the bug that already shipped once, invisibly, and the only guard against it shipping again is the family-name test in requirement 4's acceptance.
6. **Requirement 10 depends on three things this PRD does not own.** If PRD 3's `GET /api/prep/state` cannot answer "is this topic prepared, and is one running right now" cheaply and quickly, the catalogue-first surfaces degrade to an optimistic guess and the duplicate-prep avoidance evaporates. If the lock is keyed on the derived class id rather than on `topic_ref`, two routes to one topic take two locks and the mechanism fails silently in exactly the case it was built for. If PRD 4's `nearestReady` does not exist, the third affordance degrades to string similarity over topic titles, which offers a student the wrong neighbour with the confidence of a right one.
7. **Scope.** This is twenty-two requirements, twenty of them carrying MVP-1 work, against one founder, and requirement 11 shrinking to a design deliverable is the only thing that has come off the pile. The five that cannot be cut are 1, 2, 6, 7 and 21: identity, palette, copy that is true and English, a report that reaches a person, and a consent gate before a minor is modelled. Everything else in MVP-1 is a strong should.
8. **The chrome and the ear are in different languages on purpose, and nobody has seen that.** A Hindi-medium Class 9 student will read English buttons around a tutor speaking Hinglish, and the register gap is real even though the decision is right: English is what a parent and a school judge the product on. The mitigation is entirely in requirement 4's type pairing and requirement 6's register, which is to say it rests on craft rather than on arithmetic, and it will not be visible as a problem until a real student is watched using it. There is also an asymmetry with no owner yet: the tutor's language is a setting and the parent-facing progress card is not, so PRD 5's card is English for a parent who may not read it.
9. **Requirement 19's colour-vision gate may fail the palette that is already generated, verified and about to be applied.** Green `#196B46` and redDeep `#8E2310` are mixed into the ground at identical ratios, so the two subject tiles have near-identical lightness by construction, which is what makes them hard to tell apart under a red-green deficiency. If the simulation fails them the fix is to re-pitch two of the four subject inks, which re-runs every pair in the audit and changes tiles a student may already have learned. It is far cheaper now, before requirement 2 applies the palette, than after. **NOT VERIFIED:** the simulation has not been run, because it does not exist yet.

## Open questions

1. **Which mark is the identity: the atom or the penguin?** Everything derived from it is blocked on this, and the two answers give different products. If it is the penguin, does he keep a name distinct from the product's, and is that name still Meera?
2. **Is the marketing site being re-skinned to Riso Pop, or is the app diverging from the site you have already built?** One origin makes the click free and the brand break sharper: there is no domain change to explain it away. If the site stays as it is, we need a third answer, because the click from one to the other is the same brand break we are fixing, and the contest form now lives on the site side of it.
3. **Does MVP-1 keep a dark room?** It doubles every contrast check, every colour-vision check, every screenshot and every review pass. The classroom itself is already a deliberately non-themed dark auditorium, so a light-only app is coherent.
4. **On the contest form, how much does the child fill and how much does the parent?** The OTP is the parent's, and DPDP treats that as the consent artifact, so the honest design may be that the child fills their own name and class and then hands the phone over. That is a conversion decision as much as a compliance one, and it is now a design note to the site rather than a screen in this repo.
5. **Does the progress card wear Riso Pop, or a plainer document skin?** It is the one surface designed to be printed, forwarded and shown to somebody who has never heard of us, on a phone with none of our fonts. Two flat fluorescent inks are a strong look for a poster and a strange one for a school report. This is a design call and it is mine to propose, but it is worth one minute of yours before requirement 22 is built.
