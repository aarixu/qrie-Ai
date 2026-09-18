import { describe, expect, it } from 'vitest';
import { runReport } from '../../bin/cost-report.mjs';

/**
 * cost-report against a MOCKED PostgREST, because the live project needs the
 * service role key and the key is deliberately not on this machine. The mock
 * answers the same routes the real report reads: the cost_per_student_hour
 * RPC, usage_event, model_price and usage_cost.
 */

type Answers = {
  head?: Record<string, unknown>;
  used?: unknown[];
  priced?: unknown[];
  cost?: unknown[];
};

function mockFetch(answers: Answers) {
  return async (url: string): Promise<Response> => {
    const body = (() => {
      if (url.includes('/rpc/cost_per_student_hour')) {
        return [
          answers.head ?? { sessions: 0, active_hours: null, inr: null, inr_per_hour: null, unpriced_calls: 0 },
        ];
      }
      if (url.includes('usage_event?')) return answers.used ?? [];
      if (url.includes('model_price?')) return answers.priced ?? [];
      if (url.includes('usage_cost?')) return answers.cost ?? [];
      throw new Error(`unexpected route: ${url}`);
    })();
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

async function run(answers: Answers, opts: { studentHour?: boolean; days?: number } = {}) {
  const lines: string[] = [];
  await runReport({
    url: 'https://db.example',
    key: 'service-key',
    days: opts.days ?? 30,
    studentHour: opts.studentHour ?? false,
    fetchImpl: mockFetch(answers) as unknown as typeof fetch,
    log: (line: string) => lines.push(line),
  });
  return lines.join('\n');
}

describe('cost-report on an empty project', () => {
  it('says "no data yet" and never prints NaN', async () => {
    const out = await run({});
    expect(out).toMatch(/no data yet|No usage recorded yet/i);
    expect(out).not.toMatch(/NaN/);
    expect(out).not.toMatch(/undefined/);
  });

  it('--student-hour degrades the same way', async () => {
    const out = await run({}, { studentHour: true });
    expect(out).toMatch(/no data yet/i);
    expect(out).not.toMatch(/NaN/);
  });
});

describe('the unpriced list', () => {
  it('names each unpriced model loudly and says to run apply-prices', async () => {
    const out = await run({
      used: [{ provider: 'vertex', model: 'gemini-3.7-flash' }],
      priced: [],
    });
    expect(out).toMatch(/vertex\/gemini-3\.7-flash/);
    expect(out).toMatch(/apply-prices/);
  });
});

describe('prep attribution (0018 columns)', () => {
  it('groups by bucket and prep_id when rows carry them, nulls as unattributed', async () => {
    const out = await run({
      cost: [
        { session_id: 's1', prep_id: '4c3f2c9a-6c1e-4b7a-9d2e-1f0a2b3c4d5e', bucket: 'live', inr: '12.5', unpriced: false },
        { session_id: 's1', prep_id: '4c3f2c9a-6c1e-4b7a-9d2e-1f0a2b3c4d5e', bucket: 'live', inr: '7.5', unpriced: false },
        { session_id: 's2', prep_id: null, bucket: 'warm', inr: '0.4', unpriced: false },
        { session_id: 's3', prep_id: null, bucket: null, inr: '1.1', unpriced: true },
      ],
      head: { sessions: 3, active_hours: 1.5, inr: 21.5, inr_per_hour: 14.33, unpriced_calls: 1 },
    });
    expect(out).toMatch(/live/);
    expect(out).toMatch(/warm/);
    expect(out).toMatch(/unattributed/);
    expect(out).toMatch(/4c3f2c9a/);
    expect(out).toMatch(/20\.00/); // the prep's two rows summed
  });

  it('says the columns are empty rather than printing an empty table', async () => {
    const out = await run({
      cost: [{ session_id: 's1', prep_id: null, bucket: null, inr: '1', unpriced: false }],
    });
    // The two columns are in DIFFERENT states and the message says which:
    // prep_id waits on a migration and a redeploy, bucket has no writer at
    // all. One sentence for both would send an operator off to wait for
    // something that is never going to arrive on its own.
    expect(out).toMatch(/no row carries prep_id or bucket yet/i);
    expect(out).toMatch(/prep_id is WAITING ON DEPLOYMENT/);
    expect(out).toMatch(/bucket has NO WRITER ANYWHERE/);
  });
});

describe('--student-hour mode', () => {
  it('prints the number with its formula', async () => {
    const out = await run(
      {
        head: { sessions: 4, active_hours: 2.0, inr: 50.0, inr_per_hour: 25.0, unpriced_calls: 0 },
      },
      { studentHour: true },
    );
    expect(out).toMatch(/50/);
    expect(out).toMatch(/2\b/);
    expect(out).toMatch(/25/);
    // The formula is SHOWN, so the number can be checked by eye.
    expect(out).toMatch(/spend.*÷.*hours|inr.*\/.*active_hours|÷/i);
  });

  it('a floor is called a floor when calls are unpriced', async () => {
    const out = await run(
      {
        head: { sessions: 4, active_hours: 2.0, inr: 50.0, inr_per_hour: 25.0, unpriced_calls: 7 },
      },
      { studentHour: true },
    );
    expect(out).toMatch(/floor/i);
  });
});

/**
 * TWO SENTENCES IN ONE REPORT MUST NOT CONTRADICT EACH OTHER. model_price's
 * key is (provider, model, unit), so a model can be half-priced: keyed by
 * model alone the report called it priced while the database went on counting
 * its calls unpriced, and the reassuring sentence is the one an operator
 * believes because it names no fix.
 */
describe('a model with some units priced and some not', () => {
  it('names the missing UNIT instead of calling the model priced', async () => {
    const out = await run({
      head: { sessions: 3, active_hours: 1.5, inr: 12, inr_per_hour: 8, unpriced_calls: 4 },
      used: [{ provider: 'vertex', model: 'gemini-3.7-flash', prompt_tokens: 100, output_tokens: 40 }],
      priced: [{ provider: 'vertex', model: 'gemini-3.7-flash', unit: 'prompt_token' }],
    });
    expect(out).toMatch(/USED BUT NEVER PRICED/);
    expect(out).toMatch(/output_token/);
    expect(out).not.toMatch(/Every model in use has a price\./);
    expect(out).toMatch(/apply-prices/);
  });

  it('does not claim everything is priced while the database says otherwise', async () => {
    const out = await run({
      head: { sessions: 3, active_hours: 1.5, inr: 12, inr_per_hour: 8, unpriced_calls: 4 },
      used: [{ provider: 'vertex', model: 'gemini-3.7-flash', prompt_tokens: 100 }],
      priced: [{ provider: 'vertex', model: 'gemini-3.7-flash', unit: 'prompt_token' }],
    });
    // Every unit this report can check IS priced, yet unpriced_calls is 4 —
    // 0008's flag cannot see thought_tokens or bytes. Say so; do not pick.
    expect(out).not.toMatch(/Every model in use has a price\./);
    expect(out).toMatch(/unpriced call/);
  });
});

describe('the window', () => {
  it('asks the database for the same window it prints in the heading', async () => {
    const seen: string[] = [];
    await runReport({
      url: 'https://db.example',
      key: 'service-key',
      days: 7,
      fetchImpl: (async (url: string) => {
        seen.push(url);
        const body = url.includes('/rpc/') ? [{ sessions: 0 }] : [];
        return new Response(JSON.stringify(body), { status: 200 });
      }) as unknown as typeof fetch,
      log: () => {},
    });
    // Totals under "Last 7 days" must not be summed from rows outside it.
    expect(seen.find((u) => u.includes('usage_cost?'))).toMatch(/at=gte\./);
    expect(seen.find((u) => u.includes('usage_event?'))).toMatch(/at=gte\./);
  });
});

/**
 * THE NUMBER A CREDIT GETS PRICED FROM MUST NAME WHAT IT LEAVES OUT.
 * cost_per_student_hour sums rows joined onto CLOSED sessions, and a
 * preparation has no session — so the catalogue CAPEX, the whole reason
 * pre-warming exists, sits outside the headline.
 */
describe('--student-hour', () => {
  it('names the preparation spend the headline cannot see', async () => {
    const out = await run(
      {
        head: { sessions: 4, active_hours: 2, inr: 50, inr_per_hour: 25, unpriced_calls: 0 },
        cost: [{ inr: 8220 }],
      },
      { studentHour: true },
    );
    expect(out).toMatch(/spend Rs 50\.00 ÷ hours 2 = Rs 25\.00 per student-hour/);
    expect(out).toMatch(/EXCLUDES Rs 8220\.00/);
    expect(out).toMatch(/MARGINAL cost of a sitting/);
  });

  it('says nothing about exclusions when there are none', async () => {
    const out = await run(
      { head: { sessions: 4, active_hours: 2, inr: 50, inr_per_hour: 25, unpriced_calls: 0 } },
      { studentHour: true },
    );
    expect(out).not.toMatch(/EXCLUDES/);
    expect(out).not.toMatch(/NaN/);
  });
});
