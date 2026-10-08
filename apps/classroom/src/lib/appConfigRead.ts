import { supabase } from './supabase';

/**
 * The config for whoever this phone is signed in as (public.my_app_config):
 * their school's switches when they belong to one, else the platform's. It
 * works signed out too (the platform's). It sends nothing but the session the
 * Supabase client already holds.
 */
export async function readMyAppConfig(): Promise<unknown> {
  const db = supabase();
  if (!db) throw new Error('no project configured');
  const { data, error } = await db.rpc('my_app_config');
  if (error) throw new Error(error.message);
  return data;
}
