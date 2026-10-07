// @vitest-environment node
import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex, signWebhook, verifyWebhook } from '../src/signature.ts';

/**
 * CASHFREE'S WEBHOOK SIGNATURE. Written first.
 *
 * Cashfree signs base64(HMAC-SHA256(x-webhook-timestamp + raw body, client
 * secret)) and says to compute it from the raw request body string
 * (https://www.cashfree.com/docs/api-reference/webhooks/payloads-and-signatures.md).
 * The module uses WebCrypto only, so the same code runs in Deno; node:crypto
 * here is the reference, as in Cashfree's own Node sample.
 */

const enc = new TextEncoder();
const SECRET = 'test-client-secret';
const TS = '1696845523';
const RAW = '{"data":{"link_id":"QRIE-26-27-0001", "link_status":"PAID"},\n  "type":"PAYMENT_LINK_EVENT"}';

describe('signing and checking', () => {
  it('matches node:crypto\'s HMAC-SHA256 base64 of timestamp + raw body', async () => {
    const expected = createHmac('sha256', SECRET).update(TS + RAW).digest('base64');
    expect(await signWebhook(SECRET, TS, enc.encode(RAW))).toBe(expected);
    expect(await verifyWebhook(SECRET, TS, expected, enc.encode(RAW))).toBe(true);
  });

  it('fails for one changed byte, another timestamp, another secret, an empty, missing or non-base64 signature', async () => {
    const sig = await signWebhook(SECRET, TS, enc.encode(RAW));
    const changed = enc.encode(RAW);
    changed[10] = changed[10] ^ 1;
    expect(await verifyWebhook(SECRET, TS, sig, changed)).toBe(false);
    expect(await verifyWebhook(SECRET, '1696845524', sig, enc.encode(RAW))).toBe(false);
    expect(await verifyWebhook('another-secret', TS, sig, enc.encode(RAW))).toBe(false);
    expect(await verifyWebhook(SECRET, TS, '', enc.encode(RAW))).toBe(false);
    expect(await verifyWebhook(SECRET, TS, null, enc.encode(RAW))).toBe(false);
    expect(await verifyWebhook(SECRET, null, sig, enc.encode(RAW))).toBe(false);
    expect(await verifyWebhook('', TS, sig, enc.encode(RAW))).toBe(false);
    expect(await verifyWebhook(SECRET, TS, '%%% not base64 %%%', enc.encode(RAW))).toBe(false);
  });

  it('checks the raw bytes, so a body with its spacing and key order kept passes and the same JSON re-serialised fails', async () => {
    const sig = await signWebhook(SECRET, TS, enc.encode(RAW));
    expect(await verifyWebhook(SECRET, TS, sig, enc.encode(RAW))).toBe(true);
    const reserialised = JSON.stringify(JSON.parse(RAW));
    expect(reserialised).not.toBe(RAW);
    expect(await verifyWebhook(SECRET, TS, sig, enc.encode(reserialised))).toBe(false);
  });

  it('sha256Hex gives the 64-character hex digest', async () => {
    const hex = await sha256Hex(enc.encode(RAW));
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(hex).toBe(createHash('sha256').update(RAW).digest('hex'));
  });
});
