import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLASSROOM_BUILD,
  CLASSROOM_DEFAULTS,
  __resetAppConfigForTests,
  applyAppConfig,
  getAppConfig,
  isBelowMinimum,
  parseClassroomConfig,
  refreshAppConfig,
  startAppConfig,
  subscribeAppConfig,
} from '../src/lib/appConfig';
import { PROTOTYPE_ONLY_PREPARED, isFrozen } from '../src/lib/prototype';

/**
 * THE TUTOR READS QRIE CONTROL (plan 4). Written first.
 *
 * A module-level store of what public.my_app_config said, parsed key by key
 * with a safe default for each; a failed read keeps the last good values, and
 * before any read the defaults turn nothing on (the tutor's only_prepared is
 * on, R4). tutor.only_prepared sets the gate every screen reads.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

beforeEach(() => {
  __resetAppConfigForTests();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetAppConfigForTests();
});

describe('the build and the defaults', () => {
  it("the build is package.json's version", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')) as { version: string };
    expect(CLASSROOM_BUILD).toBe(pkg.version);
    expect(CLASSROOM_BUILD).toBe('0.1.0');
  });

  it("the safe defaults are the table's", () => {
    expect(CLASSROOM_DEFAULTS).toEqual({
      bannerMessage: '',
      bannerTone: 'info',
      tutorEnabled: true,
      onlyPrepared: true,
      composeLiveClasses: false,
      minVersion: '0.0.0',
    });
    expect(getAppConfig()).toEqual(CLASSROOM_DEFAULTS);
  });

  it('parsing takes each key of the right type, else its default', () => {
    expect(
      parseClassroomConfig({
        'banner.message': 'Back at 7',
        'banner.tone': 'warning',
        'tutor.enabled': false,
        'tutor.only_prepared': false,
        'tutor.compose_live_classes': true,
        'app.min_version.classroom': '0.2.0',
        'billing.state': 'ok',
      }),
    ).toEqual({
      bannerMessage: 'Back at 7',
      bannerTone: 'warning',
      tutorEnabled: false,
      onlyPrepared: false,
      composeLiveClasses: true,
      minVersion: '0.2.0',
    });
    const wrongTypes = parseClassroomConfig({ 'tutor.enabled': 'false', 'tutor.only_prepared': 0 });
    expect(wrongTypes.tutorEnabled).toBe(true);
    expect(wrongTypes.onlyPrepared).toBe(true);
    expect(parseClassroomConfig(null)).toEqual(CLASSROOM_DEFAULTS);
    // What prototypeGate.test.tsx's fetch stub answers for everything but the catalogue.
    expect(parseClassroomConfig({ states: {} })).toEqual(CLASSROOM_DEFAULTS);
  });
});

describe('the switches take effect', () => {
  it('tutor.only_prepared from the console sets the gate every screen reads', () => {
    expect(PROTOTYPE_ONLY_PREPARED).toBe(true);
    applyAppConfig({ 'tutor.only_prepared': false });
    expect(PROTOTYPE_ONLY_PREPARED).toBe(false);
    expect(isFrozen('not-yet')).toBe(false);
    applyAppConfig({});
    expect(PROTOTYPE_ONLY_PREPARED).toBe(true);
    expect(isFrozen('not-yet')).toBe(true);
  });

  it('a failed read keeps the last good values; with none, the safe defaults', async () => {
    await refreshAppConfig(async () => {
      throw new Error('offline');
    });
    expect(getAppConfig()).toEqual(CLASSROOM_DEFAULTS);
    await refreshAppConfig(async () => ({ 'tutor.enabled': false }));
    expect(getAppConfig().tutorEnabled).toBe(false);
    await refreshAppConfig(async () => {
      throw new Error('offline');
    });
    expect(getAppConfig().tutorEnabled).toBe(false);
  });

  it('a read that never answers counts as failed after 8 seconds', async () => {
    vi.useFakeTimers();
    applyAppConfig({ 'banner.message': 'kept' });
    const pending = refreshAppConfig(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(pending).resolves.toBeUndefined();
    expect(getAppConfig().bannerMessage).toBe('kept');
  });

  it('it reads at start, every five minutes, when the app is shown again, and when the network comes back; and stops', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const read = vi.fn(async () => ({}));
    const stop = startAppConfig(read);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(read).toHaveBeenCalledTimes(2);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(read).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new Event('online'));
    expect(read).toHaveBeenCalledTimes(4);
    stop();
    await vi.advanceTimersByTimeAsync(300_000);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('subscribers hear a change and only a change', () => {
    const heard = vi.fn();
    const unsubscribe = subscribeAppConfig(heard);
    applyAppConfig({ 'banner.message': 'Back at 7' });
    applyAppConfig({ 'banner.message': 'Back at 7' });
    expect(heard).toHaveBeenCalledTimes(1);
    unsubscribe();
    applyAppConfig({ 'banner.message': 'Later' });
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe('the minimum build', () => {
  it("the version check is the same rule as the school apps'", () => {
    expect(isBelowMinimum('0.1.0', '0.1.1')).toBe(true);
    expect(isBelowMinimum('2.3.0', '10.0.0')).toBe(true);
    expect(isBelowMinimum('0.1.0', '0.1.0')).toBe(false);
    expect(isBelowMinimum('0.1.0', '0.0.0')).toBe(false);
    expect(isBelowMinimum('0.2.0', '0.1.9')).toBe(false);
    for (const minimum of ['0.2', '', null, 'v9.9.9']) {
      expect(isBelowMinimum('0.1.0', minimum), String(minimum)).toBe(false);
    }
    expect(isBelowMinimum('bad', '9.9.9')).toBe(false);
  });
});

describe('importing it', () => {
  it('importing the module starts nothing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.resetModules();
    await import('../src/lib/appConfig');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
