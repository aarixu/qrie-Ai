import { profileStore, type StudentProfile } from '../stores/profile';

/**
 * THE WORKSPACE: THE ONE SHAPE BOTH ENTRY PATHS WRITE.
 *
 * Two doors lead into this app and until now they agreed on nothing. A
 * student who came through the contest form has a consent row in Postgres and
 * no profile at all (packages/relay/src/enroll.ts:48-58 says so in as many
 * words); a student who just opened the app has a profile and no consent. The
 * workspace is the small shape both of them write, so every screen after the
 * door can ask ONE object where this student came from and what they agreed
 * to.
 *
 * WHY IT LIVES INSIDE THE PROFILE ROW. Every store created by
 * createLocalStore registers itself and becomes its own student_state row
 * (stores/localStore.ts:20-35, lib/sync.ts). A workspace store would be a
 * second row to merge, to migrate and to reason about, for four fields that
 * are meaningless apart from the profile they describe. So it rides inside
 * 'ai-tutor:profile' under one key, and syncs on the back of a row that
 * already syncs.
 *
 * WHY IT IS CAST IN AND OUT. stores/profile.ts belongs to another lane this
 * wave and StudentProfile does not declare this field. The cast is contained
 * to this file, and readWorkspace validates everything it reads back rather
 * than trusting the shape — which it would have to do anyway, because a row
 * can arrive from the cloud written by an older build. HANDOFF: the field
 * belongs in StudentProfile, and the cast goes when it lands there.
 */

/** The key the workspace sits under, inside the profile row. */
export const WORKSPACE_ROW_KEY = 'workspace';

/**
 * WHICH LANGUAGE THE TUTOR SPEAKS — never which language the app is in.
 *
 * The app chrome is English for everyone. This is the voice of the person
 * teaching: 'en' is English throughout, 'hi-en' is the Hinglish a tutor in an
 * Indore classroom actually speaks. Those two spellings are what the shipped
 * code already uses, so they are what this stores; a third value is not a
 * language, it is a bug reaching a child's class.
 */
export type TutorLanguage = 'en' | 'hi-en';

const LANGUAGES: readonly TutorLanguage[] = ['en', 'hi-en'];

/**
 * WHICH DOOR. 'self_serve' is a student who answered the questions
 * themselves; 'school' is a student who will pick themselves off a class
 * roster their school uploaded. The roster is MVP-2 and unbuilt — the value
 * exists so the fork is visible and nothing has to be renamed later.
 *
 * The spellings match consent_record.source (migration 0019) on purpose: two
 * vocabularies for the same distinction is how they drift.
 */
export type EntryPath = 'self_serve' | 'school';

const ENTRIES: readonly EntryPath[] = ['self_serve', 'school'];

/**
 * That a consent row was written for this student, and where it came from.
 *
 * NOT the consent itself — the consent is the row in Postgres. This is the
 * app's note that the round trip happened, so a screen can tell an enrolled
 * student from a visitor without asking the server on every render.
 */
export interface ConsentMark {
  source: 'contest' | 'self_serve';
  /** ISO time the relay's OTP verification came back ok. */
  at: string;
}

export interface Workspace {
  /** Bumped when the shape changes in a way an old row cannot be read as. */
  version: 1;
  entry: EntryPath;
  tutorLanguage: TutorLanguage;
  consent: ConsentMark | null;
}

export const DEFAULT_WORKSPACE: Workspace = {
  version: 1,
  entry: 'self_serve',
  tutorLanguage: 'en',
  consent: null,
};

type ProfileRow = StudentProfile & { [WORKSPACE_ROW_KEY]?: unknown };

/** A consent mark, or null for anything that is not one. */
function readConsent(value: unknown): ConsentMark | null {
  if (typeof value !== 'object' || value === null) return null;
  const c = value as Partial<ConsentMark>;
  if (c.source !== 'contest' && c.source !== 'self_serve') return null;
  if (typeof c.at !== 'string' || Number.isNaN(Date.parse(c.at))) return null;
  return { source: c.source, at: c.at };
}

