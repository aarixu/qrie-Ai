import { createLocalStore, type Store } from './localStore';
import type { Theme } from '../lib/theme';

/**
 * How the student wants the app to behave. Deliberately small: every switch
 * here is one the app can actually act on with the code it already has — a
 * language picker would be a promise we cannot keep, and a switch that does
 * nothing is worse than no switch at all.
 *
 * Kept out of `settings` (the app's identity-ish state, read by older screens)
 * so a new playback preference never forces those screens to change.
 */
export interface Preferences {
  /** Light, dark, or follow the OS. Applied by lib/theme via App. */
  theme: Theme;
  /**
   * The tutor reads the lesson aloud. Off leaves a silent class, and then her
   * words are shown as captions whatever `captions` says (`showCaptions`).
   */
  voice: boolean;
  /**
   * Show what she says as text, in a strip beside the board — never on it
   * (screens/ClassRoom.tsx). Off by default since 2026-10-01: Aarav's board
   * carries no subtitles, and captions stay only as this setting.
   */
  captions: boolean;
  /** Roll into the next lesson when one finishes, instead of stopping. */
  autoplayNext: boolean;
  /**
   * A student override on top of the OS setting. It can only ever quieten
   * motion: the stylesheet already honours `prefers-reduced-motion`, and this
   * adds the students whose device does not ask on their behalf.
   */
  reducedMotion: boolean;
}

/**
 * What is actually stored: the preferences, plus whether the captions switch
 * holds the student's own choice.
 *
 * Captions came on by default until 2026-10-01, so a stored `captions: true`
 * written before then is the old default, not something the student chose —
 * and existing students are to start with captions off too (Aarav's decision).
 * Without this mark there is no telling the two apart, so a value without it
 * reads with captions off. Only the captions switch in Settings sets it
 * (`setPreference('captions', …)`).
 */
interface Stored extends Preferences {
  captionsChosen?: true;
}

/**
 * Sound starts on because that is the class as it was taught; captions and
 * autoplay start off — captions because the board is the thing to watch
 * (Aarav, 2026-10-01), autoplay because moving a student on without asking is
 * the one default that takes control away rather than giving it.
 */
const DEFAULTS: Preferences = {
  // System, because the student already told their phone which room they like.
  theme: 'system',
  voice: true,
  captions: false,
  autoplayNext: false,
  reducedMotion: false,
};

/**
 * The stored value. Registered for sync under this key like every store, so a
 * value from another device lands here as it was written there — which is why
 * the captions rule is applied when a value is READ (`readPreferences`), not
 * once when it was migrated.
 */
const stored = createLocalStore<Stored>('ai-tutor:preferences', DEFAULTS);

/**
 * What a stored value means today: the defaults under it, and captions on only
 * where the student turned them on themselves.
 */
export function readPreferences(value: Partial<Stored>): Preferences {
  const { captionsChosen, ...rest } = value;
  return { ...DEFAULTS, ...rest, captions: captionsChosen === true && rest.captions === true };
}

/**
 * The same object back for the same stored value: React's store hook compares
 * snapshots by identity, and a fresh object on every read re-renders forever.
 */
let lastStored: Stored | undefined;
let lastRead: Preferences = DEFAULTS;
const read = (): Preferences => {
  const value = stored.get();
  if (value !== lastStored) {
    lastStored = value;
    lastRead = readPreferences(value);
  }
  return lastRead;
};

/** A whole value written here keeps the captions mark the stored one carries. */
const write = (next: Preferences): void =>
  stored.set({ ...next, ...(stored.get().captionsChosen === true ? { captionsChosen: true as const } : {}) });

export const preferencesStore: Store<Preferences> = {
  get: read,
  set: write,
  update: (fn) => write(fn(read())),
  subscribe: (cb) => stored.subscribe(cb),
};

/** Write one preference, leaving the rest alone. */
export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  // Defaults are spread first so a value stored before a preference existed
  // gains that key on the next write rather than reading back as undefined.
  // The captions switch is the student's own choice from here on.
  const chosen = key === 'captions' || stored.get().captionsChosen === true;
  stored.set({ ...DEFAULTS, ...read(), [key]: value, ...(chosen ? { captionsChosen: true as const } : {}) });
}

/**
 * Whether the class shows her words as text. With her voice off nothing else
 * carries them, so they are shown then whatever the captions switch says.
 */
export function showCaptions(preferences: Preferences): boolean {
  return preferences.captions || !preferences.voice;
}
