import { createClient } from '@supabase/supabase-js';

/**
 * Both values are PUBLIC and belong in the bundle: the anon key is a published
 * identifier. What a signed-in person may do is decided by the database, in each
 * admin function, never by hiding this. The service-role key is never here and
 * must never be: tools/bin/check-bundle-secrets.mjs is the guard.
 */
const URL_ENV = import.meta.env.VITE_SUPABASE_URL;
const ANON_ENV = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(URL_ENV && ANON_ENV);

export const supabase = createClient(URL_ENV ?? 'http://localhost:54321', ANON_ENV ?? 'unset', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'qrie-admin-auth' },
});

/** The environment this build was made for; the database must agree. */
export const EXPECTED_ENV = import.meta.env.VITE_ADMIN_ENV ?? '';
