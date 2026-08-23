import { createLocalStore } from './localStore';

/**
 * How the student wants a class to play. Deliberately small: every switch here
 * is one the app can actually act on with the code it already has — a theme
 * switch or a language picker would be a promise we cannot keep, and a switch
 * that does nothing is worse than no switch at all.
 *
 * Kept out of `settings` (the app's identity-ish state, read by older screens)
 * so a new playback preference never forces those screens to change.
 */
export interface Preferences {
  /** The tutor reads the lesson aloud. Off leaves a silent, captioned class. */
  voice: boolean;
  /** Show the narration as text under the stage. */
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
 * Sound and captions start on because that is the class as it was taught;
 * autoplay starts off because moving a student on without asking is the one
 * default that takes control away rather than giving it.
 */
const DEFAULTS: Preferences = {
  voice: true,
  captions: true,
  autoplayNext: false,
  reducedMotion: false,
};

export const preferencesStore = createLocalStore<Preferences>('ai-tutor:preferences', DEFAULTS);

/** Write one preference, leaving the rest alone. */
export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  // Defaults are spread first so a value stored before a preference existed
  // gains that key on the next write rather than reading back as undefined.
  preferencesStore.update((current) => ({ ...DEFAULTS, ...current, [key]: value }));
}
