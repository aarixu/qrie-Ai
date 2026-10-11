import { createAdminClient, supabaseAdminTransport, type AdminRpcClient } from '@ai-tutor/admin-client';
import { supabase } from './supabase.ts';

/** supabase-js's builder is a thenable of { data, error }; the transport needs only that. */
export const admin = createAdminClient(supabaseAdminTransport(supabase as unknown as AdminRpcClient));
