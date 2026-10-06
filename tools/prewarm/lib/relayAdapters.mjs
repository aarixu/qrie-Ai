/**
 * THE RUNNER'S SIDE OF THE RELAY BOUNDARY — the Node twin of the browser's
 * browserLlm.ts / browserImage.ts.
 *
 * Same rule as the app: every model call goes through the relay's /api/llm
 * with a bearer token; no vendor key ever lives here (house rule — the relay
 * is the only vendor-key holder). Two things are different from the browser:
 *
 *   - `x-prep-id` rides on EVERY call. 0018 poured usage_event.prep_id so S —
 *     how many students share one preparation — can be measured. The header is
 *     validated-or-dropped server-side (handler.ts:339-340 — a non-uuid is
 *     dropped rather than allowed to cost the whole usage row). Phase D's
 *     passthrough now exists in the tree: migration 0019 gives record_usage a
 *     p_prep_id argument and usage.ts:212 passes e.prepId to it. 0019 is an
 *     UNAPPLIED FILE here, and the deployed relay predates it unless somebody
 *     has since redeployed — NOT VERIFIED from this tree, which is why 0019's
 *     p_prep_id defaults to null and the old 13-argument call keeps working.
 *     So today the id is most likely validated and then dropped. Sent
 *     regardless: applying 0019 and redeploying is then the whole change.
 *
 *   - every reply's usage is WRITTEN DOWN here too. On the Vertex path the
 *     relay TRANSLATES Vertex into the OpenAI shape (toOpenAiReply,
 *     packages/relay/src/vertex.ts:276-301) and carries usageMetadata through
 *     unchanged under the key `usage`. BOTH HALVES OF THAT SENTENCE ARE
 *     LOAD-BEARING HERE: the content is read at choices[0].message.content
 *     (OpenAI) while the counts keep Vertex's own names — promptTokenCount /
 *     candidatesTokenCount / thoughtsTokenCount, the same three
 *     usageFromVertex books in packages/relay/src/usage.ts. A reader who
 *     believed the reply came through verbatim would look for `candidates`,
 *     or 'fix' this to read `usageMetadata` and make every call unmeasured.
 *     The runner is the caller, so it can print what each topic cost without
 *     asking the database. Anything it cannot read — no usage block, or one in another
 *     provider's vocabulary — is UNMEASURED, never free. (The relay's
 *     OpenRouter dev fallback is a piped stream whose counts this tool does
 *     not speak; a run against an OpenRouter-configured relay therefore
 *     reports every call unmeasured. Vertex is what students reach.)
 */

/**
 * Mirrors relayError in apps/classroom/src/lib/relay.ts: the relay's own
 * refusal sentences (429/503) surface as-is; anything else keeps the code.
 *
 * AND KEEPS THE MACHINE-READABLE HALF, which the browser does not need and
 * this runner does. gate.ts:237-247 puts `reason` ('rate'|'budget'|'capped'|
 * 'halted'|'unavailable') in the refusal body and the seconds in retry-after.
 * Dropping them left the runner unable to tell a daily ceiling from a broken
 * prompt — so three budget refusals in a row tripped the three-strike stop
 * and reported a content failure to an operator whose only problem was the
 * calendar.
 */
function relayError(status, body, retryAfter) {
  const said = body?.error?.message;
  const err =
    said && (status === 429 || status === 503)
      ? new Error(said)
      : new Error(said ? `relay ${status}: ${said}` : `relay ${status}`);
  err.status = status;
  if (body?.error?.reason) err.reason = body.error.reason;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) err.retryAfterSeconds = seconds;
  return err;
}

