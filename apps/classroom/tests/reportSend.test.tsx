import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELPLINES } from '@ai-tutor/safety';
import { flagStore, unsentReports } from '../src/stores/flags';
import { ReportDone, ReportSheet, fileReport, noteThatMayTravel } from '../src/ui/ReportSheet';

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
    // `answer` is what the RELAY says, so it is applied to the report call and
    // to nothing else. relayFetch mints an anonymous identity on a fresh
    // device, and handing the Supabase auth client a 400 makes it throw from
    // inside relay.ts — which would be read here as "no network at all" and
    // quietly hide whatever this test was actually asserting about a status.
    const isReport = String(url).includes('/api/report');
    return Promise.resolve({
      ok: isReport ? answer.ok : true,
      status: isReport ? answer.status : 200,
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
  sessionId: null,
  release: 'dev',
  platform: 'web' as const,
  at: '2026-09-18T04:00:00.000Z',
  ...over,
});

describe('what may leave the device', () => {
  it('takes a phone number out of the child’s own words', () => {
    const out = noteThatMayTravel('call me on 9876543210 please');
    expect(out.note).not.toContain('9876543210');
    expect(out.why).toBe(null);
  });

  it('takes an email address out too', () => {
    const out = noteThatMayTravel('write to aarav@example.com');
    expect(out.note).not.toContain('aarav@example.com');
  });

  it('leaves ordinary words exactly as the child typed them', () => {
    const out = noteThatMayTravel('she said the answer was wrong and it was not');
    expect(out.note).toBe('she said the answer was wrong and it was not');
    expect(out.why).toBe(null);
  });

  /**
   * THE DEBT WAVE 3 RECORDED AND COULD NOT PAY. `screen` returns 'support'
   * with no cleaned copy of the words, so the most serious report this product
   * can receive used to travel WORDLESS: an operator saw that something
   * happened to a child and could not see what. `redact` is the pure masking
   * pass that did not exist then.
   */
  it('sends a distressing note SCRUBBED rather than withholding it', () => {
    const out = noteThatMayTravel('i want to kill myself, ring me on 9876543210');
    expect(out.note).toContain('i want to kill myself');
    expect(out.note).not.toContain('9876543210');
    expect(out.why).toBe('support');
  });

  it('scrubs a distressing note exactly the way a clean one is scrubbed', () => {
    // One masking pass, two callers. A second copy would drift, and the quiet
    // one would be the copy carrying a child in distress.
    const clean = noteThatMayTravel('ring me on 9876543210');
    const distressing = noteThatMayTravel('i want to die. ring me on 9876543210');
    expect(distressing.note.endsWith(clean.note)).toBe(true);
  });

  /**
   * The screen objects for TWO different reasons and they are not the same
   * event. 'support' is a child in distress; 'redirect' is a child who wrote
   * about something the tutor declines to discuss. Telling the second one to
   * go and tell an adult what happened, when nothing happened, is the app
   * mistaking a boundary for an emergency — so the verdict is carried out of
   * here even though the words themselves now travel either way.
   */
  it('says WHAT the screen made of it, so the confirmation can tell the truth', () => {
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

  /**
   * THE BODY IS THE DRAFT AND NOTHING ELSE IS. `sessionId`, `release` and
   * `platform` used to be computed here, which made a replayed report carry
   * the sitting and the build of the app open that happened to send it.
   */
  it('sends the sitting and the build the DRAFT carries, computing neither', async () => {
    await fileReport(
      draft({ sessionId: '407e6546-54db-421e-afa9-a3d0fb54dbbf', release: '2026.09.1' }),
    );
    const body = JSON.parse(String(posted()?.init.body)) as Record<string, unknown>;
    expect(body.sessionId).toBe('407e6546-54db-421e-afa9-a3d0fb54dbbf');
    expect(body.release).toBe('2026.09.1');
    expect(body.platform).toBe('web');
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

  /**
   * THE THIRD ANSWER, AND WHY IT IS NOT 'kept'. A 400, a 405 or a 413 is the
   * relay's verdict on the BODY, and the body is frozen in the draft — the
   * same bytes get the same answer on every app open for the life of the
   * install. Calling that 'kept' meant queueing it forever while the child was
   * told the app would keep trying.
   */
  it('answers "refused" when the relay has read the body and will not have it', async () => {
    for (const status of [400, 405, 413]) {
      answer = { ok: false, status };
      expect(await fileReport(draft())).toBe('refused');
    }
  });

  /**
   * The short list cuts the other way too, and deliberately: 429 is the
   * child's own rate or budget and 401 is an identity a later sign-in can
   * supply. Losing a child's Safety report is far worse than a wasted request,
   * and /api/report costs nothing to send.
   */
  it('keeps trying on the refusals that can come right on their own', async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      answer = { ok: false, status };
      expect(await fileReport(draft())).toBe('kept');
    }
  });
});

describe('a distressing note still ranks the report', () => {
  /**
   * The words now travel scrubbed, so this is no longer the only signal a
   * person is needed — but it is still the field a QUEUE sorts on. A child
   * who tapped "Something else" and then wrote something serious must not sit
   * below a typo complaint, so the kind carries what the note says.
   */
  it('files a distressing note as unsafe, whatever the child tapped', async () => {
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

/**
 * THE COPY IS THE BEHAVIOUR HERE.
 *
 * This sheet has changed what it does with a child's words twice now, and both
 * times the sentence on the screen was the thing that had to change with it.
 * It is rendered rather than asserted about, so a copy edit that re-promises
 * the old behaviour goes red.
 */
describe('what the child is told afterwards', () => {
  const done = (
    outcome: 'sent' | 'kept' | 'refused',
    why: 'support' | 'redirect' | null,
    hasNote = true,
  ) =>
    renderToString(
      <ReportDone
        outcome={outcome}
        why={why}
        hasNote={hasNote}
        sending={false}
        onClose={() => {}}
        onRetry={() => {}}
      />,
    );

  it('never again says a distressing note stayed on the phone', () => {
    // It did stay — and it also went, scrubbed. The old sentence is now false.
    expect(done('sent', 'support')).not.toContain('What you wrote stayed on this phone');
  });

  it('says the words went, and that they were cleaned first', () => {
    const html = done('sent', 'support');
    expect(html).toContain('phone numbers and email addresses taken out');
    expect(html).toContain('Somebody will read it');
  });

  /**
   * The textarea is optional and says so. A child who taps a reason and sends
   * nothing was being told their own words had gone and been cleaned, when
   * there were none — the one sentence in the new copy that did not branch on
   * what actually happened.
   */
  it('does not claim to have cleaned words a child never typed', () => {
    const html = done('sent', null, false);
    expect(html).not.toContain('your own words');
    expect(html).not.toContain('phone numbers and email addresses taken out');
    expect(html).toContain('Somebody will read it');
  });

  it('does not claim the words went when they have not gone yet', () => {
    const html = done('kept', 'support');
    expect(html).not.toContain('Somebody will read it');
    expect(html).toContain('nobody has read it yet');
  });

  /**
   * The app listens on 'online' and on the tab coming back, not only on a
   * mount (App.tsx watchForReportReplay, driven for real in
   * tests/reportReplay.test.ts). This sentence is held to that: it used to say
   * "the next time you open the app", which a Capacitor resume never is.
   */
  it('promises the retry this app now actually performs', () => {
    const html = done('kept', null);
    expect(html).toContain('try again as soon as your phone is back online');
    expect(html).not.toContain('the next time you open the app');
  });

  /**
   * AND STOPS PROMISING WHEN IT HAS STOPPED TRYING. A body the relay refuses
   * gets the same answer for the life of the install; "we will try again" is
   * then literally true and practically a lie. The child is told the one thing
   * that stays true instead — it is on their phone, to show somebody.
   */
  it('does not promise a retry it has given up on', () => {
    const html = done('refused', null);
    expect(html).not.toContain('try again as soon as your phone is back online');
    expect(html).toContain('trying again will not fix that');
    expect(html).toContain('show it to a parent or a teacher');
    expect(html).not.toContain('Try sending it again');
  });

  it('offers the by-hand retry only where trying again could work', () => {
    expect(done('kept', null)).toContain('Try sending it again');
    expect(done('sent', null)).not.toContain('Try sending it again');
  });

  /**
   * A report going somewhere is not the same as help arriving. A child who
   * wrote something serious is told so, and given a number they can ring
   * today, whatever became of the POST.
   */
  it('still puts a real helpline in front of a child in distress', () => {
    for (const outcome of ['sent', 'kept', 'refused'] as const) {
      expect(done(outcome, 'support')).toContain(HELPLINES.telemanas);
      expect(done(outcome, 'support')).toContain('tell an adult you trust');
    }
  });

  it('does not tell a child who only asked something off-limits to fetch an adult', () => {
    expect(done('sent', 'redirect')).not.toContain('tell an adult you trust today');
  });

  /**
   * AND SAYS NOTHING EXTRA TO THEM, on purpose. The old build had a line for a
   * 'redirect' child about part of their report staying on the phone; it went
   * with the withholding it described, and nothing replaced it because there
   * is no true sentence left to add. So it renders as a note the screen had no
   * objection to — which is what this pins, since the alternative is somebody
   * later "fixing" the apparent gap with a sentence that is not true.
   */
  it('reads exactly like an unremarkable note for a redirected child', () => {
    for (const outcome of ['sent', 'kept', 'refused'] as const) {
      expect(done(outcome, 'redirect')).toBe(done(outcome, null));
    }
  });
});

describe('a report the relay would not take', () => {
  it('is marked unsent, so the next app open can file it', async () => {
    answer = { ok: false, status: 503 };
    const pending = draft();
    expect(await fileReport(pending)).toBe('kept');
    // fileReport does not write the marker — the sheet does, beside the local
    // copy it already wrote. What is asserted here is the shape the marker
    // holds: the POST body, with the stamp the relay deduplicates on, and who
    // it belongs to so a shared phone cannot file it under the next child.
    const { recordFlag, markUnsent } = await import('../src/stores/flags');
    recordFlag({ kind: 'reported', at: pending.at, lessonId: pending.lessonId });
    markUnsent(pending.at, { draft: pending, owner: null });
    expect(unsentReports(flagStore.get())[0]?.draft.at).toBe(pending.at);
  });
});

/**
 * THE CHILD'S OWN LOG, AND THE RETRY BUTTON THAT USED TO WRITE TO IT TWICE.
 *
 * `at` is stamped once so the RELAY reads one report; the flag is recorded
 * once so the CHILD does. Before the `first` guard, tapping "Try sending it
 * again" put a second identical row in the log a child shows a parent — the
 * same defect the stamp fixes, one layer down. Driven through the real sheet
 * rather than asserted at the store, because the guard lives in the handler.
 */
describe('sending it twice', () => {
  const roots: Root[] = [];

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    for (const root of roots.splice(0)) act(() => root.unmount());
    document.body.innerHTML = '';
  });

  const open = async (): Promise<HTMLElement> => {
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<ReportSheet lessonId="class10-blood" onClose={() => {}} />);
    });
    return host;
  };

  const tap = async (host: HTMLElement, label: string) => {
    const button = [...host.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes(label),
    );
    expect(button, `no button reading "${label}"`).toBeDefined();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  it('puts one row in the child’s own log however many times it is sent', async () => {
    answer = { ok: false, status: 503 };
    const host = await open();
    await tap(host, 'Something here does not feel safe');
    await tap(host, 'Send report');

    answer = { ok: true, status: 202 };
    await tap(host, 'Try sending it again');

    const reported = flagStore.get().flags.filter((f) => f.kind === 'reported');
    expect(reported).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes('/api/report'))).toHaveLength(2);
    // And the second attempt landed, so nothing is left queued for a third.
    expect(unsentReports(flagStore.get())).toEqual([]);
  });

  it('sends the same stamp both times, so an operator reads one report', async () => {
    answer = { ok: false, status: 503 };
    const host = await open();
    await tap(host, 'She got something wrong');
    await tap(host, 'Send report');

    answer = { ok: true, status: 202 };
    await tap(host, 'Try sending it again');

    const stamps = calls
      .filter((c) => c.url.includes('/api/report'))
      .map((c) => (JSON.parse(String(c.init.body)) as { at: string }).at);
    expect(stamps).toHaveLength(2);
    expect(stamps[0]).toBe(stamps[1]);
  });
});
