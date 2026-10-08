/**
 * CASHFREE'S WEBHOOK SIGNATURE, WITH WEBCRYPTO ONLY (the same code runs in Node
 * and in a Deno Edge Function).
 *
 * Cashfree sends x-webhook-timestamp and x-webhook-signature, where the
 * signature is base64(HMAC-SHA256(timestamp + raw body, client secret)), and
 * says to compute it from the raw request body
 * (https://www.cashfree.com/docs/api-reference/webhooks/payloads-and-signatures.md).
 * So the bytes are checked as they arrived, before anything parses them.
 */

const enc = new TextEncoder();

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

const key = (secret: string, use: KeyUsage[]) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, use);

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** The hex SHA-256 of the bytes: how a body is named in the log without keeping it. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** base64(HMAC-SHA256(timestamp + body, secret)), as Cashfree computes it. */
export async function signWebhook(secret: string, timestamp: string, body: Uint8Array): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', await key(secret, ['sign']), concat(enc.encode(timestamp), body));
  // A SHA-256 MAC is 32 bytes, so spreading it into fromCharCode is safe.
  return toBase64(new Uint8Array(mac));
}

/**
 * Whether Cashfree signed exactly these bytes with this secret. WebCrypto's
 * verify compares the MACs itself (not with an early-exit string compare); a
 * missing secret, timestamp or signature, or one that is not base64, is false.
 */
export async function verifyWebhook(
  secret: string,
  timestamp: string | null,
  signature: string | null,
  body: Uint8Array,
): Promise<boolean> {
  if (!secret || !timestamp || !signature) return false;
  let given: Uint8Array<ArrayBuffer>;
  try {
    given = Uint8Array.from(atob(signature.trim()), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', await key(secret, ['verify']), given, concat(enc.encode(timestamp), body));
}
