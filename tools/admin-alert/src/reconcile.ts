/**
 * THE HOURLY RECONCILIATION, ASKED FROM OUTSIDE.
 *
 * POSTs to billing-api's /reconcile route with the checker's own token
 * (BILLING_RECONCILE_TOKEN) as Bearer and the anon key as apikey (whether the
 * functions gateway wants the apikey is UNVERIFIED). billing-api checks the
 * token, then asks the database whether a reconciliation is due; the database
 * answers yes at most once in 55 minutes, so asking on every five-minute run
 * costs one read when nothing is due.
 *
 * It never throws: a run's job is the alarm, and a reconciliation that could
 * not be asked is reported in the result. It never returns or prints the token.
 */

export interface ReconcileEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  BILLING_RECONCILE_TOKEN: string;
}

export interface ReconcileResult {
  ok: boolean;
  /** billing-api's HTTP status; 0 when it could not be reached. */
  status: number;
  /** Whether a reconciliation ran (false: not due yet); null when billing-api did not say. */
  ran: boolean | null;
}

export async function askReconcile(env: ReconcileEnv, fetchImpl: typeof fetch = fetch): Promise<ReconcileResult> {
  try {
    const res = await fetchImpl(`${env.SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/billing-api/reconcile`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.BILLING_RECONCILE_TOKEN}`,
        apikey: env.SUPABASE_ANON_KEY,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) return { ok: false, status: res.status, ran: null };
    const body = (await res.json().catch(() => null)) as { ran?: unknown } | null;
    return { ok: true, status: res.status, ran: typeof body?.ran === 'boolean' ? body.ran : null };
  } catch {
    return { ok: false, status: 0, ran: null };
  }
}
