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
 *
 * `prepId` says WHICH PREPARATION this adapter's spend belongs to, and it is the
 * only field here that is about the books rather than the model. This is the
 * path the rupees are on: the planner and the artist are the Rs 30 a cold topic
 * costs, and until they carried one, `usage_event.prep_id` was filled only by
 * the pre-warm CLI and by zero-unit lock calls. It is meant to be set here, on
 * the adapters a preparation builds, or ambiently by `duringPreparation` in
 * lib/relay.ts — and NO CALLER SETS EITHER YET, so /api/llm still leaves the
 * browser carrying no prep id at all; the wiring is a handoff to
 * lib/liveClass.ts. Prefer naming it here when that lands, because an ambient
 * scope also catches the calls a child makes while the class is already on
 * screen, and playback is not this preparation's spend.
 * Attribution only: it is a uuid we mint and carries nothing about the student.
 */
export function createBrowserLlm(
  model: string,
  opts: {
    json?: boolean;
    effort?: 'none' | 'low' | 'medium' | 'high';
    prepId?: string;
    /**
     * Give up after this long. For a call a student is waiting on in class
     * (the judge): a hung call left the chips hidden and the class frozen
     * (overnight review #31). Class prep sets none — its calls are long.
     */
    timeoutMs?: number;
  } = {},
): LlmAdapter {
  return {
    async complete(system: string, user: string): Promise<string> {
      const signal =
        opts.timeoutMs !== undefined && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(opts.timeoutMs)
          : undefined;
      const res = await relayFetch('/api/llm', {
        ...(signal ? { signal } : {}),
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Set here rather than left to `relayFetch`'s ambient scope BECAUSE it
          // is meant to win over it; relayFetch leaves a header a caller already
          // set alone. The relay validates the uuid or drops it, so a malformed
          // one costs attribution and never the call.
          ...(opts.prepId ? { 'x-prep-id': opts.prepId } : {}),
        },
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

      // `reason` is named here on purpose: it is what `relayError` carries so a
      // screen can tell a 429 the student caused from a 503 we caused without
      // reading prose. It reached the error only because the whole parsed body
      // is passed through, so a tighter cast here would have silently dropped
      // it — a refusal losing the one bit that says whose fault it is.
      const data = (await res.json().catch(() => ({}))) as {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string; reason?: string };
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
