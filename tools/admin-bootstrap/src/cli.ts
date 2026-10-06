import { provisionOwner, type Environment } from './provision.ts';

/**
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   ADMIN_OWNER_EMAIL=you@example.com ADMIN_OWNER_PASSWORD=... ADMIN_OWNER_NAME="Aarav" \
 *   node --experimental-strip-types tools/admin-bootstrap/src/cli.ts --env HOSTED
 *
 * The environment is a flag, never a default: making an owner on the wrong
 * database is the mistake this tool exists to make hard.
 */
const ENVIRONMENTS: Environment[] = ['HOSTED', 'STAGING', 'DEMO', 'TEST'];

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is not set`);
    process.exit(2);
  }
  return v;
}

const flag = process.argv.indexOf('--env');
const environment = process.argv[flag + 1] as Environment | undefined;
if (flag < 0 || !environment || !ENVIRONMENTS.includes(environment)) {
  console.error(`pass --env ${ENVIRONMENTS.join(' | ')}`);
  process.exit(2);
}

try {
  const { userId } = await provisionOwner({
    url: need('SUPABASE_URL'),
    serviceKey: need('SUPABASE_SERVICE_ROLE_KEY'),
    email: need('ADMIN_OWNER_EMAIL'),
    password: need('ADMIN_OWNER_PASSWORD'),
    name: need('ADMIN_OWNER_NAME'),
    environment,
  });
  console.log(`Owner made (${userId}) on ${environment}.`);
  console.log('Sign in to the panel now and enrol your authenticator app before anything else.');
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
