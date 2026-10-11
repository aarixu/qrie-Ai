import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/brand';
import { createLocalStore, registeredStores } from '../src/stores/localStore';
import {
  preferencesStore,
  readPreferences,
  setPreference,
  showCaptions,
  type Preferences,
} from '../src/stores/preferences';
import { profileStore } from '../src/stores/profile';
import { subjectsAvailable } from '../src/lib/content';
import { settingsStore } from '../src/stores/settings';
import { Help } from '../src/screens/Help';
import { Settings } from '../src/screens/Settings';

/**
 * Read before anything in this file writes: this is what a student who has
 * never opened Settings gets. Capturing it at import time is the only moment
 * it can be observed, since the store caches after the first read.
 */
const shipped = preferencesStore.get();

/** Both screens sit in the Screen frame, which navigates — so they need a router. */
const render = (screen: ReactElement): string =>
  renderToString(<MemoryRouter>{screen}</MemoryRouter>);

/** React escapes text on the way out; assertions read better against the source copy. */
const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

/** Source with comments stripped — prose may name the product, code may not. */
const codeOf = (relPath: string): string =>
  readFileSync(resolve(process.cwd(), relPath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

/**
 * The one tag that carries a given preference's switch. Found by the label it
 * points at rather than by position, so reordering the rows cannot silently
 * make these assertions test the wrong switch.
 */
const switchFor = (html: string, key: keyof Preferences): string => {
  const at = html.indexOf(`aria-labelledby="pref-${key}"`);
  if (at === -1) throw new Error(`no control is labelled by pref-${key}`);
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

const KLASS = 10;

/** A student who has finished onboarding, which is the only way to reach Settings. */
const asStudent = (preferences: Preferences): void => {
  profileStore.set({
    name: 'Test student',
    klass: KLASS,
    subjects: [subjectsAvailable(KLASS)[0]],
    diagnostic: null,
    diagnosedAt: null,
  });
  settingsStore.set({ klass: KLASS });
  for (const [key, value] of Object.entries(preferences)) {
    setPreference(key as keyof Preferences, value);
  }
};

describe('preferences store', () => {
  // Aarav, 2026-10-01: captions leave the board and stay only as a setting,
  // off by default.
  it('ships with sound on, captions off and autoplay off', () => {
    expect(shipped).toEqual({
      theme: 'system',
      voice: true,
      captions: false,
      autoplayNext: false,
      reducedMotion: false,
    });
  });

  /**
   * Captions came on by default until 2026-10-01, so a stored `captions: true`
   * from before then is the old default, not a choice. It reads as off — on
   * this device, and when sync brings the value in from another one.
   */
  it('reads a stored value from before the change with captions off', () => {
    const before = { theme: 'dark' as const, voice: true, captions: true, autoplayNext: true, reducedMotion: false };
    expect(readPreferences(before)).toEqual({ ...before, captions: false });
    // As sync writes it: straight into the registered store, over the cache.
    registeredStores().get('ai-tutor:preferences')!.set(before);
    expect(preferencesStore.get().captions).toBe(false);
    expect(preferencesStore.get().theme).toBe('dark');
  });

  it('keeps captions on once the student has turned them on in Settings', () => {
    registeredStores().get('ai-tutor:preferences')!.set({ ...shipped, captions: true });
    setPreference('captions', true);
    // Another preference written afterwards does not undo the choice.
    setPreference('autoplayNext', false);
    expect(preferencesStore.get().captions).toBe(true);
    const reopened = createLocalStore<Record<string, unknown>>('ai-tutor:preferences', {});
    expect(readPreferences(reopened.get()).captions).toBe(true);
    setPreference('captions', false);
    expect(preferencesStore.get().captions).toBe(false);
  });

  // A silent class with no words on screen says nothing at all: with her
  // voice off, what she says is shown with the board whatever the switch.
  it('shows captions when the student asked for them, or when her voice is off', () => {
    expect(showCaptions({ ...shipped, captions: false, voice: true })).toBe(false);
    expect(showCaptions({ ...shipped, captions: true, voice: true })).toBe(true);
    expect(showCaptions({ ...shipped, captions: false, voice: false })).toBe(true);
  });

  it('round-trips a change through storage, so a later session reads it back', () => {
    setPreference('autoplayNext', true);
    setPreference('voice', false);

    // A fresh store over the same key is the next visit to the app.
    const reopened = createLocalStore<Preferences>('ai-tutor:preferences', shipped);

    expect(reopened.get().autoplayNext).toBe(true);
    expect(reopened.get().voice).toBe(false);
  });

  it('writes one preference without disturbing the others', () => {
    setPreference('voice', true);
    setPreference('captions', true);
    setPreference('reducedMotion', true);

    expect(preferencesStore.get()).toEqual({
      theme: 'system',
      voice: true,
      captions: true,
      autoplayNext: true,
      reducedMotion: true,
    });
  });
});

describe('Settings', () => {
  const html = (() => {
    asStudent({ theme: 'system', voice: true, captions: false, autoplayNext: false, reducedMotion: true });
    return decode(render(<Settings />));
  })();

  it('groups the screen under every section heading', () => {
    for (const heading of ['Learning', 'Playback', 'About', 'Danger zone']) {
      expect(html).toContain(`>${heading}</h2>`);
    }
  });

  it('shows the class the student is in', () => {
    expect(html).toContain(`Class ${KLASS}`);
  });

  it('offers the subjects of that class as chips, marking the chosen ones', () => {
    for (const subject of subjectsAvailable(KLASS)) expect(html).toContain(`>${subject}</button>`);
    // The student picked exactly one, so exactly one chip is pressed.
    expect(html.split('aria-pressed="true"').length - 1).toBe(1);
  });

  it('renders a switch for each playback preference', () => {
    for (const key of ['voice', 'captions', 'autoplayNext', 'reducedMotion'] as const) {
      expect(switchFor(html, key)).toContain('role="switch"');
    }
  });

  // The switch is the only place captions are turned on (2026-10-01).
  // Under the board upright, along its bottom edge sideways, where the full-screen
  // board leaves no 'beside' (integration audit, 2026-10-11).
  it('says where captions go: under the board, along its bottom edge when the phone is sideways', () => {
    expect(html).toContain('under the board (along its bottom edge when your phone is sideways)');
    expect(html).not.toContain('beside the board');
  });

  it('reports each switch as checked exactly when the stored preference is on', () => {
    expect(switchFor(html, 'voice')).toContain('aria-checked="true"');
    expect(switchFor(html, 'captions')).toContain('aria-checked="false"');
    expect(switchFor(html, 'autoplayNext')).toContain('aria-checked="false"');
    expect(switchFor(html, 'reducedMotion')).toContain('aria-checked="true"');
  });

  it('follows the store rather than a fixed set of defaults', () => {
    asStudent({ theme: 'system', voice: false, captions: true, autoplayNext: true, reducedMotion: false });
    const flipped = decode(render(<Settings />));

    expect(switchFor(flipped, 'voice')).toContain('aria-checked="false"');
    expect(switchFor(flipped, 'captions')).toContain('aria-checked="true"');
    expect(switchFor(flipped, 'autoplayNext')).toContain('aria-checked="true"');
    expect(switchFor(flipped, 'reducedMotion')).toContain('aria-checked="false"');
  });

  it('offers the reset, behind a confirm step rather than one tap', () => {
    expect(html).toContain('Reset progress');
    // The destructive wording only appears once the student has asked for it.
    expect(html).not.toContain('Yes, reset');
  });

  it('links to help and names the version', () => {
    expect(html).toContain('version ');
    expect(html).toContain(BRAND.name);
  });

  it('names the product nowhere in its own code', () => {
    expect(codeOf('apps/classroom/src/screens/Settings.tsx')).not.toContain(BRAND.name);
  });
});

describe('Help', () => {
  const html = decode(render(<Help />));

  it('explains the recorded class and the raised hand', () => {
    expect(html).toContain('How it works');
    expect(html).toContain('raise your hand');
  });

  it('asks and answers the questions a student actually has', () => {
    for (const question of [
      'What is the placement test for?',
      'Why does it not tell me if I got a question right?',
      'What happens when I raise my hand?',
      'How does the streak work?',
      'How do I change my class?',
      'Where is my progress saved?',
    ]) {
      expect(html).toContain(question);
    }
  });

  it('builds the FAQ from native details/summary, one summary per question', () => {
    // Counted against each other rather than against a number somebody has to
    // remember to update: the invariant is one summary per details, not eight.
    const details = html.split('<details').length - 1;

    expect(details).toBeGreaterThan(5);
    expect(html.split('<summary').length - 1).toBe(details);
  });

  it('puts a way to reach a person above everything else on the page', () => {
    // A student who opens Help because something is wrong should not have to
    // read about streaks first.
    expect(html).toContain('If you need to talk to a person');
    expect(html.indexOf('If you need to talk to a person')).toBeLessThan(
      html.indexOf('How it works'),
    );
    expect(html).toContain('tel:14416');
    expect(html).toContain('tel:1098');
  });

  it('no longer tells a student there are no accounts', () => {
    // There are: signing in is what carries progress to another phone. A help
    // page that describes a version of the app that no longer exists is worse
    // than no help page.
    expect(html).not.toContain('There are no accounts yet');
  });

  it('points the student at Settings to change anything', () => {
    expect(html).toContain('Settings');
  });

  it('takes the product name from BRAND, never a literal in the screen', () => {
    expect(html).toContain(BRAND.name);
    expect(codeOf('apps/classroom/src/screens/Help.tsx')).not.toContain(BRAND.name);
  });
});
