import { Capacitor } from '@capacitor/core';

/**
 * WHERE THIS COPY OF THE APP IS RUNNING.
 *
 * One question, asked in one place. The app is the same code in a browser and
 * inside the native shell — that is the whole point of Capacitor — but three
 * things genuinely differ, and each of them is a one-line answer rather than a
 * second implementation:
 *
 *   - the ROUTER, because a native shell has no server to hand index.html back
 *     for a deep path;
 *   - the SERVICE WORKER, which caches assets that are already on the phone;
 *   - the RELAY URL, because a relative path inside the shell resolves against
 *     the app's own scheme, where nothing is listening.
 *
 * Nothing else in the app imports @capacitor/core, so a test can stub this
 * module and none of them has to know a native shell exists.
 */

/** True inside the Android or iOS shell; false in any browser. */
export const isNative = (): boolean => Capacitor.isNativePlatform();

/** 'android' | 'ios' | 'web'. For the few places that need to tell them apart. */
export const platform = (): string => Capacitor.getPlatform();
