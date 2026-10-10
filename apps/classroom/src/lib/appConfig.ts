import { useSyncExternalStore } from 'react';
import { setOnlyPrepared } from './prototype';

/**
 * WHAT QRIE CONTROL TELLS THE TUTOR, and what the tutor assumes when it cannot
 * ask.
 *
 * The console's switches reach this app through public.my_app_config (read by
 * lib/appConfigRead.ts): the banner, whether the tutor is on for this learner,
 * "only prepared classes", the board composer's switch and the oldest build
 * allowed to run. This module keeps the last answer in memory for the session
 * (R5), parses it key by key, and falls back to a safe default for any key it
 * cannot read. A failed read keeps the last good values; before any read
 * succeeds, the defaults below apply, and none of them turns anything on.
 *
 * Nothing starts on import: main.tsx calls startAppConfig.
 */

/** This build's number, which Qrie control's app.min_version.classroom compares. Keep it equal to package.json (a test checks). */
export const CLASSROOM_BUILD = '0.1.0';

export interface ClassroomConfig {
  bannerMessage: string;
  bannerTone: 'info' | 'warning';
  tutorEnabled: boolean;
  onlyPrepared: boolean;
  composeLiveClasses: boolean;
  minVersion: string;
}

/** Before the first good read, and for any key a read gets wrong. */
export const CLASSROOM_DEFAULTS: ClassroomConfig = Object.freeze({
  // No notice.
  bannerMessage: '',
  bannerTone: 'info',
  // The app's belief turns nothing on: claim_relay refuses a class itself when
  // the switch is off (migration 0064). false here would show every child a
  // pause whenever the read failed.
  tutorEnabled: true,
  // "Cannot read" must not mean "prepare new classes and spend" (R4).
  onlyPrepared: true,
  // No screen on this branch reads it (R7).
  composeLiveClasses: false,
  // Nobody is asked to update.
  minVersion: '0.0.0',
}) as ClassroomConfig;

/**
 * Three whole numbers of up to four digits each, as admin.flag_valid's
 * 'version' kind (0062). The same code as packages/lms-client/src/app-config.ts,
 * copied so this module ports to the live tutor branch with no new dependency.
 */
const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

export function parseVersion(v: unknown): [number, number, number] | null {
  const m = typeof v === 'string' ? VERSION.exec(v) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True only when both are well formed and the build is older: a typo never locks anyone out. */
export function isBelowMinimum(build: string, minimum: unknown): boolean {
  const b = parseVersion(build);
  const m = parseVersion(minimum);
  if (!b || !m) return false;
  for (let i = 0; i < 3; i += 1) if (b[i] !== m[i]) return b[i] < m[i];
  return false;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Each key the tutor reads, when it has the right type, else that key's default. */
export function parseClassroomConfig(raw: unknown): ClassroomConfig {
  if (!isObject(raw)) return { ...CLASSROOM_DEFAULTS };
  const bool = (key: string, fallback: boolean) => (typeof raw[key] === 'boolean' ? (raw[key] as boolean) : fallback);
  const tone = raw['banner.tone'];
  const message = raw['banner.message'];
  const minimum = raw['app.min_version.classroom'];
  return {
    bannerMessage: typeof message === 'string' ? message : CLASSROOM_DEFAULTS.bannerMessage,
    bannerTone: tone === 'info' || tone === 'warning' ? tone : CLASSROOM_DEFAULTS.bannerTone,
    tutorEnabled: bool('tutor.enabled', CLASSROOM_DEFAULTS.tutorEnabled),
    onlyPrepared: bool('tutor.only_prepared', CLASSROOM_DEFAULTS.onlyPrepared),
    composeLiveClasses: bool('tutor.compose_live_classes', CLASSROOM_DEFAULTS.composeLiveClasses),
    minVersion: typeof minimum === 'string' ? minimum : CLASSROOM_DEFAULTS.minVersion,
  };
}

let current: ClassroomConfig = CLASSROOM_DEFAULTS;
const listeners = new Set<() => void>();

export const getAppConfig = (): ClassroomConfig => current;

export function subscribeAppConfig(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The config, re-rendering the caller whenever it changes. */
export const useAppConfig = (): ClassroomConfig => useSyncExternalStore(subscribeAppConfig, getAppConfig);

/** Parses one answer and, if anything differs, makes it current and tells every subscriber. */
export function applyAppConfig(raw: unknown): void {
  const next = parseClassroomConfig(raw);
  const same = (Object.keys(next) as (keyof ClassroomConfig)[]).every((k) => next[k] === current[k]);
  if (same) return;
  current = next;
  setOnlyPrepared(current.onlyPrepared);
  for (const fn of [...listeners]) fn();
}

const TIMED_OUT = Symbol('timed out');

/**
 * One read. An answer that is not an object, an error, or no answer within
 * `timeoutMs` is a failed read, and a failed read keeps the current values.
 */
export async function refreshAppConfig(read: () => Promise<unknown>, timeoutMs = 8_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  try {
    const raw = await Promise.race([read(), timeout]);
    if (raw !== TIMED_OUT && isObject(raw)) applyAppConfig(raw);
  } catch {
    // Keep what we have: the last good values, or the defaults.
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads now, every `everyMs`, when the app is shown again and when the
 * network comes back. Returns the function that stops all of it.
 */
export function startAppConfig(read: () => Promise<unknown>, everyMs = 300_000): () => void {
  const go = () => void refreshAppConfig(read);
  go();
  const timer = setInterval(go, everyMs);
  const onVisible = () => {
    if (document.visibilityState === 'visible') go();
  };
  const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';
  if (hasDom) {
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', go);
  }
  return () => {
    clearInterval(timer);
    if (hasDom) {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', go);
    }
  };
}

/** Back to the defaults with no subscriber, for tests. */
export function __resetAppConfigForTests(): void {
  current = CLASSROOM_DEFAULTS;
  listeners.clear();
  setOnlyPrepared(CLASSROOM_DEFAULTS.onlyPrepared);
}
