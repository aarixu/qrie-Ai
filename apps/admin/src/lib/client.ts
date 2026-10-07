import { billingApiFetch, createAdminClient, createBillingClient, supabaseAdminTransport, type AdminRpcClient } from '@ai-tutor/admin-client';
import { supabase } from './supabase.ts';

/** supabase-js's builder is a thenable of { data, error }; the transport needs only that. */
export const admin = createAdminClient(supabaseAdminTransport(supabase as unknown as AdminRpcClient));

/** Billing: the admin.billing_* functions, and billing-api (the only caller of Cashfree) with the session's token. */
export const billing = createBillingClient(
  supabaseAdminTransport(supabase as unknown as AdminRpcClient),
  billingApiFetch({
    functionsUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/billing-api`,
    accessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
  }),
);
