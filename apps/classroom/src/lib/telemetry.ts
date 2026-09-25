/**
 * CRASH REPORTING AND PRODUCT ANALYTICS, BEHIND ONE DOOR.
 *
 * Two questions this answers and nothing else does: what is breaking for
 * students I will never meet, and which parts of the product they actually
 * use. Without the first, a white screen on a ₹10,000 Android is an uninstall
 * nobody hears about. Without the second, every decision about what to build
 * next is a guess.
 *
 * WHY THIS TALKS HTTP INSTEAD OF USING THE SDKS. @sentry/browser and
 * posthog-js are about 55 kB gzipped together, on a product whose entry chunk
 * was just cut from 429 kB to 122 kB for exactly the phones this is for.
 * Neither service needs a library: both take a JSON POST, and the twenty lines
 * that build it are cheaper to read than a dependency is to audit. Swapping to
 * an official SDK later is this one file — ARCHITECTURE.md's rule, and the same
 * shape lib/supabase.ts and packages/relay already use.
 *
 * WHAT NEVER LEAVES THE DEVICE. This app is used by children, and it already
 * committed to that in apps/agent/src/worker.ts: "their voices and their doubts
 * do not leave the room they were spoken in." So:
 *
 *   - no transcript, no typed doubt, no answer, no free text of ANY kind;
 *   - no name, no email, no Supabase user id;
 *   - an install id that is random, local, and tied to nothing.
 *
 * Events carry counts, ids of our own content, and enums. `track` refuses
 * anything else — see `clean`.
 *
 * UNSET IS A COMPLETE NO-OP. With no DSN and no key nothing initialises,
 * nothing is queued, and no request is ever made. That is the state the app
 * ships in today.
 */

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
/**
 * `||`, not `??`.
 *
 * .env.example ships these blank, and Vite inlines a blank var as the EMPTY
 * STRING rather than undefined — which `??` keeps. That sent every event to
 * "/capture/" on the app's own origin, where nothing is listening, and lost
 * all of them silently.
 */
const POSTHOG_HOST = (
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://eu.i.posthog.com'
).replace(/\/+$/, '');

/** Stamped on every report, so a crash can be traced to a build. */
const RELEASE = (import.meta.env.VITE_RELEASE as string | undefined) || 'dev';

// ---------------------------------------------------------------------------
// Who, anonymously
// ---------------------------------------------------------------------------

const INSTALL_KEY = 'telemetry:install';

/**
 * A random id for this installation.
 *
 * NOT the Supabase user id, deliberately. Sentry needs something stable to
 * answer "how many students hit this", and analytics needs something to count
 * sessions by — neither needs to know WHO, and under DPDP a child's account id
 * in a third-party service is a thing to justify rather than a thing to
 * default to. Clearing browser data resets it, which is the correct amount of
 * permanence for a number whose only job is grouping.
 */
function installId(): string {
  try {
    const seen = localStorage.getItem(INSTALL_KEY);
    if (seen) return seen;
    const made = crypto.randomUUID();
    localStorage.setItem(INSTALL_KEY, made);
    return made;
  } catch {
    // Private mode, or storage blocked. An id that lasts one session is worth
    // more than no report at all.
    return 'unstored';
  }
}

// ---------------------------------------------------------------------------
// Sentry
// ---------------------------------------------------------------------------

interface Dsn {
  host: string;
  projectId: string;
  publicKey: string;
}

/**
 * Pull a DSN apart. `https://<publicKey>@<host>/<projectId>`.
 *
 * Null for anything that is not one, rather than a throw: a mistyped DSN in an
 * environment file must not be the thing that stops the app booting.
 */
export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\/+/, '');
    if (!url.username || !url.host || !projectId) return null;
    return { host: url.host, projectId, publicKey: url.username };
  } catch {
    return null;
  }
}

interface Frame {
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
}

/**
 * Turn a stack string into frames Sentry can group by.
 *
 * Loose on purpose. Every browser writes this differently and a parser that
 * insists on one shape reports nothing on the others; a frame that comes out
 * as just a filename still groups better than no frames at all. Sentry accepts
 * an event with none, so nothing here can cost a report.
 */
export function framesFrom(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  // Not slice(1): Chrome opens with "Error: message" and Firefox and Safari
  // open with the innermost frame. Dropping line zero regardless threw away
  // the frame that says where it actually broke, on two engines out of three.
  // A header line simply parses as nothing and falls out on its own.
  for (const line of stack.split('\n').slice(0, 31)) {
    const at = /at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line.trim());
    if (at) {
      frames.push({
        function: at[1] ?? '?',
        filename: at[2],
        lineno: Number(at[3]),
        colno: Number(at[4]),
      });
      continue;
    }
    // Firefox and Safari: "fn@url:line:col"
    const alt = /^(.*?)@(.+?):(\d+):(\d+)$/.exec(line.trim());
    if (alt) {
      frames.push({
        function: alt[1] || '?',
        filename: alt[2],
        lineno: Number(alt[3]),
        colno: Number(alt[4]),
      });
    }
  }
  // Sentry draws the most recent call last.
  return frames.reverse();
}

