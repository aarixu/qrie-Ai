import { createClient } from '@supabase/supabase-js';
import { isServiceRoleKey } from './public-key.ts';

/**
 * Both values are PUBLIC and belong in the bundle: the anon key is a published
 * identifier. What a signed-in person may do is decided by the database, in each
 * admin function, never by hiding this.
 *
 * The service-role key must never be here. Two guards: the build scans its own
 * output (`npm run build` runs tools/bin/check-bundle-secrets.mjs on dist), and
 * if a secret key was put in VITE_SUPABASE_ANON_KEY anyway the console refuses to
 * start with it and says so. It is still in that bundle, so it must be rotated.
 */
const URL_ENV = import.meta.env.VITE_SUPABASE_URL;
const ANON_ENV = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const keyProblem: string | null = isServiceRoleKey(ANON_ENV)
  ? 'This build was given a secret key (service role) instead of the public anon key. Do not use it: replace VITE_SUPABASE_ANON_KEY, rebuild, and rotate the secret key in Supabase.'
  : null;

export const configured = Boolean(URL_ENV && ANON_ENV) && keyProblem === null;

export const supabase = createClient(URL_ENV ?? 'http://localhost:54321', keyProblem === null ? (ANON_ENV ?? 'unset') : 'unset', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'qrie-admin-auth' },
});

/** The environment this build was made for; every write sends it, and the database refuses a mismatch. */
export const EXPECTED_ENV = import.meta.env.VITE_ADMIN_ENV ?? '';
