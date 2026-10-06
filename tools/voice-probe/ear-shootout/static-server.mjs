/**
 * THE ONE-PAGE SERVER FOR A TUNNEL.
 *
 * server.mjs has a /hear route that spends Aarav's Vertex money, so it must
 * never be put on the internet. This serves phone.html and nothing else - no
 * other path, no POST, no files - so a tunnel to this port exposes one static
 * page that talks only to the visitor's own browser speech recogniser.
 *
 *   node tools/voice-probe/ear-shootout/static-server.mjs      (port 5198)
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'phone.html'));
const PORT = Number(process.env.PORT ?? 5198);

createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      // The page uses the visitor's microphone and nothing else.
      'permissions-policy': 'microphone=(self), camera=(), geolocation=()',
    });
    res.end(page);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}).listen(PORT, '127.0.0.1', () => console.log(`Static ear test page: http://127.0.0.1:${PORT}`));
