import { useState } from 'react';

/**
 * THE PROTOTYPE GATE: only a class that already exists may be opened.
 *
 * Google Cloud billing is off on the project the relay calls, so every model
 * call answers 403. A topic with no prepared class therefore cannot be
 * prepared: the student taps it, preparation starts, and it dies. Before this
 * gate, tapping any Mathematics topic showed them the vendor's own words —
 * "enable billing on project #project-dd876d44-2dc1-40de-935", a Google
 * console URL, on a child's screen.
 *
 * So the prototype offers what it can actually teach and says so about the
 * rest. Everything stays VISIBLE — the syllabus is the shape of the product
 * and hiding it would hide how much of the course exists (Syllabus.tsx says
 * this in its own docblock) — but only a prepared topic is tappable.
 *
 * ONE FLAG TURNS IT OFF. When PROTOTYPE_ONLY_PREPARED is false every screen
 * goes back to preparing classes live; nothing else has to be remembered or
 * unpicked. That is the whole reason it is one name and not a scattering of
 * conditions.
 *
 * SET FROM QRIE CONTROL. The value is the console's `tutor.only_prepared`
 * switch, applied by lib/appConfig.ts when the app reads public.my_app_config.
 * It is `true` until a read succeeds, and stays at the last value read when a
 * later read fails, so an app that cannot reach the console never starts
 * preparing new classes on its own. Screens read it at render; App subscribes
 * to the config so they re-render when it changes.
 */
export let PROTOTYPE_ONLY_PREPARED = true;

/** Called by lib/appConfig.ts only. */
export function setOnlyPrepared(on: boolean): void {
  PROTOTYPE_ONLY_PREPARED = on;
}

/**
 * WHETHER A TOPIC CAN BE OPENED — and 'loading' is not 'no'.
 *
 * The catalogue arrives over the network, and a predicate that answered a
 * plain boolean would answer "cold" for every topic in the moment before it
 * lands. Syllabus.tsx already carries a docblock about exactly this trap for
 * its badges. A screen that froze the whole course for that moment would then
 * unfreeze under a finger already moving, which is worse than either state.
 *
 * So there are three answers and a caller has to handle the middle one.
 */
export type Readiness = 'loading' | 'ready' | 'not-yet';

/**
 * The verdict for one topic.
 *
 * `lessons` is what `topicsOf` already attaches to every row — the catalogue
 * filtered to this topicRef — so this is not a second source of truth, it is a
 * name for the one that exists. Pass null while the catalogue is in flight.
 *
 * NOTE THAT "PREPARED" IS WIDER THAN THE FILES IN content/. `fetchCatalog`
 * merges the rows in Supabase `prepared_class`, so a class some earlier
 * student had made and kept counts too — measured against production on
 * 2026-09-26: 15 lesson files and 6 `prepared_class` rows, 21 catalogue
 * entries covering 20 distinct topics, because one shipped lesson carries no
 * topicRef and so is reachable as a lesson but never as a topic tile. Asking
 * the catalogue rather than the folder is what keeps those six openable.
 */
export function readiness(lessons: readonly unknown[] | null | undefined): Readiness {
  if (lessons == null) return 'loading';
  return lessons.length > 0 ? 'ready' : 'not-yet';
}

/** True only when the gate is on AND we know the topic has nothing. */
export const isFrozen = (r: Readiness): boolean => PROTOTYPE_ONLY_PREPARED && r === 'not-yet';

/**
 * The one place the notice's words live, so five screens cannot drift apart.
 *
 * Written for a fourteen-year-old and not for us: it does not say "billing",
 * "relay" or "403", and it does not apologise twice. It says what is true —
 * some classes are ready, this one is not yet — and it does not promise a date
 * nobody has set.
 */
export const PROTOTYPE_NOTICE = {
  title: 'This one is not ready yet',
  body: 'Qrie is still a prototype. A few classes are fully made and you can open those now — the rest are being written.',
  cta: 'Show me what is ready',
} as const;

/**
 * The notice's open/closed state, plus the name of whatever was tapped.
 *
 * A hook rather than a context because nothing needs to open it from two
 * places at once, and a context for one boolean is a lot of machinery to
 * explain. `tapped` carries the topic title so the notice can name the thing
 * the student actually reached for instead of talking about topics in general.
 */
export function usePrototypeNotice(): {
  tapped: string | null;
  show: (title: string) => void;
  dismiss: () => void;
} {
  const [tapped, setTapped] = useState<string | null>(null);
  return { tapped, show: setTapped, dismiss: () => setTapped(null) };
}
