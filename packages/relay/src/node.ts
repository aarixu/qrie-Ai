import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { RelayRequest, RelayResponse } from './relays.ts';

/**
 * THE NODE ADAPTER — the only part that knows what a server looks like.
 *
 * Every host we care about speaks Node's request/response: the vite dev
 * server does, Firebase Functions does (its onRequest handler is an Express
 * req/res), Cloud Run does, and so does a plain server. So one adapter is
 * enough, and the relays themselves never learn what a socket is.
 *
 * This is what stops the dev relays and the deployed relays from drifting
 * apart — they are not two implementations, they are this file calling the
 * same functions.
 */

/** Collect a request body. Empty for GET, which never has one. */
export async function readBody(req: IncomingMessage): Promise<Uint8Array> {
  if (req.method === 'GET' || req.method === 'HEAD') return new Uint8Array();
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

export async function toRelayRequest(req: IncomingMessage): Promise<RelayRequest> {
  return {
    method: req.method ?? 'GET',
    url: req.url ?? '/',
    headers: req.headers as Record<string, string | undefined>,
    body: await readBody(req),
  };
}

/**
 * Carry out what a relay decided.
 *
 * A `stream` body is piped through as it arrives rather than collected: the
 * voice starts playing on its first chunk, and buffering the whole file
 * first would put two and a half seconds of silence before every line.
 */
export async function sendRelayResponse(res: ServerResponse, out: RelayResponse): Promise<void> {
  if (out.body.kind === 'json') {
    res.statusCode = out.status;
    // EVERY header the decision set, not just the content type. This branch
    // used to set content-type alone, so `retry-after` — the one thing a
    // client can act on after a 429 or a 503 — never arrived in dev, and a
    // client written to honour it could not be tested against the dev
    // server at all. The bytes branch below always did this correctly.
    for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(out.body.value));
    return;
  }

  if (out.body.kind === 'bytes') {
    res.statusCode = out.status;
    for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
    res.end(Buffer.from(out.body.value));
    return;
  }

  const call = out.body.from;
  /** The same fallback the web host takes — see toResponse in web.ts. */
  const instead = async (): Promise<void> => {
    try {
      const other = await call.orElse!();
      if (other.body.kind === 'stream') throw new Error('a fallback may not be another stream');
      await sendRelayResponse(res, other);
    } catch (e: unknown) {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { message: String(e) } }));
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
      res.statusCode = upstream.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { message: `upstream ${upstream.status}: ${why.slice(0, 300)}` } }));
      return;
    }
    call.onServed?.();
    res.statusCode = 200;
    res.setHeader('content-type', upstream.headers.get('content-type') ?? call.fallbackContentType);
    Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
  } catch (e: unknown) {
    if (call.orElse) return await instead();
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { message: String(e) } }));
  }
}
