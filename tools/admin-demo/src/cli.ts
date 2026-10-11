import { DEMO_ANON_KEY, DEMO_PORT } from './anon-key.ts';
import { DEMO_ENV } from './seed.ts';
import { startAdminDemoServer } from './server.ts';
import { buildAdminDemo, type BuiltDemo } from './world.ts';

/**
 * npm run admin:demo
 *
 * The admin console's local demo backend, on http://127.0.0.1:54329 only (the
 * port is fixed: apps/admin/.env.demo points there; if something else holds
 * it, this stops and says so). It takes the port first, answers "still being
 * built" while it builds the whole demo in memory (about a minute), then says
 * ready. Nothing is kept: every start is a fresh demo. The sign-in addresses
 * and the demo password are in tools/admin-demo/README.md; this never prints
 * the password.
 */

async function main(): Promise<void> {
  let world: BuiltDemo | null = null;
  const started = Date.now();
  const server = await startAdminDemoServer({
    port: DEMO_PORT,
    anonKey: DEMO_ANON_KEY,
    build: async (url) => {
      console.log(`QRIE admin console, local demo backend: listening on ${url} (this computer only).`);
      console.log('Building the demo in memory, about a minute:');
      return (world = await buildAdminDemo(url, { log: (line) => console.log(`  ${line}`) }));
    },
  });
  await server.ready;
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`\nready: ${server.url} (environment ${DEMO_ENV}, built in ${seconds} s)`);
  console.log('Open the console:   npm run demo --workspace @ai-tutor/admin   then http://localhost:5182');
  console.log('Sign-in addresses and the demo password: tools/admin-demo/README.md');
  console.log("The owner's 6-digit code: npm run admin:demo-code");
  console.log('Cashfree, Auth admin and Storage are FAKE here; nothing leaves this computer.');
  console.log('Stop with Ctrl+C. Everything is forgotten when it stops.\n');

  const stop = async () => {
    await server.close();
    await (world as BuiltDemo | null)?.db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

main().catch((e: unknown) => {
  console.error(`admin:demo stopped: ${(e as Error).message}`);
  process.exit(1);
});
