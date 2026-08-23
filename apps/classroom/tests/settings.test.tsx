import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/brand';
import { createLocalStore } from '../src/stores/localStore';
import { preferencesStore, setPreference, type Preferences } from '../src/stores/preferences';
import { profileStore, SUBJECTS_BY_CLASS } from '../src/stores/profile';
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
    subjects: [SUBJECTS_BY_CLASS[KLASS][0]],
    diagnostic: null,
    diagnosedAt: null,
  });
  settingsStore.set({ klass: KLASS });
  for (const [key, value] of Object.entries(preferences)) {
    setPreference(key as keyof Preferences, value);
  }
};

describe('preferences store', () => {
  it('ships with sound and captions on and autoplay off', () => {
    expect(shipped).toEqual({
      voice: true,
      captions: true,
      autoplayNext: false,
      reducedMotion: false,
    });
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
      voice: true,
      captions: true,
      autoplayNext: true,
      reducedMotion: true,
    });
  });
});

describe('Settings', () => {
  const html = (() => {
    asStudent({ voice: true, captions: false, autoplayNext: false, reducedMotion: true });
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
    for (const subject of SUBJECTS_BY_CLASS[KLASS]) expect(html).toContain(`>${subject}</button>`);
    // The student picked exactly one, so exactly one chip is pressed.
    expect(html.split('aria-pressed="true"').length - 1).toBe(1);
  });

  it('renders a switch for each playback preference', () => {
    for (const key of ['voice', 'captions', 'autoplayNext', 'reducedMotion'] as const) {
      expect(switchFor(html, key)).toContain('role="switch"');
    }
  });

  it('reports each switch as checked exactly when the stored preference is on', () => {
    expect(switchFor(html, 'voice')).toContain('aria-checked="true"');
    expect(switchFor(html, 'captions')).toContain('aria-checked="false"');
    expect(switchFor(html, 'autoplayNext')).toContain('aria-checked="false"');
    expect(switchFor(html, 'reducedMotion')).toContain('aria-checked="true"');
  });

  it('follows the store rather than a fixed set of defaults', () => {
    asStudent({ voice: false, captions: true, autoplayNext: true, reducedMotion: false });
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
    expect(html.split('<details').length - 1).toBe(6);
    expect(html.split('<summary').length - 1).toBe(6);
  });

  it('points the student at Settings to change anything', () => {
    expect(html).toContain('Settings');
  });

  it('takes the product name from BRAND, never a literal in the screen', () => {
    expect(html).toContain(BRAND.name);
    expect(codeOf('apps/classroom/src/screens/Help.tsx')).not.toContain(BRAND.name);
  });
});
