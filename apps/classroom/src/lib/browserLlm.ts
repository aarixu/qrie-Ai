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
 */
export function createBrowserLlm(model: string, opts: { json?: boolean } = {}): LlmAdapter {
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
