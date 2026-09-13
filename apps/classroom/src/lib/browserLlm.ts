import type { LlmAdapter } from '@ai-tutor/class-prep';
import { relayError, relayFetch } from './relay';

/**
 * The browser's side of the LLM boundary.
 *
 * Talks to `/api/llm` on our own origin — never to a provider directly — so no
 * key ever reaches the bundle. The dev server relays it; in production the same
 * path is a real backend route.
 *
 * `json: true` asks the provider to constrain its reply to a JSON object. Right
 * for the planner, wrong for the artist: an SVG is not JSON, and asking for one
 * in a JSON envelope only gets it escaped.
 *
 * `effort` is how hard the model should think, and it is the difference between
 * a bill and a smaller bill. Thinking tokens charge at the OUTPUT rate: measured
 * across one class, the judge spent 2,353 of them against 296 tokens of speech,
 * so three quarters of its cost was reasoning nobody reads. Measured again over
 * 72 real answers, asking for 'none' cut that bill 31% and changed not one
 * verdict. Left undefined nothing is sent and the model behaves as it does now,
 * which is what the planner and the artist want — they are writing a class, and
 * that is the one job here where thinking is the product.
 */
export function createBrowserLlm(
  model: string,
  opts: { json?: boolean; effort?: 'none' | 'low' | 'medium' | 'high' } = {},
): LlmAdapter {
  return {
    async complete(system: string, user: string): Promise<string> {
      const res = await relayFetch('/api/llm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
          ...(opts.effort ? { reasoning_effort: opts.effort } : {}),
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string };
      };
      if (!res.ok) throw relayError(res.status, data);
      // OpenRouter reports upstream failures as a 200 with an error body.
      if (data.error) throw new Error(data.error.message ?? 'unknown LLM error');

      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text) throw new Error('The model replied with nothing.');
      return text;
    },
  };
}
