import {
  adminApiUrl,
  createAdminClient,
  createSchoolsClient,
  createStaffClient,
  createSystemClient,
  createUsersClient,
  fetchAdminApi,
  supabaseAdminTransport,
  type AdminRpcClient,
} from '@ai-tutor/admin-client';
import { supabase } from './supabase.ts';

/** supabase-js's builder is a thenable of { data, error }; the transport needs only that. */
const rpc = supabaseAdminTransport(supabase as unknown as AdminRpcClient);
/** The admin-api edge function, with the signed-in person's own token. */
const api = fetchAdminApi(
  adminApiUrl(import.meta.env.VITE_SUPABASE_URL ?? ''),
  async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
);

export const admin = createAdminClient(rpc);
export const schools = createSchoolsClient(rpc, api);
export const users = createUsersClient(rpc, api);
export const staff = createStaffClient(rpc, api);
export const system = createSystemClient(rpc);
