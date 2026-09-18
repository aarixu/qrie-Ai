import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flagStore } from '../src/stores/flags';
import { ReportSheet, fileReport, noteThatMayTravel } from '../src/ui/ReportSheet';

/**
 * A REPORT THAT REACHES A PERSON.
 *
 * The sheet used to write localStorage and tell the child "Nothing was sent
 * anywhere without you" — true, and that was the defect: a report button that
 * filed complaints into a drawer nobody opens. POST /api/report exists now.
 *
 * Two rules these tests hold the wiring to, both of them about the child and
 * neither about the server: the LOCAL copy survives every refusal, and the
 * child's own words are scrubbed of contact details before they leave the
 * device (packages/relay/src/report.ts declines to clean them at the far end,
 * on purpose, so this is the only place it can happen).
 */

const calls: { url: string; init: RequestInit }[] = [];
let answer: { ok: boolean; status: number } = { ok: true, status: 202 };

beforeEach(() => {
  localStorage.clear();
  flagStore.set({ flags: [] });
  calls.length = 0;
  answer = { ok: true, status: 202 };
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return Promise.resolve({
      ok: answer.ok,
      status: answer.status,
      json: () => Promise.resolve({ id: 'a-report-id' }),
    } as Response);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const draft = (over: Record<string, unknown> = {}) => ({
  kind: 'unsafe' as const,
  note: 'she kept talking about something scary',
  lessonId: 'class10-blood',
  topicRef: 'class10-science/blood/plasma',
  beatId: 'b4',
  spokenLine: 'Blood carries oxygen around the body.',
  at: '2026-09-18T04:00:00.000Z',
  ...over,
});

describe('what may leave the device', () => {
  it('takes a phone number out of the child’s own words', () => {
    const out = noteThatMayTravel('call me on 9876543210 please');
    expect(out.note).not.toContain('9876543210');
    expect(out.withheld).toBe(false);
  });

  it('takes an email address out too', () => {
    const out = noteThatMayTravel('write to aarav@example.com');
    expect(out.note).not.toContain('aarav@example.com');
  });

  it('leaves ordinary words exactly as the child typed them', () => {
    const out = noteThatMayTravel('she said the answer was wrong and it was not');
    expect(out.note).toBe('she said the answer was wrong and it was not');
    expect(out.withheld).toBe(false);
  });

  it('WITHHOLDS a note the screen will not hand back scrubbed, rather than sending it raw', () => {
    const out = noteThatMayTravel('i want to kill myself');
    expect(out.note).toBe('');
    expect(out.withheld).toBe(true);
  });

  /**
   * The screen withholds for TWO different reasons and they are not the same
   * event. 'support' is a child in distress; 'redirect' is a child who wrote
   * about something the tutor declines to discuss. Telling the second one to
   * go and tell an adult what happened, when nothing happened, is the app
   * mistaking a boundary for an emergency.
   */
  it('says WHY it withheld, so the confirmation can tell the truth about it', () => {
    expect(noteThatMayTravel('i want to kill myself').why).toBe('support');
    expect(noteThatMayTravel('she said the answer was wrong').why).toBe(null);
  });
});

/**
 * `relayFetch` mints an anonymous identity on a fresh device, so the report
 * POST is not necessarily the only call on the wire. Picked by path rather
 * than by index.
 */
const posted = () => calls.find((c) => c.url.includes('/api/report'));

describe('filing a report', () => {
  it('POSTs the contract’s shape to /api/report', async () => {
    const outcome = await fileReport(draft());
    expect(outcome).toBe('sent');
    const call = posted();
    expect(call).toBeDefined();
    expect(call?.init.method).toBe('POST');
    const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
    expect(body.kind).toBe('unsafe');
    expect(body.lessonId).toBe('class10-blood');
    expect(body.topicRef).toBe('class10-science/blood/plasma');
    expect(body.beatId).toBe('b4');
    expect(body.spokenLine).toBe('Blood carries oxygen around the body.');
    expect(body.at).toBe('2026-09-18T04:00:00.000Z');
    // Always present, possibly null — the shape both PRD copies agree on.
    expect(Object.keys(body)).toContain('sessionId');
  });

  it('sends the reason as the kind and never as a prefix on the note', async () => {
    await fileReport(draft({ note: 'she was rude' }));
    const body = JSON.parse(String(posted()?.init.body)) as { note: string };
    expect(body.note).toBe('she was rude');
    expect(body.note).not.toContain('—');
  });

  it('answers "kept" when the relay refuses, so the caller can say so truthfully', async () => {
    answer = { ok: false, status: 503 };
    expect(await fileReport(draft())).toBe('kept');
  });

  it('answers "kept" when there is no network at all', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    expect(await fileReport(draft())).toBe('kept');
  });
});

describe('a distressing note still ranks the report', () => {
  /**
   * The one report that most needs a person arrives WORDLESS, because the
   * screen would not hand the words back scrubbed. The kind is then the only
   * field left that can say a person is needed, so it carries it.
   */
  it('files a withheld distress note as unsafe, whatever the child tapped', async () => {
    const { reportKindFor } = await import('../src/ui/ReportSheet');
    expect(reportKindFor('other', 'support')).toBe('unsafe');
    expect(reportKindFor('wrong', 'support')).toBe('unsafe');
  });

  it('leaves the child’s own kind alone when the screen only redirected', async () => {
    const { reportKindFor } = await import('../src/ui/ReportSheet');
    expect(reportKindFor('wrong', 'redirect')).toBe('wrong');
    expect(reportKindFor('wrong', null)).toBe('wrong');
  });
});

describe('the sheet itself', () => {
  const html = renderToString(<ReportSheet lessonId="class10-blood" onClose={() => {}} />);

  it('is still a dialog a screen reader can announce', () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });

  it('no longer promises that nothing was sent anywhere', () => {
    expect(html).not.toContain('Nothing was sent anywhere without you');
  });

  /**
   * The screen removes phone numbers and emails. It does NOT remove a
   * short-form address — verified against packages/safety: "i live at 14 MG
   * Road, Pune" comes back verdict 'allow', byte-identical. Promising a child
   * it does, in the one place they are most likely to write about home, is the
   * shape of over-claim this repo has shipped before.
   */
  it('does not promise to take out an address it does not take out', () => {
    expect(html).not.toContain('we take those out before it is sent');
  });

  it('gives the child the room the file says they get', () => {
    expect(html).toContain('maxLength="500"');
  });
});
