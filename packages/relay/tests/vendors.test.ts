import { describe, expect, it } from 'vitest';
import { handleRelay, type HandlerDeps } from '../src/handler';
import { createMemoryLedger, type Gate } from '../src/gate';
import type { RelayRequest } from '../src/relays';
import { modelVendors } from '../src/vendors';

/**
 * A BROKEN GOOGLE KEY MUST NOT SEND A CHILD'S VOICE SOMEWHERE ELSE.
 *
 * /privacy says OpenRouter and Deepgram are no longer used. That was true
 * only while GOOGLE_SERVICE_ACCOUNT_JSON parsed: the Edge Function caught an
 * unusable key, logged it, and left the handler with no `vertex` and a live
 * OpenRouter key — so thinking, speech and hearing went quietly back to the
 * vendors the page says are gone. A typo while rotating the secret was
 * enough, and nothing alerted anybody.
 *
 * Now a configured service account is a promise that OpenRouter is not used,
 * kept whether or not the key works. With no service account at all (a
 * laptop), OpenRouter is used, as before.
 */

const PEM = '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n';
const usableKey = JSON.stringify({
  type: 'service_account',
  project_id: 'qrie-test',
  client_email: 'relay@qrie-test.iam.gserviceaccount.com',
  private_key: PEM,
});

describe('modelVendors', () => {
  it('uses OpenRouter when no service account is configured', () => {
    const v = modelVendors({ serviceAccountJson: '', openRouterKey: 'sk-or' });
    expect(v.vertex).toBeUndefined();
    expect(v.openRouterKey).toBe('sk-or');
    expect(v.unusable).toBeUndefined();
  });

  it('uses Vertex, and hands out no OpenRouter key, when the service account works', () => {
    const v = modelVendors({ serviceAccountJson: usableKey, openRouterKey: 'sk-or' });
    expect(v.vertex?.tokens.projectId).toBe('qrie-test');
    expect(v.openRouterKey).toBe('');
    expect(v.unusable).toBeUndefined();
  });

  it('hands out no OpenRouter key either when the service account is set but broken', () => {
    for (const broken of ['{"type":"service_account"', '{}', JSON.stringify({ ...JSON.parse(usableKey), private_key: 'MIIB' })]) {
      const v = modelVendors({ serviceAccountJson: broken, openRouterKey: 'sk-or' });
      expect(v.vertex, broken).toBeUndefined();
      expect(v.openRouterKey, broken).toBe('');
      expect(v.unusable, broken).toMatch(/service account/);
    }
  });
});

const gate = (): Gate => ({
  verify: async (h) =>
    h === 'Bearer good' ? { ok: true, user: { userId: 'student-1' } } : { ok: false, status: 401, why: 'no' },
  ledger: createMemoryLedger(),
});

const request = (url: string, over: Partial<RelayRequest> = {}): RelayRequest => ({
  method: 'POST',
  url,
  headers: { authorization: 'Bearer good', 'content-type': 'application/json' },
  body: new TextEncoder().encode(JSON.stringify({ model: 'google/gemini-3.7-flash', messages: [{ role: 'user', content: 'hi' }] })),
  ...over,
});

describe('the relay with a broken Google key', () => {
  const brokenDeps = () => {
    const v = modelVendors({ serviceAccountJson: '{"type":"service_account"', openRouterKey: 'sk-or' });
    const transcribed: number[] = [];
    const deps: HandlerDeps = {
      key: v.openRouterKey,
      ...(v.vertex ? { vertex: v.vertex } : {}),
      gate: gate(),
      transcribe: async () => {
        transcribed.push(1);
        return { status: 200, headers: {}, body: { kind: 'json', value: { text: 'from openrouter' } } };
      },
    };
    return { deps, transcribed };
  };

  /** Anything addressed to OpenRouter, whether answered here or handed to the host to fetch. */
  const touchesOpenRouter = (out: Awaited<ReturnType<typeof handleRelay>>): boolean =>
    JSON.stringify(out).includes('openrouter.ai');

  it('answers 503 on thinking and sends nothing to OpenRouter', async () => {
    const { deps } = brokenDeps();
    const out = await handleRelay(request('/api/llm'), deps);
    expect(out.status).toBe(503);
    expect(touchesOpenRouter(out)).toBe(false);
  });

  it('answers 503 on her voice and sends nothing to OpenRouter', async () => {
    const { deps } = brokenDeps();
    const out = await handleRelay(
      request('/api/speech?text=namaste', { method: 'GET', body: new Uint8Array() }),
      deps,
    );
    expect(out.status).toBe(503);
    expect(touchesOpenRouter(out)).toBe(false);
  });

  it('answers 503 on hearing and never calls the OpenRouter transcriber', async () => {
    const { deps, transcribed } = brokenDeps();
    const out = await handleRelay(
      request('/api/hear', {
        headers: { authorization: 'Bearer good', 'content-type': 'audio/wav' },
        body: new Uint8Array(3200),
      }),
      deps,
    );
    expect(out.status).toBe(503);
    expect(transcribed).toHaveLength(0);
  });
});
