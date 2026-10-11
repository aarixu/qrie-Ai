import { DEMO_PORT } from './anon-key.ts';
import { DEMO_STAFF } from './seed.ts';

/**
 * npm run admin:demo-code [-- --email ops@qrie-demo.example]
 *
 * Prints the current 6-digit authenticator code for a demo account (the owner
 * unless --email names another), asked of the running local demo on this
 * computer (GET /demo/code, which exists in that demo only). It stands in for
 * an authenticator app while testing; for an account that has just started
 * setting one up, it is the code of that new key.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const email = arg('--email') ?? DEMO_STAFF.owner.email;
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${DEMO_PORT}/demo/code?email=${encodeURIComponent(email)}`);
  } catch {
    throw new Error(`the local demo is not running on port ${DEMO_PORT}. Start it with: npm run admin:demo`);
  }
  const body = (await res.json().catch(() => null)) as { code?: string; secondsLeft?: number; factor?: string; message?: string } | null;
  if (!res.ok || !body?.code) throw new Error(body?.message ?? `the local demo answered ${res.status}`);
  const pending = body.factor === 'unverified' ? ' (the authenticator being set up)' : '';
  console.log(`${body.code}   ${email}${pending}, changes in ${body.secondsLeft} s`);
}

main().catch((e: unknown) => {
  console.error(`admin:demo-code: ${(e as Error).message}`);
  process.exit(1);
});
