import { supabase } from './supabase.ts';

/**
 * The second factor, an authenticator app (TOTP). Supabase offers TOTP and SMS;
 * SMS is not used here: a phone number can be taken over.
 */
async function verifiedFactorId(): Promise<string | null> {
  const { data } = await supabase.auth.mfa.listFactors();
  return (data?.all ?? []).find((f) => f.factor_type === 'totp' && f.status === 'verified')?.id ?? null;
}

async function challengeAndVerify(factorId: string, code: string): Promise<void> {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) throw new Error(challenge.error.message);
  const verified = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code: code.trim() });
  if (verified.error) throw new Error('That code did not work. Wait for the next one and try again.');
}

/** Verifies a code against the person's existing authenticator; the session becomes aal2 and its amr is fresh. */
export async function verifyCode(code: string): Promise<void> {
  const id = await verifiedFactorId();
  if (!id) throw new Error('No authenticator is set up for this account.');
  await challengeAndVerify(id, code);
}

export interface Enrolment {
  factorId: string;
  qr: string;
  secret: string;
}

/** Starts a new enrolment, first dropping any abandoned (unverified) one so they cannot pile up. */
export async function startEnrolment(): Promise<Enrolment> {
  const { data: list } = await supabase.auth.mfa.listFactors();
  for (const f of list?.all ?? []) {
    if (f.factor_type === 'totp' && f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Qrie control' });
  if (error || !data) throw new Error(error?.message ?? 'Could not start enrolment.');
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function finishEnrolment(factorId: string, code: string): Promise<void> {
  await challengeAndVerify(factorId, code);
}
