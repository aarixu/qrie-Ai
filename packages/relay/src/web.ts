import type { HeardAudio, RelayRequest, RelayResponse } from './relays.ts';

/**
 * THE WEB-STANDARD ADAPTER — Deno, Workers, and anything else that speaks
 * Request and Response.
 *
 * node.ts already carries the vite dev server and the Node token server. A
 * Supabase Edge Function is Deno, where there is no IncomingMessage and no
 * node:stream, so it needs this one. Both are a few dozen lines on purpose:
 * the decisions live in relays.ts and handler.ts, and an adapter that starts
 * making decisions is how two hosts begin to behave differently.
 */

export async function toRelayRequest(request: Request): Promise<RelayRequest> {
  const headers: Record<string, string> = {};
  // Header names arrive lower-cased through the Headers iterator, which is what
  // the relays index by.
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? new Uint8Array()
      : new Uint8Array(await request.arrayBuffer());
  return { method: request.method, url: request.url, headers, body };
}

/**
 * Carry out what a relay decided.
 *
 * A `stream` body is handed back as the upstream's own ReadableStream rather
 * than being read into memory first: the voice starts playing on its first
 * chunk, and buffering the whole file would put two and a half seconds of
 * silence before every line.
 */
export async function toResponse(
  out: RelayResponse,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const headers = { ...out.headers, ...extraHeaders };

  if (out.body.kind === 'json') {
    return new Response(JSON.stringify(out.body.value), {
      status: out.status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }

  if (out.body.kind === 'bytes') {
    // Copied into its own buffer: a Uint8Array over a shared ArrayBuffer is
    // not a BodyInit, and the view may be a window onto something larger.
    return new Response(out.body.value.slice().buffer as ArrayBuffer, {
      status: out.status,
      headers,
    });
  }

  const call = out.body.from;
  /**
   * The upstream failed and the relay prepared another answer — Vertex's voice
   * when OpenRouter's is out of credit or down. A throw from it, or a stream
   * where the contract promises none, is a 502 rather than a loop.
   */
  const instead = async (): Promise<Response> => {
    try {
      const other = await call.orElse!();
      if (other.body.kind === 'stream') throw new Error('a fallback may not be another stream');
      return await toResponse(other, extraHeaders);
    } catch (e: unknown) {
      return new Response(JSON.stringify({ error: { message: String(e) } }), {
        status: 502,
        headers: { 'content-type': 'application/json', ...headers },
      });
    }
  };
  try {
    const upstream = await fetch(call.url, {
      method: call.method,
      headers: call.headers,
      ...(call.body === undefined ? {} : { body: call.body }),
    });
    if (!upstream.ok || !upstream.body) {
      const why = await upstream.text().catch(() => '');
      if (call.orElse) return await instead();
      return new Response(
        JSON.stringify({ error: { message: `upstream ${upstream.status}: ${why.slice(0, 300)}` } }),
        { status: upstream.status, headers: { 'content-type': 'application/json', ...headers } },
      );
    }
    call.onServed?.();
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? call.fallbackContentType,
        ...headers,
      },
    });
  } catch (e: unknown) {
    if (call.orElse) return await instead();
    return new Response(JSON.stringify({ error: { message: String(e) } }), {
      status: 502,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }
}

const TRANSCRIPTIONS = 'https://openrouter.ai/api/v1/audio/transcriptions';

/**
 * Raw audio to a transcript, as multipart.
 *
 * The relay package deliberately holds no platform types, and this is the one
 * place that has to: a transcription endpoint takes a file upload. FormData,
 * Blob and fetch are all web standards that Deno and Node both have now, so
 * one implementation serves both hosts — which is the whole reason this is
 * here rather than copied into each adapter.
 *
 * `language` is decided in relays.ts and only carried here. The adapter does
 * not get to choose it: the moment two hosts pick their own, one of them is
 * transcribing Hinglish with an English model and nothing says so. It arrives
 * inside `HeardAudio`, exactly as hearRelay built it, so no host can put it in
 * the wrong position — see that type for the swap this shape forbids.
 *
 * WHAT IS NOT ASKED FOR, AND WHY IT IS NOT. Not `response_format:
 * verbose_json`. Without a response_format the vendor returns `{ text }` alone
 * and every confidence it computed is dropped at the wire, and a confidence is
 * worth having precisely here: `tools/speech/README.md` measured the signal
 * separating an English sentence (−0.22, exact) from Hinglish (−0.79, garbage)
 * cleanly, on a model that reported no error either time. It is still not
 * asked for, because the parameter is unmeasured against `deepgram/nova-3`
 * through OpenRouter and nothing reads the fields yet. An unrecognised
 * parameter on a transcription endpoint does not degrade politely — it can
 * come back as a refusal, or as a 200 in a shape whose missing `text` becomes
 * `reason: 'silence'` in `apps/classroom/src/lib/ear.ts`, filing a child who
 * spoke as a child who said nothing. That is the exact defect this file was
 * opened to fix, and it is not worth re-opening for fields no code reads. It
 * goes in after one live call has shown what comes back, together with the
 * code that reads it.
 *
 * AND NOTHING IS RETRIED WITHOUT THE LANGUAGE. If the vendor refuses `multi`,
 * this call fails and the room says it could not hear. It must NOT fall back
 * to the plain form: the plain form is the English ear, and its answer is a
 * confident invention that nothing downstream can tell from the truth.
 * Unheard and loud beats heard-wrong and silent.
 */
export async function transcribeViaFormData(
  key: string,
  call: HeardAudio,
  fetchImpl: typeof fetch = fetch,
): Promise<RelayResponse> {
  const form = new FormData();
  form.append('model', call.model);
  form.append('language', call.language);
  form.append('file', new Blob([call.audio as BlobPart], { type: call.contentType }), 'answer.wav');

  try {
    const upstream = await fetchImpl(TRANSCRIPTIONS, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
    });
    const text = await upstream.text();
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      // Upstream said something that is not JSON — usually an HTML error page
      // from a proxy. Passing it through verbatim would break every caller's
      // parse; naming it keeps the failure readable.
      value = { error: { message: `upstream ${upstream.status}: ${text.slice(0, 300)}` } };
    }
    return {
      status: upstream.status,
      headers: { 'content-type': 'application/json' },
      body: { kind: 'json', value },
    };
  } catch (e: unknown) {
    return {
      status: 502,
      headers: { 'content-type': 'application/json' },
      body: { kind: 'json', value: { error: { message: String(e) } } },
    };
  }
}
