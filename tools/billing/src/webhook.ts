import { extractEvent } from './extract.ts';
import { sha256Hex, verifyWebhook } from './signature.ts';

/**
 * CASHFREE'S WEBHOOK, AS A PLAIN FUNCTION (the Deno entry is
 * supabase/functions/cashfree-webhook/index.ts).
 *
 * In order, each step answering at once:
 *   1. no secret configured: 503; not a POST: 405;
 *   2. a body over 256 KiB: 413, nothing stored;
 *   3. the signature checked on the raw bytes (signature.ts); a failure is
 *      stored as the body's SHA-256 and length only and answered 401;
 *   4. the body parsed and cut down to the extract (extract.ts); a body that
 *      is not JSON, or whose amounts are malformed, is stored as unparsed and
 *      left to the hourly check;
 *   5. the key: Cashfree's x-idempotency-key, else "sha256:<body hash>";
 *   6. admin.billing_webhook_ingest stores it once and applies it: 200. If the
 *      database fails, 500, so Cashfree retries (its default is three times,
 *      at 2, 10 and 30 minutes).
 *
 * The timestamp's age is not checked (ruling R12): an event is stored once
 * and only moves an invoice forward, so a resent one changes nothing. No
 * body, header or secret is ever written to the log.
 */

export interface WebhookRequest {
  method: string;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
}

export interface WebhookDeps {
  /** CASHFREE_CLIENT_SECRET. */
  secret: string;
  /** An admin.* function, called with the service role. */
  rpc(fn: string, args: Record<string, unknown>): Promise<unknown>;
}

export const MAX_BODY_BYTES = 262144;

const header = (req: WebhookRequest, name: string): string | null => {
  for (const [k, v] of Object.entries(req.headers)) if (k.toLowerCase() === name && v) return v;
  return null;
};

export async function handleWebhook(req: WebhookRequest, deps: WebhookDeps): Promise<{ status: number; body: unknown }> {
  if (!deps.secret) return { status: 503, body: { error: 'cashfree-webhook is missing CASHFREE_CLIENT_SECRET' } };
  if (req.method !== 'POST') return { status: 405, body: { error: 'POST only' } };
  if (req.body.length > MAX_BODY_BYTES) return { status: 413, body: { error: 'too large' } };

  const hash = await sha256Hex(req.body);
  const timestamp = header(req, 'x-webhook-timestamp');
  const signature = header(req, 'x-webhook-signature');
  if (!(await verifyWebhook(deps.secret, timestamp, signature, req.body))) {
    try {
      await deps.rpc('billing_signature_failed', {
        p_body_sha256: hash,
        p_body_length: req.body.length,
        p_why: !timestamp || !signature ? 'missing signature headers' : 'signature does not match',
      });
    } catch {
      console.error('cashfree-webhook: a signature failure could not be recorded');
    }
    return { status: 401, body: { error: 'signature' } };
  }

  let value: unknown;
  try {
    value = extractEvent(JSON.parse(new TextDecoder().decode(req.body))) ?? { unparsed: true };
  } catch {
    value = { unparsed: true };
  }

  const key = header(req, 'x-idempotency-key') || `sha256:${hash}`;
  try {
    await deps.rpc('billing_webhook_ingest', {
      p_key: key,
      p_body_sha256: hash,
      p_body_length: req.body.length,
      p_value: value,
    });
    return { status: 200, body: { ok: true } };
  } catch (e) {
    // The database's message only: never the body.
    console.error('cashfree-webhook: the event was not stored:', e instanceof Error ? e.message : 'unknown error');
    return { status: 500, body: { error: 'not stored' } };
  }
}
