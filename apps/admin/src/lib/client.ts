import {
  adminApiUrl,
  billingApiFetch,
  createAdminClient,
  createBillingClient,
  createClassesClient,
  createPrivacyClient,
  createSafetyClient,
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

/** Plan 5: safety (reports, cases, the read log), classes and privacy; class removal and erasure go through admin-api. */
export const safety = createSafetyClient(rpc);
export const classes = createClassesClient(rpc, api);
export const privacy = createPrivacyClient(rpc, api);

/** Billing: the admin.billing_* functions, and billing-api (the only caller of Cashfree) with the session's token. */
export const billing = createBillingClient(
  rpc,
  billingApiFetch({
    functionsUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/billing-api`,
    accessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
  }),
);
