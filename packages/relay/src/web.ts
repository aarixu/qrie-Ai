import type { RelayRequest, RelayResponse } from './relays.ts';

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
  try {
    const upstream = await fetch(call.url, {
      method: call.method,
      headers: call.headers,
      ...(call.body === undefined ? {} : { body: call.body }),
    });
    if (!upstream.ok || !upstream.body) {
      const why = await upstream.text().catch(() => '');
      return new Response(
        JSON.stringify({ error: { message: `upstream ${upstream.status}: ${why.slice(0, 300)}` } }),
        { status: upstream.status, headers: { 'content-type': 'application/json', ...headers } },
      );
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? call.fallbackContentType,
        ...headers,
      },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: { message: String(e) } }), {
      status: 502,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }
}

/**
 * Raw audio to a transcript, as multipart.
 *
 * The relay package deliberately holds no platform types, and this is the one
 * place that has to: a transcription endpoint takes a file upload. FormData,
 * Blob and fetch are all web standards that Deno and Node both have now, so
 * one implementation serves both hosts — which is the whole reason this is
 * here rather than copied into each adapter.
 */
export async function transcribeViaFormData(
  key: string,
  model: string,
  contentType: string,
  audio: Uint8Array,
  fetchImpl: typeof fetch = fetch,
): Promise<RelayResponse> {
  const form = new FormData();
  form.append('model', model);
  form.append('file', new Blob([audio as BlobPart], { type: contentType }), 'answer.wav');

  try {
    const upstream = await fetchImpl('https://openrouter.ai/api/v1/audio/transcriptions', {
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