/** The envelope body Sentry's ingest endpoint takes. Exported for its tests. */
export function buildEnvelope(
  eventId: string,
  error: Error,
  extra: Record<string, unknown>,
  at: string,
): string {
  const event = {
    event_id: eventId,
    timestamp: at,
    platform: 'javascript',
    level: 'error',
    release: RELEASE,
    environment: import.meta.env.PROD ? 'production' : 'development',
    user: { id: installId() },
    request: {
      // The PATH, never the query string: a free-text class carries the
      // student's own words in ?topic=, and this file does not send those.
      url: typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}`,
    },
    exception: {
      values: [
        {
          type: error.name || 'Error',
          value: String(error.message).slice(0, 500),
          stacktrace: { frames: framesFrom(error.stack) },
        },
      ],
    },
    extra,
  };

  return [
    JSON.stringify({ event_id: eventId, sent_at: at }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// What a property may be
// ---------------------------------------------------------------------------

/**
 * Numbers, booleans and SHORT strings that are ours.
 *
 * The whole risk of product analytics in a child-facing app is that somebody
 * one day passes `{ answer: heard.text }` and a fourteen-year-old's spoken
 * words go to a third party. So a property is dropped unless it is a number,
 * a boolean, or a string short enough to be an id or an enum — 64 characters,
 * which is longer than every lesson id and shorter than every sentence.
 *
 * Dropped rather than truncated: a truncated sentence is still a sentence.
 */
export const MAX_PROPERTY_LENGTH = 64;

export function clean(props: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string' && value.length > 0 && value.length <= MAX_PROPERTY_LENGTH) {
      out[key] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

let sentry: Dsn | null = null;
let started = false;

/**
 * Post and forget.
 *
 * `keepalive` so a report survives the navigation that caused it, and every
 * failure is swallowed: telemetry that can break the app is worse than no
 * telemetry. Nothing awaits this.
 */
function send(url: string, body: string, type = 'application/json'): void {
  try {
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': type },
      body,
      keepalive: true,
      // Nothing here needs a cookie, and sending none is one less thing to
      // explain in a privacy policy.
      credentials: 'omit',
    }).catch(() => {});
  } catch {
    // fetch itself missing, or blocked. Nothing to do.
  }
}

/**
 * Report a crash.
 *
 * Safe to call before init and safe to call when nothing is configured: both
 * do nothing at all. Never throws — the ErrorBoundary calls this from inside
 * componentDidCatch, and a reporter that throws would replace the error it was
 * reporting.
 */
export function reportCrash(error: Error, extra: Record<string, unknown> = {}): void {
  if (!sentry) return;
  try {
    const at = new Date().toISOString();
    send(
      `https://${sentry.host}/api/${sentry.projectId}/envelope/?sentry_key=${sentry.publicKey}&sentry_version=7`,
      buildEnvelope(crypto.randomUUID().replace(/-/g, ''), error, clean(extra), at),
      'application/x-sentry-envelope',
    );
  } catch {
    // Reporting a crash must never cause one.
  }
}

/**
 * Record that something happened.
 *
 * `props` is filtered by `clean`, which is the load-bearing part: it is what
 * stops a student's words reaching an analytics service by accident. Read its
 * comment before adding a property.
 */
export function track(event: string, props: Record<string, unknown> = {}): void {
  if (!POSTHOG_KEY) return;
  try {
    send(
      `${POSTHOG_HOST}/capture/`,
      JSON.stringify({
        api_key: POSTHOG_KEY,
        event,
        distinct_id: installId(),
        properties: { ...clean(props), $lib: 'qrie', release: RELEASE },
        timestamp: new Date().toISOString(),
      }),
    );
  } catch {
    // Analytics is never worth an exception.
  }
}

/**
 * Start watching. Called once, early in main.tsx.
 *
 * The two global handlers are the point of doing this here rather than only in
 * the ErrorBoundary: React's componentDidCatch sees render-phase errors and
 * nothing else, so every rejected promise in this app — a prep that failed, a
 * relay that 500'd, a sync that could not reach Supabase — was invisible.
 */
export function initTelemetry(): void {
  if (started) return;
  started = true;

  sentry = parseDsn(SENTRY_DSN);
  if (!sentry && !POSTHOG_KEY) return;

  if (typeof window === 'undefined') return;

  window.addEventListener('error', (e) => {
    if (e.error instanceof Error) reportCrash(e.error, { kind: 'window.onerror' });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason: unknown = e.reason;
    reportCrash(
      reason instanceof Error ? reason : new Error(String(reason).slice(0, 200)),
      { kind: 'unhandledrejection' },
    );
  });
}

/** Whether anything is watching. For tests, and for the Settings screen. */
export const telemetryConfigured = (): boolean =>
  parseDsn(SENTRY_DSN) !== null || Boolean(POSTHOG_KEY);