/**
 * The workspace as it is right now, defaulted field by field.
 *
 * Every field is checked rather than trusted: this row round-trips through
 * the cloud, so it can be written by a build that is older than this one,
 * and a `tutorLanguage` of 'hi' reaching a class is a voice nobody chose.
 */
export function readWorkspace(): Workspace {
  const held = (profileStore.get() as ProfileRow)[WORKSPACE_ROW_KEY];
  if (typeof held !== 'object' || held === null) return { ...DEFAULT_WORKSPACE };
  const w = held as Partial<Workspace>;
  return {
    version: 1,
    entry: ENTRIES.includes(w.entry as EntryPath) ? (w.entry as EntryPath) : DEFAULT_WORKSPACE.entry,
    tutorLanguage: LANGUAGES.includes(w.tutorLanguage as TutorLanguage)
      ? (w.tutorLanguage as TutorLanguage)
      : DEFAULT_WORKSPACE.tutorLanguage,
    consent: readConsent(w.consent),
  };
}

/** Change part of the workspace, leaving the rest of the profile row alone. */
export function writeWorkspace(patch: Partial<Omit<Workspace, 'version'>>): Workspace {
  const next: Workspace = { ...readWorkspace(), ...patch, version: 1 };
  profileStore.update(
    (p) => ({ ...(p as ProfileRow), [WORKSPACE_ROW_KEY]: next }) as unknown as StudentProfile,
  );
  return next;
}

export const setTutorLanguage = (tutorLanguage: TutorLanguage): Workspace =>
  writeWorkspace({ tutorLanguage });

export const setEntryPath = (entry: EntryPath): Workspace => writeWorkspace({ entry });

export const tutorLanguage = (): TutorLanguage => readWorkspace().tutorLanguage;

// ------------------------------------------------------- the trial session --

/**
 * A SESSION SOMEBODY IS TRYING THE APP IN, BEFORE ANY PARENT HAS AGREED.
 *
 * sessionStorage, not localStorage, and the choice is the whole point: a
 * trial must not outlive the tab it happened in, must not reach
 * student_state, and must not be something a student can be recognised by
 * tomorrow. localStorage would survive all three.
 *
 * It is deliberately NOT part of the Workspace above: the workspace is the
 * row that syncs, and a trial is precisely the thing that must leave no row.
 */
export const TRIAL_KEY = 'ai-tutor:trial';

const session = (): Storage | null => {
  try {
    return window.sessionStorage;
  } catch {
    // Private mode, a locked-down WebView. No trial mark means mayPersist
    // stays true — see its docblock for why that is the safe direction.
    return null;
  }
};

/**
 * Open a trial, and say whether one was opened.
 *
 * IT DOES NOT REFUSE A DEVICE THAT ALREADY HAS A STUDENT, and that is a
 * decision rather than an oversight. There is a real defect in this direction:
 * an enrolled student who taps a /try link from a bookmark or an advert is
 * marked non-persisting for the whole tab, so mayPersist() goes false, App.tsx
 * stops counting them, and every guard this phase handed off will drop their
 * work once it lands. The obvious fix is to refuse when isOnboarded — and that
 * fix reopens, from the other side, the exact hole mayPersist's docblock
 * refuses to open: a shared contest kiosk or a family phone is a settled
 * device where the NEXT child at it has no parent and no consent, and refusing
 * them a trial would hand them the enrolled student's app instead. A device
 * cannot tell those two people apart, so code must not guess between them.
 *
 * The one that can tell them apart is the person holding it, so the screen
 * asks: a settled device is offered its own app first and a guest trial
 * second, and a trial can be left again (endTrial) rather than lasting until
 * the tab closes. Both directions then fail towards a child who is not written
 * about, which is the house rule, and neither fails silently.
 *
 * The boolean says whether a mark actually took, because storage can refuse.
 */