export function createRelayClient({ relayUrl, token, prepId, fetchImpl = fetch }) {
  const base = String(relayUrl).replace(/\/+$/, '');
  /** Every /api/llm call this client made: model, tokens, whether measured. */
  const calls = [];

  const ask = async (body) => {
    const res = await fetchImpl(`${base}/api/llm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-prep-id': prepId,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    const usage = data?.usage;
    const images = data?.choices?.[0]?.message?.images?.length ?? 0;
    // MEASURED means "this tool could READ the counts", not "a usage block was
    // present". The only names it can read are Vertex's; a block in any other
    // vocabulary (OpenRouter calls them prompt_tokens) would otherwise score as
    // measured-with-zero-tokens and print Rs 0.00 for a call that cost real
    // money. Presence of the KEY is the test, not its truthiness, so a genuine
    // zero stays measured.
    const readable = (v) => typeof v === 'number' && Number.isFinite(v);
    const measured =
      !!usage &&
      (readable(usage.promptTokenCount) ||
        readable(usage.candidatesTokenCount) ||
        readable(usage.thoughtsTokenCount));
    // HALF A BLOCK IS NOT A WHOLE ONE. measured is an OR, so a reply carrying
    // only promptTokenCount used to price its OUTPUT at zero and present the
    // total as exact — the partial form of the bug above. thoughtsTokenCount
    // is deliberately not in this test: Vertex omits it when the model did not
    // think, which is an absence meaning zero, not an absence meaning unknown.
    const partial =
      measured && !(readable(usage.promptTokenCount) && readable(usage.candidatesTokenCount));
    calls.push({
      model: body.model,
      promptTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
      thoughtTokens: usage?.thoughtsTokenCount ?? 0,
      images,
      measured,
      partial,
    });
    if (!res.ok) throw relayError(res.status, data, res.headers?.get?.('retry-after'));
    // OpenRouter reports upstream failures as a 200 with an error body.
    if (data.error) throw new Error(data.error.message ?? 'unknown LLM error');
    return data;
  };

  return {
    calls,

    /** LlmAdapter — the planner, the artist, the reviewer, the icon picker. */
    llm(model, opts = {}) {
      return {
        async complete(system, user) {
          const data = await ask({
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
            ...(opts.effort ? { reasoning_effort: opts.effort } : {}),
          });
          const text = data.choices?.[0]?.message?.content ?? '';
          if (!text) throw new Error('The model replied with nothing.');
          return text;
        },
      };
    },

    /** ImageAdapter — null when the model answered but drew nothing. */
    imageArtist(model) {
      return {
        async draw(prompt) {
          const data = await ask({ model, messages: [{ role: 'user', content: prompt }] });
          return data.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? null;
        },
      };
    },

    /**
     * VisionAdapter — the picture goes back up as the data: URL it already is
     * (about 1.2 MB for a generated one; the relay takes one picture a call
     * beside its text ceiling, packages/relay/src/vertex.ts MAX_PICTURE_BYTES).
     */
    vision(model) {
      return {
        async look(imageUrl, system, user) {
          const data = await ask({
            model,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              {
                role: 'user',
                content: [
                  { type: 'text', text: user },
                  { type: 'image_url', image_url: { url: imageUrl } },
                ],
              },
            ],
          });
          const text = data.choices?.[0]?.message?.content ?? '';
          if (!text) throw new Error('The model looked and said nothing.');
          return text;
        },
      };
    },

    /** POST the SavedClass to /api/class — the KEEP. */
    async keep(savedClass) {
      const res = await fetchImpl(`${base}/api/class`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'x-prep-id': prepId,
        },
        body: JSON.stringify(savedClass),
      });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, body };
    },
  };
}

/**
 * Price what the relay reported, with the rates parsed from
 * tools/sql/model_price.sql (parseModelPriceSql). The vertex rows are stored
 * under the BARE model name — the browser asks for `google/gemini-3.7-flash`
 * and model_price holds `gemini-3.7-flash` (see bareModel in packages/relay/
 * src/vertex.ts) — so the prefix is stripped the same way here.
 *
 * THE FULL NAME IS TRIED FIRST, though, because some model names contain a
 * slash of their own: model_price carries ('openrouter','deepgram/aura-2')
 * and ('openrouter','deepgram/nova-3'). Stripping unconditionally turned
 * those into 'aura-2', matched nothing, and priced a real call at zero — a
 * hole presented as a saving. Nothing calls them from here today; the trap
 * was waiting for whoever prices speech next.
 *
 * Returns a floor and says so: `unmeasured` counts calls whose reply carried
 * no usage, calls whose usage was only PARTLY readable, and calls whose model
 * has no parsed price. Zero quantities at a missing price cost nothing and
 * flag nothing.
 */
export function priceCalls(calls, prices) {
  const bare = (model) => model.replace(/^[a-z0-9-]+\//, '');
  const rateFor = (model, unit) =>
    prices.rows.find((r) => (r.model === model || r.model === bare(model)) && r.unit === unit)
      ?.inrPerUnit;

  let inr = 0;
  let unmeasured = 0;
  for (const call of calls) {
    if (!call.measured) {
      unmeasured += 1;
      continue;
    }
    const parts = [
      [call.promptTokens, 'prompt_token'],
      [call.outputTokens, 'output_token'],
      [call.thoughtTokens, 'thought_token'],
      [call.images, 'image'],
    ];
    // A hole is a hole whether the price row is missing or the COUNT is.
    let holed = call.partial === true;
    for (const [quantity, unit] of parts) {
      if (!quantity) continue;
      const rate = rateFor(call.model, unit);
      if (rate === undefined) {
        holed = true;
        continue;
      }
      inr += quantity * rate;
    }
    if (holed) unmeasured += 1;
  }
  return { inr, unmeasured };
}
