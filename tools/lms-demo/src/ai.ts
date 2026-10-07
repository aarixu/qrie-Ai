import { completeOnVertex } from '../../../packages/relay/src/vertex.ts';
import { createTokenSource, readServiceAccount, type TokenSource } from '../../../packages/relay/src/googleAuth.ts';
import type { DemoAi } from './server.ts';

/**
 * "Draft with AI" in the demo school, on Qrie's Google Cloud: the same Vertex
 * code the hosted relay runs (packages/relay completeOnVertex), so its model
 * allowlist and output cap hold here too. Each call is billed to the project
 * in the key, as the relay's are.
 */
export function vertexAi(tokens: TokenSource, fetch?: typeof globalThis.fetch): DemoAi {
  return async (chat) => {
    const r = await completeOnVertex(chat as Parameters<typeof completeOnVertex>[0], { tokens, fetch });
    const body = r.body as { choices?: { message?: { content?: unknown } }[]; error?: { message?: string } };
    if (r.status !== 200) return { error: body?.error?.message ?? `Vertex said ${r.status}` };
    const text = body?.choices?.[0]?.message?.content;
    return typeof text === 'string' ? { text } : { error: 'the model sent no text' };
  };
}

/** The demo's AI from a service-account key's JSON (GOOGLE_SERVICE_ACCOUNT_JSON), as the relay builds it. */
export function vertexAiFromKey(json: string): DemoAi {
  return vertexAi(createTokenSource(readServiceAccount(json)));
}