export function beginTrial(): boolean {
  try {
    session()?.setItem(TRIAL_KEY, new Date().toISOString());
  } catch {
    // Storage full or blocked. Nothing here is worth a thrown screen.
    return false;
  }
  return isTrialSession();
}

/**
 * Close it. Two callers: markConsented below, and the trial screen's own way
 * out — without which a trial lasted until the tab closed and an enrolled
 * student who wandered in had no way back to being counted.
 */
export function endTrial(): void {
  try {
    session()?.removeItem(TRIAL_KEY);
  } catch {
    // Same.
  }
}

export function isTrialSession(): boolean {
  try {
    return session()?.getItem(TRIAL_KEY) !== null && session()?.getItem(TRIAL_KEY) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Record that the relay accepted an enrolment for this student.
 *
 * Ends the trial in the same breath, because the thing the trial was waiting
 * for has happened: a parent held a phone, typed a code, and a consent row
 * exists.
 *
 * THE SECOND ARGUMENT EXISTS FOR AN ORDERING TRAP. The enrolment screen has
 * four things to write at once — the profile, the entry path, the tutor
 * language and this mark — and only this call ends the trial. Written in any
 * other order, every write before it happens while isTrialSession() is still
 * true, so the first handed-off guard that lands on the profile or on sync
 * would discard the enrolment's OWN row: the relay accepted, the consent row
 * exists, the student is navigated away, and the device has nothing. Taking
 * the rest of the workspace here makes the trial end first by construction,
 * and leaves one stamp on the row instead of three.
 */
export function markConsented(
  source: ConsentMark['source'],
  rest: Partial<Omit<Workspace, 'version' | 'consent'>> = {},
): Workspace {
  endTrial();
  return writeWorkspace({ ...rest, consent: { source, at: new Date().toISOString() } });
}

/**
 * MAY THIS SESSION WRITE ANYTHING THAT OUTLIVES IT?
 *
 * False in exactly one case: an open trial. In that state the app may show a
 * prepared class and take answers inside the page, and must not write a
 * belief store, a ledger_event, a progress card, an analytics event carrying
 * a stable id, or a preparation — a preparation is about Rs 30 of vendor
 * spend against a person we have no way to contact.
 *
 * WHY A CONSENT MARK IS NOT A WAY OUT OF A TRIAL. It reads as a sensible
 * second clause — "unless this student is enrolled" — and it is a hole.
 * markConsented ends the trial itself (above), so a consented student is
 * never in one; the only state that could reach such a clause is a trial
 * opened on a device that enrolled SOMEBODY ELSE. The consent lives in
 * localStorage and the trial in sessionStorage, so a shared contest kiosk or
 * a family phone produces exactly that pair in a new tab — the second child,
 * whose parent has agreed to nothing, reading a screen that says nothing is
 * kept. The one branch such a clause could ever take is the one it must
 * refuse, so there is no clause.
 *
 * beginTrial answers the mirror image of this — an enrolled student opening
 * the trial door — and answers it the same way: it refuses to guess between
 * two people a device cannot tell apart, and puts the question on the screen.
 * Its docblock has the reasoning.
 *
 * TRUE FOR EVERY OTHER SESSION, AND SAID OUT LOUD SO NOBODY READS MORE INTO
 * IT: this does not claim every writing student has a consent row. Most do
 * not — consent_record has one writer, /api/enroll, and the ordinary
 * onboarding path never calls it. Making this false for them would stop the
 * whole app from keeping a student's work, which is a product decision
 * nobody has taken. What this predicate says is narrower and true: the trial
 * door does not write.
 *
 * NOT VERIFIED that the writers obey it. This is the predicate. One caller
 * lives here — App.tsx suppresses screen_viewed for a trial — and the rest
 * (the ledger, the model store, the progress card, prepareClass, sync) are in
 * files this phase does not own and are listed as handoffs in its report.
 */
export function mayPersist(): boolean {
  return !isTrialSession();
}

/**
 * WHERE A BARE /try GOES, AND WHY IT IS A LESSON RATHER THAN THE CATALOGUE.
 *
 * Two reasons, and the second is money. The catalogue is scoped to a class
 * (Syllabus.tsx:98) and a trial student has none, so /syllabus showed them
 * "pick your class first" pointing at Settings — which the Gate rightly
 * refuses a trial. A bare /try is the obvious thing to print on a poster, and
 * it opened on a dead end.
 *
 * The class named here is the one lesson in content/ that ships with a
 * recording: content/class10-blood/audio/narration.json is the only
 * narration.json in the tree. lib/lessonVoice.ts:146-152 prefers recorded
 * audio, then the on-device voice, then the PAID relay voice — and a trial is
 * by definition the coldest install, so the on-device model has not arrived
 * and an UNRECORDED class falls through to the vendor. This one does not. The
 * catalogue stays reachable from inside the trial; it is just no longer the
 * place a bare link lands.
 *
 * NOT VERIFIED that this is the cheapest trial available end to end: the
 * answer path (lib/ear.ts:205 posts spoken answers to /api/hear) is unmetered
 * by anything this phase owns, and refusing the streaming relay adapter while
 * !mayPersist() is a one-branch change in lib/lessonVoice.ts, which this phase
 * does not own. It is a handoff in this phase's report, not a claim here.
 */
export const TRIAL_HOME = '/lesson/class10-blood';

/**
 * 160, not 80, and the figure is measured rather than guessed: the longest id
 * in content/index.json — class9-science-matter-in-our-surroundings-
 * characteristics-of-particles-of-matter — is EXACTLY 80 characters. Ids are
 * built as class<N>-<subject>-<chapter>-<topic>, so the next topic slug one
 * character longer silently made a valid lesson unreachable, with the link
 * falling back to the catalogue and nothing logged. A bound with no margin is
 * a bound that fails on the next commit to content/.
 */
const SEGMENT = '[A-Za-z0-9_-]{1,160}';
const TRIAL_ROUTES = [
  new RegExp(`^/lesson/${SEGMENT}$`),
  // The catalogue's only way into a lesson (Syllabus.tsx:179). Leaving it out
  // would confine a trial to a screen whose every tap bounced.
  new RegExp(`^/chapter/${SEGMENT}/${SEGMENT}$`),
];

/**
 * EVERYWHERE A TRIAL MAY LAND, and nowhere else.
 *
 * It lives here rather than on the screen because two files must agree on it:
 * the screen sanitises the `next` a link asked for, and the Gate decides
 * whether the session may stay where it navigated to afterwards. When only
 * the screen knew, the allow-list governed the first hop and nothing after
 * it — the bottom bar, a typed URL, or a chapter with no authored lesson
 * reached /class/<topic>, which is a live preparation and about Rs 30 spent
 * on a visitor with no parent and no phone.
 *
 * The catalogue, a chapter inside it, and one already-prepared lesson — the
 * three screens a trial is made of, in the order they are tapped — plus the
 * two doors, /try and /enrol, which are how it is entered and how it is
 * left. Not
 * /class/<topic>, which is the preparation; not /settings, /diagnostic or
 * /progress, which write about the person reading them.
 *
 * NOT /complete/<id> EITHER, AND THAT IS DELIBERATE: LessonComplete writes the
 * progress card (stores/progress.ts saveBeat/markCompleted), which is one of
 * the things this door promises not to write. So a trial that watches a class
 * to the end is refused at the last hop — which is the right refusal and was,
 * until now, a silent one. The Gate carries the refused path to /try so the
 * screen can say what was refused instead of teleporting a child back to the
 * page they already read.
 */
export function isTrialPath(pathname: string): boolean {
  if (pathname === '/syllabus' || pathname === '/try' || pathname === '/enrol') return true;
  return TRIAL_ROUTES.some((route) => route.test(pathname));
}
