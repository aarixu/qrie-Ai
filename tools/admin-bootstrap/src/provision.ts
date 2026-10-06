/**
 * THE FIRST OWNER. Run once, from a laptop, with the service-role key.
 *
 * It does three things, in this order, over plain HTTP: makes a permanent auth
 * account marked app_metadata.provisioned_by = 'staff' (so the sign-up trigger
 * gives it no solo organisation, 0047), tells the database which environment
 * this is, and makes the account the owner. The owner then signs in to the
 * panel and enrols an authenticator app straight away; until they do, anyone
 * who learns the password could enrol their own, so do not leave the gap open.
 *
 * The service-role key and the password are sent only in these requests. Neither
 * ever appears in an error message or a log line.
 */
export type Environment = 'HOSTED' | 'STAGING' | 'DEMO' | 'TEST';

export interface ProvisionInput {
  url: string;
  serviceKey: string;
  email: string;
  password: string;
  name: string;
  environment: Environment;
  fetchImpl?: typeof fetch;
}

export const MIN_PASSWORD_LENGTH = 12;

export async function provisionOwner(input: ProvisionInput): Promise<{ userId: string }> {
  const { url, serviceKey, email, password, name, environment } = input;
  const fetchImpl = input.fetchImpl ?? fetch;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('that is not an email address');
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`the password is at least ${MIN_PASSWORD_LENGTH} characters`);
  if (!name.trim()) throw new Error('give the owner a name');

  const base = url.replace(/\/+$/, '');
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' };

  async function call(label: string, path: string, body: unknown, extra: Record<string, string> = {}): Promise<unknown> {
    const res = await fetchImpl(`${base}${path}`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(`${label} failed: ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  const created = (await call('creating the account', '/auth/v1/admin/users', {
    email,
    password,
    email_confirm: true,
    app_metadata: { provisioned_by: 'staff' },
  })) as { id?: unknown } | null;
  const userId = typeof created?.id === 'string' ? created.id : null;
  if (!userId) throw new Error('creating the account returned no id');

  await call('setting the environment', '/rest/v1/rpc/set_environment', { p_env: environment }, { 'content-profile': 'admin' });
  await call('making the owner', '/rest/v1/rpc/bootstrap_owner', { p_user: userId, p_name: name.trim() }, { 'content-profile': 'admin' });
  return { userId };
}
