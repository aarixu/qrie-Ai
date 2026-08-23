import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AgentDispatchClient } from 'livekit-server-sdk';
import { loadLocalEnv, readTokenServerConfig } from './config.ts';
import {
  AGENT_NAME,
  DOUBT_PATH,
  HEALTH_PATH,
  TOKEN_PATH,
  encodeDoubtBrief,
  readDoubtRequest,
  readTokenRequest,
  type DoubtResponse,
} from './protocol.ts';
import { mintStudentToken } from './token.ts';

/**
 * THE TOKEN SERVER — the smallest possible amount of server.
 *
 * It exists for one reason: the LiveKit API secret must never reach a browser.
 * Two endpoints, both POST, and they are deliberately separate:
 *
 *   POST /token   mint a join token for one room and one identity
 *   POST /doubt   dispatch the live tutor into a room the student is already in
 *
 * WHY TWO. The agent must arrive AFTER the student is connected. Dispatching at
 * mint time sends her into an empty room to talk to nobody while the browser is
 * still negotiating WebRTC, and her opening line — the first half of the seam —
 * is spoken to silence. Separating them also means a second raised hand inside
 * the same lesson is one cheap POST on a connection that is already open,
 * instead of a fresh token and a fresh join.
 *
 * Node's own http module, no framework: a dependency here would be a
 * dependency in the one process that holds the secret.
 */

loadLocalEnv();
const config = readTokenServerConfig(process.env);

const dispatcher = new AgentDispatchClient(config.livekitUrl, config.apiKey, config.apiSecret);

/** A transcript of the class so far is the big field; 256 KB is far past it. */
const MAX_BODY_BYTES = 256 * 1024;

type BodyResult = { ok: true; value: unknown } | { ok: false; status: number; error: string };

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * CORS for exactly one origin, echoed back only when it matches. A request
 * with no Origin header at all is not a browser — curl, a health probe, a
 * test — and is allowed through without any CORS header, because CORS was
 * never what stopped those.
 */
function corsAllowed(req: IncomingMessage, res: ServerResponse): boolean {
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (origin !== config.allowedOrigin) return false;

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

async function readJsonBody(req: IncomingMessage): Promise<BodyResult> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      req.destroy();
      return { ok: false, status: 413, error: `body is larger than ${MAX_BODY_BYTES} bytes` };
    }
    chunks.push(buffer);
  }

  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false, status: 400, error: 'body must be JSON' };
  }
}

async function handleToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  if (!body.ok) return sendJson(res, body.status, { error: body.error });

  const request = readTokenRequest(body.value);
  if (request === null) {
    return sendJson(res, 400, { error: 'expected { room, identity, name? } with printable names' });
  }

  sendJson(res, 200, await mintStudentToken(config, request));
  console.log(`[token] ${request.identity} -> room ${request.room}`);
}

async function handleDoubt(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  if (!body.ok) return sendJson(res, body.status, { error: body.error });

  const request = readDoubtRequest(body.value);
  if (request === null) {
    return sendJson(res, 400, {
      error:
        'expected { room, brief } where brief has lessonId, beatId, beatTopic, studentIdentity and student.klass (6-12)',
    });
  }

  // The room already exists: the student is in it. Dispatch metadata is
  // per-invocation, which is the whole reason the brief travels this way.
  const dispatch = await dispatcher.createDispatch(request.room, AGENT_NAME, {
    metadata: encodeDoubtBrief(request.brief),
  });

  const response: DoubtResponse = {
    dispatchId: dispatch.id,
    room: request.room,
    agentName: AGENT_NAME,
  };
  sendJson(res, 200, response);
  console.log(
    `[doubt] ${request.brief.studentIdentity} raised a hand at beat ${request.brief.beatId} in room ${request.room}`,
  );
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url ?? '/', `http://${config.host}`).pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && path === HEALTH_PATH) {
    return sendJson(res, 200, { ok: true, agentName: AGENT_NAME, livekitUrl: config.livekitUrl });
  }

  if (req.method === 'POST' && path === TOKEN_PATH) return handleToken(req, res);
  if (req.method === 'POST' && path === DOUBT_PATH) return handleDoubt(req, res);

  sendJson(res, 404, { error: `no route for ${req.method ?? 'GET'} ${path}` });
}

const server = createServer((req, res) => {
  if (!corsAllowed(req, res)) {
    sendJson(res, 403, { error: 'origin not allowed' });
    return;
  }

  route(req, res).catch((error: unknown) => {
    // The message goes to our log; the browser gets a status and nothing that
    // describes our internals.
    console.error('[error]', error);
    if (!res.headersSent) sendJson(res, 502, { error: 'token server could not complete the request' });
  });
});

server.listen(config.port, config.host, () => {
  console.log(`[ready] token server on http://${config.host}:${config.port}`);
  console.log(`        livekit  ${config.livekitUrl}`);
  console.log(`        origin   ${config.allowedOrigin}`);
  console.log(`        agent    ${AGENT_NAME}`);
});
