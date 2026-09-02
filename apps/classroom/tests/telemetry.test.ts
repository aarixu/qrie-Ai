import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_PROPERTY_LENGTH,
  buildEnvelope,
  clean,
  framesFrom,
  parseDsn,
  reportCrash,
  telemetryConfigured,
  track,
} from '../src/lib/telemetry';

/**
 * The one thing that must never happen here is a student's words leaving the
 * device. This app is used by children and it already committed to that —
 * apps/agent/src/worker.ts, on LiveKit's recording flags: "their voices and
 * their doubts do not leave the room they were spoken in." So most of what is
 * checked below is what does NOT get sent.
 */

const posted: { url: string; body: string }[] = [];

beforeEach(() => {
  posted.length = 0;
  localStorage.clear();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    posted.push({ url: String(url), body: String(init.body) });
    return { ok: true } as Response;
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('unset is a complete no-op', () => {
  it('is not configured in a repo with no DSN and no key', () => {
    // The state the app ships in today, and the state every test runs in.
    expect(telemetryConfigured()).toBe(false);
  });

  it('sends nothing at all', () => {
    reportCrash(new Error('boom'));
    track('lesson_started', { lessonId: 'class10-blood' });

    expect(posted).toEqual([]);
  });

  it('does not throw when asked to report before anything is started', () => {
    // The ErrorBoundary calls this from inside componentDidCatch. A reporter
    // that throws would replace the error it was reporting.
    expect(() => reportCrash(new Error('boom'))).not.toThrow();
  });
});

describe('parseDsn', () => {
  it('pulls a real DSN apart', () => {
    expect(parseDsn('https://abc123@o42.ingest.sentry.io/7654321')).toEqual({
      publicKey: 'abc123',
      host: 'o42.ingest.sentry.io',
      projectId: '7654321',
    });
  });

  it('returns null for anything that is not one', () => {
    // A mistyped DSN in an environment file must not be the thing that stops
    // the app booting.
    for (const bad of [undefined, '', 'not a url', 'https://o42.ingest.sentry.io/7', 'https://k@h/']) {
      expect(parseDsn(bad), String(bad)).toBeNull();
    }
  });
});

describe('clean — the filter that keeps a child’s words in the room', () => {
  it('keeps numbers, booleans and short ids', () => {
    expect(clean({ beats: 8, resumed: true, lessonId: 'class10-blood' })).toEqual({
      beats: 8,
      resumed: true,
      lessonId: 'class10-blood',
    });
  });

  it('DROPS anything long enough to be a sentence', () => {
    // The failure this exists to prevent: somebody one day passing
    // { answer: heard.text } and a fourteen-year-old's spoken words going to
    // a third party.
    const said = 'because the left ventricle has to pump blood to the whole body, i think';

    expect(said.length).toBeGreaterThan(MAX_PROPERTY_LENGTH);
    expect(clean({ answer: said })).toEqual({});
  });

  it('drops rather than truncates', () => {
    // A truncated sentence is still a sentence.
    const said = 'x'.repeat(MAX_PROPERTY_LENGTH + 1);
    expect(clean({ said })).toEqual({});
  });

  it('drops objects, arrays and functions outright', () => {
    expect(clean({ o: { a: 1 }, a: [1, 2], f: () => {}, n: null, u: undefined })).toEqual({});
  });

  it('drops a number that is not one', () => {
    expect(clean({ x: NaN, y: Infinity })).toEqual({});
  });
});

describe('framesFrom', () => {
  it('reads a Chrome stack, most recent call last', () => {
    const frames = framesFrom(
      ['Error: boom', '    at inner (https://app/x.js:10:5)', '    at outer (https://app/x.js:20:1)'].join('\n'),
    );

    expect(frames).toHaveLength(2);
    expect(frames.at(-1)).toMatchObject({ function: 'inner', lineno: 10, colno: 5 });
  });

  it('reads a Firefox stack, which has no header line', () => {
    // Chrome opens with "Error: message"; Firefox and Safari open with the
    // innermost frame. Dropping line zero regardless threw away the frame that
    // says where it actually broke, on two engines out of three — and the test
    // meant to catch that had faked a header line into its own fixture.
    const frames = framesFrom(
      ['inner@https://app/x.js:10:5', 'outer@https://app/x.js:20:1'].join('\n'),
    );

    expect(frames).toHaveLength(2);
    expect(frames.at(-1)).toMatchObject({ function: 'inner', lineno: 10 });
  });

  it('drops a Chrome header line without counting it as a frame', () => {
    const frames = framesFrom(['Error: boom', '    at only (https://app/x.js:1:1)'].join('\n'));

    expect(frames).toHaveLength(1);
  });

  it('has nothing to say about a stack it cannot read, rather than throwing', () => {
    // Sentry accepts an event with no frames, so a parser that gives up still
    // reports the crash.
    expect(framesFrom(undefined)).toEqual([]);
    expect(framesFrom('some unfamiliar shape')).toEqual([]);
  });
});

describe('buildEnvelope', () => {
  const at = '2026-09-02T00:00:00.000Z';
  const envelope = (error: Error, extra: Record<string, unknown> = {}) =>
    buildEnvelope('abc', error, clean(extra), at).split('\n');

  it('is three newline-delimited JSON lines', () => {
    const lines = envelope(new Error('boom'));

    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[1])).toEqual({ type: 'event' });
  });

  it('carries the error and a stable anonymous id', () => {
    const event = JSON.parse(envelope(new Error('boom'))[2]);

    expect(event.exception.values[0]).toMatchObject({ type: 'Error', value: 'boom' });
    expect(event.user.id).toBeTruthy();
  });

  it('caps a very long message', () => {
    const event = JSON.parse(envelope(new Error('x'.repeat(2000)))[2]);

    expect(event.exception.values[0].value.length).toBeLessThanOrEqual(500);
  });

  it('sends the path and NOT the query string', () => {
    // /class?topic=<what the student typed> is a real route in this app. The
    // query string is where their own words live.
    const event = JSON.parse(envelope(new Error('boom'))[2]);

    expect(event.request.url).not.toContain('?');
  });

  it('passes extras through the same filter', () => {
    const event = JSON.parse(envelope(new Error('boom'), { path: '/lesson/x', said: 'y'.repeat(200) })[2]);

    expect(event.extra).toEqual({ path: '/lesson/x' });
  });
});

describe('a blank environment variable is the empty string, not undefined', () => {
  it('never posts an event to the app’s own origin', () => {
    // .env.example ships VITE_POSTHOG_HOST blank, and `??` keeps '' — which
    // sent every event to "/capture/" on our own host, where nothing is
    // listening, and lost all of them silently.
    track('lesson_started', { lessonId: 'x' });

    for (const call of posted) expect(call.url.startsWith('http')).toBe(true);
  });

  it('stamps a release even with the variable blank', () => {
    const event = JSON.parse(
      buildEnvelope('abc', new Error('boom'), {}, '2026-09-02T00:00:00.000Z').split('\n')[2],
    );

    expect(event.release).toBe('dev');
  });
});
